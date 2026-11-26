import React, { useState } from 'react';
import { ConfirmAction } from '../common/ConfirmAction';
import {
    Badge,
    Button,
    Checkbox,
    Input,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Spinner,
    tokens,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowImportRegular,
    ArrowSortRegular,
    DeleteRegular,
    DismissRegular,
    GlobeRegular,
    PulseRegular,
    SearchRegular,
} from '@fluentui/react-icons';
import type {
    ChromeEnvironment,
    ManagedProxy,
    ProxyCoreInfo,
} from '../../types';
import { useProxiesController } from '../../hooks/useProxiesController';
import { useI18n } from '../../i18n';
import ColumnResizeHandle from '../common/ColumnResizeHandle';
import RunStatusFilter from '../common/RunStatusFilter';
import BatchImportProxiesDialog from './BatchImportProxiesDialog';
import ProxyActionDialogs from './ProxyActionDialogs';
import ProxyConfigDrawer from './ProxyConfigDrawer';
import ProxyDetailsPanel from './ProxyDetailsPanel';
import ProxyEditorDrawer from './ProxyEditorDrawer';
import ProxyTableRow from './ProxyTableRow';
import { useProxiesStyles } from './proxiesStyles';

interface ProxiesPageProps {
    proxies: ManagedProxy[];
    environments: ChromeEnvironment[];
    coreInfo: ProxyCoreInfo | null;
    loading: boolean;
    loadError: string;
    selectedProxyId: string | null;
    onSelectProxy: (id: string | null) => void;
    detailsOpen: boolean;
    onToggleDetails: (open?: boolean) => void;
    narrowWindow: boolean;
    overlayDetails: boolean;
    onRefreshProxies: () => void;
    onEnvironmentChanged: () => Promise<void>;
    onInspectLogs: (proxyId: string) => void;
}

