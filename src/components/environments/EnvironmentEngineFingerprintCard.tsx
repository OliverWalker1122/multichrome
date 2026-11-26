import React from 'react';
import {
    Badge,
    Button,
    Field,
    Select,
    Switch,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowSyncRegular,
    ChevronDownRegular,
    ChevronUpRegular,
} from '@fluentui/react-icons';
import type {
    BrowserEngineType,
    FingerprintBrand,
    FingerprintConfig,
    FingerprintPlatform,
} from '../../types';
import { useI18n } from '../../i18n';
import InfoTip from '../common/InfoTip';
import type { EnvironmentDetailsStyles } from './environmentDetailsStyles';

export interface EnvironmentEngineFingerprintCardProps {
    styles: EnvironmentDetailsStyles;
    isRunning: boolean;
    hasFingerprintKernel: boolean;
    browserEngine: BrowserEngineType;
    onBrowserEngineChange: (engine: BrowserEngineType) => void;
    fingerprintConfig: FingerprintConfig | undefined;
    onFingerprintConfigChange: React.Dispatch<
        React.SetStateAction<FingerprintConfig | undefined>
    >;
    canRegenerate: boolean;
    regenerating: boolean;
    onRegenerate: () => void;
    showFpDetails: boolean;
    onToggleFpDetails: () => void;
}

const EnvironmentEngineFingerprintCard: React.FC<
    EnvironmentEngineFingerprintCardProps
