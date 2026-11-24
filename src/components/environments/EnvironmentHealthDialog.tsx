import React, { useCallback, useEffect, useState } from 'react';
import {
    Badge,
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    MessageBar,
    MessageBarBody,
    Spinner,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CheckmarkCircleRegular,
    ErrorCircleRegular,
    PlayRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { ChromeEnvironment, EnvironmentHealthReport } from '../../types';
import { useI18n } from '../../i18n';
import { environmentApi } from '../../services';

interface EnvironmentHealthDialogProps {
    env: ChromeEnvironment | null;
    mode?: 'inspect' | 'launch';
    batchQueueCount?: number;
    onClose: () => void;
    onConfirmLaunch?: () => Promise<void> | void;
    onConfirmLaunchAll?: () => Promise<void> | void;
}

const useStyles = makeStyles({
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginTop: '10px',
    },
    row: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-card-inner)',
    },
    iconPass: {
        color: tokens.colorPaletteGreenForeground1,
        fontSize: '18px',
        marginTop: '1px',
        flexShrink: 0,
    },
    iconWarn: {
        color: tokens.colorPaletteYellowForeground2,
        fontSize: '18px',
        marginTop: '1px',
        flexShrink: 0,
    },
    iconFail: {
        color: tokens.colorPaletteRedForeground1,
        fontSize: '18px',
        marginTop: '1px',
        flexShrink: 0,
    },
    body: {
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        flex: 1,
        minWidth: 0,
    },
    topLine: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        flexWrap: 'wrap',
    },
    label: {
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
    },
    value: {
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
    },
    detail: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        lineHeight: '17px',
    },
    centerBox: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 12px',
    },
    actionBtn: {
        whiteSpace: 'nowrap',
        flexShrink: 0,
    },
});

