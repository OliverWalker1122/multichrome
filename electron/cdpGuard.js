import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import {
    sanitizeAutomationErrorMessage,
    verifyLoopbackRequestSecurity,
} from './automationConfig.js';

/**
 * CDP methods sent automatically by Playwright / Puppeteer / @playwright/mcp / chrome-devtools-mcp
 * that would otherwise overwrite MultiChrome's C++ window size, UA/Client-Hints, or proxy-matched
 * timezone / locale / geolocation. Returning `{ id, result: {} }` satisfies the CDP spec cleanly
 * so external clients never error while the underlying browser environment stays untouched.
 */
export const IGNORED_CDP_OVERRIDE_METHODS = new Set([
    'Emulation.setUserAgentOverride',
    'Network.setUserAgentOverride',
    'Emulation.setTimezoneOverride',
    'Emulation.setLocaleOverride',
    'Emulation.setGeolocationOverride',
    'Emulation.clearGeolocationOverride',
    'Emulation.setDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
]);

export const BLOCKED_CDP_CONTEXT_METHODS = new Set([
    'Target.createBrowserContext',
]);

/**
 * Pure stateless inspector for outgoing client -> browser CDP JSON-RPC frames.
 * Returns `{ action: 'forward' }` for 99.9% of commands, or `{ action: 'reply', payload }`
 * when intercepting an environment-clobbering command.
 */
export function inspectClientCdpMessage(rawData) {
    let text;
    if (typeof rawData === 'string') {
        text = rawData;
    } else if (Buffer.isBuffer(rawData)) {
        text = rawData.toString('utf8');
    } else if (rawData instanceof ArrayBuffer) {
        text = Buffer.from(rawData).toString('utf8');
    } else if (Array.isArray(rawData)) {
        text = Buffer.concat(rawData).toString('utf8');
    } else {
        return { action: 'forward' };
    }

    // Fast path: skip JSON.parse if none of the guarded method prefixes appear in the frame
    if (
        !text.includes('Override') &&
        !text.includes('createBrowserContext')
    ) {
        return { action: 'forward' };
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { action: 'forward' };
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof parsed.method !== 'string'
    ) {
        return { action: 'forward' };
    }

    const { id, method, sessionId } = parsed;
    if (id === undefined || id === null) {
        return { action: 'forward' };
    }

    if (IGNORED_CDP_OVERRIDE_METHODS.has(method)) {
        const payload = { id, result: {} };
        if (typeof sessionId === 'string' && sessionId) {
            payload.sessionId = sessionId;
        }
        return {
            action: 'reply',
            reason: 'ignored_override',
            method,
            payload,
        };
    }

    if (BLOCKED_CDP_CONTEXT_METHODS.has(method)) {
        const payload = {
            id,
            error: {
                code: -32000,
                message:
                    'MultiChrome CDP Guard: Do not call browser.newContext() (Target.createBrowserContext), which opens an empty incognito context without profile cookies. Use browser.contexts()[0] instead.',
            },
        };
        if (typeof sessionId === 'string' && sessionId) {
            payload.sessionId = sessionId;
        }
        return {
            action: 'reply',
            reason: 'blocked_incognito_context',
            method,
            payload,
        };
    }

    return { action: 'forward' };
}

function fetchInternalJson(port, pathname, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            `http://127.0.0.1:${port}${pathname}`,
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode !== 200) {
                        reject(
                            new Error(
                                `Upstream DevTools returned HTTP ${res.statusCode}`,
                            ),
                        );
                        return;
                    }
                    try {
                        resolve(JSON.parse(text));
                    } catch {
                        reject(new Error('Invalid JSON from upstream DevTools'));
                    }
                });
            },
        );
        req.on('error', (err) => reject(err));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('Upstream DevTools request timed out'));
        });
    });
}

export function buildGuardedBrowserWsUrl(boundPort, profileId, isActiveSlot = false) {
    const suffix = isActiveSlot
        ? `/devtools/browser/active/${encodeURIComponent(profileId)}`
        : `/devtools/browser/${encodeURIComponent(profileId)}`;
    return `ws://127.0.0.1:${boundPort}${suffix}`;
}

export function buildGuardedPageWsUrl(boundPort, profileId, targetId, isActiveSlot = false) {
    const prefix = isActiveSlot
        ? `/devtools/page/active/${encodeURIComponent(profileId)}`
        : `/devtools/page/${encodeURIComponent(profileId)}`;
    return `ws://127.0.0.1:${boundPort}${prefix}/${encodeURIComponent(targetId)}`;
}

