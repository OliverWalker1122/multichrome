import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
    buildAcceptLangSwitchValue,
    cleanupLegacyFingerprintExtension,
    createProxyStartupGate,
    rewriteProxyAddressForGate,
} from '../electron/proxyStartupGate.js';

function startEchoTcpServer() {
    const receivedChunks = [];
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('data', (chunk) => {
            receivedChunks.push(chunk.toString('utf8'));
            socket.write(`ECHO:${chunk.toString('utf8')}`);
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                receivedChunks,
                close: () => {
                    for (const sock of Array.from(sockets)) {
                        sock.destroy();
                    }
                    sockets.clear();
                    return new Promise((r) => server.close(() => r()));
                },
            });
        });
    });
}

test('buildAcceptLangSwitchValue formats clean comma-separated language list without q-weights', () => {
    assert.equal(buildAcceptLangSwitchValue('en-US'), 'en-US,en');
    assert.equal(buildAcceptLangSwitchValue('ja-JP'), 'ja-JP,ja');
    assert.equal(buildAcceptLangSwitchValue('en'), 'en');
    assert.equal(buildAcceptLangSwitchValue(''), 'en-US,en');
    assert.equal(buildAcceptLangSwitchValue(undefined), 'en-US,en');
});

test('rewriteProxyAddressForGate preserves scheme and credentials while pointing to loopback gate port', () => {
    const httpRes = rewriteProxyAddressForGate('http://127.0.0.1:43210', 55555);
    assert.deepEqual(httpRes, {
        upstreamHost: '127.0.0.1',
        upstreamPort: 43210,
        gateProxyAddress: 'http://127.0.0.1:55555',
    });

    const socksRes = rewriteProxyAddressForGate('socks5://user:pass@proxy.example.com:1080', 55556);
    assert.deepEqual(socksRes, {
        upstreamHost: 'proxy.example.com',
        upstreamPort: 1080,
        gateProxyAddress: 'socks5://user:pass@127.0.0.1:55556',
    });

    assert.equal(rewriteProxyAddressForGate('', 55555), null);
    assert.equal(rewriteProxyAddressForGate('http://127.0.0.1:8080', 0), null);
});

test('cleanupLegacyFingerprintExtension removes _tz_extension IDs and directory while preserving user extensions', (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-clean-ext-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const legacyDir = path.join(tmpDir, '_tz_extension');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, '.installed'), 'abcdefghijklmnopabcdefghijklmnop');
    fs.writeFileSync(path.join(legacyDir, 'content.js'), '// legacy');

    const prefs = {
        extensions: {
            developer: { developer_mode: true },
            settings: {
                multichrome_tz_override: { path: legacyDir, location: 4 },
                abcdefghijklmnopabcdefghijklmnop: { path: legacyDir, location: 4 },
                user_custom_ext_id: { path: 'D:\\custom\\my-ext', location: 4 },
                webstore_ext_id: { path: 'webstore/1.0', location: 1 },
            },
        },
    };

    const result = cleanupLegacyFingerprintExtension(tmpDir, prefs, {
        disableDeveloperMode: true,
    });
    assert.equal(result.removedDir, true);
    assert.equal(fs.existsSync(legacyDir), false);
    assert.equal(result.removedIds.length, 2);
    assert.equal(prefs.extensions.settings.multichrome_tz_override, undefined);
    assert.equal(prefs.extensions.settings.abcdefghijklmnopabcdefghijklmnop, undefined);
    // User unpacked + webstore extensions preserved, and developer_mode stays true because another unpacked ext exists
    assert.ok(prefs.extensions.settings.user_custom_ext_id);
    assert.ok(prefs.extensions.settings.webstore_ext_id);
    assert.equal(prefs.extensions.developer.developer_mode, true);

    // When no other unpacked extension remains and disableDeveloperMode=true, developer_mode turns off
    delete prefs.extensions.settings.user_custom_ext_id;
    cleanupLegacyFingerprintExtension(tmpDir, prefs, { disableDeveloperMode: true });
    assert.equal(prefs.extensions.developer.developer_mode, false);
});

