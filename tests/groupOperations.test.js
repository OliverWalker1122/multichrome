import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_GROUP_NAME,
    normalizeDeleteGroupOptions,
    normalizeRenameGroupOptions,
} from '../electron/domain/groupPolicy.js';
import {
    executeDeleteGroup,
    executeRenameGroup,
} from '../electron/repositories/groupRepository.js';

function createMockEnvDb(initialRows) {
    const rows = initialRows.map((row) => ({ ...row }));
    return {
        rows,
        prepare(sql) {
            if (
                sql.includes('SELECT id, name FROM environments WHERE groupName = ? AND deletedAt IS NULL')
            ) {
                return {
                    all(groupName) {
                        return rows
                            .filter((r) => r.groupName === groupName && !r.deletedAt)
                            .map((r) => ({ id: r.id, name: r.name }));
                    },
                };
            }
            if (
                sql.includes('UPDATE environments SET groupName = ? WHERE groupName = ? AND deletedAt IS NULL')
            ) {
                return {
                    run(targetGroup, sourceGroup) {
                        let changes = 0;
                        for (const row of rows) {
                            if (row.groupName === sourceGroup && !row.deletedAt) {
                                row.groupName = targetGroup;
                                changes += 1;
                            }
                        }
                        return { changes };
                    },
                };
            }
            if (
                sql.includes('UPDATE environments SET deletedAt = ? WHERE groupName = ? AND deletedAt IS NULL')
            ) {
                return {
                    run(deletedAt, sourceGroup) {
                        let changes = 0;
                        for (const row of rows) {
                            if (row.groupName === sourceGroup && !row.deletedAt) {
                                row.deletedAt = deletedAt;
                                changes += 1;
                            }
                        }
                        return { changes };
                    },
                };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
    };
}

test('normalizeDeleteGroupOptions validates group names, reserved names, and move targets', () => {
    assert.deepEqual(normalizeDeleteGroupOptions('  测试组  '), {
        groupName: '测试组',
        action: 'move',
        targetGroup: DEFAULT_GROUP_NAME,
    });

    assert.deepEqual(
        normalizeDeleteGroupOptions('测试组', {
            action: 'move',
            targetGroup: '工作区',
        }),
        {
            groupName: '测试组',
            action: 'move',
            targetGroup: '工作区',
        },
    );

    assert.deepEqual(normalizeDeleteGroupOptions('默认分组', { action: 'trash' }), {
        groupName: '默认分组',
        action: 'trash',
        targetGroup: undefined,
    });

    assert.throws(() => normalizeDeleteGroupOptions(''), /分组名称不能为空/);
    assert.throws(() => normalizeDeleteGroupOptions('用户分组'), /系统保留分组/);
    assert.throws(() => normalizeDeleteGroupOptions('全部'), /系统保留分组/);
    assert.throws(
        () => normalizeDeleteGroupOptions('测试组', { action: 'purge' }),
        /不支持的分组删除方式/,
    );
    assert.throws(
        () => normalizeDeleteGroupOptions('默认分组', { action: 'move' }),
        /目标分组不能与要删除的分组相同/,
    );
    assert.throws(
        () =>
            normalizeDeleteGroupOptions('测试组', {
                action: 'move',
                targetGroup: '用户分组',
            }),
        /系统保留分组/,
    );
});

test('executeDeleteGroup moves active environments and preserves trashed or other groups', async () => {
    const db = createMockEnvDb([
        { id: '1', name: 'Env 1', groupName: '测试组', deletedAt: null },
        { id: '2', name: 'Env 2', groupName: '测试组', deletedAt: null },
        { id: '3', name: 'Trashed', groupName: '测试组', deletedAt: '2026-01-01T00:00:00.000Z' },
        { id: '4', name: 'Other', groupName: 'AI', deletedAt: null },
    ]);

    const result = await executeDeleteGroup({
        db,
        groupName: '测试组',
        options: { action: 'move', targetGroup: '工作区' },
    });

    assert.deepEqual(result, {
        groupName: '测试组',
        action: 'move',
        targetGroup: '工作区',
        affectedCount: 2,
    });

    assert.equal(db.rows[0].groupName, '工作区');
    assert.equal(db.rows[1].groupName, '工作区');
    assert.equal(db.rows[2].groupName, '测试组');
    assert.equal(db.rows[2].deletedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(db.rows[3].groupName, 'AI');
});

test('executeDeleteGroup closes running environments before soft-deleting in trash mode', async () => {
    const db = createMockEnvDb([
        { id: '1', name: 'Running Env', groupName: '测试组', deletedAt: null },
        { id: '2', name: 'Idle Env', groupName: '测试组', deletedAt: null },
        { id: '3', name: 'Other', groupName: '默认分组', deletedAt: null },
    ]);
    const closedIds = [];
    const now = '2026-11-21T12:00:00.000Z';

    const result = await executeDeleteGroup({
        db,
        groupName: '测试组',
        options: { action: 'trash' },
        closeRunningEnv: async (id) => {
            closedIds.push(id);
        },
        now,
    });

    assert.deepEqual(result, {
        groupName: '测试组',
        action: 'trash',
        targetGroup: undefined,
        affectedCount: 2,
    });
    assert.deepEqual(closedIds, ['1', '2']);
    assert.equal(db.rows[0].deletedAt, now);
    assert.equal(db.rows[1].deletedAt, now);
    assert.equal(db.rows[2].deletedAt, null);
});

test('executeDeleteGroup handles empty groups gracefully', async () => {
    const db = createMockEnvDb([
        { id: '1', name: 'Other', groupName: 'AI', deletedAt: null },
    ]);
    let closeCalled = false;

    const result = await executeDeleteGroup({
        db,
        groupName: '空分组',
        options: { action: 'trash' },
        closeRunningEnv: async () => {
            closeCalled = true;
        },
    });

    assert.deepEqual(result, {
        groupName: '空分组',
        action: 'trash',
        targetGroup: undefined,
        affectedCount: 0,
    });
    assert.equal(closeCalled, false);
});

test('normalizeRenameGroupOptions and executeRenameGroup rename active environments safely', () => {
    assert.deepEqual(normalizeRenameGroupOptions('  旧组 ', ' 新组  '), {
        oldName: '旧组',
        newName: '新组',
    });
    assert.throws(() => normalizeRenameGroupOptions('旧组', '旧组'), /不能与原名称相同/);
    assert.throws(() => normalizeRenameGroupOptions('用户分组', '新组'), /系统保留分组/);
    assert.throws(() => normalizeRenameGroupOptions('旧组', '全部'), /系统保留分组/);

    const db = createMockEnvDb([
        { id: '1', name: 'A', groupName: '旧组', deletedAt: null },
        { id: '2', name: 'B', groupName: '旧组', deletedAt: '2026-01-01T00:00:00.000Z' },
        { id: '3', name: 'C', groupName: '其他', deletedAt: null },
    ]);

    const res = executeRenameGroup({ db, oldName: '旧组', newName: '新组' });
    assert.deepEqual(res, { oldName: '旧组', newName: '新组', affectedCount: 1 });
    assert.equal(db.rows[0].groupName, '新组');
    assert.equal(db.rows[1].groupName, '旧组');
    assert.equal(db.rows[2].groupName, '其他');
});
