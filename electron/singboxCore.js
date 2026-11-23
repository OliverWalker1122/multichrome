import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
const activeChildren = new Set();
const killActiveChildren = () => {
    for (const child of activeChildren)
        if (child.exitCode === null) child.kill('SIGKILL');
};

function configPayload(config) {
    let payload;
    try {
        payload = JSON.stringify(config);
    } catch {
        throw new Error('sing-box 配置无法序列化');
    }
    if (!payload || Buffer.byteLength(payload) > 1024 * 1024)
        throw new Error('sing-box 配置超过大小限制');
    return payload;
}

const ANSI_ESC = String.fromCharCode(27);
const ANSI_ESCAPE_REGEX = new RegExp(`${ANSI_ESC}\\[[0-9;]*[A-Za-z]`, 'g');

export function stripAnsi(text) {
    return typeof text === 'string'
        ? text.replace(ANSI_ESCAPE_REGEX, '')
        : '';
}

function checkFailure(text) {
    const clean = stripAnsi(text);
    if (/unknown outbound type|unknown endpoint type/i.test(clean))
        return '此出口类型不受内置 sing-box 核心支持';
    if (/unknown field|unmarshal|decode config|invalid character/i.test(clean))
        return 'sing-box 配置字段或语法无效，请检查当前核心版本的配置格式';
    if (/deprecated|removed in/i.test(clean))
        return '配置使用了已移除的 sing-box 字段，请按当前核心版本迁移';
    if (/uuid/i.test(clean)) return 'sing-box UUID 配置无效';
    if (/certificate|private key|public key|tls/i.test(clean))
        return 'sing-box TLS 或密钥配置无效';
    if (/outbound.*not found|detour.*not found/i.test(clean))
        return 'sing-box 引用了不存在的出口';
    return 'sing-box 配置校验失败，请检查协议参数及依赖配置';
}

export function safeLog(line) {
    const clean = stripAnsi(line);
    if (!clean) return null;
    if (/\b(FATAL|ERROR|WARN)\b/i.test(clean)) {
        // Local browser/client closing an idle HTTP keep-alive socket to 127.0.0.1 is benign.
        if (/read http request:.*use of closed network connection/i.test(clean)) {
            return null;
        }
        if (/reality verification failed/i.test(clean))
            return {
                level: 'error',
                message:
                    'REALITY 握手校验失败，请检查公钥/Short ID/SNI，或排查透明代理的 TLS 域名嗅探覆写',
            };
        if (/authentication|authenticate|407|401/i.test(clean))
            return {
                level: 'error',
                message: '上游代理认证失败，请检查认证配置',
            };
        if (/address already in use|bind:/i.test(clean))
            return { level: 'error', message: '本地代理端口被占用' };
        if (/timeout|timed out|deadline exceeded/i.test(clean))
            return { level: 'error', message: '代理连接超时' };
        if (/\btls:|x509:|handshake/i.test(clean))
            return {
                level: 'error',
                message: '上游 TLS 握手失败，请检查证书、SNI 或协议配置',
            };
        if (/refused|reset|closed|eof|broken pipe/i.test(clean))
            return { level: 'error', message: '代理连接中断或上游不可达' };
        return {
            level: 'error',
            message: 'sing-box 连接或配置发生错误，请检查上游配置',
        };
    }
    const target = clean.match(
        /(?:inbound connection to|outbound connection to) ([a-z0-9.[\]:_-]{1,260})(?:\s|$)/i,
    )?.[1];
    if (target) return { level: 'info', message: `连接目标 ${target}` };
    if (clean.includes('sing-box started'))
        return { level: 'info', message: 'sing-box 核心已就绪' };
    return null;
}

function consumeLines(stream, callback) {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            callback(line.slice(0, 8192));
        }
        // A malicious or malformed message cannot grow the retained buffer.
        if (buffer.length > 16384) buffer = buffer.slice(-8192);
    });
    stream.on('end', () => {
        if (buffer) callback(buffer.slice(0, 8192));
    });
}

async function probe(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port });
        const finish = (result) => {
            socket.destroy();
            resolve(result);
        };
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.setTimeout(200, () => finish(false));
    });
}

export class SingboxCore {
    constructor({
        binaryPath = '',
        resolveBinary = null,
        workingDirectory,
        version = '1.14.4',
        checkTimeoutMs = 10000,
        startTimeoutMs = 10000,
    }) {
        this.binaryPath = binaryPath;
        this.resolveBinary = typeof resolveBinary === 'function' ? resolveBinary : null;
        this.workingDirectory = workingDirectory;
        this.version = version;
        this.checkTimeoutMs = checkTimeoutMs;
        this.startTimeoutMs = startTimeoutMs;
    }

