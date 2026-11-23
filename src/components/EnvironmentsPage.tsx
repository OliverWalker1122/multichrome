import React, { useEffect, useMemo, useState } from 'react';
import {
    Badge,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Input,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Spinner,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowSortRegular,
    CopyRegular,
    DeleteRegular,
    DismissRegular,
    DocumentTextRegular,
    EditRegular,
    FolderOpenRegular,
    MoreHorizontalRegular,
    PanelRightRegular,
    PlayRegular,
    SearchRegular,
    ShieldCheckmarkRegular,
    StopRegular,
    TableSettingsRegular,
    TagRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import dayjs from 'dayjs';
import {
    ChromeEnvironment,
    ManagedProxy,
    RunningResourceStats,
} from '../types';
import { useNotification } from '../contexts/NotificationContext';
import EnvironmentDetailsPanel from './EnvironmentDetailsPanel';
import EnvironmentHealthDialog from './EnvironmentHealthDialog';
import ColumnResizeHandle from './ColumnResizeHandle';
import {
    useSavedTableValue,
    useTableSelection,
} from '../hooks/useTableWorkspace';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { getGroupStyle, getTagStyle, getToneStyle } from '../theme/semanticColors';
import { useI18n } from '../i18n';
import {
    collectTagStats,
    matchesTagFilter,
    normalizeEnvironmentTags,
    TagFilterMode,
} from '../utils/environmentTags';

export type OptionalEnvColumn =
    'timezone' | 'language' | 'notes' | 'createdAt' | 'id';

const OPTIONAL_COLUMNS: { key: OptionalEnvColumn; zh: string; en: string }[] = [
    { key: 'timezone', zh: '时区', en: 'Timezone' },
    { key: 'language', zh: '语言', en: 'Language' },
    { key: 'notes', zh: '备注', en: 'Notes' },
    { key: 'createdAt', zh: '创建时间', en: 'Created At' },
    { key: 'id', zh: 'ID', en: 'ID' },
];

const COLUMNS_STORAGE_KEY = 'multichrome.env.optionalColumns';

function formatMemoryBytes(bytes?: number): string {
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
        // 忽略本地存储读取异常
    }
    return [];
}

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
    narrowWindow: boolean;
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

