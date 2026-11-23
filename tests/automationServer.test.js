import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import {
    AutomationConfigManager,
    DEFAULT_AUTOMATION_PORT,
    findAvailableAutomationPort,
    formatAutomationBindError,
    probeLoopbackPort,
    sanitizeProfileForAutomation,
    verifyLoopbackRequestSecurity,
} from '../electron/automationConfig.js';
import {
    IGNORED_CDP_OVERRIDE_METHODS,
    inspectClientCdpMessage,
    parseCdpHttpRoute,
    parseCdpWsRoute,
} from '../electron/cdpGuard.js';
import { AutomationServer } from '../electron/automationServer.js';
import {
    AutomationIntegration,
    createAutomationBackend,
    registerAutomationIpc,
} from '../electron/automationIntegration.js';

const PROFILE_1 = '11111111-1111-4111-8111-111111111111';
const PROFILE_2 = '22222222-2222-4222-8222-222222222222';
const PROXY_1 = '33333333-3333-4333-8333-333333333333';

function createMemoryStore(initial = null) {
    const map = new Map();
    if (initial !== null) {
        map.set('automation', structuredClone(initial));
    }
    return {
        get: (key, fallback) => (map.has(key) ? map.get(key) : fallback),
        set: (key, value) => map.set(key, structuredClone(value)),
    };
}

function httpRequest({ port, method = 'GET', path = '/', headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                method,
                path,
                headers: {
                    Host: `127.0.0.1:${port}`,
                    ...headers,
                },
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch {
                        // non-json
                    }
                    resolve({ status: res.statusCode, text, json });
                });
            },
        );
        req.on('error', reject);
        if (body !== undefined) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function createFakeUpstreamChrome() {
    const receivedFrames = [];
    const httpServer = http.createServer((req, res) => {
        const port = httpServer.address().port;
        if (req.url === '/json/version') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    Browser: 'Chrome/142.0.0.0',
                    'Protocol-Version': '1.3',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/internal-uuid`,
                }),
            );
            return;
        }
        if (req.url === '/json/list' || req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify([
                    {
                        id: 'page-target-1',
                        type: 'page',
                        title: 'Test Page',
                        url: 'https://example.com',
                        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/page-target-1`,
                        devtoolsFrontendUrl: `/devtools/inspector.html?ws=127.0.0.1:${port}/devtools/page/page-target-1`,
                    },
                ]),
            );
            return;
        }
        res.writeHead(404).end();
    });

    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (ws) => {
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString('utf8'));
            receivedFrames.push(msg);
            const reply = {
                id: msg.id,
                result: { echoedMethod: msg.method, params: msg.params || {} },
            };
            if (msg.sessionId) {
                reply.sessionId = msg.sessionId;
            }
            ws.send(JSON.stringify(reply));
        });
    });

    await new Promise((resolve) =>
        httpServer.listen(0, '127.0.0.1', () => resolve()),
    );
    const port = httpServer.address().port;

    return {
        port,
        wsEndpoint: `ws://127.0.0.1:${port}/devtools/browser/internal-uuid`,
        receivedFrames,
        close: async () => {
            for (const client of wss.clients) {
                try {
                    client.terminate();
                } catch {
                    // ignore
                }
            }
            await new Promise((resolve) => wss.close(() => resolve()));
            await new Promise((resolve) => httpServer.close(() => resolve()));
        },
    };
}

function sendWsRpc(ws, payload) {
    return new Promise((resolve, reject) => {
        const onMessage = (raw) => {
            const parsed = JSON.parse(raw.toString('utf8'));
            if (parsed.id === payload.id) {
                ws.off('message', onMessage);
                resolve(parsed);
            }
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify(payload), (err) => {
            if (err) {
                ws.off('message', onMessage);
                reject(err);
            }
        });
    });
}

test('inspectClientCdpMessage: silently absorbs all 8 override commands (including flattened sessionId) and blocks incognito context creation', () => {
    for (const method of IGNORED_CDP_OVERRIDE_METHODS) {
        const topLevel = inspectClientCdpMessage(
            JSON.stringify({ id: 7, method, params: { foo: 'bar' } }),
        );
        assert.equal(topLevel.action, 'reply');
        assert.deepEqual(topLevel.payload, { id: 7, result: {} });

        const flatSession = inspectClientCdpMessage(
            Buffer.from(
                JSON.stringify({
                    id: 42,
                    method,
                    sessionId: 'flat-session-99',
                    params: { width: 800, height: 600 },
                }),
            ),
        );
        assert.equal(flatSession.action, 'reply');
        assert.deepEqual(flatSession.payload, {
            id: 42,
            sessionId: 'flat-session-99',
            result: {},
        });
    }

    const blockedCtx = inspectClientCdpMessage(
        JSON.stringify({
            id: 99,
            method: 'Target.createBrowserContext',
            params: {},
        }),
    );
    assert.equal(blockedCtx.action, 'reply');
    assert.equal(blockedCtx.payload.id, 99);
    assert.match(blockedCtx.payload.error.message, /browser\.contexts\(\)\[0\]/);

    const normalCmd = inspectClientCdpMessage(
        JSON.stringify({
            id: 100,
            method: 'Page.navigate',
            params: { url: 'https://example.com' },
        }),
    );
    assert.equal(normalCmd.action, 'forward');
});

