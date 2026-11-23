import {
    spawn,
    ChildProcess,
    StdioOptions,
    execSync,
    execFile,
} from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import Store from 'electron-store';
import log from 'electron-log';
import { app, BrowserWindow } from 'electron';
import os from 'os';
import net from 'net';
import http from 'http';
import { SettingsManager } from './settingsManager.js';
import { CDPManager } from './cdpManager.js';
import { ProxyManager } from './proxyManager.js';
import {
    buildManagedProxyArgs,
    buildManualProxyArgs,
    applyFailClosedWebRTCPreferences,
} from './managedProxyArgs.js';
import { isProfileRunningLocally } from './profileLock.js';
import {
    buildAcceptLangSwitchValue,
    cleanupLegacyFingerprintExtension,
    createProxyStartupGate,
    rewriteProxyAddressForGate,
    type ProxyStartupGate,
} from './proxyStartupGate.js';
import {
    applyLanguagePreferences,
    resolveEffectiveLanguage,
} from './proxyGeo.js';
import { parseProxyAddress, probeProxyExitInfo } from './proxyProbeClient.js';
import {
    buildFingerprintChromiumArgs,
    generateFingerprintConfig,
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
    normalizeFingerprintConfig,
    parseFingerprintConfigJson,
} from './fingerprintProfile.js';
import { KernelManager } from './kernelManager.js';
import { executeDeleteGroup, executeRenameGroup } from './groupOperations.js';
import { hasSavedChromeSession } from './startupUrl.js';
import { clearProfileCache, inspectProfileStorage } from './profileStorage.js';
import {
    normalizeEnvironmentTags,
    parseStoredEnvironmentTags,
} from './environmentTags.js';
import { evaluateLaunchConsistency } from './launchGuard.js';
import { evaluateEnvironmentHealth } from './healthCheck.js';
import {
    aggregateProcessMemory,
    buildForceKillProcessSpec,
    buildMemorySaverChromiumArgs,
    filterBrowserProcessLines,
    parseUnixPsOutput,
    parseWindowsCimProcessJson,
} from './processMetrics.js';
import {
    removeGroupStartupUrl,
    renameGroupStartupUrl,
    resolveEffectiveStartupUrl,
    resolveExtensionTemplatePaths,
    syncBookmarksToProfile,
} from './profileTemplates.js';
import type {
    BrowserEngineType,
    FingerprintBrand,
    FingerprintPlatform,
    FingerprintSpoofingOptions,
} from './settingsManager.js';

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
    timezone?: string;   // 时区(如"America/Los_Angeles")
    language?: string;   // 语言(如"en-US")
    startupUrl?: string; // 环境级启动页（优先于分组与全局启动页）
    browserEngine?: BrowserEngineType; // 浏览器内核引擎（官方 Chrome / C++ 指纹内核）
    fingerprintConfig?: FingerprintConfig; // 持久化独立指纹配置
    createdAt: string;
    lastUsed: string;
    deletedAt?: string; // 软删除时间戳
    isRunning: boolean;
    processId?: number;
}

// 表示数据库中存储的原始环境结构
interface DBEnvironment {
    id: string;
    name: string;
    groupName: string;
    notes: string;
    dataDir: string;
    tags: string; // 数据库中是JSON字符串
    proxy?: string;
    proxyId?: string;
    proxyLabel?: string; // 代理标签
    userAgent?: string;
    timezone?: string;
    language?: string;
    startupUrl?: string;
    browserEngine?: string;
    fingerprintConfig?: string; // 数据库中是JSON字符串
    createdAt: string;
    lastUsed: string;
    deletedAt?: string;
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

export interface RenameGroupResult {
    oldName: string;
    newName: string;
    affectedCount: number;
}

interface ProxyExitInfo {
    ip: string;
    timezone?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
}

interface RunningEnvironmentRecord {
    envId: string;
    dataDir: string;
    debugPort?: number;
    launchedAt: number;
    proxyId?: string;
    startupGate?: ProxyStartupGate;
}

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

interface ChromePreferencesDoc {
    extensions?: {
        settings?: Record<string, unknown>;
        developer?: {
            developer_mode?: boolean;
        };
    };
    [key: string]: unknown;
}

const ALLOWED_UPDATE_COLUMNS = new Set([
    'name',
    'groupName',
    'notes',
    'tags',
    'proxy',
    'proxyId',
    'proxyLabel',
    'userAgent',
    'timezone',
    'language',
    'startupUrl',
    'browserEngine',
    'fingerprintConfig',
]);

// Chrome管理器类
export class ChromeManager {
    private db: Database.Database;
    private store: Store<{
        chromeExecutablePath: unknown;
    }>;
    private runningProcesses: Map<string, RunningEnvironmentRecord>;
    private launchingEnvironments: Map<string, Promise<boolean>> = new Map();
    private environmentsDataDir: string;
    private settingsManager: SettingsManager;
    private kernelManager: KernelManager;
    private appDataPath: string;
    private statusCheckInterval: NodeJS.Timeout | null = null;
    private mainWindow: BrowserWindow | null = null;
    private isChecking: boolean = false;
    private cdpManager: CDPManager;
    private reservedPorts: Set<number> = new Set(); // 预留的端口集合
    private proxyGeoCache: Map<string, { info: ProxyExitInfo; expiresAt: number }> = new Map();
    private readonly PROXY_IP_CACHE_TTL_MS = 90_000;
    private processScanCache: { ids: string[]; expiresAt: number } | null = null;
    private readonly PROCESS_SCAN_CACHE_TTL_MS = 2500;

    constructor(
        private proxyManager: ProxyManager,
        settingsManager?: SettingsManager,
        kernelManager?: KernelManager,
    ) {
        // 初始化 CDP 管理器
        this.cdpManager = new CDPManager();
        // 复用主进程共享的设置管理器，避免重复实例化和缓存不同步
        this.settingsManager = settingsManager || new SettingsManager();
        
        // 获取应用数据路径
        this.appDataPath = this.settingsManager.getSettings().dataPath || app.getPath('userData');
        log.info(`App data path: ${this.appDataPath}`);
        this.kernelManager =
            kernelManager ||
            new KernelManager({
                getDataPath: () =>
                    this.settingsManager.getSettings().dataPath || this.appDataPath,
                logger: log,
            });
        
        // 初始化存储目录
        this.environmentsDataDir = path.join(this.appDataPath, 'environments');
        log.info(`Environment data directory: ${this.environmentsDataDir}`);
        
        // 确保目录存在
        if (!fs.existsSync(this.environmentsDataDir)) {
            fs.mkdirSync(this.environmentsDataDir, { recursive: true });
        }

        // 初始化数据库（开启 WAL 与忙等待，提升读写并发与崩溃安全性）
        const dbPath = path.join(this.appDataPath, 'chrome-environments.db');
        this.db = new Database(dbPath);
        try {
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('busy_timeout = 5000');
        } catch (pragmaError) {
            log.warn('SQLite WAL 配置跳过:', pragmaError);
        }

        // 初始化存储
        this.store = new Store({
            name: 'config',
            cwd: this.appDataPath,
            schema: {
                chromeExecutablePath: {
                    type: 'string',
                    default: this.findChromeExecutable()
                }
            }
        });

        // 初始化运行进程Map
        this.runningProcesses = new Map();

        // 初始化数据库表
        this.initDatabase();

        // 启动状态检查定时器
        this.startStatusMonitoring();

        log.info('ChromeManager initialized');
    }

    // 设置主窗口引用
    public setMainWindow(window: BrowserWindow): void {
        this.mainWindow = window;
    }

    // 启动状态监控
    private startStatusMonitoring(): void {
        // 使用 CDP 事件驱动 + 轻量级轮询兜底机制
        // CDP WebSocket 断开时会立即通知（< 100ms）
        // 轮询仅用于检测 CDP 连接失败或异常情况
        this.statusCheckInterval = setInterval(() => {
            this.checkProcessStatus();
        }, 300000); // 5分钟轮询兜底
    }

    // 检查进程状态
    private async checkProcessStatus(): Promise<void> {
        // 如果正在检查中，跳过这次检查避免重复
        if (this.isChecking) {
            return;
        }

        // 如果没有运行中的进程，跳过检查
        if (this.runningProcesses.size === 0) {
            return;
        }

        this.isChecking = true;

        try {
            log.debug(`检查进程状态: 当前运行中进程数量=${this.runningProcesses.size}`);

            // 保留查询开始时的快照，避免旧查询删除期间新启动的环境。
            const observedProcesses = new Map(this.runningProcesses);
            const checkedAt = Date.now();
            const runningEnvIds = await this.checkAllChromeProcesses(true);
            
            // 检查哪些环境进程已结束
            const endedIds: string[] = [];
            for (const [id, processInfo] of observedProcesses.entries()) {
                if (this.runningProcesses.get(id) !== processInfo) continue;
                const { dataDir, launchedAt } = processInfo;
                // Chrome 启动器与浏览器进程交接期间，进程列表可能暂时没有记录。
                if (!dataDir || (launchedAt && checkedAt - launchedAt < 30000)) continue;
                
                const envId = path.basename(dataDir);
                const isRunning = runningEnvIds.includes(envId);
                
                if (!isRunning) {
                    endedIds.push(id);
                    log.info(`检测到Chrome环境进程已结束: ID=${id}, DataDir=${dataDir}`);
                } else {
                    log.debug(`Chrome进程正在运行: ID=${id}, DataDir=${dataDir}`);
                }
            }

            // 移除已结束的进程
            endedIds.forEach(id => {
                const endedRecord = this.runningProcesses.get(id);
                if (endedRecord?.proxyId) {
                    this.proxyManager?.touchActivity?.(endedRecord.proxyId);
                }
                this.runningProcesses.delete(id);
            });

            // 如果状态发生变化，通知前端
            if (endedIds.length > 0 && this.mainWindow && !this.mainWindow.isDestroyed()) {
                log.info(`进程状态发生变化，通知前端更新: 变化数量=${endedIds.length}`);
                this.mainWindow.webContents.send('chrome-status-changed');
            }
        } catch (error) {
            log.error('检查进程状态失败:', error);
        } finally {
            this.isChecking = false;
        }
    }

    // 停止状态监控
    public stopStatusMonitoring(): void {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }

        // 关闭所有环境关联的代理启动闸门
        for (const record of this.runningProcesses.values()) {
            if (record.startupGate) {
                void record.startupGate.close();
                record.startupGate = undefined;
            }
        }

        // 清理所有 CDP 连接
        this.cdpManager.cleanup();
    }

    // 优雅关闭 SQLite 数据库连接
    public closeDatabase(): void {
        try {
            if (this.db && this.db.open) {
                this.db.close();
            }
        } catch (error) {
            log.warn('关闭环境数据库失败:', error);
        }
    }

