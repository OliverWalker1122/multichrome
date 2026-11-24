import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isAdvancedProxyUri,
    parseProxyUriToOutbound,
    redactProxyUri,
} from '../electron/domain/proxyUriParser.js';
import { buildSingboxConfig, redactConfig } from '../electron/domain/singboxConfig.js';
import { SingboxCore } from '../electron/drivers/singboxCore.js';
import { ProxyManager } from '../electron/services/proxyService.js';

const binaryPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../resources/sing-box',
    process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
);
const singboxAvailable = existsSync(binaryPath);
const realCore = new SingboxCore({ binaryPath });

const DUMMY_UUID = '11111111-1111-4111-8111-111111111111';
const DUMMY_UUID_2 = '22222222-2222-4222-8222-222222222222';
// Valid 32-byte base64url public key fixture (all zero bytes)
const DUMMY_PBK = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function createMockProxyManager() {
    const key = randomBytes(32);
    const values = new Map();
    const store = {
        path: 'fixture/managed-proxies.json',
        get: (name, fallback) => values.get(name) ?? fallback,
        set: (name, value) => values.set(name, structuredClone(value)),
    };
    const secretStorage = {
        isEncryptionAvailable: () => true,
        encryptString(value) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const encrypted = Buffer.concat([
                cipher.update(value, 'utf8'),
                cipher.final(),
            ]);
            return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
        },
        decryptString(value) {
            const decipher = createDecipheriv(
                'aes-256-gcm',
                key,
                value.subarray(0, 12),
            );
            decipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([
                decipher.update(value.subarray(28)),
                decipher.final(),
            ]).toString('utf8');
        },
    };
    const core = {
        getInfo: () => ({ version: '1.14.4', available: true }),
        check: async () => {},
    };
    return {
        manager: new ProxyManager({
            store,
            secretStorage,
            core,
            configDirectory: 'fixture',
        }),
        store,
    };
}

test('isAdvancedProxyUri detects supported share URI schemes only', () => {
    for (const uri of [
        `vless://${DUMMY_UUID}@example.com:443`,
        'vmess://eyJhZGQiOiJleGFtcGxlLmNvbSJ9',
        'trojan://pass@example.com:443',
        'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388',
        'hy2://pass@example.com:443',
        'HYSTERIA2://pass@example.com:443',
        `tuic://${DUMMY_UUID}:pass@example.com:443`,
    ]) {
        assert.equal(isAdvancedProxyUri(uri), true);
    }

    for (const simple of [
        'http://user:pass@198.51.100.1:8080',
        'https://198.51.100.1:443',
        'socks5://198.51.100.1:1080',
        '198.51.100.1:8080:user:pass',
        'not-a-uri',
        '',
    ]) {
        assert.equal(isAdvancedProxyUri(simple), false);
    }
});

