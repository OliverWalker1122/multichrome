import net from 'net';
import tls from 'tls';
import {
    GEO_PROBE_TARGETS,
    IP_ONLY_PROBE_TARGETS,
    parseGeoProbeResponse,
} from './proxyGeo.js';

export const PROXY_IP_PROBE_TARGETS = [
    { host: 'api.ipify.org', path: '/' },
    { host: 'ipinfo.io', path: '/ip' },
    { host: 'ipv4.icanhazip.com', path: '/' },
    { host: 'ifconfig.me', path: '/ip' },
    { host: 'checkip.amazonaws.com', path: '/' },
];

class BufferedSocketReader {
    constructor(socket) {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.ended = false;
        this.error = null;
        this.pendingReads = [];
        this.pendingReadAll = [];

        this.socket.on('data', (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.flush();
        });
        this.socket.on('end', () => {
            this.ended = true;
            this.flush();
        });
        this.socket.on('close', () => {
            this.ended = true;
            this.flush();
        });
        this.socket.on('error', (error) => {
            this.error = error;
            this.flush();
        });
    }

    read(size, timeoutMs = 5000) {
        if (size <= 0) return Promise.resolve(Buffer.alloc(0));
        if (this.error) return Promise.reject(this.error);
        if (this.buffer.length >= size) {
            const chunk = this.buffer.subarray(0, size);
            this.buffer = this.buffer.subarray(size);
            return Promise.resolve(chunk);
        }
        if (this.ended) {
            return Promise.reject(
                new Error('socket ended before enough data was received'),
            );
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingReads = this.pendingReads.filter(
                    (waiter) => waiter.resolve !== resolve,
                );
                reject(new Error('socket read timeout'));
            }, timeoutMs);
            this.pendingReads.push({ size, resolve, reject, timer });
        });
    }

    readAll(timeoutMs = 5000) {
        if (this.error) return Promise.reject(this.error);
        if (this.ended) {
            const remaining = this.buffer;
            this.buffer = Buffer.alloc(0);
            return Promise.resolve(remaining);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingReadAll = this.pendingReadAll.filter(
                    (waiter) => waiter.resolve !== resolve,
                );
                reject(new Error('socket readAll timeout'));
            }, timeoutMs);
            this.pendingReadAll.push({ resolve, reject, timer });
        });
    }

    flush() {
        while (this.pendingReads.length > 0) {
            const waiter = this.pendingReads[0];
            if (this.buffer.length >= waiter.size) {
                clearTimeout(waiter.timer);
                const chunk = this.buffer.subarray(0, waiter.size);
                this.buffer = this.buffer.subarray(waiter.size);
                this.pendingReads.shift();
                waiter.resolve(chunk);
                continue;
            }
            if (this.error || this.ended) {
                clearTimeout(waiter.timer);
                this.pendingReads.shift();
                waiter.reject(
                    this.error ||
                        new Error(
                            'socket ended before enough data was received',
                        ),
                );
                continue;
            }
            break;
        }

        if (this.error) {
            while (this.pendingReadAll.length > 0) {
                const waiter = this.pendingReadAll.shift();
                clearTimeout(waiter.timer);
                waiter.reject(this.error);
            }
            return;
        }

        if (this.ended) {
            while (this.pendingReadAll.length > 0) {
                const waiter = this.pendingReadAll.shift();
                clearTimeout(waiter.timer);
                const remaining = this.buffer;
                this.buffer = Buffer.alloc(0);
                waiter.resolve(remaining);
            }
        }
    }
}

function getDefaultProxyPort(protocol) {
    switch (protocol) {
        case 'https:':
            return 443;
        case 'socks:':
        case 'socks5:':
            return 1080;
        case 'http:':
        default:
            return 80;
    }
}

export function parseProxyAddress(proxyAddress) {
    try {
        const normalized = proxyAddress.includes('://')
            ? proxyAddress
            : `http://${proxyAddress}`;
        const parsed = new URL(normalized);
        const protocol = parsed.protocol;
        if (!['http:', 'https:', 'socks:', 'socks5:'].includes(protocol)) {
            return null;
        }
        return {
            protocol,
            host: parsed.hostname,
            port: parsed.port
                ? parseInt(parsed.port, 10)
                : getDefaultProxyPort(protocol),
            username: parsed.username
                ? decodeURIComponent(parsed.username)
                : undefined,
            password: parsed.password
                ? decodeURIComponent(parsed.password)
                : undefined,
        };
    } catch {
        return null;
    }
}

