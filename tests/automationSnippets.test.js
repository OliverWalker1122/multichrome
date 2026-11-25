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

test('DevTools MCP outputs client-agnostic mcpServers JSON combining HTTP profile management and chrome-devtools-mcp', () => {
    const raw = buildAutomationSnippet({
        port: 18924,
        tokenSegment: '••••••••••••',
        tab: 'devtoolsMcp',
    });

    assert.equal(raw.includes('claude mcp add'), false);
    assert.deepEqual(JSON.parse(raw), {
        mcpServers: {
            multichrome: {
                url: 'http://127.0.0.1:18924/t/••••••••••••/mcp',
            },
            'chrome-devtools': {
                command: 'npx',
                args: [
                    '-y',
                    CHROME_DEVTOOLS_MCP_PACKAGE,
                    '--wsEndpoint=ws://127.0.0.1:18924/t/••••••••••••/devtools/browser',
                ],
            },
        },
    });

    const unauthed = JSON.parse(
        buildAutomationSnippet({
            port: 18922,
            tokenSegment: '',
            tab: 'devtoolsMcp',
        }),
    );
    assert.deepEqual(unauthed, {
        mcpServers: {
            multichrome: {
                url: 'http://127.0.0.1:18922/mcp',
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

test('Playwright MCP outputs client-agnostic mcpServers JSON combining HTTP profile management and @playwright/mcp', () => {
    const raw = buildAutomationSnippet({
        port: 18924,
        tokenSegment: '<ACCESS_TOKEN>',
        tab: 'playwrightMcp',
    });

    assert.equal(raw.includes('claude mcp add'), false);
    assert.deepEqual(JSON.parse(raw), {
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

    const unauthed = JSON.parse(
        buildAutomationSnippet({
            port: 18922,
            tokenSegment: '',
            tab: 'playwrightMcp',
        }),
    );
    assert.deepEqual(unauthed, {
        mcpServers: {
            multichrome: {
                url: 'http://127.0.0.1:18922/mcp',
            },
            playwright: {
                command: 'npx',
                args: [
                    '-y',
                    PLAYWRIGHT_MCP_PACKAGE,
                    '--cdp-endpoint',
                    'http://127.0.0.1:18922',
                ],
            },
        },
    });
});

test('CDP script generates Playwright connectOverCDP code with and without auth token', () => {
    const authed = buildAutomationSnippet({
        port: 18924,
        tokenSegment: 'synthetic-token',
        tab: 'cdpCode',
    });
    assert.match(authed, /import \{ chromium \} from 'playwright';/);
    assert.match(authed, /const token = 'synthetic-token';/);
    assert.match(authed, /Authorization: `Bearer \$\{token\}`/);
    assert.match(authed, /chromium\.connectOverCDP\(data\.wsEndpoint/);

    const unauthed = buildAutomationSnippet({
        port: 18922,
        tokenSegment: '',
        tab: 'cdpCode',
    });
    assert.equal(unauthed.includes('Authorization'), false);
    assert.match(
        unauthed,
        /chromium\.connectOverCDP\(data\.wsEndpoint\);/,
    );
});