export function rewriteVersionMetadata(rawVersion, { boundPort, profileId, isActiveSlot = false }) {
    const base =
        rawVersion && typeof rawVersion === 'object' ? { ...rawVersion } : {};
    base.webSocketDebuggerUrl = buildGuardedBrowserWsUrl(
        boundPort,
        profileId,
        isActiveSlot,
    );
    return base;
}

export function rewriteTargetList(rawList, { boundPort, profileId, isActiveSlot = false }) {
    if (!Array.isArray(rawList)) {
        return [];
    }
    return rawList.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            return entry;
        }
        const next = { ...entry };
        const targetId =
            typeof entry.id === 'string' && entry.id.trim()
                ? entry.id.trim()
                : '';
        if (targetId && typeof entry.webSocketDebuggerUrl === 'string') {
            const wsHostPath = `${ `127.0.0.1:${boundPort}` }${
                isActiveSlot
                    ? `/devtools/page/active/${encodeURIComponent(profileId)}/${encodeURIComponent(targetId)}`
                    : `/devtools/page/${encodeURIComponent(profileId)}/${encodeURIComponent(targetId)}`
            }`;
            next.webSocketDebuggerUrl = `ws://${wsHostPath}`;
            if (typeof next.devtoolsFrontendUrl === 'string') {
                next.devtoolsFrontendUrl = `/devtools/inspector.html?ws=${wsHostPath}`;
            }
        }
        return next;
    });
}

function writeUpgradeError(socket, statusCode, statusText, message) {
    try {
        const body = JSON.stringify({
            ok: false,
            error: sanitizeAutomationErrorMessage(message, statusText),
        });
        socket.write(
            `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
                'Content-Type: application/json; charset=utf-8\r\n' +
                'Connection: close\r\n' +
                `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
                body,
        );
    } catch {
        // ignore socket write error
    } finally {
        try {
            socket.destroy();
        } catch {
            // ignore
        }
    }
}

/**
 * Parse CDP HTTP discovery paths:
 * - `/json/version` | `/json` | `/json/list`  (active profile slot)
 * - `/cdp/<profileId>/json/version` | `/cdp/<profileId>/json` | `/cdp/<profileId>/json/list`
 */
export function parseCdpHttpRoute(pathname) {
    if (pathname === '/json/version' || pathname === '/json/version/') {
        return { kind: 'version', profileId: null, isActiveSlot: true };
    }
    if (
        pathname === '/json' ||
        pathname === '/json/' ||
        pathname === '/json/list' ||
        pathname === '/json/list/'
    ) {
        return { kind: 'list', profileId: null, isActiveSlot: true };
    }

    const scopedMatch = pathname.match(
        /^\/cdp\/([^/]+)\/json(?:\/(version|list))?\/?$/,
    );
    if (scopedMatch) {
        const profileId = decodeURIComponent(scopedMatch[1]);
        const sub = scopedMatch[2] || 'list';
        return {
            kind: sub === 'version' ? 'version' : 'list',
            profileId,
            isActiveSlot: false,
        };
    }

    return null;
}

/**
 * Parse CDP WebSocket upgrade paths:
 * - `/devtools/browser` -> active profile
 * - `/devtools/browser/active/<profileId>` -> active slot pinned to profileId
 * - `/devtools/browser/<profileId>` -> explicit profile
 * - `/devtools/page/active/<profileId>/<targetId>` -> active slot page target
 * - `/devtools/page/<profileId>/<targetId>` -> explicit profile page target
 */
export function parseCdpWsRoute(pathname) {
    if (pathname === '/devtools/browser' || pathname === '/devtools/browser/') {
        return {
            targetType: 'browser',
            profileId: null,
            targetId: null,
            isActiveSlot: true,
        };
    }

    const activeBrowserMatch = pathname.match(
        /^\/devtools\/browser\/active\/([^/]+)\/?$/,
    );
    if (activeBrowserMatch) {
        return {
            targetType: 'browser',
            profileId: decodeURIComponent(activeBrowserMatch[1]),
            targetId: null,
            isActiveSlot: true,
        };
    }

    const explicitBrowserMatch = pathname.match(
        /^\/devtools\/browser\/([^/]+)\/?$/,
    );
    if (explicitBrowserMatch) {
        return {
            targetType: 'browser',
            profileId: decodeURIComponent(explicitBrowserMatch[1]),
            targetId: null,
            isActiveSlot: false,
        };
    }

    const activePageMatch = pathname.match(
        /^\/devtools\/page\/active\/([^/]+)\/([^/]+)\/?$/,
    );
    if (activePageMatch) {
        return {
            targetType: 'page',
            profileId: decodeURIComponent(activePageMatch[1]),
            targetId: decodeURIComponent(activePageMatch[2]),
            isActiveSlot: true,
        };
    }

    const explicitPageMatch = pathname.match(
        /^\/devtools\/page\/([^/]+)\/([^/]+)\/?$/,
    );
    if (explicitPageMatch) {
        return {
            targetType: 'page',
            profileId: decodeURIComponent(explicitPageMatch[1]),
            targetId: decodeURIComponent(explicitPageMatch[2]),
            isActiveSlot: false,
        };
    }

    return null;
}

