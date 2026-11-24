import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
    buildProxyEndpointKey,
    buildProxyUsageMap,
    parseBatchProxyText,
} from '../electron/domain/proxyBatch.js';
import { ProxyManager } from '../electron/services/proxyService.js';

const DUMMY_UUID = '11111111-1111-4111-8111-111111111111';
const DUMMY_UUID_2 = '22222222-2222-4222-8222-222222222222';
const DUMMY_PBK = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function createBatchTestManager() {
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

test('parseBatchProxyText parses mixed lines, named lines, comments, and flags duplicates', () => {
    const input = [
        '# 美国住宅代理',
        '美西-1 | socks5://user1:pass1@1.2.3.4:1080',
        '2.3.4.5:8080:alice:secret',
        'http://user1:pass1@1.2.3.4:1080',
        'socks5://user1:pass1@1.2.3.4:1080', // duplicate of line 2
        'ftp://1.2.3.4:21',
        '',
        '// 忽略注释',
        '美东\thttps://proxy.example.com:443',
    ].join('\n');

    const existingKey = buildProxyEndpointKey({
        protocol: 'http',
        host: '2.3.4.5',
        port: 8080,
        username: 'alice',
    });

    const result = parseBatchProxyText(input, {
        namePrefix: '批量代理',
        existingKeys: [existingKey],
    });

    assert.equal(result.items.length, 5);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].lineNumber, 6);

    assert.equal(result.items[0].name, '美西-1');
    assert.equal(result.items[0].duplicate, false);

    assert.equal(result.items[1].name, '批量代理-2');
    assert.equal(result.items[1].duplicate, true); // matched existingKey

    assert.equal(result.items[2].name, '批量代理-3');
    assert.equal(result.items[2].duplicate, false); // http vs socks5

    assert.equal(result.items[3].duplicate, true); // duplicated within batch

    assert.equal(result.items[4].name, '美东');
    assert.equal(result.items[4].simple.protocol, 'https');
    assert.equal(result.items[4].duplicate, false);
});

test('buildProxyUsageMap groups environments by proxyId for duplicate reminders', () => {
    const map = buildProxyUsageMap([
        { id: 'e1', name: '环境A', groupName: '默认', proxyId: 'p1', isRunning: true },
        { id: 'e2', name: '环境B', groupName: '默认', proxyId: 'p1', isRunning: false },
        { id: 'e3', name: '环境C', groupName: '默认', proxyId: 'p2', isRunning: false },
        { id: 'e4', name: '环境D', groupName: '默认', isRunning: false },
    ]);

    assert.equal(map.get('p1').length, 2);
    assert.equal(map.get('p2').length, 1);
    assert.equal(map.has('p3'), false);
});

test('parseBatchProxyText supports advanced share URIs, #remark naming, explicit name override, and secret redaction', () => {
    const vmessB64 = Buffer.from(
        JSON.stringify({
            v: '2',
            ps: 'VMess-Tokyo',
            add: '198.51.100.11',
            port: 443,
            id: DUMMY_UUID,
            aid: 0,
            scy: 'auto',
            net: 'ws',
            tls: 'tls',
        }),
        'utf8',
    ).toString('base64url');
    const ssB64 = Buffer.from('aes-256-gcm:dummy-ss-pass', 'utf8').toString(
        'base64',
    );

    const input = [
        `vless://${DUMMY_UUID}@198.51.100.10:443?security=reality&sni=cdn.example.com&pbk=${DUMMY_PBK}#US%20Reality`,
        `Custom-VMess | vmess://${vmessB64}`,
        'trojan://dummy-trojan-pass@198.51.100.12:443?sni=tj.example.com',
        `ss://${ssB64}@198.51.100.13:8388#SG-SS`,
        'hy2://dummy-hy2-pass@198.51.100.14:443?sni=hy2.example.com#JP-Hy2',
        `tuic://${DUMMY_UUID}:dummy-tuic-pass@198.51.100.15:443?sni=tuic.example.com#HK-TUIC`,
        `vless://${DUMMY_UUID}@198.51.100.10:443?security=tls#Duplicate-VLESS`,
        `vless://${DUMMY_UUID_2}@198.51.100.10:443?security=tls#Second-User`,
        `vless://${DUMMY_UUID}@198.51.100.10:99999?security=reality&pbk=secret-pbk#BadPort`,
    ].join('\n');

    const result = parseBatchProxyText(input, { namePrefix: '节点' });
    assert.equal(result.items.length, 8);
    assert.equal(result.errors.length, 1);

    assert.equal(result.items[0].name, 'US Reality');
    assert.equal(result.items[0].mode, 'json');
    assert.equal(result.items[0].protocol, 'vless');
    assert.equal(result.items[0].duplicate, false);

    // Explicit "Name | uri" overrides JSON ps remark
    assert.equal(result.items[1].name, 'Custom-VMess');
    assert.equal(result.items[1].protocol, 'vmess');

    // No explicit name & no #remark falls back to prefix-validIndex
    assert.equal(result.items[2].name, '节点-3');
    assert.equal(result.items[2].protocol, 'trojan');

    assert.equal(result.items[3].name, 'SG-SS');
    assert.equal(result.items[3].protocol, 'shadowsocks');

    assert.equal(result.items[4].name, 'JP-Hy2');
    assert.equal(result.items[4].protocol, 'hysteria2');

    assert.equal(result.items[5].name, 'HK-TUIC');
    assert.equal(result.items[5].protocol, 'tuic');

    // Same UUID + host + port is duplicate even with different #remark
    assert.equal(result.items[6].duplicate, true);
    // Different UUID on same host + port is NOT duplicate
    assert.equal(result.items[7].duplicate, false);

    // Error line redacts UUID and query secrets
    assert.equal(result.errors[0].lineNumber, 9);
    assert(!result.errors[0].raw.includes(DUMMY_UUID));
    assert(!result.errors[0].raw.includes('secret-pbk'));
    assert(!result.errors[0].error.includes(DUMMY_UUID));
});

