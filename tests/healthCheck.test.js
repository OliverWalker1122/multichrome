import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEnvironmentHealth } from '../electron/healthCheck.js';

test('evaluateEnvironmentHealth returns overall pass when proxy, geo, language, WebRTC and C++ kernel are healthy', () => {
    const report = evaluateEnvironmentHealth({
        env: {
            id: 'e1',
            name: '美西主力',
            proxyId: 'p1',
            browserEngine: 'fingerprint-chromium',
            fingerprintConfig: {
                seed: 123456,
                platform: 'windows',
                brand: 'Chrome',
                spoofing: {
                    canvas: true,
                    audio: true,
                    font: true,
                    clientrects: true,
                    gpu: true,
                },
            },
        },
        proxy: { id: 'p1', name: 'US-1', status: 'running' },
        proxyAddress: 'http://127.0.0.1:10801',
        exitInfo: {
            ip: '203.0.113.10',
            countryCode: 'US',
            timezone: 'America/Los_Angeles',
            latitude: 34.05,
            longitude: -118.24,
        },
        fpDefaults: {
            autoMatchTimezone: true,
            autoMatchLanguage: false,
            defaultLanguage: 'en-US',
        },
        hasFingerprintKernel: true,
        prefsSnapshot: {
            webrtc: { ip_handling_policy: 'disable_non_proxied_udp' },
        },
    });

    assert.equal(report.overall, 'pass');
    assert.equal(report.items.length, 5);
    assert.ok(report.items.every((item) => item.status === 'pass'));
    assert.deepEqual(report.summary.geolocation, {
        latitude: 34.05,
        longitude: -118.24,
    });
});

test('evaluateEnvironmentHealth flags missing kernel as fail and timezone/language mismatch as warn', () => {
    const report = evaluateEnvironmentHealth({
        env: {
            id: 'e2',
            name: '异常环境',
            proxyId: 'p1',
            timezone: 'Asia/Shanghai',
            language: 'zh-CN',
            browserEngine: 'fingerprint-chromium',
        },
        proxy: { id: 'p1', name: 'US-1', status: 'running' },
        proxyAddress: 'http://127.0.0.1:10801',
        exitInfo: {
            ip: '198.51.100.2',
            countryCode: 'US',
            timezone: 'America/New_York',
        },
        hasFingerprintKernel: false,
    });

    assert.equal(report.overall, 'fail');
    const byId = Object.fromEntries(report.items.map((i) => [i.id, i]));
    assert.equal(byId.geo.status, 'warn');
    assert.equal(byId.language.status, 'warn');
    assert.equal(byId.fingerprint.status, 'fail');
});
