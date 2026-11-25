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
} from '../electron/drivers/proxyStartupGate.js';
import {
    isDbscAuthRefreshHost,
    normalizeTunnelWatchdogConfig,
    parseHttpConnectTarget,
    parseHttpProxyStatusCode,
    shouldEnableHttpConnectWatchdog,
} from '../electron/domain/proxyTunnelPolicy.js';

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

function startCustomTcpServer(onConnection) {
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        onConnection(socket);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
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

test('proxyTunnelPolicy parses CONNECT targets, proxy status codes, and DBSC auth refresh hosts', () => {
    assert.deepEqual(
        parseHttpConnectTarget(
            'CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443',
        ),
        { host: 'accounts.google.com', port: 443 },
    );
    assert.deepEqual(
        parseHttpConnectTarget('CONNECT [2001:db8::1]:443 HTTP/1.1'),
        { host: '2001:db8::1', port: 443 },
    );
    assert.equal(
        parseHttpConnectTarget('GET http://example.com/ HTTP/1.1'),
        null,
    );
    assert.equal(
        parseHttpProxyStatusCode('HTTP/1.1 200 Connection Established\r\n'),
        200,
    );
    assert.equal(
        parseHttpProxyStatusCode('HTTP/1.1 407 Proxy Authentication Required'),
        407,
    );
    assert.equal(isDbscAuthRefreshHost('accounts.google.com'), true);
    assert.equal(isDbscAuthRefreshHost('ACCOUNTS.YOUTUBE.COM.'), true);
    assert.equal(isDbscAuthRefreshHost('mail.google.com'), false);
    assert.equal(isDbscAuthRefreshHost('claude.ai'), false);
    assert.equal(shouldEnableHttpConnectWatchdog('http://127.0.0.1:43210'), true);
    assert.equal(shouldEnableHttpConnectWatchdog('proxy.example.com:8080'), true);
    assert.equal(shouldEnableHttpConnectWatchdog('https://proxy.example.com:443'), false);
    assert.equal(shouldEnableHttpConnectWatchdog('socks5://127.0.0.1:1080'), false);
    assert.equal(normalizeTunnelWatchdogConfig(false), null);
    assert.equal(normalizeTunnelWatchdogConfig(true)?.dbscResponseTimeoutMs, 25_000);
});

test('tunnelWatchdog terminates stalled CONNECT and TLS handshakes when upstream gateway stays TCP-alive', async (t) => {
    // 1. Upstream accepts TCP and swallows CONNECT forever (never replies 200)
    const blackholeConnect = await startCustomTcpServer(() => {});
    t.after(() => blackholeConnect.close());

    const gate1 = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: blackholeConnect.port,
        holdOnStart: false,
        maxHoldMs: 0,
        tunnelWatchdog: {
            connectHandshakeTimeoutMs: 100,
            tlsHandshakeTimeoutMs: 100,
            dbscResponseTimeoutMs: 150,
            dbscIdleTimeoutMs: 500,
        },
    });
    t.after(() => gate1.close());
    assert.equal(gate1.isReleased(), true);

    const c1 = net.connect(gate1.port, '127.0.0.1');
    t.after(() => c1.destroy());
    await new Promise((r) => c1.once('connect', r));
    const c1Closed = new Promise((r) => {
        c1.once('close', () => r(true));
        c1.on('error', () => {});
    });
    c1.write('CONNECT mail.google.com:443 HTTP/1.1\r\nHost: mail.google.com:443\r\n\r\n');
    assert.equal(await c1Closed, true);
    assert.equal(gate1.getStats().watchdogReasons.connect_handshake_timeout, 1);

    // 2. Upstream returns 200 Connection Established, then stalls TLS ServerHello forever
    const blackholeTls = await startCustomTcpServer((sock) => {
        let replied = false;
        sock.on('data', () => {
            if (!replied) {
                replied = true;
                sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            }
        });
    });
    t.after(() => blackholeTls.close());

    const gate2 = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: blackholeTls.port,
        holdOnStart: false,
        maxHoldMs: 0,
        tunnelWatchdog: {
            connectHandshakeTimeoutMs: 500,
            tlsHandshakeTimeoutMs: 100,
            dbscResponseTimeoutMs: 500,
            dbscIdleTimeoutMs: 1000,
        },
    });
    t.after(() => gate2.close());

    const c2 = net.connect(gate2.port, '127.0.0.1');
    t.after(() => c2.destroy());
    await new Promise((r) => c2.once('connect', r));
    const c2Closed = new Promise((r) => {
        c2.once('close', () => r(true));
        c2.on('error', () => {});
    });
    const got200 = new Promise((r) => c2.once('data', (d) => r(d.toString('latin1'))));
    c2.write('CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443\r\n\r\n');
    assert.match(await got200, /^HTTP\/1\.1 200 /);
    c2.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x20, ...Array(32).fill(0xaa)]));
    assert.equal(await c2Closed, true);
    assert.equal(gate2.getStats().watchdogReasons.tls_handshake_timeout, 1);
});

