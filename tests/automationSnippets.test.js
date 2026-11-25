import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(
    new URL('../src/utils/automationSnippets.ts', import.meta.url),
    'utf8',
);
const exports = {};
vm.runInNewContext(
    ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
        },
    }).outputText,
    { exports },
);
const {
    buildAutomationSnippet,
    CHROME_DEVTOOLS_MCP_PACKAGE,
    PLAYWRIGHT_MCP_PACKAGE,
} = exports;

test('MCP (HTTP) defaults to client-agnostic mcpServers JSON for multichrome only', () => {
    const raw = buildAutomationSnippet({
        port: 18924,
        tokenSegment: '••••••••••••',
        bridgePath: 'scripts/mcp-stdio.mjs',
        tab: 'mcpHttp',
        pageAddon: 'none',
    });

    assert.equal(raw.includes('claude mcp add'), false);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, {
        mcpServers: {
            multichrome: {
                url: 'http://127.0.0.1:18924/t/••••••••••••/mcp',
            },
        },
    });
});

test('MCP (HTTP) merges DevTools MCP and Playwright MCP into standard mcpServers JSON', () => {
    const devtoolsJson = JSON.parse(
        buildAutomationSnippet({
            port: 18924,
            tokenSegment: '<ACCESS_TOKEN>',
            bridgePath: 'scripts/mcp-stdio.mjs',
            tab: 'mcpHttp',
            pageAddon: 'devtools',
        }),
    );
    assert.deepEqual(devtoolsJson, {
        mcpServers: {
            multichrome: {
                url: 'http://127.0.0.1:18924/t/<ACCESS_TOKEN>/mcp',
            },
            'chrome-devtools': {
                command: 'npx',
                args: [
                    '-y',
                    CHROME_DEVTOOLS_MCP_PACKAGE,
                    '--wsEndpoint=ws://127.0.0.1:18924/t/<ACCESS_TOKEN>/devtools/browser',
                ],
            },
        },
    });

    const playwrightJson = JSON.parse(
        buildAutomationSnippet({
            port: 18924,
            tokenSegment: '<ACCESS_TOKEN>',
            bridgePath: 'scripts/mcp-stdio.mjs',
            tab: 'mcpHttp',
            pageAddon: 'playwright',
        }),
    );
    assert.deepEqual(playwrightJson, {
        mcpServers: {
            multichrome: {
                url: 'http://127.0.0.1:18924/t/<ACCESS_TOKEN>/mcp',
            },
            playwright: {
                command: 'npx',
                args: [
                    '-y',
                    PLAYWRIGHT_MCP_PACKAGE,
                    '--cdp-endpoint',
                    'ws://127.0.0.1:18924/t/<ACCESS_TOKEN>/devtools/browser',
                ],
            },
        },
    });
});

test('MCP (stdio) combines Node bridge config with optional page-control MCP and omits token when auth is disabled', () => {
    const withToken = JSON.parse(
        buildAutomationSnippet({
            port: 18924,
            tokenSegment: 'synthetic-token',
            bridgePath: '/app/scripts/mcp-stdio.mjs',
            tab: 'mcpStdio',
            pageAddon: 'playwright',
        }),
    );
    assert.deepEqual(withToken, {
        mcpServers: {
            multichrome: {
                command: 'node',
                args: ['/app/scripts/mcp-stdio.mjs'],
                env: {
                    MULTICHROME_API_URL: 'http://127.0.0.1:18924',
                    MULTICHROME_API_TOKEN: 'synthetic-token',
                },
            },
            playwright: {
                command: 'npx',
                args: [
                    '-y',
                    PLAYWRIGHT_MCP_PACKAGE,
                    '--cdp-endpoint',
                    'ws://127.0.0.1:18924/t/synthetic-token/devtools/browser',
                ],
            },
        },
    });

    const withoutToken = JSON.parse(
        buildAutomationSnippet({
            port: 18922,
            tokenSegment: '',
            bridgePath: 'scripts/mcp-stdio.mjs',
            tab: 'mcpStdio',
            pageAddon: 'devtools',
        }),
    );
    assert.deepEqual(withoutToken, {
        mcpServers: {
            multichrome: {
                command: 'node',
                args: ['scripts/mcp-stdio.mjs'],
                env: {
                    MULTICHROME_API_URL: 'http://127.0.0.1:18922',
                },
            },
            'chrome-devtools': {
                command: 'npx',
                args: [
                    '-y',
                    CHROME_DEVTOOLS_MCP_PACKAGE,
                    '--browserUrl=http://127.0.0.1:18922',
                ],
            },
        },
    });
});

test('CDP script generates Playwright connectOverCDP code with and without auth token', () => {
    const authed = buildAutomationSnippet({
        port: 18924,
        tokenSegment: 'synthetic-token',
        bridgePath: 'scripts/mcp-stdio.mjs',
        tab: 'cdpCode',
        pageAddon: 'devtools',
    });
    assert.match(authed, /import \{ chromium \} from 'playwright';/);
    assert.match(authed, /const token = 'synthetic-token';/);
    assert.match(authed, /Authorization: `Bearer \$\{token\}`/);
    assert.match(authed, /chromium\.connectOverCDP\(data\.wsEndpoint/);

    const unauthed = buildAutomationSnippet({
        port: 18922,
        tokenSegment: '',
        bridgePath: 'scripts/mcp-stdio.mjs',
        tab: 'cdpCode',
    });
    assert.equal(unauthed.includes('Authorization'), false);
    assert.match(
        unauthed,
        /chromium\.connectOverCDP\(data\.wsEndpoint\);/,
    );
});
