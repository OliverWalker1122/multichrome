import fs from 'node:fs';
import { ProxyCoordinator } from './proxyCoordinator.js';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesTagFilter } from '../domain/environmentTags.js';
import {
    DEFAULT_AUTOMATION_PORT,
    createValidationError,
    normalizeCdpConnectionInfo,
    sanitizeAutomationErrorMessage,
    sanitizeProfileForAutomation,
    validateUuid,
} from '../domain/automationPolicy.js';
import { buildGuardedBrowserWsUrl } from '../domain/cdpGuardPolicy.js';
import { findAvailableAutomationPort } from '../drivers/portAllocator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveStdioBridgePath(appPath = '') {
    const candidates = [];
    if (typeof appPath === 'string' && appPath.trim()) {
        candidates.push(path.join(appPath, 'scripts', 'mcp-stdio.mjs'));
        candidates.push(
            path.join(
                appPath,
                'dist',
                'electron',
                'transport',
                'mcpStdioBridge.js',
            ),
        );
        candidates.push(
            path.join(appPath, 'electron', 'transport', 'mcpStdioBridge.js'),
        );
    }
    candidates.push(
        path.resolve(__dirname, '..', '..', '..', 'scripts', 'mcp-stdio.mjs'),
    );
    candidates.push(
        path.resolve(__dirname, '..', '..', 'scripts', 'mcp-stdio.mjs'),
    );
    candidates.push(
        path.resolve(__dirname, '..', 'transport', 'mcpStdioBridge.js'),
    );

    const found = candidates.find((candidate) => {
        try {
            return fs.existsSync(candidate);
        } catch {
            return false;
        }
    });
    return found || candidates[0];
}

export async function fetchDevToolsWsEndpoint(debugPort, timeoutMs = 1500) {
    if (!Number.isInteger(debugPort) || debugPort <= 0) {
        return null;
    }
    return new Promise((resolve) => {
        const req = http.get(
            `http://127.0.0.1:${debugPort}/json/version`,
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    resolve(null);
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(
                            Buffer.concat(chunks).toString('utf8'),
                        );
                        resolve(
                            typeof parsed?.webSocketDebuggerUrl === 'string' &&
                                parsed.webSocketDebuggerUrl.trim()
                                ? parsed.webSocketDebuggerUrl.trim()
                                : null,
                        );
                    } catch {
                        resolve(null);
                    }
                });
            },
        );
        req.on('error', () => resolve(null));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve(null);
        });
    });
}