const ProxiesPage: React.FC<ProxiesPageProps> = ({
    proxies,
    environments,
    coreInfo,
    loading,
    loadError,
    selectedProxyId,
    onSelectProxy,
    detailsOpen,
    onToggleDetails,
    narrowWindow,
    overlayDetails,
    onRefreshProxies,
    onEnvironmentChanged,
    onInspectLogs,
}) => {
    const styles = useProxiesStyles();
    const { isEn, t } = useI18n();
    const ctrl = useProxiesController({
        proxies,
        environments,
        selectedProxyId,
        onSelectProxy,
        onToggleDetails,
        onRefreshProxies,
        onEnvironmentChanged,
    });

    const [removal, setRemoval] = useState<string[] | null>(null);
    const visibleSelected = ctrl.filtered.filter(p => ctrl.selectedProxyIds.has(p.id)).length;
    const hiddenSelected = ctrl.activeSelectedProxyIds.length - visibleSelected;
    const hasSelection = ctrl.activeSelectedProxyIds.length > 0;
    const checkTargets = hasSelection ? proxies.filter((p) => ctrl.selectedProxyIds.has(p.id)) : ctrl.filtered;
    const stoppedTargets = checkTargets.filter((p) => p.status !== 'running').length;
    const checkLabel = hasSelection
        ? t(`检测所选 ${checkTargets.length} 项`, `Check ${checkTargets.length} selected`)
        : t(`检测筛选结果 ${checkTargets.length} 项`, `Check ${checkTargets.length} listed`);

    return (
        <div className={styles.workspace}>
            <section
                className={styles.main}
                aria-label={t('代理列表工作区', 'Proxies workspace')}
            >
                <div className={styles.header}>
                    <div className={styles.headingGroup}>
                        <h1 className={styles.title}>{t('代理', 'Proxies')}</h1>
                        <span className={styles.subtitle}>
                            {isEn
                                ? `${proxies.length} proxies · ${ctrl.runningCount} running`
                                : `${proxies.length} 个代理 · ${ctrl.runningCount} 项服务已启动`}
                        </span>
                    </div>
                    <Input
                        className={styles.searchInput}
                        aria-label={t('搜索代理', 'Search proxies')}
                        contentBefore={<SearchRegular />}
                        contentAfter={
                            ctrl.search ? (
                                <Button
                                    appearance="transparent"
                                    size="small"
                                    icon={<DismissRegular />}
                                    aria-label={t('清空搜索', 'Clear search')}
                                    onClick={() => ctrl.setSearch('')}
                                />
                            ) : undefined
                        }
                        placeholder={t(
                            '搜索代理名称、协议或出口 IP',
                            'Search by proxy name, protocol, or exit IP',
                        )}
                        value={ctrl.search}
                        onChange={(_, data) => ctrl.setSearch(data.value)}
                    />
                    <div className={styles.headerActions}>
                        {ctrl.activeSelectedProxyIds.length > 0 && (
                            <Button
                                appearance="subtle"
                                icon={<DeleteRegular />}
                                style={{
                                    color: tokens.colorPaletteRedForeground1,
                                }}
                                disabled={!!ctrl.busy || !!ctrl.batchChecking}
                                onClick={() => setRemoval([...ctrl.activeSelectedProxyIds])}
                            >
                                <Badge
                                    size="small"
                                    appearance="tint"
                                    color="danger"
                                    style={{ marginRight: '6px' }}
                                >
                                    {hiddenSelected ? t(`可见 ${visibleSelected}，隐藏 ${hiddenSelected}`, `${visibleSelected} visible, ${hiddenSelected} hidden`) : ctrl.activeSelectedProxyIds.length}
                                </Badge>
                                {t('批量删除', 'Remove Selected')}
                            </Button>
                        )}
                        <div className={styles.checkAction}>
                            <Button
                                appearance="subtle"
                                icon={<PulseRegular />}
                                disabled={
                                    !!ctrl.busy ||
                                    !!ctrl.batchChecking ||
                                    checkTargets.length === 0 ||
                                    (coreInfo ? !coreInfo.available : false)
                                }
                                onClick={() => void ctrl.handleBatchCheck(checkTargets)}
                            >
                                {ctrl.batchChecking
                                    ? isEn
                                        ? `Checking (${ctrl.batchChecking.done}/${ctrl.batchChecking.total})`
                                        : `测活中 (${ctrl.batchChecking.done}/${ctrl.batchChecking.total})`
                                    : checkLabel}
                            </Button>
                            {!ctrl.batchChecking && (stoppedTargets > 0 || hiddenSelected > 0) && (
                                <small>{[
                                    stoppedTargets > 0 && t(`将启动 ${stoppedTargets} 项`, `Starts ${stoppedTargets}`),
                                    hiddenSelected > 0 && t(`含隐藏 ${hiddenSelected} 项`, `${hiddenSelected} hidden`),
                                ].filter(Boolean).join(' · ')}</small>
                            )}
                        </div>
                        <Button
                            appearance="subtle"
                            icon={<ArrowImportRegular />}
                            disabled={!!ctrl.busy || !!ctrl.batchChecking}
                            onClick={() => {
                                ctrl.setBatchResult(null);
                                ctrl.setBatchImportOpen(true);
                            }}
                        >
                            {t('批量导入', 'Batch Import')}
                        </Button>
                        <Button
                            appearance="primary"
                            icon={<AddRegular />}
                            disabled={!!ctrl.busy || !!ctrl.batchChecking}
                            onClick={() => void ctrl.openEditor()}
                        >
                            {t('添加代理', 'Add Proxy')}
                        </Button>
                    </div>
                </div>

                {(loadError || (coreInfo && !coreInfo.available)) && (
                    <div className={styles.alerts}>
                        {loadError && (
                            <MessageBar intent="error">
                                <MessageBarBody>{loadError}</MessageBarBody>
                                <MessageBarActions>
                                    <Button
                                        size="small"
                                        onClick={onRefreshProxies}
                                    >
                                        {t('重试', 'Retry')}
                                    </Button>
                                </MessageBarActions>
                            </MessageBar>
                        )}
                        {coreInfo && !coreInfo.available && (
                            <MessageBar intent="warning" layout="multiline">
                                <MessageBarBody>
                                    {t(
                                        '内置 sing-box 核心不可用，保存与启动代理需要核心支持。请检查安装包完整性。',
                                        'sing-box core is unavailable. Download or import it in Settings to save and start proxies.',
                                    )}
                                </MessageBarBody>
                            </MessageBar>
                        )}
                    </div>
                )}

                <div className={styles.toolbar}>
                    <RunStatusFilter
                        value={ctrl.statusFilter}
                        onChange={ctrl.setStatusFilter}
                        total={proxies.length}
                        runningCount={ctrl.runningCount}
                        runningLabel={t('已启动', 'Running')}
                        stoppedLabel={t('未启动', 'Stopped')}
                    />
                    <div className={styles.toolbarActions}>
                        <Menu positioning="below-end">
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    appearance="subtle"
                                    icon={<ArrowSortRegular />}
                                    aria-label={t('代理排序方式', 'Sort proxies')}
                                />
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        onClick={() =>
                                            ctrl.setSortBy('original')
                                        }
                                    >
                                        {t('添加顺序', 'Order Added')}{' '}
                                        {ctrl.sortBy === 'original' ? '✓' : ''}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() => ctrl.setSortBy('name')}
                                    >
                                        {t('名称升序', 'Name (A–Z)')}{' '}
                                        {ctrl.sortBy === 'name' ? '✓' : ''}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() => ctrl.setSortBy('status')}
                                    >
                                        {t('运行状态', 'Status')}{' '}
                                        {ctrl.sortBy === 'status' ? '✓' : ''}
                                    </MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </div>
                </div>

                {loading && proxies.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Spinner
                            size="small"
                            label={t('正在读取代理列表…', 'Loading proxies…')}
                        />
                    </div>
                ) : ctrl.filtered.length === 0 ? (
                    <div className={styles.emptyState}>
                        <GlobeRegular style={{ fontSize: '36px' }} />
                        <span
                            style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: tokens.colorNeutralForeground1,
                            }}
                        >
                            {proxies.length > 0
                                ? t('没有匹配的代理', 'No matching proxies')
                                : t('还没有配置代理', 'No proxies configured yet')}
                        </span>
                        {proxies.length > 0 && (
                            <Button appearance="subtle" onClick={() => {
                                ctrl.setSearch('');
                                ctrl.setStatusFilter('all');
                            }}>{t('清除筛选', 'Clear filters')}</Button>
                        )}
                        {proxies.length === 0 && (
                            <Button
                                appearance="primary"
                                icon={<AddRegular />}
                                onClick={() => void ctrl.openEditor()}
                            >
                                {t('添加代理', 'Add Proxy')}
                            </Button>
                        )}
                    </div>
                ) : (
                    <div ref={ctrl.tableWrapRef} className={styles.tableWrap}>
                        <table
                            className={styles.table}
                            aria-label={t('代理列表', 'Proxies table')}
                            style={{
                                minWidth: narrowWindow
                                    ? 676
                                    : 44 + ctrl.nameWidth + 666,
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
                                                ctrl.filtered.length > 0 &&
                                                ctrl.filtered.every((p) =>
                                                    ctrl.selectedProxyIds.has(
                                                        p.id,
                                                    ),
                                                )
                                                    ? true
                                                    : ctrl.filtered.some((p) =>
                                                            ctrl.selectedProxyIds.has(
                                                                p.id,
                                                            ),
                                                        )
                                                      ? 'mixed'
                                                      : false
                                            }
                                            aria-label={t(
                                                '全选代理列表',
                                                'Select all proxies',
                                            )}
                                            onChange={
                                                ctrl.toggleSelectAllFilteredProxies
                                            }
                                        />
                                    </th>
                                    <th
                                        className={styles.th}
                                        style={{
                                            width: narrowWindow
                                                ? undefined
                                                : ctrl.nameWidth,
                                        }}
                                    >
                                        {t('名称', 'Name')}
                                        {!narrowWindow && (
                                            <ColumnResizeHandle
                                                label={t('名称', 'Name')}
                                                width={ctrl.nameWidth}
                                                min={200}
                                                onChange={ctrl.setNameWidth}
                                            />
                                        )}
                                    </th>
                                    <th
                                        className={styles.th}
                                        style={{
                                            width: narrowWindow
                                                ? '118px'
                                                : '148px',
                                        }}
                                    >
                                        {t('本地服务', 'Local Service')}
                                    </th>
                                    {!narrowWindow && (
                                        <th
                                            className={styles.th}
                                            style={{ width: '166px' }}
                                        >
                                            {t('环境使用', 'Bindings')}
                                        </th>
                                    )}
                                    <th
                                        className={styles.th}
                                        style={{ width: '200px' }}
                                    >
                                        {t('出口信息', 'Exit Info')}
                                    </th>
                                    <th
                                        className={styles.th}
                                        style={{ width: '152px' }}
                                    >
                                        {t('操作', 'Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {ctrl.isVirtualized &&
                                    ctrl.topSpacerHeight > 0 && (
                                        <tr
                                            aria-hidden="true"
                                            style={{
                                                height: `${ctrl.topSpacerHeight}px`,
                                            }}
                                        >
                                            <td
                                                colSpan={narrowWindow ? 5 : 6}
                                                style={{
                                                    padding: 0,
                                                    border: 'none',
                                                    height: `${ctrl.topSpacerHeight}px`,
                                                }}
                                            />
                                        </tr>
                                    )}
                                {ctrl.visibleProxies.map(
                                    (proxy, localIndex) => {
                                        const index =
                                            ctrl.startIndex + localIndex;
                                        const assigned =
                                            ctrl.envBindingsByProxy.get(
                                                proxy.id,
                                            ) || [];
                                        const selected =
                                            ctrl.selectedProxy?.id === proxy.id;

                                        return (
                                            <ProxyTableRow
                                                key={proxy.id}
                                                styles={styles}
                                                proxy={proxy}
                                                assigned={assigned}
                                                selected={selected}
                                                checked={ctrl.selectedProxyIds.has(
                                                    proxy.id,
                                                )}
                                                narrowWindow={narrowWindow}
                                                busy={ctrl.busy}
                                                refreshingExit={ctrl.refreshingExitIds.has(
                                                    proxy.id,
                                                )}
                                                selectionRowProps={ctrl.rowProps(
                                                    proxy,
                                                    index,
                                                )}
                                                onToggleChecked={() =>
                                                    ctrl.toggleSelectProxyId(
                                                        proxy.id,
                                                    )
                                                }
                                                onSelect={() =>
                                                    onSelectProxy(proxy.id)
                                                }
                                                onOpenDetails={() =>
                                                    onToggleDetails(true)
                                                }
                                                onOpenContextMenu={(event) =>
                                                    ctrl.openContextMenu(
                                                        event,
                                                        proxy,
                                                    )
                                                }
                                                onToggleService={() =>
                                                    ctrl.handleToggleService(
                                                        proxy,
                                                    )
                                                }
                                                onEdit={() =>
                                                    void ctrl.openEditor(proxy)
                                                }
                                                onAssign={() =>
                                                    ctrl.startAssignProxy(proxy)
                                                }
                                                onRefreshExit={() =>
                                                    void ctrl.refreshExitInfo(
                                                        proxy,
                                                    )
                                                }
                                                onInspectLogs={() =>
                                                    onInspectLogs(proxy.id)
                                                }
                                                onViewConfig={() =>
                                                    void ctrl.loadConfig(
                                                        proxy.id,
                                                    )
                                                }
                                                onDelete={() =>
                                                    ctrl.setDeleteProxy(proxy)
                                                }
                                            />
                                        );
                                    },
                                )}
                                {ctrl.isVirtualized &&
                                    ctrl.bottomSpacerHeight > 0 && (
                                        <tr
                                            aria-hidden="true"
                                            style={{
                                                height: `${ctrl.bottomSpacerHeight}px`,
                                            }}
                                        >
                                            <td
                                                colSpan={narrowWindow ? 5 : 6}
                                                style={{
                                                    padding: 0,
                                                    border: 'none',
                                                    height: `${ctrl.bottomSpacerHeight}px`,
                                                }}
                                            />
                                        </tr>
                                    )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {detailsOpen && ctrl.selectedProxy && (
                <ProxyDetailsPanel
                    proxy={ctrl.selectedProxy}
                    assignedEnvironments={
                        ctrl.envBindingsByProxy.get(ctrl.selectedProxy.id) || []
                    }
                    overlay={overlayDetails}
                    busy={ctrl.busy}
                    onClose={() => onToggleDetails(false)}
                    onToggleService={ctrl.handleToggleService}
                    onEdit={(proxy) => void ctrl.openEditor(proxy)}
                    onAssign={ctrl.startAssignProxy}
                    onViewConfig={(proxy) => void ctrl.loadConfig(proxy.id)}
                    onInspectLogs={onInspectLogs}
                    refreshingExit={ctrl.refreshingExitIds.has(
                        ctrl.selectedProxy.id,
                    )}
                    onRefreshExit={(proxy) => void ctrl.refreshExitInfo(proxy)}
                    onRotateIp={(proxy) => void ctrl.handleRotateProxyIp(proxy)}
                    onDelete={(proxy) => ctrl.setDeleteProxy(proxy)}
                />
            )}

            <ProxyEditorDrawer
                editor={ctrl.editor}
                onChange={ctrl.setEditor}
                onSwitchMode={ctrl.switchEditorMode}
                onSubmit={ctrl.saveProxy}
                onClose={ctrl.closeEditor}
                formError={ctrl.formError}
                busy={ctrl.busy}
                coreInfo={coreInfo}
            />

            <ProxyConfigDrawer
                proxyId={ctrl.configProxyId}
                proxies={proxies}
                configView={ctrl.configView}
                loading={ctrl.configLoading}
                error={ctrl.configError}
                onSelectProxy={(id) => void ctrl.loadConfig(id)}
                onToggleReveal={() =>
                    ctrl.configProxyId &&
                    void ctrl.loadConfig(
                        ctrl.configProxyId,
                        !!ctrl.configView?.redacted,
                    )
                }
                onCopy={() => void ctrl.copyConfig()}
                onClose={ctrl.closeConfig}
            />

            <BatchImportProxiesDialog
                open={ctrl.batchImportOpen}
                busy={ctrl.busy}
                batchText={ctrl.batchText}
                onBatchTextChange={ctrl.setBatchText}
                batchPrefix={ctrl.batchPrefix}
                onBatchPrefixChange={ctrl.setBatchPrefix}
                batchSkipDuplicates={ctrl.batchSkipDuplicates}
                onBatchSkipDuplicatesChange={ctrl.setBatchSkipDuplicates}
                batchResult={ctrl.batchResult}
                onClose={() => ctrl.setBatchImportOpen(false)}
                onSubmit={() => void ctrl.handleBatchImport()}
            />

            {removal && (
                <ConfirmAction title={t('永久删除所选代理？', 'Permanently delete selected proxies?')}
                    action={t('删除', 'Delete')} onCancel={() => setRemoval(null)}
                    onConfirm={() => { ctrl.handleBatchRemoveSelected(removal); setRemoval(null); }}>
                    {proxies.filter(p => removal.includes(p.id)).map(p => p.name).join(' · ')}
                </ConfirmAction>
            )}
            <ProxyActionDialogs
                styles={styles}
                busy={ctrl.busy}
                environments={environments}
                envBindingsByProxy={ctrl.envBindingsByProxy}
                refreshingExitIds={ctrl.refreshingExitIds}
                assignProxy={ctrl.assignProxy}
                assignEnvironmentId={ctrl.assignEnvironmentId}
                onAssignEnvironmentIdChange={ctrl.setAssignEnvironmentId}
                onCloseAssign={() => ctrl.setAssignProxy(null)}
                onConfirmAssign={ctrl.confirmAssignProxy}
                deleteProxy={ctrl.deleteProxy}
                onCloseDelete={() => ctrl.setDeleteProxy(null)}
                onConfirmDelete={ctrl.confirmDeleteProxy}
                contextMenu={ctrl.contextMenu}
                onCloseContextMenu={() => ctrl.setContextMenu(null)}
                onToggleService={ctrl.handleToggleService}
                onOpenDetails={(proxy) => {
                    onSelectProxy(proxy.id);
                    onToggleDetails(true);
                }}
                onEdit={(proxy) => void ctrl.openEditor(proxy)}
                onStartAssign={ctrl.startAssignProxy}
                onRefreshExit={(proxy) => void ctrl.refreshExitInfo(proxy)}
                onInspectLogs={onInspectLogs}
                onViewConfig={(id) => void ctrl.loadConfig(id)}
                onStartDelete={(proxy) => ctrl.setDeleteProxy(proxy)}
            />
        </div>
    );
};

export default ProxiesPage;
