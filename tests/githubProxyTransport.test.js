import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import {
    assertOfficialGitHubUrl,
    createGitHubProxyAgent,
    isSafeExternalUrl,
    parseGitHubProxyUrl,
    parseSafeExternalUrl,
} from '../electron/githubProxyTransport.js';

test('assertOfficialGitHubUrl enforces HTTPS official GitHub allowlist', () => {
    assert.equal(
        assertOfficialGitHubUrl(
            'https://api.github.com/repos/OliverWalker1122/multichrome/releases/latest',
        ).hostname,
        'api.github.com',
    );
    assert.equal(
        assertOfficialGitHubUrl(
            'https://release-assets.githubusercontent.com/demo.zip',
        ).hostname,
        'release-assets.githubusercontent.com',
    );

    for (const bad of [
        'http://github.com/a/b',
        'https://github.com.evil.example/a/b',
        'https://example.com/file.zip',
        'file:///etc/passwd',
        'not-a-url',
    ]) {
        assert.throws(() => assertOfficialGitHubUrl(bad));
    }
});

test('parseSafeExternalUrl allows only HTTPS URLs and blocks dangerous OS schemes', () => {
    assert.equal(
        parseSafeExternalUrl('https://github.com/OliverWalker1122/multichrome'),
        'https://github.com/OliverWalker1122/multichrome',
    );
    assert.equal(isSafeExternalUrl('https://example.com/docs'), true);

    for (const unsafe of [
        'http://example.com',
        'file:///C:/Windows/System32/cmd.exe',
        'javascript:alert(1)',
        'ms-msdt:/id',
        'data:text/html,<h1>x</h1>',
        '',
        '   ',
    ]) {
        assert.equal(parseSafeExternalUrl(unsafe), null);
        assert.equal(isSafeExternalUrl(unsafe), false);
    }
});

test('parseGitHubProxyUrl parses HTTP/HTTPS/SOCKS5 proxies and rejects unsupported schemes', () => {
    assert.equal(parseGitHubProxyUrl(''), null);
    assert.equal(parseGitHubProxyUrl(undefined), null);

    const httpProxy = parseGitHubProxyUrl('http://alice:p%40ss@127.0.0.1:7890');
    assert.deepEqual(httpProxy, {
        protocol: 'http:',
        kind: 'http',
        host: '127.0.0.1',
        port: 7890,
        username: 'alice',
        password: 'p@ss',
    });

    const socksProxy = parseGitHubProxyUrl('socks5://127.0.0.1:1080');
    assert.equal(socksProxy.kind, 'socks5');
    assert.equal(socksProxy.port, 1080);

    const socksDefaultPort = parseGitHubProxyUrl('socks5h://user:pw@127.0.0.1');
    assert.equal(socksDefaultPort.kind, 'socks5');
    assert.equal(socksDefaultPort.port, 1080);
    assert.equal(socksDefaultPort.username, 'user');
    assert.equal(socksDefaultPort.password, 'pw');

    assert.throws(() => parseGitHubProxyUrl('ftp://127.0.0.1:21'));
    assert.throws(() => parseGitHubProxyUrl('not-a-proxy'));
});

test('SOCKS5 GitHub proxy connector performs auth, remote domain resolution (ATYP=0x03), and starts TLS', async (t) => {
    let capturedAuth = null;
    let capturedAtyp = null;
    let capturedHost = '';
    let capturedPort = 0;
    let sawTlsClientHello = false;

    const server = net.createServer((socket) => {
        let stage = 'greeting';
        let buf = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (stage === 'greeting') {
                if (buf.length < 2) return;
                const nMethods = buf[1];
                if (buf.length < 2 + nMethods) return;
                const methods = Array.from(buf.subarray(2, 2 + nMethods));
                buf = buf.subarray(2 + nMethods);
                assert.ok(methods.includes(0x02));
                stage = 'auth';
                socket.write(Buffer.from([0x05, 0x02]));
            }
            if (stage === 'auth') {
                if (buf.length < 2) return;
                const uLen = buf[1];
                if (buf.length < 2 + uLen + 1) return;
                const pLen = buf[2 + uLen];
                if (buf.length < 3 + uLen + pLen) return;
                const user = buf.subarray(2, 2 + uLen).toString('utf8');
                const pass = buf
                    .subarray(3 + uLen, 3 + uLen + pLen)
                    .toString('utf8');
                buf = buf.subarray(3 + uLen + pLen);
                capturedAuth = { user, pass };
                stage = 'connect';
                socket.write(Buffer.from([0x01, 0x00]));
            }
            if (stage === 'connect') {
                if (buf.length < 5) return;
                capturedAtyp = buf[3];
                const hostLen = buf[4];
                if (buf.length < 5 + hostLen + 2) return;
                capturedHost = buf.subarray(5, 5 + hostLen).toString('utf8');
                capturedPort = buf.readUInt16BE(5 + hostLen);
                buf = buf.subarray(5 + hostLen + 2);
                stage = 'tunnel';
                socket.write(
                    Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]),
                );
            }
            if (stage === 'tunnel' && buf.length > 0) {
                // TLS record content type 0x16 = Handshake (ClientHello)
                if (buf[0] === 0x16) {
                    sawTlsClientHello = true;
                }
                socket.destroy();
            }
        });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    const { port } = server.address();
    const agent = createGitHubProxyAgent(
        `socks5://demoUser:demoPass@127.0.0.1:${port}`,
    );

    await new Promise((resolve) => {
        agent.createConnection(
            { host: 'api.github.com', port: 443 },
            () => resolve(),
        );
    });
    agent.destroy();

    assert.deepEqual(capturedAuth, { user: 'demoUser', pass: 'demoPass' });
    assert.equal(capturedAtyp, 0x03);
    assert.equal(capturedHost, 'api.github.com');
    assert.equal(capturedPort, 443);
    assert.equal(sawTlsClientHello, true);
});
