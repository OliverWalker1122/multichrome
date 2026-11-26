import React, { useMemo, useState } from 'react';
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
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import {
    CheckmarkCircleRegular,
    ErrorCircleRegular,
    PlayRegular,
    ShieldCheckmarkRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { ChromeEnvironment, LaunchConsistencyReport, LaunchGuardEntry } from '../../types';
import { useI18n } from '../../i18n';
import { canLaunchProfile } from '../../utils/launchPrecheck';
import { useNotification } from '../../contexts/NotificationContext';

interface LaunchGuardDialogProps {
    env: ChromeEnvironment | null;
    report: LaunchConsistencyReport | null;
    items?: LaunchGuardEntry[];
    onCancel: () => void;
    onAutoAlignAndLaunch: () => Promise<void>;
    onForceLaunch: () => Promise<void>;
    onRetry: () => Promise<void>;
}

const useStyles = makeStyles({
    issueList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginTop: '8px',
        maxHeight: '340px',
        overflowY: 'auto',
    },
    issueCard: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-card-inner)',
    },
    batchCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-card-inner)',
    },
    batchHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
    },
    batchHeadLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    batchEnvName: {
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    batchIssueLine: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
        lineHeight: '17px',
    },
    issueIconPass: {
        color: tokens.colorPaletteGreenForeground1,
        fontSize: '18px',
        flexShrink: 0,
    },
    issueIconError: {
        color: tokens.colorPaletteRedForeground1,
        fontSize: '18px',
        marginTop: '1px',
        flexShrink: 0,
    },
    issueIconWarn: {
        color: tokens.colorPaletteYellowForeground2,
        fontSize: '18px',
        marginTop: '1px',
        flexShrink: 0,
    },
    issueText: {
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        minWidth: 0,
    },
    issueTitle: {
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    issueDetail: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
        lineHeight: '18px',
    },
    exitMeta: {
        marginTop: '8px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    actionBtn: {
        whiteSpace: 'nowrap',
        flexShrink: 0,
    },
});

