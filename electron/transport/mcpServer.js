import { LEGACY_MCP_VERSIONS, MCP_VERSIONS, MODERN_MCP_VERSION, requestVersion, unsupportedVersion } from '../domain/mcpProtocol.js';
import {
    createValidationError,
    sanitizeAutomationErrorMessage,
    validateProfileAction,
    validateProfileListFilters,
} from '../domain/automationPolicy.js';

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = LEGACY_MCP_VERSIONS;
export const DEFAULT_MCP_PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_MCP_SERVER_NAME = 'multichrome-mcp';
export const DEFAULT_MCP_SERVER_VERSION = '1.6.1';

export const MCP_RESOURCES = [
    {
        uri: 'multichrome://status',
        name: 'MultiChrome Status',
        description:
            'Current MultiChrome local CDP endpoint, active target profile, and running profile counts.',
        mimeType: 'application/json',
    },
    {
        uri: 'multichrome://profiles',
        name: 'MultiChrome Browser Profiles',
        description:
            'Sanitized list of MultiChrome browser profiles with redacted proxy state and guarded CDP endpoints.',
        mimeType: 'application/json',
    },
];

const PROFILE_SELECTOR_PROPERTIES = {
    profileId: {
        type: 'string',
        format: 'uuid',
        description: 'Target profile UUID (provide either profileId or name).',
    },
    name: {
        type: 'string',
        description:
            'Exact profile name in MultiChrome, e.g. "Profile-1" (provide either profileId or name).',
    },
};

export const MCP_TOOLS = [
    {
        name: 'list_profiles',
        description:
            'List MultiChrome anti-detect browser profiles, their proxy status, active target flag, and guarded CDP WebSocket endpoints.',
        annotations: {
            title: 'List Browser Profiles',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                view: { type: 'string', enum: ['summary', 'detail'], description: 'Use summary for discovery and detail for inspection.' },
                limit: { type: 'integer', minimum: 1, maximum: 200 },
                offset: { type: 'integer', minimum: 0 },
                group: {
                    type: 'string',
                    description: 'Optional group name filter.',
                },
                tag: {
                    type: 'string',
                    description: 'Optional tag filter.',
                },
                status: {
                    type: 'string',
                    enum: ['all', 'running', 'stopped'],
                    description: 'Filter by running state (defaults to all).',
                },
                query: {
                    type: 'string',
                    description:
                        'Optional case-insensitive substring matching profile name, notes, or id.',
                },
            },
        },
    },
    {
        name: 'start_profile',
        description:
            'Launch a MultiChrome profile with its Fail-Closed proxy, timezone and language coherence, and C++ fingerprint seed, then return its guarded CDP endpoint for @playwright/mcp, chrome-devtools-mcp, or Playwright connectOverCDP.',
        annotations: {
            title: 'Start Browser Profile',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            oneOf: [{ required: ['profileId'] }, { required: ['name'] }],
            properties: {
                ...PROFILE_SELECTOR_PROPERTIES,
                setActive: {
                    type: 'boolean',
                    description:
                        'Set this profile as the active default CDP target on http://127.0.0.1:<port> (defaults to true).',
                },
            },
        },
    },
    {
        name: 'stop_profile',
        description:
            'Close all pages in the selected profile, including unsaved work. A shared proxy may stay warm for other profiles.',
        annotations: {
            title: 'Stop Browser Profile',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            oneOf: [{ required: ['profileId'] }, { required: ['name'] }],
            properties: {
                ...PROFILE_SELECTOR_PROPERTIES,
            },
        },
    },
    {
        name: 'switch_active_profile',
        description:
            'Switch which running MultiChrome profile is exposed at the default CDP endpoint http://127.0.0.1:<port> (used by @playwright/mcp or chrome-devtools-mcp).',
        annotations: {
            title: 'Switch Active CDP Target Profile',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            oneOf: [{ required: ['profileId'] }, { required: ['name'] }],
            properties: {
                ...PROFILE_SELECTOR_PROPERTIES,
            },
        },
    },
];

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildJsonRpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function buildJsonRpcError(id, code, message) {
    return {
        jsonrpc: '2.0',
        id,
        error: {
            code,
            message: sanitizeAutomationErrorMessage(
                message,
                'MCP request failed',
            ),
        },
    };
}

function buildToolSuccess(structuredData) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(structuredData, null, 2),
            },
        ],
        structuredContent: structuredData,
        isError: false,
    };
}

function buildToolError(error) {
    const safeMessage = sanitizeAutomationErrorMessage(
        error,
        'Tool execution failed',
    );
    const errorCode =
        error && typeof error === 'object' && typeof error.code === 'string'
            ? error.code
            : 'TOOL_EXECUTION_ERROR';

    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(
                    {
                        ok: false,
                        error: { code: errorCode, message: safeMessage },
                    },
                    null,
                    2,
                ),
            },
        ],
        isError: true,
    };
}

