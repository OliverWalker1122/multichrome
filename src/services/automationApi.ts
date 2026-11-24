import type { AutomationConfigPatch, AutomationStatus } from '../types';
import { getElectronApi, subscribeIpcEvent } from './ipcGateway';

export const automationApi = {
    isAvailable: (): boolean => Boolean(getElectronApi()?.automation),

    canPickAvailablePort: (): boolean =>
        Boolean(getElectronApi()?.automation?.pickAvailablePort),

    getStatus: async (): Promise<AutomationStatus | null> => {
        const api = getElectronApi()?.automation;
        if (!api?.getStatus) return null;
        return api.getStatus();
    },

    updateConfig: async (
        patch: AutomationConfigPatch,
    ): Promise<AutomationStatus> => {
        const api = getElectronApi()?.automation;
        if (!api?.updateConfig) throw new Error('Automation API unavailable');
        return api.updateConfig(patch);
    },

    pickAvailablePort: async (): Promise<AutomationStatus> => {
        const api = getElectronApi()?.automation;
        if (!api?.pickAvailablePort) {
            throw new Error('Automation port picker unavailable');
        }
        return api.pickAvailablePort();
    },

    setActiveProfile: async (
        profileId: string | null,
    ): Promise<AutomationStatus> => {
        const api = getElectronApi()?.automation;
        if (!api?.setActiveProfile) {
            throw new Error('Automation active profile switcher unavailable');
        }
        return api.setActiveProfile(profileId);
    },

    onStateChanged: (
        handler: (status: AutomationStatus) => void,
    ): (() => void) =>
        subscribeIpcEvent('automation-state-changed', (arg) => {
            if (arg && typeof arg === 'object') {
                handler(arg as AutomationStatus);
            }
        }),
};
