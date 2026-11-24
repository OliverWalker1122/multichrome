import type { ElectronAPI } from '../types';

/**
 * Frontend Layer 1 IPC Gateway.
 *
 * This module is the ONLY place in `src/` permitted to access `window.electronAPI`
 * directly. All contexts, hooks, and UI components must go through `src/services/*`.
 */
export function getElectronApi(): ElectronAPI | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return window.electronAPI;
}

export function isElectronAvailable(): boolean {
    return Boolean(getElectronApi());
}

export function getAppPlatform(): string {
    return getElectronApi()?.app?.platform || '';
}

export function subscribeIpcEvent(
    channel: string,
    callback: (payload: unknown) => void,
): () => void {
    const api = getElectronApi();
    if (!api?.on) {
        return () => {};
    }
    const listener = (...args: unknown[]) => {
        callback(args.length > 1 ? args[1] : args[0]);
    };
    api.on(channel, listener);
    return () => {
        api.removeListener?.(channel, listener);
    };
}
