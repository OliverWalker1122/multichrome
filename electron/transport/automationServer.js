import http from 'node:http';
import {
    DEFAULT_AUTOMATION_PORT,
    formatAutomationBindError,
    sanitizeAutomationErrorMessage,
    validateAutomationPort,
    validateOptionalString,
    validateProfileListFilters,
    validateUuid,
    verifyLoopbackRequestSecurity,
} from '../domain/automationPolicy.js';
import { parseCdpHttpRoute } from '../domain/cdpGuardPolicy.js';
import { createCdpGuard } from './cdpGuardRelay.js';
import { createMcpHandler } from './mcpServer.js';

export const MAX_AUTOMATION_BODY_BYTES = 256 * 1024;

const BASE_SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
};

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class PayloadTooLargeError extends Error {
    constructor() {
        super('Request body exceeds 256 KB limit');
        this.statusCode = 413;
        this.code = 'PAYLOAD_TOO_LARGE';
    }
}

class BadJsonError extends Error {
    constructor(message = 'Invalid JSON request body') {
        super(message);
        this.statusCode = 400;
        this.code = 'INVALID_JSON';
    }
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
    if (res.writableEnded) return;
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        ...BASE_SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        ...extraHeaders,
    });
    res.end(body);
}

function sendError(res, statusCode, code, message, extraHeaders = {}) {
    sendJson(
        res,
        statusCode,
        {
            ok: false,
            error: {
                code,
                message: sanitizeAutomationErrorMessage(
                    message,
                    'Request failed',
                ),
            },
        },
        extraHeaders,
    );
}

function readRequestBody(req, maxBodyBytes) {
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader !== undefined) {
        const declared = Number(contentLengthHeader);
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
            return Promise.reject(new PayloadTooLargeError());
        }
    }

    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let settled = false;

        const cleanup = () => {
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('error', onError);
            req.off('aborted', onAborted);
        };

        const onData = (chunk) => {
            if (settled) return;
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes > maxBodyBytes) {
                settled = true;
                cleanup();
                reject(new PayloadTooLargeError());
                return;
            }
            chunks.push(buf);
        };

        const onEnd = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(Buffer.concat(chunks).toString('utf8'));
        };

        const onError = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        const onAborted = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new BadJsonError('Request aborted'));
        };

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
        req.on('aborted', onAborted);
    });
}

async function parseOptionalJsonBody(req, maxBodyBytes) {
    const raw = await readRequestBody(req, maxBodyBytes);
    const trimmed = raw.trim();
    if (!trimmed) {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        throw new BadJsonError('Malformed JSON payload');
    }
    if (!isPlainObject(parsed)) {
        throw new BadJsonError('Request body must be a JSON object');
    }
    return parsed;
}

export class AutomationServer {
    /**
     * @param {{
     *   backend: any,
     *   serverVersion?: string,
     *   logger?: { info?: (...args: any[]) => void, warn?: (...args: any[]) => void, error?: (...args: any[]) => void },
     *   maxBodyBytes?: number,
     *   cdpGuardOptions?: Record<string, any>,
     * }} options
     */
    constructor({
        backend,
        serverVersion = '1.5.0',
        logger = console,
        maxBodyBytes = MAX_AUTOMATION_BODY_BYTES,
        cdpGuardOptions = {},
    }) {
        if (!backend || typeof backend !== 'object') {
            throw new Error('AutomationServer requires a backend instance');
        }
        this.backend = backend;
        this.logger = logger;
        this.maxBodyBytes = maxBodyBytes;
        this.server = null;
        this.sockets = new Set();
        this.boundPort = 0;
        this.enabled = false;
        this.lastError = undefined;

        this.mcpHandler = createMcpHandler({
            backend,
            serverVersion,
        });

        this.cdpGuard = createCdpGuard({
            backend,
            getBoundPort: () => this.boundPort || DEFAULT_AUTOMATION_PORT,
            logger,
            ...cdpGuardOptions,
        });

        if (typeof backend.attachCdpGuard === 'function') {
            backend.attachCdpGuard(this.cdpGuard);
        }
        if (typeof backend.setBoundPortGetter === 'function') {
            backend.setBoundPortGetter(
                () => this.boundPort || DEFAULT_AUTOMATION_PORT,
            );
        }
    }

    isRunning() {
        return Boolean(this.server && this.server.listening);
    }

    getBoundPort() {
        return this.boundPort;
    }

    getLastError() {
        return this.lastError;
    }