export function createAutomationBackend({
    chromeManager,
    proxyManager = null,
    proxyIntegration = null,
    appVersion = '1.7.1',
    fetchWsEndpoint = fetchDevToolsWsEndpoint,
}) {
    if (!chromeManager || typeof chromeManager !== 'object') {
        throw new Error('createAutomationBackend requires chromeManager');
    }

    let activeProfileId = null;
    let cdpGuard = null;
    let getBoundPort = () => DEFAULT_AUTOMATION_PORT;
    let stateListener = null;
    const boundProxyByProfile = new Map();

    const coordinator = proxyIntegration?.runForProfile
        ? proxyIntegration
        : new ProxyCoordinator({ chromeManager, proxyManager });

    async function runProfileOperation(selector, operation) {
        const id = selector.profileId || (await findProfileBySelector(selector)).env.id;
        return coordinator.runForProfile(id, () => operation(id));
    }

    function notifyStateChanged() {
        if (typeof stateListener === 'function') {
            try {
                stateListener();
            } catch {
                // ignore listener error
            }
        }
    }

    function getProxySummaryMap() {
        const map = new Map();
        if (!proxyManager || typeof proxyManager.list !== 'function') {
            return map;
        }
        for (const item of proxyManager.list()) {
            if (item && item.id) {
                map.set(item.id, item);
            }
        }
        return map;
    }

    if (proxyManager && typeof proxyManager.subscribe === 'function') {
        proxyManager.subscribe((event) => {
            if (event?.kind === 'log' || !cdpGuard) {
                return;
            }
            const proxyMap = getProxySummaryMap();
            for (const [profileId, proxyId] of boundProxyByProfile.entries()) {
                if (!proxyId) continue;
                const summary = proxyMap.get(proxyId);
                if (!summary || summary.status !== 'running') {
                    cdpGuard.disconnectProfileSessions(
                        profileId,
                        'Bound proxy disconnected (Fail-Closed)',
                    );
                }
            }
        });
    }

    async function resolveInternalConnectionInfo(env) {
        if (!env || !env.isRunning) {
            return null;
        }

        if (typeof chromeManager.getAutomationConnectionInfo === 'function') {
            const raw = await chromeManager.getAutomationConnectionInfo(env.id);
            const normalized = normalizeCdpConnectionInfo(raw);
            if (!normalized) {
                return null;
            }
            if (!normalized.wsEndpoint && normalized.debugPort) {
                normalized.wsEndpoint = await fetchWsEndpoint(
                    normalized.debugPort,
                );
            }
            return normalized;
        }

        const procRecord = chromeManager.runningProcesses?.get?.(env.id);
        if (
            procRecord &&
            Number.isInteger(procRecord.debugPort) &&
            procRecord.debugPort > 0
        ) {
            const wsEndpoint = await fetchWsEndpoint(procRecord.debugPort);
            return normalizeCdpConnectionInfo({
                debugPort: procRecord.debugPort,
                wsEndpoint,
            });
        }

        return null;
    }

    async function waitForReadyInternalConnection(
        envId,
        initialConn = null,
        timeoutMs = 8000,
    ) {
        let conn = normalizeCdpConnectionInfo(initialConn);
        if (conn && conn.wsEndpoint) {
            return conn;
        }

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const current = chromeManager.getActiveEnvironment
                ? await chromeManager.getActiveEnvironment(envId)
                : (await chromeManager.getAllEnvironments()).find((item) => item.id === envId);
            if (!current || !current.isRunning) {
                break;
            }
            conn = await resolveInternalConnectionInfo(current);
            if (conn && conn.wsEndpoint) {
                return conn;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        throw createValidationError(
            'Browser launched, but internal CDP endpoint did not become ready in time',
            'CDP_NOT_READY',
            504,
        );
    }

    function ensureProfileProxyRunning(env, proxyMap = getProxySummaryMap()) {
        boundProxyByProfile.set(env.id, env.proxyId || '');
        if (!env.proxyId) {
            return;
        }
        const summary = proxyMap.get(env.proxyId);
        if (!summary || summary.status !== 'running') {
            throw createValidationError(
                `Bound proxy for profile "${env.name}" is not running (Fail-Closed)`,
                'PROXY_NOT_RUNNING',
                503,
            );
        }
    }

    async function findProfileBySelector({ profileId, name } = {}) {
        if (profileId && chromeManager.getActiveEnvironment) {
            const id = validateUuid(profileId, 'profileId');
            const env = await chromeManager.getActiveEnvironment(id);
            if (!env) throw createValidationError('Profile not found', 'PROFILE_NOT_FOUND', 404);
            return { env };
        }
        const allEnvs = await chromeManager.getAllEnvironments();
        const list = Array.isArray(allEnvs) ? allEnvs : [];

        if (profileId) {
            const normalizedId = validateUuid(profileId, 'profileId');
            const found = list.find((item) => item.id === normalizedId);
            if (!found) {
                throw createValidationError(
                    `Profile not found: ${normalizedId}`,
                    'PROFILE_NOT_FOUND',
                    404,
                );
            }
            return { env: found, allEnvs: list };
        }

        if (typeof name === 'string' && name.trim()) {
            const target = name.trim();
            const exact = list.filter((item) => item.name === target);
            if (exact.length === 1) {
                return { env: exact[0], allEnvs: list };
            }
            if (exact.length > 1) {
                throw createValidationError(
                    `Multiple profiles share name "${target}"; specify profileId`,
                    'AMBIGUOUS_PROFILE_NAME',
                    409,
                );
            }
            const lower = target.toLowerCase();
            const insensitive = list.filter(
                (item) => (item.name || '').toLowerCase() === lower,
            );
            if (insensitive.length === 1) {
                return { env: insensitive[0], allEnvs: list };
            }
            if (insensitive.length > 1) {
                throw createValidationError(
                    `Multiple profiles match "${target}"; specify profileId`,
                    'AMBIGUOUS_PROFILE_NAME',
                    409,
                );
            }
            throw createValidationError(
                `Profile not found by name: "${target}"`,
                'PROFILE_NOT_FOUND',
                404,
            );
        }

        throw createValidationError(
            'Either profileId or name is required',
            'INVALID_INPUT',
            400,
        );
    }

    function computeEffectiveActiveEnv(allEnvs) {
        const running = (Array.isArray(allEnvs) ? allEnvs : []).filter((item) =>
            Boolean(item && item.isRunning),
        );
        if (activeProfileId) {
            const matched = running.find((item) => item.id === activeProfileId);
            if (matched) {
                return matched;
            }
            activeProfileId = null;
        }
        if (running.length === 1) {
            return running[0];
        }
        return null;
    }

    function buildGuardedEndpointsForProfile(profileId) {
        const port = getBoundPort();
        return {
            httpEndpoint: `http://127.0.0.1:${port}/cdp/${encodeURIComponent(profileId)}`,
            wsEndpoint: buildGuardedBrowserWsUrl(port, profileId, false),
        };
    }

    function getActiveTargetSnapshot() {
        let runningProfiles = [];
        if (typeof chromeManager.getRunningEnvironmentSummary === 'function') {
            const summary = chromeManager.getRunningEnvironmentSummary();
            const ids = Array.isArray(summary?.ids) ? summary.ids : [];
            const names = Array.isArray(summary?.names) ? summary.names : [];
            runningProfiles = ids.map((id, idx) => ({
                id,
                name: names[idx] || id.slice(0, 8),
            }));
        }

        let resolvedActiveId = null;
        let resolvedActiveName = null;
        if (activeProfileId) {
            const found = runningProfiles.find(
                (item) => item.id === activeProfileId,
            );
            if (found) {
                resolvedActiveId = found.id;
                resolvedActiveName = found.name;
            } else if (typeof chromeManager.getRunningEnvironmentSummary === 'function') {
                activeProfileId = null;
            } else {
                resolvedActiveId = activeProfileId;
            }
        }
        if (!resolvedActiveId && runningProfiles.length === 1) {
            resolvedActiveId = runningProfiles[0].id;
            resolvedActiveName = runningProfiles[0].name;
        }

        return {
            selectedProfileId: activeProfileId,
            activeProfileId: resolvedActiveId,
            activeProfileName: resolvedActiveName,
            runningProfiles,
        };
    }

    const backendApi = {
        attachCdpGuard(guard) {
            cdpGuard = guard;
        },

        setBoundPortGetter(getter) {
            if (typeof getter === 'function') {
                getBoundPort = getter;
            }
        },

        setStateListener(listener) {
            stateListener = typeof listener === 'function' ? listener : null;
        },

        getActiveTargetSnapshot,

        isProfileProxyHealthy(profileId) {
            if (
                chromeManager.runningProcesses &&
                typeof chromeManager.runningProcesses.has === 'function' &&
                !chromeManager.runningProcesses.has(profileId)
            ) {
                return false;
            }
            const proxyId = boundProxyByProfile.get(profileId);
            if (!proxyId) {
                return true;
            }
            if (proxyManager?.isRunning) return proxyManager.isRunning(proxyId);
            const summary = getProxySummaryMap().get(proxyId);
            return Boolean(summary && summary.status === 'running');
        },

        async resolveGuardedCdpTarget(requestedProfileId = null) {
            const allEnvs = await chromeManager.getAllEnvironments();
            const list = Array.isArray(allEnvs) ? allEnvs : [];
            const proxyMap = getProxySummaryMap();

            let targetEnv = null;
            if (requestedProfileId) {
                const normalizedId = validateUuid(
                    requestedProfileId,
                    'profileId',
                );
                targetEnv = list.find((item) => item.id === normalizedId);
                if (!targetEnv) {
                    throw createValidationError(
                        `Profile not found: ${normalizedId}`,
                        'PROFILE_NOT_FOUND',
                        404,
                    );
                }
                if (!targetEnv.isRunning) {
                    throw createValidationError(
                        `Profile "${targetEnv.name}" is not running. Start it in MultiChrome or call start_profile first.`,
                        'PROFILE_NOT_RUNNING',
                        409,
                    );
                }
            } else {
                const port = getBoundPort();
                const baseUrl = `http://127.0.0.1:${port}`;
                const running = list.filter((item) => Boolean(item.isRunning));
                if (running.length === 0) {
                    throw createValidationError(
                        `No MultiChrome profile is currently running. Launch one via MultiChrome MCP (${baseUrl}/mcp -> list_profiles, start_profile) or HTTP (GET ${baseUrl}/api/v1/profiles, POST ${baseUrl}/api/v1/profiles/start with {"name":"<profileName>"}).`,
                        'NO_RUNNING_PROFILE',
                        503,
                    );
                }
                targetEnv = computeEffectiveActiveEnv(list);
                if (!targetEnv) {
                    throw createValidationError(
                        `Multiple MultiChrome profiles are running. Switch target via MultiChrome MCP (${baseUrl}/mcp -> switch_active_profile) or POST ${baseUrl}/api/v1/active-profile with {"name":"<profileName>"}.`,
                        'AMBIGUOUS_ACTIVE_PROFILE',
                        409,
                    );
                }
            }

            ensureProfileProxyRunning(targetEnv, proxyMap);
            const conn = await waitForReadyInternalConnection(
                targetEnv.id,
                null,
                4000,
            );

            return {
                profileId: targetEnv.id,
                name: targetEnv.name,
                internalDebugPort: conn.debugPort,
                internalWsEndpoint: conn.wsEndpoint,
            };
        },

        async getStatus() {
            const allEnvs = await chromeManager.getAllEnvironments();
            const list = Array.isArray(allEnvs) ? allEnvs : [];
            const runningCount = list.filter((env) =>
                Boolean(env.isRunning),
            ).length;
            const activeEnv = computeEffectiveActiveEnv(list);
            const port = getBoundPort();
            const baseUrl = `http://127.0.0.1:${port}`;

            return {
                status: 'ok',
                version: appVersion,
                cdpEndpoint: baseUrl,
                mcpEndpoint: `${baseUrl}/mcp`,
                activeProfileId: activeEnv ? activeEnv.id : null,
                activeProfileName: activeEnv ? activeEnv.name : null,
                profiles: {
                    total: list.length,
                    running: runningCount,
                    stopped: Math.max(0, list.length - runningCount),
                },
            };
        },

        async listProfiles(filters = {}) {
            const allEnvs = await chromeManager.getAllEnvironments();
            const list = Array.isArray(allEnvs) ? allEnvs : [];
            const proxyMap = getProxySummaryMap();
            const activeEnv = computeEffectiveActiveEnv(list);
            const port = getBoundPort();

            const filtered = list.filter((env) => {
                if (!env) return false;
                if (filters.group && env.groupName !== filters.group) {
                    return false;
                }
                if (
                    filters.tag &&
                    !matchesTagFilter(env.tags || [], filters.tag)
                ) {
                    return false;
                }
                if (filters.status === 'running' && !env.isRunning) {
                    return false;
                }
                if (filters.status === 'stopped' && env.isRunning) {
                    return false;
                }
                if (filters.query) {
                    const needle = filters.query.toLowerCase();
                    const hay = `${env.name || ''}\n${env.notes || ''}\n${env.id || ''}`.toLowerCase();
                    if (!hay.includes(needle)) {
                        return false;
                    }
                }
                return true;
            });

            const offset = filters.offset || 0;
            const page = filtered.slice(offset, filters.limit ? offset + filters.limit : undefined);
            const profiles = page.map((env) => {
                if (env.isRunning) {
                    boundProxyByProfile.set(env.id, env.proxyId || '');
                }
                const guardedCdp = env.isRunning
                    ? buildGuardedEndpointsForProfile(env.id)
                    : null;
                const proxySummary = env.proxyId
                    ? proxyMap.get(env.proxyId) || null
                    : null;
                const isActiveTarget = Boolean(
                    activeEnv && activeEnv.id === env.id,
                );
                if (filters.view === 'summary') {
                    return { id: env.id, name: env.name, groupName: env.groupName,
                        isRunning: Boolean(env.isRunning), isActiveTarget,
                        proxyStatus: proxySummary?.status ?? (env.proxyId ? 'unknown' : null) };
                }
                return sanitizeProfileForAutomation(
                    env,
                    guardedCdp,
                    proxySummary,
                    isActiveTarget,
                );
            });

            return {
                count: profiles.length,
                ...(filters.limit || offset ? { total: filtered.length, nextOffset: offset + profiles.length < filtered.length ? offset + profiles.length : null } : {}),
                cdpEndpoint: `http://127.0.0.1:${port}`,
                activeProfileId: activeEnv ? activeEnv.id : null,
                profiles,
            };
        },

        startProfile({ profileId, name, setActive = true } = {}) {
            return runProfileOperation({ profileId, name }, async (resolvedId) => {
                await findProfileBySelector({ profileId: resolvedId });

                let initialInternalConn = null;
                if (typeof chromeManager.launchEnvironmentForAutomation === 'function') {
                    const res = await chromeManager.launchEnvironmentForAutomation(resolvedId);
                    initialInternalConn = normalizeCdpConnectionInfo(
                        res?.cdp || res,
                    );
                } else {
                    const launched = await chromeManager.launchEnvironment(resolvedId);
                    if (!launched) {
                        throw createValidationError(
                            `Failed to launch profile: ${resolvedId}`,
                            'LAUNCH_FAILED',
                            500,
                        );
                    }
                }

                await waitForReadyInternalConnection(
                    resolvedId,
                    initialInternalConn,
                    8000,
                );

                const refreshedList = await chromeManager.getAllEnvironments();
                const list = Array.isArray(refreshedList) ? refreshedList : [];
                const updatedEnv = list.find((item) => item.id === resolvedId);
                if (!updatedEnv?.isRunning) {
                    throw createValidationError('Profile stopped before startup completed', 'PROFILE_NOT_RUNNING', 409);
                }
                const proxyMap = getProxySummaryMap();
                ensureProfileProxyRunning(updatedEnv, proxyMap);

                if (setActive !== false) {
                    const previousActive = activeProfileId;
                    activeProfileId = resolvedId;
                    if (previousActive !== resolvedId) {
                        cdpGuard?.disconnectActiveSlotSessions?.(
                            resolvedId,
                            'Switched active target profile',
                        );
                    }
                }

                const activeEnv = computeEffectiveActiveEnv(list);
                const isActiveTarget = Boolean(
                    activeEnv && activeEnv.id === resolvedId,
                );
                const guardedCdp = buildGuardedEndpointsForProfile(resolvedId);
                const proxySummary = updatedEnv.proxyId
                    ? proxyMap.get(updatedEnv.proxyId) || null
                    : null;
                const port = getBoundPort();

                notifyStateChanged();

                return {
                    started: true,
                    profileId: resolvedId,
                    name: updatedEnv.name,
                    isActiveTarget,
                    cdpEndpoint: `http://127.0.0.1:${port}`,
                    profileCdpEndpoint: guardedCdp.httpEndpoint,
                    activeCdpEndpoint: `http://127.0.0.1:${port}`,
                    wsEndpoint: guardedCdp.wsEndpoint,
                    profile: sanitizeProfileForAutomation(
                        updatedEnv,
                        guardedCdp,
                        proxySummary,
                        isActiveTarget,
                    ),
                };
            });
        },

        stopProfile({ profileId, name } = {}) {
            return runProfileOperation({ profileId, name }, async (resolvedId) => {
                const { env } = await findProfileBySelector({ profileId: resolvedId });

                cdpGuard?.disconnectProfileSessions?.(
                    resolvedId,
                    'Profile stopped',
                );

                let stopped = false;
                if (env.isRunning) {
                    stopped = Boolean(
                        await chromeManager.closeEnvironment(resolvedId),
                    );
                    if (!stopped && (await findProfileBySelector({ profileId: resolvedId })).env.isRunning) {
                        throw new Error('Profile is still running. Retry stopping it.');
                    }
                }
                boundProxyByProfile.delete(resolvedId);
                if (
                    env.proxyId &&
                    proxyIntegration &&
                    typeof proxyIntegration.releaseIfUnused === 'function'
                ) {
                    await proxyIntegration.releaseIfUnused(env.proxyId);
                }

                if (activeProfileId === resolvedId) {
                    activeProfileId = null;
                }
                notifyStateChanged();

                return {
                    profileId: resolvedId,
                    name: env.name,
                    stopped,
                };
            });
        },

        async switchActiveProfile({ profileId, name } = {}) {
            // Allow clearing explicit selection back to automatic single-profile mode
            if (
                (profileId === null || profileId === '') &&
                (name === undefined || name === null || name === '')
            ) {
                activeProfileId = null;
                cdpGuard?.disconnectActiveSlotSessions?.(
                    null,
                    'Reset active target profile to automatic mode',
                );
                notifyStateChanged();
                const port = getBoundPort();
                const allEnvs = await chromeManager.getAllEnvironments();
                const autoEnv = computeEffectiveActiveEnv(allEnvs);
                return {
                    activeProfileId: autoEnv ? autoEnv.id : null,
                    name: autoEnv ? autoEnv.name : null,
                    cdpEndpoint: `http://127.0.0.1:${port}`,
                    wsEndpoint: autoEnv
                        ? buildGuardedBrowserWsUrl(port, autoEnv.id, false)
                        : null,
                };
            }

            const { env } = await findProfileBySelector({ profileId, name });
            if (!env.isRunning) {
                throw createValidationError(
                    `Profile "${env.name}" is not running. Call start_profile first.`,
                    'PROFILE_NOT_RUNNING',
                    409,
                );
            }

            ensureProfileProxyRunning(env);
            await waitForReadyInternalConnection(env.id, null, 4000);

            activeProfileId = env.id;
            cdpGuard?.disconnectActiveSlotSessions?.(
                env.id,
                `Switched active target profile to ${env.name}`,
            );
            notifyStateChanged();

            const port = getBoundPort();
            return {
                activeProfileId: env.id,
                name: env.name,
                cdpEndpoint: `http://127.0.0.1:${port}`,
                wsEndpoint: buildGuardedBrowserWsUrl(port, env.id, false),
            };
        },

        closeAutomationResources() {
            cdpGuard?.closeAll?.();
            boundProxyByProfile.clear();
        },
    };

    return backendApi;
}

export class AutomationIntegration {
    /**
     * @param {{
     *   configManager: any,
     *   server: any,
     *   stdioBridgePath?: string,
     *   onStateChange?: ((status: any) => void) | null,
     *   logger?: { info?: (...args: any[]) => void, warn?: (...args: any[]) => void, error?: (...args: any[]) => void },
     * }} options
     */
    constructor({
        configManager,
        server,
        stdioBridgePath = '',
        onStateChange = null,
        logger = console,
    }) {
        if (!configManager || !server) {
            throw new Error(
                'AutomationIntegration requires configManager and server',
            );
        }
        this.configManager = configManager;
        this.server = server;
        this.stdioBridgePath = stdioBridgePath;
        this.onStateChange =
            typeof onStateChange === 'function' ? onStateChange : null;
        this.logger = logger || console;
        this.lastError = undefined;

        if (typeof this.server?.backend?.setStateListener === 'function') {
            this.server.backend.setStateListener(() => this.emitStateChange());
        }
    }

    emitStateChange() {
        if (!this.onStateChange) return;
        try {
            this.onStateChange(this.getStatus());
        } catch {
            // ignore listener errors
        }
    }

    async init() {
        const cfg = this.configManager.getConfig();
        const status = await this.syncServer();
        // Auto-migrate legacy Windows-reserved ports (45000–48999) persisted from older builds
        if (
            cfg.enabled &&
            !status.running &&
            status.lastError &&
            cfg.port >= 45000 &&
            cfg.port <= 48999
        ) {
            return this.pickAvailablePort();
        }
        return status;
    }

    async syncServer() {
        const cfg = this.configManager.getConfig();
        if (!cfg.enabled) {
            try {
                await this.server.stop();
                this.lastError = undefined;
            } catch (err) {
                this.lastError = sanitizeAutomationErrorMessage(err);
            }
            return this.getStatus();
        }

        try {
            await this.server.syncConfig({
                enabled: cfg.enabled,
                port: cfg.port,
            });
            this.lastError = undefined;
        } catch (err) {
            this.lastError = sanitizeAutomationErrorMessage(err);
            this.logger?.warn?.(
                `[Automation] Service sync failed: ${this.lastError}`,
            );
            try {
                await this.server.stop();
            } catch {
                // ignore stop error after failed start
            }
        }
        return this.getStatus();
    }

    getStatus() {
        const targetSnapshot =
            typeof this.server?.backend?.getActiveTargetSnapshot === 'function'
                ? this.server.backend.getActiveTargetSnapshot()
                : {
                      activeProfileId: null,
                      activeProfileName: null,
                      runningProfiles: [],
                  };

        return this.configManager.getStatus({
            running: this.server.isRunning(),
            lastError: this.lastError || this.server.getLastError(),
            stdioBridgePath: this.stdioBridgePath,
            selectedProfileId: targetSnapshot.selectedProfileId,
            activeProfileId: targetSnapshot.activeProfileId,
            activeProfileName: targetSnapshot.activeProfileName,
            runningProfiles: targetSnapshot.runningProfiles,
        });
    }

    async updateConfig(patch) {
        this.configManager.updateConfig(patch);
        const status = await this.syncServer();
        this.emitStateChange();
        return status;
    }

    async setActiveProfile(profileIdOrNull) {
        if (typeof this.server?.backend?.switchActiveProfile === 'function') {
            await this.server.backend.switchActiveProfile({
                profileId: profileIdOrNull ?? null,
            });
        }
        const status = this.getStatus();
        this.emitStateChange();
        return status;
    }

    async testConnection() {
        const status = this.getStatus();
        if (!status.running) return 'listener';
        let token;
        try { token = this.getToken(); } catch { return 'auth'; }
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
        if (token) headers.Authorization = 'Bearer ' + token;
        try {
            const call = async (method, params) => {
                const response = await fetch('http://127.0.0.1:' + status.port + '/mcp', {
                    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(3000),
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                });
                return { status: response.status, data: await response.json() };
            };
            const init = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {},
                clientInfo: { name: 'MultiChrome Settings', version: '1' } });
            if ([401, 403].includes(init.status)) return 'auth';
            if (!init.data.result?.protocolVersion) return 'tools';
            headers['MCP-Protocol-Version'] = init.data.result.protocolVersion;
            const found = await call('tools/list', {});
            const tools = found.data.result?.tools || [];
            return ['list_profiles', 'start_profile', 'stop_profile', 'switch_active_profile'].every(name =>
                tools.some(tool => tool.name === name)) ? 'ready' : 'tools';
        } catch { return 'listener'; }
    }

    getToken() {
        return typeof this.configManager.getToken === 'function'
            ? this.configManager.getToken()
            : null;
    }

    rotateToken() {
        if (typeof this.configManager.rotateToken !== 'function') {
            return null;
        }
        const nextToken = this.configManager.rotateToken();
        this.server?.disconnectAllSessions?.();
        this.emitStateChange();
        return nextToken;
    }

    async pickAvailablePort({ probe } = {}) {
        const cfg = this.configManager.getConfig();
        const locale =
            typeof this.configManager.getLocale === 'function' &&
            this.configManager.getLocale() === 'en-US'
                ? 'en-US'
                : 'zh-CN';
        const excluded = new Set([cfg.port]);
        let lastStatus = this.getStatus();

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const candidatePort = await findAvailableAutomationPort({
                preferredPort: DEFAULT_AUTOMATION_PORT,
                excludePorts: Array.from(excluded),
                ...(typeof probe === 'function' ? { probe } : {}),
                locale,
            });
            lastStatus = await this.updateConfig({ port: candidatePort });
            if (!lastStatus.lastError) {
                return lastStatus;
            }
            excluded.add(candidatePort);
        }

        return lastStatus;
    }

    async shutdown() {
        try {
            this.server?.backend?.closeAutomationResources?.();
            await this.server.stop();
        } catch (err) {
            this.logger?.warn?.(
                `[Automation] Server shutdown error: ${sanitizeAutomationErrorMessage(err)}`,
            );
        }
    }
}

export { AutomationIntegration as AutomationService };