test('parseCdpHttpRoute & parseCdpWsRoute: parses standard and profile-scoped CDP endpoints', () => {
    assert.deepEqual(parseCdpHttpRoute('/json/version'), {
        kind: 'version',
        profileId: null,
        isActiveSlot: true,
    });
    assert.deepEqual(parseCdpHttpRoute('/json/list'), {
        kind: 'list',
        profileId: null,
        isActiveSlot: true,
    });
    assert.deepEqual(parseCdpHttpRoute(`/cdp/${PROFILE_1}/json/version`), {
        kind: 'version',
        profileId: PROFILE_1,
        isActiveSlot: false,
    });

    assert.deepEqual(parseCdpWsRoute(`/devtools/browser/active/${PROFILE_1}`), {
        targetType: 'browser',
        profileId: PROFILE_1,
        targetId: null,
        isActiveSlot: true,
    });
    assert.deepEqual(parseCdpWsRoute(`/devtools/browser/${PROFILE_1}`), {
        targetType: 'browser',
        profileId: PROFILE_1,
        targetId: null,
        isActiveSlot: false,
    });
    assert.deepEqual(parseCdpWsRoute(`/devtools/page/${PROFILE_1}/tab-1`), {
        targetType: 'page',
        profileId: PROFILE_1,
        targetId: 'tab-1',
        isActiveSlot: false,
    });
});

test('AutomationConfigManager: unified enabled state, legacy store migration, port validation, and profile sanitization', async () => {
    // Legacy store with only mcpEnabled: true migrates seamlessly to enabled: true
    const legacyStore = createMemoryStore({
        localApiEnabled: false,
        mcpEnabled: true,
        port: 19005,
        encryptedToken: 'legacy-unused-blob',
    });
    const mgr = new AutomationConfigManager({ store: legacyStore });
    assert.equal(mgr.getConfig().enabled, true);
    assert.equal(mgr.getConfig().port, 19005);

    mgr.updateConfig({ enabled: false, port: DEFAULT_AUTOMATION_PORT });
    assert.equal(mgr.getConfig().enabled, false);
    assert.equal(mgr.getConfig().port, DEFAULT_AUTOMATION_PORT);

    const status = mgr.getStatus({
        running: false,
        activeProfileId: PROFILE_1,
        activeProfileName: 'ProfileOne',
        runningProfiles: [{ id: PROFILE_1, name: 'ProfileOne' }],
    });
    assert.equal(status.baseUrl, `http://127.0.0.1:${DEFAULT_AUTOMATION_PORT}`);
    assert.equal(status.cdpEndpoint, status.baseUrl);
    assert.equal(status.activeProfileId, PROFILE_1);

    // Profile sanitization redacts credentials and never exposes internal debugPort
    const sanitized = sanitizeProfileForAutomation(
        {
            id: PROFILE_1,
            name: 'ProfileOne',
            groupName: 'work',
            proxy: 'socks5://alice:secret123@198.51.100.10:1080',
            isRunning: true,
        },
        {
            wsEndpoint: `ws://127.0.0.1:18922/devtools/browser/${PROFILE_1}`,
        },
        null,
        true,
    );
    assert.equal(sanitized.proxy, 'socks5://[redacted]@198.51.100.10:1080');
    assert.equal(sanitized.isActiveTarget, true);
    assert.equal(
        sanitized.cdp.wsEndpoint,
        `ws://127.0.0.1:18922/devtools/browser/${PROFILE_1}`,
    );
    assert.equal('debugPort' in sanitized.cdp, false);

    // Loopback security check blocks Origin and non-loopback Host
    assert.equal(
        verifyLoopbackRequestSecurity(
            {
                headers: {
                    host: '127.0.0.1:18922',
                    origin: 'https://evil.example',
                },
                socket: { remoteAddress: '127.0.0.1' },
            },
            18922,
        ).status,
        403,
    );
    assert.equal(
        verifyLoopbackRequestSecurity(
            {
                headers: { host: 'attacker.dns-rebind.com:18922' },
                socket: { remoteAddress: '127.0.0.1' },
            },
            18922,
        ).status,
        403,
    );

    // Free port helper skips occupied ports
    const blocker = net.createServer();
    await new Promise((resolve) =>
        blocker.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve),
    );
    const occupiedPort = blocker.address().port;
    try {
        const probed = await probeLoopbackPort(occupiedPort);
        assert.equal(probed.available, false);
        const altPort = await findAvailableAutomationPort({
            preferredPort: occupiedPort,
            scanStart: occupiedPort,
            scanCount: 5,
        });
        assert.notEqual(altPort, occupiedPort);
    } finally {
        await new Promise((resolve) => blocker.close(() => resolve()));
    }

    assert.match(
        formatAutomationBindError({ code: 'EADDRINUSE' }, 18922),
        /18922/,
    );
});

