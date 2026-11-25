import React from 'react';
import {
    Badge,
    Button,
    Checkbox,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Spinner,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    DeleteRegular,
    DismissRegular,
    FolderSwapRegular,
    GlobeRegular,
    PlayRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import type {
    ChromeEnvironment,
    ManagedProxy,
    OptionalEnvColumn,
} from '../../types';
import {
    formatMemoryBytes,
    useEnvironmentsWorkspace,
} from '../../hooks/useEnvironmentsWorkspace';
import { useI18n } from '../../i18n';
import ColumnResizeHandle from '../common/ColumnResizeHandle';
import CookieTransferDialog from './CookieTransferDialog';
import EnvironmentDetailsPanel, {
    ENV_DETAILS_WIDTH,
} from './EnvironmentDetailsPanel';
import EnvironmentTableRow from './EnvironmentTableRow';
import EnvironmentsActionDialogs from './EnvironmentsActionDialogs';
import EnvironmentsToolbar from './EnvironmentsToolbar';
import ZeroStateOnboardingCard from './ZeroStateOnboardingCard';
import { useEnvironmentsStyles } from './environmentsStyles';

export type { OptionalEnvColumn };

interface EnvironmentsPageProps {
    environments: ChromeEnvironment[];
    allEnvironments?: ChromeEnvironment[];
    allGroups: string[];
    currentGroup: string;
    managedProxies: ManagedProxy[];
    loading: boolean;
    selectedEnvId: string | null;
    onSelectEnv: (id: string | null) => void;
    detailsOpen: boolean;
    onToggleDetails: (open?: boolean) => void;
    workspaceWidth: number;
    overlayDetails: boolean;
    onCreateClick: () => void;
    onLaunch: (id: string) => Promise<boolean>;
    onBatchLaunch?: (
        ids: string[],
    ) => Promise<{
        launchedCount: number;
        deferredCount: number;
        failedCount: number;
    }>;
    onClose: (id: string) => Promise<boolean>;
    onClone?: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onRefresh: () => Promise<void>;
    onUpdateEnvironment: (
        id: string,
        data: Partial<ChromeEnvironment>,
    ) => Promise<void>;
    onRegenerateFingerprint?: (id: string) => Promise<void>;
    hasFingerprintKernel?: boolean;
    hasAnyBrowserEngine?: boolean;
    onInspectProxyLogs: (proxyId: string) => void;
    onNavigateComponents?: () => void;
    onNavigateProxies?: () => void;
    onRequestRenameGroup?: (groupName: string) => void;
    onRequestDeleteGroup?: (groupName: string) => void;
}

const EnvironmentsPage: React.FC<EnvironmentsPageProps> = ({
    environments,
    allEnvironments,
    allGroups,
    currentGroup,
    managedProxies,
    loading,
    selectedEnvId,
    onSelectEnv,
    detailsOpen,
    onToggleDetails,
    workspaceWidth,
    overlayDetails,
    onCreateClick,
    onLaunch,
    onBatchLaunch,
    onClose,
    onClone,
    onDelete,
    onRefresh,
    onUpdateEnvironment,
    onRegenerateFingerprint,
    hasFingerprintKernel = false,
    hasAnyBrowserEngine = true,
    onInspectProxyLogs,
    onNavigateComponents,
    onNavigateProxies,
    onRequestRenameGroup,
    onRequestDeleteGroup,
}) => {
    const styles = useEnvironmentsStyles();
    const { isEn, t } = useI18n();
    const ws = useEnvironmentsWorkspace({
        environments,
        allEnvironments,
        managedProxies,
        selectedEnvId,
        onSelectEnv,
        onToggleDetails,
        onLaunch,
        onBatchLaunch,
        onClose,
        onRefresh,
    });

    const optionalColWidths: Record<OptionalEnvColumn, number> = {
        timezone: 144,
        language: 84,
        notes: 150,
        createdAt: 116,
        id: 104,
    };
    const STATUS_COL_WIDTH = 84;
    const LAST_USED_COL_WIDTH = 92;
    const ACTION_COL_WIDTH = 148;

    const listWidth =
        workspaceWidth -
        (detailsOpen && ws.selectedEnv && !overlayDetails
            ? ENV_DETAILS_WIDTH
            : 0);
    const baseColumnsWidth =
        44 +
        ws.nameWidth +
        STATUS_COL_WIDTH +
        ws.proxyWidth +
        LAST_USED_COL_WIDTH +
        ACTION_COL_WIDTH +
        (currentGroup === '用户分组' ? ws.groupWidth : 0);
    const narrowWindow = listWidth < Math.max(810, baseColumnsWidth + 24);
    const activeOptionalCols = narrowWindow ? [] : ws.optionalColumns;
    const showGroupCol = !narrowWindow && currentGroup === '用户分组';
    const showLastUsedCol = !narrowWindow;
    const showProxyCol = !narrowWindow;
    const optionalColsWidth = activeOptionalCols.reduce(
        (sum, key) => sum + (optionalColWidths[key] || 120),
        0,
    );
    const visibleColumnCount =
        4 +
        (showGroupCol ? 1 : 0) +
        (showProxyCol ? 1 : 0) +
        activeOptionalCols.length +
        (showLastUsedCol ? 1 : 0);

    const allFilteredChecked =
        ws.filtered.length > 0 &&
        ws.filtered.every((item) => ws.selectedIds.has(item.id));
    const someFilteredChecked =
        !allFilteredChecked &&
        ws.filtered.some((item) => ws.selectedIds.has(item.id));

    const headingTitle =
        currentGroup === '用户分组' ? t('环境', 'Environments') : currentGroup;
    const totalMemoryText =
        ws.allRunningCount > 0
            ? formatMemoryBytes(ws.resourceStats?.totalMemoryBytes)
            : '';

    const hasActiveFilters =
        Boolean(ws.search.trim()) ||
        ws.selectedTags.length > 0 ||
        ws.statusFilter !== 'all';

    const selectedEnvs = environments.filter((item) =>
        ws.selectedIds.has(item.id),
    );
    const visibleSelectionCount = ws.filtered.filter(item => ws.selectedIds.has(item.id)).length;
    const hiddenSelectionCount = selectedEnvs.length - visibleSelectionCount;
    const selectedRunningCount = selectedEnvs.filter(
        (item) => item.isRunning,
    ).length;
    const selectedStoppedCount = selectedEnvs.length - selectedRunningCount;

    return (
        <div className={styles.workspace}>
            <section
                className={styles.main}
                aria-label={t('环境列表工作区', 'Environments workspace')}
            >
                <EnvironmentsToolbar
                    styles={styles}
                    headingTitle={headingTitle}
                    totalMemoryText={totalMemoryText}
                    currentGroup={currentGroup}
                    narrowWindow={narrowWindow}
                    totalCount={environments.length}
                    runningCount={ws.runningCount}
                    allRunningCount={ws.allRunningCount}
                    hideCloseAll={selectedRunningCount > 0}
                    closingAll={ws.closingAll}
                    tilingWindows={ws.tilingWindows}
                    consoleDocked={ws.consoleDocked}
                    search={ws.search}
                    onSearchChange={ws.setSearch}
                    statusFilter={ws.statusFilter}
                    onStatusFilterChange={ws.setStatusFilter}
                    tagStats={ws.tagStats}
                    selectedTags={ws.selectedTags}
                    onClearSelectedTags={() => ws.setSelectedTags([])}
                    tagFilterMode={ws.tagFilterMode}
                    onTagFilterModeChange={ws.setTagFilterMode}
                    onToggleTagFilter={ws.toggleTagFilter}
                    optionalColumns={ws.optionalColumns}
                    onToggleOptionalColumn={ws.toggleOptionalColumn}
                    sortBy={ws.sortBy}
                    onSortByChange={ws.setSortBy}
                    sortOrder={ws.sortOrder}
                    onSortOrderChange={ws.setSortOrder}
                    onCreateClick={onCreateClick}
                    onTileWindows={(mode) => void ws.handleTileWindows(mode)}
                    onOpenCloseAllConfirm={() => ws.setCloseAllConfirmOpen(true)}
                    onRequestRenameGroup={onRequestRenameGroup}
                    onRequestDeleteGroup={onRequestDeleteGroup}
                />

                {ws.activeSelectedIds.length > 0 && (
                    <div
                        className={styles.batchBar}
                        role="region"
                        aria-label={t('批量操作栏', 'Batch actions bar')}
                    >
                        <Badge
                            appearance="tint"
                            color="brand"
                            className={styles.batchCountLabel}
                        >
                            {hiddenSelectionCount > 0 ? t(`可见 ${visibleSelectionCount}，隐藏 ${hiddenSelectionCount}`, `${visibleSelectionCount} visible, ${hiddenSelectionCount} hidden`) : isEn
                                ? `${ws.activeSelectedIds.length} selected`
                                : `已选 ${ws.activeSelectedIds.length} 项`}
                        </Badge>
                        {selectedStoppedCount > 0 && (
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<PlayRegular />}
                                disabled={ws.batchBusy}
                                onClick={() =>
                                    void ws.handleBatchLaunchSelected()
                                }
                            >
                                {t('批量启动', 'Launch')}
                            </Button>
                        )}
                        {selectedRunningCount > 0 && (
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={
                                    <DismissRegular
                                        style={{
                                            color: tokens.colorPaletteRedForeground1,
                                        }}
                                    />
                                }
                                disabled={ws.batchBusy}
                                onClick={() =>
                                    void ws.handleBatchStopSelected()
                                }
                            >
                                {t('批量关闭', 'Stop')}
                            </Button>
                        )}
                        <Menu positioning="below-start">
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<FolderSwapRegular />}
                                    disabled={ws.batchBusy}
                                >
                                    {t('移动分组', 'Move Group')}
                                </Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    {allGroups.map((group) => (
                                        <MenuItem
                                            key={group}
                                            onClick={() =>
                                                void ws.handleBatchAction({
                                                    action: 'moveGroup',
                                                    groupName: group,
                                                })
                                            }
                                        >
                                            {group}
                                        </MenuItem>
                                    ))}
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                        <Menu positioning="below-start">
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<GlobeRegular />}
                                    disabled={ws.batchBusy}
                                >
                                    {t('切换代理', 'Assign Proxy')}
                                </Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        onClick={() =>
                                            void ws.handleBatchAction({
                                                action: 'bindProxy',
                                                proxyId: '',
                                            })
                                        }
                                    >
                                        {t('全局默认', 'Global Default')}
                                    </MenuItem>
                                    {managedProxies.map((proxy) => (
                                        <MenuItem
                                            key={proxy.id}
                                            onClick={() =>
                                                void ws.handleBatchAction({
                                                    action: 'bindProxy',
                                                    proxyId: proxy.id,
                                                })
                                            }
                                        >
                                            {proxy.name}
                                        </MenuItem>
                                    ))}
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<DeleteRegular />}
                            style={{ color: tokens.colorPaletteRedForeground1 }}
                            disabled={ws.batchBusy}
                            onClick={() =>
                                void ws.handleBatchAction({ action: 'delete' })
                            }
                        >
                            {t('移入回收站', 'Move to Trash')}
                        </Button>
                        <div style={{ flex: 1 }} />
                        <Button
                            size="small"
                            appearance="transparent"
                            icon={<DismissRegular />}
                            disabled={ws.batchBusy}
                            onClick={ws.clearSelection}
                        >
                            {t('取消选择', 'Clear')}
                        </Button>
                    </div>
                )}

                {loading && environments.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Spinner
                            size="small"
                            label={t(
                                '正在读取 Chrome 环境…',
                                'Loading Chrome environments…',
                            )}
                        />
                    </div>
                ) : ws.filtered.length === 0 ? (
                    !hasActiveFilters &&
                    environments.length === 0 &&
                    onNavigateComponents &&
                    onNavigateProxies ? (
                        <ZeroStateOnboardingCard
                            hasAnyBrowserEngine={hasAnyBrowserEngine}
                            hasPrivacyKernel={hasFingerprintKernel}
                            proxyCount={managedProxies.length}
                            onOpenComponents={onNavigateComponents}
                            onOpenProxies={onNavigateProxies}
                            onCreateProfile={onCreateClick}
                        />
                    ) : (
                        <div className={styles.emptyState}>
                            <WindowMultipleRegular style={{ fontSize: '36px' }} />
                            <span
                                style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: tokens.colorNeutralForeground1,
                                }}
                            >
                                {hasActiveFilters
                                    ? t('未找到匹配的环境', 'No matching environments')
                                    : t('还没有 Chrome 环境', 'No Chrome environments yet')}
                            </span>
                            <span style={{ fontSize: '12px' }}>
                                {hasActiveFilters
                                    ? t(
                                          '尝试调整搜索词、运行状态或标签筛选条件。',
                                          'Try adjusting the search keyword, status, or tag filters.',
                                      )
                                    : t(
                                          '点击右上角“新建环境”创建第一个独立隔离的浏览器环境。',
                                          'Click "New Environment" in the top right to create your first isolated browser profile.',
                                      )}
                            </span>
                            {hasActiveFilters && (
                                <Button
                                    appearance="secondary"
                                    onClick={() => {
                                        ws.setSearch('');
                                        ws.setStatusFilter('all');
                                        ws.setSelectedTags([]);
                                    }}
                                >
                                    {t('清空筛选条件', 'Clear Filters')}
                                </Button>
                            )}
                        </div>
                    )
                ) : (
                    <div ref={ws.tableWrapRef} className={styles.tableWrap}>
                        <table
                            className={styles.table}
                            aria-label={t('环境列表', 'Environments table')}
                            style={{
                                minWidth: narrowWindow
                                    ? 424
                                    : 44 +
                                      ws.nameWidth +
                                      STATUS_COL_WIDTH +
                                      (showGroupCol ? ws.groupWidth : 0) +
                                      (showProxyCol ? ws.proxyWidth : 0) +
                                      optionalColsWidth +
                                      (showLastUsedCol ? LAST_USED_COL_WIDTH : 0) +
                                      ACTION_COL_WIDTH,
                            }}
                        >
                            <thead className={styles.thead}>
                                <tr>
                                    <th
                                        className={styles.th}
                                        style={{
                                            width: '44px',
                                            paddingLeft: '14px',
                                            paddingRight: '4px',
                                            overflow: 'visible',
                                            textOverflow: 'clip',
                                        }}
                                    >
                                        <Checkbox
                                            style={{ marginLeft: '-2px' }}
                                            checked={
                                                allFilteredChecked
                                                    ? true
                                                    : someFilteredChecked
                                                      ? 'mixed'
                                                      : false
                                            }
                                            aria-label={t(
                                                '全选当前列表',
                                                'Select all environments',
                                            )}
                                            onChange={ws.toggleSelectAllFiltered}
                                        />
                                    </th>
                                    <th
                                        className={styles.th}
                                        style={{
                                            width: narrowWindow
                                                ? undefined
                                                : ws.nameWidth,
                                        }}
                                    >
                                        {t('名称', 'Name')}
                                        {!narrowWindow && (
                                            <ColumnResizeHandle
                                                label={t('名称', 'Name')}
                                                width={ws.nameWidth}
                                                min={160}
                                                onChange={ws.setNameWidth}
                                            />
                                        )}
                                    </th>
                                    <th
                                        className={styles.th}
                                        style={{ width: STATUS_COL_WIDTH }}
                                    >
                                        {t('状态', 'Status')}
                                    </th>
                                    {showGroupCol && (
                                        <th
                                            className={styles.th}
                                            style={{ width: ws.groupWidth }}
                                        >
                                            {t('分组', 'Group')}
                                            <ColumnResizeHandle label={t('分组', 'Group')} width={ws.groupWidth} min={88} onChange={ws.setGroupWidth} />
                                        </th>
                                    )}
                                    {showProxyCol && (
                                        <th
                                            className={styles.th}
                                            style={{ width: ws.proxyWidth }}
                                        >
                                            {t('代理', 'Proxy')}
                                            <ColumnResizeHandle
                                                label={t('代理', 'Proxy')}
                                                width={ws.proxyWidth}
                                                min={150}
                                                onChange={ws.setProxyWidth}
                                            />
                                        </th>
                                    )}
                                    {activeOptionalCols.includes(
                                        'timezone',
                                    ) && (
                                        <th
                                            className={styles.th}
                                            style={{
                                                width: optionalColWidths.timezone,
                                            }}
                                        >
                                            {t('时区', 'Timezone')}
                                        </th>
                                    )}
                                    {activeOptionalCols.includes(
                                        'language',
                                    ) && (
                                        <th
                                            className={styles.th}
                                            style={{ width: '84px' }}
                                        >
                                            {t('语言', 'Language')}
                                        </th>
                                    )}
                                    {activeOptionalCols.includes('notes') && (
                                        <th
                                            className={styles.th}
                                            style={{ width: '150px' }}
                                        >
                                            {t('备注', 'Notes')}
                                        </th>
                                    )}
                                    {activeOptionalCols.includes(
                                        'createdAt',
                                    ) && (
                                        <th
                                            className={styles.th}
                                            style={{ width: '116px' }}
                                        >
                                            {t('创建时间', 'Created At')}
                                        </th>
                                    )}
                                    {activeOptionalCols.includes('id') && (
                                        <th
                                            className={styles.th}
                                            style={{ width: '104px' }}
                                        >
                                            ID
                                        </th>
                                    )}
                                    {showLastUsedCol && (
                                        <th
                                            className={styles.th}
                                            style={{
                                                width: LAST_USED_COL_WIDTH,
                                            }}
                                        >
                                            {t('最近使用', 'Last Used')}
                                        </th>
                                    )}
                                    <th
                                        className={mergeClasses(
                                            styles.th,
                                            styles.actionsHeader,
                                        )}
                                        style={{ width: ACTION_COL_WIDTH }}
                                    >
                                        {t('操作', 'Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {ws.isVirtualized && ws.topSpacerHeight > 0 && (
                                    <tr
                                        aria-hidden="true"
                                        style={{
                                            height: `${ws.topSpacerHeight}px`,
                                        }}
                                    >
                                        <td
                                            colSpan={visibleColumnCount}
                                            style={{
                                                padding: 0,
                                                border: 'none',
                                                height: `${ws.topSpacerHeight}px`,
                                            }}
                                        />
                                    </tr>
                                )}
                                {ws.visibleEnvironments.map(
                                    (env, localIndex) => {
                                        const index =
                                            ws.startIndex + localIndex;
                                        const selected =
                                            ws.selectedEnv?.id === env.id;
                                        const boundProxy = env.proxyId
                                            ? ws.proxyMap.get(env.proxyId)
                                            : undefined;
                                        const sharedProxyEnvs = env.proxyId
                                            ? ws.proxyUsageMap.get(
                                                  env.proxyId,
                                              ) || []
                                            : [];

                                        return (
                                            <EnvironmentTableRow
                                                key={env.id}
                                                styles={styles}
                                                env={env}
                                                selected={selected}
                                                checked={ws.selectedIds.has(env.id)}
                                                narrowWindow={narrowWindow}
                                                showGroupCol={showGroupCol}
                                                showProxyCol={showProxyCol}
                                                showLastUsedCol={
                                                    showLastUsedCol
                                                }
                                                activeOptionalCols={
                                                    activeOptionalCols
                                                }
                                                boundProxy={boundProxy}
                                                sharedProxyEnvs={
                                                    sharedProxyEnvs
                                                }
                                                memoryBytes={
                                                    ws.resourceStats
                                                        ?.environments?.[env.id]
                                                        ?.memoryBytes
                                                }
                                                busy={ws.busyId === env.id}
                                                selectionRowProps={ws.rowProps(
                                                    env,
                                                    index,
                                                )}
                                                onToggleChecked={() =>
                                                    ws.toggleSelectId(env.id)
                                                }
                                                onSelect={() => {
                                                    onSelectEnv(env.id);
                                                    if (env.isRunning) {
                                                        ws.handleFocusWindow(
                                                            env.id,
                                                            {
                                                                highlightOnly:
                                                                    detailsOpen,
                                                            },
                                                        );
                                                    }
                                                }}
                                                onFocusWindow={
                                                    env.isRunning
                                                        ? () =>
                                                              ws.handleFocusWindow(
                                                                  env.id,
                                                                  {
                                                                      highlightOnly: false,
                                                                  },
                                                              )
                                                        : undefined
                                                }
                                                onOpenDetails={() =>
                                                    onToggleDetails(true)
                                                }
                                                onOpenContextMenu={(event) =>
                                                    ws.openContextMenu(
                                                        event,
                                                        env,
                                                    )
                                                }
                                                onToggleTagFilter={
                                                    ws.toggleTagFilter
                                                }
                                                onRunToggle={() =>
                                                    void ws.handleRunToggle(env)
                                                }
                                                onInspectHealth={() =>
                                                    ws.setHealthTargetId(env.id)
                                                }
                                                onClone={
                                                    onClone
                                                        ? () =>
                                                              void onClone(
                                                                  env.id,
                                                              )
                                                        : undefined
                                                }
                                                onOpenDataDir={() =>
                                                    ws.handleOpenDataDir(env.id)
                                                }
                                                onInspectProxyLogs={
                                                    onInspectProxyLogs
                                                }
                                                onDelete={() =>
                                                    ws.setDeleteTarget(env)
                                                }
                                            />
                                        );
                                    },
                                )}
                                {ws.isVirtualized &&
                                    ws.bottomSpacerHeight > 0 && (
                                        <tr
                                            aria-hidden="true"
                                            style={{
                                                height: `${ws.bottomSpacerHeight}px`,
                                            }}
                                        >
                                            <td
                                                colSpan={visibleColumnCount}
                                                style={{
                                                    padding: 0,
                                                    border: 'none',
                                                    height: `${ws.bottomSpacerHeight}px`,
                                                }}
                                            />
                                        </tr>
                                    )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {detailsOpen && ws.selectedEnv && (
                <EnvironmentDetailsPanel
                    key={ws.selectedEnv.id}
                    environment={ws.selectedEnv}
                    allEnvironments={ws.effectiveAllEnvironments}
                    managedProxies={managedProxies}
                    groups={allGroups}
                    overlay={overlayDetails}
                    hasFingerprintKernel={hasFingerprintKernel}
                    onClose={() => onToggleDetails(false)}
                    onLaunch={async (id) => {
                        await onLaunch(id);
                    }}
                    onStop={async (id) => {
                        await onClose(id);
                    }}
                    onFocusWindow={(id) => ws.handleFocusWindow(id)}
                    onClone={onClone}
                    onInspectHealth={(env) => ws.setHealthTargetId(env.id)}
                    onDelete={(env) => ws.setDeleteTarget(env)}
                    onSave={onUpdateEnvironment}
                    onRegenerateFingerprint={onRegenerateFingerprint}
                    onInspectProxyLogs={onInspectProxyLogs}
                    onOpenCookieTransfer={(mode) =>
                        ws.setCookieTransfer({ env: ws.selectedEnv!, mode })
                    }
                />
            )}

            <CookieTransferDialog
                env={ws.cookieTransfer?.env || null}
                mode={ws.cookieTransfer?.mode || null}
                onClose={() => ws.setCookieTransfer(null)}
            />

            <EnvironmentsActionDialogs
                styles={styles}
                contextMenu={ws.contextMenu}
                onCloseContextMenu={() => ws.setContextMenu(null)}
                onRunToggle={(env) => void ws.handleRunToggle(env)}
                onFocusWindow={(id) => ws.handleFocusWindow(id)}
                onOpenDetails={(env) => {
                    onSelectEnv(env.id);
                    onToggleDetails(true);
                }}
                onInspectHealth={(id) => ws.setHealthTargetId(id)}
                onClone={onClone}
                onOpenDataDir={ws.handleOpenDataDir}
                onInspectProxyLogs={onInspectProxyLogs}
                onStartDelete={(env) => ws.setDeleteTarget(env)}
                healthTargetEnv={
                    ws.healthTargetId
                        ? ws.effectiveAllEnvironments.find(
                              (e) => e.id === ws.healthTargetId,
                          ) || null
                        : null
                }
                onCloseHealth={() => ws.setHealthTargetId(null)}
                closeAllConfirmOpen={ws.closeAllConfirmOpen}
                closingAll={ws.closingAll}
                allRunningCount={ws.allRunningCount}
                resourceStats={ws.resourceStats}
                onCloseAllCancel={() => ws.setCloseAllConfirmOpen(false)}
                onConfirmCloseAll={() => void ws.handleConfirmCloseAll()}
                deleteTarget={ws.deleteTarget}
                onCloseDelete={() => ws.setDeleteTarget(null)}
                onConfirmDelete={(id) => void onDelete(id)}
            />
        </div>
    );
};

export default EnvironmentsPage;
