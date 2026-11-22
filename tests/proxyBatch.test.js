import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildProxyEndpointKey,
    buildProxyUsageMap,
    parseBatchProxyText,
} from '../electron/proxyBatch.js';

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
