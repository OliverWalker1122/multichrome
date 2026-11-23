import React, { useCallback, useEffect, useState } from 'react';
import {
    Badge,
    Button,
    Field,
    Input,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarBody,
    ProgressBar,
    Select,
    Switch,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowDownloadRegular,
    ArrowSyncRegular,
    BoxRegular,
    CheckmarkCircleRegular,
    ChevronDownRegular,
    ChevronUpRegular,
    DeleteRegular,
    DesktopRegular,
    FolderOpenRegular,
    GlobeRegular,
    InfoRegular,
    MoreHorizontalRegular,
    OpenRegular,
    PlugConnectedRegular,
    SettingsRegular,
    ShieldCheckmarkRegular,
    StarRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import {
    AppLocale,
    AppSettings,
    BookmarkTemplate,
    BrowserEngineType,
    DefaultFingerprintSettings,
    ExtensionTemplate,
    FingerprintBrand,
    FingerprintPlatform,
    KernelDownloadProgress,
    KernelStatus,
    ManagedProxy,
    ProxyCoreInfo,
    ThemeMode,
} from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { getToneStyle } from '../theme/semanticColors';
import { workspaceTitle } from '../theme/workspaceStyles';
import { tr, translateBackendMessage, useI18n } from '../i18n';
import AppBrandIcon from './AppBrandIcon';
import AutomationSettingsPanel from './AutomationSettingsPanel';
import InfoTip from './InfoTip';

interface SettingsPageProps {
    currentSettings: AppSettings;
    onSave: (settings: AppSettings) => Promise<boolean>;
    onThemePreview: (theme: ThemeMode) => Promise<void>;
    coreInfo: ProxyCoreInfo | null;
    appVersion: string;
    managedProxies: ManagedProxy[];
    groups?: string[];
    kernelStatus: KernelStatus | null;
    onKernelStatusChange: (status: KernelStatus) => void;
}

type SettingsTab =
    | 'general'
    | 'browser'
    | 'privacy'
    | 'automation'
    | 'components'
    | 'about';

function getHostDefaultPlatform(): FingerprintPlatform {
    const p = window.electronAPI?.app?.platform;
    if (p === 'darwin') return 'macos';
    if (p === 'linux') return 'linux';
    return 'windows';
}

const QUICK_STARTUP_URLS = [
    { zh: 'ippure.com', en: 'ippure.com', url: 'https://ippure.com/' },
    { zh: 'BrowserScan', en: 'BrowserScan', url: 'https://www.browserscan.net/' },
    { zh: 'BrowserLeaks', en: 'BrowserLeaks', url: 'https://browserleaks.com/webrtc' },
    { zh: '留空', en: 'Blank', url: '' },
];

const COMMON_LANGUAGES = [
    { value: 'en-US', zh: '英语（美国）', en: 'English (US)' },
    { value: 'en-GB', zh: '英语（英国）', en: 'English (UK)' },
    { value: 'ja-JP', zh: '日语', en: 'Japanese' },
    { value: 'ko-KR', zh: '韩语', en: 'Korean' },
    { value: 'zh-TW', zh: '繁体中文', en: 'Traditional Chinese' },
];

const SPOOFING_ITEMS: Array<{
    key: keyof DefaultFingerprintSettings['spoofing'];
    zh: string;
    en: string;
    tipZh: string;
    tipEn: string;
}> = [
    {
        key: 'canvas',
        zh: '画布特征',
        en: 'Canvas',
        tipZh: '为每个环境生成独立的 Canvas 绘图特征，避免跨账号关联',
        tipEn: 'Generates unique Canvas drawing signatures per profile',
    },
    {
        key: 'audio',
        zh: '音频特征',
        en: 'Audio',
        tipZh: '隔离音频处理指纹，防止通过声卡特征关联',
        tipEn: 'Isolates AudioContext signatures across profiles',
    },
    {
        key: 'font',
        zh: '字体列表',
        en: 'Fonts',
        tipZh: '防止网站读取本机已安装的字体列表',
        tipEn: 'Prevents sites from enumerating host fonts',
    },
    {
        key: 'clientrects',
        zh: '页面布局度量',
        en: 'Layout Metrics',
        tipZh: '微调元素渲染尺寸特征，避免跨环境撞脸',
        tipEn: 'Perturbs DOM ClientRects measurements per profile',
    },
    {
        key: 'gpu',
        zh: '显卡与图形',
        en: 'Graphics / WebGL',
        tipZh: '隔离 WebGL 图形渲染特征与显卡标识',
        tipEn: 'Isolates WebGL rendering output and GPU identifiers',
    },
];

function formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
}

function cleanIpcError(err: unknown, locale: AppLocale): string {
    const raw =
        err instanceof Error
            ? err.message.replace(
                  /^Error invoking remote method '[^']+': (?:Error: )?/,
                  '',
              )
            : typeof err === 'string' && err.trim()
              ? err.replace(
                    /^Error invoking remote method '[^']+': (?:Error: )?/,
                    '',
                )
              : '';
    if (raw.trim()) {
        return translateBackendMessage(raw.trim(), locale);
    }
    return tr(
        '操作失败，请稍后重试',
        'Operation failed. Please try again.',
        locale,
    );
}

function normalizeFpState(
    raw?: DefaultFingerprintSettings,
): DefaultFingerprintSettings {
    return {
        defaultEngine: raw?.defaultEngine || 'system-chrome',
        platform: raw?.platform || getHostDefaultPlatform(),
        brand: raw?.brand || 'Chrome',
        autoMatchTimezone: raw?.autoMatchTimezone !== false,
        autoMatchLanguage: Boolean(raw?.autoMatchLanguage),
        autoMatchGeolocation: Boolean(raw?.autoMatchGeolocation),
        defaultLanguage: raw?.defaultLanguage || 'en-US',
        spoofing: {
            canvas: raw?.spoofing?.canvas !== false,
            audio: raw?.spoofing?.audio !== false,
            font: raw?.spoofing?.font !== false,
            clientrects: raw?.spoofing?.clientrects !== false,
            gpu: raw?.spoofing?.gpu !== false,
        },
    };
}

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px 24px 12px 24px',
        flexShrink: 0,
    },
    headerTop: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
    },
    title: workspaceTitle,
    headerActions: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
    },
    pillTabsBar: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px',
        borderRadius: '11px',
        backgroundColor: 'var(--glass-pill)',
        border: '1px solid var(--glass-border)',
        alignSelf: 'flex-start',
        flexWrap: 'wrap',
        maxWidth: '100%',
    },
    pillTab: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 14px',
        borderRadius: '8px',
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '13px',
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transitionProperty: 'background-color, color, box-shadow',
        transitionDuration: '120ms',
        ':hover': {
            color: tokens.colorNeutralForeground1,
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
        ':focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    pillTabActive: {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorBrandForeground1,
        fontWeight: 600,
        boxShadow: tokens.shadow2,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1,
            color: tokens.colorBrandForeground1,
        },
    },
    tabDot: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: tokens.colorPaletteRedBackground3,
        flexShrink: 0,
    },
    body: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '4px 24px 32px 24px',
    },
    container: {
        maxWidth: '760px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px 18px',
        borderRadius: '14px',
        backgroundColor: 'var(--glass-card)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        flexWrap: 'wrap',
    },
    cardTitleGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    cardTitle: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        lineHeight: '20px',
        color: tokens.colorNeutralForeground1,
    },
    sectionIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        borderRadius: '7px',
        fontSize: '14px',
        flexShrink: 0,
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        minHeight: '34px',
    },
    rowLabel: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        fontWeight: 500,
        color: tokens.colorNeutralForeground1,
    },
    divider: {
        height: '1px',
        backgroundColor: tokens.colorNeutralStroke2,
    },
    twoCol: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
    },
    pathRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    inlineAddRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
    },
    chipsRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
    },
    listStack: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    listItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '8px 10px',
        borderRadius: '8px',
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
    },
    listItemMain: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        flex: 1,
    },
    listItemTitle: {
        fontSize: '13px',
        fontWeight: 500,
        color: tokens.colorNeutralForeground1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    listItemSub: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    subPanel: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        borderRadius: '10px',
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
    },
    spoofGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '8px',
    },
    spoofItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '6px 10px',
        borderRadius: '8px',
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
    },
    componentRight: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
    },
    aboutHero: {
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
    },
    aboutName: {
        margin: 0,
        fontSize: '18px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
    },
    aboutMeta: {
        fontSize: '12.5px',
        color: tokens.colorNeutralForeground3,
        marginTop: '2px',
    },
    infoGrid: {
        display: 'grid',
        gridTemplateColumns: '110px minmax(0, 1fr)',
        rowGap: '8px',
        columnGap: '12px',
        fontSize: '13px',
    },
    infoKey: {
        color: tokens.colorNeutralForeground3,
    },
    infoVal: {
        color: tokens.colorNeutralForeground1,
        wordBreak: 'break-all',
    },
});