export function createCdpGuard({
    backend,
    getBoundPort,
    fetchJson = fetchInternalJson,
    WebSocketImpl = WebSocket,
    logger = console,
}) {
    if (!backend || typeof backend !== 'object') {
        throw new Error('createCdpGuard requires backend');
    }

    const wss = new WebSocketServer({ noServer: true });
    /** @type {Set<{ profileId: string, isActiveSlot: boolean, clientWs: WebSocket, upstreamWs: WebSocket }>} */
    const sessions = new Set();

    function closeSessionPair(entry, code = 1001, reason = 'Session closed') {
        if (!sessions.has(entry)) return;
        sessions.delete(entry);
        try {
            if (
                entry.clientWs.readyState === WebSocketImpl.OPEN ||
                entry.clientWs.readyState === WebSocketImpl.CONNECTING
            ) {
                entry.clientWs.close(code, reason);
            }
        } catch {
            try {
                entry.clientWs.terminate?.();
            } catch {
                // ignore
            }
        }
        try {
            if (
                entry.upstreamWs.readyState === WebSocketImpl.OPEN ||
                entry.upstreamWs.readyState === WebSocketImpl.CONNECTING
            ) {
                entry.upstreamWs.close();
            }
        } catch {
            try {
                entry.upstreamWs.terminate?.();
            } catch {
                // ignore
            }
        }
    }

    function disconnectProfileSessions(
        profileId,
        reason = 'Profile or bound proxy stopped (Fail-Closed)',
    ) {
        for (const entry of Array.from(sessions)) {
            if (entry.profileId === profileId) {
                closeSessionPair(entry, 1011, reason);
            }
        }
    }

    function disconnectActiveSlotSessions(
        exceptProfileId = null,
        reason = 'Active target profile switched',
    ) {
        for (const entry of Array.from(sessions)) {
            if (
                entry.isActiveSlot &&
                (!exceptProfileId || entry.profileId !== exceptProfileId)
            ) {
                closeSessionPair(entry, 1001, reason);
            }
        }
    }

    function closeAll() {
        for (const entry of Array.from(sessions)) {
            closeSessionPair(entry, 1001, 'CDP Guard shutting down');
        }
    }

    async function handleHttpDiscovery(req, res, pathname) {
        const route = parseCdpHttpRoute(pathname);
        if (!route) {
            return false;
        }

        if (req.method !== 'GET') {
            res.writeHead(405, {
                'Content-Type': 'application/json; charset=utf-8',
                Allow: 'GET',
            });
            res.end(
                JSON.stringify({
                    ok: false,
                    error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET' },
                }),
            );
            return true;
        }

        const boundPort = getBoundPort();
        const resolved = await backend.resolveGuardedCdpTarget(route.profileId);

        if (route.kind === 'version') {
            const rawVersion = await fetchJson(
                resolved.internalDebugPort,
                '/json/version',
            );
            const payload = rewriteVersionMetadata(rawVersion, {
                boundPort,
                profileId: resolved.profileId,
                isActiveSlot: route.isActiveSlot,
            });
            res.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': 'application/json; charset=utf-8',
            });
            res.end(JSON.stringify(payload));
            return true;
        }

        const rawList = await fetchJson(
            resolved.internalDebugPort,
            '/json/list',
        );
        const payload = rewriteTargetList(rawList, {
            boundPort,
            profileId: resolved.profileId,
            isActiveSlot: route.isActiveSlot,
        });
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(payload));
        return true;
    }

    async function handleUpgrade(req, socket, head) {
        const boundPort = getBoundPort();
        const securityCheck = verifyLoopbackRequestSecurity(req, boundPort);
        if (!securityCheck.ok) {
            writeUpgradeError(
                socket,
                securityCheck.status,
                'Forbidden',
                securityCheck.message,
            );
            return;
        }

        let pathname = '/';
        try {
            pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
        } catch {
            writeUpgradeError(socket, 400, 'Bad Request', 'Malformed URL');
            return;
        }

        const wsRoute = parseCdpWsRoute(pathname);
        if (!wsRoute) {
            writeUpgradeError(
                socket,
                404,
                'Not Found',
                `Unknown CDP WebSocket path: ${pathname}`,
            );
            return;
        }

        let resolved;
        try {
            resolved = await backend.resolveGuardedCdpTarget(
                wsRoute.profileId,
            );
        } catch (err) {
            const statusCode =
                err &&
                typeof err === 'object' &&
                Number.isInteger(err.statusCode)
                    ? err.statusCode
                    : 503;
            writeUpgradeError(
                socket,
                statusCode,
                'Service Unavailable',
                err instanceof Error ? err.message : 'Target unavailable',
            );
            return;
        }

        const upstreamUrl =
            wsRoute.targetType === 'browser'
                ? resolved.internalWsEndpoint
                : `ws://127.0.0.1:${resolved.internalDebugPort}/devtools/page/${encodeURIComponent(wsRoute.targetId)}`;

        let upstreamWs;
        try {
            upstreamWs = new WebSocketImpl(upstreamUrl, {
                perMessageDeflate: false,
                maxPayload: 128 * 1024 * 1024,
            });
        } catch (err) {
            writeUpgradeError(
                socket,
                502,
                'Bad Gateway',
                err instanceof Error ? err.message : 'Upstream connect failed',
            );
            return;
        }

        let opened = false;
        const connectTimer = setTimeout(() => {
            if (!opened) {
                try {
                    upstreamWs.terminate?.();
                } catch {
                    // ignore
                }
                writeUpgradeError(
                    socket,
                    504,
                    'Gateway Timeout',
                    'Timed out connecting to browser CDP endpoint',
                );
            }
        }, 5000);

        upstreamWs.once('error', (err) => {
            if (!opened) {
                clearTimeout(connectTimer);
                writeUpgradeError(
                    socket,
                    502,
                    'Bad Gateway',
                    err instanceof Error
                        ? err.message
                        : 'Failed to connect to browser CDP endpoint',
                );
            }
        });

        upstreamWs.once('open', () => {
            opened = true;
            clearTimeout(connectTimer);

            wss.handleUpgrade(req, socket, head, (clientWs) => {
                const entry = {
                    profileId: resolved.profileId,
                    isActiveSlot: wsRoute.isActiveSlot,
                    clientWs,
                    upstreamWs,
                };
                sessions.add(entry);

                clientWs.on('message', (data, isBinary) => {
                    // Re-verify proxy health on active traffic (O(1) memory check, Fail-Closed)
                    if (
                        typeof backend.isProfileProxyHealthy === 'function' &&
                        !backend.isProfileProxyHealthy(resolved.profileId)
                    ) {
                        closeSessionPair(
                            entry,
                            1011,
                            'Bound proxy disconnected (Fail-Closed)',
                        );
                        return;
                    }

                    if (!isBinary) {
                        const verdict = inspectClientCdpMessage(data);
                        if (verdict.action === 'reply') {
                            try {
                                if (clientWs.readyState === WebSocketImpl.OPEN) {
                                    clientWs.send(
                                        JSON.stringify(verdict.payload),
                                    );
                                }
                            } catch (sendErr) {
                                logger?.warn?.(
                                    `[CDPGuard] Reply failed: ${sanitizeAutomationErrorMessage(sendErr)}`,
                                );
                            }
                            return;
                        }
                    }

                    if (upstreamWs.readyState === WebSocketImpl.OPEN) {
                        upstreamWs.send(data, { binary: Boolean(isBinary) });
                    }
                });

                upstreamWs.on('message', (data, isBinary) => {
                    if (clientWs.readyState === WebSocketImpl.OPEN) {
                        clientWs.send(data, { binary: Boolean(isBinary) });
                    }
                });

                clientWs.once('close', () => {
                    closeSessionPair(entry, 1000, 'Client disconnected');
                });
                clientWs.once('error', () => {
                    closeSessionPair(entry, 1011, 'Client socket error');
                });
                upstreamWs.once('close', () => {
                    closeSessionPair(entry, 1001, 'Browser disconnected');
                });
                upstreamWs.once('error', () => {
                    closeSessionPair(entry, 1011, 'Browser socket error');
                });
            });
        });
    }

    return {
        handleHttpDiscovery,
        handleUpgrade,
        disconnectProfileSessions,
        disconnectActiveSlotSessions,
        closeAll,
        getActiveSessionCount: () => sessions.size,
    };
}
