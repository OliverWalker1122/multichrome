import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import {
    authenticateAutomationRequest,
    sanitizeAutomationErrorMessage,
    verifyLoopbackRequestSecurity,
} from '../domain/automationPolicy.js';
import {
    BLOCKED_CDP_CONTEXT_METHODS,
    IGNORED_CDP_OVERRIDE_METHODS,
    buildGuardedBrowserWsUrl,
    buildGuardedPageWsUrl,
    inspectClientCdpMessage,
    parseCdpHttpRoute,
    parseCdpWsRoute,
    rewriteTargetList,
    rewriteVersionMetadata,
} from '../domain/cdpGuardPolicy.js';

export {
    BLOCKED_CDP_CONTEXT_METHODS,
    IGNORED_CDP_OVERRIDE_METHODS,
    buildGuardedBrowserWsUrl,
    buildGuardedPageWsUrl,
    inspectClientCdpMessage,
    parseCdpHttpRoute,
    parseCdpWsRoute,
    rewriteTargetList,
    rewriteVersionMetadata,
};

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

export function createCdpGuard({
    backend,
    getBoundPort,
    getRequiredToken = () => null,
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

        const requiredToken =
            typeof getRequiredToken === 'function' ? getRequiredToken() : null;
        const authCheck = authenticateAutomationRequest(
            req,
            requiredToken,
            boundPort,
        );
        if (!authCheck.ok) {
            writeUpgradeError(
                socket,
                authCheck.status,
                authCheck.status === 401 ? 'Unauthorized' : 'Bad Request',
                authCheck.message,
            );
            return;
        }

        const pathname = authCheck.pathname;

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
                wsRoute.isActiveSlot ? null : wsRoute.profileId,
            );
            if (wsRoute.isActiveSlot && wsRoute.profileId && wsRoute.profileId !== resolved.profileId) {
                writeUpgradeError(socket, 409, 'Conflict', 'Active profile changed. Refresh discovery.');
                return;
            }
        } catch (err) {
            const statusCode =
                err &&
                typeof err === 'object' &&
                Number.isInteger(err.statusCode)
                    ? err.statusCode
                    : 503;
            logger?.warn?.(
                `[CDPGuard] Upgrade rejected (${statusCode}): ${sanitizeAutomationErrorMessage(err)}`,
            );
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

            // Discovery and the upstream connection may straddle an active-target switch.
            const snapshot = wsRoute.isActiveSlot && backend.getActiveTargetSnapshot?.();
            if (snapshot && snapshot.activeProfileId !== resolved.profileId) {
                upstreamWs.terminate();
                writeUpgradeError(socket, 409, 'Conflict', 'Active profile changed. Refresh discovery.');
                return;
            }
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
        closeAllSessions: closeAll,
        getActiveSessionCount: () => sessions.size,
    };
}