const SettingsPage: React.FC<SettingsPageProps> = ({
    currentSettings,
    onSave,
    onThemePreview,
    coreInfo,
    appVersion,
    managedProxies,
    groups = [],
    kernelStatus,
    onKernelStatusChange,
}) => {
    const styles = useStyles();
    const { locale, isEn, setLocale: setAppLocale, t } = useI18n();
    const { showNotification } = useNotification();
    const hostPlatform = window.electronAPI?.app?.platform || 'win32';
    const isMac = hostPlatform === 'darwin';
    const isLinux = hostPlatform === 'linux';

    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [fpCustomizeOpen, setFpCustomizeOpen] = useState(false);
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [updateResult, setUpdateResult] = useState<{
        currentVersion: string;
        latestVersion: string;
        hasUpdate: boolean;
        releaseUrl: string;
    } | null>(null);
    const [updateError, setUpdateError] = useState('');

    const [dataPath, setDataPath] = useState(currentSettings.dataPath || '');
    const [proxyEnabled, setProxyEnabled] = useState(
        Boolean(currentSettings.globalProxy?.enabled),
    );
    const [proxyAddress, setProxyAddress] = useState(
        currentSettings.globalProxy?.address || '',
    );
    const [startupUrl, setStartupUrl] = useState(
        currentSettings.startupUrl || '',
    );
    const [theme, setTheme] = useState<ThemeMode>(
        currentSettings.theme || 'system',
    );
    const [memorySaverMode, setMemorySaverMode] = useState(
        Boolean(currentSettings.memorySaverMode),
    );
    const [bookmarkTemplates, setBookmarkTemplates] = useState<
        BookmarkTemplate[]
    >(() => currentSettings.bookmarkTemplates || []);
    const [extensionTemplates, setExtensionTemplates] = useState<
        ExtensionTemplate[]
    >(() => currentSettings.extensionTemplates || []);
    const [
        allowExtensionsOnFingerprintKernel,
        setAllowExtensionsOnFingerprintKernel,
    ] = useState(Boolean(currentSettings.allowExtensionsOnFingerprintKernel));
    const [requireHealthCheckOnLaunch, setRequireHealthCheckOnLaunch] =
        useState(Boolean(currentSettings.requireHealthCheckOnLaunch));
    const [groupStartupUrls, setGroupStartupUrls] = useState<
        Record<string, string>
    >(() => currentSettings.groupStartupUrls || {});

    const [newBmName, setNewBmName] = useState('');
    const [newBmUrl, setNewBmUrl] = useState('');
    const [newBmFolder, setNewBmFolder] = useState('');
    const [newGroupKey, setNewGroupKey] = useState('');
    const [newGroupUrl, setNewGroupUrl] = useState('');

    const [fingerprint, setFingerprint] = useState<DefaultFingerprintSettings>(
        () => normalizeFpState(currentSettings.fingerprint),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // 组件安装状态
    const [selectedRelease, setSelectedRelease] = useState('');
    const [downloadProxyChoice, setDownloadProxyChoice] = useState('__direct__');
    const [downloadingFp, setDownloadingFp] = useState(false);
    const [fpProgress, setFpProgress] = useState<KernelDownloadProgress | null>(
        null,
    );
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
        setDataPath(currentSettings.dataPath || '');
        setProxyEnabled(Boolean(currentSettings.globalProxy?.enabled));
        setProxyAddress(currentSettings.globalProxy?.address || '');
        setStartupUrl(currentSettings.startupUrl || '');
        setTheme(currentSettings.theme || 'system');
        setMemorySaverMode(Boolean(currentSettings.memorySaverMode));
        setBookmarkTemplates(currentSettings.bookmarkTemplates || []);
        setExtensionTemplates(currentSettings.extensionTemplates || []);
        setAllowExtensionsOnFingerprintKernel(
            Boolean(currentSettings.allowExtensionsOnFingerprintKernel),
        );
        setRequireHealthCheckOnLaunch(
            Boolean(currentSettings.requireHealthCheckOnLaunch),
        );
        setGroupStartupUrls(currentSettings.groupStartupUrls || {});
        setFingerprint(normalizeFpState(currentSettings.fingerprint));
    }, [currentSettings]);

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
        const handleProgress = (_event: unknown, rawProgress: unknown) => {
            if (!rawProgress || typeof rawProgress !== 'object') return;
            const progress = rawProgress as KernelDownloadProgress;
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
        };
        window.electronAPI?.on?.('kernel-download-progress', handleProgress);
        return () => {
            window.electronAPI?.removeListener?.(
                'kernel-download-progress',
                handleProgress,
            );
        };
    }, []);

    const baselineFp = normalizeFpState(currentSettings.fingerprint);
    const isDirty =
        dataPath.trim() !== (currentSettings.dataPath || '') ||
        proxyEnabled !== Boolean(currentSettings.globalProxy?.enabled) ||
        proxyAddress.trim() !== (currentSettings.globalProxy?.address || '') ||
        startupUrl.trim() !== (currentSettings.startupUrl || '') ||
        theme !== (currentSettings.theme || 'system') ||
        memorySaverMode !== Boolean(currentSettings.memorySaverMode) ||
        allowExtensionsOnFingerprintKernel !==
            Boolean(currentSettings.allowExtensionsOnFingerprintKernel) ||
        requireHealthCheckOnLaunch !==
            Boolean(currentSettings.requireHealthCheckOnLaunch) ||
        JSON.stringify(bookmarkTemplates) !==
            JSON.stringify(currentSettings.bookmarkTemplates || []) ||
        JSON.stringify(extensionTemplates) !==
            JSON.stringify(currentSettings.extensionTemplates || []) ||
        JSON.stringify(groupStartupUrls) !==
            JSON.stringify(currentSettings.groupStartupUrls || {}) ||
        JSON.stringify(fingerprint) !== JSON.stringify(baselineFp);

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

    const handleDownloadSingbox = async (versionOverride?: string) => {
        const targetVersion =
            versionOverride ||
            singboxSummary?.recommendedVersion ||
            selectedSingboxVersion;
        if (!window.electronAPI?.kernels || !targetVersion) return;
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
            const res = await window.electronAPI.kernels.downloadSingbox(
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
        await window.electronAPI?.kernels?.cancelDownload('sing-box');
        setDownloadingSingbox(false);
        setSingboxProgress(null);
    };

    const handleImportSingbox = async () => {
        if (!window.electronAPI?.kernels) return;
        try {
            setSingboxBusy(true);
            setSingboxError('');
            const res = await window.electronAPI.kernels.importLocalSingbox();
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
        if (!window.electronAPI?.kernels) return;
        try {
            setSingboxBusy(true);
            setSingboxError('');
            const next = await window.electronAPI.kernels.setActiveSingbox(id);
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
        if (!window.electronAPI?.kernels) return;
        try {
            setSingboxBusy(true);
            setSingboxError('');
            const next = await window.electronAPI.kernels.removeSingbox(id);
            onKernelStatusChange(next);
            showNotification('success', t('已移除代理引擎', 'Removed proxy engine'));
        } catch (err) {
            setSingboxError(cleanIpcError(err, locale));
        } finally {
            setSingboxBusy(false);
        }
    };

    const handleDownloadKernel = async (versionOverride?: string) => {
        const targetVersion =
            versionOverride ||
            fpSummary?.recommendedVersion ||
            selectedRelease;
        if (!window.electronAPI?.kernels || !targetVersion) return;
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
            const result = await window.electronAPI.kernels.download(
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
        await window.electronAPI?.kernels?.cancelDownload(
            'fingerprint-chromium',
        );
        setDownloadingFp(false);
        setFpProgress(null);
    };

    const handleImportKernel = async (mode: 'file' | 'folder') => {
        if (!window.electronAPI?.kernels) return;
        try {
            setKernelBusy(true);
            setKernelError('');
            const res = await window.electronAPI.kernels.importLocal(mode);
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
        if (!window.electronAPI?.kernels) return;
        try {
            setKernelBusy(true);
            setKernelError('');
            const next = await window.electronAPI.kernels.setActive(kernelId);
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
        if (!window.electronAPI?.kernels) return;
        try {
            setKernelBusy(true);
            setKernelError('');
            const next = await window.electronAPI.kernels.remove(kernelId);
            onKernelStatusChange(next);
            showNotification('success', t('已移除该组件', 'Removed component'));
        } catch (err) {
            setKernelError(cleanIpcError(err, locale));
        } finally {
            setKernelBusy(false);
        }
    };

    const handleOpenRepo = async (
        url = 'https://github.com/OliverWalker1122/multichrome',
    ) => {
        try {
            await window.electronAPI?.app?.openExternal?.(url);
        } catch (err) {
            showNotification('error', cleanIpcError(err, locale));
        }
    };

    const handleCheckAppUpdate = async () => {
        if (!window.electronAPI?.app?.checkUpdate || checkingUpdate) return;
        try {
            setCheckingUpdate(true);
            setUpdateError('');
            const res = await window.electronAPI.app.checkUpdate();
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

    const handleSelectFolder = async () => {
        try {
            if (!window.electronAPI?.settings) return;
            const result = await window.electronAPI.settings.selectFolder();
            if (result && !result.canceled && result.filePaths.length > 0) {
                setDataPath(result.filePaths[0]);
                setError('');
            }
        } catch {
            setError(
                t(
                    '选择目录失败，请手动输入路径。',
                    'Failed to select folder. Enter the path manually.',
                ),
            );
        }
    };

    const handleAddBookmarkTemplate = () => {
        const name = newBmName.trim();
        const url = newBmUrl.trim();
        const folder = newBmFolder.trim();
        if (!name || !url) {
            showNotification(
                'warning',
                t('请填写书签名称和网址', 'Enter both name and URL'),
            );
            return;
        }
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('invalid');
            }
        } catch {
            showNotification(
                'error',
                t(
                    '网址需以 http:// 或 https:// 开头',
                    'URL must start with http:// or https://',
                ),
            );
            return;
        }
        setBookmarkTemplates((prev) => [
            ...prev,
            {
                id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name,
                url,
                ...(folder ? { folder } : {}),
            },
        ]);
        setNewBmName('');
        setNewBmUrl('');
        setNewBmFolder('');
    };

    const handleAddGroupStartupUrl = () => {
        const groupKey = newGroupKey.trim();
        const url = newGroupUrl.trim();
        if (!groupKey || !url) {
            showNotification(
                'warning',
                t('请选择分组并填写网址', 'Select a group and enter a URL'),
            );
            return;
        }
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('invalid');
            }
        } catch {
            showNotification(
                'error',
                t(
                    '网址需以 http:// 或 https:// 开头',
                    'URL must start with http:// or https://',
                ),
            );
            return;
        }
        setGroupStartupUrls((prev) => ({
            ...prev,
            [groupKey]: url,
        }));
        setNewGroupKey('');
        setNewGroupUrl('');
    };

    const handleAddExtensionFolder = async () => {
        try {
            if (!window.electronAPI?.settings?.selectFolder) return;
            const result = await window.electronAPI.settings.selectFolder();
            if (!result || result.canceled || result.filePaths.length === 0) {
                return;
            }
            const dirPath = result.filePaths[0];
            if (extensionTemplates.some((item) => item.path === dirPath)) {
                showNotification(
                    'info',
                    t('该扩展已在列表中', 'Extension already added'),
                );
                return;
            }
            const parts = dirPath.split(/[/\\]/).filter(Boolean);
            const name = parts[parts.length - 1] || dirPath;
            setExtensionTemplates((prev) => [
                ...prev,
                {
                    id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    name,
                    path: dirPath,
                    enabled: true,
                },
            ]);
            showNotification(
                'success',
                isEn
                    ? `Added "${name}". Click Save to apply.`
                    : `已添加「${name}」，点击「保存设置」生效`,
            );
        } catch {
            showNotification(
                'error',
                t('选择扩展目录失败', 'Failed to select extension folder'),
            );
        }
    };

    const handleReset = () => {
        setDataPath(currentSettings.dataPath || '');
        setProxyEnabled(Boolean(currentSettings.globalProxy?.enabled));
        setProxyAddress(currentSettings.globalProxy?.address || '');
        setStartupUrl(currentSettings.startupUrl || '');
        setTheme(currentSettings.theme || 'system');
        setMemorySaverMode(Boolean(currentSettings.memorySaverMode));
        setBookmarkTemplates(currentSettings.bookmarkTemplates || []);
        setExtensionTemplates(currentSettings.extensionTemplates || []);
        setAllowExtensionsOnFingerprintKernel(
            Boolean(currentSettings.allowExtensionsOnFingerprintKernel),
        );
        setRequireHealthCheckOnLaunch(
            Boolean(currentSettings.requireHealthCheckOnLaunch),
        );
        setGroupStartupUrls(currentSettings.groupStartupUrls || {});
        setFingerprint(normalizeFpState(currentSettings.fingerprint));
        setError('');
    };

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!dataPath.trim()) {
            setError(t('数据目录不能为空', 'Data directory cannot be empty'));
            return;
        }
        if (proxyEnabled && !proxyAddress.trim()) {
            setError(
                t(
                    '已开启全局备用代理，请填写代理地址或关闭开关',
                    'Enter a fallback proxy address or turn the switch off',
                ),
            );
            return;
        }

        try {
            setSaving(true);
            setError('');
            const ok = await onSave({
                dataPath: dataPath.trim(),
                globalProxy: {
                    enabled: proxyEnabled,
                    address: proxyAddress.trim(),
                },
                startupUrl: startupUrl.trim(),
                theme,
                locale,
                memorySaverMode,
                bookmarkTemplates,
                extensionTemplates,
                allowExtensionsOnFingerprintKernel,
                requireHealthCheckOnLaunch,
                groupStartupUrls,
                fingerprint,
            });
            if (ok) {
                showNotification('success', t('设置已保存', 'Settings saved'));
            } else {
                setError(
                    t(
                        '保存失败，请检查数据目录是否有写入权限',
                        'Save failed. Check folder write permissions.',
                    ),
                );
            }
        } catch (err) {
            setError(cleanIpcError(err, locale));
        } finally {
            setSaving(false);
        }
    };

    const importFileLabel = isMac
        ? t('导入 DMG / .app', 'Import DMG / .app')
        : isLinux
          ? t('导入安装包 / 可执行文件', 'Import archive / binary')
          : t('导入压缩包 / chrome.exe', 'Import ZIP / chrome.exe');

    const enabledSpoofCount = SPOOFING_ITEMS.filter(
        (item) => fingerprint.spoofing[item.key],
    ).length;

    const platformLabel =
        fingerprint.platform === 'macos'
            ? 'macOS'
            : fingerprint.platform === 'linux'
              ? 'Linux'
              : 'Windows';

    const tabs: Array<{
        id: SettingsTab;
        label: string;
        icon: React.ReactNode;
        dot?: boolean;
    }> = [
        { id: 'general', label: t('常规', 'General'), icon: <SettingsRegular /> },
        { id: 'browser', label: t('浏览器', 'Browser'), icon: <WindowMultipleRegular /> },
        { id: 'privacy', label: t('隐私', 'Privacy'), icon: <ShieldCheckmarkRegular /> },
        {
            id: 'automation',
            label: t('自动化与 MCP', 'Automation & MCP'),
            icon: <PlugConnectedRegular />,
        },
        {
            id: 'components',
            label: t('组件', 'Components'),
            icon: <BoxRegular />,
            dot: Boolean(kernelStatus?.updateSummary?.hasAnyUpdate),
        },
        { id: 'about', label: t('关于', 'About'), icon: <InfoRegular /> },
    ];

    const showFormHeaderActions =
        isDirty ||
        activeTab === 'general' ||
        activeTab === 'browser' ||
        activeTab === 'privacy';

    return (
        <section className={styles.root} aria-label={t('设置', 'Settings')}>
            <div className={styles.header}>
                <div className={styles.headerTop}>
                    <h1 className={styles.title}>{t('设置', 'Settings')}</h1>
                    {showFormHeaderActions && (
                        <div className={styles.headerActions}>
                            {isDirty && (
                                <Button
                                    type="button"
                                    appearance="secondary"
                                    disabled={saving}
                                    onClick={handleReset}
                                >
                                    {t('还原', 'Reset')}
                                </Button>
                            )}
                            <Button
                                type="submit"
                                form="app-settings-form"
                                appearance="primary"
                                disabled={!isDirty || saving}
                            >
                                {saving
                                    ? t('保存中…', 'Saving…')
                                    : isDirty
                                      ? t('保存设置', 'Save')
                                      : t('已保存', 'Saved')}
                            </Button>
                        </div>
                    )}
                </div>

                <div
                    className={styles.pillTabsBar}
                    role="tablist"
                    aria-label={t('设置分类', 'Settings sections')}
                >
                    {tabs.map((tab) => {
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                data-testid={`settings-tab-${tab.id}`}
                                className={mergeClasses(
                                    styles.pillTab,
                                    active && styles.pillTabActive,
                                )}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                                {tab.dot && (
                                    <span
                                        className={styles.tabDot}
                                        aria-hidden="true"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <form
                id="app-settings-form"
                className={styles.body}
                onSubmit={(event) => void handleSave(event)}
            >
                <div className={styles.container}>
                    {error && (
                        <MessageBar intent="error" layout="multiline">
                            <MessageBarBody>
                                {translateBackendMessage(error, locale)}
                            </MessageBarBody>
                        </MessageBar>
                    )}

                    {/* 1. 常规 */}
                    {activeTab === 'general' && (
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
                                            onChange={(_, data) =>
                                                setDataPath(data.value)
                                            }
                                        />
                                        <Button
                                            type="button"
                                            appearance="outline"
                                            icon={<FolderOpenRegular />}
                                            onClick={() =>
                                                void handleSelectFolder()
                                            }
                                        >
                                            {t('选择目录', 'Browse')}
                                        </Button>
                                    </div>
                                </Field>

                                {coreInfo?.configDirectory && (
                                    <Field
                                        label={
                                            <span className={styles.rowLabel}>
                                                {t(
                                                    '配置文件目录',
                                                    'Config Directory',
                                                )}
                                                <InfoTip
                                                    content={t(
                                                        '存放软件偏好设置与代理配置的本地目录',
                                                        'Local directory storing app settings and proxy configurations.',
                                                    )}
                                                />
                                            </span>
                                        }
                                    >
                                        <Input
                                            readOnly
                                            value={coreInfo.configDirectory}
                                        />
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
                                            onChange={(_, data) => {
                                                const next =
                                                    data.value as ThemeMode;
                                                setTheme(next);
                                                void onThemePreview(next);
                                            }}
                                        >
                                            <option value="system">
                                                {t('跟随系统', 'System')}
                                            </option>
                                            <option value="light">
                                                {t('浅色', 'Light')}
                                            </option>
                                            <option value="dark">
                                                {t('深色', 'Dark')}
                                            </option>
                                        </Select>
                                    </Field>
                                    <Field label={t('界面语言', 'Language')}>
                                        <Select
                                            value={locale}
                                            onChange={(_, data) =>
                                                void setAppLocale(
                                                    data.value as AppLocale,
                                                )
                                            }
                                        >
                                            <option value="zh-CN">
                                                简体中文
                                            </option>
                                            <option value="en-US">
                                                English
                                            </option>
                                        </Select>
                                    </Field>
                                </div>
                            </div>
                        </>
                    )}

                    {/* 2. 浏览器 */}
                    {activeTab === 'browser' && (
                        <>
                            <div className={styles.card}>
                                <div className={styles.cardTitleGroup}>
                                    <DesktopRegular
                                        className={styles.sectionIcon}
                                        style={getToneStyle('blue')}
                                    />
                                    <h2 className={styles.cardTitle}>
                                        {t('默认行为', 'Defaults')}
                                    </h2>
                                </div>

                                <div className={styles.row}>
                                    <span className={styles.rowLabel}>
                                        {t('默认浏览器', 'Default Browser')}
                                        <InfoTip
                                            content={
                                                hasActiveKernel
                                                    ? t(
                                                          '新建环境时默认使用的浏览器类型，可在单个环境中随时切换',
                                                          'Default browser used for new profiles; can be overridden per profile.',
                                                      )
                                                    : t(
                                                          '防关联浏览器尚未安装，请先到「组件」中安装',
                                                          'Privacy browser is not installed yet. Install it in Components.',
                                                      )
                                            }
                                        />
                                    </span>
                                    <Select
                                        style={{ minWidth: '220px' }}
                                        value={fingerprint.defaultEngine}
                                        onChange={(_, data) =>
                                            setFingerprint((prev) => ({
                                                ...prev,
                                                defaultEngine:
                                                    data.value as BrowserEngineType,
                                            }))
                                        }
                                    >
                                        <option value="system-chrome">
                                            {t('标准 Chrome', 'Standard Chrome')}
                                        </option>
                                        <option value="fingerprint-chromium">
                                            {t('防关联浏览器', 'Privacy Browser')}
                                        </option>
                                    </Select>
                                </div>

                                <div className={styles.divider} />

                                <div className={styles.row}>
                                    <span className={styles.rowLabel}>
                                        {t('省内存模式', 'Memory Saver')}
                                        <InfoTip
                                            content={t(
                                                '同时打开多个窗口时自动限制后台标签与缓存占用，不影响网页正常使用与伪装效果',
                                                'Limits background renderer and cache memory when running multiple profiles without affecting privacy signals.',
                                            )}
                                        />
                                    </span>
                                    <Switch
                                        checked={memorySaverMode}
                                        onChange={(_, data) =>
                                            setMemorySaverMode(data.checked)
                                        }
                                    />
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardTitleGroup}>
                                    <GlobeRegular
                                        className={styles.sectionIcon}
                                        style={getToneStyle('teal')}
                                    />
                                    <h2 className={styles.cardTitle}>
                                        {t('启动页', 'Startup Page')}
                                    </h2>
                                    <InfoTip
                                        content={t(
                                            '首次打开环境时自动访问的网址；已有未关闭标签页时不会重复打开。优先级：单环境 > 分组 > 全局默认',
                                            'Opened on first launch without duplicating restored tabs. Priority: Profile > Group > Global.',
                                        )}
                                    />
                                </div>

                                <Input
                                    value={startupUrl}
                                    placeholder={t(
                                        '输入默认打开的网址（留空则打开空白页）',
                                        'Default startup URL (leave blank for new tab)',
                                    )}
                                    onChange={(_, data) =>
                                        setStartupUrl(data.value)
                                    }
                                />
                                <div className={styles.chipsRow}>
                                    {QUICK_STARTUP_URLS.map((preset) => (
                                        <Button
                                            key={preset.url || 'empty'}
                                            type="button"
                                            size="small"
                                            appearance={
                                                startupUrl.trim() === preset.url
                                                    ? 'primary'
                                                    : 'subtle'
                                            }
                                            onClick={() =>
                                                setStartupUrl(preset.url)
                                            }
                                        >
                                            {isEn ? preset.en : preset.zh}
                                        </Button>
                                    ))}
                                </div>

                                <div className={styles.divider} />

                                <span className={styles.rowLabel}>
                                    {t('分组专属启动页', 'Per-Group Startup Page')}
                                    <InfoTip
                                        content={t(
                                            '为特定分组设置单独的启动网址，覆盖全局默认启动页',
                                            'Override the global startup URL for a specific group.',
                                        )}
                                    />
                                </span>
                                <div className={styles.inlineAddRow}>
                                    <Input
                                        style={{ flex: 1, minWidth: '130px' }}
                                        placeholder={t('分组名', 'Group')}
                                        list="settings-group-startup-list"
                                        value={newGroupKey}
                                        onChange={(_, d) =>
                                            setNewGroupKey(d.value)
                                        }
                                    />
                                    <datalist id="settings-group-startup-list">
                                        {groups.map((g) => (
                                            <option key={g} value={g} />
                                        ))}
                                    </datalist>
                                    <Input
                                        style={{ flex: 2, minWidth: '200px' }}
                                        placeholder="https://example.com/"
                                        value={newGroupUrl}
                                        onChange={(_, d) =>
                                            setNewGroupUrl(d.value)
                                        }
                                    />
                                    <Button
                                        type="button"
                                        appearance="outline"
                                        icon={<AddRegular />}
                                        onClick={handleAddGroupStartupUrl}
                                    >
                                        {t('添加', 'Add')}
                                    </Button>
                                </div>
                                {Object.keys(groupStartupUrls).length > 0 && (
                                    <div className={styles.listStack}>
                                        {Object.entries(groupStartupUrls).map(
                                            ([groupKey, url]) => (
                                                <div
                                                    key={groupKey}
                                                    className={styles.listItem}
                                                >
                                                    <div
                                                        className={
                                                            styles.listItemMain
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.listItemTitle
                                                            }
                                                        >
                                                            {groupKey}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.listItemSub
                                                            }
                                                        >
                                                            {url}
                                                        </span>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="small"
                                                        appearance="subtle"
                                                        icon={<DeleteRegular />}
                                                        aria-label={t(
                                                            `移除 ${groupKey}`,
                                                            `Remove ${groupKey}`,
                                                        )}
                                                        onClick={() =>
                                                            setGroupStartupUrls(
                                                                (prev) => {
                                                                    const next =
                                                                        {
                                                                            ...prev,
                                                                        };
                                                                    delete next[
                                                                        groupKey
                                                                    ];
                                                                    return next;
                                                                },
                                                            )
                                                        }
                                                    />
                                                </div>
                                            ),
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardTitleGroup}>
                                    <WindowMultipleRegular
                                        className={styles.sectionIcon}
                                        style={getToneStyle('blue')}
                                    />
                                    <h2 className={styles.cardTitle}>
                                        {t('常用书签', 'Bookmarks')}
                                    </h2>
                                    <InfoTip
                                        content={t(
                                            '启动任意环境前自动添加到书签栏，按网址去重，不会覆盖已有书签',
                                            'Automatically added to the bookmarks bar on launch without overwriting existing bookmarks.',
                                        )}
                                    />
                                </div>

                                <div className={styles.inlineAddRow}>
                                    <Input
                                        style={{ flex: 1, minWidth: '120px' }}
                                        placeholder={t('名称', 'Name')}
                                        value={newBmName}
                                        onChange={(_, d) =>
                                            setNewBmName(d.value)
                                        }
                                    />
                                    <Input
                                        style={{ flex: 2, minWidth: '180px' }}
                                        placeholder="https://example.com/"
                                        value={newBmUrl}
                                        onChange={(_, d) => setNewBmUrl(d.value)}
                                    />
                                    <Input
                                        style={{ flex: 1, minWidth: '100px' }}
                                        placeholder={t(
                                            '文件夹（可选）',
                                            'Folder (opt.)',
                                        )}
                                        value={newBmFolder}
                                        onChange={(_, d) =>
                                            setNewBmFolder(d.value)
                                        }
                                    />
                                    <Button
                                        type="button"
                                        appearance="outline"
                                        icon={<AddRegular />}
                                        onClick={handleAddBookmarkTemplate}
                                    >
                                        {t('添加', 'Add')}
                                    </Button>
                                </div>

                                {bookmarkTemplates.length > 0 && (
                                    <div className={styles.listStack}>
                                        {bookmarkTemplates.map((bm) => (
                                            <div
                                                key={bm.id}
                                                className={styles.listItem}
                                            >
                                                <div
                                                    className={
                                                        styles.listItemMain
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            styles.listItemTitle
                                                        }
                                                    >
                                                        {bm.folder
                                                            ? `[${bm.folder}] `
                                                            : ''}
                                                        {bm.name}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.listItemSub
                                                        }
                                                    >
                                                        {bm.url}
                                                    </span>
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={<DeleteRegular />}
                                                    aria-label={t(
                                                        `删除书签 ${bm.name}`,
                                                        `Remove bookmark ${bm.name}`,
                                                    )}
                                                    onClick={() =>
                                                        setBookmarkTemplates(
                                                            (prev) =>
                                                                prev.filter(
                                                                    (item) =>
                                                                        item.id !==
                                                                        bm.id,
                                                                ),
                                                        )
                                                    }
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <div className={styles.cardTitleGroup}>
                                        <BoxRegular
                                            className={styles.sectionIcon}
                                            style={getToneStyle('violet')}
                                        />
                                        <h2 className={styles.cardTitle}>
                                            {t('本地扩展', 'Extensions')}
                                        </h2>
                                        <InfoTip
                                            content={t(
                                                '添加本地解压后的扩展文件夹（含 manifest.json），启动时自动加载。默认仅在标准 Chrome 中生效以保持防关联浏览器纯净',
                                                'Load unpacked extension folders (containing manifest.json) automatically. Enabled on standard Chrome by default to keep privacy browsers clean.',
                                            )}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="outline"
                                        icon={<FolderOpenRegular />}
                                        onClick={() =>
                                            void handleAddExtensionFolder()
                                        }
                                    >
                                        {t('添加扩展', 'Add Extension')}
                                    </Button>
                                </div>

                                {extensionTemplates.length > 0 && (
                                    <>
                                        <div className={styles.listStack}>
                                            {extensionTemplates.map((ext) => (
                                                <div
                                                    key={ext.id}
                                                    className={styles.listItem}
                                                >
                                                    <div
                                                        className={
                                                            styles.listItemMain
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.listItemTitle
                                                            }
                                                        >
                                                            {ext.name}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.listItemSub
                                                            }
                                                        >
                                                            {ext.path}
                                                        </span>
                                                    </div>
                                                    <Switch
                                                        checked={ext.enabled}
                                                        onChange={(_, d) =>
                                                            setExtensionTemplates(
                                                                (prev) =>
                                                                    prev.map(
                                                                        (
                                                                            item,
                                                                        ) =>
                                                                            item.id ===
                                                                            ext.id
                                                                                ? {
                                                                                      ...item,
                                                                                      enabled:
                                                                                          d.checked,
                                                                                  }
                                                                                : item,
                                                                    ),
                                                            )
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="small"
                                                        appearance="subtle"
                                                        icon={<DeleteRegular />}
                                                        aria-label={t(
                                                            `删除扩展 ${ext.name}`,
                                                            `Remove extension ${ext.name}`,
                                                        )}
                                                        onClick={() =>
                                                            setExtensionTemplates(
                                                                (prev) =>
                                                                    prev.filter(
                                                                        (
                                                                            item,
                                                                        ) =>
                                                                            item.id !==
                                                                            ext.id,
                                                                    ),
                                                            )
                                                        }
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        <div className={styles.row}>
                                            <span className={styles.rowLabel}>
                                                {t(
                                                    '防关联浏览器也加载扩展',
                                                    'Also load on Privacy Browser',
                                                )}
                                                <InfoTip
                                                    content={t(
                                                        '开启后防关联浏览器也会加载上述扩展，可能增加被网站检测的风险，建议按需开启',
                                                        'Loading unpacked extensions in the privacy browser may increase detection surface.',
                                                    )}
                                                />
                                            </span>
                                            <Switch
                                                checked={
                                                    allowExtensionsOnFingerprintKernel
                                                }
                                                onChange={(_, d) =>
                                                    setAllowExtensionsOnFingerprintKernel(
                                                        d.checked,
                                                    )
                                                }
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                    )}

                    {/* 3. 隐私 */}
                    {activeTab === 'privacy' && (
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
                                            setRequireHealthCheckOnLaunch(
                                                data.checked,
                                            )
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
                                            setProxyEnabled(data.checked)
                                        }
                                    />
                                </div>

                                {proxyEnabled && (
                                    <Input
                                        value={proxyAddress}
                                        placeholder="http://127.0.0.1:7890"
                                        onChange={(_, data) =>
                                            setProxyAddress(data.value)
                                        }
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
                                            setFingerprint((prev) => ({
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
                                        checked={Boolean(
                                            fingerprint.autoMatchLanguage,
                                        )}
                                        onChange={(_, data) =>
                                            setFingerprint((prev) => ({
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
                                                (l) =>
                                                    l.value ===
                                                    fingerprint.defaultLanguage,
                                            )
                                                ? fingerprint.defaultLanguage
                                                : 'en-US'
                                        }
                                        onChange={(_, data) =>
                                            setFingerprint((prev) => ({
                                                ...prev,
                                                defaultLanguage: data.value,
                                            }))
                                        }
                                    >
                                        {COMMON_LANGUAGES.map((lang) => (
                                            <option
                                                key={lang.value}
                                                value={lang.value}
                                            >
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
                                        checked={Boolean(
                                            fingerprint.autoMatchGeolocation,
                                        )}
                                        onChange={(_, data) =>
                                            setFingerprint((prev) => ({
                                                ...prev,
                                                autoMatchGeolocation:
                                                    data.checked,
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
                                            {t(
                                                '仅防关联浏览器',
                                                'Privacy Browser only',
                                            )}
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
                                            {enabledSpoofCount}/
                                            {SPOOFING_ITEMS.length}
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
                                                setFpCustomizeOpen(
                                                    (prev) => !prev,
                                                )
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
                                            <Field
                                                label={t('模拟系统', 'System')}
                                            >
                                                <Select
                                                    value={fingerprint.platform}
                                                    onChange={(_, data) =>
                                                        setFingerprint(
                                                            (prev) => ({
                                                                ...prev,
                                                                platform:
                                                                    data.value as FingerprintPlatform,
                                                            }),
                                                        )
                                                    }
                                                >
                                                    <option value="windows">
                                                        Windows
                                                        {!isMac && !isLinux
                                                            ? t(
                                                                  '（推荐）',
                                                                  ' (Recommended)',
                                                              )
                                                            : ''}
                                                    </option>
                                                    <option value="macos">
                                                        macOS
                                                        {isMac
                                                            ? t(
                                                                  '（推荐）',
                                                                  ' (Recommended)',
                                                              )
                                                            : ''}
                                                    </option>
                                                    <option value="linux">
                                                        Linux
                                                        {isLinux
                                                            ? t(
                                                                  '（推荐）',
                                                                  ' (Recommended)',
                                                              )
                                                            : ''}
                                                    </option>
                                                </Select>
                                            </Field>

                                            <Field
                                                label={t(
                                                    '浏览器品牌',
                                                    'Browser Brand',
                                                )}
                                            >
                                                <Select
                                                    value={fingerprint.brand}
                                                    onChange={(_, data) =>
                                                        setFingerprint(
                                                            (prev) => ({
                                                                ...prev,
                                                                brand: data.value as FingerprintBrand,
                                                            }),
                                                        )
                                                    }
                                                >
                                                    <option value="Chrome">
                                                        {t(
                                                            'Chrome（推荐）',
                                                            'Chrome (Recommended)',
                                                        )}
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

                                        <div className={styles.spoofGrid}>
                                            {SPOOFING_ITEMS.map((item) => (
                                                <div
                                                    key={item.key}
                                                    className={styles.spoofItem}
                                                >
                                                    <span
                                                        className={
                                                            styles.rowLabel
                                                        }
                                                    >
                                                        {isEn
                                                            ? item.en
                                                            : item.zh}
                                                        <InfoTip
                                                            content={
                                                                isEn
                                                                    ? item.tipEn
                                                                    : item.tipZh
                                                            }
                                                        />
                                                    </span>
                                                    <Switch
                                                        checked={
                                                            fingerprint
                                                                .spoofing[
                                                                item.key
                                                            ]
                                                        }
                                                        onChange={(_, data) =>
                                                            setFingerprint(
                                                                (prev) => ({
                                                                    ...prev,
                                                                    spoofing: {
                                                                        ...prev.spoofing,
                                                                        [item.key]:
                                                                            data.checked,
                                                                    },
                                                                }),
                                                            )
                                                        }
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                    )}

                    {/* 4. 自动化与 MCP */}
                    {activeTab === 'automation' && <AutomationSettingsPanel />}

                    {/* 5. 组件 */}
                    {activeTab === 'components' && (
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
                                            <Badge
                                                appearance="tint"
                                                color="warning"
                                            >
                                                {isEn
                                                    ? `v${singboxSummary.currentVersion} → v${singboxSummary.recommendedVersion}`
                                                    : `可升级 v${singboxSummary.recommendedVersion}`}
                                            </Badge>
                                        ) : singboxReady ? (
                                            <Badge
                                                appearance="tint"
                                                color="success"
                                            >
                                                {isEn
                                                    ? `Ready · v${coreInfo?.version || ''}`
                                                    : `已就绪 · v${coreInfo?.version || ''}`}
                                            </Badge>
                                        ) : (
                                            <Badge
                                                appearance="tint"
                                                color="subtle"
                                            >
                                                {t('未安装', 'Not Installed')}
                                            </Badge>
                                        )}

                                        <Menu>
                                            <MenuTrigger disableButtonEnhancement>
                                                <Button
                                                    type="button"
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={
                                                        <MoreHorizontalRegular />
                                                    }
                                                    aria-label={t(
                                                        '更多操作',
                                                        'More actions',
                                                    )}
                                                />
                                            </MenuTrigger>
                                            <MenuPopover>
                                                <MenuList>
                                                    <MenuItem
                                                        icon={
                                                            <FolderOpenRegular />
                                                        }
                                                        disabled={
                                                            downloadingSingbox ||
                                                            singboxBusy
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
                                                            icon={
                                                                <DeleteRegular />
                                                            }
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
                                            {translateBackendMessage(
                                                singboxError,
                                                locale,
                                            )}
                                        </MessageBarBody>
                                    </MessageBar>
                                )}

                                {installedSingbox.length > 1 && (
                                    <div className={styles.listStack}>
                                        {installedSingbox.map((item) => {
                                            const isActive =
                                                item.id ===
                                                kernelStatus?.activeSingboxId;
                                            return (
                                                <div
                                                    key={item.id}
                                                    className={styles.listItem}
                                                >
                                                    <span
                                                        className={
                                                            styles.listItemTitle
                                                        }
                                                    >
                                                        {item.name}
                                                    </span>
                                                    <div
                                                        className={
                                                            styles.componentRight
                                                        }
                                                    >
                                                        {isActive ? (
                                                            <Badge
                                                                appearance="tint"
                                                                color="brand"
                                                            >
                                                                {t(
                                                                    '当前使用',
                                                                    'Active',
                                                                )}
                                                            </Badge>
                                                        ) : (
                                                            <Button
                                                                type="button"
                                                                size="small"
                                                                appearance="outline"
                                                                disabled={
                                                                    singboxBusy
                                                                }
                                                                icon={
                                                                    <CheckmarkCircleRegular />
                                                                }
                                                                onClick={() =>
                                                                    void handleSetActiveSingbox(
                                                                        item.id,
                                                                    )
                                                                }
                                                            >
                                                                {t(
                                                                    '启用',
                                                                    'Use',
                                                                )}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            type="button"
                                                            size="small"
                                                            appearance="subtle"
                                                            icon={
                                                                <DeleteRegular />
                                                            }
                                                            disabled={
                                                                singboxBusy
                                                            }
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
                                                style={{
                                                    flex: 1,
                                                    minWidth: '160px',
                                                }}
                                                disabled={downloadingSingbox}
                                                value={singboxProxyChoice}
                                                onChange={(_, data) =>
                                                    setSingboxProxyChoice(
                                                        data.value,
                                                    )
                                                }
                                            >
                                                <option value="__direct__">
                                                    {t(
                                                        '默认直连下载',
                                                        'Direct Download',
                                                    )}
                                                </option>
                                                {proxyEnabled &&
                                                    proxyAddress.trim() && (
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
                                                disabled={
                                                    downloadingSingbox ||
                                                    singboxBusy
                                                }
                                                icon={<ArrowDownloadRegular />}
                                                onClick={() =>
                                                    void handleDownloadSingbox()
                                                }
                                            >
                                                {downloadingSingbox
                                                    ? t(
                                                          '安装中…',
                                                          'Installing…',
                                                      )
                                                    : singboxSummary?.hasUpdate
                                                      ? t(
                                                            `升级到 v${singboxSummary.recommendedVersion}`,
                                                            `Upgrade to v${singboxSummary.recommendedVersion}`,
                                                        )
                                                      : t(
                                                            '立即安装',
                                                            'Install Now',
                                                        )}
                                            </Button>
                                        </div>

                                        {downloadingSingbox &&
                                            singboxProgress && (
                                                <div
                                                    className={styles.listStack}
                                                >
                                                    <div className={styles.row}>
                                                        <span
                                                            className={
                                                                styles.listItemSub
                                                            }
                                                        >
                                                            {singboxProgress.message
                                                                ? translateBackendMessage(
                                                                      singboxProgress.message,
                                                                      locale,
                                                                  )
                                                                : t(
                                                                      '正在处理…',
                                                                      'Processing…',
                                                                  )}
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
                                                                ? singboxProgress.percent /
                                                                  100
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
                                            {t(
                                                '防关联浏览器',
                                                'Privacy Browser',
                                            )}
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
                                            <Badge
                                                appearance="tint"
                                                color="warning"
                                            >
                                                {isEn
                                                    ? `Update: Core ${fpSummary.recommendedChromeMajor}`
                                                    : `可升级 内核 ${fpSummary.recommendedChromeMajor}`}
                                            </Badge>
                                        ) : activeFpKernel ? (
                                            <Badge
                                                appearance="tint"
                                                color="success"
                                            >
                                                {isEn
                                                    ? `Ready · Core ${activeFpKernel.chromeMajor}`
                                                    : `已就绪 · 内核 ${activeFpKernel.chromeMajor}`}
                                            </Badge>
                                        ) : (
                                            <Badge
                                                appearance="tint"
                                                color="subtle"
                                            >
                                                {t('未安装', 'Not Installed')}
                                            </Badge>
                                        )}

                                        <Menu>
                                            <MenuTrigger disableButtonEnhancement>
                                                <Button
                                                    type="button"
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={
                                                        <MoreHorizontalRegular />
                                                    }
                                                    aria-label={t(
                                                        '更多操作',
                                                        'More actions',
                                                    )}
                                                />
                                            </MenuTrigger>
                                            <MenuPopover>
                                                <MenuList>
                                                    <MenuItem
                                                        icon={<OpenRegular />}
                                                        onClick={() =>
                                                            void window.electronAPI?.kernels?.openDir()
                                                        }
                                                    >
                                                        {t(
                                                            '打开组件目录',
                                                            'Open Folder',
                                                        )}
                                                    </MenuItem>
                                                    <MenuItem
                                                        icon={
                                                            <FolderOpenRegular />
                                                        }
                                                        disabled={
                                                            downloadingFp ||
                                                            kernelBusy
                                                        }
                                                        onClick={() =>
                                                            void handleImportKernel(
                                                                'file',
                                                            )
                                                        }
                                                    >
                                                        {importFileLabel}
                                                    </MenuItem>
                                                    <MenuItem
                                                        icon={
                                                            <FolderOpenRegular />
                                                        }
                                                        disabled={
                                                            downloadingFp ||
                                                            kernelBusy
                                                        }
                                                        onClick={() =>
                                                            void handleImportKernel(
                                                                'folder',
                                                            )
                                                        }
                                                    >
                                                        {t(
                                                            '导入本地目录',
                                                            'Import Folder',
                                                        )}
                                                    </MenuItem>
                                                    {activeFpKernel && (
                                                        <MenuItem
                                                            icon={
                                                                <DeleteRegular />
                                                            }
                                                            disabled={
                                                                downloadingFp ||
                                                                kernelBusy
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
                                            {translateBackendMessage(
                                                kernelError,
                                                locale,
                                            )}
                                        </MessageBarBody>
                                    </MessageBar>
                                )}

                                {installedFpList.length > 1 && (
                                    <div className={styles.listStack}>
                                        {installedFpList.map((kernel) => {
                                            const isActive =
                                                kernel.id ===
                                                kernelStatus?.activeKernelId;
                                            return (
                                                <div
                                                    key={kernel.id}
                                                    className={styles.listItem}
                                                >
                                                    <span
                                                        className={
                                                            styles.listItemTitle
                                                        }
                                                    >
                                                        Chrome{' '}
                                                        {kernel.chromeMajor} (
                                                        {kernel.version})
                                                    </span>
                                                    <div
                                                        className={
                                                            styles.componentRight
                                                        }
                                                    >
                                                        {isActive ? (
                                                            <Badge
                                                                appearance="tint"
                                                                color="brand"
                                                            >
                                                                {t(
                                                                    '当前使用',
                                                                    'Active',
                                                                )}
                                                            </Badge>
                                                        ) : (
                                                            <Button
                                                                type="button"
                                                                size="small"
                                                                appearance="outline"
                                                                disabled={
                                                                    kernelBusy
                                                                }
                                                                icon={
                                                                    <CheckmarkCircleRegular />
                                                                }
                                                                onClick={() =>
                                                                    void handleSetActiveKernel(
                                                                        kernel.id,
                                                                    )
                                                                }
                                                            >
                                                                {t(
                                                                    '启用',
                                                                    'Use',
                                                                )}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            type="button"
                                                            size="small"
                                                            appearance="subtle"
                                                            icon={
                                                                <DeleteRegular />
                                                            }
                                                            disabled={
                                                                kernelBusy
                                                            }
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
                                                style={{
                                                    flex: 1,
                                                    minWidth: '160px',
                                                }}
                                                disabled={downloadingFp}
                                                value={downloadProxyChoice}
                                                onChange={(_, data) =>
                                                    setDownloadProxyChoice(
                                                        data.value,
                                                    )
                                                }
                                            >
                                                <option value="__direct__">
                                                    {t(
                                                        '默认直连下载',
                                                        'Direct Download',
                                                    )}
                                                </option>
                                                {proxyEnabled &&
                                                    proxyAddress.trim() && (
                                                        <option value="__global__">
                                                            {t(
                                                                '使用全局备用代理',
                                                                'Use Fallback Proxy',
                                                            )}
                                                        </option>
                                                    )}
                                                {singboxReady &&
                                                    managedProxies.map(
                                                        (proxy) => (
                                                            <option
                                                                key={proxy.id}
                                                                value={proxy.id}
                                                            >
                                                                {t(
                                                                    '代理：',
                                                                    'Proxy: ',
                                                                )}
                                                                {proxy.name}
                                                            </option>
                                                        ),
                                                    )}
                                            </Select>
                                            <Button
                                                type="button"
                                                appearance="primary"
                                                disabled={
                                                    downloadingFp || kernelBusy
                                                }
                                                icon={<ArrowDownloadRegular />}
                                                onClick={() =>
                                                    void handleDownloadKernel()
                                                }
                                            >
                                                {downloadingFp
                                                    ? t(
                                                          '安装中…',
                                                          'Installing…',
                                                      )
                                                    : fpSummary?.hasUpdate
                                                      ? t(
                                                            `升级到 Chrome ${fpSummary.recommendedChromeMajor}`,
                                                            `Upgrade to Chrome ${fpSummary.recommendedChromeMajor}`,
                                                        )
                                                      : t(
                                                            '立即安装',
                                                            'Install Now',
                                                        )}
                                            </Button>
                                        </div>

                                        {downloadingFp && fpProgress && (
                                            <div className={styles.listStack}>
                                                <div className={styles.row}>
                                                    <span
                                                        className={
                                                            styles.listItemSub
                                                        }
                                                    >
                                                        {fpProgress.message
                                                            ? translateBackendMessage(
                                                                  fpProgress.message,
                                                                  locale,
                                                              )
                                                            : t(
                                                                  '正在处理…',
                                                                  'Processing…',
                                                              )}
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
                                                        fpProgress.stage ===
                                                            'downloading' &&
                                                        fpProgress.totalBytes
                                                            ? fpProgress.percent /
                                                              100
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
                    )}

                    {/* 6. 关于 */}
                    {activeTab === 'about' && (
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <div className={styles.aboutHero}>
                                    <AppBrandIcon size={44} />
                                    <div>
                                        <h2 className={styles.aboutName}>
                                            MultiChrome
                                        </h2>
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
                                        onClick={() =>
                                            void handleCheckAppUpdate()
                                        }
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
                                        {translateBackendMessage(
                                            updateError,
                                            locale,
                                        )}
                                    </MessageBarBody>
                                </MessageBar>
                            )}

                            {updateResult && (
                                <MessageBar
                                    intent={
                                        updateResult.hasUpdate
                                            ? 'info'
                                            : 'success'
                                    }
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

                            <div
                                className={styles.infoGrid}
                                data-selectable="true"
                            >
                                <span className={styles.infoKey}>
                                    {t('当前版本', 'Version')}
                                </span>
                                <span className={styles.infoVal}>
                                    v{appVersion || '1.3.0'}
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
                                    {isMac
                                        ? 'macOS'
                                        : isLinux
                                          ? 'Linux'
                                          : 'Windows'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </form>
        </section>
    );
};

export default SettingsPage;
