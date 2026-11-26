export type BrowserEngineType = 'system-chrome' | 'fingerprint-chromium';
export type FingerprintPlatform = 'windows' | 'macos' | 'linux';
export type FingerprintBrand = 'Chrome' | 'Edge' | 'Opera' | 'Vivaldi';

export interface FingerprintSpoofingOptions {
    canvas: boolean;
    audio: boolean;
    font: boolean;
    clientrects: boolean;
    gpu: boolean;
}

export interface FingerprintConfig {
    seed: number;
    platform: FingerprintPlatform;
    platformVersion: string;
    brand: FingerprintBrand;
    hardwareConcurrency: number;
    windowSize: {
        width: number;
        height: number;
    };
    spoofing: FingerprintSpoofingOptions;
}

export interface DefaultFingerprintSettings {
    defaultEngine: BrowserEngineType;
    platform: FingerprintPlatform;
    brand: FingerprintBrand;
    autoMatchTimezone: boolean;
    autoMatchLanguage?: boolean;
    autoMatchGeolocation?: boolean;
    defaultLanguage: string;
    spoofing: FingerprintSpoofingOptions;
}

export interface InstalledKernel {
    id: string;
    kind: 'fingerprint-chromium';
    name: string;
    version: string;
    chromeMajor: number;
    installDir: string;
    executablePath: string;
    source: 'github-release' | 'local-import';
    sourceUrl?: string;
    sourceTagUrl?: string;
    sourceAuditable: boolean;
    checksumVerified?: boolean;
    archiveSha256?: string;
    executableSha256: string;
    sizeBytes?: number;
    installedAt: string;
}

export interface InstalledSingboxCore {
    id: string;
    kind: 'sing-box';
    name: string;
    version: string;
    installDir: string;
    executablePath: string;
    source: 'github-release' | 'local-import';
    sourceUrl?: string;
    releaseUrl?: string;
    checksumVerified?: boolean;
    archiveSha256?: string;
    executableSha256: string;
    sizeBytes?: number;
    installedAt: string;
}

export interface KernelReleaseInfo {
    version: string;
    chromeMajor: number;
    name: string;
    publishedAt?: string;
    sourceAuditable: boolean;
    sourceTagUrl?: string;
    assetName: string;
    downloadUrl: string;
    sha256?: string;
    sizeBytes?: number;
    recommended?: boolean;
}

export interface SingboxReleaseInfo {
    version: string;
    name: string;
    publishedAt?: string;
    assetName: string;
    downloadUrl: string;
    releaseUrl?: string;
    sha256: string;
    sizeBytes?: number;
    recommended?: boolean;
}

export interface KernelDownloadProgress {
    target?: 'fingerprint-chromium' | 'sing-box';
    version: string;
    stage: 'downloading' | 'extracting' | 'verifying' | 'done' | 'error';
    percent: number;
    receivedBytes?: number;
    totalBytes?: number;
    message?: string;
}

export interface KernelUpdateSummary {
    policyMode: 'curated-manifest';
    manifestVersion: number;
    fingerprint: {
        hasUpdate: boolean;
        currentVersion: string | null;
        recommendedVersion: string | null;
        recommendedChromeMajor: number | null;
        installedCount: number;
    };
    singbox: {
        hasUpdate: boolean;
        currentVersion: string | null;
        recommendedVersion: string | null;
        installedCount: number;
    };
    hasAnyUpdate: boolean;
    updateCount: number;
}

export type KernelOpenDirTarget =
    | 'kernels'
    | 'sing-box'
    | 'fingerprint-chromium'
    | 'system-chrome';

export interface KernelStatus {
    kernelsDir: string;
    activeKernelId: string | null;
    installedKernels: InstalledKernel[];
    availableReleases: KernelReleaseInfo[];
    systemChromePath: string;
    systemChromeAvailable: boolean;
    downloading: {
        version: string;
        stage: string;
        percent: number;
    } | null;
    singboxDir?: string;
    activeSingboxId?: string | null;
    installedSingbox?: InstalledSingboxCore[];
    availableSingboxReleases?: SingboxReleaseInfo[];
    downloadingSingbox?: {
        version: string;
        stage: string;
        percent: number;
    } | null;
    updateSummary?: KernelUpdateSummary;
}