test('parses vless:// URIs across tls, reality, none, and transports', () => {
    const reality = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@[2001:db8::1]:443?security=reality&sni=cdn.example.com&fp=chrome&pbk=${DUMMY_PBK}&sid=01ab&flow=xtls-rprx-vision&alpn=h2,http/1.1&type=tcp#US%20Reality%0A%00`,
    );
    assert.equal(reality.protocol, 'vless');
    assert.equal(reality.host, '2001:db8::1');
    assert.equal(reality.port, 443);
    assert.equal(reality.suggestedName, 'US Reality');
    assert.equal(reality.outbound.tag, 'proxy');
    assert.equal(reality.outbound.flow, 'xtls-rprx-vision');
    assert.deepEqual(reality.outbound.tls, {
        enabled: true,
        server_name: 'cdn.example.com',
        alpn: ['h2', 'http/1.1'],
        utls: { enabled: true, fingerprint: 'chrome' },
        reality: {
            enabled: true,
            public_key: DUMMY_PBK,
            short_id: '01ab',
        },
    });
    assert.equal(reality.outbound.transport, undefined);

    // Reality without explicit fp defaults uTLS fingerprint to chrome (required by sing-box)
    const realityDefaultFp = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@198.51.100.10:443?security=reality&sni=cdn.example.com&pbk=${DUMMY_PBK}`,
    );
    assert.deepEqual(realityDefaultFp.outbound.tls.utls, {
        enabled: true,
        fingerprint: 'chrome',
    });

    // WebSocket + TLS + allowInsecure
    const wsTls = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@example.com:8443?security=tls&sni=ws.example.com&allowInsecure=1&type=ws&host=cdn.example.com&path=%2Fws%3Fed%3D2048#WS%20Node`,
    );
    assert.equal(wsTls.outbound.tls.insecure, true);
    assert.deepEqual(wsTls.outbound.transport, {
        type: 'ws',
        path: '/ws?ed=2048',
        headers: { Host: 'cdn.example.com' },
    });

    // gRPC, HTTP/2, HTTPUpgrade, and security=none
    const grpc = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@example.com:443?security=tls&type=grpc&serviceName=my-grpc`,
    );
    assert.deepEqual(grpc.outbound.transport, {
        type: 'grpc',
        service_name: 'my-grpc',
    });

    const http2 = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@example.com:80?security=none&type=http&host=a.example.com,b.example.com&path=/h2`,
    );
    assert.equal(http2.outbound.tls, undefined);
    assert.deepEqual(http2.outbound.transport, {
        type: 'http',
        host: ['a.example.com', 'b.example.com'],
        path: '/h2',
    });

    const upgrade = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@example.com:443?security=tls&type=httpupgrade&host=up.example.com&path=/up`,
    );
    assert.deepEqual(upgrade.outbound.transport, {
        type: 'httpupgrade',
        host: 'up.example.com',
        path: '/up',
    });
});

test('parses vmess:// base64 and base64url JSON with remark truncation', () => {
    const longRemark = 'Node-' + 'X'.repeat(100);
    const vmessObj = {
        v: '2',
        ps: longRemark,
        add: 'example.com',
        port: '443',
        id: DUMMY_UUID,
        aid: '0',
        scy: 'aes-128-gcm',
        net: 'ws',
        type: 'none',
        host: 'ws.example.com',
        path: '/vmess',
        tls: 'tls',
        sni: 'sni.example.com',
        alpn: 'h2,http/1.1',
        fp: 'firefox',
    };
    const b64url = Buffer.from(JSON.stringify(vmessObj), 'utf8')
        .toString('base64url');
    const parsed = parseProxyUriToOutbound(`vmess://${b64url}`);
    assert.equal(parsed.protocol, 'vmess');
    assert.equal(parsed.host, 'example.com');
    assert.equal(parsed.port, 443);
    assert.equal(parsed.suggestedName.length, 80);
    assert.equal(parsed.outbound.security, 'aes-128-gcm');
    assert.equal(parsed.outbound.alter_id, 0);
    assert.deepEqual(parsed.outbound.tls, {
        enabled: true,
        server_name: 'sni.example.com',
        alpn: ['h2', 'http/1.1'],
        utls: { enabled: true, fingerprint: 'firefox' },
    });
    assert.deepEqual(parsed.outbound.transport, {
        type: 'ws',
        path: '/vmess',
        headers: { Host: 'ws.example.com' },
    });

    // Fragment overrides ps if present
    const b64std = Buffer.from(JSON.stringify(vmessObj), 'utf8').toString('base64');
    const withFrag = parseProxyUriToOutbound(`vmess://${b64std}#Override%20Name`);
    assert.equal(withFrag.suggestedName, 'Override Name');
});

