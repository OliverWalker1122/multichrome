import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    powerMonitor,
    safeStorage,
} from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from 'electron-log';
import Store from 'electron-store';
import { createApplicationLogBuffer } from './app/applicationLogs.js';
import { TrayManager } from './app/trayManager.js';
import {
    getTitleBarOverlay,
    MainWindowManager,
} from './app/windowManager.js';
import { registerAllIpcHandlers } from './ipc/index.js';
import { AutomationConfigRepository } from './repositories/automationConfigRepository.js';
import { ProxyRepository } from './repositories/proxyRepository.js';
import { SettingsRepository } from './repositories/settingsRepository.js';
import {
    AutomationService,
    createAutomationBackend,
    resolveStdioBridgePath,
} from './services/automationService.js';
import { EnvironmentService } from './services/environmentService.js';
import { KernelService } from './services/kernelService.js';
import { ProxyCoordinator } from './services/proxyCoordinator.js';
import { ProxyService } from './services/proxyService.js';
import { AutomationServer } from './transport/automationServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow E2E tests to isolate userData so real user profiles/databases are never touched.
if (process.env.MULTICHROME_USER_DATA) {
    fs.mkdirSync(process.env.MULTICHROME_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.MULTICHROME_USER_DATA);
}

// Only one process may own the stored proxy configuration and local listeners.
if (!app.requestSingleInstanceLock()) {
    process.exit(0);
}

if (process.platform === 'win32') {
    app.setAppUserModelId(
        app.isPackaged ? 'com.multichrome.app' : 'com.multichrome.app.dev',
    );
}

log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
const applicationLogs = createApplicationLogBuffer();
applicationLogs.attach(log);
log.info('Application starting...');

const isDev = process.env.NODE_ENV === 'development';
log.info('Development mode:', isDev);

let quitReady = false;
let checkingQuit = false;

// ---------------------------------------------------------------------------
// Layer 1: Repositories
// ---------------------------------------------------------------------------
const settingsRepository = new SettingsRepository();

function isEnglishLocale(): boolean {
    try {
        return settingsRepository.getSettings().locale !== 'zh-CN';
    } catch {
        return true;
    }
}

const proxyRepository = new ProxyRepository({
    store: new Store({ name: 'managed-proxies' }),
    secretStorage: safeStorage,
    configDirectory: app.getPath('userData'),
});

const automationConfigRepository = new AutomationConfigRepository({
    store: new Store({ name: 'automation-settings' }),
    getLocale: () => settingsRepository.getSettings().locale || 'en-US',
});

// ---------------------------------------------------------------------------
// Layer 2: Application Services
// ---------------------------------------------------------------------------
const kernelService = new KernelService({
    getDataPath: () =>
        settingsRepository.getSettings().dataPath || app.getPath('userData'),
    logger: log,
});

const proxyService = new ProxyService({
    repository: proxyRepository,
    resolveBinary: () => {
        const active = kernelService.getActiveSingbox();
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
    getLocale: () => settingsRepository.getSettings().locale || 'en-US',
});

const environmentService = new EnvironmentService(
    proxyService,
    settingsRepository,
    kernelService,
);

const proxyCoordinator = new ProxyCoordinator({
    proxyManager: proxyService,
    chromeManager: environmentService,
});

// ---------------------------------------------------------------------------
// Layer 3: Host Shell & Transport Adapters
// ---------------------------------------------------------------------------
const trayManager = new TrayManager({
    isEnglishLocale,
    onShowWindow: () => windowManager.showOrRestore(),
    onCloseAllAndQuit: () => {
        void performGracefulQuit(true);
    },
});

const windowManager = new MainWindowManager({
    electronRootDir: __dirname,
    isDev,
    settingsRepository,
    isEnglishLocale,
    getRunningSummary: () => environmentService.getRunningEnvironmentSummary(),
    hasRunningProxyProfiles: () => proxyCoordinator.hasRunningProfiles(),
    onMinimizeToTray: () => trayManager.ensure(),
    onConfirmCloseAllAndQuit: () => performGracefulQuit(true),
    isQuitReady: () => quitReady,
    isCheckingQuit: () => checkingQuit,
    setCheckingQuit: (val) => {
        checkingQuit = val;
    },
});

const unsubscribeEnvStatus = environmentService.subscribeStatusChange(() => {
    windowManager.send('chrome-status-changed');
});

let proxyNotifyTimer: NodeJS.Timeout | null = null;
let pendingProxyNotifyState = false;
let pendingProxyNotifyLog = false;

const unsubscribeProxyChanges = proxyService.subscribe(
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
            windowManager.send('proxy-state-changed', payload);
        }, 150);
    },
);

