export function registerAutomationIpc({ ipcMain, integration }) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') {
        throw new Error('registerAutomationIpc requires ipcMain');
    }
    if (!integration) {
        throw new Error('registerAutomationIpc requires integration');
    }
    ipcMain.handle('automation:test-connection', () => integration.testConnection());
    ipcMain.handle('automation:get-status', () => integration.getStatus());
    ipcMain.handle('automation:update-config', (_, patch) =>
        integration.updateConfig(patch),
    );
    ipcMain.handle('automation:pick-available-port', () =>
        integration.pickAvailablePort(),
    );
    ipcMain.handle('automation:set-active-profile', (_, profileId) =>
        integration.setActiveProfile(profileId),
    );
    ipcMain.handle('automation:get-token', () => integration.getToken());
    ipcMain.handle('automation:rotate-token', () => integration.rotateToken());
}
