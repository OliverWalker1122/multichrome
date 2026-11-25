import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export const ALLOWED_GITHUB_HOSTS = new Set([
    'github.com',
    'api.github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
]);

const SUPPORTED_PROXY_PROTOCOLS = new Set([
    'http:',
    'https:',
    'socks5:',
    'socks5h:',
    'socks:',
]);

export function assertOfficialGitHubUrl(urlStr) {
    let parsed;
    try {
        parsed = new URL(urlStr);
    } catch {
        throw new Error('无效的下载地址');
    }
    if (parsed.protocol !== 'https:') {
        throw new Error('仅允许通过 HTTPS 从 GitHub 官方下载');
    }
    if (!ALLOWED_GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
        throw new Error(
            `已拦截非 GitHub 官方域名下载：${parsed.hostname}`,
        );
    }
    return parsed;
}

/**
 * Validate an external URL opened from the renderer window (e.g. target="_blank").
 * Strictly allows only HTTPS URLs with a non-empty hostname to block file://,
 * javascript:, ms-msdt:, and other dangerous OS protocol handlers.
 */
export function parseSafeExternalUrl(urlStr) {
    if (typeof urlStr !== 'string' || !urlStr.trim()) return null;
    try {
        const parsed = new URL(urlStr.trim());
        if (parsed.protocol !== 'https:' || !parsed.hostname) {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

export function isSafeExternalUrl(urlStr) {
    return parseSafeExternalUrl(urlStr) !== null;
}

/**
 * Parse and validate an optional proxy URL for official GitHub HTTPS traffic.
 * Throws on non-empty unsupported/malformed proxy addresses rather than
 * silently falling back to a direct connection.
 */
export function parseGitHubProxyUrl(proxyAddress) {
    if (proxyAddress === undefined || proxyAddress === null) return null;
    const trimmed = String(proxyAddress).trim();
    if (!trimmed) return null;

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('代理地址格式无效，请检查全局代理或托管代理设置');
    }

    const protocol = parsed.protocol.toLowerCase();
    if (!SUPPORTED_PROXY_PROTOCOLS.has(protocol) || !parsed.hostname) {
        throw new Error(
            `暂不支持的代理协议 (${protocol.replace(/:$/, '')})，请使用 http://、https:// 或 socks5://`,
        );
    }

    const defaultPort =
        protocol === 'https:' ? 443 : protocol === 'http:' ? 80 : 1080;
    const port = parsed.port ? Number(parsed.port) : defaultPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('代理端口无效，请检查代理地址配置');
    }

    const username = parsed.username
        ? decodeURIComponent(parsed.username)
        : '';
    const password = parsed.password
        ? decodeURIComponent(parsed.password)
        : '';

    return {
        protocol,
        kind:
            protocol === 'http:' || protocol === 'https:' ? 'http' : 'socks5',
        host: parsed.hostname.replace(/^\[([^\]]+)\]$/, '$1'),
        port,
        username,
        password,
    };
}

function createHttpProxyConnector(proxy, { connectTimeoutMs = 25000 } = {}) {
    const authHeader =
        proxy.username || proxy.password
            ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`
            : null;

    return function createConnection(options, callback) {
        const targetHost = options.host || options.servername;
        const targetPort = Number(options.port) || 443;
        const socket =
            proxy.protocol === 'https:'
                ? tls.connect({
                      host: proxy.host,
                      port: proxy.port,
                      servername: net.isIP(proxy.host) ? undefined : proxy.host,
                      rejectUnauthorized: true,
                  })
                : net.connect(proxy.port, proxy.host);

        let done = false;
        let headerBuf = '';

        const finish = (err, tlsSocket) => {
            if (done) return;
            done = true;
            socket.setTimeout(0);
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            socket.removeListener('close', onClose);
            if (err) {
                socket.destroy();
                callback(err);
                return;
            }
            callback(null, tlsSocket);
        };

        const onError = (err) => finish(err);
        const onClose = () =>
            finish(new Error('通过 HTTP 代理连接 GitHub 时连接中断'));

        const onData = (chunk) => {
            headerBuf += chunk.toString('latin1');
            if (headerBuf.length > 16384) {
                finish(new Error('HTTP 代理 CONNECT 响应头过长'));
                return;
            }
            const headerEnd = headerBuf.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;

            const statusLine = headerBuf.slice(0, headerBuf.indexOf('\r\n'));
            if (!/^HTTP\/\d\.\d\s+200\b/i.test(statusLine)) {
                finish(new Error(`代理 CONNECT 失败: ${statusLine}`));
                return;
            }

            const leftover = headerBuf.slice(headerEnd + 4);
            socket.removeListener('data', onData);
            if (leftover.length > 0) {
                socket.unshift(Buffer.from(leftover, 'latin1'));
            }

            const tlsSocket = tls.connect(
                {
                    socket,
                    servername: targetHost,
                    rejectUnauthorized: true,
                },
                () => finish(null, tlsSocket),
            );
            tlsSocket.once('error', (err) => finish(err));
        };

        socket.setTimeout(connectTimeoutMs, () => {
            finish(new Error('通过代理连接 GitHub 超时'));
        });
        socket.once('error', onError);
        socket.once('close', onClose);

        const sendConnect = () => {
            const lines = [
                `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
                `Host: ${targetHost}:${targetPort}`,
                'Proxy-Connection: Keep-Alive',
            ];
            if (authHeader) {
                lines.push(`Proxy-Authorization: ${authHeader}`);
            }
            socket.write(`${lines.join('\r\n')}\r\n\r\n`);
            socket.on('data', onData);
        };

        if (proxy.protocol === 'https:') {
            socket.once('secureConnect', sendConnect);
        } else {
            socket.once('connect', sendConnect);
        }
    };
}

