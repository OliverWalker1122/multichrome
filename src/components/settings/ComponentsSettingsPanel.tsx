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
    Tooltip,
    mergeClasses,
} from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    ArrowSyncRegular,
    BoxRegular,
    CheckmarkCircleRegular,
    ChevronDownRegular,
    ChevronUpRegular,
    CopyRegular,
    DeleteRegular,
    FolderOpenRegular,
    GlobeRegular,
    MoreHorizontalRegular,
    OpenRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import type {
    KernelDownloadProgress,
    KernelOpenDirTarget,
    KernelStatus,
    ManagedProxy,
    ProxyCoreInfo,
} from '../../types';
import { useNotification } from '../../contexts/NotificationContext';
import { getToneStyle } from '../../theme/semanticColors';
import { translateBackendMessage, useI18n } from '../../i18n';
import { kernelApi } from '../../services';
import InfoTip from '../common/InfoTip';
import {
    cleanIpcError,
    formatBytes,
    formatDateTime,
    formatShortSha256,
} from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export interface ComponentsSettingsPanelProps {
    coreInfo: ProxyCoreInfo | null;
    kernelStatus: KernelStatus | null;
    onKernelStatusChange: (status: KernelStatus) => void;
    managedProxies: ManagedProxy[];
    fallbackProxyEnabled: boolean;
    fallbackProxyAddress: string;
}

function isInteractiveClickTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
        target.closest(
            'button, a, input, select, textarea, [role="menu"], [role="menuitem"]',
        ),
    );
}

interface CopyableMonoValueProps {
    value: string;
    displayValue?: string;
    showFullTooltip?: boolean;
    copyTooltip: string;
    copyAriaLabel: string;
    onCopy: () => void;
    rowClassName: string;
    monoClassName: string;
}

const CopyableMonoValue: React.FC<CopyableMonoValueProps> = ({
    value,
    displayValue,
    showFullTooltip = false,
    copyTooltip,
    copyAriaLabel,
    onCopy,
    rowClassName,
    monoClassName,
}) => {
    const textEl = <span className={monoClassName}>{displayValue || value}</span>;
    return (
        <div className={rowClassName}>
            {showFullTooltip ? (
                <Tooltip content={value} relationship="label">
                    {textEl}
                </Tooltip>
            ) : (
                textEl
            )}
            <Tooltip content={copyTooltip} relationship="label">
                <Button
                    type="button"
                    size="small"
                    appearance="subtle"
                    icon={<CopyRegular />}
                    aria-label={copyAriaLabel}
                    onClick={onCopy}
                />
            </Tooltip>
        </div>
    );
};

interface ExpandToggleButtonProps {
    expanded: boolean;
    testId: string;
    expandLabel: string;
    collapseLabel: string;
    onToggle: () => void;
}

