import React, { useEffect, useMemo, useState } from 'react';
import type {
    ChromeEnvironment,
    ManagedProxy,
    OptionalEnvColumn,
    RunStatus,
    RunningResourceStats,
    WindowArrangeMode,
} from '../types';
import { environmentApi } from '../services';
import { useNotification } from '../contexts/NotificationContext';
import { useI18n } from '../i18n';
import {
    type TagFilterMode,
    collectTagStats,
    matchesTagFilter,
    normalizeEnvironmentTags,
} from '../utils/environmentTags';
import { useSavedTableValue, useTableSelection } from './useTableWorkspace';
import { useVirtualRows } from './useVirtualRows';

export const OPTIONAL_COLUMNS: {
    key: OptionalEnvColumn;
    zh: string;
    en: string;
}[] = [
    { key: 'timezone', zh: '时区', en: 'Timezone' },
    { key: 'language', zh: '语言', en: 'Language' },
    { key: 'notes', zh: '备注', en: 'Notes' },
    { key: 'createdAt', zh: '创建时间', en: 'Created At' },
    { key: 'id', zh: 'ID', en: 'ID' },
];

const COLUMNS_STORAGE_KEY = 'multichrome.env.optionalColumns';

export function formatMemoryBytes(bytes?: number): string {
    if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${Math.round(mb)} MB`;
}

function loadSavedOptionalColumns(): OptionalEnvColumn[] {
    try {
        const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is OptionalEnvColumn =>
                OPTIONAL_COLUMNS.some((col) => col.key === item),
            );
        }
    } catch {
        // Ignore storage read failures
    }
    return [];
}

export type EnvSortKey = 'lastUsed' | 'createdAt' | 'name';
export type EnvSortOrder = 'asc' | 'desc';

export interface EnvContextMenuState {
    env: ChromeEnvironment;
    x: number;
    y: number;
}

export interface UseEnvironmentsWorkspaceParams {
    environments: ChromeEnvironment[];
    allEnvironments?: ChromeEnvironment[];
    managedProxies: ManagedProxy[];
    selectedEnvId: string | null;
    onSelectEnv: (id: string | null) => void;
    onToggleDetails: (open?: boolean) => void;
    onLaunch: (id: string) => Promise<boolean>;
    onBatchLaunch?: (
        ids: string[],
    ) => Promise<{
        launchedCount: number;
        deferredCount: number;
        failedCount: number;
    }>;
    onClose: (id: string) => Promise<boolean>;
    onRefresh: () => Promise<void>;
}

export function useEnvironmentsWorkspace({
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
}: UseEnvironmentsWorkspaceParams) {
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<RunStatus>('all');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagFilterMode, setTagFilterMode] = useState<TagFilterMode>('all');
    const [resourceStats, setResourceStats] =
        useState<RunningResourceStats | null>(null);
    const [closeAllConfirmOpen, setCloseAllConfirmOpen] = useState(false);
    const [closingAll, setClosingAll] = useState(false);
    const [consoleDocked, setConsoleDocked] = useState(false);
    const [contextMenu, setContextMenu] =
        useState<EnvContextMenuState | null>(null);


    const [sortBy, setSortBy] = useSavedTableValue<EnvSortKey>(
        'multichrome.env.sortBy',
        'lastUsed',
        (value): value is EnvSortKey =>
            ['lastUsed', 'createdAt', 'name'].includes(value as string),
    );
    const [sortOrder, setSortOrder] = useSavedTableValue<EnvSortOrder>(
        'multichrome.env.sortOrder',
        'desc',
        (value): value is EnvSortOrder => value === 'asc' || value === 'desc',
    );
    const [nameWidth, setNameWidth] = useSavedTableValue(
        'multichrome.env.nameWidth',
        196,
        (value): value is number =>
            typeof value === 'number' && value >= 160 && value <= 480,
    );
    const [groupWidth, setGroupWidth] = useSavedTableValue(
        'multichrome.env.groupWidth', 124,
        (value): value is number => typeof value === 'number' && value >= 88 && value <= 480,
    );
    const [proxyWidth, setProxyWidth] = useSavedTableValue(
        'multichrome.env.proxyWidth',
        184,
        (value): value is number =>
            typeof value === 'number' && value >= 150 && value <= 480,
    );
    const [optionalColumns, setOptionalColumns] = useState<OptionalEnvColumn[]>(
        loadSavedOptionalColumns,
    );
    const [deleteTarget, setDeleteTarget] = useState<ChromeEnvironment | null>(
        null,
    );
    const [healthTargetId, setHealthTargetId] = useState<string | null>(null);
    const [cookieTransfer, setCookieTransfer] = useState<{
        env: ChromeEnvironment;
        mode: 'import' | 'export';
    } | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchBusy, setBatchBusy] = useState(false);
    const [tilingWindows, setTilingWindows] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const proxyMap = useMemo(() => {
        const map = new Map<string, ManagedProxy>();
        managedProxies.forEach((proxy) => map.set(proxy.id, proxy));
        return map;
    }, [managedProxies]);

    const toggleOptionalColumn = (col: OptionalEnvColumn) => {
        setOptionalColumns((prev) => {
            const next = prev.includes(col)
                ? prev.filter((item) => item !== col)
                : [...prev, col];
            try {
                window.localStorage.setItem(
                    COLUMNS_STORAGE_KEY,
                    JSON.stringify(next),
                );
            } catch {
                // Ignore storage write failures
            }
            return next;
        });
    };

    const effectiveAllEnvironments = allEnvironments || environments;
    const allRunningCount = useMemo(
        () => effectiveAllEnvironments.filter((env) => env.isRunning).length,
        [effectiveAllEnvironments],
    );

    useEffect(() => {
        if (allRunningCount === 0 || !environmentApi.isAvailable()) {
            setResourceStats(null);
            return;
        }
        let cancelled = false;
        const poll = async (force = false) => {
            if (!force && document.hidden) return;
            try {
                const stats = await environmentApi.getRunningResourceStats();
                if (!cancelled && stats) {
                    setResourceStats(stats);
                }
            } catch {
                // Ignore transient process query errors
            }
        };
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                void poll(true);
            }
        };
        void poll(true);
        const timer = window.setInterval(() => void poll(false), 8000);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
    }, [allRunningCount]);

    const handleConfirmCloseAll = async () => {
        if (closingAll || !environmentApi.isAvailable()) {
            return;
        }
        setClosingAll(true);
        try {
            const rawResult = await environmentApi.closeAll();
            const closedCount =
                typeof rawResult === 'number'
                    ? rawResult
                    : Number(rawResult?.closedCount) || 0;
            const failedCount =
                typeof rawResult === 'object' && rawResult !== null
                    ? Number(rawResult.failedCount) || 0
                    : 0;
            setCloseAllConfirmOpen(false);
            await onRefresh();
            showNotification(
                failedCount > 0 ? 'warning' : 'success',
                closedCount > 0
                    ? failedCount > 0
                        ? isEn
                            ? `Closed ${closedCount} running environment(s) (${failedCount} failed)`
                            : `已关闭 ${closedCount} 个运行中环境（${failedCount} 个失败）`
                        : isEn
                          ? `Closed all ${closedCount} running environment(s)`
                          : `已关闭全部 ${closedCount} 个运行中环境`
                    : failedCount > 0
                      ? t(`关闭失败：${failedCount} 个环境仍需检查`, `Failed to close ${failedCount} environments`)
                      : t('当前没有运行中的环境', 'No running environments'),
            );
        } catch (error) {
            showNotification(
                'error',
                error instanceof Error
                    ? error.message
                    : t('关闭全部环境失败', 'Failed to close all environments'),
            );
        } finally {
            setClosingAll(false);
        }
    };

    const handleOpenDataDir = (id: string) => {
        void environmentApi.openDataDir(id);
    };

    const proxyUsageMap = useMemo(() => {
        const map = new Map<string, ChromeEnvironment[]>();
        effectiveAllEnvironments.forEach((env) => {
            if (!env.proxyId) return;
            const list = map.get(env.proxyId) || [];
            list.push(env);
            map.set(env.proxyId, list);
        });
        return map;
    }, [effectiveAllEnvironments]);

    const tagStats = useMemo(
        () => collectTagStats(environments),
        [environments],
    );

    const toggleTagFilter = (tag: string) => {
        const targetKey = tag.toLowerCase();
        setSelectedTags((prev) => {
            const exists = prev.some(
                (item) => item.toLowerCase() === targetKey,
            );
            if (exists) {
                return prev.filter((item) => item.toLowerCase() !== targetKey);
            }
            return normalizeEnvironmentTags([...prev, tag]);
        });
    };

    const filtered = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        const byStatus =
            statusFilter === 'running'
                ? environments.filter((env) => env.isRunning)
                : statusFilter === 'stopped'
                  ? environments.filter((env) => !env.isRunning)
                  : environments;
        const byTags =
            selectedTags.length > 0
                ? byStatus.filter((env) =>
                      matchesTagFilter(env.tags, selectedTags, tagFilterMode),
                  )
                : byStatus;
        const matched = keyword
            ? byTags.filter((env) => {
                  const proxyName = env.proxyId
                      ? proxyMap.get(env.proxyId)?.name || ''
                      : '';
                  return [
                      env.name,
                      env.groupName,
                      env.notes,
                      env.proxyLabel,
                      env.proxy,
                      proxyName,
                      env.id,
                      ...(env.tags || []),
                  ]
                      .filter(Boolean)
                      .some((field) => field!.toLowerCase().includes(keyword));
              })
            : byTags;

        return [...matched].sort((a, b) => {
            let cmp = 0;
            if (sortBy === 'name') {
                cmp = a.name.localeCompare(b.name, 'zh-CN');
            } else if (sortBy === 'createdAt') {
                cmp =
                    new Date(a.createdAt || 0).getTime() -
                    new Date(b.createdAt || 0).getTime();
            } else {
                cmp =
                    new Date(a.lastUsed || 0).getTime() -
                    new Date(b.lastUsed || 0).getTime();
            }
            return sortOrder === 'desc' ? -cmp : cmp;
        });
    }, [
        environments,
        search,
        statusFilter,
        selectedTags,
        tagFilterMode,
        sortBy,
        sortOrder,
        proxyMap,
    ]);

    const runningCount = useMemo(
        () => environments.filter((env) => env.isRunning).length,
        [environments],
    );

    const {
        containerRef: tableWrapRef,
        visibleItems: visibleEnvironments,
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
    const { selected: selectedEnv, rowProps } = useTableSelection(
        filtered,
        selectedEnvId,
        onSelectEnv,
        () => onToggleDetails(true),
        scrollToIndex,
    );


    const handleRunToggle = async (env: ChromeEnvironment) => {
        if (busyId) return;
        setBusyId(env.id);
        try {
            if (env.isRunning) {
                await onClose(env.id);
            } else {
                await onLaunch(env.id);
            }
        } finally {
            setBusyId(null);
        }
    };

    const openContextMenu = (
        event: React.MouseEvent,
        env: ChromeEnvironment,
    ) => {
        event.preventDefault();
        onSelectEnv(env.id);
        const row = event.currentTarget as HTMLElement;
        row.focus({ preventScroll: true });
        const bounds = row.getBoundingClientRect();
        const keyboard = event.clientX === 0 && event.clientY === 0;
        setContextMenu({
            env,
            x: keyboard ? bounds.left + 8 : event.clientX,
            y: keyboard ? bounds.bottom : event.clientY,
        });
    };

    const toggleSelectId = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllFiltered = () => {
        const filteredIds = filtered.map((item) => item.id);
        const allSelected =
            filteredIds.length > 0 &&
            filteredIds.every((id) => selectedIds.has(id));
        if (allSelected) {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                filteredIds.forEach((id) => next.delete(id));
                return next;
            });
        } else {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                filteredIds.forEach((id) => next.add(id));
                return next;
            });
        }
    };

    const clearSelection = () => setSelectedIds(new Set());

    const activeSelectedIds = useMemo(() => {
        const existingIds = new Set(environments.map((e) => e.id));
        return Array.from(selectedIds).filter((id) => existingIds.has(id));
    }, [selectedIds, environments]);

    const handleBatchLaunchSelected = async () => {
        if (batchBusy || activeSelectedIds.length === 0) return;
        const targetIds = environments
            .filter((e) => activeSelectedIds.includes(e.id) && !e.isRunning)
            .map((e) => e.id);
        if (targetIds.length === 0) return;
        setBatchBusy(true);
        try {
            let launched = 0;
            if (onBatchLaunch) {
                const res = await onBatchLaunch(targetIds);
                launched = res.launchedCount;
            } else {
                const results = await Promise.all(
                    targetIds.map(async (id) => {
                        try {
                            return Boolean(await onLaunch(id));
                        } catch {
                            return false;
                        }
                    }),
                );
                launched = results.filter(Boolean).length;
            }
            if (launched > 0) {
                showNotification(
                    'success',
                    isEn
                        ? `Launched ${launched} environment(s)`
                        : `已启动 ${launched} 个环境`,
                );
            }
        } finally {
            setBatchBusy(false);
        }
    };

    const handleBatchStopSelected = async () => {
        if (batchBusy || activeSelectedIds.length === 0) return;
        const targets = environments.filter(
            (e) => activeSelectedIds.includes(e.id) && e.isRunning,
        );
        if (targets.length === 0) return;
        setBatchBusy(true);
        try {
            const results = await Promise.all(
                targets.map(async (env) => {
                    try {
                        return Boolean(await onClose(env.id));
                    } catch {
                        return false;
                    }
                }),
            );
            const stopped = results.filter(Boolean).length;
            showNotification(
                stopped === targets.length ? 'success' : stopped ? 'warning' : 'error',
                t(`已关闭 ${stopped} 个环境，失败 ${targets.length - stopped} 个`,
                  `Stopped ${stopped} environments, ${targets.length - stopped} failed`),
            );
        } finally {
            setBatchBusy(false);
        }
    };

    const handleBatchAction = async (payload: {
        action: 'moveGroup' | 'bindProxy' | 'delete';
        groupName?: string;
        proxyId?: string;
    }) => {
        if (batchBusy || activeSelectedIds.length === 0) return;
        setBatchBusy(true);
        try {
            const res = await environmentApi.batchAction({
                ids: activeSelectedIds,
                ...payload,
            });
            if (payload.action === 'delete') {
                clearSelection();
            }
            await onRefresh();
            showNotification(
                res.skippedRunningCount > 0 ? 'warning' : 'success',
                isEn
                    ? `Updated ${res.succeededCount} environment(s)${res.skippedRunningCount > 0 ? ` (${res.skippedRunningCount} running skipped)` : ''}`
                    : `已处理 ${res.succeededCount} 个环境${res.skippedRunningCount > 0 ? `（跳过 ${res.skippedRunningCount} 个运行中环境）` : ''}`,
            );
        } catch (err) {
            showNotification(
                'error',
                err instanceof Error
                    ? err.message
                    : t('批量操作失败', 'Batch action failed'),
            );
        } finally {
            setBatchBusy(false);
        }
    };

    const handleTileWindows = async (
        mode: WindowArrangeMode = 'grid',
        envIds?: string[],
    ) => {
        if (
            tilingWindows ||
            (allRunningCount === 0 && mode !== 'reset-app-window')
        ) {
            return;
        }
        setTilingWindows(true);
        try {
            const res = await environmentApi.tileWindows({ mode, envIds });
            if (typeof res.consoleDocked === 'boolean') {
                setConsoleDocked(res.consoleDocked);
            }
            if (mode === 'reset-app-window') {
                setConsoleDocked(false);
                showNotification(
                    'success',
                    t(
                        '已恢复主窗口默认尺寸与居中位置',
                        'Restored main window to default centered size',
                    ),
                );
                return;
            }
            const n = res.tiledCount;
            const successText = (() => {
                if (mode === 'split-grid') {
                    return isEn
                        ? `Split-tiled ${n} running window(s) beside console`
                        : `已分屏并排平铺 ${n} 个运行中窗口`;
                }
                if (mode === 'stack') {
                    return isEn
                        ? `Stacked ${n} running window(s) to uniform size`
                        : `已统一尺寸堆叠 ${n} 个运行中窗口`;
                }
                if (mode === 'cascade') {
                    return isEn
                        ? `Cascaded ${n} running window(s)`
                        : `已阶梯层叠 ${n} 个运行中窗口`;
                }
                if (mode === 'minimize') {
                    return isEn
                        ? `Minimized ${n} running window(s)`
                        : `已最小化 ${n} 个运行中窗口`;
                }
                if (mode === 'restore') {
                    return isEn
                        ? `Restored ${n} running window(s)`
                        : `已恢复 ${n} 个运行中窗口`;
                }
                return isEn
                    ? `Tiled ${n} running window(s)`
                    : `已宫格排列 ${n} 个运行中窗口`;
            })();

            showNotification(
                n > 0 ? 'success' : 'info',
                n > 0
                    ? successText
                    : t(
                          '暂无可排列的浏览器窗口',
                          'No browser windows available to arrange',
                      ),
            );
        } catch (err) {
            showNotification(
                'error',
                err instanceof Error
                    ? err.message
                    : t('窗口排列失败', 'Failed to arrange windows'),
            );
        } finally {
            setTilingWindows(false);
        }
    };

    const handleFocusWindow = (
        id: string,
        options?: { highlightOnly?: boolean },
    ) => {
        if (!environmentApi.isAvailable()) return;
        void environmentApi.focusWindow(id, options).catch(() => {});
    };

    return {
        search,
        setSearch,
        statusFilter,
        setStatusFilter,
        selectedTags,
        setSelectedTags,
        tagFilterMode,
        setTagFilterMode,
        toggleTagFilter,
        resourceStats,
        closeAllConfirmOpen,
        setCloseAllConfirmOpen,
        closingAll,
        handleConfirmCloseAll,
        handleOpenDataDir,
        contextMenu,
        setContextMenu,
        openContextMenu,
        sortBy,
        setSortBy,
        sortOrder,
        setSortOrder,
        nameWidth,
        setNameWidth,
        groupWidth,
        setGroupWidth,
        proxyWidth,
        setProxyWidth,
        optionalColumns,
        toggleOptionalColumn,
        deleteTarget,
        setDeleteTarget,
        healthTargetId,
        setHealthTargetId,
        cookieTransfer,
        setCookieTransfer,
        selectedIds,
        activeSelectedIds,
        toggleSelectId,
        toggleSelectAllFiltered,
        clearSelection,
        batchBusy,
        handleBatchLaunchSelected,
        handleBatchStopSelected,
        handleBatchAction,
        tilingWindows,
        consoleDocked,
        handleTileWindows,
        handleFocusWindow,
        busyId,
        proxyMap,
        proxyUsageMap,
        tagStats,
        filtered,
        runningCount,
        allRunningCount,
        effectiveAllEnvironments,
        selectedEnv,
        rowProps,
        tableWrapRef,
        visibleEnvironments,
        startIndex,
        topSpacerHeight,
        bottomSpacerHeight,
        isVirtualized,
        handleRunToggle,
    };
}
