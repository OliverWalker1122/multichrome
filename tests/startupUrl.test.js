import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    decideStartupUrlAction,
    hasSavedChromeSession,
    isBlankTabUrl,
    isSameStartupPage,
    normalizeStartupUrl,
} from '../electron/startupUrl.js';

test('normalizeStartupUrl and isSameStartupPage normalize trailing slashes and www host', () => {
    assert.equal(normalizeStartupUrl('https://IP125.com/'), 'https://ip125.com');
    assert.equal(normalizeStartupUrl('javascript:alert(1)'), '');
    assert.equal(isSameStartupPage('https://ip125.com/', 'https://ip125.com'), true);
    assert.equal(isSameStartupPage('https://www.ip125.com/en/', 'https://ip125.com/'), true);
    assert.equal(isSameStartupPage('https://example.com/a', 'https://example.com/b'), false);
    assert.equal(isBlankTabUrl('chrome://newtab/'), true);
    assert.equal(isBlankTabUrl('about:blank'), true);
    assert.equal(isBlankTabUrl('https://ip125.com/'), false);
});

test('decideStartupUrlAction skips only when startup page is already open, and opens when only other pages exist', () => {
    // 已有相同启动页 -> 不重复打开
    assert.deepEqual(
        decideStartupUrlAction(
            [{ targetId: 't1', type: 'page', url: 'https://ip125.com/' }],
            'https://ip125.com',
        ),
        { action: 'skip', reason: 'already-open' },
    );

    // 恢复了其他页面（如 google.com）且包含空白页 -> 复用空白页打开启动页
    assert.deepEqual(
        decideStartupUrlAction(
            [
                { targetId: 't1', type: 'page', url: 'https://google.com/' },
                { targetId: 't2', type: 'page', url: 'chrome://newtab/' },
            ],
            'https://ip125.com',
        ),
        { action: 'navigate', targetId: 't2', url: 'https://ip125.com' },
    );

    // 恢复了其他页面（如 google.com）且没有启动页 -> 新建 1 个启动页
    assert.deepEqual(
        decideStartupUrlAction(
            [{ targetId: 't1', type: 'page', url: 'https://google.com/' }],
            'https://ip125.com',
        ),
        { action: 'create', url: 'https://ip125.com' },
    );
});

test('decideStartupUrlAction reuses blank tab or creates new tab when no restored pages exist', () => {
    // 只有空白页 -> 复用空白页导航
    assert.deepEqual(
        decideStartupUrlAction(
            [
                { targetId: 'bg', type: 'service_worker', url: 'https://ip125.com/' },
                { targetId: 't1', type: 'page', url: 'chrome://newtab/' },
            ],
            'https://ip125.com/',
        ),
        { action: 'navigate', targetId: 't1', url: 'https://ip125.com/' },
    );

    // 没有任何页面 -> 新建
    assert.deepEqual(
        decideStartupUrlAction([], 'https://ip125.com/'),
        { action: 'create', url: 'https://ip125.com/' },
    );

    // 启动页为空 -> 跳过
    assert.deepEqual(
        decideStartupUrlAction([{ targetId: 't1', type: 'page', url: 'about:blank' }], ''),
        { action: 'skip', reason: 'invalid-or-empty-startup-url' },
    );
});

test('hasSavedChromeSession detects Chromium Sessions directory and legacy files', (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-session-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    assert.equal(hasSavedChromeSession(tmpDir), false);

    const sessionsDir = path.join(tmpDir, 'Default', 'Sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    assert.equal(hasSavedChromeSession(tmpDir), false);

    fs.writeFileSync(path.join(sessionsDir, 'Session_1337000000'), 'stub');
    assert.equal(hasSavedChromeSession(tmpDir), true);
});
