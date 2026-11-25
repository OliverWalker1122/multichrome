import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countSharedProfileDirectories, reserveProfileDirectory } from '../electron/drivers/profileDirectory.js';
import { AutomationConfigRepository } from '../electron/repositories/automationConfigRepository.js';
import { createProxyAddressStorage } from '../electron/repositories/proxyAddressStorage.js';
import { ProxyCoordinator } from '../electron/services/proxyCoordinator.js';
import { validateProfileAction } from '../electron/domain/automationPolicy.js';
import { createMcpHandler } from '../electron/transport/mcpServer.js';
import { validateTransport, requestHeaders, MODERN_MCP_VERSION } from '../electron/domain/mcpProtocol.js';

function fakeStorage() {
    const values = new Map();
    return {
        isEncryptionAvailable: () => true,
        encryptString(value) {
            const key = String(values.size);
            values.set(key, value);
            return Buffer.from(key);
        },
        decryptString(buffer) {
            const value = values.get(buffer.toString());
            if (!value) throw new Error('Test storage unavailable');
            return value;
        },
    };
}

test('a cold automation repository restores the same saved token once secure storage is ready', () => {
    const secretStorage = fakeStorage();
    let saved;
    const store = { get: () => saved, set: (_, next) => { saved = next; } };
    const original = new AutomationConfigRepository({ store, secretStorage }).getToken();
    secretStorage.isEncryptionAvailable = () => false;
    const repo = new AutomationConfigRepository({ store, secretStorage });
    const originalRecord = saved;
    assert.throws(() => repo.getToken());
    assert.equal(saved, originalRecord);
    secretStorage.isEncryptionAvailable = () => true;
    assert.ok(original === repo.getToken());
    assert.equal(saved, originalRecord);
});

test('proxy addresses migrate only on a successful encrypted write and read correctly after restart', () => {
    const storage = fakeStorage();
    const original = 'https://proxy.example.invalid';
    let stored = original;
    const first = createProxyAddressStorage(storage);
    storage.isEncryptionAvailable = () => false;
    assert.equal(first.open('demo', stored), original);
    assert.throws(() => first.seal('demo', original));
    assert.equal(stored, original);
    storage.isEncryptionAvailable = () => true;
    stored = first.seal('demo', original);
    assert.ok(!stored.includes(original));
    const second = createProxyAddressStorage(storage);
    assert.equal(second.open('demo', stored), original);
    storage.isEncryptionAvailable = () => false;
    assert.throws(() => second.seal('new', original));
});

test('profile directory reservations detect database and filesystem collisions without touching either owner', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multichrome-directory-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const a = '00000001-0000-4000-8000-000000000001';
    const b = '00000001-0000-4000-8000-000000000002';
    const c = '00000002-0000-4000-8000-000000000003';
    const dir = reserveProfileDirectory(root, () => false, a);
    fs.writeFileSync(path.join(dir.dataDir, 'fixture.txt'), 'original');
    assert.throws(() => reserveProfileDirectory(root, () => false, b), /reserved/);
    assert.throws(() => reserveProfileDirectory(root, () => true, c), /reserved/);
    assert.throws(() => reserveProfileDirectory(root, () => false, 'invalid'), /UUID/);
    const candidates = [b, c];
    assert.equal(reserveProfileDirectory(root, () => false, undefined, () => candidates.shift()).id, c);
    assert.equal(fs.readFileSync(path.join(dir.dataDir, 'fixture.txt'), 'utf8'), 'original');
    assert.equal(countSharedProfileDirectories([dir, { dataDir: dir.dataDir + path.sep }, dir, { dataDir: root }]), 1);
});

test('overlapping proxy changes and ordered profile operations finish', { timeout: 2000 }, async () => {
    const coordinator = new ProxyCoordinator({});
    const completed = [];
    const operations = [
        coordinator.run(() => completed.push('change')),
        coordinator.runForProfile('A', () => completed.push('start')),
        coordinator.runForProfile('A', () => completed.push('stop')),
        coordinator.run(() => completed.push('done')),
    ];
    await Promise.all(operations);
    assert.deepEqual(completed, ['change', 'start', 'stop', 'done']);
});

test('strict profile selectors and version-aware discovery', async () => {
    assert.throws(() => validateProfileAction({ name: 'Demo', setActive: 'false' }, true));
    assert.throws(() => validateProfileAction({ name: 'Demo', unknown: false }));
    assert.equal(validateProfileAction({ name: 'Demo', setActive: false }, true).setActive, false);
    const rpc = { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_MCP_VERSION,
    } } };
    const headers = Object.fromEntries(Object.entries(requestHeaders(rpc)).map(([k,v]) => [k.toLowerCase(),v]));
    assert.equal(validateTransport(rpc, headers), null);
    assert.equal(validateTransport(rpc, {}).error.code, -32020);
    const result = await createMcpHandler({ backend: {} }).handlePayload(rpc);
    assert.ok(result.result.supportedVersions.includes(MODERN_MCP_VERSION));
});