const LaunchGuardDialog: React.FC<LaunchGuardDialogProps> = ({
    env,
    report,
    items,
    onCancel,
    onAutoAlignAndLaunch,
    onForceLaunch,
    onRetry,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();
    const [busy, setBusy] = useState<'align' | 'force' | 'retry' | null>(null);

    const effectiveItems = useMemo<LaunchGuardEntry[]>(() => {
        if (items && items.length > 0) return items;
        if (env && report) return [{ env, report }];
        return [];
    }, [items, env, report]);

    if (effectiveItems.length === 0) return null;

    const isBatch = effectiveItems.length > 1;
    const primaryItem = effectiveItems[0];
    const hasAnyError = effectiveItems.some((entry) => entry.report.hasError);
    const launchableCount = effectiveItems.filter(canLaunchProfile).length;
    const incompleteCount = effectiveItems.filter((item) => item.incomplete).length;
    const blockedCount = effectiveItems.length - launchableCount - incompleteCount;
    const hasWarning = effectiveItems.some(({ report }) => !report.hasError && !report.ok);
    const anyCanAutoAlign = effectiveItems.some(
        (entry) => entry.report.canAutoAlign && !entry.report.hasError,
    );

    const handleAlign = async () => {
        if (busy) return;
        setBusy('align');
        try {
            await onAutoAlignAndLaunch();
        } catch {
            showNotification('error', t('无法完成配置调整，请检查配置后重试。', 'Configuration changes could not be completed. Review the settings and retry.'));
        } finally {
            setBusy(null);
        }
    };

    const handleForce = async () => {
        if (busy) return;
        setBusy('force');
        try {
            await onForceLaunch();
        } finally {
            setBusy(null);
        }
    };

    return (
        <Dialog
            open={true}
            onOpenChange={(_, data) => {
                if (!data.open && !busy) onCancel();
            }}
        >
            <DialogSurface style={{ maxWidth: '560px', width: '92vw' }}>
                <DialogBody>
                    <DialogTitle>
                        {isBatch
                            ? t('批量一致性预检', 'Batch Pre-Launch Check')
                            : `${t('启动前一致性护栏', 'Pre-Launch Consistency Guard')} · ${primaryItem.env.name}`}
                        {isBatch && (
                            <Badge
                                size="small"
                                appearance="tint"
                                color="brand"
                                style={{ marginLeft: '8px' }}
                            >
                                {isEn
                                    ? `${effectiveItems.length} profiles`
                                    : `共 ${effectiveItems.length} 项`}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar
                            intent={hasAnyError ? 'error' : hasWarning ? 'warning' : 'success'}
                            layout="multiline"
                        >
                            <MessageBarBody>
                                {isBatch
                                    ? t(`可启动 ${launchableCount} 项，已阻断 ${blockedCount} 项，未完成 ${incompleteCount} 项。`,
                                        `${launchableCount} can launch, ${blockedCount} blocked, ${incompleteCount} incomplete.`)
                                    : primaryItem.incomplete
                                      ? t('预检未完成，请重试。', 'The check did not complete. Please retry.')
                                      : primaryItem.report.ok
                                      ? t('预检通过，可以启动。', 'Checks passed. Ready to launch.')
                                      : primaryItem.report.hasError
                                      ? t(
                                            '检测到阻断性配置问题，请先修复后再启动环境。',
                                            'Blocking configuration issues detected. Fix them before launching.',
                                        )
                                      : t(
                                            '检测到环境配置与代理出口地区存在潜在不一致，继续启动可能增加关联或风控风险。',
                                            'Potential mismatch detected between environment config and proxy exit region. Launching may increase risk.',
                                        )}
                            </MessageBarBody>
                        </MessageBar>

                        {isBatch ? (
                            <div
                                className={styles.issueList}
                                data-testid="batch-guard-overview"
                            >
                                {effectiveItems.map(({ env: itemEnv, report: itemReport, incomplete }) => (
                                    <div
                                        key={itemEnv.id}
                                        className={styles.batchCard}
                                        data-testid="batch-guard-row"
                                    >
                                        <div className={styles.batchHead}>
                                            <div
                                                className={styles.batchHeadLeft}
                                            >
                                                {itemReport.hasError ? (
                                                    <ErrorCircleRegular
                                                        className={
                                                            styles.issueIconError
                                                        }
                                                    />
                                                ) : itemReport.issues.length >
                                                  0 ? (
                                                    <WarningRegular
                                                        className={
                                                            styles.issueIconWarn
                                                        }
                                                    />
                                                ) : (
                                                    <CheckmarkCircleRegular
                                                        className={
                                                            styles.issueIconPass
                                                        }
                                                    />
                                                )}
                                                <span
                                                    className={
                                                        styles.batchEnvName
                                                    }
                                                >
                                                    {itemEnv.name}
                                                </span>
                                                <Badge
                                                    size="small"
                                                    appearance="tint"
                                                    color={
                                                        itemEnv.browserEngine ===
                                                        'fingerprint-chromium'
                                                            ? 'brand'
                                                            : 'informative'
                                                    }
                                                >
                                                    {itemEnv.browserEngine ===
                                                    'fingerprint-chromium'
                                                        ? t('隐私内核', 'Privacy')
                                                        : 'Chrome'}
                                                </Badge>
                                            </div>
                                            <Badge
                                                size="small"
                                                appearance="tint"
                                                color={
                                                    itemReport.hasError
                                                        ? 'danger'
                                                        : itemReport.issues
                                                                .length > 0
                                                          ? 'warning'
                                                          : 'success'
                                                }
                                            >
                                                {incomplete ? t('未完成', 'Incomplete') : itemReport.hasError
                                                    ? t('阻断', 'Blocked')
                                                    : itemReport.issues.length >
                                                        0
                                                      ? t('注意', 'Notice')
                                                      : t('就绪', 'Ready')}
                                            </Badge>
                                        </div>
                                        {itemReport.issues.length === 0 ? (
                                            <div
                                                className={
                                                    styles.batchIssueLine
                                                }
                                            >
                                                {t(
                                                    '配置与代理出口一致，可直接启动。',
                                                    'Configuration matches proxy exit and is ready to launch.',
                                                )}
                                            </div>
                                        ) : (
                                            itemReport.issues.map((issue) => (
                                                <div
                                                    key={issue.id}
                                                    className={
                                                        styles.batchIssueLine
                                                    }
                                                >
                                                    <strong>
                                                        {issue.title}：
                                                    </strong>
                                                    {issue.detail}
                                                </div>
                                            ))
                                        )}
                                        {itemReport.exitSummary?.ip && (
                                            <div className={styles.exitMeta}>
                                                {isEn
                                                    ? 'Proxy exit: IP '
                                                    : '代理出口参考：IP '}
                                                {itemReport.exitSummary.ip}
                                                {itemReport.exitSummary
                                                    .countryCode
                                                    ? isEn
                                                        ? ` · Region ${itemReport.exitSummary.countryCode}`
                                                        : ` · 地区 ${itemReport.exitSummary.countryCode}`
                                                    : ''}
                                                {itemReport.exitSummary.timezone
                                                    ? isEn
                                                        ? ` · Timezone ${itemReport.exitSummary.timezone}`
                                                        : ` · 时区 ${itemReport.exitSummary.timezone}`
                                                    : ''}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <>
                                <div className={styles.issueList}>
                                    {primaryItem.report.issues.map((issue) => (
                                        <div
                                            key={issue.id}
                                            className={styles.issueCard}
                                        >
                                            {issue.severity === 'error' ? (
                                                <ErrorCircleRegular
                                                    className={
                                                        styles.issueIconError
                                                    }
                                                />
                                            ) : (
                                                <WarningRegular
                                                    className={
                                                        styles.issueIconWarn
                                                    }
                                                />
                                            )}
                                            <div className={styles.issueText}>
                                                <div
                                                    className={
                                                        styles.issueTitle
                                                    }
                                                >
                                                    <span>{issue.title}</span>
                                                    <Badge
                                                        size="small"
                                                        appearance="tint"
                                                        color={
                                                            issue.severity ===
                                                            'error'
                                                                ? 'danger'
                                                                : 'warning'
                                                        }
                                                    >
                                                        {issue.severity ===
                                                        'error'
                                                            ? t(
                                                                  '阻断',
                                                                  'Blocked',
                                                              )
                                                            : t(
                                                                  '警告',
                                                                  'Warning',
                                                              )}
                                                    </Badge>
                                                </div>
                                                <div
                                                    className={
                                                        styles.issueDetail
                                                    }
                                                >
                                                    {issue.detail}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {primaryItem.report.exitSummary?.ip && (
                                    <div className={styles.exitMeta}>
                                        {isEn
                                            ? 'Proxy exit: IP '
                                            : '代理出口参考：IP '}
                                        {primaryItem.report.exitSummary.ip}
                                        {primaryItem.report.exitSummary
                                            .countryCode
                                            ? isEn
                                                ? ` · Region ${primaryItem.report.exitSummary.countryCode}`
                                                : ` · 地区 ${primaryItem.report.exitSummary.countryCode}`
                                            : ''}
                                        {primaryItem.report.exitSummary.timezone
                                            ? isEn
                                                ? ` · Timezone ${primaryItem.report.exitSummary.timezone}`
                                                : ` · 时区 ${primaryItem.report.exitSummary.timezone}`
                                            : ''}
                                        {typeof primaryItem.report.exitSummary
                                            .latitude === 'number' &&
                                        typeof primaryItem.report.exitSummary
                                            .longitude === 'number'
                                            ? ` · GPS ${primaryItem.report.exitSummary.latitude.toFixed(2)}, ${primaryItem.report.exitSummary.longitude.toFixed(2)}`
                                            : ''}
                                    </div>
                                )}
                            </>
                        )}
                    </DialogContent>
                    <DialogActions fluid>
                        <Button
                            className={styles.actionBtn}
                            appearance="secondary"
                            disabled={!!busy}
                            onClick={onCancel}
                        >
                            {t('取消', 'Cancel')}
                        </Button>
                        {incompleteCount > 0 && (
                            <Button disabled={!!busy} onClick={async () => {
                                setBusy('retry');
                                try { await onRetry(); } finally { setBusy(null); }
                            }}>{busy === 'retry' ? t('检查中…', 'Checking…') : t('重新检查', 'Retry check')}</Button>
                        )}
                        {launchableCount > 0 && (
                            <Button
                                className={styles.actionBtn}
                                appearance={
                                    anyCanAutoAlign ? 'subtle' : 'primary'
                                }
                                icon={<PlayRegular />}
                                disabled={!!busy}
                                onClick={() => void handleForce()}
                            >
                                {busy === 'force'
                                    ? t('启动中…', 'Launching…')
                                    : isBatch
                                      ? isEn
                                          ? `Launch ${launchableCount} eligible`
                                          : `启动可用的 ${launchableCount} 项`
                                      : hasWarning ? t('忽略警告直接启动', 'Launch Anyway') : t('启动', 'Launch')}
                            </Button>
                        )}
                        {anyCanAutoAlign && (
                            <Button
                                className={styles.actionBtn}
                                appearance="primary"
                                icon={<ShieldCheckmarkRegular />}
                                disabled={!!busy}
                                onClick={() => void handleAlign()}
                            >
                                {busy === 'align'
                                    ? t('对齐并启动中…', 'Aligning & Launching…')
                                    : isBatch
                                      ? t(
                                            `对齐并启动可用的 ${launchableCount} 项`,
                                            `Align and launch ${launchableCount} eligible`,
                                        )
                                      : t('一键对齐并启动', 'Auto-Align & Launch')}
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export default LaunchGuardDialog;