test('End-to-end CDP Guard + AutomationServer: discovery rewrite, override absorption, foolproof multi-profile guard, active switch, and Fail-Closed proxy drop', async (t) => {
    const chrome1 = await createFakeUpstreamChrome();
    const chrome2 = await createFakeUpstreamChrome();

    let proxy1Status = 'running';
    const proxySubscribers = new Set();

    const profiles = new Map([
        [
            PROFILE_1,
            {
                id: PROFILE_1,
                name: 'ProfileMain',
                groupName: 'work',
                tags: ['primary'],
                proxyId: PROXY_1,
                browserEngine: 'fingerprint-chromium',
                isRunning: false,
            },
        ],
        [
            PROFILE_2,
            {
                id: PROFILE_2,
                name: 'ProfileBackup',
                groupName: 'backup',
                tags: ['backup'],
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
            const upstream = id === PROFILE_1 ? chrome1 : chrome2;
            runningProcesses.set(id, { debugPort: upstream.port });
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
            const rec = runningProcesses.get(id);
            if (!rec) return null;
            const upstream = id === PROFILE_1 ? chrome1 : chrome2;
            return {
                debugPort: upstream.port,
                wsEndpoint: upstream.wsEndpoint,
            };
        },
    };

    const proxyManager = {
        list: () => [
            {
                id: PROXY_1,
                name: 'Tokyo Residential',
                protocol: 'vless',
                status: proxy1Status,
                exitInfo: { status: 'ready', ip: '203.0.113.9', countryCode: 'JP' },
            },
        ],
        subscribe: (fn) => {
            proxySubscribers.add(fn);
            return () => proxySubscribers.delete(fn);
        },
    };

    const backend = createAutomationBackend({
        chromeManager,
        proxyManager,
        appVersion: '1.3.0',
    });
    const server = new AutomationServer({ backend });
    const { port } = await server.start({ port: 0 });

    const openClients = new Set();
    t.after(async () => {
        for (const ws of openClients) {
            try {
                ws.terminate();
            } catch {
                // ignore
            }
        }
        await server.stop();
        await chrome1.close();
        await chrome2.close();
    });

    // 1. 0 profiles running -> /json/version returns 503 foolproof hint
    const emptyVer = await httpRequest({ port, path: '/json/version' });
    assert.equal(emptyVer.status, 503);
    assert.equal(emptyVer.json.error.code, 'NO_RUNNING_PROFILE');

    // 2. Manual launch of 1 profile -> auto-selected by /json/version without extra config
    await chromeManager.launchEnvironment(PROFILE_1);
    const ver1 = await httpRequest({ port, path: '/json/version' });
    assert.equal(ver1.status, 200);
    assert.equal(
        ver1.json.webSocketDebuggerUrl,
        `ws://127.0.0.1:${port}/devtools/browser/active/${PROFILE_1}`,
    );
    // Internal Chrome port must NOT leak in /json/version or /json/list
    assert.equal(ver1.text.includes(String(chrome1.port)), false);

    const list1 = await httpRequest({ port, path: '/json/list' });
    assert.equal(list1.status, 200);
    assert.equal(
        list1.json[0].webSocketDebuggerUrl,
        `ws://127.0.0.1:${port}/devtools/page/active/${PROFILE_1}/page-target-1`,
    );
    assert.equal(list1.text.includes(String(chrome1.port)), false);

    // 3. Manual launch of 2nd profile WITHOUT explicit active selection -> 409 foolproof block!
    await chromeManager.launchEnvironment(PROFILE_2);
    const ambiguousVer = await httpRequest({ port, path: '/json/version' });
    assert.equal(ambiguousVer.status, 409);
    assert.equal(ambiguousVer.json.error.code, 'AMBIGUOUS_ACTIVE_PROFILE');

    // 4. Select PROFILE_1 via POST /api/v1/active-profile (by name!) -> /json/version resolves cleanly
    const switchRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/v1/active-profile',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'ProfileMain' },
    });
    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.json.data.activeProfileId, PROFILE_1);

    const resolvedVer = await httpRequest({ port, path: '/json/version' });
    assert.equal(resolvedVer.status, 200);

    // 5. Reject WebSocket upgrade carrying a browser Origin header (anti-CSRF)
    await assert.rejects(
        () =>
            new Promise((resolve, reject) => {
                const badWs = new WebSocket(resolvedVer.json.webSocketDebuggerUrl, {
                    origin: 'https://malicious.site',
                });
                badWs.once('open', () => resolve());
                badWs.once('error', reject);
            }),
    );

    // 6. Connect active-slot client AND explicit parallel PROFILE_2 client simultaneously
    const activeWs = new WebSocket(resolvedVer.json.webSocketDebuggerUrl);
    openClients.add(activeWs);
    await new Promise((resolve, reject) => {
        activeWs.once('open', resolve);
        activeWs.once('error', reject);
    });

    const explicitWs2 = new WebSocket(
        `ws://127.0.0.1:${port}/devtools/browser/${PROFILE_2}`,
    );
    openClients.add(explicitWs2);
    await new Promise((resolve, reject) => {
        explicitWs2.once('open', resolve);
        explicitWs2.once('error', reject);
    });

    // Overrides are silently absorbed by CDP Guard and NEVER reach upstream Chrome
    const uaRes = await sendWsRpc(activeWs, {
        id: 1,
        sessionId: 'page-sess-1',
        method: 'Emulation.setUserAgentOverride',
        params: { userAgent: 'PuppeteerHeadless/1.0' },
    });
    assert.deepEqual(uaRes, { id: 1, sessionId: 'page-sess-1', result: {} });

    const metricsRes = await sendWsRpc(activeWs, {
        id: 2,
        sessionId: 'page-sess-1',
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false },
    });
    assert.deepEqual(metricsRes, {
        id: 2,
        sessionId: 'page-sess-1',
        result: {},
    });

    const ctxErr = await sendWsRpc(activeWs, {
        id: 3,
        method: 'Target.createBrowserContext',
        params: {},
    });
    assert.equal(ctxErr.id, 3);
    assert.ok(ctxErr.error);

    // Normal CDP command passes straight through to upstream Chrome1
    const navRes = await sendWsRpc(activeWs, {
        id: 4,
        sessionId: 'page-sess-1',
        method: 'Page.navigate',
        params: { url: 'https://app.example.com' },
    });
    assert.equal(navRes.result.echoedMethod, 'Page.navigate');
    assert.equal(chrome1.receivedFrames.length, 1);
    assert.equal(chrome1.receivedFrames[0].method, 'Page.navigate');

    // 7. Switching active profile to PROFILE_2 closes activeWs cleanly while explicitWs2 stays open!
    const activeClosedPromise = new Promise((resolve) =>
        activeWs.once('close', (code) => resolve(code)),
    );
    await backend.switchActiveProfile({ name: 'ProfileBackup' });
    const closeCode = await activeClosedPromise;
    assert.equal(closeCode, 1001);
    assert.equal(explicitWs2.readyState, WebSocket.OPEN);

    // 8. Reconnect explicit WS to PROFILE_1, then simulate sing-box proxy crash -> Fail-Closed disconnect!
    const explicitWs1 = new WebSocket(
        `ws://127.0.0.1:${port}/devtools/browser/${PROFILE_1}`,
    );
    openClients.add(explicitWs1);
    await new Promise((resolve, reject) => {
        explicitWs1.once('open', resolve);
        explicitWs1.once('error', reject);
    });

    const proxyDropClose = new Promise((resolve) =>
        explicitWs1.once('close', (code) => resolve(code)),
    );
    proxy1Status = 'error';
    for (const sub of proxySubscribers) {
        sub({ kind: 'state' });
    }
    const dropCode = await proxyDropClose;
    assert.equal(dropCode, 1011);

    // Subsequent connection attempts to PROFILE_1 while proxy is down fail closed with 503
    const brokenScopedVer = await httpRequest({
        port,
        path: `/cdp/${PROFILE_1}/json/version`,
    });
    assert.equal(brokenScopedVer.status, 503);
    assert.equal(brokenScopedVer.json.error.code, 'PROXY_NOT_RUNNING');
});

