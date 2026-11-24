import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import {
    EnvironmentRepository,
    type ChromeEnvironment,
    type DeleteGroupOptions,
    type DeleteGroupResult,
    type FingerprintConfig,
    type RenameGroupResult,
} from '../repositories/environmentRepository.js';
import {
    SettingsManager,
    type BrowserEngineType,
} from '../repositories/settingsRepository.js';
import { clearProfileCache, inspectProfileStorage } from '../drivers/profileStorage.js';
import { isProfileRunningLocally } from '../drivers/profileLock.js';
import { findSystemChromeExecutable } from '../drivers/chromeDiscovery.js';
import { parseProxyAddress } from '../drivers/proxyProbeClient.js';
import {
    generateFingerprintConfig,
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
    normalizeFingerprintConfig,
} from '../domain/fingerprintProfile.js';
import { normalizeEnvironmentTags } from '../domain/environmentTags.js';
import { evaluateLaunchConsistency } from '../domain/launchGuard.js';
import { evaluateEnvironmentHealth } from '../domain/healthCheck.js';
import {
    removeGroupStartupUrl,
    renameGroupStartupUrl,
} from '../domain/profileTemplatePolicy.js';
import {
    BrowserLaunchService,
    type ProxyExitInfo,
    type RunningEnvironmentRecord,
} from './browserLaunchService.js';
import { KernelManager, type KernelService } from './kernelService.js';
import type { ProxyService } from './proxyService.js';

export type {
    ChromeEnvironment,
    DeleteGroupOptions,
    DeleteGroupResult,
    FingerprintConfig,
    RenameGroupResult,
};

interface ManagedProxyRecord {
    id: string;
    name?: string;
    status?: string;
    localAddress?: string;
    exitInfo?: {
        status?: string;
        ip?: string;
        countryCode?: string;
    };
}

/**
 * Environment Application Service (Layer 2).
 *
 * Orchestrates `EnvironmentRepository` (SQLite persistence), `BrowserLaunchService`
 * (process & CDP lifecycle), `SettingsRepository`, `KernelService`, and `ProxyService`.
 * Zero `electron` (`BrowserWindow` / `ipcMain`), zero raw SQLite queries.
 */
export class EnvironmentService {
    public readonly repository: EnvironmentRepository;
    public readonly launchService: BrowserLaunchService;
    private readonly environmentsDataDir: string;
    private readonly settingsManager: SettingsManager;
    private readonly kernelManager: KernelService;
    private readonly proxyManager: ProxyService;

    constructor(
        proxyManager: ProxyService,
        settingsManager?: SettingsManager,
        kernelManager?: KernelService,
        options?: {
            repository?: EnvironmentRepository;
            launchService?: BrowserLaunchService;
            appDataPath?: string;
        },
    ) {
        this.proxyManager = proxyManager;
        this.settingsManager = settingsManager || new SettingsManager();
        const appDataPath =
            options?.appDataPath ||
            this.settingsManager.getSettings().dataPath;
        log.info(`App data path: ${appDataPath}`);

        this.kernelManager =
            kernelManager ||
            new KernelManager({
                getDataPath: () =>
                    this.settingsManager.getSettings().dataPath || appDataPath,
                logger: log,
            });

        this.environmentsDataDir = path.join(appDataPath, 'environments');
        if (!fs.existsSync(this.environmentsDataDir)) {
            fs.mkdirSync(this.environmentsDataDir, { recursive: true });
        }

        this.repository =
            options?.repository ||
            new EnvironmentRepository({
                appDataPath,
                defaultChromeExecutable: findSystemChromeExecutable(),
            });

        this.launchService =
            options?.launchService ||
            new BrowserLaunchService({
                repository: this.repository,
                proxyService: this.proxyManager,
                settingsRepository: this.settingsManager,
                kernelService: this.kernelManager,
            });

        log.info('EnvironmentService initialized');
    }

    public get runningProcesses(): Map<string, RunningEnvironmentRecord> {
        return this.launchService.runningProcesses;
    }

