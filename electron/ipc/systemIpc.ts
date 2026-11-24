import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    app,
    dialog,
    nativeTheme,
    shell,
    type BrowserWindow,
    type IpcMain,
} from 'electron';
import log from 'electron-log';
import type { EnvironmentService } from '../services/environmentService.js';
import type { SettingsManager } from '../repositories/settingsRepository.js';
import type { KernelService } from '../services/kernelService.js';
import type { ProxyService } from '../services/proxyService.js';
import type { BackupService } from '../services/backupService.js';
import { compareDotVersions } from '../domain/kernelPolicy.js';
import { validateBackupPassword } from '../domain/encryptedBackup.js';
import { buildSanitizedSupportBundle } from '../domain/supportBundle.js';
import {
    parseSha256Sums,
    selectPlatformReleaseAsset,
} from '../domain/updateAssetPolicy.js';
import {
    fetchOfficialGitHubJson,
    fetchOfficialGitHubText,
    openOfficialGitHubStream,
} from '../drivers/githubProxyTransport.js';
import {
    sanitizeAppSettingsPayload,
    validateId,
    validateString,
} from './validators.js';

const APP_REPO_URL = 'https://github.com/OliverWalker1122/multichrome';
const APP_RELEASES_API_URL =
    'https://api.github.com/repos/OliverWalker1122/multichrome/releases/latest';

export interface SystemIpcDeps {
    ipcMain: IpcMain;
    getMainWindow: () => BrowserWindow | null;
    settingsManager: SettingsManager;
    kernelManager: KernelService;
    proxyManager: ProxyService;
    chromeManager: EnvironmentService;
    backupService: BackupService;
    getAutomationStatus: () => {
        enabled?: boolean;
        port?: number;
        running?: boolean;
    };
    applicationLogs: {
        getLogs: () => unknown[];
        clearLogs: () => void;
    };
    isEnglishLocale: () => boolean;
    onSettingsSaved: () => void;
    getTitleBarOverlay: (isDark: boolean) => {
        color: string;
        symbolColor: string;
        height: number;
    };
}

