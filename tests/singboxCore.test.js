import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { SingboxCore, safeLog, stripAnsi } from '../electron/drivers/singboxCore.js';
import {
    buildSingboxConfig,
    simpleProxyToConfig,
} from '../electron/domain/singboxConfig.js';

const binaryPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../resources/sing-box',
    process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
);
const available = existsSync(binaryPath);
const core = new SingboxCore({ binaryPath });

async function unusedPort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

function request(port) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            {
                hostname: '127.0.0.1',
                port,
                path: 'http://fixture.invalid/private?demo=do-not-log',
                agent: false,
            },
            (response) => {
                let body = '';
                response.on('data', (chunk) => {
                    body += chunk;
                });
                response.on('end', () =>
                    resolve({ code: response.statusCode, body }),
                );
                response.on('error', reject);
            },
        );
        req.on('error', reject);
        req.setTimeout(3000, () => req.destroy(new Error('fixture timeout')));
    });
}

test('内核缺失以固定文案报错，不泄露传入配置', async () => {
    const missing = new SingboxCore({
        binaryPath: path.join(
            path.dirname(binaryPath),
            'not-installed-sing-box',
        ),
    });
    assert.equal(missing.getInfo().available, false);
    await assert.rejects(
        missing.check({ password: 'synthetic-secret' }),
        (error) => !error.message.includes('synthetic-secret'),
    );
});

test(
    '真实核心check接受HTTP SOCKS VLESS并拒绝非法配置且错误脱敏',
    { skip: !available },
    async () => {
        for (const protocol of ['http', 'https', 'socks5']) {
            await core.check(
                buildSingboxConfig(
                    simpleProxyToConfig({
                        protocol,
                        host: '127.0.0.1',
                        port: 32100,
                        username: 'fixture',
                        password: 'fixture-only',
                    }),
                    0,
                ),
            );
        }
        await core.check(
            buildSingboxConfig(
                {
                    type: 'vless',
                    server: 'example.invalid',
                    server_port: 443,
                    uuid: '11111111-1111-4111-8111-111111111111',
                    tls: { enabled: true, server_name: 'example.invalid' },
                },
                0,
            ),
        );
        await assert.rejects(
            core.check(
                buildSingboxConfig(
                    {
                        type: 'vless',
                        server: 'example.invalid',
                        server_port: 'SYNTHETIC-SECRET-INVALID',
                        uuid: '11111111-1111-4111-8111-111111111111',
                    },
                    0,
                ),
            ),
            (error) => !error.message.includes('SYNTHETIC'),
        );
    },
);

test(
    '真实核心通过stdin运行认证HTTP，日志脱敏，关闭释放监听且不直连',
    { skip: !available },
    async (t) => {
        const username = 'fixture-user';
        const password = 'fixture-only/p@ss:%?#';
        let received = 0;
        const sockets = new Set();
        const upstream = http.createServer((req, response) => {
            const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
            if (req.headers['proxy-authorization'] !== expected) {
                response.writeHead(407).end();
                return;
            }
            received++;
            response.end('through-singbox');
        });
        // sing-box deliberately uses CONNECT to an HTTP upstream even for an HTTP
        // destination. Keep the fake tunnel in-process: no destination DNS or dial.
        upstream.on('connect', (req, socket, head) => {
            const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
            if (req.headers['proxy-authorization'] !== expected) {
                socket.end(
                    'HTTP/1.1 407 Proxy Authentication Required\r\n\r\n',
                );
                return;
            }
            received++;
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            const reply = () =>
                socket.end(
                    'HTTP/1.1 200 OK\r\nContent-Length: 15\r\nConnection: close\r\n\r\nthrough-singbox',
                );
            if (head.length) reply();
            else socket.once('data', reply);
        });
        upstream.on('connection', (socket) => {
            sockets.add(socket);
            socket.on('error', () => {});
            socket.on('close', () => sockets.delete(socket));
        });
        upstream.listen(0, '127.0.0.1');
        await once(upstream, 'listening');
        t.after(async () => {
            for (const socket of sockets) socket.destroy();
            if (upstream.listening)
                await new Promise((resolve) => upstream.close(resolve));
        });
        const port = await unusedPort();
        const config = buildSingboxConfig(
            simpleProxyToConfig({
                protocol: 'http',
                host: '127.0.0.1',
                port: upstream.address().port,
                username,
                password,
            }),
            port,
        );
        await core.check(config);
        const logs = [];
        const exits = [];
        const process = await core.start(config, {
            onLog: (item) => logs.push(item),
            onExit: (item) => exits.push(item),
        });
        t.after(() => process.stop());
        assert.equal((await request(port)).body, 'through-singbox');
        assert.equal(received, 1);
        assert.equal(
            logs.some((item) => item.level === 'error'),
            false,
            `healthy startup/request must not emit false error logs: ${JSON.stringify(logs)}`,
        );
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => upstream.close(resolve));
        const failed = await request(port).catch(() => ({ code: 0 }));
        assert.notEqual(failed.code, 200);
        assert.equal(received, 1);
        await process.stop();
        await assert.rejects(request(port));
        assert.equal(exits.length, 1);
        assert.equal(exits[0].unexpected, false);
        const text = JSON.stringify(logs);
        for (const sensitive of [
            username,
            password,
            'private',
            'do-not-log',
            'Authorization',
        ])
            assert.ok(!text.includes(sensitive));
        assert.ok(logs.some((item) => item.message.includes('核心已就绪')));
    },
);