function extractIPv4(text) {
    const match = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    return match ? match[0] : null;
}

export function extractIPv4FromHttpResponse(buffer) {
    const text = buffer.toString('utf-8');
    const body = text.includes('\r\n\r\n')
        ? text.split('\r\n\r\n').slice(1).join('\r\n\r\n')
        : text;
    return extractIPv4(body) || extractIPv4(text);
}

function buildProxyAuthorizationHeader(proxy) {
    if (!proxy.username && !proxy.password) return '';
    const creds = Buffer.from(
        `${proxy.username || ''}:${proxy.password || ''}`,
        'utf-8',
    ).toString('base64');
    return `Proxy-Authorization: Basic ${creds}\r\n`;
}

function connectPlainSocket(host, port, timeoutMs = 3500, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('probe aborted'));
            return;
        }
        const socket = net.createConnection({ host, port });

        const onAbort = () => {
            clearTimeout(timer);
            socket.destroy();
            reject(new Error('probe aborted'));
        };

        const cleanup = () => {
            clearTimeout(timer);
            socket.removeListener('error', handleError);
            socket.removeListener('connect', handleConnect);
            signal?.removeEventListener('abort', onAbort);
        };

        const timer = setTimeout(() => {
            cleanup();
            socket.destroy();
            reject(new Error('proxy connect timeout'));
        }, timeoutMs);

        const handleError = (error) => {
            cleanup();
            reject(error);
        };

        const handleConnect = () => {
            cleanup();
            socket.setNoDelay(true);
            resolve(socket);
        };

        signal?.addEventListener('abort', onAbort, { once: true });
        socket.once('error', handleError);
        socket.once('connect', handleConnect);
    });
}

function connectSecureSocket(host, port, timeoutMs = 3500, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('probe aborted'));
            return;
        }
        const socket = tls.connect({ host, port, servername: host });

        const onAbort = () => {
            clearTimeout(timer);
            socket.destroy();
            reject(new Error('probe aborted'));
        };

        const cleanup = () => {
            clearTimeout(timer);
            socket.removeListener('error', handleError);
            socket.removeListener('secureConnect', handleConnect);
            signal?.removeEventListener('abort', onAbort);
        };

        const timer = setTimeout(() => {
            cleanup();
            socket.destroy();
            reject(new Error('secure proxy connect timeout'));
        }, timeoutMs);

        const handleError = (error) => {
            cleanup();
            reject(error);
        };

        const handleConnect = () => {
            cleanup();
            socket.setNoDelay(true);
            resolve(socket);
        };

        signal?.addEventListener('abort', onAbort, { once: true });
        socket.once('error', handleError);
        socket.once('secureConnect', handleConnect);
    });
}

const DEFAULT_PROBE_CONNECT_TIMEOUT_MS = 3500;
const DEFAULT_PROBE_RESPONSE_TIMEOUT_MS = 5000;

export async function fetchHttpViaHttpProxy(
    proxy,
    target,
    signal,
    timeoutMs = DEFAULT_PROBE_RESPONSE_TIMEOUT_MS,
) {
    const connectTimeoutMs = Math.min(
        DEFAULT_PROBE_CONNECT_TIMEOUT_MS,
        timeoutMs,
    );
    const socket =
        proxy.protocol === 'https:'
            ? await connectSecureSocket(
                  proxy.host,
                  proxy.port,
                  connectTimeoutMs,
                  signal,
              )
            : await connectPlainSocket(
                  proxy.host,
                  proxy.port,
                  connectTimeoutMs,
                  signal,
              );

    const onAbort = () => socket.destroy();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        const authHeader = buildProxyAuthorizationHeader(proxy);
        const request =
            [
                `GET http://${target.host}${target.path} HTTP/1.1`,
                `Host: ${target.host}`,
                'Connection: close',
                'User-Agent: MultiChrome/1.0',
                authHeader.trimEnd(),
            ]
                .filter(Boolean)
                .join('\r\n') + '\r\n\r\n';

        return await new Promise((resolve, reject) => {
            const chunks = [];
            let settled = false;

            const cleanup = () => {
                clearTimeout(timer);
                socket.removeListener('data', handleData);
                socket.removeListener('end', handleDone);
                socket.removeListener('close', handleDone);
                socket.removeListener('error', handleError);
            };

            const finish = (result, error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve(result || Buffer.concat(chunks));
            };

            const timer = setTimeout(
                () => finish(undefined, new Error('proxy response timeout')),
                timeoutMs,
            );
            const handleData = (chunk) => {
                chunks.push(chunk);
            };
            const handleDone = () => finish(Buffer.concat(chunks));
            const handleError = (error) => finish(undefined, error);

            socket.on('data', handleData);
            socket.once('end', handleDone);
            socket.once('close', handleDone);
            socket.once('error', handleError);
            socket.write(request);
        });
    } finally {
        signal?.removeEventListener('abort', onAbort);
        socket.destroy();
    }
}

