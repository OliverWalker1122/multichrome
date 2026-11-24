import React from 'react';
import {
    Badge,
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
    CopyRegular,
    DeleteRegular,
    DocumentTextRegular,
    FolderOpenRegular,
    MoreHorizontalRegular,
    PanelRightRegular,
    PlayFilled,
    PlayRegular,
    ShieldCheckmarkRegular,
    StopFilled,
    StopRegular,
} from '@fluentui/react-icons';
import dayjs from 'dayjs';
import type {
    ChromeEnvironment,
    ManagedProxy,
    OptionalEnvColumn,
} from '../../types';
import { formatMemoryBytes } from '../../hooks/useEnvironmentsWorkspace';
import { useI18n } from '../../i18n';
import { getGroupStyle, getToneStyle } from '../../theme/semanticColors';
import type { EnvironmentsStyles } from './environmentsStyles';

export interface EnvironmentTableRowProps {
    styles: EnvironmentsStyles;
    env: ChromeEnvironment;
    selected: boolean;
    narrowWindow: boolean;
    showGroupCol: boolean;
    showProxyCol: boolean;
    showLastUsedCol: boolean;
    activeOptionalCols: OptionalEnvColumn[];
    boundProxy: ManagedProxy | undefined;
    sharedProxyEnvs: ChromeEnvironment[];
    memoryBytes?: number;
    busy: boolean;
    selectionRowProps: React.HTMLAttributes<HTMLTableRowElement>;
    onSelect: () => void;
    onOpenDetails: () => void;
    onOpenContextMenu: (event: React.MouseEvent) => void;
    onToggleTagFilter: (tag: string) => void;
    onRunToggle: () => void;
    onInspectHealth: () => void;
    onClone?: () => void;
    onOpenDataDir: () => void;
    onInspectProxyLogs: (proxyId: string) => void;
    onDelete: () => void;
}

