import React, { useEffect, useMemo, useState } from 'react';
import type {
    ChromeEnvironment,
    ManagedProxy,
    OptionalEnvColumn,
    RunStatus,
    RunningResourceStats,
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
    onLaunch: (id: string) => Promise<void>;
    onClose: (id: string) => Promise<void>;
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
    const [contextMenu, setContextMenu] =
        useState<EnvContextMenuState | null>(null);

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

    const { selected: selectedEnv, rowProps } = useTableSelection(
        filtered,
        selectedEnvId,
        onSelectEnv,
        () => onToggleDetails(true),
    );
    const {
        containerRef: tableWrapRef,
        visibleItems: visibleEnvironments,
        startIndex,
        topSpacerHeight,
        bottomSpacerHeight,
        isVirtualized,
    } = useVirtualRows(filtered, {
        rowHeight: 50,
        overscan: 8,
        threshold: 80,
    });

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
        const menuWidth = 180;
        const menuHeight = 200;
        const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
        const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
        setContextMenu({
            env,
            x: Math.max(8, x),
            y: Math.max(8, y),
        });
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
        proxyWidth,
        setProxyWidth,
        optionalColumns,
        toggleOptionalColumn,
        deleteTarget,
        setDeleteTarget,
        healthTargetId,
        setHealthTargetId,
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