export async function resolveProxyIPViaHttpProxy(
    proxy,
    target,
    signal,
    timeoutMs = DEFAULT_PROBE_RESPONSE_TIMEOUT_MS,
) {
    const response = await fetchHttpViaHttpProxy(
        proxy,
        target,
        signal,
        timeoutMs,
    );
    return extractIPv4FromHttpResponse(response);
}

export async function fetchHttpViaSocksProxy(
    proxy,
    target,
    signal,
    timeoutMs = DEFAULT_PROBE_RESPONSE_TIMEOUT_MS,
) {
    const connectTimeoutMs = Math.min(
        DEFAULT_PROBE_CONNECT_TIMEOUT_MS,
        timeoutMs,
    );
    const socket = await connectPlainSocket(
        proxy.host,
        proxy.port,
        connectTimeoutMs,
        signal,
    );
    const onAbort = () => socket.destroy();
    signal?.addEventListener('abort', onAbort, { once: true });
    const reader = new BufferedSocketReader(socket);

    try {
        const needsAuth = Boolean(proxy.username || proxy.password);
        const hello = needsAuth
            ? Buffer.from([0x05, 0x02, 0x00, 0x02])
            : Buffer.from([0x05, 0x01, 0x00]);
        socket.write(hello);

        const helloResp = await reader.read(2, connectTimeoutMs);
        if (helloResp[0] !== 0x05 || helloResp[1] === 0xff) {
            throw new Error('socks5 handshake rejected');
        }

        if (helloResp[1] === 0x02) {
            const username = Buffer.from(proxy.username || '', 'utf-8');
            const password = Buffer.from(proxy.password || '', 'utf-8');
            const authReq = Buffer.concat([
                Buffer.from([0x01, username.length]),
                username,
                Buffer.from([password.length]),
                password,
            ]);
            socket.write(authReq);

            const authResp = await reader.read(2, connectTimeoutMs);
            if (authResp[1] !== 0x00) {
                throw new Error('socks5 auth failed');
            }
        }

        const hostBuffer = Buffer.from(target.host, 'utf-8');
        const connectReq = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
            hostBuffer,
            Buffer.from([0x00, 0x50]),
        ]);
        socket.write(connectReq);

        const connectRespHead = await reader.read(4, timeoutMs);
        if (connectRespHead[0] !== 0x05 || connectRespHead[1] !== 0x00) {
            throw new Error('socks5 connect failed');
        }

        let remaining = 0;
        if (connectRespHead[3] === 0x01) {
            remaining = 4 + 2;
        } else if (connectRespHead[3] === 0x03) {
            const hostLen = (await reader.read(1, timeoutMs))[0];
            remaining = hostLen + 2;
        } else if (connectRespHead[3] === 0x04) {
            remaining = 16 + 2;
        } else {
            throw new Error('socks5 unknown address type');
        }
        await reader.read(remaining, timeoutMs);

        const request = [
            `GET ${target.path} HTTP/1.1`,
            `Host: ${target.host}`,
            'Connection: close',
            'User-Agent: MultiChrome/1.0',
            '',
            '',
        ].join('\r\n');
        socket.write(request);

        return await reader.readAll(timeoutMs);
    } finally {
        signal?.removeEventListener('abort', onAbort);
        socket.destroy();
    }
}

function raceFirstSuccess(promises) {
    return new Promise((resolve, reject) => {
        let remaining = promises.length;
        if (remaining === 0) {
            reject(new Error('no probe targets'));
            return;
        }
        let settled = false;
        for (const p of promises) {
            p.then(
                (value) => {
                    if (!settled) {
                        settled = true;
                        resolve(value);
                    }
                },
                () => {
                    remaining -= 1;
                    if (remaining === 0 && !settled) {
                        reject(new Error('all probe targets failed'));
                    }
                },
            );
        }
    });
}

