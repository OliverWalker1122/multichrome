import type {
    InstalledKernel,
    InstalledSingboxCore,
    KernelDownloadProgress,
    KernelOpenDirTarget,
    KernelStatus,
} from '../types';
import { getElectronApi, subscribeIpcEvent } from './ipcGateway';

export const kernelApi = {
    isAvailable: (): boolean => Boolean(getElectronApi()?.kernels),

    getStatus: async (): Promise<KernelStatus | null> => {
        const api = getElectronApi()?.kernels;
        if (!api?.getStatus) return null;
        return api.getStatus();
    },

    refreshReleases: async (options?: {
        proxyId?: string;
        useGlobalProxy?: boolean;
    }): Promise<KernelStatus> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.refreshReleases(options);
    },

    download: async (
        version: string,
        options?: { proxyId?: string; useGlobalProxy?: boolean },
    ): Promise<{ installed: InstalledKernel; status: KernelStatus }> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.download(version, options);
    },

    cancelDownload: async (
        target?: 'fingerprint-chromium' | 'sing-box',
    ): Promise<boolean> => {
        const api = getElectronApi()?.kernels;
        if (!api) return false;
        return api.cancelDownload(target);
    },

    importLocal: async (
        mode?: 'file' | 'folder',
    ): Promise<{
        canceled: boolean;
        installed?: InstalledKernel;
        status: KernelStatus;
    }> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.importLocal(mode);
    },

    setActive: async (kernelId: string): Promise<KernelStatus> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.setActive(kernelId);
    },

    remove: async (kernelId: string): Promise<KernelStatus> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.remove(kernelId);
    },

    refreshSingboxReleases: async (options?: {
        useGlobalProxy?: boolean;
    }): Promise<KernelStatus> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.refreshSingboxReleases(options);
    },

    downloadSingbox: async (
        version: string,
        options?: { useGlobalProxy?: boolean },
    ): Promise<{ installed: InstalledSingboxCore; status: KernelStatus }> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.downloadSingbox(version, options);
    },

    importLocalSingbox: async (): Promise<{
        canceled: boolean;
        installed?: InstalledSingboxCore;
        status: KernelStatus;
    }> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.importLocalSingbox();
    },

    setActiveSingbox: async (kernelId: string): Promise<KernelStatus> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.setActiveSingbox(kernelId);
    },

    removeSingbox: async (kernelId: string): Promise<KernelStatus> => {
        const api = getElectronApi()?.kernels;
        if (!api) throw new Error('Kernel API unavailable');
        return api.removeSingbox(kernelId);
    },

    openDir: async (target?: KernelOpenDirTarget): Promise<boolean> => {
        const api = getElectronApi()?.kernels;
        if (!api) return false;
        return api.openDir(target);
    },

    onDownloadProgress: (
        handler: (progress: KernelDownloadProgress) => void,
    ): (() => void) =>
        subscribeIpcEvent('kernel-download-progress', (arg) => {
            if (arg && typeof arg === 'object') {
                handler(arg as KernelDownloadProgress);
            }
        }),
};
