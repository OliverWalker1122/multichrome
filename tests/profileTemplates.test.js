import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    normalizeBookmarkTemplates,
    normalizeGroupStartupUrls,
    removeGroupStartupUrl,
    renameGroupStartupUrl,
    resolveEffectiveStartupUrl,
} from '../electron/domain/profileTemplatePolicy.js';
import {
    resolveExtensionTemplatePaths,
    syncBookmarksToProfile,
} from '../electron/drivers/profileTemplateDriver.js';

test('resolveEffectiveStartupUrl follows env > group > global precedence', () => {
    assert.equal(
        resolveEffectiveStartupUrl({
            envStartupUrl: 'https://env.example.com',
            groupName: '运营组',
            groupStartupUrls: { 运营组: 'https://group.example.com' },
            globalStartupUrl: 'https://global.example.com',
        }),
        'https://env.example.com',
    );
    assert.equal(
        resolveEffectiveStartupUrl({
            envStartupUrl: '',
            groupName: '运营组',
            groupStartupUrls: { 运营组: 'https://group.example.com' },
            globalStartupUrl: 'https://global.example.com',
        }),
        'https://group.example.com',
    );
    assert.equal(
        resolveEffectiveStartupUrl({
            envStartupUrl: '',
            groupName: '默认分组',
            groupStartupUrls: { 运营组: 'https://group.example.com' },
            globalStartupUrl: 'https://global.example.com',
        }),
        'https://global.example.com',
    );
});

test('syncBookmarksToProfile merges templates without overwriting existing bookmarks and deduplicates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bookmarks-'));
    try {
        const templates = normalizeBookmarkTemplates([
            { id: 'b1', name: 'IP检测', url: 'https://ip125.com/' },
            {
                id: 'b2',
                name: 'WebRTC检测',
                url: 'https://browserleaks.com/webrtc',
                folder: '检测工具',
            },
            { id: 'bad', name: '无效', url: 'javascript:alert(1)' },
        ]);
        assert.equal(templates.length, 2);

        const first = syncBookmarksToProfile(tmpDir, templates);
        assert.deepEqual(first, { addedCount: 2, skippedCount: 0 });

        // Running again skips duplicates
        const second = syncBookmarksToProfile(tmpDir, templates);
        assert.deepEqual(second, { addedCount: 0, skippedCount: 2 });

        const doc = JSON.parse(
            fs.readFileSync(path.join(tmpDir, 'Default', 'Bookmarks'), 'utf-8'),
        );
        const bar = doc.roots.bookmark_bar.children;
        assert.equal(bar.length, 2);
        assert.equal(bar[0].name, 'IP检测');
        assert.equal(bar[1].type, 'folder');
        assert.equal(bar[1].name, '检测工具');
        assert.equal(bar[1].children[0].url, 'https://browserleaks.com/webrtc');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('resolveExtensionTemplatePaths blocks C++ fingerprint kernel by default unless explicitly opted in', () => {
    const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ext-'));
    try {
        fs.writeFileSync(
            path.join(extDir, 'manifest.json'),
            JSON.stringify({ manifest_version: 3, name: 'Demo', version: '1.0' }),
        );
        const list = [{ id: 'x1', name: 'Demo', path: extDir, enabled: true }];

        assert.deepEqual(
            resolveExtensionTemplatePaths(list, {
                isFingerprintChromium: false,
            }),
            [extDir],
        );
        assert.deepEqual(
            resolveExtensionTemplatePaths(list, {
                isFingerprintChromium: true,
                allowExtensionsOnFingerprintKernel: false,
            }),
            [],
        );
        assert.deepEqual(
            resolveExtensionTemplatePaths(list, {
                isFingerprintChromium: true,
                allowExtensionsOnFingerprintKernel: true,
            }),
            [extDir],
        );
    } finally {
        fs.rmSync(extDir, { recursive: true, force: true });
    }
});

test('normalizeGroupStartupUrls filters invalid URLs', () => {
    assert.deepEqual(
        normalizeGroupStartupUrls({
            A: 'https://example.com',
            B: 'not-a-url',
            '': 'https://a.com',
        }),
        { A: 'https://example.com' },
    );
});

test('renameGroupStartupUrl and removeGroupStartupUrl keep group startup URLs in sync', () => {
    const initial = {
        OldGroup: 'https://old.example.com',
        ExistingGroup: 'https://keep.example.com',
    };

    const renamed = renameGroupStartupUrl(initial, 'OldGroup', 'NewGroup');
    assert.equal(renamed.changed, true);
    assert.deepEqual(renamed.next, {
        NewGroup: 'https://old.example.com',
        ExistingGroup: 'https://keep.example.com',
    });

    // Renaming into a group that already has a startup URL preserves target URL
    const merged = renameGroupStartupUrl(initial, 'OldGroup', 'ExistingGroup');
    assert.equal(merged.changed, true);
    assert.deepEqual(merged.next, {
        ExistingGroup: 'https://keep.example.com',
    });

    // Missing group is a no-op
    const noop = renameGroupStartupUrl(initial, 'Missing', 'Other');
    assert.equal(noop.changed, false);

    const removed = removeGroupStartupUrl(initial, 'OldGroup');
    assert.equal(removed.changed, true);
    assert.deepEqual(removed.next, {
        ExistingGroup: 'https://keep.example.com',
    });
});