const EnvironmentHealthDialog: React.FC<EnvironmentHealthDialogProps> = ({
    env,
    mode = 'inspect',
    batchQueueCount = 0,
    onClose,
    onConfirmLaunch,
    onConfirmLaunchAll,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [launching, setLaunching] = useState(false);
    const [error, setError] = useState('');
    const [report, setReport] = useState<EnvironmentHealthReport | null>(null);

    const runCheck = useCallback(async (envId: string) => {
        if (!environmentApi.isAvailable()) return;
        setLoading(true);
        setError('');
        try {
            const next = await environmentApi.inspectHealth(envId);
            if (next) {
                setReport(next);
            }
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message.replace(
                          /^Error invoking remote method '[^']+': (?:Error: )?/,
                          '',
                      )
                    : t('自检失败，请稍后重试', 'Health check failed. Please try again.'),
            );
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (env) {
            setReport(null);
            void runCheck(env.id);
        }
    }, [env, runCheck]);

    if (!env) return null;

    const handleConfirmLaunch = async () => {
        if (!onConfirmLaunch || launching || loading) return;
        setLaunching(true);
        try {
            await onConfirmLaunch();
        } finally {
            setLaunching(false);
        }
    };

    const handleConfirmLaunchAll = async () => {
        if (!onConfirmLaunchAll || launching || loading) return;
        setLaunching(true);
        try {
            await onConfirmLaunchAll();
        } finally {
            setLaunching(false);
        }
    };

    const showBatchLaunchAll =
        mode === 'launch' && batchQueueCount > 1 && Boolean(onConfirmLaunchAll);

    return (
        <Dialog
            open={true}
            onOpenChange={(_, data) => {
                if (!data.open && !launching) onClose();
            }}
        >
            <DialogSurface style={{ maxWidth: '560px', width: '92vw' }}>
                <DialogBody>
                    <DialogTitle>
                        {t('健康自检', 'Health Check')} · {env.name}
                        {showBatchLaunchAll && (
                            <Badge
                                size="small"
                                appearance="tint"
                                color="brand"
                                style={{ marginLeft: '8px' }}
                            >
                                {isEn
                                    ? `${batchQueueCount} queued`
                                    : `共 ${batchQueueCount} 项`}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogContent>
                        {loading && !report ? (
                            <div className={styles.centerBox}>
                                <Spinner
                                    size="small"
                                    label={t(
                                        '正在按需启动代理并核验出口 IP、时区、语言、WebRTC 与指纹内核…',
                                        'Starting proxy on demand and verifying exit IP, timezone, language, WebRTC, and kernel…',
                                    )}
                                />
                            </div>
                        ) : error ? (
                            <MessageBar intent="error" layout="multiline">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        ) : report ? (
                            <>
                                <MessageBar
                                    intent={
                                        report.overall === 'fail'
                                            ? 'error'
                                            : report.overall === 'warn'
                                              ? 'warning'
                                              : 'success'
                                    }
                                    layout="multiline"
                                >
                                    <MessageBarBody>
                                        {report.overall === 'pass'
                                            ? t(
                                                  '检查通过：代理、时区、语言、防泄露与浏览器状态均正常。',
                                                  'All checks passed: Proxy, timezone, language, anti-leak, and browser are healthy.',
                                              )
                                            : report.overall === 'warn'
                                              ? t(
                                                    '存在注意事项：部分项目需关注，或将在启动后自动对齐。',
                                                    'Warnings detected: Some items need attention or will auto-align after launch.',
                                                )
                                              : t(
                                                    '发现阻断性异常：请先修复标红项目后再使用此环境。',
                                                    'Critical issues detected: Resolve the red items before using this environment.',
                                                )}
                                    </MessageBarBody>
                                </MessageBar>

                                <div className={styles.list}>
                                    {report.items.map((item) => (
                                        <div key={item.id} className={styles.row}>
                                            {item.status === 'pass' ? (
                                                <CheckmarkCircleRegular
                                                    className={styles.iconPass}
                                                />
                                            ) : item.status === 'warn' ? (
                                                <WarningRegular
                                                    className={styles.iconWarn}
                                                />
                                            ) : (
                                                <ErrorCircleRegular
                                                    className={styles.iconFail}
                                                />
                                            )}
                                            <div className={styles.body}>
                                                <div className={styles.topLine}>
                                                    <span className={styles.label}>
                                                        {item.label}
                                                    </span>
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                        }}
                                                    >
                                                        <span
                                                            className={
                                                                styles.value
                                                            }
                                                        >
                                                            {item.value}
                                                        </span>
                                                        <Badge
                                                            size="small"
                                                            appearance="tint"
                                                            color={
                                                                item.status ===
                                                                'pass'
                                                                    ? 'success'
                                                                    : item.status ===
                                                                        'warn'
                                                                      ? 'warning'
                                                                      : 'danger'
                                                            }
                                                        >
                                                            {item.status ===
                                                            'pass'
                                                                ? t('通过', 'Pass')
                                                                : item.status ===
                                                                    'warn'
                                                                  ? t('注意', 'Warn')
                                                                  : t('异常', 'Fail')}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className={styles.detail}>
                                                    {item.detail}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : null}
                    </DialogContent>
                    <DialogActions fluid>
                        <Button
                            className={styles.actionBtn}
                            appearance="outline"
                            icon={<ArrowClockwiseRegular />}
                            disabled={loading || launching}
                            onClick={() => void runCheck(env.id)}
                        >
                            {loading
                                ? t('检测中…', 'Checking…')
                                : t('重新检测', 'Recheck')}
                        </Button>
                        {mode === 'launch' && onConfirmLaunch ? (
                            <>
                                <Button
                                    className={styles.actionBtn}
                                    appearance="secondary"
                                    disabled={launching}
                                    onClick={onClose}
                                >
                                    {t('关闭', 'Close')}
                                </Button>
                                <Button
                                    className={styles.actionBtn}
                                    appearance={
                                        showBatchLaunchAll ? 'outline' : 'primary'
                                    }
                                    icon={<PlayRegular />}
                                    disabled={loading || launching}
                                    onClick={() => void handleConfirmLaunch()}
                                >
                                    {launching
                                        ? t('启动中…', 'Launching…')
                                        : report?.overall === 'fail'
                                          ? t('仍要继续启动', 'Launch Anyway')
                                          : t('继续启动', 'Continue Launch')}
                                </Button>
                                {showBatchLaunchAll && (
                                    <Button
                                        className={styles.actionBtn}
                                        appearance="primary"
                                        icon={<PlayRegular />}
                                        disabled={loading || launching}
                                        onClick={() =>
                                            void handleConfirmLaunchAll()
                                        }
                                    >
                                        {isEn
                                            ? `Launch All (${batchQueueCount})`
                                            : `启动全部（${batchQueueCount}）`}
                                    </Button>
                                )}
                            </>
                        ) : (
                            <Button
                                className={styles.actionBtn}
                                appearance="primary"
                                onClick={onClose}
                            >
                                {t('关闭', 'Close')}
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export default EnvironmentHealthDialog;
