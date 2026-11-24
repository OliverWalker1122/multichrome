import React from 'react';
import {
    Button,
    Spinner,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import { AddRegular, WindowMultipleRegular } from '@fluentui/react-icons';
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
import EnvironmentDetailsPanel, {
    ENV_DETAILS_WIDTH,
} from './EnvironmentDetailsPanel';
import EnvironmentTableRow from './EnvironmentTableRow';
import EnvironmentsActionDialogs from './EnvironmentsActionDialogs';
import EnvironmentsToolbar from './EnvironmentsToolbar';
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
    onLaunch: (id: string) => Promise<void>;
    onClose: (id: string) => Promise<void>;
    onClone?: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onRefresh: () => Promise<void>;
    onUpdateEnvironment: (
        id: string,
        data: Partial<ChromeEnvironment>,
    ) => Promise<void>;
    onRegenerateFingerprint?: (id: string) => Promise<void>;
    hasFingerprintKernel?: boolean;
    onInspectProxyLogs: (proxyId: string) => void;
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
    onClose,
    onClone,
    onDelete,
    onRefresh,
    onUpdateEnvironment,
    onRegenerateFingerprint,
    hasFingerprintKernel,
    onInspectProxyLogs,
    onRequestRenameGroup,
    onRequestDeleteGroup,
}) => {
    const styles = useEnvironmentsStyles();
    const { t } = useI18n();
    const ws = useEnvironmentsWorkspace({
        environments,
        allEnvironments,
        managedProxies,
        selectedEnvId,
        onSelectEnv,
        onToggleDetails,
        onLaunch,
        onClose,
        onRefresh,
    });

    const listWidth =
        workspaceWidth -
        (detailsOpen && ws.selectedEnv && !overlayDetails
            ? ENV_DETAILS_WIDTH
            : 0);
    const narrowWindow = listWidth < 810;
    const activeOptionalCols = narrowWindow ? [] : ws.optionalColumns;
    const showGroupCol = !narrowWindow && currentGroup === '用户分组';
    const showLastUsedCol = !narrowWindow;
    const showProxyCol = !narrowWindow;
    const visibleColumnCount =
        3 +
        (showGroupCol ? 1 : 0) +
        (showProxyCol ? 1 : 0) +
        activeOptionalCols.length +
        (showLastUsedCol ? 1 : 0);

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
                    closingAll={ws.closingAll}
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
                    onOpenCloseAllConfirm={() => ws.setCloseAllConfirmOpen(true)}
                    onRequestRenameGroup={onRequestRenameGroup}
                    onRequestDeleteGroup={onRequestDeleteGroup}
                />

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
                        {hasActiveFilters ? (
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
                        ) : (
                            <Button
                                appearance="primary"
                                icon={<AddRegular />}
                                onClick={onCreateClick}
                            >
                                {t('新建环境', 'New Environment')}
                            </Button>
                        )}
                    </div>
                ) : (
                    <div ref={ws.tableWrapRef} className={styles.tableWrap}>
                        <table
                            className={styles.table}
                            aria-label={t('环境列表', 'Environments table')}
                            style={{
                                minWidth: narrowWindow
                                    ? 368
                                    : ws.nameWidth +
                                      ws.proxyWidth +
                                      312 +
                                      (showGroupCol ? 88 : 0) +
                                      activeOptionalCols.length * 140,
                            }}
                        >
                            <thead className={styles.thead}>
                                <tr>
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
                                        style={{ width: '88px' }}
                                    >
                                        {t('状态', 'Status')}
                                    </th>
                                    {showGroupCol && (
                                        <th
                                            className={styles.th}
                                            style={{ width: '88px' }}
                                        >
                                            {t('分组', 'Group')}
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
                                            style={{ width: '176px' }}
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
                                            style={{ width: '100px' }}
                                        >
                                            {t('最近使用', 'Last Used')}
                                        </th>
                                    )}
                                    <th
                                        className={mergeClasses(
                                            styles.th,
                                            styles.actionsHeader,
                                        )}
                                        style={{ width: '132px' }}
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
                                                onSelect={() =>
                                                    onSelectEnv(env.id)
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
                    onLaunch={onLaunch}
                    onStop={onClose}
                    onClone={onClone}
                    onInspectHealth={(env) => ws.setHealthTargetId(env.id)}
                    onDelete={(env) => ws.setDeleteTarget(env)}
                    onSave={onUpdateEnvironment}
                    onRegenerateFingerprint={onRegenerateFingerprint}
                    onInspectProxyLogs={onInspectProxyLogs}
                />
            )}

            <EnvironmentsActionDialogs
                styles={styles}
                contextMenu={ws.contextMenu}
                onCloseContextMenu={() => ws.setContextMenu(null)}
                onRunToggle={(env) => void ws.handleRunToggle(env)}
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
