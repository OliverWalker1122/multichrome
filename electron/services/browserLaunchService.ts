import { spawn, type StdioOptions } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import log from 'electron-log';
import { CDPManager } from '../drivers/cdpManager.js';
import {
    activateProcessWindowByPid,
    allowForegroundForPid,
    getForegroundWindowPid,
} from '../drivers/nativeWindowFocus.js';
import { DebugPortReservationPool } from '../drivers/portAllocator.js';
import { BrowserProcessScanner } from '../drivers/browserProcessScanner.js';
import { findSystemChromeExecutable } from '../drivers/chromeDiscovery.js';
import { loadExtensionsViaCdpPipe } from '../drivers/extensionPipeLoader.js';
import { writeNativeStealthPreferences } from '../drivers/nativePreferences.js';
import { isProfileRunningLocally } from '../drivers/profileLock.js';
import {
    hasSavedChromeSession,
    resolveExtensionTemplatePaths,
    syncBookmarksToProfile,
} from '../drivers/profileTemplateDriver.js';
import {
    buildAcceptLangSwitchValue,
    createProxyStartupGate,
    rewriteProxyAddressForGate,
    type ProxyStartupGate,
} from '../drivers/proxyStartupGate.js';
import {
    parseProxyAddress,
    probeProxyExitInfo,
} from '../drivers/proxyProbeClient.js';
import {
    buildManagedProxyArgs,
    buildManualProxyArgs,
} from '../domain/managedProxyArgs.js';
import {
    buildFingerprintChromiumArgs,
    generateFingerprintConfig,
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
} from '../domain/fingerprintProfile.js';
import { buildMemorySaverChromiumArgs } from '../domain/processMetrics.js';
import {
    computeWindowArrangement,
    normalizeWindowArrangeMode,
    sanitizeWindowTitleTag,
} from '../domain/windowTiling.js';
import {
    parseCookiesInput,
    serializeCookiesJson,
    serializeCookiesNetscape,
} from '../domain/cookieCodec.js';
import { resolveEffectiveStartupUrl } from '../domain/profileTemplatePolicy.js';
import {
    resolveEffectiveLanguage,
    resolveTimezoneForCountry,
} from '../domain/proxyGeo.js';
import type {
    ChromeEnvironment,
    EnvironmentRepository,
    FingerprintConfig,
} from '../repositories/environmentRepository.js';
import type {
    BrowserEngineType,
    SettingsManager,
} from '../repositories/settingsRepository.js';
import type { KernelService } from './kernelService.js';
import type { ProxyService } from './proxyService.js';

export interface ProxyExitInfo {
    ip: string;
    timezone?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
}

export interface RunningEnvironmentRecord {
    envId: string;
    dataDir: string;
    pid?: number;
    debugPort?: number;
    launchedAt: number;
    proxyId?: string;
    startupGate?: ProxyStartupGate;
}

interface ManagedProxySummary {
    id: string;
    name?: string;
    status?: string;
    localAddress?: string;
    exitInfo?: {
        status?: string;
        ip?: string;
        countryCode?: string;
        timezone?: string;
        latitude?: number;
        longitude?: number;
    };
}

/**
 * Browser Runtime & Launch Orchestration Service (Layer 2 Application Service).
 *
 * Coordinates dual-engine binary resolution, private randomized CDP port allocation,
 * Fail-Closed proxy startup gate, native stealth Preferences, process spawning,
 * CDP Emulation handshake, and process health monitoring.
 * Zero SQLite SQL, zero `BrowserWindow`, zero `ipcMain` dependencies.
 */
export class BrowserLaunchService {
    public readonly runningProcesses: Map<string, RunningEnvironmentRecord> =
        new Map();
    private readonly launchingEnvironments: Map<string, Promise<boolean>> =
        new Map();
    private readonly portPool = new DebugPortReservationPool();
    private readonly cdpManager = new CDPManager();
    private readonly processScanner = new BrowserProcessScanner();
    private readonly proxyGeoCache: Map<
        string,
        { info: ProxyExitInfo; expiresAt: number }
    > = new Map();
    private readonly PROXY_IP_CACHE_TTL_MS = 90_000;
    private statusCheckInterval: NodeJS.Timeout | null = null;
    private isChecking = false;
    private readonly statusListeners: Set<() => void> = new Set();

    constructor(
        private readonly deps: {
            repository: EnvironmentRepository;
            proxyService: ProxyService;
            settingsRepository: SettingsManager;
            kernelService: KernelService;
        },
    ) {
        this.startStatusMonitoring();
    }

    public subscribeStatusChange(listener: () => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    private emitStatusChanged(): void {
        for (const listener of this.statusListeners) {
            try {
                listener();
            } catch {
                // ignore listener error
            }
        }
    }

    public isRunning(id: string): boolean {
        return this.runningProcesses.has(id);
    }

    public getRunningIds(): string[] {
        return Array.from(this.runningProcesses.keys());
    }

    public getCachedProxyGeo(
        cacheKey: string,
    ): { info: ProxyExitInfo; expiresAt: number } | undefined {
        return this.proxyGeoCache.get(cacheKey);
    }

    public getSystemChromePath(): string {
        const cached = this.deps.repository.getCachedChromePath();
        if (cached && fs.existsSync(cached)) {
            return cached;
        }
        const detected = findSystemChromeExecutable();
        if (detected && fs.existsSync(detected)) {
            this.deps.repository.setCachedChromePath(detected);
            return detected;
        }
        if (!detected) {
            log.warn('未找到Chrome可执行文件');
        }
        return cached;
    }

    private startStatusMonitoring(): void {
        this.statusCheckInterval = setInterval(() => {
            void this.checkProcessStatus();
        }, 300_000);
    }

    private async checkProcessStatus(): Promise<void> {
        if (this.isChecking || this.runningProcesses.size === 0) {
            return;
        }
        this.isChecking = true;

        try {
            const observedProcesses = new Map(this.runningProcesses);
            const checkedAt = Date.now();
            const runningEnvIds =
                await this.processScanner.scanRunningEnvironmentShortIds(true);

            const endedIds: string[] = [];
            for (const [id, processInfo] of observedProcesses.entries()) {
                if (this.runningProcesses.get(id) !== processInfo) continue;
                const { dataDir, launchedAt } = processInfo;
                if (!dataDir || (launchedAt && checkedAt - launchedAt < 30_000)) {
                    continue;
                }
                const envId = path.basename(dataDir);
                if (!runningEnvIds.includes(envId)) {
                    endedIds.push(id);
                    log.info(
                        `检测到Chrome环境进程已结束: ID=${id}, DataDir=${dataDir}`,
                    );
                }
            }

            endedIds.forEach((id) => {
                const endedRecord = this.runningProcesses.get(id);
                if (endedRecord?.proxyId) {
                    this.deps.proxyService?.touchActivity?.(endedRecord.proxyId);
                }
                if (endedRecord?.debugPort) {
                    this.portPool.release(endedRecord.debugPort);
                }
                this.runningProcesses.delete(id);
            });

            if (endedIds.length > 0) {
                log.info(
                    `进程状态发生变化，通知前端更新: 变化数量=${endedIds.length}`,
                );
                this.emitStatusChanged();
            }
        } catch (error) {
            log.error('检查进程状态失败:', error);
        } finally {
            this.isChecking = false;
        }
    }

    public stopStatusMonitoring(): void {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
        for (const record of this.runningProcesses.values()) {
            if (record.startupGate) {
                void record.startupGate.close();
                record.startupGate = undefined;
            }
        }
        this.cdpManager.cleanup();
    }

    public async getRunningResourceStats(): Promise<{
        totalMemoryBytes: number;
        totalProcesses: number;
        environments: Record<
            string,
            { memoryBytes: number; processCount: number }
        >;
    }> {
        return this.processScanner.collectRunningResourceStats(
            this.getRunningIds(),
        );
    }

    public async openUrlInEnvironment(id: string, url: string): Promise<boolean> {
        let parsed: URL;
        try {
            parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('仅支持 HTTP 或 HTTPS 链接');
            }
        } catch {
            throw new Error('无效的检测页面链接');
        }
        if (!this.runningProcesses.has(id)) {
            throw new Error('请先启动此环境，再在环境内打开检测页面');
        }
        return this.cdpManager.openUrl(id, parsed.toString());
    }

