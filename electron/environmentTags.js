export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS_PER_ENV = 12;

export function normalizeTagName(raw) {
    if (typeof raw !== 'string') return '';
    const collapsed = raw.trim().replace(/\s+/g, ' ');
    if (!collapsed) return '';
    return collapsed.slice(0, MAX_TAG_LENGTH).trim();
}

export function parseTagInput(raw) {
    if (typeof raw !== 'string') return [];
    const parts = raw.split(/[,，;；\r\n]+/);
    return normalizeEnvironmentTags(parts);
}

export function normalizeEnvironmentTags(raw) {
    const items = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(/[,，;；\r\n]+/)
          : [];
    const result = [];
    const seen = new Set();

    for (const item of items) {
        const cleaned = normalizeTagName(item);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(cleaned);
        if (result.length >= MAX_TAGS_PER_ENV) break;
    }

    return result;
}

export function parseStoredEnvironmentTags(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return normalizeEnvironmentTags(raw);
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return normalizeEnvironmentTags(parsed);
    } catch {
        return [];
    }
}

export function collectTagStats(environments) {
    if (!Array.isArray(environments)) return [];
    const bucket = new Map();

    for (const env of environments) {
        const envTags = normalizeEnvironmentTags(env?.tags);
        for (const tag of envTags) {
            const key = tag.toLowerCase();
            const existing = bucket.get(key);
            if (existing) {
                existing.count += 1;
            } else {
                bucket.set(key, { tag, count: 1 });
            }
        }
    }

    return Array.from(bucket.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag);
    });
}

export function matchesTagFilter(envTags, selectedTags, mode = 'all') {
    const normalizedSelected = normalizeEnvironmentTags(selectedTags);
    if (normalizedSelected.length === 0) return true;

    const envTagKeys = new Set(
        normalizeEnvironmentTags(envTags).map((tag) => tag.toLowerCase()),
    );
    if (envTagKeys.size === 0) return false;

    if (mode === 'any') {
        return normalizedSelected.some((tag) =>
            envTagKeys.has(tag.toLowerCase()),
        );
    }
    return normalizedSelected.every((tag) => envTagKeys.has(tag.toLowerCase()));
}

export function filterEnvironmentsByTags(
    environments,
    selectedTags,
    mode = 'all',
) {
    if (!Array.isArray(environments)) return [];
    const normalizedSelected = normalizeEnvironmentTags(selectedTags);
    if (normalizedSelected.length === 0) return environments;
    return environments.filter((env) =>
        matchesTagFilter(env?.tags, normalizedSelected, mode),
    );
}