const ExpandToggleButton: React.FC<ExpandToggleButtonProps> = ({
    expanded,
    testId,
    expandLabel,
    collapseLabel,
    onToggle,
}) => (
    <Button
        type="button"
        size="small"
        appearance="subtle"
        data-testid={testId}
        aria-expanded={expanded}
        aria-label={expanded ? collapseLabel : expandLabel}
        icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
        onClick={(e) => {
            e.stopPropagation();
            onToggle();
        }}
    />
);

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

    const [singboxExpanded, setSingboxExpanded] = useState(false);
    const [fpExpanded, setFpExpanded] = useState(false);
    const [chromeExpanded, setChromeExpanded] = useState(false);

    const [selectedRelease, setSelectedRelease] = useState('');
    const [downloadProxyChoice, setDownloadProxyChoice] =
        useState('__direct__');
    const [downloadingFp, setDownloadingFp] = useState(false);
    const [fpProgress, setFpProgress] =
        useState<KernelDownloadProgress | null>(null);
    const [kernelBusy, setKernelBusy] = useState(false);
    const [refreshingFp, setRefreshingFp] = useState(false);
    const [kernelError, setKernelError] = useState('');

    const [selectedSingboxVersion, setSelectedSingboxVersion] = useState('');
    const [singboxProxyChoice, setSingboxProxyChoice] = useState('__direct__');
    const [downloadingSingbox, setDownloadingSingbox] = useState(false);
    const [singboxProgress, setSingboxProgress] =
        useState<KernelDownloadProgress | null>(null);
    const [singboxBusy, setSingboxBusy] = useState(false);
    const [refreshingSingbox, setRefreshingSingbox] = useState(false);
    const [singboxError, setSingboxError] = useState('');

    const [redetectingChrome, setRedetectingChrome] = useState(false);

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

    const recommendedSingboxRelease =
        (kernelStatus?.availableSingboxReleases || []).find(
            (r) => r.recommended,
        ) || kernelStatus?.availableSingboxReleases?.[0];
    const recommendedFpRelease =
        (kernelStatus?.availableReleases || []).find((r) => r.recommended) ||
        kernelStatus?.availableReleases?.[0];

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

    const handleCopyText = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            showNotification(
                'success',
                isEn ? `Copied ${label}` : `已复制${label}`,
            );
        } catch {
            showNotification(
                'error',
                t(
                    '复制失败，请手动选中复制',
                    'Copy failed. Select and copy manually.',
                ),
            );
        }
    };

    const handleOpenComponentDir = async (target: KernelOpenDirTarget) => {
        try {
            const opened = await kernelApi.openDir(target);
            if (!opened) {
                showNotification(
                    'error',
                    t('未找到可打开的本地路径', 'Local path not found'),
                );
            }
        } catch (err) {
            showNotification('error', cleanIpcError(err, locale));
        }
    };

    const handleRefreshSingbox = async () => {
        if (!kernelApi.isAvailable() || refreshingSingbox) return;
        try {
            setRefreshingSingbox(true);
            setSingboxError('');
            const next = await kernelApi.refreshSingboxReleases(
                buildSingboxProxyOptions(),
            );
            onKernelStatusChange(next);
            const sbInfo = next.updateSummary?.singbox;
            if (sbInfo?.hasUpdate && sbInfo.recommendedVersion) {
                showNotification(
                    'info',
                    isEn
                        ? `Recommended version v${sbInfo.recommendedVersion} is available`
                        : `发现可升级版本 v${sbInfo.recommendedVersion}`,
                );
            } else {
                const ver =
                    sbInfo?.currentVersion ||
                    coreInfo?.version ||
                    sbInfo?.recommendedVersion ||
                    '';
                showNotification(
                    'success',
                    isEn
                        ? `Proxy engine is up to date${ver ? ` (v${ver})` : ''}`
                        : `代理引擎已是受控清单推荐版本${ver ? `（v${ver}）` : ''}`,
                );
            }
        } catch (err) {
            setSingboxError(cleanIpcError(err, locale));
        } finally {
            setRefreshingSingbox(false);
        }
    };

    const handleRefreshFp = async () => {
        if (!kernelApi.isAvailable() || refreshingFp) return;
        try {
            setRefreshingFp(true);
            setKernelError('');
            const next = await kernelApi.refreshReleases(
                buildFpDownloadProxyOptions(),
            );
            onKernelStatusChange(next);
            const fpInfo = next.updateSummary?.fingerprint;
            if (fpInfo?.hasUpdate && fpInfo.recommendedChromeMajor) {
                showNotification(
                    'info',
                    isEn
                        ? `Recommended update Core ${fpInfo.recommendedChromeMajor} is available`
                        : `发现可升级版本：内核 ${fpInfo.recommendedChromeMajor}`,
                );
            } else {
                const ver =
                    fpInfo?.currentVersion ||
                    activeFpKernel?.version ||
                    fpInfo?.recommendedVersion ||
                    '';
                showNotification(
                    'success',
                    isEn
                        ? `Privacy browser is up to date${ver ? ` (${ver})` : ''}`
                        : `防关联浏览器已是受控清单推荐版本${ver ? `（${ver}）` : ''}`,
                );
            }
        } catch (err) {
            setKernelError(cleanIpcError(err, locale));
        } finally {
            setRefreshingFp(false);
        }
    };

    const handleRedetectChrome = async () => {
        if (!kernelApi.isAvailable() || redetectingChrome) return;
        try {
            setRedetectingChrome(true);
            const next = await kernelApi.getStatus();
            if (next) {
                onKernelStatusChange(next);
                showNotification(
                    next.systemChromeAvailable ? 'success' : 'info',
                    next.systemChromeAvailable
                        ? t('已检测到本机标准 Chrome', 'Standard Chrome detected')
                        : t(
                              '仍未检测到本机 Google Chrome',
                              'Google Chrome not detected on this system',
                          ),
                );
            }
        } catch (err) {
            showNotification('error', cleanIpcError(err, locale));
        } finally {
            setRedetectingChrome(false);
        }
    };

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
    const copyPathTip = t('复制路径', 'Copy path');
    const copyShaTip = t('复制完整摘要', 'Copy full SHA-256');
    const canUseFallbackProxy =
        fallbackProxyEnabled && Boolean(fallbackProxyAddress.trim());

    const activeSingboxVersion =
        activeSingboxCore?.version || coreInfo?.version || '';
    const activeSingboxInstalledAt = formatDateTime(
        activeSingboxCore?.installedAt,
        locale,
    );
    const activeFpInstalledAt = formatDateTime(
        activeFpKernel?.installedAt,
        locale,
    );

    const headerClass = mergeClasses(
        styles.cardHeader,
        styles.cardHeaderInteractive,
    );

    return (
        <>
            {/* 代理引擎 */}
            <div className={styles.card}>
                <div
                    className={headerClass}
                    onClick={(e) => {
                        if (isInteractiveClickTarget(e.target)) return;
                        setSingboxExpanded((prev) => !prev);
                    }}
                >
                    <div className={styles.cardTitleGroup}>
                        <BoxRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('teal')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('代理引擎', 'Proxy Engine')}
                        </h2>
                        <InfoTip
                            content={t(
                                '内置 sing-box 代理转发核心，按需安装并自动完成 SHA-256 完整性校验',
                                'Built-in sing-box proxy core, installed on demand with automatic SHA-256 verification.',
                            )}
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
                                    ? `Ready · v${activeSingboxVersion}`
                                    : `已就绪 · v${activeSingboxVersion}`}
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
                                        onClick={() =>
                                            void handleOpenComponentDir('sing-box')
                                        }
                                    >
                                        {t('打开所在位置', 'Open Location')}
                                    </MenuItem>
                                    <MenuItem
                                        icon={<FolderOpenRegular />}
                                        disabled={downloadingSingbox || singboxBusy}
                                        onClick={() => void handleImportSingbox()}
                                    >
                                        {importFileLabel}
                                    </MenuItem>
                                    {activeSingboxCore && (
                                        <MenuItem
                                            icon={<DeleteRegular />}
                                            disabled={
                                                downloadingSingbox || singboxBusy
                                            }
                                            onClick={() =>
                                                void handleRemoveSingbox(
                                                    activeSingboxCore.id,
                                                )
                                            }
                                        >
                                            {t('移除当前引擎', 'Remove Engine')}
                                        </MenuItem>
                                    )}
                                </MenuList>
                            </MenuPopover>
                        </Menu>

                        <ExpandToggleButton
                            expanded={singboxExpanded}
                            testId="component-toggle-singbox"
                            expandLabel={t(
                                '展开代理引擎详情',
                                'Show proxy engine details',
                            )}
                            collapseLabel={t(
                                '收起代理引擎详情',
                                'Hide proxy engine details',
                            )}
                            onToggle={() => setSingboxExpanded((prev) => !prev)}
                        />
                    </div>
                </div>

                {singboxError && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>
                            {translateBackendMessage(singboxError, locale)}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {singboxExpanded && (
                    <div
                        className={styles.subPanel}
                        data-testid="component-details-singbox"
                    >
                        <div className={styles.infoGrid} data-selectable="true">
                            {singboxReady ? (
                                <>
                                    <span className={styles.infoKey}>
                                        {t('核心版本', 'Version')}
                                    </span>
                                    <div className={styles.detailValueRow}>
                                        <span className={styles.infoVal}>
                                            sing-box v{activeSingboxVersion}
                                        </span>
                                        {!singboxSummary?.hasUpdate &&
                                            singboxSummary?.recommendedVersion && (
                                                <Badge
                                                    size="small"
                                                    appearance="tint"
                                                    color="subtle"
                                                >
                                                    {t('推荐版本', 'Recommended')}
                                                </Badge>
                                            )}
                                    </div>

                                    <span className={styles.infoKey}>
                                        {t('安装来源', 'Source')}
                                    </span>
                                    <span className={styles.infoVal}>
                                        {activeSingboxCore?.source ===
                                        'github-release'
                                            ? t(
                                                  'GitHub 官方发行版',
                                                  'Official GitHub Release',
                                              )
                                            : activeSingboxCore?.source ===
                                                'local-import'
                                              ? t('本地导入', 'Local Import')
                                              : t('内置核心', 'Bundled Core')}
                                    </span>

                                    <span className={styles.infoKey}>
                                        {t('完整性校验', 'Verification')}
                                    </span>
                                    <div className={styles.detailValueRow}>
                                        <Badge
                                            size="small"
                                            appearance="tint"
                                            color={
                                                activeSingboxCore?.checksumVerified
                                                    ? 'success'
                                                    : 'subtle'
                                            }
                                        >
                                            {activeSingboxCore?.checksumVerified
                                                ? t(
                                                      'SHA-256 已校验',
                                                      'SHA-256 Verified',
                                                  )
                                                : t(
                                                      '本地文件已登记',
                                                      'Local File Registered',
                                                  )}
                                        </Badge>
                                    </div>

                                    {activeSingboxCore?.executableSha256 && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('文件摘要', 'SHA-256')}
                                            </span>
                                            <CopyableMonoValue
                                                value={
                                                    activeSingboxCore.executableSha256
                                                }
                                                displayValue={formatShortSha256(
                                                    activeSingboxCore.executableSha256,
                                                )}
                                                showFullTooltip
                                                copyTooltip={copyShaTip}
                                                copyAriaLabel={t(
                                                    '复制文件摘要',
                                                    'Copy SHA-256',
                                                )}
                                                onCopy={() =>
                                                    void handleCopyText(
                                                        activeSingboxCore.executableSha256,
                                                        t('文件摘要', 'SHA-256'),
                                                    )
                                                }
                                                rowClassName={
                                                    styles.detailValueRow
                                                }
                                                monoClassName={styles.monoValue}
                                            />
                                        </>
                                    )}

                                    {activeSingboxCore?.sizeBytes ? (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('占用空间', 'Size')}
                                            </span>
                                            <span className={styles.infoVal}>
                                                {formatBytes(
                                                    activeSingboxCore.sizeBytes,
                                                )}
                                            </span>
                                        </>
                                    ) : null}

                                    {activeSingboxInstalledAt && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('安装时间', 'Installed')}
                                            </span>
                                            <span className={styles.infoVal}>
                                                {activeSingboxInstalledAt}
                                            </span>
                                        </>
                                    )}

                                    {activeSingboxCore?.executablePath && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('可执行路径', 'Executable')}
                                            </span>
                                            <CopyableMonoValue
                                                value={
                                                    activeSingboxCore.executablePath
                                                }
                                                copyTooltip={copyPathTip}
                                                copyAriaLabel={t(
                                                    '复制代理引擎路径',
                                                    'Copy proxy engine path',
                                                )}
                                                onCopy={() =>
                                                    void handleCopyText(
                                                        activeSingboxCore.executablePath,
                                                        t('路径', 'path'),
                                                    )
                                                }
                                                rowClassName={
                                                    styles.detailValueRow
                                                }
                                                monoClassName={styles.monoValue}
                                            />
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    {recommendedSingboxRelease && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('推荐版本', 'Recommended')}
                                            </span>
                                            <span className={styles.infoVal}>
                                                sing-box v
                                                {recommendedSingboxRelease.version}
                                            </span>

                                            {recommendedSingboxRelease.sizeBytes ? (
                                                <>
                                                    <span
                                                        className={styles.infoKey}
                                                    >
                                                        {t(
                                                            '预计大小',
                                                            'Download Size',
                                                        )}
                                                    </span>
                                                    <span
                                                        className={styles.infoVal}
                                                    >
                                                        {formatBytes(
                                                            recommendedSingboxRelease.sizeBytes,
                                                        )}
                                                    </span>
                                                </>
                                            ) : null}

                                            {recommendedSingboxRelease.sha256 && (
                                                <>
                                                    <span
                                                        className={styles.infoKey}
                                                    >
                                                        {t(
                                                            '官方摘要',
                                                            'Official SHA-256',
                                                        )}
                                                    </span>
                                                    <CopyableMonoValue
                                                        value={
                                                            recommendedSingboxRelease.sha256
                                                        }
                                                        displayValue={formatShortSha256(
                                                            recommendedSingboxRelease.sha256,
                                                        )}
                                                        showFullTooltip
                                                        copyTooltip={copyShaTip}
                                                        copyAriaLabel={t(
                                                            '复制官方摘要',
                                                            'Copy official SHA-256',
                                                        )}
                                                        onCopy={() =>
                                                            void handleCopyText(
                                                                recommendedSingboxRelease.sha256,
                                                                t(
                                                                    '官方摘要',
                                                                    'SHA-256',
                                                                ),
                                                            )
                                                        }
                                                        rowClassName={
                                                            styles.detailValueRow
                                                        }
                                                        monoClassName={
                                                            styles.monoValue
                                                        }
                                                    />
                                                </>
                                            )}
                                        </>
                                    )}

                                    {kernelStatus?.singboxDir && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('安装目录', 'Install Dir')}
                                            </span>
                                            <span className={styles.monoValue}>
                                                {kernelStatus.singboxDir}
                                            </span>
                                        </>
                                    )}

                                    <span className={styles.infoKey}>
                                        {t('安全策略', 'Security')}
                                    </span>
                                    <span className={styles.infoVal}>
                                        {t(
                                            '仅从 GitHub 官方发行版下载并强制校验 SHA-256 摘要',
                                            'Downloaded exclusively from official GitHub Releases with strict SHA-256 verification.',
                                        )}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className={styles.detailFooter}>
                            <div className={styles.detailActions}>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    disabled={
                                        refreshingSingbox ||
                                        downloadingSingbox ||
                                        singboxBusy
                                    }
                                    icon={<ArrowSyncRegular />}
                                    onClick={() => void handleRefreshSingbox()}
                                >
                                    {refreshingSingbox
                                        ? t('检查中…', 'Checking…')
                                        : t('检查版本', 'Check Version')}
                                </Button>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    icon={<OpenRegular />}
                                    onClick={() =>
                                        void handleOpenComponentDir('sing-box')
                                    }
                                >
                                    {t('定位文件', 'Reveal File')}
                                </Button>
                            </div>
                            {installedSingbox.length > 0 && (
                                <span className={styles.detailHint}>
                                    {isEn
                                        ? `${installedSingbox.length} installed`
                                        : `已安装 ${installedSingbox.length} 个版本`}
                                </span>
                            )}
                        </div>
                    </div>
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
                                            aria-label={t('移除版本', 'Remove')}
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
                <div
                    className={headerClass}
                    onClick={(e) => {
                        if (isInteractiveClickTarget(e.target)) return;
                        setFpExpanded((prev) => !prev);
                    }}
                >
                    <div className={styles.cardTitleGroup}>
                        <WindowMultipleRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('violet')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('防关联浏览器', 'Privacy Browser')}
                        </h2>
                        <InfoTip
                            content={t(
                                '内置防关联 Chromium 浏览器，提供原生级硬件指纹隔离，适合多账号防关联场景',
                                'Built-in anti-correlation Chromium providing native hardware fingerprint isolation.',
                            )}
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
                                        onClick={() =>
                                            void handleOpenComponentDir('kernels')
                                        }
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
                                            disabled={downloadingFp || kernelBusy}
                                            onClick={() =>
                                                void handleRemoveKernel(
                                                    activeFpKernel.id,
                                                )
                                            }
                                        >
                                            {t('移除当前浏览器', 'Remove Browser')}
                                        </MenuItem>
                                    )}
                                </MenuList>
                            </MenuPopover>
                        </Menu>

                        <ExpandToggleButton
                            expanded={fpExpanded}
                            testId="component-toggle-fingerprint"
                            expandLabel={t(
                                '展开防关联浏览器详情',
                                'Show privacy browser details',
                            )}
                            collapseLabel={t(
                                '收起防关联浏览器详情',
                                'Hide privacy browser details',
                            )}
                            onToggle={() => setFpExpanded((prev) => !prev)}
                        />
                    </div>
                </div>

                {kernelError && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>
                            {translateBackendMessage(kernelError, locale)}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {fpExpanded && (
                    <div
                        className={styles.subPanel}
                        data-testid="component-details-fingerprint"
                    >
                        <div className={styles.infoGrid} data-selectable="true">
                            {activeFpKernel ? (
                                <>
                                    <span className={styles.infoKey}>
                                        {t('完整版本', 'Version')}
                                    </span>
                                    <div className={styles.detailValueRow}>
                                        <span className={styles.infoVal}>
                                            Chrome {activeFpKernel.chromeMajor} (
                                            {activeFpKernel.version})
                                        </span>
                                        {!fpSummary?.hasUpdate &&
                                            fpSummary?.recommendedVersion && (
                                                <Badge
                                                    size="small"
                                                    appearance="tint"
                                                    color="subtle"
                                                >
                                                    {t('推荐版本', 'Recommended')}
                                                </Badge>
                                            )}
                                    </div>

                                    <span className={styles.infoKey}>
                                        {t('安装来源', 'Source')}
                                    </span>
                                    <span className={styles.infoVal}>
                                        {activeFpKernel.source ===
                                        'github-release'
                                            ? t(
                                                  'GitHub 官方发行版',
                                                  'Official GitHub Release',
                                              )
                                            : t('本地导入', 'Local Import')}
                                    </span>

                                    <span className={styles.infoKey}>
                                        {t('安全审计', 'Auditability')}
                                    </span>
                                    <div className={styles.detailValueRow}>
                                        <Badge
                                            size="small"
                                            appearance="tint"
                                            color={
                                                activeFpKernel.sourceAuditable
                                                    ? 'success'
                                                    : 'subtle'
                                            }
                                        >
                                            {activeFpKernel.sourceAuditable
                                                ? t(
                                                      '源码已公开',
                                                      'Source Auditable',
                                                  )
                                                : t(
                                                      '延迟开源',
                                                      'Delayed Source',
                                                  )}
                                        </Badge>
                                        <Badge
                                            size="small"
                                            appearance="tint"
                                            color={
                                                activeFpKernel.checksumVerified
                                                    ? 'success'
                                                    : 'subtle'
                                            }
                                        >
                                            {activeFpKernel.checksumVerified
                                                ? t(
                                                      'SHA-256 已校验',
                                                      'SHA-256 Verified',
                                                  )
                                                : t(
                                                      '本地文件已登记',
                                                      'Local File Registered',
                                                  )}
                                        </Badge>
                                    </div>

                                    {activeFpKernel.executableSha256 && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('文件摘要', 'SHA-256')}
                                            </span>
                                            <CopyableMonoValue
                                                value={
                                                    activeFpKernel.executableSha256
                                                }
                                                displayValue={formatShortSha256(
                                                    activeFpKernel.executableSha256,
                                                )}
                                                showFullTooltip
                                                copyTooltip={copyShaTip}
                                                copyAriaLabel={t(
                                                    '复制内核摘要',
                                                    'Copy kernel SHA-256',
                                                )}
                                                onCopy={() =>
                                                    void handleCopyText(
                                                        activeFpKernel.executableSha256,
                                                        t('文件摘要', 'SHA-256'),
                                                    )
                                                }
                                                rowClassName={
                                                    styles.detailValueRow
                                                }
                                                monoClassName={styles.monoValue}
                                            />
                                        </>
                                    )}

                                    {activeFpKernel.sizeBytes ? (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('占用空间', 'Size')}
                                            </span>
                                            <span className={styles.infoVal}>
                                                {formatBytes(
                                                    activeFpKernel.sizeBytes,
                                                )}
                                            </span>
                                        </>
                                    ) : null}

                                    {activeFpInstalledAt && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('安装时间', 'Installed')}
                                            </span>
                                            <span className={styles.infoVal}>
                                                {activeFpInstalledAt}
                                            </span>
                                        </>
                                    )}

                                    <span className={styles.infoKey}>
                                        {t('可执行路径', 'Executable')}
                                    </span>
                                    <CopyableMonoValue
                                        value={activeFpKernel.executablePath}
                                        copyTooltip={copyPathTip}
                                        copyAriaLabel={t(
                                            '复制防关联浏览器路径',
                                            'Copy privacy browser path',
                                        )}
                                        onCopy={() =>
                                            void handleCopyText(
                                                activeFpKernel.executablePath,
                                                t('路径', 'path'),
                                            )
                                        }
                                        rowClassName={styles.detailValueRow}
                                        monoClassName={styles.monoValue}
                                    />
                                </>
                            ) : (
                                <>
                                    {recommendedFpRelease && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('推荐版本', 'Recommended')}
                                            </span>
                                            <span className={styles.infoVal}>
                                                Chrome{' '}
                                                {recommendedFpRelease.chromeMajor}{' '}
                                                ({recommendedFpRelease.version})
                                            </span>

                                            <span className={styles.infoKey}>
                                                {t('安全审计', 'Auditability')}
                                            </span>
                                            <div className={styles.detailValueRow}>
                                                <Badge
                                                    size="small"
                                                    appearance="tint"
                                                    color={
                                                        recommendedFpRelease.sourceAuditable
                                                            ? 'success'
                                                            : 'subtle'
                                                    }
                                                >
                                                    {recommendedFpRelease.sourceAuditable
                                                        ? t(
                                                              '源码已公开',
                                                              'Source Auditable',
                                                          )
                                                        : t(
                                                              '延迟开源',
                                                              'Delayed Source',
                                                          )}
                                                </Badge>
                                            </div>

                                            {recommendedFpRelease.sizeBytes ? (
                                                <>
                                                    <span
                                                        className={styles.infoKey}
                                                    >
                                                        {t(
                                                            '安装包大小',
                                                            'Package Size',
                                                        )}
                                                    </span>
                                                    <span
                                                        className={styles.infoVal}
                                                    >
                                                        {formatBytes(
                                                            recommendedFpRelease.sizeBytes,
                                                        )}
                                                    </span>
                                                </>
                                            ) : null}

                                            {recommendedFpRelease.sha256 && (
                                                <>
                                                    <span
                                                        className={styles.infoKey}
                                                    >
                                                        {t(
                                                            '官方摘要',
                                                            'Official SHA-256',
                                                        )}
                                                    </span>
                                                    <CopyableMonoValue
                                                        value={
                                                            recommendedFpRelease.sha256
                                                        }
                                                        displayValue={formatShortSha256(
                                                            recommendedFpRelease.sha256,
                                                        )}
                                                        showFullTooltip
                                                        copyTooltip={copyShaTip}
                                                        copyAriaLabel={t(
                                                            '复制官方摘要',
                                                            'Copy official SHA-256',
                                                        )}
                                                        onCopy={() =>
                                                            void handleCopyText(
                                                                recommendedFpRelease.sha256 ||
                                                                    '',
                                                                t(
                                                                    '官方摘要',
                                                                    'SHA-256',
                                                                ),
                                                            )
                                                        }
                                                        rowClassName={
                                                            styles.detailValueRow
                                                        }
                                                        monoClassName={
                                                            styles.monoValue
                                                        }
                                                    />
                                                </>
                                            )}
                                        </>
                                    )}

                                    {kernelStatus?.kernelsDir && (
                                        <>
                                            <span className={styles.infoKey}>
                                                {t('组件目录', 'Kernels Dir')}
                                            </span>
                                            <span className={styles.monoValue}>
                                                {kernelStatus.kernelsDir}
                                            </span>
                                        </>
                                    )}

                                    <span className={styles.infoKey}>
                                        {t('隔离机制', 'Isolation')}
                                    </span>
                                    <span className={styles.infoVal}>
                                        {t(
                                            '原生 C++ 硬件指纹隔离，默认零扩展与零 JS 注入',
                                            'Native C++ hardware fingerprint isolation with zero extensions and zero JS hooks by default.',
                                        )}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className={styles.detailFooter}>
                            <div className={styles.detailActions}>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    disabled={
                                        refreshingFp ||
                                        downloadingFp ||
                                        kernelBusy
                                    }
                                    icon={<ArrowSyncRegular />}
                                    onClick={() => void handleRefreshFp()}
                                >
                                    {refreshingFp
                                        ? t('检查中…', 'Checking…')
                                        : t('检查版本', 'Check Version')}
                                </Button>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    icon={<OpenRegular />}
                                    onClick={() =>
                                        void handleOpenComponentDir(
                                            activeFpKernel
                                                ? 'fingerprint-chromium'
                                                : 'kernels',
                                        )
                                    }
                                >
                                    {activeFpKernel
                                        ? t('定位文件', 'Reveal File')
                                        : t('打开组件目录', 'Open Folder')}
                                </Button>
                            </div>
                            {installedFpList.length > 0 && (
                                <span className={styles.detailHint}>
                                    {isEn
                                        ? `${installedFpList.length} installed`
                                        : `已安装 ${installedFpList.length} 个版本`}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {installedFpList.length > 1 && (
                    <div className={styles.listStack}>
                        {installedFpList.map((kernel) => {
                            const isActive =
                                kernel.id === kernelStatus?.activeKernelId;
                            return (
                                <div key={kernel.id} className={styles.listItem}>
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
                                            aria-label={t('移除版本', 'Remove')}
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
                                        <option key={proxy.id} value={proxy.id}>
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
            </div>

            {/* 标准 Chrome */}
            <div className={styles.card}>
                <div
                    className={headerClass}
                    onClick={(e) => {
                        if (isInteractiveClickTarget(e.target)) return;
                        setChromeExpanded((prev) => !prev);
                    }}
                >
                    <div className={styles.cardTitleGroup}>
                        <GlobeRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('blue')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('标准 Chrome', 'Standard Chrome')}
                        </h2>
                        <InfoTip
                            content={t(
                                '调用系统已安装的 Google Chrome，具备官方签名与自动安全更新，适合高安全主号',
                                'Uses system-installed Google Chrome with official signing and automatic security updates.',
                            )}
                        />
                    </div>

                    <div className={styles.componentRight}>
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

                        <ExpandToggleButton
                            expanded={chromeExpanded}
                            testId="component-toggle-chrome"
                            expandLabel={t(
                                '展开标准 Chrome 详情',
                                'Show Standard Chrome details',
                            )}
                            collapseLabel={t(
                                '收起标准 Chrome 详情',
                                'Hide Standard Chrome details',
                            )}
                            onToggle={() => setChromeExpanded((prev) => !prev)}
                        />
                    </div>
                </div>

                {chromeExpanded && (
                    <div
                        className={styles.subPanel}
                        data-testid="component-details-chrome"
                    >
                        <div className={styles.infoGrid} data-selectable="true">
                            <span className={styles.infoKey}>
                                {t('检测状态', 'Status')}
                            </span>
                            <span className={styles.infoVal}>
                                {kernelStatus?.systemChromeAvailable
                                    ? t(
                                          '已检测到系统安装的 Google Chrome',
                                          'System Google Chrome detected',
                                      )
                                    : t(
                                          '未在本机默认路径检测到 Google Chrome',
                                          'Google Chrome not detected in default system paths',
                                      )}
                            </span>

                            <span className={styles.infoKey}>
                                {t('适用场景', 'Recommended Use')}
                            </span>
                            <span className={styles.infoVal}>
                                {t(
                                    '高安全要求的敏感业务与主账号，完整保留官方签名与自动更新',
                                    'Sensitive primary accounts requiring official signing and automatic security updates.',
                                )}
                            </span>

                            <span className={styles.infoKey}>
                                {t('隔离机制', 'Isolation')}
                            </span>
                            <span className={styles.infoVal}>
                                {t(
                                    '独立用户数据目录、严格代理防泄露与原生地区对齐',
                                    'Isolated user data directory, strict fail-closed proxy routing, and native locale alignment.',
                                )}
                            </span>

                            {kernelStatus?.systemChromePath && (
                                <>
                                    <span className={styles.infoKey}>
                                        {t('可执行路径', 'Executable')}
                                    </span>
                                    <CopyableMonoValue
                                        value={kernelStatus.systemChromePath}
                                        copyTooltip={copyPathTip}
                                        copyAriaLabel={t(
                                            '复制标准 Chrome 路径',
                                            'Copy Standard Chrome path',
                                        )}
                                        onCopy={() =>
                                            void handleCopyText(
                                                kernelStatus.systemChromePath,
                                                t('路径', 'path'),
                                            )
                                        }
                                        rowClassName={styles.detailValueRow}
                                        monoClassName={styles.monoValue}
                                    />
                                </>
                            )}
                        </div>

                        <div className={styles.detailFooter}>
                            <div className={styles.detailActions}>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    disabled={redetectingChrome}
                                    icon={<ArrowSyncRegular />}
                                    onClick={() => void handleRedetectChrome()}
                                >
                                    {redetectingChrome
                                        ? t('检测中…', 'Detecting…')
                                        : t('重新检测', 'Re-detect')}
                                </Button>
                                {kernelStatus?.systemChromeAvailable && (
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        icon={<OpenRegular />}
                                        onClick={() =>
                                            void handleOpenComponentDir(
                                                'system-chrome',
                                            )
                                        }
                                    >
                                        {t('定位文件', 'Reveal File')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default ComponentsSettingsPanel;
