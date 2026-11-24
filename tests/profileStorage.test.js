import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    clearProfileCache,
    inspectProfileStorage,
} from '../electron/drivers/profileStorage.js';

test('inspectProfileStorage and clearProfileCache remove only cache directories and keep Cookies/Preferences', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-storage-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const defaultDir = path.join(tmpDir, 'Default');
    const cacheDir = path.join(defaultDir, 'Cache');
    const codeCacheDir = path.join(defaultDir, 'Code Cache', 'js');
    const networkDir = path.join(defaultDir, 'Network');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(codeCacheDir, { recursive: true });
    fs.mkdirSync(networkDir, { recursive: true });

    fs.writeFileSync(path.join(cacheDir, 'blob.bin'), Buffer.alloc(4096, 1));
    fs.writeFileSync(path.join(codeCacheDir, 'compiled.bin'), Buffer.alloc(2048, 2));
    fs.writeFileSync(path.join(networkDir, 'Cookies'), 'session=keep-me');
    fs.writeFileSync(path.join(defaultDir, 'Preferences'), '{"ok":true}');

    const before = await inspectProfileStorage(tmpDir);
    assert.equal(before.exists, true);
    assert.equal(before.cacheBytes, 6144);
    assert.ok(before.totalBytes > before.cacheBytes);

    const cleared = await clearProfileCache(tmpDir);
    assert.equal(cleared.freedBytes, 6144);
    assert.equal(cleared.afterCacheBytes, 0);
    assert.equal(fs.existsSync(cacheDir), false);
    assert.equal(fs.existsSync(codeCacheDir), false);

    // Cookies 与 Preferences 完好保留
    assert.equal(
        fs.readFileSync(path.join(networkDir, 'Cookies'), 'utf-8'),
        'session=keep-me',
    );
    assert.equal(
        fs.readFileSync(path.join(defaultDir, 'Preferences'), 'utf-8'),
        '{"ok":true}',
    );
});
