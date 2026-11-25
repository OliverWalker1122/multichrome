import React from 'react';
import {
    Button,
    Checkbox,
    Input,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Tooltip,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowMinimizeRegular,
    ArrowResetRegular,
    ArrowSortRegular,
    ChevronDownRegular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
    GridRegular,
    MaximizeRegular,
    MoreHorizontalRegular,
    SearchRegular,
    SplitVerticalRegular,
    SquareMultipleRegular,
    TableSettingsRegular,
    TagRegular,
    WindowNewRegular,
} from '@fluentui/react-icons';
import type {
    OptionalEnvColumn,
    RunStatus,
    WindowArrangeMode,
} from '../../types';
import {
    type EnvSortKey,
    type EnvSortOrder,
    OPTIONAL_COLUMNS,
} from '../../hooks/useEnvironmentsWorkspace';
import { useI18n } from '../../i18n';
import { getTagStyle } from '../../theme/semanticColors';
import type { TagFilterMode } from '../../utils/environmentTags';
import RunStatusFilter from '../common/RunStatusFilter';
import type { EnvironmentsStyles } from './environmentsStyles';

export interface EnvironmentsToolbarProps {
    styles: EnvironmentsStyles;
    headingTitle: string;
    totalMemoryText: string;
    currentGroup: string;
    narrowWindow: boolean;
    totalCount: number;
    runningCount: number;
    allRunningCount: number;
    hideCloseAll?: boolean;
    closingAll: boolean;
    tilingWindows?: boolean;
    consoleDocked?: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    statusFilter: RunStatus;
    onStatusFilterChange: (value: RunStatus) => void;
    tagStats: Array<{ tag: string; count: number }>;
    selectedTags: string[];
    onClearSelectedTags: () => void;
    tagFilterMode: TagFilterMode;
    onTagFilterModeChange: React.Dispatch<React.SetStateAction<TagFilterMode>>;
    onToggleTagFilter: (tag: string) => void;
    optionalColumns: OptionalEnvColumn[];
    onToggleOptionalColumn: (col: OptionalEnvColumn) => void;
    sortBy: EnvSortKey;
    onSortByChange: (next: EnvSortKey) => void;
    sortOrder: EnvSortOrder;
    onSortOrderChange: React.Dispatch<React.SetStateAction<EnvSortOrder>>;
    onCreateClick: () => void;
    onTileWindows?: (mode?: WindowArrangeMode) => void;
    onOpenCloseAllConfirm: () => void;
    onRequestRenameGroup?: (groupName: string) => void;
    onRequestDeleteGroup?: (groupName: string) => void;
}

