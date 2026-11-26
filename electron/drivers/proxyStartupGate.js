import fs from 'fs';
import net from 'net';
import path from 'path';
import {
    normalizeTunnelWatchdogConfig,
    parseHttpConnectTarget,
    parseHttpProxyStatusCode,
} from '../domain/proxyTunnelPolicy.js';
import { parseProxyAddress } from './proxyProbeClient.js';

/**
 * @typedef {{
 *   info?: (...args: unknown[]) => void;
 *   warn?: (...args: unknown[]) => void;
 *   debug?: (...args: unknown[]) => void;
 * }} GateLogger
 */

/**
 * @typedef {{
 *   port: number;
 *   isReleased: () => boolean;
 *   isAborted: () => boolean;
 *   getStats: () => {
 *     port: number;
 *     released: boolean;
 *     aborted: boolean;
 *     heldCount: number;
 *     droppedCount: number;
 *     forwardedCount: number;
 *     watchdogTerminatedCount: number;
 *     watchdogReasons: Record<string, number>;
 *   };
 *   release: () => number;
 *   dropHeldAndRelease: () => { droppedCount: number };
 *   abortFailClosed: () => Promise<{ droppedCount: number }>;
 *   close: () => Promise<void>;
 * }} ProxyStartupGate
 */

/**
 * Build a Chromium `--accept-lang` comma-separated value (without `;q=` weights)
 * so native `navigator.languages` reports e.g. `['en-US', 'en']` without JS hooks.
 * @param {string | undefined} language
 * @returns {string}
 */
export function buildAcceptLangSwitchValue(language) {
    const primary =
        typeof language === 'string' && language.trim() ? language.trim() : 'en-US';
    const base = primary.split('-')[0] || 'en';
    if (primary.toLowerCase() === base.toLowerCase()) {
        return primary;
    }
    return `${primary},${base}`;
}

/**
 * Rewrite a proxy URL to route through a local loopback TCP startup gate while
 * preserving scheme and optional credentials.
 * @param {string} proxyAddress
 * @param {number} gatePort
 * @returns {{ upstreamHost: string; upstreamPort: number; gateProxyAddress: string } | null}
 */
export function rewriteProxyAddressForGate(proxyAddress, gatePort) {
    const parsed = parseProxyAddress(proxyAddress);
    if (!parsed || !parsed.host || !parsed.port || !Number.isInteger(gatePort) || gatePort <= 0) {
        return null;
    }
    const raw = String(proxyAddress).trim();
    const normalized = raw.includes('://') ? raw : `http://${raw}`;
    let url;
    try {
        url = new URL(normalized);
    } catch {
        return null;
    }
    const auth =
        url.username || url.password
            ? `${url.username}${url.password ? `:${url.password}` : ''}@`
            : '';
    return {
        upstreamHost: parsed.host,
        upstreamPort: parsed.port,
        gateProxyAddress: `${url.protocol}//${auth}127.0.0.1:${gatePort}`,
    };
}

/**
 * Remove legacy `_tz_extension` registration from Chrome Preferences (both the
 * fixed `multichrome_tz_override` key and any unpacked extension ID pointing to
 * `<dataDir>/_tz_extension`) and delete the `_tz_extension` directory on disk.
 * Never modifies or removes user-installed extensions.
 * @param {string} dataDir
 * @param {Record<string, any>} prefs
 * @param {{ disableDeveloperMode?: boolean }} [options]
 * @returns {{ removedIds: string[]; removedDir: boolean }}
 */
