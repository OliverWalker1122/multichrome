import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { isValidIanaTimeZone } from '../domain/proxyGeo.js';

const PRIMARY_HOST = 'ipwho.is';
const FALLBACK_HOST = 'ipinfo.io';
const FALLBACK_PATH = '/json';
const MAX_RESPONSE_BYTES = 32 * 1024;
const RETRYABLE_UPSTREAM_STATUS = new Set([429, 500, 502, 503, 504]);

function buildPrimaryPath(locale = 'en-US') {
    const lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
    return `/?fields=success,ip,country,country_code,region,city,timezone,latitude,longitude&lang=${lang}`;
}

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

function attachOptionalGeoFields(result, value) {
    const rawTz =
        typeof value.timezone === 'string'
            ? value.timezone.trim()
            : value.timezone &&
                typeof value.timezone === 'object' &&
                typeof value.timezone.id === 'string'
              ? value.timezone.id.trim()
              : '';
    if (rawTz && isValidIanaTimeZone(rawTz)) {
        result.timezone = rawTz;
    }

    let lat;
    let lon;
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
        lat = value.latitude;
        lon = value.longitude;
    } else if (typeof value.loc === 'string' && value.loc.includes(',')) {
        const [rawLat, rawLon] = value.loc.split(',').map((s) => Number(s.trim()));
        if (Number.isFinite(rawLat) && Number.isFinite(rawLon)) {
            lat = rawLat;
            lon = rawLon;
        }
    }
    if (
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
    ) {
        result.latitude = lat;
        result.longitude = lon;
    }
    return result;
}

export function parseExitInfo(value) {
    if (
        !value ||
        value.success !== true ||
        typeof value.ip !== 'string' ||
        !net.isIP(value.ip)
    ) {
        const err = probeError();
        if (
            value &&
            value.success === false &&
            typeof value.message === 'string' &&
            /limit|quota|rate/i.test(value.message)
        ) {
            err.retryable = true;
        }
        throw err;
    }
    return attachOptionalGeoFields(
        {
            ip: value.ip,
            country: locationText(value.country),
            countryCode: /^[A-Z]{2}$/.test(value.country_code || '')
                ? value.country_code
                : '',
            region: locationText(value.region),
            city: locationText(value.city),
        },
        value,
    );
}

export function parseFallbackIpInfo(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        typeof value.ip !== 'string' ||
        !net.isIP(value.ip)
    ) {
        throw probeError();
    }
    const rawCountry =
        typeof value.country === 'string' ? value.country.trim().toUpperCase() : '';
    const countryCode = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : '';
    return attachOptionalGeoFields(
        {
            ip: value.ip,
            country: countryCode,
            countryCode,
            region: locationText(value.region),
            city: locationText(value.city),
        },
        value,
    );
}

function validateLoopbackProxyAddress(localAddress) {
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
        ) {
            throw probeError();
        }
    } catch {
        throw probeError();
    }
    return Number(address.port);
}

