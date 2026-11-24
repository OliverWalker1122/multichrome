import fs from 'node:fs';
import path from 'node:path';
import {
    createEmptyBookmarksDocument,
    mergeBookmarkTemplatesIntoDocument,
    normalizeBookmarkTemplates,
    normalizeExtensionTemplates,
    toChromiumTimestamp,
} from '../domain/profileTemplatePolicy.js';

/**
 * Check whether a Chromium profile directory already contains saved session files.
 */
export function hasSavedChromeSession(dataDir) {
    if (!dataDir || typeof dataDir !== 'string') return false;
    try {
        const defaultDir = path.join(dataDir, 'Default');
        const sessionsDir = path.join(defaultDir, 'Sessions');
        if (fs.existsSync(sessionsDir)) {
            const entries = fs.readdirSync(sessionsDir);
            if (entries.some((name) => /^(Session|Tabs)_/i.test(name))) {
                return true;
            }
        }
        for (const legacyFile of [
            'Current Session',
            'Last Session',
            'Current Tabs',
            'Last Tabs',
        ]) {
            if (fs.existsSync(path.join(defaultDir, legacyFile))) {
                return true;
            }
        }
    } catch {
        return false;
    }
    return false;
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
    let existingDoc = null;
    if (fs.existsSync(bookmarksPath)) {
        try {
            existingDoc = JSON.parse(fs.readFileSync(bookmarksPath, 'utf-8'));
        } catch {
            existingDoc = createEmptyBookmarksDocument(nowTs);
        }
    } else {
        existingDoc = createEmptyBookmarksDocument(nowTs);
    }

    const { doc, addedCount, skippedCount } = mergeBookmarkTemplatesIntoDocument(
        existingDoc,
        templates,
        nowTs,
    );

    if (addedCount > 0) {
        fs.writeFileSync(bookmarksPath, JSON.stringify(doc, null, 2), 'utf-8');
    }

    return { addedCount, skippedCount };
}

/**
 * Determine which unpacked extension directories exist on disk and should be loaded.
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