test('AutomationIntegration + IPC: port conflict recovery and active profile IPC state sync', async (t) => {
    const blocker = net.createServer();
    await new Promise((resolve) =>
        blocker.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve),
    );
    const blockedPort = blocker.address().port;

    const store = createMemoryStore();
    const configManager = new AutomationConfigManager({ store });
    const backend = createAutomationBackend({
        chromeManager: {
            getAllEnvironments: async () => [],
            getRunningEnvironmentSummary: () => ({ count: 0, ids: [], names: [] }),
        },
    });
    const server = new AutomationServer({ backend });
    const events = [];
    const integration = new AutomationIntegration({
        configManager,
        server,
        onStateChange: (s) => events.push(s),
    });

    const handlers = new Map();
    registerAutomationIpc({
        ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
        integration,
    });

    t.after(async () => {
        await integration.shutdown();
        await new Promise((resolve) => blocker.close(() => resolve()));
    });

    // Occupying port triggers clean start failure without crashing
    const failedStatus = await handlers.get('automation:update-config')(null, {
        enabled: true,
        port: blockedPort,
    });
    assert.equal(failedStatus.running, false);
    assert.ok(failedStatus.lastError);

    // pick-available-port automatically moves off the occupied port and starts cleanly
    const recoveredStatus = await handlers.get('automation:pick-available-port')();
    assert.equal(recoveredStatus.running, true);
    assert.notEqual(recoveredStatus.port, blockedPort);
    assert.equal(recoveredStatus.lastError, undefined);
    assert.ok(events.length >= 2);
});