test('ProxyManager.batchImport deduplicates across existing simple and json records and encrypts all entries', async () => {
    const { manager, store } = createBatchTestManager();

    // Seed an existing simple proxy and an existing json VLESS proxy
    await manager.save({
        name: 'Existing-Simple',
        protocol: 'http',
        host: '198.51.100.1',
        port: 8080,
        username: 'u1',
        password: 'p1',
    });
    await manager.save({
        name: 'Existing-JSON-VLESS',
        mode: 'json',
        config: JSON.stringify({
            type: 'vless',
            server: '198.51.100.2',
            server_port: 443,
            uuid: DUMMY_UUID,
            tls: { enabled: true, server_name: 'cdn.example.com' },
        }),
    });

    const batchText = [
        'http://u1:p1@198.51.100.1:8080', // dup of existing simple
        `vless://${DUMMY_UUID}@198.51.100.2:443?security=tls#DupExistingVLESS`, // dup of existing json
        `vless://${DUMMY_UUID_2}@198.51.100.2:443?security=tls#NewVLESS`, // new UUID
        'trojan://dummy-pass@198.51.100.3:443?sni=tj.example.com#NewTrojan',
        'socks5://u2:p2@198.51.100.4:1080',
    ].join('\n');

    const result = await manager.batchImport({
        text: batchText,
        namePrefix: 'Batch',
        skipDuplicates: true,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.skippedDuplicates.length, 2);
    assert.equal(result.skippedDuplicates[0].host, '198.51.100.1');
    assert.equal(result.skippedDuplicates[1].host, '198.51.100.2');
    assert.equal(result.skippedDuplicates[1].port, 443);

    assert.equal(result.imported.length, 3);
    assert.equal(result.imported[0].name, 'NewVLESS');
    assert.equal(result.imported[0].mode, 'json');
    assert.equal(result.imported[0].protocol, 'vless');

    assert.equal(result.imported[1].name, 'NewTrojan');
    assert.equal(result.imported[1].mode, 'json');
    assert.equal(result.imported[1].protocol, 'trojan');

    assert.equal(result.imported[2].name, 'Batch-5');
    assert.equal(result.imported[2].mode, 'simple');
    assert.equal(result.imported[2].protocol, 'socks5');

    // Persisted store must contain zero plaintext hosts, passwords, or UUIDs
    const persisted = JSON.stringify(store.get('proxies'));
    assert(!persisted.includes(DUMMY_UUID));
    assert(!persisted.includes(DUMMY_UUID_2));
    assert(!persisted.includes('dummy-pass'));
    assert(!persisted.includes('198.51.100.2'));
    assert(!persisted.includes('198.51.100.3'));
});

test('parseBatchProxyText redacts schemeless and malformed credentials in error output', () => {
    const badLines = [
        'bad-host:99999:alice:secretPass',
        'alice:secretPass@bad-host:99999',
        'vless://secret-uuid@:bad',
    ].join('\n');

    const result = parseBatchProxyText(badLines, { namePrefix: 'Node' });
    assert.equal(result.items.length, 0);
    assert.equal(result.errors.length, 3);

    for (const err of result.errors) {
        assert(!err.raw.includes('secretPass'));
        assert(!err.raw.includes('secret-uuid'));
        assert(!err.raw.includes('alice'));
        assert(!err.error.includes('secretPass'));
        assert(!err.error.includes('secret-uuid'));
    }
    assert.equal(result.errors[0].raw, 'bad-host:99999:[已隐藏]');
    assert.equal(result.errors[1].raw, '***@bad-host:99999');
    assert.equal(result.errors[2].raw, 'vless://***@:bad');
});
