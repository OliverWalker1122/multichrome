import React, { useCallback, useMemo, useState } from 'react';
import { FluentProvider, makeStyles, tokens } from '@fluentui/react-components';
import {
    BatchCreateEnvironmentsInput,
    BrowserEngineType,
    ChromeEnvironment,
    DeleteGroupOptions,
} from './types';
import { getWindowTheme } from './theme/win11Theme';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import {
    EnvironmentProvider,
    useEnvironment,
} from './contexts/EnvironmentContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import {
    NotificationProvider,
    useNotification,
} from './contexts/NotificationContext';
import { environmentApi } from './services';
import { useSavedTableValue } from './hooks/useTableWorkspace';
import { useAppShellLifecycle } from './hooks/useAppShellLifecycle';
import TitleBar from './components/layout/TitleBar';
import NavigationSidebar, {
    NavSection,
} from './components/layout/NavigationSidebar';
import LogDockPanel from './components/layout/LogDockPanel';
import StatusBar from './components/layout/StatusBar';
import EnvironmentsPage from './components/environments/EnvironmentsPage';
import CreateEnvironmentModal from './components/environments/CreateEnvironmentModal';
import ApplicationLogsPanel from './components/layout/ApplicationLogsPanel';
import ProxiesPage from './components/proxies/ProxiesPage';
import TrashPage from './components/environments/TrashPage';
import SettingsPage, { SettingsTab } from './components/settings/SettingsPage';
import DeleteGroupDialog from './components/environments/DeleteGroupDialog';
import RenameGroupDialog from './components/environments/RenameGroupDialog';
import LaunchGuardDialog from './components/environments/LaunchGuardDialog';
import EnvironmentHealthDialog from './components/environments/EnvironmentHealthDialog';
import { useI18n } from './i18n';

interface NavigationTarget {
    section: NavSection;
    group?: string;
    favorites?: boolean;
    environmentId?: string;
    tab?: SettingsTab;
}

interface NavigationRequest {
    target: NavigationTarget;
    index?: number;
}

function sameDestination(a: NavigationTarget, b: NavigationTarget) {
    return a.section === b.section && a.group === b.group && Boolean(a.favorites) === Boolean(b.favorites)
        && a.environmentId === b.environmentId && a.tab === b.tab;
}

const useStyles = makeStyles({
    shell: {
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--glass-shell)',
        backgroundImage: 'var(--glass-sheen)',
        color: tokens.colorNeutralForeground1,
    },
    body: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        overflow: 'hidden',
    },
    contentColumn: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--glass-workspace)',
        isolation: 'isolate',
        borderTop: '1px solid var(--glass-border)',
        borderLeft: '1px solid var(--glass-border)',
        borderTopLeftRadius: '14px',
    },
    workspaceHost: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
    },
});

