import type {
    BrowserEngineType,
    ChromeEnvironment,
    ClearEnvironmentCacheResult,
    DeleteGroupOptions,
    DeleteGroupResult,
    EnvironmentHealthReport,
    EnvironmentStorageStats,
    FingerprintConfig,
    LaunchConsistencyReport,
    RenameGroupResult,
    RunningResourceStats,
} from '../types';
import { getElectronApi, subscribeIpcEvent } from './ipcGateway';

export function hasEnvironmentApi(): boolean {
    return Boolean(getElectronApi()?.chromeEnvironments);
}

export function hasTrashApi(): boolean {
    return Boolean(getElectronApi()?.trash);
}

export const environmentApi = {
    isAvailable: hasEnvironmentApi,

    getAll: async (): Promise<ChromeEnvironment[]> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) return [];
        return api.getAll();
    },

    create: async (
        name: string,
        groupName: string,
        notes: string,
        options?: {
            browserEngine?: BrowserEngineType;
            fingerprintConfig?: Partial<FingerprintConfig>;
            proxyId?: string;
            proxy?: string;
            proxyLabel?: string;
            tags?: string[];
        },
    ): Promise<ChromeEnvironment> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) throw new Error('Electron API failed to load');
        return api.create(name, groupName, notes, options);
    },

    clone: async (id: string, customName?: string): Promise<ChromeEnvironment> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api?.clone) throw new Error('Electron API failed to load');
        return api.clone(id, customName);
    },

    regenerateFingerprint: async (id: string): Promise<ChromeEnvironment> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api?.regenerateFingerprint) {
            throw new Error('Electron API failed to load');
        }
        return api.regenerateFingerprint(id);
    },

    launch: async (id: string): Promise<boolean> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) throw new Error('Electron API failed to load');
        return api.launch(id);
    },

    checkLaunchConsistency: async (
        id: string,
    ): Promise<LaunchConsistencyReport | null> => {
        const fn = getElectronApi()?.chromeEnvironments?.checkLaunchConsistency;
        if (!fn) return null;
        return fn(id);
    },

    inspectHealth: async (
        id: string,
    ): Promise<EnvironmentHealthReport | null> => {
        const fn = getElectronApi()?.chromeEnvironments?.inspectHealth;
        if (!fn) return null;
        return fn(id);
    },

    openUrl: async (id: string, url: string): Promise<boolean> => {
        const fn = getElectronApi()?.chromeEnvironments?.openUrl;
        if (!fn) throw new Error('Electron API failed to load');
        return fn(id, url);
    },

    close: async (id: string): Promise<boolean> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) throw new Error('Electron API failed to load');
        return api.close(id);
    },

    closeAll: async (): Promise<
        number | { closedCount: number; failedCount: number }
    > => {
        const fn = getElectronApi()?.chromeEnvironments?.closeAll;
        if (!fn) throw new Error('Electron API failed to load');
        return fn();
    },

    getRunningResourceStats: async (): Promise<RunningResourceStats | null> => {
        const fn = getElectronApi()?.chromeEnvironments?.getRunningResourceStats;
        if (!fn) return null;
        return fn();
    },

    getStorageStats: async (
        id: string,
    ): Promise<EnvironmentStorageStats | null> => {
        const fn = getElectronApi()?.chromeEnvironments?.getStorageStats;
        if (!fn) return null;
        return fn(id);
    },

    clearCache: async (id: string): Promise<ClearEnvironmentCacheResult> => {
        const fn = getElectronApi()?.chromeEnvironments?.clearCache;
        if (!fn) throw new Error('Electron API failed to load');
        return fn(id);
    },

    openDataDir: async (id: string): Promise<boolean> => {
        const fn = getElectronApi()?.chromeEnvironments?.openDataDir;
        if (!fn) return false;
        return fn(id);
    },

    delete: async (id: string): Promise<boolean> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) throw new Error('Electron API failed to load');
        return api.delete(id);
    },

    update: async (
        id: string,
        data: Partial<ChromeEnvironment>,
    ): Promise<ChromeEnvironment> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) throw new Error('Electron API failed to load');
        return api.update(id, data);
    },

    getEmptyGroups: async (): Promise<string[]> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) return [];
        return api.getEmptyGroups();
    },

    renameGroup: async (
        oldName: string,
        newName: string,
    ): Promise<RenameGroupResult> => {
        const fn = getElectronApi()?.chromeEnvironments?.renameGroup;
        if (!fn) throw new Error('Electron API failed to load');
        return fn(oldName, newName);
    },

    deleteGroup: async (
        groupName: string,
        options?: DeleteGroupOptions,
    ): Promise<DeleteGroupResult> => {
        const fn = getElectronApi()?.chromeEnvironments?.deleteGroup;
        if (!fn) throw new Error('Electron API failed to load');
        return fn(groupName, options);
    },

    deleteEmptyGroup: async (groupName: string): Promise<boolean> => {
        const api = getElectronApi()?.chromeEnvironments;
        if (!api) throw new Error('Electron API failed to load');
        return api.deleteEmptyGroup(groupName);
    },

    onStatusChanged: (handler: () => void): (() => void) =>
        subscribeIpcEvent('chrome-status-changed', handler),
};

export const trashApi = {
    isAvailable: hasTrashApi,

    getDeletedEnvironments: async (): Promise<ChromeEnvironment[]> => {
        const api = getElectronApi()?.trash;
        if (!api) return [];
        return api.getDeletedEnvironments();
    },

    restore: async (id: string): Promise<boolean> => {
        const api = getElectronApi()?.trash;
        if (!api) throw new Error('Trash API unavailable');
        return api.restore(id);
    },

    permanentlyDelete: async (id: string): Promise<boolean> => {
        const api = getElectronApi()?.trash;
        if (!api) throw new Error('Trash API unavailable');
        return api.permanentlyDelete(id);
    },

    cleanup: async (): Promise<number> => {
        const api = getElectronApi()?.trash;
        if (!api) throw new Error('Trash API unavailable');
        return api.cleanup();
    },
};
