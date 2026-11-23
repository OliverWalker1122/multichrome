import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ProxyManager, resolveSafeStartError } from '../electron/proxyManager.js';

const TEST_USERNAME = 'fixture-user';
const TEST_PASSWORD = 'local-only/p@ss:%?#';
const UUID = '11111111-1111-4111-8111-111111111111';

function fixture(overrides = {}) {
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
    const calls = { checked: [], started: [], stopped: 0, handlers: [] };
    const core = {
        getInfo: () => ({ version: 'fixture', available: true }),
        check: async (config) => {
            calls.checked.push(config);
        },
        start: async (config, handlers) => {
            calls.started.push(config);
            calls.handlers.push(handlers);
            return {
                stop: async () => {
                    calls.stopped++;
                    handlers.onExit({ unexpected: false, code: 0 });
                },
            };
        },
        ...overrides,
    };
    const options = {
        store,
        secretStorage,
        core,
        configDirectory: 'fixture',
        exitProbe: async () => ({
            ip: '192.0.2.10',
            country: '测试国家',
            countryCode: 'US',
            region: '测试地区',
            city: '测试城市',
        }),
    };
    return {
        manager: new ProxyManager(options),
        store,
        secretStorage,
        core,
        calls,
        options,
    };
}

function simpleInput() {
    return {
        name: '测试代理',
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
    };
}

test('simple proxy saves only encrypted configuration and preserves an omitted password', async () => {
    const { manager, store, options, calls } = fixture();
    const saved = await manager.save(simpleInput());
    assert.equal(calls.checked.length, 1);
    const persisted = JSON.stringify(store.get('proxies'));
    for (const secret of [TEST_USERNAME, TEST_PASSWORD, 'proxy.example.com'])
        assert(!persisted.includes(secret));
    assert(!JSON.stringify(saved).includes(TEST_PASSWORD));
    const edit = { ...simpleInput() };
    delete edit.password;
    await manager.save({ ...edit, id: saved.id, name: '编辑' });
    const restored = new ProxyManager(options);
    assert.equal(restored.list()[0].name, '编辑');
    const revealed = JSON.parse(restored.getConfig(saved.id, true).json);
    assert.equal(revealed.outbounds[0].password, TEST_PASSWORD);
    assert(!restored.getConfig(saved.id).json.includes(TEST_PASSWORD));
    await restored.save({ ...edit, id: saved.id, username: '', password: '' });
    assert.equal(restored.list()[0].hasPassword, false);
});

test('one-line and native VLESS JSON inputs retain editing mode and default to redacted viewing', async () => {
    const { manager } = fixture();
    const oneLine = await manager.save({
        name: '一行',
        mode: 'line',
        line: 'socks5://fixture:demo%40password@proxy.example.com:1080',
    });
    assert.equal(oneLine.protocol, 'socks5');
    assert.equal(manager.getEditor(oneLine.id).mode, 'simple');
    assert.equal(
        JSON.parse(manager.getEditor(oneLine.id, true).config).outbounds[0]
            .password,
        'demo@password',
    );
    const native = await manager.save({
        name: 'VLESS',
        mode: 'json',
        config: JSON.stringify({
            type: 'vless',
            server: 'proxy.example.com',
            server_port: 443,
            uuid: UUID,
            tls: { enabled: true, server_name: 'example.com' },
        }),
    });
    assert.equal(native.protocol, 'vless');
    assert.equal(native.mode, 'json');
    assert(manager.getEditor(native.id).config.includes(UUID));
    assert(!manager.getConfig(native.id).json.includes(UUID));
    assert(manager.getConfig(native.id, true).json.includes(UUID));
    assert.equal(manager.getConfig(native.id).running, false);
    assert.equal(
        JSON.parse(manager.getConfig(native.id).json).inbounds[0].listen_port,
        0,
    );
});

test('failed core validation never overwrites the previously saved configuration', async () => {
    const { manager, store, core } = fixture();
    const saved = await manager.save(simpleInput());
    const before = JSON.stringify(store.get('proxies'));
    core.check = async () => {
        throw new Error('核心校验失败');
    };
    await assert.rejects(
        manager.save({ ...simpleInput(), id: saved.id, name: '不应保存' }),
        /校验失败/,
    );
    assert.equal(JSON.stringify(store.get('proxies')), before);
});

