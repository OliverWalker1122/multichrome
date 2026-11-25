import fs from 'fs';
import { BrowserWindow, screen, shell, type IpcMain } from 'electron';
import log from 'electron-log';
import { computeDefaultMainWindowBounds } from '../domain/windowTiling.js';
import type { EnvironmentService } from '../services/environmentService.js';
import type { SettingsManager } from '../repositories/settingsRepository.js';
import type { ProxyCoordinator } from '../services/proxyCoordinator.js';
import {
    sanitizeBatchActionPayload,
    sanitizeBatchCreatePayload,
    sanitizeCreateEnvironmentOptions,
    sanitizeUpdateEnvironmentPayload,
    validateId,
    validateString,
} from './validators.js';

export interface EnvironmentIpcDeps {
    ipcMain: IpcMain;
    getMainWindow?: () => BrowserWindow | null;
    chromeManager: EnvironmentService;
    settingsManager: SettingsManager;
    proxyIntegration: ProxyCoordinator;
    flashWindowHighlight?: (
        bounds: {
            left: number;
            top: number;
            width: number;
            height: number;
            windowState?: string;
        } | null,
        label: string,
    ) => boolean;
}

export function registerEnvironmentIpc({
    ipcMain,
    getMainWindow,
    chromeManager,
    settingsManager,
    proxyIntegration,
    flashWindowHighlight,
}: EnvironmentIpcDeps): void {
    ipcMain.handle('get-chrome-environments', async () => {
        try {
            return await chromeManager.getAllEnvironments();
        } catch (error) {
            log.error('获取Chrome环境失败:', error);
            throw error;
        }
    });

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
                const validOptions = sanitizeCreateEnvironmentOptions(
                    options,
                    settingsManager.getSettings().fingerprint,
                );
                return await chromeManager.createEnvironment(
                    validName,
                    validGroupName,
                    validNotes,
                    validOptions,
                );
            } catch (error) {
                log.error('创建Chrome环境失败:', error);
                throw error;
            }
        },
    );

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

    ipcMain.handle('close-all-chrome-environments', async () => {
        try {
            return await chromeManager.closeAllEnvironments();
        } catch (error) {
            log.error('关闭全部运行环境失败:', error);
            throw error;
        }
    });

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

    ipcMain.handle('get-environment-storage', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await chromeManager.getEnvironmentStorageStats(validId);
        } catch (error) {
            log.error('统计环境磁盘占用失败:', error);
            throw error;
        }
    });

    ipcMain.handle('clear-environment-cache', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await chromeManager.clearEnvironmentCache(validId);
        } catch (error) {
            log.error('清理环境缓存失败:', error);
            throw error;
        }
    });

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

    ipcMain.handle('launch-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            log.info(`收到启动Chrome环境请求，环境ID: ${validId}`);
            return await proxyIntegration.runForProfile(validId, () =>
                chromeManager.launchEnvironment(validId),
            );
        } catch (error) {
            log.error('启动Chrome环境失败:', error);
            throw error;
        }
    });

    ipcMain.handle('close-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await proxyIntegration.runForProfile(validId, () =>
                chromeManager.closeEnvironment(validId),
            );
        } catch (error) {
            log.error('关闭Chrome环境失败:', error);
            throw error;
        }
    });

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

    ipcMain.handle('get-deleted-environments', async () => {
        try {
            return await chromeManager.getDeletedEnvironments();
        } catch (error) {
            log.error('获取回收站环境失败:', error);
            throw error;
        }
    });

    ipcMain.handle('restore-chrome-environment', async (_, id: unknown) => {
        try {
            const validId = validateId(id);
            return await chromeManager.restoreEnvironment(validId);
        } catch (error) {
            log.error('恢复Chrome环境失败:', error);
            throw error;
        }
    });

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

    ipcMain.handle(
        'update-chrome-environment',
        async (_, id: unknown, data: unknown) => {
            try {
                const validId = validateId(id);
                const validData = sanitizeUpdateEnvironmentPayload(
                    data,
                    settingsManager.getSettings().fingerprint,
                );
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

    ipcMain.handle('get-empty-groups', async () => {
        try {
            return await chromeManager.getEmptyGroups();
        } catch (error) {
            log.error('获取空分组失败:', error);
            throw error;
        }
    });

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

    ipcMain.handle('delete-empty-group', async (_, groupName: unknown) => {
        try {
            const validGroupName = validateString(groupName, '分组名称');
            return await chromeManager.deleteEmptyGroup(validGroupName);
        } catch (error) {
            log.error('删除空分组失败:', error);
            throw error;
        }
    });

    ipcMain.handle(
        'batch-create-environments',
        async (_, payload: unknown) => {
            try {
                const validPayload = sanitizeBatchCreatePayload(
                    payload,
                    settingsManager.getSettings().fingerprint,
                );
                return await chromeManager.batchCreateEnvironments(
                    validPayload,
                );
            } catch (error) {
                log.error('批量创建环境失败:', error);
                throw error;
            }
        },
    );

    ipcMain.handle(
        'batch-action-environments',
        async (_, payload: unknown) => {
            try {
                const validPayload = sanitizeBatchActionPayload(payload);
                return await proxyIntegration.run(() =>
                    chromeManager.batchActionEnvironments(validPayload),
                );
            } catch (error) {
                log.error('批量操作环境失败:', error);
                throw error;
            }
        },
    );

    ipcMain.handle(
        'export-environment-cookies',
        async (_, id: unknown, format: unknown = 'json') => {
            try {
                const validId = validateId(id);
                const safeFormat = format === 'netscape' ? 'netscape' : 'json';
                return await chromeManager.exportEnvironmentCookies(
                    validId,
                    safeFormat,
                );
            } catch (error) {
                log.error('导出环境 Cookie 失败:', error);
                throw error;
            }
        },
    );

    ipcMain.handle(
        'import-environment-cookies',
        async (_, id: unknown, rawText: unknown) => {
            try {
                const validId = validateId(id);
                const validText = validateString(rawText, 'Cookie 内容');
                return await chromeManager.importEnvironmentCookies(
                    validId,
                    validText,
                );
            } catch (error) {
                log.error('导入环境 Cookie 失败:', error);
                throw error;
            }
        },
    );

    let isConsoleDocked = false;
    let savedNormalBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null = null;

    const NORMAL_MAIN_MIN_WIDTH = 740;
    const NORMAL_MAIN_MIN_HEIGHT = 540;

    const applyMainWindowBounds = (
        mainWin: BrowserWindow,
        targetBounds: { x: number; y: number; width: number; height: number },
        dockedNarrow = false,
    ) => {
        if (mainWin.isDestroyed()) return;
        if (mainWin.isMinimized()) {
            mainWin.restore();
        }
        if (mainWin.isMaximized()) {
            mainWin.unmaximize();
        }
        if (dockedNarrow) {
            mainWin.setMinimumSize(
                Math.min(380, Math.max(320, targetBounds.width)),
                Math.min(NORMAL_MAIN_MIN_HEIGHT, Math.max(420, targetBounds.height)),
            );
            mainWin.setBounds(targetBounds);
        } else {
            mainWin.setBounds(targetBounds);
            mainWin.setMinimumSize(
                NORMAL_MAIN_MIN_WIDTH,
                NORMAL_MAIN_MIN_HEIGHT,
            );
        }
        mainWin.focus();
    };

    ipcMain.handle(
        'tile-chrome-windows',
        async (_, rawOptions: unknown = undefined) => {
            try {
                const mainWin =
                    (getMainWindow ? getMainWindow() : null) ||
                    BrowserWindow.getAllWindows().find(
                        (win) => !win.isDestroyed() && win.isFocusable(),
                    ) ||
                    null;
                const display = mainWin
                    ? screen.getDisplayMatching(mainWin.getBounds())
                    : screen.getPrimaryDisplay();
                const workArea = display.workArea;

                const opts =
                    rawOptions && typeof rawOptions === 'object'
                        ? (rawOptions as {
                              mode?: unknown;
                              envIds?: unknown;
                          })
                        : {};
                const mode =
                    typeof opts.mode === 'string' ? opts.mode : 'grid';

                if (mode === 'reset-app-window') {
                    const defaultBounds =
                        computeDefaultMainWindowBounds(workArea);
                    if (mainWin) {
                        applyMainWindowBounds(mainWin, defaultBounds, false);
                    }
                    isConsoleDocked = false;
                    savedNormalBounds = null;
                    return {
                        mode: 'reset-app-window',
                        tiledCount: 0,
                        consoleBounds: defaultBounds,
                        consoleDocked: false,
                    };
                }

                const envIds = Array.isArray(opts.envIds)
                    ? opts.envIds
                          .filter(
                              (item): item is string =>
                                  typeof item === 'string' &&
                                  item.trim().length > 0,
                          )
                          .map((item) => validateId(item))
                    : undefined;

                const res = await chromeManager.arrangeRunningWindows(workArea, {
                    mode,
                    envIds,
                });

                if (res.consoleBounds && mainWin && !mainWin.isDestroyed()) {
                    if (!isConsoleDocked && !mainWin.isMaximized()) {
                        savedNormalBounds = mainWin.getBounds();
                    }
                    applyMainWindowBounds(mainWin, res.consoleBounds, true);
                    isConsoleDocked = true;
                } else if (
                    isConsoleDocked &&
                    mainWin &&
                    !mainWin.isDestroyed() &&
                    (mode === 'grid' || mode === 'stack' || mode === 'cascade')
                ) {
                    const fallbackBounds =
                        savedNormalBounds ||
                        computeDefaultMainWindowBounds(workArea);
                    applyMainWindowBounds(mainWin, fallbackBounds, false);
                    isConsoleDocked = false;
                    savedNormalBounds = null;
                }

                return {
                    ...res,
                    consoleDocked: isConsoleDocked,
                };
            } catch (error) {
                log.error('排列浏览器窗口失败:', error);
                throw error;
            }
        },
    );

    ipcMain.handle(
        'focus-chrome-environment-window',
        async (_, id: unknown, rawOptions: unknown = undefined) => {
            try {
                const validId = validateId(id);
                const highlightOnly = Boolean(
                    rawOptions &&
                        typeof rawOptions === 'object' &&
                        (rawOptions as { highlightOnly?: unknown })
                            .highlightOnly === true,
                );
                const result = await chromeManager.focusEnvironmentWindow(
                    validId,
                    { highlightOnly },
                );
                if (result.bounds && flashWindowHighlight) {
                    flashWindowHighlight(result.bounds, result.label);
                }
                return result.focused;
            } catch (error) {
                log.error('定位浏览器窗口失败:', error);
                throw error;
            }
        },
    );
}
