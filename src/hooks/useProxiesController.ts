import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
    BatchImportProxiesResult,
    ChromeEnvironment,
    ManagedProxy,
    ProxyConfigView,
    ProxyEditorState,
    ProxyInput,
    RunStatus,
} from '../types';
import { environmentApi, proxyApi } from '../services';
import { useNotification } from '../contexts/NotificationContext';
import { tr, useI18n } from '../i18n';
import { createEmptyProxyEditor } from '../utils/proxyEditor';
import { useSavedTableValue, useTableSelection } from './useTableWorkspace';
import { useVirtualRows } from './useVirtualRows';

export type ProxySortKey = 'original' | 'name' | 'status';

function errorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              '',
          )
        : tr('操作失败，请稍后重试', 'Operation failed. Please try again.');
}

export interface UseProxiesControllerParams {
    proxies: ManagedProxy[];
    environments: ChromeEnvironment[];
    selectedProxyId: string | null;
    onSelectProxy: (id: string | null) => void;
    onToggleDetails: (open?: boolean) => void;
    onRefreshProxies: () => void;
    onEnvironmentChanged: () => Promise<void>;
}

export function useProxiesController({
    proxies,
    environments,
    selectedProxyId,
    onSelectProxy,
    onToggleDetails,
    onRefreshProxies,
    onEnvironmentChanged,
}: UseProxiesControllerParams) {
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<RunStatus>('all');
    const [contextMenu, setContextMenu] = useState<{
        proxy: ManagedProxy;
        x: number;
        y: number;
    } | null>(null);

    useEffect(() => {
        if (!contextMenu) return;
        const closeMenu = () => setContextMenu(null);
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setContextMenu(null);
        };
        window.addEventListener('click', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [contextMenu]);

    const [sortBy, setSortBy] = useSavedTableValue<ProxySortKey>(
        'multichrome.proxy.sortBy',
        'original',
        (value): value is ProxySortKey =>
            ['original', 'name', 'status'].includes(value as string),
    );
    const [nameWidth, setNameWidth] = useSavedTableValue(
        'multichrome.proxy.nameWidth',
        280,
        (value): value is number =>
            typeof value === 'number' && value >= 200 && value <= 480,
    );
    const [busy, setBusy] = useState('');
    const [refreshingExitIds, setRefreshingExitIds] = useState<Set<string>>(
        new Set(),
    );
    const exitRequests = useRef(new Set<string>());
    const [editor, setEditor] = useState<ProxyEditorState | null>(null);
    const [formError, setFormError] = useState('');
    const [configProxyId, setConfigProxyId] = useState<string | null>(null);
    const [configView, setConfigView] = useState<ProxyConfigView | null>(null);
    const [configLoading, setConfigLoading] = useState(false);
    const [configError, setConfigError] = useState('');
    const [assignProxy, setAssignProxy] = useState<ManagedProxy | null>(null);
    const [assignEnvironmentId, setAssignEnvironmentId] = useState('');
    const [deleteProxy, setDeleteProxy] = useState<ManagedProxy | null>(null);
    const [selectedProxyIds, setSelectedProxyIds] = useState<Set<string>>(
        new Set(),
    );
    const [batchImportOpen, setBatchImportOpen] = useState(false);
    const [batchText, setBatchText] = useState('');
    const [batchPrefix, setBatchPrefix] = useState(() => tr('代理', 'Proxy'));
    const [batchSkipDuplicates, setBatchSkipDuplicates] = useState(true);
    const [batchResult, setBatchResult] =
        useState<BatchImportProxiesResult | null>(null);
    const [batchChecking, setBatchChecking] = useState<{
        done: number;
        total: number;
    } | null>(null);

    const configRequestRef = useRef(0);

    const filtered = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        const byStatus =
            statusFilter === 'running'
                ? proxies.filter((proxy) => proxy.status === 'running')
                : statusFilter === 'stopped'
                  ? proxies.filter((proxy) => proxy.status !== 'running')
                  : proxies;
        const matched = !keyword
            ? byStatus
            : byStatus.filter((proxy) =>
                  [
                      proxy.name,
                      proxy.protocol,
                      proxy.host,
                      proxy.localAddress,
                      proxy.exitInfo?.ip,
                      proxy.exitInfo?.country,
                      proxy.exitInfo?.city,
                  ]
                      .filter(Boolean)
                      .some((field) => field!.toLowerCase().includes(keyword)),
              );
        if (sortBy === 'original') return matched;
        return [...matched].sort((a, b) => {
            if (sortBy === 'status') {
                const order = { running: 0, error: 1, stopped: 2 };
                const difference = order[a.status] - order[b.status];
                if (difference) return difference;
            }
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }, [proxies, search, statusFilter, sortBy]);

    const {
        containerRef: tableWrapRef,
        visibleItems: visibleProxies,
        startIndex,
        topSpacerHeight,
        bottomSpacerHeight,
        isVirtualized,
        scrollToIndex,
    } = useVirtualRows(filtered, {
        rowHeight: 50,
        overscan: 8,
        threshold: 80,
    });
    const { selected: selectedProxy, rowProps } = useTableSelection(
        filtered,
        selectedProxyId,
        onSelectProxy,
        () => onToggleDetails(true),
        scrollToIndex,
    );


    const runningCount = useMemo(
        () => proxies.filter((proxy) => proxy.status === 'running').length,
        [proxies],
    );

    const envBindingsByProxy = useMemo(() => {
        const map = new Map<string, ChromeEnvironment[]>();
        environments.forEach((env) => {
            if (!env.proxyId) return;
            const list = map.get(env.proxyId) || [];
            list.push(env);
            map.set(env.proxyId, list);
        });
        return map;
    }, [environments]);

    const runAction = async (key: string, action: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(key);
        try {
            await action();
            onRefreshProxies();
        } catch (error) {
            showNotification('error', errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const handleToggleService = (proxy: ManagedProxy) => {
        const running = proxy.status === 'running';
        void runAction(proxy.id, () =>
            running ? proxyApi.stop(proxy.id) : proxyApi.start(proxy.id),
        );
    };

    const refreshExitInfo = async (proxy: ManagedProxy) => {
        if (
            proxy.status !== 'running' ||
            proxy.exitInfo?.status === 'checking' ||
            exitRequests.current.has(proxy.id)
        ) {
            return;
        }
        exitRequests.current.add(proxy.id);
        setRefreshingExitIds(new Set(exitRequests.current));
        try {
            await proxyApi.refreshExitInfo(proxy.id);
        } catch (error) {
            showNotification('error', errorMessage(error));
        } finally {
            exitRequests.current.delete(proxy.id);
            setRefreshingExitIds(new Set(exitRequests.current));
            onRefreshProxies();
        }
    };

    const handleBatchImport = async () => {
        if (!batchText.trim() || busy) return;
        setBusy('batch-import');
        setBatchResult(null);
        try {
            const result = await proxyApi.batchImport({
                text: batchText,
                namePrefix: batchPrefix.trim() || t('代理', 'Proxy'),
                skipDuplicates: batchSkipDuplicates,
            });
            setBatchResult(result);
            onRefreshProxies();
            if (result.imported.length > 0 && result.errors.length === 0) {
                showNotification(
                    'success',
                    isEn
                        ? `Imported ${result.imported.length} proxy(ies)${
                              result.skippedDuplicates.length > 0
                                  ? ` (${result.skippedDuplicates.length} duplicate(s) skipped)`
                                  : ''
                          }`
                        : `成功导入 ${result.imported.length} 个代理${
                              result.skippedDuplicates.length > 0
                                  ? `（已跳过 ${result.skippedDuplicates.length} 个重复项）`
                                  : ''
                          }`,
                );
                if (result.skippedDuplicates.length === 0) {
                    setBatchImportOpen(false);
                    setBatchText('');
                }
            } else if (result.imported.length > 0) {
                showNotification(
                    'warning',
                    isEn
                        ? `Imported ${result.imported.length} proxy(ies), ${result.errors.length} line(s) failed`
                        : `导入 ${result.imported.length} 个代理，${result.errors.length} 行失败`,
                );
            } else if (
                result.skippedDuplicates.length > 0 &&
                result.errors.length === 0
            ) {
                showNotification(
                    'info',
                    isEn
                        ? `All ${result.skippedDuplicates.length} proxy(ies) already exist; none imported`
                        : `全部 ${result.skippedDuplicates.length} 条代理已存在，未重复导入`,
                );
            } else {
                showNotification(
                    'error',
                    t(
                        '未导入任何有效代理，请检查格式',
                        'No valid proxies imported. Please check the format.',
                    ),
                );
            }
        } catch (error) {
            showNotification('error', errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const handleBatchCheckAll = async () => {
        if (busy || batchChecking || filtered.length === 0) return;
        const targets = [...filtered];
        setBatchChecking({ done: 0, total: targets.length });
        let okCount = 0;
        let failCount = 0;
        let done = 0;
        const concurrency = 3;
        let cursor = 0;

        const worker = async () => {
            while (cursor < targets.length) {
                const target = targets[cursor++];
                try {
                    if (target.status !== 'running') {
                        await proxyApi.start(target.id);
                    }
                    const exit = await proxyApi.refreshExitInfo(target.id);
                    if (exit?.status === 'ready') okCount += 1;
                    else failCount += 1;
                } catch {
                    failCount += 1;
                } finally {
                    done += 1;
                    setBatchChecking({ done, total: targets.length });
                    onRefreshProxies();
                }
            }
        };

        try {
            await Promise.all(
                Array.from(
                    { length: Math.min(concurrency, targets.length) },
                    () => worker(),
                ),
            );
            showNotification(
                failCount === 0 ? 'success' : 'warning',
                isEn
                    ? `Batch health check done: ${okCount} healthy${failCount > 0 ? `, ${failCount} failed` : ''}`
                    : `批量测活完成：${okCount} 个可用${failCount > 0 ? `，${failCount} 个检测失败` : ''}`,
            );
        } finally {
            setBatchChecking(null);
            onRefreshProxies();
        }
    };

    const openEditor = async (proxy?: ManagedProxy) => {
        if (busy) return;
        setFormError('');
        if (!proxy) {
            setEditor(createEmptyProxyEditor());
            return;
        }
        setBusy(`edit:${proxy.id}`);
        try {
            const details = await proxyApi.getEditor(proxy.id);
            setEditor({
                ...createEmptyProxyEditor(),
                id: proxy.id,
                name: proxy.name,
                mode: details.mode,
                protocol:
                    proxy.protocol === 'https' || proxy.protocol === 'socks5'
                        ? proxy.protocol
                        : 'http',
                host: proxy.host,
                port: proxy.port ? String(proxy.port) : '',
                username: proxy.username,
                hasPassword: details.mode === 'simple' && proxy.hasPassword,
                config: details.config || '',
                rotationUrl: details.rotationUrl || '',
            });
        } catch (error) {
            showNotification('error', errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const switchEditorMode = async (mode: ProxyEditorState['mode']) => {
        if (!editor || busy || editor.mode === mode) return;
        setFormError('');
        const next: ProxyEditorState = {
            ...createEmptyProxyEditor(),
            id: editor.id,
            name: editor.name,
            rotationUrl: editor.rotationUrl,
            mode,
        };
        if (mode !== 'json' || !editor.id) {
            setEditor(next);
            return;
        }
        setBusy('convert');
        try {
            const details = await proxyApi.getEditor(editor.id, true);
            setEditor({
                ...next,
                config: details.config || '',
                rotationUrl: details.rotationUrl || editor.rotationUrl,
            });
        } catch (error) {
            setFormError(errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const saveProxy = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!editor || busy) return;
        setFormError('');
        setBusy('save');

        let input: ProxyInput;
        const identity = {
            id: editor.id,
            name: editor.name.trim(),
            rotationUrl: editor.rotationUrl.trim(),
        };
        if (editor.mode === 'line') {
            input = { ...identity, mode: 'line', line: editor.line.trim() };
        } else if (editor.mode === 'json') {
            input = { ...identity, mode: 'json', config: editor.config };
        } else {
            input = {
                ...identity,
                mode: 'simple',
                protocol: editor.protocol,
                host: editor.host.trim(),
                port: Number(editor.port),
                username: editor.clearCredentials ? '' : editor.username,
            };
            if (editor.clearCredentials) {
                input.password = '';
            } else if (!editor.hasPassword || editor.password) {
                input.password = editor.password;
            }
        }

        try {
            const saved = await proxyApi.save(input);
            setEditor(null);
            onSelectProxy(saved.id);
            onRefreshProxies();
            showNotification(
                'success',
                t(
                    'sing-box 校验通过，代理配置已保存',
                    'Validated with sing-box and saved proxy config',
                ),
            );
        } catch (error) {
            setFormError(errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const loadConfig = async (id: string, reveal = false) => {
        const reqId = ++configRequestRef.current;
        setConfigProxyId(id);
        setConfigView(null);
        setConfigError('');
        setConfigLoading(true);
        try {
            const view = await proxyApi.getConfig(id, reveal);
            if (reqId === configRequestRef.current) {
                setConfigView(view);
            }
        } catch (error) {
            if (reqId === configRequestRef.current) {
                setConfigError(errorMessage(error));
            }
        } finally {
            if (reqId === configRequestRef.current) {
                setConfigLoading(false);
            }
        }
    };

    const closeConfig = () => {
        configRequestRef.current += 1;
        setConfigProxyId(null);
        setConfigView(null);
        setConfigError('');
        setConfigLoading(false);
    };

    const copyConfig = async () => {
        if (!configView) return;
        try {
            await navigator.clipboard.writeText(configView.json);
            showNotification(
                'success',
                configView.redacted
                    ? t('已复制脱敏配置', 'Copied redacted config')
                    : t(
                          '已复制完整配置（包含认证信息）',
                          'Copied full config (including credentials)',
                      ),
            );
        } catch {
            showNotification(
                'error',
                t(
                    '无法访问剪贴板，请手动选中复制',
                    'Clipboard unavailable. Please select and copy manually.',
                ),
            );
        }
    };

    const openContextMenu = (event: React.MouseEvent, proxy: ManagedProxy) => {
        event.preventDefault();
        onSelectProxy(proxy.id);
        const menuWidth = 184;
        const menuHeight = 270;
        const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
        const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
        setContextMenu({
            proxy,
            x: Math.max(8, x),
            y: Math.max(8, y),
        });
    };

    const startAssignProxy = (proxy: ManagedProxy) => {
        setAssignProxy(proxy);
        setAssignEnvironmentId('');
    };

    const confirmAssignProxy = () => {
        if (!assignProxy || !assignEnvironmentId) return;
        const proxyId = assignProxy.id;
        void runAction('assign', async () => {
            await environmentApi.update(assignEnvironmentId, { proxyId });
            await onEnvironmentChanged();
            setAssignProxy(null);
            showNotification(
                'success',
                t(
                    '已分配代理，下次启动此环境时自动启用',
                    'Proxy assigned — takes effect on next launch',
                ),
            );
        });
    };

    const confirmDeleteProxy = () => {
        if (!deleteProxy) return;
        const targetId = deleteProxy.id;
        void runAction('delete', async () => {
            await proxyApi.remove(targetId);
            if (selectedProxyId === targetId) {
                onSelectProxy(null);
            }
            setDeleteProxy(null);
            showNotification('success', t('代理已删除', 'Proxy deleted'));
        });
    };

    const activeSelectedProxyIds = useMemo(() => {
        const existing = new Set(proxies.map((p) => p.id));
        return Array.from(selectedProxyIds).filter((id) => existing.has(id));
    }, [selectedProxyIds, proxies]);

    const toggleSelectProxyId = (id: string) => {
        setSelectedProxyIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllFilteredProxies = () => {
        const filteredIds = filtered.map((p) => p.id);
        const allChecked =
            filteredIds.length > 0 &&
            filteredIds.every((id) => selectedProxyIds.has(id));
        setSelectedProxyIds((prev) => {
            const next = new Set(prev);
            filteredIds.forEach((id) => {
                if (allChecked) next.delete(id);
                else next.add(id);
            });
            return next;
        });
    };

    const clearSelectedProxyIds = () => setSelectedProxyIds(new Set());

    const handleBatchRemoveSelected = (ids: string[]) => {
        if (ids.length === 0) return;
        void runAction('batch-remove', async () => {
            const res = await proxyApi.batchRemove(ids);
            const remaining = new Set(res.remainingIds || []);
            setSelectedProxyIds(remaining);
            if (selectedProxyId && ids.includes(selectedProxyId) && !remaining.has(selectedProxyId)) {
                onSelectProxy(null);
            }
            const counts = [isEn ? `Removed ${res.removedCount}` : `已删除 ${res.removedCount} 个代理`];
            if (res.skippedInUseCount) {
                counts.push(isEn ? `${res.skippedInUseCount} active or bound` : `${res.skippedInUseCount} 个正在运行或已绑定`);
            }
            if (res.failedCount) {
                counts.push(isEn ? `${res.failedCount} failed` : `${res.failedCount} 个删除失败`);
            }
            const severity = remaining.size ? (res.removedCount ? 'warning' : 'error') : 'success';
            showNotification(severity, counts.join(isEn ? ', ' : '，'));
        });
    };

    const handleRotateProxyIp = (proxy: ManagedProxy) => {
        void runAction(`rotate:${proxy.id}`, async () => {
            await proxyApi.rotateIp(proxy.id);
            showNotification(
                'success',
                isEn
                    ? `Triggered IP rotation for "${proxy.name}"`
                    : `已触发「${proxy.name}」更换出口 IP`,
            );
        });
    };

    return {
        search,
        setSearch,
        statusFilter,
        setStatusFilter,
        sortBy,
        setSortBy,
        nameWidth,
        setNameWidth,
        busy,
        refreshingExitIds,
        filtered,
        selectedProxy,
        rowProps,
        tableWrapRef,
        visibleProxies,
        startIndex,
        topSpacerHeight,
        bottomSpacerHeight,
        isVirtualized,
        runningCount,
        envBindingsByProxy,
        handleToggleService,
        refreshExitInfo,
        handleRotateProxyIp,
        selectedProxyIds,
        activeSelectedProxyIds,
        toggleSelectProxyId,
        toggleSelectAllFilteredProxies,
        clearSelectedProxyIds,
        handleBatchRemoveSelected,
        editor,
        setEditor,
        formError,
        openEditor,
        switchEditorMode,
        saveProxy,
        configProxyId,
        configView,
        configLoading,
        configError,
        loadConfig,
        closeConfig,
        copyConfig,
        batchImportOpen,
        setBatchImportOpen,
        batchText,
        setBatchText,
        batchPrefix,
        setBatchPrefix,
        batchSkipDuplicates,
        setBatchSkipDuplicates,
        batchResult,
        setBatchResult,
        handleBatchImport,
        batchChecking,
        handleBatchCheckAll,
        assignProxy,
        setAssignProxy,
        assignEnvironmentId,
        setAssignEnvironmentId,
        startAssignProxy,
        confirmAssignProxy,
        deleteProxy,
        setDeleteProxy,
        confirmDeleteProxy,
        contextMenu,
        setContextMenu,
        openContextMenu,
    };
}
