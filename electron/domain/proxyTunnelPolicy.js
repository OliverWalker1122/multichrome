/**
 * Pure domain policy for local loopback HTTP CONNECT proxy tunnel watchdogs.
 *
 * Chromium 148's W3C Device Bound Session Credentials (DBSC) `URLFetcher`
 * does not enforce a standalone refresh request timeout yet (added later in
 * upstream Chromium). When a residential proxy keeps its client-side TCP
 * connection alive while stalling the remote TLS/HTTP response for a bound
 * cookie rotation (`accounts.google.com/RotateBoundCookies`), Chromium 148
 * permanently defers all in-scope `*.google.com` credentialed requests.
 *
 * Terminating stalled CONNECT/TLS handshakes and stalled DBSC auth-refresh
 * tunnels at the local loopback relay surfaces a transient `net_error` to
 * Chromium (`SessionError::kNetError`), which preserves the native DBSC
 * session AND immediately calls `UnblockDeferredRequests()`.
 */

export const DBSC_AUTH_REFRESH_HOSTS = Object.freeze([
    'accounts.google.com',
    'accounts.youtube.com',
]);

export const DEFAULT_TUNNEL_WATCHDOG_CONFIG = Object.freeze({
    connectHandshakeTimeoutMs: 20_000,
    tlsHandshakeTimeoutMs: 20_000,
    dbscResponseTimeoutMs: 25_000,
    dbscIdleTimeoutMs: 60_000,
    minResponseTriggerBytes: 64,
});

const DBSC_AUTH_REFRESH_HOST_SET = new Set(DBSC_AUTH_REFRESH_HOSTS);

/**
 * Normalize a proxy tunnel watchdog configuration object with safe defaults.
 * @param {boolean | Partial<typeof DEFAULT_TUNNEL_WATCHDOG_CONFIG> | undefined} raw
 * @returns {{
 *   connectHandshakeTimeoutMs: number;
 *   tlsHandshakeTimeoutMs: number;
 *   dbscResponseTimeoutMs: number;
 *   dbscIdleTimeoutMs: number;
 *   minResponseTriggerBytes: number;
 * } | null}
 */
export function normalizeTunnelWatchdogConfig(raw) {
    if (!raw) return null;
    if (raw === true) {
        return { ...DEFAULT_TUNNEL_WATCHDOG_CONFIG };
    }
    if (typeof raw !== 'object') return null;

    const pickNonNegativeInt = (value, fallback) =>
        Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

    return {
        connectHandshakeTimeoutMs: pickNonNegativeInt(
            raw.connectHandshakeTimeoutMs,
            DEFAULT_TUNNEL_WATCHDOG_CONFIG.connectHandshakeTimeoutMs,
        ),
        tlsHandshakeTimeoutMs: pickNonNegativeInt(
            raw.tlsHandshakeTimeoutMs,
            DEFAULT_TUNNEL_WATCHDOG_CONFIG.tlsHandshakeTimeoutMs,
        ),
        dbscResponseTimeoutMs: pickNonNegativeInt(
            raw.dbscResponseTimeoutMs,
            DEFAULT_TUNNEL_WATCHDOG_CONFIG.dbscResponseTimeoutMs,
        ),
        dbscIdleTimeoutMs: pickNonNegativeInt(
            raw.dbscIdleTimeoutMs,
            DEFAULT_TUNNEL_WATCHDOG_CONFIG.dbscIdleTimeoutMs,
        ),
        minResponseTriggerBytes: Math.max(
            1,
            pickNonNegativeInt(
                raw.minResponseTriggerBytes,
                DEFAULT_TUNNEL_WATCHDOG_CONFIG.minResponseTriggerBytes,
            ),
        ),
    };
}

/**
 * Return true iff the proxy URL uses plaintext HTTP proxy framing (`http://`)
 * where Chrome sends ASCII `CONNECT host:port HTTP/1.1` requests.
 * Covers 100% of built-in sing-box proxies (`http://127.0.0.1:<port>`) and
 * manual HTTP proxies while leaving `https://` and `socks5://` untouched.
 * @param {string | undefined} proxyAddress
 * @returns {boolean}
 */
export function shouldEnableHttpConnectWatchdog(proxyAddress) {
    if (typeof proxyAddress !== 'string' || !proxyAddress.trim()) {
        return false;
    }
    const raw = proxyAddress.trim();
    const normalized = raw.includes('://') ? raw : `http://${raw}`;
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

/**
 * Parse an HTTP `CONNECT host:port HTTP/1.x` request header block and extract
 * the normalized target host and port. Returns null for non-CONNECT requests.
 * @param {string} headerBlock
 * @returns {{ host: string; port: number } | null}
 */
export function parseHttpConnectTarget(headerBlock) {
    if (typeof headerBlock !== 'string' || !headerBlock) return null;
    const lineEnd = headerBlock.indexOf('\r\n');
    const requestLine =
        lineEnd >= 0 ? headerBlock.slice(0, lineEnd) : headerBlock;
    const match = /^CONNECT\s+(\S+)\s+HTTP\/1\.[01]$/i.exec(requestLine.trim());
    if (!match) return null;

    const authority = match[1];
    let host = '';
    let portStr = '';

    if (authority.startsWith('[')) {
        const closeBracket = authority.indexOf(']');
        if (closeBracket < 0) return null;
        host = authority.slice(1, closeBracket).trim();
        if (authority[closeBracket + 1] !== ':') return null;
        portStr = authority.slice(closeBracket + 2);
    } else {
        const lastColon = authority.lastIndexOf(':');
        if (lastColon <= 0) return null;
        host = authority.slice(0, lastColon).trim();
        portStr = authority.slice(lastColon + 1);
    }

    const port = Number(portStr);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }

    return {
        host: host.toLowerCase().replace(/\.+$/, ''),
        port,
    };
}

/**
 * Parse the numeric HTTP status code from an upstream HTTP proxy response
 * header block (e.g. `HTTP/1.1 200 Connection Established`).
 * @param {string} headerBlock
 * @returns {number | null}
 */
export function parseHttpProxyStatusCode(headerBlock) {
    if (typeof headerBlock !== 'string' || !headerBlock) return null;
    const lineEnd = headerBlock.indexOf('\r\n');
    const statusLine =
        lineEnd >= 0 ? headerBlock.slice(0, lineEnd) : headerBlock;
    const match = /^HTTP\/1\.[01]\s+(\d{3})\b/i.exec(statusLine.trim());
    if (!match) return null;
    return Number(match[1]);
}

/**
 * Determine whether a CONNECT target host is a dedicated DBSC auth-refresh
 * host that should receive post-TLS response-stall and idle-socket guards.
 * @param {string | undefined} host
 * @returns {boolean}
 */
export function isDbscAuthRefreshHost(host) {
    if (typeof host !== 'string' || !host.trim()) return false;
    const normalized = host.trim().toLowerCase().replace(/\.+$/, '');
    return DBSC_AUTH_REFRESH_HOST_SET.has(normalized);
}