    public subscribeStatusChange(listener: () => void): () => void {
        return this.launchService.subscribeStatusChange(listener);
    }

    public stopStatusMonitoring(): void {
        this.launchService.stopStatusMonitoring();
    }

    public closeDatabase(): void {
        this.repository.close();
    }

    public getSystemChromePath(): string {
        return this.launchService.getSystemChromePath();
    }

    public async getAllEnvironments(): Promise<ChromeEnvironment[]> {
        try {
            return this.repository.findAllActive((id) =>
                this.launchService.isRunning(id),
            );
        } catch (error) {
            log.error('获取所有环境失败:', error);
            throw error;
        }
    }

    public async getDeletedEnvironments(): Promise<ChromeEnvironment[]> {
        try {
            return this.repository.findAllDeleted();
        } catch (error) {
            log.error('获取已删除环境失败:', error);
            throw error;
        }
    }

    public async createEnvironment(
        name: string,
        groupName: string,
        notes = '',
        options?: {
            browserEngine?: BrowserEngineType;
            fingerprintConfig?: Partial<FingerprintConfig>;
            proxyId?: string;
            proxy?: string;
            proxyLabel?: string;
            tags?: string[];
        },
    ): Promise<ChromeEnvironment> {
        try {
            const id = uuidv4();
            const envId = id.substring(0, 8);
            const dataDir = path.join(this.environmentsDataDir, envId);
            fs.mkdirSync(dataDir, { recursive: true });

            const now = new Date().toISOString();
            const fpDefaults = normalizeDefaultFingerprintSettings(
                this.settingsManager.getSettings().fingerprint,
            );
            const hasActiveKernel = Boolean(
                this.kernelManager.getActiveKernel(),
            );
            const requestedEngine = options?.browserEngine
                ? (normalizeBrowserEngine(
                      options.browserEngine,
                  ) as BrowserEngineType)
                : fpDefaults.defaultEngine === 'fingerprint-chromium' &&
                    hasActiveKernel
                  ? 'fingerprint-chromium'
                  : 'system-chrome';

            const fingerprintConfig = options?.fingerprintConfig
                ? (normalizeFingerprintConfig(
                      options.fingerprintConfig,
                      fpDefaults,
                  ) as FingerprintConfig)
                : (generateFingerprintConfig(fpDefaults) as FingerprintConfig);

            const proxyId = options?.proxyId?.trim() || undefined;
            const proxy = !proxyId
                ? options?.proxy?.trim() || undefined
                : undefined;
            const proxyLabel = !proxyId
                ? options?.proxyLabel?.trim() || undefined
                : undefined;

            const env: ChromeEnvironment = {
                id,
                name,
                groupName,
                notes,
                dataDir,
                tags: normalizeEnvironmentTags(options?.tags),
                proxy,
                proxyId,
                proxyLabel,
                browserEngine: requestedEngine,
                fingerprintConfig,
                createdAt: now,
                lastUsed: now,
                isRunning: false,
            };

            this.repository.insert(env);
            log.info(
                `创建新环境: ${name} (${id}), 引擎=${env.browserEngine}, 指纹种子=${env.fingerprintConfig?.seed}`,
            );
            return env;
        } catch (error) {
            log.error('创建环境失败:', error);
            throw error;
        }
    }

