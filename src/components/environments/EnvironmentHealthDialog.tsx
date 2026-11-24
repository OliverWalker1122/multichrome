import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
    environments?: ChromeEnvironment[];
    mode?: 'inspect' | 'launch';
    batchQueueCount?: number;
    onClose: () => void;
    onConfirmLaunch?: () => Promise<void> | void;
    onConfirmLaunchAll?: () => Promise<void> | void;
}

interface HealthCheckSlot {
    loading: boolean;
    report?: EnvironmentHealthReport;
    error?: string;
}

const useStyles = makeStyles({
    overviewList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginTop: '10px',
        maxHeight: '196px',
        overflowY: 'auto',
    },
    overviewRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-card-inner)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        color: tokens.colorNeutralForeground1,
        fontFamily: 'inherit',
    },
    overviewRowActive: {
        border: `1px solid ${tokens.colorBrandStroke1}`,
    },
    overviewLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        flex: 1,
    },
    overviewName: {
        fontSize: '13px',
        fontWeight: 600,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    overviewRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
    },
    overviewMeta: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        maxWidth: '180px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    detailHeader: {
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground2,
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginTop: '8px',
        maxHeight: '280px',
        overflowY: 'auto',
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

function sanitizeErrorMessage(err: unknown, fallback: string): string {
    return err instanceof Error
        ? err.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              '',
          )
        : fallback;
}