    private async isManagedProxyInUseByOtherBrowser(
        proxyId: string,
        excludeEnvId?: string,
    ): Promise<boolean> {
        const rows = this.deps.repository.findRowsByProxyId(proxyId);
        for (const row of rows) {
            if (row.id === excludeEnvId) continue;
            if (this.runningProcesses.has(row.id)) {
                return true;
            }
        }
        for (const row of rows) {
            if (row.id === excludeEnvId || !row.dataDir) continue;
            const local = await isProfileRunningLocally(row.dataDir);
            if (local.running) {
                return true;
            }
        }
        return false;
    }

    private evictProxyGeoCache(proxyAddress?: string): void {
        if (!proxyAddress) return;
        const parsed = parseProxyAddress(proxyAddress);
        if (!parsed) return;
        const cacheKey = `${parsed.protocol}//${parsed.host}:${parsed.port}`;
        this.proxyGeoCache.delete(cacheKey);
    }

    public async ensureManagedProxyReady(
        proxyId: string,
        excludeEnvId?: string,
    ): Promise<string> {
        const previousAddress = (
            this.deps.proxyService.list() as ManagedProxySummary[]
        ).find((item) => item.id === proxyId)?.localAddress;

        const nextAddress =
            typeof this.deps.proxyService.ensureFresh === 'function'
                ? await this.deps.proxyService.ensureFresh(proxyId, {
                      isInUse: () =>
                          this.isManagedProxyInUseByOtherBrowser(
                              proxyId,
                              excludeEnvId,
                          ),
                  })
                : await this.deps.proxyService.ensureStarted(proxyId);

        if (previousAddress && previousAddress !== nextAddress) {
            this.evictProxyGeoCache(previousAddress);
        }
        return nextAddress;
    }

    private cacheProxyExitInfo(
        proxyAddress: string,
        info: ProxyExitInfo,
    ): void {
        const parsed = parseProxyAddress(proxyAddress);
        if (!parsed) return;
        const cacheKey = `${parsed.protocol}//${parsed.host}:${parsed.port}`;
        this.proxyGeoCache.set(cacheKey, {
            info,
            expiresAt: Date.now() + this.PROXY_IP_CACHE_TTL_MS,
        });
    }

    private toProxyExitInfo(
        raw?: {
            ip?: string;
            countryCode?: string;
            timezone?: string;
            latitude?: number;
            longitude?: number;
        } | null,
    ): ProxyExitInfo | null {
        if (!raw?.ip) return null;
        const countryCode = raw.countryCode || undefined;
        const timezone =
            raw.timezone || resolveTimezoneForCountry(countryCode) || undefined;
        const info: ProxyExitInfo = {
            ip: raw.ip,
            countryCode,
            timezone,
        };
        if (
            typeof raw.latitude === 'number' &&
            typeof raw.longitude === 'number' &&
            Number.isFinite(raw.latitude) &&
            Number.isFinite(raw.longitude)
        ) {
            info.latitude = raw.latitude;
            info.longitude = raw.longitude;
        }
        return info;
    }

    public async resolveManagedProxyExitInfoBeforeLaunch(
        proxyId: string,
        proxyAddress: string,
        options: { needTimezone?: boolean; timeoutMs?: number } = {},
    ): Promise<ProxyExitInfo | null> {
        const parsed = parseProxyAddress(proxyAddress);
        if (parsed) {
            const cacheKey = `${parsed.protocol}//${parsed.host}:${parsed.port}`;
            const cached = this.proxyGeoCache.get(cacheKey);
            if (
                cached &&
                cached.expiresAt > Date.now() &&
                (!options.needTimezone || cached.info.timezone)
            ) {
                log.info(
                    `[代理预解析] 命中短时缓存: ip=${cached.info.ip}, tz=${cached.info.timezone || 'none'}`,
                );
                return cached.info;
            }
        }

        const existing = (
            this.deps.proxyService?.list?.() as ManagedProxySummary[] | undefined
        )?.find((item) => item.id === proxyId)?.exitInfo;
        if (existing?.status === 'ready' && existing.ip) {
            const readyInfo = this.toProxyExitInfo(existing);
            if (readyInfo && (!options.needTimezone || readyInfo.timezone)) {
                this.cacheProxyExitInfo(proxyAddress, readyInfo);
                return readyInfo;
            }
        }

        if (typeof this.deps.proxyService?.refreshExitInfo === 'function') {
            const waitMs = options.timeoutMs ?? 6500;
            let timer: NodeJS.Timeout | undefined;
            try {
                const refreshed = (await Promise.race([
                    this.deps.proxyService.refreshExitInfo(proxyId),
                    new Promise<null>((resolve) => {
                        timer = setTimeout(() => resolve(null), waitMs);
                    }),
                ])) as ManagedProxySummary['exitInfo'] | null;
                if (refreshed?.status === 'ready' && refreshed.ip) {
                    const info = this.toProxyExitInfo(refreshed);
                    if (info) {
                        this.cacheProxyExitInfo(proxyAddress, info);
                        return info;
                    }
                }
                return null;
            } catch {
                return null;
            } finally {
                if (timer) clearTimeout(timer);
            }
        }

        return this.resolveProxyExitInfoBeforeLaunch(proxyAddress, options);
    }