test(
    '真实核心不会将已被其他进程占用的端口误判成启动成功',
    { skip: !available },
    async (t) => {
        const occupied = net.createServer((socket) => socket.end());
        occupied.listen(0, '127.0.0.1');
        await once(occupied, 'listening');
        t.after(() => new Promise((resolve) => occupied.close(resolve)));
        const config = buildSingboxConfig(
            simpleProxyToConfig({
                protocol: 'http',
                host: '127.0.0.1',
                port: 9,
            }),
            occupied.address().port,
        );
        await assert.rejects(core.start(config));
    },
);

test(
    '真实核心SOCKS5认证与域名转发不依赖本地目标DNS',
    { skip: !available },
    async (t) => {
        const username = 'fixture-socks';
        const password = 'fixture-socks-only';
        const sockets = new Set();
        let authenticated = false;
        let requestedDomain;
        const upstream = net.createServer((socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            socket.on('error', () => {});
            let stage = 0;
            let buffer = Buffer.alloc(0);
            socket.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length) {
                    if (stage === 0) {
                        if (buffer.length < 2 || buffer.length < 2 + buffer[1])
                            return;
                        if (
                            buffer[0] !== 5 ||
                            !buffer.subarray(2, 2 + buffer[1]).includes(2)
                        ) {
                            socket.destroy();
                            return;
                        }
                        buffer = buffer.subarray(2 + buffer[1]);
                        socket.write(Buffer.from([5, 2]));
                        stage = 1;
                    } else if (stage === 1) {
                        if (buffer.length < 2 || buffer.length < 3 + buffer[1])
                            return;
                        const usernameLength = buffer[1];
                        const passwordLength = buffer[2 + usernameLength];
                        const total = 3 + usernameLength + passwordLength;
                        if (buffer.length < total) return;
                        authenticated =
                            buffer
                                .subarray(2, 2 + usernameLength)
                                .toString() === username &&
                            buffer
                                .subarray(3 + usernameLength, total)
                                .toString() === password;
                        buffer = buffer.subarray(total);
                        socket.write(Buffer.from([1, authenticated ? 0 : 1]));
                        if (!authenticated) {
                            socket.destroy();
                            return;
                        }
                        stage = 2;
                    } else if (stage === 2) {
                        if (buffer.length < 5) return;
                        if (buffer[3] !== 3) {
                            socket.destroy();
                            return;
                        }
                        const total = 7 + buffer[4];
                        if (buffer.length < total) return;
                        requestedDomain = buffer
                            .subarray(5, 5 + buffer[4])
                            .toString();
                        buffer = buffer.subarray(total);
                        socket.write(
                            Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]),
                        );
                        stage = 3;
                    } else {
                        if (!buffer.includes(Buffer.from('\r\n\r\n'))) return;
                        buffer = Buffer.alloc(0);
                        socket.end(
                            'HTTP/1.1 200 OK\r\nContent-Length: 15\r\nConnection: close\r\n\r\nthrough-singbox',
                        );
                    }
                }
            });
        });
        upstream.listen(0, '127.0.0.1');
        await once(upstream, 'listening');
        t.after(async () => {
            for (const socket of sockets) socket.destroy();
            await new Promise((resolve) => upstream.close(resolve));
        });
        const port = await unusedPort();
        const config = buildSingboxConfig(
            simpleProxyToConfig({
                protocol: 'socks5',
                host: '127.0.0.1',
                port: upstream.address().port,
                username,
                password,
            }),
            port,
        );
        await core.check(config);
        const runtime = await core.start(config);
        t.after(() => runtime.stop());
        assert.equal((await request(port)).body, 'through-singbox');
        assert.equal(authenticated, true);
        assert.equal(requestedDomain, 'fixture.invalid');
        await runtime.stop();
    },
);

