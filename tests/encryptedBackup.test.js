import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BACKUP_MAGIC,
    BACKUP_VERSION,
    decryptBackupBundle,
    encryptBackupBundle,
    sanitizePortableSettings,
    validateBackupPassword,
} from '../electron/domain/encryptedBackup.js';

test('validateBackupPassword enforces minimum and maximum lengths', () => {
    assert.throws(() => validateBackupPassword(''), /8 个字符/);
    assert.throws(() => validateBackupPassword('1234567'), /8 个字符/);
    assert.throws(() => validateBackupPassword('a'.repeat(257)), /256 个字符/);
    assert.equal(validateBackupPassword('StrongPass!2026'), 'StrongPass!2026');
});

test('sanitizePortableSettings strips machine-specific dataPath while keeping preferences', () => {
    const cleaned = sanitizePortableSettings({
        dataPath: 'C:\\Users\\alice\\AppData\\Roaming\\MultiChrome',
        locale: 'zh-CN',
        theme: 'dark',
        memorySaverMode: true,
        globalProxy: { enabled: true, address: 'http://127.0.0.1:7890' },
    });
    assert.equal('dataPath' in cleaned, false);
    assert.equal(cleaned.locale, 'zh-CN');
    assert.equal(cleaned.theme, 'dark');
    assert.equal(cleaned.memorySaverMode, true);
    assert.deepEqual(cleaned.globalProxy, {
        enabled: true,
        address: 'http://127.0.0.1:7890',
    });
});

test('encryptBackupBundle & decryptBackupBundle perform authenticated scrypt + AES-256-GCM round-trip', () => {
    const sample = {
        settings: {
            dataPath: '/Users/bob/Library/Application Support/MultiChrome',
            locale: 'en-US',
            theme: 'light',
        },
        proxies: [
            {
                id: 'p-1',
                name: 'US Residential',
                data: {
                    mode: 'simple',
                    simple: {
                        protocol: 'http',
                        host: '198.51.100.10',
                        port: 8080,
                        username: 'user1',
                        password: 'secret-value-1',
                    },
                    config: {},
                },
            },
        ],
        environments: [
            {
                id: 'e-1',
                name: 'Storefront 01',
                groupName: 'Default',
                fingerprintConfig: { seed: 123456789 },
            },
        ],
    };

    const encryptedText = encryptBackupBundle(sample, 'VaultMaster#99', {
        appVersion: '1.6.0',
        nowIso: '2026-11-24T12:00:00.000Z',
    });
    const envelope = JSON.parse(encryptedText);
    assert.equal(envelope.magic, BACKUP_MAGIC);
    assert.equal(envelope.version, BACKUP_VERSION);
    assert.equal(envelope.cipher.name, 'aes-256-gcm');
    assert.equal(encryptedText.includes('secret-value-1'), false);
    assert.equal(encryptedText.includes('198.51.100.10'), false);

    const restored = decryptBackupBundle(encryptedText, 'VaultMaster#99');
    assert.equal(restored.appVersion, '1.6.0');
    assert.equal('dataPath' in restored.settings, false);
    assert.equal(restored.settings.theme, 'light');
    assert.equal(restored.proxies.length, 1);
    assert.equal(restored.proxies[0].data.simple.password, 'secret-value-1');
    assert.equal(restored.environments[0].fingerprintConfig.seed, 123456789);
});

test('decryptBackupBundle rejects wrong password and tampered ciphertext without leakage', () => {
    const encryptedText = encryptBackupBundle(
        { settings: {}, proxies: [], environments: [] },
        'CorrectHorse123',
    );
    assert.throws(
        () => decryptBackupBundle(encryptedText, 'WrongPassword123'),
        /密码错误或文件已被篡改/,
    );

    const parsed = JSON.parse(encryptedText);
    const bytes = Buffer.from(parsed.ciphertext, 'base64');
    bytes[0] = bytes[0] ^ 0xff;
    parsed.ciphertext = bytes.toString('base64');
    assert.throws(
        () => decryptBackupBundle(JSON.stringify(parsed), 'CorrectHorse123'),
        /密码错误或文件已被篡改/,
    );
});
