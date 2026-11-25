export const MODERN_MCP_VERSION = '2026-07-28';
export const LEGACY_MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const MCP_VERSIONS = [MODERN_MCP_VERSION, ...LEGACY_MCP_VERSIONS];

export function requestVersion(message) {
    return message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
}

export function unsupportedVersion(id, requested) {
    return { jsonrpc: '2.0', id: id ?? null, error: {
        code: -32022, message: 'Unsupported protocol version', data: { supported: MCP_VERSIONS, requested },
    } };
}

function nameHeader(value) {
    return /^[\x20-\x7e]+$/.test(value) && value.trim() === value && !/^=\?base64\?.*\?=$/.test(value)
        ? value : '=?base64?' + Buffer.from(value).toString('base64') + '?=';
}

export function requestHeaders(message, negotiatedVersion) {
    const version = requestVersion(message) ?? negotiatedVersion;
    if (!version) return {};
    const headers = { 'MCP-Protocol-Version': version };
    if (version === MODERN_MCP_VERSION && message?.method) {
        headers['Mcp-Method'] = message.method;
        if (['tools/call', 'prompts/get', 'resources/read'].includes(message.method)) {
            const value = message.params?.name ?? message.params?.uri;
            if (typeof value === 'string') headers['Mcp-Name'] = nameHeader(value);
        }
    }
    return headers;
}

export function validateTransport(message, headers) {
    const version = headers['mcp-protocol-version'];
    const bodyVersion = requestVersion(message);
    const id = message?.id ?? null;
    if (bodyVersion !== undefined && version !== bodyVersion) {
        return { jsonrpc: '2.0', id, error: { code: -32020, message: 'Protocol version header mismatch' } };
    }
    if (version && !MCP_VERSIONS.includes(version)) return unsupportedVersion(id, version);
    if (version === MODERN_MCP_VERSION) {
        const expected = requestHeaders(message, version);
        if (bodyVersion !== version || Object.entries(expected).some(([key, value]) => headers[key.toLowerCase()] !== value)) {
            return { jsonrpc: '2.0', id, error: { code: -32020, message: 'Request metadata header mismatch' } };
        }
    }
    if (Array.isArray(message) && version && version >= '2025-06-18') {
        return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Expected one JSON-RPC message' } };
    }
    return null;
}
