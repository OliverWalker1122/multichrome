import React from 'react';
import {
    Badge,
    Button,
    MessageBar,
    MessageBarBody,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    CodeRegular,
    ArrowClockwiseRegular,
    CopyRegular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
    LinkRegular,
    PlayRegular,
    StopRegular,
} from '@fluentui/react-icons';
import { ChromeEnvironment, ManagedProxy } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { useDetailsKeyboard } from '../hooks/useDetailsKeyboard';
import ProxyExitInfo from './ProxyExitInfo';
import InfoTip from './InfoTip';
import { useI18n } from '../i18n';

interface ProxyDetailsPanelProps {
    proxy: ManagedProxy;
    assignedEnvironments: ChromeEnvironment[];
    overlay: boolean;
    busy: string;
    onClose: () => void;
    onToggleService: (proxy: ManagedProxy) => void;
    onEdit: (proxy: ManagedProxy) => void;
    onAssign: (proxy: ManagedProxy) => void;
    onViewConfig: (proxy: ManagedProxy) => void;
    onInspectLogs: (proxyId: string) => void;
    refreshingExit: boolean;
    onRefreshExit: (proxy: ManagedProxy) => void;
    onDelete: (proxy: ManagedProxy) => void;
}

const useStyles = makeStyles({
    backdrop: {
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.36)',
        zIndex: 20,
        display: 'flex',
        justifyContent: 'flex-end',
    },
    panel: {
        width: '348px',
        minWidth: '348px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--glass-drawer)',
        backdropFilter: 'blur(28px)',
        borderLeft: '1px solid var(--glass-border)',
        outline: 'none',
        overflow: 'hidden',
        flexShrink: 0,
    },
    panelOverlay: {
        width: 'min(380px, 92vw)',
        minWidth: 0,
        boxShadow: tokens.shadow28,
    },
    header: {
        padding: '12px 14px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
        flexShrink: 0,
    },
    titleWrap: {
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    title: {
        fontSize: '15px',
        fontWeight: 600,
        margin: 0,
        color: tokens.colorNeutralForeground1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    subRow: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
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
    actionsBar: {
        padding: '10px 14px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        flexShrink: 0,
    },
    body: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
    },
    card: {
        padding: '12px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    cardTitle: {
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    kvRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '10px',
        fontSize: '12px',
    },
    kvKey: {
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
    kvVal: {
        color: tokens.colorNeutralForeground1,
        textAlign: 'right',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    mono: {
        fontFamily: tokens.fontFamilyMonospace,
    },
    statusHint: {
        fontSize: '12px',
        lineHeight: '1.5',
        color: tokens.colorNeutralForeground3,
        margin: 0,
    },
    envItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '6px 8px',
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: '12px',
    },
    envName: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
});

const ProxyDetailsPanel: React.FC<ProxyDetailsPanelProps> = ({
    proxy,
    assignedEnvironments,
    overlay,
    busy,
    onClose,
    onToggleService,
    onEdit,
    onAssign,
    onViewConfig,
    onInspectLogs,
    refreshingExit,
    onRefreshExit,
    onDelete,
}) => {
    const styles = useStyles();
    const { locale, isEn, t } = useI18n();
    const keyboardProps = useDetailsKeyboard(overlay, onClose);
    const { showNotification } = useNotification();

    const running = proxy.status === 'running';
    const inUseEnvs = assignedEnvironments.filter((env) => env.isRunning);
    const inUse = inUseEnvs.length > 0;

    const copyLocalAddress = async () => {
        if (!proxy.localAddress) return;
        try {
            await navigator.clipboard.writeText(proxy.localAddress);
            showNotification(
                'success',
                t('已复制本地代理入口地址', 'Copied local proxy address'),
            );
        } catch {
            showNotification(
                'error',
                t(
                    '无法访问剪贴板，请手动复制',
                    'Clipboard unavailable. Please copy manually.',
                ),
            );
        }
    };

    const panelContent = (
        <aside
            {...keyboardProps}
            className={mergeClasses(
                styles.panel,
                overlay && styles.panelOverlay,
            )}
            aria-label={t('代理详情', 'Proxy details')}
            onClick={(event) => event.stopPropagation()}
        >
            <div className={styles.header}>
                <div className={styles.titleWrap}>
                    <div className={styles.titleRow}>
                        <span
                            className={mergeClasses(
                                styles.dot,
                                running
                                    ? styles.dotRunning
                                    : proxy.status === 'error'
                                      ? styles.dotError
                                      : styles.dotStopped,
                            )}
                        />
                        <h3 className={styles.title} title={proxy.name}>
                            {proxy.name}
                        </h3>
                    </div>
                    <div className={styles.subRow}>
                        <span>{proxy.protocol.toUpperCase()}</span>
                        <span>·</span>
                        <span>
                            {running
                                ? t('本地服务已启动', 'Local service running')
                                : proxy.status === 'error'
                                  ? t('启动异常', 'Start error')
                                  : t('本地服务未启动', 'Stopped')}
                        </span>
                    </div>
                </div>
                <Tooltip
                    content={t('关闭详情面板', 'Close details panel')}
                    relationship="label"
                >
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<DismissRegular />}
                        aria-label={t('关闭详情面板', 'Close details panel')}
                        onClick={onClose}
                    />
                </Tooltip>
            </div>

            <div className={styles.actionsBar}>
                <Tooltip
                    content={
                        running && inUse
                            ? t(
                                  '仍有运行中环境正在使用此代理，请先关闭浏览器',
                                  'Running environments are still using this proxy. Close them first.',
                              )
                            : ''
                    }
                    relationship="description"
                >
                    <Button
                        size="small"
                        appearance={running ? 'secondary' : 'primary'}
                        icon={running ? <StopRegular /> : <PlayRegular />}
                        disabled={!!busy || (running && inUse)}
                        onClick={() => onToggleService(proxy)}
                    >
                        {busy === proxy.id
                            ? t('处理中…', 'Working…')
                            : running
                              ? t('停止服务', 'Stop')
                              : t('启动服务', 'Start')}
                    </Button>
                </Tooltip>

                <Tooltip
                    content={
                        running || inUse
                            ? t(
                                  '请先停止代理服务再编辑配置',
                                  'Stop the proxy service before editing',
                              )
                            : t('编辑代理配置', 'Edit proxy config')
                    }
                    relationship="label"
                >
                    <Button
                        size="small"
                        appearance="outline"
                        icon={<EditRegular />}
                        disabled={!!busy || running || inUse}
                        onClick={() => onEdit(proxy)}
                    >
                        {t('编辑', 'Edit')}
                    </Button>
                </Tooltip>

                <Button
                    size="small"
                    appearance="outline"
                    icon={<CodeRegular />}
                    disabled={!!busy}
                    onClick={() => onViewConfig(proxy)}
                >
                    {t('完整配置', 'Config')}
                </Button>

                <div style={{ flex: 1 }} />

                <Tooltip
                    content={
                        assignedEnvironments.length > 0
                            ? t(
                                  '请先在环境中解除与此代理的绑定',
                                  'Unbind this proxy from all environments first',
                              )
                            : running
                              ? t(
                                    '请先停止代理服务再删除',
                                    'Stop the proxy service before deleting',
                                )
                              : t('删除代理', 'Delete proxy')
                    }
                    relationship="label"
                >
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        aria-label={t('删除代理', 'Delete proxy')}
                        disabled={
                            !!busy || running || assignedEnvironments.length > 0
                        }
                        onClick={() => onDelete(proxy)}
                    />
                </Tooltip>
            </div>

            <div className={styles.body}>
                {proxy.lastError && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>
                            {isEn
                                ? `${proxy.lastError}. Check outbound settings or inspect proxy logs below.`
                                : `${proxy.lastError}。请检查出口配置或查看下方运行日志定位原因。`}
                        </MessageBarBody>
                    </MessageBar>
                )}

                <div className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                            }}
                        >
                            {t('服务状态', 'Service Status')}
                            <InfoTip
                                content={t(
                                    '“已启动”表示本地代理入口已就绪，上游连通情况可查看运行日志或出口检测结果',
                                    '"Running" means the local listener is ready; verify upstream connectivity via logs or exit probe.',
                                )}
                            />
                        </span>
                        <Button
                            size="small"
                            appearance="transparent"
                            onClick={() => onInspectLogs(proxy.id)}
                        >
                            {t('查看日志', 'Logs')}
                        </Button>
                    </div>
                    <div className={styles.kvRow}>
                        <span className={styles.kvKey}>
                            {t('本地服务', 'Local Service')}
                        </span>
                        <Badge
                            appearance="tint"
                            color={
                                running
                                    ? 'success'
                                    : proxy.status === 'error'
                                      ? 'danger'
                                      : 'subtle'
                            }
                        >
                            {running
                                ? t('已启动', 'Running')
                                : proxy.status === 'error'
                                  ? t('异常', 'Error')
                                  : t('未启动', 'Stopped')}
                        </Badge>
                    </div>
                    <div className={styles.kvRow}>
                        <span className={styles.kvKey}>
                            {t('本地入口', 'Local Endpoint')}
                        </span>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                minWidth: 0,
                            }}
                        >
                            <span
                                className={mergeClasses(
                                    styles.kvVal,
                                    styles.mono,
                                )}
                                data-selectable="true"
                            >
                                {proxy.localAddress ||
                                    t('启动后自动分配', 'Assigned on start')}
                            </span>
                            {proxy.localAddress && (
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<CopyRegular />}
                                    aria-label={t('复制本地入口', 'Copy local endpoint')}
                                    onClick={() => void copyLocalAddress()}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                            }}
                        >
                            {t('出口 IP 与位置', 'Exit IP & Location')}
                            <InfoTip
                                content={t(
                                    '通过此代理实时探测出口 IP；位置仅供参考，动态代理可能随连接变化',
                                    'Probed via this proxy. Location is approximate; rotating proxies may change IP per connection.',
                                )}
                            />
                        </span>
                        <Tooltip
                            content={t(
                                '通过此代理重新检测出口（15 秒冷却）',
                                'Re-probe exit IP via this proxy (15s cooldown)',
                            )}
                            relationship="description"
                        >
                            <Button
                                size="small"
                                appearance="transparent"
                                icon={<ArrowClockwiseRegular />}
                                disabled={
                                    !running ||
                                    refreshingExit ||
                                    proxy.exitInfo?.status === 'checking'
                                }
                                onClick={() => onRefreshExit(proxy)}
                            >
                                {t('重新检测', 'Re-probe')}
                            </Button>
                        </Tooltip>
                    </div>
                    <ProxyExitInfo
                        proxy={proxy}
                        refreshing={refreshingExit}
                        onRefresh={() => onRefreshExit(proxy)}
                    />
                    {running && proxy.exitInfo?.checkedAt && (
                        <p className={styles.statusHint}>
                            {t('检测时间：', 'Checked: ')}
                            {new Date(proxy.exitInfo.checkedAt).toLocaleString(
                                locale,
                            )}
                        </p>
                    )}
                </div>

                <div className={styles.card}>
                    <div className={styles.cardTitle}>
                        {t('连接与配置', 'Connection & Config')}
                    </div>
                    <div className={styles.kvRow}>
                        <span className={styles.kvKey}>{t('协议', 'Protocol')}</span>
                        <span className={styles.kvVal}>
                            {proxy.protocol.toUpperCase()}
                        </span>
                    </div>
                    <div className={styles.kvRow}>
                        <span className={styles.kvKey}>
                            {t('出口目标', 'Upstream')}
                        </span>
                        <span
                            className={mergeClasses(styles.kvVal, styles.mono)}
                            title={
                                proxy.host && proxy.port
                                    ? `${proxy.host}:${proxy.port}`
                                    : 'sing-box JSON'
                            }
                            data-selectable="true"
                        >
                            {proxy.host && proxy.port
                                ? `${proxy.host}:${proxy.port}`
                                : t('由 sing-box JSON 定义', 'Defined in sing-box JSON')}
                        </span>
                    </div>
                    <div className={styles.kvRow}>
                        <span className={styles.kvKey}>
                            {t('配置模式', 'Config Mode')}
                        </span>
                        <span className={styles.kvVal}>
                            {proxy.mode === 'json'
                                ? 'sing-box JSON'
                                : t('标准代理表单', 'Standard Form')}
                        </span>
                    </div>
                    <div className={styles.kvRow}>
                        <span className={styles.kvKey}>
                            {t('认证信息', 'Credentials')}
                        </span>
                        <span className={styles.kvVal}>
                            {proxy.username || proxy.hasPassword
                                ? t('已加密保存', 'Saved (Encrypted)')
                                : t('无需认证', 'None')}
                        </span>
                    </div>
                </div>

                <div className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>
                            {isEn
                                ? `Bound Environments (${assignedEnvironments.length} bound · ${inUseEnvs.length} active)`
                                : `关联环境（已分配 ${assignedEnvironments.length} · 使用中 ${inUseEnvs.length}）`}
                        </span>
                        <Button
                            size="small"
                            appearance="transparent"
                            icon={<LinkRegular />}
                            disabled={!!busy}
                            onClick={() => onAssign(proxy)}
                        >
                            {t('分配', 'Assign')}
                        </Button>
                    </div>
                    {assignedEnvironments.length === 0 ? (
                        <p className={styles.statusHint}>
                            {t(
                                '尚未分配给任何环境。点击“分配”可将此代理绑定到已停止的环境。',
                                'Not bound to any environment yet. Click "Assign" to bind to stopped environments.',
                            )}
                        </p>
                    ) : (
                        assignedEnvironments.map((env) => (
                            <div key={env.id} className={styles.envItem}>
                                <span
                                    className={styles.envName}
                                    title={`${env.groupName} / ${env.name}`}
                                >
                                    <span
                                        className={mergeClasses(
                                            styles.dot,
                                            env.isRunning
                                                ? styles.dotRunning
                                                : styles.dotStopped,
                                        )}
                                    />
                                    <span>{env.name}</span>
                                    <span
                                        style={{
                                            color: tokens.colorNeutralForeground3,
                                        }}
                                    >
                                        ({env.groupName})
                                    </span>
                                </span>
                                <Badge
                                    size="small"
                                    appearance="tint"
                                    color={env.isRunning ? 'success' : 'subtle'}
                                >
                                    {env.isRunning
                                        ? t('使用中', 'Active')
                                        : t('已分配', 'Bound')}
                                </Badge>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </aside>
    );

    if (overlay) {
        return (
            <div className={styles.backdrop} onClick={onClose}>
                {panelContent}
            </div>
        );
    }

    return panelContent;
};

export default ProxyDetailsPanel;