function createSocks5ProxyConnector(proxy, { connectTimeoutMs = 25000 } = {}) {
    const userBuf = Buffer.from(proxy.username || '', 'utf8');
    const passBuf = Buffer.from(proxy.password || '', 'utf8');
    if (userBuf.length > 255 || passBuf.length > 255) {
        throw new Error('SOCKS5 代理认证用户名或密码长度不能超过 255 字节');
    }

    return function createConnection(options, callback) {
        const targetHost = options.host || options.servername;
        const targetPort = Number(options.port) || 443;
        const hostBuf = Buffer.from(String(targetHost || ''), 'utf8');
        if (!hostBuf.length || hostBuf.length > 255) {
            callback(new Error('目标主机名无效'));
            return;
        }

        const socket = net.connect(proxy.port, proxy.host);
        let done = false;
        let stage = 'greeting';
        let buffer = Buffer.alloc(0);

        const finish = (err, tlsSocket) => {
            if (done) return;
            done = true;
            socket.setTimeout(0);
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            socket.removeListener('close', onClose);
            if (err) {
                socket.destroy();
                callback(err);
                return;
            }
            callback(null, tlsSocket);
        };

        const onError = (err) => finish(err);
        const onClose = () =>
            finish(new Error('通过 SOCKS5 代理连接 GitHub 时连接中断'));

        const sendConnectRequest = () => {
            stage = 'connect';
            // Always use ATYP=0x03 (domain name) so DNS resolves remotely through SOCKS5
            const req = Buffer.alloc(4 + 1 + hostBuf.length + 2);
            req[0] = 0x05; // VER
            req[1] = 0x01; // CMD: CONNECT
            req[2] = 0x00; // RSV
            req[3] = 0x03; // ATYP: DOMAINNAME
            req[4] = hostBuf.length;
            hostBuf.copy(req, 5);
            req.writeUInt16BE(targetPort, 5 + hostBuf.length);
            socket.write(req);
        };

        const processBuffer = () => {
            while (!done) {
                if (stage === 'greeting') {
                    if (buffer.length < 2) return;
                    const ver = buffer[0];
                    const method = buffer[1];
                    buffer = buffer.subarray(2);

                    if (ver !== 0x05) {
                        finish(new Error('SOCKS5 代理握手版本不兼容'));
                        return;
                    }
                    if (method === 0x00) {
                        sendConnectRequest();
                        continue;
                    }
                    if (method === 0x02) {
                        if (!userBuf.length && !passBuf.length) {
                            finish(new Error('SOCKS5 代理要求用户名和密码认证'));
                            return;
                        }
                        stage = 'auth';
                        const authPacket = Buffer.concat([
                            Buffer.from([0x01, userBuf.length]),
                            userBuf,
                            Buffer.from([passBuf.length]),
                            passBuf,
                        ]);
                        socket.write(authPacket);
                        continue;
                    }
                    finish(new Error('SOCKS5 代理不支持当前认证方式'));
                    return;
                }

                if (stage === 'auth') {
                    if (buffer.length < 2) return;
                    const authVer = buffer[0];
                    const authStatus = buffer[1];
                    buffer = buffer.subarray(2);
                    if (authVer !== 0x01 || authStatus !== 0x00) {
                        finish(new Error('SOCKS5 代理用户名或密码认证失败'));
                        return;
                    }
                    sendConnectRequest();
                    continue;
                }

                if (stage === 'connect') {
                    if (buffer.length < 4) return;
                    const ver = buffer[0];
                    const rep = buffer[1];
                    const atyp = buffer[3];
                    if (ver !== 0x05) {
                        finish(new Error('SOCKS5 代理响应格式无效'));
                        return;
                    }
                    if (rep !== 0x00) {
                        finish(new Error(`SOCKS5 代理连接目标失败 (code=${rep})`));
                        return;
                    }

                    let replyLen = 0;
                    if (atyp === 0x01) {
                        replyLen = 4 + 4 + 2;
                    } else if (atyp === 0x04) {
                        replyLen = 4 + 16 + 2;
                    } else if (atyp === 0x03) {
                        if (buffer.length < 5) return;
                        replyLen = 4 + 1 + buffer[4] + 2;
                    } else {
                        finish(new Error('SOCKS5 代理返回未知地址类型'));
                        return;
                    }

                    if (buffer.length < replyLen) return;
                    const leftover = buffer.subarray(replyLen);
                    buffer = Buffer.alloc(0);

                    socket.removeListener('data', onData);
                    if (leftover.length > 0) {
                        socket.unshift(leftover);
                    }

                    const tlsSocket = tls.connect(
                        {
                            socket,
                            servername: targetHost,
                            rejectUnauthorized: true,
                        },
                        () => finish(null, tlsSocket),
                    );
                    tlsSocket.once('error', (err) => finish(err));
                    return;
                }
            }
        };

        const onData = (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > 4096) {
                finish(new Error('SOCKS5 代理握手响应过长'));
                return;
            }
            processBuffer();
        };

        socket.setTimeout(connectTimeoutMs, () => {
            finish(new Error('通过 SOCKS5 代理连接 GitHub 超时'));
        });
        socket.once('error', onError);
        socket.once('close', onClose);
        socket.once('connect', () => {
            const hasAuth = userBuf.length > 0 || passBuf.length > 0;
            const greeting = hasAuth
                ? Buffer.from([0x05, 0x02, 0x00, 0x02])
                : Buffer.from([0x05, 0x01, 0x00]);
            socket.write(greeting);
            socket.on('data', onData);
        });
    };
}

