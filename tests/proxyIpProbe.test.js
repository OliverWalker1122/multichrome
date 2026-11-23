import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
    probeProxyExitInfo,
    resolveProxyIPViaHttpProxy,
} from '../electron/proxyProbeClient.js';

for (const authenticated of [false, true]) {
    test(`生产 HTTP 出口探测${authenticated ? '有认证' : '无认证'}完整发送请求头并及时取得 IP`, async (t) => {
        const observations = [];
        const sockets = new Set();
        const expectedIP = '203.0.113.42';
        const server = http.createServer((request, response) => {
            observations.push({
                method: request.method,
                url: request.url,
                host: request.headers.host,
                authorization: request.headers['proxy-authorization'],
            });
            response.writeHead(200, {
                'Content-Type': 'text/plain',
                Connection: 'close',
            });
            response.end(`${expectedIP}\n`);
        });
        server.on('connection', (socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
        });
        t.after(async () => {
            for (const socket of sockets) socket.destroy();
            await new Promise((resolve) => server.close(resolve));
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const port = server.address().port;
        const credentials = authenticated
            ? { username: 'fixture-user', password: 'fixture-password' }
            : {};
        let timer;
        try {
            const ip = await Promise.race([
                resolveProxyIPViaHttpProxy(
                    { protocol: 'http:', host: '127.0.0.1', port, ...credentials },
                    { host: 'fixture.invalid', path: '/ip' },
                ),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    '本地代理未在 1500ms 内收到完整 HTTP 请求头并返回 IP',
                                ),
                            ),
                        1500,
                    );
                }),
            ]);
            assert.equal(ip, expectedIP);
            assert.deepEqual(observations, [
                {
                    method: 'GET',
                    url: 'http://fixture.invalid/ip',
                    host: 'fixture.invalid',
                    authorization: authenticated
                        ? `Basic ${Buffer.from('fixture-user:fixture-password').toString('base64')}`
                        : undefined,
                },
            ]);
        } finally {
            clearTimeout(timer);
        }
    });
}

test('probeProxyExitInfo (needTimezone) 优先仅并发 geo 节点，成功时不触发 IP-only 兜底请求', async (t) => {
    const seenHosts = [];
    const sockets = new Set();
    const server = http.createServer((request, response) => {
        const host = String(request.headers.host || '');
        seenHosts.push(host);
        if (host === 'geo-ok.invalid') {
            response.writeHead(200, {
                'Content-Type': 'application/json',
                Connection: 'close',
            });
            response.end(
                JSON.stringify({
                    query: '203.0.113.55',
                    timezone: 'America/La_Paz',
                    countryCode: 'BO',
                    country: 'Bolivia',
                }),
            );
            return;
        }
        response.writeHead(500, { Connection: 'close' });
        response.end('error');
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    const info = await probeProxyExitInfo(`http://127.0.0.1:${port}`, {
        needTimezone: true,
        geoTargets: [
            { host: 'geo-fail.invalid', path: '/json' },
            { host: 'geo-ok.invalid', path: '/json' },
        ],
        ipTargets: [{ host: 'ip-fallback.invalid', path: '/' }],
        timeoutMs: 1000,
    });

    assert.equal(info?.ip, '203.0.113.55');
    assert.equal(info?.timezone, 'America/La_Paz');
    assert.equal(info?.countryCode, 'BO');
    assert.equal(seenHosts.includes('ip-fallback.invalid'), false);
});

test('probeProxyExitInfo 在所有 geo 节点失败后回退 IP-only 节点，并支持高延迟自定义超时', async (t) => {
    const sockets = new Set();
    const timers = new Set();
    const server = http.createServer((request, response) => {
        const host = String(request.headers.host || '');
        if (host === 'geo-fail.invalid') {
            response.writeHead(502, { Connection: 'close' });
            response.end('bad gateway');
            return;
        }
        if (host === 'ip-slow.invalid') {
            const timer = setTimeout(() => {
                timers.delete(timer);
                if (response.destroyed || response.writableEnded) return;
                response.writeHead(200, {
                    'Content-Type': 'text/plain',
                    Connection: 'close',
                });
                response.end('203.0.113.88\n');
            }, 220);
            timers.add(timer);
            return;
        }
        response.writeHead(404, { Connection: 'close' });
        response.end('not found');
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    t.after(async () => {
        for (const timer of timers) clearTimeout(timer);
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    // Short timeout expires before the delayed proxy responds.
    const timedOut = await probeProxyExitInfo(`http://127.0.0.1:${port}`, {
        needTimezone: true,
        geoTargets: [{ host: 'geo-fail.invalid', path: '/json' }],
        ipTargets: [{ host: 'ip-slow.invalid', path: '/' }],
        timeoutMs: 80,
    });
    assert.equal(timedOut, null);

    // Generous timeout allows geo -> IP-only fallback to succeed.
    const recovered = await probeProxyExitInfo(`http://127.0.0.1:${port}`, {
        needTimezone: true,
        geoTargets: [{ host: 'geo-fail.invalid', path: '/json' }],
        ipTargets: [{ host: 'ip-slow.invalid', path: '/' }],
        timeoutMs: 1200,
    });
    assert.deepEqual(recovered, { ip: '203.0.113.88' });
});