    public async resolveProxyExitInfoBeforeLaunch(
        proxyAddress: string,
        options: { needTimezone?: boolean; bypassCache?: boolean } = {},
    ): Promise<ProxyExitInfo | null> {
        return probeProxyExitInfo(proxyAddress, {
            needTimezone: Boolean(options.needTimezone),
            bypassCache: Boolean(options.bypassCache),
            cache: this.proxyGeoCache,
            cacheTtlMs: this.PROXY_IP_CACHE_TTL_MS,
            logger: log,
        });
    }

    private async waitForDebugEndpoint(
        debugPort: number,
        timeoutMs = 8000,
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const ready = await new Promise<boolean>((resolve) => {
                const req = http.get(
                    `http://127.0.0.1:${debugPort}/json/version`,
                    (res) => {
                        res.resume();
                        resolve(res.statusCode === 200);
                    },
                );
                req.on('error', () => resolve(false));
                req.setTimeout(300, () => {
                    req.destroy();
                    resolve(false);
                });
            });
            if (ready) return true;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
    }

    public launchEnvironment(id: string): Promise<boolean> {
        const inflight = this.launchingEnvironments.get(id);
        if (inflight) {
            log.info(`环境正在启动中，复用当前启动任务: ${id.substring(0, 8)}`);
            return inflight;
        }
        const task = this.launchEnvironmentInternal(id);
        this.launchingEnvironments.set(id, task);
        void task
            .finally(() => {
                if (this.launchingEnvironments.get(id) === task) {
                    this.launchingEnvironments.delete(id);
                }
            })
            .catch(() => {});
        return task;
    }

