import React, { useCallback, useMemo, useState } from 'react';
import { FluentProvider, makeStyles, tokens } from '@fluentui/react-components';
import {
    BrowserEngineType,
    ChromeEnvironment,
    DeleteGroupOptions,
} from './types';
import { win11DarkTheme, win11LightTheme } from './theme/win11Theme';
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
import SettingsPage from './components/settings/SettingsPage';
import DeleteGroupDialog from './components/environments/DeleteGroupDialog';
import RenameGroupDialog from './components/environments/RenameGroupDialog';
import LaunchGuardDialog from './components/environments/LaunchGuardDialog';
import EnvironmentHealthDialog from './components/environments/EnvironmentHealthDialog';
import { useI18n } from './i18n';

const useStyles = makeStyles({
    shell: {
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--glass-shell)',
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
        actions: settingsActions,
    } = useSettings();
    const { showNotification } = useNotification();
    const { isEn, t } = useI18n();

    const [activeSection, setActiveSection] =
        useState<NavSection>('environments');
    const [sidebarManualCollapsed, setSidebarManualCollapsed] = useState(false);
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

    const navCollapsed =
        lifecycle.windowWidth < 880 || sidebarManualCollapsed;
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
            state.currentGroup === '用户分组'
                ? state.environments
                : state.environments.filter(
                      (env) => env.groupName === state.currentGroup,
                  ),
        [state.environments, state.currentGroup],
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
                    ? `Selected: ${lifecycle.selectedEnv.name} · ${lifecycle.selectedEnv.isRunning ? 'Running' : 'Stopped'}`
                    : `已选择: ${lifecycle.selectedEnv.name} · ${lifecycle.selectedEnv.isRunning ? '运行中' : '未运行'}`;
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
                    ? `Selected: ${lifecycle.selectedProxy.name} · ${status}`
                    : `已选择: ${lifecycle.selectedProxy.name} · ${status}`;
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
                runningCount={totalRunningEnvs}
                singboxReady={Boolean(lifecycle.coreInfo?.available)}
                onOpenSettings={() => setActiveSection('settings')}
            />

            <div className={styles.body}>
                <NavigationSidebar
                    activeSection={activeSection}
                    onSelectSection={(section) => setActiveSection(section)}
                    collapsed={navCollapsed}
                    canToggleCollapsed={lifecycle.windowWidth >= 880}
                    onToggleCollapsed={() =>
                        setSidebarManualCollapsed((prev) => !prev)
                    }
                    environmentCount={state.environments.length}
                    proxyCount={lifecycle.managedProxies.length}
                    trashCount={lifecycle.trashCount}
                    groups={groups}
                    groupCounts={groupCounts}
                    currentGroup={state.currentGroup}
                    emptyGroups={state.emptyGroups}
                    onSelectGroup={(group) => actions.setCurrentGroup(group)}
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
                                onClose={actions.closeEnvironment}
                                onClone={handleCloneEnvironment}
                                onDelete={actions.deleteEnvironment}
                                onRefresh={actions.refreshEnvironments}
                                onUpdateEnvironment={handleSaveEnvironment}
                                onRegenerateFingerprint={
                                    handleRegenerateFingerprint
                                }
                                hasFingerprintKernel={hasFingerprintKernel}
                                onInspectProxyLogs={
                                    lifecycle.handleInspectProxyLogs
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
                                narrowWindow={lifecycle.contentWidth < 920}
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
                groups={groupsForModal}
                defaultGroup={state.currentGroup}
                defaultEngine={settings.fingerprint?.defaultEngine}
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
                onCancel={() => lifecycle.setLaunchGuardState(null)}
                onAutoAlignAndLaunch={lifecycle.handleAutoAlignAndLaunch}
                onForceLaunch={lifecycle.handleForceLaunch}
            />

            <EnvironmentHealthDialog
                env={lifecycle.launchHealthEnv}
                mode="launch"
                onClose={() => lifecycle.setLaunchHealthEnv(null)}
                onConfirmLaunch={lifecycle.handleConfirmHealthLaunch}
            />
        </div>
    );
};

const ThemedApp: React.FC = () => {
    const { isDark } = useSettings();
    return (
        <FluentProvider
            theme={isDark ? win11DarkTheme : win11LightTheme}
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