// Chrome环境接口
export interface ChromeEnvironment {
    id: string;
    name: string;
    groupName: string;
    notes: string;
    dataDir: string;
    tags: string[];
    proxy?: string;
    proxyId?: string;
    proxyLabel?: string; // 代理标签(如"菲律宾"、"美国")
    userAgent?: string;
    timezone?: string; // 时区(如"America/Los_Angeles")
    language?: string; // 语言(如"en-US")
    startupUrl?: string; // 环境级启动页（优先于分组与全局启动页）
    browserEngine?: BrowserEngineType; // 浏览器引擎
    fingerprintConfig?: FingerprintConfig; // 持久化独立指纹配置
    createdAt: string;
    lastUsed: string;
    deletedAt?: string; // 软删除时间戳
    isRunning: boolean;
    processId?: number;
}

export interface DeleteGroupOptions {
    action: 'move' | 'trash';
    targetGroup?: string;
}

export interface DeleteGroupResult {
    groupName: string;
    action: 'move' | 'trash';
    targetGroup?: string;
    affectedCount: number;
}

export interface EnvironmentStorageStats {
    exists: boolean;
    totalBytes: number;
    cacheBytes: number;
}

export interface ClearEnvironmentCacheResult {
    freedBytes: number;
    removedCount: number;
    afterTotalBytes: number;
    afterCacheBytes: number;
}

export type WindowArrangeMode =
    | 'grid'
    | 'split-grid'
    | 'stack'
    | 'cascade'
    | 'minimize'
    | 'restore'
    | 'reset-app-window';

export interface WindowArrangeResult {
    mode?: WindowArrangeMode | string;
    tiledCount: number;
    consoleDocked?: boolean;
    consoleBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}

export interface RunningResourceStats {
    totalMemoryBytes: number;
    totalProcesses: number;
    environments: Record<
        string,
        { memoryBytes: number; processCount: number }
    >;
}

export interface EnvironmentHealthItem {
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    value: string;
    detail: string;
}

export interface EnvironmentHealthReport {
    overall: 'pass' | 'warn' | 'fail';
    checkedAt: string;
    summary: {
        ip?: string;
        countryCode?: string;
        timezone?: string;
        language: string;
        geolocation?: { latitude: number; longitude: number };
        proxyMode: 'managed' | 'manual' | 'global' | 'direct';
        browserEngine: BrowserEngineType;
    };
    items: EnvironmentHealthItem[];
}

export interface LaunchConsistencyIssue {
    id: string;
    severity: 'error' | 'warning';
    title: string;
    detail: string;
    autoFixPatch?: Partial<ChromeEnvironment>;
}

export interface LaunchGuardEntry {
    env: ChromeEnvironment;
    report: LaunchConsistencyReport;
    incomplete?: boolean;
}

export interface LaunchConsistencyReport {
    ok: boolean;
    hasError: boolean;
    canAutoAlign: boolean;
    issues: LaunchConsistencyIssue[];
    suggestedPatch?: Partial<ChromeEnvironment>;
    exitSummary?: {
        ip?: string;
        countryCode?: string;
        timezone?: string;
        latitude?: number;
        longitude?: number;
    };
}

export interface RenameGroupResult {
    oldName: string;
    newName: string;
    affectedCount: number;
}

// 预加载API类型定义
export interface ProxyExitInfo {
    status: 'idle' | 'checking' | 'ready' | 'error';
    ip?: string;
    country?: string;
    countryCode?: string;
    region?: string;
    city?: string;
    latencyMs?: number;
    checkedAt?: string;
    error?: string;
}

export interface BatchImportProxiesInput {
    text: string;
    namePrefix?: string;
    skipDuplicates?: boolean;
}

export interface BatchImportProxiesResult {
    imported: ManagedProxy[];
    skippedDuplicates: Array<{
        lineNumber: number;
        name: string;
        host: string;
        port: number;
    }>;
    errors: Array<{
        lineNumber: number;
        raw: string;
        error: string;
    }>;
}

