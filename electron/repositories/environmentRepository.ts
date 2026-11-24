import path from 'path';
import Database from 'better-sqlite3';
import Store from 'electron-store';
import log from 'electron-log';
import {
    generateFingerprintConfig,
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
    normalizeFingerprintConfig,
    parseFingerprintConfigJson,
} from '../domain/fingerprintProfile.js';
import {
    normalizeEnvironmentTags,
    parseStoredEnvironmentTags,
} from '../domain/environmentTags.js';
import {
    executeDeleteGroup,
    executeRenameGroup,
} from './groupRepository.js';
import type {
    BrowserEngineType,
    FingerprintBrand,
    FingerprintPlatform,
    FingerprintSpoofingOptions,
} from './settingsRepository.js';

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

export interface ChromeEnvironment {
    id: string;
    name: string;
    groupName: string;
    notes: string;
    dataDir: string;
    tags: string[];
    proxy?: string;
    proxyId?: string;
    proxyLabel?: string;
    userAgent?: string;
    timezone?: string;
    language?: string;
    startupUrl?: string;
    browserEngine?: BrowserEngineType;
    fingerprintConfig?: FingerprintConfig;
    createdAt: string;
    lastUsed: string;
    deletedAt?: string;
    isRunning: boolean;
    processId?: number;
}

export interface DBEnvironment {
    id: string;
    name: string;
    groupName: string;
    notes: string;
    dataDir: string;
    tags: string;
    proxy?: string;
    proxyId?: string;
    proxyLabel?: string;
    userAgent?: string;
    timezone?: string;
    language?: string;
    startupUrl?: string;
    browserEngine?: string;
    fingerprintConfig?: string;
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

/**
 * SQLite Environment & Chrome Binary Persistence Repository (Layer 1 Infrastructure).
 * Zero process spawning, zero network calls, zero Electron UI / IPC coupling.
 */
export class EnvironmentRepository {
    private readonly db: Database.Database;
    private readonly binaryStore: Store<{ chromeExecutablePath: unknown }>;

    constructor(options: {
        appDataPath: string;
        defaultChromeExecutable?: string;
    }) {
        const dbPath = path.join(options.appDataPath, 'chrome-environments.db');
        this.db = new Database(dbPath);
        try {
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('busy_timeout = 5000');
        } catch (pragmaError) {
            log.warn('SQLite WAL 配置跳过:', pragmaError);
        }

        this.binaryStore = new Store({
            name: 'config',
            cwd: options.appDataPath,
            schema: {
                chromeExecutablePath: {
                    type: 'string',
                    default: options.defaultChromeExecutable || '',
                },
            },
        });

        this.initDatabase();
    }

    public getCachedChromePath(): string {
        return (this.binaryStore.get('chromeExecutablePath') as string) || '';
    }

    public setCachedChromePath(executablePath: string): void {
        this.binaryStore.set('chromeExecutablePath', executablePath);
    }

    public checkIntegrity(): string {
        try {
            const result = this.db.pragma('integrity_check', { simple: true });
            return String(result || 'unknown');
        } catch (error) {
            log.warn('SQLite integrity_check 失败:', error);
            return 'error';
        }
    }

    public close(): void {
        try {
            if (this.db && this.db.open) {
                this.db.close();
            }
        } catch (error) {
            log.warn('关闭环境数据库失败:', error);
        }
    }

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

    private migrateDatabase(): void {
        try {
            const tableInfo = this.db
                .prepare('PRAGMA table_info(environments)')
                .all() as Array<{ name: string }>;
            const hasCol = (col: string) =>
                tableInfo.some((column) => column.name === col);

            if (!hasCol('proxyId')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN proxyId TEXT');
            }
            if (!hasCol('deletedAt')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN deletedAt TEXT');
            }
            if (!hasCol('proxyLabel')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN proxyLabel TEXT');
            }
            if (!hasCol('timezone')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN timezone TEXT');
            }
            if (!hasCol('language')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN language TEXT');
            }
            if (!hasCol('browserEngine')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN browserEngine TEXT');
            }
            if (!hasCol('fingerprintConfig')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN fingerprintConfig TEXT');
            }
            if (!hasCol('startupUrl')) {
                this.db.exec('ALTER TABLE environments ADD COLUMN startupUrl TEXT');
            }
        } catch (error) {
            log.error('数据库迁移失败:', error);
        }
    }

