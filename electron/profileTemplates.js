import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function isValidHttpUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    try {
        const parsed = new URL(raw.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export function normalizeBookmarkTemplates(raw) {
    if (!Array.isArray(raw)) return [];
    const seenIds = new Set();
    const result = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
        const url = typeof item.url === 'string' ? item.url.trim() : '';
        if (!name || !isValidHttpUrl(url)) continue;
        const id =
            typeof item.id === 'string' && item.id.trim() && !seenIds.has(item.id.trim())
                ? item.id.trim()
                : randomUUID();
        seenIds.add(id);
        const folder =
            typeof item.folder === 'string' && item.folder.trim()
                ? item.folder.trim().slice(0, 60)
                : '';
        result.push({
            id,
            name,
            url,
            ...(folder ? { folder } : {}),
        });
    }
    return result;
}

export function normalizeExtensionTemplates(raw) {
    if (!Array.isArray(raw)) return [];
    const seenIds = new Set();
    const result = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const extPath = typeof item.path === 'string' ? item.path.trim() : '';
        if (!extPath) continue;
        const name =
            typeof item.name === 'string' && item.name.trim()
                ? item.name.trim().slice(0, 80)
                : path.basename(extPath);
        const id =
            typeof item.id === 'string' && item.id.trim() && !seenIds.has(item.id.trim())
                ? item.id.trim()
                : randomUUID();
        seenIds.add(id);
        result.push({
            id,
            name,
            path: extPath,
            enabled: item.enabled !== false,
        });
    }
    return result;
}

export function normalizeGroupStartupUrls(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
        const groupName = typeof key === 'string' ? key.trim() : '';
        const url = typeof value === 'string' ? value.trim() : '';
        if (!groupName || !url) continue;
        if (isValidHttpUrl(url)) {
            result[groupName] = url;
        }
    }
    return result;
}

export function renameGroupStartupUrl(rawMap, oldName, newName) {
    const normalized = normalizeGroupStartupUrls(rawMap);
    const from = typeof oldName === 'string' ? oldName.trim() : '';
    const to = typeof newName === 'string' ? newName.trim() : '';
    if (!from || !to || from === to || !(from in normalized)) {
        return { changed: false, next: normalized };
    }
    const next = { ...normalized };
    const existingUrl = next[from];
    delete next[from];
    if (!(to in next) && existingUrl) {
        next[to] = existingUrl;
    }
    return { changed: true, next };
}

export function removeGroupStartupUrl(rawMap, groupName) {
    const normalized = normalizeGroupStartupUrls(rawMap);
    const target = typeof groupName === 'string' ? groupName.trim() : '';
    if (!target || !(target in normalized)) {
        return { changed: false, next: normalized };
    }
    const next = { ...normalized };
    delete next[target];
    return { changed: true, next };
}

/**
 * Startup URL precedence: per-environment > per-group > global.
 */
export function resolveEffectiveStartupUrl({
    envStartupUrl = '',
    groupName = '',
    groupStartupUrls = {},
    globalStartupUrl = '',
} = {}) {
    if (typeof envStartupUrl === 'string' && envStartupUrl.trim()) {
        return envStartupUrl.trim();
    }
    if (
        typeof groupName === 'string' &&
        groupName.trim() &&
        groupStartupUrls &&
        typeof groupStartupUrls[groupName.trim()] === 'string' &&
        groupStartupUrls[groupName.trim()].trim()
    ) {
        return groupStartupUrls[groupName.trim()].trim();
    }
    if (typeof globalStartupUrl === 'string' && globalStartupUrl.trim()) {
        return globalStartupUrl.trim();
    }
    return '';
}

function toChromiumTimestamp(date = new Date()) {
    // Microseconds since 1601-01-01 UTC
    const unixMs = date.getTime();
    return String((unixMs + 11644473600000) * 1000);
}

function collectExistingUrlsAndMaxId(node, urls, state) {
    if (!node || typeof node !== 'object') return;
    const numericId = Number(node.id);
    if (Number.isInteger(numericId) && numericId > state.maxId) {
        state.maxId = numericId;
    }
    if (node.type === 'url' && typeof node.url === 'string') {
        urls.add(node.url.trim().replace(/\/+$/, '').toLowerCase());
    }
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            collectExistingUrlsAndMaxId(child, urls, state);
        }
    }
}