test('By-name HTTP start/stop (/api/v1/profiles/start), self-discoverable 503 hint, and legacy 45000–48999 boot auto-recovery', async (t) => {
    const chrome = await createFakeUpstreamChrome();
    const profile = {
        id: PROFILE_1,
        name: 'Profile-1',
        groupName: 'work',
        tags: [],
        browserEngine: 'fingerprint-chromium',
        isRunning: false,
    };
    const runningProcesses = new Map();
    const backend = createAutomationBackend({
        chromeManager: {
            runningProcesses,
            getAllEnvironments: async () => [structuredClone(profile)],
            getRunningEnvironmentSummary: () => ({
                count: profile.isRunning ? 1 : 0,
                ids: profile.isRunning ? [profile.id] : [],
                names: profile.isRunning ? [profile.name] : [],
            }),
            launchEnvironment: async () => {
                profile.isRunning = true;
                runningProcesses.set(profile.id, { debugPort: chrome.port });
                return true;
            },
            closeEnvironment: async () => {
                profile.isRunning = false;
                runningProcesses.delete(profile.id);
                return true;
            },
            getAutomationConnectionInfo: async () => ({
                debugPort: chrome.port,
                wsEndpoint: chrome.wsEndpoint,
            }),
        },
    });

    // Occupy a legacy 45xxx port to verify init() auto-migrates off broken 45000–48999 ports
    const blocker = net.createServer();
    let legacyBlockedPort = 45199;
    try {
        await new Promise((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(
                { host: '127.0.0.1', port: legacyBlockedPort, exclusive: true },
                resolve,
            );
        });
    } catch {
        // On Windows where 45199 is already system-reserved (EACCES), binding 45199 will also fail naturally!
    }

    const store = createMemoryStore({
        enabled: true,
        port: legacyBlockedPort,
    });
    const configManager = new AutomationConfigManager({ store });
    const server = new AutomationServer({ backend });
    const integration = new AutomationIntegration({ configManager, server });

    t.after(async () => {
        await integration.shutdown();
        await chrome.close();
        try {
            await new Promise((resolve) => blocker.close(() => resolve()));
        } catch {
            // ignore
        }
    });

    const bootStatus = await integration.init();
    assert.equal(bootStatus.running, true);
    assert.notEqual(bootStatus.port, legacyBlockedPort);
    const port = bootStatus.port;

    // 503 hint explicitly advertises /mcp and /api/v1/profiles/start
    const hint503 = await httpRequest({ port, path: '/json/version' });
    assert.equal(hint503.status, 503);
    assert.match(hint503.json.error.message, /\/mcp/);
    assert.match(hint503.json.error.message, /\/api\/v1\/profiles\/start/);

    // Start and stop by profile name via HTTP without needing UUID
    const startByName = await httpRequest({
        port,
        method: 'POST',
        path: '/api/v1/profiles/start',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Profile-1' },
    });
    assert.equal(startByName.status, 200);
    assert.equal(startByName.json.data.profileId, PROFILE_1);

    const stopByName = await httpRequest({
        port,
        method: 'POST',
        path: '/api/v1/profiles/stop',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Profile-1' },
    });
    assert.equal(stopByName.status, 200);
    assert.equal(stopByName.json.data.stopped, true);
});