export function createMcpHandler({
    backend,
    serverName = DEFAULT_MCP_SERVER_NAME,
    serverVersion = DEFAULT_MCP_SERVER_VERSION,
}) {
    if (!backend || typeof backend !== 'object') {
        throw new Error('createMcpHandler requires a backend implementation');
    }

    async function executeTool(name, rawArgs) {
        if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
            throw createValidationError(
                'Tool arguments must be a JSON object',
                'INVALID_ARGUMENTS',
                400,
            );
        }
        const args = rawArgs || {};

        switch (name) {
            case 'list_profiles': {
                const filters = validateProfileListFilters(args);
                return backend.listProfiles(filters);
            }
            case 'start_profile': {
                return backend.startProfile(validateProfileAction(args, true));
            }
            case 'stop_profile': {
                const selector = validateProfileAction(args);
                return backend.stopProfile(selector);
            }
            case 'switch_active_profile': {
                const selector = validateProfileAction(args);
                return backend.switchActiveProfile(selector);
            }
            default: {
                const unknownErr = new Error(`Unknown MCP tool: ${String(name)}`);
                unknownErr.isUnknownTool = true;
                throw unknownErr;
            }
        }
    }

    async function handleSingleMessage(msg) {
        const version = requestVersion(msg);
        if (version && !MCP_VERSIONS.includes(version)) return unsupportedVersion(msg?.id, version);
        const response = await dispatch(msg);
        if (version === MODERN_MCP_VERSION && response?.result) response.result.resultType = 'complete';
        return response;
    }

    async function dispatch(msg) {
        if (!isPlainObject(msg) || msg.jsonrpc !== '2.0') {
            return buildJsonRpcError(
                isPlainObject(msg) && 'id' in msg ? msg.id : null,
                -32600,
                'Invalid JSON-RPC 2.0 request',
            );
        }

        const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
        if (!hasId) {
            return null;
        }
        const id = msg.id;

        if (typeof msg.method !== 'string' || !msg.method.trim()) {
            return buildJsonRpcError(id, -32600, 'Missing JSON-RPC method');
        }

        const method = msg.method;
        const params = isPlainObject(msg.params) ? msg.params : {};

        try {
            switch (method) {
                case 'server/discover':
                    return buildJsonRpcResult(id, {
                        resultType: 'complete', supportedVersions: MCP_VERSIONS, capabilities: { tools: {}, resources: {} },
                        _meta: { 'io.modelcontextprotocol/serverInfo': { name: serverName, version: serverVersion } },
                    });
                case 'initialize': {
                    const requestedVersion =
                        typeof params.protocolVersion === 'string'
                            ? params.protocolVersion
                            : '';
                    const negotiatedVersion =
                        SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requestedVersion)
                            ? requestedVersion
                            : DEFAULT_MCP_PROTOCOL_VERSION;

                    return buildJsonRpcResult(id, {
                        protocolVersion: negotiatedVersion,
                        capabilities: {
                            tools: { listChanged: false },
                            resources: { subscribe: false, listChanged: false },
                        },
                        serverInfo: { name: serverName, version: serverVersion },
                        instructions:
                            'MultiChrome manages anti-detect profiles and Fail-Closed proxies. Use start_profile or switch_active_profile to select an environment, then use standard @playwright/mcp, chrome-devtools-mcp, or Playwright connectOverCDP against the profile-specific profileCdpEndpoint or wsEndpoint for all page automation.',
                    });
                }

                case 'ping':
                    return buildJsonRpcResult(id, {});

                case 'tools/list':
                    return buildJsonRpcResult(id, { tools: MCP_TOOLS });

                case 'tools/call': {
                    const toolName =
                        typeof params.name === 'string' ? params.name.trim() : '';
                    if (!toolName) {
                        return buildJsonRpcError(
                            id,
                            -32602,
                            'Missing required parameter: name',
                        );
                    }
                    try {
                        const data = await executeTool(toolName, params.arguments);
                        return buildJsonRpcResult(id, buildToolSuccess(data));
                    } catch (toolErr) {
                        if (toolErr && toolErr.isUnknownTool) {
                            return buildJsonRpcError(id, -32602, toolErr.message);
                        }
                        return buildJsonRpcResult(id, buildToolError(toolErr));
                    }
                }

                case 'resources/list':
                    return buildJsonRpcResult(id, { resources: MCP_RESOURCES });

                case 'resources/templates/list':
                    return buildJsonRpcResult(id, { resourceTemplates: [] });

                case 'resources/read': {
                    const uri =
                        typeof params.uri === 'string' ? params.uri.trim() : '';
                    if (uri === 'multichrome://status') {
                        const statusData = await backend.getStatus();
                        return buildJsonRpcResult(id, {
                            contents: [
                                {
                                    uri,
                                    mimeType: 'application/json',
                                    text: JSON.stringify(statusData, null, 2),
                                },
                            ],
                        });
                    }
                    if (uri === 'multichrome://profiles') {
                        const profilesData = await backend.listProfiles({});
                        return buildJsonRpcResult(id, {
                            contents: [
                                {
                                    uri,
                                    mimeType: 'application/json',
                                    text: JSON.stringify(profilesData, null, 2),
                                },
                            ],
                        });
                    }
                    return buildJsonRpcError(
                        id,
                        -32602,
                        `Unknown resource URI: ${uri || '(empty)'}`,
                    );
                }

                case 'prompts/list':
                    return buildJsonRpcResult(id, { prompts: [] });

                default:
                    return buildJsonRpcError(
                        id,
                        -32601,
                        `Method not found: ${method}`,
                    );
            }
        } catch (err) {
            return buildJsonRpcError(id, -32603, err);
        }
    }

    async function handlePayload(payload) {
        if (Array.isArray(payload)) {
            if (payload.length === 0) {
                return buildJsonRpcError(
                    null,
                    -32600,
                    'Empty JSON-RPC batch is invalid',
                );
            }
            const responses = [];
            for (const item of payload) {
                const res = await handleSingleMessage(item);
                if (res !== null) {
                    responses.push(res);
                }
            }
            return responses.length > 0 ? responses : null;
        }
        return handleSingleMessage(payload);
    }

    return { handlePayload };
}
