import React from 'react';
import {
    Button,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Tooltip,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CodeRegular,
    DeleteRegular,
    DocumentTextRegular,
    EditRegular,
    LinkRegular,
    MoreHorizontalRegular,
    PanelRightRegular,
    PlayRegular,
    StopRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import type { ChromeEnvironment, ManagedProxy } from '../../types';
import { useI18n } from '../../i18n';
import { getProtocolStyle, getToneStyle } from '../../theme/semanticColors';
import ProxyExitInfo from './ProxyExitInfo';
import type { ProxiesStyles } from './proxiesStyles';

export function formatProtocolLabel(protocol: string): string {
    const lower = protocol.toLowerCase();
    if (lower === 'shadowsocks' || lower === 'ss') return 'Shadowsocks';
    if (lower === 'vmess') return 'VMess';
    if (lower === 'trojan') return 'Trojan';
    if (lower === 'hysteria2' || lower === 'hy2') return 'Hysteria2';
    if (
        lower === 'http' ||
        lower === 'https' ||
        lower === 'socks5' ||
        lower === 'vless' ||
        lower === 'tuic'
    ) {
        return lower.toUpperCase();
    }
    return protocol.toUpperCase();
}

export interface ProxyTableRowProps {
    styles: ProxiesStyles;
    proxy: ManagedProxy;
    assigned: ChromeEnvironment[];
    selected: boolean;
    narrowWindow: boolean;
    busy: string;
    refreshingExit: boolean;
    selectionRowProps: React.HTMLAttributes<HTMLTableRowElement>;
    onSelect: () => void;
    onOpenDetails: () => void;
    onOpenContextMenu: (event: React.MouseEvent) => void;
    onToggleService: () => void;
    onEdit: () => void;
    onAssign: () => void;
    onRefreshExit: () => void;
    onInspectLogs: () => void;
    onViewConfig: () => void;
    onDelete: () => void;
}

const ProxyTableRow: React.FC<ProxyTableRowProps> = ({
    styles,
    proxy,
    assigned,
    selected,
    narrowWindow,
    busy,
    refreshingExit,
    selectionRowProps,
    onSelect,
    onOpenDetails,
    onOpenContextMenu,
    onToggleService,
    onEdit,
    onAssign,
    onRefreshExit,
    onInspectLogs,
    onViewConfig,
    onDelete,
}) => {
    const { isEn, t } = useI18n();
    const inUseCount = assigned.filter((env) => env.isRunning).length;
    const inUse = inUseCount > 0;
    const running = proxy.status === 'running';
    const protocolLabel = formatProtocolLabel(proxy.protocol);

    return (
        <tr
            {...selectionRowProps}
            aria-selected={selected}
            className={mergeClasses(styles.row, selected && styles.rowSelected)}
            onClick={onSelect}
            onContextMenu={onOpenContextMenu}
            onDoubleClick={() => {
                onSelect();
                onOpenDetails();
            }}
        >
            <td className={styles.td}>
                <div className={styles.nameTextWrap}>
                    <span className={styles.namePrimary} title={proxy.name}>
                        {proxy.name}
                    </span>
                    <span className={styles.nameSub}>
                        <span
                            style={{
                                color: getProtocolStyle(proxy.protocol).color,
                            }}
                        >
                            {protocolLabel}
                        </span>
                        {proxy.host && proxy.port
                            ? ` · ${proxy.host}:${proxy.port}`
                            : ''}
                    </span>
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
                            : proxy.status === 'error'
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
                            proxy.status === 'error'
                                ? getToneStyle('rose')
                                : undefined
                        }
                        className={
                            running
                                ? styles.statusRunning
                                : proxy.status === 'error'
                                  ? styles.statusError
                                  : styles.statusStopped
                        }
                    >
                        {running
                            ? t('已启动', 'Running')
                            : proxy.status === 'error'
                              ? t('异常', 'Error')
                              : t('未启动', 'Stopped')}
                    </span>
                </Tooltip>
            </td>
            {!narrowWindow && (
                <td className={mergeClasses(styles.td, styles.numeric)}>
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
                                        style={{ fontSize: '11px' }}
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
                    refreshing={refreshingExit}
                    onRefresh={onRefreshExit}
                />
            </td>
            <td
                className={styles.td}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={styles.actionCell}>
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
                            appearance="subtle"
                            className={mergeClasses(
                                styles.runButton,
                                running
                                    ? styles.runButtonStop
                                    : styles.runButtonStart,
                            )}
                            icon={
                                busy === proxy.id ? undefined : running ? (
                                    <StopRegular style={{ fontSize: '13px' }} />
                                ) : (
                                    <PlayRegular style={{ fontSize: '13px' }} />
                                )
                            }
                            disabled={!!busy || (running && inUse)}
                            onClick={onToggleService}
                        >
                            {busy === proxy.id
                                ? t('处理中', 'Working')
                                : running
                                  ? t('停止', 'Stop')
                                  : t('启动', 'Start')}
                        </Button>
                    </Tooltip>
                    <Menu positioning="below-end">
                        <MenuTrigger disableButtonEnhancement>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<MoreHorizontalRegular />}
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
                                    disabled={!!busy || (running && inUse)}
                                    onClick={onToggleService}
                                >
                                    {running
                                        ? t('停止服务', 'Stop')
                                        : t('启动服务', 'Start')}
                                </MenuItem>
                                <MenuItem
                                    icon={<PanelRightRegular />}
                                    onClick={() => {
                                        onSelect();
                                        onOpenDetails();
                                    }}
                                >
                                    {t('查看详情', 'Details')}
                                </MenuItem>
                                <MenuItem
                                    icon={<EditRegular />}
                                    disabled={!!busy || running || inUse}
                                    onClick={onEdit}
                                >
                                    {t('编辑代理', 'Edit')}
                                </MenuItem>
                                <MenuItem
                                    icon={<LinkRegular />}
                                    disabled={!!busy}
                                    onClick={onAssign}
                                >
                                    {t('分配环境', 'Assign')}
                                </MenuItem>
                                <MenuItem
                                    icon={<ArrowClockwiseRegular />}
                                    disabled={
                                        !running ||
                                        proxy.exitInfo?.status === 'checking' ||
                                        refreshingExit
                                    }
                                    onClick={onRefreshExit}
                                >
                                    {t('检测出口 IP', 'Probe Exit IP')}
                                </MenuItem>
                                <MenuItem
                                    icon={<DocumentTextRegular />}
                                    onClick={onInspectLogs}
                                >
                                    {t('查看日志', 'Logs')}
                                </MenuItem>
                                <MenuItem
                                    icon={<CodeRegular />}
                                    disabled={!!busy}
                                    onClick={onViewConfig}
                                >
                                    {t('完整配置', 'Full Config')}
                                </MenuItem>
                                <MenuDivider />
                                <MenuItem
                                    icon={<DeleteRegular />}
                                    style={{
                                        color: tokens.colorPaletteRedForeground1,
                                    }}
                                    disabled={
                                        !!busy || running || assigned.length > 0
                                    }
                                    onClick={onDelete}
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
};

export default ProxyTableRow;
