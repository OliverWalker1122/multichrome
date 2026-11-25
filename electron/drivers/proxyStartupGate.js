import fs from 'fs';
import net from 'net';
import path from 'path';
import {
    isDbscAuthRefreshHost,
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
 * Attach a passive, zero-MITM HTTP CONNECT stall watchdog to a piped socket
 * pair. Observes framing bytes without mutating or intercepting TLS traffic:
 * - All HTTP CONNECT tunnels: guards against stalled proxy CONNECT responses
 *   and stalled TLS ClientHello -> ServerHello handshakes, then detaches so
 *   steady-state traffic incurs zero ongoing callback overhead.
 * - Dedicated DBSC auth-refresh hosts (`accounts.google.com`,
 *   `accounts.youtube.com`): additionally guards against stalled active
 *   requests (equivalent to upstream Chromium's DBSC `URLFetcher` timeout) and
 *   recycles long-idle connections so 10-minute cookie rotations never hit
 *   zombie residential NAT tunnels.
 *
 * @param {net.Socket} clientSocket
 * @param {net.Socket} upstream
 * @param {{
 *   connectHandshakeTimeoutMs: number;
 *   tlsHandshakeTimeoutMs: number;
 *   dbscResponseTimeoutMs: number;
 *   dbscIdleTimeoutMs: number;
 *   minResponseTriggerBytes: number;
 * }} config
 * @param {(reason: string, host: string) => void} onTerminated
 * @param {GateLogger | undefined} logger
 */
function attachHttpConnectTunnelWatchdog(
    clientSocket,
    upstream,
    config,
    onTerminated,
    logger,
) {
    let phase = 'client_head';
    let clientHeadBuf = '';
    let upstreamHeadBuf = '';
    let isConnectTunnel = false;
    let isWatchedDbscHost = false;
    let targetHost = '';
    let unansweredClientBytes = 0;
    let awaitingResponse = false;
    let cleanedUp = false;

    /** @type {NodeJS.Timeout | null} */
    let handshakeTimer = null;
    /** @type {NodeJS.Timeout | null} */
    let tlsTimer = null;
    /** @type {NodeJS.Timeout | null} */
    let responseTimer = null;
    /** @type {NodeJS.Timeout | null} */
    let idleTimer = null;

    const clearTimer = (ref) => {
        if (ref) clearTimeout(ref);
        return null;
    };

    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        handshakeTimer = clearTimer(handshakeTimer);
        tlsTimer = clearTimer(tlsTimer);
        responseTimer = clearTimer(responseTimer);
        idleTimer = clearTimer(idleTimer);
        clientHeadBuf = '';
        upstreamHeadBuf = '';
        clientSocket.off('data', onClientData);
        upstream.off('data', onUpstreamData);
        clientSocket.off('close', cleanup);
        upstream.off('close', cleanup);
    };

    const detachToPassthrough = () => {
        phase = 'detached';
        cleanup();
    };

    const terminate = (reason) => {
        if (cleanedUp) return;
        cleanup();
        onTerminated(reason, targetHost);
        if (reason !== 'dbsc_idle_recycle') {
            logger?.warn?.(
                `[代理隧道看门狗] 检测到卡死连接 (${reason}${targetHost ? `, host=${targetHost}` : ''})，已主动断链触发重连`,
            );
        }
        if (!upstream.destroyed) upstream.destroy();
        if (!clientSocket.destroyed) clientSocket.destroy();
    };

    const armHandshakeTimer = () => {
        handshakeTimer = clearTimer(handshakeTimer);
        if (config.connectHandshakeTimeoutMs > 0) {
            handshakeTimer = setTimeout(
                () => terminate('connect_handshake_timeout'),
                config.connectHandshakeTimeoutMs,
            );
            handshakeTimer.unref?.();
        }
    };

    const armTlsTimer = () => {
        tlsTimer = clearTimer(tlsTimer);
        if (config.tlsHandshakeTimeoutMs > 0) {
            tlsTimer = setTimeout(
                () => terminate('tls_handshake_timeout'),
                config.tlsHandshakeTimeoutMs,
            );
            tlsTimer.unref?.();
        }
    };

    const armIdleTimer = () => {
        idleTimer = clearTimer(idleTimer);
        if (
            isWatchedDbscHost &&
            !awaitingResponse &&
            config.dbscIdleTimeoutMs > 0
        ) {
            idleTimer = setTimeout(
                () => terminate('dbsc_idle_recycle'),
                config.dbscIdleTimeoutMs,
            );
            idleTimer.unref?.();
        }
    };

    const armResponseTimerIfNeeded = () => {
        if (awaitingResponse || !isWatchedDbscHost) return;
        awaitingResponse = true;
        idleTimer = clearTimer(idleTimer);
        if (config.dbscResponseTimeoutMs > 0) {
            responseTimer = setTimeout(
                () => terminate('dbsc_response_timeout'),
                config.dbscResponseTimeoutMs,
            );
            responseTimer.unref?.();
        }
    };

    /** @param {Buffer} chunk */
    function onClientData(chunk) {
        if (cleanedUp || !chunk || chunk.length === 0) return;

        if (phase === 'client_head') {
            if (clientHeadBuf.length === 0) {
                const firstByte = chunk[0];
                if (firstByte < 0x41 || firstByte > 0x5a) {
                    detachToPassthrough();
                    return;
                }
            }
            clientHeadBuf += chunk.toString('latin1');
            if (clientHeadBuf.length > 8192) {
                detachToPassthrough();
                return;
            }
            const headerEnd = clientHeadBuf.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                if (!handshakeTimer) armHandshakeTimer();
                return;
            }

            const head = clientHeadBuf.slice(0, headerEnd);
            clientHeadBuf = '';
            const connectTarget = parseHttpConnectTarget(head);
            if (connectTarget) {
                isConnectTunnel = true;
                targetHost = connectTarget.host;
                isWatchedDbscHost = isDbscAuthRefreshHost(connectTarget.host);
            } else {
                isConnectTunnel = false;
            }
            phase = 'proxy_response';
            armHandshakeTimer();
            return;
        }

        if (phase === 'tls_handshake') {
            if (!tlsTimer) {
                armTlsTimer();
            }
            return;
        }

        if (phase === 'tunnel' && isWatchedDbscHost) {
            unansweredClientBytes += chunk.length;
            if (unansweredClientBytes >= config.minResponseTriggerBytes) {
                armResponseTimerIfNeeded();
            }
        }
    }

    /** @param {Buffer} chunk */
    function onUpstreamData(chunk) {
        if (cleanedUp || !chunk || chunk.length === 0) return;

        if (phase === 'client_head') {
            detachToPassthrough();
            return;
        }

        if (phase === 'proxy_response') {
            if (!isConnectTunnel) {
                detachToPassthrough();
                return;
            }
            upstreamHeadBuf += chunk.toString('latin1');
            if (upstreamHeadBuf.length > 8192) {
                detachToPassthrough();
                return;
            }
            const headerEnd = upstreamHeadBuf.indexOf('\r\n\r\n');
            if (headerEnd < 0) return;

            const statusCode = parseHttpProxyStatusCode(
                upstreamHeadBuf.slice(0, headerEnd),
            );
            const trailingBytes = upstreamHeadBuf.length - (headerEnd + 4);
            upstreamHeadBuf = '';
            handshakeTimer = clearTimer(handshakeTimer);

            if (statusCode !== 200) {
                detachToPassthrough();
                return;
            }

            phase = 'tls_handshake';
            if (trailingBytes > 0) {
                if (isWatchedDbscHost) {
                    phase = 'tunnel';
                    armIdleTimer();
                } else {
                    detachToPassthrough();
                }
            } else {
                armTlsTimer();
            }
            return;
        }

        if (phase === 'tls_handshake') {
            tlsTimer = clearTimer(tlsTimer);
            if (!isWatchedDbscHost) {
                detachToPassthrough();
                return;
            }
            phase = 'tunnel';
            unansweredClientBytes = 0;
            awaitingResponse = false;
            armIdleTimer();
            return;
        }

        if (phase === 'tunnel' && isWatchedDbscHost) {
            unansweredClientBytes = 0;
            awaitingResponse = false;
            responseTimer = clearTimer(responseTimer);
            armIdleTimer();
        }
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
