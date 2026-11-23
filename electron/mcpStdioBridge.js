import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_AUTOMATION_PORT,
    sanitizeAutomationErrorMessage,
} from './automationConfig.js';

export const DEFAULT_MCP_BASE_URL = `http://127.0.0.1:${DEFAULT_AUTOMATION_PORT}`;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export function resolveMcpEndpointUrl(rawApiUrl) {
    const base =
        typeof rawApiUrl === 'string' && rawApiUrl.trim()
            ? rawApiUrl.trim()
            : DEFAULT_MCP_BASE_URL;

    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        throw new Error('Invalid MULTICHROME_API_URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('MULTICHROME_API_URL must use http or https');
    }

    const host = parsed.hostname.toLowerCase();
    if (
        host !== '127.0.0.1' &&
        host !== 'localhost' &&
        host !== '::1' &&
        host !== '[::1]'
    ) {
        throw new Error('MULTICHROME_API_URL must target a loopback host');
    }

    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = cleanPath.endsWith('/mcp')
        ? cleanPath
        : `${cleanPath}/mcp`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
}

function parseSsePayloads(rawText) {
    const messages = [];
    const events = rawText.split(/\r?\n\r?\n/);
    for (const event of events) {
        const dataLines = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const payloadText = dataLines.join('\n').trim();
        if (!payloadText || payloadText === '[DONE]') continue;
        try {
            messages.push(JSON.parse(payloadText));
        } catch {
            // ignore non-JSON SSE keepalive comments/data
        }
    }
    return messages;
}

