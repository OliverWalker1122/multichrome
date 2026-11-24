import test from 'node:test';
import assert from 'node:assert/strict';
import { ProxyIntegration } from '../electron/services/proxyCoordinator.js';
import { registerProxyIpc } from '../electron/ipc/proxyIpc.js';

const PROXY_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function fixture() {
    const calls = [];
    const bindings = [];
    const manager = {
        list: () => [{ id: PROXY_ID }],
        save: async (input) => {
            calls.push(['save', input]);
            return input;
        },
        remove: async (id) => {
            calls.push(['remove', id]);
        },
        ensureStarted: async (id) => {
            calls.push(['start', id]);
            return 'http://127.0.0.1:34567';
        },
        stop: async (id) => {
            calls.push(['stop', id]);
        },
        closeAll: async () => {
            calls.push(['closeAll']);
        },
        getLogs: (id) => [{ proxyId: id, message: '测试日志' }],
        refreshExitInfo: async (id) => {
            calls.push(['refreshExitInfo', id]);
            return { status: 'ready', ip: '192.0.2.20' };
        },
        clearLogs: (id) => {
            calls.push(['clearLogs', id]);
        },
    };
    const chromeManager = { getProxyBindings: async () => bindings };
    const integration = new ProxyIntegration({
        proxyManager: manager,
        chromeManager,
    });
    const handlers = new Map();
    registerProxyIpc({
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        integration,
        validateId: (id) => {
            if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))
                throw new Error('无效的ID格式');
            return id;
        },
    });
    const invoke = async (channel, input) =>
        handlers.get(channel)(undefined, input);
    return { calls, bindings, manager, chromeManager, integration, invoke };
}

test('queued operations wait for earlier operations and preserve their own results', async () => {
    const { integration } = fixture();
    const gate = deferred();
    const started = deferred();
    const order = [];
    const first = integration.run(async () => {
        order.push('first:start');
        started.resolve();
        await gate.promise;
        order.push('first:end');
        return 1;
    });
    const second = integration.run(() => {
        order.push('second');
        return 2;
    });
    await started.promise;
    assert.deepEqual(order, ['first:start']);
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
});

test('exit-info IPC validates IDs and does not hold the proxy mutation queue', async () => {
    const { manager, invoke, calls } = fixture();
    const lookup = deferred();
    manager.refreshExitInfo = () => lookup.promise;
    await assert.rejects(
        invoke('proxies:refresh-exit-info', 'invalid'),
        /无效/,
    );
    const refreshing = invoke('proxies:refresh-exit-info', PROXY_ID);
    await invoke('proxies:stop', PROXY_ID);
    assert.deepEqual(calls, [['stop', PROXY_ID]]);
    lookup.resolve({ status: 'idle' });
    assert.deepEqual(await refreshing, { status: 'idle' });
});

test('a failed operation does not poison later queued work', async () => {
    const { integration } = fixture();
    const syncFailure = integration.run(() => {
        throw new Error('同步失败');
    });
    const asyncFailure = integration.run(async () => {
        throw new Error('异步失败');
    });
    const recovery = integration.run(() => '恢复成功');
    await assert.rejects(syncFailure, /同步失败/);
    await assert.rejects(asyncFailure, /异步失败/);
    assert.equal(await recovery, '恢复成功');
    await integration.pending;
});

test('shutdown drains accepted work, rejects new work and closes listeners once', async () => {
    const { integration, calls } = fixture();
    const gate = deferred();
    const started = deferred();
    const first = integration.run(async () => {
        started.resolve();
        await gate.promise;
        calls.push(['first']);
    });
    const second = integration.run(() => {
        calls.push(['second']);
    });
    await started.promise;
    const shutdown = integration.shutdown();
    const repeatedShutdown = integration.shutdown();
    assert.equal(shutdown, repeatedShutdown);
    await assert.rejects(
        integration.run(() => {
            calls.push(['unexpected']);
        }),
        /程序正在退出/,
    );
    assert.deepEqual(calls, []);
    gate.resolve();
    await Promise.all([first, second, shutdown, repeatedShutdown]);
    assert.deepEqual(calls, [['first'], ['second'], ['closeAll']]);
});

test('shutdown still closes listeners after a queued task fails', async () => {
    const { integration, calls } = fixture();
    const failure = integration.run(() => {
        throw new Error('启动失败');
    });
    const rejected = assert.rejects(failure, /启动失败/);
    await integration.shutdown();
    await rejected;
    assert.deepEqual(calls, [['closeAll']]);
});

test('failed cleanup can be retried without accepting new tasks', async () => {
    const { integration, manager } = fixture();
    let attempts = 0;
    manager.closeAll = async () => {
        if (++attempts === 1) throw new Error('关闭失败');
    };
    await assert.rejects(integration.shutdown(), /关闭失败/);
    await assert.rejects(
        integration.run(() => undefined),
        /程序正在退出/,
    );
    await integration.shutdown();
    assert.equal(attempts, 2);
});

