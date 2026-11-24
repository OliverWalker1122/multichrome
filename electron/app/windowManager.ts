import path from 'path';
import {
    app,
    BrowserWindow,
    dialog,
    nativeTheme,
    screen,
    shell,
} from 'electron';
import log from 'electron-log';
import { computeDefaultMainWindowBounds } from '../domain/windowTiling.js';
import { parseSafeExternalUrl } from '../drivers/githubProxyTransport.js';
import type { SettingsManager } from '../repositories/settingsRepository.js';

export function getTitleBarOverlay(isDark: boolean) {
    return {
        color: '#00000000',
        symbolColor: isDark ? '#e2e8f0' : '#0f172a',
        height: 40,
    };
}

export interface MainWindowManagerOptions {
    electronRootDir: string;
    isDev: boolean;
    settingsRepository: SettingsManager;
    isEnglishLocale: () => boolean;
    getRunningSummary: () => { count: number; ids: string[]; names: string[] };
    hasRunningProxyProfiles: () => Promise<boolean>;
    onMinimizeToTray: () => void;
    onConfirmCloseAllAndQuit: () => Promise<void>;
    isQuitReady: () => boolean;
    isCheckingQuit: () => boolean;
    setCheckingQuit: (val: boolean) => void;
}

/**
 * Electron Main Window Shell Adapter (Layer 3 Host Shell).
 *
 * Encapsulates `BrowserWindow` creation, Acrylic/Vibrancy materials, CSP headers,
 * safe external link opening, close confirmation dialog, and typed IPC broadcast forwarding.
 */
export class MainWindowManager {
    private mainWindow: BrowserWindow | null = null;

    constructor(private readonly options: MainWindowManagerOptions) {}

    public getWindow(): BrowserWindow | null {
        return this.mainWindow;
    }

    public send(channel: string, payload?: unknown): void {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        if (payload === undefined) {
            this.mainWindow.webContents.send(channel);
        } else {
            this.mainWindow.webContents.send(channel, payload);
        }
    }

    public showOrRestore(): void {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            this.create();
            return;
        }
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.show();
        this.mainWindow.focus();
    }

    public hide(): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.hide();
        }
    }

    private resolveInitialDarkMode(): boolean {
        const theme =
            this.options.settingsRepository.getSettings().theme || 'system';
        if (theme === 'dark') return true;
        if (theme === 'light') return false;
        return nativeTheme.shouldUseDarkColors;
    }

    public create(): BrowserWindow {
        const primaryDisplay = screen.getPrimaryDisplay();
        const defaultBounds = computeDefaultMainWindowBounds(
            primaryDisplay.workArea,
        );
        const isDark = this.resolveInitialDarkMode();
        const savedTheme =
            this.options.settingsRepository.getSettings().theme || 'system';
        nativeTheme.themeSource = savedTheme;

        const win = new BrowserWindow({
            x: defaultBounds.x,
            y: defaultBounds.y,
            width: defaultBounds.width,
            height: defaultBounds.height,
            minWidth: 740,
            minHeight: 540,
            show: false,
            autoHideMenuBar: true,
            frame: true,
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
                preload: path.join(
                    this.options.electronRootDir,
                    'preload.cjs',
                ),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
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

        this.mainWindow = win;

        win.webContents.session.webRequest.onHeadersReceived(
            (details, callback) => {
                callback({
                    responseHeaders: {
                        ...details.responseHeaders,
                        'Content-Security-Policy': [
                            this.options.isDev
                                ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline' http://localhost:5173; img-src 'self' data: http://localhost:5173;"
                                : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
                        ],
                    },
                });
            },
        );

        if (this.options.isDev) {
            const devUrl = 'http://localhost:5173';
            let retryCount = 0;
            win.webContents.on(
                'did-fail-load',
                (_event, errorCode, errorDesc) => {
                    log.warn(`开发页面加载失败 (${errorCode}): ${errorDesc}`);
                    if (
                        retryCount < 20 &&
                        this.mainWindow &&
                        !this.mainWindow.isDestroyed()
                    ) {
                        retryCount += 1;
                        setTimeout(() => {
                            if (
                                this.mainWindow &&
                                !this.mainWindow.isDestroyed()
                            ) {
                                void this.mainWindow.loadURL(devUrl);
                            }
                        }, 500);
                    }
                },
            );
            void win.loadURL(devUrl);
            win.webContents.openDevTools();
        } else {
            win.webContents.on(
                'did-fail-load',
                (_event, errorCode, errorDesc, validatedURL) => {
                    log.error(
                        `页面加载失败 (${errorCode}): ${errorDesc} - ${validatedURL}`,
                    );
                },
            );
            void win.loadFile(
                path.join(
                    this.options.electronRootDir,
                    '../renderer/index.html',
                ),
            );
        }

        win.webContents.on('did-finish-load', () => {
            log.info(
                'Renderer did-finish-load:',
                this.mainWindow?.webContents.getURL(),
            );
            if (this.mainWindow && !this.mainWindow.isVisible()) {
                this.mainWindow.show();
                this.mainWindow.setMenuBarVisibility(false);
            }
        });

        win.webContents.setWindowOpenHandler(({ url }) => {
            const safeUrl = parseSafeExternalUrl(url);
            if (safeUrl) {
                void shell.openExternal(safeUrl);
            } else {
                log.warn('已拦截非安全外部链接打开请求');
            }
            return { action: 'deny' };
        });

        win.once('ready-to-show', () => {
            log.info('MainWindow ready-to-show');
            this.mainWindow?.show();
            this.mainWindow?.setMenuBarVisibility(false);
        });

        win.on('close', (event) => {
            if (this.options.isQuitReady()) return;
            const summary = this.options.getRunningSummary();
            if (summary.count === 0) return;

            event.preventDefault();
            if (this.options.isCheckingQuit()) return;
            this.options.setCheckingQuit(true);
            void (async () => {
                const hasProxyProfiles =
                    await this.options.hasRunningProxyProfiles();
                const isEn = this.options.isEnglishLocale();
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
                    this.mainWindow && !this.mainWindow.isDestroyed()
                        ? this.mainWindow
                        : undefined;
                const boxOptions = {
                    type: 'question' as const,
                    title: isEn ? 'Quit MultiChrome' : '退出 MultiChrome',
                    message: isEn
                        ? `${summary.count} browser environment${summary.count > 1 ? 's are' : ' is'} still running`
                        : `当前仍有 ${summary.count} 个浏览器环境正在运行`,
                    detail: detailLines.join('\n\n'),
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
                    this.options.onMinimizeToTray();
                    this.hide();
                    return;
                }
                if (result.response === 1) {
                    this.options.setCheckingQuit(false);
                    await this.options.onConfirmCloseAllAndQuit();
                }
            })()
                .catch((error) => {
                    log.error('退出前运行态检查失败:', error);
                })
                .finally(() => {
                    if (!this.options.isQuitReady()) {
                        this.options.setCheckingQuit(false);
                    }
                });
        });

        win.on('closed', () => {
            this.mainWindow = null;
        });

        return win;
    }
}
