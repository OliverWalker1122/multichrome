import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createMcpHandler } from '../electron/transport/mcpServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function verify(label, transport, check) {
    const client = new Client({ name: 'multichrome-offline-verification', version: '1' });
    try {
        await client.connect(transport);
        await check(client);
    } catch {
        // Transport errors may include the temporary fixture's authenticated URL.
        throw new Error(label + ' client verification failed');
    } finally {
        await client.close().catch(() => {});
    }
}

export async function verifyMcpClients({ port, token, profileId, bridgePath, projectRoot, tempRoot }) {
    const origin = 'http://127.0.0.1:' + port;
    const ws = 'ws://127.0.0.1:' + port + '/t/' + encodeURIComponent(token) + '/devtools/browser/' + profileId;
    const stdio = (args, env = {}) => new StdioClientTransport({
        command: process.execPath, cwd: tempRoot, args, env, stderr: 'ignore',
    });
    const checkTools = async client => {
        const list = await client.listTools();
        if (list.tools.length !== 4) throw new Error('Unexpected tools');
        const response = await client.callTool({ name: 'list_profiles', arguments: { view: 'summary', limit: 1 } });
        if (response.isError || response.structuredContent?.profiles?.length !== 1) throw new Error('Missing profile');
    };
    await verify('HTTP', new StreamableHTTPClientTransport(new URL('/mcp', origin), {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
    }), checkTools);
    await verify('stdio', stdio([bridgePath], { MULTICHROME_API_URL: origin, MULTICHROME_API_TOKEN: token }), checkTools);
    const binaries = path.join(projectRoot, 'node_modules');
    const clients = [
        ['Playwright MCP', stdio([path.join(binaries, '@playwright/mcp/cli.js'), '--cdp-endpoint', ws]), 'browser_tabs', { action: 'list' }],
        ['Chrome DevTools MCP', stdio([path.join(binaries, 'chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js'),
            '--wsEndpoint=' + ws, '--no-usage-statistics', '--no-performance-crux']), 'list_pages', {}],
    ];
    for (const [label, transport, name, args] of clients) {
        await verify(label, transport, async client => {
            const listed = await client.listTools();
            if (!listed.tools.some(tool => tool.name === name)) throw new Error('Missing page listing tool');
            const result = await client.callTool({ name, arguments: args });
            if (result.isError || !result.content?.length) throw new Error('Could not list local tabs');
        });
    }
}

/** Exercise the exact unpacked entry point an external Node process uses. */
export async function verifyPackagedBridge(resources) {
    const handler = createMcpHandler({ backend: {} });
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const payload = await handler.handlePayload(JSON.parse(Buffer.concat(chunks).toString()));
        response.writeHead(payload ? 200 : 202, { 'Content-Type': 'application/json' });
        response.end(payload ? JSON.stringify(payload) : undefined);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const entry = path.join(resources, 'app.asar.unpacked', 'dist/electron/transport/mcpStdioBridge.js');
        await verify('Packaged stdio', new StdioClientTransport({
            command: process.execPath, args: [entry], stderr: 'ignore',
            env: { MULTICHROME_API_URL: 'http://127.0.0.1:' + server.address().port, MULTICHROME_API_TOKEN: '' },
        }), async client => {
            if ((await client.listTools()).tools.length !== 4) throw new Error('Packaged tool discovery failed');
        });
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}