const EnvironmentHealthDialog: React.FC<EnvironmentHealthDialogProps> = ({
    env,
    environments,
    mode = 'inspect',
    onClose,
    onConfirmLaunch,
    onConfirmLaunchAll,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const [launching, setLaunching] = useState(false);
    const [slots, setSlots] = useState<Record<string, HealthCheckSlot>>({});
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const targets = useMemo(
        () =>
            environments && environments.length > 0
                ? environments
                : env
                  ? [env]
                  : [],
        [environments, env],
    );
    const targetsSignature = useMemo(
        () => targets.map((item) => item.id).join(','),
        [targets],
    );

    const runChecks = useCallback(
        async (list: ChromeEnvironment[]) => {
            if (!environmentApi.isAvailable() || list.length === 0) return;
            const initial: Record<string, HealthCheckSlot> = {};
            list.forEach((item) => {
                initial[item.id] = { loading: true };
            });
            setSlots(initial);

            let cursor = 0;
            const fallbackErr = t(
                '自检失败，请稍后重试',
                'Health check failed. Please try again.',
            );
            const workers = Array.from(
                { length: Math.min(4, list.length) },
                async () => {
                    while (cursor < list.length) {
                        const target = list[cursor];
                        cursor += 1;
                        try {
                            const report = await environmentApi.inspectHealth(
                                target.id,
                            );
                            setSlots((prev) => ({
                                ...prev,
                                [target.id]: {
                                    loading: false,
                                    report: report || undefined,
                                },
                            }));
                        } catch (err) {
                            setSlots((prev) => ({
                                ...prev,
                                [target.id]: {
                                    loading: false,
                                    error: sanitizeErrorMessage(err, fallbackErr),
                                },
                            }));
                        }
                    }
                },
            );
            await Promise.all(workers);
        },
        [t],
    );

    useEffect(() => {
        if (targets.length === 0) {
            setSlots({});
            setSelectedId(null);
            return;
        }
        setSelectedId((prev) =>
            prev && targets.some((item) => item.id === prev)
                ? prev
                : targets[0].id,
        );
        void runChecks(targets);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetsSignature, runChecks]);

    if (targets.length === 0) return null;

    const isBatch = targets.length > 1;
    const anyLoading = targets.some(
        (item) => slots[item.id]?.loading !== false,
    );
    const doneCount = targets.filter(
        (item) => slots[item.id] && !slots[item.id].loading,
    ).length;
    const passCount = targets.filter(
        (item) => slots[item.id]?.report?.overall === 'pass',
    ).length;
    const warnCount = targets.filter(
        (item) => slots[item.id]?.report?.overall === 'warn',
    ).length;
    const failCount = targets.filter(
        (item) =>
            Boolean(slots[item.id]?.error) ||
            slots[item.id]?.report?.overall === 'fail',
    ).length;

    const activeEnv =
        targets.find((item) => item.id === selectedId) || targets[0];
    const activeSlot = slots[activeEnv.id];
    const activeReport = activeSlot?.report || null;

    const handleConfirmSingleLaunch = async () => {
        if (!onConfirmLaunch || launching || anyLoading) return;
        setLaunching(true);
        try {
            await onConfirmLaunch();
        } finally {
            setLaunching(false);
        }
    };

    const handleConfirmBatchLaunch = async () => {
        const handler = onConfirmLaunchAll || onConfirmLaunch;
        if (!handler || launching || anyLoading) return;
        setLaunching(true);
        try {
            await handler();
        } finally {
            setLaunching(false);
        }
    };

    const batchIntent = anyLoading
        ? 'info'
        : failCount > 0
          ? 'error'
          : warnCount > 0
            ? 'warning'
            : 'success';

    return (
        <Dialog
            open={true}
            onOpenChange={(_, data) => {
                if (!data.open && !launching) onClose();
            }}
        >
            <DialogSurface style={{ maxWidth: '580px', width: '92vw' }}>
                <DialogBody>
                    <DialogTitle>
                        {isBatch
                            ? t('批量健康自检', 'Batch Health Check')
                            : `${t('健康自检', 'Health Check')} · ${activeEnv.name}`}
                        {isBatch && (
                            <Badge
                                size="small"
                                appearance="tint"
                                color="brand"
                                style={{ marginLeft: '8px' }}
                            >
                                {isEn
                                    ? `${targets.length} profiles`
                                    : `共 ${targets.length} 项`}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogContent>
                        {isBatch ? (
                            <>
                                <MessageBar
                                    intent={batchIntent}
                                    layout="multiline"
                                >
                                    <MessageBarBody>
                                        {anyLoading
                                            ? isEn
                                                ? `Checking ${targets.length} environments concurrently (${doneCount} completed)…`
                                                : `正在并发检测 ${targets.length} 个环境（已完成 ${doneCount} 项）…`
                                            : failCount > 0
                                              ? isEn
                                                  ? `Completed ${targets.length} checks: ${passCount} passed, ${warnCount} warnings, ${failCount} critical.`
                                                  : `已完成 ${targets.length} 个环境预检：通过 ${passCount} 项，注意 ${warnCount} 项，异常 ${failCount} 项。`
                                              : warnCount > 0
                                                ? isEn
                                                    ? `All ${targets.length} environments checked: ${passCount} passed, ${warnCount} with minor notices.`
                                                    : `全部 ${targets.length} 个环境预检完成：通过 ${passCount} 项，注意 ${warnCount} 项。`
                                                : isEn
                                                  ? `All ${targets.length} environments passed pre-launch checks and are ready to tile on screen.`
                                                  : `全部 ${targets.length} 个环境预检通过，启动后将自动并排平铺窗口。`}
                                    </MessageBarBody>
                                </MessageBar>

                                <div
                                    className={styles.overviewList}
                                    data-testid="batch-health-overview"
                                >
                                    {targets.map((item) => {
                                        const slot = slots[item.id];
                                        const rep = slot?.report;
                                        const isSelected =
                                            item.id === activeEnv.id;
                                        const exitSummary = rep?.summary.ip
                                            ? `${rep.summary.ip}${rep.summary.countryCode ? ` (${rep.summary.countryCode})` : ''}`
                                            : rep?.items[0]?.value || '';
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                data-testid="batch-health-row"
                                                className={`${styles.overviewRow} ${isSelected ? styles.overviewRowActive : ''}`}
                                                onClick={() =>
                                                    setSelectedId(item.id)
                                                }
                                            >
                                                <div
                                                    className={
                                                        styles.overviewLeft
                                                    }
                                                >
                                                    {!slot || slot.loading ? (
                                                        <Spinner size="tiny" />
                                                    ) : slot.error ||
                                                      rep?.overall === 'fail' ? (
                                                        <ErrorCircleRegular
                                                            className={
                                                                styles.iconFail
                                                            }
                                                        />
                                                    ) : rep?.overall ===
                                                      'warn' ? (
                                                        <WarningRegular
                                                            className={
                                                                styles.iconWarn
                                                            }
                                                        />
                                                    ) : (
                                                        <CheckmarkCircleRegular
                                                            className={
                                                                styles.iconPass
                                                            }
                                                        />
                                                    )}
                                                    <span
                                                        className={
                                                            styles.overviewName
                                                        }
                                                    >
                                                        {item.name}
                                                    </span>
                                                    <Badge
                                                        size="small"
                                                        appearance="tint"
                                                        color={
                                                            item.browserEngine ===
                                                            'fingerprint-chromium'
                                                                ? 'brand'
                                                                : 'informative'
                                                        }
                                                    >
                                                        {item.browserEngine ===
                                                        'fingerprint-chromium'
                                                            ? t(
                                                                  '隐私内核',
                                                                  'Privacy',
                                                              )
                                                            : 'Chrome'}
                                                    </Badge>
                                                </div>
                                                <div
                                                    className={
                                                        styles.overviewRight
                                                    }
                                                >
                                                    {exitSummary && (
                                                        <span
                                                            className={
                                                                styles.overviewMeta
                                                            }
                                                        >
                                                            {exitSummary}
                                                        </span>
                                                    )}
                                                    <Badge
                                                        size="small"
                                                        appearance="tint"
                                                        color={
                                                            !slot || slot.loading
                                                                ? 'informative'
                                                                : slot.error ||
                                                                    rep?.overall ===
                                                                        'fail'
                                                                  ? 'danger'
                                                                  : rep?.overall ===
                                                                      'warn'
                                                                    ? 'warning'
                                                                    : 'success'
                                                        }
                                                    >
                                                        {!slot || slot.loading
                                                            ? t(
                                                                  '检测中',
                                                                  'Checking',
                                                              )
                                                            : slot.error ||
                                                                rep?.overall ===
                                                                    'fail'
                                                              ? t('异常', 'Fail')
                                                              : rep?.overall ===
                                                                  'warn'
                                                                ? t(
                                                                      '注意',
                                                                      'Warn',
                                                                  )
                                                                : t(
                                                                      '通过',
                                                                      'Pass',
                                                                  )}
                                                    </Badge>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className={styles.detailHeader}>
                                    {isEn
                                        ? `Details · ${activeEnv.name}`
                                        : `检测明细 · ${activeEnv.name}`}
                                </div>
                            </>
                        ) : null}

                        {(!activeSlot || activeSlot.loading) && !activeReport ? (
                            <div className={styles.centerBox}>
                                <Spinner
                                    size="small"
                                    label={t(
                                        '正在按需启动代理并核验出口 IP、时区、语言、WebRTC 与指纹内核…',
                                        'Starting proxy on demand and verifying exit IP, timezone, language, WebRTC, and kernel…',
                                    )}
                                />
                            </div>
                        ) : activeSlot?.error ? (
                            <MessageBar
                                intent="error"
                                layout="multiline"
                                style={{ marginTop: isBatch ? '8px' : 0 }}
                            >
                                <MessageBarBody>
                                    {activeSlot.error}
                                </MessageBarBody>
                            </MessageBar>
                        ) : activeReport ? (
                            <>
                                {!isBatch && (
                                    <MessageBar
                                        intent={
                                            activeReport.overall === 'fail'
                                                ? 'error'
                                                : activeReport.overall === 'warn'
                                                  ? 'warning'
                                                  : 'success'
                                        }
                                        layout="multiline"
                                    >
                                        <MessageBarBody>
                                            {activeReport.overall === 'pass'
                                                ? t(
                                                      '检查通过：代理、时区、语言、防泄露与浏览器状态均正常。',
                                                      'All checks passed: Proxy, timezone, language, anti-leak, and browser are healthy.',
                                                  )
                                                : activeReport.overall === 'warn'
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
                                )}

                                <div className={styles.list}>
                                    {activeReport.items.map((item) => (
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
                                                    <span
                                                        className={styles.label}
                                                    >
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
                                                                  ? t(
                                                                        '注意',
                                                                        'Warn',
                                                                    )
                                                                  : t(
                                                                        '异常',
                                                                        'Fail',
                                                                    )}
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
                            appearance="subtle"
                            icon={<ArrowClockwiseRegular />}
                            disabled={anyLoading || launching}
                            onClick={() => void runChecks(targets)}
                        >
                            {anyLoading
                                ? t('检测中…', 'Checking…')
                                : t('重新检测', 'Recheck')}
                        </Button>
                        {mode === 'launch' &&
                        (onConfirmLaunch || onConfirmLaunchAll) ? (
                            <>
                                <Button
                                    className={styles.actionBtn}
                                    appearance="secondary"
                                    disabled={launching}
                                    onClick={onClose}
                                >
                                    {t('关闭', 'Close')}
                                </Button>
                                {isBatch ? (
                                    <Button
                                        className={styles.actionBtn}
                                        appearance="primary"
                                        icon={<PlayRegular />}
                                        disabled={anyLoading || launching}
                                        onClick={() =>
                                            void handleConfirmBatchLaunch()
                                        }
                                    >
                                        {launching
                                            ? t('启动中…', 'Launching…')
                                            : isEn
                                              ? `Launch All (${targets.length})`
                                              : `启动全部（${targets.length}）`}
                                    </Button>
                                ) : (
                                    <Button
                                        className={styles.actionBtn}
                                        appearance="primary"
                                        icon={<PlayRegular />}
                                        disabled={anyLoading || launching}
                                        onClick={() =>
                                            void handleConfirmSingleLaunch()
                                        }
                                    >
                                        {launching
                                            ? t('启动中…', 'Launching…')
                                            : activeReport?.overall === 'fail'
                                              ? t('仍要继续启动', 'Launch Anyway')
                                              : t('继续启动', 'Continue Launch')}
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
