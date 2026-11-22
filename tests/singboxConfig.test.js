import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseProxyLine,
    simpleProxyToConfig,
    normalizeProxyConfig,
    buildSingboxConfig,
    redactConfig,
} from '../electron/singboxConfig.js';

test('一行代理支持认证URL、供应商四段格式和IPv6，正确还原编码', () => {
    assert.deepEqual(
        parseProxyLine('socks5://demo%40local:p%3A%2F%25%40ss@[::1]:1081'),
        {
            protocol: 'socks5',
            host: '::1',
            port: 1081,
            username: 'demo@local',
            password: 'p:/%@ss',
        },
    );
    assert.deepEqual(parseProxyLine('proxy.example:3128:demo:p:a:ss'), {
        protocol: 'http',
        host: 'proxy.example',
        port: 3128,
        username: 'demo',
        password: 'p:a:ss',
    });
    assert.equal(parseProxyLine('https://proxy.example:443').port, 443);
    assert.equal(
        parseProxyLine('socks5h://proxy.example:1080').protocol,
        'socks5',
    );
    assert.equal(parseProxyLine('proxy.example:8080').port, 8080);
    assert.throws(
        () => parseProxyLine('http://demo:sensitive%XX@proxy.example:8080'),
        (error) => !error.message.includes('sensitive'),
    );
    assert.throws(() => parseProxyLine('vless://secret@proxy.example:443'));
    assert.throws(() =>
        parseProxyLine('http://proxy.example:8080/path?secret=value'),
    );
});

test('简单HTTP HTTPS SOCKS配置正确转换成sing-box原生结构', () => {
    const common = {
        host: 'proxy.example',
        port: 443,
        username: 'demo',
        password: 'demo-password',
    };
    const https = simpleProxyToConfig({ ...common, protocol: 'https' });
    assert.equal(https.outbounds[0].type, 'http');
    assert.equal(https.outbounds[0].tls.enabled, true);
    assert.equal(https.outbounds[0].tls.insecure, undefined);
    assert.equal(https.outbounds[0].password, common.password);
    const socks = simpleProxyToConfig({ ...common, protocol: 'socks5' });
    assert.equal(socks.outbounds[0].type, 'socks');
    assert.equal(socks.outbounds[0].version, '5');
    assert.equal(socks.route.final, socks.outbounds[0].tag);
});

test('复杂VLESS配置、JSONC及出口组被保留，不让用户覆盖托管监听', () => {
    const spec = normalizeProxyConfig(`{
        // synthetic fixture
        "type":"vless", "server":"example.invalid", "server_port":443,
        "uuid":"11111111-1111-4111-8111-111111111111",
        "tls":{"enabled":true,"server_name":"example.invalid",},
        "transport":{"type":"ws","path":"/demo//path",},
    }`);
    assert.equal(spec.outbounds[0].transport.path, '/demo//path');
    const full = buildSingboxConfig(spec, 39001);
    assert.equal(full.inbounds.length, 1);
    assert.equal(full.inbounds[0].listen, '127.0.0.1');
    assert.equal(full.inbounds[0].listen_port, 39001);
    assert.equal(full.route.final, 'proxy');
    assert.equal(full.dns.servers[0].type, 'local');
    assert.ok(full.route.default_domain_resolver);
    assert.throws(() => normalizeProxyConfig({ ...spec, inbounds: [] }));
    assert.throws(() =>
        normalizeProxyConfig({ ...spec, route: { rules: [] } }),
    );
    const group = normalizeProxyConfig({
        outbounds: [
            { type: 'selector', tag: 'main', outbounds: ['http-node'] },
            {
                type: 'http',
                tag: 'http-node',
                server: 'example.invalid',
                server_port: 80,
            },
        ],
        route: { final: 'main' },
    });
    assert.equal(group.outbounds[0].outbounds[0], 'http-node');
});

test('出口引用、直接出口、循环及损坏JSON全部拒绝，错误不回显输入', () => {
    for (const value of [
        { type: 'direct' },
        {
            outbounds: [
                { type: 'selector', tag: 'main', outbounds: ['missing'] },
            ],
        },
        {
            outbounds: [
                { type: 'selector', tag: 'main', outbounds: ['node'] },
                { type: 'http', tag: 'node', detour: 'main' },
            ],
        },
        {
            outbounds: [{ type: 'http', tag: 'node' }],
            route: { final: 'absent' },
        },
        {
            outbounds: [
                { type: 'http', tag: 'node' },
                { type: 'http', tag: 'node' },
            ],
        },
        '{ "password": "SENSITIVE-EXAMPLE",',
    ]) {
        assert.throws(
            () => normalizeProxyConfig(value),
            (error) => !error.message.includes('SENSITIVE-EXAMPLE'),
        );
    }
});

test('端点可以作为最终出口，自定义DNS与resolver可保留', () => {
    const spec = normalizeProxyConfig({
        endpoints: [
            { type: 'wireguard', tag: 'wg', private_key: 'fixture-only' },
        ],
        dns: { servers: [{ type: 'local', tag: 'user-local' }] },
        route: { final: 'wg', default_domain_resolver: 'user-local' },
    });
    const compiled = buildSingboxConfig(spec, 0);
    assert.equal(compiled.route.final, 'wg');
    assert.equal(compiled.endpoints[0].type, 'wireguard');
    assert.equal(compiled.dns.servers.length, 1);
});

test('配置默认遮挡所有认证字段、密钥和含参数URL且不改动原配置', () => {
    const input = {
        password: 'secret-one',
        uuid: 'secret-two',
        tls: {
            private_key: 'secret-three',
            reality: { public_key: 'key-four', short_id: 'short-five' },
        },
        transport: { headers: { Authorization: 'secret-six' } },
        url: 'https://example.invalid/path?token=secret-seven',
        auth: 'secret-eight',
        server: 'example.invalid',
        server_port: 443,
    };
    const redacted = redactConfig(input);
    const serialized = JSON.stringify(redacted);
    assert.ok(!serialized.includes('secret-'));
    assert.ok(!serialized.includes('key-four'));
    assert.ok(!serialized.includes('short-five'));
    assert.equal(redacted.server, input.server);
    assert.equal(input.password, 'secret-one');
});