test('legacy proxy-chain records retain IDs and can be launched and migrated on edit', async () => {
    const { store, secretStorage, options } = fixture();
    const legacy = {
        id: UUID,
        name: '旧代理',
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080,
        credentials: secretStorage
            .encryptString(
                JSON.stringify({
                    username: TEST_USERNAME,
                    password: TEST_PASSWORD,
                }),
            )
            .toString('base64'),
    };
    store.set('proxies', [legacy]);
    const manager = new ProxyManager(options);
    assert.equal(manager.list()[0].id, UUID);
    await manager.ensureStarted(UUID);
    await manager.stop(UUID);
    await manager.save({ ...simpleInput(), id: UUID, password: undefined });
    const saved = store.get('proxies')[0];
    assert.equal(saved.id, UUID);
    assert.equal(saved.version, 2);
    assert(!('credentials' in saved));
    assert.equal(
        JSON.parse(manager.getConfig(UUID, true).json).outbounds[0].password,
        TEST_PASSWORD,
    );
});

test('concurrent starts share one core; running edits are blocked and the viewer matches active config', async () => {
    const { manager, calls } = fixture();
    const saved = await manager.save(simpleInput());
    const addresses = await Promise.all(
        Array.from({ length: 5 }, () => manager.ensureStarted(saved.id)),
    );
    assert.equal(new Set(addresses).size, 1);
    assert.equal(calls.started.length, 1);
    assert.equal(manager.list()[0].status, 'running');
    assert.deepEqual(
        JSON.parse(manager.getConfig(saved.id, true).json),
        calls.started[0],
    );
    await assert.rejects(
        manager.save({ ...simpleInput(), id: saved.id }),
        /先停止/,
    );
    await assert.rejects(manager.remove(saved.id), /先停止/);
    await manager.stop(saved.id);
    assert.equal(calls.stopped, 1);
    assert.equal(manager.list()[0].status, 'stopped');
    await manager.remove(saved.id);
    assert.equal(manager.list().length, 0);
});

test('core crash reports an error and drops the local address without direct fallback', async () => {
    const { manager, calls } = fixture();
    const saved = await manager.save(simpleInput());
    await manager.ensureStarted(saved.id);
    calls.handlers[0].onExit({ unexpected: true, code: 1 });
    const summary = manager.list()[0];
    assert.equal(summary.status, 'error');
    assert.equal(summary.localAddress, undefined);
    assert(
        manager
            .getLogs(saved.id)
            .some(
                (log) =>
                    log.level === 'error' && log.message.includes('意外退出'),
            ),
    );
    assert(!JSON.stringify(manager.getLogs()).includes(TEST_PASSWORD));
});

test('shutdown during a start closes its child and rejects further starts', async () => {
    const { manager, calls } = fixture();
    const saved = await manager.save(simpleInput());
    const start = manager.ensureStarted(saved.id);
    const shutdown = manager.closeAll();
    await assert.rejects(start, /启动失败/);
    await shutdown;
    assert.equal(calls.stopped, 1);
    await assert.rejects(manager.ensureStarted(saved.id), /退出/);
});

test('unavailable encryption never degrades to plaintext; a corrupt record is recoverable by replacement', async () => {
    const { manager, secretStorage, store } = fixture();
    secretStorage.isEncryptionAvailable = () => false;
    await assert.rejects(manager.save(simpleInput()), /安全存储/);
    assert.equal(store.get('proxies', []).length, 0);
    secretStorage.isEncryptionAvailable = () => true;
    const saved = await manager.save(simpleInput());
    manager.records[0].payload = 'corrupt';
    assert.equal(manager.list()[0].status, 'error');
    await assert.rejects(manager.ensureStarted(saved.id), /启动失败/);
    await manager.save({ ...simpleInput(), id: saved.id });
    assert.equal(manager.list()[0].status, 'stopped');
});

