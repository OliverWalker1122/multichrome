import type { BrowserWindow, IpcMain } from 'electron';
import type { EnvironmentService } from '../services/environmentService.js';
import type { ProxyService } from '../services/proxyService.js';
import type { ProxyCoordinator } from '../services/proxyCoordinator.js';
import type { KernelService } from '../services/kernelService.js';
import type { BackupService } from '../services/backupService.js';
import type { SettingsManager } from '../repositories/settingsRepository.js';
import { registerAutomationIpc } from './automationIpc.js';
import { registerEnvironmentIpc } from './environmentIpc.js';
import { registerProxyIpc } from './proxyIpc.js';
import { registerSystemIpc } from './systemIpc.js';
import { validateId } from './validators.js';

export interface AutomationIpcServicePort {
    getStatus: () => unknown;
    updateConfig: (patch: unknown) => Promise<unknown>;
    pickAvailablePort: () => Promise<unknown>;
    setActiveProfile: (profileId: unknown) => Promise<unknown>;
}

export interface RegisterAllIpcDeps {
    ipcMain: IpcMain;
    getMainWindow: () => BrowserWindow | null;
    environmentService: EnvironmentService;
    proxyService: ProxyService;
    proxyCoordinator: ProxyCoordinator;
    kernelService: KernelService;
    backupService: BackupService;
    settingsRepository: SettingsManager;
    automationService: AutomationIpcServicePort;
    applicationLogs: {
        getLogs: () => unknown[];
        clearLogs: () => void;
    };
    isEnglishLocale: () => boolean;
    onSettingsSaved: () => void;
    getTitleBarOverlay: (isDark: boolean) => {
        color: string;
        symbolColor: string;
        height: number;
    };
    flashWindowHighlight?: (
        bounds: {
            left: number;
            top: number;
            width: number;
            height: number;
            windowState?: string;
        } | null,
        label: string,
    ) => boolean;
}

export function registerAllIpcHandlers(deps: RegisterAllIpcDeps): void {
    registerProxyIpc({
        ipcMain: deps.ipcMain,
        integration: deps.proxyCoordinator,
        validateId,
    });
    registerAutomationIpc({
        ipcMain: deps.ipcMain,
        integration: deps.automationService,
    });
    registerEnvironmentIpc({
        ipcMain: deps.ipcMain,
        getMainWindow: deps.getMainWindow,
        chromeManager: deps.environmentService,
        settingsManager: deps.settingsRepository,
        proxyIntegration: deps.proxyCoordinator,
        flashWindowHighlight: deps.flashWindowHighlight,
    });
    registerSystemIpc({
        ipcMain: deps.ipcMain,
        getMainWindow: deps.getMainWindow,
        settingsManager: deps.settingsRepository,
        kernelManager: deps.kernelService,
        proxyManager: deps.proxyService,
        chromeManager: deps.environmentService,
        backupService: deps.backupService,
        getAutomationStatus: () =>
            deps.automationService.getStatus() as {
                enabled?: boolean;
                port?: number;
                running?: boolean;
            },
        applicationLogs: deps.applicationLogs,
        isEnglishLocale: deps.isEnglishLocale,
        onSettingsSaved: deps.onSettingsSaved,
        getTitleBarOverlay: deps.getTitleBarOverlay,
    });
}
