import React, { useState } from 'react';
import { Button, MessageBar, MessageBarBody } from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    ArrowSyncRegular,
    DocumentTextRegular,
    OpenRegular,
    StarRegular,
} from '@fluentui/react-icons';
import type { AppUpdateCheckResult } from '../../types';
import { useNotification } from '../../contexts/NotificationContext';
import { translateBackendMessage, useI18n } from '../../i18n';
import { systemApi } from '../../services';
import AppBrandIcon from '../common/AppBrandIcon';
import { cleanIpcError } from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export interface AboutSettingsPanelProps {
    appVersion: string;
    hostPlatform: string;
}

const AboutSettingsPanel: React.FC<AboutSettingsPanelProps> = ({
    appVersion,
    hostPlatform,
}) => {
    const styles = useSettingsStyles();
    const { locale, isEn, t } = useI18n();
    const { showNotification } = useNotification();

    const isMac = hostPlatform === 'darwin';
    const isLinux = hostPlatform === 'linux';

    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [downloadingUpdate, setDownloadingUpdate] = useState(false);
    const [exportingDiag, setExportingDiag] = useState(false);
    const [updateResult, setUpdateResult] =
        useState<AppUpdateCheckResult | null>(null);
    const [updateError, setUpdateError] = useState('');

    const handleOpenRepo = async (
        url = 'https://github.com/OliverWalker1122/multichrome',
    ) => {
        try {
            await systemApi.openExternal(url);
        } catch (err) {
            showNotification('error', cleanIpcError(err, locale));
        }
    };

    const handleCheckAppUpdate = async () => {
        if (checkingUpdate) return;
        try {
            setCheckingUpdate(true);
            setUpdateError('');
            const res = await systemApi.checkUpdate();
            if (!res) return;
            setUpdateResult(res);
            if (!res.hasUpdate) {
                showNotification(
                    'success',
                    isEn
                        ? `You are up to date (v${res.currentVersion})`
                        : `当前已是最新版本（v${res.currentVersion}）`,
                );
            }
        } catch (err) {
            setUpdateError(cleanIpcError(err, locale));
        } finally {
            setCheckingUpdate(false);
        }
    };

    const handleDownloadInstaller = async () => {
        if (downloadingUpdate) return;
        try {
            setDownloadingUpdate(true);
            setUpdateError('');
            const res = await systemApi.downloadUpdate();
            if (!res.canceled) {
                const digestHint = res.sha256 ? res.sha256.slice(0, 12) : '';
                showNotification(
                    'success',
                    isEn
                        ? `Verified installer saved${digestHint ? ` (SHA-256 ${digestHint}…)` : ''}`
                        : `已完成 SHA-256 校验并保存安装包${digestHint ? `（${digestHint}…）` : ''}`,
                );
            }
        } catch (err) {
            setUpdateError(cleanIpcError(err, locale));
        } finally {
            setDownloadingUpdate(false);
        }
    };

    const handleExportDiagnostics = async () => {
        if (exportingDiag) return;
        try {
            setExportingDiag(true);
            const res = await systemApi.exportDiagnostics();
            if (!res.canceled) {
                showNotification(
                    'success',
                    t('脱敏诊断报告已导出', 'Sanitized diagnostics exported'),
                );
            }
        } catch (err) {
            showNotification('error', cleanIpcError(err, locale));
        } finally {
            setExportingDiag(false);
        }
    };

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <div className={styles.aboutHero}>
                    <AppBrandIcon size={44} />
                    <div>
                        <h2 className={styles.aboutName}>MultiChrome</h2>
                        <div className={styles.aboutMeta}>
                            {t(
                                '本地优先的多环境隔离浏览器',
                                'Local-first isolated multi-profile browser',
                            )}
                        </div>
                    </div>
                </div>
                <div className={styles.componentRight}>
                    <Button
                        type="button"
                        appearance="subtle"
                        icon={<StarRegular />}
                        onClick={() => void handleOpenRepo()}
                    >
                        GitHub Star
                    </Button>
                    <Button
                        type="button"
                        appearance="subtle"
                        disabled={exportingDiag}
                        icon={<DocumentTextRegular />}
                        onClick={() => void handleExportDiagnostics()}
                    >
                        {t('导出诊断报告', 'Export Diagnostics')}
                    </Button>
                    <Button
                        type="button"
                        appearance="primary"
                        disabled={checkingUpdate}
                        icon={<ArrowSyncRegular />}
                        onClick={() => void handleCheckAppUpdate()}
                    >
                        {checkingUpdate
                            ? t('检查中…', 'Checking…')
                            : t('检查更新', 'Check Updates')}
                    </Button>
                </div>
            </div>

            {updateError && (
                <MessageBar intent="error" layout="multiline">
                    <MessageBarBody>
                        {translateBackendMessage(updateError, locale)}
                    </MessageBarBody>
                </MessageBar>
            )}

            {updateResult && (
                <MessageBar
                    intent={updateResult.hasUpdate ? 'info' : 'success'}
                    layout="multiline"
                >
                    <MessageBarBody>
                        <div className={styles.row}>
                            <span>
                                {updateResult.hasUpdate
                                    ? isEn
                                        ? `New version v${updateResult.latestVersion} is available (current: v${updateResult.currentVersion})`
                                        : `发现新版本 v${updateResult.latestVersion}（当前 v${updateResult.currentVersion}）`
                                    : isEn
                                      ? `MultiChrome v${updateResult.currentVersion} is up to date`
                                      : `当前已是最新版本（v${updateResult.currentVersion}）`}
                            </span>
                            {updateResult.hasUpdate && (
                                <div className={styles.componentRight}>
                                    {updateResult.canDownloadAsset ? (
                                        <>
                                            <Button
                                                type="button"
                                                size="small"
                                                appearance="subtle"
                                                icon={<OpenRegular />}
                                                onClick={() =>
                                                    void handleOpenRepo(
                                                        updateResult.releaseUrl,
                                                    )
                                                }
                                            >
                                                {t('查看详情', 'Release Notes')}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="small"
                                                appearance="primary"
                                                disabled={downloadingUpdate}
                                                icon={<ArrowDownloadRegular />}
                                                onClick={() =>
                                                    void handleDownloadInstaller()
                                                }
                                            >
                                                {downloadingUpdate
                                                    ? t(
                                                          '校验下载中…',
                                                          'Verifying…',
                                                      )
                                                    : t(
                                                          '下载安装包',
                                                          'Download Installer',
                                                      )}
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="primary"
                                            icon={<OpenRegular />}
                                            onClick={() =>
                                                void handleOpenRepo(
                                                    updateResult.releaseUrl,
                                                )
                                            }
                                        >
                                            {t('前往下载', 'Download')}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </MessageBarBody>
                </MessageBar>
            )}

            <div className={styles.divider} />

            <div className={styles.infoGrid} data-selectable="true">
                <span className={styles.infoKey}>
                    {t('当前版本', 'Version')}
                </span>
                <span className={styles.infoVal}>
                    v{appVersion || '1.6.0'}
                </span>

                <span className={styles.infoKey}>
                    {t('隐私承诺', 'Privacy')}
                </span>
                <span className={styles.infoVal}>
                    {t(
                        '全本地运行，无账号云端同步与数据上传',
                        '100% local execution with zero cloud upload',
                    )}
                </span>

                <span className={styles.infoKey}>
                    {t('运行平台', 'Platform')}
                </span>
                <span className={styles.infoVal}>
                    {isMac ? 'macOS' : isLinux ? 'Linux' : 'Windows'}
                </span>
            </div>
        </div>
    );
};

export default AboutSettingsPanel;