    public async cloneEnvironment(
        sourceId: string,
        customName?: string,
    ): Promise<ChromeEnvironment> {
        try {
            const source = this.repository.findActiveById(sourceId, false);
            if (!source) {
                throw new Error('源环境不存在或已移入回收站');
            }

            const id = uuidv4();
            const envId = id.substring(0, 8);
            const dataDir = path.join(this.environmentsDataDir, envId);
            fs.mkdirSync(dataDir, { recursive: true });

            const now = new Date().toISOString();
            const fpDefaults = normalizeDefaultFingerprintSettings(
                this.settingsManager.getSettings().fingerprint,
            );
            const freshFp = generateFingerprintConfig({
                ...fpDefaults,
                platform:
                    source.fingerprintConfig?.platform || fpDefaults.platform,
                brand: source.fingerprintConfig?.brand || fpDefaults.brand,
                spoofing:
                    source.fingerprintConfig?.spoofing || fpDefaults.spoofing,
            }) as FingerprintConfig;

            const name = customName?.trim() || `${source.name} - 副本`;
            const cloned: ChromeEnvironment = {
                id,
                name,
                groupName: source.groupName,
                notes: source.notes || '',
                dataDir,
                tags: [...source.tags],
                proxy: source.proxy,
                proxyId: source.proxyId,
                proxyLabel: source.proxyLabel,
                userAgent: source.userAgent,
                timezone: source.timezone,
                language: source.language,
                startupUrl: source.startupUrl,
                browserEngine: source.browserEngine || 'system-chrome',
                fingerprintConfig: freshFp,
                createdAt: now,
                lastUsed: now,
                isRunning: false,
            };

            this.repository.insert(cloned);
            log.info(
                `克隆环境: ${source.name} -> ${cloned.name} (${cloned.id}), 新指纹种子=${cloned.fingerprintConfig?.seed}`,
            );
            return cloned;
        } catch (error) {
            log.error('克隆环境失败:', error);
            throw error;
        }
    }

    public async checkLaunchConsistency(
        id: string,
    ): Promise<ReturnType<typeof evaluateLaunchConsistency>> {
        const env = this.repository.findActiveById(
            id,
            this.launchService.isRunning(id),
        );
        if (!env) {
            throw new Error('环境不存在');
        }
        const settings = this.settingsManager.getSettings();
        const hasFingerprintKernel = Boolean(
            this.kernelManager?.getActiveKernel(),
        );

        let managedProxy: ManagedProxyRecord | null = null;
        if (env.proxyId && this.proxyManager) {
            managedProxy =
                (this.proxyManager.list() as ManagedProxyRecord[]).find(
                    (item) => item.id === env.proxyId,
                ) || null;
        }

        let proxyAddress: string | undefined;
        if (managedProxy?.localAddress) {
            proxyAddress = managedProxy.localAddress;
        } else if (!env.proxyId) {
            if (env.proxy?.trim()) {
                proxyAddress = env.proxy.trim();
            } else if (
                settings.globalProxy?.enabled &&
                settings.globalProxy.address
            ) {
                proxyAddress = settings.globalProxy.address;
            }
        }

        let exitInfo: ProxyExitInfo | null = null;
        if (
            managedProxy?.exitInfo?.status === 'ready' &&
            managedProxy.exitInfo.ip
        ) {
            exitInfo = {
                ip: managedProxy.exitInfo.ip,
                countryCode: managedProxy.exitInfo.countryCode,
            };
        }

        if (proxyAddress) {
            const parsed = parseProxyAddress(proxyAddress);
            if (parsed) {
                const cacheKey = `${parsed.protocol}//${parsed.host}:${parsed.port}`;
                const cached = this.launchService.getCachedProxyGeo(cacheKey);
                if (cached && cached.expiresAt > Date.now()) {
                    exitInfo = {
                        ...(exitInfo || {}),
                        ...cached.info,
                    };
                } else if (
                    (env.timezone?.trim() ||
                        (env.language?.trim() &&
                            env.language.trim().toLowerCase() !== 'auto')) &&
                    (!exitInfo?.timezone || !exitInfo?.countryCode)
                ) {
                    try {
                        const probed = await Promise.race([
                            this.launchService.resolveProxyExitInfoBeforeLaunch(
                                proxyAddress,
                                { needTimezone: true },
                            ),
                            new Promise<null>((resolve) =>
                                setTimeout(() => resolve(null), 1800),
                            ),
                        ]);
                        if (probed) {
                            exitInfo = {
                                ...(exitInfo || {}),
                                ...probed,
                            };
                        }
                    } catch {
                        // probe timeout does not block launch
                    }
                }
            }
        }

        return evaluateLaunchConsistency({
            env,
            proxy: managedProxy,
            exitInfo,
            hasFingerprintKernel,
            locale: settings.locale || 'zh-CN',
        });
    }

