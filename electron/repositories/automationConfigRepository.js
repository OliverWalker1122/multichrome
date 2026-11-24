import {
    DEFAULT_AUTOMATION_PORT,
    validateAutomationPort,
} from '../domain/automationPolicy.js';

const AUTOMATION_STORE_KEY = 'automation';

function isEnLocale(getLocale) {
    try {
        return typeof getLocale === 'function' && getLocale() === 'en-US';
    } catch {
        return false;
    }
}

export class AutomationConfigRepository {
    /**
     * @param {{
     *   store: { get: (key: string, fallback?: any) => any, set: (key: string, value: any) => void },
     *   defaultPort?: number,
     *   getLocale?: (() => string) | null,
     * }} options
     */
    constructor({
        store,
        defaultPort = DEFAULT_AUTOMATION_PORT,
        getLocale = null,
    }) {
        if (
            !store ||
            typeof store.get !== 'function' ||
            typeof store.set !== 'function'
        ) {
            throw new Error('AutomationConfigManager requires a valid store');
        }
        this.store = store;
        this.getLocale = typeof getLocale === 'function' ? getLocale : null;

        let validatedDefaultPort = DEFAULT_AUTOMATION_PORT;
        try {
            validatedDefaultPort = validateAutomationPort(defaultPort);
        } catch {
            validatedDefaultPort = DEFAULT_AUTOMATION_PORT;
        }
        this.defaultPort = validatedDefaultPort;

        this.state = this.loadState();
    }

    loadState() {
        const raw = this.store.get(AUTOMATION_STORE_KEY, null);
        const obj =
            raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

        let port = this.defaultPort;
        try {
            if (obj.port !== undefined) {
                port = validateAutomationPort(obj.port);
            }
        } catch {
            port = this.defaultPort;
        }

        const enabled =
            typeof obj.enabled === 'boolean'
                ? obj.enabled
                : Boolean(obj.localApiEnabled || obj.mcpEnabled);

        return {
            enabled,
            port,
        };
    }

    persistState(nextState) {
        const enabled = Boolean(nextState.enabled);
        const persisted = {
            enabled,
            // Preserve legacy booleans in store for backward compatibility across versions
            localApiEnabled: enabled,
            mcpEnabled: enabled,
            port: nextState.port,
        };
        this.store.set(AUTOMATION_STORE_KEY, persisted);
        this.state = {
            enabled,
            port: nextState.port,
        };
        return this.state;
    }

    getConfig() {
        return {
            enabled: this.state.enabled,
            localApiEnabled: this.state.enabled,
            mcpEnabled: this.state.enabled,
            port: this.state.port,
        };
    }

    updateConfig(patch = {}) {
        const en = isEnLocale(this.getLocale);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new Error(
                en ? 'Invalid automation configuration' : '自动化配置格式无效',
            );
        }

        let nextEnabled = this.state.enabled;
        if ('enabled' in patch) {
            nextEnabled = Boolean(patch.enabled);
        } else if ('localApiEnabled' in patch || 'mcpEnabled' in patch) {
            const nextLocal =
                'localApiEnabled' in patch
                    ? Boolean(patch.localApiEnabled)
                    : this.state.enabled;
            const nextMcp =
                'mcpEnabled' in patch
                    ? Boolean(patch.mcpEnabled)
                    : this.state.enabled;
            nextEnabled = Boolean(nextLocal || nextMcp);
        }

        const nextPort =
            'port' in patch && patch.port !== undefined
                ? validateAutomationPort(patch.port, en ? 'en-US' : 'zh-CN')
                : this.state.port;

        this.persistState({
            enabled: nextEnabled,
            port: nextPort,
        });

        return this.getConfig();
    }

    getStatus({
        running = false,
        lastError = undefined,
        stdioBridgePath = '',
        activeProfileId = null,
        activeProfileName = null,
        runningProfiles = [],
    } = {}) {
        const resolvedError =
            typeof lastError === 'string' && lastError.trim()
                ? lastError.trim()
                : undefined;
        const baseUrl = `http://127.0.0.1:${this.state.port}`;

        return {
            enabled: this.state.enabled,
            localApiEnabled: this.state.enabled,
            mcpEnabled: this.state.enabled,
            port: this.state.port,
            baseUrl,
            cdpEndpoint: baseUrl,
            mcpEndpoint: `${baseUrl}/mcp`,
            running: Boolean(running),
            ...(resolvedError ? { lastError: resolvedError } : {}),
            activeProfileId:
                typeof activeProfileId === 'string' && activeProfileId
                    ? activeProfileId
                    : null,
            activeProfileName:
                typeof activeProfileName === 'string' && activeProfileName
                    ? activeProfileName
                    : null,
            runningProfiles: Array.isArray(runningProfiles)
                ? runningProfiles
                : [],
            stdioBridgePath:
                typeof stdioBridgePath === 'string' ? stdioBridgePath : '',
        };
    }
}

export { AutomationConfigRepository as AutomationConfigManager };