    // 初始化数据库表
    private initDatabase(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        groupName TEXT NOT NULL,
        notes TEXT,
        dataDir TEXT NOT NULL,
        tags TEXT,
        proxy TEXT,
        proxyLabel TEXT,
        userAgent TEXT,
        createdAt TEXT NOT NULL,
        lastUsed TEXT NOT NULL,
        deletedAt TEXT
      );
    `);
        
        // 检查是否需要迁移现有数据
        this.migrateDatabase();

        try {
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_environments_deleted_lastused
                ON environments (deletedAt, lastUsed DESC);
                CREATE INDEX IF NOT EXISTS idx_environments_proxy_id
                ON environments (proxyId);
            `);
        } catch (indexError) {
            log.warn('创建数据库索引跳过:', indexError);
        }
    }
    
    // 数据库迁移
    private migrateDatabase(): void {
        try {
            // 检查表结构信息
            const tableInfo = this.db.prepare("PRAGMA table_info(environments)").all() as Array<{name: string}>;
            if (!tableInfo.some(column => column.name === 'proxyId')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN proxyId TEXT');
            }
            log.info('当前数据库列:', tableInfo.map(col => col.name).join(', '));

            // 检查 deletedAt 列是否存在
            const hasDeletedAt = tableInfo.some(column => column.name === 'deletedAt');
            if (!hasDeletedAt) {
                this.db.exec('ALTER TABLE environments ADD COLUMN deletedAt TEXT');
                log.info('数据库已迁移：添加 deletedAt 列');
            }

            // 检查 proxyLabel 列是否存在
            const hasProxyLabel = tableInfo.some(column => column.name === 'proxyLabel');
            log.info(`proxyLabel 列是否存在: ${hasProxyLabel}`);
            if (!hasProxyLabel) {
                log.info('准备添加 proxyLabel 列...');
                this.db.exec('ALTER TABLE environments ADD COLUMN proxyLabel TEXT');
                log.info('数据库已迁移：添加 proxyLabel 列');
            }

            // 检查 timezone 列是否存在
            const hasTimezone = tableInfo.some(column => column.name === 'timezone');
            if (!hasTimezone) {
                this.db.exec('ALTER TABLE environments ADD COLUMN timezone TEXT');
                log.info('数据库已迁移：添加 timezone 列');
            }

            // 检查 language 列是否存在
            const hasLanguage = tableInfo.some(column => column.name === 'language');
            if (!hasLanguage) {
                this.db.exec('ALTER TABLE environments ADD COLUMN language TEXT');
                log.info('数据库已迁移：添加 language 列');
            }

            // 检查 browserEngine 列是否存在（老环境默认为 NULL -> system-chrome）
            const hasBrowserEngine = tableInfo.some(column => column.name === 'browserEngine');
            if (!hasBrowserEngine) {
                this.db.exec('ALTER TABLE environments ADD COLUMN browserEngine TEXT');
                log.info('数据库已迁移：添加 browserEngine 列');
            }

            // 检查 fingerprintConfig 列是否存在
            const hasFingerprintConfig = tableInfo.some(column => column.name === 'fingerprintConfig');
            if (!hasFingerprintConfig) {
                this.db.exec('ALTER TABLE environments ADD COLUMN fingerprintConfig TEXT');
                log.info('数据库已迁移：添加 fingerprintConfig 列');
            }

            // 检查 startupUrl 列是否存在（环境级启动页）
            const hasStartupUrl = tableInfo.some(column => column.name === 'startupUrl');
            if (!hasStartupUrl) {
                this.db.exec('ALTER TABLE environments ADD COLUMN startupUrl TEXT');
                log.info('数据库已迁移：添加 startupUrl 列');
            }
        } catch (error) {
            log.error('数据库迁移失败:', error);
        }
    }

    public getSystemChromePath(): string {
        const cached = (this.store.get('chromeExecutablePath') as string) || '';
        if (cached && fs.existsSync(cached)) {
            return cached;
        }
        const detected = this.findChromeExecutable();
        if (detected && fs.existsSync(detected)) {
            this.store.set('chromeExecutablePath', detected);
            return detected;
        }
        return cached;
    }

    private hydrateEnvironment(dbEnv: DBEnvironment, isRunning: boolean): ChromeEnvironment {
        const {
            // 兼容旧版本本地数据库里可能存在的历史列，不透出到渲染层
            walletAddress: _legacyWalletAddress,
            ...rest
        } = dbEnv as DBEnvironment & { walletAddress?: string };
        void _legacyWalletAddress;
        return {
            ...rest,
            tags: parseStoredEnvironmentTags(dbEnv.tags),
            browserEngine: normalizeBrowserEngine(dbEnv.browserEngine) as BrowserEngineType,
            fingerprintConfig: parseFingerprintConfigJson(dbEnv.fingerprintConfig) as FingerprintConfig | undefined,
            isRunning,
        };
    }

    // 查找Chrome可执行文件路径
    private findChromeExecutable(): string {
        if (process.platform === 'win32') {
            // Windows平台常见Chrome安装路径
            const commonPaths = [
                path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join('C:', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
            ];

            for (const chromePath of commonPaths) {
                if (fs.existsSync(chromePath)) {
                    return chromePath;
                }
            }
        } else if (process.platform === 'darwin') {
            const macPaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                path.join(
                    os.homedir(),
                    'Applications',
                    'Google Chrome.app',
                    'Contents',
                    'MacOS',
                    'Google Chrome',
                ),
            ];
            for (const chromePath of macPaths) {
                if (fs.existsSync(chromePath)) {
                    return chromePath;
                }
            }
        } else if (process.platform === 'linux') {
            // Linux平台尝试查找chrome或google-chrome
            const possibleNames = ['google-chrome', 'chrome', 'chromium-browser', 'chromium'];
            for (const name of possibleNames) {
                try {
                    // 尝试使用which命令查找可执行文件路径
                    const chromePath = execSync(`which ${name}`).toString().trim();
                    if (chromePath) {
                        return chromePath;
                    }
                } catch (error) {
                    // 忽略错误，继续尝试下一个可能的名称
                }
            }
        }

        // 未找到Chrome，返回空字符串
        log.warn('未找到Chrome可执行文件');
        return '';
    }

    // 获取所有Chrome环境（排除已删除的）
    public async getAllEnvironments(): Promise<ChromeEnvironment[]> {
        try {
            const query = this.db.prepare('SELECT * FROM environments WHERE deletedAt IS NULL ORDER BY lastUsed DESC');
            const dbEnvironments = query.all() as DBEnvironment[];

            // 转换为应用使用的结构
            return dbEnvironments.map(dbEnv =>
                this.hydrateEnvironment(dbEnv, this.runningProcesses.has(dbEnv.id)),
            );
        } catch (error) {
            log.error('获取所有环境失败:', error);
            throw error;
        }
    }
    
    // 获取回收站中的环境
    public async getDeletedEnvironments(): Promise<ChromeEnvironment[]> {
        try {
            const query = this.db.prepare('SELECT * FROM environments WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC');
            const dbEnvironments = query.all() as DBEnvironment[];

            // 转换为应用使用的结构
            return dbEnvironments.map(dbEnv =>
                this.hydrateEnvironment(dbEnv, false),
            );
        } catch (error) {
            log.error('获取已删除环境失败:', error);
            throw error;
        }
    }

    // 创建新的Chrome环境
    public async createEnvironment(
        name: string,
        groupName: string,
        notes: string = '',
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
            // 生成唯一ID
            const id = uuidv4();

            // 创建环境数据目录
            const envId = id.substring(0, 8);
            const dataDir = path.join(this.environmentsDataDir, envId);

            // 确保目录存在
            fs.mkdirSync(dataDir, { recursive: true });

            // 创建日期
            const now = new Date().toISOString();

            // 读取默认指纹策略并为新环境生成独立持久化指纹档案
            const fpDefaults = normalizeDefaultFingerprintSettings(
                this.settingsManager.getSettings().fingerprint,
            );
            const hasActiveKernel = Boolean(this.kernelManager.getActiveKernel());
            const requestedEngine = options?.browserEngine
                ? (normalizeBrowserEngine(options.browserEngine) as BrowserEngineType)
                : fpDefaults.defaultEngine === 'fingerprint-chromium' && hasActiveKernel
                  ? 'fingerprint-chromium'
                  : 'system-chrome';

            const fingerprintConfig = options?.fingerprintConfig
                ? (normalizeFingerprintConfig(
                      options.fingerprintConfig,
                      fpDefaults,
                  ) as FingerprintConfig)
                : (generateFingerprintConfig(fpDefaults) as FingerprintConfig);

            const proxyId = options?.proxyId?.trim() || undefined;
            const proxy = !proxyId ? options?.proxy?.trim() || undefined : undefined;
            const proxyLabel = !proxyId
                ? options?.proxyLabel?.trim() || undefined
                : undefined;

            // 创建环境记录
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
                isRunning: false
            };

            // 保存到数据库
            const stmt = this.db.prepare(`
        INSERT INTO environments 
        (id, name, groupName, notes, dataDir, tags, proxy, proxyId, proxyLabel, browserEngine, fingerprintConfig, createdAt, lastUsed) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

            stmt.run(
                env.id,
                env.name,
                env.groupName,
                env.notes,
                env.dataDir,
                JSON.stringify(env.tags),
                env.proxy ?? null,
                env.proxyId ?? null,
                env.proxyLabel ?? null,
                env.browserEngine,
                JSON.stringify(env.fingerprintConfig),
                env.createdAt,
                env.lastUsed
            );

            log.info(
                `创建新环境: ${name} (${id}), 引擎=${env.browserEngine}, 指纹种子=${env.fingerprintConfig?.seed}`,
            );
            return env;
        } catch (error) {
            log.error('创建环境失败:', error);
            throw error;
        }
    }

    // 克隆现有环境配置（自动分配全新独立数据目录与全新 32-bit 持久化指纹种子）
    public async cloneEnvironment(
        sourceId: string,
        customName?: string,
    ): Promise<ChromeEnvironment> {
        try {
            const sourceDb = this.db
                .prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NULL')
                .get(sourceId) as DBEnvironment | undefined;
            if (!sourceDb) {
                throw new Error('源环境不存在或已移入回收站');
            }
            const source = this.hydrateEnvironment(sourceDb, false);

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
                platform: source.fingerprintConfig?.platform || fpDefaults.platform,
                brand: source.fingerprintConfig?.brand || fpDefaults.brand,
                spoofing: source.fingerprintConfig?.spoofing || fpDefaults.spoofing,
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

            this.db
                .prepare(
                    `INSERT INTO environments
                    (id, name, groupName, notes, dataDir, tags, proxy, proxyId, proxyLabel, userAgent, timezone, language, startupUrl, browserEngine, fingerprintConfig, createdAt, lastUsed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    cloned.id,
                    cloned.name,
                    cloned.groupName,
                    cloned.notes,
                    cloned.dataDir,
                    JSON.stringify(cloned.tags),
                    cloned.proxy ?? null,
                    cloned.proxyId ?? null,
                    cloned.proxyLabel ?? null,
                    cloned.userAgent ?? null,
                    cloned.timezone ?? null,
                    cloned.language ?? null,
                    cloned.startupUrl ?? null,
                    cloned.browserEngine,
                    JSON.stringify(cloned.fingerprintConfig),
                    cloned.createdAt,
                    cloned.lastUsed,
                );

            log.info(
                `克隆环境: ${source.name} -> ${cloned.name} (${cloned.id}), 新指纹种子=${cloned.fingerprintConfig?.seed}`,
            );
            return cloned;
        } catch (error) {
            log.error('克隆环境失败:', error);
            throw error;
        }
    }

    // 启动前「防呆一致性护栏」校验：代理状态 / 指纹内核 / 时区与语言一致性
    public async checkLaunchConsistency(
        id: string,
    ): Promise<ReturnType<typeof evaluateLaunchConsistency>> {
        const dbEnv = this.db
            .prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NULL')
            .get(id) as DBEnvironment | undefined;
        if (!dbEnv) {
            throw new Error('环境不存在');
        }
        const env = this.hydrateEnvironment(dbEnv, this.runningProcesses.has(id));
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
            } else if (settings.globalProxy?.enabled && settings.globalProxy.address) {
                proxyAddress = settings.globalProxy.address;
            }
        }

        let exitInfo: ProxyExitInfo | null = null;
        if (managedProxy?.exitInfo?.status === 'ready' && managedProxy.exitInfo.ip) {
            exitInfo = {
                ip: managedProxy.exitInfo.ip,
                countryCode: managedProxy.exitInfo.countryCode,
            };
        }

        if (proxyAddress) {
            const parsed = parseProxyAddress(proxyAddress);
            if (parsed) {
                const cacheKey = `${parsed.protocol}//${parsed.host}:${parsed.port}`;
                const cached = this.proxyGeoCache.get(cacheKey);
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
                    // 仅当用户手动固定了时区或语言且缓存缺失时，才做一次快速探测以核验冲突
                    try {
                        const probed = await Promise.race([
                            this.resolveProxyExitInfoBeforeLaunch(proxyAddress, {
                                needTimezone: true,
                            }),
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
                        // 探测超时不阻断启动
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

    // 一键防泄露 / 指纹健康自检
    public async inspectEnvironmentHealth(
        id: string,
    ): Promise<ReturnType<typeof evaluateEnvironmentHealth>> {
        const dbEnv = this.db
            .prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NULL')
            .get(id) as DBEnvironment | undefined;
        if (!dbEnv) {
            throw new Error('环境不存在');
        }
        const env = this.hydrateEnvironment(dbEnv, this.runningProcesses.has(id));
        const settings = this.settingsManager.getSettings();
        const fpDefaults = normalizeDefaultFingerprintSettings(settings.fingerprint);
        const hasFingerprintKernel = Boolean(this.kernelManager?.getActiveKernel());

        let managedProxy: ManagedProxyRecord | null = null;
        let proxyAddress = '';
        if (env.proxyId && this.proxyManager) {
            managedProxy =
                (this.proxyManager.list() as ManagedProxyRecord[]).find(
                    (item) => item.id === env.proxyId,
                ) || null;
            if (managedProxy) {
                try {
                    proxyAddress = await this.ensureManagedProxyReady(
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
            } else if (settings.globalProxy?.enabled && settings.globalProxy.address) {
                proxyAddress = settings.globalProxy.address;
            }
        }

        let exitInfo: ProxyExitInfo | null = null;
        if (managedProxy?.exitInfo?.status === 'ready' && managedProxy.exitInfo.ip) {
            exitInfo = {
                ip: managedProxy.exitInfo.ip,
                countryCode: managedProxy.exitInfo.countryCode,
            };
        }

        if (proxyAddress) {
            try {
                const probed = await Promise.race([
                    this.resolveProxyExitInfoBeforeLaunch(proxyAddress, {
                        needTimezone: true,
                        bypassCache: true,
                    }),
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
                // 保持已有信息
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

    // 获取运行中环境的实时内存占用统计
    public async getRunningResourceStats(): Promise<{
        totalMemoryBytes: number;
        totalProcesses: number;
        environments: Record<
            string,
            { memoryBytes: number; processCount: number }
        >;
    }> {
        const runningList = Array.from(this.runningProcesses.keys());
        if (runningList.length === 0) {
            return { totalMemoryBytes: 0, totalProcesses: 0, environments: {} };
        }

        const shortToFullId = new Map<string, string>();
        for (const envId of runningList) {
            shortToFullId.set(envId.substring(0, 8).toLowerCase(), envId);
        }

        const records = await new Promise<
            Array<{ commandLine: string; memoryBytes: number }>
        >((resolve) => {
            if (process.platform === 'win32') {
                execFile(
                    'powershell.exe',
                    [
                        '-NoProfile',
                        '-NonInteractive',
                        '-Command',
                        "Get-CimInstance Win32_Process -Filter \"Name like '%chrome%'\" | Select-Object WorkingSetSize,CommandLine | ConvertTo-Json -Compress",
                    ],
                    { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
                    (error, stdout) => {
                        if (error || !stdout) {
                            resolve([]);
                            return;
                        }
                        resolve(parseWindowsCimProcessJson(stdout));
                    },
                );
            } else {
                execFile(
                    'ps',
                    ['-ax', '-o', 'rss=,command='],
                    { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
                    (error, stdout) => {
                        if (error || !stdout) {
                            resolve([]);
                            return;
                        }
                        resolve(parseUnixPsOutput(stdout));
                    },
                );
            }
        });

        const agg = aggregateProcessMemory(records);
        const environments: Record<
            string,
            { memoryBytes: number; processCount: number }
        > = {};
        let totalMemoryBytes = 0;
        let totalProcesses = 0;

        for (const [shortId, metrics] of Object.entries(agg.byEnvIdShort)) {
            const fullId = shortToFullId.get(shortId);
            if (!fullId) continue;
            environments[fullId] = metrics;
            totalMemoryBytes += metrics.memoryBytes;
            totalProcesses += metrics.processCount;
        }

        return {
            totalMemoryBytes,
            totalProcesses,
            environments,
        };
    }

    // 在已运行环境中打开指定 URL（用于健康自检快捷打开检测页）
    public async openUrlInEnvironment(id: string, url: string): Promise<boolean> {
        let parsed: URL;
        try {
            parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('仅支持 http/https 链接');
            }
        } catch {
            throw new Error('无效的检测页面链接');
        }
        if (!this.runningProcesses.has(id)) {
            throw new Error('请先启动此环境，再在环境内打开检测页面');
        }
        return this.cdpManager.openUrl(id, parsed.toString());
    }

    // 为环境重新生成一套全新持久化指纹配置
    public async regenerateFingerprint(id: string): Promise<ChromeEnvironment> {
        if (this.runningProcesses.has(id)) {
            throw new Error('环境正在运行，请先关闭后再重新生成指纹');
        }
        const fpDefaults = normalizeDefaultFingerprintSettings(
            this.settingsManager.getSettings().fingerprint,
        );
        const nextFp = generateFingerprintConfig(fpDefaults) as FingerprintConfig;
        return this.updateEnvironment(id, { fingerprintConfig: nextFp });
    }

    // 检查端口是否可用
    private async isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();

            server.once('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(false); // 端口被占用
                } else {
                    resolve(false); // 其他错误也视为不可用
                }
            });

            server.once('listening', () => {
                server.close();
                resolve(true); // 端口可用
            });

            server.listen(port, '127.0.0.1');
        });
    }

    // 查找可用的私有随机调试端口（避开 9222/18922 与 Windows 49152+ Hyper-V 保留段，带 OS 动态兜底与预留防竞态）
    private async findAvailableDebugPort(
        minPort: number = 20000,
        maxPort: number = 39999,
        maxAttempts: number = 60,
    ): Promise<number> {
        const span = Math.max(1, maxPort - minPort + 1);
        const startOffset = Math.floor(Math.random() * span);

        for (let i = 0; i < maxAttempts; i++) {
            const port = minPort + ((startOffset + i * 97) % span);
            if (port === 9222 || port === 18922 || this.reservedPorts.has(port)) {
                continue;
            }
            if (await this.isPortAvailable(port)) {
                this.reservedPorts.add(port);
                return port;
            }
        }

        // OS 内核级兜底分配（自动绕过 Windows netsh excludedportrange 保留段）
        for (let fallback = 0; fallback < 10; fallback++) {
            const osPort = await new Promise<number>((resolve) => {
                const srv = net.createServer();
                srv.once('error', () => resolve(0));
                srv.listen(0, '127.0.0.1', () => {
                    const addr = srv.address();
                    const p = addr && typeof addr === 'object' ? addr.port : 0;
                    srv.close(() => resolve(p));
                });
            });
            if (
                osPort > 1024 &&
                osPort !== 9222 &&
                osPort !== 18922 &&
                !this.reservedPorts.has(osPort)
            ) {
                this.reservedPorts.add(osPort);
                return osPort;
            }
        }

        throw new Error(`无法找到可用的调试端口 (尝试范围: ${minPort}-${maxPort})`);
    }

    // 释放预留的端口
    private releasePort(port: number): void {
        this.reservedPorts.delete(port);
    }

    private async isManagedProxyInUseByOtherBrowser(
        proxyId: string,
        excludeEnvId?: string,
    ): Promise<boolean> {
        const rows = this.db
            .prepare('SELECT id, dataDir FROM environments WHERE proxyId = ?')
            .all(proxyId) as Array<{ id: string; dataDir?: string }>;
        for (const row of rows) {
            if (row.id === excludeEnvId) continue;
            if (this.runningProcesses.has(row.id)) {
                return true;
            }
        }
        for (const row of rows) {
            if (row.id === excludeEnvId || !row.dataDir) continue;
            const local = await isProfileRunningLocally(row.dataDir);
            if (local.running) {
                return true;
            }
        }
        return false;
    }

    private evictProxyGeoCache(proxyAddress?: string): void {
        if (!proxyAddress) return;
        const parsed = parseProxyAddress(proxyAddress);
        if (!parsed) return;
        const cacheKey = `${parsed.protocol}//${parsed.host}:${parsed.port}`;
        this.proxyGeoCache.delete(cacheKey);
    }

    private async ensureManagedProxyReady(
        proxyId: string,
        excludeEnvId?: string,
    ): Promise<string> {
        const previousAddress = (
            this.proxyManager.list() as ManagedProxyRecord[]
        ).find((item) => item.id === proxyId)?.localAddress;

        const nextAddress =
            typeof this.proxyManager.ensureFresh === 'function'
                ? await this.proxyManager.ensureFresh(proxyId, {
                      isInUse: () =>
                          this.isManagedProxyInUseByOtherBrowser(
                              proxyId,
                              excludeEnvId,
                          ),
                  })
                : await this.proxyManager.ensureStarted(proxyId);

        if (previousAddress && previousAddress !== nextAddress) {
            this.evictProxyGeoCache(previousAddress);
        }
        return nextAddress;
    }

    private async resolveProxyExitInfoBeforeLaunch(
        proxyAddress: string,
        options: { needTimezone?: boolean; bypassCache?: boolean } = {},
    ): Promise<ProxyExitInfo | null> {
        return probeProxyExitInfo(proxyAddress, {
            needTimezone: Boolean(options.needTimezone),
            bypassCache: Boolean(options.bypassCache),
            cache: this.proxyGeoCache,
            cacheTtlMs: this.PROXY_IP_CACHE_TTL_MS,
            logger: log,
        });
    }

    private async waitForDebugEndpoint(debugPort: number, timeoutMs: number = 8000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const ready = await new Promise<boolean>((resolve) => {
                const req = http.get(`http://127.0.0.1:${debugPort}/json/version`, (res) => {
                    res.resume();
                    resolve(res.statusCode === 200);
                });
                req.on('error', () => resolve(false));
                req.setTimeout(300, () => {
                    req.destroy();
                    resolve(false);
                });
            });

            if (ready) {
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 25));
        }

        return false;
    }

    /**
     * 通过 CDP pipe 协议加载扩展
     * Chrome v137+ 移除了 --load-extension，改用 CDP Extensions.loadUnpacked
     * pipe 协议使用 fd3（写入Chrome）和 fd4（从Chrome读取），消息以 \0 分隔
     */
    private loadExtensionsViaPipe(
        chromeProcess: ChildProcess,
        extensionPaths: string[],
        envName: string,
        installedTrackerPath?: string,
    ): void {
        const pipeWrite = chromeProcess.stdio[3] as import('stream').Writable;
        const pipeRead = chromeProcess.stdio[4] as import('stream').Readable;

        if (!pipeWrite || !pipeRead) {
            log.warn(`[${envName}] CDP pipe 不可用`);
            return;
        }

        let msgId = 0;
        let buffer = '';
        const pendingByMsgId = new Map<number, string>();

        const recordInstalledExtension = (extPath: string) => {
            if (!installedTrackerPath) return;
            try {
                let existing: string[] = [];
                if (fs.existsSync(installedTrackerPath)) {
                    const parsed = JSON.parse(
                        fs.readFileSync(installedTrackerPath, 'utf-8'),
                    );
                    if (Array.isArray(parsed)) {
                        existing = parsed.filter(
                            (item): item is string => typeof item === 'string',
                        );
                    }
                }
                if (!existing.includes(extPath)) {
                    fs.writeFileSync(
                        installedTrackerPath,
                        JSON.stringify([...existing, extPath]),
                        'utf-8',
                    );
                }
            } catch {
                // ignore tracker write failure
            }
        };

        // 监听 pipe 响应
        pipeRead.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            // CDP pipe 消息以 \0 分隔
            let nullIdx;
            while ((nullIdx = buffer.indexOf('\0')) !== -1) {
                const msgStr = buffer.substring(0, nullIdx);
                buffer = buffer.substring(nullIdx + 1);
                try {
                    const msg = JSON.parse(msgStr);
                    const targetExtPath =
                        typeof msg.id === 'number'
                            ? pendingByMsgId.get(msg.id)
                            : undefined;
                    if (typeof msg.id === 'number') {
                        pendingByMsgId.delete(msg.id);
                    }
                    if (msg.result?.id) {
                        log.info(`[${envName}] 扩展已通过 CDP pipe 加载，ID: ${msg.result.id}`);
                        if (targetExtPath) {
                            recordInstalledExtension(targetExtPath);
                        }
                    } else if (msg.error) {
                        log.warn(`[${envName}] CDP pipe 扩展加载失败: ${msg.error.message || JSON.stringify(msg.error)}`);
                    }
                } catch {
                    // 忽略非 JSON 消息
                }
            }
        });

        pipeRead.on('error', () => { /* ignore */ });
        pipeWrite.on('error', () => { /* ignore */ });

        // 等待 Chrome 初始化后发送扩展加载命令
        setTimeout(() => {
            for (const extPath of extensionPaths) {
                try {
                    const id = ++msgId;
                    pendingByMsgId.set(id, extPath);
                    const cmd = JSON.stringify({
                        id,
                        method: 'Extensions.loadUnpacked',
                        params: { path: extPath }
                    }) + '\0';
                    pipeWrite.write(cmd);
                    log.info(`[${envName}] 通过 CDP pipe 请求加载扩展: ${extPath}`);
                } catch (err) {
                    log.warn(`[${envName}] CDP pipe 写入失败:`, err);
                }
            }

            // 注意：不要关闭 pipe！关闭 pipe 会导致 Chrome 退出
            // pipe 会在 Chrome 进程退出时自动清理
        }, 2000);
    }

    /**
     * 纯原生隐匿偏好写入（C++ 指纹内核与标准 Chrome 统一适用）：
     * - 通过 Chromium 原生 Preferences 锁定 WebRTC Fail-Closed 与语言/区域（含 countryid_at_install）
     * - 自动清理旧版遗留的 `_tz_extension` 目录及注册项（不影响用户自有扩展），消除 JS Hook 检测面
     */
    private applyNativeStealthPreferences(
        dataDir: string,
        enforceWebRTCFailClosed: boolean = false,
        language?: string,
        options: { disableDeveloperMode?: boolean } = {},
    ): void {
        try {
            const prefDir = path.join(dataDir, 'Default');
            const prefPath = path.join(prefDir, 'Preferences');
            fs.mkdirSync(prefDir, { recursive: true });

            let prefs: ChromePreferencesDoc = {};
            if (fs.existsSync(prefPath)) {
                try {
                    prefs = JSON.parse(
                        fs.readFileSync(prefPath, 'utf-8'),
                    ) as ChromePreferencesDoc;
                } catch {
                    prefs = {};
                }
            }

            const cleaned = cleanupLegacyFingerprintExtension(dataDir, prefs, {
                disableDeveloperMode: Boolean(options.disableDeveloperMode),
            });
            if (cleaned.removedIds.length > 0 || cleaned.removedDir) {
                log.info(
                    `[原生隐匿] 已清理旧版指纹扩展残留 (ids=${cleaned.removedIds.join(',') || 'none'}, dir=${cleaned.removedDir})`,
                );
            }

            if (enforceWebRTCFailClosed) {
                applyFailClosedWebRTCPreferences(prefs);
            }
            if (language) {
                applyLanguagePreferences(prefs, language);
            }

            fs.writeFileSync(prefPath, JSON.stringify(prefs));
        } catch (error) {
            log.warn('[原生隐匿] 写入 Preferences 失败:', error);
        }
    }

    // 启动Chrome环境（单环境并发去重，防止快速双击触发双开竞态；不同环境仍完全并发）
    public launchEnvironment(id: string): Promise<boolean> {
        const inflight = this.launchingEnvironments.get(id);
        if (inflight) {
            log.info(`环境正在启动中，复用当前启动任务: ${id.substring(0, 8)}`);
            return inflight;
        }
        const task = this.launchEnvironmentInternal(id);
        this.launchingEnvironments.set(id, task);
        void task.finally(() => {
            if (this.launchingEnvironments.get(id) === task) {
                this.launchingEnvironments.delete(id);
            }
        });
        return task;
    }

    private async launchEnvironmentInternal(id: string): Promise<boolean> {
        let allocatedDebugPort: number | undefined;
        let startupGate: ProxyStartupGate | undefined;
        try {
            // 检查环境是否存在
            const stmt = this.db.prepare('SELECT * FROM environments WHERE id = ?');
            const dbEnv = stmt.get(id) as DBEnvironment | undefined;

            if (!dbEnv) {
                log.error(`环境未找到: ${id}`);
                throw new Error(`环境未找到: ${id}`);
            }

            const env = this.hydrateEnvironment(dbEnv, this.runningProcesses.has(id));

            // 检查是否已经在运行
            if (this.runningProcesses.has(id)) {
                log.info(`环境已在运行: ${env.name} (${id})`);
                return true;
            }

            // 毫秒级本地文件锁 + DevTools 端口检测，避免每次启动冷拉 PowerShell 全量扫进程
            if (env.proxyId) {
                const localState = await isProfileRunningLocally(env.dataDir);
                if (localState.running) {
                    throw new Error('该环境已有浏览器窗口，请先关闭旧窗口，再启动以使用内置代理');
                }
            }

            // 获取全局设置与默认指纹策略
            const settings = this.settingsManager.getSettings();
            const globalProxy = settings.globalProxy;
            const fpDefaults = normalizeDefaultFingerprintSettings(settings.fingerprint);

            // 解析当前环境应使用的浏览器内核（官方 Chrome / C++ 指纹内核）
            const browserEngine = normalizeBrowserEngine(env.browserEngine) as BrowserEngineType;
            let chromePath = '';
            let activeFingerprintConfig: FingerprintConfig | undefined = env.fingerprintConfig;

            if (browserEngine === 'fingerprint-chromium') {
                const activeKernel = this.kernelManager.getActiveKernel();
                if (!activeKernel) {
                    throw new Error(
                        '未安装 C++ 指纹内核。请前往「设置 → 浏览器内核」下载或导入 fingerprint-chromium，或将该环境切换为官方 Chrome。',
                    );
                }
                chromePath = activeKernel.executablePath;
                if (!activeFingerprintConfig) {
                    activeFingerprintConfig = generateFingerprintConfig(fpDefaults) as FingerprintConfig;
                    this.db
                        .prepare('UPDATE environments SET fingerprintConfig = ? WHERE id = ?')
                        .run(JSON.stringify(activeFingerprintConfig), id);
                }
                log.info(
                    `[${env.name}] 使用 C++ 指纹内核 ${activeKernel.version} (seed=${activeFingerprintConfig.seed}, platform=${activeFingerprintConfig.platform}, brand=${activeFingerprintConfig.brand}, cores=${activeFingerprintConfig.hardwareConcurrency}, window=${activeFingerprintConfig.windowSize.width}x${activeFingerprintConfig.windowSize.height})`,
                );
            } else {
                chromePath = this.getSystemChromePath();
                if (!chromePath || !fs.existsSync(chromePath)) {
                    log.error('Chrome可执行文件未找到');
                    throw new Error('Chrome可执行文件未找到，请确认已安装 Google Chrome');
                }
            }

            // 并行执行：分配私有随机高调试端口 + 启动/重建内置代理（如有）
            const [debugPort, proxyAddress] = await Promise.all([
                this.findAvailableDebugPort(),
                env.proxyId
                    ? this.ensureManagedProxyReady(env.proxyId, id)
                    : Promise.resolve(env.proxy || (globalProxy?.enabled ? globalProxy?.address : undefined)),
            ]);
            allocatedDebugPort = debugPort;
            log.info(`[${env.name}] 分配端口: ${debugPort}`);

            // 准备启动参数
            const args = [
                `--user-data-dir=${env.dataDir}`,// 指定用户数据目录，每个环境独立
                '--no-first-run',              // 禁用首次运行向导
                '--no-default-browser-check',   // 禁用默认浏览器检查
                `--remote-debugging-port=${debugPort}`,  // 启用 CDP，使用固定端口便于连接
                '--disable-blink-features=AutomationControlled',  // 防止 navigator.webdriver=true（反 bot 检测）
                '--test-type',                  // 隐藏命令行参数警告横幅
            ];

            // 收集需要通过 CDP pipe 加载的扩展路径（仅限首次安装用户自定义扩展模板）
            const extensionsToLoad: string[] = [];

            // 添加用户代理（如果有；C++ 指纹内核默认由内核根据 brand/platform 生成一致的 UA + Client Hints）
            if (env.userAgent) {
                args.push(`--user-agent=${env.userAgent}`);
            }

            let startupExitInfo: ProxyExitInfo | null = null;
            let startupProxyIP: string | undefined;
            const manualTimezone = env.timezone?.trim() || undefined;
            const shouldAutoMatchTz = !manualTimezone && fpDefaults.autoMatchTimezone;
            const rawEnvLanguage = env.language?.trim() || '';
            const shouldAutoMatchLang =
                rawEnvLanguage.toLowerCase() === 'auto' ||
                (!rawEnvLanguage && Boolean(fpDefaults.autoMatchLanguage));

            if (proxyAddress) {
                try {
                    startupExitInfo = await this.resolveProxyExitInfoBeforeLaunch(proxyAddress, {
                        needTimezone: true,
                    });
                    startupProxyIP = startupExitInfo?.ip || undefined;
                    if (startupProxyIP) {
                        log.info(
                            `[${env.name}] 启动前已解析代理出口: ip=${startupProxyIP}${startupExitInfo?.countryCode ? `, country=${startupExitInfo.countryCode}` : ''}${startupExitInfo?.timezone ? `, tz=${startupExitInfo.timezone}` : ''}`,
                        );
                    } else {
                        log.warn(`[${env.name}] 启动前未能解析代理 IP，已通过内核 Fail-Closed 策略防止首开泄露`);
                    }
                } catch (error) {
                    log.warn(`[${env.name}] 启动前解析代理出口信息失败:`, error);
                }
            }

            // 语言策略：支持环境级 auto 或全局“语言跟随代理地区”，否则优先手动值，未配置回退默认语言（默认 en-US）
            const effectiveLanguage = resolveEffectiveLanguage(env.language, {
                autoMatchLanguage: Boolean(fpDefaults.autoMatchLanguage),
                countryCode: startupExitInfo?.countryCode,
                defaultLanguage: fpDefaults.defaultLanguage,
            });
            args.push(`--lang=${effectiveLanguage}`);
            args.push(`--accept-lang=${buildAcceptLangSwitchValue(effectiveLanguage)}`);
            log.info(
                `[${env.name}] 使用语言: ${effectiveLanguage}${
                    shouldAutoMatchLang && startupExitInfo?.countryCode
                        ? `（按代理地区 ${startupExitInfo.countryCode} 自动匹配）`
                        : env.language
                          ? ''
                          : '（默认策略）'
                }`,
            );

            const effectiveTimezone =
                manualTimezone ||
                (fpDefaults.autoMatchTimezone ? startupExitInfo?.timezone : undefined) ||
                undefined;
            if (!manualTimezone && effectiveTimezone) {
                log.info(`[${env.name}] 未配置时区，已按代理 IP 自动匹配时区: ${effectiveTimezone}`);
            }

            const isFingerprintChromium = browserEngine === 'fingerprint-chromium';

            // C++ 指纹内核原生命令行参数注入（Canvas/WebGL/Audio/Font/ClientRects/CPU/Brand/Platform/Timezone/WindowSize）
            if (isFingerprintChromium && activeFingerprintConfig) {
                args.push(
                    ...buildFingerprintChromiumArgs(activeFingerprintConfig, {
                        timezone: effectiveTimezone,
                        language: effectiveLanguage,
                    }),
                );
            }

            const shouldAutoMatchGeo = Boolean(fpDefaults.autoMatchGeolocation);
            const startupGeolocation =
                shouldAutoMatchGeo &&
                typeof startupExitInfo?.latitude === 'number' &&
                typeof startupExitInfo?.longitude === 'number'
                    ? {
                          latitude: startupExitInfo.latitude,
                          longitude: startupExitInfo.longitude,
                          accuracy: 100,
                      }
                    : undefined;

            // 标准 Chrome 在绑定代理且需要通过 CDP 挂载原生 V8 时区/定位/区域覆盖时，
            // 启用轻量级本地 TCP 启动流量闸门，消除旧会话恢复瞬间的 ~0.3s 竞态（含磁盘缓存 / SW 抢跑）。
            let chromeProxyAddress = proxyAddress;
            const needStartupGate =
                !isFingerprintChromium &&
                Boolean(proxyAddress) &&
                Boolean(effectiveTimezone || startupGeolocation);
            if (needStartupGate && proxyAddress) {
                const parsedUpstream = parseProxyAddress(proxyAddress);
                if (parsedUpstream) {
                    try {
                        startupGate = await createProxyStartupGate({
                            upstreamHost: parsedUpstream.host,
                            upstreamPort: parsedUpstream.port,
                            maxHoldMs: 8000,
                            failClosedOnTimeout: true,
                            logger: log,
                        });
                        const rewritten = rewriteProxyAddressForGate(
                            proxyAddress,
                            startupGate.port,
                        );
                        if (rewritten) {
                            chromeProxyAddress = rewritten.gateProxyAddress;
                            log.info(
                                `[${env.name}] 已启用 Fail-Closed 启动流量闸门 (127.0.0.1:${startupGate.port} -> ${rewritten.upstreamHost}:${rewritten.upstreamPort})`,
                            );
                        } else {
                            await startupGate.close();
                            startupGate = undefined;
                        }
                    } catch (gateErr) {
                        log.warn(`[${env.name}] 启动流量闸门初始化失败，回退直连代理入口:`, gateErr);
                        if (startupGate) {
                            await startupGate.close();
                            startupGate = undefined;
                        }
                    }
                }
            }

            if (chromeProxyAddress) {
                if (env.proxyId) {
                    args.push(...buildManagedProxyArgs(chromeProxyAddress));
                } else {
                    // 手动/全局代理同样强制 Fail-Closed（禁 QUIC、禁非代理 WebRTC UDP、禁本地 DNS 泄露）
                    args.push(...buildManualProxyArgs(chromeProxyAddress));
                }
                log.info(`[${env.name}] 已启用${env.proxyId ? '内置' : '手动'}代理（Fail-Closed 模式）`);
            }

            if (isFingerprintChromium) {
                // C++ 指纹内核走纯原生隐匿模式：
                // 时区 / 语言 / WebRTC Fail-Closed 全部由 C++ 启动参数与原生 Preferences 生效，
                // 不安装开发者模式扩展（_tz_extension），也不通过 CDP 注入任何 JS 原型补丁；
                // 仅在获取到出口经纬度时使用原生 Emulation.setGeolocationOverride 补齐四维一致。
                this.cdpManager.primeEnvironment(id, {
                    geolocation: startupGeolocation,
                });
                this.applyNativeStealthPreferences(
                    env.dataDir,
                    Boolean(proxyAddress),
                    effectiveLanguage,
                    { disableDeveloperMode: true },
                );
                log.info(
                    `[${env.name}] 已启用 C++ 纯原生隐匿模式（零扩展 / 零 JS Hook）: tz=${effectiveTimezone || 'pending'}, lang=${effectiveLanguage}, geo=${startupGeolocation ? `${startupGeolocation.latitude.toFixed(2)},${startupGeolocation.longitude.toFixed(2)}` : 'none'}, webrtc=${proxyAddress ? 'fail-closed' : 'direct'}`,
                );
            } else {
                // 标准 Chrome 同样走纯原生零扩展 / 零 JS Hook 模式：
                // WebRTC Fail-Closed 与 Accept-Language 由原生 Preferences + CLI 锁定；
                // 时区 / 区域 / Geolocation 由 V8/Blink 底层 CDP Emulation 原生覆盖，配合启动流量闸门消除首屏竞态。
                this.cdpManager.primeEnvironment(id, {
                    timezone: effectiveTimezone,
                    locale: effectiveLanguage,
                    geolocation: startupGeolocation,
                });
                this.applyNativeStealthPreferences(
                    env.dataDir,
                    Boolean(proxyAddress),
                    effectiveLanguage,
                    { disableDeveloperMode: false },
                );
                log.info(
                    `[${env.name}] 已启用标准 Chrome 原生隐匿模式（零扩展 / 零 JS Hook）: tz=${effectiveTimezone || 'none'}, lang=${effectiveLanguage}, geo=${startupGeolocation ? `${startupGeolocation.latitude.toFixed(2)},${startupGeolocation.longitude.toFixed(2)}` : 'none'}, webrtc=${proxyAddress ? 'fail-closed' : 'direct'}, gate=${startupGate ? 'on' : 'off'}`,
                );
            }

            // 分发常用书签模板（增量合并不覆盖用户已有书签）
            if (settings.bookmarkTemplates && settings.bookmarkTemplates.length > 0) {
                try {
                    const bmRes = syncBookmarksToProfile(
                        env.dataDir,
                        settings.bookmarkTemplates,
                    );
                    if (bmRes.addedCount > 0) {
                        log.info(
                            `[${env.name}] 已分发 ${bmRes.addedCount} 条书签模板（跳过重复 ${bmRes.skippedCount} 条）`,
                        );
                    }
                } catch (err) {
                    log.warn(`[${env.name}] 分发书签模板失败:`, err);
                }
            }

            // 分发本地扩展模板（C++ 纯原生隐匿模式默认禁止加载扩展，除非用户在设置中显式开启）
            const installedTrackerPath = path.join(
                env.dataDir,
                '.template-extensions.json',
            );
            const templateExtPaths = resolveExtensionTemplatePaths(
                settings.extensionTemplates,
                {
                    isFingerprintChromium,
                    allowExtensionsOnFingerprintKernel: Boolean(
                        settings.allowExtensionsOnFingerprintKernel,
                    ),
                },
            );
            if (templateExtPaths.length > 0) {
                let installedTemplatePaths: string[] = [];
                try {
                    if (fs.existsSync(installedTrackerPath)) {
                        const raw = JSON.parse(
                            fs.readFileSync(installedTrackerPath, 'utf-8'),
                        );
                        if (Array.isArray(raw)) {
                            installedTemplatePaths = raw.filter(
                                (item): item is string => typeof item === 'string',
                            );
                        }
                    }
                } catch {
                    installedTemplatePaths = [];
                }
                const newlyAddedExtPaths: string[] = [];
                for (const extPath of templateExtPaths) {
                    if (
                        !installedTemplatePaths.includes(extPath) &&
                        !extensionsToLoad.includes(extPath)
                    ) {
                        extensionsToLoad.push(extPath);
                        newlyAddedExtPaths.push(extPath);
                    }
                }
                if (newlyAddedExtPaths.length > 0) {
                    log.info(
                        `[${env.name}] 将通过 CDP pipe 安装 ${newlyAddedExtPaths.length} 个本地扩展模板`,
                    );
                }
            }

            // 仅在需要安装扩展时才添加 pipe 标志
            // --remote-debugging-pipe 会导致 Chrome 在 pipe 关闭时退出
            // 所以只在首次安装时使用，后续启动不需要
            const needPipe = extensionsToLoad.length > 0;
            if (needPipe) {
                args.push('--remote-debugging-pipe');
                args.push('--enable-unsafe-extension-debugging');
                log.info(`[${env.name}] 启用 CDP pipe（首次安装扩展）`);
            }

            // 省内存启动策略（不改变 navigator.deviceMemory / hardwareConcurrency 等指纹面）
            if (settings.memorySaverMode) {
                args.push(...buildMemorySaverChromiumArgs());
                log.info(`[${env.name}] 已启用省内存启动策略（Memory Saver + 渲染进程与缓存上限）`);
            }

            // 始终恢复上次会话
            args.push('--restore-last-session');

            // 启动页智能去重（优先级：环境级 > 分组级 > 全局默认）：
            // 仅全新环境（无历史会话文件）通过启动参数直开；已有旧会话时交由 CDP 检查去重
            const startupUrl = resolveEffectiveStartupUrl({
                envStartupUrl: env.startupUrl,
                groupName: env.groupName,
                groupStartupUrls: settings.groupStartupUrls,
                globalStartupUrl: settings.startupUrl,
            });
            const hadSavedSession = hasSavedChromeSession(env.dataDir);
            if (startupUrl && !hadSavedSession) {
                args.push(startupUrl);
            }

            // 时区伪装：通过 TZ 环境变量设置（作为扩展的补充）
            const spawnEnv = { ...process.env };
            if (effectiveTimezone) {
                spawnEnv.TZ = effectiveTimezone;
            }

            // Chrome 启动配置
            const pipeStdio: StdioOptions = [
                'ignore',
                'ignore',
                'ignore',
                'pipe',
                'pipe',
            ];
            const spawnOptions = process.platform === 'win32' ? {
                detached: false,
                stdio: needPipe ? pipeStdio : ('ignore' as const),
                windowsHide: false,
                env: spawnEnv
            } : {
                detached: true,
                stdio: needPipe ? pipeStdio : ('ignore' as const),
                env: spawnEnv
            };

            // 启动 Chrome 进程
            const chromeProcess = spawn(chromePath, args, spawnOptions);

            // 通过 CDP pipe 加载扩展（仅首次安装时，成功后再写入 .template-extensions.json）
            if (needPipe && chromeProcess.stdio[3] && chromeProcess.stdio[4]) {
                this.loadExtensionsViaPipe(
                    chromeProcess,
                    extensionsToLoad,
                    env.name,
                    installedTrackerPath,
                );
            }

            // 重要说明：spawn 返回的进程只是 Chrome 的启动器进程，会立即退出
            // Chrome 真正的浏览器进程是独立运行的，通过 CDP 协议跟踪

            // 监听启动器进程的错误（用于检测启动失败）
            chromeProcess.on('error', (error) => {
                log.error(`Chrome 启动失败: ID=${id}, code=${error.name}`);

                // 释放预留的端口与启动闸门
                this.releasePort(debugPort);
                if (startupGate) {
                    void startupGate.close();
                }

                this.runningProcesses.delete(id);
                this.cdpManager.disconnect(id);
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('chrome-status-changed');
                }
            });

            // 标记为运行中（保存调试端口、关联代理与启动闸门）
            this.runningProcesses.set(id, {
                envId: id,
                dataDir: env.dataDir,
                debugPort: debugPort,
                launchedAt: Date.now(),
                proxyId: env.proxyId,
                startupGate,
            });
            if (env.proxyId) {
                this.proxyManager?.touchActivity?.(env.proxyId);
            }
            const launchRecord = this.runningProcesses.get(id);

            // 更新最后使用时间
            this.db.prepare('UPDATE environments SET lastUsed = ? WHERE id = ?')
                .run(new Date().toISOString(), id);

            log.info(`[${env.name}] 启动Chrome - PID:${chromeProcess.pid}, 端口:${debugPort}, ID:${id.substring(0,8)}`);

            const envIdShort = id.substring(0, 8);
            const isEnLocale = settings.locale === 'en-US';
            const handleBrowserDisconnected = () => {
                if (this.runningProcesses.get(id) !== launchRecord) return;
                log.info(`[${env.name}] 浏览器已关闭 - 端口:${debugPort}, ID:${envIdShort}`);
                this.releasePort(debugPort);
                if (launchRecord?.proxyId) {
                    this.proxyManager?.touchActivity?.(launchRecord.proxyId);
                }
                if (launchRecord?.startupGate) {
                    void launchRecord.startupGate.close();
                    launchRecord.startupGate = undefined;
                }
                this.runningProcesses.delete(id);
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('chrome-status-changed');
                }
            };

            const runBackgroundExitRetry = async () => {
                if (proxyAddress && (!startupProxyIP || (shouldAutoMatchTz && !effectiveTimezone))) {
                    try {
                        const retryInfo = await this.resolveProxyExitInfoBeforeLaunch(proxyAddress, {
                            needTimezone: shouldAutoMatchTz && !effectiveTimezone,
                            bypassCache: true,
                        });
                        if (this.runningProcesses.get(id) !== launchRecord) return;
                        if (retryInfo?.ip) {
                            const resolvedTz =
                                manualTimezone ||
                                effectiveTimezone ||
                                (fpDefaults.autoMatchTimezone ? retryInfo.timezone : undefined);
                            if (shouldAutoMatchTz && !effectiveTimezone && retryInfo.timezone) {
                                await this.cdpManager.setTimezone(id, retryInfo.timezone);
                            }
                            if (
                                shouldAutoMatchGeo &&
                                !startupGeolocation &&
                                typeof retryInfo.latitude === 'number' &&
                                typeof retryInfo.longitude === 'number'
                            ) {
                                await this.cdpManager.setGeolocation(id, {
                                    latitude: retryInfo.latitude,
                                    longitude: retryInfo.longitude,
                                    accuracy: 100,
                                });
                            }
                            log.info(
                                `[${env.name}] 后台补测代理出口成功并已刷新: ip=${retryInfo.ip}, tz=${resolvedTz || 'none'}`,
                            );
                        } else {
                            log.warn(`[${env.name}] 后台补测代理出口仍未返回，继续保持内核 Fail-Closed 防泄露保护`);
                        }
                    } catch (err) {
                        log.warn(`[${env.name}] 后台补测代理出口失败:`, err);
                    }
                }
            };

            // 严格 Fail-Closed 启动握手：当标准 Chrome 启用了启动流量闸门时，同步等待 CDP 挂载原生时区并开闸（正常仅 ~400-600ms）；
            // 若在超时前未能完成挂载，则物理阻断全部待发流量、关闭半启动浏览器并报错，让用户重试，绝不静默放行泄露本机时区！
            if (startupGate) {
                let gateHandshakeOk = false;
                try {
                    const debugReady = await this.waitForDebugEndpoint(debugPort, 7500);
                    if (
                        debugReady &&
                        !startupGate.isAborted() &&
                        this.runningProcesses.get(id) === launchRecord
                    ) {
                        const cdpConnected = await this.cdpManager.connect(
                            id,
                            debugPort,
                            handleBrowserDisconnected,
                            async () => (await isProfileRunningLocally(env.dataDir, debugPort)).running,
                        );
                        if (
                            cdpConnected &&
                            !startupGate.isAborted() &&
                            this.runningProcesses.get(id) === launchRecord
                        ) {
                            log.info(`✅ [${env.name}] CDP连接成功 - ID:${envIdShort}`);
                            const overridesReady = await this.cdpManager.applyOverrides(id);
                            if (
                                overridesReady &&
                                !startupGate.isAborted() &&
                                this.runningProcesses.get(id) === launchRecord
                            ) {
                                await this.cdpManager.flushStartupGate(id, startupGate);
                                if (!startupGate.isAborted() && startupGate.isReleased()) {
                                    gateHandshakeOk = true;
                                    log.info(
                                        `[${env.name}] CDP原生覆盖成功: tz=${effectiveTimezone || 'none'}, lang=${effectiveLanguage}, ip=${startupProxyIP || 'fail-closed'}`,
                                    );
                                }
                            }
                        }
                    }
                } catch (handshakeErr) {
                    log.warn(`[${env.name}] 启动闸门握手异常:`, handshakeErr);
                }

                if (!gateHandshakeOk) {
                    log.error(
                        `❌ [${env.name}] 启动安全防护超时/未就绪，已 Fail-Closed 阻断并终止本次启动`,
                    );
                    await startupGate.abortFailClosed();
                    if (launchRecord) {
                        launchRecord.startupGate = undefined;
                    }
                    // 关闭未就绪的浏览器进程并释放端口，确保用户可干净重试
                    try {
                        await this.closeEnvironment(id);
                    } catch {
                        this.releasePort(debugPort);
                        this.runningProcesses.delete(id);
                        this.cdpManager.disconnect(id);
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.webContents.send('chrome-status-changed');
                        }
                    }
                    allocatedDebugPort = undefined;
                    startupGate = undefined;
                    throw new Error(
                        isEnLocale
                            ? `Security protection for "${env.name}" timed out before launch completed. Launch was blocked to prevent timezone leak — please try launching again.`
                            : `「${env.name}」安全防护初始化超时，已拦截本次启动以防止时区泄露，请重试启动。`,
                    );
                }

                if (startupUrl && hadSavedSession) {
                    void this.cdpManager.ensureStartupUrl(id, startupUrl);
                }
                void runBackgroundExitRetry();
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('chrome-status-changed');
                }
                return true;
            }

            // 非闸门模式（C++ 原生指纹内核 / 直连模式）：保持异步 CDP 连接与引擎收尾
            void (async () => {
                const debugReady = await this.waitForDebugEndpoint(debugPort);
                if (this.runningProcesses.get(id) !== launchRecord) return;
                if (!debugReady) {
                    log.warn(`[${env.name}] 调试端口未就绪，使用轮询检测 - ID:${envIdShort}`);

                    const runningEnvIds = await this.checkAllChromeProcesses(true);
                    if (this.runningProcesses.get(id) !== launchRecord) return;
                    if (runningEnvIds.includes(envIdShort)) {
                        log.info(`✅ [${env.name}] 轮询确认运行中 - ID:${envIdShort}`);
                    } else {
                        log.error(`❌ [${env.name}] 启动失败 - ID:${envIdShort}`);
                        this.releasePort(debugPort);
                        this.runningProcesses.delete(id);
                        this.cdpManager.disconnect(id);
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.webContents.send('chrome-status-changed');
                        }
                    }
                    return;
                }

                const cdpConnected = await this.cdpManager.connect(
                    id,
                    debugPort,
                    handleBrowserDisconnected,
                    async () => (await isProfileRunningLocally(env.dataDir, debugPort)).running,
                );
                if (this.runningProcesses.get(id) !== launchRecord) return;

                if (cdpConnected) {
                    log.info(`✅ [${env.name}] CDP连接成功 - ID:${envIdShort}`);

                    if (isFingerprintChromium) {
                        if (startupGeolocation) {
                            await this.cdpManager.applyOverrides(id);
                            if (this.runningProcesses.get(id) !== launchRecord) return;
                        }
                        // Ungoogled Chromium 默认搜索引擎为 "No Search"，首次启动静默初始化为 Google 搜索
                        const searchReadyMarker = path.join(env.dataDir, '.google-search-ready');
                        if (!fs.existsSync(searchReadyMarker)) {
                            const searchConfigured = await this.cdpManager.ensureDefaultGoogleSearch(id);
                            if (this.runningProcesses.get(id) !== launchRecord) return;
                            if (searchConfigured) {
                                try {
                                    fs.writeFileSync(searchReadyMarker, '1');
                                } catch {
                                    /* ignore */
                                }
                            }
                        }
                    } else {
                        const overridesReady = await this.cdpManager.applyOverrides(id);
                        if (this.runningProcesses.get(id) !== launchRecord) return;
                        log.info(`[${env.name}] CDP原生覆盖${overridesReady ? '成功' : '失败'}: tz=${effectiveTimezone || 'none'}, lang=${effectiveLanguage}, ip=${startupProxyIP || 'fail-closed'}`);
                    }

                    if (startupUrl && hadSavedSession) {
                        void this.cdpManager.ensureStartupUrl(id, startupUrl);
                    }

                    await runBackgroundExitRetry();

                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('chrome-status-changed');
                    }
                } else {
                    log.warn(`[${env.name}] CDP连接失败，使用轮询检测 - ID:${envIdShort}`);

                    const runningEnvIds = await this.checkAllChromeProcesses(true);
                    if (this.runningProcesses.get(id) !== launchRecord) return;
                    if (runningEnvIds.includes(envIdShort)) {
                        log.info(`✅ [${env.name}] 轮询确认运行中 - ID:${envIdShort}`);
                    } else {
                        log.error(`❌ [${env.name}] 启动失败 - ID:${envIdShort}`);
                        this.releasePort(debugPort);
                        this.runningProcesses.delete(id);
                        this.cdpManager.disconnect(id);
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.webContents.send('chrome-status-changed');
                        }
                    }
                }
            })().catch(() => {
                log.warn('无法确认浏览器启动状态，将在后续状态检查中重试');
            });

            return true;
        } catch (error) {
            if (allocatedDebugPort !== undefined) this.releasePort(allocatedDebugPort);
            if (startupGate) {
                void startupGate.close();
            }
            log.error('启动环境失败:', error);
            throw error;
        }
    }

    /**
     * 获取运行中环境的自动化 CDP 连接信息（用于 Local REST API & MCP）
     */
    public async getAutomationConnectionInfo(id: string): Promise<{
        debugPort: number;
        wsEndpoint: string | null;
        httpEndpoint: string;
        debuggerAddress: string;
    } | null> {
        const procRecord = this.runningProcesses.get(id);
        const cdpInfo = this.cdpManager.getConnectionInfo(id);
        if (!procRecord) {
            return null;
        }
        if (procRecord.startupGate && !procRecord.startupGate.isReleased()) {
            return null;
        }
        const debugPort = procRecord.debugPort || cdpInfo?.debugPort;
        if (!debugPort || !Number.isInteger(debugPort) || debugPort <= 0) {
            return null;
        }
        const liveWs = await this.cdpManager.fetchLiveWsEndpoint(debugPort);
        const wsEndpoint =
            liveWs ||
            (cdpInfo?.connected && cdpInfo.debugUrl ? cdpInfo.debugUrl : null);
        if (!wsEndpoint) {
            return null;
        }
        return {
            debugPort,
            wsEndpoint,
            httpEndpoint: `http://127.0.0.1:${debugPort}`,
            debuggerAddress: `127.0.0.1:${debugPort}`,
        };
    }

    /**
     * 以 Fail-Closed 模式为外部自动化控制面启动环境，并等待 CDP WebSocket 调试端点完全就绪。
     * 直接复用普通 launchEnvironment() 路径，不改变或拖慢 UI 正常启动流程。
     */
    public async launchEnvironmentForAutomation(
        id: string,
        timeoutMs = 15000,
    ): Promise<{
        profileId: string;
        name: string;
        browserEngine: BrowserEngineType;
        debugPort: number;
        wsEndpoint: string;
        httpEndpoint: string;
        debuggerAddress: string;
        env: ChromeEnvironment;
        cdp: {
            debugPort: number;
            wsEndpoint: string;
            httpEndpoint: string;
            debuggerAddress: string;
        };
    }> {
        const effectiveTimeoutMs =
            Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
        const deadline = Date.now() + effectiveTimeoutMs;

        const launched = await this.launchEnvironment(id);
        if (!launched) {
            throw new Error(`启动环境失败: ${id}`);
        }

        let liveWsEndpoint: string | null = null;
        let activeDebugPort = 0;
        let wsLiveSince = 0;
        const cdpConnectGraceMs = 2000;

        while (Date.now() < deadline) {
            const procRecord = this.runningProcesses.get(id);
            if (!procRecord) {
                throw new Error(`浏览器进程未能保持运行，启动失败: ${id}`);
            }

            if (procRecord.startupGate) {
                if (procRecord.startupGate.isAborted()) {
                    throw new Error(`启动安全闸门已 Fail-Closed 中止: ${id}`);
                }
                if (!procRecord.startupGate.isReleased()) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    continue;
                }
            }

            const port =
                procRecord.debugPort ||
                this.cdpManager.getConnectionInfo(id)?.debugPort ||
                0;
            if (Number.isInteger(port) && port > 0) {
                activeDebugPort = port;
                if (!liveWsEndpoint) {
                    liveWsEndpoint = await this.cdpManager.fetchLiveWsEndpoint(port);
                    if (liveWsEndpoint) {
                        wsLiveSince = Date.now();
                    }
                }
            }

            if (liveWsEndpoint && activeDebugPort > 0) {
                const isCdpReady = this.cdpManager.isConnected(id);
                const waitedForCdp = wsLiveSince > 0 ? Date.now() - wsLiveSince : 0;
                if (
                    isCdpReady ||
                    Boolean(procRecord.startupGate) ||
                    waitedForCdp >= cdpConnectGraceMs
                ) {
                    break;
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 75));
        }

        if (!this.runningProcesses.has(id)) {
            throw new Error(`浏览器进程未能保持运行，启动失败: ${id}`);
        }
        if (!liveWsEndpoint || activeDebugPort <= 0) {
            throw new Error(
                `环境 ${id} 的 CDP WebSocket 调试端点在 ${effectiveTimeoutMs}ms 内未就绪 (Fail-Closed)`,
            );
        }

        const dbEnv = this.db
            .prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NULL')
            .get(id) as DBEnvironment | undefined;
        if (!dbEnv) {
            throw new Error(`环境未找到: ${id}`);
        }
        const env = this.hydrateEnvironment(dbEnv, true);
        const cdp = {
            debugPort: activeDebugPort,
            wsEndpoint: liveWsEndpoint,
            httpEndpoint: `http://127.0.0.1:${activeDebugPort}`,
            debuggerAddress: `127.0.0.1:${activeDebugPort}`,
        };

        return {
            profileId: env.id,
            name: env.name,
            browserEngine: env.browserEngine || 'system-chrome',
            debugPort: cdp.debugPort,
            wsEndpoint: cdp.wsEndpoint,
            httpEndpoint: cdp.httpEndpoint,
            debuggerAddress: cdp.debuggerAddress,
            env,
            cdp,
        };
    }

    // 关闭Chrome环境
    public async closeEnvironment(id: string): Promise<boolean> {
        try {
            const envProcess = this.runningProcesses.get(id);

            if (!envProcess) {
                return false;
            }

            const env = this.db.prepare('SELECT name FROM environments WHERE id = ?').get(id) as { name: string } | undefined;
            const envName = env?.name || '未知';
            const envIdShort = id.substring(0, 8);

            log.info(`[${envName}] 开始关闭 - ID:${envIdShort}`);

            // 优先通过 CDP 优雅关闭浏览器（快速落盘并释放 lockfile）
            const gracefulClosed = await this.cdpManager.closeBrowser(id);

            // 断开 CDP 连接并关闭启动流量闸门
            this.cdpManager.disconnect(id);
            if (envProcess.startupGate) {
                void envProcess.startupGate.close();
                envProcess.startupGate = undefined;
            }

            // 通过 Chrome 进程关闭
            const dataDir = envProcess.dataDir;
            const debugPort = envProcess.debugPort;

            // 释放预留的端口
            if (debugPort) {
                this.releasePort(debugPort);
            }

            // 等待短暂时间确认优雅关闭；若仍存活则执行强制进程终止兜底
            let stillRunning = !gracefulClosed;
            if (gracefulClosed && dataDir) {
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                    const state = await isProfileRunningLocally(dataDir);
                    if (!state.running) {
                        stillRunning = false;
                        break;
                    }
                    stillRunning = true;
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }

            if (stillRunning) {
                const killSpec = buildForceKillProcessSpec(
                    envIdShort,
                    process.platform,
                );
                if (killSpec) {
                    await new Promise<void>((resolve) => {
                        execFile(
                            killSpec.executable,
                            killSpec.args,
                            {
                                windowsHide: true,
                                timeout: 4000,
                                maxBuffer: 1024 * 1024,
                            },
                            (error) => {
                                if (!error) {
                                    log.info(
                                        `[${envName}] Chrome进程已强制关闭 - ID:${envIdShort}`,
                                    );
                                }
                                resolve();
                            },
                        );
                    });
                }
            }

            // 从运行列表中移除并刷新关联代理最近活跃时间
            if (envProcess.proxyId) {
                this.proxyManager?.touchActivity?.(envProcess.proxyId);
            }
            this.runningProcesses.delete(id);

            // 通知前端更新
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('chrome-status-changed');
            }

            return true;
        } catch (error) {
            log.error('关闭环境失败:', error);
            throw error;
        }
    }

    // 获取当前正在运行的环境摘要
    public getRunningEnvironmentSummary(): {
        count: number;
        ids: string[];
        names: string[];
    } {
        const ids = Array.from(this.runningProcesses.keys());
        if (ids.length === 0) {
            return { count: 0, ids: [], names: [] };
        }
        const placeholders = ids.map(() => '?').join(', ');
        const rows = this.db
            .prepare(`SELECT id, name FROM environments WHERE id IN (${placeholders})`)
            .all(...ids) as Array<{ id: string; name: string }>;
        const nameMap = new Map(rows.map((row) => [row.id, row.name]));
        const names = ids.map((id) => nameMap.get(id) || id.substring(0, 8));
        return { count: ids.length, ids, names };
    }

    // 关闭所有正在运行的环境（并发优雅关闭，避免多个环境串行叠加耗时）
    public async closeAllEnvironments(): Promise<{
        closedCount: number;
        failedCount: number;
    }> {
        const ids = Array.from(this.runningProcesses.keys());
        if (ids.length === 0) {
            return { closedCount: 0, failedCount: 0 };
        }
        let closedCount = 0;
        let failedCount = 0;
        await Promise.allSettled(
            ids.map(async (id) => {
                try {
                    await this.closeEnvironment(id);
                    closedCount += 1;
                } catch (error) {
                    failedCount += 1;
                    log.warn(`关闭环境失败 (${id}):`, error);
                }
            }),
        );
        return { closedCount, failedCount };
    }

    // 获取环境数据目录路径（用于打开文件夹）
    public getEnvironmentDataDir(id: string): string {
        const row = this.db
            .prepare('SELECT dataDir FROM environments WHERE id = ?')
            .get(id) as { dataDir?: string } | undefined;
        if (!row?.dataDir) {
            throw new Error('环境不存在');
        }
        return row.dataDir;
    }

    // 统计环境 Profile 磁盘占用与可清理缓存体积
    public async getEnvironmentStorageStats(id: string): Promise<{
        exists: boolean;
        totalBytes: number;
        cacheBytes: number;
    }> {
        const dataDir = this.getEnvironmentDataDir(id);
        return await inspectProfileStorage(dataDir);
    }

    // 清理环境 Profile 缓存（保留 Cookie 与登录态）
    public async clearEnvironmentCache(id: string): Promise<{
        freedBytes: number;
        removedCount: number;
        afterTotalBytes: number;
        afterCacheBytes: number;
    }> {
        const dataDir = this.getEnvironmentDataDir(id);
        if (this.runningProcesses.has(id)) {
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

    // 软删除Chrome环境（移到回收站）
    public async deleteEnvironment(id: string): Promise<boolean> {
        try {
            // 首先尝试关闭环境（如果正在运行）
            if (this.runningProcesses.has(id)) {
                await this.closeEnvironment(id);
            }

            // 获取环境信息
            const stmt = this.db.prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NULL');
            const env = stmt.get(id) as ChromeEnvironment;

            if (!env) {
                log.error(`尝试删除不存在或已删除的环境: ${id}`);
                return false;
            }

            // 软删除：设置 deletedAt 时间戳
            const deletedAt = new Date().toISOString();
            this.db.prepare('UPDATE environments SET deletedAt = ? WHERE id = ?').run(deletedAt, id);

            log.info(`软删除Chrome环境: ${env.name} (${id})`);
            return true;
        } catch (error) {
            log.error('软删除环境失败:', error);
            throw error;
        }
    }
    
    // 从回收站恢复环境
    public async restoreEnvironment(id: string): Promise<boolean> {
        try {
            // 获取已删除环境信息
            const stmt = this.db.prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NOT NULL');
            const env = stmt.get(id) as ChromeEnvironment;

            if (!env) {
                log.error(`尝试恢复不存在或未删除的环境: ${id}`);
                return false;
            }

            // 恢复：移除 deletedAt 时间戳
            this.db.prepare('UPDATE environments SET deletedAt = NULL WHERE id = ?').run(id);

            log.info(`恢复Chrome环境: ${env.name} (${id})`);
            return true;
        } catch (error) {
            log.error('恢复环境失败:', error);
            throw error;
        }
    }
    
    // 永久删除环境（从回收站彻底删除）
    public async permanentlyDeleteEnvironment(id: string): Promise<boolean> {
        try {
            // 获取已删除环境信息
            const stmt = this.db.prepare('SELECT * FROM environments WHERE id = ? AND deletedAt IS NOT NULL');
            const env = stmt.get(id) as DBEnvironment;

            if (!env) {
                log.error(`尝试永久删除不存在或未删除的环境: ${id}`);
                return false;
            }

            // 从数据库中彻底删除环境
            this.db.prepare('DELETE FROM environments WHERE id = ?').run(id);

            // 删除环境数据目录
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
    
    // 清空回收站（删除超过30天的环境）
    public async cleanupTrash(): Promise<number> {
        try {
            // 计算30天前的时间戳
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const cutoffDate = thirtyDaysAgo.toISOString();

            // 获取需要清理的环境
            const stmt = this.db.prepare('SELECT * FROM environments WHERE deletedAt IS NOT NULL AND deletedAt < ?');
            const envs = stmt.all(cutoffDate) as DBEnvironment[];

            let cleanedCount = 0;
            for (const env of envs) {
                // 删除数据目录
                if (fs.existsSync(env.dataDir)) {
                    fs.rmSync(env.dataDir, { recursive: true, force: true });
                }
                cleanedCount++;
            }

            // 从数据库中删除这些环境
            this.db.prepare('DELETE FROM environments WHERE deletedAt IS NOT NULL AND deletedAt < ?').run(cutoffDate);

            log.info(`清理回收站: 删除了 ${cleanedCount} 个过期环境`);
            return cleanedCount;
        } catch (error) {
            log.error('清理回收站失败:', error);
            throw error;
        }
    }

    // 更新Chrome环境信息
    public async updateEnvironment(id: string, data: Partial<ChromeEnvironment>): Promise<ChromeEnvironment> {
        try {
            // 获取当前环境信息
            const stmt = this.db.prepare('SELECT * FROM environments WHERE id = ?');
            const env = stmt.get(id) as DBEnvironment;

            if (!env) {
                log.error(`尝试更新不存在的环境: ${id}`);
                throw new Error(`环境未找到: ${id}`);
            }

            // 准备更新数据
            const updateData: Partial<ChromeEnvironment> = { ...data };

            // 不允许更新某些字段
            delete updateData.id;
            delete updateData.dataDir;
            delete updateData.createdAt;

            // 构建更新SQL
            const updates: string[] = [];
            const params: unknown[] = [];
            const fpDefaults = normalizeDefaultFingerprintSettings(
                this.settingsManager.getSettings().fingerprint,
            );

            Object.entries(updateData).forEach(([key, value]) => {
                if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
                    return;
                }
                // 特殊处理tags字段
                if (key === 'tags' && Array.isArray(value)) {
                    updates.push(`${key} = ?`);
                    params.push(JSON.stringify(normalizeEnvironmentTags(value)));
                } else if (key === 'browserEngine') {
                    updates.push(`${key} = ?`);
                    params.push(normalizeBrowserEngine(value));
                } else if (key === 'fingerprintConfig') {
                    updates.push(`${key} = ?`);
                    params.push(
                        value
                            ? JSON.stringify(normalizeFingerprintConfig(value, fpDefaults))
                            : null,
                    );
                } else {
                    updates.push(`${key} = ?`);
                    params.push(value);
                }
            });

            // 如果切换到了 C++ 指纹内核且尚未拥有指纹档案，自动补建一套持久化指纹
            if (
                updateData.browserEngine === 'fingerprint-chromium' &&
                !('fingerprintConfig' in updateData) &&
                !env.fingerprintConfig
            ) {
                updates.push('fingerprintConfig = ?');
                params.push(JSON.stringify(generateFingerprintConfig(fpDefaults)));
            }

            // 如果没有要更新的字段，直接返回当前环境
            if (updates.length === 0) {
                return this.hydrateEnvironment(env, this.runningProcesses.has(id));
            }

            // 执行更新
            const updateSql = `UPDATE environments SET ${updates.join(', ')} WHERE id = ?`;
            params.push(id);

            this.db.prepare(updateSql).run(...params);

            // 获取更新后的环境
            const updatedEnv = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as DBEnvironment;

            log.info(`更新Chrome环境: ${updatedEnv.name} (${id})`);

            return this.hydrateEnvironment(updatedEnv, this.runningProcesses.has(id));
        } catch (error) {
            log.error('更新环境失败:', error);
            throw error;
        }
    }

    public async getProxyBindings(): Promise<Array<{id: string; proxyId?: string; isRunning: boolean}>> {
        const rows = this.db.prepare('SELECT id, proxyId, dataDir FROM environments').all() as Array<{
            id: string;
            proxyId?: string;
            dataDir?: string;
        }>;
        // 优先使用毫秒级本地锁与调试端口探活，避免每次校验冷启动 PowerShell 扫全机进程
        return Promise.all(
            rows.map(async (row) => {
                if (this.runningProcesses.has(row.id)) {
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

    // 重命名分组
    public async renameGroup(
        oldName: string,
        newName: string,
    ): Promise<RenameGroupResult> {
        try {
            const result = executeRenameGroup({
                db: this.db,
                oldName,
                newName,
            });
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
            return result as RenameGroupResult;
        } catch (error) {
            log.error('重命名分组失败:', error);
            throw error;
        }
    }

    // 删除分组（支持迁移组内环境到目标分组，或将组内环境移入回收站）
    public async deleteGroup(
        groupName: string,
        options?: DeleteGroupOptions,
    ): Promise<DeleteGroupResult> {
        try {
            const result = await executeDeleteGroup({
                db: this.db,
                groupName,
                options,
                closeRunningEnv: async (envId: string) => {
                    if (this.runningProcesses.has(envId)) {
                        await this.closeEnvironment(envId);
                    }
                },
            });

            log.info(
                `删除分组: ${result.groupName}, 方式=${result.action}, 影响环境数=${result.affectedCount}` +
                    (result.targetGroup ? `, 目标分组=${result.targetGroup}` : ''),
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
            return result as DeleteGroupResult;
        } catch (error) {
            log.error('删除分组失败:', error);
            throw error;
        }
    }

    // 删除空分组
    public async deleteEmptyGroup(groupName: string): Promise<boolean> {
        // 首先检查该分组是否为空（仅统计未删除环境）
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM environments WHERE groupName = ? AND deletedAt IS NULL');
        const result = stmt.get(groupName) as { count: number };
        
        if (result.count > 0) {
            // 分组不为空，不能删除
            return false;
        }
        
        // 分组为空，可以删除
        // 实际上，由于分组只是环境的一个属性，而不是单独的表，
        // 所以删除空分组只需要确保没有环境使用这个分组名即可
        return true;
    }

    // 获取所有空分组
    public async getEmptyGroups(): Promise<string[]> {
        // 获取所有活跃环境使用中的分组
        const usedGroupsStmt = this.db.prepare('SELECT DISTINCT groupName FROM environments WHERE deletedAt IS NULL');
        const usedGroups = usedGroupsStmt.all() as { groupName: string }[];
        const activeGroupNames = new Set(usedGroups.map(g => g.groupName));

        // 仅在历史结构兼容时返回空列表（不再将活跃分组误判为空分组）
        return Array.from(activeGroupNames).filter(() => false);
    }

    // 使用平台特定命令查询所有运行中的Chrome环境ID（跨平台，带短 TTL 缓存）
    private async checkAllChromeProcesses(strict = false): Promise<string[]> {
        if (this.processScanCache && this.processScanCache.expiresAt > Date.now()) {
            return this.processScanCache.ids;
        }
        try {
            const windows = process.platform === 'win32';
            if (!windows && process.platform !== 'darwin' && process.platform !== 'linux') {
                throw new Error('不支持的操作系统');
            }
            // 独立参数避免嵌套 shell 引号；PowerShell 的查询错误必须返回非零状态。
            const executable = windows ? 'powershell.exe' : 'ps';
            const args = windows
                ? ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Get-CimInstance -ClassName Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"]
                : ['-ax', '-o', 'command='];
            const ids = await new Promise<string[]>((resolve, reject) => {
                execFile(executable, args, {
                    encoding: 'utf8',
                    timeout: 8000,
                    maxBuffer: 4 * 1024 * 1024,
                    windowsHide: true
                }, (error, stdout) => {
                    if (error) {
                        reject(new Error('无法确认浏览器运行状态，请重试'));
                        return;
                    }
                    // ps 成功但没有 Chrome 是正常空结果，不与查询失败混淆。
                    const chromeCommands = filterBrowserProcessLines(
                        stdout,
                        process.platform,
                    );
                    resolve(this.parseEnvironmentIds(chromeCommands));
                });
            });
            this.processScanCache = {
                ids,
                expiresAt: Date.now() + this.PROCESS_SCAN_CACHE_TTL_MS,
            };
            return ids;
        } catch {
            // 进程输出可能带有手动代理认证参数，不记录 stdout/stderr 或原始错误。
            log.debug('Chrome进程状态查询失败');
            if (strict) throw new Error('无法确认浏览器运行状态，请重试');
            return [];
        }
    }

    // 从命令行输出中解析环境ID（跨平台通用）
    private parseEnvironmentIds(output: string): string[] {
        const envIds: string[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.includes('--user-data-dir=') && trimmed.includes('environments')) {
                // 匹配 --user-data-dir=.../environments/xxxxxxxx 格式
                // 支持 Windows 和 Unix 路径分隔符
                const match = trimmed.match(/--user-data-dir=.*?environments[\\/]([a-f0-9]{8})/);
                if (match && match[1]) {
                    envIds.push(match[1]);
                }
            }
        }

        // 去重并返回
        return [...new Set(envIds)];
    }

}
