export type WorkspaceSection =
    'environments' | 'proxies' | 'trash' | 'settings';

export interface LogDockPreference {
    open: boolean;
    height: number;
}

export type LogDockPreferences = Record<WorkspaceSection, LogDockPreference>;

const PREFERENCES_KEY = 'multichrome.log-dock.v1';

export function loadLogDockPreferences(
    storage?: Pick<Storage, 'getItem'>,
): LogDockPreferences {
    const defaults: LogDockPreferences = {
        environments: { open: false, height: 170 },
        proxies: { open: true, height: 170 },
        trash: { open: false, height: 170 },
        settings: { open: false, height: 170 },
    };
    try {
        const source = storage ?? window.localStorage;
        const saved = JSON.parse(source.getItem(PREFERENCES_KEY) || '{}');
        for (const section of Object.keys(defaults) as WorkspaceSection[]) {
            const value = saved?.[section];
            if (typeof value?.open === 'boolean')
                defaults[section].open = value.open;
            if (
                typeof value?.height === 'number' &&
                Number.isFinite(value.height)
            ) {
                defaults[section].height = Math.min(
                    420,
                    Math.max(120, value.height),
                );
            }
        }
    } catch {
        // Preferences are optional; unavailable storage must not block the app.
    }
    return defaults;
}

export function saveLogDockPreferences(preferences: LogDockPreferences): void {
    try {
        window.localStorage.setItem(
            PREFERENCES_KEY,
            JSON.stringify(preferences),
        );
    } catch {
        // Keep the current session usable when storage is unavailable.
    }
}

export type LogTarget =
    | { kind: 'all'; label: string }
    | { kind: 'proxy'; proxyId: string; label: string }
    | { kind: 'none'; label: string; emptyMessage: string };

interface LogTargetInput {
    section: WorkspaceSection;
    scope: string;
    selectedEnvironment: { proxyId?: string } | null;
    selectedProxyId: string | null;
    proxies: { id: string; name: string }[];
    locale?: 'zh-CN' | 'en-US';
}

export function resolveLogTarget(input: LogTargetInput): LogTarget {
    const {
        section,
        scope,
        selectedEnvironment,
        selectedProxyId,
        proxies,
        locale = 'zh-CN',
    } = input;
    const isEn = locale === 'en-US';
    if (scope === '__all__') {
        return { kind: 'all', label: isEn ? 'All Proxies' : '全部代理' };
    }

    const following = scope === '__selected__';
    const proxyId = following
        ? section === 'environments'
            ? selectedEnvironment?.proxyId
            : section === 'proxies'
              ? selectedProxyId
              : null
        : scope;
    const proxy = proxies.find((item) => item.id === proxyId);
    if (proxy) {
        return {
            kind: 'proxy',
            proxyId: proxy.id,
            label: isEn
                ? `${following ? 'Follow Selected' : 'Pinned'}: ${proxy.name}`
                : `${following ? '跟随所选' : '固定'}：${proxy.name}`,
        };
    }

    let emptyMessage = isEn
        ? 'This proxy has been removed. Please choose another log scope.'
        : '此代理已移除，请重新选择日志范围。';
    if (following) {
        if (section === 'environments') {
            emptyMessage = selectedEnvironment
                ? isEn
                    ? 'This environment has no bound built-in proxy; no proxy logs available.'
                    : '此环境未绑定可用的内置代理，暂无代理日志。'
                : isEn
                  ? 'Select an environment to inspect its proxy logs.'
                  : '请选择一个环境，查看它使用的代理日志。';
        } else if (section === 'proxies') {
            emptyMessage = isEn
                ? 'Select a proxy to inspect its connection and runtime logs.'
                : '请选择一个代理，查看它的连接与运行记录。';
        } else {
            emptyMessage = isEn
                ? 'Switch to Environments or Proxies, or choose "All Proxies".'
                : '请切换到环境或代理页面，或选择“全部代理”。';
        }
    }
    return {
        kind: 'none',
        label: following
            ? isEn
                ? 'Follow Selected: None'
                : '跟随所选：未选择代理'
            : isEn
              ? 'Pinned: Proxy Removed'
              : '固定：代理已移除',
        emptyMessage,
    };
}

// Undefined is an intentional "all proxies" request in the IPC API. An empty
// selection must be handled before calling it, for both reads and deletion.
export function readTargetLogs<T>(
    target: LogTarget,
    read: (proxyId?: string) => Promise<T[]>,
): Promise<T[]> {
    if (target.kind === 'none') return Promise.resolve([]);
    return read(target.kind === 'proxy' ? target.proxyId : undefined);
}

export function clearTargetLogs(
    target: LogTarget,
    clear: (proxyId?: string) => Promise<void>,
): Promise<void> {
    if (target.kind === 'none') return Promise.resolve();
    return clear(target.kind === 'proxy' ? target.proxyId : undefined);
}
