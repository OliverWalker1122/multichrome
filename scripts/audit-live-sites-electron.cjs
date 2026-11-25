'use strict';

/**
 * Live External Fingerprint Audit Worker (invoked via `npm run audit:live`)
 *
 * Launches target profiles simultaneously via MultiChrome's loopback MCP + Guarded CDP
 * control plane, tiles all browser windows side-by-side across the screen, and concurrently
 * visits real external checkers (CreepJS, BrowserScan, BrowserLeaks WebRTC, PixelScan).
 * Never modifies or deletes user profile data, never hardcodes proxy/profile names,
 * redacts all exit IPs/proxy labels when `--auto-proxies` is used, and NEVER attempts
 * to solve or bypass CAPTCHAs — reports CAPTCHA/Challenge transparently.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { app, safeStorage, screen } = require('electron');
const Store = require('electron-store');
const WebSocket = require('ws');
const inspectPixelScan = require('./inspect-pixelscan.cjs');

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
        autoProxiesCount: 0,
        engines: ['fingerprint-chromium', 'system-chrome'],
        invalidEngine: '',
        sites: ['creepjs', 'browserscan', 'browserleaks', 'pixelscan'],
        parallel: true,
        viaMcp: true,
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
        } else if (arg.startsWith('--auto-proxies=')) {
            const count = Number.parseInt(
                arg.slice('--auto-proxies='.length).trim(),
                10,
            );
            if (Number.isInteger(count) && count > 0) {
                opts.autoProxiesCount = Math.min(count, 4);
            }
        } else if (arg === '--auto-proxies') {
            opts.autoProxiesCount = 2;
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
        } else if (arg === '--serial') {
            opts.parallel = false;
        } else if (arg === '--parallel') {
            opts.parallel = true;
        } else if (arg === '--direct') {
            opts.viaMcp = false;
        } else if (arg === '--via-mcp') {
            opts.viaMcp = true;
        }
    }
    return opts;
}

const OPTS = parseArgs(process.argv.slice(2));
// Keep audit launch details out of the desktop user's application log.
const auditLog = require('electron-log');
auditLog.transports.file.level = false;
auditLog.transports.console.level = false;
const realUserData = path.join(app.getPath('appData'), 'multichrome');
app.setPath('userData', realUserData);

function redactPublicIps(input) {
    if (typeof input === 'string') {
        return input
            .replace(
                /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g,
                '[REDACTED_EXIT_IP]',
            )
            .replace(
                /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi,
                '[REDACTED_EXIT_IPV6]',
            );
    }
    if (Array.isArray(input)) {
        return input.map(redactPublicIps);
    }
    if (input && typeof input === 'object') {
        return Object.fromEntries(
            Object.entries(input).map(([k, v]) => [k, redactPublicIps(v)]),
        );
    }
    return input;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function httpJsonRequest({ port, method = 'GET', pathname = '/', token = '', body = undefined, timeoutMs = 45000 }) {
    return new Promise((resolve, reject) => {
        const headers = {
            Host: `127.0.0.1:${port}`,
            Accept: 'application/json, text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        let payloadBuf = null;
        if (body !== undefined) {
            payloadBuf = Buffer.from(
                typeof body === 'string' ? body : JSON.stringify(body),
                'utf8',
            );
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = String(payloadBuf.byteLength);
        }
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                method,
                path: pathname,
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch {
                        // non-json
                    }
                    resolve({ status: res.statusCode || 0, text, json });
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error(`HTTP timeout on ${method} ${pathname}`));
        });
        if (payloadBuf) req.write(payloadBuf);
        req.end();
    });
}

async function createLoopbackMcpHarness(chromeManager, proxyManager) {
    const { generateAutomationToken } = await import(
        pathToFileURL(path.join(distElectron, 'domain', 'automationPolicy.js')).href
    );
    const { createAutomationBackend } = await import(
        pathToFileURL(path.join(distElectron, 'services', 'automationService.js')).href
    );
    const { AutomationServer } = await import(
        pathToFileURL(path.join(distElectron, 'transport', 'automationServer.js')).href
    );

    const mcpToken = generateAutomationToken();
    const automationBackend = createAutomationBackend({
        chromeManager,
        proxyManager,
    });
    const server = new AutomationServer({
        backend: automationBackend,
        serverVersion: '1.6.2',
        getRequiredToken: () => mcpToken,
    });
    await server.start({ port: 0 });
    const port = server.getBoundPort();

    let rpcSeq = 1;
    const callMcp = async (method, params = {}) => {
        const res = await httpJsonRequest({
            port,
            method: 'POST',
            pathname: '/mcp',
            token: mcpToken,
            body: {
                jsonrpc: '2.0',
                id: rpcSeq++,
                method,
                params,
            },
        });
        if (res.status !== 200 || res.json?.error) {
            throw new Error(
                `MCP ${method} failed (HTTP ${res.status}, RPC ${Number(res.json?.error?.code) || 'unknown'})`,
            );
        }
        return res.json.result;
    };

    const callTool = async (name, args = {}) => {
        const result = await callMcp('tools/call', { name, arguments: args });
        if (result?.isError) {
            throw new Error(
                `MCP tool ${name} error: ${result?.content?.[0]?.text || 'unknown'}`,
            );
        }
        return result.structuredContent;
    };

    const initRes = await callMcp('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'audit-live-mcp', version: '1.6.2' },
    });
    const toolsRes = await callMcp('tools/list', {});

    // Also verify real stdio MCP bridge (`scripts/mcp-stdio.mjs`) under Electron node mode
    const stdioSmokeOk = await new Promise((resolve) => {
        const bridgeChild = spawn(
            process.execPath,
            [path.join(projectRoot, 'scripts', 'mcp-stdio.mjs')],
            {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    MULTICHROME_API_URL: `http://127.0.0.1:${port}`,
                    MULTICHROME_API_TOKEN: mcpToken,
                },
                stdio: ['pipe', 'pipe', 'ignore'],
            },
        );
        let stdoutBuf = '';
        const timer = setTimeout(() => {
            try { bridgeChild.kill('SIGTERM'); } catch {}
            resolve(false);
        }, 8000);
        bridgeChild.stdout.on('data', (chunk) => {
            stdoutBuf += chunk.toString('utf8');
            if (stdoutBuf.includes('\n')) {
                clearTimeout(timer);
                try { bridgeChild.kill('SIGTERM'); } catch {}
                try {
                    const parsed = JSON.parse(stdoutBuf.trim().split('\n')[0]);
                    resolve(parsed?.result?.tools?.length === 4);
                } catch {
                    resolve(false);
                }
            }
        });
        bridgeChild.once('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
        bridgeChild.stdin.write(
            JSON.stringify({
                jsonrpc: '2.0',
                id: 99,
                method: 'tools/list',
                params: {},
            }) + '\n',
        );
    });

    return {
        port,
        token: mcpToken,
        serverName: initRes?.serverInfo?.name || 'unknown',
        toolNames: (toolsRes?.tools || []).map((t) => t.name),
        stdioSmokeOk,
        callTool,
        fetchScopedVersion: async (profileId) => {
            const res = await httpJsonRequest({
                port,
                method: 'GET',
                pathname: `/cdp/${encodeURIComponent(profileId)}/json/version`,
                token: mcpToken,
            });
            return res.json || {};
        },
        fetchActiveVersion: async () => {
            const res = await httpJsonRequest({
                port,
                method: 'GET',
                pathname: '/json/version',
                token: mcpToken,
            });
            return res.json || {};
        },
        close: async () => {
            await server.stop().catch(() => {});
        },
    };
}

async function waitForDevToolsWs(chromeManager, envId, timeoutMs = 20000) {
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
    constructor(wsUrl, headers = undefined) {
        this.wsUrl = wsUrl;
        this.headers = headers;
        this.ws = null;
        this.id = 0;
        this.pending = new Map();
    }
    async connect() {
        this.ws = this.headers
            ? new WebSocket(this.wsUrl, { headers: this.headers })
            : new WebSocket(this.wsUrl);
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
    send(method, params = {}, sessionId = undefined, timeoutMs = 25000) {
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

async function readWindowBounds(cdp) {
    try {
        const targetsRes = await cdp.send('Target.getTargets', {});
        const page = (targetsRes?.targetInfos || []).find((t) => t.type === 'page');
        if (!page?.targetId) return null;
        const winRes = await cdp.send('Browser.getWindowForTarget', {
            targetId: page.targetId,
        });
        return winRes?.bounds || null;
    } catch {
        return null;
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
                (lastVal.error && lastVal.error !== 'empty result') ||
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
        pollMs: 28000,
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
        pollMs: 20000,
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
        pollMs: 14000,
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
        pollMs: 60000,
        extractJs: `(${inspectPixelScan.toString()})(document)`,
    },
};

function disposeChromeManager(manager) {
    if (!manager) return;
    try {
        manager.stopStatusMonitoring?.();
        if (manager.statusCheckInterval) {
            clearInterval(manager.statusCheckInterval);
            manager.statusCheckInterval = null;
        }
    } catch {
        // ignore
    }
    try {
        manager.closeDatabase?.();
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
        return res.ready && res.verdict ? `fingerprint=${res.verdict}` : 'INCONCLUSIVE (no explicit verdict)';
    }
    return 'ok';
}

async function selectAutoWorkingProxies(proxyManager, maxCount) {
    const all = proxyManager.list();
    const selected = [];
    for (const candidate of all) {
        if (selected.length >= maxCount) break;
        try {
            await proxyManager.ensureStarted(candidate.id);
            const exit = await Promise.race([
                proxyManager.refreshExitInfo(candidate.id, { force: true }),
                new Promise((resolve) => setTimeout(() => resolve(null), 9000)),
            ]);
            if (exit && exit.status === 'ready' && exit.ip) {
                selected.push({
                    id: candidate.id,
                    protocol: candidate.protocol || 'proxy',
                    countryCode: exit.countryCode || 'UNKNOWN',
                    displaySlot: `ProxySlot-${selected.length + 1} (${String(candidate.protocol || 'proxy').toUpperCase()}/${exit.countryCode || 'XX'})`,
                });
            } else {
                await proxyManager.stop(candidate.id).catch(() => {});
            }
        } catch {
            await proxyManager.stop(candidate.id).catch(() => {});
        }
    }
    return selected;
}

async function runAuditGroup({
    chromeManager,
    proxyManager,
    targets,
    reports,
    parallel,
    viaMcp,
}) {
    if (targets.length === 0) return { auditedCount: 0, mcpSummary: null };

    const useParallel = parallel && targets.length > 1;
    let mcpHarness = null;
    const mcpSummary = {
        enabled: Boolean(viaMcp),
        serverName: '',
        toolCount: 0,
        stdioBridgeOk: false,
        simultaneousLaunched: 0,
        tiledCount: 0,
        distinctGridPositions: 0,
        activeSwitchVerified: false,
    };

    try {
        if (viaMcp) {
            mcpHarness = await createLoopbackMcpHarness(chromeManager, proxyManager);
            mcpSummary.serverName = mcpHarness.serverName;
            mcpSummary.toolCount = mcpHarness.toolNames.length;
            mcpSummary.stdioBridgeOk = mcpHarness.stdioSmokeOk;
            console.log(
                `\n[MCP Control Plane] Started on 127.0.0.1:${mcpHarness.port} | server=${mcpHarness.serverName} | tools=${mcpHarness.toolNames.join(',')} | stdioBridge=${mcpHarness.stdioSmokeOk}`,
            );
            const listed = await mcpHarness.callTool('list_profiles', {});
            console.log(
                `[MCP Control Plane] list_profiles discovered ${listed.count} profile(s)`,
            );
        }

        if (!useParallel) {
            for (const target of targets) {
                const engineLabel = getEngineLabel(target.env.browserEngine);
                const report = {
                    label: target.label,
                    engine: target.env.browserEngine,
                    engineLabel,
                    browserVersion: 'unknown',
                    windowBounds: null,
                    sites: {},
                    error: null,
                };
                reports.push(report);
                let cdp;
                try {
                    let wsUrl = '';
                    if (mcpHarness) {
                        const started = await mcpHarness.callTool('start_profile', {
                            profileId: target.env.id,
                            setActive: true,
                        });
                        wsUrl = started.wsEndpoint;
                        const ver = await mcpHarness.fetchScopedVersion(target.env.id);
                        report.browserVersion = ver.Browser || 'unknown';
                    } else {
                        await chromeManager.launchEnvironment(target.env.id);
                        const devTools = await waitForDevToolsWs(
                            chromeManager,
                            target.env.id,
                            20000,
                        );
                        wsUrl = devTools.wsUrl;
                        report.browserVersion = devTools.browserVersion;
                    }
                    cdp = new CDPClient(
                        wsUrl,
                        mcpHarness
                            ? { Authorization: `Bearer ${mcpHarness.token}` }
                            : undefined,
                    );
                    await cdp.connect();
                    await sleep(1500);
                    for (const siteKey of OPTS.sites) {
                        const spec = SITE_SPECS[siteKey];
                        if (!spec) continue;
                        const res = await visitAndInspect(
                            cdp,
                            spec.url,
                            spec.waitMs,
                            spec.extractJs,
                            spec.pollMs,
                        );
                        report.sites[siteKey] = redactPublicIps(res);
                    }
                } catch (err) {
                    report.error = redactPublicIps(err.message);
                    process.exitCode = 1;
                } finally {
                    cdp?.close();
                    if (mcpHarness) {
                        await mcpHarness
                            .callTool('stop_profile', { profileId: target.env.id })
                            .catch(() => {});
                    } else {
                        await chromeManager.closeEnvironment(target.env.id).catch(() => {});
                    }
                    await sleep(1200);
                }
            }
            return { auditedCount: targets.length, mcpSummary };
        }

        // ===================================================================
        // MULTI-WINDOW SIMULTANEOUS LAUNCH + TILING + CONCURRENT LIVE L4 AUDIT
        // ===================================================================
        console.log(
            `\n==================== MULTI-WINDOW SIMULTANEOUS L4 (${targets.length} WINDOWS) ====================`,
        );

        const sessions = [];
        try {
            // 1) Launch ALL target browser windows simultaneously!
            const launchOutcomes = await Promise.all(
                targets.map(async (target, idx) => {
                    const engineLabel = getEngineLabel(target.env.browserEngine);
                    const report = {
                        label: target.label,
                        engine: target.env.browserEngine,
                        engineLabel,
                        browserVersion: 'unknown',
                        windowBounds: null,
                        sites: {},
                        error: null,
                    };
                    reports.push(report);
                    try {
                        let wsUrl = '';
                        let browserVersion = 'unknown';
                        if (mcpHarness) {
                            const started = await mcpHarness.callTool(
                                'start_profile',
                                {
                                    profileId: target.env.id,
                                    setActive: idx === 0,
                                },
                            );
                            wsUrl = started.wsEndpoint;
                            const ver = await mcpHarness.fetchScopedVersion(
                                target.env.id,
                            );
                            browserVersion = ver.Browser || 'unknown';
                        } else {
                            await chromeManager.launchEnvironment(target.env.id);
                            const devTools = await waitForDevToolsWs(
                                chromeManager,
                                target.env.id,
                                25000,
                            );
                            wsUrl = devTools.wsUrl;
                            browserVersion = devTools.browserVersion;
                        }
                        report.browserVersion = browserVersion;
                        const cdp = new CDPClient(
                            wsUrl,
                            mcpHarness
                                ? { Authorization: `Bearer ${mcpHarness.token}` }
                                : undefined,
                        );
                        await cdp.connect();
                        return { target, report, cdp, ok: true };
                    } catch (err) {
                        report.error = redactPublicIps(err.message);
                        process.exitCode = 1;
                        return { target, report, cdp: null, ok: false };
                    }
                }),
            );

            for (const item of launchOutcomes) {
                if (item.ok && item.cdp) {
                    sessions.push(item);
                }
            }
            mcpSummary.simultaneousLaunched = sessions.length;

            if (mcpHarness && sessions.length >= 2) {
                const runningList = await mcpHarness.callTool('list_profiles', {
                    status: 'running',
                });
                const secondId = sessions[1].target.env.id;
                const switched = await mcpHarness.callTool(
                    'switch_active_profile',
                    { profileId: secondId },
                );
                const activeVer = await mcpHarness.fetchActiveVersion();
                mcpSummary.activeSwitchVerified =
                    runningList.count === sessions.length &&
                    switched.activeProfileId === secondId &&
                    String(activeVer.webSocketDebuggerUrl || '').endsWith(
                        `/${secondId}`,
                    );
                console.log(
                    `[MCP Multi-Window] running=${runningList.count}/${targets.length} | switch_active_profile -> ${sessions[1].target.label} verified=${mcpSummary.activeSwitchVerified}`,
                );
            }

            // 2) Tile all simultaneously open browser windows side-by-side across the primary display!
            if (sessions.length > 0) {
                const workArea = screen.getPrimaryDisplay().workArea;
                const tileRes = await chromeManager.tileRunningWindows(workArea);
                mcpSummary.tiledCount = tileRes?.tiledCount || 0;
                await sleep(600);
                const posKeys = new Set();
                for (const sess of sessions) {
                    const b = await readWindowBounds(sess.cdp);
                    if (b) {
                        sess.report.windowBounds = {
                            left: b.left,
                            top: b.top,
                            width: b.width,
                            height: b.height,
                        };
                        posKeys.add(`${b.left},${b.top}`);
                    }
                }
                mcpSummary.distinctGridPositions = posKeys.size;
                console.log(
                    `[Multi-Window Grid Tiling] tiled=${mcpSummary.tiledCount}/${sessions.length} | distinctPositions=${mcpSummary.distinctGridPositions} | bounds=${JSON.stringify(sessions.map((s) => ({ label: s.target.label, bounds: s.report.windowBounds })))}`,
                );
            }

            await sleep(1500);

            // 3) Audit ALL open browser windows CONCURRENTLY (`Promise.all`) against live external L4 sites!
            await Promise.all(
                sessions.map(async ({ target, report, cdp }) => {
                    for (const siteKey of OPTS.sites) {
                        const spec = SITE_SPECS[siteKey];
                        if (!spec) continue;
                        console.log(
                            `[Concurrent L4 -> START] [${target.label}] [${spec.label}]`,
                        );
                        const res = await visitAndInspect(
                            cdp,
                            spec.url,
                            spec.waitMs,
                            spec.extractJs,
                            spec.pollMs,
                        );
                        const sanitizedRes = redactPublicIps(res);
                        report.sites[siteKey] = sanitizedRes;
                        console.log(
                            `[Concurrent L4 -> DONE]  [${target.label}] [${spec.label}] => ${summarizeSiteResult(siteKey, sanitizedRes)}`,
                        );
                    }
                }),
            );
        } finally {
            for (const sess of sessions) {
                sess.cdp?.close();
            }
            if (mcpHarness) {
                await Promise.allSettled(
                    targets.map((t) =>
                        mcpHarness.callTool('stop_profile', {
                            profileId: t.env.id,
                        }),
                    ),
                );
            } else {
                await Promise.allSettled(
                    targets.map((t) => chromeManager.closeEnvironment(t.env.id)),
                );
            }
            await sleep(1200);
        }

        return { auditedCount: targets.length, mcpSummary };
    } finally {
        if (mcpHarness) {
            await mcpHarness.close();
        }
    }
}

app.whenReady().then(async () => {
    let proxyManager;
    let realChromeManager;
    let tempChromeManager;
    let tempAuditRoot = '';
    const reports = [];
    const mcpSummaries = [];
    try {
        if (OPTS.invalidEngine) {
            console.error(
                `[audit:live] 不支持的 --engine 参数: ${OPTS.invalidEngine}（可选: both, fingerprint-chromium, system-chrome）`,
            );
            process.exitCode = 1;
            return;
        }
        if (
            OPTS.envs.length === 0 &&
            OPTS.proxies.length === 0 &&
            OPTS.autoProxiesCount === 0
        ) {
            console.log(
                'Usage:\n' +
                    '  npm run audit:live -- --proxy="<内置代理名称1>,<内置代理名称2>" [--engine=both|fingerprint-chromium|system-chrome]\n' +
                    '  npm run audit:live -- --auto-proxies=2 [--engine=both]\n' +
                    '  npm run audit:live -- --env="<环境名称1>,<环境名称2>" [--sites=creepjs,browserscan,browserleaks,pixelscan]',
            );
            process.exitCode = 1;
            return;
        }

        const { SettingsManager } = await import(
            pathToFileURL(path.join(distElectron, 'repositories', 'settingsRepository.js')).href
        );
        const { KernelManager } = await import(
            pathToFileURL(path.join(distElectron, 'services', 'kernelService.js')).href
        );
        const { ProxyManager } = await import(
            pathToFileURL(path.join(distElectron, 'services', 'proxyService.js')).href
        );
        const { ChromeManager } = await import(
            pathToFileURL(path.join(distElectron, 'services', 'environmentService.js')).href
        );

        const settingsManager = new SettingsManager();
        const configuredDataPath =
            settingsManager.getSettings().dataPath || app.getPath('userData');
        const hasKernelManifest = (dir) =>
            Boolean(
                dir &&
                    fs.existsSync(path.join(dir, 'kernels', 'manifest.json')),
            );
        let realDataPath = configuredDataPath;
        if (!hasKernelManifest(realDataPath)) {
            const hintPath = path.join(projectRoot, '.tmp', 'e2e-data-dir.txt');
            if (fs.existsSync(hintPath)) {
                const hintedDir = fs.readFileSync(hintPath, 'utf8').trim();
                if (path.isAbsolute(hintedDir) && hasKernelManifest(hintedDir)) {
                    realDataPath = hintedDir;
                }
            }
            if (!hasKernelManifest(realDataPath) && hasKernelManifest(realUserData)) {
                realDataPath = realUserData;
            }
        }
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
            const matchedEnvs = OPTS.envs
                .map((name) => allEnvs.find((e) => e.name === name))
                .filter(Boolean);

            if (matchedEnvs.length === 0) {
                console.error(
                    `[audit:live] 未找到指定环境: ${OPTS.envs.join(', ')}`,
                );
                process.exitCode = 1;
            } else {
                const res = await runAuditGroup({
                    chromeManager: realChromeManager,
                    proxyManager,
                    targets: matchedEnvs.map((env, idx) => ({
                        env,
                        label: `EnvSlot-${idx + 1} (${env.browserEngine || 'system-chrome'})`,
                    })),
                    reports,
                    parallel: OPTS.parallel,
                    viaMcp: OPTS.viaMcp,
                });
                auditedCount += res.auditedCount;
                if (res.mcpSummary) mcpSummaries.push(res.mcpSummary);
            }
        }

        if (OPTS.proxies.length > 0 || OPTS.autoProxiesCount > 0) {
            let selectedProxySpecs = [];
            if (OPTS.autoProxiesCount > 0) {
                console.log(
                    `[audit:live] Probing up to ${OPTS.autoProxiesCount} healthy managed proxies automatically...`,
                );
                selectedProxySpecs = await selectAutoWorkingProxies(
                    proxyManager,
                    OPTS.autoProxiesCount,
                );
                if (selectedProxySpecs.length === 0) {
                    console.error(
                        '[audit:live] 未找到可连通的内置代理，请确认至少有 1 个可用代理节点',
                    );
                    process.exitCode = 1;
                }
            } else {
                const allProxies = proxyManager.list();
                selectedProxySpecs = OPTS.proxies
                    .map((name, idx) => {
                        const lower = name.toLowerCase();
                        const found =
                            allProxies.find((p) => p.name === name) ||
                            allProxies.find(
                                (p) =>
                                    String(p.name || '').trim().toLowerCase() ===
                                    lower,
                            );
                        if (!found) return null;
                        return {
                            id: found.id,
                            protocol: found.protocol || 'proxy',
                            countryCode: '',
                            displaySlot: `ProxySlot-${idx + 1} (${String(found.protocol || 'proxy').toUpperCase()})`,
                        };
                    })
                    .filter(Boolean);
                if (selectedProxySpecs.length === 0) {
                    console.error('[audit:live] 未找到指定内置代理');
                    process.exitCode = 1;
                }
            }

            if (selectedProxySpecs.length > 0) {
                tempAuditRoot = fs.mkdtempSync(
                    path.join(os.tmpdir(), 'multichrome-live-audit-'),
                );
                const tempSettingsManager = new SettingsManager({ directory: tempAuditRoot });
                const saved = await tempSettingsManager.saveSettings({
                    dataPath: tempAuditRoot,
                    startupUrl: 'about:blank',
                    requireHealthCheckOnLaunch: false,
                });
                if (!saved) throw new Error('Could not initialize temporary audit settings');

                tempChromeManager = new ChromeManager(
                    proxyManager,
                    tempSettingsManager,
                    kernelManager,
                );

                const ephemeralTargets = [];
                for (let pIdx = 0; pIdx < selectedProxySpecs.length; pIdx += 1) {
                    const proxySpec = selectedProxySpecs[pIdx];
                    for (const engineId of OPTS.engines) {
                        const meta = ENGINE_META[engineId];
                        if (engineId === 'fingerprint-chromium') {
                            const activeKernel = kernelManager.getActiveKernel();
                            if (!activeKernel) {
                                const msg =
                                    '未安装或未激活 C++ 隐私指纹内核 (fingerprint-chromium)，无法执行该内核抽检';
                                console.error(`[audit:live] ${msg}`);
                                reports.push({
                                    label: `${proxySpec.displaySlot}-${meta.tag}`,
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
                                    label: `${proxySpec.displaySlot}-${meta.tag}`,
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
                                `LiveAudit-P${pIdx + 1}-${meta.tag}`,
                                '用户分组',
                                `ephemeral L4 multi-window MCP audit profile (${engineId})`,
                                {
                                    browserEngine: engineId,
                                    proxyId: proxySpec.id,
                                },
                            );
                        ephemeralTargets.push({
                            env: ephemeralEnv,
                            label: `${ephemeralEnv.name} [${proxySpec.displaySlot}]`,
                        });
                    }
                }

                const res = await runAuditGroup({
                    chromeManager: tempChromeManager,
                    proxyManager,
                    targets: ephemeralTargets,
                    reports,
                    parallel: OPTS.parallel,
                    viaMcp: OPTS.viaMcp,
                });
                auditedCount += res.auditedCount;
                if (res.mcpSummary) mcpSummaries.push(res.mcpSummary);
            }
        }

        if (mcpSummaries.length > 0) {
            console.log(
                '\n==================== MCP & MULTI-WINDOW SUMMARY ====================',
            );
            for (const s of mcpSummaries) {
                console.log(
                    `  MCP Server: ${s.serverName} | Tools=${s.toolCount} | StdioBridge=${s.stdioBridgeOk} | SimultaneousWindows=${s.simultaneousLaunched} | GridTiled=${s.tiledCount} (distinctPositions=${s.distinctGridPositions}) | ActiveSwitchVerified=${s.activeSwitchVerified}`,
                );
            }
        }

        if (reports.length > 0) {
            console.log(
                '\n==================== LIVE AUDIT DUAL-ENGINE SUMMARY ====================',
            );
            for (const engineKey of ['fingerprint-chromium', 'system-chrome']) {
                const group = reports.filter((r) => r.engine === engineKey);
                if (group.length === 0) continue;
                console.log(`\n### ${getEngineLabel(engineKey)} (共 ${group.length} 个并发窗口)`);
                for (const item of group) {
                    console.log(
                        `\n  [${item.label}] version=${item.browserVersion}${item.windowBounds ? ` | bounds=${JSON.stringify(item.windowBounds)}` : ''}`,
                    );
                    if (item.error) {
                        console.log(`    ERROR: ${item.error}`);
                        continue;
                    }
                    for (const siteKey of OPTS.sites) {
                        const spec = SITE_SPECS[siteKey];
                        if (!spec) continue;
                        console.log(
                            `    - ${spec.label}: ${summarizeSiteResult(siteKey, item.sites[siteKey])}`,
                        );
                    }
                }
            }
            console.log(
                '\n========================================================================',
            );
        }

        if (auditedCount === 0) {
            process.exitCode = 1;
        }
    } catch (fatalErr) {
        console.error(
            '[audit:live] Fatal error:',
            redactPublicIps(fatalErr?.message || String(fatalErr)),
        );
        process.exitCode = 1;
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
        app.exit(process.exitCode || 0);
    }
});
