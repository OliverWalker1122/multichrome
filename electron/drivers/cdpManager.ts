import WebSocket from 'ws';
import log from 'electron-log';
import http from 'http';
import { decideStartupUrlAction } from '../domain/startupUrlPolicy.js';

export interface StartupGateController {
    isReleased: () => boolean;
    release: () => number;
    dropHeldAndRelease: () => { droppedCount: number };
}

// CDP 连接信息
interface CDPConnection {
    ws: WebSocket;
    debugUrl: string;
    debugPort: number;
    envId: string;
    browserPID: number | null;
    connected: boolean;
    autoAttachEnabled: boolean;
    autoAttachPromise: Promise<void> | null;
    manualDisconnect: boolean;
    reconnectAttempts: number;
    reconnectTimer: NodeJS.Timeout | null;
    onDisconnect: () => void;
    isProfileAlive?: () => Promise<boolean>;
}

// 跟踪已附加的页面 session
interface AttachedSession {
    sessionId: string;
    targetId: string;
    type: string;
    url: string;
    injected: boolean;
}

interface PendingResponse {
    resolve: (msg: Record<string, unknown>) => void;
    timer: NodeJS.Timeout;
    envId: string;
}

// CDP 管理器类
export class CDPManager {
    private connections: Map<string, CDPConnection> = new Map();
    private envTimezones: Map<string, string> = new Map();
    private envLocales: Map<string, string> = new Map();
    private envGeolocations: Map<
        string,
        { latitude: number; longitude: number; accuracy: number }
    > = new Map();
    private envSessions: Map<string, Map<string, AttachedSession>> = new Map();
    private envInjectionTasks: Map<string, Set<Promise<void>>> = new Map();
    private pendingResponses: Map<number, PendingResponse> = new Map();
    private messageId: number = 0;

    private readonly MAX_RECONNECT_ATTEMPTS = 3;
    private readonly MAX_ALIVE_RECONNECT_ATTEMPTS = 12;
    private readonly BASE_RECONNECT_DELAY = 1000;

