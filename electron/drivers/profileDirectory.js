import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Count directory ownership conflicts for an explicitly requested diagnostics report. */
export function countSharedProfileDirectories(profiles) {
    const seen = new Set();
    const shared = new Set();
    for (const profile of profiles) {
        if (!profile?.dataDir) continue;
        const normalized = path.resolve(profile.dataDir);
        const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        if (seen.has(key)) shared.add(key);
        else seen.add(key);
    }
    return shared.size;
}

export function isProfileId(value) {
    return typeof value === 'string' && uuidPattern.test(value);
}

/** Reserve a fresh directory atomically while retaining legacy directory and process identities. */
export function reserveProfileDirectory(root, isOwned, importedId, generate = randomUUID) {
    for (let attempt = 0; attempt < 16; attempt++) {
        const id = importedId ?? generate();
        if (!isProfileId(id)) throw new Error('Invalid profile UUID');
        const directory = path.join(root, id.slice(0, 8).toLowerCase());
        if (!isOwned(directory)) {
            try {
                fs.mkdirSync(directory);
                return { id, dataDir: directory };
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
            }
        }
        if (importedId) throw new Error('Profile directory is already reserved');
    }
    throw new Error('Unable to reserve a unique profile directory');
}
