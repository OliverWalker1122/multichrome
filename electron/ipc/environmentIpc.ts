import fs from 'fs';
import { screen, shell, type IpcMain } from 'electron';
import log from 'electron-log';
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
    chromeManager: EnvironmentService;
    settingsManager: SettingsManager;
    proxyIntegration: ProxyCoordinator;
}

export function registerEnvironmentIpc({
    ipcMain,
    chromeManager,
    settingsManager,
    proxyIntegration,
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
            return await proxyIntegration.runLaunch(() =>
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
            return await proxyIntegration.run(() =>
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

    ipcMain.handle('tile-chrome-windows', async () => {
        try {
            const workArea = screen.getPrimaryDisplay().workArea;
            return await chromeManager.tileRunningWindows(workArea);
        } catch (error) {
            log.error('排列浏览器窗口失败:', error);
            throw error;
        }
    });
}
