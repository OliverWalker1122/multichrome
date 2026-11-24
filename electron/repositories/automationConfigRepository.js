import {
    DEFAULT_AUTOMATION_PORT,
    generateAutomationToken,
    isValidAutomationTokenFormat,
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
     *   secretStorage?: { isEncryptionAvailable?: () => boolean, encryptString?: (plain: string) => Buffer, decryptString?: (buf: Buffer) => string } | null,
     *   defaultPort?: number,
     *   getLocale?: (() => string) | null,
     * }} options
     */
    constructor({
        store,
        secretStorage = null,
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
        this.secretStorage = secretStorage || null;
        this.getLocale = typeof getLocale === 'function' ? getLocale : null;

        let validatedDefaultPort = DEFAULT_AUTOMATION_PORT;
        try {
            validatedDefaultPort = validateAutomationPort(defaultPort);
        } catch {
            validatedDefaultPort = DEFAULT_AUTOMATION_PORT;
        }
        this.defaultPort = validatedDefaultPort;
        this.token = null;

        this.state = this.loadState();
    }

    canEncrypt() {
        return Boolean(
            this.secretStorage &&
                typeof this.secretStorage.isEncryptionAvailable ===
                    'function' &&
                this.secretStorage.isEncryptionAvailable() &&
                typeof this.secretStorage.encryptString === 'function' &&
                typeof this.secretStorage.decryptString === 'function',
        );
    }

    assertEncryptionReady() {
        if (!this.secretStorage) return;
        if (!this.canEncrypt()) {
            const en = isEnLocale(this.getLocale);
            throw new Error(
                en
                    ? 'OS secure storage is unavailable; refusing to store plaintext automation token'
                    : '系统安全加密存储不可用，已拒绝明文保存自动化访问密钥',
            );
        }
    }

    decryptStoredToken(encryptedBase64) {
        if (
            !this.canEncrypt() ||
            typeof encryptedBase64 !== 'string' ||
            !encryptedBase64.trim()
        ) {
            return null;
        }
        try {
            const plain = this.secretStorage.decryptString(
                Buffer.from(encryptedBase64.trim(), 'base64'),
            );
            return isValidAutomationTokenFormat(plain) ? plain.trim() : null;
        } catch {
            return null;
        }
    }

    encryptTokenForStore(plainToken) {
        this.assertEncryptionReady();
        if (!this.secretStorage) return undefined;
        return this.secretStorage
            .encryptString(plainToken)
            .toString('base64');
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

        let encryptedToken =
            typeof obj.encryptedToken === 'string' && obj.encryptedToken.trim()
                ? obj.encryptedToken.trim()
                : undefined;

        if (this.secretStorage && this.canEncrypt()) {
            const decrypted = this.decryptStoredToken(encryptedToken);
            if (decrypted) {
                this.token = decrypted;
            } else {
                const fresh = generateAutomationToken();
                encryptedToken = this.encryptTokenForStore(fresh);
                this.token = fresh;
                this.store.set(AUTOMATION_STORE_KEY, {
                    enabled,
                    localApiEnabled: enabled,
                    mcpEnabled: enabled,
                    port,
                    ...(encryptedToken ? { encryptedToken } : {}),
                });
            }
        } else {
            this.token = null;
        }

        return {
            enabled,
            port,
            encryptedToken,
        };
    }

    persistState(nextState) {
        const enabled = Boolean(nextState.enabled);
        const encryptedToken =
            nextState.encryptedToken !== undefined
                ? nextState.encryptedToken
                : this.state?.encryptedToken;

        const persisted = {
            enabled,
            // Preserve legacy booleans in store for backward compatibility across versions
            localApiEnabled: enabled,
            mcpEnabled: enabled,
            port: nextState.port,
            ...(encryptedToken ? { encryptedToken } : {}),
        };
        this.store.set(AUTOMATION_STORE_KEY, persisted);
        this.state = {
            enabled,
            port: nextState.port,
            encryptedToken,
        };
        return this.state;
    }

    ensureToken() {
        if (!this.secretStorage) {
            return null;
        }
        if (this.token && isValidAutomationTokenFormat(this.token)) {
            return this.token;
        }
        this.assertEncryptionReady();
        const fresh = generateAutomationToken();
        const encryptedToken = this.encryptTokenForStore(fresh);
        this.token = fresh;
        this.persistState({
            enabled: this.state.enabled,
            port: this.state.port,
            encryptedToken,
        });
        return this.token;
    }

    getToken() {
        if (!this.secretStorage) {
            return null;
        }
        return this.ensureToken();
    }

    rotateToken() {
        this.assertEncryptionReady();
        const fresh = generateAutomationToken();
        const encryptedToken = this.secretStorage
            ? this.encryptTokenForStore(fresh)
            : undefined;
        this.token = fresh;
        this.persistState({
            enabled: this.state.enabled,
            port: this.state.port,
            encryptedToken,
        });
        return fresh;
    }

    getConfig() {
        return {
            enabled: this.state.enabled,
            localApiEnabled: this.state.enabled,
            mcpEnabled: this.state.enabled,
            port: this.state.port,
            authRequired: Boolean(this.secretStorage || this.token),
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

        if (nextEnabled && this.secretStorage) {
            this.ensureToken();
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
            authRequired: Boolean(this.secretStorage || this.token),
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