test('tunnelWatchdog unblocks stalled DBSC auth-refresh requests and recycles idle DBSC tunnels without affecting non-DBSC long-polling hosts', async (t) => {
    let stage = 'connect';
    const upstream = await startCustomTcpServer((sock) => {
        let localStage = 'connect';
        let reqCount = 0;
        sock.on('data', (chunk) => {
            const text = chunk.toString('latin1');
            if (localStage === 'connect' && text.includes('\r\n\r\n')) {
                localStage = 'tls';
                sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                return;
            }
            if (localStage === 'tls') {
                localStage = 'tunnel';
                sock.write(Buffer.from('SERVER_HELLO_OK'));
                return;
            }
            reqCount += 1;
            if (stage === 'stall_second_dbsc_req') {
                if (reqCount === 1) {
                    sock.write(Buffer.from('FIRST_ROTATE_OK'));
                }
                // 2nd request stalls forever while socket stays TCP-alive
                return;
            }
            if (stage === 'slow_non_dbsc_long_poll') {
                setTimeout(() => {
                    if (!sock.destroyed) sock.write(Buffer.from('LONG_POLL_EVENT'));
                }, 260);
            }
        });
    });
    t.after(() => upstream.close());

    const gate = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.port,
        holdOnStart: false,
        maxHoldMs: 0,
        tunnelWatchdog: {
            connectHandshakeTimeoutMs: 500,
            tlsHandshakeTimeoutMs: 500,
            dbscResponseTimeoutMs: 120,
            dbscIdleTimeoutMs: 180,
            minResponseTriggerBytes: 64,
        },
    });
    t.after(() => gate.close());

    // Case 1: accounts.google.com 1st request succeeds, tiny H2 control ACK (<64B) does NOT trigger response timeout,
    // then 2nd request (>=64B) stalls -> terminated by dbsc_response_timeout
    stage = 'stall_second_dbsc_req';
    const dbscClient = net.connect(gate.port, '127.0.0.1');
    t.after(() => dbscClient.destroy());
    await new Promise((r) => dbscClient.once('connect', r));
    const dbscClosed = new Promise((r) => {
        dbscClient.once('close', () => r(true));
        dbscClient.on('error', () => {});
    });

    const nextChunk = (sock) => new Promise((r) => sock.once('data', (d) => r(d.toString('latin1'))));
    dbscClient.write('CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443\r\n\r\n');
    assert.match(await nextChunk(dbscClient), /^HTTP\/1\.1 200 /);
    dbscClient.write(Buffer.from('CLIENT_HELLO'));
    assert.equal(await nextChunk(dbscClient), 'SERVER_HELLO_OK');
    dbscClient.write(Buffer.alloc(128, 0x41));
    assert.equal(await nextChunk(dbscClient), 'FIRST_ROTATE_OK');
    // Small H2 WINDOW_UPDATE (32B < 64B) followed quickly by real stalled POST /RotateBoundCookies (256B)
    dbscClient.write(Buffer.alloc(32, 0x01));
    await new Promise((r) => setTimeout(r, 30));
    dbscClient.write(Buffer.alloc(256, 0x42));
    assert.equal(await dbscClosed, true);
    assert.equal(gate.getStats().watchdogReasons.dbsc_response_timeout, 1);

    // Case 2: idle accounts.youtube.com tunnel is cleanly recycled after dbscIdleTimeoutMs
    stage = 'idle_only';
    const idleClient = net.connect(gate.port, '127.0.0.1');
    t.after(() => idleClient.destroy());
    await new Promise((r) => idleClient.once('connect', r));
    const idleClosed = new Promise((r) => {
        idleClient.once('close', () => r(true));
        idleClient.on('error', () => {});
    });
    idleClient.write('CONNECT accounts.youtube.com:443 HTTP/1.1\r\nHost: accounts.youtube.com:443\r\n\r\n');
    assert.match(await nextChunk(idleClient), /^HTTP\/1\.1 200 /);
    idleClient.write(Buffer.from('CLIENT_HELLO'));
    assert.equal(await nextChunk(idleClient), 'SERVER_HELLO_OK');
    assert.equal(await idleClosed, true);
    assert.equal(gate.getStats().watchdogReasons.dbsc_idle_recycle, 1);

    // Case 3: non-DBSC host (mail.google.com) waiting > dbscResponseTimeoutMs & > dbscIdleTimeoutMs stays alive!
    stage = 'slow_non_dbsc_long_poll';
    const mailClient = net.connect(gate.port, '127.0.0.1');
    t.after(() => mailClient.destroy());
    await new Promise((r) => mailClient.once('connect', r));
    mailClient.write('CONNECT mail.google.com:443 HTTP/1.1\r\nHost: mail.google.com:443\r\n\r\n');
    assert.match(await nextChunk(mailClient), /^HTTP\/1\.1 200 /);
    mailClient.write(Buffer.from('CLIENT_HELLO'));
    assert.equal(await nextChunk(mailClient), 'SERVER_HELLO_OK');
    mailClient.write(Buffer.alloc(256, 0x43));
    assert.equal(await nextChunk(mailClient), 'LONG_POLL_EVENT');
    assert.equal(gate.getStats().watchdogTerminatedCount, 2);
});

test('tunnelWatchdog transparently passes through non-HTTP binary protocols like SOCKS5', async (t) => {
    const upstream = await startEchoTcpServer();
    t.after(() => upstream.close());

    const gate = await createProxyStartupGate({
        upstreamHost: '127.0.0.1',
        upstreamPort: upstream.port,
        holdOnStart: false,
        maxHoldMs: 0,
        tunnelWatchdog: {
            connectHandshakeTimeoutMs: 80,
            tlsHandshakeTimeoutMs: 80,
            dbscResponseTimeoutMs: 80,
            dbscIdleTimeoutMs: 80,
        },
    });
    t.after(() => gate.close());

    const client = net.connect(gate.port, '127.0.0.1');
    t.after(() => client.destroy());
    await new Promise((r) => client.once('connect', r));
    const reply = new Promise((r) => client.once('data', (d) => r(d)));
    client.write(Buffer.from([0x05, 0x01, 0x00]));
    const echoed = await reply;
    assert.ok(echoed.toString('latin1').startsWith('ECHO:'));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(client.destroyed, false);
    assert.equal(gate.getStats().watchdogTerminatedCount, 0);
});