    async syncConfig({
        enabled,
        localApiEnabled,
        mcpEnabled,
        port = DEFAULT_AUTOMATION_PORT,
    } = {}) {
        const shouldRun =
            typeof enabled === 'boolean'
                ? enabled
                : Boolean(localApiEnabled || mcpEnabled);

        if (!shouldRun) {
            await this.stop();
            this.enabled = false;
            this.lastError = undefined;
            return { running: false, port: 0 };
        }

        const validatedPort =
            port === 0 ? 0 : validateAutomationPort(port);

        if (this.isRunning() && this.boundPort === validatedPort) {
            this.enabled = true;
            this.lastError = undefined;
            return { running: true, port: this.boundPort };
        }

        await this.stop();
        return this.start({ port: validatedPort });
    }

    async start({ port = DEFAULT_AUTOMATION_PORT } = {}) {
        const targetPort = port === 0 ? 0 : validateAutomationPort(port);
        this.enabled = true;

        const server = http.createServer((req, res) => {
            void this.handleRequest(req, res);
        });

        server.on('connection', (socket) => {
            this.sockets.add(socket);
            socket.on('close', () => {
                this.sockets.delete(socket);
            });
        });

        server.on('upgrade', (req, socket, head) => {
            if (!this.enabled) {
                socket.destroy();
                return;
            }
            void this.cdpGuard.handleUpgrade(req, socket, head);
        });

        try {
            const actualPort = await new Promise((resolve, reject) => {
                const onListening = () => {
                    server.off('error', onError);
                    const addr = server.address();
                    const resolvedPort =
                        addr && typeof addr === 'object'
                            ? addr.port
                            : targetPort;
                    resolve(resolvedPort);
                };
                const onError = (err) => {
                    server.off('listening', onListening);
                    reject(err);
                };
                server.once('listening', onListening);
                server.once('error', onError);
                server.listen(targetPort, '127.0.0.1');
            });

            server.on('error', (err) => {
                this.lastError = sanitizeAutomationErrorMessage(err);
                this.logger?.error?.(
                    `[AutomationServer] Runtime error: ${this.lastError}`,
                );
            });

            this.server = server;
            this.boundPort = actualPort;
            this.lastError = undefined;
            this.logger?.info?.(
                `[AutomationServer] Listening on http://127.0.0.1:${actualPort} (CDP Guard + MCP)`,
            );
            return { running: true, port: actualPort };
        } catch (err) {
            const safeMsg = formatAutomationBindError(err, targetPort);
            this.lastError = safeMsg;
            try {
                server.close();
            } catch {
                // ignore
            }
            throw new Error(safeMsg);
        }
    }

    async stop() {
        this.cdpGuard.closeAll();

        const server = this.server;
        this.server = null;
        this.boundPort = 0;

        if (!server) {
            this.sockets.clear();
            return;
        }

        for (const socket of this.sockets) {
            try {
                socket.destroy();
            } catch {
                // ignore
            }
        }
        this.sockets.clear();

        await new Promise((resolve) => {
            try {
                server.close(() => resolve());
            } catch {
                resolve();
            }
        });
    }

    async handleRequest(req, res) {
        try {
            const securityCheck = verifyLoopbackRequestSecurity(
                req,
                this.boundPort,
            );
            if (!securityCheck.ok) {
                sendError(
                    res,
                    securityCheck.status,
                    securityCheck.code,
                    securityCheck.message,
                );
                return;
            }

            if (!this.enabled) {
                sendError(
                    res,
                    503,
                    'SERVICE_DISABLED',
                    'Local CDP & MCP service is disabled',
                );
                return;
            }

            let urlObj;
            try {
                urlObj = new URL(
                    req.url || '/',
                    `http://127.0.0.1:${this.boundPort || DEFAULT_AUTOMATION_PORT}`,
                );
            } catch {
                sendError(res, 400, 'INVALID_URL', 'Malformed request URL');
                return;
            }

            const pathname = urlObj.pathname;

            // 1. Standard Chrome DevTools Protocol discovery (/json/version, /json/list, /json, /cdp/<id>/json/...)
            if (parseCdpHttpRoute(pathname)) {
                await this.cdpGuard.handleHttpDiscovery(req, res, pathname);
                return;
            }

            // 2. Streamable HTTP MCP (/mcp)
            if (pathname === '/mcp' || pathname === '/mcp/') {
                await this.handleMcpRequest(req, res);
                return;
            }

            // 3. Minimal local HTTP helper endpoints (/api/v1/*)
            if (pathname.startsWith('/api/v1')) {
                await this.handleRestRequest(req, res, urlObj);
                return;
            }

            sendError(res, 404, 'NOT_FOUND', `Unknown endpoint: ${pathname}`);
        } catch (err) {
            const statusCode =
                err &&
                typeof err === 'object' &&
                typeof err.statusCode === 'number'
                    ? err.statusCode
                    : 500;
            const code =
                err && typeof err === 'object' && typeof err.code === 'string'
                    ? err.code
                    : 'INTERNAL_ERROR';
            sendError(res, statusCode, code, err);
        }
    }

