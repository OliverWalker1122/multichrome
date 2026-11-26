import React from 'react';
import { Button, Field, Input } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronUpRegular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n';
import InfoTip from '../common/InfoTip';
import type { EnvironmentDetailsStyles } from './environmentDetailsStyles';

const COMMON_TIMEZONES = [
    'America/Los_Angeles',
    'America/New_York',
    'Europe/London',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Asia/Hong_Kong',
    'Asia/Shanghai',
];

const COMMON_LANGUAGES = [
    'auto',
    'en-US',
    'en-GB',
    'ja-JP',
    'ko-KR',
    'de-DE',
    'fr-FR',
    'zh-TW',
    'zh-HK',
    'zh-CN',
];

export interface EnvironmentAdvancedFieldsProps {
    styles: EnvironmentDetailsStyles;
    isRunning: boolean;
    hasManagedProxy: boolean;
    showAdvanced: boolean;
    onToggleAdvanced: () => void;
    proxy: string;
    onProxyChange: (value: string) => void;
    proxyLabel: string;
    onProxyLabelChange: (value: string) => void;
    timezone: string;
    onTimezoneChange: (value: string) => void;
    language: string;
    onLanguageChange: (value: string) => void;
    startupUrl: string;
    onStartupUrlChange: (value: string) => void;
}

const EnvironmentAdvancedFields: React.FC<EnvironmentAdvancedFieldsProps> = ({
    styles,
    isRunning,
    hasManagedProxy,
    showAdvanced,
    onToggleAdvanced,
    proxy,
    onProxyChange,
    proxyLabel,
    onProxyLabelChange,
    timezone,
    onTimezoneChange,
    language,
    onLanguageChange,
    startupUrl,
    onStartupUrlChange,
}) => {
    const { t } = useI18n();

    return (
        <>
            <div>
                <Button
                    type="button"
                    size="small"
                    appearance="subtle"
                    icon={
                        showAdvanced ? (
                            <ChevronUpRegular />
                        ) : (
                            <ChevronDownRegular />
                        )
                    }
                    iconPosition="after"
                    aria-expanded={showAdvanced}
                    onClick={onToggleAdvanced}
                >
                    {showAdvanced
                        ? t('收起高级设置', 'Hide Advanced')
                        : t(
                              '高级设置（时区、语言、启动页）',
                              'Advanced (Timezone, Language, URL)',
                          )}
                </Button>
            </div>

            {showAdvanced && (
                <div className={styles.metaBox}>
                    {!hasManagedProxy && (
                        <>
                            <Field
                                label={t(
                                    '手动代理地址',
                                    'Manual Proxy Address',
                                )}
                            >
                                <Input
                                    disabled={isRunning}
                                    placeholder="http://127.0.0.1:7890"
                                    value={proxy}
                                    onChange={(_, data) =>
                                        onProxyChange(data.value)
                                    }
                                />
                            </Field>
                            <Field label={t('代理备注名', 'Proxy Label')}>
                                <Input
                                    disabled={isRunning}
                                    placeholder={t(
                                        '例如：美国节点',
                                        'e.g., US Node',
                                    )}
                                    value={proxyLabel}
                                    onChange={(_, data) =>
                                        onProxyLabelChange(data.value)
                                    }
                                />
                            </Field>
                        </>
                    )}

                    <Field label={t('时区', 'Timezone')}>
                        <Input
                            placeholder="America/Los_Angeles"
                            list="env-detail-timezones"
                            value={timezone}
                            onChange={(_, data) =>
                                onTimezoneChange(data.value)
                            }
                        />
                        <datalist id="env-detail-timezones">
                            {COMMON_TIMEZONES.map((tz) => (
                                <option key={tz} value={tz} />
                            ))}
                        </datalist>
                    </Field>

                    <Field
                        label={
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                }}
                            >
                                {t('语言', 'Language')}
                                <InfoTip
                                    content={t(
                                        '填 auto 自动跟随代理地区，留空跟随全局设置',
                                        'Use "auto" to match proxy country; leave blank for global default',
                                    )}
                                />
                            </span>
                        }
                    >
                        <Input
                            placeholder="auto"
                            list="env-detail-languages"
                            value={language}
                            onChange={(_, data) =>
                                onLanguageChange(data.value)
                            }
                        />
                        <datalist id="env-detail-languages">
                            {COMMON_LANGUAGES.map((lang) => (
                                <option key={lang} value={lang} />
                            ))}
                        </datalist>
                    </Field>

                    <Field
                        label={
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                }}
                            >
                                {t('专属启动页', 'Startup URL')}
                                <InfoTip
                                    content={t(
                                        '优先于分组与全局启动页，留空则沿用上级设置',
                                        'Overrides group and global startup URL',
                                    )}
                                />
                            </span>
                        }
                    >
                        <Input
                            placeholder="https://ippure.com/"
                            value={startupUrl}
                            onChange={(_, data) =>
                                onStartupUrlChange(data.value)
                            }
                        />
                    </Field>
                </div>
            )}
        </>
    );
};

export default EnvironmentAdvancedFields;
