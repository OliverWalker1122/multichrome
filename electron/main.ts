import {
    app,
    BrowserWindow,
    ipcMain,
    shell,
    dialog,
    screen,
    safeStorage,
    nativeTheme,
    powerMonitor,
    Tray,
    Menu,
    nativeImage,
} from 'electron';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import {
    ChromeManager,
    ChromeEnvironment,
    FingerprintConfig,
} from './chromeManager.js';
import {
    SettingsManager,
    AppSettings,
    BrowserEngineType,
    DefaultFingerprintSettings,
} from './settingsManager.js';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { ProxyManager } from './proxyManager.js';
import { ProxyIntegration, registerProxyIpc } from './proxyIntegration.js';
import { createApplicationLogBuffer } from './applicationLogs.js';
import { KernelManager } from './kernelManager.js';
import {
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
    normalizeFingerprintConfig,
} from './fingerprintProfile.js';
import { normalizeEnvironmentTags } from './environmentTags.js';
import { compareDotVersions } from './kernelPolicy.js';
import {
    fetchOfficialGitHubJson,
    parseSafeExternalUrl,
} from './githubProxyTransport.js';
import { AutomationConfigManager } from './automationConfig.js';
import { AutomationServer } from './automationServer.js';
import {
    AutomationIntegration,
    createAutomationBackend,
    registerAutomationIpc,
    resolveStdioBridgePath,
} from './automationIntegration.js';

const APP_REPO_URL = 'https://github.com/OliverWalker1122/multichrome';
const APP_RELEASES_API_URL =
    'https://api.github.com/repos/OliverWalker1122/multichrome/releases/latest';

// ESM兼容性：获取当前文件的目录名
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 允许 E2E 测试通过环境变量隔离 userData 目录，绝不触碰用户真实数据
if (process.env.MULTICHROME_USER_DATA) {
    fs.mkdirSync(process.env.MULTICHROME_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.MULTICHROME_USER_DATA);
}

// Only one process may own the stored proxy configuration and local listeners.
if (!app.requestSingleInstanceLock()) {
    process.exit(0);
}

// Match the AppUserModelID embedded in the NSIS shortcuts when packaged;
// in unpackaged local/dev runs use a distinct ID so Windows Taskbar does not
// hijack the icon from an older installed MultiChrome.exe shortcut.
if (process.platform === 'win32') {
    app.setAppUserModelId(
        app.isPackaged ? 'com.multichrome.app' : 'com.multichrome.app.dev',
    );
}

// 设置日志
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
const applicationLogs = createApplicationLogBuffer();
applicationLogs.attach(log);
log.info('Application starting...');

// 输出环境变量信息
const isDev = process.env.NODE_ENV === 'development';

log.info('Development mode:', isDev);

// 全局窗口引用与托盘引用
let mainWindow: BrowserWindow | null = null;
let appTray: Tray | null = null;

function getTrayIconPath(): string {
    return path.join(
        app.getAppPath(),
        'assets',
        process.platform === 'win32' ? 'icon.ico' : 'icon.png',
    );
}

function showOrRestoreMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        if (mainWindow) {
            chromeManager.setMainWindow(mainWindow);
        }
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function isEnglishLocale(): boolean {
    try {
        return settingsManager?.getSettings?.().locale === 'en-US';
    } catch {
        return false;
    }
}

function updateAppTrayMenu(): void {
    if (!appTray || appTray.isDestroyed()) return;
    const isEn = isEnglishLocale();
    appTray.setToolTip(
        isEn ? 'MultiChrome (Running in background)' : 'MultiChrome（后台运行中）',
    );
    const contextMenu = Menu.buildFromTemplate([
        {
            label: isEn ? 'Show MultiChrome' : '显示 MultiChrome',
            click: () => showOrRestoreMainWindow(),
        },
        { type: 'separator' },
        {
            label: isEn
                ? 'Close All Environments & Quit'
                : '关闭全部环境并退出',
            click: () => {
                void performGracefulQuit(true);
            },
        },
    ]);
    appTray.setContextMenu(contextMenu);
}

function ensureAppTray(): Tray {
    if (appTray && !appTray.isDestroyed()) {
        updateAppTrayMenu();
        return appTray;
    }
    const icon = nativeImage.createFromPath(getTrayIconPath());
    appTray = new Tray(icon);
    updateAppTrayMenu();
    appTray.on('click', () => showOrRestoreMainWindow());
    appTray.on('double-click', () => showOrRestoreMainWindow());
    return appTray;
}

function destroyAppTray(): void {
    if (appTray && !appTray.isDestroyed()) {
        appTray.destroy();
    }
    appTray = null;
}
app.on('second-instance', () => {
    showOrRestoreMainWindow();
});

