import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { SingboxCore } from './singboxCore.js';
import { probeProxyExit } from './proxyExitProbe.js';
import {
    parseProxyLine,
    simpleProxyToConfig,
    normalizeProxyConfig,
    buildSingboxConfig,
    redactConfig,
} from './singboxConfig.js';
import {
    buildProxyEndpointKey,
    parseBatchProxyText,
} from './proxyBatch.js';
import {
    buildOutboundEndpointKey,
    isAdvancedProxyUri,
    parseProxyUriToOutbound,
    redactProxyUri,
} from './proxyUriParser.js';

const MAX_LOGS = 1000;
const EXIT_PROBE_COOLDOWN_MS = 15000;
const DEFAULT_IDLE_RECYCLE_MS = 2 * 60 * 1000;
const BATCH_CHECK_CONCURRENCY = 4;
const GENERIC_START_ERROR = 'sing-box 启动失败，请检查核心、配置和本地端口';

const SAFE_START_ERROR_PATTERNS = [
    /^尚未安装 sing-box 代理核心/,
    /^无法解密代理配置/,
    /^此出口类型不受内置 sing-box 核心支持$/,
    /^sing-box 配置/,
    /^配置使用了已移除的 sing-box 字段/,
    /^sing-box UUID 配置无效$/,
    /^sing-box TLS 或密钥配置无效$/,
    /^sing-box 引用了不存在的出口$/,
    /^无法分配本地代理端口$/,
    /^无法启动内置 sing-box/,
    /^无法启动 sing-box 核心/,
];

/**
 * Keep startup error reporting strictly redacted: only known safe internal
 * diagnostics are surfaced (always prefixed with "sing-box 启动失败"), while
 * any unknown error that could contain upstream host/credentials/paths falls
 * back to a fixed generic message.
 */
export function resolveSafeStartError(error) {
    const message =
        error && typeof error.message === 'string' ? error.message.trim() : '';
    if (
        message &&
        SAFE_START_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ) {
        return message.includes('启动失败')
            ? message
            : `sing-box 启动失败：${message}`;
    }
    return GENERIC_START_ERROR;
}

function validateName(value) {
    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 80 ||
        [...value].some((character) => character.charCodeAt(0) < 32)
    ) {
        throw new Error('请填写不超过 80 个字符的代理名称');
    }
    return value.trim();
}

function buildRecordCacheToken(record) {
    if (record.payload) return `v2:${record.payload}`;
    return `v1:${record.protocol || ''}|${record.host || ''}|${record.port || 0}|${record.credentials || ''}`;
}

function extractSummaryMetadata(data) {
    const config = data?.config;
    const main = [
        ...(config?.outbounds || []),
        ...(config?.endpoints || []),
    ].find((item) => item.tag === config?.route?.final);
    const simple = data?.simple;
    return {
        mode: data?.mode || 'json',
        protocol: simple?.protocol || main?.type || 'sing-box',
        host: simple?.host || main?.server || '',
        port: simple?.port || main?.server_port || 0,
        username: simple?.username || '',
        hasPassword:
            data?.mode === 'json' ? true : Boolean(simple?.password),
        endpointKey: simple
            ? buildProxyEndpointKey(simple)
            : buildOutboundEndpointKey(main),
    };
}

async function reserveLocalPort() {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', () => reject(new Error('无法分配本地代理端口')));
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close((error) =>
                error
                    ? reject(new Error('无法分配本地代理端口'))
                    : resolve(port),
            );
        });
    });
}

async function runWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    const runners = Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