export async function forwardJsonRpcOverHttp(
    messageOrLine,
    {
        apiUrl = process.env.MULTICHROME_API_URL || DEFAULT_MCP_BASE_URL,
        token = process.env.MULTICHROME_API_TOKEN || '',
        fetchImpl = globalThis.fetch,
        timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    } = {},
) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('HTTP fetch implementation is unavailable');
    }

    let requestObj;
    let bodyText;
    if (typeof messageOrLine === 'string') {
        bodyText = messageOrLine.trim();
        try {
            requestObj = JSON.parse(bodyText);
        } catch {
            return {
                status: 400,
                accepted: false,
                responses: [
                    {
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32700, message: 'Parse error' },
                    },
                ],
                response: {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' },
                },
            };
        }
    } else if (messageOrLine && typeof messageOrLine === 'object') {
        requestObj = messageOrLine;
        bodyText = JSON.stringify(messageOrLine);
    } else {
        return {
            status: 400,
            accepted: false,
            responses: [
                {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32600, message: 'Invalid Request' },
                },
            ],
            response: {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32600, message: 'Invalid Request' },
            },
        };
    }

    const hasId =
        requestObj &&
        typeof requestObj === 'object' &&
        !Array.isArray(requestObj) &&
        Object.prototype.hasOwnProperty.call(requestObj, 'id') &&
        requestObj.id !== undefined;
    const requestId = hasId ? requestObj.id : undefined;

    let endpointUrl;
    try {
        endpointUrl = resolveMcpEndpointUrl(apiUrl);
    } catch (err) {
        const msg = sanitizeAutomationErrorMessage(err, 'Invalid MCP URL');
        if (!hasId) {
            return { status: 0, accepted: true, responses: [], response: null, error: msg };
        }
        const rpcErr = {
            jsonrpc: '2.0',
            id: requestId,
            error: { code: -32000, message: msg },
        };
        return { status: 0, accepted: false, responses: [rpcErr], response: rpcErr, error: msg };
    }

    const controller = new AbortController();
    const timer =
        timeoutMs > 0
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;

    try {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        const response = await fetchImpl(endpointUrl, {
            method: 'POST',
            headers,
            body: bodyText,
            signal: controller.signal,
        });

        if (response.status === 202) {
            return {
                status: 202,
                accepted: true,
                responses: [],
                response: null,
            };
        }

        const contentType = (
            response.headers?.get?.('content-type') || ''
        ).toLowerCase();
        const rawText = await response.text();

        if (contentType.includes('text/event-stream')) {
            const parsedList = parseSsePayloads(rawText);
            return {
                status: response.status,
                accepted: parsedList.length === 0,
                responses: parsedList,
                response: parsedList[0] ?? null,
            };
        }

        let parsedBody = null;
        if (rawText && rawText.trim()) {
            try {
                parsedBody = JSON.parse(rawText);
            } catch {
                parsedBody = null;
            }
        }

        if (
            parsedBody &&
            typeof parsedBody === 'object' &&
            !Array.isArray(parsedBody) &&
            parsedBody.jsonrpc === '2.0'
        ) {
            return {
                status: response.status,
                accepted: false,
                responses: [parsedBody],
                response: parsedBody,
            };
        }

        const httpErrorMsg = parsedBody?.error?.message
            ? `HTTP ${response.status}: ${parsedBody.error.message}`
            : `HTTP ${response.status} from MultiChrome MCP endpoint`;

        if (!hasId) {
            return {
                status: response.status,
                accepted: true,
                responses: [],
                response: null,
                error: httpErrorMsg,
            };
        }

        const synthesized = {
            jsonrpc: '2.0',
            id: requestId,
            error: {
                code: -32000,
                message: sanitizeAutomationErrorMessage(
                    httpErrorMsg,
                    'MCP HTTP request failed',
                ),
                ...(parsedBody?.error?.code
                    ? { data: { status: response.status, code: parsedBody.error.code } }
                    : { data: { status: response.status } }),
            },
        };
        return {
            status: response.status,
            accepted: false,
            responses: [synthesized],
            response: synthesized,
            error: httpErrorMsg,
        };
    } catch (err) {
        const msg = sanitizeAutomationErrorMessage(
            err,
            'Failed to connect to MultiChrome MCP server',
        );
        if (!hasId) {
            return {
                status: 0,
                accepted: true,
                responses: [],
                response: null,
                error: msg,
            };
        }
        const rpcErr = {
            jsonrpc: '2.0',
            id: requestId,
            error: { code: -32000, message: msg },
        };
        return {
            status: 0,
            accepted: false,
            responses: [rpcErr],
            response: rpcErr,
            error: msg,
        };
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export async function runStdioBridge({
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr,
    apiUrl = process.env.MULTICHROME_API_URL || DEFAULT_MCP_BASE_URL,
    token = process.env.MULTICHROME_API_TOKEN || '',
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
    const rl = readline.createInterface({
        input,
        crlfDelay: Infinity,
    });

    let queue = Promise.resolve();

    const processLine = async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const outcome = await forwardJsonRpcOverHttp(trimmed, {
            apiUrl,
            token,
            fetchImpl,
            timeoutMs,
        });

        if (outcome.error && errorOutput && typeof errorOutput.write === 'function') {
            errorOutput.write(`[multichrome-mcp] ${outcome.error}\n`);
        }

        if (!outcome.accepted && Array.isArray(outcome.responses)) {
            for (const msg of outcome.responses) {
                output.write(`${JSON.stringify(msg)}\n`);
            }
        }
    };

    return new Promise((resolve, reject) => {
        rl.on('line', (line) => {
            queue = queue.then(() => processLine(line)).catch((err) => {
                if (errorOutput && typeof errorOutput.write === 'function') {
                    errorOutput.write(
                        `[multichrome-mcp] ${sanitizeAutomationErrorMessage(err)}\n`,
                    );
                }
            });
        });

        rl.on('close', () => {
            queue.then(() => resolve()).catch(reject);
        });

        rl.on('error', (err) => {
            reject(err);
        });
    });
}

const isDirectEntry =
    typeof process !== 'undefined' &&
    Array.isArray(process.argv) &&
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isDirectEntry) {
    runStdioBridge().catch((err) => {
        process.stderr.write(
            `[multichrome-mcp] Fatal stdio bridge error: ${sanitizeAutomationErrorMessage(err)}\n`,
        );
        process.exitCode = 1;
    });
}
