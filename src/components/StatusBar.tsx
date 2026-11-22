import React from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronUpRegular,
    TextBulletListSquareRegular,
} from '@fluentui/react-icons';
import { ProxyCoreInfo } from '../types';
import { getToneStyle } from '../theme/semanticColors';
import { useI18n } from '../i18n';

interface StatusBarProps {
    selectionLabel: string;
    logOpen: boolean;
    onToggleLog: () => void;
    onJumpToErrorLog: () => void;
    onOpenAppLogs: () => void;
    errorLogCount: number;
    coreInfo: ProxyCoreInfo | null;
    appVersion: string;
}

const useStyles = makeStyles({
    root: {
        height: '28px',
        minHeight: '28px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '0 14px 0 20px',
        backgroundColor: 'transparent',
        borderTop: '1px solid var(--glass-border)',
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
    },
    left: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    right: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
    },
    divider: {
        width: '1px',
        height: '12px',
        backgroundColor: tokens.colorNeutralStroke2,
    },
    logButton: {
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        padding: '2px 7px',
        borderRadius: tokens.borderRadiusSmall,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        transitionProperty: 'background-color, color',
        transitionDuration: '100ms',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:focus-visible': {
            outline: `1px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-1px',
        },
    },
    logGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
    },
    logButtonOpen: {
        color: tokens.colorBrandForeground1,
        backgroundColor: tokens.colorBrandBackground2,
        fontWeight: 600,
    },
    errorCountBtn: {
        border: 'none',
        padding: '0 6px',
        height: '18px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: '18px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transitionProperty: 'filter, transform',
        transitionDuration: '100ms',
        '&:hover': {
            filter: 'brightness(0.92)',
        },
        '&:active': {
            transform: 'scale(0.96)',
        },
        '&:focus-visible': {
            outline: `1px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '1px',
        },
    },
    version: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        '@media (max-width: 800px)': {
            display: 'none',
        },
    },
    dot: {
        width: '6px',
        height: '6px',
        borderRadius: '999px',
        flexShrink: 0,
    },
    dotGreen: {
        backgroundColor: tokens.colorPaletteGreenForeground1,
    },
    dotRed: {
        backgroundColor: tokens.colorPaletteRedForeground1,
    },
    coreWrap: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
    },
    coreUnavailable: {
        color: tokens.colorPaletteRedForeground1,
    },
    coreStatus: {
        '@media (max-width: 900px)': { display: 'none' },
    },
});

const StatusBar: React.FC<StatusBarProps> = ({
    selectionLabel,
    logOpen,
    onToggleLog,
    onJumpToErrorLog,
    onOpenAppLogs,
    errorLogCount,
    coreInfo,
    appVersion,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();

    return (
        <footer className={styles.root} aria-label={t('状态栏', 'Status bar')}>
            <div className={styles.left} title={selectionLabel}>
                {selectionLabel}
            </div>
            <div className={styles.right}>
                <div className={styles.logGroup}>
                    <button
                        type="button"
                        aria-pressed={logOpen}
                        className={mergeClasses(
                            styles.logButton,
                            logOpen && styles.logButtonOpen,
                        )}
                        onClick={onToggleLog}
                    >
                        <span>{t('代理日志', 'Proxy Logs')}</span>
                        {logOpen ? (
                            <ChevronDownRegular style={{ fontSize: '12px' }} />
                        ) : (
                            <ChevronUpRegular style={{ fontSize: '12px' }} />
                        )}
                    </button>
                    {errorLogCount > 0 && (
                        <button
                            type="button"
                            className={styles.errorCountBtn}
                            style={getToneStyle('rose')}
                            onClick={onJumpToErrorLog}
                            aria-label={
                                isEn
                                    ? `Jump to ${errorLogCount} error log(s)`
                                    : `点击定位 ${errorLogCount} 条错误日志`
                            }
                            title={
                                isEn
                                    ? `Jump to ${errorLogCount} error log(s)`
                                    : `点击定位 ${errorLogCount} 条错误日志`
                            }
                        >
                            {errorLogCount}
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    className={styles.logButton}
                    onClick={onOpenAppLogs}
                    aria-haspopup="dialog"
                >
                    <TextBulletListSquareRegular style={{ fontSize: '14px' }} />
                    <span>{t('后台日志', 'App Logs')}</span>
                </button>
                <span
                    className={mergeClasses(styles.divider, styles.coreStatus)}
                    aria-hidden="true"
                />
                <span
                    className={mergeClasses(
                        styles.coreWrap,
                        styles.coreStatus,
                        Boolean(coreInfo && !coreInfo.available) &&
                            styles.coreUnavailable,
                    )}
                    title={
                        coreInfo?.configDirectory ||
                        t('sing-box 核心状态', 'sing-box core status')
                    }
                >
                    {coreInfo && (
                        <span
                            className={mergeClasses(
                                styles.dot,
                                coreInfo.available
                                    ? styles.dotGreen
                                    : styles.dotRed,
                            )}
                        />
                    )}
                    {coreInfo
                        ? coreInfo.available
                            ? `sing-box ${coreInfo.version || t('就绪', 'Ready')}`
                            : t(
                                  'sing-box 未安装（前往设置下载）',
                                  'sing-box not installed (download in Settings)',
                              )
                        : t('sing-box 检测中', 'Checking sing-box')}
                </span>
                {appVersion && (
                    <span className={styles.version}>
                        <span className={styles.divider} aria-hidden="true" />
                        <span className={styles.coreWrap}>v{appVersion}</span>
                    </span>
                )}
            </div>
        </footer>
    );
};

export default StatusBar;
