import http from 'node:http';
import https from 'node:https';
import { validateProxyRotationUrl } from '../domain/proxyRotationPolicy.js';

const MAX_RESPONSE_BYTES = 4096;
const MAX_REDIRECTS = 3;

export function triggerProxyRotation(
    rawUrl,
    { timeoutMs = 12000 } = {},
    redirectCount = 0,
) {
    let validUrl;
    try {
        validUrl = validateProxyRotationUrl(rawUrl);
    } catch (error) {
        return Promise.reject(error);
    }
    if (!validUrl) {
        return Promise.reject(new Error('此代理未配置换 IP 链接'));
    }

    const parsed = new URL(validUrl);
    const transport = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                hostname: parsed.hostname.replace(/^\[([^\]]+)\]$/, '$1'),
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                method: 'GET',
                timeout: timeoutMs,
                headers: {
                    'User-Agent': 'MultiChrome-ProxyRotator/1.6',
                    Accept: '*/*',
                },
            },
            (res) => {
                const status = res.statusCode || 0;
                if (
                    [301, 302, 303, 307, 308].includes(status) &&
                    res.headers.location &&
                    redirectCount < MAX_REDIRECTS
                ) {
                    res.resume();
                    let nextUrl = '';
                    try {
                        nextUrl = new URL(
                            res.headers.location,
                            validUrl,
                        ).toString();
                    } catch {
                        reject(new Error('换 IP 链接重定向地址无效'));
                        return;
                    }
                    triggerProxyRotation(
                        nextUrl,
                        { timeoutMs },
                        redirectCount + 1,
                    ).then(resolve, reject);
                    return;
                }

                let bytes = 0;
                res.on('data', (chunk) => {
                    bytes += chunk.length;
                    if (bytes >= MAX_RESPONSE_BYTES) {
                        res.destroy();
                    }
                });
                res.on('end', () => {
                    if (status >= 200 && status < 400) {
                        resolve({ ok: true, statusCode: status });
                    } else {
                        reject(
                            new Error(`换 IP 接口返回状态异常（HTTP ${status}）`),
                        );
                    }
                });
                res.on('close', () => {
                    if (bytes >= MAX_RESPONSE_BYTES) {
                        if (status >= 200 && status < 400) {
                            resolve({ ok: true, statusCode: status });
                        } else {
                            reject(
                                new Error(
                                    `换 IP 接口返回状态异常（HTTP ${status}）`,
                                ),
                            );
                        }
                    }
                });
                res.on('error', () => {
                    reject(new Error('读取换 IP 接口响应失败'));
                });
            },
        );

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('触发换 IP 请求超时'));
        });
        req.on('error', () => {
            reject(new Error('无法连接代理换 IP 接口'));
        });
        req.end();
    });
}
