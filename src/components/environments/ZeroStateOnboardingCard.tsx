import React from 'react';
import {
    Badge,
    Button,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import {
    AddRegular,
    BoxRegular,
    GlobeRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import { useI18n } from '../../i18n';
import { getToneStyle } from '../../theme/semanticColors';
import InfoTip from '../common/InfoTip';

export interface ZeroStateOnboardingCardProps {
    hasAnyBrowserEngine: boolean;
    hasPrivacyKernel: boolean;
    proxyCount: number;
    onOpenComponents: () => void;
    onOpenProxies: () => void;
    onCreateProfile: () => void;
}

const useStyles = makeStyles({
    wrap: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 24px',
        overflowY: 'auto',
    },
    card: {
        width: '100%',
        maxWidth: '580px',
        backgroundColor: 'var(--glass-card)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
        borderRadius: '14px',
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
    },
    titleGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
    },
    sectionIcon: {
        width: '28px',
        height: '28px',
        padding: '5px',
        borderRadius: '8px',
        boxSizing: 'border-box',
        flexShrink: 0,
    },
    title: {
        margin: 0,
        fontSize: '16px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
    },
    stepsList: {
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '10px',
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
        overflow: 'hidden',
    },
    row: {
        minHeight: '44px',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        '&:last-child': {
            borderBottom: 'none',
        },
    },
    rowLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    rowLabel: {
        fontSize: '13px',
        fontWeight: 500,
        color: tokens.colorNeutralForeground1,
    },
    rowRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
    },
});

const ZeroStateOnboardingCard: React.FC<ZeroStateOnboardingCardProps> = ({
    hasAnyBrowserEngine,
    hasPrivacyKernel,
    proxyCount,
    onOpenComponents,
    onOpenProxies,
    onCreateProfile,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();

    return (
        <div className={styles.wrap}>
            <div className={styles.card}>
                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <WindowMultipleRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('blue')}
                        />
                        <h2 className={styles.title}>
                            {t('快速开始', 'Quick Start')}
                        </h2>
                        <InfoTip
                            content={t(
                                '点击“新建环境”即可创建首个独立浏览器环境。',
                                'Select New Environment to create your first isolated browser profile.',
                            )}
                        />
                    </div>
                    <Button
                        appearance="primary"
                        icon={<AddRegular />}
                        onClick={onCreateProfile}
                    >
                        {t('新建环境', 'New Environment')}
                    </Button>
                </div>

                <div className={styles.stepsList}>
                    <div className={styles.row}>
                        <div className={styles.rowLeft}>
                            <BoxRegular
                                style={{
                                    fontSize: '16px',
                                    color: tokens.colorBrandForeground1,
                                    flexShrink: 0,
                                }}
                            />
                            <span className={styles.rowLabel}>
                                {t('浏览器内核', 'Browser Engine')}
                            </span>
                            <InfoTip
                                content={t(
                                    '可直接使用本机系统 Chrome，或前往「组件」按需下载开源 C++ 隐私指纹内核',
                                    'Use installed Google Chrome directly, or download the open-source C++ privacy kernel in Components.',
                                )}
                            />
                        </div>
                        <div className={styles.rowRight}>
                            <Badge
                                appearance="tint"
                                color={
                                    hasPrivacyKernel
                                        ? 'success'
                                        : hasAnyBrowserEngine
                                          ? 'informative'
                                          : 'warning'
                                }
                                size="small"
                            >
                                {hasPrivacyKernel
                                    ? t('隐私内核就绪', 'Privacy Ready')
                                    : hasAnyBrowserEngine
                                      ? t('系统 Chrome 就绪', 'Chrome Ready')
                                      : t('待安装', 'Required')}
                            </Badge>
                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={onOpenComponents}
                            >
                                {t('组件管理', 'Components')}
                            </Button>
                        </div>
                    </div>

                    <div className={styles.row}>
                        <div className={styles.rowLeft}>
                            <GlobeRegular
                                style={{
                                    fontSize: '16px',
                                    color: tokens.colorPaletteTealForeground2,
                                    flexShrink: 0,
                                }}
                            />
                            <span className={styles.rowLabel}>
                                {t('隔离代理', 'Proxy Isolation')}
                            </span>
                            <InfoTip
                                content={t(
                                    '支持 HTTP、SOCKS5 及 VLESS 等主流协议链接批量导入，启动前强锁防泄露规则',
                                    'Import HTTP, SOCKS5, or VLESS share URIs with fail-closed WebRTC, QUIC, and DNS leak locks.',
                                )}
                            />
                        </div>
                        <div className={styles.rowRight}>
                            <Badge
                                appearance="tint"
                                color={proxyCount > 0 ? 'success' : 'subtle'}
                                size="small"
                            >
                                {proxyCount > 0
                                    ? isEn
                                        ? `${proxyCount} configured`
                                        : `已配 ${proxyCount} 条`
                                    : t('可选', 'Optional')}
                            </Badge>
                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={onOpenProxies}
                            >
                                {t('管理代理', 'Proxies')}
                            </Button>
                        </div>
                    </div>

                    <div className={styles.row}>
                        <div className={styles.rowLeft}>
                            <WindowMultipleRegular
                                style={{
                                    fontSize: '16px',
                                    color: tokens.colorPalettePurpleForeground2,
                                    flexShrink: 0,
                                }}
                            />
                            <span className={styles.rowLabel}>
                                {t('独立环境', 'Isolated Profile')}
                            </span>
                            <InfoTip
                                content={t(
                                    '每个环境拥有独立用户目录与持久化 32 位指纹种子，支持单个或批量创建',
                                    'Each profile receives an isolated data directory and persistent 32-bit fingerprint seed, single or bulk.',
                                )}
                            />
                        </div>
                        <div className={styles.rowRight}>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<AddRegular />}
                                onClick={onCreateProfile}
                            >
                                {t('立即创建', 'Create')}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ZeroStateOnboardingCard;
