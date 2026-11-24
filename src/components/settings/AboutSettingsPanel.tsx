import React, { useState } from 'react';
import { Button, MessageBar, MessageBarBody } from '@fluentui/react-components';
import {
    ArrowSyncRegular,
    OpenRegular,
    StarRegular,
} from '@fluentui/react-icons';
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
    const [updateResult, setUpdateResult] = useState<{
        currentVersion: string;
        latestVersion: string;
        hasUpdate: boolean;
        releaseUrl: string;
    } | null>(null);
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
                        appearance="outline"
                        icon={<StarRegular />}
                        onClick={() => void handleOpenRepo()}
                    >
                        GitHub Star
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
                    </MessageBarBody>
                </MessageBar>
            )}

            <div className={styles.divider} />

            <div className={styles.infoGrid} data-selectable="true">
                <span className={styles.infoKey}>
                    {t('当前版本', 'Version')}
                </span>
                <span className={styles.infoVal}>
                    v{appVersion || '1.4.0'}
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