    private async launchEnvironmentInternal(id: string): Promise<boolean> {
        let allocatedDebugPort: number | undefined;
        let startupGate: ProxyStartupGate | undefined;
        try {
            const env = this.deps.repository.findAnyById(
                id,
                this.runningProcesses.has(id),
            );
            if (!env) {
                log.error(`环境未找到: ${id}`);
                throw new Error(`环境未找到: ${id}`);
            }

            if (this.runningProcesses.has(id)) {
                log.info(`环境已在运行: ${env.name} (${id})`);
                return true;
            }

            if (env.proxyId) {
                const localState = await isProfileRunningLocally(env.dataDir);
                if (localState.running) {
                    throw new Error(
                        '该环境已有浏览器窗口，请先关闭旧窗口，再启动以使用内置代理',
                    );
                }
            }

            const settings = this.deps.settingsRepository.getSettings();
            const globalProxy = settings.globalProxy;
            const fpDefaults = normalizeDefaultFingerprintSettings(
                settings.fingerprint,
            );

            const browserEngine = normalizeBrowserEngine(
                env.browserEngine,
            ) as BrowserEngineType;
            let chromePath = '';
            let activeFingerprintConfig: FingerprintConfig | undefined =
                env.fingerprintConfig;

            if (browserEngine === 'fingerprint-chromium') {
                const activeKernel = this.deps.kernelService.getActiveKernel();
                if (!activeKernel) {
                    throw new Error(
                        '未安装 C++ 指纹内核。请前往「设置 → 浏览器内核」下载或导入 fingerprint-chromium，或将该环境切换为官方 Chrome。',
                    );
                }
                chromePath = activeKernel.executablePath;
                if (!activeFingerprintConfig) {
                    activeFingerprintConfig = generateFingerprintConfig(
                        fpDefaults,
                    ) as FingerprintConfig;
                    this.deps.repository.saveFingerprintConfig(
                        id,
                        activeFingerprintConfig,
                    );
                }
                log.info(
                    `[${env.name}] 使用 C++ 指纹内核 ${activeKernel.version} (seed=${activeFingerprintConfig.seed}, platform=${activeFingerprintConfig.platform}, brand=${activeFingerprintConfig.brand}, cores=${activeFingerprintConfig.hardwareConcurrency}, window=${activeFingerprintConfig.windowSize.width}x${activeFingerprintConfig.windowSize.height})`,
                );
            } else {
                chromePath = this.getSystemChromePath();
                if (!chromePath || !fs.existsSync(chromePath)) {
                    log.error('Chrome可执行文件未找到');
                    throw new Error(
                        'Chrome可执行文件未找到，请确认已安装 Google Chrome',
                    );
                }
            }

            const [debugPort, proxyAddress] = await Promise.all([
                this.portPool.acquire(),
                env.proxyId
                    ? this.ensureManagedProxyReady(env.proxyId, id)
                    : Promise.resolve(
                          env.proxy ||
                              (globalProxy?.enabled
                                  ? globalProxy?.address
                                  : undefined),
                      ),
            ]);
            allocatedDebugPort = debugPort;
            log.info(`[${env.name}] 分配端口: ${debugPort}`);

            const args = [
                `--user-data-dir=${env.dataDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                `--remote-debugging-port=${debugPort}`,
                '--disable-blink-features=AutomationControlled',
                '--test-type',
            ];
            const windowTitleTag = sanitizeWindowTitleTag(env.name);
            if (windowTitleTag) {
                args.push(`--window-name=${windowTitleTag}`);
            }

            const extensionsToLoad: string[] = [];
            if (env.userAgent) {
                args.push(`--user-agent=${env.userAgent}`);
            }

            let startupExitInfo: ProxyExitInfo | null = null;
            let startupProxyIP: string | undefined;
            const manualTimezone = env.timezone?.trim() || undefined;
            const shouldAutoMatchTz =
                !manualTimezone && fpDefaults.autoMatchTimezone;
            const rawEnvLanguage = env.language?.trim() || '';
            const shouldAutoMatchLang =
                rawEnvLanguage.toLowerCase() === 'auto' ||
                (!rawEnvLanguage && Boolean(fpDefaults.autoMatchLanguage));

            if (proxyAddress) {
                try {
                    startupExitInfo = env.proxyId
                        ? await this.resolveManagedProxyExitInfoBeforeLaunch(
                              env.proxyId,
                              proxyAddress,
                              { needTimezone: true },
                          )
                        : await this.resolveProxyExitInfoBeforeLaunch(
                              proxyAddress,
                              { needTimezone: true },
                          );
                    startupProxyIP = startupExitInfo?.ip || undefined;
                    if (startupProxyIP) {
                        log.info(
                            `[${env.name}] 启动前已解析代理出口: ip=${startupProxyIP}${startupExitInfo?.countryCode ? `, country=${startupExitInfo.countryCode}` : ''}${startupExitInfo?.timezone ? `, tz=${startupExitInfo.timezone}` : ''}`,
                        );
                    } else {
                        log.warn(
                            `[${env.name}] 启动前未能解析代理 IP，已通过内核 Fail-Closed 策略防止首开泄露`,
                        );
                    }
                } catch (error) {
                    log.warn(`[${env.name}] 启动前解析代理出口信息失败:`, error);
                }
            }

            const effectiveLanguage = resolveEffectiveLanguage(env.language, {
                autoMatchLanguage: Boolean(fpDefaults.autoMatchLanguage),
                countryCode: startupExitInfo?.countryCode,
                defaultLanguage: fpDefaults.defaultLanguage,
            });
            args.push(`--lang=${effectiveLanguage}`);
            args.push(
                `--accept-lang=${buildAcceptLangSwitchValue(effectiveLanguage)}`,
            );
            log.info(
                `[${env.name}] 使用语言: ${effectiveLanguage}${
                    shouldAutoMatchLang && startupExitInfo?.countryCode
                        ? `（按代理地区 ${startupExitInfo.countryCode} 自动匹配）`
                        : env.language
                          ? ''
                          : '（默认策略）'
                }`,
            );

            const effectiveTimezone =
                manualTimezone ||
                (fpDefaults.autoMatchTimezone
                    ? startupExitInfo?.timezone
                    : undefined) ||
                undefined;
            if (!manualTimezone && effectiveTimezone) {
                log.info(
                    `[${env.name}] 未配置时区，已按代理 IP 自动匹配时区: ${effectiveTimezone}`,
                );
            }

            const isFingerprintChromium =
                browserEngine === 'fingerprint-chromium';

            if (isFingerprintChromium && activeFingerprintConfig) {
                args.push(
                    ...buildFingerprintChromiumArgs(activeFingerprintConfig, {
                        timezone: effectiveTimezone,
                        language: effectiveLanguage,
                    }),
                );
            }

            const shouldAutoMatchGeo = Boolean(fpDefaults.autoMatchGeolocation);
            const startupGeolocation =
                shouldAutoMatchGeo &&
                typeof startupExitInfo?.latitude === 'number' &&
                typeof startupExitInfo?.longitude === 'number'
                    ? {
                          latitude: startupExitInfo.latitude,
                          longitude: startupExitInfo.longitude,
                          accuracy: 100,
                      }
                    : undefined;

            let chromeProxyAddress = proxyAddress;
            const needStartupGate =
                !isFingerprintChromium &&
                Boolean(proxyAddress) &&
                Boolean(effectiveTimezone || startupGeolocation);
            if (needStartupGate && proxyAddress) {
                const parsedUpstream = parseProxyAddress(proxyAddress);
                if (parsedUpstream) {
                    try {
                        startupGate = await createProxyStartupGate({
                            upstreamHost: parsedUpstream.host,
                            upstreamPort: parsedUpstream.port,
                            maxHoldMs: 8000,
                            failClosedOnTimeout: true,
                            logger: log,
                        });
                        const rewritten = rewriteProxyAddressForGate(
                            proxyAddress,
                            startupGate.port,
                        );
                        if (rewritten) {
                            chromeProxyAddress = rewritten.gateProxyAddress;
                            log.info(
                                `[${env.name}] 已启用 Fail-Closed 启动流量闸门 (127.0.0.1:${startupGate.port} -> ${rewritten.upstreamHost}:${rewritten.upstreamPort})`,
                            );
                        } else {
                            await startupGate.close();
                            startupGate = undefined;
                        }
                    } catch (gateErr) {
                        log.warn(
                            `[${env.name}] 启动流量闸门初始化失败，回退直连代理入口:`,
                            gateErr,
                        );
                        if (startupGate) {
                            await startupGate.close();
                            startupGate = undefined;
                        }
                    }
                }
            }

            if (chromeProxyAddress) {
                if (env.proxyId) {
                    args.push(...buildManagedProxyArgs(chromeProxyAddress));
                } else {
                    args.push(...buildManualProxyArgs(chromeProxyAddress));
                }
                log.info(
                    `[${env.name}] 已启用${env.proxyId ? '内置' : '手动'}代理（Fail-Closed 模式）`,
                );
            }

            if (isFingerprintChromium) {
                this.cdpManager.primeEnvironment(id, {
                    geolocation: startupGeolocation,
                });
                writeNativeStealthPreferences({
                    dataDir: env.dataDir,
                    enforceWebRTCFailClosed: Boolean(proxyAddress),
                    language: effectiveLanguage,
                    profileName: env.name,
                    disableDeveloperMode: true,
                    logger: log,
                });
                log.info(
                    `[${env.name}] 已启用 C++ 纯原生隐匿模式（零扩展、零 JS Hook）: tz=${effectiveTimezone || 'pending'}, lang=${effectiveLanguage}, geo=${startupGeolocation ? `${startupGeolocation.latitude.toFixed(2)},${startupGeolocation.longitude.toFixed(2)}` : 'none'}, webrtc=${proxyAddress ? 'fail-closed' : 'direct'}`,
                );
            } else {
                this.cdpManager.primeEnvironment(id, {
                    timezone: effectiveTimezone,
                    locale: effectiveLanguage,
                    geolocation: startupGeolocation,
                });
                writeNativeStealthPreferences({
                    dataDir: env.dataDir,
                    enforceWebRTCFailClosed: Boolean(proxyAddress),
                    language: effectiveLanguage,
                    profileName: env.name,
                    disableDeveloperMode: false,
                    logger: log,
                });
                log.info(
                    `[${env.name}] 已启用标准 Chrome 原生隐匿模式（零扩展、零 JS Hook）: tz=${effectiveTimezone || 'none'}, lang=${effectiveLanguage}, geo=${startupGeolocation ? `${startupGeolocation.latitude.toFixed(2)},${startupGeolocation.longitude.toFixed(2)}` : 'none'}, webrtc=${proxyAddress ? 'fail-closed' : 'direct'}, gate=${startupGate ? 'on' : 'off'}`,
                );
            }

            if (
                settings.bookmarkTemplates &&
                settings.bookmarkTemplates.length > 0
            ) {
                try {
                    const bmRes = syncBookmarksToProfile(
                        env.dataDir,
                        settings.bookmarkTemplates,
                    );
                    if (bmRes.addedCount > 0) {
                        log.info(
                            `[${env.name}] 已分发 ${bmRes.addedCount} 条书签模板（跳过重复 ${bmRes.skippedCount} 条）`,
                        );
                    }
                } catch (err) {
                    log.warn(`[${env.name}] 分发书签模板失败:`, err);
                }
            }

            const installedTrackerPath = path.join(
                env.dataDir,
                '.template-extensions.json',
            );
            const templateExtPaths = resolveExtensionTemplatePaths(
                settings.extensionTemplates,
                {
                    isFingerprintChromium,
                    allowExtensionsOnFingerprintKernel: Boolean(
                        settings.allowExtensionsOnFingerprintKernel,
                    ),
                },
            );
            if (templateExtPaths.length > 0) {
                let installedTemplatePaths: string[] = [];
                try {
                    if (fs.existsSync(installedTrackerPath)) {
                        const raw = JSON.parse(
                            fs.readFileSync(installedTrackerPath, 'utf-8'),
                        );
                        if (Array.isArray(raw)) {
                            installedTemplatePaths = raw.filter(
                                (item): item is string => typeof item === 'string',
                            );
                        }
                    }
                } catch {
                    installedTemplatePaths = [];
                }
                for (const extPath of templateExtPaths) {
                    if (
                        !installedTemplatePaths.includes(extPath) &&
                        !extensionsToLoad.includes(extPath)
                    ) {
                        extensionsToLoad.push(extPath);
                    }
                }
                if (extensionsToLoad.length > 0) {
                    log.info(
                        `[${env.name}] 将通过 CDP pipe 安装 ${extensionsToLoad.length} 个本地扩展模板`,
                    );
                }
            }

            const needPipe = extensionsToLoad.length > 0;
            if (needPipe) {
                args.push('--remote-debugging-pipe');
                args.push('--enable-unsafe-extension-debugging');
                log.info(`[${env.name}] 启用 CDP pipe（首次安装扩展）`);
            }

            if (settings.memorySaverMode) {
                args.push(...buildMemorySaverChromiumArgs());
                log.info(
                    `[${env.name}] 已启用省内存启动策略（Memory Saver + 渲染进程与缓存上限）`,
                );
            }

            args.push('--restore-last-session');

            const startupUrl = resolveEffectiveStartupUrl({
                envStartupUrl: env.startupUrl,
                groupName: env.groupName,
                groupStartupUrls: settings.groupStartupUrls,
                globalStartupUrl: settings.startupUrl,
            });
            const hadSavedSession = hasSavedChromeSession(env.dataDir);
            if (startupUrl && !hadSavedSession) {
                args.push(startupUrl);
            }

            const spawnEnv = { ...process.env };
            if (effectiveTimezone) {
                spawnEnv.TZ = effectiveTimezone;
            }

            const pipeStdio: StdioOptions = [
                'ignore',
                'ignore',
                'ignore',
                'pipe',
                'pipe',
            ];
            const spawnOptions =
                process.platform === 'win32'
                    ? {
                          detached: false,
                          stdio: needPipe ? pipeStdio : ('ignore' as const),
                          windowsHide: false,
                          env: spawnEnv,
                      }
                    : {
                          detached: true,
                          stdio: needPipe ? pipeStdio : ('ignore' as const),
                          env: spawnEnv,
                      };

            const chromeProcess = spawn(chromePath, args, spawnOptions);

            if (needPipe && chromeProcess.stdio[3] && chromeProcess.stdio[4]) {
                loadExtensionsViaCdpPipe(
                    chromeProcess,
                    extensionsToLoad,
                    env.name,
                    installedTrackerPath,
                );
            }

            chromeProcess.on('error', (error) => {
                log.error(`Chrome 启动失败: ID=${id}, code=${error.name}`);
                this.portPool.release(debugPort);
                if (startupGate) {
                    void startupGate.close();
                }
                this.runningProcesses.delete(id);
                this.cdpManager.disconnect(id);
                this.emitStatusChanged();
            });

            this.runningProcesses.set(id, {
                envId: id,
                dataDir: env.dataDir,
                pid: chromeProcess.pid,
                debugPort,
                launchedAt: Date.now(),
                proxyId: env.proxyId,
                startupGate,
            });
            if (env.proxyId) {
                this.deps.proxyService?.touchActivity?.(env.proxyId);
            }
            const launchRecord = this.runningProcesses.get(id);

            this.deps.repository.touchLastUsed(id);
            log.info(
                `[${env.name}] 启动Chrome - PID:${chromeProcess.pid}, 端口:${debugPort}, ID:${id.substring(0, 8)}`,
            );

            const envIdShort = id.substring(0, 8);
            const isEnLocale = settings.locale !== 'zh-CN';
            const handleBrowserDisconnected = () => {
                if (this.runningProcesses.get(id) !== launchRecord) return;
                log.info(
                    `[${env.name}] 浏览器已关闭 - 端口:${debugPort}, ID:${envIdShort}`,
                );
                this.portPool.release(debugPort);
                if (launchRecord?.proxyId) {
                    this.deps.proxyService?.touchActivity?.(launchRecord.proxyId);
                }
                if (launchRecord?.startupGate) {
                    void launchRecord.startupGate.close();
                    launchRecord.startupGate = undefined;
                }
                this.runningProcesses.delete(id);
                this.emitStatusChanged();
            };

            const runBackgroundExitRetry = async () => {
                if (
                    proxyAddress &&
                    (!startupProxyIP ||
                        (shouldAutoMatchTz && !effectiveTimezone))
                ) {
                    try {
                        // 托管代理已在 ProxyService 内维持单飞 HTTPS 出口检测，不再重复打并发探测连接
                        const retryInfo = env.proxyId
                            ? await this.resolveManagedProxyExitInfoBeforeLaunch(
                                  env.proxyId,
                                  proxyAddress,
                                  {
                                      needTimezone:
                                          shouldAutoMatchTz && !effectiveTimezone,
                                      timeoutMs: 6000,
                                  },
                              )
                            : await this.resolveProxyExitInfoBeforeLaunch(
                                  proxyAddress,
                                  {
                                      needTimezone:
                                          shouldAutoMatchTz && !effectiveTimezone,
                                      bypassCache: true,
                                  },
                              );
                        if (this.runningProcesses.get(id) !== launchRecord)
                            return;
                        if (retryInfo?.ip) {
                            const resolvedTz =
                                manualTimezone ||
                                effectiveTimezone ||
                                (fpDefaults.autoMatchTimezone
                                    ? retryInfo.timezone
                                    : undefined);
                            // C++ 指纹内核时区由启动参数原生固化；严禁在页面运行中途开启
                            // waitForDebuggerOnStart 注入 CDP 时区，否则会挂起 Gmail 等重度应用的 SW/iframe
                            if (
                                !isFingerprintChromium &&
                                shouldAutoMatchTz &&
                                !effectiveTimezone &&
                                retryInfo.timezone
                            ) {
                                await this.cdpManager.setTimezone(
                                    id,
                                    retryInfo.timezone,
                                );
                            }
                            if (
                                !isFingerprintChromium &&
                                shouldAutoMatchGeo &&
                                !startupGeolocation &&
                                typeof retryInfo.latitude === 'number' &&
                                typeof retryInfo.longitude === 'number'
                            ) {
                                await this.cdpManager.setGeolocation(id, {
                                    latitude: retryInfo.latitude,
                                    longitude: retryInfo.longitude,
                                    accuracy: 100,
                                });
                            }
                            log.info(
                                `[${env.name}] 后台补测代理出口成功并已刷新: ip=${retryInfo.ip}, tz=${resolvedTz || 'none'}`,
                            );
                        } else {
                            log.warn(
                                `[${env.name}] 后台补测代理出口仍未返回，继续保持内核 Fail-Closed 防泄露保护`,
                            );
                        }
                    } catch (err) {
                        log.warn(`[${env.name}] 后台补测代理出口失败:`, err);
                    }
                }
            };

            if (startupGate) {
                let gateHandshakeOk = false;
                try {
                    const debugReady = await this.waitForDebugEndpoint(
                        debugPort,
                        7500,
                    );
                    if (
                        debugReady &&
                        !startupGate.isAborted() &&
                        this.runningProcesses.get(id) === launchRecord
                    ) {
                        const cdpConnected = await this.cdpManager.connect(
                            id,
                            debugPort,
                            handleBrowserDisconnected,
                            async () =>
                                (
                                    await isProfileRunningLocally(
                                        env.dataDir,
                                        debugPort,
                                    )
                                ).running,
                        );
                        if (
                            cdpConnected &&
                            !startupGate.isAborted() &&
                            this.runningProcesses.get(id) === launchRecord
                        ) {
                            log.info(`✅ [${env.name}] CDP连接成功 - ID:${envIdShort}`);
                            const overridesReady =
                                await this.cdpManager.applyOverrides(id);
                            if (
                                overridesReady &&
                                !startupGate.isAborted() &&
                                this.runningProcesses.get(id) === launchRecord
                            ) {
                                await this.cdpManager.flushStartupGate(
                                    id,
                                    startupGate,
                                );
                                if (
                                    !startupGate.isAborted() &&
                                    startupGate.isReleased()
                                ) {
                                    gateHandshakeOk = true;
                                    log.info(
                                        `[${env.name}] CDP原生覆盖成功: tz=${effectiveTimezone || 'none'}, lang=${effectiveLanguage}, ip=${startupProxyIP || 'fail-closed'}`,
                                    );
                                }
                            }
                        }
                    }
                } catch (handshakeErr) {
                    log.warn(`[${env.name}] 启动闸门握手异常:`, handshakeErr);
                }

                if (!gateHandshakeOk) {
                    log.error(
                        `❌ [${env.name}] 启动安全防护超时未就绪，已 Fail-Closed 阻断并终止本次启动`,
                    );
                    await startupGate.abortFailClosed();
                    if (launchRecord) {
                        launchRecord.startupGate = undefined;
                    }
                    try {
                        await this.closeEnvironment(id);
                    } catch {
                        this.portPool.release(debugPort);
                        this.runningProcesses.delete(id);
                        this.cdpManager.disconnect(id);
                        this.emitStatusChanged();
                    }
                    allocatedDebugPort = undefined;
                    startupGate = undefined;
                    throw new Error(
                        isEnLocale
                            ? `Security protection for "${env.name}" timed out before launch completed. Launch was blocked to prevent timezone leak — please try launching again.`
                            : `「${env.name}」安全防护初始化超时，已拦截本次启动以防止时区泄露，请重试启动。`,
                    );
                }

                if (startupUrl && hadSavedSession) {
                    void this.cdpManager.ensureStartupUrl(id, startupUrl);
                }
                void runBackgroundExitRetry();
                this.emitStatusChanged();
                return true;
            }

            void (async () => {
                const debugReady = await this.waitForDebugEndpoint(debugPort);
                if (this.runningProcesses.get(id) !== launchRecord) return;
                if (!debugReady) {
                    log.warn(
                        `[${env.name}] 调试端口未就绪，使用轮询检测 - ID:${envIdShort}`,
                    );
                    const runningEnvIds =
                        await this.processScanner.scanRunningEnvironmentShortIds(
                            true,
                        );
                    if (this.runningProcesses.get(id) !== launchRecord) return;
                    if (runningEnvIds.includes(envIdShort)) {
                        log.info(
                            `✅ [${env.name}] 轮询确认运行中 - ID:${envIdShort}`,
                        );
                    } else {
                        log.error(`❌ [${env.name}] 启动失败 - ID:${envIdShort}`);
                        this.portPool.release(debugPort);
                        this.runningProcesses.delete(id);
                        this.cdpManager.disconnect(id);
                        this.emitStatusChanged();
                    }
                    return;
                }

                const cdpConnected = await this.cdpManager.connect(
                    id,
                    debugPort,
                    handleBrowserDisconnected,
                    async () =>
                        (await isProfileRunningLocally(env.dataDir, debugPort))
                            .running,
                );
                if (this.runningProcesses.get(id) !== launchRecord) return;

                if (cdpConnected) {
                    log.info(`✅ [${env.name}] CDP连接成功 - ID:${envIdShort}`);

                    if (isFingerprintChromium) {
                        if (startupGeolocation) {
                            await this.cdpManager.applyOverrides(id);
                            if (this.runningProcesses.get(id) !== launchRecord)
                                return;
                        }
                        const searchReadyMarker = path.join(
                            env.dataDir,
                            '.google-search-ready',
                        );
                        if (!fs.existsSync(searchReadyMarker)) {
                            const searchConfigured =
                                await this.cdpManager.ensureDefaultGoogleSearch(
                                    id,
                                );
                            if (this.runningProcesses.get(id) !== launchRecord)
                                return;
                            if (searchConfigured) {
                                try {
                                    fs.writeFileSync(searchReadyMarker, '1');
                                } catch {
                                    /* ignore */
                                }
                            }
                        }
                    } else {
                        const overridesReady =
                            await this.cdpManager.applyOverrides(id);
                        if (this.runningProcesses.get(id) !== launchRecord)
                            return;
                        log.info(
                            `[${env.name}] CDP原生覆盖${overridesReady ? '成功' : '失败'}: tz=${effectiveTimezone || 'none'}, lang=${effectiveLanguage}, ip=${startupProxyIP || 'fail-closed'}`,
                        );
                    }

                    if (startupUrl && hadSavedSession) {
                        void this.cdpManager.ensureStartupUrl(id, startupUrl);
                    }

                    await runBackgroundExitRetry();
                    this.emitStatusChanged();
                } else {
                    log.warn(
                        `[${env.name}] CDP连接失败，使用轮询检测 - ID:${envIdShort}`,
                    );
                    const runningEnvIds =
                        await this.processScanner.scanRunningEnvironmentShortIds(
                            true,
                        );
                    if (this.runningProcesses.get(id) !== launchRecord) return;
                    if (runningEnvIds.includes(envIdShort)) {
                        log.info(
                            `✅ [${env.name}] 轮询确认运行中 - ID:${envIdShort}`,
                        );
                    } else {
                        log.error(`❌ [${env.name}] 启动失败 - ID:${envIdShort}`);
                        this.portPool.release(debugPort);
                        this.runningProcesses.delete(id);
                        this.cdpManager.disconnect(id);
                        this.emitStatusChanged();
                    }
                }
            })().catch(() => {
                log.warn('无法确认浏览器启动状态，将在后续状态检查中重试');
            });

            return true;
        } catch (error) {
            if (allocatedDebugPort !== undefined) {
                this.portPool.release(allocatedDebugPort);
            }
            if (startupGate) {
                void startupGate.close();
            }
            log.error('启动环境失败:', error);
            throw error;
        }
    }

    public async getAutomationConnectionInfo(id: string): Promise<{
        debugPort: number;
        wsEndpoint: string | null;
        httpEndpoint: string;
        debuggerAddress: string;
    } | null> {
        const procRecord = this.runningProcesses.get(id);
        const cdpInfo = this.cdpManager.getConnectionInfo(id);
        if (!procRecord) {
            return null;
        }
        if (procRecord.startupGate && !procRecord.startupGate.isReleased()) {
            return null;
        }
        const debugPort = procRecord.debugPort || cdpInfo?.debugPort;
        if (!debugPort || !Number.isInteger(debugPort) || debugPort <= 0) {
            return null;
        }
        const liveWs = await this.cdpManager.fetchLiveWsEndpoint(debugPort);
        const wsEndpoint =
            liveWs ||
            (cdpInfo?.connected && cdpInfo.debugUrl ? cdpInfo.debugUrl : null);
        if (!wsEndpoint) {
            return null;
        }
        return {
            debugPort,
            wsEndpoint,
            httpEndpoint: `http://127.0.0.1:${debugPort}`,
            debuggerAddress: `127.0.0.1:${debugPort}`,
        };
    }

    public async launchEnvironmentForAutomation(
        id: string,
        timeoutMs = 15000,
    ): Promise<{
        profileId: string;
        name: string;
        browserEngine: BrowserEngineType;
        debugPort: number;
        wsEndpoint: string;
        httpEndpoint: string;
        debuggerAddress: string;
        env: ChromeEnvironment;
        cdp: {
            debugPort: number;
            wsEndpoint: string;
            httpEndpoint: string;
            debuggerAddress: string;
        };
    }> {
        const effectiveTimeoutMs =
            Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
        const deadline = Date.now() + effectiveTimeoutMs;

        const launched = await this.launchEnvironment(id);
        if (!launched) {
            throw new Error(`启动环境失败: ${id}`);
        }

        let liveWsEndpoint: string | null = null;
        let activeDebugPort = 0;
        let wsLiveSince = 0;
        const cdpConnectGraceMs = 2000;

        while (Date.now() < deadline) {
            const procRecord = this.runningProcesses.get(id);
            if (!procRecord) {
                throw new Error(`浏览器进程未能保持运行，启动失败: ${id}`);
            }

            if (procRecord.startupGate) {
                if (procRecord.startupGate.isAborted()) {
                    throw new Error(`启动安全闸门已 Fail-Closed 中止: ${id}`);
                }
                if (!procRecord.startupGate.isReleased()) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    continue;
                }
            }

            const port =
                procRecord.debugPort ||
                this.cdpManager.getConnectionInfo(id)?.debugPort ||
                0;
            if (Number.isInteger(port) && port > 0) {
                activeDebugPort = port;
                if (!liveWsEndpoint) {
                    liveWsEndpoint =
                        await this.cdpManager.fetchLiveWsEndpoint(port);
                    if (liveWsEndpoint) {
                        wsLiveSince = Date.now();
                    }
                }
            }

            if (liveWsEndpoint && activeDebugPort > 0) {
                const isCdpReady = this.cdpManager.isConnected(id);
                const waitedForCdp =
                    wsLiveSince > 0 ? Date.now() - wsLiveSince : 0;
                if (
                    isCdpReady ||
                    Boolean(procRecord.startupGate) ||
                    waitedForCdp >= cdpConnectGraceMs
                ) {
                    break;
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 75));
        }

        if (!this.runningProcesses.has(id)) {
            throw new Error(`浏览器进程未能保持运行，启动失败: ${id}`);
        }
        if (!liveWsEndpoint || activeDebugPort <= 0) {
            throw new Error(
                `环境 ${id} 的 CDP WebSocket 调试端点在 ${effectiveTimeoutMs}ms 内未就绪 (Fail-Closed)`,
            );
        }

        const env = this.deps.repository.findActiveById(id, true);
        if (!env) {
            throw new Error(`环境未找到: ${id}`);
        }
        const cdp = {
            debugPort: activeDebugPort,
            wsEndpoint: liveWsEndpoint,
            httpEndpoint: `http://127.0.0.1:${activeDebugPort}`,
            debuggerAddress: `127.0.0.1:${activeDebugPort}`,
        };

        return {
            profileId: env.id,
            name: env.name,
            browserEngine: env.browserEngine || 'system-chrome',
            debugPort: cdp.debugPort,
            wsEndpoint: cdp.wsEndpoint,
            httpEndpoint: cdp.httpEndpoint,
            debuggerAddress: cdp.debuggerAddress,
            env,
            cdp,
        };
    }