export function cleanupLegacyFingerprintExtension(dataDir, prefs, options = {}) {
    const removedIds = [];
    const legacyExtDir = path.resolve(dataDir, '_tz_extension');
    const normalizePath = (p) => {
        const resolved = path.resolve(String(p));
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const normalizedLegacyDir = normalizePath(legacyExtDir);

    let installedId = '';
    const installedMarker = path.join(legacyExtDir, '.installed');
    try {
        if (fs.existsSync(installedMarker)) {
            installedId = fs.readFileSync(installedMarker, 'utf-8').trim();
        }
    } catch {
        installedId = '';
    }

    const settings = prefs?.extensions?.settings;
    if (settings && typeof settings === 'object') {
        for (const [extId, entry] of Object.entries(settings)) {
            const entryPath =
                entry && typeof entry === 'object' && typeof entry.path === 'string'
                    ? normalizePath(entry.path)
                    : '';
            const isLegacy =
                extId === 'multichrome_tz_override' ||
                (installedId && extId === installedId) ||
                (entryPath && entryPath === normalizedLegacyDir);
            if (isLegacy) {
                delete settings[extId];
                removedIds.push(extId);
            }
        }
    }

    if (options.disableDeveloperMode && prefs?.extensions?.developer?.developer_mode === true) {
        const hasOtherUnpacked =
            settings && typeof settings === 'object'
                ? Object.values(settings).some(
                      (entry) => entry && typeof entry === 'object' && entry.location === 4,
                  )
                : false;
        if (!hasOtherUnpacked) {
            prefs.extensions.developer.developer_mode = false;
        }
    }

    let removedDir = false;
    if (fs.existsSync(legacyExtDir)) {
        try {
            fs.rmSync(legacyExtDir, { recursive: true, force: true });
            removedDir = true;
        } catch {
            removedDir = false;
        }
    }

    return { removedIds, removedDir };
}

/**
 * Observe only the CONNECT exchange and the initial TLS record header. Once the
 * server sends tunnel data, the sockets revert to ordinary pipe semantics.
 */
function attachHttpConnectTunnelWatchdog(clientSocket, upstream, config, onTerminated, logger) {
    let phase = 'request';
    let header = '';
    let helloPrefix = Buffer.alloc(0);
    let sentHello = false;
    let timer;

    function cleanup() {
        clearTimeout(timer);
        header = '';
        clientSocket.off('data', onClientData);
        upstream.off('data', onUpstreamData);
        clientSocket.off('close', cleanup);
        upstream.off('close', cleanup);
    }

    function arm(reason, timeoutMs) {
        clearTimeout(timer);
        if (!timeoutMs) return;
        timer = setTimeout(() => {
            cleanup();
            onTerminated(reason);
            upstream.destroy();
            clientSocket.destroy();
            logger?.warn?.(reason === 'connect_handshake_timeout'
                ? '代理未及时回应 CONNECT 请求 (connect_handshake_timeout)'
                : '代理隧道未及时收到 TLS 握手回复 (tls_handshake_timeout)');
        }, timeoutMs);
        timer.unref();
    }

    // The header delimiter can span TCP reads. Never buffer the TLS payload
    // or retain HTTP headers after the decision.
    function readHead(chunk) {
        const previousLength = header.length;
        header += chunk.subarray(0, 8192 - previousLength).toString('latin1');
        const end = header.indexOf('\r\n\r\n');
        if (end < 0) {
            if (header.length >= 8192) cleanup();
            return null;
        }
        const head = header.slice(0, end);
        header = '';
        return { head, tail: chunk.subarray(end + 4 - previousLength) };
    }

    function observeHello(chunk) {
        if (sentHello || !chunk.length) return;
        // TLS record type (handshake), major version, and ClientHello message type.
        helloPrefix = Buffer.concat([helloPrefix, chunk.subarray(0, 6 - helloPrefix.length)]);
        if (helloPrefix[0] !== 0x16 || (helloPrefix.length > 1 && helloPrefix[1] !== 3)) {
            cleanup();
            return;
        }
        if (helloPrefix.length < 6) return;
        if (helloPrefix[5] !== 1) {
            cleanup();
            return;
        }
        sentHello = true;
        if (phase === 'tls') arm('tls_handshake_timeout', config.tlsHandshakeTimeoutMs);
    }

    function onClientData(chunk) {
        if (phase !== 'request') {
            observeHello(chunk);
            return;
        }
        if (!header.length && chunk[0] !== 0x43) {
            cleanup();
            return;
        }
        const request = readHead(chunk);
        if (!request) return;
        if (!parseHttpConnectTarget(request.head)) {
            cleanup();
            return;
        }
        phase = 'response';
        arm('connect_handshake_timeout', config.connectHandshakeTimeoutMs);
        observeHello(request.tail);
    }

    function onUpstreamData(chunk) {
        if (phase !== 'response') {
            cleanup();
            return;
        }
        const response = readHead(chunk);
        if (!response) return;
        clearTimeout(timer);
        const code = parseHttpProxyStatusCode(response.head);
        if (code === null || code < 200 || code >= 300 || response.tail.length) {
            cleanup();
            return;
        }
        phase = 'tls';
        if (sentHello) arm('tls_handshake_timeout', config.tlsHandshakeTimeoutMs);
    }

    clientSocket.on('data', onClientData);
    upstream.on('data', onUpstreamData);
    clientSocket.once('close', cleanup);
    upstream.once('close', cleanup);
}

/**
 * Create a lightweight L4 loopback TCP Startup Hold-Gate / Tunnel Watchdog in front of a proxy.
 *
 * - When `holdOnStart` is true (default): starts in HOLD mode, accepting TCP connections from
 *   Chrome and pausing reads until CDP attaches and applies native V8 Emulation overrides.
 * - When `holdOnStart` is false: starts immediately released in zero-hold passthrough mode so
 *   engines with native C++ flags still benefit from the HTTP CONNECT stall watchdog without
 *   adding startup latency.
 * - `release()`: forwards all held sockets to upstream and switches to direct
 *   passthrough for all future connections.
 * - `dropHeldAndRelease()`: destroys all held pre-CDP sockets (preventing any
 *   buffered beacons from disk-cached / Service Worker tabs from reaching the
 *   upstream proxy) and immediately switches the gate to open passthrough.
 * - `abortFailClosed()`: destroys all held/active sockets and closes the gate
 *   WITHOUT ever forwarding traffic (strict Fail-Closed on CDP timeout/failure).
 * - Safety timer (`maxHoldMs`): defaults to Fail-Closed (`failClosedOnTimeout: true`)
 *   so unaligned sessions are blocked instead of silently leaking local timezone.
 *
 * @param {{
 *   upstreamHost: string;
 *   upstreamPort: number;
 *   holdOnStart?: boolean;
 *   maxHoldMs?: number;
 *   failClosedOnTimeout?: boolean;
 *   tunnelWatchdog?: boolean | Partial<typeof import('../domain/proxyTunnelPolicy.js').DEFAULT_TUNNEL_WATCHDOG_CONFIG>;
 *   onTimeoutAbort?: () => void;
 *   logger?: GateLogger;
 * }} options
 * @returns {Promise<ProxyStartupGate>}
 */
export function createProxyStartupGate({
    upstreamHost,
    upstreamPort,
    holdOnStart = true,
    maxHoldMs = 8000,
    failClosedOnTimeout = true,
    tunnelWatchdog = false,
    onTimeoutAbort,
    logger,
}) {
    const watchdogConfig = normalizeTunnelWatchdogConfig(tunnelWatchdog);
    let released = !holdOnStart;
    let aborted = false;
    let closed = false;
    let droppedCount = 0;
    let forwardedCount = 0;
    let watchdogTerminatedCount = 0;
    /** @type {Record<string, number>} */
    const watchdogReasons = {};
    /** @type {Set<net.Socket>} */
    const heldSockets = new Set();
    /** @type {Set<net.Socket>} */
    const activeSockets = new Set();
    /** @type {NodeJS.Timeout | null} */
    let safetyTimer = null;

    /** @param {net.Socket} clientSocket */
    function pipeToUpstream(clientSocket) {
        if (closed || aborted || clientSocket.destroyed) {
            clientSocket.destroy();
            return;
        }
        const upstream = net.connect(upstreamPort, upstreamHost);
        activeSockets.add(upstream);
        upstream.on('close', () => activeSockets.delete(upstream));
        upstream.on('error', () => {
            if (!clientSocket.destroyed) clientSocket.destroy();
        });
        clientSocket.on('error', () => {
            if (!upstream.destroyed) upstream.destroy();
        });
        if (watchdogConfig) {
            attachHttpConnectTunnelWatchdog(
                clientSocket,
                upstream,
                watchdogConfig,
                (reason) => {
                    watchdogTerminatedCount += 1;
                    watchdogReasons[reason] =
                        (watchdogReasons[reason] || 0) + 1;
                },
                logger,
            );
        }
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
        clientSocket.resume();
    }

    function clearSafetyTimer() {
        if (safetyTimer) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
        }
    }

    function release() {
        clearSafetyTimer();
        if (released || aborted || closed) return 0;
        released = true;
        const pending = Array.from(heldSockets);
        heldSockets.clear();
        let count = 0;
        for (const sock of pending) {
            if (!sock.destroyed) {
                count += 1;
                forwardedCount += 1;
                pipeToUpstream(sock);
            }
        }
        return count;
    }

    function dropHeldAndRelease() {
        clearSafetyTimer();
        if (aborted || closed) return { droppedCount: 0 };
        released = true;
        const pending = Array.from(heldSockets);
        heldSockets.clear();
        let dropped = 0;
        for (const sock of pending) {
            if (!sock.destroyed) {
                dropped += 1;
                droppedCount += 1;
                sock.destroy();
            }
        }
        return { droppedCount: dropped };
    }

    function closeServerSockets() {
        for (const sock of Array.from(activeSockets)) {
            sock.destroy();
        }
        activeSockets.clear();
        return new Promise((done) => {
            try {
                server.close(() => done());
            } catch {
                done();
            }
        });
    }

    async function abortFailClosed() {
        clearSafetyTimer();
        aborted = true;
        closed = true;
        released = false;
        const pending = Array.from(heldSockets);
        heldSockets.clear();
        let dropped = 0;
        for (const sock of pending) {
            if (!sock.destroyed) {
                dropped += 1;
                droppedCount += 1;
                sock.destroy();
            }
        }
        await closeServerSockets();
        return { droppedCount: dropped };
    }

    const server = net.createServer((clientSocket) => {
        if (closed || aborted) {
            clientSocket.destroy();
            return;
        }
        activeSockets.add(clientSocket);
        clientSocket.on('close', () => {
            activeSockets.delete(clientSocket);
            heldSockets.delete(clientSocket);
        });
        clientSocket.on('error', () => {
            heldSockets.delete(clientSocket);
            if (!clientSocket.destroyed) clientSocket.destroy();
        });

        if (released) {
            forwardedCount += 1;
            pipeToUpstream(clientSocket);
            return;
        }

        clientSocket.pause();
        heldSockets.add(clientSocket);
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            const address = server.address();
            const port =
                address && typeof address === 'object' ? address.port : 0;

            if (holdOnStart && maxHoldMs > 0) {
                safetyTimer = setTimeout(() => {
                    if (!released && !closed && !aborted) {
                        if (failClosedOnTimeout) {
                            logger?.warn?.(
                                `[启动闸门] 等待 CDP 超时 (${maxHoldMs}ms)，Fail-Closed 已阻断并中止启动`,
                            );
                            void abortFailClosed().finally(() => {
                                try {
                                    onTimeoutAbort?.();
                                } catch {
                                    // ignore callback error
                                }
                            });
                        } else {
                            const count = release();
                            logger?.warn?.(
                                `[启动闸门] 等待 CDP 超时 (${maxHoldMs}ms)，已自动放行 ${count} 条连接`,
                            );
                        }
                    }
                }, maxHoldMs);
                safetyTimer.unref?.();
            }

            resolve({
                port,
                isReleased: () => released,
                isAborted: () => aborted,
                getStats: () => ({
                    port,
                    released,
                    aborted,
                    heldCount: heldSockets.size,
                    droppedCount,
                    forwardedCount,
                    watchdogTerminatedCount,
                    watchdogReasons: { ...watchdogReasons },
                }),
                release,
                dropHeldAndRelease,
                abortFailClosed,
                close: async () => {
                    clearSafetyTimer();
                    closed = true;
                    heldSockets.clear();
                    await closeServerSockets();
                },
            });
        });
    });
}