export function createGitHubProxyAgent(proxyAddress, options = {}) {
    const proxy = parseGitHubProxyUrl(proxyAddress);
    if (!proxy) return null;

    const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
    agent.createConnection =
        proxy.kind === 'socks5'
            ? createSocks5ProxyConnector(proxy, options)
            : createHttpProxyConnector(proxy, options);
    return agent;
}

/**
 * @param {string} urlStr
 * @param {{
 *   proxyAddress?: string;
 *   timeoutMs?: number;
 *   userAgent?: string;
 *   accept?: string;
 *   signal?: AbortSignal;
 * }} [options]
 */
export function openOfficialGitHubStream(
    urlStr,
    options = {},
    redirectCount = 0,
) {
    if (redirectCount > 8) {
        return Promise.reject(new Error('下载重定向次数过多'));
    }

    let parsed;
    try {
        parsed = assertOfficialGitHubUrl(urlStr);
    } catch (err) {
        return Promise.reject(err);
    }

    let agent = null;
    try {
        agent = createGitHubProxyAgent(options.proxyAddress, {
            connectTimeoutMs: Math.min(options.timeoutMs || 30000, 25000),
        });
    } catch (err) {
        return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'GET',
            headers: {
                'User-Agent':
                    options.userAgent || 'MultiChrome-KernelManager/1.3',
                Accept: options.accept || '*/*',
            },
            timeout: options.timeoutMs || 30000,
            ...(agent ? { agent } : {}),
        };

        const cleanupAgent = () => {
            if (agent) {
                try {
                    agent.destroy();
                } catch {
                    // ignore
                }
            }
        };

        const req = https.request(reqOptions, (res) => {
            const status = res.statusCode || 0;
            if (
                [301, 302, 303, 307, 308].includes(status) &&
                res.headers.location
            ) {
                res.resume();
                cleanupAgent();
                const nextUrl = new URL(res.headers.location, urlStr).toString();
                openOfficialGitHubStream(
                    nextUrl,
                    options,
                    redirectCount + 1,
                ).then(resolve, reject);
                return;
            }
            if (status < 200 || status >= 300) {
                const rateLimited =
                    (status === 403 || status === 429) &&
                    String(res.headers['x-ratelimit-remaining'] ?? '') === '0';
                res.resume();
                cleanupAgent();
                reject(
                    new Error(
                        rateLimited
                            ? `HTTP ${status} (速率受限): 无法访问 ${parsed.hostname}`
                            : `HTTP ${status}: 无法访问 ${parsed.hostname}`,
                    ),
                );
                return;
            }
            res.once('close', cleanupAgent);
            resolve(res);
        });

        req.on('timeout', () => {
            cleanupAgent();
            req.destroy(new Error('GitHub 网络请求超时'));
        });
        req.on('error', (err) => {
            cleanupAgent();
            reject(err);
        });

        if (options.signal) {
            if (options.signal.aborted) {
                cleanupAgent();
                req.destroy(new Error('操作已取消'));
                return;
            }
            options.signal.addEventListener(
                'abort',
                () => {
                    cleanupAgent();
                    req.destroy(new Error('操作已取消'));
                },
                { once: true },
            );
        }

        req.end();
    });
}