    public async closeEnvironment(id: string): Promise<boolean> {
        try {
            const envProcess = this.runningProcesses.get(id);
            if (!envProcess) {
                return false;
            }

            const envName = this.deps.repository.findNameById(id) || '未知';
            const envIdShort = id.substring(0, 8);
            log.info(`[${envName}] 开始关闭 - ID:${envIdShort}`);

            const gracefulClosed = await this.cdpManager.closeBrowser(id);
            this.cdpManager.disconnect(id);
            if (envProcess.startupGate) {
                void envProcess.startupGate.close();
                envProcess.startupGate = undefined;
            }

            const { dataDir, debugPort } = envProcess;
            if (debugPort) {
                this.portPool.release(debugPort);
            }

            let stillRunning = !gracefulClosed;
            if (gracefulClosed && dataDir) {
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                    const state = await isProfileRunningLocally(dataDir);
                    if (!state.running) {
                        stillRunning = false;
                        break;
                    }
                    stillRunning = true;
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }

            if (stillRunning) {
                await this.processScanner.forceKillEnvironmentProcesses(
                    envIdShort,
                    envName,
                );
            }

            if (envProcess.proxyId) {
                this.deps.proxyService?.touchActivity?.(envProcess.proxyId);
            }
            this.runningProcesses.delete(id);
            this.emitStatusChanged();
            return true;
        } catch (error) {
            log.error('关闭环境失败:', error);
            throw error;
        }
    }

