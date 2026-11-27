import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    AppSettings,
    ChromeEnvironment,
    KernelStatus,
    LaunchGuardEntry,
    ManagedProxy,
    ProxyCoreInfo,
    ProxyLog,
} from '../types';
import { useI18n } from '../i18n';
import { canLaunchProfile, checkProfile } from '../utils/launchPrecheck';
import { useNotification } from '../contexts/NotificationContext';
import {
    environmentApi,
    kernelApi,
    proxyApi,
    systemApi,
    trashApi,
} from '../services';
import {
    clearTargetLogs,
    loadLogDockPreferences,
    readTargetLogs,
    resolveLogTarget,
    saveLogDockPreferences,
    type LogDockPreference,
    type LogLevelFilter,
    type LogScope,
    type WorkspaceSection,
} from '../utils/logWorkspace';

export interface UseAppShellLifecycleOptions {
    activeSection: WorkspaceSection;
    environments: ChromeEnvironment[];
    currentGroup: string;
    selectedEnvId: string | null;
    selectedProxyId: string | null;
    onSelectProxyId: (id: string | null) => void;
    settings: AppSettings;
    launchEnvironment: (id: string) => Promise<boolean>;
    updateEnvironment: (
        id: string,
        data: Partial<ChromeEnvironment>,
        options?: { throwOnError?: boolean },
    ) => Promise<ChromeEnvironment | undefined>;
}

/**
 * Layer 2 Application Shell Lifecycle Hook.
 *
 * Manages window viewport metrics, app metadata, kernel & trash status,
 * managed proxy live state + 10s fallback polling, log dock streaming,
 * and pre-launch consistency / health guard workflows via `src/services/*`.
 */