test('createProxyStartupGate holds bytes until release() then forwards intact', async (t) => {
    const upstream = await startEchoTcpServer();
    t.after(() => upstream.close());

    const gate = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.port,
        maxHoldMs: 5000,
    });
    t.after(() => gate.close());

    const client = net.connect(gate.port, '127.0.0.1');
    t.after(() => client.destroy());
    await new Promise((r) => client.once('connect', r));

    const responsePromise = new Promise((resolve) => {
        client.once('data', (chunk) => resolve(chunk.toString('utf8')));
    });

    client.write('HELLO_GATE');
    await new Promise((r) => setTimeout(r, 120));

    // Must NOT have reached upstream while held
    assert.equal(upstream.receivedChunks.length, 0);
    assert.equal(gate.isReleased(), false);
    assert.equal(gate.getStats().heldCount, 1);

    const forwarded = gate.release();
    assert.equal(forwarded, 1);
    assert.equal(gate.isReleased(), true);

    const echoed = await responsePromise;
    assert.equal(echoed, 'ECHO:HELLO_GATE');
    assert.deepEqual(upstream.receivedChunks, ['HELLO_GATE']);
});

test('createProxyStartupGate dropHeldAndRelease discards pre-CDP beacons and opens for reloaded traffic', async (t) => {
    const upstream = await startEchoTcpServer();
    t.after(() => upstream.close());

    const gate = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.port,
        maxHoldMs: 5000,
    });
    t.after(() => gate.close());

    // Simulate a disk-cached / SW tab firing a pre-CDP local-TZ beacon into a held socket
    const staleClient = net.connect(gate.port, '127.0.0.1');
    t.after(() => staleClient.destroy());
    await new Promise((r) => staleClient.once('connect', r));
    const staleClosed = new Promise((resolve) => {
        staleClient.once('close', () => resolve(true));
        staleClient.on('error', () => {});
    });
    staleClient.write('STALE_LOCAL_TZ_BEACON');
    await new Promise((r) => setTimeout(r, 80));

    const { droppedCount } = gate.dropHeldAndRelease();
    assert.equal(droppedCount, 1);
    assert.equal(gate.isReleased(), true);
    assert.equal(await staleClosed, true);

    // Zero stale bytes may ever reach upstream
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(upstream.receivedChunks.length, 0);

    // New reloaded connection passes straight through
    const freshClient = net.connect(gate.port, '127.0.0.1');
    t.after(() => freshClient.destroy());
    await new Promise((r) => freshClient.once('connect', r));
    const freshEcho = new Promise((resolve) => {
        freshClient.once('data', (chunk) => resolve(chunk.toString('utf8')));
    });
    freshClient.write('FRESH_TARGET_TZ_BEACON');
    assert.equal(await freshEcho, 'ECHO:FRESH_TARGET_TZ_BEACON');
    assert.deepEqual(upstream.receivedChunks, ['FRESH_TARGET_TZ_BEACON']);
});

test('createProxyStartupGate defaults to Fail-Closed on timeout (drops held sockets, zero leak, blocks future traffic)', async (t) => {
    const upstream = await startEchoTcpServer();
    t.after(() => upstream.close());

    let abortedCallbackFired = false;
    const gate = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.port,
        maxHoldMs: 120,
        onTimeoutAbort: () => {
            abortedCallbackFired = true;
        },
    });
    t.after(() => gate.close());

    const client = net.connect(gate.port, '127.0.0.1');
    t.after(() => client.destroy());
    await new Promise((r) => client.once('connect', r));
    const clientClosed = new Promise((resolve) => {
        client.once('close', () => resolve(true));
        client.on('error', () => {});
    });
    client.write('MUST_NOT_LEAK_ON_TIMEOUT');

    assert.equal(await clientClosed, true);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(gate.isAborted(), true);
    assert.equal(gate.isReleased(), false);
    assert.equal(abortedCallbackFired, true);
    assert.equal(upstream.receivedChunks.length, 0);
    // Subsequent release() calls on an aborted gate must remain no-op
    assert.equal(gate.release(), 0);
    assert.equal(gate.isReleased(), false);
});

test('createProxyStartupGate supports optional release-on-timeout when failClosedOnTimeout=false', async (t) => {
    const upstream = await startEchoTcpServer();
    t.after(() => upstream.close());

    const gate = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.port,
        maxHoldMs: 120,
        failClosedOnTimeout: false,
    });
    t.after(() => gate.close());

    const client = net.connect(gate.port, '127.0.0.1');
    t.after(() => client.destroy());
    await new Promise((r) => client.once('connect', r));
    const echoPromise = new Promise((resolve) => {
        client.once('data', (chunk) => resolve(chunk.toString('utf8')));
    });
    client.write('SAFETY_RELEASE');

    const echoed = await echoPromise;
    assert.equal(echoed, 'ECHO:SAFETY_RELEASE');
    assert.equal(gate.isReleased(), true);
    assert.equal(gate.isAborted(), false);
});
