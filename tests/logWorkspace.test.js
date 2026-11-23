import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the production log-scope boundary without starting Electron or
// reading any application state, credentials, or real browser profiles.
const source = fs.readFileSync(
    new URL('../src/utils/logWorkspace.ts', import.meta.url),
    'utf8',
);
const exports = {};
vm.runInNewContext(
    ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
        },
    }).outputText,
    { exports },
);
const {
    resolveLogTarget,
    readTargetLogs,
    clearTargetLogs,
    loadLogDockPreferences,
} = exports;

const proxies = [
    { id: 'proxy-a', name: '代理 A' },
    { id: 'proxy-b', name: '代理 B' },
];
const input = {
    section: 'environments',
    scope: '__selected__',
    selectedEnvironment: null,
    selectedProxyId: null,
    proxies,
};

test('无环境、无托管绑定和失效代理不会读取或清空全部日志', async () => {
    const cases = [
        input,
        { ...input, selectedEnvironment: {} },
        { ...input, selectedEnvironment: { proxyId: 'removed' } },
        { ...input, section: 'proxies' },
        { ...input, section: 'settings', selectedProxyId: 'proxy-a' },
        {
            ...input,
            section: 'trash',
            selectedEnvironment: { proxyId: 'proxy-a' },
        },
        { ...input, scope: 'removed' },
    ];
    let requests = 0;
    for (const item of cases) {
        const target = resolveLogTarget(item);
        assert.equal(target.kind, 'none');
        assert.ok(target.emptyMessage);
        assert.equal(
            (
                await readTargetLogs(target, async () => {
                    requests += 1;
                    return [];
                })
            ).length,
            0,
        );
        await clearTargetLogs(target, async () => {
            requests += 1;
        });
    }
    assert.equal(requests, 0);
});

test('跟随环境使用绑定代理，固定范围不随环境选择变化', async () => {
    const follow = resolveLogTarget({
        ...input,
        selectedEnvironment: { proxyId: 'proxy-b' },
        selectedProxyId: 'proxy-a',
    });
    assert.equal(follow.proxyId, 'proxy-b');
    assert.equal(follow.label, '跟随所选：代理 B');
    const pinned = resolveLogTarget({
        ...input,
        scope: 'proxy-a',
        selectedEnvironment: { proxyId: 'proxy-b' },
    });
    assert.equal(pinned.proxyId, 'proxy-a');
    assert.equal(pinned.label, '固定：代理 A');
    const proxyPage = resolveLogTarget({
        ...input,
        section: 'proxies',
        selectedProxyId: 'proxy-b',
    });
    assert.equal(proxyPage.proxyId, 'proxy-b');
    const calls = [];
    await readTargetLogs(follow, async (id) => {
        calls.push(['read', id]);
        return [];
    });
    await clearTargetLogs(pinned, async (id) => {
        calls.push(['clear', id]);
    });
    assert.deepEqual(calls, [
        ['read', 'proxy-b'],
        ['clear', 'proxy-a'],
    ]);
});

test('只有明确选择全部代理才向 IPC 传递 undefined', async () => {
    const target = resolveLogTarget({ ...input, scope: '__all__' });
    assert.equal(target.kind, 'all');
    const calls = [];
    await readTargetLogs(target, async (id) => {
        calls.push(['read', id]);
        return [];
    });
    await clearTargetLogs(target, async (id) => {
        calls.push(['clear', id]);
    });
    assert.deepEqual(calls, [
        ['read', undefined],
        ['clear', undefined],
    ]);
});

test('日志布局按页面恢复，损坏存储与异常高度安全回退', () => {
    const defaults = loadLogDockPreferences({ getItem: () => '{invalid' });
    assert.equal(defaults.environments.open, false);
    assert.equal(defaults.proxies.open, false);
    assert.equal(defaults.proxies.height, 170);
    assert.equal(defaults.settings.open, false);
    assert.equal(defaults.trash.open, false);
    const restored = loadLogDockPreferences({
        getItem: () =>
            JSON.stringify({
                environments: { open: true, height: 270 },
                proxies: { open: true, height: 99999 },
                settings: { open: 'yes', height: -50 },
            }),
    });
    assert.equal(restored.environments.open, true);
    assert.equal(restored.environments.height, 270);
    assert.equal(restored.proxies.open, true);
    assert.equal(restored.proxies.height, 420);
    assert.equal(restored.settings.open, false);
    assert.equal(restored.settings.height, 120);
    assert.doesNotThrow(() =>
        loadLogDockPreferences({
            getItem: () => {
                throw new Error('storage unavailable');
            },
        }),
    );
});
