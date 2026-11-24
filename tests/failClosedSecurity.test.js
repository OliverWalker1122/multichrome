import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
    buildManagedProxyArgs,
    buildManualProxyArgs,
    applyFailClosedWebRTCPreferences,
} from '../electron/domain/managedProxyArgs.js';
import {
    isProfileRunningLocally,
    readDevToolsActivePort,
} from '../electron/drivers/profileLock.js';
import { ProxyIntegration } from '../electron/services/proxyCoordinator.js';

test('manual and managed proxy args enforce fail-closed QUIC, WebRTC and DNS rules', () => {
    const managed = buildManagedProxyArgs('http://127.0.0.1:43210');
    assert.ok(managed.includes('--disable-quic'));
    assert.ok(managed.includes('--proxy-bypass-list=<-loopback>'));
    assert.ok(
        managed.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'),
    );
    assert.ok(
        managed.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'),
    );

    const manual = buildManualProxyArgs('socks5://user:pass@proxy.example.com:1080');
    assert.ok(manual.includes('--proxy-server=socks5://user:pass@proxy.example.com:1080'));
    assert.ok(manual.includes('--disable-quic'));
    assert.ok(manual.includes('--proxy-bypass-list=<-loopback>'));
    assert.ok(
        manual.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'),
    );
    assert.ok(
        manual.includes('--webrtc-ip-handling-policy=disable_non_proxied_udp'),
    );
    const resolverRule = manual.find((arg) =>
        arg.startsWith('--host-resolver-rules='),
    );
    assert.ok(resolverRule);
    assert.match(resolverRule, /MAP \* ~NOTFOUND/);
    assert.match(resolverRule, /EXCLUDE proxy\.example\.com/);
    assert.match(resolverRule, /EXCLUDE 127\.0\.0\.1/);

    assert.throws(() => buildManualProxyArgs(''), /代理地址无效/);
});

test('applyFailClosedWebRTCPreferences locks WebRTC policies without clobbering sibling keys', () => {
    const prefs = { profile: { name: 'test' }, webrtc: { existing: 1 } };
    applyFailClosedWebRTCPreferences(prefs);
    assert.equal(prefs.profile.name, 'test');
    assert.equal(prefs.webrtc.existing, 1);
    assert.equal(prefs.webrtc.ip_handling_policy, 'disable_non_proxied_udp');
    assert.equal(prefs.webrtc.multiple_routes_enabled, false);
    assert.equal(prefs.webrtc.nonproxied_udp_enabled, false);
});

test('profileLock detects live DevToolsActivePort and clears when browser stops', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-lock-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const idle = await isProfileRunningLocally(tmpDir);
    assert.equal(idle.running, false);
    assert.equal(readDevToolsActivePort(tmpDir), null);

    const server = http.createServer((req, res) => {
        if (req.url === '/json/version') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ Browser: 'Chrome/Test' }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    fs.writeFileSync(
        path.join(tmpDir, 'DevToolsActivePort'),
        `${port}\n/devtools/browser/test\n`,
    );
    assert.equal(readDevToolsActivePort(tmpDir), port);

    const alive = await isProfileRunningLocally(tmpDir);
    assert.equal(alive.running, true);
    assert.equal(alive.source, 'devtools-file');

    await new Promise((resolve) => server.close(resolve));
    const afterClose = await isProfileRunningLocally(tmpDir);
    assert.equal(afterClose.running, false);
});

test('ProxyIntegration.runLaunch allows concurrent launches while serializing mutations and shutdown', async () => {
    const events = [];
    let closedAll = false;
    const integration = new ProxyIntegration({
        proxyManager: {
            closeAll: async () => {
                closedAll = true;
                events.push('closeAll');
            },
        },
        chromeManager: { getProxyBindings: async () => [] },
    });

    const launch1 = integration.runLaunch(async () => {
        events.push('launch1:start');
        await new Promise((r) => setTimeout(r, 60));
        events.push('launch1:end');
        return 'L1';
    });
    const launch2 = integration.runLaunch(async () => {
        events.push('launch2:start');
        await new Promise((r) => setTimeout(r, 20));
        events.push('launch2:end');
        return 'L2';
    });

    // Mutation queued while launches are active must wait for both launches
    const mutation = integration.run(async () => {
        events.push('mutation');
        return 'M1';
    });

    const results = await Promise.all([launch1, launch2, mutation]);
    assert.deepEqual(results, ['L1', 'L2', 'M1']);
    // Both launches started before either ended (concurrent!)
    assert.ok(events.indexOf('launch2:start') < events.indexOf('launch1:end'));
    // Mutation ran strictly after both launches finished
    assert.ok(events.indexOf('mutation') > events.indexOf('launch1:end'));
    assert.ok(events.indexOf('mutation') > events.indexOf('launch2:end'));

    await integration.shutdown();
    assert.equal(closedAll, true);
});
