import { isProfileId } from '../drivers/profileDirectory.js';
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
        getAppVersion = () => '1.6.2',
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
        const english = currentSettings.locale === 'en-US';
        if (payload.environments.some(env => !isProfileId(env?.id)) ||
            payload.proxies.some(proxy => typeof proxy?.id !== 'string' || !proxy.id.trim() || !proxy.data?.config) ||
            (portableSettings.globalProxy !== undefined && (
                typeof portableSettings.globalProxy?.enabled !== 'boolean' ||
                typeof portableSettings.globalProxy?.address !== 'string'
            ))) {
            throw new Error(english ? 'Invalid records in backup' : '备份记录格式无效');
        }
        const completed = [];
        let stage = english ? 'destination' : '目标目录';
        let proxyRes, envRes;
        try {
            this.settingsRepository.assertRestoreTargetWritable(currentSettings.dataPath);
            stage = english ? 'proxies' : '代理';
            proxyRes = this.proxyService.importProxiesFromBackup(payload.proxies);
            completed.push(stage);
            stage = english ? 'environments' : '环境';
            envRes = this.environmentService.importEnvironmentsFromBackup(payload.environments);
            completed.push(stage);
            stage = english ? 'settings' : '设置';
            if (Object.keys(portableSettings).length && !await this.settingsRepository.saveSettings({
                ...portableSettings, dataPath: currentSettings.dataPath,
            })) throw new Error('Settings write failed');
        } catch {
            const done = completed.join(english ? ', ' : '、') || (english ? 'none' : '无');
            throw new Error(english
                ? 'Restore failed during ' + stage + '. Completed: ' + done + '. Retry the same backup to resume.'
                : '恢复在“' + stage + '”步骤失败。已完成：' + done + '。可使用同一份备份重试。');
        }

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