/**
 * @param {string} proxyAddress
 * @param {{
 *   needTimezone?: boolean;
 *   bypassCache?: boolean;
 *   cache?: Map<string, { info: any; expiresAt: number }>;
 *   cacheTtlMs?: number;
 *   timeoutMs?: number;
 *   geoTargets?: Array<{ host: string; path: string }>;
 *   ipTargets?: Array<{ host: string; path: string }>;
 *   logger?: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void };
 * }} [options]
 */
export async function probeProxyExitInfo(
    proxyAddress,
    {
        needTimezone = false,
        bypassCache = false,
        cache = undefined,
        cacheTtlMs = 20000,
        timeoutMs = DEFAULT_PROBE_RESPONSE_TIMEOUT_MS,
        geoTargets = GEO_PROBE_TARGETS,
        ipTargets = IP_ONLY_PROBE_TARGETS,
        logger = undefined,
    } = {},
) {
    const proxy = parseProxyAddress(proxyAddress);
    if (!proxy) {
        logger?.warn?.('不支持的代理格式，无法启动前解析出口信息');
        return null;
    }

    const cacheKey = `${proxy.protocol}//${proxy.host}:${proxy.port}`;
    if (!bypassCache && cache) {
        const cached = cache.get(cacheKey);
        if (
            cached &&
            cached.expiresAt > Date.now() &&
            (!needTimezone || cached.info.timezone)
        ) {
            logger?.info?.(
                `[代理预解析] 命中短时缓存: ip=${cached.info.ip}, tz=${cached.info.timezone || 'none'}`,
            );
            return cached.info;
        }
    }

    const fetchBuffer = (target, signal) =>
        proxy.protocol === 'socks:' || proxy.protocol === 'socks5:'
            ? fetchHttpViaSocksProxy(proxy, target, signal, timeoutMs)
            : fetchHttpViaHttpProxy(proxy, target, signal, timeoutMs);

    const probeGeoTarget = async (target, signal) => {
        const buffer = await fetchBuffer(target, signal);
        const parsed = parseGeoProbeResponse(buffer);
        if (!parsed || !parsed.ip) {
            throw new Error(`invalid geo response from ${target.host}`);
        }
        return parsed;
    };

    const probeIpTarget = async (target, signal) => {
        const buffer = await fetchBuffer(target, signal);
        const ip = extractIPv4FromHttpResponse(buffer);
        if (!ip) {
            throw new Error(`empty ip from ${target.host}`);
        }
        return { ip };
    };

    const primaryController = new AbortController();
    let fallbackController = null;

    try {
        let result;
        if (needTimezone) {
            // Race only the 3 geo endpoints first (instead of blasting 8 sockets at once),
            // reducing connection burst & RST churn on residential/chained proxies.
            let fallbackIpInfo = null;
            const geoWithTzPromise = raceFirstSuccess(
                geoTargets.map(async (target) => {
                    const info = await probeGeoTarget(
                        target,
                        primaryController.signal,
                    );
                    if (!fallbackIpInfo) fallbackIpInfo = info;
                    if (!info.timezone) {
                        throw new Error(`missing timezone from ${target.host}`);
                    }
                    return info;
                }),
            );

            try {
                result = await geoWithTzPromise;
            } catch {
                primaryController.abort();
                if (fallbackIpInfo) {
                    result = fallbackIpInfo;
                } else {
                    fallbackController = new AbortController();
                    const ipFallback = await raceFirstSuccess(
                        ipTargets.map((target) =>
                            probeIpTarget(target, fallbackController.signal),
                        ),
                    ).catch(() => null);
                    if (!ipFallback) {
                        throw new Error('all geo and ip targets failed');
                    }
                    result = ipFallback;
                }
            }
        } else {
            result = await raceFirstSuccess(
                ipTargets.map((target) =>
                    probeIpTarget(target, primaryController.signal),
                ),
            );
        }

        primaryController.abort();
        fallbackController?.abort();
        if (cache) {
            cache.set(cacheKey, {
                info: result,
                expiresAt: Date.now() + cacheTtlMs,
            });
        }
        return result;
    } catch {
        primaryController.abort();
        fallbackController?.abort();
        logger?.warn?.('[代理预解析] 全部探测节点均未返回有效出口信息');
        return null;
    }
}