    /**
     * 获取 WebSocket 调试 URL
     */
    private async getBrowserWebSocketUrl(port: number): Promise<string | null> {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.webSocketDebuggerUrl || null);
                    } catch {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    /**
     * 发送 CDP 命令并等待响应（带超时自动清理，避免 pendingResponses 泄漏）
     */
    private sendCommand(
        envId: string,
        ws: WebSocket,
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
        timeoutMs: number = 1500,
    ): Promise<Record<string, unknown> | null> {
        if (ws.readyState !== WebSocket.OPEN) {
            return Promise.resolve(null);
        }

        const id = ++this.messageId;
        const payload: Record<string, unknown> = { id, method, params };
        if (sessionId) {
            payload.sessionId = sessionId;
        }

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingResponses.delete(id);
                resolve(null);
            }, timeoutMs);

            this.pendingResponses.set(id, { resolve, timer, envId });

            try {
                ws.send(JSON.stringify(payload));
            } catch (err) {
                clearTimeout(timer);
                this.pendingResponses.delete(id);
                log.warn(`[CDP] 命令发送失败: ${method} (${err})`);
                resolve(null);
            }
        });
    }

    private clearPendingForEnv(envId: string): void {
        for (const [id, entry] of this.pendingResponses.entries()) {
            if (entry.envId === envId) {
                clearTimeout(entry.timer);
                this.pendingResponses.delete(id);
                entry.resolve({});
            }
        }
    }

    private shouldEnableOverrides(envId: string): boolean {
        return (
            this.envTimezones.has(envId) ||
            this.envLocales.has(envId) ||
            this.envGeolocations.has(envId)
        );
    }

    private trackInjectionTask(envId: string, task: Promise<void>): void {
        let set = this.envInjectionTasks.get(envId);
        if (!set) {
            set = new Set();
            this.envInjectionTasks.set(envId, set);
        }
        set.add(task);
        void task.finally(() => {
            set?.delete(task);
        });
    }

    private async awaitPendingInjections(envId: string): Promise<void> {
        const set = this.envInjectionTasks.get(envId);
        if (!set || set.size === 0) return;
        await Promise.allSettled(Array.from(set));
    }

    /**
     * 尝试重连 CDP；若提供 isProfileAlive，则在浏览器确认仍存活时继续指数退避重连，
     * 防止因短暂卡顿误判浏览器已关闭。
     */
    private async attemptReconnect(
        envId: string,
        debugPort: number,
        onDisconnect: () => void,
    ): Promise<void> {
        const connection = this.connections.get(envId);
        if (!connection || connection.manualDisconnect) return;

        const wsUrl = await this.getBrowserWebSocketUrl(debugPort);
        if (wsUrl) {
            if (!this.connections.get(envId) || connection.manualDisconnect) return;
            this.createWebSocketConnection(
                envId,
                debugPort,
                wsUrl,
                onDisconnect,
                connection.isProfileAlive,
            );
            return;
        }

        // DevTools 端点暂不可达：先用本地文件锁/端口快速确认浏览器是否真的已退出
        let stillAlive = false;
        if (connection.isProfileAlive) {
            try {
                stillAlive = await connection.isProfileAlive();
            } catch {
                stillAlive = false;
            }
        }

        const maxAttempts = stillAlive
            ? this.MAX_ALIVE_RECONNECT_ATTEMPTS
            : this.MAX_RECONNECT_ATTEMPTS;

        if ((!stillAlive && connection.isProfileAlive) || connection.reconnectAttempts >= maxAttempts) {
            this.clearPendingForEnv(envId);
            this.connections.delete(envId);
            this.envSessions.delete(envId);
            onDisconnect();
            return;
        }

        connection.reconnectAttempts += 1;
        const delay = Math.min(
            5000,
            this.BASE_RECONNECT_DELAY * Math.pow(1.5, connection.reconnectAttempts - 1),
        );
        if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
        connection.reconnectTimer = setTimeout(() => {
            void this.attemptReconnect(envId, debugPort, onDisconnect);
        }, delay);
    }

    /**
     * 创建 WebSocket 连接
     */
    private createWebSocketConnection(
        envId: string,
        debugPort: number,
        wsUrl: string,
        onDisconnect: () => void,
        isProfileAlive?: () => Promise<boolean>,
    ): void {
        const ws = new WebSocket(wsUrl);

        let connection = this.connections.get(envId);
        if (!connection) {
            connection = {
                ws,
                debugUrl: wsUrl,
                debugPort,
                envId,
                browserPID: null,
                connected: false,
                autoAttachEnabled: false,
                autoAttachPromise: null,
                manualDisconnect: false,
                reconnectAttempts: 0,
                reconnectTimer: null,
                onDisconnect,
                isProfileAlive,
            };
            this.connections.set(envId, connection);
        } else {
            connection.ws = ws;
            connection.debugUrl = wsUrl;
            connection.autoAttachEnabled = false;
            connection.autoAttachPromise = null;
            connection.manualDisconnect = false;
            connection.isProfileAlive = isProfileAlive ?? connection.isProfileAlive;
        }

        if (!this.envSessions.has(envId)) {
            this.envSessions.set(envId, new Map());
        }

        ws.on('open', () => {
            if (!connection || connection.ws !== ws) return;
            connection.connected = true;
            connection.reconnectAttempts = 0;

            if (this.shouldEnableOverrides(envId)) {
                void this.enableAutoAttach(envId, ws);
            }
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.id && this.pendingResponses.has(message.id)) {
                    const entry = this.pendingResponses.get(message.id)!;
                    clearTimeout(entry.timer);
                    this.pendingResponses.delete(message.id);
                    entry.resolve(message);
                }

                if (message.method) {
                    this.handleCDPEvent(envId, message.method, message.params, ws);
                }
            } catch {
                /* ignore malformed CDP frame */
            }
        });

        ws.on('close', () => {
            if (!connection || connection.ws !== ws) return;
            connection.connected = false;
            connection.autoAttachEnabled = false;
            connection.autoAttachPromise = null;
            this.clearPendingForEnv(envId);

            if (connection.manualDisconnect) return;

            if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
            connection.reconnectTimer = setTimeout(() => {
                void this.attemptReconnect(envId, debugPort, onDisconnect);
            }, this.BASE_RECONNECT_DELAY);
        });

        ws.on('error', () => {
            /* close 事件会统一处理 */
        });
    }

    /**
     * 在 browser-level WebSocket 上启用 Target.setAutoAttach（幂等去重）
     */
    private enableAutoAttach(envId: string, ws: WebSocket): Promise<void> {
        const connection = this.connections.get(envId);
        if (!connection || connection.ws !== ws || ws.readyState !== WebSocket.OPEN) {
            return Promise.resolve();
        }
        if (connection.autoAttachEnabled && connection.autoAttachPromise) {
            return connection.autoAttachPromise;
        }

        connection.autoAttachEnabled = true;
        const promise = this.sendCommand(
            envId,
            ws,
            'Target.setAutoAttach',
            {
                autoAttach: true,
                waitForDebuggerOnStart: true,
                flatten: true,
            },
            undefined,
            2000,
        ).then((resp) => {
            if (resp && 'error' in resp && resp.error) {
                if (this.connections.get(envId)?.ws === ws) {
                    connection.autoAttachEnabled = false;
                }
                log.warn(`[CDP] Target.setAutoAttach 返回错误:`, resp.error);
            } else {
                log.info(`[CDP] 已启用 Target.setAutoAttach: ${envId.substring(0, 8)}`);
            }
        });

        connection.autoAttachPromise = promise;
        return promise;
    }

    /**
     * 等待 browser-level WebSocket 真正进入 open 状态
     */
    private async waitForConnectionOpen(envId: string, timeoutMs: number = 3000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const connection = this.connections.get(envId);
            if (connection?.connected) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        return false;
    }

    /**
     * 连接到 Chrome CDP
     */
    public async connect(
        envId: string,
        debugPort: number,
        onDisconnect: () => void,
        isProfileAlive?: () => Promise<boolean>,
    ): Promise<boolean> {
        try {
            const wsUrl = await this.getBrowserWebSocketUrl(debugPort);
            if (!wsUrl) return false;
            this.createWebSocketConnection(envId, debugPort, wsUrl, onDisconnect, isProfileAlive);
            return await this.waitForConnectionOpen(envId);
        } catch {
            return false;
        }
    }

    /**
     * 在 CDP 建连前预注册环境的原生 V8/Blink Emulation 覆盖配置（零 JS Hook）。
     */
    public primeEnvironment(
        envId: string,
        options: {
            timezone?: string;
            locale?: string;
            geolocation?: {
                latitude: number;
                longitude: number;
                accuracy?: number;
            };
        },
    ): void {
        if (options.timezone) {
            this.envTimezones.set(envId, options.timezone);
        } else {
            this.envTimezones.delete(envId);
        }

        if (options.locale) {
            this.envLocales.set(envId, options.locale);
        } else {
            this.envLocales.delete(envId);
        }

        if (
            options.geolocation &&
            Number.isFinite(options.geolocation.latitude) &&
            Number.isFinite(options.geolocation.longitude)
        ) {
            this.envGeolocations.set(envId, {
                latitude: options.geolocation.latitude,
                longitude: options.geolocation.longitude,
                accuracy:
                    typeof options.geolocation.accuracy === 'number' &&
                    options.geolocation.accuracy > 0
                        ? options.geolocation.accuracy
                        : 100,
            });
        } else {
            this.envGeolocations.delete(envId);
        }
    }

    /**
     * 处理 CDP 事件
     */
    private handleCDPEvent(
        envId: string,
        method: string,
        params: Record<string, unknown> | undefined,
        ws: WebSocket,
    ): void {
        if (method === 'Inspector.targetCrashed') {
            log.warn(`浏览器崩溃: ${envId.substring(0, 8)}`);
        }

        if (method === 'Target.attachedToTarget') {
            const targetInfo = params?.targetInfo as
                | { targetId?: string; type?: string; url?: string }
                | undefined;
            const sessionId = params?.sessionId as string | undefined;
            const waitingForDebugger = Boolean(params?.waitingForDebugger);

            if (targetInfo && sessionId) {
                const targetType = targetInfo.type || 'other';
                const sessions = this.envSessions.get(envId) || new Map();
                sessions.set(sessionId, {
                    sessionId,
                    targetId: targetInfo.targetId || '',
                    type: targetType,
                    url: targetInfo.url || '',
                    injected: false,
                });
                this.envSessions.set(envId, sessions);

                if (targetType === 'page' || targetType === 'iframe') {
                    if (this.shouldEnableOverrides(envId)) {
                        log.info(
                            `[CDP] 页面已附加，施加原生覆盖: ${targetInfo.url?.substring(0, 60) || 'new tab'} (session: ${sessionId.substring(0, 8)})`,
                        );
                        this.trackInjectionTask(
                            envId,
                            this.injectToSession(envId, sessionId, ws, waitingForDebugger),
                        );
                    } else if (waitingForDebugger) {
                        this.resumeTarget(ws, sessionId);
                    }
                } else if (
                    (targetType === 'worker' || targetType === 'shared_worker') &&
                    (this.envTimezones.has(envId) || this.envLocales.has(envId))
                ) {
                    // 同步覆盖 Dedicated / Shared Web Worker 的 V8 引擎时区与语言区域
                    //（ServiceWorker 宿主不支持 Emulation 域，避免拦截暂停导致 Gmail 等重度 SW 应用卡加载屏）
                    this.trackInjectionTask(
                        envId,
                        this.injectTimezoneToWorker(envId, sessionId, ws, waitingForDebugger),
                    );
                } else if (waitingForDebugger) {
                    this.resumeTarget(ws, sessionId);
                }
            }
        }

        if (method === 'Target.detachedFromTarget') {
            const sessionId = params?.sessionId as string | undefined;
            if (sessionId) {
                const sessions = this.envSessions.get(envId);
                if (sessions) sessions.delete(sessionId);
            }
        }
    }

    /**
     * 对 Worker 目标施加 V8 时区覆盖并在确认响应后立即恢复执行
     */
    private async injectTimezoneToWorker(
        envId: string,
        sessionId: string,
        ws: WebSocket,
        waitingForDebugger: boolean,
    ): Promise<void> {
        try {
            const timezone = this.envTimezones.get(envId);
            const locale = this.envLocales.get(envId);
            let lastPromise: Promise<Record<string, unknown> | null> =
                Promise.resolve(null);
            if (timezone) {
                lastPromise = this.sendCommand(
                    envId,
                    ws,
                    'Emulation.setTimezoneOverride',
                    { timezoneId: timezone },
                    sessionId,
                    400,
                );
            }
            if (locale) {
                lastPromise = this.sendCommand(
                    envId,
                    ws,
                    'Emulation.setLocaleOverride',
                    { locale },
                    sessionId,
                    400,
                );
            }
            await lastPromise;
        } finally {
            if (waitingForDebugger) {
                this.resumeTarget(ws, sessionId);
            }
        }
    }

    /**
     * 向指定 session 施加纯原生 V8/Blink Emulation 覆盖（零 JS Hook），等待 ACK 后立即恢复执行
     */
    private async injectToSession(
        envId: string,
        sessionId: string,
        ws: WebSocket,
        waitingForDebugger: boolean,
    ): Promise<void> {
        const timezone = this.envTimezones.get(envId);
        const locale = this.envLocales.get(envId);
        const geolocation = this.envGeolocations.get(envId);

        const cmds: Array<{ method: string; params: Record<string, unknown> }> = [];

        if (timezone) {
            cmds.push({
                method: 'Emulation.setTimezoneOverride',
                params: { timezoneId: timezone },
            });
        }

        if (locale) {
            cmds.push({
                method: 'Emulation.setLocaleOverride',
                params: { locale },
            });
        }

        if (geolocation) {
            cmds.push({
                method: 'Emulation.setGeolocationOverride',
                params: {
                    latitude: geolocation.latitude,
                    longitude: geolocation.longitude,
                    accuracy: geolocation.accuracy,
                },
            });
        }

        try {
            let lastPromise: Promise<Record<string, unknown> | null> =
                Promise.resolve(null);
            for (const cmd of cmds) {
                lastPromise = this.sendCommand(
                    envId,
                    ws,
                    cmd.method,
                    cmd.params,
                    sessionId,
                    400,
                );
            }

            // 利用同 session FIFO 特性：等最后一条原生 Emulation 命令 ACK 后再标记就绪/放行
            await lastPromise;
        } finally {
            if (waitingForDebugger) {
                this.resumeTarget(ws, sessionId);
            }
        }

        const sessions = this.envSessions.get(envId);
        const session = sessions?.get(sessionId);
        if (session) session.injected = true;

        log.info(
            `[CDP] 已施加 ${cmds.length} 条原生 Emulation 命令到 session ${sessionId.substring(0, 8)}`,
        );
    }

    /**
     * 恢复被 waitForDebuggerOnStart 暂停的目标
     */
    private resumeTarget(ws: WebSocket, sessionId: string): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(
                JSON.stringify({
                    id: ++this.messageId,
                    sessionId,
                    method: 'Runtime.runIfWaitingForDebugger',
                    params: {},
                }),
            );
        } catch (err) {
            log.warn(`[CDP] 恢复目标失败: ${err}`);
        }
    }

    /**
     * 优雅关闭浏览器（通过 CDP Browser.close，快速落盘并释放 lockfile）
     */
    public async closeBrowser(envId: string): Promise<boolean> {
        const connection = this.connections.get(envId);
        if (!connection || !connection.connected || connection.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            const resp = await this.sendCommand(envId, connection.ws, 'Browser.close', {}, undefined, 1000);
            return resp !== null;
        } catch {
            return false;
        }
    }

    /**
     * 断开 CDP 连接
     */
    public disconnect(envId: string): void {
        const connection = this.connections.get(envId);
        if (connection) {
            connection.manualDisconnect = true;
            if (connection.reconnectTimer) {
                clearTimeout(connection.reconnectTimer);
                connection.reconnectTimer = null;
            }
            try {
                connection.ws.close();
            } catch {
                /* ignore */
            }
            this.connections.delete(envId);
        }

        this.clearPendingForEnv(envId);
        this.envSessions.delete(envId);
        this.envInjectionTasks.delete(envId);
        this.envTimezones.delete(envId);
        this.envLocales.delete(envId);
        this.envGeolocations.delete(envId);
    }

    /**
     * 通过 CDP 设置时区并刷新到所有已有页面/Worker sessions
     */
    public async setTimezone(envId: string, timezone: string): Promise<boolean> {
        this.envTimezones.set(envId, timezone);
        const connection = this.connections.get(envId);
        const sessions = this.envSessions.get(envId);
        if (connection?.connected && sessions && sessions.size > 0) {
            for (const [sessionId, session] of sessions) {
                if (session.type === 'page' || session.type === 'iframe') {
                    void this.injectToSession(envId, sessionId, connection.ws, false);
                } else if (
                    session.type === 'worker' ||
                    session.type === 'shared_worker'
                ) {
                    void this.injectTimezoneToWorker(envId, sessionId, connection.ws, false);
                }
            }
            return true;
        }
        return this.applyOverrides(envId);
    }

    /**
     * 通过 CDP 设置 Geolocation 经纬度并刷新到所有已有页面 sessions
     */
    public async setGeolocation(
        envId: string,
        geolocation: { latitude: number; longitude: number; accuracy?: number },
    ): Promise<boolean> {
        if (
            !Number.isFinite(geolocation.latitude) ||
            !Number.isFinite(geolocation.longitude)
        ) {
            return false;
        }
        this.envGeolocations.set(envId, {
            latitude: geolocation.latitude,
            longitude: geolocation.longitude,
            accuracy:
                typeof geolocation.accuracy === 'number' &&
                geolocation.accuracy > 0
                    ? geolocation.accuracy
                    : 100,
        });
        const connection = this.connections.get(envId);
        const sessions = this.envSessions.get(envId);
        if (connection?.connected && sessions && sessions.size > 0) {
            for (const [sessionId, session] of sessions) {
                if (session.type === 'page' || session.type === 'iframe') {
                    void this.injectToSession(envId, sessionId, connection.ws, false);
                }
            }
            return true;
        }
        return this.applyOverrides(envId);
    }

    /**
     * 在运行中的环境里新建标签页打开指定 URL
     */
    public async openUrl(envId: string, url: string): Promise<boolean> {
        const connection = this.connections.get(envId);
        if (
            !connection ||
            !connection.connected ||
            connection.ws.readyState !== WebSocket.OPEN
        ) {
            return false;
        }
        try {
            const resp = await this.sendCommand(
                envId,
                connection.ws,
                'Target.createTarget',
                { url },
                undefined,
                2000,
            );
            return Boolean(resp && !('error' in resp && resp.error));
        } catch {
            return false;
        }
    }

    /**
     * 应用当前环境已缓存的原生 V8/Blink Emulation 覆盖到现有页面和后续页面。
     */
    public async applyOverrides(envId: string): Promise<boolean> {
        try {
            const connection = this.connections.get(envId);
            if (!connection || !connection.connected) {
                log.warn(`CDP 连接不存在，无法应用覆盖: ${envId.substring(0, 8)}`);
                return false;
            }

            if (!this.shouldEnableOverrides(envId)) {
                return true;
            }

            const ws = connection.ws;
            await this.enableAutoAttach(envId, ws);

            // 若已有页面 session 附加则无需盲等；否则短轮询最多 1200ms
            const deadline = Date.now() + 1200;
            let pageSessionCount = this.countPageSessions(envId);
            while (pageSessionCount === 0 && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 30));
                pageSessionCount = this.countPageSessions(envId);
            }

            // 等待所有已附加页面与 Worker 完成原生 Emulation ACK
            await this.awaitPendingInjections(envId);

            const timezone = this.envTimezones.get(envId);
            const locale = this.envLocales.get(envId);
            if (pageSessionCount > 0) {
                log.info(
                    `[CDP] 原生 Emulation 覆盖已就绪 (${pageSessionCount} 个页面，零 JS Hook): tz=${timezone || 'none'}, locale=${locale || 'none'}`,
                );
                return true;
            }

            log.warn(`[CDP] 应用覆盖时暂未发现页面 session，后续新标签页仍将自动附加`);
            return true;
        } catch (error) {
            log.error(`CDP 应用覆盖失败:`, error);
            return false;
        }
    }

    /**
     * 在全部恢复标签页完成原生 V8 时区/语言挂载后，安全放行代理启动闸门：
     * - 若没有任何标签页在闸门放行前就从本地磁盘缓存 / Service Worker 抢跑提交，则直接放行（0 重载、0 丢包）；
     * - 若检测到离线缓存 / Service Worker 抢跑页面，则先销毁闸门内全部旧 TCP 连接（物理阻断可能携带本机时区的旧 beacon），
     *   打开闸门，并对恢复的 http(s) 标签页执行一次 Page.reload，确保全部页面在目标 V8 时区下重新加载。
     */
    public async flushStartupGate(
        envId: string,
        gate: StartupGateController,
    ): Promise<{
        preCommittedCount: number;
        reloadedCount: number;
        droppedCount: number;
        forwardedCount: number;
    }> {
        if (gate.isReleased()) {
            return {
                preCommittedCount: 0,
                reloadedCount: 0,
                droppedCount: 0,
                forwardedCount: 0,
            };
        }

        const connection = this.connections.get(envId);
        const sessions = this.envSessions.get(envId);
        if (
            !connection ||
            !connection.connected ||
            connection.ws.readyState !== WebSocket.OPEN ||
            !sessions ||
            sessions.size === 0
        ) {
            const forwardedCount = gate.release();
            return {
                preCommittedCount: 0,
                reloadedCount: 0,
                droppedCount: 0,
                forwardedCount,
            };
        }

        const ws = connection.ws;
        const pageSessions = Array.from(sessions.values()).filter(
            (s) => s.type === 'page',
        );
        const preCommitted: Array<{ session: AttachedSession; href: string }> = [];
        const pendingHttp: AttachedSession[] = [];

        await Promise.all(
            pageSessions.map(async (session) => {
                let committedHref = '';
                try {
                    const resp = await this.sendCommand(
                        envId,
                        ws,
                        'Runtime.evaluate',
                        {
                            expression: 'location.href',
                            returnByValue: true,
                        },
                        session.sessionId,
                        400,
                    );
                    const resultObj = resp?.result as
                        | { result?: { value?: unknown } }
                        | undefined;
                    if (typeof resultObj?.result?.value === 'string') {
                        committedHref = resultObj.result.value;
                    }
                } catch {
                    committedHref = '';
                }

                const isPreCommittedHttp = /^https?:\/\//i.test(committedHref);
                const isTargetHttp = /^https?:\/\//i.test(session.url || '');
                if (isPreCommittedHttp) {
                    preCommitted.push({ session, href: committedHref });
                } else if (isTargetHttp) {
                    pendingHttp.push(session);
                }
            }),
        );

        if (preCommitted.length === 0) {
            const forwardedCount = gate.release();
            log.info(
                `[CDP] 启动闸门已放行（无离线缓存抢跑）: forwarded=${forwardedCount}`,
            );
            return {
                preCommittedCount: 0,
                reloadedCount: 0,
                droppedCount: 0,
                forwardedCount,
            };
        }

        // Step 1（闸门保持关闭）：先把离线缓存 / Service Worker 抢跑页切到 about:blank，
        // 彻底销毁旧 Document 及其挂起中的 fetch/XHR 事务，杜绝断开旧 socket 后 Chrome 自动重试旧请求！
        await Promise.allSettled(
            preCommitted.map(async ({ session }) => {
                await this.sendCommand(
                    envId,
                    ws,
                    'Page.stopLoading',
                    {},
                    session.sessionId,
                    400,
                );
                await this.sendCommand(
                    envId,
                    ws,
                    'Page.navigate',
                    { url: 'about:blank' },
                    session.sessionId,
                    800,
                );
                const blankDeadline = Date.now() + 400;
                while (Date.now() < blankDeadline) {
                    const check = await this.sendCommand(
                        envId,
                        ws,
                        'Runtime.evaluate',
                        { expression: 'location.href', returnByValue: true },
                        session.sessionId,
                        200,
                    );
                    const cur = (
                        check?.result as { result?: { value?: unknown } } | undefined
                    )?.result?.value;
                    if (cur === 'about:blank') break;
                    await new Promise((r) => setTimeout(r, 15));
                }
            }),
        );

        // 等待 Network Service 进程完全处理完旧 Document 的 URLLoader 取消 IPC
        await new Promise((r) => setTimeout(r, 40));

        // Step 2：旧 Document 已卸载、不会再触发任何自动重试 -> 物理销毁闸门内全部旧 TCP 连接并打开闸门！
        const { droppedCount } = gate.dropHeldAndRelease();

        // Step 3：在目标 V8 时区/语言已生效且闸门已打开状态下，用 Page.navigate 重新加载抢跑页
        //（刻意不走 history back/BFCache，防止复活 CDP 挂载前的旧 JS 上下文），并重载其余 pending 标签页
        await Promise.allSettled([
            ...preCommitted.map(({ session, href }) =>
                this.sendCommand(
                    envId,
                    ws,
                    'Page.navigate',
                    { url: href },
                    session.sessionId,
                    1500,
                ),
            ),
            ...pendingHttp.map((session) =>
                this.sendCommand(
                    envId,
                    ws,
                    'Page.reload',
                    { ignoreCache: false },
                    session.sessionId,
                    1500,
                ),
            ),
        ]);

        const reloadedCount = preCommitted.length + pendingHttp.length;
        log.info(
            `[CDP] 启动闸门检测到 ${preCommitted.length} 个离线缓存抢跑页，已卸载旧页、丢弃 ${droppedCount} 条旧连接并重载 ${reloadedCount} 个标签页`,
        );
        return {
            preCommittedCount: preCommitted.length,
            reloadedCount,
            droppedCount,
            forwardedCount: 0,
        };
    }

    private countPageSessions(envId: string): number {
        const sessions = this.envSessions.get(envId);
        if (!sessions) return 0;
        let count = 0;
        for (const session of sessions.values()) {
            if (session.type === 'page') count += 1;
        }
        return count;
    }

    /**
     * 为 Ungoogled Chromium（fingerprint-chromium）把默认搜索引擎从 "No Search" 升级为 Google。
     * 通过后台静默打开 chrome://settings/searchEngines 调用 Chromium 原生 SearchEnginesHandler，
     * 由内核自身生成带合法 url_hash 与 Secure Preferences HMAC 的持久化记录，仅首次执行一次。
     * 若用户已改为其他搜索引擎（如 DuckDuckGo / Bing），则保持用户选择不变。
     */
    public async ensureDefaultGoogleSearch(envId: string): Promise<boolean> {
        const connection = this.connections.get(envId);
        if (!connection || !connection.connected || connection.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        const ws = connection.ws;

        // 先确认浏览器已有至少一个主页面目标，避免关闭临时后台标签页时把整个浏览器窗口关闭
        let hasOtherPage = false;
        const pageWaitDeadline = Date.now() + 2000;
        while (Date.now() < pageWaitDeadline) {
            const targetsResp = await this.sendCommand(envId, ws, 'Target.getTargets', {}, undefined, 1000);
            const infos = (targetsResp?.result as { targetInfos?: Array<{ type?: string }> } | undefined)
                ?.targetInfos;
            if (Array.isArray(infos) && infos.some((t) => t.type === 'page')) {
                hasOtherPage = true;
                break;
            }
            await new Promise((r) => setTimeout(r, 80));
        }
        if (!hasOtherPage) {
            return false;
        }

        let targetId: string | undefined;
        try {
            const created = await this.sendCommand(
                envId,
                ws,
                'Target.createTarget',
                { url: 'chrome://settings/searchEngines', background: true },
                undefined,
                2000,
            );
            targetId = (created?.result as { targetId?: string } | undefined)?.targetId;
            if (!targetId) return false;

            const attached = await this.sendCommand(
                envId,
                ws,
                'Target.attachToTarget',
                { targetId, flatten: true },
                undefined,
                2000,
            );
            const sessionId = (attached?.result as { sessionId?: string } | undefined)?.sessionId;
            if (!sessionId) return false;

            // 等待 chrome://settings WebUI 脚本就绪
            const readyDeadline = Date.now() + 3000;
            let ready = false;
            while (Date.now() < readyDeadline) {
                const probe = await this.sendCommand(
                    envId,
                    ws,
                    'Runtime.evaluate',
                    {
                        expression: `document.readyState !== 'loading' && typeof chrome !== 'undefined' && typeof chrome.send === 'function'`,
                        returnByValue: true,
                    },
                    sessionId,
                    800,
                );
                if ((probe?.result as { result?: { value?: boolean } } | undefined)?.result?.value === true) {
                    ready = true;
                    break;
                }
                await new Promise((r) => setTimeout(r, 100));
            }
            if (!ready) return false;

            const evalResp = await this.sendCommand(
                envId,
                ws,
                'Runtime.evaluate',
                {
                    expression: `(async () => {
                        const mod = await import('chrome://settings/settings.js');
                        const proxy = mod.SearchEnginesBrowserProxyImpl && mod.SearchEnginesBrowserProxyImpl.getInstance();
                        if (!proxy) return { ok: false, reason: 'no_proxy' };

                        const before = await proxy.getSearchEnginesList();
                        const currentDefault = (before.defaults || []).find((d) => d.default);
                        const isNoSearch =
                            !currentDefault ||
                            currentDefault.keyword === 'nosearch' ||
                            currentDefault.name === 'No Search' ||
                            currentDefault.url === 'http://%s';
                        if (!isNoSearch) {
                            return { ok: true, skipped: true, current: currentDefault.name };
                        }

                        const findGoogle = (list) => {
                            const all = [
                                ...(list.defaults || []),
                                ...(list.actives || []),
                                ...(list.others || []),
                            ];
                            return all.find(
                                (e) =>
                                    typeof e.url === 'string' &&
                                    (e.url.includes('google.com/search?q=') || e.url.includes('google.com/search?')),
                            );
                        };

                        let googleEntry = findGoogle(before);
                        if (!googleEntry) {
                            for (const startId of [0, -1]) {
                                proxy.searchEngineEditStarted(startId);
                                const okName = await proxy.validateSearchEngineInput('searchEngine', 'Google');
                                const okKey = await proxy.validateSearchEngineInput('keyword', 'google.com');
                                const okUrl = await proxy.validateSearchEngineInput('queryUrl', 'https://www.google.com/search?q=%s');
                                if (okName && okKey && okUrl) {
                                    proxy.searchEngineEditCompleted(
                                        'Google',
                                        'google.com',
                                        'https://www.google.com/search?q=%s',
                                        ''
                                    );
                                    break;
                                }
                                proxy.searchEngineEditCancelled();
                            }
                            await new Promise((r) => setTimeout(r, 250));
                            const afterAdd = await proxy.getSearchEnginesList();
                            googleEntry = findGoogle(afterAdd);
                        }

                        if (!googleEntry) {
                            return { ok: false, reason: 'add_failed' };
                        }

                        proxy.setDefaultSearchEngine(googleEntry.id, 0, null);
                        await new Promise((r) => setTimeout(r, 250));
                        const afterSet = await proxy.getSearchEnginesList();
                        const finalDefault = (afterSet.defaults || []).find((d) => d.default);
                        return {
                            ok: Boolean(finalDefault && finalDefault.name === 'Google'),
                            finalDefault: finalDefault ? finalDefault.name : null,
                        };
                    })()`,
                    awaitPromise: true,
                    returnByValue: true,
                },
                sessionId,
                5000,
            );

            const val = (evalResp?.result as { result?: { value?: { ok?: boolean; skipped?: boolean; finalDefault?: string } } } | undefined)
                ?.result?.value;
            if (val?.ok) {
                log.info(
                    `[CDP] C++ 内核默认搜索引擎检查完成 (${envId.substring(0, 8)}): ${val.skipped ? '保留用户现有设置' : `已设为 ${val.finalDefault}`}`,
                );
                return true;
            }
            log.warn(`[CDP] C++ 内核设置默认 Google 搜索未成功 (${envId.substring(0, 8)}):`, val);
            return false;
        } catch (err) {
            log.warn(`[CDP] 设置默认搜索引擎异常 (${envId.substring(0, 8)}):`, err);
            return false;
        } finally {
            if (targetId) {
                try {
                    await this.sendCommand(envId, ws, 'Target.closeTarget', { targetId }, undefined, 1000);
                } catch {
                    /* ignore */
                }
            }
        }
    }

    /**
     * 启动页智能去重：
     * 仅在当前未恢复任何旧业务标签页、且未已打开相同启动页时，才复用空白页导航到启动页。
     * 避免每次重启因 `--restore-last-session` 导致启动页（如 ip125.com）越开越多。
     */
    public async ensureStartupUrl(envId: string, startupUrl: string): Promise<boolean> {
        const connection = this.connections.get(envId);
        if (!connection || !connection.connected || connection.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        const ws = connection.ws;
        const trimmed = startupUrl?.trim() || '';
        if (!trimmed) return false;

        try {
            let latestTargets: Array<{ targetId: string; url?: string; type?: string }> = [];
            // 给 Chrome 最多 900ms 完成上次会话标签页恢复，一旦发现旧页面立即跳过
            const deadline = Date.now() + 900;
            while (Date.now() < deadline) {
                const resp = await this.sendCommand(envId, ws, 'Target.getTargets', {}, undefined, 1000);
                const infos = (
                    resp?.result as
                        | { targetInfos?: Array<{ targetId: string; url?: string; type?: string }> }
                        | undefined
                )?.targetInfos;
                if (Array.isArray(infos)) {
                    latestTargets = infos;
                    const quickDecision = decideStartupUrlAction(latestTargets, trimmed);
                    if (quickDecision.action === 'skip') {
                        log.info(
                            `[CDP] 启动页已跳过 (${envId.substring(0, 8)}): ${quickDecision.reason}`,
                        );
                        return false;
                    }
                }
                await new Promise((r) => setTimeout(r, 120));
            }

            const decision = decideStartupUrlAction(latestTargets, trimmed);
            if (decision.action === 'skip') {
                log.info(`[CDP] 启动页已跳过 (${envId.substring(0, 8)}): ${decision.reason}`);
                return false;
            }

            if (decision.action === 'navigate') {
                const attached = await this.sendCommand(
                    envId,
                    ws,
                    'Target.attachToTarget',
                    { targetId: decision.targetId, flatten: true },
                    undefined,
                    1500,
                );
                const sessionId = (attached?.result as { sessionId?: string } | undefined)?.sessionId;
                if (sessionId) {
                    await this.sendCommand(
                        envId,
                        ws,
                        'Page.navigate',
                        { url: decision.url },
                        sessionId,
                        2000,
                    );
                    log.info(`[CDP] 已在空白标签页打开启动页 (${envId.substring(0, 8)})`);
                    return true;
                }
            }

            await this.sendCommand(
                envId,
                ws,
                'Target.createTarget',
                { url: decision.url },
                undefined,
                2000,
            );
            log.info(`[CDP] 已新建标签页打开启动页 (${envId.substring(0, 8)})`);
            return true;
        } catch (err) {
            log.warn(`[CDP] 启动页智能处理异常 (${envId.substring(0, 8)}):`, err);
            return false;
        }
    }

    /**
     * 检查连接状态
     */
    public isConnected(envId: string): boolean {
        const connection = this.connections.get(envId);
        return connection ? connection.connected : false;
    }

    /**
     * 获取指定环境当前缓存的 CDP 连接元数据（只读快照）
     */
    public getConnectionInfo(envId: string): {
        debugPort: number;
        debugUrl: string;
        connected: boolean;
    } | null {
        const connection = this.connections.get(envId);
        if (!connection) {
            return null;
        }
        return {
            debugPort: connection.debugPort,
            debugUrl: connection.debugUrl,
            connected: connection.connected,
        };
    }

    /**
     * 查询运行中 Chrome 调试端口当前的浏览器级 WebSocket 端点
     */
    public async fetchLiveWsEndpoint(port: number): Promise<string | null> {
        if (!Number.isInteger(port) || port <= 0) {
            return null;
        }
        return this.getBrowserWebSocketUrl(port);
    }

    /**
     * 通过短连接执行一次性浏览器级 CDP 操作（Cookie 读写 / 窗口网格排列）
     */
    private async withEphemeralBrowserClient<T>(
        debugPort: number,
        fn: (
            call: (
                method: string,
                params?: Record<string, unknown>,
                sessionId?: string,
            ) => Promise<Record<string, unknown>>,
        ) => Promise<T>,
    ): Promise<T> {
        let wsUrl: string | null = null;
        const waitDeadline = Date.now() + 6000;
        while (Date.now() < waitDeadline) {
            wsUrl = await this.getBrowserWebSocketUrl(debugPort);
            if (wsUrl) break;
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (!wsUrl) {
            throw new Error('浏览器调试端口暂不可达，请确认环境仍在运行');
        }
        const ws = new WebSocket(wsUrl);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('连接浏览器 CDP 超时'));
            }, 4000);
            ws.once('open', () => {
                clearTimeout(timer);
                resolve();
            });
            ws.once('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });

        let nextId = 1;
        const pending = new Map<
            number,
            {
                resolve: (value: Record<string, unknown>) => void;
                reject: (err: Error) => void;
                timer: NodeJS.Timeout;
            }
        >();

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString()) as {
                    id?: number;
                    result?: Record<string, unknown>;
                    error?: { message?: string };
                };
                if (msg.id && pending.has(msg.id)) {
                    const entry = pending.get(msg.id)!;
                    clearTimeout(entry.timer);
                    pending.delete(msg.id);
                    if (msg.error) {
                        entry.reject(
                            new Error(msg.error.message || 'CDP 命令执行失败'),
                        );
                    } else {
                        entry.resolve(msg.result || {});
                    }
                }
            } catch {
                /* ignore malformed frame */
            }
        });

        const call = (
            method: string,
            params: Record<string, unknown> = {},
            sessionId?: string,
        ): Promise<Record<string, unknown>> =>
            new Promise((resolve, reject) => {
                if (ws.readyState !== WebSocket.OPEN) {
                    reject(new Error('CDP 连接已关闭'));
                    return;
                }
                const id = nextId++;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`CDP 命令超时: ${method}`));
                }, 5000);
                pending.set(id, { resolve, reject, timer });
                try {
                    const payload: Record<string, unknown> = {
                        id,
                        method,
                        params,
                    };
                    if (sessionId) {
                        payload.sessionId = sessionId;
                    }
                    ws.send(JSON.stringify(payload));
                } catch (err) {
                    clearTimeout(timer);
                    pending.delete(id);
                    reject(
                        err instanceof Error
                            ? err
                            : new Error('CDP 命令发送失败'),
                    );
                }
            });

        try {
            return await fn(call);
        } finally {
            for (const entry of pending.values()) {
                clearTimeout(entry.timer);
            }
            pending.clear();
            try {
                ws.close();
            } catch {
                /* ignore */
            }
        }
    }

    public async getBrowserCookies(
        debugPort: number,
    ): Promise<Record<string, unknown>[]> {
        return this.withEphemeralBrowserClient(debugPort, async (call) => {
            const res = await call('Storage.getCookies');
            return Array.isArray(res.cookies)
                ? (res.cookies as Record<string, unknown>[])
                : [];
        });
    }

    public async setBrowserCookies(
        debugPort: number,
        cookies: Record<string, unknown>[],
    ): Promise<number> {
        if (!Array.isArray(cookies) || cookies.length === 0) return 0;
        const cdpCookies = cookies.map((item) => {
            const rawDomain =
                typeof item.domain === 'string' ? item.domain.trim() : '';
            const cleanHost = rawDomain.replace(/^\./, '');
            const cookiePath =
                typeof item.path === 'string' && item.path.startsWith('/')
                    ? item.path
                    : '/';
            const scheme = item.secure ? 'https' : 'http';
            const url = `${scheme}://${cleanHost}${cookiePath}`;
            const isIpOrLocalhost =
                cleanHost === 'localhost' ||
                /^(?:\d{1,3}\.){3}\d{1,3}$/.test(cleanHost) ||
                cleanHost.includes(':');
            if (isIpOrLocalhost) {
                const clone: Record<string, unknown> = {
                    ...item,
                    path: cookiePath,
                    url,
                };
                delete clone.domain;
                return clone;
            }
            return { ...item, domain: rawDomain, path: cookiePath, url };
        });
        await this.withEphemeralBrowserClient(debugPort, async (call) => {
            await call('Storage.setCookies', { cookies: cdpCookies });
        });
        return cdpCookies.length;
    }

    private async fetchDebugTargets(
        debugPort: number,
    ): Promise<Array<{ id?: string; type?: string }>> {
        return new Promise<Array<{ id?: string; type?: string }>>((resolve) => {
            const req = http.get(
                `http://127.0.0.1:${debugPort}/json/list`,
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(Array.isArray(parsed) ? parsed : []);
                        } catch {
                            resolve([]);
                        }
                    });
                },
            );
            req.on('error', () => resolve([]));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve([]);
            });
        });
    }

    public async setWindowBoundsForPort(
        debugPort: number,
        bounds: { left: number; top: number; width: number; height: number },
    ): Promise<boolean> {
        let pageTarget: { id?: string; type?: string } | undefined;
        const waitDeadline = Date.now() + 8000;
        while (Date.now() < waitDeadline) {
            const targets = await this.fetchDebugTargets(debugPort);
            pageTarget =
                targets.find((item) => item.type === 'page' && item.id) ||
                targets.find((item) => item.id);
            if (pageTarget?.id) break;
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (!pageTarget?.id) return false;

        const targetId = pageTarget.id;
        return this.withEphemeralBrowserClient(debugPort, async (call) => {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    const winInfo = await call('Browser.getWindowForTarget', {
                        targetId,
                    });
                    const windowId = Number(winInfo.windowId);
                    if (!Number.isInteger(windowId)) {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        continue;
                    }
                    await call('Browser.setWindowBounds', {
                        windowId,
                        bounds: { windowState: 'normal' },
                    });
                    await call('Browser.setWindowBounds', {
                        windowId,
                        bounds: {
                            left: Math.round(bounds.left),
                            top: Math.round(bounds.top),
                            width: Math.round(bounds.width),
                            height: Math.round(bounds.height),
                            windowState: 'normal',
                        },
                    });
                    return true;
                } catch {
                    if (attempt === 2) return false;
                    await new Promise((resolve) => setTimeout(resolve, 250));
                }
            }
            return false;
        });
    }

    public async setWindowStateForPort(
        debugPort: number,
        windowState: 'minimized' | 'normal' | 'maximized',
    ): Promise<boolean> {
        let pageTarget: { id?: string; type?: string } | undefined;
        const waitDeadline = Date.now() + 4000;
        while (Date.now() < waitDeadline) {
            const targets = await this.fetchDebugTargets(debugPort);
            pageTarget =
                targets.find((item) => item.type === 'page' && item.id) ||
                targets.find((item) => item.id);
            if (pageTarget?.id) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!pageTarget?.id) return false;
        const targetId = pageTarget.id;

        return this.withEphemeralBrowserClient(debugPort, async (call) => {
            const winInfo = await call('Browser.getWindowForTarget', {
                targetId,
            });
            const windowId = Number(winInfo.windowId);
            if (!Number.isInteger(windowId)) return false;
            await call('Browser.setWindowBounds', {
                windowId,
                bounds: { windowState },
            });
            return true;
        });
    }

    public async focusWindowForPort(debugPort: number): Promise<boolean> {
        let pageTarget: { id?: string; type?: string } | undefined;
        const waitDeadline = Date.now() + 4000;
        while (Date.now() < waitDeadline) {
            const targets = await this.fetchDebugTargets(debugPort);
            pageTarget =
                targets.find((item) => item.type === 'page' && item.id) ||
                targets.find((item) => item.id);
            if (pageTarget?.id) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!pageTarget?.id) return false;
        const targetId = pageTarget.id;

        return this.withEphemeralBrowserClient(debugPort, async (call) => {
            const winInfo = await call('Browser.getWindowForTarget', {
                targetId,
            });
            const windowId = Number(winInfo.windowId);
            const currentBounds = (winInfo.bounds || {}) as {
                windowState?: string;
            };
            if (
                Number.isInteger(windowId) &&
                currentBounds.windowState === 'minimized'
            ) {
                await call('Browser.setWindowBounds', {
                    windowId,
                    bounds: { windowState: 'normal' },
                });
            }
            const attached = await call('Target.attachToTarget', {
                targetId,
                flatten: true,
            });
            const sessionId =
                typeof attached.sessionId === 'string'
                    ? attached.sessionId
                    : '';
            if (sessionId) {
                try {
                    await call('Page.bringToFront', {}, sessionId);
                } finally {
                    await call('Target.detachFromTarget', { sessionId }).catch(
                        () => {},
                    );
                }
            }
            return true;
        });
    }

    /**
     * 清理所有连接
     */
    public cleanup(): void {
        for (const envId of [...this.connections.keys()]) {
            this.disconnect(envId);
        }
        for (const entry of this.pendingResponses.values()) {
            clearTimeout(entry.timer);
        }
        this.pendingResponses.clear();
    }
}
