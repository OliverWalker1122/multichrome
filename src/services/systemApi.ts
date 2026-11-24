import type { AppInfo, AppLog, AppSettings, ThemeMode } from '../types';
import { getAppPlatform, getElectronApi } from './ipcGateway';

export const systemApi = {
    getPlatform: getAppPlatform,

    hasSettingsApi: (): boolean => Boolean(getElectronApi()?.settings),

    getSettings: async (): Promise<AppSettings> => {
        const api = getElectronApi()?.settings;
        if (!api) throw new Error('Settings API is not loaded properly');
        return api.getSettings();
    },

    saveSettings: async (settings: AppSettings): Promise<boolean> => {
        const api = getElectronApi()?.settings;
        if (!api) throw new Error('Settings API is not loaded properly');
        return api.saveSettings(settings);
    },

    selectFolder: async (): Promise<{
        canceled: boolean;
        filePaths: string[];
    }> => {
        const api = getElectronApi()?.settings;
        if (!api) return { canceled: true, filePaths: [] };
        return api.selectFolder();
    },

    getAppInfo: async (): Promise<AppInfo | null> => {
        const api = getElectronApi()?.app;
        if (!api?.getInfo) return null;
        return api.getInfo();
    },

    openExternal: async (url: string): Promise<boolean> => {
        const fn = getElectronApi()?.app?.openExternal;
        if (!fn) return false;
        return fn(url);
    },

    checkUpdate: async () => {
        const fn = getElectronApi()?.app?.checkUpdate;
        if (!fn) return null;
        return fn();
    },

    setTheme: async (theme: ThemeMode, isDark: boolean): Promise<boolean> => {
        const fn = getElectronApi()?.app?.setTheme;
        if (!fn) return false;
        return fn(theme, isDark);
    },

    getAppLogs: async (): Promise<AppLog[]> => {
        const api = getElectronApi()?.appLogs;
        if (!api) return [];
        return api.getLogs();
    },

    clearAppLogs: async (): Promise<void> => {
        const api = getElectronApi()?.appLogs;
        if (!api) return;
        return api.clearLogs();
    },
};
