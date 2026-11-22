import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Select,
    Spinner,
    Textarea,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowClockwiseRegular,
    ArrowImportRegular,
    ArrowSortRegular,
    CodeRegular,
    DeleteRegular,
    DismissRegular,
    DocumentTextRegular,
    EditRegular,
    GlobeRegular,
    LinkRegular,
    MoreHorizontalRegular,
    PanelRightRegular,
    PlayRegular,
    PulseRegular,
    SearchRegular,
    StopRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import {
    BatchImportProxiesResult,
    ChromeEnvironment,
    ManagedProxy,
    ProxyConfigView,
    ProxyCoreInfo,
    ProxyInput,
} from '../types';
import { useNotification } from '../contexts/NotificationContext';
import ProxyDetailsPanel from './ProxyDetailsPanel';
import ProxyExitInfo from './ProxyExitInfo';
import ProxyEditorDrawer, {
    ProxyEditorState,
    createEmptyProxyEditor,
} from './ProxyEditorDrawer';
import ProxyConfigDrawer from './ProxyConfigDrawer';
import ColumnResizeHandle from './ColumnResizeHandle';
import {
    useSavedTableValue,
    useTableSelection,
} from '../hooks/useTableWorkspace';
import { getProtocolStyle, getToneStyle } from '../theme/semanticColors';
import { tr, useI18n } from '../i18n';

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

function errorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              '',
          )
        : tr('操作失败，请稍后重试', 'Operation failed. Please try again.');
}

