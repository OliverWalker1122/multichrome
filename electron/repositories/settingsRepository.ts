import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import log from 'electron-log';
import { app } from 'electron';
import {
    DEFAULT_FINGERPRINT_SETTINGS,
    normalizeDefaultFingerprintSettings,
} from '../domain/fingerprintProfile.js';
import {
    normalizeBookmarkTemplates,
    normalizeExtensionTemplates,
    normalizeGroupStartupUrls,
} from '../domain/profileTemplatePolicy.js';

export interface BookmarkTemplate {
    id: string;
    name: string;
    url: string;
    folder?: string;
}

export interface ExtensionTemplate {
    id: string;
    name: string;
    path: string;
    enabled: boolean;
}

// 应用设置接口
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppLocale = 'zh-CN' | 'en-US';
export type BrowserEngineType = 'system-chrome' | 'fingerprint-chromium';
export type FingerprintPlatform = 'windows' | 'macos' | 'linux';
export type FingerprintBrand = 'Chrome' | 'Edge' | 'Opera' | 'Vivaldi';

export interface FingerprintSpoofingOptions {
    canvas: boolean;
    audio: boolean;
    font: boolean;
    clientrects: boolean;
    gpu: boolean;
}

export interface DefaultFingerprintSettings {
    defaultEngine: BrowserEngineType;
    platform: FingerprintPlatform;
    brand: FingerprintBrand;
    autoMatchTimezone: boolean;
    autoMatchLanguage?: boolean;
    autoMatchGeolocation?: boolean;
    defaultLanguage: string;
    spoofing: FingerprintSpoofingOptions;
}

export interface AppSettings {
    dataPath: string;
    globalProxy?: {
        enabled: boolean;
        address: string;
    };
    startupUrl?: string;
    theme?: ThemeMode;
    locale?: AppLocale;
    memorySaverMode?: boolean;
    bookmarkTemplates?: BookmarkTemplate[];
    extensionTemplates?: ExtensionTemplate[];
    allowExtensionsOnFingerprintKernel?: boolean;
    requireHealthCheckOnLaunch?: boolean;
    groupStartupUrls?: Record<string, string>;
    fingerprint?: DefaultFingerprintSettings;
}

// 设置管理器类
export class SettingsManager {
    private store: Store<AppSettings>;

    constructor() {
        // 初始化存储
        this.store = new Store<AppSettings>({
            name: 'app-settings',
            schema: {
                dataPath: {
                    type: 'string',
                    default: app.getPath('userData'),
                },
                globalProxy: {
                    type: 'object',
                    properties: {
                        enabled: {
                            type: 'boolean',
                            default: false,
                        },
                        address: {
                            type: 'string',
                            default: '',
                        },
                    },
                    default: {
                        enabled: false,
                        address: '',
                    },
                },
                startupUrl: {
                    type: 'string',
                    default: '',
                },
                theme: {
                    type: 'string',
                    enum: ['system', 'light', 'dark'],
                    default: 'system',
                },
                locale: {
                    type: 'string',
                    enum: ['zh-CN', 'en-US'],
                    default: 'en-US',
                },
                memorySaverMode: {
                    type: 'boolean',
                    default: false,
                },
                bookmarkTemplates: {
                    type: 'array',
                    default: [],
                },
                extensionTemplates: {
                    type: 'array',
                    default: [],
                },
                allowExtensionsOnFingerprintKernel: {
                    type: 'boolean',
                    default: false,
                },
                requireHealthCheckOnLaunch: {
                    type: 'boolean',
                    default: false,
                },
                groupStartupUrls: {
                    type: 'object',
                    default: {},
                },
                fingerprint: {
                    type: 'object',
                    default:
                        DEFAULT_FINGERPRINT_SETTINGS as DefaultFingerprintSettings,
                },
            },
        });

        log.info('SettingsManager initialized');
    }

    // 获取应用设置
    public getSettings(): AppSettings {
        try {
            return {
                dataPath: this.store.get('dataPath'),
                globalProxy: this.store.get('globalProxy'),
                startupUrl: this.store.get('startupUrl'),
                theme: this.store.get('theme') || 'system',
                locale:
                    this.store.get('locale') === 'zh-CN' ? 'zh-CN' : 'en-US',
                memorySaverMode: Boolean(this.store.get('memorySaverMode')),
                bookmarkTemplates: normalizeBookmarkTemplates(
                    this.store.get('bookmarkTemplates'),
                ) as BookmarkTemplate[],
                extensionTemplates: normalizeExtensionTemplates(
                    this.store.get('extensionTemplates'),
                ) as ExtensionTemplate[],
                allowExtensionsOnFingerprintKernel: Boolean(
                    this.store.get('allowExtensionsOnFingerprintKernel'),
                ),
                requireHealthCheckOnLaunch: Boolean(
                    this.store.get('requireHealthCheckOnLaunch'),
                ),
                groupStartupUrls: normalizeGroupStartupUrls(
                    this.store.get('groupStartupUrls'),
                ) as Record<string, string>,
                fingerprint: normalizeDefaultFingerprintSettings(
                    this.store.get('fingerprint'),
                ) as DefaultFingerprintSettings,
            };
        } catch (error) {
            log.error('获取设置失败:', error);
            // 返回默认设置
            return {
                dataPath: app.getPath('userData'),
                globalProxy: {
                    enabled: false,
                    address: '',
                },
                startupUrl: '',
                theme: 'system',
                fingerprint: normalizeDefaultFingerprintSettings(
                    undefined,
                ) as DefaultFingerprintSettings,
            };
        }
    }

