'use strict';

/**
 * Live External Fingerprint Audit Worker (invoked via `npm run audit:live`)
 *
 * Visits real external checkers (CreepJS, BrowserScan, BrowserLeaks WebRTC, PixelScan)
 * using the user's chosen local profile(s) without modifying or deleting any profile data.
 * Never attempts to solve or bypass CAPTCHAs — reports CAPTCHA/Challenge transparently.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');
const WebSocket = require('ws');

const projectRoot = path.resolve(__dirname, '..');
const distElectron = path.join(projectRoot, 'dist', 'electron');

const ENGINE_META = {
    'fingerprint-chromium': {
        id: 'fingerprint-chromium',
        tag: 'cpp',
        label: 'C++ 隐私指纹内核 (fingerprint-chromium)',
    },
    'system-chrome': {
        id: 'system-chrome',
        tag: 'chrome',
        label: '系统 Chrome 内核 (system-chrome)',
    },
};

function getEngineLabel(engineId) {
    return ENGINE_META[engineId]?.label || String(engineId || 'unknown');
}

function parseEngines(raw) {
    const tokens = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const resolved = [];
    for (const token of tokens) {
        if (token === 'both' || token === 'all') {
            resolved.push('fingerprint-chromium', 'system-chrome');
        } else if (token === 'fingerprint-chromium' || token === 'cpp') {
            resolved.push('fingerprint-chromium');
        } else if (token === 'system-chrome' || token === 'chrome') {
            resolved.push('system-chrome');
        } else {
            return { engines: [], invalid: token };
        }
    }
    return { engines: [...new Set(resolved)], invalid: '' };
}

function parseArgs(argv) {
    const opts = {
        envs: [],
        proxies: [],
        engines: ['fingerprint-chromium', 'system-chrome'],
        invalidEngine: '',
        sites: ['creepjs', 'browserscan', 'browserleaks', 'pixelscan'],
    };
    for (const arg of argv) {
        if (arg.startsWith('--env=')) {
            const raw = arg.slice('--env='.length).trim();
            opts.envs = raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (arg.startsWith('--proxy=')) {
            const raw = arg.slice('--proxy='.length).trim();
            opts.proxies = raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (arg.startsWith('--engine=')) {
            const raw = arg.slice('--engine='.length).trim();
            const parsed = parseEngines(raw);
            if (parsed.invalid || parsed.engines.length === 0) {
                opts.invalidEngine = parsed.invalid || raw || '(empty)';
            } else {
                opts.engines = parsed.engines;
            }
        } else if (arg.startsWith('--sites=')) {
            const raw = arg.slice('--sites='.length).trim().toLowerCase();
            opts.sites = raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        }
    }
    return opts;
}

const OPTS = parseArgs(process.argv.slice(2));
const realUserData = path.join(app.getPath('appData'), 'multichrome');
app.setPath('userData', realUserData);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForDevToolsWs(chromeManager, envId, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const proc = chromeManager.runningProcesses?.get(envId);
        const port = proc?.debugPort;
        if (port) {
            try {
                const version = await new Promise((resolve, reject) => {
                    const req = http.get(
                        `http://127.0.0.1:${port}/json/version`,
                        (res) => {
                            const chunks = [];
                            res.on('data', (c) => chunks.push(c));
                            res.on('end', () => {
                                try {
                                    resolve(
                                        JSON.parse(
                                            Buffer.concat(chunks).toString('utf8'),
                                        ),
                                    );
                                } catch (e) {
                                    reject(e);
                                }
                            });
                        },
                    );
                    req.on('error', reject);
                    req.setTimeout(2000, () => {
                        req.destroy();
                        reject(new Error('timeout'));
                    });
                });
                if (version?.webSocketDebuggerUrl) {
                    return {
                        wsUrl: version.webSocketDebuggerUrl,
                        browserVersion: version.Browser || 'unknown',
                    };
                }
            } catch {
                // retry
            }
        }
        await sleep(250);
    }
    throw new Error('Timed out waiting for CDP /json/version');
}

class CDPClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.id = 0;
        this.pending = new Map();
    }
    async connect() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            this.ws.once('open', resolve);
            this.ws.once('error', reject);
        });
        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        reject(
                            new Error(msg.error.message || JSON.stringify(msg.error)),
                        );
                    } else {
                        resolve(msg.result);
                    }
                }
            } catch {
                // ignore
            }
        });
    }
    send(method, params = {}, sessionId = undefined, timeoutMs = 20000) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`CDP timeout: ${method}`));
                }
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => {
                    clearTimeout(timer);
                    resolve(v);
                },
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                },
            });
            const payload = { id, method, params };
            if (sessionId) payload.sessionId = sessionId;
            this.ws.send(JSON.stringify(payload));
        });
    }
    close() {
        try {
            this.ws?.close();
        } catch {
            // ignore
        }
    }
}

async function visitAndInspect(cdp, url, waitMs, extractJs, pollUntilReadyMs = 0) {
    let targetId;
    try {
        const created = await cdp.send('Target.createTarget', { url });
        targetId = created.targetId;
        const attached = await cdp.send('Target.attachToTarget', {
            targetId,
            flatten: true,
        });
        const sessionId = attached.sessionId;
        await sleep(waitMs);
        const deadline = Date.now() + pollUntilReadyMs;
        let lastVal = { error: 'empty result' };
        while (true) {
            const evalRes = await cdp.send(
                'Runtime.evaluate',
                { expression: extractJs, awaitPromise: true, returnByValue: true },
                sessionId,
                15000,
            );
            lastVal = evalRes?.result?.value || { error: 'empty result' };
            if (
                !pollUntilReadyMs ||
                lastVal.ready ||
                lastVal.blocked ||
                Date.now() >= deadline
            ) {
                return lastVal;
            }
            await sleep(2500);
        }
    } catch (err) {
        return { error: err.message };
    } finally {
        if (targetId) {
            await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
        }
    }
}

const SITE_SPECS = {
    creepjs: {
        label: 'CreepJS',
        url: 'https://abrahamjuliot.github.io/creepjs/',
        waitMs: 10000,
        pollMs: 25000,
        extractJs: `(() => {
            const text = (document.body?.innerText || '').trim();
            if (/verify you are human|just a moment|cloudflare/i.test(text)) {
                return { blocked: 'CAPTCHA/Challenge' };
            }
            const ready = text.length > 800 && !text.includes('Computing...');
            if (!ready) return { title: document.title, ready: false };
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            const findSection = (prefix, count = 8) => {
                const idx = lines.findIndex(l => l.toLowerCase().startsWith(prefix.toLowerCase()));
                return idx >= 0 ? lines.slice(idx, idx + count) : [];
            };
            return {
                ready: true,
                fpId: lines.slice(0, 3),
                lies: lines.filter(l => /\\blies\\b|lie\\s*\\(/i.test(l)).slice(0, 8),
                trash: lines.filter(l => /\\btrash\\b/i.test(l)).slice(0, 6),
                headless: findSection('Headless', 6),
                resistance: findSection('Resistance', 6),
                timezone: findSection('Timezone', 5),
                intl: findSection('Intl', 5),
                worker: findSection('Worker', 8),
                webgl: findSection('WebGL', 9),
            };
        })()`,
    },
    browserscan: {
        label: 'BrowserScan',
        url: 'https://www.browserscan.net/',
        waitMs: 12000,
        pollMs: 18000,
        extractJs: `(() => {
            const text = (document.body?.innerText || '').trim();
            if (/verify you are human|just a moment|turnstile|captcha/i.test(text)) {
                return { blocked: 'CAPTCHA/Challenge' };
            }
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            const highlights = lines.filter(l => /authenticity|Bot Detection|WebRTC|IP Time Zone|language:|\\d+%/i.test(l)).slice(0, 15);
            const ready = text.length > 600 && /authenticity|Bot Detection/i.test(text) && !/checking\\.\\.\\.|loading\\.\\.\\./i.test(text.slice(0, 400));
            return {
                ready,
                title: document.title,
                highlights,
                snippet: lines.slice(0, 45).join(' | '),
            };
        })()`,
    },
    browserleaks: {
        label: 'BrowserLeaks WebRTC',
        url: 'https://browserleaks.com/webrtc',
        waitMs: 10000,
        pollMs: 12000,
        extractJs: `(() => {
            const text = (document.body?.innerText || '').trim();
            if (/verify you are human|just a moment|captcha/i.test(text)) {
                return { blocked: 'CAPTCHA/Challenge' };
            }
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            const webrtcLines = lines.filter(l => /No Leak|Local IP|Public IP|IPv4|IPv6|RTCPeerConnection/i.test(l)).slice(0, 12);
            return {
                ready: webrtcLines.length >= 2,
                title: document.title,
                webrtcLines,
            };
        })()`,
    },
    pixelscan: {
        label: 'PixelScan',
        url: 'https://pixelscan.net/fingerprint-check',
        waitMs: 12000,
        pollMs: 0,
        extractJs: `(() => {
            const text = (document.body?.innerText || '').trim();
            if (/verify you are human|just a moment|turnstile|captcha/i.test(text)) {
                return { blocked: 'CAPTCHA/Challenge' };
            }
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            return {
                title: document.title,
                snippet: lines.slice(0, 40).join(' | '),
            };
        })()`,
    },
};

function disposeChromeManager(manager) {
    if (!manager) return;
    try {
        if (manager.statusCheckInterval) {
            clearInterval(manager.statusCheckInterval);
            manager.statusCheckInterval = null;
        }
    } catch {
        // ignore
    }
    try {
        manager.db?.close?.();
    } catch {
        // ignore
    }
}

function summarizeSiteResult(siteKey, res) {
    if (!res) return 'no-result';
    if (res.blocked) return `BLOCKED (${res.blocked})`;
    if (res.error) return `ERROR (${res.error})`;
    if (siteKey === 'creepjs') {
        const lies = Array.isArray(res.lies) ? res.lies.length : '?';
        const trash = Array.isArray(res.trash) ? res.trash.length : '?';
        const headless = (res.headless || []).find((l) => /% headless/i.test(l)) || '';
        const stealth = (res.headless || []).find((l) => /% stealth/i.test(l)) || '';
        const tz = (res.timezone || [])[2] || (res.timezone || [])[1] || '';
        const intl = (res.intl || [])[1] || '';
        return `ready=${Boolean(res.ready)}, lies=${lies}, trash=${trash}, ${headless}, ${stealth}, tz=${tz}, intl=${intl}`;
    }
    if (siteKey === 'browserscan') {
        const auth =
            (res.highlights || []).find((l) => /authenticity/i.test(l)) || '';
        const snippet = String(res.snippet || '');
        const botMatch = snippet.match(/Bot Detection:\s*\|\s*([^|]+)/i);
        const webrtcMatch = snippet.match(/WebRTC\s*\|\s*([^|]+)/i);
        const tzMatch = snippet.match(/IP Time Zone:\s*\|\s*([^|]+)/i);
        return [
            auth || 'authenticity=unknown',
            `bot=${botMatch ? botMatch[1].trim() : 'unknown'}`,
            `webrtc=${webrtcMatch ? webrtcMatch[1].trim() : 'unknown'}`,
            `tz=${tzMatch ? tzMatch[1].trim() : 'unknown'}`,
        ].join(', ');
    }
    if (siteKey === 'browserleaks') {
        const lines = Array.isArray(res.webrtcLines) ? res.webrtcLines : [];
        const noLeak = lines.some((l) => /No Leak/i.test(l));
        const localIp = lines.find((l) => /Local IP/i.test(l)) || '';
        const publicIp = lines.find((l) => /Public IP/i.test(l)) || '';
        return `noLeak=${noLeak}, ${localIp.replace(/\t/g, '=')}, ${publicIp.replace(/\t/g, '=')}`;
    }
    if (siteKey === 'pixelscan') {
        return res.title ? `title=${res.title}` : 'loaded';
    }
    return 'ok';
}

async function auditEnvironment(chromeManager, env, label, reports) {
    const engineLabel = getEngineLabel(env.browserEngine);
    console.log(
        `\n==================== LIVE AUDIT: ${label} ====================\n` +
            `内核类型: ${engineLabel}`,
    );
    const report = {
        label,
        engine: env.browserEngine,
        engineLabel,
        browserVersion: 'unknown',
        sites: {},
        error: null,
    };
    reports.push(report);
    let cdp;
    try {
        await chromeManager.launchEnvironment(env.id);
        const devTools = await waitForDevToolsWs(chromeManager, env.id, 20000);
        report.browserVersion = devTools.browserVersion;
        console.log(`浏览器版本: ${devTools.browserVersion}`);
        cdp = new CDPClient(devTools.wsUrl);
        await cdp.connect();
        await sleep(2000);

        for (const siteKey of OPTS.sites) {
            const spec = SITE_SPECS[siteKey];
            if (!spec) continue;
            console.log(`\n--- [${engineLabel}] [${spec.label}] ${spec.url} ---`);
            const res = await visitAndInspect(
                cdp,
                spec.url,
                spec.waitMs,
                spec.extractJs,
                spec.pollMs,
            );
            report.sites[siteKey] = res;
            console.log(JSON.stringify(res, null, 2));
        }
    } catch (err) {
        report.error = err.message;
        console.error(`[audit:live] ${label} (${engineLabel}) 异常:`, err.message);
        process.exitCode = 1;
    } finally {
        cdp?.close();
        await chromeManager.closeEnvironment(env.id).catch(() => {});
        await sleep(1500);
    }
}

app.whenReady().then(async () => {
    let proxyManager;
    let realChromeManager;
    let tempChromeManager;
    let tempAuditRoot = '';
    const reports = [];
    try {
        if (OPTS.invalidEngine) {
            console.error(
                `[audit:live] 不支持的 --engine 参数: ${OPTS.invalidEngine}（可选: both, fingerprint-chromium, system-chrome）`,
            );
            process.exitCode = 1;
            return;
        }
        if (OPTS.envs.length === 0 && OPTS.proxies.length === 0) {
            console.log(
                'Usage:\n' +
                    '  npm run audit:live -- --env="<环境名称1>,<环境名称2>" [--sites=creepjs,browserscan,browserleaks,pixelscan]\n' +
                    '  npm run audit:live -- --proxy="<内置代理名称>" [--engine=both|fingerprint-chromium|system-chrome] [--sites=creepjs,browserscan,browserleaks,pixelscan]',
            );
            process.exitCode = 1;
            return;
        }

        const { SettingsManager } = await import(
            pathToFileURL(path.join(distElectron, 'settingsManager.js')).href
        );
        const { KernelManager } = await import(
            pathToFileURL(path.join(distElectron, 'kernelManager.js')).href
        );
        const { ProxyManager } = await import(
            pathToFileURL(path.join(distElectron, 'proxyManager.js')).href
        );
        const { ChromeManager } = await import(
            pathToFileURL(path.join(distElectron, 'chromeManager.js')).href
        );

        const settingsManager = new SettingsManager();
        const realDataPath =
            settingsManager.getSettings().dataPath || app.getPath('userData');
        const kernelManager = new KernelManager({
            getDataPath: () => realDataPath,
        });
        proxyManager = new ProxyManager({
            store: new Store({ name: 'managed-proxies', cwd: realUserData }),
            secretStorage: safeStorage,
            resolveBinary: () => {
                const active = kernelManager.getActiveSingbox();
                return active
                    ? { binaryPath: active.executablePath, version: active.version }
                    : null;
            },
            binaryPath: path.join(
                projectRoot,
                'resources',
                'sing-box',
                process.platform === 'win32' ? 'sing-box.exe' : 'sing-box',
            ),
            configDirectory: realUserData,
        });

        let auditedCount = 0;

        if (OPTS.envs.length > 0) {
            realChromeManager = new ChromeManager(
                proxyManager,
                settingsManager,
                kernelManager,
            );
            const allEnvs = await realChromeManager.getAllEnvironments();
            const targets = OPTS.envs
                .map((name) => allEnvs.find((e) => e.name === name))
                .filter(Boolean);

            if (targets.length === 0) {
                console.error(
                    `[audit:live] 未找到指定环境: ${OPTS.envs.join(', ')}`,
                );
                process.exitCode = 1;
            } else {
                for (const env of targets) {
                    await auditEnvironment(
                        realChromeManager,
                        env,
                        env.name,
                        reports,
                    );
                    auditedCount += 1;
                }
            }
        }

        if (OPTS.proxies.length > 0) {
            const allProxies = proxyManager.list();
            const matchedProxies = OPTS.proxies
                .map((name) => {
                    const lower = name.toLowerCase();
                    return (
                        allProxies.find((p) => p.name === name) ||
                        allProxies.find(
                            (p) => String(p.name || '').trim().toLowerCase() === lower,
                        )
                    );
                })
                .filter(Boolean);

            if (matchedProxies.length === 0) {
                console.error(
                    `[audit:live] 未找到指定内置代理: ${OPTS.proxies.join(', ')}`,
                );
                process.exitCode = 1;
            } else {
                tempAuditRoot = fs.mkdtempSync(
                    path.join(os.tmpdir(), 'multichrome-live-audit-'),
                );
                const tempSettingsManager = Object.create(settingsManager);
                tempSettingsManager.getSettings = () => ({
                    ...settingsManager.getSettings(),
                    dataPath: tempAuditRoot,
                    requireHealthCheckOnLaunch: false,
                });

                tempChromeManager = new ChromeManager(
                    proxyManager,
                    tempSettingsManager,
                    kernelManager,
                );

                for (const proxy of matchedProxies) {
                    for (const engineId of OPTS.engines) {
                        const meta = ENGINE_META[engineId];
                        if (engineId === 'fingerprint-chromium') {
                            const activeKernel = kernelManager.getActiveKernel();
                            if (!activeKernel) {
                                const msg =
                                    '未安装或未激活 C++ 隐私指纹内核 (fingerprint-chromium)，无法执行该内核抽检';
                                console.error(`[audit:live] ${msg}`);
                                reports.push({
                                    label: `LiveAudit-${proxy.name}-${meta.tag} [proxy:${proxy.name}]`,
                                    engine: engineId,
                                    engineLabel: meta.label,
                                    browserVersion: 'missing',
                                    sites: {},
                                    error: msg,
                                });
                                process.exitCode = 1;
                                continue;
                            }
                        } else if (engineId === 'system-chrome') {
                            const chromePath =
                                tempChromeManager.getSystemChromePath();
                            if (!chromePath || !fs.existsSync(chromePath)) {
                                const msg =
                                    '未检测到系统 Chrome 可执行文件 (system-chrome)，无法执行该内核抽检';
                                console.error(`[audit:live] ${msg}`);
                                reports.push({
                                    label: `LiveAudit-${proxy.name}-${meta.tag} [proxy:${proxy.name}]`,
                                    engine: engineId,
                                    engineLabel: meta.label,
                                    browserVersion: 'missing',
                                    sites: {},
                                    error: msg,
                                });
                                process.exitCode = 1;
                                continue;
                            }
                        }

                        const ephemeralEnv =
                            await tempChromeManager.createEnvironment(
                                `LiveAudit-${proxy.name}-${meta.tag}`,
                                '用户分组',
                                `ephemeral L4 audit profile (${engineId})`,
                                {
                                    browserEngine: engineId,
                                    proxyId: proxy.id,
                                },
                            );
                        await auditEnvironment(
                            tempChromeManager,
                            ephemeralEnv,
                            `${ephemeralEnv.name} [proxy:${proxy.name}]`,
                            reports,
                        );
                        auditedCount += 1;
                    }
                }
            }
        }

        if (reports.length > 0) {
            console.log(
                '\n==================== LIVE AUDIT DUAL-ENGINE SUMMARY ====================',
            );
            for (const item of reports) {
                console.log(
                    `\n[${item.engineLabel}] ${item.label} | version=${item.browserVersion}`,
                );
                if (item.error) {
                    console.log(`  ERROR: ${item.error}`);
                    continue;
                }
                for (const siteKey of OPTS.sites) {
                    const spec = SITE_SPECS[siteKey];
                    if (!spec) continue;
                    console.log(
                        `  - ${spec.label}: ${summarizeSiteResult(siteKey, item.sites[siteKey])}`,
                    );
                }
            }
            console.log(
                '========================================================================',
            );
        }

        if (auditedCount === 0) {
            process.exitCode = 1;
        }
    } finally {
        disposeChromeManager(tempChromeManager);
        disposeChromeManager(realChromeManager);
        if (proxyManager) {
            await proxyManager.closeAll().catch(() => {});
        }
        if (tempAuditRoot) {
            try {
                fs.rmSync(tempAuditRoot, { recursive: true, force: true });
            } catch {
                // ignore best-effort cleanup
            }
        }
        app.quit();
    }
});
