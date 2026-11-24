import React, { useState } from 'react';
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
    ErrorCircleRegular,
    PlayRegular,
    ShieldCheckmarkRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { ChromeEnvironment, LaunchConsistencyReport } from '../../types';
import { useI18n } from '../../i18n';

interface LaunchGuardDialogProps {
    env: ChromeEnvironment | null;
    report: LaunchConsistencyReport | null;
    onCancel: () => void;
    onAutoAlignAndLaunch: () => Promise<void>;
    onForceLaunch: () => Promise<void>;
}

const useStyles = makeStyles({
    issueList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginTop: '8px',
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
        marginTop: '10px',
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
    onCancel,
    onAutoAlignAndLaunch,
    onForceLaunch,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const [busy, setBusy] = useState<'align' | 'force' | null>(null);

    if (!env || !report) return null;

    const handleAlign = async () => {
        if (busy) return;
        setBusy('align');
        try {
            await onAutoAlignAndLaunch();
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
            <DialogSurface style={{ maxWidth: '520px', width: '92vw' }}>
                <DialogBody>
                    <DialogTitle>
                        {t('启动前一致性护栏', 'Pre-Launch Consistency Guard')} · {env.name}
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar
                            intent={report.hasError ? 'error' : 'warning'}
                            layout="multiline"
                        >
                            <MessageBarBody>
                                {report.hasError
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

                        <div className={styles.issueList}>
                            {report.issues.map((issue) => (
                                <div key={issue.id} className={styles.issueCard}>
                                    {issue.severity === 'error' ? (
                                        <ErrorCircleRegular
                                            className={styles.issueIconError}
                                        />
                                    ) : (
                                        <WarningRegular
                                            className={styles.issueIconWarn}
                                        />
                                    )}
                                    <div className={styles.issueText}>
                                        <div className={styles.issueTitle}>
                                            <span>{issue.title}</span>
                                            <Badge
                                                size="small"
                                                appearance="tint"
                                                color={
                                                    issue.severity === 'error'
                                                        ? 'danger'
                                                        : 'warning'
                                                }
                                            >
                                                {issue.severity === 'error'
                                                    ? t('阻断', 'Blocked')
                                                    : t('警告', 'Warning')}
                                            </Badge>
                                        </div>
                                        <div className={styles.issueDetail}>
                                            {issue.detail}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {report.exitSummary?.ip && (
                            <div className={styles.exitMeta}>
                                {isEn ? 'Proxy exit: IP ' : '代理出口参考：IP '}
                                {report.exitSummary.ip}
                                {report.exitSummary.countryCode
                                    ? isEn
                                        ? ` · Region ${report.exitSummary.countryCode}`
                                        : ` · 地区 ${report.exitSummary.countryCode}`
                                    : ''}
                                {report.exitSummary.timezone
                                    ? isEn
                                        ? ` · Timezone ${report.exitSummary.timezone}`
                                        : ` · 时区 ${report.exitSummary.timezone}`
                                    : ''}
                                {typeof report.exitSummary.latitude ===
                                    'number' &&
                                typeof report.exitSummary.longitude === 'number'
                                    ? ` · GPS ${report.exitSummary.latitude.toFixed(2)}, ${report.exitSummary.longitude.toFixed(2)}`
                                    : ''}
                            </div>
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
                        {!report.hasError && (
                            <Button
                                className={styles.actionBtn}
                                appearance="outline"
                                icon={<PlayRegular />}
                                disabled={!!busy}
                                onClick={() => void handleForce()}
                            >
                                {busy === 'force'
                                    ? t('启动中…', 'Launching…')
                                    : t('忽略警告直接启动', 'Launch Anyway')}
                            </Button>
                        )}
                        {report.canAutoAlign && (
                            <Button
                                className={styles.actionBtn}
                                appearance="primary"
                                icon={<ShieldCheckmarkRegular />}
                                disabled={!!busy}
                                onClick={() => void handleAlign()}
                            >
                                {busy === 'align'
                                    ? t('对齐并启动中…', 'Aligning & Launching…')
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