function probeSingleTarget(
    proxyPort,
    { host, path, parse, connectTls, signal, timeoutMs },
) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject({ error: probeError(true), retryable: false });
            return;
        }

        let settled = false;
        let tunnelRequest;
        let tunnelSocket;
        let secureSocket;
        let lookupRequest;
        let agent;

        const finish = (failure, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            lookupRequest?.destroy();
            secureSocket?.destroy();
            tunnelSocket?.destroy();
            tunnelRequest?.destroy();
            agent?.destroy();
            if (failure) reject(failure);
            else resolve(result);
        };

        const fail = (retryable = false) =>
            finish({ error: probeError(false), retryable });
        const onAbort = () =>
            finish({ error: probeError(true), retryable: false });
        const timer = setTimeout(() => fail(false), Math.max(1, timeoutMs));
        signal?.addEventListener('abort', onAbort, { once: true });

        tunnelRequest = http.request({
            hostname: '127.0.0.1',
            port: proxyPort,
            method: 'CONNECT',
            path: `${host}:443`,
            headers: { Host: `${host}:443` },
            agent: false,
        });
        tunnelRequest.once('error', () => fail(false));
        tunnelRequest.once('response', () => fail(false));
        tunnelRequest.once('connect', (response, socket, head) => {
            tunnelSocket = socket;
            socket.on('error', () => fail(false));
            if (settled) {
                socket.destroy();
                return;
            }
            if (response.statusCode !== 200 || head.length) {
                fail(false);
                return;
            }
            agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
            agent.createConnection = (_options, callback) => {
                try {
                    secureSocket = connectTls(
                        {
                            socket,
                            servername: host,
                            rejectUnauthorized: true,
                            ALPNProtocols: ['http/1.1'],
                        },
                        () => callback(null, secureSocket),
                    );
                    secureSocket.on('error', () => fail(false));
                } catch {
                    fail(false);
                }
            };
            lookupRequest = https.request(
                {
                    hostname: host,
                    port: 443,
                    path,
                    method: 'GET',
                    agent,
                    headers: {
                        Accept: 'application/json',
                        'Accept-Encoding': 'identity',
                        Connection: 'close',
                    },
                },
                (lookupResponse) => {
                    const status = lookupResponse.statusCode || 0;
                    const encoding =
                        lookupResponse.headers['content-encoding'];
                    if (
                        status !== 200 ||
                        (encoding && encoding !== 'identity')
                    ) {
                        lookupResponse.destroy();
                        // Only fallback on explicit upstream rate-limit / 5xx outage
                        // after the loopback CONNECT tunnel itself succeeded.
                        fail(RETRYABLE_UPSTREAM_STATUS.has(status));
                        return;
                    }
                    const chunks = [];
                    let bytes = 0;
                    lookupResponse.on('error', () => fail(false));
                    lookupResponse.on('aborted', () => fail(false));
                    lookupResponse.on('data', (chunk) => {
                        bytes += chunk.length;
                        if (bytes > MAX_RESPONSE_BYTES) {
                            lookupResponse.destroy();
                            fail(false);
                        } else {
                            chunks.push(chunk);
                        }
                    });
                    lookupResponse.on('end', () => {
                        if (settled) return;
                        try {
                            finish(
                                null,
                                parse(
                                    JSON.parse(
                                        Buffer.concat(chunks).toString('utf8'),
                                    ),
                                ),
                            );
                        } catch (parseErr) {
                            fail(Boolean(parseErr?.retryable));
                        }
                    });
                },
            );
            lookupRequest.once('error', () => fail(false));
            lookupRequest.end();
        });
        tunnelRequest.end();
    });
}

/**
 * The only TCP destination is the managed loopback listener. The lookup host
 * is resolved by that proxy, and HTTPS uses the resulting CONNECT socket.
 * No environment proxy settings, redirects, or direct retry are involved.
 * On upstream 429/5xx outage from ipwho.is, falls back to ipinfo.io over the
 * exact same verified loopback HTTPS CONNECT tunnel.
 * connectTls is injectable solely for isolated transport tests.
 */
export function createProxyExitProbe({ connectTls = tls.connect } = {}) {
    return async function probeProxyExit(
        localAddress,
        { signal, timeoutMs = 12000, locale = 'en-US' } = {},
    ) {
        const proxyPort = validateLoopbackProxyAddress(localAddress);
        if (signal?.aborted) {
            throw probeError(true);
        }

        const startedAt = Date.now();
        try {
            return await probeSingleTarget(proxyPort, {
                host: PRIMARY_HOST,
                path: buildPrimaryPath(locale),
                parse: parseExitInfo,
                connectTls,
                signal,
                timeoutMs,
            });
        } catch (primaryFailure) {
            const elapsed = Date.now() - startedAt;
            const remainingMs = timeoutMs - elapsed;
            if (
                primaryFailure?.retryable &&
                !signal?.aborted &&
                remainingMs > 500
            ) {
                try {
                    return await probeSingleTarget(proxyPort, {
                        host: FALLBACK_HOST,
                        path: FALLBACK_PATH,
                        parse: parseFallbackIpInfo,
                        connectTls,
                        signal,
                        timeoutMs: remainingMs,
                    });
                } catch (fallbackFailure) {
                    throw fallbackFailure?.error || probeError(false);
                }
            }
            throw primaryFailure?.error || probeError(false);
        }
    };
}

export const probeProxyExit = createProxyExitProbe();