const EnvironmentsToolbar: React.FC<EnvironmentsToolbarProps> = ({
    styles,
    headingTitle,
    totalMemoryText,
    currentGroup,
    narrowWindow,
    totalCount,
    runningCount,
    allRunningCount,
    hideCloseAll = false,
    closingAll,
    tilingWindows = false,
    consoleDocked = false,
    search,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    tagStats,
    selectedTags,
    onClearSelectedTags,
    tagFilterMode,
    onTagFilterModeChange,
    onToggleTagFilter,
    optionalColumns,
    onToggleOptionalColumn,
    sortBy,
    onSortByChange,
    sortOrder,
    onSortOrderChange,
    onCreateClick,
    onTileWindows,
    onOpenCloseAllConfirm,
    onRequestRenameGroup,
    onRequestDeleteGroup,
}) => {
    const { isEn, t } = useI18n();

    return (
        <>
            <div className={styles.header}>
                <div className={styles.headingGroup}>
                    <h1 className={styles.title} title={headingTitle}>
                        {headingTitle}
                    </h1>
                    {totalMemoryText && (
                        <span className={styles.subtitle}>
                            {t('运行环境总内存', 'Total profile memory')}{' '}
                            {totalMemoryText}
                        </span>
                    )}
                </div>
                <Input
                    className={styles.searchInput}
                    aria-label={t('搜索环境', 'Search environments')}
                    contentBefore={<SearchRegular />}
                    contentAfter={
                        search ? (
                            <Button
                                appearance="transparent"
                                size="small"
                                icon={<DismissRegular />}
                                aria-label={t('清空搜索', 'Clear search')}
                                onClick={() => onSearchChange('')}
                            />
                        ) : undefined
                    }
                    placeholder={t('搜索环境', 'Search environments')}
                    title={t(
                        '按名称、分组、标签、代理或备注搜索',
                        'Search by name, group, tags, proxy, or notes',
                    )}
                    value={search}
                    onChange={(_, data) => onSearchChange(data.value)}
                />
                <div className={styles.headerActions}>
                    {allRunningCount === 0 && consoleDocked && onTileWindows && (
                        <Button
                            appearance="subtle"
                            icon={<ArrowResetRegular />}
                            disabled={tilingWindows}
                            aria-label={t('恢复主窗口', 'Reset Window')}
                            onClick={() => onTileWindows('reset-app-window')}
                        >
                            {t('恢复主窗口', 'Reset Window')}
                        </Button>
                    )}
                    {allRunningCount > 0 && onTileWindows && (
                        <Menu positioning="below-end">
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    appearance="subtle"
                                    icon={<GridRegular />}
                                    disabled={tilingWindows || closingAll}
                                    aria-label={t('窗口布局', 'Window Layout')}
                                >
                                    {t('窗口布局', 'Window Layout')}
                                    <ChevronDownRegular
                                        style={{
                                            marginLeft: '4px',
                                            fontSize: '12px',
                                        }}
                                    />
                                </Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        icon={<GridRegular />}
                                        onClick={() => onTileWindows('grid')}
                                    >
                                        {t('无缝宫格平铺', 'Seamless Grid')}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<SplitVerticalRegular />}
                                        onClick={() =>
                                            onTileWindows('split-grid')
                                        }
                                    >
                                        {t(
                                            '分屏并排平铺',
                                            'Split Beside Console',
                                        )}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<SquareMultipleRegular />}
                                        onClick={() => onTileWindows('stack')}
                                    >
                                        {t('统一尺寸堆叠', 'Uniform Stack')}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<WindowNewRegular />}
                                        onClick={() => onTileWindows('cascade')}
                                    >
                                        {t('阶梯错位层叠', 'Cascade Windows')}
                                    </MenuItem>
                                    <MenuDivider />
                                    <MenuItem
                                        icon={<ArrowMinimizeRegular />}
                                        onClick={() =>
                                            onTileWindows('minimize')
                                        }
                                    >
                                        {t('最小化全部窗口', 'Minimize All')}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<MaximizeRegular />}
                                        onClick={() => onTileWindows('restore')}
                                    >
                                        {t('恢复全部窗口', 'Restore All')}
                                    </MenuItem>
                                    <MenuDivider />
                                    <MenuItem
                                        icon={<ArrowResetRegular />}
                                        onClick={() =>
                                            onTileWindows('reset-app-window')
                                        }
                                    >
                                        {t(
                                            '恢复主窗口大小',
                                            'Reset App Window',
                                        )}
                                    </MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    )}
                    {allRunningCount > 0 && !hideCloseAll && (
                        <Button
                            appearance="subtle"
                            icon={
                                <DismissRegular
                                    style={{
                                        color: tokens.colorPaletteRedForeground1,
                                    }}
                                />
                            }
                            disabled={closingAll}
                            onClick={onOpenCloseAllConfirm}
                        >
                            {isEn
                                ? `Stop All (${allRunningCount})`
                                : `关闭全部 (${allRunningCount})`}
                        </Button>
                    )}
                    <Button
                        appearance="primary"
                        icon={<AddRegular />}
                        onClick={onCreateClick}
                    >
                        {t('新建环境', 'New Environment')}
                    </Button>
                </div>
            </div>

            <div className={styles.toolbar}>
                <RunStatusFilter
                    value={statusFilter}
                    onChange={onStatusFilterChange}
                    total={totalCount}
                    runningCount={runningCount}
                    runningLabel={t('运行中', 'Running')}
                    stoppedLabel={t('未运行', 'Stopped')}
                />
                <div className={styles.toolbarActions}>
                    {currentGroup !== '用户分组' &&
                        (onRequestRenameGroup || onRequestDeleteGroup) && (
                            <Menu positioning="below-end">
                                <MenuTrigger disableButtonEnhancement>
                                    <Button
                                        appearance="subtle"
                                        icon={<MoreHorizontalRegular />}
                                    >
                                        {t('管理分组', 'Manage group')}
                                    </Button>
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        {onRequestRenameGroup && (
                                            <MenuItem
                                                icon={<EditRegular />}
                                                onClick={() =>
                                                    onRequestRenameGroup(
                                                        currentGroup,
                                                    )
                                                }
                                            >
                                                {t(
                                                    '重命名分组',
                                                    'Rename group',
                                                )}
                                            </MenuItem>
                                        )}
                                        {onRequestDeleteGroup && (
                                            <MenuItem
                                                icon={<DeleteRegular />}
                                                onClick={() =>
                                                    onRequestDeleteGroup(
                                                        currentGroup,
                                                    )
                                                }
                                            >
                                                {t('删除分组', 'Delete group')}
                                            </MenuItem>
                                        )}
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        )}

                    {(tagStats.length > 0 || selectedTags.length > 0) && (
                        <Popover positioning="below-end">
                            <PopoverTrigger disableButtonEnhancement>
                                <Button
                                    appearance={
                                        selectedTags.length > 0
                                            ? 'secondary'
                                            : 'subtle'
                                    }
                                    icon={<TagRegular />}
                                >
                                    {selectedTags.length > 0
                                        ? isEn
                                            ? `Tags (${selectedTags.length})`
                                            : `标签 (${selectedTags.length})`
                                        : t('标签', 'Tags')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverSurface>
                                <div className={styles.tagPopoverBox}>
                                    <div className={styles.tagPopoverHeader}>
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: tokens.colorNeutralForeground2,
                                            }}
                                        >
                                            {t('按标签筛选', 'Filter by Tags')}
                                        </span>
                                        <div
                                            className={styles.tagModeGroup}
                                            role="group"
                                            aria-label={t(
                                                '标签匹配逻辑',
                                                'Tag match mode',
                                            )}
                                        >
                                            <button
                                                type="button"
                                                className={mergeClasses(
                                                    styles.tagModeBtn,
                                                    tagFilterMode === 'all' &&
                                                        styles.tagModeBtnActive,
                                                )}
                                                aria-pressed={
                                                    tagFilterMode === 'all'
                                                }
                                                onClick={() =>
                                                    onTagFilterModeChange('all')
                                                }
                                            >
                                                {t('全部 AND', 'All')}
                                            </button>
                                            <button
                                                type="button"
                                                className={mergeClasses(
                                                    styles.tagModeBtn,
                                                    tagFilterMode === 'any' &&
                                                        styles.tagModeBtnActive,
                                                )}
                                                aria-pressed={
                                                    tagFilterMode === 'any'
                                                }
                                                onClick={() =>
                                                    onTagFilterModeChange('any')
                                                }
                                            >
                                                {t('任一 OR', 'Any')}
                                            </button>
                                        </div>
                                    </div>

                                    {tagStats.length === 0 ? (
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                color: tokens.colorNeutralForeground3,
                                            }}
                                        >
                                            {t(
                                                '当前列表暂无标签，可在新建环境或右侧详情面板中为环境添加。',
                                                'No tags yet. Add tags when creating or editing an environment.',
                                            )}
                                        </span>
                                    ) : (
                                        <div className={styles.tagOptionList}>
                                            {tagStats.map(({ tag, count }) => {
                                                const active =
                                                    selectedTags.some(
                                                        (item) =>
                                                            item.toLowerCase() ===
                                                            tag.toLowerCase(),
                                                    );
                                                return (
                                                    <button
                                                        key={tag}
                                                        type="button"
                                                        className={mergeClasses(
                                                            styles.tagOptionChip,
                                                            active &&
                                                                styles.tagOptionChipActive,
                                                        )}
                                                        style={getTagStyle(tag)}
                                                        aria-pressed={active}
                                                        onClick={() =>
                                                            onToggleTagFilter(
                                                                tag,
                                                            )
                                                        }
                                                    >
                                                        <span>#{tag}</span>
                                                        <span
                                                            style={{
                                                                opacity: 0.75,
                                                                fontSize:
                                                                    '11px',
                                                            }}
                                                        >
                                                            {count}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {selectedTags.length > 0 && (
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'flex-end',
                                            }}
                                        >
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                onClick={onClearSelectedTags}
                                            >
                                                {t(
                                                    '清空标签筛选',
                                                    'Clear Tag Filter',
                                                )}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </PopoverSurface>
                        </Popover>
                    )}

                    {!narrowWindow && (
                        <Popover positioning="below-end">
                            <PopoverTrigger disableButtonEnhancement>
                                <Button
                                    appearance="subtle"
                                    icon={<TableSettingsRegular />}
                                >
                                    {t('列', 'Columns')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverSurface>
                                <div className={styles.colMenuList}>
                                    <span
                                        style={{
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            color: tokens.colorNeutralForeground3,
                                            marginBottom: '4px',
                                        }}
                                    >
                                        {t('显示附加列', 'Extra Columns')}
                                    </span>
                                    {OPTIONAL_COLUMNS.map((col) => (
                                        <Checkbox
                                            key={col.key}
                                            label={isEn ? col.en : col.zh}
                                            checked={optionalColumns.includes(
                                                col.key,
                                            )}
                                            onChange={() =>
                                                onToggleOptionalColumn(col.key)
                                            }
                                        />
                                    ))}
                                </div>
                            </PopoverSurface>
                        </Popover>
                    )}

                    <Menu positioning="below-end">
                        <MenuTrigger disableButtonEnhancement>
                            <Tooltip
                                content={t('排序方式', 'Sort by')}
                                relationship="label"
                            >
                                <Button
                                    appearance="subtle"
                                    icon={<ArrowSortRegular />}
                                    aria-label={t('排序方式', 'Sort by')}
                                />
                            </Tooltip>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem
                                    onClick={() => {
                                        onSortByChange('lastUsed');
                                        onSortOrderChange((prev) =>
                                            sortBy === 'lastUsed' &&
                                            prev === 'desc'
                                                ? 'asc'
                                                : 'desc',
                                        );
                                    }}
                                >
                                    {t('最近使用', 'Last Used')}{' '}
                                    {sortBy === 'lastUsed'
                                        ? sortOrder === 'desc'
                                            ? '↓'
                                            : '↑'
                                        : ''}
                                </MenuItem>
                                <MenuItem
                                    onClick={() => {
                                        onSortByChange('createdAt');
                                        onSortOrderChange((prev) =>
                                            sortBy === 'createdAt' &&
                                            prev === 'desc'
                                                ? 'asc'
                                                : 'desc',
                                        );
                                    }}
                                >
                                    {t('创建时间', 'Created At')}{' '}
                                    {sortBy === 'createdAt'
                                        ? sortOrder === 'desc'
                                            ? '↓'
                                            : '↑'
                                        : ''}
                                </MenuItem>
                                <MenuItem
                                    onClick={() => {
                                        onSortByChange('name');
                                        onSortOrderChange((prev) =>
                                            sortBy === 'name' && prev === 'asc'
                                                ? 'desc'
                                                : 'asc',
                                        );
                                    }}
                                >
                                    {t('名称', 'Name')}{' '}
                                    {sortBy === 'name'
                                        ? sortOrder === 'desc'
                                            ? '↓'
                                            : '↑'
                                        : ''}
                                </MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </div>
            </div>

            {selectedTags.length > 0 && (
                <div
                    className={styles.activeTagBar}
                    aria-label={t('已启用标签筛选', 'Active tag filters')}
                >
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() =>
                            onTagFilterModeChange((prev) =>
                                prev === 'all' ? 'any' : 'all',
                            )
                        }
                    >
                        {tagFilterMode === 'all'
                            ? t('同时包含 (AND)', 'Match All (AND)')
                            : t('包含任一 (OR)', 'Match Any (OR)')}
                    </Button>
                    {selectedTags.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            className={styles.activeTagChip}
                            style={getTagStyle(tag)}
                            title={t(
                                '点击移除此标签筛选',
                                'Click to remove tag filter',
                            )}
                            onClick={() => onToggleTagFilter(tag)}
                        >
                            <span>#{tag}</span>
                            <span aria-hidden="true">×</span>
                        </button>
                    ))}
                    <Button
                        size="small"
                        appearance="transparent"
                        onClick={onClearSelectedTags}
                    >
                        {t('清空', 'Clear')}
                    </Button>
                </div>
            )}
        </>
    );
};

export default EnvironmentsToolbar;
