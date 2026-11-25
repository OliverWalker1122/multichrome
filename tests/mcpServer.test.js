import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { AutomationServer } from '../electron/transport/automationServer.js';
import { createAutomationBackend } from '../electron/services/automationService.js';
import {
    createMcpHandler,
    DEFAULT_MCP_PROTOCOL_VERSION,
    MCP_TOOLS,
} from '../electron/transport/mcpServer.js';
import {
    forwardJsonRpcOverHttp,
    resolveMcpEndpointUrl,
    runStdioBridge,
} from '../electron/transport/mcpStdioBridge.js';

const PROFILE_1 = '11111111-1111-4111-8111-111111111111';
const PROFILE_2 = '22222222-2222-4222-8222-222222222222';

function createBackendFixture() {
    const profiles = new Map([
        [
            PROFILE_1,
            {
                id: PROFILE_1,
                name: 'work-us',
                groupName: 'work',
                notes: 'Primary work profile',
                tags: ['team', 'jp'],
                proxy: 'http://user:pass@198.51.100.22:8080',
                browserEngine: 'fingerprint-chromium',
                isRunning: false,
            },
        ],
        [
            PROFILE_2,
            {
                id: PROFILE_2,
                name: 'backup-eu',
                groupName: 'backup',
                notes: 'Secondary account',
                tags: ['ops'],
                browserEngine: 'fingerprint-chromium',
                isRunning: false,
            },
        ],
    ]);

    const runningProcesses = new Map();
    const chromeManager = {
        runningProcesses,
        getAllEnvironments: async () =>
            Array.from(profiles.values()).map((p) => structuredClone(p)),
        getRunningEnvironmentSummary: () => {
            const running = Array.from(profiles.values()).filter(
                (p) => p.isRunning,
            );
            return {
                count: running.length,
                ids: running.map((p) => p.id),
                names: running.map((p) => p.name),
            };
        },
        launchEnvironment: async (id) => {
            const p = profiles.get(id);
            if (!p) return false;
            p.isRunning = true;
            runningProcesses.set(id, { debugPort: 55100 });
            return true;
        },
        closeEnvironment: async (id) => {
            const p = profiles.get(id);
            if (!p) return false;
            p.isRunning = false;
            runningProcesses.delete(id);
            return true;
        },
        getAutomationConnectionInfo: async (id) => {
            if (!runningProcesses.has(id)) return null;
            return {
                debugPort: 55100,
                wsEndpoint: 'ws://127.0.0.1:55100/devtools/browser/internal',
            };
        },
    };

    return createAutomationBackend({
        chromeManager,
        appVersion: '1.3.0',
    });
}

test('MCP handler exposes strictly the 4 profile orchestration tools and supports profileId or name', async () => {
    assert.deepEqual(
        MCP_TOOLS.map((t) => t.name),
        [
            'list_profiles',
            'start_profile',
            'stop_profile',
            'switch_active_profile',
        ],
    );

    const backend = createBackendFixture();
    backend.setBoundPortGetter(() => 18922);
    const handler = createMcpHandler({ backend });

    const initRes = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: DEFAULT_MCP_PROTOCOL_VERSION },
    });
    assert.equal(initRes.result.protocolVersion, DEFAULT_MCP_PROTOCOL_VERSION);
    assert.equal(initRes.result.serverInfo.name, 'multichrome-mcp');

    const toolsRes = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
    });
    assert.equal(toolsRes.result.tools.length, 4);

    // Start profile by name ("work-us") without needing UUID lookup first
    const startPrimary = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
            name: 'start_profile',
            arguments: { name: 'WORK-US' }, // case-insensitive match
        },
    });
    assert.equal(startPrimary.result.isError, false);
    const startedData = startPrimary.result.structuredContent;
    assert.equal(startedData.profileId, PROFILE_1);
    assert.equal(startedData.isActiveTarget, true);
    assert.equal(startedData.cdpEndpoint, 'http://127.0.0.1:18922');
    assert.equal(
        startedData.wsEndpoint,
        `ws://127.0.0.1:18922/devtools/browser/${PROFILE_1}`,
    );
    // Proxy credentials redacted and internal port 55100 never exposed
    assert.equal(
        startedData.profile.proxy,
        'http://[redacted]@198.51.100.22:8080',
    );
    assert.equal(JSON.stringify(startedData).includes('55100'), false);

    // Start second profile with setActive: false (keeps work-us as active default target)
    const startSecondary = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
            name: 'start_profile',
            arguments: { profileId: PROFILE_2, setActive: false },
        },
    });
    assert.equal(startSecondary.result.structuredContent.isActiveTarget, false);

    const listRunning = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
            name: 'list_profiles',
            arguments: { status: 'running' },
        },
    });
    assert.equal(listRunning.result.structuredContent.count, 2);
    assert.equal(listRunning.result.structuredContent.activeProfileId, PROFILE_1);

    // Switch active profile to backup-eu by name
    const switched = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
            name: 'switch_active_profile',
            arguments: { name: 'backup-eu' },
        },
    });
    assert.equal(switched.result.structuredContent.activeProfileId, PROFILE_2);

    // Stop profile
    const stopped = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
            name: 'stop_profile',
            arguments: { name: 'backup-eu' },
        },
    });
    assert.equal(stopped.result.structuredContent.stopped, true);

    // Resources read
    const statusResource = await handler.handlePayload({
        jsonrpc: '2.0',
        id: 8,
        method: 'resources/read',
        params: { uri: 'multichrome://status' },
    });
    assert.equal(statusResource.result.contents.length, 1);
});