test('parses trojan://, ss:// (SIP002, legacy, URL-encoded), hy2://, and tuic://', () => {
    const trojan = parseProxyUriToOutbound(
        'trojan://pass%3Aword%401@example.com:443?sni=tj.example.com&alpn=h2&fp=safari&type=ws&path=/tj#Trojan%201',
    );
    assert.equal(trojan.protocol, 'trojan');
    assert.equal(trojan.outbound.password, 'pass:word@1');
    assert.equal(trojan.outbound.tls.server_name, 'tj.example.com');
    assert.equal(trojan.outbound.tls.utls.fingerprint, 'safari');
    assert.equal(trojan.outbound.transport.path, '/tj');

    // SIP002 ss://base64(method:password)@host:port?plugin=...#name
    const ssAuthB64 = Buffer.from('aes-256-gcm:p@ss:word', 'utf8').toString('base64url');
    const ssSip002 = parseProxyUriToOutbound(
        `ss://${ssAuthB64}@198.51.100.20:8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dexample.com#SS-SIP002`,
    );
    assert.equal(ssSip002.protocol, 'shadowsocks');
    assert.equal(ssSip002.outbound.method, 'aes-256-gcm');
    assert.equal(ssSip002.outbound.password, 'p@ss:word');
    assert.equal(ssSip002.outbound.plugin, 'obfs-local');
    assert.equal(ssSip002.outbound.plugin_opts, 'obfs=http;obfs-host=example.com');
    assert.equal(ssSip002.suggestedName, 'SS-SIP002');

    // Legacy ss://base64(method:password@host:port)#name
    const ssLegacyB64 = Buffer.from(
        'chacha20-ietf-poly1305:sec@ret@[2001:db8::2]:8388',
        'utf8',
    ).toString('base64');
    const ssLegacy = parseProxyUriToOutbound(`ss://${ssLegacyB64}#SS-Legacy`);
    assert.equal(ssLegacy.outbound.method, 'chacha20-ietf-poly1305');
    assert.equal(ssLegacy.outbound.password, 'sec@ret');
    assert.equal(ssLegacy.outbound.server, '2001:db8::2');
    assert.equal(ssLegacy.outbound.server_port, 8388);

    // URL-encoded ss://method:password@host:port#name
    const ssPlain = parseProxyUriToOutbound(
        'ss://aes-128-gcm:p%40ss%25word@example.com:8388#SS-Plain',
    );
    assert.equal(ssPlain.outbound.method, 'aes-128-gcm');
    assert.equal(ssPlain.outbound.password, 'p@ss%word');

    // hy2:// & hysteria2://
    const hy2 = parseProxyUriToOutbound(
        'hy2://hy2-secret@example.com:8443?sni=hy2.example.com&alpn=h3&insecure=1&obfs=salamander&obfs-password=obfs-secret#Hy2',
    );
    assert.equal(hy2.protocol, 'hysteria2');
    assert.equal(hy2.outbound.server_port, 8443);
    assert.deepEqual(hy2.outbound.obfs, {
        type: 'salamander',
        password: 'obfs-secret',
    });
    assert.equal(hy2.outbound.tls.insecure, true);

    const hysteria2DefaultPort = parseProxyUriToOutbound(
        'hysteria2://hy2-secret@example.com?sni=hy2.example.com#Hy2Default',
    );
    assert.equal(hysteria2DefaultPort.port, 443);

    // tuic:// defaults
    const tuic = parseProxyUriToOutbound(
        `tuic://${DUMMY_UUID}:tuic-secret@example.com:443?sni=tuic.example.com&insecure=1#TUIC`,
    );
    assert.equal(tuic.protocol, 'tuic');
    assert.equal(tuic.outbound.congestion_control, 'bbr');
    assert.equal(tuic.outbound.udp_relay_mode, 'native');
    assert.deepEqual(tuic.outbound.tls.alpn, ['h3']);
    assert.equal(tuic.outbound.tls.insecure, true);
});

test('endpointKey stability and secret redaction across errors and sing-box configs', () => {
    const a = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@example.com:443?security=tls#NameA`,
    );
    const b = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID.toUpperCase()}@EXAMPLE.COM:443?security=tls#NameB`,
    );
    const c = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID_2}@example.com:443?security=tls#NameC`,
    );
    assert.equal(a.endpointKey, b.endpointKey);
    assert.notEqual(a.endpointKey, c.endpointKey);
    assert(!a.endpointKey.includes(DUMMY_UUID.toLowerCase()));

    // Redaction check on built sing-box config
    const reality = parseProxyUriToOutbound(
        `vless://${DUMMY_UUID}@example.com:443?security=reality&sni=example.com&pbk=${DUMMY_PBK}&sid=cafe#Test`,
    );
    const full = buildSingboxConfig(reality.config, 0);
    const redactedText = JSON.stringify(redactConfig(full));
    assert(!redactedText.includes(DUMMY_UUID));
    assert(!redactedText.includes(DUMMY_PBK));
    assert(!redactedText.includes('cafe'));

    // Error messages never echo secret tokens/passwords/UUIDs
    for (const badUri of [
        `vless://${DUMMY_UUID}@example.com:99999?security=reality&pbk=secret-pbk`,
        'vless://@example.com:443?security=tls',
        `vless://${DUMMY_UUID}@example.com:443?security=reality`,
        'trojan://super-secret-password@example.com:abc',
        'hy2://super-secret-password@example.com:443?obfs=salamander',
        'vmess://not-valid-base64-secret-payload',
        'ss://not-valid-base64',
        'tuic://invalid-uuid:super-secret@example.com:443',
    ]) {
        assert.throws(
            () => parseProxyUriToOutbound(badUri),
            (err) =>
                !err.message.includes('super-secret') &&
                !err.message.includes(DUMMY_UUID) &&
                !err.message.includes('secret-pbk'),
        );
    }

    // redactProxyUri masks credentials across schemed, schemeless, and malformed lines
    assert.equal(
        redactProxyUri(`vless://${DUMMY_UUID}@example.com:443?pbk=${DUMMY_PBK}#N`),
        'vless://***@example.com:443',
    );
    assert.equal(redactProxyUri('vmess://eyJhZGQiOiJzZWNyZXQifQ=='), 'vmess://[已隐藏]');
    assert.equal(
        redactProxyUri('vless://secret-uuid@:bad'),
        'vless://***@:bad',
    );
    assert.equal(
        redactProxyUri('alice:secretPass@bad-host:99999'),
        '***@bad-host:99999',
    );
    assert.equal(
        redactProxyUri('bad-host:99999:alice:secretPass'),
        'bad-host:99999:[已隐藏]',
    );
    assert.equal(
        redactProxyUri('bad-host:99999:alice'),
        'bad-host:99999:[已隐藏]',
    );
    assert.equal(
        redactProxyUri('[2001:db8::1]:99999:alice:secretPass'),
        '[2001:db8::1]:99999:[已隐藏]',
    );
    for (const rawInput of [
        'vless://secret-uuid@:bad',
        'alice:secretPass@bad-host:99999',
        'bad-host:99999:alice:secretPass',
    ]) {
        const redacted = redactProxyUri(rawInput);
        assert(!redacted.includes('secretPass'));
        assert(!redacted.includes('secret-uuid'));
        assert(!redacted.includes('alice'));
    }
});