test('running profiles cannot change managed or manual proxy settings', async () => {
    const { integration, bindings } = fixture();
    bindings.push({ id: PROFILE_ID, proxyId: PROXY_ID, isRunning: true });
    for (const data of [
        { proxyId: PROXY_ID },
        { proxyId: '' },
        { proxy: 'http://127.0.0.1:3000' },
    ]) {
        await assert.rejects(
            integration.validateBinding(PROFILE_ID, data),
            /先关闭环境/,
        );
    }
    await integration.validateBinding(PROFILE_ID, { name: '新名称' });
});

test('stopped profiles accept existing proxies or clearing bindings, but reject missing proxies', async () => {
    const { integration, bindings } = fixture();
    bindings.push({ id: PROFILE_ID, proxyId: PROXY_ID, isRunning: false });
    await integration.validateBinding(PROFILE_ID, { proxyId: PROXY_ID });
    await integration.validateBinding(PROFILE_ID, { proxyId: '', proxy: '' });
    await assert.rejects(
        integration.validateBinding(PROFILE_ID, { proxyId: 'missing' }),
        /所选代理不存在/,
    );
});

test('a running binding blocks proxy stopping and editing through IPC', async () => {
    const { bindings, calls, invoke } = fixture();
    bindings.push({ id: PROFILE_ID, proxyId: PROXY_ID, isRunning: true });
    await assert.rejects(invoke('proxies:stop', PROXY_ID), /仍有环境正在使用/);
    await assert.rejects(
        invoke('proxies:save', { id: PROXY_ID, name: '修改' }),
        /仍有环境正在使用/,
    );
    assert.deepEqual(calls, []);
    bindings[0].isRunning = false;
    await invoke('proxies:stop', PROXY_ID);
    assert.deepEqual(calls, [['stop', PROXY_ID]]);
});

test('deletion protects bindings to stopped and recycled profiles', async () => {
    const { bindings, calls, invoke } = fixture();
    bindings.push({
        id: PROFILE_ID,
        proxyId: PROXY_ID,
        isRunning: false,
        deletedAt: '2026-01-01',
    });
    await assert.rejects(invoke('proxies:remove', PROXY_ID), /包括回收站/);
    assert.deepEqual(calls, []);
    bindings.splice(0);
    await invoke('proxies:remove', PROXY_ID);
    assert.deepEqual(calls, [['remove', PROXY_ID]]);
});

test('a stop queued during launch observes the new running binding', async () => {
    const { integration, bindings, calls, invoke } = fixture();
    const gate = deferred();
    const started = deferred();
    const launch = integration.run(async () => {
        started.resolve();
        await gate.promise;
        bindings.push({ id: PROFILE_ID, proxyId: PROXY_ID, isRunning: true });
    });
    await started.promise;
    const rejectedStop = assert.rejects(
        invoke('proxies:stop', PROXY_ID),
        /仍有环境正在使用/,
    );
    gate.resolve();
    await Promise.all([launch, rejectedStop]);
    assert.deepEqual(calls, []);
});

test('quit detection includes only running profiles with managed proxies', async () => {
    const { integration, bindings } = fixture();
    assert.equal(await integration.hasRunningProfiles(), false);
    bindings.push({
        id: PROFILE_ID,
        isRunning: true,
        proxy: 'http://127.0.0.1:3000',
    });
    bindings.push({ id: 'stopped', proxyId: PROXY_ID, isRunning: false });
    assert.equal(await integration.hasRunningProfiles(), false);
    bindings.push({ id: 'running', proxyId: PROXY_ID, isRunning: true });
    assert.equal(await integration.hasRunningProfiles(), true);
});

test('a failed process inspection prevents destructive proxy operations', async () => {
    const { chromeManager, integration, invoke, calls } = fixture();
    chromeManager.getProxyBindings = async () => {
        throw new Error('进程检查失败');
    };
    await assert.rejects(invoke('proxies:stop', PROXY_ID), /进程检查失败/);
    await assert.rejects(invoke('proxies:remove', PROXY_ID), /进程检查失败/);
    await assert.rejects(integration.hasRunningProfiles(), /进程检查失败/);
    assert.deepEqual(calls, []);
});

test('IPC validates IDs and rejects mutations after shutdown', async () => {
    const { integration, calls, invoke } = fixture();
    for (const channel of [
        'proxies:remove',
        'proxies:start',
        'proxies:stop',
        'proxies:logs',
        'proxies:clear-logs',
    ]) {
        await assert.rejects(invoke(channel, 'invalid'), /无效的ID格式/);
    }
    assert.deepEqual(calls, []);
    assert.equal(
        await invoke('proxies:start', PROXY_ID),
        'http://127.0.0.1:34567',
    );
    await integration.shutdown();
    for (const channel of [
        'proxies:remove',
        'proxies:start',
        'proxies:stop',
        'proxies:clear-logs',
    ]) {
        await assert.rejects(invoke(channel, PROXY_ID), /程序正在退出/);
    }
    await assert.rejects(
        invoke('proxies:save', { name: '新代理' }),
        /程序正在退出/,
    );
    assert.deepEqual(calls, [['start', PROXY_ID], ['closeAll']]);
});
