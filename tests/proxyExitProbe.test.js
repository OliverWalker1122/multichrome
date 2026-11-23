import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import {
    createProxyExitProbe,
    parseExitInfo,
    probeProxyExit,
} from '../electron/proxyExitProbe.js';

const EXIT = {
    success: true,
    ip: '203.0.113.22',
    country: '美国',
    country_code: 'US',
    region: '加利福尼亚州',
    city: '洛杉矶',
};

async function proxyFixture(t, onConnect) {
    const server = http.createServer();
    const sockets = new Set();
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    server.on('connect', onConnect);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    });
    return `http://127.0.0.1:${server.address().port}`;
}

function plaintextTlsFixture(check = () => {}) {
    return createProxyExitProbe({
        connectTls(options, callback) {
            check(options);
            queueMicrotask(callback);
            return options.socket;
        },
    });
}

test('lookup travels through a loopback CONNECT tunnel with fixed HTTPS identity and no credentials', async (t) => {
    let connectRequests = 0;
    let lookupRequests = 0;
    const proxy = await proxyFixture(t, (request, socket) => {
        connectRequests++;
        assert.equal(request.url, 'ipwho.is:443');
        assert.equal(request.headers['proxy-authorization'], undefined);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        socket.once('data', (chunk) => {
            lookupRequests++;
            const requestText = chunk.toString('utf8');
            assert.match(
                requestText,
                /^GET \/\?fields=success,ip,country,country_code,region,city&lang=zh-CN HTTP\/1.1/,
            );
            assert.match(requestText, /Host: ipwho.is\r\n/i);
            assert(!/authorization:/i.test(requestText));
            const body = JSON.stringify(EXIT);
            socket.end(
                `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
            );
        });
    });
    const probe = plaintextTlsFixture((options) => {
        assert.equal(options.servername, 'ipwho.is');
        assert.equal(options.rejectUnauthorized, true);
        assert.deepEqual(options.ALPNProtocols, ['http/1.1']);
    });
    assert.deepEqual(await probe(proxy), {
        ip: EXIT.ip,
        country: EXIT.country,
        countryCode: EXIT.country_code,
        region: EXIT.region,
        city: EXIT.city,
    });
    assert.equal(connectRequests, 1);
    assert.equal(lookupRequests, 1);
});

test('CONNECT rejection fails without any direct TLS connection or raw server error', async (t) => {
    let tlsCalls = 0;
    let proxyCalls = 0;
    const proxy = await proxyFixture(t, (_request, socket) => {
        proxyCalls++;
        socket.end(
            'HTTP/1.1 407 upstream-fixture-private-error\r\nContent-Length: 0\r\n\r\n',
        );
    });
    const probe = createProxyExitProbe({
        connectTls() {
            tlsCalls++;
            throw new Error('must not connect directly');
        },
    });
    await assert.rejects(probe(proxy), { message: '出口检测失败，请稍后重试' });
    assert.equal(proxyCalls, 1);
    assert.equal(tlsCalls, 0);
});

test('lookup rejects redirects, oversized bodies and invalid payloads', async (t) => {
    for (const [status, body] of [
        [302, ''],
        [200, 'x'.repeat(33 * 1024)],
        [
            200,
            JSON.stringify({
                success: false,
                message: 'upstream-fixture-private-error',
            }),
        ],
        [200, JSON.stringify({ ...EXIT, ip: 'not-an-ip' })],
    ]) {
        const proxy = await proxyFixture(t, (_request, socket) => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            socket.once('data', () => {
                socket.end(
                    `HTTP/1.1 ${status} fixture\r\nLocation: https://example.test/\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
                );
            });
        });
        await assert.rejects(plaintextTlsFixture()(proxy), {
            message: '出口检测失败，请稍后重试',
        });
    }
});

test('lookup can be cancelled and times out even when CONNECT never replies', async (t) => {
    let notifyConnected;
    const connected = new Promise((resolve) => {
        notifyConnected = resolve;
    });
    const proxy = await proxyFixture(t, () => notifyConnected());
    const controller = new AbortController();
    const lookup = probeProxyExit(proxy, { signal: controller.signal });
    await connected;
    controller.abort();
    await assert.rejects(lookup, {
        name: 'AbortError',
        message: '出口检测已取消',
    });
    await assert.rejects(probeProxyExit(proxy, { timeoutMs: 30 }), {
        message: '出口检测失败，请稍后重试',
    });
});

test('only a bare numeric loopback HTTP proxy is accepted and geolocation text is bounded', async () => {
    for (const address of [
        'http://example.test:8080',
        'http://localhost:8080',
        'https://127.0.0.1:8080',
        'http://fixture:password@127.0.0.1:8080',
        'http://127.0.0.1:8080/?target=example.test',
    ])
        await assert.rejects(probeProxyExit(address), /出口检测失败/);
    const parsed = parseExitInfo({
        ...EXIT,
        ip: '2001:db8::1',
        country: '\u0000' + '国'.repeat(200),
        country_code: 'invalid',
        city: null,
    });
    assert.equal(parsed.country.length, 120);
    assert.equal(parsed.countryCode, '');
    assert.equal(parsed.city, '');
});

test('supports en-US locale and falls back to ipinfo.io over same loopback HTTPS tunnel on upstream 429/503', async (t) => {
    const requestedHosts = [];
    const requestedPaths = [];
    const proxy = await proxyFixture(t, (request, socket) => {
        requestedHosts.push(request.url);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        socket.once('data', (chunk) => {
            const firstLine = chunk.toString('utf8').split('\r\n')[0];
            requestedPaths.push(firstLine);
            if (request.url === 'ipwho.is:443') {
                socket.end(
                    'HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
                );
                return;
            }
            const body = JSON.stringify({
                ip: '198.51.100.42',
                country: 'JP',
                region: 'Tokyo',
                city: 'Minato',
            });
            socket.end(
                `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
            );
        });
    });

    const tlsHosts = [];
    const probe = plaintextTlsFixture((options) => {
        tlsHosts.push(options.servername);
        assert.equal(options.rejectUnauthorized, true);
    });

    const result = await probe(proxy, { locale: 'en-US' });
    assert.deepEqual(requestedHosts, ['ipwho.is:443', 'ipinfo.io:443']);
    assert.deepEqual(tlsHosts, ['ipwho.is', 'ipinfo.io']);
    assert.match(requestedPaths[0], /lang=en HTTP\/1\.1$/);
    assert.match(requestedPaths[1], /^GET \/json HTTP\/1\.1$/);
    assert.deepEqual(result, {
        ip: '198.51.100.42',
        country: 'JP',
        countryCode: 'JP',
        region: 'Tokyo',
        city: 'Minato',
    });
});