    // 保存应用设置
    public async saveSettings(settings: AppSettings): Promise<boolean> {
        try {
            // 验证路径是否有效
            if (!settings.dataPath || !this.isValidPath(settings.dataPath)) {
                log.error('无效的路径:', settings.dataPath);
                return false;
            }

            // 确保文件夹存在
            if (!fs.existsSync(settings.dataPath)) {
                fs.mkdirSync(settings.dataPath, { recursive: true });
            }

            // 检查文件夹是否可写
            try {
                const testFile = path.join(settings.dataPath, '.write-test');
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
            } catch (error) {
                log.error('路径不可写:', error);
                return false;
            }

            // 保存设置
            this.store.set('dataPath', settings.dataPath);

            // 保存全局代理设置
            if (settings.globalProxy !== undefined) {
                this.store.set('globalProxy', settings.globalProxy);
            }

            // 保存启动页设置
            if (settings.startupUrl !== undefined) {
                this.store.set('startupUrl', settings.startupUrl);
            }

            // 保存主题设置
            if (
                settings.theme === 'system' ||
                settings.theme === 'light' ||
                settings.theme === 'dark'
            ) {
                this.store.set('theme', settings.theme);
            }

            if (settings.locale === 'zh-CN' || settings.locale === 'en-US') {
                this.store.set('locale', settings.locale);
            }

            if (typeof settings.memorySaverMode === 'boolean') {
                this.store.set('memorySaverMode', settings.memorySaverMode);
            }

            if (settings.bookmarkTemplates !== undefined) {
                this.store.set(
                    'bookmarkTemplates',
                    normalizeBookmarkTemplates(
                        settings.bookmarkTemplates,
                    ) as BookmarkTemplate[],
                );
            }

            if (settings.extensionTemplates !== undefined) {
                this.store.set(
                    'extensionTemplates',
                    normalizeExtensionTemplates(
                        settings.extensionTemplates,
                    ) as ExtensionTemplate[],
                );
            }

            if (
                typeof settings.allowExtensionsOnFingerprintKernel === 'boolean'
            ) {
                this.store.set(
                    'allowExtensionsOnFingerprintKernel',
                    settings.allowExtensionsOnFingerprintKernel,
                );
            }

            if (typeof settings.requireHealthCheckOnLaunch === 'boolean') {
                this.store.set(
                    'requireHealthCheckOnLaunch',
                    settings.requireHealthCheckOnLaunch,
                );
            }

            if (settings.groupStartupUrls !== undefined) {
                this.store.set(
                    'groupStartupUrls',
                    normalizeGroupStartupUrls(
                        settings.groupStartupUrls,
                    ) as Record<string, string>,
                );
            }

            // 保存默认指纹与防泄露策略设置
            if (settings.fingerprint !== undefined) {
                const normalizedFp = normalizeDefaultFingerprintSettings(
                    settings.fingerprint,
                ) as DefaultFingerprintSettings;
                this.store.set('fingerprint', normalizedFp);
            }

            // 如果数据路径已更改，需要迁移数据
            const currentDataPath = app.getPath('userData');
            if (settings.dataPath !== currentDataPath) {
                log.info(
                    `数据路径已更改: ${currentDataPath} -> ${settings.dataPath}`,
                );
            }

            log.info('设置已保存');
            return true;
        } catch (error) {
            log.error('保存设置失败:', error);
            return false;
        }
    }

    // 检查路径是否有效
    private isValidPath(pathStr: string): boolean {
        try {
            // 检查路径是否绝对路径
            if (!path.isAbsolute(pathStr)) {
                log.error('路径不是绝对路径:', pathStr);
                return false;
            }

            // 检查路径是否包含非法字符 - Windows平台的特殊检查
            if (process.platform === 'win32') {
                const pathParts = pathStr.split(path.sep).filter(Boolean);
                const invalidChars = /[<>"|?*]/;

                for (const part of pathParts) {
                    if (invalidChars.test(part)) {
                        log.error('路径包含非法字符:', part);
                        return false;
                    }
                }

                const drivePattern = /^[A-Za-z]:$/;
                if (pathParts.length > 0 && !drivePattern.test(pathParts[0])) {
                    if (!pathStr.startsWith('\\\\')) {
                        log.error(
                            'Windows路径必须以有效的盘符开头:',
                            pathParts[0],
                        );
                        return false;
                    }
                }
            }

            return true;
        } catch (error) {
            log.error('验证路径失败:', error);
            return false;
        }
    }
}

export { SettingsManager as SettingsRepository };
