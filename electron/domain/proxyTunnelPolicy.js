// These deadlines cover outstanding requests only. Established tunnels use
// the browser and upstream proxy's native connection lifecycle.
export const DEFAULT_TUNNEL_WATCHDOG_CONFIG = Object.freeze({
    connectHandshakeTimeoutMs: 20_000,
    tlsHandshakeTimeoutMs: 20_000,
});

/** @param {boolean | Partial<typeof DEFAULT_TUNNEL_WATCHDOG_CONFIG> | undefined} raw */
export function normalizeTunnelWatchdogConfig(raw) {
    if (raw === true) return DEFAULT_TUNNEL_WATCHDOG_CONFIG;
    if (!raw || typeof raw !== 'object') return null;
    const timeout = (ms, fallback) =>
        Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : fallback;
    return {
        connectHandshakeTimeoutMs: timeout(
            raw.connectHandshakeTimeoutMs,
            DEFAULT_TUNNEL_WATCHDOG_CONFIG.connectHandshakeTimeoutMs,
        ),
        tlsHandshakeTimeoutMs: timeout(
            raw.tlsHandshakeTimeoutMs,
            DEFAULT_TUNNEL_WATCHDOG_CONFIG.tlsHandshakeTimeoutMs,
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