    async handleMcpRequest(req, res) {
        const method = (req.method || 'GET').toUpperCase();

        if (method === 'GET') {
            sendError(
                res,
                405,
                'METHOD_NOT_ALLOWED',
                'Use POST /mcp for JSON-RPC Streamable HTTP requests',
                { Allow: 'POST, DELETE' },
            );
            return;
        }

        if (method === 'DELETE') {
            res.writeHead(204, BASE_SECURITY_HEADERS);
            res.end();
            return;
        }

        if (method !== 'POST') {
            sendError(
                res,
                405,
                'METHOD_NOT_ALLOWED',
                `Unsupported HTTP method: ${method}`,
                { Allow: 'POST, DELETE' },
            );
            return;
        }

        const rawBody = await readRequestBody(req, this.maxBodyBytes);
        if (!rawBody.trim()) {
            sendJson(res, 400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32600, message: 'Empty JSON-RPC request body' },
            });
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            sendJson(res, 400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
            });
            return;
        }

        const rpcResponse = await this.mcpHandler.handlePayload(parsed);
        if (rpcResponse === null) {
            res.writeHead(202, BASE_SECURITY_HEADERS);
            res.end();
            return;
        }

        sendJson(res, 200, rpcResponse);
    }

    async handleRestRequest(req, res, urlObj) {
        const method = (req.method || 'GET').toUpperCase();
        const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

        if (method === 'GET' && pathname === '/api/v1/status') {
            const data = await this.backend.getStatus();
            sendJson(res, 200, { ok: true, data });
            return;
        }

        if (method === 'GET' && pathname === '/api/v1/profiles') {
            const filters = validateProfileListFilters({
                group: urlObj.searchParams.get('group') ?? undefined,
                tag: urlObj.searchParams.get('tag') ?? undefined,
                status: urlObj.searchParams.get('status') ?? undefined,
                query: urlObj.searchParams.get('query') ?? undefined,
            });
            const data = await this.backend.listProfiles(filters);
            sendJson(res, 200, { ok: true, data });
            return;
        }

        if (
            method === 'POST' &&
            (pathname === '/api/v1/profiles/start' ||
                pathname === '/api/v1/profiles/stop')
        ) {
            const body = await parseOptionalJsonBody(req, this.maxBodyBytes);
            const profileId =
                body.profileId !== undefined &&
                body.profileId !== null &&
                String(body.profileId).trim()
                    ? validateUuid(body.profileId, 'profileId')
                    : undefined;
            const name =
                body.name !== undefined && body.name !== null
                    ? validateOptionalString(body.name, 'name', {
                          maxLength: 120,
                      })
                    : undefined;
            if (!profileId && !name) {
                throw new BadJsonError('Either profileId or name is required');
            }
            if (pathname.endsWith('/start')) {
                const data = await this.backend.startProfile({
                    profileId,
                    name,
                    setActive:
                        body.setActive === undefined
                            ? true
                            : Boolean(body.setActive),
                });
                sendJson(res, 200, { ok: true, data });
                return;
            }
            const data = await this.backend.stopProfile({ profileId, name });
            sendJson(res, 200, { ok: true, data });
            return;
        }

        const actionMatch = pathname.match(
            /^\/api\/v1\/profiles\/([^/]+)\/(start|stop)$/,
        );
        if (actionMatch && method === 'POST') {
            const profileId = validateUuid(
                decodeURIComponent(actionMatch[1]),
                'profileId',
            );
            const action = actionMatch[2];
            if (action === 'start') {
                const body = await parseOptionalJsonBody(req, this.maxBodyBytes);
                const data = await this.backend.startProfile({
                    profileId,
                    setActive:
                        body.setActive === undefined
                            ? true
                            : Boolean(body.setActive),
                });
                sendJson(res, 200, { ok: true, data });
                return;
            }
            const data = await this.backend.stopProfile({ profileId });
            sendJson(res, 200, { ok: true, data });
            return;
        }

        if (method === 'POST' && pathname === '/api/v1/active-profile') {
            const body = await parseOptionalJsonBody(req, this.maxBodyBytes);
            const profileId =
                body.profileId !== undefined &&
                body.profileId !== null &&
                String(body.profileId).trim()
                    ? validateUuid(body.profileId, 'profileId')
                    : undefined;
            const name =
                body.name !== undefined && body.name !== null
                    ? validateOptionalString(body.name, 'name', {
                          maxLength: 120,
                      })
                    : undefined;
            if (!profileId && !name) {
                throw new BadJsonError('Either profileId or name is required');
            }
            const data = await this.backend.switchActiveProfile({
                profileId,
                name,
            });
            sendJson(res, 200, { ok: true, data });
            return;
        }

        sendError(
            res,
            404,
            'NOT_FOUND',
            `Unknown API route: ${method} ${pathname}`,
        );
    }
}