function formatProtocolLabel(protocol: string): string {
    const lower = protocol.toLowerCase();
    if (lower === 'shadowsocks' || lower === 'ss') return 'Shadowsocks';
    if (
        lower === 'http' ||
        lower === 'https' ||
        lower === 'socks5' ||
        lower === 'vless' ||
        lower === 'vmess' ||
        lower === 'tuic'
    ) {
        return lower.toUpperCase();
    }
    return protocol.toUpperCase();
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
        padding: '16px 20px 10px 20px',
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
        fontWeight: 600,
        lineHeight: '28px',
        margin: 0,
        color: tokens.colorNeutralForeground1,
    },
    subtitle: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    alerts: {
        padding: '0 20px 10px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flexShrink: 0,
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 20px 10px 20px',
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
    },
    thRight: {
        textAlign: 'right',
    },
    row: {
        height: '48px',
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
    },
    nameCell: {
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        minWidth: 0,
    },
    proxyIcon: {
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
    dotError: {
        backgroundColor: tokens.colorPaletteRedForeground1,
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
    statusError: {
        color: tokens.colorPaletteRedForeground1,
        fontWeight: 600,
        fontSize: '13px',
        borderRadius: '5px',
        padding: '3px 7px',
    },
    statusStopped: {
        color: tokens.colorNeutralForeground2,
        fontSize: '13px',
    },
    numeric: {
        fontVariantNumeric: 'tabular-nums',
        color: tokens.colorNeutralForeground2,
        fontSize: '13px',
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
        minWidth: '176px',
        padding: '4px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
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
        '&:hover:not(:disabled)': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
        '&:disabled': {
            opacity: 0.45,
            cursor: 'not-allowed',
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
});

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
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<
        'all' | 'running' | 'stopped'
    >('all');
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
    const [sortBy, setSortBy] = useSavedTableValue<
        'original' | 'name' | 'status'
    >(
        'multichrome.proxy.sortBy',
        'original',
        (value): value is 'original' | 'name' | 'status' =>
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
    const [batchImportOpen, setBatchImportOpen] = useState(false);
    const [batchText, setBatchText] = useState('');
    const [batchPrefix, setBatchPrefix] = useState(() =>
        tr('代理', 'Proxy'),
    );
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

    const { selected: selectedProxy, rowProps } = useTableSelection(
        filtered,
        selectedProxyId,
        onSelectProxy,
        () => onToggleDetails(true),
    );
    const runningCount = proxies.filter(
        (proxy) => proxy.status === 'running',
    ).length;

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
            running
                ? window.electronAPI.proxies.stop(proxy.id)
                : window.electronAPI.proxies.start(proxy.id),
        );
    };

    const refreshExitInfo = async (proxy: ManagedProxy) => {
        if (
            proxy.status !== 'running' ||
            proxy.exitInfo?.status === 'checking' ||
            exitRequests.current.has(proxy.id)
        )
            return;
        exitRequests.current.add(proxy.id);
        setRefreshingExitIds(new Set(exitRequests.current));
        try {
            await window.electronAPI.proxies.refreshExitInfo(proxy.id);
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
            const result = await window.electronAPI.proxies.batchImport({
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
            } else if (result.skippedDuplicates.length > 0 && result.errors.length === 0) {
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
                        await window.electronAPI.proxies.start(target.id);
                    }
                    const exit =
                        await window.electronAPI.proxies.refreshExitInfo(
                            target.id,
                        );
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
            const details = await window.electronAPI.proxies.getEditor(
                proxy.id,
            );
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
            mode,
        };
        if (mode !== 'json' || !editor.id) {
            setEditor(next);
            return;
        }
        setBusy('convert');
        try {
            const details = await window.electronAPI.proxies.getEditor(
                editor.id,
                true,
            );
            setEditor({ ...next, config: details.config || '' });
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
        const identity = { id: editor.id, name: editor.name.trim() };
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
            const saved = await window.electronAPI.proxies.save(input);
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
            // 保留草稿不关闭编辑面板
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
            const view = await window.electronAPI.proxies.getConfig(id, reveal);
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
                                ? `${proxies.length} proxies · ${runningCount} running`
                                : `${proxies.length} 个代理 · ${runningCount} 项服务已启动`}
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <Tooltip
                            content={t(
                                '启动未运行的代理并刷新当前列表所有代理的出口 IP、地区与延迟',
                                'Start stopped proxies and probe exit IP, region, and latency for all listed proxies',
                            )}
                            relationship="description"
                        >
                            <Button
                                appearance="outline"
                                icon={<PulseRegular />}
                                disabled={
                                    !!busy ||
                                    !!batchChecking ||
                                    filtered.length === 0 ||
                                    (coreInfo ? !coreInfo.available : false)
                                }
                                onClick={() => void handleBatchCheckAll()}
                            >
                                {batchChecking
                                    ? isEn
                                        ? `Checking (${batchChecking.done}/${batchChecking.total})`
                                        : `测活中 (${batchChecking.done}/${batchChecking.total})`
                                    : t('批量测活', 'Batch Check')}
                            </Button>
                        </Tooltip>
                        <Button
                            appearance="outline"
                            icon={<ArrowImportRegular />}
                            disabled={!!busy || !!batchChecking}
                            onClick={() => {
                                setBatchResult(null);
                                setBatchImportOpen(true);
                            }}
                        >
                            {t('批量导入', 'Batch Import')}
                        </Button>
                        <Button
                            appearance="primary"
                            icon={<AddRegular />}
                            disabled={!!busy || !!batchChecking}
                            onClick={() => void openEditor()}
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
                            '搜索代理名称、协议或出口 IP',
                            'Search by proxy name, protocol, or exit IP',
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
                                        : `已启动 (${runningCount})`,
                                ],
                                [
                                    'stopped',
                                    isEn
                                        ? `Stopped (${proxies.length - runningCount})`
                                        : `未启动 (${proxies.length - runningCount})`,
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
                        <Menu positioning="below-end">
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    appearance="outline"
                                    icon={<ArrowSortRegular />}
                                    aria-label={t('代理排序方式', 'Sort proxies')}
                                />
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        onClick={() => setSortBy('original')}
                                    >
                                        {t('添加顺序', 'Order Added')}{' '}
                                        {sortBy === 'original' ? '✓' : ''}
                                    </MenuItem>
                                    <MenuItem onClick={() => setSortBy('name')}>
                                        {t('名称升序', 'Name (A–Z)')}{' '}
                                        {sortBy === 'name' ? '✓' : ''}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() => setSortBy('status')}
                                    >
                                        {t('运行状态', 'Status')}{' '}
                                        {sortBy === 'status' ? '✓' : ''}
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
                ) : filtered.length === 0 ? (
                    <div className={styles.emptyState}>
                        <GlobeRegular style={{ fontSize: '36px' }} />
                        <span
                            style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: tokens.colorNeutralForeground1,
                            }}
                        >
                            {search.trim()
                                ? t('未找到匹配的代理', 'No matching proxies')
                                : t('还没有配置代理', 'No proxies configured yet')}
                        </span>
                        <span style={{ fontSize: '12px' }}>
                            {search.trim()
                                ? t(
                                      '尝试更换代理名称、协议或出口 IP 关键词。',
                                      'Try a different name, protocol, or exit IP keyword.',
                                  )
                                : t(
                                      'HTTP / SOCKS5 支持粘贴一行地址；VLESS、Shadowsocks、TUIC 等支持 sing-box 出口 JSON。',
                                      'Paste a single line for HTTP/SOCKS5, or sing-box outbound JSON for VLESS, Shadowsocks, TUIC, and more.',
                                  )}
                        </span>
                        {!search.trim() && (
                            <Button
                                appearance="primary"
                                icon={<AddRegular />}
                                onClick={() => void openEditor()}
                            >
                                {t('添加代理', 'Add Proxy')}
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className={styles.tableWrap}>
                        <table
                            className={styles.table}
                            aria-label={t('代理列表', 'Proxies table')}
                            style={{
                                minWidth: narrowWindow ? 600 : nameWidth + 620,
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
                                                min={200}
                                                onChange={setNameWidth}
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
                                        {t('出口 IP / 位置', 'Exit IP / Location')}
                                    </th>
                                    <th
                                        className={mergeClasses(
                                            styles.th,
                                            styles.thRight,
                                        )}
                                        style={{ width: '116px' }}
                                    >
                                        {t('操作', 'Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((proxy, index) => {
                                    const assigned =
                                        envBindingsByProxy.get(proxy.id) || [];
                                    const inUseCount = assigned.filter(
                                        (env) => env.isRunning,
                                    ).length;
                                    const inUse = inUseCount > 0;
                                    const running = proxy.status === 'running';
                                    const selected =
                                        selectedProxy?.id === proxy.id;
                                    const protocolLabel = formatProtocolLabel(
                                        proxy.protocol,
                                    );

                                    return (
                                        <tr
                                            key={proxy.id}
                                            {...rowProps(proxy, index)}
                                            aria-selected={selected}
                                            className={mergeClasses(
                                                styles.row,
                                                selected && styles.rowSelected,
                                            )}
                                            onClick={() =>
                                                onSelectProxy(proxy.id)
                                            }
                                            onContextMenu={(event) => {
                                                event.preventDefault();
                                                onSelectProxy(proxy.id);
                                                const menuWidth = 184;
                                                const menuHeight = 270;
                                                const x = Math.min(
                                                    event.clientX,
                                                    window.innerWidth -
                                                        menuWidth -
                                                        8,
                                                );
                                                const y = Math.min(
                                                    event.clientY,
                                                    window.innerHeight -
                                                        menuHeight -
                                                        8,
                                                );
                                                setContextMenu({
                                                    proxy,
                                                    x: Math.max(8, x),
                                                    y: Math.max(8, y),
                                                });
                                            }}
                                            onDoubleClick={() => {
                                                onSelectProxy(proxy.id);
                                                onToggleDetails(true);
                                            }}
                                        >
                                            <td className={styles.td}>
                                                <div
                                                    className={styles.nameCell}
                                                >
                                                    <span
                                                        className={
                                                            styles.proxyIcon
                                                        }
                                                        style={getProtocolStyle(
                                                            proxy.protocol,
                                                        )}
                                                        aria-hidden="true"
                                                    >
                                                        <GlobeRegular />
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
                                                            title={proxy.name}
                                                        >
                                                            {proxy.name}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.nameSub
                                                            }
                                                        >
                                                            <span
                                                                style={{
                                                                    color: getProtocolStyle(
                                                                        proxy.protocol,
                                                                    ).color,
                                                                }}
                                                            >
                                                                {protocolLabel}
                                                            </span>
                                                            {proxy.host &&
                                                            proxy.port
                                                                ? ` · ${proxy.host}:${proxy.port}`
                                                                : ''}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className={styles.td}>
                                                <Tooltip
                                                    content={
                                                        running
                                                            ? t(
                                                                  '本地代理入口已启动（上游连通请结合底部连接日志确认）',
                                                                  'Local proxy listener is running (check logs below for upstream status)',
                                                              )
                                                            : proxy.status ===
                                                                'error'
                                                              ? proxy.lastError ||
                                                                t(
                                                                    '服务启动失败，请查看运行日志',
                                                                    'Service failed to start. Check logs.',
                                                                )
                                                              : t(
                                                                    '本地代理服务未启动，打开已绑定环境时会自动启动',
                                                                    'Stopped — starts automatically when launching a bound environment',
                                                                )
                                                    }
                                                    relationship="description"
                                                >
                                                    <span
                                                        style={
                                                            proxy.status ===
                                                            'error'
                                                                ? getToneStyle(
                                                                      'rose',
                                                                  )
                                                                : undefined
                                                        }
                                                        className={
                                                            running
                                                                ? styles.statusRunning
                                                                : proxy.status ===
                                                                    'error'
                                                                  ? styles.statusError
                                                                  : styles.statusStopped
                                                        }
                                                    >
                                                        {running
                                                            ? t('已启动', 'Running')
                                                            : proxy.status ===
                                                                'error'
                                                              ? t('异常', 'Error')
                                                              : t('未启动', 'Stopped')}
                                                    </span>
                                                </Tooltip>
                                            </td>
                                            {!narrowWindow && (
                                                <td
                                                    className={mergeClasses(
                                                        styles.td,
                                                        styles.numeric,
                                                    )}
                                                >
                                                    <Tooltip
                                                        content={
                                                            assigned.length > 1
                                                                ? isEn
                                                                    ? `Warning: ${assigned.length} environments share this proxy: ${assigned.map((e) => e.name).join(', ')} (${inUseCount} active)`
                                                                    : `注意：以下 ${assigned.length} 个环境共用同一代理，可能存在关联风险：${assigned.map((e) => e.name).join('、')}（使用中 ${inUseCount} 个）`
                                                                : isEn
                                                                  ? `Bound: ${assigned.length}${assigned.length === 1 ? ` (${assigned[0].name})` : ''} · Active: ${inUseCount}`
                                                                  : `已分配环境：${assigned.length} 个${assigned.length === 1 ? `（${assigned[0].name}）` : ''} · 使用中环境：${inUseCount} 个`
                                                        }
                                                        relationship="description"
                                                    >
                                                        <span
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                            }}
                                                        >
                                                            <span>
                                                                {isEn
                                                                    ? `Bound ${assigned.length} · Active ${inUseCount}`
                                                                    : `已分配 ${assigned.length} · 使用中 ${inUseCount}`}
                                                            </span>
                                                            {assigned.length > 1 && (
                                                                <span
                                                                    style={{
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '2px',
                                                                        fontSize: '11px',
                                                                        fontWeight: 600,
                                                                        padding: '1px 5px',
                                                                        borderRadius: '4px',
                                                                        backgroundColor:
                                                                            tokens.colorPaletteYellowBackground1,
                                                                        color: tokens.colorPaletteYellowForeground2,
                                                                    }}
                                                                >
                                                                    <WarningRegular
                                                                        style={{
                                                                            fontSize:
                                                                                '11px',
                                                                        }}
                                                                    />
                                                                    {t('复用', 'Shared')}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </Tooltip>
                                                </td>
                                            )}
                                            <td className={styles.td}>
                                                <ProxyExitInfo
                                                    proxy={proxy}
                                                    refreshing={refreshingExitIds.has(
                                                        proxy.id,
                                                    )}
                                                    onRefresh={() =>
                                                        void refreshExitInfo(
                                                            proxy,
                                                        )
                                                    }
                                                />
                                            </td>
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
                                                    <Tooltip
                                                        content={
                                                            running && inUse
                                                                ? t(
                                                                      '仍有使用中的环境，请先关闭对应浏览器',
                                                                      'Environments are still using this proxy. Close them first.',
                                                                  )
                                                                : ''
                                                        }
                                                        relationship="description"
                                                    >
                                                        <Button
                                                            size="small"
                                                            appearance={
                                                                running
                                                                    ? 'secondary'
                                                                    : 'outline'
                                                            }
                                                            disabled={
                                                                !!busy ||
                                                                (running &&
                                                                    inUse)
                                                            }
                                                            onClick={() =>
                                                                handleToggleService(
                                                                    proxy,
                                                                )
                                                            }
                                                        >
                                                            {busy === proxy.id
                                                                ? t('处理中', 'Working')
                                                                : running
                                                                  ? t('停止', 'Stop')
                                                                  : t('启动', 'Start')}
                                                        </Button>
                                                    </Tooltip>
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
                                                                        ? `More actions for ${proxy.name}`
                                                                        : `更多操作 ${proxy.name}`
                                                                }
                                                            />
                                                        </MenuTrigger>
                                                        <MenuPopover>
                                                            <MenuList>
                                                                <MenuItem
                                                                    icon={
                                                                        running ? (
                                                                            <StopRegular />
                                                                        ) : (
                                                                            <PlayRegular />
                                                                        )
                                                                    }
                                                                    disabled={
                                                                        !!busy ||
                                                                        (running &&
                                                                            inUse)
                                                                    }
                                                                    onClick={() =>
                                                                        void handleToggleService(
                                                                            proxy,
                                                                        )
                                                                    }
                                                                >
                                                                    {running
                                                                        ? t('停止服务', 'Stop')
                                                                        : t('启动服务', 'Start')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <PanelRightRegular />
                                                                    }
                                                                    onClick={() => {
                                                                        onSelectProxy(
                                                                            proxy.id,
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
                                                                        <EditRegular />
                                                                    }
                                                                    disabled={
                                                                        !!busy ||
                                                                        running ||
                                                                        inUse
                                                                    }
                                                                    onClick={() =>
                                                                        void openEditor(
                                                                            proxy,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('编辑代理', 'Edit')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <LinkRegular />
                                                                    }
                                                                    disabled={
                                                                        !!busy
                                                                    }
                                                                    onClick={() => {
                                                                        setAssignProxy(
                                                                            proxy,
                                                                        );
                                                                        setAssignEnvironmentId(
                                                                            '',
                                                                        );
                                                                    }}
                                                                >
                                                                    {t('分配环境', 'Assign')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <ArrowClockwiseRegular />
                                                                    }
                                                                    disabled={
                                                                        !running ||
                                                                        proxy
                                                                            .exitInfo
                                                                            ?.status ===
                                                                            'checking' ||
                                                                        refreshingExitIds.has(
                                                                            proxy.id,
                                                                        )
                                                                    }
                                                                    onClick={() =>
                                                                        void refreshExitInfo(
                                                                            proxy,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('检测出口 IP', 'Probe Exit IP')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <DocumentTextRegular />
                                                                    }
                                                                    onClick={() =>
                                                                        onInspectLogs(
                                                                            proxy.id,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('查看日志', 'Logs')}
                                                                </MenuItem>
                                                                <MenuItem
                                                                    icon={
                                                                        <CodeRegular />
                                                                    }
                                                                    disabled={
                                                                        !!busy
                                                                    }
                                                                    onClick={() =>
                                                                        void loadConfig(
                                                                            proxy.id,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('完整配置', 'Full Config')}
                                                                </MenuItem>
                                                                <MenuDivider />
                                                                <MenuItem
                                                                    icon={
                                                                        <DeleteRegular />
                                                                    }
                                                                    style={{
                                                                        color: tokens.colorPaletteRedForeground1,
                                                                    }}
                                                                    disabled={
                                                                        !!busy ||
                                                                        running ||
                                                                        assigned.length >
                                                                            0
                                                                    }
                                                                    onClick={() =>
                                                                        setDeleteProxy(
                                                                            proxy,
                                                                        )
                                                                    }
                                                                >
                                                                    {t('删除代理', 'Delete')}
                                                                </MenuItem>
                                                            </MenuList>
                                                        </MenuPopover>
                                                    </Menu>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {detailsOpen && selectedProxy && (
                <ProxyDetailsPanel
                    proxy={selectedProxy}
                    assignedEnvironments={
                        envBindingsByProxy.get(selectedProxy.id) || []
                    }
                    overlay={overlayDetails}
                    busy={busy}
                    onClose={() => onToggleDetails(false)}
                    onToggleService={handleToggleService}
                    onEdit={(proxy) => void openEditor(proxy)}
                    onAssign={(proxy) => {
                        setAssignProxy(proxy);
                        setAssignEnvironmentId('');
                    }}
                    onViewConfig={(proxy) => void loadConfig(proxy.id)}
                    onInspectLogs={onInspectLogs}
                    refreshingExit={refreshingExitIds.has(selectedProxy.id)}
                    onRefreshExit={(proxy) => void refreshExitInfo(proxy)}
                    onDelete={(proxy) => setDeleteProxy(proxy)}
                />
            )}

            <ProxyEditorDrawer
                editor={editor}
                onChange={setEditor}
                onSwitchMode={switchEditorMode}
                onSubmit={saveProxy}
                onClose={() => setEditor(null)}
                formError={formError}
                busy={busy}
                coreInfo={coreInfo}
            />

            <ProxyConfigDrawer
                proxyId={configProxyId}
                proxies={proxies}
                configView={configView}
                loading={configLoading}
                error={configError}
                onSelectProxy={(id) => void loadConfig(id)}
                onToggleReveal={() =>
                    configProxyId &&
                    void loadConfig(configProxyId, !!configView?.redacted)
                }
                onCopy={() => void copyConfig()}
                onClose={closeConfig}
            />

            {/* 批量导入代理 */}
            <Dialog
                open={batchImportOpen}
                onOpenChange={(_, data) => {
                    if (!data.open && !busy) setBatchImportOpen(false);
                }}
            >
                <DialogSurface style={{ maxWidth: '580px', width: '92vw' }}>
                    <DialogBody>
                        <DialogTitle>{t('批量导入代理', 'Batch Import Proxies')}</DialogTitle>
                        <DialogContent
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                            }}
                        >
                            <Field
                                label={t('代理列表（每行一条）', 'Proxy List (one per line)')}
                                hint={t(
                                    '支持 protocol://账号:密码@主机:端口、主机:端口:账号:密码、主机:端口；也支持“自定义名称 | 代理地址”格式，以 # 或 // 开头的注释行会自动忽略。',
                                    'Supports protocol://user:pass@host:port, host:port:user:pass, host:port, and "Custom Name | address". Lines starting with # or // are ignored.',
                                )}
                            >
                                <Textarea
                                    rows={7}
                                    resize="vertical"
                                    placeholder={
                                        'US-Res-1 | socks5://user:pass@1.2.3.4:1080\nhttp://user:pass@5.6.7.8:8080\n9.10.11.12:3128:alice:secret'
                                    }
                                    value={batchText}
                                    onChange={(_, data) =>
                                        setBatchText(data.value)
                                    }
                                />
                            </Field>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-end',
                                    gap: '12px',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <Field
                                    label={t('默认命名前缀', 'Default Name Prefix')}
                                    style={{ flex: 1, minWidth: '180px' }}
                                >
                                    <Input
                                        value={batchPrefix}
                                        onChange={(_, data) =>
                                            setBatchPrefix(data.value)
                                        }
                                        placeholder={t(
                                            '留空则使用 主机:端口',
                                            'Leave blank to use host:port',
                                        )}
                                    />
                                </Field>
                                <Checkbox
                                    checked={batchSkipDuplicates}
                                    onChange={(_, data) =>
                                        setBatchSkipDuplicates(
                                            Boolean(data.checked),
                                        )
                                    }
                                    label={t('自动跳过重复代理', 'Skip duplicates')}
                                />
                            </div>
                            {batchResult && (
                                <MessageBar
                                    intent={
                                        batchResult.errors.length > 0
                                            ? 'warning'
                                            : 'success'
                                    }
                                    layout="multiline"
                                >
                                    <MessageBarBody>
                                        <div>
                                            {isEn ? (
                                                <>
                                                    Result: Imported{' '}
                                                    <strong>{batchResult.imported.length}</strong>, skipped{' '}
                                                    <strong>{batchResult.skippedDuplicates.length}</strong>{' '}
                                                    duplicate(s), failed{' '}
                                                    <strong>{batchResult.errors.length}</strong>.
                                                </>
                                            ) : (
                                                <>
                                                    导入结果：成功{' '}
                                                    <strong>{batchResult.imported.length}</strong>{' '}
                                                    条，跳过重复{' '}
                                                    <strong>{batchResult.skippedDuplicates.length}</strong>{' '}
                                                    条，失败{' '}
                                                    <strong>{batchResult.errors.length}</strong>{' '}
                                                    条。
                                                </>
                                            )}
                                        </div>
                                        {batchResult.errors.length > 0 && (
                                            <div
                                                style={{
                                                    marginTop: '6px',
                                                    fontSize: '12px',
                                                    maxHeight: '100px',
                                                    overflowY: 'auto',
                                                }}
                                            >
                                                {batchResult.errors.map(
                                                    (item) => (
                                                        <div
                                                            key={`${item.lineNumber}-${item.raw}`}
                                                        >
                                                            {isEn
                                                                ? `Line ${item.lineNumber}: ${item.error} (${item.raw})`
                                                                : `第 ${item.lineNumber} 行：${item.error}（${item.raw}）`}
                                                        </div>
                                                    ),
                                                )}
                                            </div>
                                        )}
                                    </MessageBarBody>
                                </MessageBar>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busy}
                                onClick={() => setBatchImportOpen(false)}
                            >
                                {t('关闭', 'Close')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busy || !batchText.trim()}
                                onClick={() => void handleBatchImport()}
                            >
                                {busy === 'batch-import'
                                    ? t('校验并导入中…', 'Importing…')
                                    : t('开始导入', 'Import')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* 分配代理给环境 */}
            <Dialog
                open={assignProxy !== null}
                onOpenChange={(_, data) => {
                    if (!data.open && !busy) setAssignProxy(null);
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {isEn
                                ? `Assign Proxy: ${assignProxy?.name}`
                                : `分配代理：${assignProxy?.name}`}
                        </DialogTitle>
                        <DialogContent>
                            {assignProxy &&
                                (envBindingsByProxy.get(assignProxy.id) || [])
                                    .length > 0 && (
                                    <MessageBar
                                        intent="warning"
                                        layout="multiline"
                                        style={{ marginBottom: '12px' }}
                                    >
                                        <MessageBarBody>
                                            {isEn
                                                ? `Already bound to ${(envBindingsByProxy.get(assignProxy.id) || []).length} environment(s) (${(envBindingsByProxy.get(assignProxy.id) || []).map((e) => e.name).join(', ')}). Sharing a proxy may cause exit IP correlation.`
                                                : `此代理已被 ${(envBindingsByProxy.get(assignProxy.id) || []).length} 个环境绑定（${(envBindingsByProxy.get(assignProxy.id) || []).map((e) => e.name).join('、')}）。多个环境共用同一代理可能导致出口 IP 关联。`}
                                        </MessageBarBody>
                                    </MessageBar>
                                )}
                            <Field
                                label={t('选择目标环境', 'Target Environment')}
                                hint={t(
                                    '此代理将优先于该环境的手动代理和全局默认代理。仅可为未运行的环境分配。',
                                    'Takes priority over manual and global proxies. Only stopped environments can be assigned.',
                                )}
                            >
                                <Select
                                    value={assignEnvironmentId}
                                    onChange={(_, data) =>
                                        setAssignEnvironmentId(data.value)
                                    }
                                >
                                    <option value="">
                                        {t(
                                            '请选择已停止的环境',
                                            'Select a stopped environment',
                                        )}
                                    </option>
                                    {environments.map((env) => (
                                        <option
                                            key={env.id}
                                            value={env.id}
                                            disabled={env.isRunning}
                                        >
                                            {env.groupName} / {env.name}
                                            {env.isRunning
                                                ? t('（运行中）', ' (Running)')
                                                : ''}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busy}
                                onClick={() => setAssignProxy(null)}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busy || !assignEnvironmentId}
                                onClick={() => {
                                    if (!assignProxy || !assignEnvironmentId)
                                        return;
                                    void runAction('assign', async () => {
                                        await window.electronAPI.chromeEnvironments.update(
                                            assignEnvironmentId,
                                            { proxyId: assignProxy.id },
                                        );
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
                                }}
                            >
                                {busy === 'assign'
                                    ? t('保存中…', 'Saving…')
                                    : t('确认分配', 'Assign')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* 删除代理确认 */}
            <Dialog
                open={deleteProxy !== null}
                onOpenChange={(_, data) => {
                    if (!data.open && !busy) setDeleteProxy(null);
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{t('删除代理', 'Delete Proxy')}</DialogTitle>
                        <DialogContent>
                            {isEn
                                ? `Permanently delete proxy "${deleteProxy?.name}" and its saved encrypted credentials? This cannot be undone.`
                                : `确定要永久删除代理“${deleteProxy?.name}”及其保存的加密认证信息吗？此操作无法撤销。`}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busy}
                                onClick={() => setDeleteProxy(null)}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busy}
                                onClick={() => {
                                    if (!deleteProxy) return;
                                    const targetId = deleteProxy.id;
                                    void runAction('delete', async () => {
                                        await window.electronAPI.proxies.remove(
                                            targetId,
                                        );
                                        if (selectedProxyId === targetId)
                                            onSelectProxy(null);
                                        setDeleteProxy(null);
                                        showNotification(
                                            'success',
                                            t('代理已删除', 'Proxy deleted'),
                                        );
                                    });
                                }}
                            >
                                {t('确认删除', 'Delete')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {contextMenu &&
                (() => {
                    const target = contextMenu.proxy;
                    const assigned = envBindingsByProxy.get(target.id) || [];
                    const inUse = assigned.some((env) => env.isRunning);
                    const running = target.status === 'running';
                    return (
                        <div
                            className={styles.contextMenu}
                            role="menu"
                            style={{
                                left: contextMenu.x,
                                top: contextMenu.y,
                            }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={!!busy || (running && inUse)}
                                onClick={() => {
                                    setContextMenu(null);
                                    void handleToggleService(target);
                                }}
                            >
                                {running ? <StopRegular /> : <PlayRegular />}
                                {running
                                    ? t('停止服务', 'Stop')
                                    : t('启动服务', 'Start')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                onClick={() => {
                                    setContextMenu(null);
                                    onSelectProxy(target.id);
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
                                disabled={!!busy || running || inUse}
                                onClick={() => {
                                    setContextMenu(null);
                                    void openEditor(target);
                                }}
                            >
                                <EditRegular />
                                {t('编辑代理', 'Edit')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={!!busy}
                                onClick={() => {
                                    setContextMenu(null);
                                    setAssignProxy(target);
                                    setAssignEnvironmentId('');
                                }}
                            >
                                <LinkRegular />
                                {t('分配环境', 'Assign')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={
                                    !running ||
                                    target.exitInfo?.status === 'checking' ||
                                    refreshingExitIds.has(target.id)
                                }
                                onClick={() => {
                                    setContextMenu(null);
                                    void refreshExitInfo(target);
                                }}
                            >
                                <ArrowClockwiseRegular />
                                {t('检测出口 IP', 'Probe Exit IP')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                onClick={() => {
                                    setContextMenu(null);
                                    onInspectLogs(target.id);
                                }}
                            >
                                <DocumentTextRegular />
                                {t('查看日志', 'Logs')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={!!busy}
                                onClick={() => {
                                    setContextMenu(null);
                                    void loadConfig(target.id);
                                }}
                            >
                                <CodeRegular />
                                {t('完整配置', 'Full Config')}
                            </button>
                            <div className={styles.contextMenuSep} />
                            <button
                                type="button"
                                role="menuitem"
                                className={mergeClasses(
                                    styles.contextMenuItem,
                                    styles.contextMenuDanger,
                                )}
                                disabled={
                                    !!busy || running || assigned.length > 0
                                }
                                onClick={() => {
                                    setContextMenu(null);
                                    setDeleteProxy(target);
                                }}
                            >
                                <DeleteRegular />
                                {t('删除代理', 'Delete')}
                            </button>
                        </div>
                    );
                })()}
        </div>
    );
};

export default ProxiesPage;
