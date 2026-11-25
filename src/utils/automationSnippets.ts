export type SnippetTab = 'cdpCode' | 'devtoolsMcp' | 'playwrightMcp';

export const CHROME_DEVTOOLS_MCP_PACKAGE = 'chrome-devtools-mcp@1.14.0';
export const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp@0.0.86';

export interface BuildAutomationSnippetInput {
    port: number;
    tokenSegment: string;
    tab: SnippetTab;
}

export function buildAutomationSnippet({
    port,
    tokenSegment,
    tab,
}: BuildAutomationSnippetInput): string {
    const baseUrl = `http://127.0.0.1:${port}`;
    const hasToken = Boolean(tokenSegment);
    const mcpUrl = hasToken
        ? `${baseUrl}/t/${tokenSegment}/mcp`
        : `${baseUrl}/mcp`;
    const cdpWsUrl = hasToken
        ? `ws://127.0.0.1:${port}/t/${tokenSegment}/devtools/browser`
        : baseUrl;

    if (tab === 'cdpCode') {
        return hasToken
            ? [
                  "import { chromium } from 'playwright';",
                  '',
                  `const token = '${tokenSegment}';`,
                  `const res = await fetch('${baseUrl}/api/v1/profiles/start', {`,
                  "  method: 'POST',",
                  "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },",
                  "  body: JSON.stringify({ name: 'Profile-1' }),",
                  '});',
                  'const { data } = await res.json();',
                  'const browser = await chromium.connectOverCDP(data.wsEndpoint, {',
                  '  headers: { Authorization: `Bearer ${token}` },',
                  '});',
                  'const context = browser.contexts()[0];',
              ].join('\n')
            : [
                  "import { chromium } from 'playwright';",
                  '',
                  `const res = await fetch('${baseUrl}/api/v1/profiles/start', {`,
                  "  method: 'POST',",
                  "  headers: { 'Content-Type': 'application/json' },",
                  "  body: JSON.stringify({ name: 'Profile-1' }),",
                  '});',
                  'const { data } = await res.json();',
                  'const browser = await chromium.connectOverCDP(data.wsEndpoint);',
                  'const context = browser.contexts()[0];',
              ].join('\n');
    }

    const mcpServers: Record<string, Record<string, unknown>> = {
        multichrome: {
            url: mcpUrl,
        },
    };

    if (tab === 'devtoolsMcp') {
        mcpServers['chrome-devtools'] = {
            command: 'npx',
            args: [
                '-y',
                CHROME_DEVTOOLS_MCP_PACKAGE,
                hasToken
                    ? `--wsEndpoint=${cdpWsUrl}`
                    : `--browserUrl=${baseUrl}`,
            ],
        };
    } else {
        mcpServers.playwright = {
            command: 'npx',
            args: ['-y', PLAYWRIGHT_MCP_PACKAGE, '--cdp-endpoint', cdpWsUrl],
        };
    }

    return JSON.stringify({ mcpServers }, null, 2);
}