test('logs are bounded and scoped to the selected proxy', () => {
    const { manager } = fixture();
    for (let index = 0; index < 1200; index++)
        manager.addLog(index % 2 ? 'a' : 'b', 'info', '测试日志');
    assert.equal(manager.getLogs().length, 1000);
    assert.equal(manager.getLogs('a').length, 500);
    manager.clearLogs('a');
    assert.equal(manager.getLogs().length, 500);
    manager.clearLogs();
    assert.equal(manager.getLogs().length, 0);
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

test('exit detection is nonblocking, shared across starts and refreshes, and rate limited', async () => {
    const { manager } = fixture();
    const lookup = deferred();
    let calls = 0;
    let now = 100000;
    manager.now = () => now;
    manager.exitProbe = (address, { signal }) => {
        calls++;
        assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.equal(signal.aborted, false);
        return lookup.promise;
    };
    const saved = await manager.save(simpleInput());
    const address = await manager.ensureStarted(saved.id);
    assert.match(address, /^http:/);
    assert.equal(manager.list()[0].exitInfo.status, 'checking');
    await manager.ensureStarted(saved.id);
    const first = manager.refreshExitInfo(saved.id);
    const second = manager.refreshExitInfo(saved.id);
    assert.equal(calls, 1);
    lookup.resolve({ ip: '192.0.2.22', country: '测试国家', city: '测试城市' });
    assert.deepEqual(await first, await second);
    assert.equal(manager.list()[0].exitInfo.status, 'ready');
    assert.equal(
        manager.list()[0].exitInfo.checkedAt,
        new Date(now).toISOString(),
    );
    const detached = manager.list()[0].exitInfo;
    detached.ip = 'must-not-mutate';
    assert.equal(manager.list()[0].exitInfo.ip, '192.0.2.22');
    await manager.refreshExitInfo(saved.id);
    assert.equal(calls, 1);
    now += 15001;
    await manager.refreshExitInfo(saved.id);
    assert.equal(calls, 2);
    await manager.closeAll();
});

test('failed exit detection leaves a usable running proxy and returns only a fixed error', async () => {
    const { manager } = fixture();
    manager.exitProbe = async () => {
        throw new Error('fixture-private-request-details');
    };
    const saved = await manager.save(simpleInput());
    await manager.ensureStarted(saved.id);
    await manager.refreshExitInfo(saved.id);
    const summary = manager.list()[0];
    assert.equal(summary.status, 'running');
    assert.equal(summary.lastError, undefined);
    assert.equal(summary.exitInfo.status, 'error');
    assert(!JSON.stringify(summary).includes('fixture-private'));
    assert(!JSON.stringify(manager.getLogs()).includes('fixture-private'));
    await manager.stop(saved.id);
    assert.deepEqual(manager.list()[0].exitInfo, { status: 'idle' });
    await assert.rejects(manager.refreshExitInfo(saved.id), /先启动/);
});

test('stop aborts detection; a late result cannot overwrite a restarted proxy', async () => {
    const { manager, calls } = fixture();
    const first = deferred();
    const second = deferred();
    const signals = [];
    manager.exitProbe = (_address, { signal }) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
    };
    const saved = await manager.save(simpleInput());
    await manager.ensureStarted(saved.id);
    const oldLookup = manager.refreshExitInfo(saved.id);
    await manager.stop(saved.id);
    assert.equal(signals[0].aborted, true);
    assert.deepEqual(manager.list()[0].exitInfo, { status: 'idle' });
    await manager.ensureStarted(saved.id);
    const newLookup = manager.refreshExitInfo(saved.id);
    first.resolve({ ip: '192.0.2.1' });
    await oldLookup;
    assert.equal(manager.list()[0].exitInfo.status, 'checking');
    second.resolve({ ip: '192.0.2.2' });
    await newLookup;
    assert.equal(manager.list()[0].exitInfo.ip, '192.0.2.2');
    calls.handlers[1].onExit({ unexpected: true });
    assert.deepEqual(manager.list()[0].exitInfo, { status: 'idle' });
    await manager.closeAll();
});

test('in-memory redacted summary cache avoids repeated decryptString calls without weakening security', async () => {
    const { manager, secretStorage, store } = fixture();
    let decryptCalls = 0;
    const origDecrypt = secretStorage.decryptString.bind(secretStorage);
    secretStorage.decryptString = (buf) => {
        decryptCalls += 1;
        return origDecrypt(buf);
    };

    const saved = await manager.save(simpleInput());
    decryptCalls = 0;

    // Repeated list() calls reuse redacted in-memory metadata
    for (let i = 0; i < 10; i++) {
        const items = manager.list();
        assert.equal(items[0].id, saved.id);
        assert.equal(items[0].host, 'proxy.example.com');
        assert.equal(items[0].hasPassword, true);
        assert(!JSON.stringify(items[0]).includes(TEST_PASSWORD));
    }
    assert.equal(decryptCalls, 0);

    // Persisted store remains strictly encrypted with no plaintext host/credentials
    const persisted = JSON.stringify(store.get('proxies'));
    assert(!persisted.includes('proxy.example.com'));
    assert(!persisted.includes(TEST_PASSWORD));

    // If OS encryption becomes unavailable, cache is immediately invalidated
    secretStorage.isEncryptionAvailable = () => false;
    assert.equal(manager.list()[0].status, 'error');
    secretStorage.isEncryptionAvailable = () => true;
    assert.equal(manager.list()[0].status, 'stopped');
    assert.equal(decryptCalls, 1);
});

test('resolveSafeStartError surfaces safe known causes and redacts arbitrary upstream errors', async () => {
    assert.match(
        resolveSafeStartError(
            new Error(
                '尚未安装 sing-box 代理核心，请前往「设置 → 代理核心（sing-box）」下载官方核心',
            ),
        ),
        /^sing-box 启动失败：尚未安装 sing-box 代理核心/,
    );
    assert.equal(
        resolveSafeStartError(
            new Error('connect ECONNREFUSED 198.51.100.9:8080 user:secretPass'),
        ),
        'sing-box 启动失败，请检查核心、配置和本地端口',
    );

    const { manager, core } = fixture();
    const saved = await manager.save(simpleInput());
    core.check = async () => {
        throw new Error(
            '配置使用了已移除的 sing-box 字段，请按当前核心版本迁移',
        );
    };
    await assert.rejects(
        manager.ensureStarted(saved.id),
        /sing-box 启动失败：配置使用了已移除的 sing-box 字段/,
    );
});

test('batchImport validates concurrently with a single atomic persist and preserves order', async () => {
    const { manager, store, core } = fixture();
    let persistWrites = 0;
    const origSet = store.set.bind(store);
    store.set = (key, value) => {
        if (key === 'proxies') persistWrites += 1;
        return origSet(key, value);
    };

    let activeChecks = 0;
    let maxConcurrentChecks = 0;
    core.check = async () => {
        activeChecks += 1;
        maxConcurrentChecks = Math.max(maxConcurrentChecks, activeChecks);
        await new Promise((r) => setTimeout(r, 15));
        activeChecks -= 1;
    };

    const events = [];
    const unsubscribe = manager.subscribe((evt) => events.push(evt));

    const text = [
        'Node-1 | http://u1:p1@198.51.100.1:8080',
        'Node-2 | socks5://u2:p2@198.51.100.2:1080',
        'Node-3 | http://u3:p3@198.51.100.3:8080',
        'Node-4 | http://u4:p4@198.51.100.4:8080',
        'Node-5 | http://u5:p5@198.51.100.5:8080',
        'Node-Dup | http://u1:p1@198.51.100.1:8080',
        'bad-host:99999',
    ].join('\n');

    const result = await manager.batchImport({
        text,
        namePrefix: '批量',
        skipDuplicates: true,
    });
    unsubscribe();

    assert.equal(result.imported.length, 5);
    assert.deepEqual(
        result.imported.map((item) => item.name),
        ['Node-1', 'Node-2', 'Node-3', 'Node-4', 'Node-5'],
    );
    assert.equal(result.skippedDuplicates.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(persistWrites, 1);
    assert.ok(maxConcurrentChecks >= 2 && maxConcurrentChecks <= 4);
    assert.ok(events.some((evt) => evt.kind === 'state'));
});

test('ensureFresh reuses warm proxies and touchActivity extends the warm window', async () => {
    const { manager, calls } = fixture();
    let now = 1_000_000;
    manager.now = () => now;
    manager.idleRecycleMs = 120_000;

    const saved = await manager.save(simpleInput());
    const firstAddress = await manager.ensureFresh(saved.id, {
        isInUse: () => false,
    });
    assert.equal(calls.started.length, 1);
    assert.equal(calls.stopped, 0);

    now += 60_000;
    const warmAddress = await manager.ensureFresh(saved.id, {
        isInUse: () => false,
    });
    assert.equal(warmAddress, firstAddress);
    assert.equal(calls.started.length, 1);
    assert.equal(calls.stopped, 0);

    // Simulates browser close refreshing lastActiveAt shortly before reopen.
    now += 100_000;
    manager.touchActivity(saved.id);
    now += 50_000;
    const afterTouch = await manager.ensureFresh(saved.id, {
        isInUse: () => false,
    });
    assert.equal(afterTouch, firstAddress);
    assert.equal(calls.started.length, 1);
    assert.equal(calls.stopped, 0);

    await manager.closeAll();
});

test('ensureFresh recycles idle-stale proxies only when unused and fails safe if isInUse throws', async () => {
    const { manager, calls } = fixture();
    let now = 2_000_000;
    manager.now = () => now;
    manager.idleRecycleMs = 120_000;

    const saved = await manager.save(simpleInput());
    const firstAddress = await manager.ensureStarted(saved.id);
    assert.equal(calls.started.length, 1);

    now += 120_000;
    assert.equal(manager.getStaleReason(saved.id), 'idle-timeout');

    // Never tear down a listener while another browser is actively bound to it.
    const whileInUse = await manager.ensureFresh(saved.id, {
        isInUse: () => true,
    });
    assert.equal(whileInUse, firstAddress);
    assert.equal(calls.started.length, 1);
    assert.equal(calls.stopped, 0);

    // Fail-safe when usage verification throws.
    now += 120_000;
    const whileCheckErrors = await manager.ensureFresh(saved.id, {
        isInUse: async () => {
            throw new Error('process scan failed');
        },
    });
    assert.equal(whileCheckErrors, firstAddress);
    assert.equal(calls.started.length, 1);
    assert.equal(calls.stopped, 0);

    // Unused + idle-stale => transparent recycle onto a fresh sing-box process.
    now += 120_000;
    assert.equal(manager.getStaleReason(saved.id), 'idle-timeout');
    const recycledAddress = await manager.ensureFresh(saved.id, {
        isInUse: () => false,
    });
    assert.match(recycledAddress, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(calls.stopped, 1);
    assert.equal(calls.started.length, 2);
    assert.equal(manager.getStaleReason(saved.id), null);
    assert.ok(
        manager
            .getLogs(saved.id)
            .some((log) =>
                log.message.includes(
                    '检测到代理长时间闲置，正在重建 sing-box 通道以避免首开卡顿',
                ),
            ),
    );

    await manager.closeAll();
});

test('ensureFresh recycles on upstream-error and system-resume; exit probe clears upstream-error only', async () => {
    const { manager, calls } = fixture();
    let now = 3_000_000;
    manager.now = () => now;
    manager.idleRecycleMs = 10 * 60_000;

    let shouldFailProbe = false;
    manager.exitProbe = async () => {
        if (shouldFailProbe) throw new Error('upstream timeout');
        return { ip: '192.0.2.30', country: '测试国家' };
    };

    const saved = await manager.save(simpleInput());
    await manager.ensureStarted(saved.id);
    // Let the background start exitProbe settle.
    await manager.refreshExitInfo(saved.id);

    // Upstream log error marks stale; a subsequent healthy exit check clears it.
    calls.handlers[0].onLog({ level: 'error', message: 'dial timeout' });
    assert.equal(manager.getStaleReason(saved.id), 'upstream-error');
    assert.equal(manager.list()[0].lastError, 'dial timeout');

    now += 20_000;
    await manager.refreshExitInfo(saved.id);
    assert.equal(manager.getStaleReason(saved.id), null);
    assert.equal(manager.list()[0].lastError, undefined);

    // Failed exit probe marks stale -> ensureFresh recycles.
    shouldFailProbe = true;
    now += 20_000;
    await manager.refreshExitInfo(saved.id);
    assert.equal(manager.getStaleReason(saved.id), 'upstream-error');

    shouldFailProbe = false;
    await manager.ensureFresh(saved.id, { isInUse: () => false });
    assert.equal(calls.stopped, 1);
    assert.equal(calls.started.length, 2);
    assert.ok(
        manager
            .getLogs(saved.id)
            .some((log) =>
                log.message.includes(
                    '检测到代理先前出现连接异常，正在重建 sing-box 通道',
                ),
            ),
    );
    await manager.refreshExitInfo(saved.id);

    // System resume marks stale and is NOT downgraded or cleared by log/probe activity.
    manager.markAllStale('system-resume');
    assert.equal(manager.getStaleReason(saved.id), 'system-resume');
    calls.handlers[1].onLog({ level: 'error', message: 'transient error' });
    assert.equal(manager.getStaleReason(saved.id), 'system-resume');
    now += 20_000;
    await manager.refreshExitInfo(saved.id);
    assert.equal(manager.getStaleReason(saved.id), 'system-resume');

    await manager.ensureFresh(saved.id, { isInUse: () => false });
    assert.equal(calls.stopped, 2);
    assert.equal(calls.started.length, 3);
    assert.equal(manager.getStaleReason(saved.id), null);
    assert.ok(
        manager
            .getLogs(saved.id)
            .some((log) =>
                log.message.includes(
                    '检测到系统从休眠恢复，正在重建 sing-box 通道',
                ),
            ),
    );

    await manager.closeAll();
});

test('concurrent ensureFresh shares one recycle and stop/closeAll during recycle leaves no running child', async () => {
    const startGate = deferred();
    let gateSecondStart = false;
    const stopGate = deferred();
    let gateSecondStop = false;
    let activeChildren = 0;

    const { manager, calls } = fixture({
        start: async (config, handlers) => {
            calls.started.push(config);
            calls.handlers.push(handlers);
            if (gateSecondStart) {
                gateSecondStart = false;
                await startGate.promise;
            }
            activeChildren += 1;
            let stopped = false;
            return {
                stop: async () => {
                    if (stopped) return;
                    stopped = true;
                    if (gateSecondStop) {
                        gateSecondStop = false;
                        await stopGate.promise;
                    }
                    activeChildren -= 1;
                    calls.stopped += 1;
                    handlers.onExit({ unexpected: false, code: 0 });
                },
            };
        },
    });

    const saved = await manager.save(simpleInput());
    await manager.ensureStarted(saved.id);
    assert.equal(activeChildren, 1);

    manager.markAllStale('system-resume');
    const inUseGate = deferred();
    gateSecondStart = true;

    const p1 = manager.ensureFresh(saved.id, {
        isInUse: () => inUseGate.promise,
    });
    const p2 = manager.ensureFresh(saved.id, {
        isInUse: () => inUseGate.promise,
    });

    inUseGate.resolve(false);
    // Yield so recycle enters stop -> start and registers recyclingPromises.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Overlapping ensureStarted joins the same recycle, and edits are blocked.
    const p3 = manager.ensureStarted(saved.id);
    await assert.rejects(
        manager.save({ ...simpleInput(), id: saved.id }),
        /先停止/,
    );

    startGate.resolve();
    const [a1, a2, a3] = await Promise.all([p1, p2, p3]);
    assert.equal(a1, a2);
    assert.equal(a2, a3);
    assert.equal(calls.stopped, 1);
    assert.equal(calls.started.length, 2);
    assert.equal(activeChildren, 1);

    // Explicit stop() during an in-flight recycle cancels restart and stops cleanly.
    manager.markAllStale('system-resume');
    gateSecondStop = true;
    const recycleBeforeStop = manager.ensureFresh(saved.id, {
        isInUse: () => false,
    });
    // Wait one tick so recycle enters stopInternal() before stop() is invoked.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stopPromise = manager.stop(saved.id);
    stopGate.resolve();
    await assert.rejects(recycleBeforeStop, /取消/);
    await stopPromise;
    assert.equal(manager.list()[0].status, 'stopped');
    assert.equal(activeChildren, 0);

    // Explicit stop() called immediately while isInUse is still pending also cancels cleanly.
    await manager.ensureStarted(saved.id);
    assert.equal(activeChildren, 1);
    manager.markAllStale('system-resume');
    const pendingInUse = deferred();
    const recycleDuringInUse = manager.ensureFresh(saved.id, {
        isInUse: () => pendingInUse.promise,
    });
    const immediateStop = manager.stop(saved.id);
    pendingInUse.resolve(false);
    await assert.rejects(recycleDuringInUse, /取消/);
    await immediateStop;
    assert.equal(manager.list()[0].status, 'stopped');
    assert.equal(activeChildren, 0);

    // closeAll() during an in-flight recycle cancels cleanly with zero leaked children.
    await manager.ensureStarted(saved.id);
    assert.equal(activeChildren, 1);
    manager.markAllStale('system-resume');
    const closeStopGate = deferred();
    const origStart = manager.core.start;
    manager.core.start = async (config, handlers) => {
        await closeStopGate.promise;
        return origStart(config, handlers);
    };
    const recycleDuringClose = manager.ensureFresh(saved.id, {
        isInUse: () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const closePromise = manager.closeAll();
    closeStopGate.resolve();
    await assert.rejects(recycleDuringClose, /启动失败|退出|取消/);
    await closePromise;
    assert.equal(activeChildren, 0);
});
