'use strict';

/**
 * Live External Fingerprint Audit Worker (invoked via `npm run audit:live`)
 *
 * Visits real external checkers (CreepJS, BrowserScan, BrowserLeaks WebRTC, PixelScan)
 * using the user's chosen local profile(s) without modifying or deleting any profile data.
 * Never attempts to solve or bypass CAPTCHAs — reports CAPTCHA/Challenge transparently.
 */

const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');
const WebSocket = require('ws');

const projectRoot = path.resolve(__dirname, '..');
const distElectron = path.join(projectRoot, 'dist', 'electron');

function parseArgs(argv) {
    const opts = {
        envs: [],
        sites: ['creepjs', 'browserscan', 'browserleaks', 'pixelscan'],
    };
    for (const arg of argv) {
        if (arg.startsWith('--env=')) {
            const raw = arg.slice('--env='.length).trim();
            opts.envs = raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
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
                    return version.webSocketDebuggerUrl;
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
        pollMs: 0,
        extractJs: `(() => {
            const text = (document.body?.innerText || '').trim();
            if (/verify you are human|just a moment|turnstile|captcha/i.test(text)) {
                return { blocked: 'CAPTCHA/Challenge' };
            }
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            return {
                title: document.title,
                highlights: lines.filter(l => /authenticity|Bot Detection|WebRTC|IP Time Zone|language:/i.test(l)).slice(0, 12),
                snippet: lines.slice(0, 45).join(' | '),
            };
        })()`,
    },
    browserleaks: {
        label: 'BrowserLeaks WebRTC',
        url: 'https://browserleaks.com/webrtc',
        waitMs: 10000,
        pollMs: 0,
        extractJs: `(() => {
            const text = (document.body?.innerText || '').trim();
            if (/verify you are human|just a moment|captcha/i.test(text)) {
                return { blocked: 'CAPTCHA/Challenge' };
            }
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            return {
                title: document.title,
                webrtcLines: lines.filter(l => /No Leak|Local IP|Public IP|IPv4|IPv6|RTCPeerConnection/i.test(l)).slice(0, 10),
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

app.whenReady().then(async () => {
    let proxyManager;
    let chromeManager;
    try {
        if (OPTS.envs.length === 0) {
            console.log(
                'Usage: npm run audit:live -- --env="<环境名称1>,<环境名称2>" [--sites=creepjs,browserscan,browserleaks,pixelscan]',
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
        const kernelManager = new KernelManager({
            getDataPath: () =>
                settingsManager.getSettings().dataPath || app.getPath('userData'),
        });
        proxyManager = new ProxyManager({
            store: new Store({ name: 'managed-proxies' }),
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
        chromeManager = new ChromeManager(
            proxyManager,
            settingsManager,
            kernelManager,
        );

        const allEnvs = await chromeManager.getAllEnvironments();
        const targets = OPTS.envs
            .map((name) => allEnvs.find((e) => e.name === name))
            .filter(Boolean);

        if (targets.length === 0) {
            console.error(
                `[audit:live] 未找到指定环境: ${OPTS.envs.join(', ')}`,
            );
            process.exitCode = 1;
            return;
        }

        for (const env of targets) {
            console.log(
                `\n==================== LIVE AUDIT: ${env.name} (${env.browserEngine}) ====================`,
            );
            let cdp;
            try {
                await chromeManager.launchEnvironment(env.id);
                const wsUrl = await waitForDevToolsWs(chromeManager, env.id, 15000);
                cdp = new CDPClient(wsUrl);
                await cdp.connect();
                await sleep(2000);

                for (const siteKey of OPTS.sites) {
                    const spec = SITE_SPECS[siteKey];
                    if (!spec) continue;
                    console.log(`\n--- [${spec.label}] ${spec.url} ---`);
                    const res = await visitAndInspect(
                        cdp,
                        spec.url,
                        spec.waitMs,
                        spec.extractJs,
                        spec.pollMs,
                    );
                    console.log(JSON.stringify(res, null, 2));
                }
            } catch (err) {
                console.error(`[audit:live] ${env.name} 异常:`, err.message);
            } finally {
                cdp?.close();
                await chromeManager.closeEnvironment(env.id).catch(() => {});
                await sleep(1500);
            }
        }
    } finally {
        if (proxyManager) {
            await proxyManager.closeAll().catch(() => {});
        }
        app.quit();
    }
});
