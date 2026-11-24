import React from 'react';
import { Button, Field, Input, Select } from '@fluentui/react-components';
import { FolderOpenRegular, SettingsRegular } from '@fluentui/react-icons';
import type { AppLocale, ProxyCoreInfo, ThemeMode } from '../../types';
import { getToneStyle } from '../../theme/semanticColors';
import { useI18n } from '../../i18n';
import InfoTip from '../common/InfoTip';
import { useSettingsStyles } from './settingsStyles';

export interface GeneralSettingsSectionProps {
    dataPath: string;
    onDataPathChange: (value: string) => void;
    onSelectFolder: () => void;
    coreInfo: ProxyCoreInfo | null;
    theme: ThemeMode;
    onThemeChange: (next: ThemeMode) => void;
}

const GeneralSettingsSection: React.FC<GeneralSettingsSectionProps> = ({
    dataPath,
    onDataPathChange,
    onSelectFolder,
    coreInfo,
    theme,
    onThemeChange,
}) => {
    const styles = useSettingsStyles();
    const { locale, setLocale: setAppLocale, t } = useI18n();

    return (
        <>
            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <FolderOpenRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('amber')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('存储位置', 'Storage')}
                    </h2>
                </div>

                <Field
                    label={
                        <span className={styles.rowLabel}>
                            {t('数据目录', 'Data Directory')}
                            <InfoTip
                                content={t(
                                    '保存浏览器环境、登录数据与已安装组件；修改后重启生效',
                                    'Stores browser profiles, sessions, and installed components. Restart after changing.',
                                )}
                            />
                        </span>
                    }
                >
                    <div className={styles.pathRow}>
                        <Input
                            style={{ flex: 1 }}
                            value={dataPath}
                            placeholder={t(
                                '例如：D:\\MultiChromeData',
                                'e.g., D:\\MultiChromeData',
                            )}
                            onChange={(_, data) => onDataPathChange(data.value)}
                        />
                        <Button
                            type="button"
                            appearance="outline"
                            icon={<FolderOpenRegular />}
                            onClick={onSelectFolder}
                        >
                            {t('选择目录', 'Browse')}
                        </Button>
                    </div>
                </Field>

                {coreInfo?.configDirectory && (
                    <Field
                        label={
                            <span className={styles.rowLabel}>
                                {t('配置文件目录', 'Config Directory')}
                                <InfoTip
                                    content={t(
                                        '存放软件偏好设置与代理配置的本地目录',
                                        'Local directory storing app settings and proxy configurations.',
                                    )}
                                />
                            </span>
                        }
                    >
                        <Input readOnly value={coreInfo.configDirectory} />
                    </Field>
                )}
            </div>

            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <SettingsRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('violet')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('外观', 'Appearance')}
                    </h2>
                </div>
                <div className={styles.twoCol}>
                    <Field label={t('主题', 'Theme')}>
                        <Select
                            value={theme}
                            onChange={(_, data) =>
                                onThemeChange(data.value as ThemeMode)
                            }
                        >
                            <option value="system">
                                {t('跟随系统', 'System')}
                            </option>
                            <option value="light">{t('浅色', 'Light')}</option>
                            <option value="dark">{t('深色', 'Dark')}</option>
                        </Select>
                    </Field>
                    <Field label={t('界面语言', 'Language')}>
                        <Select
                            value={locale}
                            onChange={(_, data) =>
                                void setAppLocale(data.value as AppLocale)
                            }
                        >
                            <option value="en-US">English</option>
                            <option value="zh-CN">简体中文</option>
                        </Select>
                    </Field>
                </div>
            </div>
        </>
    );
};

export default GeneralSettingsSection;
