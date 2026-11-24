export function registerProxyIpc({ ipcMain, integration, validateId }) {
    const manager = integration.proxyManager;
    ipcMain.handle('proxies:list', () => manager.list());
    ipcMain.handle('proxies:core-info', () => manager.getCoreInfo());
    // A lookup is cancellable and must not block profile launches or stopping.
    ipcMain.handle('proxies:refresh-exit-info', (_, id) =>
        manager.refreshExitInfo(validateId(id)),
    );
    ipcMain.handle('proxies:editor', (_, id, asJson) =>
        manager.getEditor(validateId(id), asJson === true),
    );
    ipcMain.handle('proxies:config', (_, id, reveal) =>
        manager.getConfig(validateId(id), reveal === true),
    );
    ipcMain.handle('proxies:save', (_, input) =>
        integration.run(async () => {
            if (input?.id) {
                await integration.assertProxyUnused(validateId(input.id));
            }
            return manager.save(input);
        }),
    );
    ipcMain.handle('proxies:batch-import', (_, payload) =>
        integration.run(async () => manager.batchImport(payload)),
    );
    ipcMain.handle('proxies:remove', (_, id) =>
        integration.run(async () => {
            const validId = validateId(id);
            await integration.assertProxyUnused(validId, true);
            return manager.remove(validId);
        }),
    );
    ipcMain.handle('proxies:start', (_, id) =>
        integration.run(() => manager.ensureStarted(validateId(id))),
    );
    ipcMain.handle('proxies:stop', (_, id) =>
        integration.run(async () => {
            const validId = validateId(id);
            await integration.assertProxyUnused(validId);
            return manager.stop(validId);
        }),
    );
    ipcMain.handle('proxies:logs', (_, id) =>
        manager.getLogs(id ? validateId(id) : undefined),
    );
    ipcMain.handle('proxies:clear-logs', (_, id) =>
        integration.run(() =>
            manager.clearLogs(id ? validateId(id) : undefined),
        ),
    );
}
