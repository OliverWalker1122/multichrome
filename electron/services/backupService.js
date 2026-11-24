import {
    decryptBackupBundle,
    encryptBackupBundle,
    sanitizePortableSettings,
} from '../domain/encryptedBackup.js';

/**
 * End-to-End Encrypted Local Backup & Migration Service (Layer 2).
 * Zero cloud sync, zero Electron imports: coordinates Settings, ProxyService,
 * and EnvironmentService using authenticated scrypt + AES-256-GCM archives.
 */
export class BackupService {
    constructor({
        environmentService,
        proxyService,
        settingsRepository,
        getAppVersion = () => '1.6.0',
    }) {
        this.environmentService = environmentService;
        this.proxyService = proxyService;
        this.settingsRepository = settingsRepository;
        this.getAppVersion = getAppVersion;
    }

    async exportEncryptedBackup(password) {
        const running = this.environmentService.getRunningEnvironmentSummary();
        if (running.count > 0) {
            throw new Error(
                '请先关闭所有正在运行的浏览器环境，再导出加密备份',
            );
        }

        const currentSettings = this.settingsRepository.getSettings();
        const proxies = this.proxyService.exportDecryptedProxiesForBackup();
        const environments =
            await this.environmentService.getAllEnvironments();

        const serializedEnvironments = environments.map((env) => ({
            id: env.id,
            name: env.name,
            groupName: env.groupName,
            notes: env.notes || '',
            tags: Array.isArray(env.tags) ? env.tags : [],
            proxy: env.proxy,
            proxyId: env.proxyId,
            proxyLabel: env.proxyLabel,
            userAgent: env.userAgent,
            timezone: env.timezone,
            language: env.language,
            startupUrl: env.startupUrl,
            browserEngine: env.browserEngine,
            fingerprintConfig: env.fingerprintConfig,
            createdAt: env.createdAt,
            lastUsed: env.lastUsed,
        }));

        return encryptBackupBundle(
            {
                settings: currentSettings,
                proxies,
                environments: serializedEnvironments,
            },
            password,
            { appVersion: this.getAppVersion() },
        );
    }

    async restoreEncryptedBackup(rawContent, password) {
        const running = this.environmentService.getRunningEnvironmentSummary();
        if (running.count > 0) {
            throw new Error(
                '请先关闭所有正在运行的浏览器环境，再从加密备份恢复',
            );
        }

        const payload = decryptBackupBundle(rawContent, password);
        const currentSettings = this.settingsRepository.getSettings();
        const portableSettings = sanitizePortableSettings(payload.settings);
        if (Object.keys(portableSettings).length > 0) {
            await this.settingsRepository.saveSettings({
                ...currentSettings,
                ...portableSettings,
                dataPath: currentSettings.dataPath,
            });
        }

        const proxyRes = this.proxyService.importProxiesFromBackup(
            payload.proxies,
        );
        const envRes =
            this.environmentService.importEnvironmentsFromBackup(
                payload.environments,
            );

        return {
            restoredEnvironments: envRes.restoredCount,
            skippedEnvironments: envRes.skippedCount,
            restoredProxies: proxyRes.restoredCount,
            skippedProxies: proxyRes.skippedCount,
            exportedAt: payload.exportedAt,
            appVersion: payload.appVersion,
        };
    }
}