const automationAppVersion = app.getVersion();
const buildAutomationBackend = createAutomationBackend as unknown as (options: {
    chromeManager: EnvironmentService;
    proxyManager: ProxyService;
    proxyIntegration: ProxyCoordinator;
    kernelManager: KernelService;
    appVersion: string;
}) => ReturnType<typeof createAutomationBackend>;

const automationBackend = buildAutomationBackend({
    chromeManager: environmentService,
    proxyManager: proxyService,
    proxyIntegration: proxyCoordinator,
    kernelManager: kernelService,
    appVersion: automationAppVersion,
});

const automationServer = new AutomationServer({
    backend: automationBackend,
    serverVersion: automationAppVersion,
    logger: log,
});

const automationService = new AutomationService({
    configManager: automationConfigRepository,
    server: automationServer,
    stdioBridgePath: resolveStdioBridgePath(
        app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked')
            : app.getAppPath(),
    ),
    onStateChange: (status: unknown) => {
        windowManager.send('automation-state-changed', status);
    },
    logger: log,
});

// ---------------------------------------------------------------------------
// Layer 4: Application Lifecycle & Graceful Shutdown
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
    windowManager.showOrRestore();
});

app.whenReady().then(() => {
    windowManager.create();

    registerAllIpcHandlers({
        ipcMain,
        getMainWindow: () => windowManager.getWindow(),
        environmentService,
        proxyService,
        proxyCoordinator,
        kernelService,
        settingsRepository,
        automationService,
        applicationLogs,
        isEnglishLocale,
        onSettingsSaved: () => trayManager.updateMenu(),
        getTitleBarOverlay,
    });

    const automationCfg = automationConfigRepository.getConfig();
    if (automationCfg.localApiEnabled || automationCfg.mcpEnabled) {
        void automationService
            .init()
            .then(() => {
                automationService.emitStateChange();
            })
            .catch((err) => {
                log.warn('[Automation] 本地自动化控制面初始化异常:', err);
            });
    }

    powerMonitor.on('resume', () => {
        log.info(
            '检测到系统从休眠恢复，将在下次启动时自动重建空闲 sing-box 通道',
        );
        proxyService.markAllStale('system-resume');
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            windowManager.create();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

async function performGracefulQuit(
    closeAllEnvironmentsFirst = false,
): Promise<void> {
    if (quitReady || checkingQuit) return;
    checkingQuit = true;
    proxyCoordinator.closing = true;
    try {
        await proxyCoordinator.pending;
        if (closeAllEnvironmentsFirst) {
            await environmentService.closeAllEnvironments();
        } else {
            const summary = environmentService.getRunningEnvironmentSummary();
            const hasProxyProfiles =
                await proxyCoordinator.hasRunningProfiles();
            if (summary.count > 0 || hasProxyProfiles) {
                const isEn = isEnglishLocale();
                const countLabel =
                    summary.count > 0
                        ? `${summary.count} 个`
                        : '正在使用内置代理的';
                const currentWin = windowManager.getWindow();
                const parentWin =
                    currentWin && !currentWin.isDestroyed()
                        ? currentWin
                        : undefined;
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
                    trayManager.ensure();
                    windowManager.hide();
                    return;
                }
                if (result.response === 1) {
                    await environmentService.closeAllEnvironments();
                } else {
                    windowManager.showOrRestore();
                    return;
                }
            }
        }

        await automationService.shutdown();
        await proxyCoordinator.shutdown();
        unsubscribeEnvStatus();
        unsubscribeProxyChanges();
        if (proxyNotifyTimer) {
            clearTimeout(proxyNotifyTimer);
            proxyNotifyTimer = null;
        }
        environmentService.stopStatusMonitoring();
        environmentService.closeDatabase();
        trayManager.destroy();
        quitReady = true;
        app.quit();
    } catch {
        log.error('关闭内置代理失败，请重试退出');
        windowManager.showOrRestore();
        const isEn = isEnglishLocale();
        dialog.showErrorBox(
            isEn ? 'Unable to Quit Right Now' : '暂时无法退出',
            isEn
                ? 'Unable to verify browser state or stop the built-in proxy. MultiChrome will keep running; please try quitting again.'
                : '无法确认浏览器状态或关闭内置代理，程序已继续运行，请重试。',
        );
    } finally {
        checkingQuit = false;
        if (!quitReady) proxyCoordinator.closing = false;
    }
}

app.on('before-quit', (event) => {
    if (quitReady) return;
    event.preventDefault();
    void performGracefulQuit(false);
});

process.on('uncaughtException', (error) => {
    log.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason) => {
    log.error('未处理的 Promise 拒绝:', reason);
});