const useStyles = makeStyles({
    workspace: {
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
    },
    main: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '16px 22px 10px 22px',
        flexShrink: 0,
    },
    headingGroup: {
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    title: {
        fontSize: '20px',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: '28px',
        margin: 0,
        color: tokens.colorNeutralForeground1,
    },
    subtitle: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 22px 12px 22px',
        flexShrink: 0,
        flexWrap: 'wrap',
    },
    searchInput: {
        flex: 1,
        minWidth: '180px',
    },
    toolbarActions: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
    },
    tableWrap: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'auto',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
    },
    thead: {
        position: 'sticky',
        top: 0,
        zIndex: 2,
        backgroundColor: 'var(--glass-card)',
        backdropFilter: 'blur(14px)',
        boxShadow: 'inset 0 -1px 0 var(--glass-border)',
    },
    th: {
        position: 'relative',
        textAlign: 'left',
        padding: '8px 12px',
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        '&:first-child': {
            paddingLeft: '20px',
        },
        '&:last-child': {
            paddingRight: '20px',
        },
    },
    thRight: {
        textAlign: 'right',
    },
    row: {
        height: '50px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: '80ms',
        '&:hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    rowSelected: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        '&:hover': {
            backgroundColor: tokens.colorNeutralBackground1Selected,
        },
        '& > td:first-child': {
            boxShadow: `inset 3px 0 0 ${tokens.colorBrandBackground}`,
        },
    },
    td: {
        padding: '6px 12px',
        fontSize: '13px',
        color: tokens.colorNeutralForeground1,
        verticalAlign: 'middle',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        '&:first-child': {
            paddingLeft: '20px',
        },
        '&:last-child': {
            paddingRight: '20px',
        },
    },
    groupPill: {
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: '100%',
        padding: '1px 8px',
        height: '22px',
        borderRadius: tokens.borderRadiusMedium,
        fontSize: '12px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    proxySubRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    miniGreenDot: {
        width: '6px',
        height: '6px',
        borderRadius: '999px',
        backgroundColor: tokens.colorPaletteGreenForeground1,
        flexShrink: 0,
    },
    nameCell: {
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        minWidth: 0,
    },
    profileIcon: {
        width: '28px',
        height: '28px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '8px',
        fontSize: '17px',
        flexShrink: 0,
    },
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '999px',
        flexShrink: 0,
    },
    dotRunning: {
        backgroundColor: tokens.colorPaletteGreenForeground1,
    },
    dotStopped: {
        backgroundColor: tokens.colorNeutralForeground4,
    },
    nameTextWrap: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
    },
    namePrimary: {
        fontSize: '14px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    nameSub: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    statusRunning: {
        color: tokens.colorPaletteGreenForeground1,
        fontWeight: 600,
        fontSize: '13px',
        backgroundColor: tokens.colorPaletteGreenBackground1,
        borderRadius: '5px',
        padding: '3px 7px',
    },
    statusStopped: {
        color: tokens.colorNeutralForeground2,
        fontSize: '13px',
    },
    muted: {
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
    },
    mono: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
    },
    actionCell: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '4px',
    },
    emptyState: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        padding: '32px 20px',
        color: tokens.colorNeutralForeground3,
        textAlign: 'center',
    },
    colMenuList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: '150px',
    },
    statusFilterGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px',
        borderRadius: '8px',
        backgroundColor: 'var(--glass-pill)',
        border: '1px solid var(--glass-border)',
        gap: '2px',
        flexShrink: 0,
    },
    statusFilterBtn: {
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        fontFamily: 'inherit',
        padding: '4px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        '&:hover': {
            color: tokens.colorNeutralForeground1,
        },
    },
    statusFilterBtnActive: {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        fontWeight: 600,
        boxShadow: tokens.shadow2,
    },
    contextMenu: {
        position: 'fixed',
        zIndex: 1000,
        minWidth: '168px',
        padding: '4px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        boxShadow: tokens.shadow16,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    contextMenuItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '6px 10px',
        border: 'none',
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground1,
        fontSize: '13px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
    },
    contextMenuDanger: {
        color: tokens.colorPaletteRedForeground1,
    },
    contextMenuSep: {
        height: '1px',
        margin: '3px 6px',
        backgroundColor: tokens.colorNeutralStroke2,
    },
    tagPopoverBox: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minWidth: '248px',
        maxWidth: '300px',
    },
    tagPopoverHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
    },
    tagModeGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '6px',
        padding: '2px',
        backgroundColor: tokens.colorNeutralBackground3,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    tagModeBtn: {
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '11px',
        padding: '2px 7px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontFamily: 'inherit',
    },
    tagModeBtnActive: {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        fontWeight: 600,
    },
    tagOptionList: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        maxHeight: '190px',
        overflowY: 'auto',
    },
    tagOptionChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        borderRadius: '999px',
        padding: '2px 9px',
        fontSize: '12px',
        lineHeight: '18px',
        border: '1px solid transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
        opacity: 0.85,
        ':hover': {
            opacity: 1,
        },
    },
    tagOptionChipActive: {
        opacity: 1,
        boxShadow: `0 0 0 1.5px ${tokens.colorBrandStroke1}`,
        fontWeight: 600,
    },
    activeTagBar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '6px',
        padding: '0 22px 10px 22px',
        flexShrink: 0,
    },
    activeTagChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '999px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 500,
        lineHeight: '16px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
    },
    rowTagsWrap: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px',
        marginTop: '3px',
    },
    rowTagChip: {
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '999px',
        padding: '0 6px',
        fontSize: '11px',
        lineHeight: '17px',
        fontWeight: 500,
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        maxWidth: '110px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    rowTagMore: {
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '999px',
        padding: '0 6px',
        fontSize: '11px',
        lineHeight: '17px',
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground2,
    },
});

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
    narrowWindow,
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
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<
        'all' | 'running' | 'stopped'
    >('all');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagFilterMode, setTagFilterMode] = useState<TagFilterMode>('all');
    const [resourceStats, setResourceStats] =
        useState<RunningResourceStats | null>(null);
    const [closeAllConfirmOpen, setCloseAllConfirmOpen] = useState(false);
    const [closingAll, setClosingAll] = useState(false);
    const [contextMenu, setContextMenu] = useState<{
        env: ChromeEnvironment;
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
    const [sortBy, setSortBy] = useSavedTableValue<
        'lastUsed' | 'createdAt' | 'name'
    >(
        'multichrome.env.sortBy',
        'lastUsed',
        (value): value is 'lastUsed' | 'createdAt' | 'name' =>
            ['lastUsed', 'createdAt', 'name'].includes(value as string),
    );
    const [sortOrder, setSortOrder] = useSavedTableValue<'asc' | 'desc'>(
        'multichrome.env.sortOrder',
        'desc',
        (value): value is 'asc' | 'desc' => value === 'asc' || value === 'desc',
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
                // 忽略存储异常
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
        if (
            allRunningCount === 0 ||
            !window.electronAPI?.chromeEnvironments?.getRunningResourceStats
        ) {
            setResourceStats(null);
            return;
        }
        let cancelled = false;
        const poll = async (force = false) => {
            if (!force && document.hidden) return;
            try {
                const stats =
                    await window.electronAPI.chromeEnvironments.getRunningResourceStats?.();
                if (!cancelled && stats) {
                    setResourceStats(stats);
                }
            } catch {
                // ignore transient process query errors
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
        if (closingAll || !window.electronAPI?.chromeEnvironments?.closeAll) {
            return;
        }
        setClosingAll(true);
        try {
            const rawResult =
                await window.electronAPI.chromeEnvironments.closeAll();
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
            const exists = prev.some((item) => item.toLowerCase() === targetKey);
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

    const runningCount = environments.filter((env) => env.isRunning).length;
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

    // 窄窗口自动隐藏可选列与次要列，保留名称、状态与主要操作
    const activeOptionalCols = narrowWindow ? [] : optionalColumns;
    const showGroupCol = !narrowWindow && currentGroup === '用户分组';
    const showLastUsedCol = !narrowWindow;
    const showProxyCol = !narrowWindow;
    const visibleColumnCount =
        3 +
        (showGroupCol ? 1 : 0) +
        (showProxyCol ? 1 : 0) +
        activeOptionalCols.length +
        (showLastUsedCol ? 1 : 0);

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

    const headingTitle =
        currentGroup === '用户分组' ? t('环境', 'Environments') : currentGroup;
    const totalMemoryText =
        allRunningCount > 0
            ? formatMemoryBytes(resourceStats?.totalMemoryBytes)
            : '';

    return (
        <div className={styles.workspace}>
            <section
                className={styles.main}
                aria-label={t('环境列表工作区', 'Environments workspace')}
            >
                <div className={styles.header}>
                    <div className={styles.headingGroup}>
                        <h1 className={styles.title}>{headingTitle}</h1>
                        <span className={styles.subtitle}>
                            {isEn
                                ? `${environments.length} profiles · ${runningCount} running${totalMemoryText ? ` · ${totalMemoryText}` : ''}`
                                : `${environments.length} 个环境 · ${runningCount} 个运行中${totalMemoryText ? ` · 内存 ${totalMemoryText}` : ''}`}
                        </span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexShrink: 0,
                        }}
                    >
                        {currentGroup !== '用户分组' && onRequestRenameGroup && (
                            <Button
                                appearance="outline"
                                icon={<EditRegular />}
                                onClick={() => onRequestRenameGroup(currentGroup)}
                            >
                                {t('重命名分组', 'Rename Group')}
                            </Button>
                        )}
                        {currentGroup !== '用户分组' && onRequestDeleteGroup && (
                            <Button
                                appearance="outline"
                                icon={<DeleteRegular />}
                                onClick={() => onRequestDeleteGroup(currentGroup)}
                            >
                                {t('删除分组', 'Delete Group')}
                            </Button>
                        )}
                        {allRunningCount > 0 && (
                            <Button
                                appearance="outline"
                                icon={<StopRegular />}
                                disabled={closingAll}
                                onClick={() => setCloseAllConfirmOpen(true)}
                            >
                                {isEn
                                    ? `Stop All (${allRunningCount})`
                                    : `关闭全部 (${allRunningCount})`}
                            </Button>
                        )}
                        <Button
                            appearance="primary"
                            icon={<AddRegular />}
                            onClick={onCreateClick}
                        >
                            {t('新建环境', 'New Environment')}
                        </Button>
                    </div>
                </div>

                <div className={styles.toolbar}>
                    <Input
                        className={styles.searchInput}
                        contentBefore={<SearchRegular />}
                        contentAfter={
                            search ? (
                                <Button
                                    appearance="transparent"
                                    size="small"
                                    icon={<DismissRegular />}
                                    aria-label={t('清空搜索', 'Clear search')}
                                    onClick={() => setSearch('')}
                                />
                            ) : undefined
                        }
                        placeholder={t(
                            '搜索环境名称、分组、标签、代理或备注',
                            'Search by name, group, tags, proxy, or notes',
                        )}
                        value={search}
                        onChange={(_, data) => setSearch(data.value)}
                    />

                    <div
                        className={styles.statusFilterGroup}
                        role="group"
                        aria-label={t('按运行状态筛选', 'Filter by status')}
                    >
                        {(
                            [
                                ['all', t('全部', 'All')],
                                [
                                    'running',
                                    isEn
                                        ? `Running (${runningCount})`
                                        : `运行中 (${runningCount})`,
                                ],
                                [
                                    'stopped',
                                    isEn
                                        ? `Stopped (${environments.length - runningCount})`
                                        : `未运行 (${environments.length - runningCount})`,
                                ],
                            ] as const
                        ).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                className={mergeClasses(
                                    styles.statusFilterBtn,
                                    statusFilter === key &&
                                        styles.statusFilterBtnActive,
                                )}
                                aria-pressed={statusFilter === key}
                                onClick={() => setStatusFilter(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className={styles.toolbarActions}>
                        {(tagStats.length > 0 || selectedTags.length > 0) && (
                            <Popover positioning="below-end">
                            <PopoverTrigger disableButtonEnhancement>
                                <Button
                                    appearance={
                                        selectedTags.length > 0
                                            ? 'primary'
                                            : 'outline'
                                    }
                                    icon={<TagRegular />}
                                >
                                    {selectedTags.length > 0
                                        ? isEn
                                            ? `Tags (${selectedTags.length})`
                                            : `标签 (${selectedTags.length})`
                                        : t('标签', 'Tags')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverSurface>
                                <div className={styles.tagPopoverBox}>
                                    <div className={styles.tagPopoverHeader}>
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: tokens.colorNeutralForeground2,
                                            }}
                                        >
                                            {t('按标签筛选', 'Filter by Tags')}
                                        </span>
                                        <div
                                            className={styles.tagModeGroup}
                                            role="group"
                                            aria-label={t(
                                                '标签匹配逻辑',
                                                'Tag match mode',
                                            )}
                                        >
                                            <button
                                                type="button"
                                                className={mergeClasses(
                                                    styles.tagModeBtn,
                                                    tagFilterMode === 'all' &&
                                                        styles.tagModeBtnActive,
                                                )}
                                                aria-pressed={
                                                    tagFilterMode === 'all'
                                                }
                                                onClick={() =>
                                                    setTagFilterMode('all')
                                                }
                                            >
                                                {t('全部 AND', 'All')}
                                            </button>
                                            <button
                                                type="button"
                                                className={mergeClasses(
                                                    styles.tagModeBtn,
                                                    tagFilterMode === 'any' &&
                                                        styles.tagModeBtnActive,
                                                )}
                                                aria-pressed={
                                                    tagFilterMode === 'any'
                                                }
                                                onClick={() =>
                                                    setTagFilterMode('any')
                                                }
                                            >
                                                {t('任一 OR', 'Any')}
                                            </button>
                                        </div>
                                    </div>

                                    {tagStats.length === 0 ? (
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                color: tokens.colorNeutralForeground3,
                                            }}
                                        >
                                            {t(
                                                '当前列表暂无标签，可在新建环境或右侧详情面板中为环境添加。',
                                                'No tags yet. Add tags when creating or editing an environment.',
                                            )}
                                        </span>
                                    ) : (
                                        <div className={styles.tagOptionList}>
                                            {tagStats.map(({ tag, count }) => {
                                                const active =
                                                    selectedTags.some(
                                                        (item) =>
                                                            item.toLowerCase() ===
                                                            tag.toLowerCase(),
                                                    );
                                                return (
                                                    <button
                                                        key={tag}
                                                        type="button"
                                                        className={mergeClasses(
                                                            styles.tagOptionChip,
                                                            active &&
                                                                styles.tagOptionChipActive,
                                                        )}
                                                        style={getTagStyle(tag)}
                                                        aria-pressed={active}
                                                        onClick={() =>
                                                            toggleTagFilter(tag)
                                                        }
                                                    >
                                                        <span>#{tag}</span>
                                                        <span
                                                            style={{
                                                                opacity: 0.75,
                                                                fontSize: '11px',
                                                            }}
                                                        >
                                                            {count}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {selectedTags.length > 0 && (
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'flex-end',
                                            }}
                                        >
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                onClick={() =>
                                                    setSelectedTags([])
                                                }
                                            >
                                                {t(
                                                    '清空标签筛选',
                                                    'Clear Tag Filter',
                                                )}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </PopoverSurface>
                        </Popover>
                        )}

                        {!narrowWindow && (
                            <Popover positioning="below-end">
                                <PopoverTrigger disableButtonEnhancement>
                                    <Button
                                        appearance="outline"
                                        icon={<TableSettingsRegular />}
                                    >
                                        {t('列', 'Columns')}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverSurface>
                                    <div className={styles.colMenuList}>
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: tokens.colorNeutralForeground3,
                                                marginBottom: '4px',
                                            }}
                                        >
                                            {t('显示附加列', 'Extra Columns')}
                                        </span>
                                        {OPTIONAL_COLUMNS.map((col) => (
                                            <Checkbox
                                                key={col.key}
                                                label={isEn ? col.en : col.zh}
                                                checked={optionalColumns.includes(
                                                    col.key,
                                                )}
                                                onChange={() =>
                                                    toggleOptionalColumn(
                                                        col.key,
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                </PopoverSurface>
                            </Popover>
                        )}

                        <Menu positioning="below-end">
                            <MenuTrigger disableButtonEnhancement>
                                <Tooltip
                                    content={t('排序方式', 'Sort by')}
                                    relationship="label"
                                >
                                    <Button
                                        appearance="outline"
                                        icon={<ArrowSortRegular />}
                                        aria-label={t('排序方式', 'Sort by')}
                                    />
                                </Tooltip>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        onClick={() => {
                                            setSortBy('lastUsed');
                                            setSortOrder((prev) =>
                                                sortBy === 'lastUsed' &&
                                                prev === 'desc'
                                                    ? 'asc'
                                                    : 'desc',
                                            );
                                        }}
                                    >
                                        {t('最近使用', 'Last Used')}{' '}
                                        {sortBy === 'lastUsed'
                                            ? sortOrder === 'desc'
                                                ? '↓'
                                                : '↑'
                                            : ''}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() => {
                                            setSortBy('createdAt');
                                            setSortOrder((prev) =>
                                                sortBy === 'createdAt' &&
                                                prev === 'desc'
                                                    ? 'asc'
                                                    : 'desc',
                                            );
                                        }}
                                    >
                                        {t('创建时间', 'Created At')}{' '}
                                        {sortBy === 'createdAt'
                                            ? sortOrder === 'desc'
                                                ? '↓'
                                                : '↑'
                                            : ''}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() => {
                                            setSortBy('name');
                                            setSortOrder((prev) =>
                                                sortBy === 'name' &&
                                                prev === 'asc'
                                                    ? 'desc'
                                                    : 'asc',
                                            );
                                        }}
                                    >
                                        {t('名称', 'Name')}{' '}
                                        {sortBy === 'name'
                                            ? sortOrder === 'desc'
                                                ? '↓'
                                                : '↑'
                                            : ''}
                                    </MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </div>
                </div>

                {selectedTags.length > 0 && (
                    <div
                        className={styles.activeTagBar}
                        aria-label={t('已启用标签筛选', 'Active tag filters')}
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            onClick={() =>
                                setTagFilterMode((prev) =>
                                    prev === 'all' ? 'any' : 'all',
                                )
                            }
                        >
                            {tagFilterMode === 'all'
                                ? t('同时包含 (AND)', 'Match All (AND)')
                                : t('包含任一 (OR)', 'Match Any (OR)')}
                        </Button>
                        {selectedTags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                className={styles.activeTagChip}
                                style={getTagStyle(tag)}
                                title={t('点击移除此标签筛选', 'Click to remove tag filter')}
                                onClick={() => toggleTagFilter(tag)}
                            >
                                <span>#{tag}</span>
                                <span aria-hidden="true">×</span>
                            </button>
                        ))}
                        <Button
                            size="small"
                            appearance="transparent"
                            onClick={() => setSelectedTags([])}
                        >
                            {t('清空', 'Clear')}
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
                ) : filtered.length === 0 ? (
                    <div className={styles.emptyState}>
                        <WindowMultipleRegular style={{ fontSize: '36px' }} />
                        <span
                            style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: tokens.colorNeutralForeground1,
                            }}
                        >
                            {search.trim() ||
                            selectedTags.length > 0 ||
                            statusFilter !== 'all'
                                ? t('未找到匹配的环境', 'No matching environments')
                                : t('还没有 Chrome 环境', 'No Chrome environments yet')}
                        </span>
                        <span style={{ fontSize: '12px' }}>
                            {search.trim() ||
                            selectedTags.length > 0 ||
                            statusFilter !== 'all'
                                ? t(
                                      '尝试调整搜索词、运行状态或标签筛选条件。',
                                      'Try adjusting the search keyword, status, or tag filters.',
                                  )
                                : t(
                                      '点击右上角“新建环境”创建第一个独立隔离的浏览器环境。',
                                      'Click "New Environment" in the top right to create your first isolated browser profile.',
                                  )}
                        </span>
                        {search.trim() ||
                        selectedTags.length > 0 ||
                        statusFilter !== 'all' ? (
                            <Button
                                appearance="secondary"
                                onClick={() => {
                                    setSearch('');
                                    setStatusFilter('all');
                                    setSelectedTags([]);
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
                    <div ref={tableWrapRef} className={styles.tableWrap}>
                        <table
                            className={styles.table}
                            aria-label={t('环境列表', 'Environments table')}
                            style={{
                                minWidth: narrowWindow
                                    ? 480
                                    : nameWidth +
                                      proxyWidth +
                                      292 +
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
                                                : nameWidth,
                                        }}
                                    >
                                        {t('名称', 'Name')}
                                        {!narrowWindow && (
                                            <ColumnResizeHandle
                                                label={t('名称', 'Name')}
                                                width={nameWidth}
                                                min={160}
                                                onChange={setNameWidth}
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
                                            style={{ width: proxyWidth }}
                                        >
                                            {t('代理', 'Proxy')}
                                            <ColumnResizeHandle
                                                label={t('代理', 'Proxy')}
                                                width={proxyWidth}
                                                min={150}
                                                onChange={setProxyWidth}
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
                                            styles.thRight,
                                        )}
                                        style={{ width: '112px' }}
                                    >
                                        {t('操作', 'Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {isVirtualized && topSpacerHeight > 0 && (
                                    <tr
                                        aria-hidden="true"
                                        style={{
                                            height: `${topSpacerHeight}px`,
                                        }}
                                    >
                                        <td
                                            colSpan={visibleColumnCount}
                                            style={{
                                                padding: 0,
                                                border: 'none',
                                                height: `${topSpacerHeight}px`,
                                            }}
                                        />
                                    </tr>
                                )}
                                {visibleEnvironments.map((env, localIndex) => {
                                    const index = startIndex + localIndex;
                                    const selected = selectedEnv?.id === env.id;
                                    const boundProxy = env.proxyId
                                        ? proxyMap.get(env.proxyId)
                                        : undefined;
                                    const proxyDisplay = env.proxyId
                                        ? boundProxy
                                            ? boundProxy.name
                                            : t('代理已失效', 'Proxy Missing')
                                        : env.proxyLabel ||
                                          env.proxy ||
                                          t('全局默认', 'Global Default');
                                    const proxySub = env.proxyId
                                        ? boundProxy
                                            ? boundProxy.status === 'running'
                                                ? `${boundProxy.protocol.toUpperCase()} · ${t('本地服务已启动', 'Running')}`
                                                : boundProxy.status === 'error'
                                                  ? `${boundProxy.protocol.toUpperCase()} · ${t('启动异常', 'Error')}`
                                                  : `${boundProxy.protocol.toUpperCase()} · ${t('按需启动', 'On demand')}`
                                            : t('请重新分配', 'Reassign required')
                                        : env.proxy
                                          ? t('手动代理', 'Manual proxy')
                                          : '';

                                    return (
                                        <tr
                                            key={env.id}
                                            {...rowProps(env, index)}
                                            aria-selected={selected}
                                            className={mergeClasses(
                                                styles.row,
                                                selected && styles.rowSelected,
                                            )}
                                            onClick={() => onSelectEnv(env.id)}
                                            onContextMenu={(event) => {
                                                event.preventDefault();
                                                onSelectEnv(env.id);
                                                const menuWidth = 180;
                                                const menuHeight = 200;
                                                const x = Math.min(
                                                    event.clientX,
                                                    window.innerWidth - menuWidth - 8,
                                                );
                                                const y = Math.min(
                                                    event.clientY,
                                                    window.innerHeight - menuHeight - 8,
                                                );
                                                setContextMenu({
                                                    env,
                                                    x: Math.max(8, x),
                                                    y: Math.max(8, y),
                                                });
                                            }}
                                            onDoubleClick={() => {
                                                onSelectEnv(env.id);
                                                onToggleDetails(true);
                                            }}
                                        >
                                            <td className={styles.td}>
                                                <div
                                                    className={styles.nameCell}
                                                >
                                                    <span
                                                        className={
                                                            styles.profileIcon
                                                        }
                                                        style={getGroupStyle(
                                                            env.groupName,
                                                        )}
                                                        aria-hidden="true"
                                                    >
                                                        <WindowMultipleRegular />
                                                    </span>
                                                    <div
                                                        className={
                                                            styles.nameTextWrap
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.namePrimary
                                                            }
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                            }}
                                                            title={env.name}
                                                        >
                                                            <span
                                                                style={{
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                }}
                                                            >
                                                                {env.name}
                                                            </span>
                                                            {env.browserEngine ===
                                                                'fingerprint-chromium' && (
                                                                <Badge
                                                                    size="small"
                                                                    appearance="tint"
                                                                    color="brand"
                                                                    style={{
                                                                        flexShrink: 0,
                                                                        whiteSpace: 'nowrap',
                                                                    }}
                                                                >
                                                                    {t('防关联', 'Privacy')}
                                                                </Badge>
                                                            )}
                                                        </span>
                                                        {Array.isArray(env.tags) &&
                                                            env.tags.length > 0 && (
                                                                <div
                                                                    className={
                                                                        styles.rowTagsWrap
                                                                    }
                                                                >
                                                                    {env.tags
                                                                        .slice(0, 3)
                                                                        .map(
                                                                            (
                                                                                tag,
                                                                            ) => (
                                                                                <button
                                                                                    key={
                                                                                        tag
                                                                                    }
                                                                                    type="button"
                                                                                    className={
                                                                                        styles.rowTagChip
                                                                                    }
                                                                                    style={getTagStyle(
                                                                                        tag,
                                                                                    )}
                                                                                    title={t(
                                                                                        `按标签 #${tag} 筛选`,
                                                                                        `Filter by tag #${tag}`,
                                                                                    )}
                                                                                    onClick={(
                                                                                        event,
                                                                                    ) => {
                                                                                        event.stopPropagation();
                                                                                        toggleTagFilter(
                                                                                            tag,
                                                                                        );
                                                                                    }}
                                                                                >
                                                                                    #{tag}
                                                                                </button>
                                                                            ),
                                                                        )}
                                                                    {env.tags
                                                                        .length >
                                                                        3 && (
                                                                        <Tooltip
                                                                            content={env.tags
                                                                                .map(
                                                                                    (
                                                                                        tag,
                                                                                    ) =>
                                                                                        `#${tag}`,
                                                                                )
                                                                                .join(
                                                                                    ' ',
                                                                                )}
                                                                            relationship="label"
                                                                        >
                                                                            <span
                                                                                className={
                                                                                    styles.rowTagMore
                                                                                }
                                                                            >
                                                                                +
                                                                                {env
                                                                                    .tags
                                                                                    .length -
                                                                                    3}
                                                                            </span>
                                                                        </Tooltip>
                                                                    )}
                                                                </div>
                                                            )}
                                                        {(narrowWindow ||
                                                            env.notes) && (
                                                            <span
                                                                className={
                                                                    styles.nameSub
                                                                }
                                                            >
                                                                {narrowWindow
                                                                    ? `${env.groupName} · ${proxyDisplay}`
                                                                    : env.notes}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className={styles.td}>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '2px',
                                                        alignItems: 'flex-start',
                                                    }}
                                                >
                                                    <span
                                                        className={
                                                            env.isRunning
                                                                ? styles.statusRunning
                                                                : styles.statusStopped
                                                        }
                                                    >
                                                        {env.isRunning
                                                            ? t('运行中', 'Running')
                                                            : t('未运行', 'Stopped')}
                                                    </span>
                                                    {env.isRunning &&
                                                        resourceStats
                                                            ?.environments?.[
                                                            env.id
                                                        ]?.memoryBytes && (
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        '11px',
                                                                    color: tokens.colorNeutralForeground3,
                                                                    fontVariantNumeric:
                                                                        'tabular-nums',
                                                                }}
                                                            >
                                                                {formatMemoryBytes(
                                                                    resourceStats
                                                                        .environments[
                                                                        env.id
                                                                    ]
                                                                        .memoryBytes,
                                                                )}
                                                            </span>
                                                        )}
                                                </div>
                                            </td>
                                            {showGroupCol && (
                                                <td className={styles.td}>
                                                    <span
                                                        className={
                                                            styles.groupPill
                                                        }
                                                        style={getGroupStyle(
                                                            env.groupName,
                                                        )}
                                                        title={env.groupName}
                                                    >
                                                        {env.groupName}
                                                    </span>
                                                </td>
                                            )}
                                            {showProxyCol && (
                                                <td
                                                    className={styles.td}
                                                    title={`${proxyDisplay}${proxySub ? ` (${proxySub})` : ''}`}
                                                >
                                                    <div
                                                        className={
                                                            styles.nameTextWrap
                                                        }
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                alignItems:
                                                                    'center',
                                                                gap: '5px',
                                                                minWidth: 0,
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        '13px',
                                                                    overflow:
                                                                        'hidden',
                                                                    textOverflow:
                                                                        'ellipsis',
                                                                }}
                                                            >
                                                                {proxyDisplay}
                                                            </span>
                                                            {env.proxyId &&
                                                                (
                                                                    proxyUsageMap.get(
                                                                        env.proxyId,
                                                                    ) || []
                                                                ).length > 1 && (
                                                                    <Tooltip
                                                                        content={
                                                                            isEn
                                                                                ? `Proxy reuse warning: ${(proxyUsageMap.get(env.proxyId) || []).length} environments share this proxy (${(proxyUsageMap.get(env.proxyId) || []).map((e) => e.name).join(', ')})`
                                                                                : `代理查重提醒：共 ${(proxyUsageMap.get(env.proxyId) || []).length} 个环境共用此代理（${(proxyUsageMap.get(env.proxyId) || []).map((e) => e.name).join('、')}）`
                                                                        }
                                                                        relationship="description"
                                                                    >
                                                                        <span
                                                                            style={{
                                                                                fontSize:
                                                                                    '10px',
                                                                                fontWeight: 600,
                                                                                padding:
                                                                                    '0 4px',
                                                                                borderRadius:
                                                                                    '4px',
                                                                                flexShrink: 0,
                                                                                backgroundColor:
                                                                                    tokens.colorPaletteYellowBackground1,
                                                                                color: tokens.colorPaletteYellowForeground2,
                                                                            }}
                                                                        >
                                                                            {isEn ? 'Shared×' : '共用×'}
                                                                            {
                                                                                (
                                                                                    proxyUsageMap.get(
                                                                                        env.proxyId,
                                                                                    ) ||
                                                                                    []
                                                                                )
                                                                                    .length
                                                                            }
                                                                        </span>
                                                                    </Tooltip>
                                                                )}
                                                        </div>
                                                        {proxySub && (
                                                            <span
                                                                className={
                                                                    styles.proxySubRow
                                                                }
                                                                style={
                                                                    boundProxy?.status ===
                                                                    'error'
                                                                        ? {
                                                                              color: getToneStyle(
                                                                                  'rose',
                                                                              )
                                                                                  .color,
                                                                          }
                                                                        : undefined
                                                                }
                                                            >
                                                                {boundProxy?.status ===
                                                                    'running' && (
                                                                    <span
                                                                        className={
                                                                            styles.miniGreenDot
                                                                        }
                                                                    />
                                                                )}
                                                                <span
                                                                    style={{
                                                                        overflow:
                                                                            'hidden',
                                                                        textOverflow:
                                                                            'ellipsis',
                                                                    }}
                                                                >
                                                                    {proxySub}
                                                                </span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                            {activeOptionalCols.includes(
                                                'timezone',
                                            ) && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.mono,
                                                    )}
                                                    title={env.timezone || ''}
                                                >
                                                    {env.timezone || '-'}
                                                </td>
                                            )}
                                            {activeOptionalCols.includes(
                                                'language',
                                            ) && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.mono,
                                                    )}
                                                >
                                                    {env.language || '-'}
                                                </td>
                                            )}
                                            {activeOptionalCols.includes(
                                                'notes',
                                            ) && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.muted,
                                                    )}
                                                    title={env.notes || ''}
                                                >
                                                    {env.notes || '-'}
                                                </td>
                                            )}
                                            {activeOptionalCols.includes(
                                                'createdAt',
                                            ) && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.muted,
                                                    )}
                                                >
                                                    {env.createdAt
                                                        ? dayjs(
                                                              env.createdAt,
                                                          ).format(
                                                              'MM-DD HH:mm',
                                                          )
                                                        : '-'}
                                                </td>
                                            )}
                                            {activeOptionalCols.includes(
                                                'id',
                                            ) && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.mono,
                                                    )}
                                                    title={env.id}
                                                >
                                                    {env.id.slice(0, 8)}
                                                </td>
                                            )}
                                            {showLastUsedCol && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.muted,
                                                    )}
                                                >
                                                    {env.lastUsed
                                                        ? dayjs(
                                                              env.lastUsed,
                                                          ).format(
                                                              'MM-DD HH:mm',
                                                          )
                                                        : '-'}
                                                </td>
                                            )}
                                            <td
                                                className={styles.td}
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <div
                                                    className={
                                                        styles.actionCell
                                                    }
                                                >
                                                    <Button
                                                        size="small"
                                                        appearance={
                                                            env.isRunning
                                                                ? 'secondary'
                                                                : 'outline'
                                                        }
                                                        disabled={
                                                            busyId === env.id
                                                        }
                                                        onClick={() =>
                                                            void handleRunToggle(
                                                                env,
                                                            )
                                                        }
                                                    >
                                                        {busyId === env.id
                                                            ? t('处理中', 'Working')
                                                            : env.isRunning
                                                              ? t('关闭', 'Stop')
                                                              : t('启动', 'Launch')}
                                                    </Button>
                                                    <Menu positioning="below-end">
                                                        <MenuTrigger
                                                            disableButtonEnhancement
                                                        >
                                                            <Button
                                                                size="small"
                                                                appearance="subtle"
                                                                icon={
                                                                    <MoreHorizontalRegular />
                                                                }
                                                                aria-label={
                                                                    isEn
                                                                        ? `More actions for ${env.name}`
                                                                        : `更多操作 ${env.name}`
                                                                }
                                                            />
                                                        </MenuTrigger>
                                                        <MenuPopover>
                                                            <MenuList>
                                                                <MenuItem
                                                                    icon={
                                                                        env.isRunning ? (
                                                                            <StopRegular />
                                                                        ) : (
                                                                            <PlayRegular />
                                                                        )
                                                                    }
                                                                    onClick={() =>
                                                                        void handleRunToggle(
                                                                            env,
                                                                        )
                                                                    }
                                                                >
                                                                    {env.isRunning
                                                                        ? t('关闭环境', 'Stop')
                                                                        : t('启动环境', 'Launch')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <PanelRightRegular />
                                                                    }
                                                                    onClick={() => {
                                                                        onSelectEnv(
                                                                            env.id,
                                                                        );
                                                                        onToggleDetails(
                                                                            true,
                                                                        );
                                                                    }}
                                                                >
                                                                    {t('查看详情', 'Details')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <ShieldCheckmarkRegular />
                                                                    }
                                                                    onClick={() =>
                                                                        setHealthTargetId(
                                                                            env.id,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('安全自检', 'Health Check')}
                                                                </MenuItem>
                                                                {onClone && (
                                                                    <MenuItem
                                                                        icon={
                                                                            <CopyRegular />
                                                                        }
                                                                        onClick={() =>
                                                                            void onClone(
                                                                                env.id,
                                                                            )
                                                                        }
                                                                    >
                                                                        {t('克隆环境', 'Clone')}
                                                                    </MenuItem>
                                                                )}
                                                                <MenuItem
                                                                    icon={
                                                                        <FolderOpenRegular />
                                                                    }
                                                                    onClick={() =>
                                                                        void window.electronAPI?.chromeEnvironments?.openDataDir?.(
                                                                            env.id,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('打开数据目录', 'Open Folder')}
                                                                </MenuItem>
                                                                {env.proxyId && (
                                                                    <MenuItem
                                                                        icon={
                                                                            <DocumentTextRegular />
                                                                        }
                                                                        onClick={() =>
                                                                            onInspectProxyLogs(
                                                                                env.proxyId!,
                                                                            )
                                                                        }
                                                                    >
                                                                        {t('查看代理日志', 'Proxy Logs')}
                                                                    </MenuItem>
                                                                )}
                                                                <MenuDivider />
                                                                <MenuItem
                                                                    icon={
                                                                        <DeleteRegular />
                                                                    }
                                                                    style={{
                                                                        color: tokens.colorPaletteRedForeground1,
                                                                    }}
                                                                    onClick={() =>
                                                                        setDeleteTarget(
                                                                            env,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('移入回收站', 'Move to Trash')}
                                                                </MenuItem>
                                                            </MenuList>
                                                        </MenuPopover>
                                                    </Menu>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {isVirtualized && bottomSpacerHeight > 0 && (
                                    <tr
                                        aria-hidden="true"
                                        style={{
                                            height: `${bottomSpacerHeight}px`,
                                        }}
                                    >
                                        <td
                                            colSpan={visibleColumnCount}
                                            style={{
                                                padding: 0,
                                                border: 'none',
                                                height: `${bottomSpacerHeight}px`,
                                            }}
                                        />
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {detailsOpen && selectedEnv && (
                <EnvironmentDetailsPanel
                    key={selectedEnv.id}
                    environment={selectedEnv}
                    allEnvironments={effectiveAllEnvironments}
                    managedProxies={managedProxies}
                    groups={allGroups}
                    overlay={overlayDetails}
                    hasFingerprintKernel={hasFingerprintKernel}
                    onClose={() => onToggleDetails(false)}
                    onLaunch={onLaunch}
                    onStop={onClose}
                    onClone={onClone}
                    onInspectHealth={(env) => setHealthTargetId(env.id)}
                    onDelete={(env) => setDeleteTarget(env)}
                    onSave={onUpdateEnvironment}
                    onRegenerateFingerprint={onRegenerateFingerprint}
                    onInspectProxyLogs={onInspectProxyLogs}
                />
            )}

            {contextMenu && (
                <div
                    role="menu"
                    className={styles.contextMenu}
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const target = contextMenu.env;
                            setContextMenu(null);
                            void handleRunToggle(target);
                        }}
                    >
                        {contextMenu.env.isRunning ? (
                            <StopRegular />
                        ) : (
                            <PlayRegular />
                        )}
                        {contextMenu.env.isRunning
                            ? t('关闭环境', 'Stop Environment')
                            : t('启动环境', 'Launch Environment')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const target = contextMenu.env;
                            setContextMenu(null);
                            onSelectEnv(target.id);
                            onToggleDetails(true);
                        }}
                    >
                        <PanelRightRegular />
                        {t('查看详情', 'Details')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const targetId = contextMenu.env.id;
                            setContextMenu(null);
                            setHealthTargetId(targetId);
                        }}
                    >
                        <ShieldCheckmarkRegular />
                        {t('安全自检', 'Health Check')}
                    </button>
                    {onClone && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.contextMenuItem}
                            onClick={() => {
                                const target = contextMenu.env;
                                setContextMenu(null);
                                void onClone(target.id);
                            }}
                        >
                            <CopyRegular />
                            {t('克隆环境', 'Clone')}
                        </button>
                    )}
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const targetId = contextMenu.env.id;
                            setContextMenu(null);
                            void window.electronAPI?.chromeEnvironments?.openDataDir?.(
                                targetId,
                            );
                        }}
                    >
                        <FolderOpenRegular />
                        {t('打开数据目录', 'Open Folder')}
                    </button>
                    {contextMenu.env.proxyId && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.contextMenuItem}
                            onClick={() => {
                                const proxyId = contextMenu.env.proxyId!;
                                setContextMenu(null);
                                onInspectProxyLogs(proxyId);
                            }}
                        >
                            <DocumentTextRegular />
                            {t('查看代理日志', 'Proxy Logs')}
                        </button>
                    )}
                    <div className={styles.contextMenuSep} />
                    <button
                        type="button"
                        role="menuitem"
                        className={mergeClasses(
                            styles.contextMenuItem,
                            styles.contextMenuDanger,
                        )}
                        onClick={() => {
                            const target = contextMenu.env;
                            setContextMenu(null);
                            setDeleteTarget(target);
                        }}
                    >
                        <DeleteRegular />
                        {t('移入回收站', 'Move to Trash')}
                    </button>
                </div>
            )}

            <EnvironmentHealthDialog
                env={
                    healthTargetId
                        ? effectiveAllEnvironments.find(
                              (e) => e.id === healthTargetId,
                          ) || null
                        : null
                }
                onClose={() => setHealthTargetId(null)}
            />

            <Dialog
                open={closeAllConfirmOpen}
                onOpenChange={(_, data) => {
                    if (!data.open && !closingAll) setCloseAllConfirmOpen(false);
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t('一键关闭全部运行环境', 'Stop All Running Environments')}
                        </DialogTitle>
                        <DialogContent>
                            {isEn ? (
                                <>
                                    <strong>{allRunningCount}</strong> browser
                                    environment{allRunningCount > 1 ? 's are' : ' is'}{' '}
                                    currently running
                                    {resourceStats?.totalMemoryBytes
                                        ? ` (~${formatMemoryBytes(resourceStats.totalMemoryBytes)} RAM)`
                                        : ''}
                                    . Gracefully close all of them? Sessions and
                                    cookies will be preserved automatically.
                                </>
                            ) : (
                                <>
                                    当前共有 <strong>{allRunningCount}</strong>{' '}
                                    个浏览器环境正在运行
                                    {resourceStats?.totalMemoryBytes
                                        ? `（共占用内存约 ${formatMemoryBytes(resourceStats.totalMemoryBytes)}）`
                                        : ''}
                                    。确认优雅关闭全部环境并释放内存吗？各环境会话与
                                    Cookie 会自动落盘保留。
                                </>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={closingAll}
                                onClick={() => setCloseAllConfirmOpen(false)}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={closingAll}
                                onClick={() => void handleConfirmCloseAll()}
                            >
                                {closingAll
                                    ? t('关闭中…', 'Stopping…')
                                    : t('确认关闭全部', 'Stop All')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <Dialog
                open={deleteTarget !== null}
                onOpenChange={(_, data) => {
                    if (!data.open) setDeleteTarget(null);
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{t('移入回收站', 'Move to Trash')}</DialogTitle>
                        <DialogContent>
                            {isEn
                                ? `Move environment "${deleteTarget?.name}" to Trash? You can restore it anytime within 30 days.`
                                : `确定将环境“${deleteTarget?.name}”移入回收站吗？30 天内可在回收站随时恢复。`}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() => setDeleteTarget(null)}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    const target = deleteTarget;
                                    setDeleteTarget(null);
                                    if (target) {
                                        void onDelete(target.id);
                                    }
                                }}
                            >
                                {t('移入回收站', 'Move to Trash')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};

export default EnvironmentsPage;
