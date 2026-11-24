export const DEFAULT_GROUP_NAME = '默认分组';
export const RESERVED_GROUP_NAMES = new Set(['用户分组', '全部']);

/**
 * 校验并规范化删除分组参数（纯领域规则，零 I/O）
 * @param {unknown} groupName
 * @param {{ action?: unknown; targetGroup?: unknown }} [options]
 */
export function normalizeDeleteGroupOptions(groupName, options = {}) {
    if (typeof groupName !== 'string' || !groupName.trim()) {
        throw new Error('分组名称不能为空');
    }
    const normalizedGroup = groupName.trim();
    if (RESERVED_GROUP_NAMES.has(normalizedGroup)) {
        throw new Error(`系统保留分组“${normalizedGroup}”不可删除`);
    }

    const rawAction = options && typeof options === 'object' ? options.action : undefined;
    const action = rawAction === undefined ? 'move' : rawAction;
    if (action !== 'move' && action !== 'trash') {
        throw new Error('不支持的分组删除方式');
    }

    if (action === 'move') {
        const rawTarget =
            options && typeof options === 'object' && typeof options.targetGroup === 'string'
                ? options.targetGroup.trim()
                : '';
        const targetGroup = rawTarget || DEFAULT_GROUP_NAME;
        if (RESERVED_GROUP_NAMES.has(targetGroup)) {
            throw new Error(`不能将环境移动到系统保留分组“${targetGroup}”`);
        }
        if (targetGroup === normalizedGroup) {
            throw new Error(
                '目标分组不能与要删除的分组相同，请选择其他目标分组或将组内环境移入回收站',
            );
        }
        return {
            groupName: normalizedGroup,
            action: 'move',
            targetGroup,
        };
    }

    return {
        groupName: normalizedGroup,
        action: 'trash',
        targetGroup: undefined,
    };
}

/**
 * 校验并规范化重命名分组参数（纯领域规则，零 I/O）
 * @param {unknown} oldName
 * @param {unknown} newName
 */
export function normalizeRenameGroupOptions(oldName, newName) {
    if (typeof oldName !== 'string' || !oldName.trim()) {
        throw new Error('原分组名称不能为空');
    }
    if (typeof newName !== 'string' || !newName.trim()) {
        throw new Error('新分组名称不能为空');
    }
    const normalizedOld = oldName.trim();
    const normalizedNew = newName.trim();
    if (RESERVED_GROUP_NAMES.has(normalizedOld)) {
        throw new Error(`系统保留分组“${normalizedOld}”不可重命名`);
    }
    if (RESERVED_GROUP_NAMES.has(normalizedNew)) {
        throw new Error(`不能重命名为系统保留分组“${normalizedNew}”`);
    }
    if (normalizedOld === normalizedNew) {
        throw new Error('新分组名称不能与原名称相同');
    }
    return {
        oldName: normalizedOld,
        newName: normalizedNew,
    };
}