export function registerSystemIpc({
    ipcMain,
    getMainWindow,
    settingsManager,
    kernelManager,
    proxyManager,
    chromeManager,
    backupService,
    getAutomationStatus,
    applicationLogs,
    isEnglishLocale,
    onSettingsSaved,
    getTitleBarOverlay,
}: SystemIpcDeps): void {
    const getKernelStatusPayload = () =>
        kernelManager.getStatus(
            chromeManager.getSystemChromePath(),
            settingsManager.getSettings().locale || 'en-US',
        );

    const resolveDownloadProxy = async (
        options: unknown,
        allowManagedProxyId: boolean,
    ): Promise<string | undefined> => {
        if (options && typeof options === 'object') {
            const raw = options as Record<string, unknown>;
            if (
                allowManagedProxyId &&
                typeof raw.proxyId === 'string' &&
                raw.proxyId.trim()
            ) {
                return proxyManager.ensureStarted(validateId(raw.proxyId));
            }
            if (raw.useGlobalProxy) {
                const gp = settingsManager.getSettings().globalProxy;
                if (gp?.enabled && gp.address) return gp.address;
            }
            return undefined;
        }
        return undefined;
    };

    const sendDownloadProgress = (progress: unknown) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('kernel-download-progress', progress);
        }
    };

    ipcMain.handle('app:logs', () => applicationLogs.getLogs());
    ipcMain.handle('app:clear-logs', () => applicationLogs.clearLogs());

    ipcMain.handle('get-settings', async () => {
        try {
            return settingsManager.getSettings();
        } catch (error) {
            log.error('获取应用设置失败:', error);
            throw error;
        }
    });

    ipcMain.handle('save-settings', async (_, settings: unknown) => {
        try {
            const validSettings = sanitizeAppSettingsPayload(settings);
            const saved = await settingsManager.saveSettings(validSettings);
            if (saved) {
                onSettingsSaved();
            }
            return saved;
        } catch (error) {
            log.error('保存应用设置失败:', error);
            throw error;
        }
    });

    ipcMain.handle('kernels:status', () => getKernelStatusPayload());

    ipcMain.handle(
        'kernels:refresh-releases',
        async (_, options: unknown = undefined) => {
            let proxyAddress: string | undefined;
            if (options !== undefined) {
                proxyAddress = await resolveDownloadProxy(options, true);
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
            const proxyAddress = await resolveDownloadProxy(options, true);
            const installed = await kernelManager.downloadAndInstall(
                validVersion,
                {
                    proxyAddress,
                    onProgress: sendDownloadProgress,
                },
            );
            return {
                installed,
                status: getKernelStatusPayload(),
            };
        },
    );

    ipcMain.handle(
        'kernels:cancel-download',
        (_, target: unknown = 'fingerprint-chromium') =>
            kernelManager.cancelDownload(
                target === 'sing-box' ? 'sing-box' : 'fingerprint-chromium',
            ),
    );

    ipcMain.handle(
        'kernels:refresh-singbox-releases',
        async (_, options: unknown = undefined) => {
            const proxyAddress = await resolveDownloadProxy(options, false);
            await kernelManager.fetchAvailableSingboxReleases(proxyAddress);
            return getKernelStatusPayload();
        },
    );

    ipcMain.handle(
        'kernels:download-singbox',
        async (_, version: unknown, options: unknown = undefined) => {
            const validVersion = validateString(version, 'sing-box 版本号');
            const proxyAddress = await resolveDownloadProxy(options, false);
            const installed = await kernelManager.downloadAndInstallSingbox(
                validVersion,
                {
                    proxyAddress,
                    onProgress: sendDownloadProgress,
                },
            );
            return {
                installed,
                status: getKernelStatusPayload(),
            };
        },
    );

    ipcMain.handle('kernels:import-local-singbox', async () => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            throw new Error('主窗口未初始化');
        }
        const isEn = isEnglishLocale();
        const result = await dialog.showOpenDialog(mainWindow, {
            title: isEn
                ? 'Select official sing-box archive or executable'
                : '选择 sing-box 官方安装包或可执行文件',
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
            const mainWindow = getMainWindow();
            if (!mainWindow) {
                throw new Error('主窗口未初始化');
            }
            const isEn = isEnglishLocale();
            const isFolder = mode === 'folder';
            const platformTitle = isEn
                ? 'Select privacy browser package or executable'
                : '选择防关联浏览器安装包或可执行文件';
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
            !parsed.pathname
                .toLowerCase()
                .startsWith('/oliverwalker1122/multichrome')
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
            if (
                msg.startsWith('HTTP ') ||
                msg.includes('解析版本信息') ||
                msg.includes('代理')
            ) {
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
        const { installer, checksumAsset } = selectPlatformReleaseAsset(
            Array.isArray(payload.assets) ? payload.assets : [],
            process.platform,
            process.arch,
        );
        return {
            currentVersion,
            latestVersion,
            hasUpdate: compareDotVersions(latestVersion, currentVersion) > 0,
            releaseUrl: htmlUrl,
            canDownloadAsset: Boolean(installer && checksumAsset),
            assetName: installer?.name,
            assetSizeBytes: installer?.sizeBytes,
            publishedAt:
                typeof payload.published_at === 'string'
                    ? payload.published_at
                    : undefined,
        };
    });

    ipcMain.handle('app:download-update', async () => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            throw new Error('主窗口未初始化');
        }
        const isEn = isEnglishLocale();
        const currentVersion = app.getVersion();
        const globalProxy = settingsManager.getSettings().globalProxy;
        const proxyAddress =
            globalProxy?.enabled && globalProxy.address?.trim()
                ? globalProxy.address.trim()
                : undefined;

        const payload = (await fetchOfficialGitHubJson(APP_RELEASES_API_URL, {
            proxyAddress,
            timeoutMs: 12000,
            userAgent: `MultiChrome/${currentVersion}`,
        })) as Record<string, unknown>;

        const { installer, checksumAsset } = selectPlatformReleaseAsset(
            Array.isArray(payload.assets) ? payload.assets : [],
            process.platform,
            process.arch,
        );
        if (!installer || !checksumAsset) {
            throw new Error('当前平台暂无可自动校验的官方安装包，请前往 Releases 页面手动下载');
        }

        const sumsText = await fetchOfficialGitHubText(
            checksumAsset.downloadUrl,
            {
                proxyAddress,
                timeoutMs: 15000,
                userAgent: `MultiChrome/${currentVersion}`,
            },
        );
        const expectedSha256 = parseSha256Sums(sumsText, installer.name);

        const saveRes = await dialog.showSaveDialog(mainWindow, {
            title: isEn ? 'Save Official Installer' : '保存官方安装包',
            defaultPath: path.join(app.getPath('downloads'), installer.name),
        });
        if (saveRes.canceled || !saveRes.filePath) {
            return { canceled: true };
        }

        const tempFile = `${saveRes.filePath}.part-${Date.now()}`;
        try {
            const resStream = await openOfficialGitHubStream(
                installer.downloadUrl,
                {
                    proxyAddress,
                    timeoutMs: 60000,
                    userAgent: `MultiChrome/${currentVersion}`,
                },
            );
            const hash = crypto.createHash('sha256');
            const writer = fs.createWriteStream(tempFile);
            await new Promise<void>((resolve, reject) => {
                resStream.on('data', (chunk: Buffer) => {
                    hash.update(chunk);
                });
                resStream.on('error', reject);
                writer.on('error', reject);
                writer.on('finish', resolve);
                resStream.pipe(writer);
            });
            const actualSha256 = hash.digest('hex').toLowerCase();
            if (actualSha256 !== expectedSha256) {
                throw new Error(
                    `安装包 SHA-256 校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${actualSha256.slice(0, 12)}…），已中止安装`,
                );
            }
            fs.renameSync(tempFile, saveRes.filePath);
            shell.showItemInFolder(saveRes.filePath);
            return {
                canceled: false,
                filePath: saveRes.filePath,
                fileName: installer.name,
                sha256: actualSha256,
            };
        } catch (error) {
            try {
                fs.rmSync(tempFile, { force: true });
            } catch {
                /* ignore */
            }
            throw error;
        }
    });

    ipcMain.handle('app:export-diagnostics', async () => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            throw new Error('主窗口未初始化');
        }
        const isEn = isEnglishLocale();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const saveRes = await dialog.showSaveDialog(mainWindow, {
            title: isEn
                ? 'Export Sanitized Diagnostics'
                : '导出脱敏诊断报告',
            defaultPath: path.join(
                app.getPath('downloads'),
                `multichrome-diagnostics-${stamp}.json`,
            ),
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (saveRes.canceled || !saveRes.filePath) {
            return { canceled: true };
        }

        const settings = settingsManager.getSettings();
        const kernelStatus = getKernelStatusPayload();
        const activeKernel = kernelManager.getActiveKernel();
        const activeSingbox = kernelManager.getActiveSingbox();
        const envs = await chromeManager.getAllEnvironments();
        const deleted = await chromeManager.getDeletedEnvironments();
        const proxies = proxyManager.list();

        const bundle = buildSanitizedSupportBundle({
            appVersion: app.getVersion(),
            locale: settings.locale || 'en-US',
            platform: process.platform,
            arch: process.arch,
            osRelease: os.release(),
            electronVersion: process.versions.electron || '',
            chromeVersion: process.versions.chrome || '',
            nodeVersion: process.version,
            dbIntegrity: chromeManager.checkDatabaseIntegrity(),
            activeProfiles: envs.length,
            deletedProfiles: deleted.length,
            runningProfiles: chromeManager.getRunningEnvironmentSummary().count,
            systemChromeAvailable: kernelStatus.systemChromeAvailable,
            activePrivacyKernelVersion: activeKernel?.version || null,
            activeSingboxVersion: activeSingbox?.version || '1.14.4',
            proxies,
            automation: getAutomationStatus(),
            recentLogs: applicationLogs.getLogs(),
        });

        fs.writeFileSync(
            saveRes.filePath,
            JSON.stringify(bundle, null, 2),
            'utf8',
        );
        shell.showItemInFolder(saveRes.filePath);
        return {
            canceled: false,
            filePath: saveRes.filePath,
        };
    });

    ipcMain.handle('backup:export', async (_, password: unknown) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            throw new Error('主窗口未初始化');
        }
        const validPassword = validateBackupPassword(password);
        const isEn = isEnglishLocale();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const saveRes = await dialog.showSaveDialog(mainWindow, {
            title: isEn ? 'Export Encrypted Backup' : '导出加密备份',
            defaultPath: path.join(
                app.getPath('downloads'),
                `multichrome-backup-${stamp}.mcbackup`,
            ),
            filters: [
                {
                    name: isEn
                        ? 'MultiChrome Encrypted Backup'
                        : 'MultiChrome 加密备份',
                    extensions: ['mcbackup'],
                },
            ],
        });
        if (saveRes.canceled || !saveRes.filePath) {
            return { canceled: true };
        }
        const encryptedText = await backupService.exportEncryptedBackup(
            validPassword,
        );
        fs.writeFileSync(saveRes.filePath, encryptedText, 'utf8');
        shell.showItemInFolder(saveRes.filePath);
        return {
            canceled: false,
            filePath: saveRes.filePath,
        };
    });

    ipcMain.handle('backup:restore', async (_, password: unknown) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) {
            throw new Error('主窗口未初始化');
        }
        const validPassword = validateBackupPassword(password);
        const isEn = isEnglishLocale();
        const openRes = await dialog.showOpenDialog(mainWindow, {
            title: isEn ? 'Select Encrypted Backup' : '选择加密备份文件',
            properties: ['openFile'],
            filters: [
                {
                    name: isEn
                        ? 'MultiChrome Encrypted Backup'
                        : 'MultiChrome 加密备份',
                    extensions: ['mcbackup'],
                },
                { name: isEn ? 'All Files' : '所有文件', extensions: ['*'] },
            ],
        });
        if (openRes.canceled || openRes.filePaths.length === 0) {
            return { canceled: true };
        }
        const rawContent = fs.readFileSync(openRes.filePaths[0], 'utf8');
        const summary = await backupService.restoreEncryptedBackup(
            rawContent,
            validPassword,
        );
        onSettingsSaved();
        return {
            canceled: false,
            ...summary,
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
        const mainWindow = getMainWindow();
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

    ipcMain.handle('select-folder', async () => {
        try {
            const mainWindow = getMainWindow();
            if (!mainWindow) {
                throw new Error('主窗口未初始化');
            }
            const isEn = isEnglishLocale();
            return await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory', 'createDirectory'],
                title: isEn ? 'Select Data Storage Folder' : '选择数据存储位置',
            });
        } catch (error) {
            log.error('选择文件夹失败:', error);
            throw error;
        }
    });
}