    public async inspectEnvironmentHealth(
        id: string,
    ): Promise<ReturnType<typeof evaluateEnvironmentHealth>> {
        const env = this.repository.findActiveById(
            id,
            this.launchService.isRunning(id),
        );
        if (!env) {
            throw new Error('环境不存在');
        }
        const settings = this.settingsManager.getSettings();
        const fpDefaults = normalizeDefaultFingerprintSettings(
            settings.fingerprint,
        );
        const hasFingerprintKernel = Boolean(
            this.kernelManager?.getActiveKernel(),
        );

        let managedProxy: ManagedProxyRecord | null = null;
        let proxyAddress = '';
        if (env.proxyId && this.proxyManager) {
            managedProxy =
                (this.proxyManager.list() as ManagedProxyRecord[]).find(
                    (item) => item.id === env.proxyId,
                ) || null;
            if (managedProxy) {
                try {
                    proxyAddress =
                        await this.launchService.ensureManagedProxyReady(
                            env.proxyId,
                            id,
                        );
                } catch (err) {
                    log.warn(
                        `健康自检按需启动或重建内置代理失败 (${managedProxy.name}):`,
                        err,
                    );
                }
                managedProxy =
                    (this.proxyManager.list() as ManagedProxyRecord[]).find(
                        (item) => item.id === env.proxyId,
                    ) || managedProxy;
            }
        }

        if (!proxyAddress && managedProxy?.localAddress) {
            proxyAddress = managedProxy.localAddress;
        } else if (!env.proxyId) {
            if (env.proxy?.trim()) {
                proxyAddress = env.proxy.trim();
            } else if (
                settings.globalProxy?.enabled &&
                settings.globalProxy.address
            ) {
                proxyAddress = settings.globalProxy.address;
            }
        }

        let exitInfo: ProxyExitInfo | null = null;
        if (
            managedProxy?.exitInfo?.status === 'ready' &&
            managedProxy.exitInfo.ip
        ) {
            exitInfo = {
                ip: managedProxy.exitInfo.ip,
                countryCode: managedProxy.exitInfo.countryCode,
            };
        }

        if (proxyAddress) {
            try {
                const probed = await Promise.race([
                    this.launchService.resolveProxyExitInfoBeforeLaunch(
                        proxyAddress,
                        { needTimezone: true, bypassCache: true },
                    ),
                    new Promise<null>((resolve) =>
                        setTimeout(() => resolve(null), 8000),
                    ),
                ]);
                if (probed) {
                    exitInfo = {
                        ...(exitInfo || {}),
                        ...probed,
                    };
                }
            } catch {
                // keep existing info
            }
        }

        let prefsSnapshot: Record<string, unknown> | null = null;
        try {
            const prefPath = path.join(env.dataDir, 'Default', 'Preferences');
            if (fs.existsSync(prefPath)) {
                prefsSnapshot = JSON.parse(
                    fs.readFileSync(prefPath, 'utf-8'),
                ) as Record<string, unknown>;
            }
        } catch {
            prefsSnapshot = null;
        }

        return evaluateEnvironmentHealth({
            env,
            proxy: managedProxy,
            proxyAddress,
            exitInfo,
            fpDefaults,
            hasFingerprintKernel,
            prefsSnapshot,
            locale: settings.locale || 'zh-CN',
        });
    }

    public getRunningResourceStats() {
        return this.launchService.getRunningResourceStats();
    }

    public openUrlInEnvironment(id: string, url: string): Promise<boolean> {
        return this.launchService.openUrlInEnvironment(id, url);
    }

    public async regenerateFingerprint(id: string): Promise<ChromeEnvironment> {
        if (this.launchService.isRunning(id)) {
            throw new Error('环境正在运行，请先关闭后再重新生成指纹');
        }
        const fpDefaults = normalizeDefaultFingerprintSettings(
            this.settingsManager.getSettings().fingerprint,
        );
        const nextFp = generateFingerprintConfig(
            fpDefaults,
        ) as FingerprintConfig;
        return this.updateEnvironment(id, { fingerprintConfig: nextFp });
    }