test('safeLog 剥离 ANSI 颜色码并准确诊断 REALITY/TLS 错误且忽略本地保活断开噪音', () => {
    const realityLine =
        '+0800 2026-11-24 00:08:39 \u001b[31mERROR\u001b[0m [\u001b[38;5;115m1866514531\u001b[0m 258ms] connection: open connection to api.example.com:80 using outbound/vless[proxy]: reality verification failed';
    assert.equal(stripAnsi(realityLine).includes('\u001b['), false);
    const realityEntry = safeLog(realityLine);
    assert.equal(realityEntry?.level, 'error');
    assert.match(realityEntry?.message || '', /REALITY 握手校验失败/);
    assert.equal(realityEntry?.message.includes('api.example.com'), false);

    const tlsLine =
        '+0800 2026-11-24 00:08:40 \u001b[31mERROR\u001b[0m connection: tls: failed to verify certificate: x509: certificate signed by unknown authority';
    const tlsEntry = safeLog(tlsLine);
    assert.equal(tlsEntry?.level, 'error');
    assert.match(tlsEntry?.message || '', /TLS 握手失败/);

    const benignKeepAlive =
        '+0800 2026-11-24 01:46:52 \u001b[31mERROR\u001b[0m [3130443072 1.42s] inbound/http[multichrome-in]: process connection from 127.0.0.1:58341: read http request: read tcp 127.0.0.1:58339->127.0.0.1:58341: use of closed network connection';
    assert.equal(safeLog(benignKeepAlive), null);

    // Startup readiness probe & browser idle loopback disconnects must never poison proxy health
    const startupProbeEof =
        '+0800 2026-11-25 23:15:21 \u001b[31mERROR\u001b[0m [2111119535 0ms] inbound/http[multichrome-in]: process connection from 127.0.0.1:59399: read http request: EOF';
    assert.equal(safeLog(startupProbeEof), null);

    const localReset =
        '+0800 2026-11-25 23:15:22 \u001b[31mERROR\u001b[0m [2111119536 0ms] inbound/http[multichrome-in]: process connection from 127.0.0.1:59400: read http request: wsarecv: An existing connection was forcibly closed by the remote host.';
    assert.equal(safeLog(localReset), null);

    // Genuine outbound EOF must still be reported as an error so stale tunnels recycle
    const outboundEof =
        '+0800 2026-11-25 23:15:23 \u001b[31mERROR\u001b[0m [2111119537 400ms] connection: open connection to example.com:443 using outbound/http[proxy]: EOF';
    const outboundEofEntry = safeLog(outboundEof);
    assert.equal(outboundEofEntry?.level, 'error');
    assert.match(outboundEofEntry?.message || '', /代理连接中断或上游不可达/);

    // Per-destination upstream HTTP 403 policy rejection is a warning, not a broken tunnel error
    const target403 =
        '+0800 2026-11-25 23:13:02 \u001b[31mERROR\u001b[0m [3372473758 405ms] connection: open connection to tracker.example.invalid:443 using outbound/http[proxy]: unexpected status: 403 Forbidden';
    const target403Entry = safeLog(target403);
    assert.equal(target403Entry?.level, 'warn');
    assert.equal(target403Entry?.message, '上游代理拒绝了部分目标连接（HTTP 403）');
    assert.equal(target403Entry?.message.includes('tracker.example.invalid'), false);

    // Upstream proxy 407 authentication failure must remain an error
    const auth407 =
        '+0800 2026-11-25 23:13:03 \u001b[31mERROR\u001b[0m [3372473759 200ms] connection: open connection to example.com:443 using outbound/http[proxy]: unexpected status: 407 Proxy Authentication Required';
    const auth407Entry = safeLog(auth407);
    assert.equal(auth407Entry?.level, 'error');
    assert.match(auth407Entry?.message || '', /上游代理认证失败/);

    const coloredTarget =
        '+0800 2026-11-24 01:46:51 \u001b[36mINFO\u001b[0m [12345 0ms] outbound/vless[proxy]: outbound connection to example.com:443';
    assert.deepEqual(safeLog(coloredTarget), {
        level: 'info',
        message: '连接目标 example.com:443',
    });
});