    public async exportEnvironmentCookies(
        id: string,
        format: 'json' | 'netscape' = 'json',
    ): Promise<{ count: number; format: 'json' | 'netscape'; content: string }> {
        const procRecord = this.runningProcesses.get(id);
        if (!procRecord) {
            throw new Error('请先启动该浏览器环境后再导出 Cookie');
        }
        const debugPort =
            procRecord.debugPort || this.cdpManager.getConnectionInfo(id)?.debugPort;
        if (!debugPort) {
            throw new Error('未能获取该环境的原生 CDP 通道');
        }
        const rawCookies = await this.cdpManager.getBrowserCookies(debugPort);
        const safeFormat = format === 'netscape' ? 'netscape' : 'json';
        const content =
            safeFormat === 'netscape'
                ? serializeCookiesNetscape(rawCookies)
                : serializeCookiesJson(rawCookies);
        return {
            count: rawCookies.length,
            format: safeFormat,
            content,
        };
    }

    public async importEnvironmentCookies(
        id: string,
        rawText: string,
    ): Promise<{ importedCount: number }> {
        const procRecord = this.runningProcesses.get(id);
        if (!procRecord) {
            throw new Error('请先启动该浏览器环境后再导入 Cookie');
        }
        const debugPort =
            procRecord.debugPort || this.cdpManager.getConnectionInfo(id)?.debugPort;
        if (!debugPort) {
            throw new Error('未能获取该环境的原生 CDP 通道');
        }
        const parsed = parseCookiesInput(rawText);
        const importedCount = await this.cdpManager.setBrowserCookies(
            debugPort,
            parsed,
        );
        return { importedCount };
    }