export interface ManagedProxy {
    id: string;
    name: string;
    protocol: string;
    mode: 'simple' | 'json';
    coreVersion?: string;
    host: string;
    port: number;
    username: string;
    hasPassword: boolean;
    status: 'running' | 'stopped' | 'error';
    localAddress?: string;
    lastError?: string;
    hasRotationUrl?: boolean;
    exitInfo?: ProxyExitInfo;
}

export interface SimpleProxyInput {
    id?: string;
    name: string;
    mode?: 'simple';
    protocol: 'http' | 'https' | 'socks5';
    host: string;
    port: number;
    username: string;
    password?: string;
    rotationUrl?: string;
}

export type ProxyInput =
    | SimpleProxyInput
    | {
          id?: string;
          name: string;
          mode: 'json';
          config: string;
          rotationUrl?: string;
      }
    | {
          id?: string;
          name: string;
          mode: 'line';
          line: string;
          rotationUrl?: string;
      };

export interface ProxyConfigView {
    json: string;
    redacted: boolean;
    running: boolean;
    sourcePath: string;
    coreVersion: string;
}

export interface ProxyCoreInfo {
    version: string;
    available: boolean;
    configDirectory: string;
}

export type ThemePalette = 'neutral' | 'blue' | 'sage';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppLocale = 'zh-CN' | 'en-US';

export interface BookmarkTemplate {
    id: string;
    name: string;
    url: string;
    folder?: string;
}

export interface ExtensionTemplate {
    id: string;
    name: string;
    path: string;
    enabled: boolean;
}

export interface AppSettings {
    dataPath: string;
    globalProxy?: {
        enabled: boolean;
        address: string;
    };
    startupUrl?: string;
    theme?: ThemeMode;
    palette?: ThemePalette;
    locale?: AppLocale;
    memorySaverMode?: boolean;
    bookmarkTemplates?: BookmarkTemplate[];
    extensionTemplates?: ExtensionTemplate[];
    allowExtensionsOnFingerprintKernel?: boolean;
    requireHealthCheckOnLaunch?: boolean;
    groupStartupUrls?: Record<string, string>;
    fingerprint?: DefaultFingerprintSettings;
}

export interface AppInfo {
    version: string;
    platform: string;
}

export interface ProxyLog {
    id: string;
    proxyId: string;
    time: string;
    level: 'info' | 'error';
    message: string;
}

export interface AppLog {
    id: string;
    time: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
}

export type RunStatus = 'all' | 'running' | 'stopped';

export type OptionalEnvColumn =
    | 'timezone'
    | 'language'
    | 'notes'
    | 'createdAt'
    | 'id';

export interface ProxyEditorState {
    id?: string;
    mode: 'line' | 'simple' | 'json';
    name: string;
    protocol: SimpleProxyInput['protocol'];
    host: string;
    port: string;
    username: string;
    password: string;
    hasPassword: boolean;
    clearCredentials: boolean;
    line: string;
    config: string;
    rotationUrl: string;
}

export interface BatchCreateEnvironmentsInput {
    namePrefix: string;
    groupName: string;
    count: number;
    startNumber?: number;
    notes?: string;
    browserEngine?: BrowserEngineType;
    proxyMode?: 'none' | 'single' | 'sequential';
    proxyIds?: string[];
    tags?: string[];
}

export interface BatchActionEnvironmentsInput {
    ids: string[];
    action: 'moveGroup' | 'bindProxy' | 'addTags' | 'delete';
    groupName?: string;
    proxyId?: string;
    tags?: string[];
}

export interface BackupRestoreResult {
    canceled: boolean;
    restoredEnvironments?: number;
    skippedEnvironments?: number;
    restoredProxies?: number;
    skippedProxies?: number;
    exportedAt?: string;
    appVersion?: string;
}

export interface AppUpdateCheckResult {
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    releaseUrl: string;
    canDownloadAsset?: boolean;
    assetName?: string;
    assetSizeBytes?: number;
    publishedAt?: string;
}

export interface RunningProfileOption {
    id: string;
    name: string;
}

