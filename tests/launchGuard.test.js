import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateLaunchConsistency,
    getTimeZoneOffsetMinutes,
} from '../electron/launchGuard.js';

test('evaluateLaunchConsistency passes cleanly when timezone/language align or use defaults', () => {
    const res = evaluateLaunchConsistency({
        env: {
            id: 'e1',
            name: '美西环境',
            browserEngine: 'fingerprint-chromium',
            proxyId: 'p1',
            timezone: '',
            language: 'en-US',
        },
        proxy: { id: 'p1', status: 'running' },
        exitInfo: {
            ip: '203.0.113.10',
            countryCode: 'US',
            timezone: 'America/Los_Angeles',
            latitude: 34.05,
            longitude: -118.24,
        },
        hasFingerprintKernel: true,
    });

    assert.equal(res.ok, true);
    assert.equal(res.issues.length, 0);
    assert.equal(res.canAutoAlign, false);
});

test('evaluateLaunchConsistency flags timezone and zh-CN language conflicts with one-click auto-align patch', () => {
    const res = evaluateLaunchConsistency({
        env: {
            id: 'e2',
            name: '错配环境',
            browserEngine: 'system-chrome',
            proxyId: 'p1',
            timezone: 'Asia/Shanghai',
            language: 'zh-CN',
        },
        proxy: { id: 'p1', status: 'running' },
        exitInfo: {
            ip: '198.51.100.5',
            countryCode: 'US',
            timezone: 'America/New_York',
        },
        hasFingerprintKernel: true,
    });

    assert.equal(res.ok, false);
    assert.equal(res.hasError, false);
    assert.equal(res.canAutoAlign, true);
    assert.deepEqual(res.suggestedPatch, { timezone: '', language: 'auto' });
    assert.equal(res.issues.length, 2);
    assert.equal(res.issues[0].id, 'timezone-mismatch');
    assert.equal(res.issues[1].id, 'language-mismatch');
});

test('evaluateLaunchConsistency allows en-US globally without false positives', () => {
    const res = evaluateLaunchConsistency({
        env: {
            id: 'e3',
            name: '日本英文环境',
            browserEngine: 'system-chrome',
            timezone: 'Asia/Tokyo',
            language: 'en-US',
        },
        exitInfo: {
            ip: '192.0.2.8',
            countryCode: 'JP',
            timezone: 'Asia/Tokyo',
        },
        hasFingerprintKernel: true,
    });

    assert.equal(res.ok, true);
});

test('evaluateLaunchConsistency reports blocking errors for missing kernel or missing proxy', () => {
    const res = evaluateLaunchConsistency({
        env: {
            id: 'e4',
            name: '缺内核环境',
            browserEngine: 'fingerprint-chromium',
            proxyId: 'deleted-proxy',
        },
        proxy: null,
        hasFingerprintKernel: false,
    });

    assert.equal(res.ok, false);
    assert.equal(res.hasError, true);
    assert.equal(res.canAutoAlign, false);
    assert.equal(res.issues.length, 2);
});

test('getTimeZoneOffsetMinutes returns finite offset difference between Shanghai and Tokyo', () => {
    const sh = getTimeZoneOffsetMinutes('Asia/Shanghai', new Date('2026-01-15T00:00:00Z'));
    const tk = getTimeZoneOffsetMinutes('Asia/Tokyo', new Date('2026-01-15T00:00:00Z'));
    assert.equal(tk - sh, 60);
});