const AppShell: React.FC = () => {
    const styles = useStyles();
    const { state, actions } = useEnvironment();
    const {
        settings,
        themeMode,
        isDark,
        loading: settingsLoading,
        actions: settingsActions,
    } = useSettings();
    const { showNotification } = useNotification();
    const { isEn, t } = useI18n();

    const [history, setHistory] = useState({
        entries: [{ section: 'environments', group: '用户分组' }] as NavigationTarget[],
        index: 0,
    });
    const currentPage = history.entries[history.index];
    const activeSection = currentPage.section;
    const [settingsDirty, setSettingsDirty] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState<NavigationRequest | null>(null);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [shortcutRevision, setShortcutRevision] = useState(0);
    const [favoriteIds, setFavoriteIds] = useSavedTableValue<string[]>(
        'multichrome.env.favorites', [],
        (value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string'),
    );
    const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
    const favorites = useMemo(() => state.environments.filter(env => favoriteSet.has(env.id)), [state.environments, favoriteSet]);
    const toggleFavorite = (id: string) => setFavoriteIds(current =>
        current.includes(id) ? current.filter(item => item !== id) : [...current, id],
    );

    const applyNavigation = ({ target, index }: NavigationRequest) => {
        setHistory(previous => {
            if (index !== undefined) return { ...previous, index };
            if (sameDestination(previous.entries[previous.index], target)) return previous;
            const entries = [...previous.entries.slice(0, previous.index + 1), target];
            return { entries, index: entries.length - 1 };
        });
        if (target.section === 'environments') {
            const group = target.group ?? '用户分组';
            const exists = group === '用户分组' || state.emptyGroups.includes(group)
                || state.environments.some(env => env.groupName === group);
            actions.setCurrentGroup(exists ? group : '用户分组');
            setFavoritesOnly(Boolean(target.favorites));
            const shortcut = target.environmentId ? favorites.find(env => env.id === target.environmentId) : undefined;
            setEnvDetailsOpen(Boolean(shortcut));
            if (shortcut) {
                setSelectedEnvId(shortcut.id);
                setShortcutRevision(current => current + 1);
            }
        }
    };
    const requestNavigation = (target: NavigationTarget, index?: number) => {
        const request = { target, index };
        if (activeSection === 'settings' && target.section !== 'settings' && settingsDirty) {
            setPendingNavigation(request);
        } else {
            applyNavigation(request);
        }
    };
    const navigate = (section: NavSection) => {
        if (section === activeSection) return;
        if (section === 'environments') {
            requestNavigation({ section, group: state.currentGroup, favorites: favoritesOnly });
        } else {
            requestNavigation(section === 'settings' ? { section, tab: 'general' } : { section });
        }
    };
    const goToHistory = (index: number) => {
        const target = history.entries[index];
        if (target) requestNavigation(target, index);
    };

    const finishLeavingSettings = () => {
        if (!pendingNavigation) return;
        applyNavigation(pendingNavigation);
        setPendingNavigation(null);
        setSettingsDirty(false);
    };
    const [sidebarOverride, setSidebarOverride] = useState<{ compact: boolean; collapsed: boolean } | null>(null);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [renameGroupTarget, setRenameGroupTarget] = useState<string | null>(
        null,
    );
    const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(
        null,
    );
    const [appLogsOpen, setAppLogsOpen] = useState(false);

    const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
    const [selectedProxyId, setSelectedProxyId] = useState<string | null>(null);
    const [envDetailsOpen, setEnvDetailsOpen] = useState(false);
    const [proxyDetailsOpen, setProxyDetailsOpen] = useState(false);

    const lifecycle = useAppShellLifecycle({
        activeSection,
        environments: state.environments,
        currentGroup: state.currentGroup,
        selectedEnvId,
        selectedProxyId,
        onSelectProxyId: setSelectedProxyId,
        settings,
        launchEnvironment: actions.launchEnvironment,
        updateEnvironment: actions.updateEnvironment,
    });

    const compact = lifecycle.windowWidth < 880;
    const navCollapsed = sidebarOverride?.compact === compact ? sidebarOverride.collapsed : compact;
    const narrowWindow = lifecycle.contentWidth < 760;
    const overlayDetails = lifecycle.contentWidth < 1120;
    const totalRunningEnvs = useMemo(
        () => state.environments.filter((env) => env.isRunning).length,
        [state.environments],
    );

    const handleQuickToggleTheme = useCallback(() => {
        const next = isDark ? 'light' : 'dark';
        void settingsActions.setThemeMode(next);
    }, [isDark, settingsActions]);

    const { groups, groupCounts } = useMemo(() => {
        const counts: Record<string, number> = {};
        state.environments.forEach((env) => {
            if (env.groupName) {
                counts[env.groupName] = (counts[env.groupName] || 0) + 1;
            }
        });
        const uniqueGroups = Array.from(
            new Set(
                state.environments.map((env) => env.groupName).filter(Boolean),
            ),
        );
        return { groups: uniqueGroups, groupCounts: counts };
    }, [state.environments]);

    const groupsForModal = groups.length > 0 ? groups : ['默认分组'];

    const filteredEnvironments = useMemo(
        () =>
            favoritesOnly ? favorites : state.currentGroup === '用户分组'
                ? state.environments
                : state.environments.filter(
                      (env) => env.groupName === state.currentGroup,
                  ),
        [state.environments, state.currentGroup, favorites, favoritesOnly],
    );

    const kernelUpdateSummary = lifecycle.kernelStatus?.updateSummary;
    const settingsUpdateTooltip = useMemo(() => {
        if (!kernelUpdateSummary?.hasAnyUpdate) return undefined;
        const parts: string[] = [];
        if (
            kernelUpdateSummary.fingerprint.hasUpdate &&
            kernelUpdateSummary.fingerprint.recommendedVersion
        ) {
            parts.push(
                isEn
                    ? `Fingerprint Kernel ${kernelUpdateSummary.fingerprint.recommendedVersion}`
                    : `指纹内核 ${kernelUpdateSummary.fingerprint.recommendedVersion}`,
            );
        }
        if (
            kernelUpdateSummary.singbox.hasUpdate &&
            kernelUpdateSummary.singbox.recommendedVersion
        ) {
            parts.push(
                `sing-box v${kernelUpdateSummary.singbox.recommendedVersion}`,
            );
        }
        if (parts.length === 0) return undefined;
        return isEn
            ? `Verified recommended update available: ${parts.join(', ')}`
            : `有已验证推荐内核可升级：${parts.join('、')}`;
    }, [kernelUpdateSummary, isEn]);

    const handleCreateEnvironment = async (
        name: string,
        groupName: string,
        notes: string,
        options?: {
            browserEngine?: BrowserEngineType;
            proxyId?: string;
            tags?: string[];
        },
    ) => {
        const created = await actions.createEnvironment(
            name,
            groupName,
            notes,
            options,
        );
        setSelectedEnvId(created.id);
        setCreateModalOpen(false);
        showNotification(
            'success',
            isEn
                ? `Created environment "${created.name}"`
                : `已创建环境“${created.name}”`,
        );
    };

    const handleBatchCreateEnvironments = async (
        payload: BatchCreateEnvironmentsInput,
    ) => {
        const created = await environmentApi.batchCreate(payload);
        await actions.refreshEnvironments();
        if (created.length > 0) {
            setSelectedEnvId(created[0].id);
        }
        setCreateModalOpen(false);
        showNotification(
            'success',
            isEn
                ? `Created ${created.length} profiles`
                : `已批量创建 ${created.length} 个环境`,
        );
    };

    const handleCloneEnvironment = async (id: string) => {
        const cloned = await actions.cloneEnvironment(id);
        setSelectedEnvId(cloned.id);
        showNotification(
            'success',
            isEn
                ? `Cloned environment "${cloned.name}" (new unique fingerprint assigned)`
                : `已克隆环境“${cloned.name}”（已分配全新独立指纹）`,
        );
    };

    const handleConfirmRenameGroup = async (
        oldName: string,
        newName: string,
    ) => {
        const result = await actions.renameGroup(oldName, newName);
        setHistory(previous => ({
            ...previous,
            entries: previous.entries.map(entry => entry.group === result.oldName
                ? { ...entry, group: result.newName } : entry),
        }));
        setRenameGroupTarget(null);
        showNotification(
            'success',
            isEn
                ? `Renamed group "${result.oldName}" to "${result.newName}"`
                : `已将分组“${result.oldName}”重命名为“${result.newName}”`,
        );
    };

    const deleteGroupInfo = useMemo(() => {
        if (!deleteGroupTarget) {
            return {
                environmentCount: 0,
                runningCount: 0,
                availableTargetGroups: [] as string[],
            };
        }
        const envsInGroup = state.environments.filter(
            (env) => env.groupName === deleteGroupTarget,
        );
        const otherGroups = groups.filter((g) => g !== deleteGroupTarget);
        const targetCandidates =
            deleteGroupTarget === '默认分组'
                ? otherGroups
                : Array.from(new Set(['默认分组', ...otherGroups]));
        return {
            environmentCount: envsInGroup.length,
            runningCount: envsInGroup.filter((env) => env.isRunning).length,
            availableTargetGroups: targetCandidates,
        };
    }, [deleteGroupTarget, state.environments, groups]);

    const handleConfirmDeleteGroup = async (options: DeleteGroupOptions) => {
        if (!deleteGroupTarget) return;
        const result = await actions.deleteGroup(deleteGroupTarget, options);
        setDeleteGroupTarget(null);
        if (result.action === 'trash') {
            lifecycle.refreshTrashCount();
        }
        if (result.affectedCount === 0) {
            showNotification(
                'success',
                isEn
                    ? `Deleted empty group "${result.groupName}"`
                    : `已删除空分组“${result.groupName}”`,
            );
        } else if (result.action === 'move') {
            showNotification(
                'success',
                isEn
                    ? `Deleted group "${result.groupName}" and moved ${result.affectedCount} environment(s) to "${result.targetGroup}"`
                    : `已删除分组“${result.groupName}”，${result.affectedCount} 个环境已移至“${result.targetGroup}”`,
            );
        } else {
            showNotification(
                'success',
                isEn
                    ? `Deleted group "${result.groupName}" and moved ${result.affectedCount} environment(s) to Trash`
                    : `已删除分组“${result.groupName}”，并将 ${result.affectedCount} 个环境移入回收站`,
            );
        }
    };

    const handleRegenerateFingerprint = async (id: string) => {
        await actions.regenerateFingerprint(id);
    };

    const hasFingerprintKernel = Boolean(
        lifecycle.kernelStatus?.activeKernelId &&
            lifecycle.kernelStatus.installedKernels.some(
                (k) => k.id === lifecycle.kernelStatus?.activeKernelId,
            ),
    );
    const hasAnyBrowserEngine = Boolean(
        lifecycle.kernelStatus?.systemChromeAvailable || hasFingerprintKernel,
    );

    const handleSaveEnvironment = async (
        id: string,
        data: Partial<ChromeEnvironment>,
    ) => {
        await actions.updateEnvironment(id, data, { throwOnError: true });
    };

    const selectionLabel = useMemo(() => {
        if (activeSection === 'environments') {
            if (lifecycle.selectedEnv) {
                return isEn
                    ? `Current profile: ${lifecycle.selectedEnv.name} · ${lifecycle.selectedEnv.isRunning ? 'Running' : 'Stopped'}`
                    : `当前环境： ${lifecycle.selectedEnv.name} · ${lifecycle.selectedEnv.isRunning ? '运行中' : '未运行'}`;
            }
            const running = filteredEnvironments.filter(
                (e) => e.isRunning,
            ).length;
            return isEn
                ? `${filteredEnvironments.length} environments · ${running} running`
                : `${filteredEnvironments.length} 个环境 · ${running} 个运行中`;
        }
        if (activeSection === 'proxies') {
            if (lifecycle.selectedProxy) {
                const status =
                    lifecycle.selectedProxy.status === 'running'
                        ? t('本地服务已启动', 'Local service running')
                        : lifecycle.selectedProxy.status === 'error'
                          ? t('启动异常', 'Start error')
                          : t('未启动', 'Stopped');
                return isEn
                    ? `Current proxy: ${lifecycle.selectedProxy.name} · ${status}`
                    : `当前代理： ${lifecycle.selectedProxy.name} · ${status}`;
            }
            const running = lifecycle.managedProxies.filter(
                (p) => p.status === 'running',
            ).length;
            return isEn
                ? `${lifecycle.managedProxies.length} proxies · ${running} running`
                : `${lifecycle.managedProxies.length} 个代理 · ${running} 项服务已启动`;
        }
        if (activeSection === 'trash') {
            return isEn
                ? `Trash · ${lifecycle.trashCount} deleted`
                : `回收站 · ${lifecycle.trashCount} 个已删除环境`;
        }
        return t('系统设置', 'Settings');
    }, [
        activeSection,
        lifecycle.selectedEnv,
        lifecycle.selectedProxy,
        filteredEnvironments,
        lifecycle.managedProxies,
        lifecycle.trashCount,
        isEn,
        t,
    ]);

    const errorLogCount = useMemo(
        () => lifecycle.logs.filter((entry) => entry.level === 'error').length,
        [lifecycle.logs],
    );

    return (
        <div className={styles.shell}>
            <TitleBar
                themeMode={themeMode}
                isDark={isDark}
                onToggleTheme={handleQuickToggleTheme}
                collapsed={navCollapsed}
                onToggleCollapsed={() => setSidebarOverride({ compact, collapsed: !navCollapsed })}
                runningCount={totalRunningEnvs}
                singboxReady={Boolean(lifecycle.coreInfo?.available)}
                canGoBack={history.index > 0}
                canGoForward={history.index + 1 < history.entries.length}
                onBack={() => goToHistory(history.index - 1)}
                onForward={() => goToHistory(history.index + 1)}
                onOpenSettings={() => navigate('settings')}
            />

            <div className={styles.body}>
                <NavigationSidebar
                    activeSection={activeSection}
                    onSelectSection={(section) => navigate(section)}
                    collapsed={navCollapsed}
                    favorites={favorites}
                    favoritesOnly={favoritesOnly}
                    onSelectFavorites={environmentId => requestNavigation({ section: 'environments', group: '用户分组', favorites: true, environmentId })}
                    environmentCount={state.environments.length}
                    proxyCount={lifecycle.managedProxies.length}
                    trashCount={lifecycle.trashCount}
                    groups={groups}
                    groupCounts={groupCounts}
                    currentGroup={state.currentGroup}
                    emptyGroups={state.emptyGroups}
                    onSelectGroup={group => requestNavigation({ section: 'environments', group })}
                    onRequestRenameGroup={(group) =>
                        setRenameGroupTarget(group)
                    }
                    onRequestDeleteGroup={(group) =>
                        setDeleteGroupTarget(group)
                    }
                    settingsBadge={Boolean(kernelUpdateSummary?.hasAnyUpdate)}
                    settingsBadgeTooltip={settingsUpdateTooltip}
                />

                <main
                    ref={lifecycle.contentRef}
                    className={styles.contentColumn}
                >
                    <div className={styles.workspaceHost}>
                        {activeSection === 'environments' && (
                            <EnvironmentsPage
                                key={shortcutRevision}
                                favoritesOnly={favoritesOnly}
                                favoriteIds={favoriteSet}
                                onToggleFavorite={toggleFavorite}
                                environments={filteredEnvironments}
                                allEnvironments={state.environments}
                                allGroups={groupsForModal}
                                currentGroup={state.currentGroup}
                                managedProxies={lifecycle.managedProxies}
                                loading={state.loading}
                                selectedEnvId={selectedEnvId}
                                onSelectEnv={setSelectedEnvId}
                                detailsOpen={envDetailsOpen}
                                onToggleDetails={(open) =>
                                    setEnvDetailsOpen((prev) =>
                                        typeof open === 'boolean'
                                            ? open
                                            : !prev,
                                    )
                                }
                                workspaceWidth={lifecycle.contentWidth}
                                overlayDetails={overlayDetails}
                                onCreateClick={() => setCreateModalOpen(true)}
                                onLaunch={lifecycle.handleLaunchWithGuard}
                                onBatchLaunch={
                                    lifecycle.handleBatchLaunchWithGuard
                                }
                                onClose={actions.closeEnvironment}
                                onClone={handleCloneEnvironment}
                                onDelete={actions.deleteEnvironment}
                                onRefresh={actions.refreshEnvironments}
                                onUpdateEnvironment={handleSaveEnvironment}
                                onRegenerateFingerprint={
                                    handleRegenerateFingerprint
                                }
                                hasFingerprintKernel={hasFingerprintKernel}
                                hasAnyBrowserEngine={hasAnyBrowserEngine}
                                onInspectProxyLogs={
                                    lifecycle.handleInspectProxyLogs
                                }
                                onNavigateComponents={() => requestNavigation({ section: 'settings', tab: 'components' })}
                                onNavigateProxies={() =>
                                    navigate('proxies')
                                }
                                onRequestRenameGroup={(group) =>
                                    setRenameGroupTarget(group)
                                }
                                onRequestDeleteGroup={(group) =>
                                    setDeleteGroupTarget(group)
                                }
                            />
                        )}

                        {activeSection === 'proxies' && (
                            <ProxiesPage
                                proxies={lifecycle.managedProxies}
                                environments={state.environments}
                                coreInfo={lifecycle.coreInfo}
                                loading={lifecycle.proxiesLoading}
                                loadError={lifecycle.proxiesLoadError}
                                selectedProxyId={selectedProxyId}
                                onSelectProxy={setSelectedProxyId}
                                detailsOpen={proxyDetailsOpen}
                                onToggleDetails={(open) =>
                                    setProxyDetailsOpen((prev) =>
                                        typeof open === 'boolean' ? open : !prev,
                                    )
                                }
                                narrowWindow={lifecycle.contentWidth - (proxyDetailsOpen && !overlayDetails ? 348 : 0) < 990}
                                overlayDetails={overlayDetails}
                                onRefreshProxies={lifecycle.triggerProxyRefresh}
                                onEnvironmentChanged={
                                    actions.refreshEnvironments
                                }
                                onInspectLogs={lifecycle.handleInspectProxyLogs}
                            />
                        )}

                        {activeSection === 'trash' && (
                            <TrashPage
                                onEnvironmentRestored={
                                    actions.refreshEnvironments
                                }
                                onCountChange={lifecycle.setTrashCount}
                                narrowWindow={narrowWindow}
                            />
                        )}

                        {activeSection === 'settings' && (
                            <SettingsPage
                                currentSettings={settings}
                                onDraftStateChange={setSettingsDirty}
                                leaveRequested={Boolean(pendingNavigation)}
                                onLeave={finishLeavingSettings}
                                onKeepEditing={() => setPendingNavigation(null)}
                                onSave={settingsActions.saveSettings}
                                onThemePreview={settingsActions.setThemeMode}
                                coreInfo={lifecycle.coreInfo}
                                appVersion={lifecycle.appVersion}
                                managedProxies={lifecycle.managedProxies}
                                groups={groupsForModal}
                                kernelStatus={lifecycle.kernelStatus}
                                onKernelStatusChange={(nextStatus) => {
                                    lifecycle.setKernelStatus(nextStatus);
                                    lifecycle.triggerProxyRefresh();
                                }}
                                activeTab={currentPage.tab ?? 'general'}
                                onTabChange={tab => requestNavigation({ section: 'settings', tab })}
                                onDataRestored={() => {
                                    void settingsActions.loadSettings();
                                    void actions.refreshEnvironments();
                                    lifecycle.triggerProxyRefresh();
                                    lifecycle.refreshTrashCount();
                                }}
                            />
                        )}
                    </div>

                    <LogDockPanel
                        open={lifecycle.logOpen}
                        height={lifecycle.logHeight}
                        onHeightChange={(height) =>
                            lifecycle.updateLogDock({ height })
                        }
                        onCollapse={() =>
                            lifecycle.updateLogDock({ open: false })
                        }
                        proxies={lifecycle.managedProxies}
                        scopeLabel={lifecycle.logTarget.label}
                        emptyMessage={
                            lifecycle.logTarget.kind === 'none'
                                ? lifecycle.logTarget.emptyMessage
                                : undefined
                        }
                        hasTarget={lifecycle.logTarget.kind !== 'none'}
                        errorMessage={lifecycle.logError}
                        scope={lifecycle.logScope}
                        onScopeChange={(nextScope) => {
                            lifecycle.setLogScope(nextScope);
                            lifecycle.triggerProxyRefresh();
                        }}
                        level={lifecycle.logLevel}
                        onLevelChange={lifecycle.setLogLevel}
                        logs={lifecycle.logs}
                        paused={lifecycle.logsPaused}
                        onTogglePaused={() =>
                            lifecycle.setLogsPaused((prev) => !prev)
                        }
                        followLatest={lifecycle.followLatest}
                        onToggleFollowLatest={() =>
                            lifecycle.setFollowLatest((prev) => !prev)
                        }
                        onRefresh={() => {
                            lifecycle.setLogsPaused(false);
                            lifecycle.triggerProxyRefresh();
                        }}
                        onClear={() => void lifecycle.handleClearLogs()}
                        busy={lifecycle.clearingLogs}
                        jumpToErrorTick={lifecycle.jumpToErrorTick}
                    />

                    <StatusBar
                        selectionLabel={selectionLabel}
                        logOpen={lifecycle.logOpen}
                        onToggleLog={() =>
                            lifecycle.updateLogDock({
                                open: !lifecycle.logOpen,
                            })
                        }
                        onJumpToErrorLog={lifecycle.handleJumpToErrorLog}
                        onOpenAppLogs={() => setAppLogsOpen(true)}
                        errorLogCount={errorLogCount}
                        coreInfo={lifecycle.coreInfo}
                        appVersion={lifecycle.appVersion}
                    />
                </main>
            </div>

            {appLogsOpen && (
                <ApplicationLogsPanel onClose={() => setAppLogsOpen(false)} />
            )}

            <CreateEnvironmentModal
                open={createModalOpen}
                onCancel={() => setCreateModalOpen(false)}
                onOk={handleCreateEnvironment}
                onBatchCreate={handleBatchCreateEnvironments}
                groups={groupsForModal}
                defaultGroup={state.currentGroup}
                defaultEngine={settings.fingerprint?.defaultEngine}
                defaultNetwork={settingsLoading || !settings.dataPath ? 'unknown' : settings.globalProxy?.enabled && settings.globalProxy.address ? 'proxy' : 'direct'}
                hasFingerprintKernel={hasFingerprintKernel}
                managedProxies={lifecycle.managedProxies}
                allEnvironments={state.environments}
            />

            <RenameGroupDialog
                groupName={renameGroupTarget}
                existingGroups={groups}
                onCancel={() => setRenameGroupTarget(null)}
                onConfirm={handleConfirmRenameGroup}
            />

            <DeleteGroupDialog
                groupName={deleteGroupTarget}
                environmentCount={deleteGroupInfo.environmentCount}
                runningCount={deleteGroupInfo.runningCount}
                availableTargetGroups={deleteGroupInfo.availableTargetGroups}
                onCancel={() => setDeleteGroupTarget(null)}
                onConfirm={handleConfirmDeleteGroup}
            />

            <LaunchGuardDialog
                env={lifecycle.launchGuardState?.env || null}
                report={lifecycle.launchGuardState?.report || null}
                items={lifecycle.launchGuardQueue}
                onCancel={lifecycle.handleCancelLaunchGuard}
                onAutoAlignAndLaunch={lifecycle.handleAutoAlignAndLaunch}
                onForceLaunch={lifecycle.handleForceLaunch}
                onRetry={lifecycle.retryIncompleteChecks}
            />

            <EnvironmentHealthDialog
                env={lifecycle.launchHealthEnv}
                environments={lifecycle.launchHealthQueue}
                mode="launch"
                batchQueueCount={lifecycle.launchHealthQueueCount}
                onClose={lifecycle.handleDismissHealthLaunch}
                onConfirmLaunch={lifecycle.handleConfirmHealthLaunch}
                onConfirmLaunchAll={lifecycle.handleConfirmHealthLaunchAll}
            />
        </div>
    );
};

const ThemedApp: React.FC = () => {
    const { isDark, settings } = useSettings();
    const palette = settings.palette ?? 'neutral';
    const theme = useMemo(() => getWindowTheme(palette, isDark), [palette, isDark]);
    return (
        <FluentProvider
            theme={theme}
            style={{
                height: '100%',
                width: '100%',
                backgroundColor: 'transparent',
            }}
        >
            <NotificationProvider>
                <EnvironmentProvider>
                    <AppShell />
                </EnvironmentProvider>
            </NotificationProvider>
        </FluentProvider>
    );
};

const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <SettingsProvider>
                <ThemedApp />
            </SettingsProvider>
        </ErrorBoundary>
    );
};

export default App;