/**
 * @param {string} urlStr
 * @param {{
 *   proxyAddress?: string;
 *   timeoutMs?: number;
 *   userAgent?: string;
 *   maxBytes?: number;
 *   signal?: AbortSignal;
 * }} [options]
 */
export async function fetchOfficialGitHubJson(
    urlStr,
    {
        proxyAddress = undefined,
        timeoutMs = 10000,
        userAgent = 'MultiChrome/1.3',
        maxBytes = 2 * 1024 * 1024,
        signal = undefined,
    } = {},
) {
    const res = await openOfficialGitHubStream(urlStr, {
        proxyAddress,
        timeoutMs,
        userAgent,
        accept: 'application/vnd.github+json',
        signal,
    });

    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        res.on('data', (chunk) => {
            const buf = Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes > maxBytes) {
                res.destroy();
                reject(new Error('版本信息响应过大'));
                return;
            }
            chunks.push(buf);
        });
        res.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(new Error('解析版本信息失败'));
            }
        });
        res.on('error', reject);
    });
}

/**
 * Resolve a single HTTPS redirect target on an allowlisted official GitHub host
 * without following the redirect body (used for `/releases/latest` -> `/releases/tag/vX.Y.Z`
 * fallback when `api.github.com` anonymous rate limits are exhausted).
 *
 * @param {string} urlStr
 * @param {{
 *   proxyAddress?: string;
 *   timeoutMs?: number;
 *   userAgent?: string;
 *   signal?: AbortSignal;
 * }} [options]
 */
export function resolveOfficialGitHubRedirect(urlStr, options = {}) {
    let parsed;
    try {
        parsed = assertOfficialGitHubUrl(urlStr);
    } catch (err) {
        return Promise.reject(err);
    }

    let agent = null;
    try {
        agent = createGitHubProxyAgent(options.proxyAddress, {
            connectTimeoutMs: Math.min(options.timeoutMs || 15000, 15000),
        });
    } catch (err) {
        return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'GET',
            headers: {
                'User-Agent': options.userAgent || 'MultiChrome/1.6',
                Accept: 'text/html, */*',
            },
            timeout: options.timeoutMs || 12000,
            ...(agent ? { agent } : {}),
        };

        const cleanupAgent = () => {
            if (agent) {
                try {
                    agent.destroy();
                } catch {
                    // ignore
                }
            }
        };

        const req = https.request(reqOptions, (res) => {
            const status = res.statusCode || 0;
            const location = res.headers.location;
            res.resume();
            cleanupAgent();
            if ([301, 302, 303, 307, 308].includes(status) && location) {
                try {
                    const nextUrl = new URL(location, urlStr).toString();
                    assertOfficialGitHubUrl(nextUrl);
                    resolve(nextUrl);
                } catch (err) {
                    reject(err);
                }
                return;
            }
            reject(new Error(`HTTP ${status}: 无法获取 ${parsed.hostname} 跳转地址`));
        });

        req.on('timeout', () => {
            cleanupAgent();
            req.destroy(new Error('GitHub 网络请求超时'));
        });
        req.on('error', (err) => {
            cleanupAgent();
            reject(err);
        });

        if (options.signal) {
            if (options.signal.aborted) {
                cleanupAgent();
                req.destroy(new Error('操作已取消'));
                return;
            }
            options.signal.addEventListener(
                'abort',
                () => {
                    cleanupAgent();
                    req.destroy(new Error('操作已取消'));
                },
                { once: true },
            );
        }

        req.end();
    });
}

/**
 * @param {string} urlStr
 * @param {{
 *   proxyAddress?: string;
 *   timeoutMs?: number;
 *   userAgent?: string;
 *   maxBytes?: number;
 *   signal?: AbortSignal;
 * }} [options]
 */
export async function fetchOfficialGitHubText(
    urlStr,
    {
        proxyAddress = undefined,
        timeoutMs = 15000,
        userAgent = 'MultiChrome/1.6',
        maxBytes = 1024 * 1024,
        signal = undefined,
    } = {},
) {
    const res = await openOfficialGitHubStream(urlStr, {
        proxyAddress,
        timeoutMs,
        userAgent,
        accept: 'text/plain, */*',
        signal,
    });

    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        res.on('data', (chunk) => {
            const buf = Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes > maxBytes) {
                res.destroy();
                reject(new Error('校验文件响应过大'));
                return;
            }
            chunks.push(buf);
        });
        res.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        res.on('error', reject);
    });
}
