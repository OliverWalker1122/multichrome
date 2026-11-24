#!/usr/bin/env node
/**
 * MultiChrome Full UI + 12-Feature End-to-End Verification Suite
 *
 * Launches the REAL compiled Electron app against a completely isolated temporary
 * userData directory, connects to the live renderer over CDP, verifies zero uncaught
 * exceptions, clicks through real Fluent UI controls, and launches a real browser
 * environment to verify startup-URL deduplication, bookmark template sync, live memory
 * stats, and close-all flow.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const results = [];
const consoleErrors = [];
const pageExceptions = [];

function record(id, title, passed, detail = '') {
    results.push({ id, title, passed, detail });
    const icon = passed ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${id}: ${title}${detail ? ` — ${detail}` : ''}`);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(3000, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
    });
}

function httpRequest({
    port,
    method = 'GET',
    path: reqPath = '/',
    headers = {},
    body = null,
    timeoutMs = 20000,
}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                method,
                path: reqPath,
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(Buffer.from(c)));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try {
                        json = text ? JSON.parse(text) : null;
                    } catch {
                        json = null;
                    }
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        text,
                        json,
                    });
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        if (body !== null) {
            req.write(body);
        }
        req.end();
    });
}

async function waitForRendererTarget(debugPort, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const targets = await httpGetJson(
                `http://127.0.0.1:${debugPort}/json/list`,
            );
            const page = targets.find(
                (t) =>
                    t.type === 'page' &&
                    typeof t.webSocketDebuggerUrl === 'string' &&
                    !t.url.startsWith('devtools://'),
            );
            if (page) return page;
        } catch {
            // retry
        }
        await sleep(250);
    }
    throw new Error(`Timed out waiting for Electron renderer target on port ${debugPort}`);
}

class SimpleCDP {
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
                    if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    else resolve(msg.result);
                } else if (msg.method === 'Runtime.exceptionThrown') {
                    const text =
                        msg.params?.exceptionDetails?.exception?.description ||
                        msg.params?.exceptionDetails?.text ||
                        'Unknown page exception';
                    pageExceptions.push(text);
                } else if (
                    msg.method === 'Runtime.consoleAPICalled' &&
                    msg.params?.type === 'error'
                ) {
                    const args = (msg.params.args || [])
                        .map((a) => a.value ?? a.description ?? '')
                        .join(' ');
                    if (args) consoleErrors.push(args);
                }
            } catch {
                // ignore
            }
        });
        await this.send('Runtime.enable');
    }

    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`CDP timeout: ${method}`));
                }
            }, 15000);
            this.pending.set(id, {
                resolve: (val) => {
                    clearTimeout(timer);
                    resolve(val);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async eval(expression) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (res.exceptionDetails) {
            throw new Error(
                res.exceptionDetails.exception?.description ||
                    res.exceptionDetails.text ||
                    'Evaluate exception',
            );
        }
        return res.result?.value;
    }

    close() {
        try {
            this.ws?.close();
        } catch {
            // ignore
        }
    }
}

async function waitUntil(fn, timeoutMs = 8000, intervalMs = 150) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await fn();
        if (last) return last;
        await sleep(intervalMs);
    }
    return last;
}

async function verifyWindowMaterials(cdp, reloadUI) {
    const originalTheme = await cdp.eval("window.electronAPI.settings.getSettings().then(s => s.theme || 'system')");
    const startsDark = await cdp.eval("document.documentElement.dataset.theme === 'dark'");
    const systemMedia = await cdp.eval(`({
        reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        forced: matchMedia('(forced-colors: active)').matches,
    })`);
    const screenshots = process.argv.includes('--screenshots');
    const shellLightness = {};
    const failures = [];
    const waitForPaint = async () => {
        if (await cdp.eval('document.hidden')) await cdp.send('Page.bringToFront');
        await cdp.eval(`new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    };
    const setMedia = async (transparency, forcedColors = 'none') => {
        const features = [];
        if (transparency && (systemMedia.reduced || transparency === 'reduce')) {
            features.push({ name: 'prefers-reduced-transparency', value: transparency });
        }
        if (transparency && (systemMedia.forced || forcedColors === 'active')) {
            features.push({ name: 'forced-colors', value: forcedColors });
        }
        await cdp.send('Emulation.setEmulatedMedia', { features });
        // matchMedia updates before the new material colors and filters are painted.
        await waitForPaint();
    };
    try {
        // Start with the other theme so both passes explicitly select a theme through the title bar.
        for (const theme of startsDark ? ['light', 'dark'] : ['dark', 'light']) {
            await setMedia('no-preference');
            await cdp.eval(`if (document.documentElement.dataset.theme !== '${theme}') {
                document.querySelector('header[aria-label="应用顶栏"] button[aria-label*="色"]').click();
            }`);
            if (!await waitUntil(() => cdp.eval(`document.documentElement.dataset.theme === '${theme}'`))) {
                throw new Error(`标题栏无法切换至 ${theme}`);
            }
            if (screenshots) {
                const fixtureVisible = await cdp.eval(`(() => {
                    const names = [...document.querySelectorAll('table[aria-label="环境列表"] tbody tr')]
                        .map(row => row.querySelector('td [title]')?.title);
                    return names.length === 2 && names.includes('测试环境Alpha') && names.includes('测试环境Beta')
                        && !document.querySelector('[data-details-panel], [role="dialog"]');
                })()`);
                if (!fixtureVisible) throw new Error('截图时未显示预期的两个测试环境');
                // Use a solid backdrop underneath the renderer to keep the host desktop out of captures.
                await cdp.eval(`document.querySelector('tr [title="测试环境Alpha"]').closest('tr').click();
                    document.body.style.backgroundColor = '${theme === 'light' ? '#e0e0e0' : '#303030'}';
                    document.fonts.ready.then(() => true)`);
                await waitForPaint();
                const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
                const dir = path.join(projectRoot, '.tmp', 'ui-screenshots');
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, `home-${theme}.png`), Buffer.from(data, 'base64'));
            }
            await cdp.eval(`document.querySelector('table[aria-label="环境列表"] tbody tr')
                .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
            if (!await waitUntil(() => cdp.eval("!!document.querySelector('[data-details-panel]')"))) {
                throw new Error('环境详情未打开');
            }
            for (const mode of ['standard', 'reduced', 'forced-colors']) {
                const expectReduced = mode === 'reduced';
                const expectForced = mode === 'forced-colors';
                if (mode !== 'standard') {
                    await setMedia(expectReduced ? 'reduce' : 'no-preference', expectForced ? 'active' : 'none');
                }
                const measure = () => cdp.eval(`(() => {
                    const nodes = {
                        shell: document.querySelector('header[aria-label="应用顶栏"]').parentElement,
                        workspace: document.querySelector('main'),
                        card: document.querySelector('table[aria-label="环境列表"]').parentElement,
                        drawer: document.querySelector('[data-details-panel]'),
                    };
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = 1;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    const layers = {};
                    for (const [name, node] of Object.entries(nodes)) {
                        if (!node?.getClientRects().length) throw new Error('缺少材质层 ' + name);
                        const style = getComputedStyle(node);
                        ctx.clearRect(0, 0, 1, 1);
                        ctx.fillStyle = style.backgroundColor;
                        ctx.fillRect(0, 0, 1, 1);
                        const [r, g, b, alpha] = ctx.getImageData(0, 0, 1, 1).data;
                        layers[name] = { alpha, brightness: r + g + b, filter: style.backdropFilter };
                    }
                    return {
                        layers,
                        reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
                        forced: matchMedia('(forced-colors: active)').matches,
                    };
                })()`);
                let mismatches;
                await waitUntil(async () => {
                    const { layers, reduced, forced } = await measure();
                    mismatches = [];
                    const expectOpaque = expectReduced || expectForced;
                    if (reduced !== expectReduced || forced !== expectForced) mismatches.push(`${theme}/${mode}: media`);
                    for (const [name, { alpha, filter }] of Object.entries(layers)) {
                        if (expectOpaque ? alpha !== 255 || filter !== 'none' : alpha === 0 || alpha === 255) {
                            mismatches.push(`${theme}/${mode}/${name}: alpha=${alpha}, filter=${filter}`);
                        }
                    }
                    if (!expectOpaque) {
                        const { workspace, shell, card, drawer } = layers;
                        shellLightness[theme] = shell.brightness;
                        if (!(workspace.alpha < shell.alpha && shell.alpha <= card.alpha && card.alpha < drawer.alpha)) {
                            mismatches.push(`${theme}: 层级 alpha=${[workspace.alpha, shell.alpha, card.alpha, drawer.alpha]}`);
                        }
                    }
                    return mismatches.length === 0;
                }, 2500);
                failures.push(...mismatches);
            }
            await cdp.eval(`document.querySelector('[data-details-panel] button[aria-label="关闭详情面板"]').click()`);
            if (!await waitUntil(() => cdp.eval("!document.querySelector('[data-details-panel]')"))) {
                throw new Error('环境详情未关闭');
            }
        }
        if (shellLightness.light <= shellLightness.dark) failures.push('浅色与深色外壳亮度异常');
    } catch (error) {
        failures.push(error.message);
    } finally {
        await setMedia();
        await cdp.eval(`(async () => {
            const settings = await window.electronAPI.settings.getSettings();
            if (settings.theme !== ${JSON.stringify(originalTheme)}) {
                await window.electronAPI.settings.saveSettings({ ...settings, theme: ${JSON.stringify(originalTheme)} });
            }
        })()`);
        await reloadUI();
    }
    record('E2E-02d', '浅深主题玻璃材质、降低透明度与强制颜色回退', failures.length === 0, failures.join(' | '));
}

function startLocalTestServer() {
    let hits = 0;
    const server = http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];

        if (urlPath === '/inbox') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><title>Verification Inbox</title></head><body>
                <h1>Verification Mail</h1>
                <p id="otp-banner">OTP Code: <strong id="otp-code">739184</strong></p>
                <table id="quota-table">
                    <thead><tr><th>Region</th><th>Status</th></tr></thead>
                    <tbody><tr><td>Tokyo</td><td>Available</td></tr><tr><td>Osaka</td><td>Full</td></tr></tbody>
                </table>
            </body></html>`);
            return;
        }

        if (urlPath === '/signup') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><title>Cloud Registration</title></head><body>
                <h1>Create Cloud Account</h1>
                <label for="reg-email">Work Email</label>
                <input id="reg-email" name="email" placeholder="Work Email" />
                <label for="reg-region">Home Region</label>
                <select id="reg-region" name="region">
                    <option value="">Select</option>
                    <option value="ap-tokyo-1">Japan East (Tokyo)</option>
                    <option value="us-ashburn-1">US East (Ashburn)</option>
                </select>
                <div id="shadow-host"></div>
                <label for="reg-otp">Verification Code</label>
                <input id="reg-otp" name="otp" placeholder="6-digit OTP" />
                <button id="submit-reg" type="button">Complete Registration</button>
                <div id="reg-result"></div>
                <script>
                    const host = document.getElementById('shadow-host');
                    const root = host.attachShadow({ mode: 'open' });
                    const btn = document.createElement('button');
                    btn.id = 'agree-terms-btn';
                    btn.textContent = 'Accept Terms';
                    window.__termsAccepted = false;
                    btn.addEventListener('click', (ev) => {
                        window.__termsAccepted = true;
                        window.__lastClickTrusted = ev.isTrusted;
                        btn.textContent = 'Terms Accepted';
                    });
                    root.appendChild(btn);
                    document.getElementById('submit-reg').addEventListener('click', () => {
                        const email = document.getElementById('reg-email').value;
                        const region = document.getElementById('reg-region').value;
                        const otp = document.getElementById('reg-otp').value;
                        if (email && region === 'ap-tokyo-1' && window.__termsAccepted && otp === '739184') {
                            document.getElementById('reg-result').textContent = 'Registration Complete: ' + email + ' @ ' + region + ' #' + otp;
                        } else {
                            document.getElementById('reg-result').textContent = 'Incomplete: ' + JSON.stringify({ email, region, terms: window.__termsAccepted, otp });
                        }
                    });
                </script>
            </body></html>`);
            return;
        }

        if (urlPath === '/flash-sale') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><title>Instance Provisioning</title></head><body>
                <h1>Provision Compute</h1>
                <button id="buy-now" type="button">Create Instance</button>
                <div id="sale-status">Ready</div>
                <script>
                    let count = 0;
                    document.getElementById('buy-now').addEventListener('click', () => {
                        count += 1;
                        if (count < 4) {
                            document.getElementById('sale-status').textContent = 'Out of host capacity (attempt ' + count + ')';
                        } else {
                            document.getElementById('sale-status').textContent = 'Order Confirmed #9001 (attempt ' + count + ')';
                        }
                    });
                </script>
            </body></html>`);
            return;
        }

        if (urlPath === '/captcha-gate') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><title>Just a moment...</title></head><body>
                <div class="cf-turnstile">Verify you are human</div>
                <button id="gated-btn" type="button">Continue</button>
            </body></html>`);
            return;
        }

        if (urlPath === '/rpa-form') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><title>RPA Task Form</title></head><body>
                <label for="rpa-project">Project Name</label>
                <input id="rpa-project" name="project" placeholder="Project Name" />
                <button id="rpa-save" type="button">Save Project</button>
                <div id="rpa-output"></div>
                <script>
                    document.getElementById('rpa-save').addEventListener('click', () => {
                        document.getElementById('rpa-output').textContent = 'Saved: ' + document.getElementById('rpa-project').value;
                    });
                </script>
            </body></html>`);
            return;
        }

        if (urlPath === '/account-check') {
            const cookieHeader = req.headers.cookie || '';
            const loggedIn = cookieHeader.includes('mc_session=active');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
                loggedIn
                    ? `<!doctype html><html><head><title>Dashboard</title></head><body><div id="welcome-user">Account Active</div></body></html>`
                    : `<!doctype html><html><head><title>Sign In</title></head><body><input type="password" placeholder="Password" /><p>Please sign in</p></body></html>`,
            );
            return;
        }

        hits += 1;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
            `<!doctype html><html><head><title>E2E Startup Page</title></head><body><h1>MultiChrome E2E OK</h1><p>Hit #${hits}</p></body></html>`,
        );
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                getHits: () => hits,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ui-e2e-'));
    const tempUserData = path.join(tempRoot, 'userData');
    fs.mkdirSync(tempUserData, { recursive: true });

    const debugPort = await findFreePort();
    const localServer = await startLocalTestServer();
    const localStartupUrl = `http://127.0.0.1:${localServer.port}/startup`;

    const childEnv = {
        ...process.env,
        MULTICHROME_USER_DATA: tempUserData,
        NODE_ENV: 'production',
    };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    console.log(`[E2E-UI] Starting Electron app with isolated userData: ${tempUserData}`);
    const electronProc = spawn(
        electronBinary,
        [projectRoot, `--remote-debugging-port=${debugPort}`],
        {
            cwd: projectRoot,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );

    let electronStderr = '';
    electronProc.stderr.on('data', (chunk) => {
        electronStderr += chunk.toString('utf8');
    });

    let cdp = null;
    try {
        const target = await waitForRendererTarget(debugPort, 25000);
        cdp = new SimpleCDP(target.webSocketDebuggerUrl);
        await cdp.connect();

        // Wait until React app mounts and electronAPI is ready (fresh install defaults to English en-US)
        const mountedDefaultEn = await waitUntil(
            () =>
                cdp.eval(`Boolean(
                    window.electronAPI &&
                    document.body &&
                    document.documentElement.lang === 'en-US' &&
                    document.body.innerText.includes('New Environment')
                )`),
            12000,
        );
        const initialLocale = await cdp.eval(
            `window.electronAPI.settings.getSettings().then(s => s.locale)`,
        );
        // Switch to optional Simplified Chinese via TitleBar toggle and verify live persistence
        await cdp.eval(`
            document.querySelector('header[aria-label="Application title bar"] button[aria-label*="Chinese"]')?.click()
        `);
        const switchedToZh = await waitUntil(
            () =>
                cdp.eval(`Boolean(
                    document.documentElement.lang === 'zh-CN' &&
                    document.body.innerText.includes('新建环境')
                )`),
            6000,
        );
        const savedZhLocale = await cdp.eval(
            `window.electronAPI.settings.getSettings().then(s => s.locale)`,
        );
        record(
            'E2E-00',
            '主窗口启动渲染（默认英文 en-US）& 一键切换可选简体中文（zh-CN）',
            Boolean(
                mountedDefaultEn &&
                    initialLocale === 'en-US' &&
                    switchedToZh &&
                    savedZhLocale === 'zh-CN',
            ),
            `defaultLocale=${initialLocale}, switchedLocale=${savedZhLocale}, url=${target.url}`,
        );

        // Helper functions injected into page for reliable React UI interactions
        const injectHelpers = async () => {
            await cdp.eval(`
                window.__e2e = {
                    clickByText(text, selector = 'button, [role="menuitem"], [role="tab"]') {
                        const els = Array.from(document.querySelectorAll(selector));
                        const match = els.find((el) => {
                            if (el.offsetParent === null) return false;
                            const t = (el.innerText || el.textContent || '').trim();
                            return t === text || t.includes(text);
                        });
                        if (!match) return false;
                        match.click();
                        return true;
                    },
                    clickExact(text, selector = 'button, [role="menuitem"], [role="tab"]') {
                        const els = Array.from(document.querySelectorAll(selector));
                        const match = els.find((el) => {
                            if (el.offsetParent === null) return false;
                            const t = (el.innerText || el.textContent || '').trim();
                            return t === text;
                        });
                        if (!match) return false;
                        match.click();
                        return true;
                    },
                    setReactValue(el, value) {
                        const proto = el.tagName === 'TEXTAREA'
                            ? window.HTMLTextAreaElement.prototype
                            : window.HTMLInputElement.prototype;
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                        setter.call(el, value);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    },
                    bodyText() {
                        return document.body.innerText || '';
                    }
                };
                true;
            `);
        };
        const reloadUI = async () => {
            await cdp.eval(`window.location.reload(); true;`);
            await sleep(400);
            await waitUntil(
                () =>
                    cdp
                        .eval(
                            `Boolean(window.electronAPI && document.body && document.body.innerText.includes('新建环境'))`,
                        )
                        .catch(() => false),
                10000,
                200,
            );
            await injectHelpers();
        };
        await injectHelpers();

        // ---------------------------------------------------------------
        // E2E-01: Verify zero crypto/wallet copy across main UI & Create modal
        // ---------------------------------------------------------------
        await cdp.eval(`window.__e2e.clickExact('新建环境')`);
        await sleep(300);
        const modalText = await cdp.eval(`window.__e2e.bodyText()`);
        const hasCryptoCopy = /钱包地址|大额钱包|交易所/.test(modalText);
        await cdp.eval(`window.__e2e.clickExact('取消')`);
        await sleep(200);
        record(
            'E2E-01',
            '通用指纹浏览器定位（界面无币圈/钱包残留）',
            !hasCryptoCopy,
            hasCryptoCopy ? 'Found unexpected crypto copy in create modal' : 'Clean general-purpose UI',
        );

        // ---------------------------------------------------------------
        // E2E-02: Create environments, group rename, status filter, context menu, group delete
        // ---------------------------------------------------------------
        const envA = await cdp.eval(`
            window.electronAPI.chromeEnvironments.create('测试环境Alpha', '测试组A', '用于UI端到端验证', { browserEngine: 'system-chrome' })
        `);
        const envB = await cdp.eval(`
            window.electronAPI.chromeEnvironments.create('测试环境Beta', '测试组A', '', { browserEngine: 'system-chrome' })
        `);
        // Sync UI after direct IPC environment creation
        await reloadUI();
        await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('测试环境Alpha')`));
        await verifyWindowMaterials(cdp, reloadUI);

        const sidebarLayoutOk = await cdp.eval(`(() => {
            const nav = document.querySelector('aside[aria-label="主导航"]');
            const header = nav.querySelector('button[aria-label="环境"]');
            const all = nav.querySelector('button[title="全部环境"]');
            const group = nav.querySelector('button[title="测试组A"]');
            if (!header || !all || !group) return false;
            const aligned = Math.abs(all.lastElementChild.getBoundingClientRect().right
                - group.lastElementChild.getBoundingClientRect().right) < 1;
            return header.textContent.trim() === '环境' && aligned
                && all.getAttribute('aria-current') === 'page'
                && nav.querySelectorAll('[aria-current="page"]').length === 1;
        })()`);
        await cdp.eval(`document.querySelector('aside button[title="测试组A"]')?.click()`);
        const selectionMoved = await waitUntil(() => cdp.eval(`Boolean(
            document.querySelector('aside button[title="测试组A"][aria-current="page"]')
            && document.querySelectorAll('aside [aria-current="page"]').length === 1)`));
        await cdp.eval(`document.querySelector('aside button[title="全部环境"]')?.click()`);
        record('E2E-02a', '侧栏计数对齐，当前分组单独高亮', sidebarLayoutOk && selectionMoved);

        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
        const menuVisibilityOk = await cdp.eval(`(() => {
            const row = document.querySelector('tr[aria-selected="false"]:not(:hover)');
            const menu = row?.querySelector('.mc-environment-row-menu');
            const launchBtn = Array.from(row?.querySelectorAll('button') || []).find(
                (b) => (b.innerText || '').includes('启动')
            );
            if (!menu || !launchBtn) return false;
            const launchStyle = getComputedStyle(launchBtn);
            const launchProminent =
                launchStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                parseFloat(launchStyle.borderTopWidth || '0') >= 1;
            const expected = matchMedia('(hover: hover) and (pointer: fine)').matches ? '0' : '1';
            const resting = getComputedStyle(menu).opacity;
            menu.focus();
            const focused = getComputedStyle(menu).opacity;
            menu.blur();
            return launchProminent && resting === expected && focused === '1';
        })()`);
        record('E2E-02c', '启动按钮醒目可见 + 行菜单按输入设备显示且键盘聚焦可见', menuVisibilityOk);

        const isDockOpen = () => cdp.eval(`Boolean(document.getElementById('proxy-log-dock'))`);
        const toggleDock = () => cdp.eval(`window.__e2e.clickExact('代理日志', 'footer button')`);
        const initiallyClosed = !(await isDockOpen());
        await toggleDock();
        const opened = await waitUntil(isDockOpen);
        await reloadUI();
        const restoredOpen = await waitUntil(isDockOpen);
        await cdp.eval(`document.querySelector('nav button[aria-label="代理"]')?.click()`);
        const proxyPageClosed = await waitUntil(() => cdp.eval(`document.querySelector('main h1')?.textContent === '代理'
            && !document.getElementById('proxy-log-dock')`));
        await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
        const stillOpen = await waitUntil(isDockOpen);
        await toggleDock();
        await reloadUI();
        const restoredClosed = !(await isDockOpen());
        record('E2E-02b', '代理日志默认收起，各页独立记住开关',
            initiallyClosed && opened && restoredOpen && proxyPageClosed && stillOpen && restoredClosed);

        // Test status filter pills (运行中 -> empty, 未运行 -> shows envA)
        const statusFilters = '[aria-label="按运行状态筛选"] button';
        await cdp.eval(`window.__e2e.clickByText('运行中', ${JSON.stringify(statusFilters)})`);
        await sleep(200);
        const runningEmpty = await cdp.eval(`!window.__e2e.bodyText().includes('测试环境Alpha')`);
        await cdp.eval(`window.__e2e.clickByText('未运行', ${JSON.stringify(statusFilters)})`);
        await sleep(200);
        const stoppedShows = await cdp.eval(`window.__e2e.bodyText().includes('测试环境Alpha')`);
        await cdp.eval(`window.__e2e.clickByText('全部', ${JSON.stringify(statusFilters)})`);
        await sleep(200);

        // Test right-click context menu on row
        const contextMenuItems = await cdp.eval(`
            (() => {
                const rows = Array.from(document.querySelectorAll('tbody tr'));
                const row = rows.find((r) => (r.innerText || '').includes('测试环境Alpha'));
                if (!row) return null;
                row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 220 }));
                return true;
            })()
        `);
        await sleep(200);
        const menuText = await cdp.eval(`document.querySelector('[role="menu"]')?.innerText || ''`);
        const contextMenuOk =
            Boolean(contextMenuItems) &&
            menuText.includes('克隆环境') &&
            menuText.includes('安全自检') &&
            menuText.includes('打开数据目录');
        // Dismiss context menu
        await cdp.eval(`document.body.click()`);
        await sleep(150);

        // Click sidebar group '测试组A' -> Rename to '测试组B' via real dialog
        const clickedGroup = await cdp.eval(`window.__e2e.clickByText('测试组A', 'aside button, nav button')`);
        await sleep(300);
        await cdp.eval(`window.__e2e.clickExact('管理分组', 'main button')`);
        const clickedRename = await waitUntil(() =>
            cdp.eval(`window.__e2e.clickExact('重命名分组', '[role="menuitem"]')`));
        await sleep(300);
        await cdp.eval(`
            (() => {
                const input = document.querySelector('[role="dialog"] input');
                if (input) window.__e2e.setReactValue(input, '测试组B');
            })()
        `);
        await sleep(150);
        await cdp.eval(`window.__e2e.clickByText('确认重命名', '[role="dialog"] button')`);
        const renamedVisible = await waitUntil(
            () =>
                cdp.eval(
                    `window.__e2e.bodyText().includes('测试组B') && !window.__e2e.bodyText().includes('测试组A')`,
                ),
            5000,
        );

        // Delete group '测试组B' (move environments to 默认分组) via real dialog
        await sleep(250);
        await cdp.eval(`window.__e2e.clickExact('管理分组', 'main button')`);
        const clickedDeleteGroup = await waitUntil(() =>
            cdp.eval(`window.__e2e.clickExact('删除分组', '[role="menuitem"]')`));
        await sleep(300);
        await cdp.eval(`window.__e2e.clickExact('确认删除', '[role="dialog"] button')`);
        const deletedGroupOk = await waitUntil(
            () =>
                cdp.eval(
                    `window.__e2e.bodyText().includes('测试环境Alpha') && !window.__e2e.bodyText().includes('测试组B') && !window.__e2e.bodyText().includes('测试组A')`,
                ),
            5000,
        );
        record(
            'E2E-02',
            '分组重命名/删除 + 运行状态筛选 + 表格行右键菜单',
            Boolean(
                runningEmpty &&
                    stoppedShows &&
                    contextMenuOk &&
                    clickedGroup &&
                    clickedRename &&
                    renamedVisible &&
                    clickedDeleteGroup &&
                    deletedGroupOk,
            ),
            `filter=${runningEmpty && stoppedShows}, ctxMenu=${contextMenuOk}, groupClick=${Boolean(clickedGroup)}, rename=${Boolean(renamedVisible)}, deleteGroup=${Boolean(clickedDeleteGroup && deletedGroupOk)}`,
        );

        // ---------------------------------------------------------------
        // E2E-03: Environment Clone (fresh isolated dir + new fingerprint seed)
        // ---------------------------------------------------------------
        const cloned = await cdp.eval(
            `window.electronAPI.chromeEnvironments.clone(${JSON.stringify(envA.id)})`,
        );
        await reloadUI();
        const cloneVisible = await waitUntil(
            () => cdp.eval(`window.__e2e.bodyText().includes('测试环境Alpha - 副本')`),
            4000,
        );
        const cloneIsolated =
            Boolean(cloned) &&
            cloned.id !== envA.id &&
            cloned.dataDir !== envA.dataDir &&
            cloned.fingerprintConfig?.seed !== envA.fingerprintConfig?.seed;
        record(
            'E2E-03',
            '环境克隆（独立目录 & 全新 32-bit 指纹种子）',
            Boolean(cloneVisible && cloneIsolated),
            `seedA=${envA.fingerprintConfig?.seed} -> seedClone=${cloned?.fingerprintConfig?.seed}`,
        );

        // ---------------------------------------------------------------
        // E2E-04: Profile Storage Stats & One-Click Cache Cleanup (UI + Disk)
        // ---------------------------------------------------------------
        const defaultProfileDir = path.join(envA.dataDir, 'Default');
        const cacheDataDir = path.join(defaultProfileDir, 'Cache', 'Cache_Data');
        fs.mkdirSync(cacheDataDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDataDir, 'f_000001'), Buffer.alloc(300 * 1024, 0x41));
        fs.writeFileSync(path.join(defaultProfileDir, 'Cookies'), 'KEEP_LOGIN_SESSION');
        fs.writeFileSync(path.join(defaultProfileDir, 'Preferences'), '{"ok":true}');

        // Select envA row and open details panel
        await cdp.eval(`
            (() => {
                const rows = Array.from(document.querySelectorAll('tbody tr'));
                const row = rows.find((r) => (r.innerText || '').includes('测试环境Alpha') && !(r.innerText || '').includes('副本'));
                if (row) {
                    row.click();
                    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                }
            })()
        `);
        const storageShown = await waitUntil(
            () => cdp.eval(`window.__e2e.bodyText().includes('清缓存') && window.__e2e.bodyText().includes('KB')`),
            5000,
        );
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 958, height: 700, deviceScaleFactor: 1, mobile: false,
        });
        try {
            const fits = await waitUntil(() => cdp.eval(`(() => {
                const table = document.querySelector('table[aria-label="环境列表"]')?.parentElement;
                const form = document.getElementById('env-details-form');
                return window.innerWidth === 958 && [table, form].every(
                    el => el?.clientWidth > 0 && el.scrollWidth <= el.clientWidth + 1
                );
            })()`));
            record('E2E-04a', '中等宽度窗口内，环境列表与详情表单完整可见', fits);
        } finally {
            await cdp.send('Emulation.clearDeviceMetricsOverride');
        }
        await cdp.eval(`window.__e2e.clickByText('清缓存')`);
        const cacheCleared = await waitUntil(
            () => !fs.existsSync(path.join(cacheDataDir, 'f_000001')),
            5000,
        );
        const cookiesKept =
            fs.readFileSync(path.join(defaultProfileDir, 'Cookies'), 'utf8') ===
                'KEEP_LOGIN_SESSION' &&
            fs.existsSync(path.join(defaultProfileDir, 'Preferences'));
        record(
            'E2E-04',
            'Profile 体积统计 & 详情面板一键清缓存（保留 Cookie/Preferences）',
            Boolean(storageShown && cacheCleared && cookiesKept),
            `uiShown=${Boolean(storageShown)}, cacheRemoved=${Boolean(cacheCleared)}, cookiesPreserved=${cookiesKept}`,
        );

        // ---------------------------------------------------------------
        // E2E-05: Batch Proxy Import + Duplicate Proxy Reminder across UI
        // ---------------------------------------------------------------
        await cdp.eval(`window.__e2e.clickByText('代理', 'nav button, aside button, button')`);
        await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('批量导入')`), 5000);
        await cdp.eval(`window.__e2e.clickByText('批量导入')`);
        await sleep(250);
        await cdp.eval(`
            (() => {
                const ta = document.querySelector('[role="dialog"] textarea');
                if (ta) {
                    window.__e2e.setReactValue(ta, [
                        '美西测试-1 | http://127.0.0.1:18081',
                        '日本测试-2 | socks5://user:pass@127.0.0.1:18082',
                        'http://127.0.0.1:18081',
                        'ftp://invalid.example:21',
                    ].join('\\n'));
                }
            })()
        `);
        await sleep(150);
        await cdp.eval(`window.__e2e.clickByText('开始导入', '[role="dialog"] button')`);
        const batchImportSummaryOk = await waitUntil(
            () =>
                cdp.eval(
                    `(() => {
                        const t = document.querySelector('[role="dialog"]')?.innerText || '';
                        return t.includes('成功 2 条') && t.includes('跳过重复 1 条') && t.includes('失败 1 条');
                    })()`,
                ),
            8000,
        );
        await cdp.eval(`window.__e2e.clickExact('关闭', '[role="dialog"] button')`);
        await sleep(250);

        const proxies = await cdp.eval(`window.electronAPI.proxies.list()`);
        const proxy1 = proxies.find((p) => p.name === '美西测试-1');
        let duplicateBadgeProxyOk = false;
        let duplicateBadgeEnvOk = false;
        let duplicateDetailsWarnOk = false;
        if (proxy1) {
            // Bind same proxy to envA and envB
            await cdp.eval(`window.electronAPI.chromeEnvironments.update(${JSON.stringify(envA.id)}, { proxyId: ${JSON.stringify(proxy1.id)} })`);
            await cdp.eval(`window.electronAPI.chromeEnvironments.update(${JSON.stringify(envB.id)}, { proxyId: ${JSON.stringify(proxy1.id)} })`);
            // Reload UI so React state reflects direct IPC proxy bindings cleanly
            await reloadUI();
            duplicateBadgeEnvOk = await waitUntil(
                () => cdp.eval(`window.__e2e.bodyText().includes('共用×2')`),
                4000,
            );
            // Open envA details to see duplicate warning banner
            await cdp.eval(`
                (() => {
                    const rows = Array.from(document.querySelectorAll('tbody tr'));
                    const row = rows.find((r) => (r.innerText || '').includes('测试环境Alpha') && !(r.innerText || '').includes('副本'));
                    if (row) {
                        row.click();
                        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                    }
                })()
            `);
            duplicateDetailsWarnOk = await waitUntil(
                () => cdp.eval(`window.__e2e.bodyText().includes('共用 IP 存在关联风险')`),
                4000,
            );
            // Check Proxies page '复用' badge
            await cdp.eval(`window.__e2e.clickByText('代理', 'nav button, aside button, button')`);
            duplicateBadgeProxyOk = await waitUntil(
                () => cdp.eval(`window.__e2e.bodyText().includes('复用')`),
                4000,
            );
            // Unbind proxy1 from envA so we can later launch envA directly against our local test HTTP server
            await cdp.eval(`window.electronAPI.chromeEnvironments.update(${JSON.stringify(envA.id)}, { proxyId: '' })`);
        }
        record(
            'E2E-05',
            '代理批量导入（去重/错行提示）& 多环境复用查重提醒',
            Boolean(
                batchImportSummaryOk &&
                    duplicateBadgeProxyOk &&
                    duplicateBadgeEnvOk &&
                    duplicateDetailsWarnOk,
            ),
            `batchUI=${Boolean(batchImportSummaryOk)}, proxyBadge=${Boolean(duplicateBadgeProxyOk)}, envBadge=${Boolean(duplicateBadgeEnvOk)}, detailsWarn=${Boolean(duplicateDetailsWarnOk)}`,
        );

        // ---------------------------------------------------------------
        // E2E-06: Settings Tabs — Auto Language, Bookmarks, Memory Saver Mode
        // ---------------------------------------------------------------
        // Simulate an already-running file:// window whose old build assets were replaced.
        await cdp.send('Network.enable');
        try {
            await cdp.send('Network.setBlockedURLs', { urls: ['file://*/assets/*.js'] });
            await cdp.eval(`window.__e2e.clickByText('设置', 'nav button, aside button')`);
            const settingsOpened = await waitUntil(
                () => cdp.eval(`Boolean(document.querySelector('[data-testid="settings-tab-general"]'))`),
                5000,
            );
            record('E2E-06a', '已打开的窗口在旧构建资源不可用时仍能进入设置', Boolean(settingsOpened));
        } finally {
            await cdp.send('Network.setBlockedURLs', { urls: [] });
            await cdp.send('Network.disable');
        }

        // Tab: 隐私 -> verify & toggle 自动匹配语言
        await cdp.eval(`window.__e2e.clickByText('隐私', '[role="tab"], button')`);
        const autoLangVisible = await waitUntil(
            () => cdp.eval(`window.__e2e.bodyText().includes('自动匹配语言')`),
            4000,
        );
        await cdp.eval(`
            (() => {
                const switches = Array.from(document.querySelectorAll('input[type="checkbox"][role="switch"]'));
                // switches: [0]=启动前安全检查, [1]=全局备用代理, [2]=自动匹配时区, [3]=自动匹配语言
                if (switches[3] && !switches[3].checked) switches[3].click();
            })()
        `);
        await sleep(150);

        // Tab: 浏览器 -> toggle 省内存模式 & add bookmark template
        await cdp.eval(`window.__e2e.clickByText('浏览器', '[role="tab"], button')`);
        const templatesTabVisible = await waitUntil(
            () =>
                cdp.eval(
                    `window.__e2e.bodyText().includes('常用书签') && window.__e2e.bodyText().includes('本地扩展')`,
                ),
            4000,
        );
        const memSaverVisible = await waitUntil(
            () => cdp.eval(`window.__e2e.bodyText().includes('省内存模式')`),
            4000,
        );
        await cdp.eval(`
            (() => {
                const sw = document.querySelector('input[type="checkbox"][role="switch"]');
                if (sw && !sw.checked) sw.click();
                const nameInput = document.querySelector('input[placeholder="名称"]');
                const urlInputs = Array.from(document.querySelectorAll('input[placeholder="https://example.com/"]'));
                const urlInput = urlInputs[urlInputs.length - 1];
                const folderInput = document.querySelector('input[placeholder="文件夹（可选）"]');
                if (nameInput) window.__e2e.setReactValue(nameInput, 'E2E检测书签');
                if (urlInput) window.__e2e.setReactValue(urlInput, 'https://ip125.com/');
                if (folderInput) window.__e2e.setReactValue(folderInput, '常用工具');
            })()
        `);
        await sleep(150);
        await cdp.eval(`
            (() => {
                const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === '添加');
                const bmAddBtn = btns[btns.length - 1];
                if (bmAddBtn) bmAddBtn.click();
            })()
        `);
        await sleep(200);
        await cdp.eval(`window.__e2e.clickExact('保存设置')`);
        await sleep(500);
        const savedSettings = await cdp.eval(`window.electronAPI.settings.getSettings()`);
        const settingsPersisted =
            savedSettings?.memorySaverMode === true &&
            savedSettings?.fingerprint?.autoMatchLanguage === true &&
            Array.isArray(savedSettings?.bookmarkTemplates) &&
            savedSettings.bookmarkTemplates.some((b) => b.name === 'E2E检测书签');
        record(
            'E2E-06',
            '设置中心：自动匹配语言、常用书签与扩展、省内存模式保存',
            Boolean(autoLangVisible && templatesTabVisible && memSaverVisible && settingsPersisted),
            `autoLang=${Boolean(autoLangVisible)}, templatesTab=${Boolean(templatesTabVisible)}, memSaver=${Boolean(memSaverVisible)}, persisted=${settingsPersisted}`,
        );

        // ---------------------------------------------------------------
        // E2E-07: Pre-Launch Consistency Guard Dialog
        // ---------------------------------------------------------------
        await cdp.eval(`window.__e2e.clickByText('全部环境', 'nav button, aside button, button')`);
        await sleep(350);
        // Set envB to fingerprint-chromium (no kernel installed in isolated temp dir -> triggers guard error dialog)
        await cdp.eval(
            `window.electronAPI.chromeEnvironments.update(${JSON.stringify(envB.id)}, { browserEngine: 'fingerprint-chromium' })`,
        );
        await reloadUI();
        await sleep(300);
        await cdp.eval(`
            (() => {
                const rows = Array.from(document.querySelectorAll('tbody tr'));
                const row = rows.find((r) => (r.innerText || '').includes('测试环境Beta'));
                const btn = row ? Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').includes('启动')) : null;
                if (btn) btn.click();
            })()
        `);
        const guardShown = await waitUntil(
            () =>
                cdp.eval(
                    `(() => {
                        const t = document.querySelector('[role="dialog"]')?.innerText || '';
                        return t.includes('启动前一致性护栏') && t.includes('缺少 C++ 指纹浏览器内核');
                    })()`,
                ),
            5000,
        );
        await cdp.eval(`window.__e2e.clickExact('取消', '[role="dialog"] button')`);
        await sleep(200);
        record(
            'E2E-07',
            '启动前「防呆一致性护栏」拦截弹窗',
            Boolean(guardShown),
            guardShown ? 'Guard dialog intercepted missing kernel cleanly' : 'Guard dialog did not appear',
        );

        // ---------------------------------------------------------------
        // E2E-08: Environment Health Check Dialog
        // ---------------------------------------------------------------
        await cdp.eval(`
            (() => {
                const rows = Array.from(document.querySelectorAll('tbody tr'));
                const row = rows.find((r) => (r.innerText || '').includes('测试环境Alpha') && !(r.innerText || '').includes('副本'));
                if (row) {
                    row.click();
                    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                }
            })()
        `);
        await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('健康自检')`), 4000);
        await cdp.eval(`window.__e2e.clickByText('健康自检')`);
        const healthDialogOk = await waitUntil(
            () =>
                cdp.eval(
                    `(() => {
                        const t = document.querySelector('[role="dialog"]')?.innerText || '';
                        return (
                            t.includes('健康自检') &&
                            t.includes('代理与出口 IP') &&
                            t.includes('时区与 Geolocation') &&
                            t.includes('WebRTC & DNS 防泄露')
                        );
                    })()`,
                ),
            8000,
        );
        await cdp.eval(`window.__e2e.clickExact('关闭', '[role="dialog"] button')`);
        await sleep(200);
        record(
            'E2E-08',
            '健康自检弹窗（无双重斜杠标题）',
            Boolean(healthDialogOk),
            healthDialogOk ? 'All health check cards rendered' : 'Health dialog incomplete',
        );

        // ---------------------------------------------------------------
        // E2E-09: Real Browser Launch — Bookmark Sync, Env Startup URL Dedup, Live Memory Stats, Close All
        // ---------------------------------------------------------------
        await cdp.eval(
            `window.electronAPI.chromeEnvironments.update(${JSON.stringify(envA.id)}, { startupUrl: ${JSON.stringify(localStartupUrl)} })`,
        );
        const launch1Ok = await cdp.eval(
            `window.electronAPI.chromeEnvironments.launch(${JSON.stringify(envA.id)})`,
        );
        await sleep(3000);

        // 1) Verify Bookmarks file synced with template bookmark
        const bookmarksPath = path.join(envA.dataDir, 'Default', 'Bookmarks');
        let bookmarkSynced = false;
        if (fs.existsSync(bookmarksPath)) {
            const bmText = fs.readFileSync(bookmarksPath, 'utf8');
            bookmarkSynced = bmText.includes('E2E检测书签') && bmText.includes('常用工具');
        }

        // 2) Verify live memory stats API & UI subtitle + "关闭全部 (1)" button
        const memStats = await waitUntil(async () => {
            const s = await cdp.eval(`window.electronAPI.chromeEnvironments.getRunningResourceStats()`);
            return s && s.totalMemoryBytes > 0 ? s : null;
        }, 8000, 500);
        const closeAllBtnVisible = await waitUntil(
            () =>
                cdp.eval(
                    `window.__e2e.bodyText().includes('关闭全部 (1)') && /内存\\s+\\d/.test(window.__e2e.bodyText())`,
                ),
            6000,
        );

        // 3) Verify startup URL opened on first launch
        const hitsAfterFirstLaunch = localServer.getHits();

        // 4) Close envA via UI "关闭全部 (1)" button + confirm dialog
        await cdp.eval(`window.__e2e.clickByText('关闭全部 (1)')`);
        await sleep(250);
        await cdp.eval(`window.__e2e.clickByText('确认关闭全部', '[role="dialog"] button')`);
        const closedAllOk = await waitUntil(async () => {
            const list = await cdp.eval(`window.electronAPI.chromeEnvironments.getAll()`);
            return Array.isArray(list) && list.every((e) => !e.isRunning);
        }, 10000, 300);

        // 5) Relaunch envA (now has saved Chrome Sessions) -> verify startup URL is NOT duplicated
        // Ensure a Sessions marker exists if Chrome closed quickly
        const sessionsDir = path.join(envA.dataDir, 'Default', 'Sessions');
        if (!fs.existsSync(sessionsDir) || fs.readdirSync(sessionsDir).length === 0) {
            fs.mkdirSync(sessionsDir, { recursive: true });
            fs.writeFileSync(path.join(sessionsDir, 'Session_1'), 'stub');
        }
        const hitsBeforeSecondLaunch = localServer.getHits();
        const launch2Ok = await cdp.eval(
            `window.electronAPI.chromeEnvironments.launch(${JSON.stringify(envA.id)})`,
        );
        await sleep(3000);
        const hitsAfterSecondLaunch = localServer.getHits();
        // Close cleanly
        await cdp.eval(`window.electronAPI.chromeEnvironments.closeAll()`);
        await sleep(1500);

        // On second launch with existing restored tab (localStartupUrl), Chrome restores the 1 existing tab
        // (at most +1 reload of the restored tab, NEVER +2 duplicate tabs!)
        const secondLaunchDelta = hitsAfterSecondLaunch - hitsBeforeSecondLaunch;
        const dedupOk = Boolean(launch1Ok && launch2Ok) && hitsAfterFirstLaunch >= 1 && secondLaunchDelta <= 1;

        record(
            'E2E-09',
            '真实 Chrome 启动：书签模板分发 + 实时内存监控 + 一键关闭全部 + 启动页智能去重',
            Boolean(bookmarkSynced && memStats && closeAllBtnVisible && closedAllOk && dedupOk),
            `bookmark=${bookmarkSynced}, memMB=${memStats ? Math.round(memStats.totalMemoryBytes / 1024 / 1024) : 0}MB, closeAllUI=${Boolean(closeAllBtnVisible && closedAllOk)}, hits1=${hitsAfterFirstLaunch}, delta2=${secondLaunchDelta}`,
        );

        // ---------------------------------------------------------------
        // E2E-11 & E2E-12: Streamlined CDP Guard + 4-Tool MCP + Real-Browser Anti-Clobber Verification
        // ---------------------------------------------------------------
        const isPort18922Free = await new Promise((resolve) => {
            const s = net.createServer();
            s.once('error', () => resolve(false));
            s.listen({ host: '127.0.0.1', port: 18922, exclusive: true }, () => {
                s.close(() => resolve(true));
            });
        });

        const automationPort = await findFreePort();
        await cdp.eval(`window.__e2e.clickByText('设置', 'nav button, aside button, button')`);
        const autoTabReady = await waitUntil(
            () => cdp.eval(`Boolean(document.querySelector('[data-testid="settings-tab-automation"]'))`),
            8000,
        );
        await cdp.eval(`document.querySelector('[data-testid="settings-tab-automation"]')?.click()`);
        const autoPanelReady = await waitUntil(
            () =>
                cdp.eval(`(() => {
                    const panel = document.querySelector('[data-testid="automation-settings-panel"]');
                    const enableWrap = document.querySelector('[data-testid="automation-enable-switch"]');
                    const enableSw = enableWrap ? (enableWrap.matches('input[type="checkbox"]') ? enableWrap : enableWrap.querySelector('input[type="checkbox"]')) : null;
                    const portWrap = document.querySelector('[data-testid="automation-port-input"]');
                    const portInput = portWrap ? (portWrap.matches('input') ? portWrap : portWrap.querySelector('input')) : null;
                    return Boolean(panel && enableSw && !enableSw.disabled && portInput && !portInput.disabled);
                })()`),
            8000,
        );

        // Verify untouched default port (18922) binds out-of-the-box on Windows when free
        let defaultPortBootOk = true;
        if (isPort18922Free) {
            await cdp.eval(`(() => {
                const enableWrap = document.querySelector('[data-testid="automation-enable-switch"]');
                const enableSw = enableWrap ? (enableWrap.matches('input[type="checkbox"]') ? enableWrap : enableWrap.querySelector('input[type="checkbox"]')) : null;
                if (enableSw && !enableSw.checked) enableSw.click();
            })()`);
            defaultPortBootOk = Boolean(
                await waitUntil(
                    () =>
                        cdp.eval(`(() => {
                            const badge = (document.querySelector('[data-testid="automation-running-badge"]')?.textContent || '').trim();
                            const url = (document.querySelector('[data-testid="automation-base-url"]')?.textContent || '').trim();
                            return (badge === '运行中' || badge === 'Running') && url.includes(':18922');
                        })()`),
                    5000,
                ),
            );
        }

        await cdp.eval(`(() => {
            const portWrap = document.querySelector('[data-testid="automation-port-input"]');
            const portInput = portWrap ? (portWrap.matches('input') ? portWrap : portWrap.querySelector('input')) : null;
            if (portInput) window.__e2e.setReactValue(portInput, ${JSON.stringify(String(automationPort))});
        })()`);
        await sleep(150);
        await cdp.eval(`document.querySelector('[data-testid="automation-apply-port"]')?.click()`);
        const portApplied = await waitUntil(
            () =>
                cdp.eval(`(() => {
                    const urlEl = document.querySelector('[data-testid="automation-base-url"]');
                    const applyBtn = document.querySelector('[data-testid="automation-apply-port"]');
                    return Boolean(urlEl && (urlEl.textContent || '').includes(${JSON.stringify(`:${automationPort}`)}) && applyBtn && applyBtn.disabled);
                })()`),
            5000,
        );

        await cdp.eval(`(() => {
            const enableWrap = document.querySelector('[data-testid="automation-enable-switch"]');
            const enableSw = enableWrap ? (enableWrap.matches('input[type="checkbox"]') ? enableWrap : enableWrap.querySelector('input[type="checkbox"]')) : null;
            if (enableSw && !enableSw.checked) enableSw.click();
        })()`);
        const serverReady = await waitUntil(
            () =>
                cdp.eval(`(() => {
                    const enableWrap = document.querySelector('[data-testid="automation-enable-switch"]');
                    const enableSw = enableWrap ? (enableWrap.matches('input[type="checkbox"]') ? enableWrap : enableWrap.querySelector('input[type="checkbox"]')) : null;
                    const badge = document.querySelector('[data-testid="automation-running-badge"]');
                    const badgeText = (badge?.textContent || '').trim();
                    return Boolean(enableSw && enableSw.checked && !enableSw.disabled && (badgeText === '运行中' || badgeText === 'Running'));
                })()`),
            5000,
        );

        // Expand Quick Connect snippets and verify 2-in-1 multichrome (/mcp) + @playwright/mcp config
        await cdp.eval(`document.querySelector('[data-testid="automation-snippets-toggle"]')?.click()`);
        const standardSnippetsOk = Boolean(
            await waitUntil(
                () =>
                    cdp.eval(`(() => {
                        const code = document.querySelector('[data-testid="automation-snippet-code"]')?.textContent || '';
                        return code.includes('/mcp') && code.includes('@playwright/mcp@latest') && code.includes('--cdp-endpoint');
                    })()`),
                3000,
            ),
        );

        let restStatusOk = false;
        let mcpInitOk = false;
        let mcpToolsOk = false;
        let origin403Ok = false;
        let portConflictUiOk = false;
        let disabledCleanlyOk = false;
        let e2e11Error = '';
        let conflictBlocker = null;

        // E2E-12 real-browser CDP Guard flags
        let realPrivatePortIsolationOk = false;
        let realDiscoveryAndPassThroughOk = false;
        let realOverrideShieldOk = false;
        let realIncognitoBlockOk = false;
        let realActiveSwitchAndParallelOk = false;
        let e2e12Error = '';

        try {
            if (serverReady) {
                const reqHeaders = {
                    Host: `127.0.0.1:${automationPort}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                };

                let rpcId = 10;
                const callMcpTool = async (name, args = {}) => {
                    const res = await httpRequest({
                        port: automationPort,
                        method: 'POST',
                        path: '/mcp',
                        headers: reqHeaders,
                        timeoutMs: 30000,
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: rpcId++,
                            method: 'tools/call',
                            params: { name, arguments: args },
                        }),
                    });
                    if (res.status !== 200 || res.json?.error || res.json?.result?.isError) {
                        throw new Error(
                            `MCP ${name} failed: ${res.json?.error?.message || res.json?.result?.content?.[0]?.text || res.text}`,
                        );
                    }
                    return {
                        data: res.json.result.structuredContent,
                        content: res.json.result.content,
                    };
                };

                const statusRes = await httpRequest({
                    port: automationPort,
                    method: 'GET',
                    path: '/api/v1/status',
                    headers: { Host: `127.0.0.1:${automationPort}` },
                });
                restStatusOk =
                    statusRes.status === 200 &&
                    statusRes.json?.ok === true &&
                    typeof statusRes.json?.data?.profiles?.total === 'number';

                const initRes = await httpRequest({
                    port: automationPort,
                    method: 'POST',
                    path: '/mcp',
                    headers: reqHeaders,
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: {
                            protocolVersion: '2025-06-18',
                            capabilities: {},
                            clientInfo: { name: 'e2e-ui-suite', version: '1.0.0' },
                        },
                    }),
                });
                mcpInitOk =
                    initRes.status === 200 &&
                    initRes.json?.result?.serverInfo?.name === 'multichrome-mcp';

                const toolsRes = await httpRequest({
                    port: automationPort,
                    method: 'POST',
                    path: '/mcp',
                    headers: reqHeaders,
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 2,
                        method: 'tools/list',
                        params: {},
                    }),
                });
                mcpToolsOk =
                    toolsRes.status === 200 &&
                    Array.isArray(toolsRes.json?.result?.tools) &&
                    toolsRes.json.result.tools.length === 4;

                const originRes = await httpRequest({
                    port: automationPort,
                    method: 'GET',
                    path: '/json/version',
                    headers: {
                        Host: `127.0.0.1:${automationPort}`,
                        Origin: 'https://evil.example.com',
                    },
                });
                origin403Ok = originRes.status === 403;

                // -----------------------------------------------------------
                // E2E-12: Real-Browser Standard CDP Guard Suite
                // -----------------------------------------------------------
                const openGuardSockets = [];
                try {
                    const baseTestUrl = `http://127.0.0.1:${localServer.port}`;
                    await cdp.eval(
                        `window.electronAPI.chromeEnvironments.update(${JSON.stringify(envA.id)}, {
                            timezone: 'Asia/Tokyo',
                            startupUrl: ${JSON.stringify(`${baseTestUrl}/inbox`)},
                        })`,
                    );

                    // 1) Start profile by NAME via simplified 4-tool MCP
                    const startedA = await callMcpTool('start_profile', {
                        name: '测试环境Alpha',
                    });
                    const internalPortA = await cdp.eval(`(async () => {
                        const logs = await window.electronAPI.appLogs.getLogs();
                        for (let i = logs.length - 1; i >= 0; i--) {
                            const m = String(logs[i]?.message || '').match(/\\[测试环境Alpha\\] 分配端口:\\s*(\\d+)/);
                            if (m) return Number(m[1]);
                        }
                        return 0;
                    })()`);
                    // Verify internal Chrome port is randomized away from 9222 and never leaked in responses
                    realPrivatePortIsolationOk =
                        internalPortA >= 10000 &&
                        internalPortA !== 9222 &&
                        internalPortA !== automationPort &&
                        startedA.data?.wsEndpoint === `ws://127.0.0.1:${automationPort}/devtools/browser/${envA.id}` &&
                        !JSON.stringify(startedA.data).includes(String(internalPortA));

                    // 2) Standard CDP discovery (/json/version) just like @playwright/mcp & chrome-devtools-mcp
                    const verRes = await httpRequest({
                        port: automationPort,
                        method: 'GET',
                        path: '/json/version',
                        headers: { Host: `127.0.0.1:${automationPort}` },
                    });
                    const browserWsUrl = verRes.json?.webSocketDebuggerUrl || '';

                    const sendGuardCdp = (ws, msg) =>
                        new Promise((resolve, reject) => {
                            const timer = setTimeout(() => {
                                ws.off('message', onMsg);
                                reject(new Error(`CDP timeout on ${msg.method}`));
                            }, 8000);
                            const onMsg = (raw) => {
                                const parsed = JSON.parse(raw.toString('utf8'));
                                if (parsed.id === msg.id) {
                                    clearTimeout(timer);
                                    ws.off('message', onMsg);
                                    resolve(parsed);
                                }
                            };
                            ws.on('message', onMsg);
                            ws.send(JSON.stringify(msg));
                        });

                    const guardWs = new WebSocket(browserWsUrl);
                    openGuardSockets.push(guardWs);
                    await new Promise((resolve, reject) => {
                        guardWs.once('open', resolve);
                        guardWs.once('error', reject);
                    });

                    let cid = 1;
                    // Verify Target.createBrowserContext is blocked with foolproof hint
                    const ctxAttempt = await sendGuardCdp(guardWs, {
                        id: cid++,
                        method: 'Target.createBrowserContext',
                        params: {},
                    });
                    realIncognitoBlockOk = Boolean(
                        ctxAttempt.error &&
                            String(ctxAttempt.error.message).includes('browser.contexts()[0]'),
                    );

                    // Attach to page target in flattened mode (exactly how Playwright / Puppeteer work)
                    const targetsRes = await sendGuardCdp(guardWs, {
                        id: cid++,
                        method: 'Target.getTargets',
                        params: {},
                    });
                    const pageTarget = (targetsRes.result?.targetInfos || []).find(
                        (t) => t.type === 'page',
                    );
                    const attachRes = await sendGuardCdp(guardWs, {
                        id: cid++,
                        method: 'Target.attachToTarget',
                        params: { targetId: pageTarget.targetId, flatten: true },
                    });
                    const pageSessionId = attachRes.result.sessionId;

                    // Navigate to test page over guarded standard CDP
                    await sendGuardCdp(guardWs, {
                        id: cid++,
                        sessionId: pageSessionId,
                        method: 'Page.navigate',
                        params: { url: `${baseTestUrl}/inbox` },
                    });
                    await sleep(600);

                    // Fire external override commands that Puppeteer / Playwright typically send automatically
                    const uaOverrideRes = await sendGuardCdp(guardWs, {
                        id: cid++,
                        sessionId: pageSessionId,
                        method: 'Emulation.setUserAgentOverride',
                        params: { userAgent: 'ClobberedBotUA/9.9' },
                    });
                    const tzOverrideRes = await sendGuardCdp(guardWs, {
                        id: cid++,
                        sessionId: pageSessionId,
                        method: 'Emulation.setTimezoneOverride',
                        params: { timezoneId: 'UTC' },
                    });
                    const metricsOverrideRes = await sendGuardCdp(guardWs, {
                        id: cid++,
                        sessionId: pageSessionId,
                        method: 'Emulation.setDeviceMetricsOverride',
                        params: {
                            width: 612,
                            height: 412,
                            deviceScaleFactor: 1,
                            mobile: false,
                        },
                    });

                    // Inspect live Chrome browser state — environment must be 100% uncorrupted!
                    const evalRes = await sendGuardCdp(guardWs, {
                        id: cid++,
                        sessionId: pageSessionId,
                        method: 'Runtime.evaluate',
                        params: {
                            expression: `({
                                otp: document.querySelector('#otp-code')?.textContent?.trim() || '',
                                ua: navigator.userAgent,
                                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                innerW: window.innerWidth,
                                webdriver: navigator.webdriver,
                            })`,
                            returnByValue: true,
                        },
                    });
                    const liveState = evalRes.result?.result?.value || {};
                    realDiscoveryAndPassThroughOk =
                        verRes.status === 200 &&
                        browserWsUrl.startsWith(`ws://127.0.0.1:${automationPort}/devtools/browser/active/`) &&
                        liveState.otp === '739184';

                    realOverrideShieldOk =
                        Boolean(uaOverrideRes.result) &&
                        Boolean(tzOverrideRes.result) &&
                        Boolean(metricsOverrideRes.result) &&
                        !String(liveState.ua || '').includes('ClobberedBotUA') &&
                        liveState.tz === 'Asia/Tokyo' &&
                        liveState.innerW !== 612 &&
                        liveState.webdriver === false;

                    // 3) Launch second profile (setActive: false), then switch_active_profile & verify active disconnect + parallel explicit WS
                    const startedClone = await callMcpTool('start_profile', {
                        profileId: cloned.id,
                        setActive: false,
                    });
                    const parallelWs = new WebSocket(startedClone.data.wsEndpoint);
                    openGuardSockets.push(parallelWs);
                    await new Promise((resolve, reject) => {
                        parallelWs.once('open', resolve);
                        parallelWs.once('error', reject);
                    });

                    const activeClosedOnSwitch = new Promise((resolve) =>
                        guardWs.once('close', () => resolve(true)),
                    );
                    const switched = await callMcpTool('switch_active_profile', {
                        profileId: cloned.id,
                    });
                    await Promise.race([activeClosedOnSwitch, sleep(3000)]);

                    const verAfterSwitch = await httpRequest({
                        port: automationPort,
                        method: 'GET',
                        path: '/json/version',
                        headers: { Host: `127.0.0.1:${automationPort}` },
                    });
                    realActiveSwitchAndParallelOk =
                        switched.data?.activeProfileId === cloned.id &&
                        verAfterSwitch.json?.webSocketDebuggerUrl?.endsWith(`/${cloned.id}`) &&
                        parallelWs.readyState === WebSocket.OPEN;

                    await callMcpTool('stop_profile', { profileId: cloned.id });
                    await callMcpTool('stop_profile', { profileId: envA.id });
                } catch (err12) {
                    e2e12Error = err12 instanceof Error ? err12.message : String(err12);
                } finally {
                    for (const s of openGuardSockets) {
                        try {
                            s.terminate();
                        } catch {
                            // ignore
                        }
                    }
                    await cdp.eval(`window.electronAPI.chromeEnvironments.closeAll()`).catch(() => {});
                }

                // Port conflict UI regression check:
                conflictBlocker = net.createServer();
                await new Promise((resolve, reject) => {
                    conflictBlocker.once('error', reject);
                    conflictBlocker.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
                });
                const blockedPort = conflictBlocker.address().port;

                await cdp.eval(`(() => {
                    const portWrap = document.querySelector('[data-testid="automation-port-input"]');
                    const portInput = portWrap ? (portWrap.matches('input') ? portWrap : portWrap.querySelector('input')) : null;
                    if (portInput) window.__e2e.setReactValue(portInput, ${JSON.stringify(String(blockedPort))});
                })()`);
                await sleep(150);
                await cdp.eval(`document.querySelector('[data-testid="automation-apply-port"]')?.click()`);

                const conflictShown = await waitUntil(
                    () =>
                        cdp.eval(`(() => {
                            const badge = (document.querySelector('[data-testid="automation-running-badge"]')?.textContent || '').trim();
                            const errBanner = (document.querySelector('[data-testid="automation-last-error"]')?.textContent || '').trim();
                            const autoPickBannerBtn = document.querySelector('[data-testid="automation-auto-pick-port-banner"]');
                            return Boolean(
                                (badge === '启动失败' || badge === 'Start Failed') &&
                                errBanner.includes(${JSON.stringify(String(blockedPort))}) &&
                                autoPickBannerBtn
                            );
                        })()`),
                    5000,
                );

                const noFakeSuccessToast = await cdp.eval(`(() => {
                    const region = document.querySelector('[role="region"][aria-label*="通知"], [role="region"][aria-label*="Notification"]');
                    const txt = region ? region.innerText : '';
                    return !txt.includes(${JSON.stringify(`监听端口已更新为 ${blockedPort}`)}) && !txt.includes(${JSON.stringify(`Listening port updated to ${blockedPort}`)});
                })()`);

                await cdp.eval(`document.querySelector('[data-testid="automation-auto-pick-port-banner"]')?.click()`);
                const recoveredViaBanner = await waitUntil(
                    () =>
                        cdp.eval(`(() => {
                            const badge = (document.querySelector('[data-testid="automation-running-badge"]')?.textContent || '').trim();
                            const errBanner = document.querySelector('[data-testid="automation-last-error"]');
                            const baseUrl = (document.querySelector('[data-testid="automation-base-url"]')?.textContent || '').trim();
                            return Boolean(
                                (badge === '运行中' || badge === 'Running') &&
                                !errBanner &&
                                baseUrl &&
                                !baseUrl.includes(${JSON.stringify(`:${blockedPort}`)})
                            );
                        })()`),
                    5000,
                );
                portConflictUiOk = Boolean(conflictShown && noFakeSuccessToast && recoveredViaBanner);
            }
        } catch (err) {
            e2e11Error = err instanceof Error ? err.message : String(err);
        } finally {
            if (conflictBlocker) {
                try {
                    await new Promise((resolve) => conflictBlocker.close(() => resolve()));
                } catch {
                    // ignore
                }
            }
            const activeStatusBeforeDisable = await cdp.eval(`window.electronAPI?.automation?.getStatus?.()`);
            const activeAutomationPort =
                Number.isInteger(activeStatusBeforeDisable?.port) && activeStatusBeforeDisable.port > 0
                    ? activeStatusBeforeDisable.port
                    : automationPort;
            await cdp.eval(`(() => {
                const enableWrap = document.querySelector('[data-testid="automation-enable-switch"]');
                const enableSw = enableWrap ? (enableWrap.matches('input[type="checkbox"]') ? enableWrap : enableWrap.querySelector('input[type="checkbox"]')) : null;
                if (enableSw && enableSw.checked) enableSw.click();
            })()`);
            const uiStopped = await waitUntil(
                () =>
                    cdp.eval(`(() => {
                        const enableWrap = document.querySelector('[data-testid="automation-enable-switch"]');
                        const enableSw = enableWrap ? (enableWrap.matches('input[type="checkbox"]') ? enableWrap : enableWrap.querySelector('input[type="checkbox"]')) : null;
                        const badge = document.querySelector('[data-testid="automation-running-badge"]');
                        const badgeText = (badge?.textContent || '').trim();
                        return Boolean(enableSw && !enableSw.checked && !enableSw.disabled && (badgeText === '已停止' || badgeText === 'Stopped'));
                    })()`),
                5000,
            );
            const statusAfterDisable = await cdp.eval(`window.electronAPI?.automation?.getStatus?.()`);
            let portClosed = false;
            try {
                await httpRequest({
                    port: activeAutomationPort,
                    method: 'GET',
                    path: '/json/version',
                    headers: { Host: `127.0.0.1:${activeAutomationPort}` },
                });
            } catch {
                portClosed = true;
            }
            disabledCleanlyOk = Boolean(
                uiStopped &&
                statusAfterDisable &&
                statusAfterDisable.running === false &&
                !statusAfterDisable.enabled &&
                portClosed,
            );
        }

        // ---------------------------------------------------------------
        // E2E-10: Zero uncaught page exceptions
        // ---------------------------------------------------------------
        record(
            'E2E-10',
            '全程无未捕获前端异常',
            pageExceptions.length === 0,
            pageExceptions.length === 0
                ? `0 uncaught exceptions (consoleErrors=${consoleErrors.length})`
                : pageExceptions.join(' | '),
        );

        record(
            'E2E-11',
            '极简本地 CDP 守卫与 MCP 面板（默认端口 18922 / 标准接入命令 / 4 项环境工具 / Origin 403 / 端口冲突一键恢复 / 干净停机）',
            Boolean(
                defaultPortBootOk &&
                    autoTabReady &&
                    autoPanelReady &&
                    portApplied &&
                    serverReady &&
                    standardSnippetsOk &&
                    restStatusOk &&
                    mcpInitOk &&
                    mcpToolsOk &&
                    origin403Ok &&
                    portConflictUiOk &&
                    disabledCleanlyOk,
            ),
            `defaultPort=${defaultPortBootOk}, ui=${Boolean(autoTabReady && autoPanelReady)}, snippets=${standardSnippetsOk}, rest=${restStatusOk}, mcpInit=${mcpInitOk}, mcpTools4=${mcpToolsOk}, 403=${origin403Ok}, portConflictUi=${portConflictUiOk}, stopped=${disabledCleanlyOk}${e2e11Error ? `, err=${e2e11Error}` : ''}`,
        );

        record(
            'E2E-12',
            '真机标准 CDP 透传守卫（私有高端口隔离 / 标准 /json/version 直连 / 拦截 UA·时区·窗口尺寸篡改与无痕 Context / 多环境无缝切号）',
            Boolean(
                realPrivatePortIsolationOk &&
                    realDiscoveryAndPassThroughOk &&
                    realOverrideShieldOk &&
                    realIncognitoBlockOk &&
                    realActiveSwitchAndParallelOk,
            ),
            `privatePort=${realPrivatePortIsolationOk}, passThrough=${realDiscoveryAndPassThroughOk}, overrideShield=${realOverrideShieldOk}, incognitoBlock=${realIncognitoBlockOk}, activeSwitch=${realActiveSwitchAndParallelOk}${e2e12Error ? `, err=${e2e12Error}` : ''}`,
        );
    } finally {
        cdp?.close();
        try {
            electronProc.kill('SIGTERM');
        } catch {
            // ignore
        }
        await sleep(800);
        if (!electronProc.killed) {
            try {
                electronProc.kill('SIGKILL');
            } catch {
                // ignore
            }
        }
        await localServer.close();
        try {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch {
            // ignore on Windows file lock delay
        }
    }

    const failed = results.filter((r) => !r.passed);
    console.log('\n==================================================');
    console.log(`E2E UI Suite Summary: ${results.length - failed.length}/${results.length} passed`);
    if (consoleErrors.length > 0) {
        console.log('Console errors observed:', consoleErrors);
    }
    if (failed.length > 0) {
        console.log('Failed checks:', failed);
        if (electronStderr.trim()) {
            console.log('Electron stderr tail:', electronStderr.slice(-1000));
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('[E2E-UI] Fatal error:', err);
    process.exit(1);
});