    public launchEnvironment(id: string): Promise<boolean> {
        return this.launchService.launchEnvironment(id);
    }

    public getAutomationConnectionInfo(id: string) {
        return this.launchService.getAutomationConnectionInfo(id);
    }

    public launchEnvironmentForAutomation(id: string, timeoutMs = 15000) {
        return this.launchService.launchEnvironmentForAutomation(id, timeoutMs);
    }

    public closeEnvironment(id: string): Promise<boolean> {
        return this.launchService.closeEnvironment(id);
    }

    public closeAllEnvironments() {
        return this.launchService.closeAllEnvironments();
    }

    public getRunningEnvironmentSummary(): {
        count: number;
        ids: string[];
        names: string[];
    } {
        const ids = this.launchService.getRunningIds();
        if (ids.length === 0) {
            return { count: 0, ids: [], names: [] };
        }
        const nameMap = this.repository.findNamesByIds(ids);
        const names = ids.map((id) => nameMap.get(id) || id.substring(0, 8));
        return { count: ids.length, ids, names };
    }

    public getEnvironmentDataDir(id: string): string {
        return this.repository.findDataDirById(id);
    }

    public async getEnvironmentStorageStats(id: string): Promise<{
        exists: boolean;
        totalBytes: number;
        cacheBytes: number;
    }> {
        const dataDir = this.getEnvironmentDataDir(id);
        return inspectProfileStorage(dataDir);
    }

    public async clearEnvironmentCache(id: string): Promise<{
        freedBytes: number;
        removedCount: number;
        afterTotalBytes: number;
        afterCacheBytes: number;
    }> {
        const dataDir = this.getEnvironmentDataDir(id);
        if (this.launchService.isRunning(id)) {
            throw new Error('环境正在运行，请先关闭浏览器后再清理缓存');
        }
        const local = await isProfileRunningLocally(dataDir);
        if (local.running) {
            throw new Error('检测到该环境浏览器仍在运行，请先关闭后再清理缓存');
        }
        const result = await clearProfileCache(dataDir);
        log.info(
            `已清理环境缓存 (${id.substring(0, 8)}): 释放 ${result.freedBytes} 字节，清理目录数=${result.removedCount}`,
        );
        return result;
    }

    public async deleteEnvironment(id: string): Promise<boolean> {
        try {
            if (this.launchService.isRunning(id)) {
                await this.closeEnvironment(id);
            }
            const res = this.repository.softDelete(id);
            if (!res.deleted) {
                log.error(`尝试删除不存在或已删除的环境: ${id}`);
                return false;
            }
            log.info(`软删除Chrome环境: ${res.name} (${id})`);
            return true;
        } catch (error) {
            log.error('软删除环境失败:', error);
            throw error;
        }
    }

    public async restoreEnvironment(id: string): Promise<boolean> {
        try {
            const res = this.repository.restore(id);
            if (!res.restored) {
                log.error(`尝试恢复不存在或未删除的环境: ${id}`);
                return false;
            }
            log.info(`恢复Chrome环境: ${res.name} (${id})`);
            return true;
        } catch (error) {
            log.error('恢复环境失败:', error);
            throw error;
        }
    }

    public async permanentlyDeleteEnvironment(id: string): Promise<boolean> {
        try {
            const env = this.repository.hardDeleteDeleted(id);
            if (!env) {
                log.error(`尝试永久删除不存在或未删除的环境: ${id}`);
                return false;
            }
            if (fs.existsSync(env.dataDir)) {
                fs.rmSync(env.dataDir, { recursive: true, force: true });
            }
            log.info(`永久删除Chrome环境: ${env.name} (${id})`);
            return true;
        } catch (error) {
            log.error('永久删除环境失败:', error);
            throw error;
        }
    }

