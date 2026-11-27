import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { decideStartupUrlAction } from '../electron/domain/startupUrlPolicy.js';
import { buildFingerprintChromiumArgs } from '../electron/domain/fingerprintProfile.js';

const require = createRequire(import.meta.url);

function loadCDPManagerClass() {
    const source = fs.readFileSync(path.resolve('electron/drivers/cdpManager.ts'), 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;

    const moduleObj = { exports: {} };
    const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
    const customRequire = (specifier) => {
        if (specifier === 'electron-log') return { default: noopLogger, ...noopLogger };
        if (specifier === '../domain/startupUrlPolicy.js') {
            return { decideStartupUrlAction };
        }
        return require(specifier);
    };

    vm.runInNewContext(transpiled, {
        module: moduleObj,
        exports: moduleObj.exports,
        require: customRequire,
        process,
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
    });

    return moduleObj.exports.CDPManager;
}

test('CDPManager uses pure native V8/Blink Emulation (zero JS prototype hooks) for all engines', () => {
    const CDPManager = loadCDPManagerClass();
    const cdp = new CDPManager();

    // C++ fingerprint kernel without geolocation needs no CDP overrides at all
    cdp.primeEnvironment('env-cpp', {});
    assert.equal(cdp.shouldEnableOverrides('env-cpp'), false);

    // Adding a fallback timezone or geolocation enables native Emulation overrides
    cdp.envTimezones.set('env-cpp', 'America/New_York');
    assert.equal(cdp.shouldEnableOverrides('env-cpp'), true);

    // Official Chrome registers timezone/locale/geo for native Emulation only (no JS injection method)
    cdp.primeEnvironment('env-chrome', {
        timezone: 'America/Los_Angeles',
        locale: 'en-US',
        geolocation: { latitude: 34.05, longitude: -118.24 },
    });
    assert.equal(cdp.shouldEnableOverrides('env-chrome'), true);
    assert.equal(typeof cdp.getFullInjectionScript, 'undefined');

    // Disconnect clears all primed state cleanly
    cdp.disconnect('env-cpp');
    cdp.disconnect('env-chrome');
    assert.equal(cdp.shouldEnableOverrides('env-cpp'), false);
    assert.equal(cdp.shouldEnableOverrides('env-chrome'), false);
});

test('CDPManager excludes service_worker in Target.setAutoAttach filter and avoids pausing for geolocation-only overrides', async () => {
    const CDPManager = loadCDPManagerClass();
    const cdp = new CDPManager();

    // Geolocation-only (C++ fingerprint kernel with GPS sync) must NOT pause targets on start
    cdp.primeEnvironment('env-geo', {
        geolocation: { latitude: -16.5, longitude: -68.15 },
    });
    assert.equal(cdp.shouldEnableOverrides('env-geo'), true);
    assert.equal(cdp.shouldPauseOnAutoAttach('env-geo'), false);

    // Timezone/locale (system Chrome) pauses page/worker targets but excludes service_worker via filter
    cdp.primeEnvironment('env-tz', {
        timezone: 'America/La_Paz',
        locale: 'en-US',
    });
    assert.equal(cdp.shouldPauseOnAutoAttach('env-tz'), true);

    const sentPayloads = [];
    const fakeWs = {
        readyState: 1, // WebSocket.OPEN
        send(raw) {
            const payload = JSON.parse(raw);
            sentPayloads.push(payload);
            const entry = cdp.pendingResponses.get(payload.id);
            if (entry) {
                clearTimeout(entry.timer);
                cdp.pendingResponses.delete(payload.id);
                // First call with filter succeeds for env-geo; for env-fallback simulate legacy rejection on filter
                if (entry.envId === 'env-fallback' && payload.params?.filter) {
                    entry.resolve({ id: payload.id, error: { code: -32602, message: 'Unknown parameter filter' } });
                } else {
                    entry.resolve({ id: payload.id, result: {} });
                }
            }
        },
        close() {},
    };

    for (const envId of ['env-geo', 'env-tz', 'env-fallback']) {
        cdp.connections.set(envId, {
            ws: fakeWs,
            debugUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
            debugPort: 9222,
            envId,
            browserPID: null,
            connected: true,
            autoAttachEnabled: false,
            autoAttachPromise: null,
            manualDisconnect: false,
            reconnectAttempts: 0,
            reconnectTimer: null,
            onDisconnect() {},
        });
    }
    cdp.primeEnvironment('env-fallback', { timezone: 'America/La_Paz' });

    await cdp.enableAutoAttach('env-geo', fakeWs);
    await cdp.enableAutoAttach('env-tz', fakeWs);
    await cdp.enableAutoAttach('env-fallback', fakeWs);

    assert.equal(sentPayloads.length, 4);
    assert.equal(sentPayloads[0].method, 'Target.setAutoAttach');
    assert.equal(sentPayloads[0].params.waitForDebuggerOnStart, false);
    assert.ok(
        sentPayloads[0].params.filter.some(
            (rule) => rule.type === 'service_worker' && rule.exclude === true,
        ),
    );
    assert.equal(sentPayloads[1].params.waitForDebuggerOnStart, true);
    assert.ok(
        sentPayloads[1].params.filter.some(
            (rule) => rule.type === 'service_worker' && rule.exclude === true,
        ),
    );
    // Fallback retries without filter when older Chromium rejects filter
    assert.ok(Array.isArray(sentPayloads[2].params.filter));
    assert.equal(sentPayloads[3].params.filter, undefined);
    assert.equal(sentPayloads[3].params.waitForDebuggerOnStart, true);
    assert.equal(cdp.connections.get('env-fallback').autoAttachEnabled, true);
});

test('EnvironmentService.inspectEnvironmentHealth never excludes the inspected env from proxy in-use checks', () => {
    const src = fs.readFileSync(
        path.resolve('electron/services/environmentService.ts'),
        'utf8',
    );
    const fnStart = src.indexOf('public async inspectEnvironmentHealth');
    assert.ok(fnStart >= 0);
    const fnBody = src.slice(fnStart, fnStart + 2200);
    assert.match(fnBody, /ensureManagedProxyReady\(\s*env\.proxyId\s*,?\s*\)/);
    assert.equal(/ensureManagedProxyReady\(\s*env\.proxyId\s*,\s*id\s*\)/.test(fnBody), false);
});

test('buildFingerprintChromiumArgs preserves native DeviceBoundSessions so existing Google DBSC sessions keep rotating bound cookies', () => {
    const args = buildFingerprintChromiumArgs(
        {
            seed: 123456,
            platform: 'windows',
            brand: 'Chrome',
            hardwareConcurrency: 8,
            windowSize: { width: 1600, height: 900 },
        },
        { timezone: 'America/La_Paz' },
    );
    const disabledFeatures = args
        .filter((arg) => arg.startsWith('--disable-features='))
        .flatMap((arg) => arg.slice('--disable-features='.length).split(','));
    assert.equal(disabledFeatures.includes('DeviceBoundSessions'), false);
    assert.equal(disabledFeatures.includes('PersistDeviceBoundSessions'), false);
    assert.equal(disabledFeatures.includes('EnableBoundSessionCredentials'), false);
});

test('CDPManager fails closed when Emulation timezone ACK times out and symmetrically resets cached + uncached restored tabs', async () => {
    const CDPManager = loadCDPManagerClass();
    const cdp = new CDPManager();
    cdp.primeEnvironment('env-timeout', {
        timezone: 'Asia/Tokyo',
        locale: 'en-US',
    });

    // 1. Simulate a session whose Emulation command times out (returns null) -> applyOverrides must return false (Fail-Closed)
    const silentWs = {
        readyState: 1,
        send(raw) {
            const payload = JSON.parse(raw);
            if (payload.method === 'Target.setAutoAttach') {
                const entry = cdp.pendingResponses.get(payload.id);
                if (entry) {
                    clearTimeout(entry.timer);
                    cdp.pendingResponses.delete(payload.id);
                    entry.resolve({ id: payload.id, result: {} });
                }
            }
        },
        close() {},
    };
    cdp.connections.set('env-timeout', {
        ws: silentWs,
        debugUrl: 'ws://127.0.0.1:9222/devtools/browser/t1',
        debugPort: 9222,
        envId: 'env-timeout',
        browserPID: null,
        connected: true,
        autoAttachEnabled: false,
        autoAttachPromise: null,
        manualDisconnect: false,
        reconnectAttempts: 0,
        reconnectTimer: null,
        onDisconnect() {},
    });
    cdp.envSessions.set(
        'env-timeout',
        new Map([
            [
                'sess-stalled',
                {
                    sessionId: 'sess-stalled',
                    targetId: 't-stalled',
                    type: 'page',
                    url: 'http://e2e-restore.invalid/restore-uncached',
                    injected: false,
                },
            ],
        ]),
    );
    // Stub sendCommand for fast deterministic timeout on Emulation commands
    const origSend = cdp.sendCommand.bind(cdp);
    cdp.sendCommand = (envId, ws, method, params, sessionId, timeoutMs) => {
        if (envId === 'env-timeout' && method.startsWith('Emulation.')) {
            return Promise.resolve(null);
        }
        return origSend(envId, ws, method, params, sessionId, timeoutMs);
    };
    assert.equal(await cdp.applyOverrides('env-timeout'), false);

    // 2. Simulate restored session with one disk-cached tab (already committed) and one uncached tab (about:blank + pending session.url)
    cdp.primeEnvironment('env-restore', {
        timezone: 'Asia/Tokyo',
        locale: 'en-US',
    });
    const sessionCalls = [];
    const currentHref = new Map([
        ['sess-cached', 'http://e2e-restore.invalid/restore-cached'],
        ['sess-uncached', 'about:blank'],
    ]);
    const restoreWs = {
        readyState: 1,
        send(raw) {
            const payload = JSON.parse(raw);
            sessionCalls.push({
                sessionId: payload.sessionId || null,
                method: payload.method,
                url: payload.params?.url,
                timezoneId: payload.params?.timezoneId,
            });
            const entry = cdp.pendingResponses.get(payload.id);
            if (!entry) return;
            clearTimeout(entry.timer);
            cdp.pendingResponses.delete(payload.id);
            if (payload.method === 'Runtime.evaluate') {
                entry.resolve({
                    id: payload.id,
                    result: { result: { value: currentHref.get(payload.sessionId) || 'about:blank' } },
                });
            } else if (payload.method === 'Page.navigate') {
                currentHref.set(payload.sessionId, payload.params.url);
                entry.resolve({ id: payload.id, result: {} });
            } else if (
                payload.method === 'Emulation.setTimezoneOverride' &&
                payload.sessionId === 'sess-uncached'
            ) {
                // Also verify Chromium's "already in effect" response on shared renderer is accepted as ACK
                entry.resolve({
                    id: payload.id,
                    error: { code: -32000, message: 'Timezone override is already in effect' },
                });
            } else {
                entry.resolve({ id: payload.id, result: {} });
            }
        },
        close() {},
    };
    cdp.connections.set('env-restore', {
        ws: restoreWs,
        debugUrl: 'ws://127.0.0.1:9223/devtools/browser/t2',
        debugPort: 9223,
        envId: 'env-restore',
        browserPID: null,
        connected: true,
        autoAttachEnabled: true,
        autoAttachPromise: Promise.resolve(),
        manualDisconnect: false,
        reconnectAttempts: 0,
        reconnectTimer: null,
        onDisconnect() {},
    });
    cdp.envSessions.set(
        'env-restore',
        new Map([
            [
                'sess-cached',
                {
                    sessionId: 'sess-cached',
                    targetId: 't-cached',
                    type: 'page',
                    url: 'http://e2e-restore.invalid/restore-cached',
                    injected: true,
                },
            ],
            [
                'sess-uncached',
                {
                    sessionId: 'sess-uncached',
                    targetId: 't-uncached',
                    type: 'page',
                    url: 'http://e2e-restore.invalid/restore-uncached',
                    injected: false,
                },
            ],
        ]),
    );
    assert.equal(await cdp.applyOverrides('env-restore'), true);

    let gateDropped = false;
    const gate = {
        isReleased: () => gateDropped,
        release: () => 0,
        dropHeldAndRelease: () => {
            gateDropped = true;
            return { droppedCount: 4 };
        },
    };
    const flushRes = await cdp.flushStartupGate('env-restore', gate);
    assert.equal(flushRes.preCommittedCount, 1);
    assert.equal(flushRes.reloadedCount, 2);
    assert.equal(flushRes.droppedCount, 4);
    // Both cached AND uncached restored tabs must reset via about:blank and finish with explicit Page.navigate to their target URLs
    assert.equal(currentHref.get('sess-cached'), 'http://e2e-restore.invalid/restore-cached');
    assert.equal(currentHref.get('sess-uncached'), 'http://e2e-restore.invalid/restore-uncached');
    assert.equal(
        sessionCalls.some((c) => c.method === 'Page.reload'),
        false,
    );
});