    public hydrateEnvironment(
        dbEnv: DBEnvironment,
        isRunning: boolean,
    ): ChromeEnvironment {
        const {
            // Backward compatibility: strip legacy column if present in older local SQLite files
            walletAddress: _legacyWalletAddress,
            ...rest
        } = dbEnv as DBEnvironment & { walletAddress?: string };
        void _legacyWalletAddress;
        return {
            ...rest,
            tags: parseStoredEnvironmentTags(dbEnv.tags),
            browserEngine: normalizeBrowserEngine(
                dbEnv.browserEngine,
            ) as BrowserEngineType,
            fingerprintConfig: parseFingerprintConfigJson(
                dbEnv.fingerprintConfig,
            ) as FingerprintConfig | undefined,
            isRunning,
        };
    }

    public findAllActive(
        isRunningPredicate: (id: string) => boolean,
    ): ChromeEnvironment[] {
        const rows = this.db
            .prepare(
                'SELECT * FROM environments WHERE deletedAt IS NULL ORDER BY lastUsed DESC',
            )
            .all() as DBEnvironment[];
        return rows.map((row) =>
            this.hydrateEnvironment(row, isRunningPredicate(row.id)),
        );
    }

    public findAllDeleted(): ChromeEnvironment[] {
        const rows = this.db
            .prepare(
                'SELECT * FROM environments WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC',
            )
            .all() as DBEnvironment[];
        return rows.map((row) => this.hydrateEnvironment(row, false));
    }

    public findActiveById(
        id: string,
        isRunning = false,
    ): ChromeEnvironment | null {
        const row = this.db
            .prepare(
                'SELECT * FROM environments WHERE id = ? AND deletedAt IS NULL',
            )
            .get(id) as DBEnvironment | undefined;
        return row ? this.hydrateEnvironment(row, isRunning) : null;
    }

    public findAnyById(
        id: string,
        isRunning = false,
    ): ChromeEnvironment | null {
        const row = this.db
            .prepare('SELECT * FROM environments WHERE id = ?')
            .get(id) as DBEnvironment | undefined;
        return row ? this.hydrateEnvironment(row, isRunning) : null;
    }