// 输入验证函数
function validateString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} 必须是非空字符串`);
    }
    return value.trim();
}

function validateId(value: unknown): string {
    const id = validateString(value, 'ID');
    // 简单的UUID格式验证
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
        )
    ) {
        throw new Error('无效的ID格式');
    }
    return id;
}

// 初始化设置管理器与指纹内核管理器（主进程与 ChromeManager 共享同一实例）
const settingsManager = new SettingsManager();
const kernelManager = new KernelManager({
    getDataPath: () =>
        settingsManager.getSettings().dataPath || app.getPath('userData'),
    logger: log,
});

// 初始化代理与 Chrome 管理器
// sing-box 优先使用用户在「设置」中从 GitHub 官方下载并校验 SHA-256 的核心（存放在 <dataPath>/kernels/sing-box），
// 开发环境如本地存在 resources/sing-box 则作为兜底。
const proxyManager = new ProxyManager({
    store: new Store({ name: 'managed-proxies' }),
    secretStorage: safeStorage,
    resolveBinary: () => {
        const active = kernelManager.getActiveSingbox();
        if (active) {
            return {
                binaryPath: active.executablePath,
                version: active.version,
            };
        }
        return null;
    },
    binaryPath: path.join(
        app.isPackaged
            ? process.resourcesPath
            : path.join(app.getAppPath(), 'resources'),
        'sing-box',
        process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
    ),
    configDirectory: app.getPath('userData'),
    getLocale: () => settingsManager.getSettings().locale || 'zh-CN',
});

let proxyNotifyTimer: NodeJS.Timeout | null = null;
let pendingProxyNotifyState = false;
let pendingProxyNotifyLog = false;

const unsubscribeProxyChanges = proxyManager.subscribe(
    (event: { kind?: string }) => {
        if (event?.kind === 'log') {
            pendingProxyNotifyLog = true;
        } else {
            pendingProxyNotifyState = true;
        }
        if (proxyNotifyTimer) return;
        proxyNotifyTimer = setTimeout(() => {
            proxyNotifyTimer = null;
            const payload = {
                state: pendingProxyNotifyState,
                log: pendingProxyNotifyLog,
            };
            pendingProxyNotifyState = false;
            pendingProxyNotifyLog = false;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('proxy-state-changed', payload);
            }
        }, 150);
    },
);
const chromeManager = new ChromeManager(
    proxyManager,
    settingsManager,
    kernelManager,
);
const proxyIntegration = new ProxyIntegration({ proxyManager, chromeManager });
const automationConfigManager = new AutomationConfigManager({
    store: new Store({ name: 'automation-settings' }),
    secretStorage: safeStorage,
    getLocale: () => settingsManager.getSettings().locale || 'zh-CN',
});
const automationAppVersion = app.getVersion();
const buildAutomationBackend = createAutomationBackend as unknown as (options: {
    chromeManager: ChromeManager;
    proxyManager: ProxyManager;
    proxyIntegration: ProxyIntegration;
    kernelManager: KernelManager;
    appVersion: string;
}) => ReturnType<typeof createAutomationBackend>;
const automationBackend = buildAutomationBackend({
    chromeManager,
    proxyManager,
    proxyIntegration,
    kernelManager,
    appVersion: automationAppVersion,
});
const automationServer = new AutomationServer({
    backend: automationBackend,
    serverVersion: automationAppVersion,
    logger: log,
});
const automationIntegration = new AutomationIntegration({
    configManager: automationConfigManager,
    server: automationServer,
    stdioBridgePath: resolveStdioBridgePath(
        app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked')
            : app.getAppPath(),
    ),
    onStateChange: (status: unknown) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('automation-state-changed', status);
        }
    },
    logger: log,
});

function getTitleBarOverlay(isDark: boolean) {
    return {
        color: '#00000000',
        symbolColor: isDark ? '#e2e8f0' : '#0f172a',
        height: 40,
    };
}

function resolveInitialDarkMode(): boolean {
    const theme = settingsManager.getSettings().theme || 'system';
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return nativeTheme.shouldUseDarkColors;
}

function createWindow() {
    // 获取主显示器信息
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } =
        primaryDisplay.workAreaSize;

    const windowWidth = Math.min(1200, Math.max(1000, screenWidth - 120));
    const windowHeight = Math.min(760, Math.max(650, screenHeight - 100));
    const isDark = resolveInitialDarkMode();
    const savedTheme = settingsManager.getSettings().theme || 'system';
    nativeTheme.themeSource = savedTheme;

    // 创建主窗口（采用 Windows 11 原生标题栏按钮覆盖方案）
    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        center: true,
        minWidth: 740,
        minHeight: 540,
        show: false, // 先隐藏窗口，等加载完成后再显示
        autoHideMenuBar: true, // 隐藏菜单栏
        frame: true, // 保留窗口边框与系统拖动/缩放/贴靠行为
        backgroundColor:
            process.platform === 'win32' || process.platform === 'darwin'
                ? '#00000000'
                : isDark
                  ? '#11141c'
                  : '#f4f6fa',
        ...(process.platform === 'win32'
            ? {
                  backgroundMaterial: 'acrylic' as const,
                  titleBarStyle: 'hidden' as const,
                  titleBarOverlay: getTitleBarOverlay(isDark),
              }
            : process.platform === 'darwin'
              ? {
                    vibrancy: 'under-window' as const,
                    visualEffectState: 'active' as const,
                    titleBarStyle: 'hiddenInset' as const,
                }
              : { titleBarStyle: 'default' as const }),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true, // 启用沙盒模式提升安全性
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
        },
        icon: path.join(
            app.getAppPath(),
            'assets',
            process.platform === 'win32' ? 'icon.ico' : 'icon.png',
        ),
    });

    // 设置安全策略
    mainWindow.webContents.session.webRequest.onHeadersReceived(
        (details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [
                        isDev
                            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline' http://localhost:5173; img-src 'self' data: http://localhost:5173;"
                            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
                    ],
                },
            });
        },
    );

    // 加载前端页面
    if (isDev) {
        // 开发模式下，等待或加载 Vite 开发服务器 URL
        const devUrl = 'http://localhost:5173';
        let retryCount = 0;
        mainWindow.webContents.on(
            'did-fail-load',
            (_event, errorCode, errorDesc) => {
                log.warn(`开发页面加载失败 (${errorCode}): ${errorDesc}`);
                if (
                    retryCount < 20 &&
                    mainWindow &&
                    !mainWindow.isDestroyed()
                ) {
                    retryCount += 1;
                    setTimeout(() => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            void mainWindow.loadURL(devUrl);
                        }
                    }, 500);
                }
            },
        );
        void mainWindow.loadURL(devUrl);
        // 打开开发工具
        mainWindow.webContents.openDevTools();
    } else {
        // 生产模式下，加载打包后的HTML文件
        mainWindow.webContents.on(
            'did-fail-load',
            (_event, errorCode, errorDesc, validatedURL) => {
                log.error(
                    `页面加载失败 (${errorCode}): ${errorDesc} - ${validatedURL}`,
                );
            },
        );
        void mainWindow.loadFile(
            path.join(__dirname, '../renderer/index.html'),
        );
    }

    mainWindow.webContents.on('did-finish-load', () => {
        log.info('Renderer did-finish-load:', mainWindow?.webContents.getURL());
        if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.setMenuBarVisibility(false);
        }
    });

    // 处理外部链接：严格仅放行 HTTPS 外链，阻断 file:// 等危险系统协议
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const safeUrl = parseSafeExternalUrl(url);
        if (safeUrl) {
            void shell.openExternal(safeUrl);
        } else {
            log.warn('已拦截非安全外部链接打开请求');
        }
        return { action: 'deny' };
    });

    // 页面加载完成后显示窗口
    mainWindow.once('ready-to-show', () => {
        log.info('MainWindow ready-to-show');
        mainWindow?.show();
        // 确保菜单栏隐藏
        mainWindow?.setMenuBarVisibility(false);
    });

    // 窗口关闭前的运行态保护：存在运行中环境时拦截弹窗，避免窗口闪烁或代理中断
    mainWindow.on('close', (event) => {
        if (quitReady) return;
        const summary = chromeManager.getRunningEnvironmentSummary();
        if (summary.count === 0) return;

        event.preventDefault();
        if (checkingQuit) return;
        checkingQuit = true;
        void (async () => {
            const hasProxyProfiles = await proxyIntegration.hasRunningProfiles();
            const isEn = isEnglishLocale();
            const previewNames = summary.names
                .slice(0, 4)
                .join(isEn ? ', ' : '、');
            const nameSuffix =
                summary.names.length > 4
                    ? isEn
                        ? ` and ${summary.count - 4} more`
                        : ` 等 ${summary.count} 个环境`
                    : '';
            const detailLines = isEn
                ? [
                      `Running: ${previewNames}${nameSuffix}.`,
                      hasProxyProfiles
                          ? 'Quitting directly will stop the built-in proxy service and disconnect these environments. Minimize to tray to keep running in the background, or close all environments before quitting.'
                          : 'You can minimize MultiChrome to the system tray to keep monitoring in the background, or close all running environments first.',
                  ]
                : [
                      `正在运行：${previewNames}${nameSuffix}。`,
                      hasProxyProfiles
                          ? '直接退出会停止内置代理服务并中断这些环境的网络连接。建议最小化到托盘保持后台运行，或先关闭全部环境后安全退出。'
                          : '您可以将主程序最小化到系统托盘继续在后台监控状态，或先安全关闭全部运行环境再退出。',
                  ];
            const parentWin =
                mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
            const boxOptions = {
                type: 'question' as const,
                title: isEn ? 'Quit MultiChrome' : '退出 MultiChrome',
                message: isEn
                    ? `${summary.count} browser environment${summary.count > 1 ? 's are' : ' is'} still running`
                    : `当前仍有 ${summary.count} 个浏览器环境正在运行`,
                detail: detailLines.join('\n\n'),
                buttons: isEn
                    ? [
                          'Minimize to Tray',
                          'Close All & Quit',
                          'Cancel',
                      ]
                    : ['最小化到托盘', '关闭全部环境并退出', '取消'],
                defaultId: 0,
                cancelId: 2,
            };
            const result = parentWin
                ? await dialog.showMessageBox(parentWin, boxOptions)
                : await dialog.showMessageBox(boxOptions);

            if (result.response === 0) {
                ensureAppTray();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.hide();
                }
                return;
            }
            if (result.response === 1) {
                checkingQuit = false;
                await performGracefulQuit(true);
            }
        })()
            .catch((error) => {
                log.error('退出前运行态检查失败:', error);
            })
            .finally(() => {
                if (!quitReady) {
                    checkingQuit = false;
                }
            });
    });

    // 窗口关闭时清空引用
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
    createWindow();

    // 设置ChromeManager的主窗口引用
    if (mainWindow) {
        chromeManager.setMainWindow(mainWindow);
    }

    // 设置IPC处理程序
    setupIpcHandlers();

    // 若已启用本地自动化控制面，则在应用就绪后按需启动（端口绑定失败仅记录在 lastError，绝不阻断应用启动）
    const automationCfg = automationConfigManager.getConfig();
    if (automationCfg.localApiEnabled || automationCfg.mcpEnabled) {
        void automationIntegration
            .init()
            .then(() => {
                automationIntegration.emitStateChange();
            })
            .catch((err) => {
                log.warn('[Automation] 本地自动化控制面初始化异常:', err);
            });
    }

    // 系统从休眠/睡眠恢复后，旧 UDP NAT 映射与长连接可能已失效，标记空闲内置代理在下次启动前重建通道
    powerMonitor.on('resume', () => {
        log.info('检测到系统从休眠恢复，将在下次启动时自动重建空闲 sing-box 通道');
        proxyManager.markAllStale('system-resume');
    });

    // macOS下点击dock图标时重新创建窗口
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            if (mainWindow) {
                chromeManager.setMainWindow(mainWindow);
            }
        }
    });
});

// 所有窗口关闭时退出应用（Windows & Linux）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

let quitReady = false;
let checkingQuit = false;

async function performGracefulQuit(closeAllEnvironmentsFirst = false): Promise<void> {
    if (quitReady || checkingQuit) return;
    checkingQuit = true;
    proxyIntegration.closing = true;
    try {
        await proxyIntegration.pending;
        if (closeAllEnvironmentsFirst) {
            await chromeManager.closeAllEnvironments();
        } else {
            const summary = chromeManager.getRunningEnvironmentSummary();
            const hasProxyProfiles = await proxyIntegration.hasRunningProfiles();
            if (summary.count > 0 || hasProxyProfiles) {
                const isEn = isEnglishLocale();
                const countLabel =
                    summary.count > 0 ? `${summary.count} 个` : '正在使用内置代理的';
                const parentWin =
                    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
                const boxOptions = {
                    type: 'question' as const,
                    title: isEn ? 'Quit MultiChrome' : '退出 MultiChrome',
                    message: isEn
                        ? summary.count > 0
                            ? `${summary.count} browser environment${summary.count > 1 ? 's are' : ' is'} still running`
                            : 'Browser environments using the built-in proxy are still running'
                        : `当前仍有 ${countLabel} 浏览器环境正在运行`,
                    detail: isEn
                        ? hasProxyProfiles
                            ? 'Quitting directly will stop the built-in proxy service and disconnect these environments. Close all environments first or minimize to the system tray.'
                            : 'Close all running environments before quitting, or minimize to the system tray.'
                        : hasProxyProfiles
                          ? '直接退出会停止内置代理服务并中断这些环境的网络连接。建议先关闭全部环境再退出，或最小化到系统托盘。'
                          : '建议先关闭全部运行环境再退出，或最小化到系统托盘保持后台运行。',
                    buttons: isEn
                        ? ['Minimize to Tray', 'Close All & Quit', 'Cancel']
                        : ['最小化到托盘', '关闭全部环境并退出', '取消'],
                    defaultId: 0,
                    cancelId: 2,
                };
                const result = parentWin
                    ? await dialog.showMessageBox(parentWin, boxOptions)
                    : await dialog.showMessageBox(boxOptions);

                if (result.response === 0) {
                    ensureAppTray();
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.hide();
                    }
                    return;
                }
                if (result.response === 1) {
                    await chromeManager.closeAllEnvironments();
                } else {
                    showOrRestoreMainWindow();
                    return;
                }
            }
        }

        await automationIntegration.shutdown();
        await proxyIntegration.shutdown();
        unsubscribeProxyChanges();
        if (proxyNotifyTimer) {
            clearTimeout(proxyNotifyTimer);
            proxyNotifyTimer = null;
        }
        chromeManager.stopStatusMonitoring();
        chromeManager.closeDatabase();
        destroyAppTray();
        quitReady = true;
        app.quit();
    } catch {
        log.error('关闭内置代理失败，请重试退出');
        showOrRestoreMainWindow();
        const isEn = isEnglishLocale();
        dialog.showErrorBox(
            isEn ? 'Unable to Quit Right Now' : '暂时无法退出',
            isEn
                ? 'Unable to verify browser state or stop the built-in proxy. MultiChrome will keep running; please try quitting again.'
                : '无法确认浏览器状态或关闭内置代理，程序已继续运行，请重试。',
        );
    } finally {
        checkingQuit = false;
        if (!quitReady) proxyIntegration.closing = false;
    }
}

app.on('before-quit', (event) => {
    if (quitReady) return;
    event.preventDefault();
    void performGracefulQuit(false);
});

function getKernelStatusPayload() {
    return kernelManager.getStatus(
        chromeManager.getSystemChromePath(),
        settingsManager.getSettings().locale || 'zh-CN',
    );
}

// 设置IPC处理程序
function setupIpcHandlers() {
    registerProxyIpc({ ipcMain, integration: proxyIntegration, validateId });
    registerAutomationIpc({ ipcMain, integration: automationIntegration });

    ipcMain.handle('app:logs', () => applicationLogs.getLogs());
    ipcMain.handle('app:clear-logs', () => applicationLogs.clearLogs());
    // 获取所有Chrome环境
    ipcMain.handle('get-chrome-environments', async () => {
        try {
            return await chromeManager.getAllEnvironments();
        } catch (error) {
            log.error('获取Chrome环境失败:', error);
            throw error;
        }
    });

    // 创建新的Chrome环境
    ipcMain.handle(
        'create-chrome-environment',
        async (
            _,
            name: unknown,
            groupName: unknown,
            notes: unknown = '',
            options: unknown = undefined,
        ) => {
            try {
                const validName = validateString(name, '环境名称');
                const validGroupName = validateString(groupName, '分组名称');
                const validNotes = typeof notes === 'string' ? notes : '';
                const validOptions: {
                    browserEngine?: BrowserEngineType;
                    fingerprintConfig?: Partial<FingerprintConfig>;
                    proxyId?: string;
                    proxy?: string;
                    proxyLabel?: string;
                    tags?: string[];
                } = {};
                if (options && typeof options === 'object') {
                    const raw = options as Record<string, unknown>;
                    if ('browserEngine' in raw) {
                        validOptions.browserEngine = normalizeBrowserEngine(
                            raw.browserEngine,
                        ) as BrowserEngineType;
                    }
                    if (
                        'fingerprintConfig' in raw &&
                        raw.fingerprintConfig &&
                        typeof raw.fingerprintConfig === 'object'
                    ) {
                        validOptions.fingerprintConfig =
                            normalizeFingerprintConfig(
                                raw.fingerprintConfig,
                                settingsManager.getSettings().fingerprint,
                            ) as Partial<FingerprintConfig>;
                    }
                    if ('proxyId' in raw && typeof raw.proxyId === 'string') {
                        const trimmedProxyId = raw.proxyId.trim();
                        if (trimmedProxyId) {
                            validOptions.proxyId = validateId(trimmedProxyId);
                        }
                    }
                    if ('proxy' in raw && typeof raw.proxy === 'string') {
                        const trimmedProxy = raw.proxy.trim();
                        if (trimmedProxy) {
                            validOptions.proxy = trimmedProxy;
                        }
                    }
                    if ('proxyLabel' in raw && typeof raw.proxyLabel === 'string') {
                        const trimmedLabel = raw.proxyLabel.trim();
                        if (trimmedLabel) {
                            validOptions.proxyLabel = trimmedLabel;
                        }
                    }
                    if ('tags' in raw) {
                        validOptions.tags = normalizeEnvironmentTags(raw.tags);
                    }
                }

                return await chromeManager.createEnvironment(
                    validName,
                    validGroupName,
                    validNotes,
                    Object.keys(validOptions).length > 0
                        ? validOptions
                        : undefined,
                );
            } catch (error) {
                log.error('创建Chrome环境失败:', error);
                throw error;
            }
        },
    );

    // 克隆现有Chrome环境（生成全新独立指纹与数据目录）
    ipcMain.handle(
        'clone-chrome-environment',
        async (_, id: unknown, customName: unknown = undefined) => {
            try {
                const validId = validateId(id);
                const validName =
                    typeof customName === 'string' && customName.trim()
                        ? customName.trim()
                        : undefined;
                return await chromeManager.cloneEnvironment(validId, validName);
            } catch (error) {
                log.error('克隆Chrome环境失败:', error);
                throw error;
            }
        },
    );

    // 启动前一致性护栏校验
    ipcMain.handle(
        'check-environment-launch-consistency',
        async (_, id: unknown) => {
            try {
                const validId = validateId(id);
                return await chromeManager.checkLaunchConsistency(validId);
            } catch (error) {
                log.error('启动前一致性校验失败:', error);
                throw error;
            }
        },
    );

    // 一键防泄露 / 指纹健康自检
    ipcMain.handle('inspect-environment-health', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await proxyIntegration.runLaunch(() =>
                chromeManager.inspectEnvironmentHealth(validId),
            );
        } catch (error) {
            log.error('环境健康自检失败:', error);
            throw error;
        }
    });

    // 获取运行中环境的实时内存占用统计
    ipcMain.handle('get-running-resource-stats', async () => {
        try {
            return await chromeManager.getRunningResourceStats();
        } catch (error) {
            log.error('获取运行环境资源统计失败:', error);
            return {
                totalMemoryBytes: 0,
                totalProcesses: 0,
                environments: {},
            };
        }
    });

    // 一键关闭全部运行中的Chrome环境
    ipcMain.handle('close-all-chrome-environments', async () => {
        try {
            return await chromeManager.closeAllEnvironments();
        } catch (error) {
            log.error('关闭全部运行环境失败:', error);
            throw error;
        }
    });

    // 在运行中环境里打开检测页
    ipcMain.handle(
        'open-url-in-environment',
        async (_, id: unknown, url: unknown) => {
            try {
                const validId = validateId(id);
                const validUrl = validateString(url, '页面地址');
                return await chromeManager.openUrlInEnvironment(
                    validId,
                    validUrl,
                );
            } catch (error) {
                log.error('在环境中打开页面失败:', error);
                throw error;
            }
        },
    );

    // 统计环境 Profile 磁盘占用与可清理缓存
    ipcMain.handle('get-environment-storage', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await chromeManager.getEnvironmentStorageStats(validId);
        } catch (error) {
            log.error('统计环境磁盘占用失败:', error);
            throw error;
        }
    });

    // 清理环境缓存（保留 Cookie 与登录态）
    ipcMain.handle('clear-environment-cache', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await chromeManager.clearEnvironmentCache(validId);
        } catch (error) {
            log.error('清理环境缓存失败:', error);
            throw error;
        }
    });

    // 在系统文件管理器中打开环境数据目录
    ipcMain.handle('open-environment-data-dir', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            const dataDir = chromeManager.getEnvironmentDataDir(validId);
            fs.mkdirSync(dataDir, { recursive: true });
            const errMsg = await shell.openPath(dataDir);
            if (errMsg) {
                throw new Error(errMsg);
            }
            return true;
        } catch (error) {
            log.error('打开环境数据目录失败:', error);
            throw error;
        }
    });

    // 重新生成环境持久化指纹配置
    ipcMain.handle(
        'regenerate-environment-fingerprint',
        async (_, id: unknown) => {
            try {
                const validId = validateId(id);
                return await chromeManager.regenerateFingerprint(validId);
            } catch (error) {
                log.error('重新生成环境指纹失败:', error);
                throw error;
            }
        },
    );

    // 启动Chrome环境（允许多个环境并发启动，同时仍与代理停用/删除/退出安全互斥）
    ipcMain.handle('launch-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            log.info(`收到启动Chrome环境请求，环境ID: ${validId}`);
            return await proxyIntegration.runLaunch(() =>
                chromeManager.launchEnvironment(validId),
            );
        } catch (error) {
            log.error('启动Chrome环境失败:', error);
            throw error;
        }
    });

    // 关闭Chrome环境
    ipcMain.handle('close-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await proxyIntegration.run(() =>
                chromeManager.closeEnvironment(validId),
            );
        } catch (error) {
            log.error('关闭Chrome环境失败:', error);
            throw error;
        }
    });

    // 软删除Chrome环境（移到回收站）
    ipcMain.handle('delete-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await proxyIntegration.run(() =>
                chromeManager.deleteEnvironment(validId),
            );
        } catch (error) {
            log.error('删除Chrome环境失败:', error);
            throw error;
        }
    });

    // 获取回收站中的环境
    ipcMain.handle('get-deleted-environments', async () => {
        try {
            return await chromeManager.getDeletedEnvironments();
        } catch (error) {
            log.error('获取回收站环境失败:', error);
            throw error;
        }
    });

    // 从回收站恢复环境
    ipcMain.handle('restore-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await chromeManager.restoreEnvironment(validId);
        } catch (error) {
            log.error('恢复Chrome环境失败:', error);
            throw error;
        }
    });

    // 永久删除环境
    ipcMain.handle('permanently-delete-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await proxyIntegration.run(() =>
                chromeManager.permanentlyDeleteEnvironment(validId),
            );
        } catch (error) {
            log.error('永久删除环境失败:', error);
            throw error;
        }
    });

    // 清空回收站
    ipcMain.handle('cleanup-trash', async () => {
        try {
            return await proxyIntegration.run(() =>
                chromeManager.cleanupTrash(),
            );
        } catch (error) {
            log.error('清空回收站失败:', error);
            throw error;
        }
    });

    // 更新Chrome环境信息
    ipcMain.handle(
        'update-chrome-environment',
        async (_, id: unknown, data: unknown) => {
            try {
                const validId = validateId(id);

                // 验证更新数据
                if (!data || typeof data !== 'object') {
                    throw new Error('更新数据格式无效');
                }

                const updateData = data as Record<string, unknown>;
                const validData: Partial<ChromeEnvironment> = {};

                if ('name' in updateData)
                    validData.name = validateString(
                        updateData.name,
                        '环境名称',
                    );
                if ('groupName' in updateData)
                    validData.groupName = validateString(
                        updateData.groupName,
                        '分组名称',
                    );
                if ('notes' in updateData)
                    validData.notes =
                        typeof updateData.notes === 'string'
                            ? updateData.notes
                            : '';
                if ('tags' in updateData)
                    validData.tags = normalizeEnvironmentTags(updateData.tags);
                if ('proxy' in updateData)
                    validData.proxy =
                        typeof updateData.proxy === 'string'
                            ? updateData.proxy
                            : undefined;
                if ('proxyId' in updateData)
                    validData.proxyId = updateData.proxyId
                        ? validateId(updateData.proxyId)
                        : '';
                if ('proxyLabel' in updateData)
                    validData.proxyLabel =
                        typeof updateData.proxyLabel === 'string'
                            ? updateData.proxyLabel
                            : undefined;
                if ('userAgent' in updateData)
                    validData.userAgent =
                        typeof updateData.userAgent === 'string'
                            ? updateData.userAgent
                            : undefined;
                if ('timezone' in updateData)
                    validData.timezone =
                        typeof updateData.timezone === 'string'
                            ? updateData.timezone
                            : undefined;
                if ('language' in updateData)
                    validData.language =
                        typeof updateData.language === 'string'
                            ? updateData.language
                            : undefined;
                if ('startupUrl' in updateData)
                    validData.startupUrl =
                        typeof updateData.startupUrl === 'string'
                            ? updateData.startupUrl.trim()
                            : undefined;
                if ('browserEngine' in updateData)
                    validData.browserEngine = normalizeBrowserEngine(
                        updateData.browserEngine,
                    ) as BrowserEngineType;
                if (
                    'fingerprintConfig' in updateData &&
                    updateData.fingerprintConfig &&
                    typeof updateData.fingerprintConfig === 'object'
                ) {
                    validData.fingerprintConfig = normalizeFingerprintConfig(
                        updateData.fingerprintConfig,
                        settingsManager.getSettings().fingerprint,
                    ) as FingerprintConfig;
                }

                return await proxyIntegration.run(async () => {
                    await proxyIntegration.validateBinding(validId, validData);
                    return chromeManager.updateEnvironment(validId, validData);
                });
            } catch (error) {
                log.error('更新Chrome环境失败:', error);
                throw error;
            }
        },
    );

    // 获取空分组
    ipcMain.handle('get-empty-groups', async () => {
        try {
            return await chromeManager.getEmptyGroups();
        } catch (error) {
            log.error('获取空分组失败:', error);
            throw error;
        }
    });

    // 重命名分组
    ipcMain.handle(
        'rename-group',
        async (_, oldName: unknown, newName: unknown) => {
            try {
                const validOldName = validateString(oldName, '原分组名称');
                const validNewName = validateString(newName, '新分组名称');
                return await chromeManager.renameGroup(
                    validOldName,
                    validNewName,
                );
            } catch (error) {
                log.error('重命名分组失败:', error);
                throw error;
            }
        },
    );

    // 删除分组（支持迁移组内环境到目标分组，或将组内环境移入回收站）
    ipcMain.handle(
        'delete-group',
        async (_, groupName: unknown, options: unknown = undefined) => {
            try {
                const validGroupName = validateString(groupName, '分组名称');
                const rawOptions =
                    options && typeof options === 'object'
                        ? (options as Record<string, unknown>)
                        : {};
                const action =
                    rawOptions.action === 'trash' ? 'trash' : 'move';
                const targetGroup =
                    typeof rawOptions.targetGroup === 'string'
                        ? rawOptions.targetGroup
                        : undefined;
                return await proxyIntegration.run(() =>
                    chromeManager.deleteGroup(validGroupName, {
                        action,
                        targetGroup,
                    }),
                );
            } catch (error) {
                log.error('删除分组失败:', error);
                throw error;
            }
        },
    );

    // 删除空分组
    ipcMain.handle('delete-empty-group', async (_, groupName: unknown) => {
        try {
            const validGroupName = validateString(groupName, '分组名称');
            return await chromeManager.deleteEmptyGroup(validGroupName);
        } catch (error) {
            log.error('删除空分组失败:', error);
            throw error;
        }
    });

    // 获取应用设置
    ipcMain.handle('get-settings', async () => {
        try {
            return settingsManager.getSettings();
        } catch (error) {
            log.error('获取应用设置失败:', error);
            throw error;
        }
    });

    // 保存应用设置
    ipcMain.handle('save-settings', async (_, settings: unknown) => {
        try {
            if (!settings || typeof settings !== 'object') {
                throw new Error('设置数据格式无效');
            }

            const settingsData = settings as Record<string, unknown>;
            if (
                !('dataPath' in settingsData) ||
                typeof settingsData.dataPath !== 'string'
            ) {
                throw new Error('dataPath 必须是字符串');
            }

            // 构建有效的设置对象，包含 dataPath 和 globalProxy
            const validSettings: AppSettings = { dataPath: settingsData.dataPath };

            // 如果有 globalProxy 配置，添加到设置中
            if ('globalProxy' in settingsData && settingsData.globalProxy) {
                const proxy = settingsData.globalProxy as Record<
                    string,
                    unknown
                >;
                if (
                    typeof proxy.enabled === 'boolean' &&
                    typeof proxy.address === 'string'
                ) {
                    validSettings.globalProxy = {
                        enabled: proxy.enabled,
                        address: proxy.address,
                    };
                }
            }

            // 如果有 startupUrl 配置，添加到设置中
            if (
                'startupUrl' in settingsData &&
                typeof settingsData.startupUrl === 'string'
            ) {
                validSettings.startupUrl = settingsData.startupUrl;
            }

            // 如果有 theme 配置，添加到设置中
            if (
                settingsData.theme === 'system' ||
                settingsData.theme === 'light' ||
                settingsData.theme === 'dark'
            ) {
                validSettings.theme = settingsData.theme;
            }

            if (
                settingsData.locale === 'zh-CN' ||
                settingsData.locale === 'en-US'
            ) {
                validSettings.locale = settingsData.locale;
            }

            if (typeof settingsData.memorySaverMode === 'boolean') {
                validSettings.memorySaverMode = settingsData.memorySaverMode;
            }
            if (Array.isArray(settingsData.bookmarkTemplates)) {
                validSettings.bookmarkTemplates = settingsData.bookmarkTemplates;
            }
            if (Array.isArray(settingsData.extensionTemplates)) {
                validSettings.extensionTemplates =
                    settingsData.extensionTemplates;
            }
            if (
                typeof settingsData.allowExtensionsOnFingerprintKernel ===
                'boolean'
            ) {
                validSettings.allowExtensionsOnFingerprintKernel =
                    settingsData.allowExtensionsOnFingerprintKernel;
            }
            if (typeof settingsData.requireHealthCheckOnLaunch === 'boolean') {
                validSettings.requireHealthCheckOnLaunch =
                    settingsData.requireHealthCheckOnLaunch;
            }
            if (
                settingsData.groupStartupUrls &&
                typeof settingsData.groupStartupUrls === 'object' &&
                !Array.isArray(settingsData.groupStartupUrls)
            ) {
                validSettings.groupStartupUrls =
                    settingsData.groupStartupUrls as Record<string, string>;
            }

            // 如果有默认指纹与防泄露策略配置，添加到设置中
            if (
                'fingerprint' in settingsData &&
                settingsData.fingerprint &&
                typeof settingsData.fingerprint === 'object'
            ) {
                validSettings.fingerprint = normalizeDefaultFingerprintSettings(
                    settingsData.fingerprint,
                ) as DefaultFingerprintSettings;
            }

            const saved = await settingsManager.saveSettings(validSettings);
            if (saved) {
                updateAppTrayMenu();
            }
            return saved;
        } catch (error) {
            log.error('保存应用设置失败:', error);
            throw error;
        }
    });

    // 浏览器内核管理 IPC（存放在数据目录 <dataPath>/kernels）
    ipcMain.handle('kernels:status', () => getKernelStatusPayload());

    ipcMain.handle(
        'kernels:refresh-releases',
        async (_, options: unknown = undefined) => {
            let proxyAddress: string | undefined;
            if (options && typeof options === 'object') {
                const raw = options as Record<string, unknown>;
                if (typeof raw.proxyId === 'string' && raw.proxyId.trim()) {
                    proxyAddress = await proxyManager.ensureStarted(
                        validateId(raw.proxyId),
                    );
                } else if (raw.useGlobalProxy) {
                    const gp = settingsManager.getSettings().globalProxy;
                    if (gp?.enabled && gp.address) proxyAddress = gp.address;
                }
            } else {
                const gp = settingsManager.getSettings().globalProxy;
                if (gp?.enabled && gp.address) proxyAddress = gp.address;
            }
            await kernelManager.fetchAvailableReleases(proxyAddress);
            return getKernelStatusPayload();
        },
    );

    ipcMain.handle(
        'kernels:download',
        async (_, version: unknown, options: unknown = undefined) => {
            const validVersion = validateString(version, '内核版本号');
            let proxyAddress: string | undefined;
            if (options && typeof options === 'object') {
                const raw = options as Record<string, unknown>;
                if (typeof raw.proxyId === 'string' && raw.proxyId.trim()) {
                    proxyAddress = await proxyManager.ensureStarted(
                        validateId(raw.proxyId),
                    );
                } else if (raw.useGlobalProxy) {
                    const gp = settingsManager.getSettings().globalProxy;
                    if (gp?.enabled && gp.address) proxyAddress = gp.address;
                }
            }
            const installed = await kernelManager.downloadAndInstall(
                validVersion,
                {
                    proxyAddress,
                    onProgress: (progress: unknown) => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send(
                                'kernel-download-progress',
                                progress,
                            );
                        }
                    },
                },
            );
            return {
                installed,
                status: getKernelStatusPayload(),
            };
        },
    );

    ipcMain.handle('kernels:cancel-download', (_, target: unknown = 'fingerprint-chromium') =>
        kernelManager.cancelDownload(
            target === 'sing-box' ? 'sing-box' : 'fingerprint-chromium',
        ),
    );

    // sing-box 官方代理核心管理 IPC（同样从 GitHub Releases 下载并强制校验 SHA-256）
    ipcMain.handle(
        'kernels:refresh-singbox-releases',
        async (_, options: unknown = undefined) => {
            let proxyAddress: string | undefined;
            if (options && typeof options === 'object') {
                const raw = options as Record<string, unknown>;
                if (raw.useGlobalProxy) {
                    const gp = settingsManager.getSettings().globalProxy;
                    if (gp?.enabled && gp.address) proxyAddress = gp.address;
                }
            }
            await kernelManager.fetchAvailableSingboxReleases(proxyAddress);
            return getKernelStatusPayload();
        },
    );

    ipcMain.handle(
        'kernels:download-singbox',
        async (_, version: unknown, options: unknown = undefined) => {
            const validVersion = validateString(version, 'sing-box 版本号');
            let proxyAddress: string | undefined;
            if (options && typeof options === 'object') {
                const raw = options as Record<string, unknown>;
                if (raw.useGlobalProxy) {
                    const gp = settingsManager.getSettings().globalProxy;
                    if (gp?.enabled && gp.address) proxyAddress = gp.address;
                }
            }
            const installed = await kernelManager.downloadAndInstallSingbox(
                validVersion,
                {
                    proxyAddress,
                    onProgress: (progress: unknown) => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send(
                                'kernel-download-progress',
                                progress,
                            );
                        }
                    },
                },
            );
            return {
                installed,
                status: getKernelStatusPayload(),
            };
        },
    );

    ipcMain.handle('kernels:import-local-singbox', async () => {
        if (!mainWindow) {
            throw new Error('主窗口未初始化');
        }
        const isEn = isEnglishLocale();
        const result = await dialog.showOpenDialog(mainWindow, {
            title: isEn
                ? 'Select official sing-box archive (.zip / .tar.gz) or sing-box executable'
                : '选择 sing-box 官方压缩包 (.zip / .tar.gz) 或 sing-box.exe',
            properties: ['openFile'],
            filters: [
                {
                    name: isEn ? 'sing-box Core Files' : 'sing-box 核心文件',
                    extensions: ['zip', 'gz', 'exe'],
                },
                { name: isEn ? 'All Files' : '所有文件', extensions: ['*'] },
            ],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return {
                canceled: true,
                status: getKernelStatusPayload(),
            };
        }
        const imported = await kernelManager.importLocalSingbox(
            result.filePaths[0],
        );
        return {
            canceled: false,
            installed: imported,
            status: getKernelStatusPayload(),
        };
    });

    ipcMain.handle('kernels:set-active-singbox', (_, kernelId: unknown) => {
        const validKernelId = validateString(kernelId, 'sing-box 核心ID');
        kernelManager.setActiveSingbox(validKernelId);
        return getKernelStatusPayload();
    });

    ipcMain.handle('kernels:remove-singbox', (_, kernelId: unknown) => {
        const validKernelId = validateString(kernelId, 'sing-box 核心ID');
        kernelManager.removeSingbox(validKernelId);
        return getKernelStatusPayload();
    });

    ipcMain.handle(
        'kernels:import-local',
        async (_, mode: unknown = 'file') => {
            if (!mainWindow) {
                throw new Error('主窗口未初始化');
            }
            const isEn = isEnglishLocale();
            const isFolder = mode === 'folder';
            const platformTitle =
                process.platform === 'darwin'
                    ? isEn
                        ? 'Select privacy browser image (.dmg / .zip) or Chromium.app'
                        : '选择指纹内核镜像 (.dmg / .zip) 或 Chromium.app'
                    : process.platform === 'linux'
                      ? isEn
                          ? 'Select privacy browser archive (.tar.xz / .zip) or chrome executable'
                          : '选择指纹内核压缩包 (.tar.xz / .zip) 或 chrome 可执行文件'
                      : isEn
                        ? 'Select privacy browser archive (.zip) or chrome.exe'
                        : '选择指纹内核压缩包 (.zip) 或 chrome.exe';
            const platformFilters =
                process.platform === 'darwin'
                    ? [
                          {
                              name: isEn
                                  ? 'macOS Chromium Kernel'
                                  : 'macOS Chromium 内核',
                              extensions: ['dmg', 'zip', 'app'],
                          },
                          {
                              name: isEn ? 'All Files' : '所有文件',
                              extensions: ['*'],
                          },
                      ]
                    : process.platform === 'linux'
                      ? [
                            {
                                name: isEn
                                    ? 'Linux Chromium Kernel'
                                    : 'Linux Chromium 内核',
                                extensions: ['xz', 'gz', 'zip'],
                            },
                            {
                                name: isEn ? 'All Files' : '所有文件',
                                extensions: ['*'],
                            },
                        ]
                      : [
                            {
                                name: isEn
                                    ? 'Windows Chromium Kernel'
                                    : 'Windows Chromium 内核',
                                extensions: ['zip', 'exe'],
                            },
                            {
                                name: isEn ? 'All Files' : '所有文件',
                                extensions: ['*'],
                            },
                        ];
            const result = await dialog.showOpenDialog(mainWindow, {
                title: isFolder
                    ? isEn
                        ? 'Select Privacy Browser Folder'
                        : '选择指纹内核所在目录'
                    : platformTitle,
                properties: isFolder ? ['openDirectory'] : ['openFile'],
                filters: isFolder ? undefined : platformFilters,
            });
            if (result.canceled || result.filePaths.length === 0) {
                return {
                    canceled: true,
                    status: getKernelStatusPayload(),
                };
            }
            const imported = await kernelManager.importLocalKernel(
                result.filePaths[0],
            );
            return {
                canceled: false,
                installed: imported,
                status: getKernelStatusPayload(),
            };
        },
    );

    ipcMain.handle('kernels:set-active', (_, kernelId: unknown) => {
        const validKernelId = validateString(kernelId, '内核ID');
        kernelManager.setActiveKernel(validKernelId);
        return getKernelStatusPayload();
    });

    ipcMain.handle('kernels:remove', (_, kernelId: unknown) => {
        const validKernelId = validateString(kernelId, '内核ID');
        kernelManager.removeKernel(validKernelId);
        return getKernelStatusPayload();
    });

    ipcMain.handle('kernels:open-dir', async () => {
        const dir = kernelManager.getKernelsDir();
        fs.mkdirSync(dir, { recursive: true });
        await shell.openPath(dir);
        return true;
    });

    // 应用与窗口外观辅助 IPC
    ipcMain.handle('app:get-info', () => ({
        version: app.getVersion(),
        platform: process.platform,
    }));

    ipcMain.handle('app:open-external', async (_, rawUrl: unknown) => {
        if (typeof rawUrl !== 'string') {
            throw new Error('无效的链接地址');
        }
        let parsed: URL;
        try {
            parsed = new URL(rawUrl);
        } catch {
            throw new Error('无效的链接地址');
        }
        if (
            parsed.protocol !== 'https:' ||
            parsed.hostname.toLowerCase() !== 'github.com' ||
            !parsed.pathname.toLowerCase().startsWith('/oliverwalker1122/multichrome')
        ) {
            throw new Error('仅允许打开官方项目页面');
        }
        await shell.openExternal(parsed.toString());
        return true;
    });

    ipcMain.handle('app:check-update', async () => {
        const currentVersion = app.getVersion();
        const globalProxy = settingsManager.getSettings().globalProxy;
        const proxyAddress =
            globalProxy?.enabled && globalProxy.address?.trim()
                ? globalProxy.address.trim()
                : undefined;

        let payload: Record<string, unknown>;
        try {
            payload = (await fetchOfficialGitHubJson(APP_RELEASES_API_URL, {
                proxyAddress,
                timeoutMs: 10000,
                userAgent: `MultiChrome/${currentVersion}`,
            })) as Record<string, unknown>;
        } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            if (msg.includes('超时')) {
                throw new Error('检查更新超时，请稍后重试');
            }
            if (msg.startsWith('HTTP ') || msg.includes('解析版本信息') || msg.includes('代理')) {
                throw new Error(msg);
            }
            throw new Error('网络不可达，无法检查更新');
        }

        const rawTag = String(payload.tag_name || '').trim();
        const latestVersion = rawTag.replace(/^v/i, '');
        if (!latestVersion) {
            throw new Error('未获取到有效版本号');
        }
        const htmlUrl =
            typeof payload.html_url === 'string' &&
            payload.html_url.startsWith(`${APP_REPO_URL}/`)
                ? payload.html_url
                : `${APP_REPO_URL}/releases`;
        return {
            currentVersion,
            latestVersion,
            hasUpdate: compareDotVersions(latestVersion, currentVersion) > 0,
            releaseUrl: htmlUrl,
            publishedAt:
                typeof payload.published_at === 'string'
                    ? payload.published_at
                    : undefined,
        };
    });

    ipcMain.handle('window:set-theme', (_, theme: unknown, isDark: unknown) => {
        if (theme === 'system' || theme === 'light' || theme === 'dark') {
            nativeTheme.themeSource = theme;
        }
        const dark =
            typeof isDark === 'boolean'
                ? isDark
                : nativeTheme.shouldUseDarkColors;
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (process.platform === 'linux') {
                mainWindow.setBackgroundColor(dark ? '#11141c' : '#f4f6fa');
            }
            if (process.platform === 'win32') {
                mainWindow.setTitleBarOverlay(getTitleBarOverlay(dark));
            }
        }
        return true;
    });

    // 选择文件夹
    ipcMain.handle('select-folder', async () => {
        try {
            if (!mainWindow) {
                throw new Error('主窗口未初始化');
            }

            const isEn = isEnglishLocale();
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory', 'createDirectory'],
                title: isEn ? 'Select Data Storage Folder' : '选择数据存储位置',
            });

            return result;
        } catch (error) {
            log.error('选择文件夹失败:', error);
            throw error;
        }
    });
}

// 处理未捕获的异常与未处理的 Promise 拒绝
process.on('uncaughtException', (error) => {
    log.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason) => {
    log.error('未处理的 Promise 拒绝:', reason);
});