> = ({
    styles,
    isRunning,
    hasFingerprintKernel,
    browserEngine,
    onBrowserEngineChange,
    fingerprintConfig,
    onFingerprintConfigChange,
    canRegenerate,
    regenerating,
    onRegenerate,
    showFpDetails,
    onToggleFpDetails,
}) => {
    const { t } = useI18n();

    return (
        <div className={styles.metaBox}>
            <Field
                label={
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                        }}
                    >
                        {t('浏览器', 'Browser')}
                        <InfoTip
                            content={
                                isRunning
                                    ? t(
                                          '环境运行中，关闭后方可切换浏览器',
                                          'Close the environment before switching browser',
                                      )
                                    : browserEngine === 'fingerprint-chromium'
                                      ? hasFingerprintKernel
                                          ? t(
                                                '防关联浏览器为每个环境提供独立设备特征',
                                                'Privacy Browser isolates device signatures per profile',
                                            )
                                          : t(
                                                '尚未安装防关联浏览器，请先在「设置 → 组件」安装',
                                                'Install Privacy Browser in Settings → Components first',
                                            )
                                      : t(
                                            '系统自带的标准 Google Chrome，适合重要主号',
                                            'Standard Google Chrome, ideal for primary accounts',
                                        )
                            }
                        />
                    </span>
                }
            >
                <Select
                    disabled={isRunning}
                    value={browserEngine}
                    onChange={(_, data) =>
                        onBrowserEngineChange(data.value as BrowserEngineType)
                    }
                >
                    <option value="system-chrome">
                        {t('标准 Chrome', 'Standard Chrome')}
                    </option>
                    <option value="fingerprint-chromium">
                        {t('防关联浏览器', 'Privacy Browser')}
                    </option>
                </Select>
            </Field>

            {browserEngine === 'fingerprint-chromium' && (
                <>
                    {fingerprintConfig ? (
                        <>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '6px',
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: '12px',
                                        color: tokens.colorNeutralForeground2,
                                    }}
                                >
                                    {fingerprintConfig.platform} ·{' '}
                                    {fingerprintConfig.brand} ·{' '}
                                    {fingerprintConfig.hardwareConcurrency}
                                    {t('核', 'c')}
                                </span>
                                <div
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                    }}
                                >
                                    {canRegenerate && (
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="subtle"
                                            disabled={isRunning || regenerating}
                                            icon={<ArrowSyncRegular />}
                                            onClick={onRegenerate}
                                        >
                                            {t('换新', 'New')}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        icon={
                                            showFpDetails ? (
                                                <ChevronUpRegular />
                                            ) : (
                                                <ChevronDownRegular />
                                            )
                                        }
                                        aria-expanded={showFpDetails}
                                        onClick={onToggleFpDetails}
                                    >
                                        {showFpDetails
                                            ? t('收起', 'Hide')
                                            : t('详情', 'Details')}
                                    </Button>
                                </div>
                            </div>

                            {showFpDetails && (
                                <>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            flexWrap: 'wrap',
                                        }}
                                    >
                                        <Badge
                                            size="small"
                                            appearance="tint"
                                            color="brand"
                                        >
                                            Seed #{fingerprintConfig.seed}
                                        </Badge>
                                        <Badge
                                            size="small"
                                            appearance="outline"
                                        >
                                            {fingerprintConfig.windowSize.width}×
                                            {
                                                fingerprintConfig.windowSize
                                                    .height
                                            }
                                        </Badge>
                                    </div>

                                    <div
                                        style={{
                                            display: 'flex',
                                            gap: '8px',
                                        }}
                                    >
                                        <Field
                                            style={{ flex: 1 }}
                                            label={t('操作系统', 'System')}
                                        >
                                            <Select
                                                disabled={isRunning}
                                                value={
                                                    fingerprintConfig.platform
                                                }
                                                onChange={(_, data) =>
                                                    onFingerprintConfigChange(
                                                        (prev) =>
                                                            prev
                                                                ? {
                                                                      ...prev,
                                                                      platform:
                                                                          data.value as FingerprintPlatform,
                                                                  }
                                                                : prev,
                                                    )
                                                }
                                            >
                                                <option value="windows">
                                                    Windows
                                                </option>
                                                <option value="macos">
                                                    macOS
                                                </option>
                                                <option value="linux">
                                                    Linux
                                                </option>
                                            </Select>
                                        </Field>
                                        <Field
                                            style={{ flex: 1 }}
                                            label={t('浏览器品牌', 'Brand')}
                                        >
                                            <Select
                                                disabled={isRunning}
                                                value={fingerprintConfig.brand}
                                                onChange={(_, data) =>
                                                    onFingerprintConfigChange(
                                                        (prev) =>
                                                            prev
                                                                ? {
                                                                      ...prev,
                                                                      brand: data.value as FingerprintBrand,
                                                                  }
                                                                : prev,
                                                    )
                                                }
                                            >
                                                <option value="Chrome">
                                                    Chrome
                                                </option>
                                                <option value="Edge">
                                                    Edge
                                                </option>
                                                <option value="Opera">
                                                    Opera
                                                </option>
                                                <option value="Vivaldi">
                                                    Vivaldi
                                                </option>
                                            </Select>
                                        </Field>
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 1fr',
                                            gap: '4px 8px',
                                        }}
                                    >
                                        {(
                                            [
                                                ['canvas', t('画布', 'Canvas')],
                                                ['audio', t('音频', 'Audio')],
                                                ['font', t('字体', 'Fonts')],
                                                [
                                                    'clientrects',
                                                    t('布局', 'Layout'),
                                                ],
                                                ['gpu', t('显卡', 'GPU')],
                                            ] as const
                                        ).map(([key, label]) => (
                                            <Switch
                                                key={key}
                                                disabled={isRunning}
                                                label={label}
                                                checked={
                                                    fingerprintConfig.spoofing[
                                                        key
                                                    ]
                                                }
                                                onChange={(_, data) =>
                                                    onFingerprintConfigChange(
                                                        (prev) =>
                                                            prev
                                                                ? {
                                                                      ...prev,
                                                                      spoofing:
                                                                          {
                                                                              ...prev.spoofing,
                                                                              [key]: data.checked,
                                                                          },
                                                                  }
                                                                : prev,
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <span
                            style={{
                                fontSize: '12px',
                                color: tokens.colorNeutralForeground3,
                            }}
                        >
                            {t(
                                '保存后将自动生成独立设备特征',
                                'Unique device profile will be generated on save',
                            )}
                        </span>
                    )}
                </>
            )}
        </div>
    );
};

export default EnvironmentEngineFingerprintCard;
