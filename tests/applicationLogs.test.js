import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApplicationLogBuffer } from '../electron/applicationLogs.js';

const require = createRequire(import.meta.url);
// Use the actual electron-log dispatcher with memory-only transports. No app,
// real log files, credentials, network request, or user profile is involved.
const Logger = require('electron-log/src/core/Logger.js');

function fixture(options) {
    const logger = new Logger({ logId: `fixture-${Math.random()}` });
    const originalMessages = [];
    const originalTransport = (message) => originalMessages.push(message);
    originalTransport.level = 'silly';
    logger.transports.console = originalTransport;
    logger.transports.file = originalTransport;
    const logs = createApplicationLogBuffer(options);
    const detach = logs.attach(logger);
    return { logger, logs, detach, originalTransport, originalMessages };
}

test('捕获 electron-log 消息，保留原有输出且支持移除 transport', () => {
    const { logger, logs, detach, originalTransport, originalMessages } =
        fixture();
    assert.equal(logs.attach(logger), detach);
    logger.info('Application starting...');
    logger.warn('启动等待');
    logger.debug('窗口 ready-to-show');
    logger.error('环境启动失败');
    const entries = logs.getLogs();
    assert.deepEqual(
        entries.map((entry) => entry.level),
        ['info', 'warn', 'debug', 'error'],
    );
    assert.equal(entries[0].message, 'Application starting...');
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 4);
    assert.ok(
        entries.every((entry) => Number.isFinite(Date.parse(entry.time))),
    );
    assert.equal(originalMessages.length, 8);
    assert.equal(logger.transports.console, originalTransport);
    assert.equal(logger.transports.file, originalTransport);
    detach();
    logger.info('不再收集');
    assert.equal(logs.getLogs().length, 4);
    assert.equal(originalMessages.length, 10);
});

test('日志在入缓存前脱敏 URL、字符串认证、对象字段和跨参数秘密', () => {
    const { logger, logs } = fixture();
    const credentials = {
        password: 'fixture-password',
        access_token: 'fixture-access',
        headers: { Cookie: 'fixture-cookie' },
        nested: { privateKey: 'fixture-private', api_key: 'fixture-api' },
        reason: 'configuration invalid',
    };
    logger.info(
        'HTTP https://fixture-user:fixture-password@example.test/private/session?access=fixture-query#fixture-fragment',
        credentials,
    );
    logger.error('Authorization: Bearer fixture-auth');
    logger.warn('password="fixture quoted password"');
    logger.warn('token:', 'fixture-split');
    logger.debug('Cookie: session=fixture-session; account=fixture-account');
    const text = logs
        .getLogs()
        .map((entry) => entry.message)
        .join('\n');
    for (const secret of [
        'fixture-user',
        'fixture-password',
        'fixture-access',
        'fixture-cookie',
        'fixture-private',
        'fixture-api',
        'fixture-query',
        'fixture-fragment',
        'fixture-auth',
        'fixture quoted password',
        'fixture-split',
        'fixture-session',
        'fixture-account',
    ]) {
        assert.ok(
            !text.includes(secret),
            `Sensitive fixture remained: ${secret}`,
        );
    }
    assert.ok(text.includes('https://example.test/'));
    assert.ok(text.includes('configuration invalid'));
    assert.equal(credentials.password, 'fixture-password');
});

test('异常、循环对象、访问器和大消息不会使日志收集失败', () => {
    const { logger, logs } = fixture();
    const circular = { name: 'fixture' };
    circular.self = circular;
    Object.defineProperty(circular, 'getter', {
        enumerable: true,
        get() {
            throw new Error('Getter must never be invoked');
        },
    });
    logger.error(new Error('request failed password=fixture-error-password'));
    logger.info(circular, Buffer.from('fixture-binary-secret'));
    logger.debug('x'.repeat(100000));
    const entries = logs.getLogs();
    assert.equal(entries.length, 3);
    assert.ok(!entries[0].message.includes('fixture-error-password'));
    assert.ok(entries[1].message.includes('循环引用'));
    assert.ok(entries[1].message.includes('访问器已省略'));
    assert.ok(!entries[1].message.includes('fixture-binary-secret'));
    assert.ok(entries.every((entry) => entry.message.length <= 4001));
});

test('容量有上限、读取返回副本且清空只清理内存缓冲', () => {
    const { logger, logs, originalMessages } = fixture({ limit: 2 });
    logger.info('first');
    logger.info('second');
    logger.info('third');
    assert.deepEqual(
        logs.getLogs().map((entry) => entry.message),
        ['second', 'third'],
    );
    const snapshot = logs.getLogs();
    snapshot[0].message = 'mutated';
    assert.equal(logs.getLogs()[0].message, 'second');
    logs.clearLogs();
    assert.deepEqual(logs.getLogs(), []);
    assert.equal(originalMessages.length, 6);

    const bounded = fixture({ limit: 100000 });
    for (let index = 0; index < 1001; index++) bounded.logger.info(index);
    assert.equal(bounded.logs.getLogs().length, 1000);
    assert.equal(bounded.logs.getLogs()[0].message, '1');
});
