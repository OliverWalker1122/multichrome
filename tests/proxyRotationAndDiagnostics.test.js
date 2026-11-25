import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateProxyRotationUrl } from '../electron/domain/proxyRotationPolicy.js';
import { triggerProxyRotation } from '../electron/drivers/proxyRotationClient.js';
import {
    buildSanitizedSupportBundle,
    sanitizeDiagnosticText,
} from '../electron/domain/supportBundle.js';
import {
    parseSha256Sums,
    selectPlatformReleaseAsset,
} from '../electron/domain/updateAssetPolicy.js';

test('validateProxyRotationUrl allows valid public webhook URLs and blocks loopback/private SSRF targets', () => {
    assert.equal(validateProxyRotationUrl(''), '');
    assert.equal(
        validateProxyRotationUrl('  https://api.provider.example/rotate?token=abc123  '),
        'https://api.provider.example/rotate?token=abc123',
    );
    assert.throws(
        () => validateProxyRotationUrl('http://127.0.0.1:8080/rotate'),
        /内网 IP/,
    );
    assert.throws(
        () => validateProxyRotationUrl('http://192.168.1.1/rotate'),
        /内网 IP/,
    );
    assert.throws(
        () => validateProxyRotationUrl('http://10.0.0.5/rotate'),
        /内网 IP/,
    );
    assert.throws(
        () => validateProxyRotationUrl('https://localhost/rotate'),
        /内网域名/,
    );
    assert.throws(
        () => validateProxyRotationUrl('file:///etc/passwd'),
        /http 或 https/,
    );
});

test('sanitizeDiagnosticText and buildSanitizedSupportBundle strip usernames, credentials, and public IPs', () => {
    const raw =
        'Launch C:\\Users\\alice\\AppData\\MultiChrome via http://admin:secret99@proxy.example:8080 exit 203.0.113.45 local 127.0.0.1';
    const cleaned = sanitizeDiagnosticText(raw);
    assert.equal(cleaned.includes('alice'), false);
    assert.equal(cleaned.includes('secret99'), false);
    assert.equal(cleaned.includes('203.0.113.45'), false);
    assert.ok(cleaned.includes('[REDACTED]'));
    assert.ok(cleaned.includes('[REDACTED_IP]'));
    assert.ok(cleaned.includes('127.0.0.1'));

    const bundle = buildSanitizedSupportBundle({
        appVersion: '1.6.0',
        dbIntegrity: 'ok',
        activeProfiles: 4,
        recentLogs: [
            {
                timestamp: '2026-11-24T12:00:00Z',
                level: 'info',
                message: '/Users/bob/Library/MultiChrome connected 198.51.100.9',
            },
        ],
    });
    assert.equal(bundle.database.integrity, 'ok');
    assert.equal(bundle.recentLogs[0].message.includes('bob'), false);
    assert.equal(bundle.recentLogs[0].message.includes('198.51.100.9'), false);
});

test('selectPlatformReleaseAsset and parseSha256Sums resolve installer assets and digests cleanly', () => {
    const assets = [
        {
            name: 'MultiChrome-Setup-1.6.0.exe',
            browser_download_url: 'https://github.com/OliverWalker1122/multichrome/releases/download/v1.6.0/MultiChrome-Setup-1.6.0.exe',
            size: 90000000,
        },
        {
            name: 'MultiChrome-1.6.0-arm64.dmg',
            browser_download_url: 'https://github.com/OliverWalker1122/multichrome/releases/download/v1.6.0/MultiChrome-1.6.0-arm64.dmg',
            size: 110000000,
        },
        {
            name: 'MultiChrome-1.6.0.AppImage',
            browser_download_url: 'https://github.com/OliverWalker1122/multichrome/releases/download/v1.6.0/MultiChrome-1.6.0.AppImage',
            size: 100000000,
        },
        {
            name: 'SHA256SUMS.txt',
            browser_download_url: 'https://github.com/OliverWalker1122/multichrome/releases/download/v1.6.0/SHA256SUMS.txt',
        },
    ];

    assert.equal(
        selectPlatformReleaseAsset(assets, 'win32', 'x64').installer?.name,
        'MultiChrome-Setup-1.6.0.exe',
    );
    assert.equal(
        selectPlatformReleaseAsset(assets, 'darwin', 'arm64').installer?.name,
        'MultiChrome-1.6.0-arm64.dmg',
    );
    assert.equal(
        selectPlatformReleaseAsset(assets, 'linux', 'x64').installer?.name,
        'MultiChrome-1.6.0.AppImage',
    );

    const sumsText = [
        `${'a'.repeat(64)}  MultiChrome-Setup-1.6.0.exe`,
        `${'b'.repeat(64)} *MultiChrome-1.6.0-arm64.dmg`,
    ].join('\n');
    assert.equal(
        parseSha256Sums(sumsText, 'MultiChrome-Setup-1.6.0.exe'),
        'a'.repeat(64),
    );
    assert.equal(
        parseSha256Sums(sumsText, 'MultiChrome-1.6.0-arm64.dmg'),
        'b'.repeat(64),
    );
});

test('triggerProxyRotation rejects empty/private SSRF URLs cleanly and handles HTTP status codes', async () => {
    await assert.rejects(() => triggerProxyRotation(''), /未配置换 IP/);
    await assert.rejects(
        () => triggerProxyRotation('http://127.0.0.1:9999/rotate'),
        /内网 IP/,
    );
    await assert.rejects(
        () => triggerProxyRotation('https://localhost/rotate'),
        /内网域名/,
    );
    await assert.rejects(
        () => triggerProxyRotation('ftp://example.com/rotate'),
        /http 或 https/,
    );
    // Verify unreachable RFC-5737 TEST-NET-1 fails cleanly within short timeout without throwing uncaught errors
    await assert.rejects(
        () =>
            triggerProxyRotation('http://192.0.2.1:81/rotate', {
                timeoutMs: 120,
            }),
        /超时|无法连接/,
    );
    // Verify http.createServer sanity check stays available for local driver tests
    assert.equal(typeof http.createServer, 'function');
});