    public insert(env: ChromeEnvironment): void {
        this.db
            .prepare(
                `INSERT INTO environments
                (id, name, groupName, notes, dataDir, tags, proxy, proxyId, proxyLabel, userAgent, timezone, language, startupUrl, browserEngine, fingerprintConfig, createdAt, lastUsed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                env.id,
                env.name,
                env.groupName,
                env.notes,
                env.dataDir,
                JSON.stringify(env.tags),
                env.proxy ?? null,
                env.proxyId ?? null,
                env.proxyLabel ?? null,
                env.userAgent ?? null,
                env.timezone ?? null,
                env.language ?? null,
                env.startupUrl ?? null,
                env.browserEngine,
                JSON.stringify(env.fingerprintConfig),
                env.createdAt,
                env.lastUsed,
            );
    }

    public saveFingerprintConfig(id: string, config: FingerprintConfig): void {
        this.db
            .prepare(
                'UPDATE environments SET fingerprintConfig = ? WHERE id = ?',
            )
            .run(JSON.stringify(config), id);
    }

    public touchLastUsed(id: string, isoTimestamp = new Date().toISOString()): void {
        this.db
            .prepare('UPDATE environments SET lastUsed = ? WHERE id = ?')
            .run(isoTimestamp, id);
    }

    public update(
        id: string,
        data: Partial<ChromeEnvironment>,
        fpDefaults: ReturnType<typeof normalizeDefaultFingerprintSettings>,
        isRunning: boolean,
    ): ChromeEnvironment {
        const env = this.db
            .prepare('SELECT * FROM environments WHERE id = ?')
            .get(id) as DBEnvironment | undefined;
        if (!env) {
            throw new Error(`环境未找到: ${id}`);
        }

        const updateData: Partial<ChromeEnvironment> = { ...data };
        delete updateData.id;
        delete updateData.dataDir;
        delete updateData.createdAt;

        const updates: string[] = [];
        const params: unknown[] = [];

        Object.entries(updateData).forEach(([key, value]) => {
            if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
                return;
            }
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
                        ? JSON.stringify(
                              normalizeFingerprintConfig(value, fpDefaults),
                          )
                        : null,
                );
            } else {
                updates.push(`${key} = ?`);
                params.push(value);
            }
        });

        if (
            updateData.browserEngine === 'fingerprint-chromium' &&
            !('fingerprintConfig' in updateData) &&
            !env.fingerprintConfig
        ) {
            updates.push('fingerprintConfig = ?');
            params.push(JSON.stringify(generateFingerprintConfig(fpDefaults)));
        }

        if (updates.length === 0) {
            return this.hydrateEnvironment(env, isRunning);
        }

        const updateSql = `UPDATE environments SET ${updates.join(', ')} WHERE id = ?`;
        params.push(id);
        this.db.prepare(updateSql).run(...params);

        const updatedEnv = this.db
            .prepare('SELECT * FROM environments WHERE id = ?')
            .get(id) as DBEnvironment;
        return this.hydrateEnvironment(updatedEnv, isRunning);
    }

    public softDelete(
        id: string,
        deletedAt = new Date().toISOString(),
    ): { deleted: boolean; name?: string } {
        const env = this.db
            .prepare(
                'SELECT id, name FROM environments WHERE id = ? AND deletedAt IS NULL',
            )
            .get(id) as { id: string; name: string } | undefined;
        if (!env) {
            return { deleted: false };
        }
        this.db
            .prepare('UPDATE environments SET deletedAt = ? WHERE id = ?')
            .run(deletedAt, id);
        return { deleted: true, name: env.name };
    }

    public restore(id: string): { restored: boolean; name?: string } {
        const env = this.db
            .prepare(
                'SELECT id, name FROM environments WHERE id = ? AND deletedAt IS NOT NULL',
            )
            .get(id) as { id: string; name: string } | undefined;
        if (!env) {
            return { restored: false };
        }
        this.db
            .prepare('UPDATE environments SET deletedAt = NULL WHERE id = ?')
            .run(id);
        return { restored: true, name: env.name };
    }

    public hardDeleteDeleted(id: string): DBEnvironment | null {
        const env = this.db
            .prepare(
                'SELECT * FROM environments WHERE id = ? AND deletedAt IS NOT NULL',
            )
            .get(id) as DBEnvironment | undefined;
        if (!env) {
            return null;
        }
        this.db.prepare('DELETE FROM environments WHERE id = ?').run(id);
        return env;
    }

    public purgeDeletedBefore(cutoffIso: string): DBEnvironment[] {
        const envs = this.db
            .prepare(
                'SELECT * FROM environments WHERE deletedAt IS NOT NULL AND deletedAt < ?',
            )
            .all(cutoffIso) as DBEnvironment[];
        if (envs.length > 0) {
            this.db
                .prepare(
                    'DELETE FROM environments WHERE deletedAt IS NOT NULL AND deletedAt < ?',
                )
                .run(cutoffIso);
        }
        return envs;
    }

    public findDataDirById(id: string): string {
        const row = this.db
            .prepare('SELECT dataDir FROM environments WHERE id = ?')
            .get(id) as { dataDir?: string } | undefined;
        if (!row?.dataDir) {
            throw new Error('环境不存在');
        }
        return row.dataDir;
    }

    public findNameById(id: string): string | undefined {
        const row = this.db
            .prepare('SELECT name FROM environments WHERE id = ?')
            .get(id) as { name?: string } | undefined;
        return row?.name;
    }

    public findNamesByIds(ids: string[]): Map<string, string> {
        if (ids.length === 0) return new Map();
        const placeholders = ids.map(() => '?').join(', ');
        const rows = this.db
            .prepare(
                `SELECT id, name FROM environments WHERE id IN (${placeholders})`,
            )
            .all(...ids) as Array<{ id: string; name: string }>;
        return new Map(rows.map((row) => [row.id, row.name]));
    }

    public findAllProxyRows(): Array<{
        id: string;
        proxyId?: string;
        dataDir?: string;
    }> {
        return this.db
            .prepare('SELECT id, proxyId, dataDir FROM environments')
            .all() as Array<{ id: string; proxyId?: string; dataDir?: string }>;
    }

    public findRowsByProxyId(
        proxyId: string,
    ): Array<{ id: string; dataDir?: string }> {
        return this.db
            .prepare('SELECT id, dataDir FROM environments WHERE proxyId = ?')
            .all(proxyId) as Array<{ id: string; dataDir?: string }>;
    }

    public renameGroup(oldName: string, newName: string): RenameGroupResult {
        return executeRenameGroup({ db: this.db, oldName, newName }) as RenameGroupResult;
    }

    public async deleteGroup(
        groupName: string,
        options?: DeleteGroupOptions,
        closeRunningEnv?: (id: string) => Promise<void>,
    ): Promise<DeleteGroupResult> {
        return (await executeDeleteGroup({
            db: this.db,
            groupName,
            options,
            closeRunningEnv,
        })) as DeleteGroupResult;
    }

    public isGroupEmpty(groupName: string): boolean {
        const result = this.db
            .prepare(
                'SELECT COUNT(*) as count FROM environments WHERE groupName = ? AND deletedAt IS NULL',
            )
            .get(groupName) as { count: number };
        return result.count === 0;
    }

    public getEmptyGroups(): string[] {
        const usedGroups = this.db
            .prepare(
                'SELECT DISTINCT groupName FROM environments WHERE deletedAt IS NULL',
            )
            .all() as Array<{ groupName: string }>;
        const activeGroupNames = new Set(usedGroups.map((g) => g.groupName));
        return Array.from(activeGroupNames).filter(() => false);
    }
}
