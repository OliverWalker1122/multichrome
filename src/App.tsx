import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FluentProvider, makeStyles, tokens } from '@fluentui/react-components';
import {
    BrowserEngineType,
    ChromeEnvironment,
    DeleteGroupOptions,
    KernelStatus,
    LaunchConsistencyReport,
    ManagedProxy,
    ProxyCoreInfo,
    ProxyLog,
} from './types';
import { win11DarkTheme, win11LightTheme } from './theme/win11Theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
    EnvironmentProvider,
    useEnvironment,
} from './contexts/EnvironmentContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import {
    NotificationProvider,
    useNotification,
} from './contexts/NotificationContext';
import TitleBar from './components/TitleBar';
import NavigationSidebar, { NavSection } from './components/NavigationSidebar';
import LogDockPanel, {
    LogLevelFilter,
    LogScope,
} from './components/LogDockPanel';
import StatusBar from './components/StatusBar';
import EnvironmentsPage from './components/EnvironmentsPage';
import CreateEnvironmentModal from './components/CreateEnvironmentModal';
// A file:// window can outlive a rebuild that removes the previous renderer assets.
import ApplicationLogsPanel from './components/ApplicationLogsPanel';
import ProxiesPage from './components/ProxiesPage';
import TrashPage from './components/TrashPage';
import SettingsPage from './components/SettingsPage';
import DeleteGroupDialog from './components/DeleteGroupDialog';
import RenameGroupDialog from './components/RenameGroupDialog';
import LaunchGuardDialog from './components/LaunchGuardDialog';
import EnvironmentHealthDialog from './components/EnvironmentHealthDialog';
import { useI18n } from './i18n';
import {
    clearTargetLogs,
    loadLogDockPreferences,
    readTargetLogs,
    resolveLogTarget,
    saveLogDockPreferences,
    LogDockPreference,
} from './utils/logWorkspace';

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
    const { locale, isEn, t } = useI18n();

    // 导航与页面状态
    const [activeSection, setActiveSection] =
        useState<NavSection>('environments');
    const [sidebarManualCollapsed, setSidebarManualCollapsed] = useState(false);
    const [windowWidth, setWindowWidth] = useState<number>(
        () => window.innerWidth,
    );
    const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
    const contentRef = useRef<HTMLElement>(null);
    const [contentWidth, setContentWidth] = useState(
        () => window.innerWidth - 192,
    );
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [renameGroupTarget, setRenameGroupTarget] = useState<string | null>(
        null,
    );
    const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(
        null,
    );
    const [appLogsOpen, setAppLogsOpen] = useState(false);

    // 选中项与详情抽屉状态
    const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
    const [selectedProxyId, setSelectedProxyId] = useState<string | null>(null);
    const [envDetailsOpen, setEnvDetailsOpen] = useState(false);
    const [proxyDetailsOpen, setProxyDetailsOpen] = useState(false);

    // 代理数据、核心信息、回收站计数、应用版本
    const [managedProxies, setManagedProxies] = useState<ManagedProxy[]>([]);
    const [proxiesLoading, setProxiesLoading] = useState(true);
    const [proxiesLoadError, setProxiesLoadError] = useState('');
    const [coreInfo, setCoreInfo] = useState<ProxyCoreInfo | null>(null);
    const [kernelStatus, setKernelStatus] = useState<KernelStatus | null>(null);
    const [trashCount, setTrashCount] = useState(0);
    const [appVersion, setAppVersion] = useState('1.4.0');
    const [proxyRefreshTick, setProxyRefreshTick] = useState(0);
    const proxiesSigRef = useRef('');
    const coreInfoSigRef = useRef('');
    const logSigRef = useRef('');

    // 每个页面分别保留日志面板开关与高度，不把代理页布局带入其他页面。
    const [logDockPreferences, setLogDockPreferences] = useState(
        loadLogDockPreferences,
    );
    const logOpen = logDockPreferences[activeSection].open;
    const logHeight = Math.min(
        logDockPreferences[activeSection].height,
        Math.max(120, Math.floor(windowHeight * 0.48)),
    );
    const [logScope, setLogScope] = useState<LogScope>('__selected__');
    const [logLevel, setLogLevel] = useState<LogLevelFilter>('all');
    const [logSnapshot, setLogSnapshot] = useState<{
        key: string;
        entries: ProxyLog[];
    }>({ key: '', entries: [] });
    const [logFailure, setLogFailure] = useState<{
        key: string;
        message: string;
    } | null>(null);
    const [logsPaused, setLogsPaused] = useState(false);
    const [followLatest, setFollowLatest] = useState(true);
    const [clearingLogs, setClearingLogs] = useState(false);
    const logRequestVersion = useRef(0);

    const updateLogDock = useCallback(
        (patch: Partial<LogDockPreference>) => {
            setLogDockPreferences((previous) => ({
                ...previous,
                [activeSection]: { ...previous[activeSection], ...patch },
            }));
        },
        [activeSection],
    );

    const [jumpToErrorTick, setJumpToErrorTick] = useState(0);

    const handleJumpToErrorLog = useCallback(() => {
        updateLogDock({ open: true });
        setLogLevel('error');
        setJumpToErrorTick((value) => value + 1);
    }, [updateLogDock]);

    useEffect(() => {
        saveLogDockPreferences(logDockPreferences);
    }, [logDockPreferences]);

    // 监听窗口宽度以适配窄窗口响应规则
    useEffect(() => {
        const handleResize = () => {
            setWindowWidth(window.innerWidth);
            setWindowHeight(window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        const observer = new ResizeObserver(([entry]) => {
            setContentWidth(entry.contentRect.width);
        });
        observer.observe(content);
        return () => observer.disconnect();
    }, []);

    // 仅挂载时读取一次应用版本
    useEffect(() => {
        let cancelled = false;
        window.electronAPI?.app
            ?.getInfo()
            .then((info) => {
                if (!cancelled && info?.version) setAppVersion(info.version);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, []);

    // 读取回收站计数与内核状态
    useEffect(() => {
        let cancelled = false;
        window.electronAPI?.trash
            ?.getDeletedEnvironments()
            .then((deleted) => {
                if (!cancelled) setTrashCount(deleted.length);
            })
            .catch(() => {});

        window.electronAPI?.kernels
            ?.getStatus()
            .then((status) => {
                if (!cancelled) setKernelStatus(status);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [state.environments.length, settings.dataPath]);

    // 响应式计算
    const navCollapsed = windowWidth < 880 || sidebarManualCollapsed;
    const narrowWindow = contentWidth < 760;
    const overlayDetails = contentWidth < 1120;
    const totalRunningEnvs = useMemo(
        () => state.environments.filter((env) => env.isRunning).length,
        [state.environments],
    );

    const handleQuickToggleTheme = useCallback(() => {
        const next = isDark ? 'light' : 'dark';
        void settingsActions.setThemeMode(next);
    }, [isDark, settingsActions]);

    const selectedEnv =
        state.environments.find(
            (env) =>
                env.id === selectedEnvId &&
                (state.currentGroup === '用户分组' ||
                    env.groupName === state.currentGroup),
        ) || null;
    const selectedProxy =
        managedProxies.find((proxy) => proxy.id === selectedProxyId) || null;

    const logTarget = useMemo(
        () =>
            resolveLogTarget({
                section: activeSection,
                scope: logScope,
                selectedEnvironment: selectedEnv,
                selectedProxyId,
                proxies: managedProxies,
                locale,
            }),
        [
            activeSection,
            logScope,
            selectedEnv,
            selectedProxyId,
            managedProxies,
            locale,
        ],
    );
    const logTargetId =
        logTarget.kind === 'proxy' ? logTarget.proxyId : logTarget.kind;
    const logContextKey = `${activeSection}:${logScope}:${logTargetId}`;
    // A scope switch hides the previous snapshot immediately, even while paused.
    const logs = useMemo(
        () => (logSnapshot.key === logContextKey ? logSnapshot.entries : []),
        [logSnapshot, logContextKey],
    );
    const logError =
        logFailure?.key === logContextKey ? logFailure.message : '';

    // 代理状态：主进程事件推送 + 10s 低频兜底 + 隐藏暂停 + 签名防无谓重渲染。
    useEffect(() => {
        if (!window.electronAPI?.proxies) {
            setProxiesLoading(false);
            return;
        }
        let cancelled = false;
        let pending = false;

        const poll = async (force = false) => {
            if (pending) return;
            if (!force && document.hidden) return;
            pending = true;
            try {
                const [nextProxies, nextCore] = await Promise.all([
                    window.electronAPI.proxies.list(),
                    window.electronAPI.proxies.getCoreInfo(),
                ]);
                if (!cancelled) {
                    const nextProxiesSig = JSON.stringify(nextProxies);
                    if (nextProxiesSig !== proxiesSigRef.current) {
                        proxiesSigRef.current = nextProxiesSig;
                        setManagedProxies(nextProxies);
                    }
                    const nextCoreSig = JSON.stringify(nextCore);
                    if (nextCoreSig !== coreInfoSigRef.current) {
                        coreInfoSigRef.current = nextCoreSig;
                        setCoreInfo(nextCore);
                    }
                    setProxiesLoadError((prev) => (prev ? '' : prev));
                }
            } catch {
                if (!cancelled) {
                    setProxiesLoadError(
                        t(
                            '暂时无法读取代理状态，请点击重试。',
                            'Unable to read proxy status right now. Click Retry.',
                        ),
                    );
                }
            } finally {
                pending = false;
                if (!cancelled) setProxiesLoading(false);
            }
        };

        const handleProxyStateEvent = (
            _event: unknown,
            payload?: unknown,
        ) => {
            const detail = payload as { state?: boolean } | undefined;
            if (!detail || detail.state !== false) {
                void poll(true);
            }
        };

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                void poll(true);
            }
        };

        void poll(true);
        const timer = window.setInterval(() => {
            void poll(false);
        }, 10000);
        window.electronAPI.on?.('proxy-state-changed', handleProxyStateEvent);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.electronAPI.removeListener?.(
                'proxy-state-changed',
                handleProxyStateEvent,
            );
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
    }, [proxyRefreshTick, t]);

    useEffect(() => {
        if (
            !window.electronAPI?.proxies ||
            logTarget.kind === 'none' ||
            logsPaused
        )
            return;
        let cancelled = false;
        let pending = false;
        const target = logTarget;
        const poll = async (force = false) => {
            if (pending) return;
            if (!force && document.hidden) return;
            pending = true;
            const requestVersion = logRequestVersion.current;
            try {
                const entries = await readTargetLogs(
                    target,
                    window.electronAPI.proxies.getLogs,
                );
                if (
                    !cancelled &&
                    requestVersion === logRequestVersion.current
                ) {
                    const firstId = entries[0]?.id || '';
                    const lastId = entries[entries.length - 1]?.id || '';
                    const nextSig = `${logContextKey}|${entries.length}|${firstId}|${lastId}`;
                    if (nextSig !== logSigRef.current) {
                        logSigRef.current = nextSig;
                        setLogSnapshot({ key: logContextKey, entries });
                    }
                    setLogFailure((prev) => (prev ? null : prev));
                }
            } catch {
                if (
                    !cancelled &&
                    requestVersion === logRequestVersion.current
                ) {
                    setLogFailure({
                        key: logContextKey,
                        message: t(
                            '无法读取日志，请点击刷新重试。',
                            'Failed to load logs. Click refresh to try again.',
                        ),
                    });
                }
            } finally {
                pending = false;
            }
        };

        const handleProxyLogEvent = () => {
            if (!document.hidden) {
                void poll(true);
            }
        };

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                void poll(true);
            }
        };

        void poll(true);
        const intervalMs = logOpen ? 3000 : 8000;
        const timer = window.setInterval(() => void poll(false), intervalMs);
        window.electronAPI.on?.('proxy-state-changed', handleProxyLogEvent);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.electronAPI.removeListener?.(
                'proxy-state-changed',
                handleProxyLogEvent,
            );
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
        // Identity and kind fully define an IPC log request; names and list
        // object identities can change on each background status poll.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logContextKey, logsPaused, logOpen, proxyRefreshTick]);

    // 分组及各分组数量统计
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

    const handleInspectProxyLogs = useCallback(
        (proxyId: string) => {
            setSelectedProxyId(proxyId);
            setLogScope(proxyId);
            setLogsPaused(false);
            updateLogDock({ open: true });
            setProxyRefreshTick((v) => v + 1);
        },
        [updateLogDock],
    );

    const handleClearLogs = useCallback(async () => {
        if (
            !window.electronAPI?.proxies ||
            clearingLogs ||
            logTarget.kind === 'none'
        )
            return;
        const clearingKey = logContextKey;
        logRequestVersion.current += 1;
        setClearingLogs(true);
        try {
            await clearTargetLogs(
                logTarget,
                window.electronAPI.proxies.clearLogs,
            );
            logSigRef.current = '';
            setLogSnapshot((snapshot) =>
                snapshot.key === clearingKey
                    ? { key: clearingKey, entries: [] }
                    : snapshot,
            );
        } catch {
            showNotification(
                'error',
                t('清空日志失败，请重试', 'Failed to clear logs. Please retry.'),
            );
        } finally {
            logRequestVersion.current += 1;
            setClearingLogs(false);
            setProxyRefreshTick((value) => value + 1);
        }
    }, [logTarget, logContextKey, clearingLogs, showNotification, t]);

    const kernelUpdateSummary = kernelStatus?.updateSummary;
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
            window.electronAPI?.trash
                ?.getDeletedEnvironments()
                .then((deleted) => setTrashCount(deleted.length))
                .catch(() => {});
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
        kernelStatus?.activeKernelId &&
            kernelStatus.installedKernels.some(
                (k) => k.id === kernelStatus.activeKernelId,
            ),
    );

    const [launchGuardState, setLaunchGuardState] = useState<{
        env: ChromeEnvironment;
        report: LaunchConsistencyReport;
    } | null>(null);
    const [launchHealthEnv, setLaunchHealthEnv] =
        useState<ChromeEnvironment | null>(null);

    const handleLaunchWithGuard = async (id: string) => {
        const env = state.environments.find((item) => item.id === id);
        if (env && settings.requireHealthCheckOnLaunch) {
            setLaunchHealthEnv(env);
            return;
        }
        if (
            env &&
            window.electronAPI?.chromeEnvironments?.checkLaunchConsistency
        ) {
            try {
                const report =
                    await window.electronAPI.chromeEnvironments.checkLaunchConsistency(
                        id,
                    );
                if (report && !report.ok && report.issues.length > 0) {
                    setLaunchGuardState({ env, report });
                    return;
                }
            } catch {
                // 护栏检查本身异常时不阻断正常启动
            }
        }
        await actions.launchEnvironment(id);
    };

    const handleConfirmHealthLaunch = async () => {
        if (!launchHealthEnv) return;
        const targetId = launchHealthEnv.id;
        setLaunchHealthEnv(null);
        await actions.launchEnvironment(targetId);
    };

    const handleAutoAlignAndLaunch = async () => {
        if (!launchGuardState) return;
        const { env, report } = launchGuardState;
        if (report.suggestedPatch) {
            await actions.updateEnvironment(env.id, report.suggestedPatch, {
                throwOnError: true,
            });
        }
        setLaunchGuardState(null);
        await actions.launchEnvironment(env.id);
    };

    const handleForceLaunch = async () => {
        if (!launchGuardState) return;
        const targetId = launchGuardState.env.id;
        setLaunchGuardState(null);
        await actions.launchEnvironment(targetId);
    };

    const handleSaveEnvironment = async (
        id: string,
        data: Partial<import('./types').ChromeEnvironment>,
    ) => {
        await actions.updateEnvironment(id, data, { throwOnError: true });
    };

    const selectionLabel = useMemo(() => {
        if (activeSection === 'environments') {
            if (selectedEnv) {
                return isEn
                    ? `Selected: ${selectedEnv.name} · ${selectedEnv.isRunning ? 'Running' : 'Stopped'}`
                    : `已选择: ${selectedEnv.name} · ${selectedEnv.isRunning ? '运行中' : '未运行'}`;
            }
            const running = filteredEnvironments.filter(
                (e) => e.isRunning,
            ).length;
            return isEn
                ? `${filteredEnvironments.length} environments · ${running} running`
                : `${filteredEnvironments.length} 个环境 · ${running} 个运行中`;
        }
        if (activeSection === 'proxies') {
            if (selectedProxy) {
                const status =
                    selectedProxy.status === 'running'
                        ? t('本地服务已启动', 'Local service running')
                        : selectedProxy.status === 'error'
                          ? t('启动异常', 'Start error')
                          : t('未启动', 'Stopped');
                return isEn
                    ? `Selected: ${selectedProxy.name} · ${status}`
                    : `已选择: ${selectedProxy.name} · ${status}`;
            }
            const running = managedProxies.filter(
                (p) => p.status === 'running',
            ).length;
            return isEn
                ? `${managedProxies.length} proxies · ${running} running`
                : `${managedProxies.length} 个代理 · ${running} 项服务已启动`;
        }
        if (activeSection === 'trash') {
            return isEn
                ? `Trash · ${trashCount} deleted`
                : `回收站 · ${trashCount} 个已删除环境`;
        }
        return t('系统设置', 'Settings');
    }, [
        activeSection,
        selectedEnv,
        selectedProxy,
        filteredEnvironments,
        managedProxies,
        trashCount,
        isEn,
        t,
    ]);

    const errorLogCount = useMemo(
        () => logs.filter((entry) => entry.level === 'error').length,
        [logs],
    );

    // 底部日志面板在“环境”和“代理”主工作区可停靠展示，在设置/回收站时也可随时从状态栏展开
    const showLogDock = logOpen;

    return (
        <div className={styles.shell}>
            <TitleBar
                themeMode={themeMode}
                isDark={isDark}
                onToggleTheme={handleQuickToggleTheme}
                runningCount={totalRunningEnvs}
                singboxReady={Boolean(coreInfo?.available)}
                onOpenSettings={() => setActiveSection('settings')}
            />

            <div className={styles.body}>
                <NavigationSidebar
                    activeSection={activeSection}
                    onSelectSection={(section) => setActiveSection(section)}
                    collapsed={navCollapsed}
                    canToggleCollapsed={windowWidth >= 880}
                    onToggleCollapsed={() =>
                        setSidebarManualCollapsed((prev) => !prev)
                    }
                    environmentCount={state.environments.length}
                    proxyCount={managedProxies.length}
                    trashCount={trashCount}
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

                <main ref={contentRef} className={styles.contentColumn}>
                    <div className={styles.workspaceHost}>
                        {activeSection === 'environments' && (
                            <EnvironmentsPage
                                environments={filteredEnvironments}
                                allEnvironments={state.environments}
                                allGroups={groupsForModal}
                                currentGroup={state.currentGroup}
                                managedProxies={managedProxies}
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
                                workspaceWidth={contentWidth}
                                overlayDetails={overlayDetails}
                                onCreateClick={() => setCreateModalOpen(true)}
                                onLaunch={handleLaunchWithGuard}
                                onClose={actions.closeEnvironment}
                                onClone={handleCloneEnvironment}
                                onDelete={actions.deleteEnvironment}
                                onRefresh={actions.refreshEnvironments}
                                onUpdateEnvironment={handleSaveEnvironment}
                                onRegenerateFingerprint={
                                    handleRegenerateFingerprint
                                }
                                hasFingerprintKernel={hasFingerprintKernel}
                                onInspectProxyLogs={handleInspectProxyLogs}
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
                                proxies={managedProxies}
                                environments={state.environments}
                                coreInfo={coreInfo}
                                loading={proxiesLoading}
                                loadError={proxiesLoadError}
                                selectedProxyId={selectedProxyId}
                                onSelectProxy={setSelectedProxyId}
                                detailsOpen={proxyDetailsOpen}
                                onToggleDetails={(open) =>
                                    setProxyDetailsOpen((prev) =>
                                        typeof open === 'boolean' ? open : !prev,
                                    )
                                }
                                narrowWindow={contentWidth < 920}
                                overlayDetails={overlayDetails}
                                onRefreshProxies={() =>
                                    setProxyRefreshTick((v) => v + 1)
                                }
                                onEnvironmentChanged={actions.refreshEnvironments}
                                onInspectLogs={handleInspectProxyLogs}
                            />
                        )}

                        {activeSection === 'trash' && (
                            <TrashPage
                                onEnvironmentRestored={actions.refreshEnvironments}
                                onCountChange={setTrashCount}
                                narrowWindow={narrowWindow}
                            />
                        )}

                        {activeSection === 'settings' && (
                            <SettingsPage
                                currentSettings={settings}
                                onSave={settingsActions.saveSettings}
                                onThemePreview={settingsActions.setThemeMode}
                                coreInfo={coreInfo}
                                appVersion={appVersion}
                                managedProxies={managedProxies}
                                groups={groupsForModal}
                                kernelStatus={kernelStatus}
                                onKernelStatusChange={(nextStatus) => {
                                    setKernelStatus(nextStatus);
                                    setProxyRefreshTick((v) => v + 1);
                                }}
                            />
                        )}
                    </div>

                    <LogDockPanel
                        open={showLogDock}
                        height={logHeight}
                        onHeightChange={(height) => updateLogDock({ height })}
                        onCollapse={() => updateLogDock({ open: false })}
                        proxies={managedProxies}
                        scopeLabel={logTarget.label}
                        emptyMessage={
                            logTarget.kind === 'none'
                                ? logTarget.emptyMessage
                                : undefined
                        }
                        hasTarget={logTarget.kind !== 'none'}
                        errorMessage={logError}
                        scope={logScope}
                        onScopeChange={(nextScope) => {
                            setLogScope(nextScope);
                            setProxyRefreshTick((v) => v + 1);
                        }}
                        level={logLevel}
                        onLevelChange={setLogLevel}
                        logs={logs}
                        paused={logsPaused}
                        onTogglePaused={() => setLogsPaused((prev) => !prev)}
                        followLatest={followLatest}
                        onToggleFollowLatest={() =>
                            setFollowLatest((prev) => !prev)
                        }
                        onRefresh={() => {
                            setLogsPaused(false);
                            setProxyRefreshTick((v) => v + 1);
                        }}
                        onClear={() => void handleClearLogs()}
                        busy={clearingLogs}
                        jumpToErrorTick={jumpToErrorTick}
                    />

                    <StatusBar
                        selectionLabel={selectionLabel}
                        logOpen={logOpen}
                        onToggleLog={() => updateLogDock({ open: !logOpen })}
                        onJumpToErrorLog={handleJumpToErrorLog}
                        onOpenAppLogs={() => setAppLogsOpen(true)}
                        errorLogCount={errorLogCount}
                        coreInfo={coreInfo}
                        appVersion={appVersion}
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
                managedProxies={managedProxies}
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
                env={launchGuardState?.env || null}
                report={launchGuardState?.report || null}
                onCancel={() => setLaunchGuardState(null)}
                onAutoAlignAndLaunch={handleAutoAlignAndLaunch}
                onForceLaunch={handleForceLaunch}
            />

            <EnvironmentHealthDialog
                env={launchHealthEnv}
                mode="launch"
                onClose={() => setLaunchHealthEnv(null)}
                onConfirmLaunch={handleConfirmHealthLaunch}
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