test(
    'real SingboxCore.check accepts all 6 parsed URI protocols',
    { skip: !singboxAvailable },
    async () => {
        const vmessPayload = Buffer.from(
            JSON.stringify({
                v: '2',
                ps: 'VMess-Test',
                add: 'example.com',
                port: 443,
                id: DUMMY_UUID,
                aid: 0,
                scy: 'auto',
                net: 'ws',
                host: 'cdn.example.com',
                path: '/ws',
                tls: 'tls',
                sni: 'example.com',
                fp: 'chrome',
            }),
            'utf8',
        ).toString('base64url');

        const ssAuth = Buffer.from('aes-256-gcm:dummy-ss-pass', 'utf8').toString(
            'base64',
        );

        const uris = [
            `vless://${DUMMY_UUID}@example.com:443?security=reality&sni=example.com&pbk=${DUMMY_PBK}&sid=01ab&flow=xtls-rprx-vision#VLESS-Reality`,
            `vless://${DUMMY_UUID}@example.com:443?security=tls&sni=example.com&fp=chrome&type=ws&host=cdn.example.com&path=/ws#VLESS-WS`,
            `vless://${DUMMY_UUID}@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=svc#VLESS-gRPC`,
            `vless://${DUMMY_UUID}@example.com:443?security=tls&sni=example.com&type=httpupgrade&host=cdn.example.com&path=/up#VLESS-HTTPUpgrade`,
            `vmess://${vmessPayload}`,
            'trojan://dummy-trojan-pass@example.com:443?sni=example.com&alpn=h2&fp=chrome#Trojan',
            `ss://${ssAuth}@198.51.100.10:8388#SS`,
            'hy2://dummy-hy2-pass@example.com:443?sni=example.com&alpn=h3&obfs=salamander&obfs-password=dummy-obfs#Hy2',
            `tuic://${DUMMY_UUID}:dummy-tuic-pass@example.com:443?sni=example.com#TUIC`,
        ];

        for (const uri of uris) {
            const parsed = parseProxyUriToOutbound(uri);
            assert.notEqual(parsed.outbound.type, 'direct');
            await realCore.check(buildSingboxConfig(parsed.config, 0));
        }
    },
);

test('ProxyManager preserves simple mode for simple lines and encrypts advanced URIs as json mode', async () => {
    const { manager, store } = createMockProxyManager();

    const simpleSaved = await manager.save({
        name: 'SimpleSOCKS',
        mode: 'line',
        line: 'socks5://demo:secret@198.51.100.1:1080',
    });
    assert.equal(simpleSaved.mode, 'simple');
    assert.equal(manager.getEditor(simpleSaved.id).mode, 'simple');

    const vlessSaved = await manager.save({
        name: 'AdvancedVLESS',
        mode: 'line',
        line: `vless://${DUMMY_UUID}@198.51.100.2:443?security=reality&sni=cdn.example.com&pbk=${DUMMY_PBK}&sid=abcd#V1`,
    });
    assert.equal(vlessSaved.mode, 'json');
    assert.equal(vlessSaved.protocol, 'vless');
    assert.equal(vlessSaved.host, '198.51.100.2');
    assert.equal(vlessSaved.port, 443);
    assert.equal(manager.getEditor(vlessSaved.id).mode, 'json');

    const persisted = JSON.stringify(store.get('proxies'));
    assert(!persisted.includes(DUMMY_UUID));
    assert(!persisted.includes('198.51.100.2'));
    assert(!persisted.includes(DUMMY_PBK));

    assert(!JSON.stringify(vlessSaved).includes(DUMMY_UUID));
    assert(!manager.getConfig(vlessSaved.id).json.includes(DUMMY_UUID));
    assert(manager.getConfig(vlessSaved.id, true).json.includes(DUMMY_UUID));
});