    public async arrangeRunningWindows(
        workArea: {
            x: number;
            y: number;
            width: number;
            height: number;
        },
        options?: {
            mode?: string;
            envIds?: string[];
            platform?: string;
        },
    ): Promise<{
        mode: string;
        tiledCount: number;
        consoleBounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        } | null;
    }> {
        const mode = normalizeWindowArrangeMode(options?.mode);
        const filterSet =
            Array.isArray(options?.envIds) && options.envIds.length > 0
                ? new Set(options.envIds)
                : null;
        const entries = Array.from(this.runningProcesses.values())
            .filter(
                (item) =>
                    item.debugPort &&
                    item.debugPort > 0 &&
                    (!filterSet || filterSet.has(item.envId)),
            )
            .sort((a, b) => a.launchedAt - b.launchedAt);
        if (entries.length === 0) {
            return { mode, tiledCount: 0, consoleBounds: null };
        }

        if (mode === 'minimize' || mode === 'restore') {
            const targetState = mode === 'minimize' ? 'minimized' : 'normal';
            const outcomes = await Promise.all(
                entries.map(async (entry) => {
                    if (!entry.debugPort) return false;
                    try {
                        return await this.cdpManager.setWindowStateForPort(
                            entry.debugPort,
                            targetState,
                        );
                    } catch {
                        return false;
                    }
                }),
            );
            return {
                mode,
                tiledCount: outcomes.filter(Boolean).length,
                consoleBounds: null,
            };
        }

        const plan = computeWindowArrangement(mode, entries.length, workArea, {
            platform: options?.platform ?? process.platform,
        });
        const outcomes = await Promise.all(
            entries.map(async (entry, index) => {
                const port = entry.debugPort;
                if (!port) return false;
                try {
                    return await this.cdpManager.setWindowBoundsForPort(
                        port,
                        plan.boundsList[index],
                    );
                } catch (err) {
                    log.warn(
                        `[${entry.envId.substring(0, 8)}] 窗口排列跳过:`,
                        err,
                    );
                    return false;
                }
            }),
        );
        return {
            mode: plan.mode,
            tiledCount: outcomes.filter(Boolean).length,
            consoleBounds: plan.consoleBounds,
        };
    }

    public async tileRunningWindows(workArea: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): Promise<{ tiledCount: number }> {
        const res = await this.arrangeRunningWindows(workArea, {
            mode: 'grid',
            platform: process.platform,
        });
        return { tiledCount: res.tiledCount };
    }

    public async focusEnvironmentWindow(
        id: string,
        options?: { highlightOnly?: boolean },
    ): Promise<{
        focused: boolean;
        bounds: {
            left: number;
            top: number;
            width: number;
            height: number;
            windowState?: string;
        } | null;
        label: string;
        pid: number | null;
        foregroundConfirmed: boolean;
    }> {
        const record = this.runningProcesses.get(id);
        if (!record) {
            return {
                focused: false,
                bounds: null,
                label: '',
                pid: null,
                foregroundConfirmed: false,
            };
        }
        const debugPort =
            record.debugPort || this.cdpManager.getConnectionInfo(id)?.debugPort;
        const pid =
            typeof record.pid === 'number' && record.pid > 0
                ? record.pid
                : null;
        const envMeta = this.deps.repository.findAnyById(id, true);
        const label = envMeta?.name || '';
        const highlightOnly = Boolean(options?.highlightOnly);

        if (!debugPort) {
            if (!highlightOnly && pid) {
                const nativeOk = activateProcessWindowByPid(pid);
                return {
                    focused: nativeOk,
                    bounds: null,
                    label,
                    pid,
                    foregroundConfirmed:
                        nativeOk || getForegroundWindowPid() === pid,
                };
            }
            return {
                focused: false,
                bounds: null,
                label,
                pid,
                foregroundConfirmed: false,
            };
        }

        if (!highlightOnly && pid) {
            allowForegroundForPid(pid);
        }

        let cdpRes: {
            focused: boolean;
            bounds: {
                left: number;
                top: number;
                width: number;
                height: number;
                windowState?: string;
            } | null;
        } = { focused: false, bounds: null };
        try {
            cdpRes = await this.cdpManager.focusWindowForPort(debugPort, {
                bringToFront: !highlightOnly,
            });
        } catch (err) {
            log.warn(`[${id.substring(0, 8)}] CDP 定位窗口异常:`, err);
        }

        let foregroundConfirmed = false;
        if (!highlightOnly && pid) {
            if (getForegroundWindowPid() === pid) {
                foregroundConfirmed = true;
            } else {
                const nativeFocused = activateProcessWindowByPid(pid);
                foregroundConfirmed =
                    nativeFocused || getForegroundWindowPid() === pid;
            }
        }

        return {
            focused: Boolean(cdpRes.focused || foregroundConfirmed),
            bounds: cdpRes.bounds,
            label,
            pid,
            foregroundConfirmed,
        };
    }

    public async closeAllEnvironments(): Promise<{
        closedCount: number;
        failedCount: number;
    }> {
        const ids = this.getRunningIds();
        if (ids.length === 0) {
            return { closedCount: 0, failedCount: 0 };
        }
        let closedCount = 0;
        let failedCount = 0;
        await Promise.allSettled(
            ids.map(async (id) => {
                try {
                    await this.closeEnvironment(id);
                    closedCount += 1;
                } catch (error) {
                    failedCount += 1;
                    log.warn(`关闭环境失败 (${id}):`, error);
                }
            }),
        );
        return { closedCount, failedCount };
    }
}
