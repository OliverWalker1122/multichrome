import fs from 'fs';
import net from 'net';
import path from 'path';
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
 * Create a lightweight L4 loopback TCP Startup Hold-Gate in front of a proxy.
 *
 * - Starts in HOLD mode: accepts TCP connections from Chrome and pauses reads so
 *   restored session tabs cannot fetch network responses or send beacons before
 *   CDP attaches and applies native V8 Emulation overrides.
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
 *   maxHoldMs?: number;
 *   failClosedOnTimeout?: boolean;
 *   onTimeoutAbort?: () => void;
 *   logger?: GateLogger;
 * }} options
 * @returns {Promise<ProxyStartupGate>}
 */
export function createProxyStartupGate({
    upstreamHost,
    upstreamPort,
    maxHoldMs = 8000,
    failClosedOnTimeout = true,
    onTimeoutAbort,
    logger,
}) {
    let released = false;
    let aborted = false;
    let closed = false;
    let droppedCount = 0;
    let forwardedCount = 0;
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

            if (maxHoldMs > 0) {
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
