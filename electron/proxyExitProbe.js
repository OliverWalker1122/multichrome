import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const LOOKUP_HOST = 'ipwho.is';
const LOOKUP_PATH =
    '/?fields=success,ip,country,country_code,region,city&lang=zh-CN';
const MAX_RESPONSE_BYTES = 32 * 1024;

function probeError(aborted = false) {
    const error = new Error(
        aborted ? '出口检测已取消' : '出口检测失败，请稍后重试',
    );
    error.name = aborted ? 'AbortError' : 'Error';
    return error;
}

function locationText(value) {
    if (typeof value !== 'string') return '';
    return [...value]
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
        .join('')
        .trim()
        .slice(0, 120);
}

export function parseExitInfo(value) {
    if (
        !value ||
        value.success !== true ||
        typeof value.ip !== 'string' ||
        !net.isIP(value.ip)
    ) {
        throw probeError();
    }
    return {
        ip: value.ip,
        country: locationText(value.country),
        countryCode: /^[A-Z]{2}$/.test(value.country_code || '')
            ? value.country_code
            : '',
        region: locationText(value.region),
        city: locationText(value.city),
    };
}

/**
 * The only TCP destination is the managed loopback listener. The lookup host
 * is resolved by that proxy, and HTTPS uses the resulting CONNECT socket.
 * No environment proxy settings, redirects, or direct retry are involved.
 * connectTls is injectable solely for isolated transport tests.
 */
export function createProxyExitProbe({ connectTls = tls.connect } = {}) {
    return function probeProxyExit(
        localAddress,
        { signal, timeoutMs = 12000 } = {},
    ) {
        return new Promise((resolve, reject) => {
            let address;
            try {
                address = new URL(localAddress);
                if (
                    address.protocol !== 'http:' ||
                    address.hostname !== '127.0.0.1' ||
                    !address.port ||
                    address.username ||
                    address.password ||
                    address.pathname !== '/' ||
                    address.search ||
                    address.hash
                )
                    throw probeError();
            } catch {
                reject(probeError());
                return;
            }
            if (signal?.aborted) {
                reject(probeError(true));
                return;
            }

            let settled = false;
            let tunnelRequest;
            let tunnelSocket;
            let secureSocket;
            let lookupRequest;
            let agent;
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                lookupRequest?.destroy();
                secureSocket?.destroy();
                tunnelSocket?.destroy();
                tunnelRequest?.destroy();
                agent?.destroy();
                if (error) reject(error);
                else resolve(result);
            };
            const fail = () => finish(probeError());
            const onAbort = () => finish(probeError(true));
            const timer = setTimeout(fail, timeoutMs);
            signal?.addEventListener('abort', onAbort, { once: true });

            tunnelRequest = http.request({
                hostname: '127.0.0.1',
                port: Number(address.port),
                method: 'CONNECT',
                path: `${LOOKUP_HOST}:443`,
                headers: { Host: `${LOOKUP_HOST}:443` },
                agent: false,
            });
            tunnelRequest.once('error', fail);
            tunnelRequest.once('response', fail);
            tunnelRequest.once('connect', (response, socket, head) => {
                tunnelSocket = socket;
                socket.on('error', fail);
                if (settled) {
                    socket.destroy();
                    return;
                }
                if (response.statusCode !== 200 || head.length) {
                    fail();
                    return;
                }
                agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
                agent.createConnection = (_options, callback) => {
                    try {
                        secureSocket = connectTls(
                            {
                                socket,
                                servername: LOOKUP_HOST,
                                rejectUnauthorized: true,
                                ALPNProtocols: ['http/1.1'],
                            },
                            () => callback(null, secureSocket),
                        );
                        secureSocket.on('error', fail);
                    } catch {
                        fail();
                    }
                };
                lookupRequest = https.request(
                    {
                        hostname: LOOKUP_HOST,
                        port: 443,
                        path: LOOKUP_PATH,
                        method: 'GET',
                        agent,
                        headers: {
                            Accept: 'application/json',
                            'Accept-Encoding': 'identity',
                            Connection: 'close',
                        },
                    },
                    (lookupResponse) => {
                        const encoding =
                            lookupResponse.headers['content-encoding'];
                        if (
                            lookupResponse.statusCode !== 200 ||
                            (encoding && encoding !== 'identity')
                        ) {
                            lookupResponse.destroy();
                            fail();
                            return;
                        }
                        const chunks = [];
                        let bytes = 0;
                        lookupResponse.on('error', fail);
                        lookupResponse.on('aborted', fail);
                        lookupResponse.on('data', (chunk) => {
                            bytes += chunk.length;
                            if (bytes > MAX_RESPONSE_BYTES) {
                                lookupResponse.destroy();
                                fail();
                            } else chunks.push(chunk);
                        });
                        lookupResponse.on('end', () => {
                            if (settled) return;
                            try {
                                finish(
                                    null,
                                    parseExitInfo(
                                        JSON.parse(
                                            Buffer.concat(chunks).toString(
                                                'utf8',
                                            ),
                                        ),
                                    ),
                                );
                            } catch {
                                fail();
                            }
                        });
                    },
                );
                lookupRequest.once('error', fail);
                lookupRequest.end();
            });
            tunnelRequest.end();
        });
    };
}

export const probeProxyExit = createProxyExitProbe();
