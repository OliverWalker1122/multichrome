import React, { useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Select,
} from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    ArrowUploadRegular,
    FolderOpenRegular,
    SettingsRegular,
    ShieldLockRegular,
} from '@fluentui/react-icons';
import type { AppLocale, ProxyCoreInfo, ThemeMode } from '../../types';
import { useNotification } from '../../contexts/NotificationContext';
import { getToneStyle } from '../../theme/semanticColors';
import { translateBackendMessage, useI18n } from '../../i18n';
import { systemApi } from '../../services';
import InfoTip from '../common/InfoTip';
import { cleanIpcError } from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export interface GeneralSettingsSectionProps {
    dataPath: string;
    onDataPathChange: (value: string) => void;
    onSelectFolder: () => void;
    coreInfo: ProxyCoreInfo | null;
    theme: ThemeMode;
    onThemeChange: (next: ThemeMode) => void;
    onDataRestored?: () => void;
}

const GeneralSettingsSection: React.FC<GeneralSettingsSectionProps> = ({
    dataPath,
    onDataPathChange,
    onSelectFolder,
    coreInfo,
    theme,
    onThemeChange,
    onDataRestored,
}) => {
    const styles = useSettingsStyles();
    const { locale, isEn, setLocale: setAppLocale, t } = useI18n();
    const { showNotification } = useNotification();

    const [backupDialogMode, setBackupDialogMode] = useState<
        'export' | 'restore' | null
    >(null);
    const [backupPassword, setBackupPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [backupBusy, setBackupBusy] = useState(false);
    const [backupError, setBackupError] = useState('');

    const openBackupDialog = (mode: 'export' | 'restore') => {
        setBackupDialogMode(mode);
        setBackupPassword('');
        setConfirmPassword('');
        setBackupError('');
    };

    const closeBackupDialog = () => {
        if (backupBusy) return;
        setBackupDialogMode(null);
        setBackupPassword('');
        setConfirmPassword('');
        setBackupError('');
    };

    const handleBackupSubmit = async () => {
        if (!backupDialogMode || backupBusy) return;
        if (backupPassword.length < 8) {
            setBackupError(
                t(
                    '备份密码长度至少需要 8 位字符',
                    'Backup password must be at least 8 characters.',
                ),
            );
            return;
        }
        if (
            backupDialogMode === 'export' &&
            backupPassword !== confirmPassword
        ) {
            setBackupError(
                t('两次输入的密码不一致', 'The two passwords do not match.'),
            );
            return;
        }

        try {
            setBackupBusy(true);
            setBackupError('');
            if (backupDialogMode === 'export') {
                const res = await systemApi.exportBackup(backupPassword);
                if (res.canceled) return;
                setBackupDialogMode(null);
                showNotification(
                    'success',
                    t('加密备份已导出', 'Encrypted backup exported'),
                );
            } else {
                const res = await systemApi.restoreBackup(backupPassword);
                if (res.canceled) return;
                setBackupDialogMode(null);
                onDataRestored?.();
                showNotification(
                    'success',
                    isEn
                        ? `Restored ${res.restoredEnvironments ?? 0} profiles and ${res.restoredProxies ?? 0} proxies`
                        : `已恢复 ${res.restoredEnvironments ?? 0} 个环境与 ${res.restoredProxies ?? 0} 个代理`,
                );
            }
        } catch (err) {
            setBackupError(cleanIpcError(err, locale));
        } finally {
            setBackupBusy(false);
        }
    };

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

            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <ShieldLockRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('teal')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('加密备份', 'Encrypted Backup')}
                    </h2>
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('本地迁移包', 'Local Migration Archive')}
                        <InfoTip
                            content={t(
                                '使用 AES-256-GCM 密码加密导出或恢复环境元数据、指纹种子与代理配置（不含浏览器缓存目录，全程零云端上传）',
                                'Exports or restores profile metadata, fingerprint seeds, and proxy configs with AES-256-GCM password encryption (excludes browser cache folders; zero cloud upload).',
                            )}
                        />
                    </span>
                    <div className={styles.componentRight}>
                        <Button
                            type="button"
                            appearance="subtle"
                            icon={<ArrowUploadRegular />}
                            onClick={() => openBackupDialog('restore')}
                        >
                            {t('恢复备份', 'Restore Backup')}
                        </Button>
                        <Button
                            type="button"
                            appearance="outline"
                            icon={<ArrowDownloadRegular />}
                            onClick={() => openBackupDialog('export')}
                        >
                            {t('导出备份', 'Export Backup')}
                        </Button>
                    </div>
                </div>
            </div>

            <Dialog
                open={backupDialogMode !== null}
                onOpenChange={(_, data) => {
                    if (!data.open) closeBackupDialog();
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {backupDialogMode === 'export'
                                ? t('导出加密备份', 'Export Encrypted Backup')
                                : t('恢复加密备份', 'Restore Encrypted Backup')}
                        </DialogTitle>
                        <DialogContent>
                            <div className={styles.listStack}>
                                {backupError && (
                                    <MessageBar intent="error" layout="multiline">
                                        <MessageBarBody>
                                            {translateBackendMessage(
                                                backupError,
                                                locale,
                                            )}
                                        </MessageBarBody>
                                    </MessageBar>
                                )}
                                <Field label={t('备份密码', 'Backup Password')}>
                                    <Input
                                        type="password"
                                        value={backupPassword}
                                        disabled={backupBusy}
                                        placeholder={t(
                                            '至少 8 位备份密码',
                                            'At least 8 characters',
                                        )}
                                        onChange={(_, data) =>
                                            setBackupPassword(data.value)
                                        }
                                    />
                                </Field>
                                {backupDialogMode === 'export' && (
                                    <Field
                                        label={t(
                                            '确认密码',
                                            'Confirm Password',
                                        )}
                                    >
                                        <Input
                                            type="password"
                                            value={confirmPassword}
                                            disabled={backupBusy}
                                            placeholder={t(
                                                '再次输入备份密码',
                                                'Re-enter backup password',
                                            )}
                                            onChange={(_, data) =>
                                                setConfirmPassword(data.value)
                                            }
                                        />
                                    </Field>
                                )}
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                type="button"
                                appearance="secondary"
                                disabled={backupBusy}
                                onClick={closeBackupDialog}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                type="button"
                                appearance="primary"
                                disabled={backupBusy}
                                onClick={() => void handleBackupSubmit()}
                            >
                                {backupBusy
                                    ? t('处理中…', 'Processing…')
                                    : backupDialogMode === 'export'
                                      ? t('导出备份', 'Export Backup')
                                      : t('恢复备份', 'Restore Backup')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
};

export default GeneralSettingsSection;
