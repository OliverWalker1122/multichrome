import React from 'react';
import {
    Button,
    Tooltip,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { ManagedProxy } from '../../types';
import { useI18n } from '../../i18n';

const useStyles = makeStyles({
    root: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 },
    text: { display: 'flex', flexDirection: 'column', minWidth: 0 },
    ip: {
        fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: tokens.colorNeutralForeground1,
    },
    location: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    hint: { fontSize: '12px', color: tokens.colorNeutralForeground3 },
    error: { fontSize: '12px', color: tokens.colorPaletteRedForeground1 },
});

const ProxyExitInfo: React.FC<{
    proxy: ManagedProxy;
    refreshing: boolean;
    onRefresh: () => void;
}> = ({ proxy, refreshing, onRefresh }) => {
    const styles = useStyles();
    const { locale, isEn, t } = useI18n();
    const info = proxy.exitInfo;
    if (proxy.status !== 'running')
        return <span className={styles.hint}>{t('启动后检测', 'Probe on start')}</span>;
    if (refreshing || info?.status === 'checking')
        return <span className={styles.hint}>{t('检测中…', 'Probing…')}</span>;
    if (info?.status === 'ready' && info.ip) {
        const location =
            [info.country, info.city || info.region]
                .filter(Boolean)
                .join(' · ') || t('位置未知', 'Unknown location');
        const latencyText =
            typeof info.latencyMs === 'number' && info.latencyMs > 0
                ? ` · ${info.latencyMs}ms`
                : '';
        const checkedStr = info.checkedAt
            ? ` · ${new Date(info.checkedAt).toLocaleString(locale)}`
            : '';
        const tooltip = isEn
            ? `${info.ip} · ${location}${latencyText}${checkedStr} (probed via this proxy)`
            : `${info.ip} · ${location}${latencyText}${checkedStr}，通过此代理检测`;
        return (
            <Tooltip content={tooltip} relationship="description">
                <span className={styles.text} tabIndex={0}>
                    <span className={styles.ip} data-selectable="true">
                        {info.ip}
                    </span>
                    <span className={styles.location}>
                        {location}
                        {latencyText}
                    </span>
                </span>
            </Tooltip>
        );
    }
    return (
        <span className={styles.root}>
            <Tooltip
                content={
                    info?.error ||
                    t(
                        '通过此代理检测出口 IP 和位置',
                        'Probe exit IP and location via this proxy',
                    )
                }
                relationship="description"
            >
                <span
                    tabIndex={info?.status === 'error' ? 0 : undefined}
                    className={
                        info?.status === 'error' ? styles.error : styles.hint
                    }
                >
                    {info?.status === 'error'
                        ? t('检测失败', 'Probe failed')
                        : t('等待检测', 'Pending')}
                </span>
            </Tooltip>
            <Button
                size="small"
                appearance="subtle"
                icon={<ArrowClockwiseRegular />}
                aria-label={
                    isEn
                        ? `Re-probe exit for ${proxy.name}`
                        : `重新检测出口 ${proxy.name}`
                }
                onClick={(event) => {
                    event.stopPropagation();
                    onRefresh();
                }}
            />
        </span>
    );
};

export default ProxyExitInfo;