function createEmptyBookmarksDocument(nowTs) {
    return {
        roots: {
            bookmark_bar: {
                children: [],
                date_added: nowTs,
                date_last_used: '0',
                date_modified: nowTs,
                guid: randomUUID(),
                id: '1',
                name: 'Bookmarks bar',
                type: 'folder',
            },
            other: {
                children: [],
                date_added: nowTs,
                date_last_used: '0',
                date_modified: nowTs,
                guid: randomUUID(),
                id: '2',
                name: 'Other bookmarks',
                type: 'folder',
            },
            synced: {
                children: [],
                date_added: nowTs,
                date_last_used: '0',
                date_modified: nowTs,
                guid: randomUUID(),
                id: '3',
                name: 'Mobile bookmarks',
                type: 'folder',
            },
        },
        version: 1,
    };
}

/**
 * Safely merge bookmark templates into <dataDir>/Default/Bookmarks without
 * overwriting or removing any existing user bookmarks.
 */
export function syncBookmarksToProfile(dataDir, rawTemplates) {
    const templates = normalizeBookmarkTemplates(rawTemplates);
    if (!dataDir || templates.length === 0) {
        return { addedCount: 0, skippedCount: 0 };
    }

    const defaultDir = path.join(dataDir, 'Default');
    const bookmarksPath = path.join(defaultDir, 'Bookmarks');
    fs.mkdirSync(defaultDir, { recursive: true });

    const nowTs = toChromiumTimestamp();
    let doc;
    if (fs.existsSync(bookmarksPath)) {
        try {
            doc = JSON.parse(fs.readFileSync(bookmarksPath, 'utf-8'));
        } catch {
            doc = createEmptyBookmarksDocument(nowTs);
        }
    } else {
        doc = createEmptyBookmarksDocument(nowTs);
    }

    if (!doc || typeof doc !== 'object' || !doc.roots || typeof doc.roots !== 'object') {
        doc = createEmptyBookmarksDocument(nowTs);
    }
    if (!doc.roots.bookmark_bar || !Array.isArray(doc.roots.bookmark_bar.children)) {
        doc.roots.bookmark_bar = createEmptyBookmarksDocument(nowTs).roots.bookmark_bar;
    }

    const existingUrls = new Set();
    const idState = { maxId: 3 };
    collectExistingUrlsAndMaxId(doc.roots.bookmark_bar, existingUrls, idState);
    collectExistingUrlsAndMaxId(doc.roots.other, existingUrls, idState);
    collectExistingUrlsAndMaxId(doc.roots.synced, existingUrls, idState);

    let addedCount = 0;
    let skippedCount = 0;

    for (const tpl of templates) {
        const normalizedUrl = tpl.url.trim().replace(/\/+$/, '').toLowerCase();
        if (existingUrls.has(normalizedUrl)) {
            skippedCount += 1;
            continue;
        }
        existingUrls.add(normalizedUrl);

        let targetChildren = doc.roots.bookmark_bar.children;
        if (tpl.folder) {
            let folderNode = targetChildren.find(
                (child) =>
                    child &&
                    child.type === 'folder' &&
                    child.name === tpl.folder &&
                    Array.isArray(child.children),
            );
            if (!folderNode) {
                idState.maxId += 1;
                folderNode = {
                    children: [],
                    date_added: nowTs,
                    date_last_used: '0',
                    date_modified: nowTs,
                    guid: randomUUID(),
                    id: String(idState.maxId),
                    name: tpl.folder,
                    type: 'folder',
                };
                targetChildren.push(folderNode);
            }
            targetChildren = folderNode.children;
        }

        idState.maxId += 1;
        targetChildren.push({
            date_added: nowTs,
            date_last_used: '0',
            guid: randomUUID(),
            id: String(idState.maxId),
            name: tpl.name,
            type: 'url',
            url: tpl.url,
        });
        addedCount += 1;
    }

    if (addedCount > 0) {
        // Delete stale checksum so Chromium accepts and recalculates it on launch
        delete doc.checksum;
        doc.roots.bookmark_bar.date_modified = nowTs;
        fs.writeFileSync(bookmarksPath, JSON.stringify(doc, null, 2), 'utf-8');
    }

    return { addedCount, skippedCount };
}

/**
 * Determine which unpacked extension directories should be loaded for a profile.
 * Preserves C++ Pure Native Zero-Extension Stealth by default unless explicitly opted in.
 */
export function resolveExtensionTemplatePaths(
    rawTemplates,
    {
        isFingerprintChromium = false,
        allowExtensionsOnFingerprintKernel = false,
    } = {},
) {
    if (isFingerprintChromium && !allowExtensionsOnFingerprintKernel) {
        return [];
    }
    const templates = normalizeExtensionTemplates(rawTemplates);
    const validPaths = [];
    for (const tpl of templates) {
        if (!tpl.enabled) continue;
        try {
            const manifestPath = path.join(tpl.path, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                validPaths.push(tpl.path);
            }
        } catch {
            // ignore inaccessible path
        }
    }
    return validPaths;
}