const EnvironmentTableRow: React.FC<EnvironmentTableRowProps> = ({
    styles,
    env,
    selected,
    narrowWindow,
    showGroupCol,
    showProxyCol,
    showLastUsedCol,
    activeOptionalCols,
    boundProxy,
    sharedProxyEnvs,
    memoryBytes,
    busy,
    selectionRowProps,
    onSelect,
    onOpenDetails,
    onOpenContextMenu,
    onToggleTagFilter,
    onRunToggle,
    onInspectHealth,
    onClone,
    onOpenDataDir,
    onInspectProxyLogs,
    onDelete,
}) => {
    const { isEn, t } = useI18n();

    const proxyDisplay = env.proxyId
        ? boundProxy
            ? boundProxy.name
            : t('代理已失效', 'Proxy Missing')
        : env.proxyLabel || env.proxy || t('全局默认', 'Global Default');
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
                    <span className={styles.namePrimary} title={env.name}>
                        <span className={styles.clippedLabel}>{env.name}</span>
                        {env.browserEngine === 'fingerprint-chromium' && (
                            <Badge
                                size="small"
                                appearance="outline"
                                color="brand"
                                style={{ flexShrink: 0 }}
                            >
                                {t('防关联', 'Privacy')}
                            </Badge>
                        )}
                    </span>
                    {Array.isArray(env.tags) && env.tags.length > 0 && (
                        <div className={styles.rowTagsWrap}>
                            {env.tags.slice(0, 3).map((tag) => (
                                <button
                                    key={tag}
                                    type="button"
                                    className={styles.rowTagChip}
                                    title={t(
                                        `按标签 #${tag} 筛选`,
                                        `Filter by tag #${tag}`,
                                    )}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onToggleTagFilter(tag);
                                    }}
                                >
                                    #{tag}
                                </button>
                            ))}
                            {env.tags.length > 3 && (
                                <Tooltip
                                    content={env.tags
                                        .map((tag) => `#${tag}`)
                                        .join(' ')}
                                    relationship="label"
                                >
                                    <span className={styles.rowTagMore}>
                                        +{env.tags.length - 3}
                                    </span>
                                </Tooltip>
                            )}
                        </div>
                    )}
                    {(narrowWindow || env.notes) && (
                        <span className={styles.nameSub}>
                            {narrowWindow
                                ? `${env.groupName} · ${proxyDisplay}`
                                : env.notes}
                        </span>
                    )}
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
                    {env.isRunning ? (
                        <Badge appearance="tint" color="success" size="small">
                            {t('运行中', 'Running')}
                        </Badge>
                    ) : (
                        <span className={styles.statusStopped}>
                            {t('未运行', 'Stopped')}
                        </span>
                    )}
                    {env.isRunning && memoryBytes && (
                        <span
                            style={{
                                fontSize: '11px',
                                color: tokens.colorNeutralForeground3,
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            {formatMemoryBytes(memoryBytes)}
                        </span>
                    )}
                </div>
            </td>
            {showGroupCol && (
                <td className={styles.td}>
                    <span
                        className={styles.groupLabel}
                        style={{ color: getGroupStyle(env.groupName).color }}
                        title={env.groupName}
                    >
                        <span aria-hidden="true" className={styles.groupDot} />
                        <span className={styles.clippedLabel}>
                            {env.groupName}
                        </span>
                    </span>
                </td>
            )}
            {showProxyCol && (
                <td
                    className={styles.td}
                    title={`${proxyDisplay}${proxySub ? ` (${proxySub})` : ''}`}
                >
                    <div className={styles.nameTextWrap}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                                minWidth: 0,
                            }}
                        >
                            <span
                                className={styles.clippedLabel}
                                style={{
                                    color:
                                        env.proxyId ||
                                        env.proxy ||
                                        env.proxyLabel
                                            ? undefined
                                            : tokens.colorNeutralForeground3,
                                }}
                            >
                                {proxyDisplay}
                            </span>
                            {env.proxyId && sharedProxyEnvs.length > 1 && (
                                <Tooltip
                                    content={
                                        isEn
                                            ? `Proxy reuse warning: ${sharedProxyEnvs.length} environments share this proxy (${sharedProxyEnvs.map((e) => e.name).join(', ')})`
                                            : `代理查重提醒：共 ${sharedProxyEnvs.length} 个环境共用此代理（${sharedProxyEnvs.map((e) => e.name).join('、')}）`
                                    }
                                    relationship="description"
                                >
                                    <span
                                        style={{
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            padding: '0 4px',
                                            borderRadius: '4px',
                                            flexShrink: 0,
                                            backgroundColor:
                                                tokens.colorPaletteYellowBackground1,
                                            color: tokens.colorPaletteYellowForeground2,
                                        }}
                                    >
                                        {isEn ? 'Shared×' : '共用×'}
                                        {sharedProxyEnvs.length}
                                    </span>
                                </Tooltip>
                            )}
                        </div>
                        {proxySub && (
                            <span
                                className={styles.proxySubRow}
                                style={
                                    boundProxy?.status === 'error'
                                        ? {
                                              color: getToneStyle('rose').color,
                                          }
                                        : undefined
                                }
                            >
                                {boundProxy?.status === 'running' && (
                                    <span className={styles.miniGreenDot} />
                                )}
                                <span
                                    style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}
                                >
                                    {proxySub}
                                </span>
                            </span>
                        )}
                    </div>
                </td>
            )}
            {activeOptionalCols.includes('timezone') && (
                <td
                    className={mergeClasses(styles.td, styles.muted)}
                    title={env.timezone || ''}
                >
                    {env.timezone || '-'}
                </td>
            )}
            {activeOptionalCols.includes('language') && (
                <td className={mergeClasses(styles.td, styles.muted)}>
                    {env.language || '-'}
                </td>
            )}
            {activeOptionalCols.includes('notes') && (
                <td
                    className={mergeClasses(styles.td, styles.muted)}
                    title={env.notes || ''}
                >
                    {env.notes || '-'}
                </td>
            )}
            {activeOptionalCols.includes('createdAt') && (
                <td className={mergeClasses(styles.td, styles.muted)}>
                    {env.createdAt
                        ? dayjs(env.createdAt).format('MM-DD HH:mm')
                        : '-'}
                </td>
            )}
            {activeOptionalCols.includes('id') && (
                <td
                    className={mergeClasses(styles.td, styles.mono)}
                    title={env.id}
                >
                    {env.id.slice(0, 8)}
                </td>
            )}
            {showLastUsedCol && (
                <td className={mergeClasses(styles.td, styles.muted)}>
                    {env.lastUsed
                        ? dayjs(env.lastUsed).format('MM-DD HH:mm')
                        : '-'}
                </td>
            )}
            <td
                className={styles.td}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={styles.actionCell}>
                    <Button
                        className={mergeClasses(
                            styles.runButton,
                            env.isRunning
                                ? styles.runButtonStop
                                : styles.runButtonLaunch,
                        )}
                        size="small"
                        appearance="secondary"
                        icon={
                            busy ? undefined : env.isRunning ? (
                                <StopFilled
                                    style={{
                                        fontSize: '9px',
                                        color: tokens.colorPaletteRedForeground1,
                                    }}
                                />
                            ) : (
                                <PlayFilled
                                    style={{
                                        fontSize: '10px',
                                        color: tokens.colorBrandForeground1,
                                    }}
                                />
                            )
                        }
                        disabled={busy}
                        onClick={onRunToggle}
                    >
                        {busy
                            ? t('处理中', 'Working')
                            : env.isRunning
                              ? t('关闭', 'Stop')
                              : t('启动', 'Launch')}
                    </Button>
                    <Menu positioning="below-end">
                        <MenuTrigger disableButtonEnhancement>
                            <Button
                                size="small"
                                appearance="subtle"
                                className="mc-environment-row-menu"
                                icon={<MoreHorizontalRegular />}
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
                                    onClick={onRunToggle}
                                >
                                    {env.isRunning
                                        ? t('关闭环境', 'Stop')
                                        : t('启动环境', 'Launch')}
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
                                    icon={<ShieldCheckmarkRegular />}
                                    onClick={onInspectHealth}
                                >
                                    {t('安全自检', 'Health Check')}
                                </MenuItem>
                                {onClone && (
                                    <MenuItem
                                        icon={<CopyRegular />}
                                        onClick={onClone}
                                    >
                                        {t('克隆环境', 'Clone')}
                                    </MenuItem>
                                )}
                                <MenuItem
                                    icon={<FolderOpenRegular />}
                                    onClick={onOpenDataDir}
                                >
                                    {t('打开数据目录', 'Open Folder')}
                                </MenuItem>
                                {env.proxyId && (
                                    <MenuItem
                                        icon={<DocumentTextRegular />}
                                        onClick={() =>
                                            onInspectProxyLogs(env.proxyId!)
                                        }
                                    >
                                        {t('查看代理日志', 'Proxy Logs')}
                                    </MenuItem>
                                )}
                                <MenuDivider />
                                <MenuItem
                                    icon={<DeleteRegular />}
                                    style={{
                                        color: tokens.colorPaletteRedForeground1,
                                    }}
                                    onClick={onDelete}
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
};

export default EnvironmentTableRow;