    resolveCurrentBinary() {
        if (this.resolveBinary) {
            const resolved = this.resolveBinary();
            if (resolved?.binaryPath && existsSync(resolved.binaryPath)) {
                return {
                    binaryPath: resolved.binaryPath,
                    version: resolved.version || this.version,
                    available: true,
                };
            }
        }
        if (this.binaryPath && existsSync(this.binaryPath)) {
            let detectedVersion = this.version;
            try {
                const metadata = JSON.parse(
                    readFileSync(
                        path.join(path.dirname(this.binaryPath), 'core.json'),
                        'utf8',
                    ),
                );
                if (
                    typeof metadata.version === 'string' &&
                    /^\d+\.\d+\.\d+/.test(metadata.version)
                ) {
                    detectedVersion = metadata.version;
                }
            } catch {
                /* Public bundled version metadata is optional in tests. */
            }
            return {
                binaryPath: this.binaryPath,
                version: detectedVersion,
                available: true,
            };
        }
        return {
            binaryPath: this.binaryPath || '',
            version: '',
            available: false,
        };
    }

    getInfo() {
        const resolved = this.resolveCurrentBinary();
        return {
            version: resolved.version,
            available: resolved.available,
            binaryPath: resolved.available ? resolved.binaryPath : '',
        };
    }

    spawn(command, payload) {
        const resolved = this.resolveCurrentBinary();
        if (!resolved.available || !resolved.binaryPath) {
            throw new Error(
                '尚未安装 sing-box 代理核心，请前往「设置 → 代理核心（sing-box）」下载官方核心',
            );
        }
        let child;
        try {
            const args = [command, '-c', 'stdin'];
            if (this.workingDirectory) args.push('-D', this.workingDirectory);
            child = spawn(resolved.binaryPath, args, {
                windowsHide: true,
                cwd: this.workingDirectory,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch {
            throw new Error(
                '无法启动 sing-box 核心，请前往「设置」重新下载官方核心',
            );
        }
        child.stdin.on('error', () => {});
        child.stdin.end(payload);
        return child;
    }

    async check(config) {
        const payload = configPayload(config);
        return new Promise((resolve, reject) => {
            const child = this.spawn('check', payload);
            let output = '';
            let settled = false;
            const done = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve();
            };
            const collect = (chunk) => {
                if (output.length < 65536)
                    output += chunk.toString().slice(0, 65536 - output.length);
            };
            child.stdout.on('data', collect);
            child.stderr.on('data', collect);
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                done(new Error('sing-box 配置校验超时'));
            }, this.checkTimeoutMs);
            child.once('error', () =>
                done(new Error('无法启动内置 sing-box，请重新安装程序')),
            );
            child.once('close', (code) =>
                done(code === 0 ? undefined : new Error(checkFailure(output))),
            );
        });
    }

    async start(config, { onLog = () => {}, onExit = () => {} } = {}) {
        const inbound = config?.inbounds?.[0];
        if (
            inbound?.listen !== '127.0.0.1' ||
            !Number.isInteger(inbound.listen_port) ||
            inbound.listen_port < 1 ||
            inbound.listen_port > 65535
        ) {
            throw new Error('sing-box 本地监听配置无效');
        }
        const child = this.spawn('run', configPayload(config));
        activeChildren.add(child);
        if (activeChildren.size === 1) process.once('exit', killActiveChildren);
        let exited = false;
        let stopping = false;
        let readyMessage = false;
        let closeResolve;
        let stopPromise;
        const closed = new Promise((resolve) => {
            closeResolve = resolve;
        });
        const recordLine = (line) => {
            if (line.includes('sing-box started')) readyMessage = true;
            const message = safeLog(line);
            if (message) onLog(message);
        };
        consumeLines(child.stdout, recordLine);
        consumeLines(child.stderr, recordLine);
        const finish = (code) => {
            if (exited) return;
            exited = true;
            activeChildren.delete(child);
            if (activeChildren.size === 0)
                process.removeListener('exit', killActiveChildren);
            closeResolve();
            onExit({ unexpected: !stopping, code });
        };
        child.once('error', () => finish(null));
        child.once('close', finish);
        const waitForExit = async (milliseconds) => {
            let timer;
            try {
                await Promise.race([
                    closed,
                    new Promise((resolve) => {
                        timer = setTimeout(resolve, milliseconds);
                    }),
                ]);
            } finally {
                clearTimeout(timer);
            }
        };
        const stop = () => {
            if (stopPromise) return stopPromise;
            stopping = true;
            stopPromise = (async () => {
                if (exited) return;
                child.kill();
                await waitForExit(3000);
                if (!exited) {
                    child.kill('SIGKILL');
                    await waitForExit(2000);
                }
                if (!exited)
                    throw new Error('sing-box 核心未能停止，请重试退出');
            })();
            return stopPromise;
        };
        const deadline = Date.now() + this.startTimeoutMs;
        while (!exited && Date.now() < deadline) {
            if (readyMessage && (await probe(inbound.listen_port))) {
                if (!exited) return { stop };
            }
            await wait(40);
        }
        await stop();
        throw new Error('sing-box 启动失败，请检查配置和本地端口');
    }
}