export function useAppShellLifecycle({
    activeSection,
    environments,
    currentGroup,
    selectedEnvId,
    selectedProxyId,
    onSelectProxyId,
    settings,
    launchEnvironment,
    updateEnvironment,
}: UseAppShellLifecycleOptions) {
    const { showNotification } = useNotification();
    const { locale, t } = useI18n();

    const [windowWidth, setWindowWidth] = useState<number>(
        () => window.innerWidth,
    );
    const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
    const contentRef = useRef<HTMLElement>(null);
    const [contentWidth, setContentWidth] = useState(
        () => window.innerWidth - 192,
    );

    const [managedProxies, setManagedProxies] = useState<ManagedProxy[]>([]);
    const [proxiesLoading, setProxiesLoading] = useState(true);
    const [proxiesLoadError, setProxiesLoadError] = useState('');
    const [coreInfo, setCoreInfo] = useState<ProxyCoreInfo | null>(null);
    const [kernelStatus, setKernelStatus] = useState<KernelStatus | null>(null);
    const [trashCount, setTrashCount] = useState(0);
    const [appVersion, setAppVersion] = useState('1.7.1');
    const [proxyRefreshTick, setProxyRefreshTick] = useState(0);

    const proxiesSigRef = useRef('');
    const coreInfoSigRef = useRef('');
    const logSigRef = useRef('');

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
    const [jumpToErrorTick, setJumpToErrorTick] = useState(0);

    const updateLogDock = useCallback(
        (patch: Partial<LogDockPreference>) => {
            setLogDockPreferences((previous) => ({
                ...previous,
                [activeSection]: { ...previous[activeSection], ...patch },
            }));
        },
        [activeSection],
    );

    const handleJumpToErrorLog = useCallback(() => {
        updateLogDock({ open: true });
        setLogLevel('error');
        setJumpToErrorTick((value) => value + 1);
    }, [updateLogDock]);

    useEffect(() => {
        saveLogDockPreferences(logDockPreferences);
    }, [logDockPreferences]);

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

    useEffect(() => {
        let cancelled = false;
        systemApi
            .getAppInfo()
            .then((info) => {
                if (!cancelled && info?.version) setAppVersion(info.version);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const refreshTrashCount = useCallback(() => {
        trashApi
            .getDeletedEnvironments()
            .then((deleted) => setTrashCount(deleted.length))
            .catch(() => {});
    }, []);

    useEffect(() => {
        let cancelled = false;
        trashApi
            .getDeletedEnvironments()
            .then((deleted) => {
                if (!cancelled) setTrashCount(deleted.length);
            })
            .catch(() => {});

        kernelApi
            .getStatus()
            .then((status) => {
                if (!cancelled && status) setKernelStatus(status);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [environments.length, settings.dataPath]);

    const selectedEnv =
        environments.find(
            (env) =>
                env.id === selectedEnvId &&
                (currentGroup === '用户分组' || env.groupName === currentGroup),
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
    const logs = useMemo(
        () => (logSnapshot.key === logContextKey ? logSnapshot.entries : []),
        [logSnapshot, logContextKey],
    );
    const logError =
        logFailure?.key === logContextKey ? logFailure.message : '';

    useEffect(() => {
        if (!proxyApi.isAvailable()) {
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
                    proxyApi.list(),
                    proxyApi.getCoreInfo(),
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

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                void poll(true);
            }
        };

        void poll(true);
        const timer = window.setInterval(() => {
            void poll(false);
        }, 10000);
        const unsubscribe = proxyApi.onStateChanged((detail) => {
            if (!detail || detail.state !== false) {
                void poll(true);
            }
        });
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            unsubscribe();
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
    }, [proxyRefreshTick, t]);

    useEffect(() => {
        if (
            !proxyApi.isAvailable() ||
            logTarget.kind === 'none' ||
            logsPaused
        ) {
            return;
        }
        let cancelled = false;
        let pending = false;
        const target = logTarget;
        const poll = async (force = false) => {
            if (pending) return;
            if (!force && document.hidden) return;
            pending = true;
            const requestVersion = logRequestVersion.current;
            try {
                const entries = await readTargetLogs(target, proxyApi.getLogs);
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

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                void poll(true);
            }
        };

        void poll(true);
        const intervalMs = logOpen ? 3000 : 8000;
        const timer = window.setInterval(() => void poll(false), intervalMs);
        const unsubscribe = proxyApi.onStateChanged(() => {
            if (!document.hidden) {
                void poll(true);
            }
        });
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            unsubscribe();
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logContextKey, logsPaused, logOpen, proxyRefreshTick]);

    const triggerProxyRefresh = useCallback(() => {
        setProxyRefreshTick((v) => v + 1);
    }, []);

    const handleInspectProxyLogs = useCallback(
        (proxyId: string) => {
            onSelectProxyId(proxyId);
            setLogScope(proxyId);
            setLogsPaused(false);
            updateLogDock({ open: true });
            setProxyRefreshTick((v) => v + 1);
        },
        [onSelectProxyId, updateLogDock],
    );

    const handleClearLogs = useCallback(async () => {
        if (
            !proxyApi.isAvailable() ||
            clearingLogs ||
            logTarget.kind === 'none'
        ) {
            return;
        }
        const clearingKey = logContextKey;
        logRequestVersion.current += 1;
        setClearingLogs(true);
        try {
            await clearTargetLogs(logTarget, proxyApi.clearLogs);
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

    const [launchGuardQueue, setLaunchGuardQueue] = useState<LaunchGuardEntry[]>([]);
    const [launchHealthQueue, setLaunchHealthQueue] = useState<
        ChromeEnvironment[]
    >([]);

    const launchGuardState = launchGuardQueue[0] || null;
    const launchHealthEnv = launchHealthQueue[0] || null;

    const launchWithConcurrency = useCallback(
        async (ids: string[], concurrency = 4): Promise<number> => {
            if (ids.length === 0) return 0;
            let cursor = 0;
            let launchedCount = 0;
            const workers = Array.from(
                { length: Math.min(concurrency, ids.length) },
                async () => {
                    while (cursor < ids.length) {
                        const targetId = ids[cursor];
                        cursor += 1;
                        try {
                            if (await launchEnvironment(targetId)) {
                                launchedCount += 1;
                            }
                        } catch {
                            // individual launch error already surfaced via context
                        }
                    }
                },
            );
            await Promise.all(workers);

            const previouslyRunning = environments.filter(
                (item) => item.isRunning && !ids.includes(item.id),
            ).length;
            if (
                launchedCount > 0 &&
                (ids.length >= 2 || previouslyRunning + launchedCount >= 2) &&
                environmentApi.isAvailable()
            ) {
                await environmentApi.tileWindows().catch(() => {});
                window.setTimeout(() => {
                    void environmentApi.tileWindows().catch(() => {});
                }, 900);
            }
            return launchedCount;
        },
        [environments, launchEnvironment],
    );

    const checkConsistency = useCallback(
        (env: ChromeEnvironment) => checkProfile(env, environmentApi.checkLaunchConsistency, t),
        [t],
    );

    const retryIncompleteChecks = async () => {
        const incomplete = launchGuardQueue.filter((item) => item.incomplete);
        const retries = await Promise.all(incomplete.map(async (item) =>
            [item, await checkConsistency(item.env)] as const,
        ));
        const results = new Map(retries);
        setLaunchGuardQueue((current) => current.map((item) => results.get(item) || item));
    };

    const handleLaunchWithGuard = useCallback(
        async (id: string): Promise<boolean> => {
            const env = environments.find((item) => item.id === id);
            if (env && settings.requireHealthCheckOnLaunch) {
                setLaunchHealthQueue((prev) =>
                    prev.some((item) => item.id === env.id)
                        ? prev
                        : [...prev, env],
                );
                return false;
            }
            if (env) {
                const entry = await checkConsistency(env);
                if (!entry.report.ok) {
                    setLaunchGuardQueue((prev) =>
                        prev.some((item) => item.env.id === id) ? prev : [...prev, entry],
                    );
                    return false;
                }
            }
            return launchEnvironment(id);
        },
        [environments, launchEnvironment, settings.requireHealthCheckOnLaunch, checkConsistency],
    );

    const handleBatchLaunchWithGuard = useCallback(
        async (
            ids: string[],
        ): Promise<{
            launchedCount: number;
            deferredCount: number;
            failedCount: number;
        }> => {
            const targets = ids
                .map((id) => environments.find((item) => item.id === id))
                .filter((env): env is ChromeEnvironment =>
                    Boolean(env && !env.isRunning),
                );
            if (targets.length === 0) {
                return { launchedCount: 0, deferredCount: 0, failedCount: 0 };
            }

            if (settings.requireHealthCheckOnLaunch) {
                setLaunchHealthQueue(targets);
                return {
                    launchedCount: 0,
                    deferredCount: targets.length,
                    failedCount: 0,
                };
            }

            const checks = await Promise.all(targets.map(checkConsistency));
            if (checks.some((item) => !item.report.ok)) {
                setLaunchGuardQueue(checks);
                return {
                    launchedCount: 0,
                    deferredCount: checks.length,
                    failedCount: 0,
                };
            }

            const cleanIds = targets.map((item) => item.id);
            const launchedCount = await launchWithConcurrency(cleanIds);
            return {
                launchedCount,
                deferredCount: 0,
                failedCount: Math.max(0, cleanIds.length - launchedCount),
            };
        },
        [
            environments,
            launchWithConcurrency,
            settings.requireHealthCheckOnLaunch,
            checkConsistency,
        ],
    );

    const handleConfirmHealthLaunch = useCallback(async () => {
        const current = launchHealthQueue[0];
        if (!current) return;
        setLaunchHealthQueue([]);
        await launchEnvironment(current.id);
    }, [launchEnvironment, launchHealthQueue]);

    const handleConfirmHealthLaunchAll = useCallback(async () => {
        const queuedIds = launchHealthQueue.map((item) => item.id);
        if (queuedIds.length === 0) return;
        setLaunchHealthQueue([]);
        const launchedCount = await launchWithConcurrency(queuedIds);
        if (launchedCount > 0) {
            showNotification(
                'success',
                locale === 'en-US'
                    ? `Launched ${launchedCount} environment(s)`
                    : `已启动 ${launchedCount} 个环境`,
            );
        }
    }, [launchHealthQueue, launchWithConcurrency, locale, showNotification]);

    const handleDismissHealthLaunch = useCallback(() => {
        setLaunchHealthQueue([]);
    }, []);

    const handleAutoAlignAndLaunch = useCallback(async () => {
        const queue = [...launchGuardQueue];
        if (queue.length === 0) return;
        await Promise.all(
            queue.map(async ({ env, report }) => {
                if (!report.hasError && report.canAutoAlign && report.suggestedPatch) {
                    await updateEnvironment(env.id, report.suggestedPatch, {
                        throwOnError: true,
                    });
                }
            }),
        );
        const launchableIds = queue
            .filter(canLaunchProfile)
            .map(({ env }) => env.id);
        setLaunchGuardQueue([]);
        const launchedCount = await launchWithConcurrency(launchableIds);
        if (queue.length > 1 && launchedCount > 0) {
            showNotification(
                'success',
                locale === 'en-US'
                    ? `Launched ${launchedCount} environment(s)`
                    : `已启动 ${launchedCount} 个环境`,
            );
        }
    }, [
        launchGuardQueue,
        launchWithConcurrency,
        locale,
        showNotification,
        updateEnvironment,
    ]);

    const handleForceLaunch = useCallback(async () => {
        const queue = [...launchGuardQueue];
        if (queue.length === 0) return;
        const launchableIds = queue
            .filter(canLaunchProfile)
            .map(({ env }) => env.id);
        setLaunchGuardQueue([]);
        const launchedCount = await launchWithConcurrency(launchableIds);
        if (queue.length > 1 && launchedCount > 0) {
            showNotification(
                'success',
                locale === 'en-US'
                    ? `Launched ${launchedCount} environment(s)`
                    : `已启动 ${launchedCount} 个环境`,
            );
        }
    }, [launchGuardQueue, launchWithConcurrency, locale, showNotification]);

    const handleCancelLaunchGuard = useCallback(() => {
        setLaunchGuardQueue([]);
    }, []);

    return {
        windowWidth,
        contentRef,
        contentWidth,
        managedProxies,
        proxiesLoading,
        proxiesLoadError,
        coreInfo,
        kernelStatus,
        setKernelStatus,
        trashCount,
        setTrashCount,
        refreshTrashCount,
        appVersion,
        triggerProxyRefresh,
        selectedEnv,
        selectedProxy,
        logOpen,
        logHeight,
        logScope,
        setLogScope,
        logLevel,
        setLogLevel,
        logs,
        logTarget,
        logError,
        logsPaused,
        setLogsPaused,
        followLatest,
        setFollowLatest,
        clearingLogs,
        jumpToErrorTick,
        updateLogDock,
        handleJumpToErrorLog,
        handleInspectProxyLogs,
        handleClearLogs,
        launchGuardState,
        launchGuardQueue,
        retryIncompleteChecks,
        launchGuardQueueCount: launchGuardQueue.length,
        handleCancelLaunchGuard,
        launchHealthEnv,
        launchHealthQueue,
        launchHealthQueueCount: launchHealthQueue.length,
        handleDismissHealthLaunch,
        handleLaunchWithGuard,
        handleBatchLaunchWithGuard,
        handleConfirmHealthLaunch,
        handleConfirmHealthLaunchAll,
        handleAutoAlignAndLaunch,
        handleForceLaunch,
    };
}