    public async cleanupTrash(): Promise<number> {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const cutoffDate = thirtyDaysAgo.toISOString();

            const envs = this.repository.purgeDeletedBefore(cutoffDate);
            let cleanedCount = 0;
            for (const env of envs) {
                if (fs.existsSync(env.dataDir)) {
                    fs.rmSync(env.dataDir, { recursive: true, force: true });
                }
                cleanedCount += 1;
            }
            log.info(`清理回收站: 删除了 ${cleanedCount} 个过期环境`);
            return cleanedCount;
        } catch (error) {
            log.error('清理回收站失败:', error);
            throw error;
        }
    }

    public async updateEnvironment(
        id: string,
        data: Partial<ChromeEnvironment>,
    ): Promise<ChromeEnvironment> {
        try {
            const fpDefaults = normalizeDefaultFingerprintSettings(
                this.settingsManager.getSettings().fingerprint,
            );
            const updated = this.repository.update(
                id,
                data,
                fpDefaults,
                this.launchService.isRunning(id),
            );
            log.info(`更新Chrome环境: ${updated.name} (${id})`);
            return updated;
        } catch (error) {
            log.error('更新环境失败:', error);
            throw error;
        }
    }

    public async getProxyBindings(): Promise<
        Array<{ id: string; proxyId?: string; isRunning: boolean }>
    > {
        const rows = this.repository.findAllProxyRows();
        return Promise.all(
            rows.map(async (row) => {
                if (this.launchService.isRunning(row.id)) {
                    return { id: row.id, proxyId: row.proxyId, isRunning: true };
                }
                const local = row.dataDir
                    ? await isProfileRunningLocally(row.dataDir)
                    : { running: false };
                return {
                    id: row.id,
                    proxyId: row.proxyId,
                    isRunning: local.running,
                };
            }),
        );
    }

    public async renameGroup(
        oldName: string,
        newName: string,
    ): Promise<RenameGroupResult> {
        try {
            const result = this.repository.renameGroup(oldName, newName);
            log.info(
                `重命名分组: ${result.oldName} -> ${result.newName}, 影响环境数=${result.affectedCount}`,
            );
            try {
                const currentSettings = this.settingsManager.getSettings();
                const migrated = renameGroupStartupUrl(
                    currentSettings.groupStartupUrls,
                    result.oldName,
                    result.newName,
                );
                if (migrated.changed) {
                    await this.settingsManager.saveSettings({
                        ...currentSettings,
                        groupStartupUrls: migrated.next,
                    });
                }
            } catch (syncError) {
                log.warn('同步分组启动页配置失败:', syncError);
            }
            return result;
        } catch (error) {
            log.error('重命名分组失败:', error);
            throw error;
        }
    }

    public async deleteGroup(
        groupName: string,
        options?: DeleteGroupOptions,
    ): Promise<DeleteGroupResult> {
        try {
            const result = await this.repository.deleteGroup(
                groupName,
                options,
                async (envId: string) => {
                    if (this.launchService.isRunning(envId)) {
                        await this.closeEnvironment(envId);
                    }
                },
            );
            log.info(
                `删除分组: ${result.groupName}, 方式=${result.action}, 影响环境数=${result.affectedCount}` +
                    (result.targetGroup
                        ? `, 目标分组=${result.targetGroup}`
                        : ''),
            );
            try {
                const currentSettings = this.settingsManager.getSettings();
                const cleaned = removeGroupStartupUrl(
                    currentSettings.groupStartupUrls,
                    result.groupName,
                );
                if (cleaned.changed) {
                    await this.settingsManager.saveSettings({
                        ...currentSettings,
                        groupStartupUrls: cleaned.next,
                    });
                }
            } catch (syncError) {
                log.warn('清理已删除分组启动页配置失败:', syncError);
            }
            return result;
        } catch (error) {
            log.error('删除分组失败:', error);
            throw error;
        }
    }

    public async deleteEmptyGroup(groupName: string): Promise<boolean> {
        return this.repository.isGroupEmpty(groupName);
    }

    public async getEmptyGroups(): Promise<string[]> {
        return this.repository.getEmptyGroups();
    }
}

export { EnvironmentService as ChromeManager };
