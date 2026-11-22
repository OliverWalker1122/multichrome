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

const MAX_LOGS = 1000;
const EXIT_PROBE_COOLDOWN_MS = 15000;

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
    }) {
        this.store = store;
        this.secretStorage = secretStorage;
        this.exitProbe = exitProbe;
        this.now = now;
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
        this.logs = [];
        this.closed = false;
        const saved = store.get('proxies', []);
        if (!Array.isArray(saved)) throw new Error('代理配置格式无效');
        this.records = saved;
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

    summary(record) {
        const runtime = this.runtimes.get(record.id);
        let data;
        let credentialError;
        try {
            data = this.payload(record);
        } catch {
            credentialError = '代理配置无法解密，请重新配置';
        }
        const config = data?.config;
        const main = [
            ...(config?.outbounds || []),
            ...(config?.endpoints || []),
        ].find((item) => item.tag === config?.route?.final);
        const simple = data?.simple;
        return {
            id: record.id,
            name: record.name,
            mode: data?.mode || 'json',
            protocol: simple?.protocol || main?.type || 'sing-box',
            host: simple?.host || main?.server || '',
            port: simple?.port || main?.server_port || 0,
            username: simple?.username || '',
            hasPassword:
                data?.mode === 'json' ? true : Boolean(simple?.password),
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
        if (runtime?.handle || runtime?.starting || runtime?.stopping) {
            throw new Error('请先停止此代理，再修改或删除');
        }
    }

    persist(records) {
        try {
            this.store.set('proxies', records);
            this.records = records;
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
        this.runtimes.delete(record.id);
        this.addLog(record.id, 'info', 'sing-box 配置校验通过，已加密保存');
        return this.summary(record);
    }

    async batchImport({ text, namePrefix = '代理', skipDuplicates = true } = {}) {
        if (this.closed) throw new Error('代理服务正在退出');
        const existingKeys = [];
        for (const record of this.records) {
            try {
                const data = this.payload(record);
                if (data?.simple) {
                    existingKeys.push(buildProxyEndpointKey(data.simple));
                }
            } catch {
                // ignore unreadable legacy entries
            }
        }
        const parsed = parseBatchProxyText(text, {
            namePrefix,
            existingKeys,
        });
        const imported = [];
        const skippedDuplicates = [];
        const errors = [...parsed.errors];

        for (const item of parsed.items) {
            if (item.duplicate && skipDuplicates) {
                skippedDuplicates.push({
                    lineNumber: item.lineNumber,
                    name: item.name,
                    host: item.simple.host,
                    port: item.simple.port,
                });
                continue;
            }
            try {
                const saved = await this.save({
                    name: item.name,
                    mode: 'line',
                    line: item.line,
                });
                imported.push(saved);
            } catch (error) {
                errors.push({
                    lineNumber: item.lineNumber,
                    raw: item.line.slice(0, 120),
                    error:
                        error instanceof Error
                            ? error.message
                            : '代理保存失败',
                });
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
        this.runtimes.delete(id);
        this.clearLogs(id);
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
    }
    getLogs(id) {
        return this.logs
            .filter((item) => !id || item.proxyId === id)
            .map((item) => ({ ...item }));
    }
    clearLogs(id) {
        this.logs = id ? this.logs.filter((item) => item.proxyId !== id) : [];
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
        const isCurrent = () =>
            this.runtimes.get(id) === runtime &&
            runtime.exitAbort === controller &&
            !controller.signal.aborted &&
            Boolean(runtime.handle) &&
            !runtime.stopping &&
            !this.closed;
        const pending = Promise.resolve()
            .then(() => {
                if (!isCurrent()) return null;
                return this.exitProbe(runtime.localAddress, {
                    signal: controller.signal,
                });
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
                    this.addLog(
                        id,
                        'info',
                        `出口检测完成：${result.ip} (${latencyMs}ms)`,
                    );
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
                    this.addLog(
                        id,
                        'error',
                        '出口检测失败，请稍后重试；代理服务仍在运行',
                    );
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

    async ensureStarted(id) {
        if (this.closed) throw new Error('代理服务正在退出');
        const record = this.find(id);
        let runtime = this.runtimes.get(id);
        if (runtime?.stopping) {
            await runtime.stopping;
            return this.ensureStarted(id);
        }
        if (runtime?.starting) return runtime.starting;
        if (runtime?.handle) return runtime.localAddress;
        runtime = {
            handle: null,
            starting: null,
            stopping: null,
            lastError: undefined,
            port: 0,
            localAddress: undefined,
            config: null,
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
                    if (level === 'error') runtime.lastError = message;
                },
                onExit: ({ unexpected }) => {
                    exited = true;
                    this.cancelExitProbe(runtime);
                    runtime.handle = null;
                    runtime.localAddress = undefined;
                    runtime.config = null;
                    if (unexpected) {
                        runtime.lastError =
                            'sing-box 意外退出，浏览器代理连接已中断；请关闭环境后重新启动';
                        this.addLog(record.id, 'error', runtime.lastError);
                    }
                },
            });
            if (exited || this.closed) {
                await handle.stop();
                throw new Error('代理服务启动已取消');
            }
            runtime.handle = handle;
            runtime.localAddress = `http://127.0.0.1:${runtime.port}`;
            this.addLog(
                record.id,
                'info',
                `sing-box 已启动 ${runtime.localAddress}`,
            );
            // Browser startup does not wait for the external geolocation service.
            void this.refreshExitInfo(record.id).catch(() => {});
            return runtime.localAddress;
        } catch {
            runtime.config = null;
            runtime.lastError = 'sing-box 启动失败，请检查核心、配置和本地端口';
            this.addLog(record.id, 'error', runtime.lastError);
            throw new Error(runtime.lastError);
        }
    }

    async stop(id) {
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
                this.addLog(id, 'info', 'sing-box 已停止');
            }
            runtime.lastError = undefined;
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
    }
}
