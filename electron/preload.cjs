const { contextBridge, ipcRenderer } = require('electron');

const VALID_EVENT_CHANNELS = [
    'chrome-status-changed',
    'kernel-download-progress',
    'proxy-state-changed',
    'automation-state-changed',
];

try {
    // 暴露给渲染进程的安全API
    contextBridge.exposeInMainWorld('electronAPI', {
        proxies: {
            list: () => ipcRenderer.invoke('proxies:list'),
            getCoreInfo: () => ipcRenderer.invoke('proxies:core-info'),
            getEditor: (id, asJson = false) =>
                ipcRenderer.invoke('proxies:editor', id, asJson),
            getConfig: (id, reveal = false) =>
                ipcRenderer.invoke('proxies:config', id, reveal),
            save: (input) => ipcRenderer.invoke('proxies:save', input),
            batchImport: (payload) =>
                ipcRenderer.invoke('proxies:batch-import', payload),
            remove: (id) => ipcRenderer.invoke('proxies:remove', id),
            start: (id) => ipcRenderer.invoke('proxies:start', id),
            stop: (id) => ipcRenderer.invoke('proxies:stop', id),
            refreshExitInfo: (id) =>
                ipcRenderer.invoke('proxies:refresh-exit-info', id),
            getLogs: (id) => ipcRenderer.invoke('proxies:logs', id),
            clearLogs: (id) => ipcRenderer.invoke('proxies:clear-logs', id),
            rotateIp: (id) => ipcRenderer.invoke('proxies:rotate-ip', id),
            batchRemove: (ids) => ipcRenderer.invoke('proxies:batch-remove', ids),
        },
        appLogs: {
            getLogs: () => ipcRenderer.invoke('app:logs'),
            clearLogs: () => ipcRenderer.invoke('app:clear-logs'),
        },
        // Chrome环境管理API
        chromeEnvironments: {
            // 获取所有环境
            getAll: () => ipcRenderer.invoke('get-chrome-environments'),

            // 创建新环境
            create: (name, groupName, notes, options) =>
                ipcRenderer.invoke(
                    'create-chrome-environment',
                    name,
                    groupName,
                    notes,
                    options,
                ),

            // 克隆环境（生成全新指纹与独立目录）
            clone: (id, customName) =>
                ipcRenderer.invoke('clone-chrome-environment', id, customName),

            // 统计环境磁盘占用与缓存
            getStorageStats: (id) =>
                ipcRenderer.invoke('get-environment-storage', id),

            // 清理环境缓存（保留 Cookie 与登录态）
            clearCache: (id) =>
                ipcRenderer.invoke('clear-environment-cache', id),

            // 在文件管理器中打开环境目录
            openDataDir: (id) =>
                ipcRenderer.invoke('open-environment-data-dir', id),

            // 重新生成环境持久化指纹
            regenerateFingerprint: (id) =>
                ipcRenderer.invoke('regenerate-environment-fingerprint', id),

            // 启动环境
            launch: (id) => ipcRenderer.invoke('launch-chrome-environment', id),

            // 启动前一致性护栏校验
            checkLaunchConsistency: (id) =>
                ipcRenderer.invoke('check-environment-launch-consistency', id),

            // 一键防泄露 / 指纹健康自检
            inspectHealth: (id) =>
                ipcRenderer.invoke('inspect-environment-health', id),

            // 在已运行环境中打开指定检测链接
            openUrl: (id, url) =>
                ipcRenderer.invoke('open-url-in-environment', id, url),

            // 关闭环境
            close: (id) => ipcRenderer.invoke('close-chrome-environment', id),

            // 一键关闭全部运行中的环境
            closeAll: () => ipcRenderer.invoke('close-all-chrome-environments'),

            // 获取运行中环境的实时内存占用统计
            getRunningResourceStats: () =>
                ipcRenderer.invoke('get-running-resource-stats'),

            // 软删除环境（移到回收站）
            delete: (id) => ipcRenderer.invoke('delete-chrome-environment', id),

            // 更新环境
            update: (id, data) =>
                ipcRenderer.invoke('update-chrome-environment', id, data),

            // 获取空分组
            getEmptyGroups: () => ipcRenderer.invoke('get-empty-groups'),

            // 重命名分组
            renameGroup: (oldName, newName) =>
                ipcRenderer.invoke('rename-group', oldName, newName),

            // 删除分组（支持迁移或移入回收站）
            deleteGroup: (groupName, options) =>
                ipcRenderer.invoke('delete-group', groupName, options),

            // 删除空分组
            deleteEmptyGroup: (groupName) =>
                ipcRenderer.invoke('delete-empty-group', groupName),

            // 批量创建环境
            batchCreate: (payload) =>
                ipcRenderer.invoke('batch-create-environments', payload),

            // 批量操作环境
            batchAction: (payload) =>
                ipcRenderer.invoke('batch-action-environments', payload),

            // 原生 CDP Cookie 导出
            exportCookies: (id, format = 'json') =>
                ipcRenderer.invoke('export-environment-cookies', id, format),

            // 原生 CDP Cookie 导入
            importCookies: (id, rawText) =>
                ipcRenderer.invoke('import-environment-cookies', id, rawText),

            // 多窗口排列（无缝宫格平铺 / 分屏平铺 / 统一尺寸堆叠 / 阶梯层叠 / 最小化 / 恢复）
            tileWindows: (options) =>
                ipcRenderer.invoke('tile-chrome-windows', options),

            // 定位并置顶运行中环境的浏览器窗口（可选 highlightOnly 仅高亮不抢焦点）
            focusWindow: (id, options) =>
                ipcRenderer.invoke(
                    'focus-chrome-environment-window',
                    id,
                    options,
                ),
        },

        // 回收站管理API
        trash: {
            // 获取回收站中的环境
            getDeletedEnvironments: () =>
                ipcRenderer.invoke('get-deleted-environments'),

            // 从回收站恢复环境
            restore: (id) =>
                ipcRenderer.invoke('restore-chrome-environment', id),

            // 永久删除环境
            permanentlyDelete: (id) =>
                ipcRenderer.invoke('permanently-delete-environment', id),

            // 清空回收站
            cleanup: () => ipcRenderer.invoke('cleanup-trash'),
        },
        // 设置API
        settings: {
            // 获取应用设置
            getSettings: () => ipcRenderer.invoke('get-settings'),

            // 保存应用设置
            saveSettings: (settings) =>
                ipcRenderer.invoke('save-settings', settings),

            // 选择文件夹
            selectFolder: () => ipcRenderer.invoke('select-folder'),

            // 打开本地配置文件目录
            openConfigDir: () => ipcRenderer.invoke('settings:open-config-dir'),
        },

        // 浏览器内核与 sing-box 代理核心管理API
        kernels: {
            getStatus: () => ipcRenderer.invoke('kernels:status'),
            refreshReleases: (options) =>
                ipcRenderer.invoke('kernels:refresh-releases', options),
            download: (version, options) =>
                ipcRenderer.invoke('kernels:download', version, options),
            cancelDownload: (target = 'fingerprint-chromium') =>
                ipcRenderer.invoke('kernels:cancel-download', target),
            importLocal: (mode = 'file') =>
                ipcRenderer.invoke('kernels:import-local', mode),
            setActive: (kernelId) =>
                ipcRenderer.invoke('kernels:set-active', kernelId),
            remove: (kernelId) =>
                ipcRenderer.invoke('kernels:remove', kernelId),
            refreshSingboxReleases: (options) =>
                ipcRenderer.invoke('kernels:refresh-singbox-releases', options),
            downloadSingbox: (version, options) =>
                ipcRenderer.invoke('kernels:download-singbox', version, options),
            importLocalSingbox: () =>
                ipcRenderer.invoke('kernels:import-local-singbox'),
            setActiveSingbox: (kernelId) =>
                ipcRenderer.invoke('kernels:set-active-singbox', kernelId),
            removeSingbox: (kernelId) =>
                ipcRenderer.invoke('kernels:remove-singbox', kernelId),
            openDir: (target) => ipcRenderer.invoke('kernels:open-dir', target),
        },

        // 本地 CDP 透传守卫与 MCP 服务
        automation: {
            testConnection: () => ipcRenderer.invoke('automation:test-connection'),
            getStatus: () => ipcRenderer.invoke('automation:get-status'),
            updateConfig: (patch) =>
                ipcRenderer.invoke('automation:update-config', patch),
            pickAvailablePort: () =>
                ipcRenderer.invoke('automation:pick-available-port'),
            setActiveProfile: (profileId) =>
                ipcRenderer.invoke('automation:set-active-profile', profileId),
            getToken: () => ipcRenderer.invoke('automation:get-token'),
            rotateToken: () => ipcRenderer.invoke('automation:rotate-token'),
        },

        // 应用与窗口API
        app: {
            getInfo: () => ipcRenderer.invoke('app:get-info'),
            openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
            checkUpdate: () => ipcRenderer.invoke('app:check-update'),
            downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
            exportDiagnostics: () => ipcRenderer.invoke('app:export-diagnostics'),
            exportBackup: (password) =>
                ipcRenderer.invoke('backup:export', password),
            restoreBackup: (password) =>
                ipcRenderer.invoke('backup:restore', password),
            setTheme: (theme, isDark) =>
                ipcRenderer.invoke('window:set-theme', theme, isDark),
            platform: process.platform,
        },

        // 事件监听API
        on: (channel, callback) => {
            if (VALID_EVENT_CHANNELS.includes(channel)) {
                ipcRenderer.on(channel, callback);
            }
        },

        removeListener: (channel, callback) => {
            if (VALID_EVENT_CHANNELS.includes(channel)) {
                ipcRenderer.removeListener(channel, callback);
            }
        },
    });
} catch (error) {
    console.error('预加载脚本执行失败:', error);
}