export interface AutomationStatus {
    enabled: boolean;
    localApiEnabled: boolean;
    mcpEnabled: boolean;
    authRequired?: boolean;
    port: number;
    baseUrl: string;
    cdpEndpoint?: string;
    mcpEndpoint?: string;
    running: boolean;
    lastError?: string;
    selectedProfileId?: string | null;
    activeProfileId?: string | null;
    activeProfileName?: string | null;
    runningProfiles?: RunningProfileOption[];
    stdioBridgePath: string;
}

export interface AutomationConfigPatch {
    enabled?: boolean;
    localApiEnabled?: boolean;
    mcpEnabled?: boolean;
    port?: number;
}

export interface ElectronAPI {
    proxies: {
        list: () => Promise<ManagedProxy[]>;
        save: (input: ProxyInput) => Promise<ManagedProxy>;
        batchImport: (
            input: BatchImportProxiesInput,
        ) => Promise<BatchImportProxiesResult>;
        remove: (id: string) => Promise<void>;
        start: (id: string) => Promise<string>;
        stop: (id: string) => Promise<void>;
        refreshExitInfo: (id: string) => Promise<ProxyExitInfo>;
        getLogs: (id?: string) => Promise<ProxyLog[]>;
        clearLogs: (id?: string) => Promise<void>;
        getEditor: (
            id: string,
            asJson?: boolean,
        ) => Promise<{
            mode: 'simple' | 'json';
            config?: string;
            rotationUrl?: string;
        }>;
        getConfig: (id: string, reveal?: boolean) => Promise<ProxyConfigView>;
        getCoreInfo: () => Promise<ProxyCoreInfo>;
        rotateIp?: (id: string) => Promise<{
            ok: boolean;
            statusCode: number;
            exitInfo?: ProxyExitInfo;
        }>;
        batchRemove?: (ids: string[]) => Promise<{
            removedCount: number;
            skippedInUseCount: number;
            failedCount?: number;
            remainingIds?: string[];
        }>;
    };
    appLogs: {
        getLogs: () => Promise<AppLog[]>;
        clearLogs: () => Promise<void>;
    };
    chromeEnvironments: {
        getAll: () => Promise<ChromeEnvironment[]>;
        create: (
            name: string,
            groupName: string,
            notes: string,
            options?: {
                browserEngine?: BrowserEngineType;
                fingerprintConfig?: Partial<FingerprintConfig>;
                proxyId?: string;
                proxy?: string;
                proxyLabel?: string;
                tags?: string[];
            },
        ) => Promise<ChromeEnvironment>;
        clone: (
            id: string,
            customName?: string,
        ) => Promise<ChromeEnvironment>;
        getStorageStats: (id: string) => Promise<EnvironmentStorageStats>;
        clearCache: (id: string) => Promise<ClearEnvironmentCacheResult>;
        openDataDir: (id: string) => Promise<boolean>;
        regenerateFingerprint: (id: string) => Promise<ChromeEnvironment>;
        launch: (id: string) => Promise<boolean>;
        checkLaunchConsistency?: (id: string) => Promise<LaunchConsistencyReport>;
        inspectHealth?: (id: string) => Promise<EnvironmentHealthReport>;
        openUrl?: (id: string, url: string) => Promise<boolean>;
        close: (id: string) => Promise<boolean>;
        closeAll?: () => Promise<
            number | { closedCount: number; failedCount: number }
        >;
        getRunningResourceStats?: () => Promise<RunningResourceStats>;
        delete: (id: string) => Promise<boolean>; // 软删除（移到回收站）
        update: (
            id: string,
            data: Partial<ChromeEnvironment>,
        ) => Promise<ChromeEnvironment>;
        getEmptyGroups: () => Promise<string[]>;
        renameGroup: (
            oldName: string,
            newName: string,
        ) => Promise<RenameGroupResult>;
        deleteGroup: (
            groupName: string,
            options?: DeleteGroupOptions,
        ) => Promise<DeleteGroupResult>;
        deleteEmptyGroup: (groupName: string) => Promise<boolean>;
        batchCreate?: (
            payload: BatchCreateEnvironmentsInput,
        ) => Promise<ChromeEnvironment[]>;
        batchAction?: (
            payload: BatchActionEnvironmentsInput,
        ) => Promise<{
            succeededCount: number;
            skippedRunningCount: number;
        }>;
        exportCookies?: (
            id: string,
            format?: 'json' | 'netscape',
        ) => Promise<{
            count: number;
            format: 'json' | 'netscape';
            content: string;
        }>;
        importCookies?: (
            id: string,
            rawText: string,
        ) => Promise<{ importedCount: number }>;
        tileWindows?: (options?: {
            mode?: WindowArrangeMode;
            envIds?: string[];
        }) => Promise<WindowArrangeResult>;
        focusWindow?: (
            id: string,
            options?: { highlightOnly?: boolean },
        ) => Promise<boolean>;
    };
    kernels?: {
        getStatus: () => Promise<KernelStatus>;
        refreshReleases: (options?: {
            proxyId?: string;
            useGlobalProxy?: boolean;
        }) => Promise<KernelStatus>;
        download: (
            version: string,
            options?: { proxyId?: string; useGlobalProxy?: boolean },
        ) => Promise<{ installed: InstalledKernel; status: KernelStatus }>;
        cancelDownload: (
            target?: 'fingerprint-chromium' | 'sing-box',
        ) => Promise<boolean>;
        importLocal: (mode?: 'file' | 'folder') => Promise<{
            canceled: boolean;
            installed?: InstalledKernel;
            status: KernelStatus;
        }>;
        setActive: (kernelId: string) => Promise<KernelStatus>;
        remove: (kernelId: string) => Promise<KernelStatus>;
        refreshSingboxReleases: (options?: {
            useGlobalProxy?: boolean;
        }) => Promise<KernelStatus>;
        downloadSingbox: (
            version: string,
            options?: { useGlobalProxy?: boolean },
        ) => Promise<{ installed: InstalledSingboxCore; status: KernelStatus }>;
        importLocalSingbox: () => Promise<{
            canceled: boolean;
            installed?: InstalledSingboxCore;
            status: KernelStatus;
        }>;
        setActiveSingbox: (kernelId: string) => Promise<KernelStatus>;
        removeSingbox: (kernelId: string) => Promise<KernelStatus>;
        openDir: (target?: KernelOpenDirTarget) => Promise<boolean>;
    };
    trash: {
        getDeletedEnvironments: () => Promise<ChromeEnvironment[]>;
        restore: (id: string) => Promise<boolean>;
        permanentlyDelete: (id: string) => Promise<boolean>;
        cleanup: () => Promise<number>;
    };
    settings: {
        getSettings: () => Promise<AppSettings>;
        saveSettings: (settings: AppSettings) => Promise<boolean>;
        selectFolder: () => Promise<{ canceled: boolean; filePaths: string[] }>;
        openConfigDir?: () => Promise<boolean>;
    };
    automation?: {
        testConnection: () => Promise<string>;
        getStatus: () => Promise<AutomationStatus>;
        updateConfig: (
            patch: AutomationConfigPatch,
        ) => Promise<AutomationStatus>;
        pickAvailablePort?: () => Promise<AutomationStatus>;
        setActiveProfile?: (
            profileId: string | null,
        ) => Promise<AutomationStatus>;
        getToken?: () => Promise<string | null>;
        rotateToken?: () => Promise<string | null>;
    };
    app?: {
        getInfo: () => Promise<AppInfo>;
        openExternal?: (url: string) => Promise<boolean>;
        checkUpdate?: () => Promise<AppUpdateCheckResult>;
        downloadUpdate?: () => Promise<{
            canceled: boolean;
            filePath?: string;
            fileName?: string;
            sha256?: string;
        }>;
        exportDiagnostics?: () => Promise<{
            canceled: boolean;
            filePath?: string;
        }>;
        exportBackup?: (
            password: string,
        ) => Promise<{ canceled: boolean; filePath?: string }>;
        restoreBackup?: (password: string) => Promise<BackupRestoreResult>;
        setTheme: (theme: ThemeMode, isDark: boolean) => Promise<boolean>;
        platform: string;
    };
    on: (channel: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (
        channel: string,
        callback: (...args: unknown[]) => void,
    ) => void;
}

// 全局Window类型扩展
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

// 导出错误类型
export * from './errors';
