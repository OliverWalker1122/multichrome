import React, { useState } from 'react';
import {
    Badge,
    Button,
    Field,
    Input,
    Select,
    Switch,
} from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronUpRegular,
    DesktopRegular,
    GlobeRegular,
    ShieldCheckmarkRegular,
} from '@fluentui/react-icons';
import type {
    DefaultFingerprintSettings,
    FingerprintBrand,
    FingerprintPlatform,
} from '../../types';
import { getToneStyle } from '../../theme/semanticColors';
import { useI18n } from '../../i18n';
import InfoTip from '../common/InfoTip';
import { COMMON_LANGUAGES, SPOOFING_ITEMS } from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export interface PrivacySettingsSectionProps {
    requireHealthCheckOnLaunch: boolean;
    onRequireHealthCheckOnLaunchChange: (enabled: boolean) => void;
    proxyEnabled: boolean;
    onProxyEnabledChange: (enabled: boolean) => void;
    proxyAddress: string;
    onProxyAddressChange: (address: string) => void;
    fingerprint: DefaultFingerprintSettings;
    onFingerprintChange: React.Dispatch<
        React.SetStateAction<DefaultFingerprintSettings>
    >;
    hostPlatform: string;
}

const PrivacySettingsSection: React.FC<PrivacySettingsSectionProps> = ({
    requireHealthCheckOnLaunch,
    onRequireHealthCheckOnLaunchChange,
    proxyEnabled,
    onProxyEnabledChange,
    proxyAddress,
    onProxyAddressChange,
    fingerprint,
    onFingerprintChange,
    hostPlatform,
}) => {
    const styles = useSettingsStyles();
    const { isEn, t } = useI18n();
    const [fpCustomizeOpen, setFpCustomizeOpen] = useState(false);

    const isMac = hostPlatform === 'darwin';
    const isLinux = hostPlatform === 'linux';

    const enabledSpoofCount = SPOOFING_ITEMS.filter(
        (item) => fingerprint.spoofing[item.key],
    ).length;

    const platformLabel =
        fingerprint.platform === 'macos'
            ? 'macOS'
            : fingerprint.platform === 'linux'
              ? 'Linux'
              : 'Windows';

    return (
        <>
            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <ShieldCheckmarkRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('green')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('网络保护', 'Network Protection')}
                    </h2>
                    <InfoTip
                        content={t(
                            '绑定代理的环境默认启用全链路防泄露：代理断开时自动断网绝不暴露本机 IP，并阻断 WebRTC 与本地 DNS 泄露',
                            'Proxied profiles enforce strict anti-leak protection: never fall back to direct IP on disconnect and block WebRTC/DNS leaks.',
                        )}
                    />
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('启动前安全检查', 'Pre-Launch Check')}
                        <InfoTip
                            content={t(
                                '开启后，每次启动环境前会先核对代理、时区、语言与防泄露状态，确认无误再打开窗口',
                                'Shows a quick proxy, timezone, language, and leak health check before launching.',
                            )}
                        />
                    </span>
                    <Switch
                        checked={requireHealthCheckOnLaunch}
                        onChange={(_, data) =>
                            onRequireHealthCheckOnLaunchChange(data.checked)
                        }
                    />
                </div>

                <div className={styles.divider} />

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('全局备用代理', 'Fallback Proxy')}
                        <InfoTip
                            content={t(
                                '当某个环境没有单独绑定代理时，自动走这里配置的备用代理',
                                'Used automatically for profiles that do not have a dedicated proxy.',
                            )}
                        />
                    </span>
                    <Switch
                        checked={proxyEnabled}
                        onChange={(_, data) =>
                            onProxyEnabledChange(data.checked)
                        }
                    />
                </div>

                {proxyEnabled && (
                    <Input
                        value={proxyAddress}
                        placeholder="http://127.0.0.1:7890"
                        onChange={(_, data) => onProxyAddressChange(data.value)}
                    />
                )}
            </div>

            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <GlobeRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('teal')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('地区同步', 'Region Sync')}
                    </h2>
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('自动匹配时区', 'Auto-Match Timezone')}
                        <InfoTip
                            content={t(
                                '根据代理出口 IP 所在地区自动设置浏览器时区',
                                'Automatically aligns browser timezone with the proxy exit IP.',
                            )}
                        />
                    </span>
                    <Switch
                        checked={fingerprint.autoMatchTimezone}
                        onChange={(_, data) =>
                            onFingerprintChange((prev) => ({
                                ...prev,
                                autoMatchTimezone: data.checked,
                            }))
                        }
                    />
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('自动匹配语言', 'Auto-Match Language')}
                        <InfoTip
                            content={t(
                                '同时适用于标准 Chrome 与防关联浏览器（纯原生参数生效，无 JS 痕迹）；根据代理出口国家自动切换网页语言',
                                'Applies to both Standard Chrome and Privacy Browser natively with zero JS hooks; matches language to proxy exit country.',
                            )}
                        />
                    </span>
                    <Switch
                        checked={Boolean(fingerprint.autoMatchLanguage)}
                        onChange={(_, data) =>
                            onFingerprintChange((prev) => ({
                                ...prev,
                                autoMatchLanguage: data.checked,
                            }))
                        }
                    />
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('默认网页语言', 'Default Language')}
                    </span>
                    <Select
                        style={{ minWidth: '200px' }}
                        value={
                            COMMON_LANGUAGES.some(
                                (l) => l.value === fingerprint.defaultLanguage,
                            )
                                ? fingerprint.defaultLanguage
                                : 'en-US'
                        }
                        onChange={(_, data) =>
                            onFingerprintChange((prev) => ({
                                ...prev,
                                defaultLanguage: data.value,
                            }))
                        }
                    >
                        {COMMON_LANGUAGES.map((lang) => (
                            <option key={lang.value} value={lang.value}>
                                {isEn ? lang.en : lang.zh}
                            </option>
                        ))}
                    </Select>
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('同步定位 (GPS)', 'Sync Geolocation')}
                        <InfoTip
                            content={t(
                                '同时适用于标准 Chrome 与防关联浏览器。默认关闭以保持防关联浏览器零调试挂载；仅在网站明确校验位置权限时建议开启',
                                'Applies to both browsers. Off by default to keep zero page-level attachment on the Privacy Browser; enable only when sites check GPS.',
                            )}
                        />
                    </span>
                    <Switch
                        checked={Boolean(fingerprint.autoMatchGeolocation)}
                        onChange={(_, data) =>
                            onFingerprintChange((prev) => ({
                                ...prev,
                                autoMatchGeolocation: data.checked,
                            }))
                        }
                    />
                </div>
            </div>

            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                        <DesktopRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('violet')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('设备伪装', 'Device Spoofing')}
                        </h2>
                        <Badge
                            size="small"
                            appearance="tint"
                            color="subtle"
                        >
                            {t('仅防关联浏览器', 'Privacy Browser only')}
                        </Badge>
                        <InfoTip
                            content={t(
                                '新建防关联环境时自动生成独立的设备特征，通常保持默认即可',
                                'Automatically assigns unique hardware signatures to new privacy profiles. Default settings work best for most users.',
                            )}
                        />
                    </div>
                    <div className={styles.componentRight}>
                        <span className={styles.listItemSub}>
                            {platformLabel} · {fingerprint.brand} ·{' '}
                            {enabledSpoofCount}/{SPOOFING_ITEMS.length}
                        </span>
                        <Button
                            type="button"
                            size="small"
                            appearance="subtle"
                            icon={
                                fpCustomizeOpen ? (
                                    <ChevronUpRegular />
                                ) : (
                                    <ChevronDownRegular />
                                )
                            }
                            iconPosition="after"
                            onClick={() =>
                                setFpCustomizeOpen((prev) => !prev)
                            }
                        >
                            {fpCustomizeOpen
                                ? t('收起', 'Hide')
                                : t('自定义', 'Customize')}
                        </Button>
                    </div>
                </div>

                {fpCustomizeOpen && (
                    <>
                        <div className={styles.twoCol}>
                            <Field label={t('模拟系统', 'System')}>
                                <Select
                                    value={fingerprint.platform}
                                    onChange={(_, data) =>
                                        onFingerprintChange((prev) => ({
                                            ...prev,
                                            platform:
                                                data.value as FingerprintPlatform,
                                        }))
                                    }
                                >
                                    <option value="windows">
                                        Windows
                                        {!isMac && !isLinux
                                            ? t('（推荐）', ' (Recommended)')
                                            : ''}
                                    </option>
                                    <option value="macos">
                                        macOS
                                        {isMac
                                            ? t('（推荐）', ' (Recommended)')
                                            : ''}
                                    </option>
                                    <option value="linux">
                                        Linux
                                        {isLinux
                                            ? t('（推荐）', ' (Recommended)')
                                            : ''}
                                    </option>
                                </Select>
                            </Field>

                            <Field label={t('浏览器品牌', 'Browser Brand')}>
                                <Select
                                    value={fingerprint.brand}
                                    onChange={(_, data) =>
                                        onFingerprintChange((prev) => ({
                                            ...prev,
                                            brand: data.value as FingerprintBrand,
                                        }))
                                    }
                                >
                                    <option value="Chrome">
                                        {t(
                                            'Chrome（推荐）',
                                            'Chrome (Recommended)',
                                        )}
                                    </option>
                                    <option value="Edge">Edge</option>
                                    <option value="Opera">Opera</option>
                                    <option value="Vivaldi">Vivaldi</option>
                                </Select>
                            </Field>
                        </div>

                        <div className={styles.spoofGrid}>
                            {SPOOFING_ITEMS.map((item) => (
                                <div key={item.key} className={styles.spoofItem}>
                                    <span className={styles.rowLabel}>
                                        {isEn ? item.en : item.zh}
                                        <InfoTip
                                            content={
                                                isEn ? item.tipEn : item.tipZh
                                            }
                                        />
                                    </span>
                                    <Switch
                                        checked={
                                            fingerprint.spoofing[item.key]
                                        }
                                        onChange={(_, data) =>
                                            onFingerprintChange((prev) => ({
                                                ...prev,
                                                spoofing: {
                                                    ...prev.spoofing,
                                                    [item.key]: data.checked,
                                                },
                                            }))
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </>
    );
};

export default PrivacySettingsSection;