test('Streamable HTTP /mcp + tokenless stdio bridge round-trip cleanly on 127.0.0.1', async (t) => {
    const backend = createBackendFixture();
    const server = new AutomationServer({ backend });
    const { port } = await server.start({ port: 0 });
    t.after(async () => {
        await server.stop();
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    assert.equal(resolveMcpEndpointUrl(baseUrl), `${baseUrl}/mcp`);

    // Forward without needing any token
    const directForward = await forwardJsonRpcOverHttp(
        { jsonrpc: '2.0', id: 10, method: 'tools/list' },
        { apiUrl: baseUrl },
    );
    assert.equal(directForward.status, 200);
    assert.equal(directForward.response.result.tools.length, 4);

    // Full stdio bridge stream test
    const input = new PassThrough();
    const output = new PassThrough();
    let stdoutText = '';
    output.on('data', (chunk) => {
        stdoutText += chunk.toString('utf8');
    });

    const bridgeDone = runStdioBridge({
        input,
        output,
        apiUrl: baseUrl,
    });
    input.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    input.write(
        `${JSON.stringify({
            jsonrpc: '2.0',
            id: 21,
            method: 'tools/call',
            params: { name: 'list_profiles', arguments: { group: 'work' } },
        })}\n`,
    );
    input.end();
    await bridgeDone;

    const lines = stdoutText.trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.id, 21);
    assert.equal(parsed.result.structuredContent.count, 1);
    assert.equal(parsed.result.structuredContent.profiles[0].name, 'work-us');

    // Verify browser Origin header is still rejected on /mcp (403)
    const originCheck = await new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                method: 'POST',
                path: '/mcp',
                headers: {
                    Host: `127.0.0.1:${port}`,
                    Origin: 'https://evil.example',
                    'Content-Type': 'application/json',
                },
            },
            (res) => resolve(res.statusCode),
        );
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    });
    assert.equal(originCheck, 403);
});

test('mcpStdioBridge handles URL validation, malformed JSON, 202 accepted, SSE payloads, and HTTP error synthesis', async () => {
    assert.throws(() => resolveMcpEndpointUrl('not-a-url'), /Invalid MULTICHROME_API_URL/);
    assert.throws(() => resolveMcpEndpointUrl('ftp://127.0.0.1:18922'), /http or https/);
    assert.throws(() => resolveMcpEndpointUrl('http://example.com:18922'), /loopback/);
    assert.equal(
        resolveMcpEndpointUrl('http://127.0.0.1:18922/t/mc_live_abc123/'),
        'http://127.0.0.1:18922/t/mc_live_abc123/mcp',
    );

    const parseErr = await forwardJsonRpcOverHttp('{bad-json', {
        apiUrl: 'http://127.0.0.1:18922',
    });
    assert.equal(parseErr.status, 400);
    assert.equal(parseErr.response.error.code, -32700);

    const invalidReq = await forwardJsonRpcOverHttp(null, {
        apiUrl: 'http://127.0.0.1:18922',
    });
    assert.equal(invalidReq.status, 400);
    assert.equal(invalidReq.response.error.code, -32600);

    const badUrlErr = await forwardJsonRpcOverHttp(
        { jsonrpc: '2.0', id: 7, method: 'ping' },
        { apiUrl: 'http://remote.invalid:18922' },
    );
    assert.equal(badUrlErr.status, 0);
    assert.equal(badUrlErr.response.id, 7);

    const accepted202 = await forwardJsonRpcOverHttp(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        {
            apiUrl: 'http://127.0.0.1:18922',
            fetchImpl: async () => ({ status: 202, headers: new Headers(), text: async () => '' }),
        },
    );
    assert.equal(accepted202.status, 202);
    assert.equal(accepted202.accepted, true);

    const sseRes = await forwardJsonRpcOverHttp(
        { jsonrpc: '2.0', id: 8, method: 'tools/list' },
        {
            apiUrl: 'http://127.0.0.1:18922',
            token: 'mc_live_test_token_12345678901234567890',
            fetchImpl: async (_url, init) => {
                assert.equal(
                    init.headers.Authorization,
                    'Bearer mc_live_test_token_12345678901234567890',
                );
                return {
                    status: 200,
                    headers: new Headers({ 'content-type': 'text/event-stream' }),
                    text: async () =>
                        'event: message\ndata: {"jsonrpc":"2.0","id":8,"result":{"ok":true}}\n\n',
                };
            },
        },
    );
    assert.equal(sseRes.status, 200);
    assert.equal(sseRes.response.result.ok, true);

    const unauthErr = await forwardJsonRpcOverHttp(
        { jsonrpc: '2.0', id: 9, method: 'tools/list' },
        {
            apiUrl: 'http://127.0.0.1:18922',
            fetchImpl: async () => ({
                status: 401,
                headers: new Headers({ 'content-type': 'application/json' }),
                text: async () =>
                    JSON.stringify({
                        ok: false,
                        error: { code: 'UNAUTHORIZED', message: 'Missing token' },
                    }),
            }),
        },
    );
    assert.equal(unauthErr.status, 401);
    assert.equal(unauthErr.response.error.data.status, 401);
});
