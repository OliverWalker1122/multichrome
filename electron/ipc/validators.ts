import type {
    ChromeEnvironment,
    FingerprintConfig,
} from '../repositories/environmentRepository.js';
import type {
    AppSettings,
    BrowserEngineType,
    DefaultFingerprintSettings,
} from '../repositories/settingsRepository.js';
import {
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
    normalizeFingerprintConfig,
} from '../domain/fingerprintProfile.js';
import { normalizeEnvironmentTags } from '../domain/environmentTags.js';

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} 必须是非空字符串`);
    }
    return value.trim();
}

export function validateId(value: unknown): string {
    const id = validateString(value, 'ID');
    if (!UUID_REGEX.test(id)) {
        throw new Error('无效的ID格式');
    }
    return id;
}

export interface CreateEnvironmentOptionsPayload {
    browserEngine?: BrowserEngineType;
    fingerprintConfig?: Partial<FingerprintConfig>;
    proxyId?: string;
    proxy?: string;
    proxyLabel?: string;
    tags?: string[];
}

export function sanitizeCreateEnvironmentOptions(
    options: unknown,
    defaultFingerprint?: DefaultFingerprintSettings,
): CreateEnvironmentOptionsPayload | undefined {
    if (!options || typeof options !== 'object') {
        return undefined;
    }
    const raw = options as Record<string, unknown>;
    const validOptions: CreateEnvironmentOptionsPayload = {};

    if ('browserEngine' in raw) {
        validOptions.browserEngine = normalizeBrowserEngine(
            raw.browserEngine,
        ) as BrowserEngineType;
    }
    if (
        'fingerprintConfig' in raw &&
        raw.fingerprintConfig &&
        typeof raw.fingerprintConfig === 'object'
    ) {
        validOptions.fingerprintConfig = normalizeFingerprintConfig(
            raw.fingerprintConfig,
            defaultFingerprint,
        ) as Partial<FingerprintConfig>;
    }
    if ('proxyId' in raw && typeof raw.proxyId === 'string') {
        const trimmedProxyId = raw.proxyId.trim();
        if (trimmedProxyId) {
            validOptions.proxyId = validateId(trimmedProxyId);
        }
    }
    if ('proxy' in raw && typeof raw.proxy === 'string') {
        const trimmedProxy = raw.proxy.trim();
        if (trimmedProxy) {
            validOptions.proxy = trimmedProxy;
        }
    }
    if ('proxyLabel' in raw && typeof raw.proxyLabel === 'string') {
        const trimmedLabel = raw.proxyLabel.trim();
        if (trimmedLabel) {
            validOptions.proxyLabel = trimmedLabel;
        }
    }
    if ('tags' in raw) {
        validOptions.tags = normalizeEnvironmentTags(raw.tags);
    }

    return Object.keys(validOptions).length > 0 ? validOptions : undefined;
}

export function sanitizeUpdateEnvironmentPayload(
    data: unknown,
    defaultFingerprint?: DefaultFingerprintSettings,
): Partial<ChromeEnvironment> {
    if (!data || typeof data !== 'object') {
        throw new Error('更新数据格式无效');
    }

    const updateData = data as Record<string, unknown>;
    const validData: Partial<ChromeEnvironment> = {};

    if ('name' in updateData) {
        validData.name = validateString(updateData.name, '环境名称');
    }
    if ('groupName' in updateData) {
        validData.groupName = validateString(updateData.groupName, '分组名称');
    }
    if ('notes' in updateData) {
        validData.notes =
            typeof updateData.notes === 'string' ? updateData.notes : '';
    }
    if ('tags' in updateData) {
        validData.tags = normalizeEnvironmentTags(updateData.tags);
    }
    if ('proxy' in updateData) {
        validData.proxy =
            typeof updateData.proxy === 'string' ? updateData.proxy : undefined;
    }
    if ('proxyId' in updateData) {
        validData.proxyId = updateData.proxyId
            ? validateId(updateData.proxyId)
            : '';
    }
    if ('proxyLabel' in updateData) {
        validData.proxyLabel =
            typeof updateData.proxyLabel === 'string'
                ? updateData.proxyLabel
                : undefined;
    }
    if ('userAgent' in updateData) {
        validData.userAgent =
            typeof updateData.userAgent === 'string'
                ? updateData.userAgent
                : undefined;
    }
    if ('timezone' in updateData) {
        validData.timezone =
            typeof updateData.timezone === 'string'
                ? updateData.timezone
                : undefined;
    }
    if ('language' in updateData) {
        validData.language =
            typeof updateData.language === 'string'
                ? updateData.language
                : undefined;
    }
    if ('startupUrl' in updateData) {
        validData.startupUrl =
            typeof updateData.startupUrl === 'string'
                ? updateData.startupUrl.trim()
                : undefined;
    }
    if ('browserEngine' in updateData) {
        validData.browserEngine = normalizeBrowserEngine(
            updateData.browserEngine,
        ) as BrowserEngineType;
    }
    if (
        'fingerprintConfig' in updateData &&
        updateData.fingerprintConfig &&
        typeof updateData.fingerprintConfig === 'object'
    ) {
        validData.fingerprintConfig = normalizeFingerprintConfig(
            updateData.fingerprintConfig,
            defaultFingerprint,
        ) as FingerprintConfig;
    }

    return validData;
}

export function sanitizeAppSettingsPayload(settings: unknown): AppSettings {
    if (!settings || typeof settings !== 'object') {
        throw new Error('设置数据格式无效');
    }

    const settingsData = settings as Record<string, unknown>;
    if (
        !('dataPath' in settingsData) ||
        typeof settingsData.dataPath !== 'string'
    ) {
        throw new Error('dataPath 必须是字符串');
    }

    const validSettings: AppSettings = { dataPath: settingsData.dataPath };
    if (settingsData.palette === 'neutral' || settingsData.palette === 'blue' || settingsData.palette === 'sage') {
        validSettings.palette = settingsData.palette;
    }

    if ('globalProxy' in settingsData && settingsData.globalProxy) {
        const proxy = settingsData.globalProxy as Record<string, unknown>;
        if (
            typeof proxy.enabled === 'boolean' &&
            typeof proxy.address === 'string'
        ) {
            validSettings.globalProxy = {
                enabled: proxy.enabled,
                address: proxy.address,
            };
        }
    }

    if (
        'startupUrl' in settingsData &&
        typeof settingsData.startupUrl === 'string'
    ) {
        validSettings.startupUrl = settingsData.startupUrl;
    }

    if (
        settingsData.theme === 'system' ||
        settingsData.theme === 'light' ||
        settingsData.theme === 'dark'
    ) {
        validSettings.theme = settingsData.theme;
    }

    if (settingsData.locale === 'zh-CN' || settingsData.locale === 'en-US') {
        validSettings.locale = settingsData.locale;
    }

    if (typeof settingsData.memorySaverMode === 'boolean') {
        validSettings.memorySaverMode = settingsData.memorySaverMode;
    }
    if (Array.isArray(settingsData.bookmarkTemplates)) {
        validSettings.bookmarkTemplates = settingsData.bookmarkTemplates;
    }
    if (Array.isArray(settingsData.extensionTemplates)) {
        validSettings.extensionTemplates = settingsData.extensionTemplates;
    }
    if (typeof settingsData.allowExtensionsOnFingerprintKernel === 'boolean') {
        validSettings.allowExtensionsOnFingerprintKernel =
            settingsData.allowExtensionsOnFingerprintKernel;
    }
    if (typeof settingsData.requireHealthCheckOnLaunch === 'boolean') {
        validSettings.requireHealthCheckOnLaunch =
            settingsData.requireHealthCheckOnLaunch;
    }
    if (
        settingsData.groupStartupUrls &&
        typeof settingsData.groupStartupUrls === 'object' &&
        !Array.isArray(settingsData.groupStartupUrls)
    ) {
        validSettings.groupStartupUrls = settingsData.groupStartupUrls as Record<
            string,
            string
        >;
    }

    if (
        'fingerprint' in settingsData &&
        settingsData.fingerprint &&
        typeof settingsData.fingerprint === 'object'
    ) {
        validSettings.fingerprint = normalizeDefaultFingerprintSettings(
            settingsData.fingerprint,
        ) as DefaultFingerprintSettings;
    }

    return validSettings;
}

export function sanitizeBatchCreatePayload(
    input: unknown,
    defaultFingerprint?: DefaultFingerprintSettings,
): {
    namePrefix: string;
    groupName: string;
    count: number;
    startNumber?: number;
    notes?: string;
    browserEngine?: BrowserEngineType;
    proxyMode?: 'none' | 'single' | 'sequential';
    proxyIds?: string[];
    tags?: string[];
} {
    if (!input || typeof input !== 'object') {
        throw new Error('批量创建参数格式无效');
    }
    const raw = input as Record<string, unknown>;
    const namePrefix = validateString(raw.namePrefix, '名称前缀');
    const groupName = validateString(raw.groupName, '分组名称');
    const count = Number(raw.count);
    const startNumber =
        raw.startNumber === undefined ? 1 : Number(raw.startNumber);
    const notes = typeof raw.notes === 'string' ? raw.notes : '';
    const browserEngine =
        'browserEngine' in raw
            ? (normalizeBrowserEngine(
                  raw.browserEngine,
              ) as BrowserEngineType)
            : defaultFingerprint?.defaultEngine;
    const proxyMode =
        raw.proxyMode === 'single' || raw.proxyMode === 'sequential'
            ? raw.proxyMode
            : 'none';
    const proxyIds = Array.isArray(raw.proxyIds)
        ? raw.proxyIds
              .filter((item) => typeof item === 'string' && item.trim())
              .map((item) => validateId(item))
        : undefined;
    const tags = 'tags' in raw ? normalizeEnvironmentTags(raw.tags) : undefined;

    return {
        namePrefix,
        groupName,
        count,
        startNumber,
        notes,
        browserEngine,
        proxyMode,
        proxyIds,
        tags,
    };
}

export function sanitizeBatchActionPayload(input: unknown): {
    ids: string[];
    action: 'moveGroup' | 'bindProxy' | 'addTags' | 'delete';
    groupName?: string;
    proxyId?: string;
    tags?: string[];
} {
    if (!input || typeof input !== 'object') {
        throw new Error('批量操作参数格式无效');
    }
    const raw = input as Record<string, unknown>;
    if (!Array.isArray(raw.ids) || raw.ids.length === 0) {
        throw new Error('请至少选择一个浏览器环境');
    }
    const ids = Array.from(
        new Set(raw.ids.map((id) => validateId(id))),
    );
    const action = raw.action;
    if (
        action !== 'moveGroup' &&
        action !== 'bindProxy' &&
        action !== 'addTags' &&
        action !== 'delete'
    ) {
        throw new Error('不支持的批量操作类型');
    }
    return {
        ids,
        action,
        groupName:
            action === 'moveGroup'
                ? validateString(raw.groupName, '目标分组名称')
                : undefined,
        proxyId:
            action === 'bindProxy' && typeof raw.proxyId === 'string' && raw.proxyId.trim()
                ? validateId(raw.proxyId)
                : undefined,
        tags:
            action === 'addTags'
                ? normalizeEnvironmentTags(raw.tags)
                : undefined,
    };
}