/** Proxy definitions stay encrypted; sing-box receives its runtime JSON via stdin. */
export class ProxyManager {
    /**
     * @param {{
     *   store: any,
     *   secretStorage: any,
     *   core?: any,
     *   binaryPath?: string,
     *   resolveBinary?: (() => { binaryPath: string; version?: string } | null) | null,
     *   configDirectory?: string,
     *   coreVersion?: string,
     *   exitProbe?: any,
     *   now?: () => number,
     *   getLocale?: (() => string) | null,
     *   idleRecycleMs?: number,
     * }} options
     */
    constructor({
        store,
        secretStorage,
        core = null,
        binaryPath = '',
        resolveBinary = null,
        configDirectory = '',
        coreVersion = '1.14.4',
        exitProbe = probeProxyExit,
        now = Date.now,
        getLocale = null,
        idleRecycleMs = DEFAULT_IDLE_RECYCLE_MS,
    }) {
        this.store = store;
        this.secretStorage = secretStorage;
        this.exitProbe = exitProbe;
        this.now = now;
        this.getLocale = typeof getLocale === 'function' ? getLocale : null;
        this.idleRecycleMs =
            typeof idleRecycleMs === 'number' &&
            Number.isFinite(idleRecycleMs) &&
            idleRecycleMs >= 0
                ? idleRecycleMs
                : DEFAULT_IDLE_RECYCLE_MS;
        this.core =
            core ||
            new SingboxCore({
                binaryPath:
                    binaryPath ||
                    path.resolve(
                        'resources',
                        'sing-box',
                        process.platform === 'win32'
                            ? 'sing-box.exe'
                            : 'sing-box',
                    ),
                resolveBinary,
                version: coreVersion,
                workingDirectory: configDirectory || undefined,
            });
        this.configDirectory = configDirectory;
        this.sourcePath =
            store.path || path.join(configDirectory, 'managed-proxies.json');
        this.runtimes = new Map();
        this.recyclingPromises = new Map();
        this.stopGenerations = new Map();
        // In-memory cache of redacted summary metadata only (never persisted,
        // never stores passwords, UUIDs, or full sing-box JSON configs).
        this.summaryCache = new Map();
        this.listeners = new Set();
        this.logs = [];
        this.closed = false;
        const saved = store.get('proxies', []);
        if (!Array.isArray(saved)) throw new Error('代理配置格式无效');
        this.records = saved;
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    notifyChange(kind = 'state', proxyId = undefined) {
        if (this.listeners.size === 0) return;
        for (const listener of this.listeners) {
            try {
                listener({ kind, proxyId });
            } catch {
                // ignore listener errors
            }
        }
    }

    encryptionAvailable() {
        return (
            this.secretStorage.isEncryptionAvailable() &&
            this.secretStorage.getSelectedStorageBackend?.() !== 'basic_text'
        );
    }

    decrypt(value) {
        try {
            if (!this.encryptionAvailable()) throw new Error();
            return JSON.parse(
                this.secretStorage.decryptString(Buffer.from(value, 'base64')),
            );
        } catch {
            throw new Error(
                '无法解密代理配置，请在原系统账户下使用，或重新配置此代理',
            );
        }
    }

    payload(record) {
        if (record.payload) return this.decrypt(record.payload);
        // Compatibility with proxies saved by the earlier proxy-chain build.
        const credentials = record.credentials
            ? this.decrypt(record.credentials)
            : { username: '', password: '' };
        const simple = {
            protocol: record.protocol,
            host: record.host,
            port: record.port,
            username: credentials.username,
            password: credentials.password,
        };
        return { mode: 'simple', simple, config: simpleProxyToConfig(simple) };
    }

    find(id) {
        const record = this.records.find((item) => item.id === id);
        if (!record) throw new Error('代理不存在');
        return record;
    }

    resolveSummaryMetadata(record) {
        if (!this.encryptionAvailable()) {
            this.summaryCache.clear();
            return {
                meta: null,
                credentialError: '代理配置无法解密，请重新配置',
            };
        }

        const token = buildRecordCacheToken(record);
        const cached = this.summaryCache.get(record.id);
        if (cached && cached.token === token) {
            return { meta: cached.meta, credentialError: undefined };
        }

        try {
            const data = this.payload(record);
            const meta = extractSummaryMetadata(data);
            this.summaryCache.set(record.id, { token, meta });
            return { meta, credentialError: undefined };
        } catch {
            this.summaryCache.delete(record.id);
            return {
                meta: null,
                credentialError: '代理配置无法解密，请重新配置',
            };
        }
    }

    summary(record) {
        const runtime = this.runtimes.get(record.id);
        const { meta, credentialError } = this.resolveSummaryMetadata(record);
        return {
            id: record.id,
            name: record.name,
            mode: meta?.mode || 'json',
            protocol: meta?.protocol || 'sing-box',
            host: meta?.host || '',
            port: meta?.port || 0,
            username: meta?.username || '',
            hasPassword: Boolean(meta?.hasPassword),
            status: runtime?.handle
                ? 'running'
                : runtime?.lastError || credentialError
                  ? 'error'
                  : 'stopped',
            localAddress: runtime?.handle ? runtime.localAddress : undefined,
            lastError: runtime?.lastError || credentialError,
            exitInfo: { ...(runtime?.exitInfo || { status: 'idle' }) },
        };
    }

    list() {
        return this.records.map((record) => this.summary(record));
    }

    getCoreInfo() {
        return {
            ...this.core.getInfo(),
            configDirectory: this.configDirectory,
        };
    }

    getEditor(id, asJson = false) {
        const data = this.payload(this.find(id));
        return data.mode === 'json' || asJson
            ? { mode: 'json', config: JSON.stringify(data.config, null, 2) }
            : { mode: 'simple' };
    }

    getConfig(id, reveal = false) {
        const record = this.find(id);
        const runtime = this.runtimes.get(id);
        const config =
            runtime?.handle && runtime.config
                ? runtime.config
                : buildSingboxConfig(
                      this.payload(record).config,
                      runtime?.port || 0,
                  );
        return {
            json: JSON.stringify(
                reveal ? config : redactConfig(config),
                null,
                2,
            ),
            redacted: !reveal,
            running: Boolean(runtime?.handle),
            sourcePath: this.sourcePath,
            coreVersion: this.core.getInfo().version,
        };
    }

    assertStopped(id) {
        const runtime = this.runtimes.get(id);
        if (
            runtime?.handle ||
            runtime?.starting ||
            runtime?.stopping ||
            this.recyclingPromises.has(id)
        ) {
            throw new Error('请先停止此代理，再修改或删除');
        }
    }

    persist(records) {
        try {
            this.store.set('proxies', records);
            this.records = records;
            const validIds = new Set(records.map((item) => item.id));
            for (const key of this.summaryCache.keys()) {
                if (!validIds.has(key)) {
                    this.summaryCache.delete(key);
                }
            }
        } catch {
            throw new Error('代理配置保存失败');
        }
    }

    async save(input) {
        if (this.closed) throw new Error('代理服务正在退出');
        if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error('代理配置无效');
        const previous = input.id ? this.find(input.id) : undefined;
        if (previous) this.assertStopped(previous.id);
        const name = validateName(input.name);
        let data;
        if (input.mode === 'json') {
            data = { mode: 'json', config: normalizeProxyConfig(input.config) };
        } else if (input.mode === 'line' && isAdvancedProxyUri(input.line)) {
            const parsed = parseProxyUriToOutbound(input.line);
            data = {
                mode: 'json',
                config: normalizeProxyConfig(parsed.config),
            };
        } else {
            let simple;
            if (input.mode === 'line') {
                simple = parseProxyLine(input.line);
            } else {
                if (input.mode && input.mode !== 'simple')
                    throw new Error('代理输入方式无效');
                const oldSimple =
                    input.password === undefined && previous
                        ? this.payload(previous).simple
                        : undefined;
                simple = {
                    protocol: input.protocol,
                    host: input.host,
                    port: input.port,
                    username: input.username ?? '',
                    password: input.password ?? oldSimple?.password ?? '',
                };
            }
            data = {
                mode: 'simple',
                simple,
                config: simpleProxyToConfig(simple),
            };
        }
        if (!this.encryptionAvailable())
            throw new Error('系统安全存储不可用，无法保存代理配置');
        await this.core.check(buildSingboxConfig(data.config, 0));
        if (this.closed) throw new Error('代理服务正在退出');
        if (previous) this.assertStopped(previous.id);
        let encrypted;
        try {
            encrypted = this.secretStorage
                .encryptString(JSON.stringify(data))
                .toString('base64');
        } catch {
            throw new Error('代理配置加密失败');
        }
        const record = {
            id: previous?.id || randomUUID(),
            name,
            payload: encrypted,
            version: 2,
        };
        this.persist(
            previous
                ? this.records.map((item) =>
                      item.id === record.id ? record : item,
                  )
                : [...this.records, record],
        );
        this.summaryCache.set(record.id, {
            token: buildRecordCacheToken(record),
            meta: extractSummaryMetadata(data),
        });
        this.runtimes.delete(record.id);
        this.addLog(record.id, 'info', 'sing-box 配置校验通过，已加密保存');
        this.notifyChange('state', record.id);
        return this.summary(record);
    }

    async batchImport({ text, namePrefix = '代理', skipDuplicates = true } = {}) {
        if (this.closed) throw new Error('代理服务正在退出');
        const existingKeys = [];
        for (const record of this.records) {
            const { meta } = this.resolveSummaryMetadata(record);
            if (meta && meta.host && meta.port) {
                existingKeys.push(
                    meta.endpointKey ||
                        buildProxyEndpointKey({
                            protocol: meta.protocol,
                            host: meta.host,
                            port: meta.port,
                            username: meta.username,
                        }),
                );
            }
        }
        const parsed = parseBatchProxyText(text, {
            namePrefix,
            existingKeys,
        });
        const imported = [];
        const skippedDuplicates = [];
        const errors = [...parsed.errors];
        const candidates = [];

        for (const item of parsed.items) {
            if (item.duplicate && skipDuplicates) {
                skippedDuplicates.push({
                    lineNumber: item.lineNumber,
                    name: item.name,
                    host: item.host ?? item.simple?.host ?? '',
                    port: item.port ?? item.simple?.port ?? 0,
                });
                continue;
            }
            candidates.push(item);
        }

        if (candidates.length > 0) {
            const outcomes = await runWithConcurrency(
                candidates,
                BATCH_CHECK_CONCURRENCY,
                async (item) => {
                    if (this.closed) {
                        return {
                            ok: false,
                            item,
                            error: '代理服务正在退出',
                        };
                    }
                    try {
                        const name = validateName(item.name);
                        let data;
                        if (
                            item.mode === 'json' ||
                            isAdvancedProxyUri(item.line)
                        ) {
                            const parsedUri =
                                item.parsed ||
                                parseProxyUriToOutbound(item.line);
                            data = {
                                mode: 'json',
                                config: normalizeProxyConfig(parsedUri.config),
                            };
                        } else {
                            const simple =
                                item.simple || parseProxyLine(item.line);
                            data = {
                                mode: 'simple',
                                simple,
                                config: simpleProxyToConfig(simple),
                            };
                        }
                        if (!this.encryptionAvailable()) {
                            throw new Error(
                                '系统安全存储不可用，无法保存代理配置',
                            );
                        }
                        await this.core.check(
                            buildSingboxConfig(data.config, 0),
                        );
                        if (this.closed) {
                            throw new Error('代理服务正在退出');
                        }
                        let encrypted;
                        try {
                            encrypted = this.secretStorage
                                .encryptString(JSON.stringify(data))
                                .toString('base64');
                        } catch {
                            throw new Error('代理配置加密失败');
                        }
                        const record = {
                            id: randomUUID(),
                            name,
                            payload: encrypted,
                            version: 2,
                        };
                        return {
                            ok: true,
                            item,
                            record,
                            meta: extractSummaryMetadata(data),
                        };
                    } catch (error) {
                        return {
                            ok: false,
                            item,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : '代理保存失败',
                        };
                    }
                },
            );

            if (this.closed) {
                throw new Error('代理服务正在退出');
            }

            const newRecords = [];
            const newMetaEntries = [];
            for (const outcome of outcomes) {
                if (outcome.ok) {
                    newRecords.push(outcome.record);
                    newMetaEntries.push({
                        id: outcome.record.id,
                        token: buildRecordCacheToken(outcome.record),
                        meta: outcome.meta,
                    });
                } else {
                    errors.push({
                        lineNumber: outcome.item.lineNumber,
                        raw: redactProxyUri(outcome.item.line).slice(0, 120),
                        error: outcome.error,
                    });
                }
            }

            if (newRecords.length > 0) {
                this.persist([...this.records, ...newRecords]);
                for (const entry of newMetaEntries) {
                    this.summaryCache.set(entry.id, {
                        token: entry.token,
                        meta: entry.meta,
                    });
                }
                for (const record of newRecords) {
                    this.addLog(
                        record.id,
                        'info',
                        'sing-box 配置校验通过，已加密保存',
                    );
                    imported.push(this.summary(record));
                }
                this.notifyChange('state');
            }
        }

        return {
            imported,
            skippedDuplicates,
            errors,
        };
    }

    async remove(id) {
        this.find(id);
        this.assertStopped(id);
        this.persist(this.records.filter((item) => item.id !== id));
        this.summaryCache.delete(id);
        this.runtimes.delete(id);
        this.stopGenerations.delete(id);
        this.clearLogs(id);
        this.notifyChange('state', id);
    }

    addLog(proxyId, level, message) {
        this.logs.push({
            id: randomUUID(),
            proxyId,
            time: new Date().toISOString(),
            level,
            message,
        });
        if (this.logs.length > MAX_LOGS)
            this.logs.splice(0, this.logs.length - MAX_LOGS);
        this.notifyChange('log', proxyId);
    }

    getLogs(id) {
        return this.logs
            .filter((item) => !id || item.proxyId === id)
            .map((item) => ({ ...item }));
    }

    clearLogs(id) {
        this.logs = id ? this.logs.filter((item) => item.proxyId !== id) : [];
        this.notifyChange('log', id);
    }

    cancelExitProbe(runtime) {
        runtime.exitAbort?.abort();
        runtime.exitAbort = null;
        runtime.exitProbePromise = null;
        runtime.exitInfo = { status: 'idle' };
        runtime.lastExitProbeAt = 0;
    }

    async refreshExitInfo(id) {
        if (this.closed) throw new Error('代理服务正在退出');
        this.find(id);
        const runtime = this.runtimes.get(id);
        if (!runtime?.handle || runtime.stopping)
            throw new Error('请先启动代理，再检测出口');
        if (runtime.exitProbePromise) return runtime.exitProbePromise;
        if (
            runtime.exitInfo.status !== 'idle' &&
            this.now() - runtime.lastExitProbeAt < EXIT_PROBE_COOLDOWN_MS
        )
            return { ...runtime.exitInfo };

        const controller = new AbortController();
        runtime.exitAbort = controller;
        const startedAt = this.now();
        runtime.lastExitProbeAt = startedAt;
        runtime.exitInfo = { status: 'checking' };
        this.notifyChange('state', id);
        const isCurrent = () =>
            this.runtimes.get(id) === runtime &&
            runtime.exitAbort === controller &&
            !controller.signal.aborted &&
            Boolean(runtime.handle) &&
            !runtime.stopping &&
            !this.closed;
        const probeOptions = this.getLocale
            ? { signal: controller.signal, locale: this.getLocale() }
            : { signal: controller.signal };
        const pending = Promise.resolve()
            .then(() => {
                if (!isCurrent()) return null;
                return this.exitProbe(runtime.localAddress, probeOptions);
            })
            .then((result) => {
                if (isCurrent() && result) {
                    const finishedAt = this.now();
                    const latencyMs = Math.max(0, finishedAt - startedAt);
                    runtime.exitInfo = {
                        ...result,
                        latencyMs,
                        status: 'ready',
                        checkedAt: new Date(finishedAt).toISOString(),
                    };
                    runtime.lastActiveAt = finishedAt;
                    if (runtime.staleReason === 'upstream-error') {
                        runtime.staleReason = null;
                    }
                    if (runtime.lastError) {
                        runtime.lastError = undefined;
                    }
                    this.addLog(
                        id,
                        'info',
                        `出口检测完成：${result.ip} (${latencyMs}ms)`,
                    );
                    this.notifyChange('state', id);
                }
                return { ...runtime.exitInfo };
            })
            .catch(() => {
                if (isCurrent()) {
                    runtime.exitInfo = {
                        status: 'error',
                        error: '出口检测失败，请稍后重试',
                        checkedAt: new Date(this.now()).toISOString(),
                    };
                    if (!runtime.staleReason) {
                        runtime.staleReason = 'upstream-error';
                    }
                    this.addLog(
                        id,
                        'error',
                        '出口检测失败，请稍后重试；代理服务仍在运行',
                    );
                    this.notifyChange('state', id);
                }
                return { ...runtime.exitInfo };
            })
            .finally(() => {
                if (runtime.exitProbePromise === pending) {
                    runtime.exitProbePromise = null;
                    runtime.exitAbort = null;
                }
            });
        runtime.exitProbePromise = pending;
        return pending;
    }

    touchActivity(id) {
        const runtime = this.runtimes.get(id);
        if (runtime?.handle && !runtime.stopping) {
            runtime.lastActiveAt = this.now();
        }
    }

    markAllStale(reason = 'system-resume') {
        for (const runtime of this.runtimes.values()) {
            if (runtime?.handle && !runtime.stopping) {
                runtime.staleReason = reason;
            }
        }
    }

    getStaleReason(id) {
        const runtime = this.runtimes.get(id);
        if (!runtime?.handle || runtime.stopping) return null;
        if (runtime.staleReason) return runtime.staleReason;
        const baseline = runtime.lastActiveAt || runtime.startedAt || 0;
        if (
            this.idleRecycleMs > 0 &&
            baseline > 0 &&
            this.now() - baseline >= this.idleRecycleMs
        ) {
            return 'idle-timeout';
        }
        return null;
    }

    /**
     * Ensure the proxy is started and — if no browser is currently bound to its
     * local listener — transparently recycle an idle/sleep-stale/errored
     * sing-box process onto a fresh local TCP + UDP port before browser launch.
     *
     * @param {string} id
     * @param {{ isInUse?: (proxyId: string) => boolean | Promise<boolean> }} [options]
     */
    async ensureFresh(id, { isInUse } = {}) {
        if (this.closed) throw new Error('代理服务正在退出');
        this.find(id);
        const stopGen = this.stopGenerations.get(id) || 0;

        const inflightRecycle = this.recyclingPromises.get(id);
        if (inflightRecycle) return inflightRecycle;

        const runtime = this.runtimes.get(id);
        if (runtime?.stopping) {
            await runtime.stopping;
            if (
                this.closed ||
                (this.stopGenerations.get(id) || 0) !== stopGen
            ) {
                throw new Error('代理服务启动已取消');
            }
            return this.ensureFresh(id, { isInUse });
        }
        if (runtime?.starting) return runtime.starting;
        if (!runtime?.handle) return this.ensureStartedInternal(id);

        const staleReason = this.getStaleReason(id);
        if (!staleReason) {
            this.touchActivity(id);
            return runtime.localAddress;
        }

        let inUse = false;
        if (typeof isInUse === 'function') {
            try {
                inUse = Boolean(await isInUse(id));
            } catch {
                // Fail-safe: never tear down a listener if active browser usage cannot be verified.
                inUse = true;
            }
        }

        if (this.closed) throw new Error('代理服务正在退出');
        if ((this.stopGenerations.get(id) || 0) !== stopGen) {
            throw new Error('代理服务启动已取消');
        }
        const concurrentRecycle = this.recyclingPromises.get(id);
        if (concurrentRecycle) return concurrentRecycle;

        const current = this.runtimes.get(id);
        if (current?.stopping) {
            await current.stopping;
            if (
                this.closed ||
                (this.stopGenerations.get(id) || 0) !== stopGen
            ) {
                throw new Error('代理服务启动已取消');
            }
            return this.ensureFresh(id, { isInUse });
        }
        if (current?.starting) return current.starting;
        if (!current?.handle) return this.ensureStartedInternal(id);

        if (inUse) {
            this.touchActivity(id);
            return current.localAddress;
        }

        const currentReason = this.getStaleReason(id);
        if (!currentReason) {
            this.touchActivity(id);
            return current.localAddress;
        }

        let startRecycle;
        const recycleTask = new Promise((resolve, reject) => {
            startRecycle = () =>
                (async () => {
                    const logMessage =
                        currentReason === 'system-resume'
                            ? '检测到系统从休眠恢复，正在重建 sing-box 通道'
                            : currentReason === 'upstream-error'
                              ? '检测到代理先前出现连接异常，正在重建 sing-box 通道'
                              : '检测到代理长时间闲置，正在重建 sing-box 通道以避免首开卡顿';
                    this.addLog(id, 'info', logMessage);
                    await this.stopInternal(id);
                    if (this.closed) throw new Error('代理服务正在退出');
                    if ((this.stopGenerations.get(id) || 0) !== stopGen) {
                        throw new Error('代理服务启动已取消');
                    }
                    return await this.ensureStartedInternal(id);
                })().then(resolve, reject);
        });

        this.recyclingPromises.set(id, recycleTask);
        startRecycle();
        try {
            return await recycleTask;
        } finally {
            if (this.recyclingPromises.get(id) === recycleTask) {
                this.recyclingPromises.delete(id);
            }
        }
    }

    async ensureStarted(id) {
        if (this.closed) throw new Error('代理服务正在退出');
        this.find(id);
        const inflightRecycle = this.recyclingPromises.get(id);
        if (inflightRecycle) return inflightRecycle;
        return this.ensureStartedInternal(id);
    }

    async ensureStartedInternal(id) {
        if (this.closed) throw new Error('代理服务正在退出');
        const record = this.find(id);
        let runtime = this.runtimes.get(id);
        if (runtime?.stopping) {
            await runtime.stopping;
            return this.ensureStartedInternal(id);
        }
        if (runtime?.starting) return runtime.starting;
        if (runtime?.handle) {
            runtime.lastActiveAt = this.now();
            return runtime.localAddress;
        }
        runtime = {
            handle: null,
            starting: null,
            stopping: null,
            lastError: undefined,
            port: 0,
            localAddress: undefined,
            config: null,
            startedAt: 0,
            lastActiveAt: 0,
            staleReason: null,
            exitInfo: { status: 'idle' },
            exitProbePromise: null,
            exitAbort: null,
            lastExitProbeAt: 0,
        };
        this.runtimes.set(id, runtime);
        runtime.starting = this.start(record, runtime);
        try {
            return await runtime.starting;
        } finally {
            runtime.starting = null;
        }
    }

    async start(record, runtime) {
        let exited = false;
        try {
            runtime.port = await reserveLocalPort();
            runtime.config = buildSingboxConfig(
                this.payload(record).config,
                runtime.port,
            );
            await this.core.check(runtime.config);
            const handle = await this.core.start(runtime.config, {
                onLog: ({ level, message }) => {
                    this.addLog(record.id, level, message);
                    if (level === 'error') {
                        runtime.lastError = message;
                        if (!runtime.staleReason) {
                            runtime.staleReason = 'upstream-error';
                        }
                        this.notifyChange('state', record.id);
                    }
                },
                onExit: ({ unexpected }) => {
                    exited = true;
                    this.cancelExitProbe(runtime);
                    runtime.handle = null;
                    runtime.localAddress = undefined;
                    runtime.config = null;
                    runtime.startedAt = 0;
                    runtime.lastActiveAt = 0;
                    runtime.staleReason = null;
                    if (unexpected) {
                        runtime.lastError =
                            'sing-box 意外退出，浏览器代理连接已中断；请关闭环境后重新启动';
                        this.addLog(record.id, 'error', runtime.lastError);
                    }
                    this.notifyChange('state', record.id);
                },
            });
            if (exited || this.closed) {
                await handle.stop();
                throw new Error('代理服务启动已取消');
            }
            const startedAt = this.now();
            runtime.handle = handle;
            runtime.localAddress = `http://127.0.0.1:${runtime.port}`;
            runtime.startedAt = startedAt;
            runtime.lastActiveAt = startedAt;
            runtime.staleReason = null;
            runtime.lastError = undefined;
            this.addLog(
                record.id,
                'info',
                `sing-box 已启动 ${runtime.localAddress}`,
            );
            this.notifyChange('state', record.id);
            // Browser startup does not wait for the external geolocation service.
            void this.refreshExitInfo(record.id).catch(() => {});
            return runtime.localAddress;
        } catch (error) {
            runtime.config = null;
            runtime.lastError = resolveSafeStartError(error);
            this.addLog(record.id, 'error', runtime.lastError);
            this.notifyChange('state', record.id);
            throw new Error(runtime.lastError);
        }
    }

    async stop(id) {
        this.find(id);
        this.stopGenerations.set(id, (this.stopGenerations.get(id) || 0) + 1);
        const inflightRecycle = this.recyclingPromises.get(id);
        if (inflightRecycle) {
            await inflightRecycle.catch(() => {});
        }
        return this.stopInternal(id);
    }

    async stopInternal(id) {
        this.find(id);
        const runtime = this.runtimes.get(id);
        if (!runtime) return;
        if (runtime.stopping) return runtime.stopping;
        runtime.stopping = (async () => {
            this.cancelExitProbe(runtime);
            if (runtime.starting) await runtime.starting.catch(() => {});
            this.cancelExitProbe(runtime);
            if (runtime.handle) {
                await runtime.handle.stop();
                runtime.handle = null;
                runtime.localAddress = undefined;
                runtime.config = null;
                runtime.startedAt = 0;
                runtime.lastActiveAt = 0;
                runtime.staleReason = null;
                this.addLog(id, 'info', 'sing-box 已停止');
            }
            runtime.lastError = undefined;
            this.notifyChange('state', id);
        })();
        try {
            await runtime.stopping;
        } finally {
            runtime.stopping = null;
        }
    }

    async closeAll() {
        this.closed = true;
        await Promise.all(this.records.map((record) => this.stop(record.id)));
        this.summaryCache.clear();
    }
}
