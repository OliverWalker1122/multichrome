export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS_PER_ENV = 12;

export type TagFilterMode = 'all' | 'any';

export interface TagStat {
    tag: string;
    count: number;
}

export function normalizeTagName(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const collapsed = raw.trim().replace(/\s+/g, ' ');
    if (!collapsed) return '';
    return collapsed.slice(0, MAX_TAG_LENGTH).trim();
}

export function parseTagInput(raw: string): string[] {
    if (typeof raw !== 'string') return [];
    return normalizeEnvironmentTags(raw.split(/[,，;；\r\n]+/));
}

export function normalizeEnvironmentTags(raw: unknown): string[] {
    const items = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(/[,，;；\r\n]+/)
          : [];
    const result: string[] = [];
    const seen = new Set<string>();

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

export function collectTagStats(
    environments: Array<{ tags?: string[] }>,
): TagStat[] {
    const bucket = new Map<string, TagStat>();

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

export function matchesTagFilter(
    envTags: string[] | undefined,
    selectedTags: string[],
    mode: TagFilterMode = 'all',
): boolean {
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
