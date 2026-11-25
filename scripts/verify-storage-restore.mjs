import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SettingsManager } from '../dist/electron/repositories/settingsRepository.js';
import { EnvironmentService } from '../dist/electron/services/environmentService.js';
import { BackupService } from '../dist/electron/services/backupService.js';
import { createProxyAddressStorage } from '../dist/electron/repositories/proxyAddressStorage.js';
import { encryptBackupBundle } from '../dist/electron/domain/encryptedBackup.js';

/** Only touches the fresh storage-fixtures directory in the isolated Electron test process. */
export async function verifyStorageRestore(directory) {
    fs.mkdirSync(directory);
    let available = false;
    const keys = new Map();
    const storage = {
        isEncryptionAvailable: () => available,
        encryptString(value) {
            const key = String(keys.size + 1);
            keys.set(key, value);
            return Buffer.from(key);
        },
        decryptString(value) {
            assert.ok(keys.has(value.toString()));
            return keys.get(value.toString());
        },
    };
    const settingsFile = path.join(directory, 'app-settings.json');
    const legacy = 'http://fixture:example@proxy.invalid:8000';
    fs.writeFileSync(settingsFile, JSON.stringify({ dataPath: directory, globalProxy: { enabled: true, address: legacy } }));
    const makeSettings = () => new SettingsManager({ directory, proxyAddresses: createProxyAddressStorage(storage) });
    const settings = makeSettings();
    const options = { appDataPath: directory, launchService: { getRunningIds: () => [] } };
    const profiles = new EnvironmentService({}, settings, {}, options);
    const db = new Database(path.join(directory, 'chrome-environments.db'));
    const id = 'a0000001-0000-4000-8000-000000000001';
    const first = 'a0000002-0000-4000-8000-000000000002';
    const second = 'a0000003-0000-4000-8000-000000000003';
    const rawGlobal = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).globalProxy.address;
    const rawProfile = () => db.prepare('SELECT proxy FROM environments WHERE id = ?').get(id).proxy;
    try {
        profiles.importEnvironmentsFromBackup([{ id }]);
        db.prepare('UPDATE environments SET proxy = ? WHERE id = ?').run(legacy, id);
        assert.ok(settings.getSettings().globalProxy.address === legacy);
        assert.ok(profiles.repository.findAnyById(id).proxy === legacy);
        assert.equal(await settings.saveSettings({ dataPath: directory, theme: 'dark' }), true);
        assert.ok(rawGlobal() === legacy && rawProfile() === legacy);
        assert.equal(await settings.saveSettings({ dataPath: directory, globalProxy: { enabled: true, address: legacy } }), false);
        assert.throws(() => profiles.repository.update(id, { proxy: legacy }, {}, false));
        assert.ok(rawGlobal() === legacy && rawProfile() === legacy);
        available = true;
        assert.equal(await settings.saveSettings({ dataPath: directory, globalProxy: { enabled: true, address: legacy } }), true);
        profiles.repository.update(id, { proxy: legacy }, {}, false);
        assert.ok(rawGlobal() !== legacy && rawProfile() !== legacy);
        assert.ok(!fs.readFileSync(settingsFile, 'utf8').includes(legacy));
        const coldSettings = makeSettings();
        const coldProfiles = new EnvironmentService({}, coldSettings, {}, options);
        try {
            available = false;
            assert.equal(coldSettings.getSettings().dataPath, directory);
            assert.throws(() => coldSettings.getSettings().globalProxy.address);
            assert.throws(() => coldProfiles.repository.findAnyById(id).proxy);
            available = true;
            assert.ok(coldSettings.getSettings().globalProxy.address === legacy);
            assert.ok(coldProfiles.repository.findAnyById(id).proxy === legacy);
        } finally {
            coldProfiles.repository.close();
        }
        const backup = new BackupService({
            environmentService: profiles, settingsRepository: settings,
            proxyService: { importProxiesFromBackup: () => ({ restoredCount: 0, skippedCount: 0 }) },
        });
        const password = 'test-fixture-only';
        const bundle = encryptBackupBundle({ environments: [{ id: first }, { id: second }], settings: { theme: 'light' } }, password);
        const checkWritable = settings.assertRestoreTargetWritable.bind(settings);
        settings.assertRestoreTargetWritable = () => { throw new Error('Fixture destination is read-only'); };
        await assert.rejects(backup.restoreEncryptedBackup(bundle, password), /failed during destination/);
        assert.equal(profiles.repository.findAnyById(first), null);
        settings.assertRestoreTargetWritable = checkWritable;
        const conflict = path.join(directory, 'environments', second.slice(0, 8));
        fs.mkdirSync(conflict);
        await assert.rejects(backup.restoreEncryptedBackup(bundle, password), /environments/);
        assert.equal(profiles.repository.findAnyById(first), null);
        assert.equal(fs.existsSync(path.join(directory, 'environments', first.slice(0, 8))), false);
        assert.ok(fs.existsSync(conflict));
        assert.equal(settings.getSettings().theme, 'dark');
        fs.rmdirSync(conflict);
        const save = settings.saveSettings.bind(settings);
        settings.saveSettings = async () => false;
        await assert.rejects(backup.restoreEncryptedBackup(bundle, password), /failed during settings/);
        settings.saveSettings = save;
        assert.ok(profiles.repository.findAnyById(first) && profiles.repository.findAnyById(second));
        const retry = await backup.restoreEncryptedBackup(bundle, password);
        assert.equal(retry.skippedEnvironments, 2);
        assert.equal(settings.getSettings().theme, 'light');
        console.log('[PASS] Isolated legacy storage, encryption, restore rollback and retry');
    } finally {
        db.close();
        profiles.repository.close();
    }
}
