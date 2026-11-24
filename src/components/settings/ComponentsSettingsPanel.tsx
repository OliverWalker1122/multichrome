import React, { useCallback, useEffect, useState } from 'react';
import {
    Badge,
    Button,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarBody,
    ProgressBar,
    Select,
} from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    BoxRegular,
    CheckmarkCircleRegular,
    DeleteRegular,
    FolderOpenRegular,
    GlobeRegular,
    MoreHorizontalRegular,
    OpenRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import type {
    KernelDownloadProgress,
    KernelStatus,
    ManagedProxy,
    ProxyCoreInfo,
} from '../../types';
import { useNotification } from '../../contexts/NotificationContext';
import { getToneStyle } from '../../theme/semanticColors';
import { translateBackendMessage, useI18n } from '../../i18n';
import { kernelApi } from '../../services';
import InfoTip from '../common/InfoTip';
import { cleanIpcError, formatBytes } from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export interface ComponentsSettingsPanelProps {
    coreInfo: ProxyCoreInfo | null;
    kernelStatus: KernelStatus | null;
    onKernelStatusChange: (status: KernelStatus) => void;
    managedProxies: ManagedProxy[];
    fallbackProxyEnabled: boolean;
    fallbackProxyAddress: string;
}

const ComponentsSettingsPanel: React.FC<ComponentsSettingsPanelProps> = ({
    coreInfo,
    kernelStatus,
    onKernelStatusChange,
    managedProxies,
    fallbackProxyEnabled,
    fallbackProxyAddress,
}) => {
    const styles = useSettingsStyles();
    const { locale, isEn, t } = useI18n();
    const { showNotification } = useNotification();

    const [selectedRelease, setSelectedRelease] = useState('');
    const [downloadProxyChoice, setDownloadProxyChoice] =
        useState('__direct__');
    const [downloadingFp, setDownloadingFp] = useState(false);
    const [fpProgress, setFpProgress] =
        useState<KernelDownloadProgress | null>(null);
    const [kernelBusy, setKernelBusy] = useState(false);
    const [kernelError, setKernelError] = useState('');

    const [selectedSingboxVersion, setSelectedSingboxVersion] = useState('');
    const [singboxProxyChoice, setSingboxProxyChoice] = useState('__direct__');
    const [downloadingSingbox, setDownloadingSingbox] = useState(false);
    const [singboxProgress, setSingboxProgress] =
        useState<KernelDownloadProgress | null>(null);
    const [singboxBusy, setSingboxBusy] = useState(false);
    const [singboxError, setSingboxError] = useState('');

    useEffect(() => {
        const releases = kernelStatus?.availableReleases || [];
        if (releases.length > 0 && !selectedRelease) {
            const preferred =
                releases.find((r) => r.recommended) || releases[0];
            setSelectedRelease(preferred.version);
        }
        const sbReleases = kernelStatus?.availableSingboxReleases || [];
        if (sbReleases.length > 0 && !selectedSingboxVersion) {
            const preferred =
                sbReleases.find((r) => r.recommended) || sbReleases[0];
            setSelectedSingboxVersion(preferred.version);
        }
    }, [kernelStatus, selectedRelease, selectedSingboxVersion]);

    useEffect(() => {
        return kernelApi.onDownloadProgress((progress) => {
            if (progress.target === 'sing-box') {
                setSingboxProgress(progress);
                if (progress.stage === 'done' || progress.stage === 'error') {
                    setDownloadingSingbox(false);
                }
            } else {
                setFpProgress(progress);
                if (progress.stage === 'done' || progress.stage === 'error') {
                    setDownloadingFp(false);
                }
            }
        });
    }, []);

    const installedFpList = kernelStatus?.installedKernels || [];
    const activeFpKernel = installedFpList.find(
        (k) => k.id === kernelStatus?.activeKernelId,
    );
    const hasActiveKernel = Boolean(activeFpKernel);
    const installedSingbox = kernelStatus?.installedSingbox || [];
    const activeSingboxCore = installedSingbox.find(
        (item) => item.id === kernelStatus?.activeSingboxId,
    );
    const singboxReady = Boolean(coreInfo?.available);
    const singboxSummary = kernelStatus?.updateSummary?.singbox;
    const fpSummary = kernelStatus?.updateSummary?.fingerprint;

    const singboxNeedsAction = Boolean(
        !singboxReady || singboxSummary?.hasUpdate || downloadingSingbox,
    );
    const fpNeedsAction = Boolean(
        !hasActiveKernel || fpSummary?.hasUpdate || downloadingFp,
    );

    const buildFpDownloadProxyOptions = useCallback(() => {
        if (downloadProxyChoice === '__global__') {
            return { useGlobalProxy: true };
        }
        if (downloadProxyChoice && downloadProxyChoice !== '__direct__') {
            return { proxyId: downloadProxyChoice };
        }
        return undefined;
    }, [downloadProxyChoice]);

    const buildSingboxProxyOptions = useCallback(() => {
        if (singboxProxyChoice === '__global__') {
            return { useGlobalProxy: true };
        }
        return undefined;
    }, [singboxProxyChoice]);

    const handleDownloadSingbox = async () => {
        const targetVersion =
            singboxSummary?.recommendedVersion || selectedSingboxVersion;
        if (!kernelApi.isAvailable() || !targetVersion) return;
        try {
            setDownloadingSingbox(true);
            setSingboxError('');
            setSingboxProgress({
                target: 'sing-box',
                version: targetVersion,
                stage: 'downloading',
                percent: 0,
                message: t('正在下载代理引擎…', 'Downloading proxy engine…'),
            });
            const res = await kernelApi.downloadSingbox(
                targetVersion,
                buildSingboxProxyOptions(),
            );
            onKernelStatusChange(res.status);
            showNotification(
                'success',
                isEn
                    ? `Proxy engine v${res.installed.version} is ready`
                    : `代理引擎 v${res.installed.version} 已安装就绪`,
            );
        } catch (err) {
            setSingboxError(cleanIpcError(err, locale));
        } finally {
            setDownloadingSingbox(false);
        }
    };

    const handleCancelSingboxDownload = async () => {
        await kernelApi.cancelDownload('sing-box');
        setDownloadingSingbox(false);
        setSingboxProgress(null);
    };

    const handleImportSingbox = async () => {
        if (!kernelApi.isAvailable()) return;
        try {
            setSingboxBusy(true);
            setSingboxError('');
            const res = await kernelApi.importLocalSingbox();
            onKernelStatusChange(res.status);
            if (!res.canceled && res.installed) {
                showNotification(
                    'success',
                    isEn
                        ? `Imported proxy engine: ${res.installed.name}`
                        : `已导入代理引擎：${res.installed.name}`,
                );
            }
        } catch (err) {
            setSingboxError(cleanIpcError(err, locale));
        } finally {
            setSingboxBusy(false);
        }
    };

    const handleSetActiveSingbox = async (id: string) => {
        if (!kernelApi.isAvailable()) return;
        try {
            setSingboxBusy(true);
            setSingboxError('');
            const next = await kernelApi.setActiveSingbox(id);
            onKernelStatusChange(next);
            showNotification(
                'success',
                t('已切换代理引擎', 'Switched proxy engine'),
            );
        } catch (err) {
            setSingboxError(cleanIpcError(err, locale));
        } finally {
            setSingboxBusy(false);
        }
    };

    const handleRemoveSingbox = async (id: string) => {
        if (!kernelApi.isAvailable()) return;
        try {
            setSingboxBusy(true);
            setSingboxError('');
            const next = await kernelApi.removeSingbox(id);
            onKernelStatusChange(next);
            showNotification('success', t('已移除代理引擎', 'Removed proxy engine'));
        } catch (err) {
            setSingboxError(cleanIpcError(err, locale));
        } finally {
            setSingboxBusy(false);
        }
    };

    const handleDownloadKernel = async () => {
        const targetVersion = fpSummary?.recommendedVersion || selectedRelease;
        if (!kernelApi.isAvailable() || !targetVersion) return;
        try {
            setDownloadingFp(true);
            setKernelError('');
            setFpProgress({
                target: 'fingerprint-chromium',
                version: targetVersion,
                stage: 'downloading',
                percent: 0,
                message: t(
                    '正在下载防关联浏览器…',
                    'Downloading privacy browser…',
                ),
            });
            const result = await kernelApi.download(
                targetVersion,
                buildFpDownloadProxyOptions(),
            );
            onKernelStatusChange(result.status);
            showNotification(
                'success',
                isEn
                    ? `Privacy browser ${result.installed.version} is ready`
                    : `防关联浏览器 ${result.installed.version} 已安装就绪`,
            );
        } catch (err) {
            setKernelError(cleanIpcError(err, locale));
        } finally {
            setDownloadingFp(false);
        }
    };

    const handleCancelFpDownload = async () => {
        await kernelApi.cancelDownload('fingerprint-chromium');
        setDownloadingFp(false);
        setFpProgress(null);
    };

    const handleImportKernel = async (mode: 'file' | 'folder') => {
        if (!kernelApi.isAvailable()) return;
        try {
            setKernelBusy(true);
            setKernelError('');
            const res = await kernelApi.importLocal(mode);
            onKernelStatusChange(res.status);
            if (!res.canceled && res.installed) {
                showNotification(
                    'success',
                    isEn
                        ? `Imported browser: ${res.installed.name}`
                        : `已导入浏览器：${res.installed.name}`,
                );
            }
        } catch (err) {
            setKernelError(cleanIpcError(err, locale));
        } finally {
            setKernelBusy(false);
        }
    };

    const handleSetActiveKernel = async (kernelId: string) => {
        if (!kernelApi.isAvailable()) return;
        try {
            setKernelBusy(true);
            setKernelError('');
            const next = await kernelApi.setActive(kernelId);
            onKernelStatusChange(next);
            showNotification(
                'success',
                t('已切换防关联浏览器', 'Switched privacy browser'),
            );
        } catch (err) {
            setKernelError(cleanIpcError(err, locale));
        } finally {
            setKernelBusy(false);
        }
    };

    const handleRemoveKernel = async (kernelId: string) => {
        if (!kernelApi.isAvailable()) return;
        try {
            setKernelBusy(true);
            setKernelError('');
            const next = await kernelApi.remove(kernelId);
            onKernelStatusChange(next);
            showNotification('success', t('已移除该组件', 'Removed component'));
        } catch (err) {
            setKernelError(cleanIpcError(err, locale));
        } finally {
            setKernelBusy(false);
        }
    };

    const importFileLabel = t('导入本地文件', 'Import Local File');

    const canUseFallbackProxy =
        fallbackProxyEnabled && Boolean(fallbackProxyAddress.trim());

    return (
        <>
            {/* 代理引擎 */}
            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                        <BoxRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('teal')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('代理引擎', 'Proxy Engine')}
                        </h2>
                        <InfoTip
                            content={
                                activeSingboxCore
                                    ? `${t('内置代理转发核心（sing-box）', 'Built-in proxy core (sing-box)')} · ${activeSingboxCore.executablePath}`
                                    : t(
                                          '用于运行内置代理节点，按需安装并自动完成完整性校验',
                                          'Powers built-in proxy nodes with automatic integrity verification.',
                                      )
                            }
                        />
                    </div>

                    <div className={styles.componentRight}>
                        {singboxSummary?.hasUpdate ? (
                            <Badge appearance="tint" color="warning">
                                {isEn
                                    ? `v${singboxSummary.currentVersion} → v${singboxSummary.recommendedVersion}`
                                    : `可升级 v${singboxSummary.recommendedVersion}`}
                            </Badge>
                        ) : singboxReady ? (
                            <Badge appearance="tint" color="success">
                                {isEn
                                    ? `Ready · v${coreInfo?.version || ''}`
                                    : `已就绪 · v${coreInfo?.version || ''}`}
                            </Badge>
                        ) : (
                            <Badge appearance="tint" color="subtle">
                                {t('未安装', 'Not Installed')}
                            </Badge>
                        )}

                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    icon={<MoreHorizontalRegular />}
                                    aria-label={t('更多操作', 'More actions')}
                                />
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        icon={<FolderOpenRegular />}
                                        disabled={
                                            downloadingSingbox || singboxBusy
                                        }
                                        onClick={() =>
                                            void handleImportSingbox()
                                        }
                                    >
                                        {t(
                                            '导入本地文件',
                                            'Import Local File',
                                        )}
                                    </MenuItem>
                                    {activeSingboxCore && (
                                        <MenuItem
                                            icon={<DeleteRegular />}
                                            disabled={
                                                downloadingSingbox ||
                                                singboxBusy
                                            }
                                            onClick={() =>
                                                void handleRemoveSingbox(
                                                    activeSingboxCore.id,
                                                )
                                            }
                                        >
                                            {t(
                                                '移除当前引擎',
                                                'Remove Engine',
                                            )}
                                        </MenuItem>
                                    )}
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </div>
                </div>

                {singboxError && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>
                            {translateBackendMessage(singboxError, locale)}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {installedSingbox.length > 1 && (
                    <div className={styles.listStack}>
                        {installedSingbox.map((item) => {
                            const isActive =
                                item.id === kernelStatus?.activeSingboxId;
                            return (
                                <div key={item.id} className={styles.listItem}>
                                    <span className={styles.listItemTitle}>
                                        {item.name}
                                    </span>
                                    <div className={styles.componentRight}>
                                        {isActive ? (
                                            <Badge
                                                appearance="tint"
                                                color="brand"
                                            >
                                                {t('当前使用', 'Active')}
                                            </Badge>
                                        ) : (
                                            <Button
                                                type="button"
                                                size="small"
                                                appearance="outline"
                                                disabled={singboxBusy}
                                                icon={
                                                    <CheckmarkCircleRegular />
                                                }
                                                onClick={() =>
                                                    void handleSetActiveSingbox(
                                                        item.id,
                                                    )
                                                }
                                            >
                                                {t('启用', 'Use')}
                                            </Button>
                                        )}
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="subtle"
                                            icon={<DeleteRegular />}
                                            disabled={singboxBusy}
                                            onClick={() =>
                                                void handleRemoveSingbox(
                                                    item.id,
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {singboxNeedsAction && (
                    <div className={styles.subPanel}>
                        <div className={styles.inlineAddRow}>
                            <Select
                                style={{ flex: 1, minWidth: '160px' }}
                                disabled={downloadingSingbox}
                                value={singboxProxyChoice}
                                onChange={(_, data) =>
                                    setSingboxProxyChoice(data.value)
                                }
                            >
                                <option value="__direct__">
                                    {t('默认直连下载', 'Direct Download')}
                                </option>
                                {canUseFallbackProxy && (
                                    <option value="__global__">
                                        {t(
                                            '使用全局备用代理',
                                            'Use Fallback Proxy',
                                        )}
                                    </option>
                                )}
                            </Select>
                            <Button
                                type="button"
                                appearance="primary"
                                disabled={downloadingSingbox || singboxBusy}
                                icon={<ArrowDownloadRegular />}
                                onClick={() => void handleDownloadSingbox()}
                            >
                                {downloadingSingbox
                                    ? t('安装中…', 'Installing…')
                                    : singboxSummary?.hasUpdate
                                      ? t(
                                            `升级到 v${singboxSummary.recommendedVersion}`,
                                            `Upgrade to v${singboxSummary.recommendedVersion}`,
                                        )
                                      : t('立即安装', 'Install Now')}
                            </Button>
                        </div>

                        {downloadingSingbox && singboxProgress && (
                            <div className={styles.listStack}>
                                <div className={styles.row}>
                                    <span className={styles.listItemSub}>
                                        {singboxProgress.message
                                            ? translateBackendMessage(
                                                  singboxProgress.message,
                                                  locale,
                                              )
                                            : t('正在处理…', 'Processing…')}
                                        {singboxProgress.receivedBytes
                                            ? ` (${formatBytes(singboxProgress.receivedBytes)}${singboxProgress.totalBytes ? ` / ${formatBytes(singboxProgress.totalBytes)}` : ''})`
                                            : ''}
                                    </span>
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        onClick={() =>
                                            void handleCancelSingboxDownload()
                                        }
                                    >
                                        {t('取消', 'Cancel')}
                                    </Button>
                                </div>
                                <ProgressBar
                                    value={
                                        singboxProgress.stage ===
                                            'downloading' &&
                                        singboxProgress.totalBytes
                                            ? singboxProgress.percent / 100
                                            : undefined
                                    }
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 防关联浏览器 */}
            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                        <WindowMultipleRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('violet')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('防关联浏览器', 'Privacy Browser')}
                        </h2>
                        <InfoTip
                            content={
                                activeFpKernel
                                    ? `${t('内置防关联 Chromium 浏览器', 'Built-in anti-correlation Chromium')} · ${activeFpKernel.executablePath}`
                                    : t(
                                          '提供原生级硬件指纹隔离，适合多账号防关联场景',
                                          'Provides native fingerprint isolation for multi-account workflows.',
                                      )
                            }
                        />
                    </div>

                    <div className={styles.componentRight}>
                        {fpSummary?.hasUpdate ? (
                            <Badge appearance="tint" color="warning">
                                {isEn
                                    ? `Update: Core ${fpSummary.recommendedChromeMajor}`
                                    : `可升级 内核 ${fpSummary.recommendedChromeMajor}`}
                            </Badge>
                        ) : activeFpKernel ? (
                            <Badge appearance="tint" color="success">
                                {isEn
                                    ? `Ready · Core ${activeFpKernel.chromeMajor}`
                                    : `已就绪 · 内核 ${activeFpKernel.chromeMajor}`}
                            </Badge>
                        ) : (
                            <Badge appearance="tint" color="subtle">
                                {t('未安装', 'Not Installed')}
                            </Badge>
                        )}

                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    icon={<MoreHorizontalRegular />}
                                    aria-label={t('更多操作', 'More actions')}
                                />
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        icon={<OpenRegular />}
                                        onClick={() => void kernelApi.openDir()}
                                    >
                                        {t('打开组件目录', 'Open Folder')}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<FolderOpenRegular />}
                                        disabled={downloadingFp || kernelBusy}
                                        onClick={() =>
                                            void handleImportKernel('file')
                                        }
                                    >
                                        {importFileLabel}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<FolderOpenRegular />}
                                        disabled={downloadingFp || kernelBusy}
                                        onClick={() =>
                                            void handleImportKernel('folder')
                                        }
                                    >
                                        {t('导入本地目录', 'Import Folder')}
                                    </MenuItem>
                                    {activeFpKernel && (
                                        <MenuItem
                                            icon={<DeleteRegular />}
                                            disabled={
                                                downloadingFp || kernelBusy
                                            }
                                            onClick={() =>
                                                void handleRemoveKernel(
                                                    activeFpKernel.id,
                                                )
                                            }
                                        >
                                            {t(
                                                '移除当前浏览器',
                                                'Remove Browser',
                                            )}
                                        </MenuItem>
                                    )}
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </div>
                </div>

                {kernelError && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>
                            {translateBackendMessage(kernelError, locale)}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {installedFpList.length > 1 && (
                    <div className={styles.listStack}>
                        {installedFpList.map((kernel) => {
                            const isActive =
                                kernel.id === kernelStatus?.activeKernelId;
                            return (
                                <div
                                    key={kernel.id}
                                    className={styles.listItem}
                                >
                                    <span className={styles.listItemTitle}>
                                        Chrome {kernel.chromeMajor} (
                                        {kernel.version})
                                    </span>
                                    <div className={styles.componentRight}>
                                        {isActive ? (
                                            <Badge
                                                appearance="tint"
                                                color="brand"
                                            >
                                                {t('当前使用', 'Active')}
                                            </Badge>
                                        ) : (
                                            <Button
                                                type="button"
                                                size="small"
                                                appearance="outline"
                                                disabled={kernelBusy}
                                                icon={
                                                    <CheckmarkCircleRegular />
                                                }
                                                onClick={() =>
                                                    void handleSetActiveKernel(
                                                        kernel.id,
                                                    )
                                                }
                                            >
                                                {t('启用', 'Use')}
                                            </Button>
                                        )}
                                        <Button
                                            type="button"
                                            size="small"
                                            appearance="subtle"
                                            icon={<DeleteRegular />}
                                            disabled={kernelBusy}
                                            onClick={() =>
                                                void handleRemoveKernel(
                                                    kernel.id,
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {fpNeedsAction && (
                    <div className={styles.subPanel}>
                        <div className={styles.inlineAddRow}>
                            <Select
                                style={{ flex: 1, minWidth: '160px' }}
                                disabled={downloadingFp}
                                value={downloadProxyChoice}
                                onChange={(_, data) =>
                                    setDownloadProxyChoice(data.value)
                                }
                            >
                                <option value="__direct__">
                                    {t('默认直连下载', 'Direct Download')}
                                </option>
                                {canUseFallbackProxy && (
                                    <option value="__global__">
                                        {t(
                                            '使用全局备用代理',
                                            'Use Fallback Proxy',
                                        )}
                                    </option>
                                )}
                                {singboxReady &&
                                    managedProxies.map((proxy) => (
                                        <option
                                            key={proxy.id}
                                            value={proxy.id}
                                        >
                                            {t('代理：', 'Proxy: ')}
                                            {proxy.name}
                                        </option>
                                    ))}
                            </Select>
                            <Button
                                type="button"
                                appearance="primary"
                                disabled={downloadingFp || kernelBusy}
                                icon={<ArrowDownloadRegular />}
                                onClick={() => void handleDownloadKernel()}
                            >
                                {downloadingFp
                                    ? t('安装中…', 'Installing…')
                                    : fpSummary?.hasUpdate
                                      ? t(
                                            `升级到 Chrome ${fpSummary.recommendedChromeMajor}`,
                                            `Upgrade to Chrome ${fpSummary.recommendedChromeMajor}`,
                                        )
                                      : t('立即安装', 'Install Now')}
                            </Button>
                        </div>

                        {downloadingFp && fpProgress && (
                            <div className={styles.listStack}>
                                <div className={styles.row}>
                                    <span className={styles.listItemSub}>
                                        {fpProgress.message
                                            ? translateBackendMessage(
                                                  fpProgress.message,
                                                  locale,
                                              )
                                            : t('正在处理…', 'Processing…')}
                                        {fpProgress.receivedBytes
                                            ? ` (${formatBytes(fpProgress.receivedBytes)}${fpProgress.totalBytes ? ` / ${formatBytes(fpProgress.totalBytes)}` : ''})`
                                            : ''}
                                    </span>
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        onClick={() =>
                                            void handleCancelFpDownload()
                                        }
                                    >
                                        {t('取消', 'Cancel')}
                                    </Button>
                                </div>
                                <ProgressBar
                                    value={
                                        fpProgress.stage === 'downloading' &&
                                        fpProgress.totalBytes
                                            ? fpProgress.percent / 100
                                            : undefined
                                    }
                                />
                            </div>
                        )}
                    </div>
                )}

                <div className={styles.divider} />

                <div className={styles.row}>
                    <div className={styles.cardTitleGroup}>
                        <GlobeRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('blue')}
                        />
                        <span className={styles.rowLabel}>
                            {t('标准 Chrome', 'Standard Chrome')}
                            <InfoTip
                                content={
                                    kernelStatus?.systemChromePath
                                        ? `${t('系统自带 Google Chrome，适合高安全主号', 'System Google Chrome, ideal for sensitive primary accounts')} · ${kernelStatus.systemChromePath}`
                                        : t(
                                              '未检测到本机安装的 Google Chrome',
                                              'Google Chrome not detected on this system.',
                                          )
                                }
                            />
                        </span>
                    </div>
                    <Badge
                        appearance="tint"
                        color={
                            kernelStatus?.systemChromeAvailable
                                ? 'success'
                                : 'subtle'
                        }
                    >
                        {kernelStatus?.systemChromeAvailable
                            ? t('已就绪', 'Ready')
                            : t('未检测到', 'Not Found')}
                    </Badge>
                </div>
            </div>
        </>
    );
};

export default ComponentsSettingsPanel;
