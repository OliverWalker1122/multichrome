import type {
    BatchImportProxiesInput,
    BatchImportProxiesResult,
    ManagedProxy,
    ProxyConfigView,
    ProxyCoreInfo,
    ProxyExitInfo,
    ProxyInput,
    ProxyLog,
} from '../types';
import { getElectronApi, subscribeIpcEvent } from './ipcGateway';

export const proxyApi = {
    isAvailable: (): boolean => Boolean(getElectronApi()?.proxies),

    list: async (): Promise<ManagedProxy[]> => {
        const api = getElectronApi()?.proxies;
        if (!api) return [];
        return api.list();
    },

    save: async (input: ProxyInput): Promise<ManagedProxy> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.save(input);
    },

    batchImport: async (
        input: BatchImportProxiesInput,
    ): Promise<BatchImportProxiesResult> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.batchImport(input);
    },

    remove: async (id: string): Promise<void> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.remove(id);
    },

    start: async (id: string): Promise<string> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.start(id);
    },

    stop: async (id: string): Promise<void> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.stop(id);
    },

    refreshExitInfo: async (id: string): Promise<ProxyExitInfo> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.refreshExitInfo(id);
    },

    getLogs: async (id?: string): Promise<ProxyLog[]> => {
        const api = getElectronApi()?.proxies;
        if (!api) return [];
        return api.getLogs(id);
    },

    clearLogs: async (id?: string): Promise<void> => {
        const api = getElectronApi()?.proxies;
        if (!api) return;
        return api.clearLogs(id);
    },

    getEditor: async (
        id: string,
        asJson?: boolean,
    ): Promise<{
        mode: 'simple' | 'json';
        config?: string;
        rotationUrl?: string;
    }> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.getEditor(id, asJson);
    },

    rotateIp: async (
        id: string,
    ): Promise<{
        ok: boolean;
        statusCode: number;
        exitInfo?: ProxyExitInfo;
    }> => {
        const fn = getElectronApi()?.proxies?.rotateIp;
        if (!fn) throw new Error('Proxy API unavailable');
        return fn(id);
    },

    batchRemove: async (
        ids: string[],
    ): Promise<{ removedCount: number; skippedInUseCount: number }> => {
        const fn = getElectronApi()?.proxies?.batchRemove;
        if (!fn) throw new Error('Proxy API unavailable');
        return fn(ids);
    },

    getConfig: async (id: string, reveal?: boolean): Promise<ProxyConfigView> => {
        const api = getElectronApi()?.proxies;
        if (!api) throw new Error('Proxy API unavailable');
        return api.getConfig(id, reveal);
    },

    getCoreInfo: async (): Promise<ProxyCoreInfo | null> => {
        const api = getElectronApi()?.proxies;
        if (!api) return null;
        return api.getCoreInfo();
    },

    onStateChanged: (
        handler: (payload?: { state?: boolean; log?: boolean }) => void,
    ): (() => void) =>
        subscribeIpcEvent('proxy-state-changed', (arg) => {
            handler(arg as { state?: boolean; log?: boolean } | undefined);
        }),
};
