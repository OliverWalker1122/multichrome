import {
    normalizeDeleteGroupOptions,
    normalizeRenameGroupOptions,
} from '../domain/groupPolicy.js';

/**
 * SQLite Group Persistence Operations (Layer 1 Repository).
 */
export function executeRenameGroup({ db, oldName, newName }) {
    const normalized = normalizeRenameGroupOptions(oldName, newName);
    const result = db
        .prepare(
            'UPDATE environments SET groupName = ? WHERE groupName = ? AND deletedAt IS NULL',
        )
        .run(normalized.newName, normalized.oldName);
    return {
        oldName: normalized.oldName,
        newName: normalized.newName,
        affectedCount: typeof result?.changes === 'number' ? result.changes : 0,
    };
}

/**
 * @param {{
 *   db: any,
 *   groupName: string,
 *   options?: { action?: 'move' | 'trash'; targetGroup?: string },
 *   closeRunningEnv?: ((id: string) => Promise<void>) | undefined,
 *   now?: string | undefined,
 * }} params
 */
export async function executeDeleteGroup({
    db,
    groupName,
    options = { action: 'move' },
    closeRunningEnv = undefined,
    now = undefined,
}) {
    const normalized = normalizeDeleteGroupOptions(groupName, options);
    const activeEnvs = db
        .prepare(
            'SELECT id, name FROM environments WHERE groupName = ? AND deletedAt IS NULL',
        )
        .all(normalized.groupName);

    if (!activeEnvs || activeEnvs.length === 0) {
        return {
            groupName: normalized.groupName,
            action: normalized.action,
            targetGroup: normalized.targetGroup,
            affectedCount: 0,
        };
    }

    if (normalized.action === 'move') {
        const result = db
            .prepare(
                'UPDATE environments SET groupName = ? WHERE groupName = ? AND deletedAt IS NULL',
            )
            .run(normalized.targetGroup, normalized.groupName);
        return {
            groupName: normalized.groupName,
            action: 'move',
            targetGroup: normalized.targetGroup,
            affectedCount:
                typeof result?.changes === 'number'
                    ? result.changes
                    : activeEnvs.length,
        };
    }

    if (typeof closeRunningEnv === 'function') {
        for (const env of activeEnvs) {
            await closeRunningEnv(env.id);
        }
    }

    const deletedAt = now || new Date().toISOString();
    const result = db
        .prepare(
            'UPDATE environments SET deletedAt = ? WHERE groupName = ? AND deletedAt IS NULL',
        )
        .run(deletedAt, normalized.groupName);

    return {
        groupName: normalized.groupName,
        action: 'trash',
        targetGroup: undefined,
        affectedCount:
            typeof result?.changes === 'number'
                ? result.changes
                : activeEnvs.length,
    };
}
