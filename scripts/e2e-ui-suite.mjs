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
import { verifyMcpClients } from './verify-mcp-clients.mjs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import {
    getForegroundWindowPid,
    isNativeWindowFocusAvailable,
} from '../electron/drivers/nativeWindowFocus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const appVersionTag = `v${JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version}`;
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

async function settleUiPaint(cdp) {
    if (await cdp.eval('document.hidden')) await cdp.send('Page.bringToFront');
    await cdp.eval(`(async () => {
        await document.fonts.ready;
        const paint = () => new Promise(resolve => requestAnimationFrame(resolve));
        await paint();
        await paint();
        const transitions = document.getAnimations().filter(animation =>
            animation.playState === 'running' && animation.effect?.getComputedTiming().endTime <= 800);
        await Promise.race([
            Promise.allSettled(transitions.map(animation => animation.finished)),
            new Promise(resolve => setTimeout(resolve, 850)),
        ]);
        await paint();
    })()`);
}

async function captureUiFixture(cdp, name) {
    if (!process.argv.includes('--screenshots')) return;
    await settleUiPaint(cdp);
    const backdrop = await cdp.eval("document.documentElement.dataset.theme === 'dark' ? 48 : 235");
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: backdrop, g: backdrop, b: backdrop, a: 1 },
    });
    try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        const dir = path.join(projectRoot, '.tmp', 'ui-screenshots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
    } finally {
        await cdp.send('Emulation.setDefaultBackgroundColorOverride');
    }
}

async function openViewSubmenu(cdp, label) {
    await cdp.eval(`window.__e2e.clickExact('视图', 'main button')`);
    await waitUntil(() => cdp.eval(`window.__e2e.clickExact(${JSON.stringify(label)}, '[role="menuitem"]')`));
}

async function toggleTimeZoneColumn(cdp) {
    await openViewSubmenu(cdp, '显示列');
    await waitUntil(() => cdp.eval(`window.__e2e.clickExact('时区', '[role="menuitemcheckbox"]')`));
}

async function verifyWorkspacePreferences(cdp, reloadUI) {
    const check = async (expression, label) => {
        if (!await waitUntil(() => cdp.eval(expression))) throw new Error(label);
    };
    const click = (selector) => cdp.eval(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    const star = 'table button[aria-label="星标环境 测试环境Alpha"]';
    const cards = '[aria-label="常用环境卡片"]';
    const hasCards = `Boolean(document.querySelector('${cards} article'))`;
    try {
        await check("document.documentElement.dataset.palette === 'neutral'", '新安装简白');
        const originalMode = await cdp.eval('window.electronAPI.settings.getSettings().then(settings => settings.theme)');
        await click(star);
        await check(hasCards, '星标卡片');
        await click('aside button[title="测试环境Alpha"]');
        await check("Boolean(document.querySelector('[data-details-panel]')) && document.querySelector('main h1').textContent === '常用环境'", '跨分组星标入口');
        await click('[data-details-panel] button[aria-label="关闭详情面板"]');
        await cdp.eval(`window.__e2e.clickExact('视图', 'main button')`);
        await check(`window.__e2e.clickExact('仅列表', '[role="menuitemradio"]')`, '切换列表');
        await reloadUI();
        await check(`!${hasCards} && document.querySelector('${star}')?.getAttribute('aria-pressed') === 'true'`, '重载保留星标与视图');
        await cdp.eval(`window.__e2e.clickExact('视图', 'main button')`);
        await check(`window.__e2e.clickExact('卡片和列表', '[role="menuitemradio"]')`, '切换卡片');
        await check(hasCards, '重显卡片');
        const secondStar = 'table button[aria-label="星标环境 测试环境Beta"]';
        await click(secondStar);
        await check(`document.querySelectorAll('${cards} article').length === 2`, '两张常用卡片');
        const shellColors = new Set();
        for (const palette of ['blue', 'sage', 'neutral']) {
            await click('nav button[aria-label="设置"]');
            const radio = 'input[name="theme-palette"][value="' + palette + '"]';
            await check(`Boolean(document.querySelector('${radio}'))`, '主题预览');
            await click(radio);
            await check(`document.documentElement.dataset.palette === '${palette}'`, '应用 ' + palette);
            shellColors.add(await cdp.eval("getComputedStyle(document.querySelector('main').parentElement.parentElement).backgroundColor"));
            if (palette === 'sage') {
                await cdp.eval(`document.querySelector('${radio}').scrollIntoView({ block: 'center' })`);
                await captureUiFixture(cdp, 'settings-palette');
            }
            await reloadUI();
            await check(`document.documentElement.dataset.palette === '${palette}' && ${hasCards}`, '重载配色 ' + palette);
            for (const mode of ['light', 'dark']) {
                if (await cdp.eval(`document.documentElement.dataset.theme !== '${mode}'`)) {
                    await click('header button[aria-label*="色"]');
                }
                await check(`document.documentElement.dataset.theme === '${mode}' && document.documentElement.dataset.palette === '${palette}'`, palette + ' / ' + mode);
                await captureUiFixture(cdp, 'favorites-' + palette + '-' + mode);
            }
        }
        if (shellColors.size !== 3) throw new Error('三种外壳配色应有区分');
        await click(secondStar);
        await check(`document.querySelectorAll('${cards} article').length === 1`, '列表取消星标');
        await click(cards + ' button[aria-pressed="true"]');
        await check(`!${hasCards} && !document.querySelector('aside button[title="测试环境Alpha"]')`, '取消星标');
        await cdp.eval(`window.electronAPI.settings.getSettings().then(({ dataPath }) =>
            window.electronAPI.settings.saveSettings({ dataPath, theme: ${JSON.stringify(originalMode)} }))`);
        record('UX-09', '常用环境、视图切换与三套配色持久化', true);
    } catch (error) {
        record('UX-09', '常用环境、视图切换与三套配色持久化', false, error.message);
    } finally {
        await reloadUI();
    }
}

async function verifyPageControls(cdp) {
    const issues = [];
    const roles = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'spinbutton', 'combobox', 'tab']);
    const inspect = async (page) => {
        await cdp.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        for (const node of nodes) {
            if (node.ignored || !roles.has(node.role?.value) || node.name?.value?.trim()) continue;
            const { node: dom } = await cdp.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId });
            const attrs = dom.attributes || [];
            const tag = ['data-testid', 'id', 'type'].map((name) => {
                const i = attrs.indexOf(name);
                return i >= 0 ? attrs[i + 1] : '';
            }).filter(Boolean).join(' ');
            issues.push(`${page}: ${node.role.value} ${tag}`);
        }
    };
    const inspectDialog = async (label, modes = []) => {
        await cdp.eval(`window.__e2e.clickExact('${label}', 'main button')`);
        if (!(await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[role="dialog"]'))`)))) {
            issues.push(`${label}: did not open`);
            return;
        }
        await inspect(label);
        for (const mode of modes) {
            await cdp.eval(`window.__e2e.clickExact('${mode}', '[role="dialog"] [role="tab"]')`);
            await inspect(`${label} ${mode}`);
        }
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        if (!(await waitUntil(() => cdp.eval(`!document.querySelector('[role="dialog"]')`)))) {
            issues.push(`${label}: did not close`);
        }
    };
    const navigate = async (label) => {
        await cdp.eval(`document.querySelector('aside button[aria-label^="${label}"]')?.click()`);
        const heading = label === '环境' ? '全部环境' : label;
        return waitUntil(() => cdp.eval(`document.querySelector('main h1')?.textContent?.trim() === '${heading}'`));
    };
    for (const page of ['环境', '代理', '回收站', '设置']) {
        if (!(await navigate(page))) { issues.push(`${page}: navigation`); continue; }
        if (page !== '设置') {
            await inspect(page);
            if (page === '环境') await inspectDialog('新建环境');
            if (page === '代理') {
                await inspectDialog('添加代理', ['手动表单', 'JSON']);
                await inspectDialog('批量导入');
            }
            continue;
        }
        for (const tab of ['general', 'browser', 'privacy', 'automation', 'components', 'about']) {
            await cdp.eval(`document.querySelector('[data-testid="settings-tab-${tab}"]')?.click()`);
            const selected = await waitUntil(() => cdp.eval(`document.querySelector('[data-testid="settings-tab-${tab}"]')?.getAttribute('aria-selected') === 'true'`));
            if (!selected) { issues.push(`${tab}: navigation`); continue; }
            await inspect(tab);
            if (['privacy', 'automation', 'components'].includes(tab)) {
                await cdp.eval(`document.querySelectorAll('#settings-content button[aria-expanded="false"]:not([aria-haspopup])').forEach(button => button.click())`);
                await inspect(`${tab} expanded`);
            }
            if (tab === 'general') await inspectDialog('导出备份');
        }
    }
    await navigate('环境');
    record('UX-06', '所有一级页面与六个设置分类的交互控件均有可访问名称', issues.length === 0, issues.join(' | '));
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
    const visualMeasurements = [];
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
            await settleUiPaint(cdp);
            const measurements = await cdp.eval(`(() => {
                const table = document.querySelector('table[aria-label="环境列表"]');
                const create = [...document.querySelectorAll('main button')].find(button => button.textContent.trim() === '新建环境');
                const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
                const luminance = color => {
                    ctx.fillStyle = color;
                    ctx.fillRect(0, 0, 1, 1);
                    const linear = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(byte => {
                        const v = byte / 255;
                        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                    });
                    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
                };
                const contrast = (text, surface) => {
                    const a = luminance(getComputedStyle(text).color);
                    const b = luminance(getComputedStyle(surface).backgroundColor);
                    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                };
                return {
                    create: contrast(create, create),
                    header: contrast(table.tHead.rows[0].cells[1], table.tHead),
                    unusedHeight: table.parentElement.clientHeight - table.offsetHeight,
                };
            })()`);
            visualMeasurements.push({ theme, ...measurements });
            if (screenshots) {
                const fixtureVisible = await cdp.eval(`(() => {
                    const names = [...document.querySelectorAll('table[aria-label="环境列表"] tbody tr')]
                        .map(row => row.querySelector('td [title]')?.title);
                    return names.length === 2 && names.includes('测试环境Alpha') && names.includes('测试环境Beta')
                        && !document.querySelector('[data-details-panel], [role="dialog"]');
                })()`);
                if (!fixtureVisible) throw new Error('截图时未显示预期的两个测试环境');
                await cdp.eval(`document.querySelector('tr [title="测试环境Alpha"]').closest('tr').click()`);
                await captureUiFixture(cdp, `home-${theme}`);
            }
            if (theme === 'light') {
                await cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: 740, height: 640, deviceScaleFactor: 1, mobile: false,
                });
                try {
                    const fits = await waitUntil(() => cdp.eval(`(() => {
                        const table = document.querySelector('table[aria-label="环境列表"]');
                        const frame = table.parentElement;
                        const header = document.querySelector('main h1').getBoundingClientRect();
                        const search = document.querySelector('input[aria-label="搜索环境"]');
                        const create = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '新建环境');
                        const controls = [search, create, table.tBodies[0].rows[0].querySelector('td:last-child button')];
                        return window.innerWidth === 740 && frame.scrollWidth <= frame.clientWidth + 1
                            && Math.abs(header.left - frame.getBoundingClientRect().left) <= 1
                            && controls.every(el => {
                                const rect = el?.getBoundingClientRect();
                                return rect?.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth;
                            });
                    })()`));
                    record('UX-08', '最小桌面宽度下标题与列表对齐，搜索、新建与行操作完整可见', fits);
                    if (fits) await captureUiFixture(cdp, 'home-compact');
                } finally {
                    await cdp.send('Emulation.clearDeviceMetricsOverride');
                    await waitForPaint();
                }
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
    record('UX-07', '浅深色主按钮和表头文字对比度、短列表收边',
        visualMeasurements.length === 2 && visualMeasurements.every(m => m.create >= 4.5 && m.header >= 4.5 && Math.abs(m.unusedHeight) <= 2),
        JSON.stringify(visualMeasurements));
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

        // Capture Zero-State Onboarding Card verification right at clean 0-env start before E2E-01/02 creates any environment
        const zeroStateOnboardingOk = await cdp.eval(`(() => {
            const text = document.body.innerText || '';
            const hasTitle = text.includes('快速开始') && text.includes('浏览器内核');
            const hasNewBtn = Array.from(document.querySelectorAll('main button')).some(b => (b.innerText || '').trim() === '新建环境');
            const hasInfoTips = document.querySelectorAll('main button[data-infotip="true"]').length >= 1;
            return Boolean(hasTitle && hasNewBtn && hasInfoTips);
        })()`);

        // ---------------------------------------------------------------
        await verifyPageControls(cdp);
        // E2E-01: Verify zero crypto/wallet copy across main UI & Create modal
        // ---------------------------------------------------------------
        await cdp.eval(`window.__e2e.clickExact('新建环境')`);
        await sleep(300);
        const modalText = await cdp.eval(`window.__e2e.bodyText()`);
        const hasCryptoCopy = /钱包地址|大额钱包|交易所/.test(modalText);
        record('UX-01', '创建环境明确显示当前直连路径', modalText.includes('将直接连接网络'));
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
        await verifyWorkspacePreferences(cdp, reloadUI);
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
        const menuKeyboard = await cdp.eval(`(() => {
            const menu = document.querySelector('[role="menu"]');
            if (!menu || !menu.contains(document.activeElement)) return false;
            const keys = Array.from(menu.querySelectorAll('button:enabled'));
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            const lastFocused = document.activeElement === keys.at(-1);
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return lastFocused && document.activeElement?.tagName === 'TR';
        })()`);
        record('UX-05', '右键菜单支持键盘导航并将焦点还给原行', menuKeyboard);
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

        const listedTargets = await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('检测筛选结果 2 项')`));
        await cdp.eval(`document.querySelector('main tbody input[type="checkbox"]')?.click()`);
        const checkedTargets = await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('检测所选 1 项') && window.__e2e.bodyText().includes('将启动 1 项')`));
        if (checkedTargets) await captureUiFixture(cdp, 'proxy-selection');
        await cdp.eval(`document.querySelector('main tbody input[type="checkbox"]')?.click()`);
        record('UX-02', '代理测活按勾选范围显示目标数与待启动数', listedTargets && checkedTargets);

        await cdp.eval(`window.__e2e.clickExact('添加代理', 'main button')`);
        await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[role="dialog"] [role="tablist"]'))`));
        await cdp.eval(`window.__e2e.clickExact('手动表单', '[role="dialog"] [role="tab"]')`);
        await cdp.eval(`(() => {
            const port = document.querySelector('[role="dialog"] input[type="number"]');
            if (port) window.__e2e.setReactValue(port, '19080');
        })()`);
        await cdp.eval(`window.__e2e.clickExact('JSON', '[role="dialog"] [role="tab"]')`);
        await cdp.eval(`window.__e2e.clickExact('手动表单', '[role="dialog"] [role="tab"]')`);
        const modeDraftKept = await cdp.eval(`document.querySelector('[role="dialog"] input[type="number"]')?.value === '19080'`);
        record('UX-03', '代理编辑切换配置方式后保留原输入', modeDraftKept);
        await cdp.eval(`window.__e2e.clickExact('取消', '[role="dialog"] button')`);

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
        await cdp.eval(`document.querySelector('aside button[aria-label="代理"]')?.click()`);
        const settingsGuardShown = await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[role="alertdialog"]'))`));
        if (settingsGuardShown) await captureUiFixture(cdp, 'unsaved-settings');
        await cdp.eval(`window.__e2e.clickExact('继续编辑', '[role="alertdialog"] button')`);
        const keptEditing = await waitUntil(() => cdp.eval(`Boolean(document.querySelector('#app-settings-form')) && !document.querySelector('[role="alertdialog"]')`));
        if (keptEditing) await captureUiFixture(cdp, 'settings-browser');
        await cdp.eval(`document.querySelector('aside button[aria-label="代理"]')?.click()`);
        await waitUntil(() => cdp.eval(`window.__e2e.clickExact('保存并离开', '[role="alertdialog"] button')`));
        const leftAfterSave = await waitUntil(() => cdp.eval(`!document.querySelector('#app-settings-form') && Boolean(document.querySelector('input[aria-label="搜索代理"]'))`));
        record('UX-04', '设置草稿可继续编辑，也可保存并到达原目标', settingsGuardShown && keptEditing && leftAfterSave);
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
        // E2E-09: Real Browser Launch — Bookmark Sync, Env Startup URL Dedup, Live Memory Stats, Zero Layout Shift, Close All
        // ---------------------------------------------------------------
        const captureEnvLayout = () =>
            cdp.eval(`(() => {
                const search = document.querySelector('input[aria-label="搜索环境"]');
                const filter = document.querySelector('[aria-label="按运行状态筛选"]');
                const table = document.querySelector('table[aria-label="环境列表"]');
                if (!search || !filter || !table) return null;
                const searchRect = search.getBoundingClientRect();
                const filterRect = filter.getBoundingClientRect();
                const wrapRect = table.parentElement.getBoundingClientRect();
                const ths = Array.from(table.querySelectorAll('thead th')).map((th) => {
                    const r = th.getBoundingClientRect();
                    return { left: r.left, width: r.width };
                });
                const rows = Array.from(table.querySelectorAll('tbody tr:not([aria-hidden="true"])'));
                const alphaRow = rows.find((r) => (r.innerText || '').includes('测试环境Alpha') && !(r.innerText || '').includes('副本'));
                const rowHeight = alphaRow ? alphaRow.getBoundingClientRect().height : 0;
                return {
                    searchLeft: searchRect.left,
                    searchTop: searchRect.top,
                    filterTop: filterRect.top,
                    tableTop: wrapRect.top,
                    colCount: ths.length,
                    ths,
                    rowHeight,
                };
            })()`);
        const layoutsMatch = (a, b) => {
            if (!a || !b || a.colCount !== b.colCount || a.colCount === 0) return false;
            const near = (x, y) => Math.abs(x - y) <= 1;
            return (
                near(a.searchLeft, b.searchLeft) &&
                near(a.searchTop, b.searchTop) &&
                near(a.filterTop, b.filterTop) &&
                near(a.tableTop, b.tableTop) &&
                near(a.rowHeight, b.rowHeight) &&
                a.ths.every((th, idx) => near(th.left, b.ths[idx].left) && near(th.width, b.ths[idx].width))
            );
        };
        const layoutBeforeLaunch = await captureEnvLayout();

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

        // 2) Verify live memory stats API & UI inline memory + "关闭全部 (1)" button + zero layout shift while running
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
        const layoutWhileRunning = await captureEnvLayout();

        // 3) Verify startup URL opened on first launch
        const hitsAfterFirstLaunch = localServer.getHits();

        // 4) Close envA via UI "关闭全部 (1)" button + confirm dialog + verify zero layout shift after close
        await cdp.eval(`window.__e2e.clickByText('关闭全部 (1)')`);
        await sleep(250);
        await cdp.eval(`window.__e2e.clickByText('确认关闭全部', '[role="dialog"] button')`);
        const closedAllOk = await waitUntil(async () => {
            const list = await cdp.eval(`window.electronAPI.chromeEnvironments.getAll()`);
            return Array.isArray(list) && list.every((e) => !e.isRunning);
        }, 10000, 300);
        await sleep(150);
        const layoutAfterClose = await captureEnvLayout();
        const zeroLayoutShiftOk =
            layoutsMatch(layoutBeforeLaunch, layoutWhileRunning) &&
            layoutsMatch(layoutBeforeLaunch, layoutAfterClose);

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
            '真实 Chrome 启动：书签模板分发 + 实时内存监控 + 启停零跳变 + 一键关闭全部 + 启动页智能去重',
            Boolean(bookmarkSynced && memStats && closeAllBtnVisible && closedAllOk && zeroLayoutShiftOk && dedupOk),
            `bookmark=${bookmarkSynced}, memMB=${memStats ? Math.round(memStats.totalMemoryBytes / 1024 / 1024) : 0}MB, zeroShift=${zeroLayoutShiftOk}, closeAllUI=${Boolean(closeAllBtnVisible && closedAllOk)}, hits1=${hitsAfterFirstLaunch}, delta2=${secondLaunchDelta}`,
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

        // Expand Quick Connect snippets and verify 3 side-by-side tabs (CDP Script / DevTools MCP / Playwright MCP) with HTTP profile management + screenshot-safe token masking
        await cdp.eval(`document.querySelector('[data-testid="automation-snippets-toggle"]')?.click()`);
        const cdpScriptTabOk = Boolean(
            await waitUntil(
                () =>
                    cdp.eval(`(() => {
                        const code = document.querySelector('[data-testid="automation-snippet-code"]')?.textContent || '';
                        const tokDisp = (document.querySelector('[data-testid="automation-token-display"]')?.textContent || '').trim();
                        const tabs = document.querySelectorAll('[data-testid="automation-snippets-card"] [role="tab"]');
                        const addonRow = document.querySelector('[data-testid="automation-page-addon-row"]');
                        return (
                            tabs.length === 3 &&
                            addonRow === null &&
                            tokDisp === '••••••••••••' &&
                            !code.includes('mc_live_') &&
                            code.includes('chromium.connectOverCDP') &&
                            code.includes("const token = '••••••••••••';")
                        );
                    })()`),
                3000,
            ),
        );
        await cdp.eval(`document.querySelector('[data-testid="automation-snippet-tab-devtools-mcp"]')?.click()`);
        const devtoolsTabOk = Boolean(
            await waitUntil(
                () =>
                    cdp.eval(`(() => {
                        const code = document.querySelector('[data-testid="automation-snippet-code"]')?.textContent || '';
                        const parsed = JSON.parse(code);
                        const dtArgs = parsed.mcpServers?.['chrome-devtools']?.args || [];
                        return (
                            !code.includes('mc_live_') &&
                            !code.includes('claude mcp add') &&
                            String(parsed.mcpServers?.multichrome?.url || '').includes('••••••••••••/mcp') &&
                            dtArgs.includes('chrome-devtools-mcp@1.14.0') &&
                            dtArgs.some((a) => String(a).includes('--wsEndpoint=ws://127.0.0.1:') && String(a).includes('••••••••••••/devtools/browser'))
                        );
                    })()`),
                3000,
            ),
        );
        await cdp.eval(`document.querySelector('[data-testid="automation-snippet-tab-playwright-mcp"]')?.click()`);
        const playwrightTabOk = Boolean(
            await waitUntil(
                () =>
                    cdp.eval(`(() => {
                        const code = document.querySelector('[data-testid="automation-snippet-code"]')?.textContent || '';
                        const parsed = JSON.parse(code);
                        const pwArgs = parsed.mcpServers?.playwright?.args || [];
                        return (
                            !code.includes('mc_live_') &&
                            !code.includes('claude mcp add') &&
                            String(parsed.mcpServers?.multichrome?.url || '').includes('••••••••••••/mcp') &&
                            pwArgs.includes('@playwright/mcp@0.0.86') &&
                            pwArgs.some((a) => String(a).includes('••••••••••••/devtools/browser'))
                        );
                    })()`),
                3000,
            ),
        );
        const standardSnippetsOk =
            cdpScriptTabOk && devtoolsTabOk && playwrightTabOk;

        let restStatusOk = false;
        let mcpInitOk = false;
        let mcpToolsOk = false;
        let tokenAuthGuardOk = false;
        let origin403Ok = false;
        let portConflictUiOk = false;
        let disabledCleanlyOk = false;
        let e2e11Error = '';
        let conflictBlocker = null;

        // E2E-12 real-browser CDP Guard + Multi-Window MCP flags
        let realPrivatePortIsolationOk = false;
        let realDiscoveryAndPassThroughOk = false;
        let realOverrideShieldOk = false;
        let realIncognitoBlockOk = false;
        let realActiveSwitchAndParallelOk = false;
        let mcpStdioBridgeOk = false;
        let mcpMultiWindow3ConcurrentOk = false;
        let e2e12Error = '';

        try {
            if (serverReady) {
                // 0) Verify Token UI Show/Hide + Unauthenticated 401 Block + UI Token Reset Invalidating Old Token!
                await cdp.eval(`document.querySelector('[data-testid="automation-toggle-token"]')?.click()`);
                const firstToken = await waitUntil(
                    () =>
                        cdp.eval(`(() => {
                            const txt = (document.querySelector('[data-testid="automation-token-display"]')?.textContent || '').trim();
                            return txt.startsWith('mc_live_') ? txt : '';
                        })()`),
                    3000,
                );
                await cdp.eval(`document.querySelector('[data-testid="automation-toggle-token"]')?.click()`);
                const reMaskedOk = await waitUntil(
                    () =>
                        cdp.eval(`(document.querySelector('[data-testid="automation-token-display"]')?.textContent || '').trim() === '••••••••••••'`),
                    3000,
                );

                // Unauthenticated requests MUST be rejected with 401
                const unauthRest = await httpRequest({
                    port: automationPort,
                    method: 'GET',
                    path: '/api/v1/status',
                    headers: { Host: `127.0.0.1:${automationPort}` },
                });
                const unauthMcp = await httpRequest({
                    port: automationPort,
                    method: 'POST',
                    path: '/mcp',
                    headers: {
                        Host: `127.0.0.1:${automationPort}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
                });
                const unauthCdp = await httpRequest({
                    port: automationPort,
                    method: 'GET',
                    path: '/json/version',
                    headers: { Host: `127.0.0.1:${automationPort}` },
                });

                // Click UI Reset Token button -> old token MUST become 401 and new token becomes active!
                await cdp.eval(`document.querySelector('[data-testid="automation-token-menu"]')?.click()`);
                await waitUntil(() => cdp.eval(`(() => {
                    const item = document.querySelector('[data-testid="automation-rotate-token"]');
                    item?.click();
                    return Boolean(item);
                })()`), 3000);
                await cdp.eval(`document.querySelector('[role="alertdialog"] button:last-child')?.click()`);
                await sleep(250);
                const activeToken = await cdp.eval(`window.electronAPI.automation.getToken()`);
                const oldTokenAfterReset = await httpRequest({
                    port: automationPort,
                    method: 'GET',
                    path: '/api/v1/status',
                    headers: {
                        Host: `127.0.0.1:${automationPort}`,
                        Authorization: `Bearer ${firstToken}`,
                    },
                });
                const pathCapMcpCheck = await httpRequest({
                    port: automationPort,
                    method: 'POST',
                    path: `/t/${activeToken}/mcp`,
                    headers: {
                        Host: `127.0.0.1:${automationPort}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'tools/list', params: {} }),
                });
                tokenAuthGuardOk = Boolean(
                    firstToken &&
                        reMaskedOk &&
                        unauthRest.status === 401 &&
                        unauthMcp.status === 401 &&
                        unauthCdp.status === 401 &&
                        activeToken &&
                        activeToken !== firstToken &&
                        oldTokenAfterReset.status === 401 &&
                        pathCapMcpCheck.status === 200 &&
                        pathCapMcpCheck.json?.result?.tools?.length === 4,
                );

                const authHeader = { Authorization: `Bearer ${activeToken}` };
                const reqHeaders = {
                    Host: `127.0.0.1:${automationPort}`,
                    Authorization: `Bearer ${activeToken}`,
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
                    headers: {
                        Host: `127.0.0.1:${automationPort}`,
                        ...authHeader,
                    },
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
                    await verifyMcpClients({ port: automationPort, token: activeToken, profileId: envA.id,
                        projectRoot, tempRoot, bridgePath: path.join(projectRoot, 'dist/electron/transport/mcpStdioBridge.js') });
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

                    // 2) Standard CDP discovery (/json/version) authenticated via URL capability prefix (/t/<token>/...)
                    const verRes = await httpRequest({
                        port: automationPort,
                        method: 'GET',
                        path: `/t/${activeToken}/json/version`,
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

                    const guardWs = new WebSocket(browserWsUrl, {
                        headers: authHeader,
                    });
                    openGuardSockets.push(guardWs);
                    await new Promise((resolve, reject) => {
                        guardWs.once('open', resolve);
                        guardWs.once('error', reject);
                    });

                    // Also verify headerless URL-prefix WebSocket (`ws://127.0.0.1:<port>/t/<token>/devtools/browser`) for CLI tools (`@playwright/mcp` / `chrome-devtools-mcp`)
                    const pathTokenWs = new WebSocket(
                        `ws://127.0.0.1:${automationPort}/t/${activeToken}/devtools/browser`,
                    );
                    openGuardSockets.push(pathTokenWs);
                    await new Promise((resolve, reject) => {
                        pathTokenWs.once('open', resolve);
                        pathTokenWs.once('error', reject);
                    });
                    const pathTokenVer = await sendGuardCdp(pathTokenWs, {
                        id: 9001,
                        method: 'Browser.getVersion',
                        params: {},
                    });
                    pathTokenWs.close();
                    const pathTokenWsOk = Boolean(pathTokenVer.result?.product);

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
                        pathTokenWsOk &&
                        liveState.otp === '739184';

                    realOverrideShieldOk =
                        Boolean(uaOverrideRes.result) &&
                        Boolean(tzOverrideRes.result) &&
                        Boolean(metricsOverrideRes.result) &&
                        !String(liveState.ua || '').includes('ClobberedBotUA') &&
                        liveState.tz === 'Asia/Tokyo' &&
                        liveState.innerW !== 612 &&
                        liveState.webdriver === false;

                    // 0) Verify real MCP stdio bridge (`scripts/mcp-stdio.mjs`) over NDJSON stdin/stdout
                    const stdioBridgeRes = await new Promise((resolve, reject) => {
                        const bridgeProc = spawn(
                            process.execPath,
                            [path.join(projectRoot, 'scripts', 'mcp-stdio.mjs')],
                            {
                                cwd: projectRoot,
                                env: {
                                    ...process.env,
                                    MULTICHROME_API_URL: `http://127.0.0.1:${automationPort}`,
                                    MULTICHROME_API_TOKEN: activeToken,
                                },
                                stdio: ['pipe', 'pipe', 'pipe'],
                            },
                        );
                        const lines = [];
                        let buf = '';
                        const timer = setTimeout(() => {
                            try { bridgeProc.kill('SIGTERM'); } catch {}
                            reject(new Error('MCP stdio bridge timed out'));
                        }, 10000);
                        bridgeProc.stdout.on('data', (chunk) => {
                            buf += chunk.toString('utf8');
                            let idx;
                            while ((idx = buf.indexOf('\n')) >= 0) {
                                const line = buf.slice(0, idx).trim();
                                buf = buf.slice(idx + 1);
                                if (line) {
                                    try { lines.push(JSON.parse(line)); } catch {}
                                }
                                if (lines.length >= 3) {
                                    clearTimeout(timer);
                                    try { bridgeProc.kill('SIGTERM'); } catch {}
                                    resolve(lines);
                                }
                            }
                        });
                        bridgeProc.once('error', (err) => {
                            clearTimeout(timer);
                            reject(err);
                        });
                        bridgeProc.stdin.write(
                            JSON.stringify({
                                jsonrpc: '2.0',
                                id: 101,
                                method: 'initialize',
                                params: {
                                    protocolVersion: '2025-06-18',
                                    capabilities: {},
                                    clientInfo: { name: 'e2e-stdio', version: '1.0.0' },
                                },
                            }) +
                            '\n' +
                            JSON.stringify({
                                jsonrpc: '2.0',
                                id: 102,
                                method: 'tools/list',
                                params: {},
                            }) +
                            '\n' +
                            JSON.stringify({
                                jsonrpc: '2.0',
                                id: 103,
                                method: 'tools/call',
                                params: { name: 'list_profiles', arguments: {} },
                            }) +
                            '\n',
                        );
                    });
                    mcpStdioBridgeOk =
                        Array.isArray(stdioBridgeRes) &&
                        stdioBridgeRes.length === 3 &&
                        stdioBridgeRes[0]?.result?.serverInfo?.name === 'multichrome-mcp' &&
                        stdioBridgeRes[1]?.result?.tools?.length === 4 &&
                        Array.isArray(stdioBridgeRes[2]?.result?.structuredContent?.profiles);

                    // 3) Launch 2 more profiles concurrently via MCP (`cloned` + `mcpEnvC`) so 3 real windows run at once!
                    const mcpEnvC = await cdp.eval(
                        `window.electronAPI.chromeEnvironments.create('MCP并发窗口Gamma', '测试组B', '', { browserEngine: 'system-chrome' })`,
                    );
                    await cdp.eval(
                        `Promise.all([
                            window.electronAPI.chromeEnvironments.update(${JSON.stringify(cloned.id)}, {
                                timezone: 'America/New_York',
                                startupUrl: ${JSON.stringify(`${baseTestUrl}/rpa-form`)},
                            }),
                            window.electronAPI.chromeEnvironments.update(${JSON.stringify(mcpEnvC.id)}, {
                                timezone: 'Europe/London',
                                startupUrl: ${JSON.stringify(`${baseTestUrl}/flash-sale`)},
                            }),
                        ])`,
                    );

                    const [startedClone, startedGamma] = await Promise.all([
                        callMcpTool('start_profile', {
                            profileId: cloned.id,
                            setActive: false,
                        }),
                        callMcpTool('start_profile', {
                            profileId: mcpEnvC.id,
                            setActive: false,
                        }),
                    ]);

                    const runningViaMcp = await callMcpTool('list_profiles', {
                        status: 'running',
                    });
                    const tileViaIpc = await cdp.eval(
                        `window.electronAPI.chromeEnvironments.tileWindows()`,
                    );

                    // Connect 3 explicit guarded CDP WebSockets concurrently (testing both /t/<token> path capability & Bearer header!)
                    const openExplicitWs = async (wsUrl, usePathToken = false) => {
                        const targetUrl = usePathToken
                            ? wsUrl.replace(
                                  `ws://127.0.0.1:${automationPort}/devtools/`,
                                  `ws://127.0.0.1:${automationPort}/t/${activeToken}/devtools/`,
                              )
                            : wsUrl;
                        const sock = usePathToken
                            ? new WebSocket(targetUrl)
                            : new WebSocket(targetUrl, { headers: authHeader });
                        openGuardSockets.push(sock);
                        await new Promise((resolve, reject) => {
                            sock.once('open', resolve);
                            sock.once('error', reject);
                        });
                        return sock;
                    };
                    const [wsAlpha, wsBeta, wsGamma] = await Promise.all([
                        openExplicitWs(startedA.data.wsEndpoint, true),
                        openExplicitWs(startedClone.data.wsEndpoint, false),
                        openExplicitWs(startedGamma.data.wsEndpoint, true),
                    ]);

                    const inspectLiveWindowViaGuard = async (sock, expectedPath) => {
                        let reqSeq = 500;
                        const tRes = await sendGuardCdp(sock, {
                            id: reqSeq++,
                            method: 'Target.getTargets',
                            params: {},
                        });
                        const pg = (tRes.result?.targetInfos || []).find((t) => t.type === 'page');
                        const winForTarget = await sendGuardCdp(sock, {
                            id: reqSeq++,
                            method: 'Browser.getWindowForTarget',
                            params: { targetId: pg.targetId },
                        });
                        const att = await sendGuardCdp(sock, {
                            id: reqSeq++,
                            method: 'Target.attachToTarget',
                            params: { targetId: pg.targetId, flatten: true },
                        });
                        const sid = att.result.sessionId;
                        await sendGuardCdp(sock, {
                            id: reqSeq++,
                            sessionId: sid,
                            method: 'Page.navigate',
                            params: { url: `${baseTestUrl}${expectedPath}` },
                        });
                        await sleep(450);
                        const ev = await sendGuardCdp(sock, {
                            id: reqSeq++,
                            sessionId: sid,
                            method: 'Runtime.evaluate',
                            params: {
                                expression: `({
                                    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                    path: location.pathname,
                                })`,
                                returnByValue: true,
                            },
                        });
                        return {
                            bounds: winForTarget.result?.bounds || {},
                            evalValue: ev.result?.result?.value || {},
                        };
                    };

                    const [snapAlpha, snapBeta, snapGamma] = await Promise.all([
                        inspectLiveWindowViaGuard(wsAlpha, '/inbox'),
                        inspectLiveWindowViaGuard(wsBeta, '/rpa-form'),
                        inspectLiveWindowViaGuard(wsGamma, '/flash-sale'),
                    ]);
                    const posSet = new Set([
                        `${snapAlpha.bounds.left},${snapAlpha.bounds.top}`,
                        `${snapBeta.bounds.left},${snapBeta.bounds.top}`,
                        `${snapGamma.bounds.left},${snapGamma.bounds.top}`,
                    ]);
                    mcpMultiWindow3ConcurrentOk =
                        runningViaMcp.data?.count === 3 &&
                        tileViaIpc?.tiledCount === 3 &&
                        posSet.size === 3 &&
                        snapAlpha.evalValue.tz === 'Asia/Tokyo' &&
                        snapBeta.evalValue.tz === 'America/New_York' &&
                        snapGamma.evalValue.tz === 'Europe/London';

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
                        headers: {
                            Host: `127.0.0.1:${automationPort}`,
                            ...authHeader,
                        },
                    });
                    realActiveSwitchAndParallelOk =
                        switched.data?.activeProfileId === cloned.id &&
                        verAfterSwitch.json?.webSocketDebuggerUrl?.endsWith(`/${cloned.id}`) &&
                        wsBeta.readyState === WebSocket.OPEN &&
                        wsGamma.readyState === WebSocket.OPEN;

                    await Promise.all([
                        callMcpTool('stop_profile', { profileId: mcpEnvC.id }),
                        callMcpTool('stop_profile', { profileId: cloned.id }),
                        callMcpTool('stop_profile', { profileId: envA.id }),
                    ]);
                    await cdp.eval(`window.electronAPI.chromeEnvironments.delete(${JSON.stringify(mcpEnvC.id)})`).catch(() => {});
                    await cdp.eval(`window.electronAPI.chromeEnvironments.permanentlyDelete(${JSON.stringify(mcpEnvC.id)})`).catch(() => {});
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
        // E2E-13: Pixel geometry & zero-clipping UI audit (Checkboxes / Actions / BatchBar)
        // ---------------------------------------------------------------
        let e2e13Error = '';
        let envCheckboxesUnclipped = false;
        let envActionsUnclipped = false;
        let batchBarGapOk = false;
        let proxyLayoutUnclipped = false;
        try {
            await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])'))`),
            );
            await cdp.eval(`document.querySelector('aside button[title="全部环境"]')?.click()`);
            await sleep(200);

            // Toggle optional "时区" column ON via toolbar Columns popover to test exact 8-column layout
            await toggleTimeZoneColumn(cdp);
            await waitUntil(() =>
                cdp.eval(`Array.from(document.querySelectorAll('table[aria-label="环境列表"] thead th')).some(th => (th.textContent || '').includes('时区'))`),
            );
            // Dismiss Columns popover and select first row checkbox to mount Batch Bar
            await cdp.eval(`document.querySelector('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"]) input[type="checkbox"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('[aria-label="批量操作栏"]'))`),
            );
            await sleep(150);

            const envGeom = await cdp.eval(`(() => {
                const table = document.querySelector('table[aria-label="环境列表"]');
                const wrap = table.parentElement;
                const thBox = table.querySelector('thead th:first-child');
                const tdBox = table.querySelector('tbody tr:not([aria-hidden="true"]) td:first-child');
                const measureCb = (cell) => {
                    const cellRect = cell.getBoundingClientRect();
                    const ind = cell.querySelector('[class*="indicator"]') || cell.querySelector('input[type="checkbox"]');
                    const r = ind.getBoundingClientRect();
                    return {
                        cellLeft: cellRect.left,
                        cellRight: cellRect.right,
                        left: r.left,
                        right: r.right,
                        width: r.width,
                        height: r.height,
                        ok: r.width >= 14 && r.height >= 14 && r.left >= cellRect.left - 0.5 && r.right <= cellRect.right + 0.5,
                    };
                };
                const hdr = measureCb(thBox);
                const rowCb = measureCb(tdBox);

                const row = table.querySelector('tbody tr:not([aria-hidden="true"])');
                const actionTd = row.lastElementChild;
                const tdRect = actionTd.getBoundingClientRect();
                const launchBtn = Array.from(actionTd.querySelectorAll('button')).find(b => (b.innerText || '').includes('启动') || (b.innerText || '').includes('关闭'));
                const menuBtn = actionTd.querySelector('.mc-environment-row-menu');
                const lRect = launchBtn.getBoundingClientRect();
                const mRect = menuBtn.getBoundingClientRect();

                const wrapRect = wrap.getBoundingClientRect();
                const unclippedWithoutScroll =
                    window.outerWidth >= 1260
                        ? mRect.right <= wrapRect.right + 0.5 &&
                          wrap.scrollWidth <= wrap.clientWidth + 1
                        : true;

                wrap.scrollLeft = wrap.scrollWidth;
                const mAfterScroll = menuBtn.getBoundingClientRect();
                wrap.scrollLeft = 0;

                const filterRect = document.querySelector('[aria-label="按运行状态筛选"]').getBoundingClientRect();
                const batchRect = document.querySelector('[aria-label="批量操作栏"]').getBoundingClientRect();
                const batchText = document.querySelector('[aria-label="批量操作栏"]')?.innerText || '';
                const stoppedOnlyBatchOk =
                    batchText.includes('批量启动') &&
                    !batchText.includes('批量关闭');

                return {
                    hdr,
                    rowCb,
                    actionsOk:
                        lRect.left >= tdRect.left - 0.5 &&
                        mRect.right <= tdRect.right + 0.5 &&
                        mRect.width >= 24 &&
                        mAfterScroll.right <= wrapRect.right + 0.5 &&
                        unclippedWithoutScroll,
                    batchGap: batchRect.top - filterRect.bottom,
                    stoppedOnlyBatchOk,
                };
            })()`);

            envCheckboxesUnclipped = Boolean(envGeom?.hdr?.ok && envGeom?.rowCb?.ok);
            envActionsUnclipped = Boolean(envGeom?.actionsOk);
            batchBarGapOk =
                Number(envGeom?.batchGap) >= 4 &&
                Boolean(envGeom?.stoppedOnlyBatchOk);

            // Clear selection & toggle "时区" OFF cleanly
            await cdp.eval(`window.__e2e.clickByText('取消选择', '[aria-label="批量操作栏"] button')`);
            await toggleTimeZoneColumn(cdp);
            await sleep(100);
            await cdp.eval(`document.body.click()`);

            // Audit Proxies table checkbox & action geometry
            await cdp.eval(`document.querySelector('nav button[aria-label="代理"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('table[aria-label="代理列表"] tbody tr:not([aria-hidden="true"])'))`),
            );
            await sleep(150);
            const proxyGeom = await cdp.eval(`(() => {
                const table = document.querySelector('table[aria-label="代理列表"]');
                const measureCb = (cell) => {
                    const cellRect = cell.getBoundingClientRect();
                    const ind = cell.querySelector('[class*="indicator"]') || cell.querySelector('input[type="checkbox"]');
                    const r = ind.getBoundingClientRect();
                    return r.width >= 14 && r.height >= 14 && r.left >= cellRect.left - 0.5 && r.right <= cellRect.right + 0.5;
                };
                const hdrOk = measureCb(table.querySelector('thead th:first-child'));
                const row = table.querySelector('tbody tr:not([aria-hidden="true"])');
                const rowOk = measureCb(row.firstElementChild);
                const actionTd = row.lastElementChild;
                const tdRect = actionTd.getBoundingClientRect();
                const btns = Array.from(actionTd.querySelectorAll('button'));
                const lastBtnRect = btns[btns.length - 1].getBoundingClientRect();
                const firstBtnRect = btns[0].getBoundingClientRect();
                return Boolean(hdrOk && rowOk && firstBtnRect.left >= tdRect.left - 0.5 && lastBtnRect.right <= tdRect.right + 0.5 && lastBtnRect.width >= 24);
            })()`);
            proxyLayoutUnclipped = Boolean(proxyGeom);
        } catch (err13) {
            e2e13Error = err13 instanceof Error ? err13.message : String(err13);
        }

        // ---------------------------------------------------------------
        // E2E-14: Real UI Multi-Window Simultaneous Launch (3 profiles) + Tiling + Cookies + Health Queue
        // ---------------------------------------------------------------
        let e2e14Error = '';
        let uiBulkCreateOk = false;
        let simultaneousLaunch3Ok = false;
        let uiTile3Ok = false;
        let uiTile3SubDetail = '';
        let uiCookieTransferOk = false;
        let simultaneousStop3Ok = false;
        let healthQueueBatchOk = false;
        let backupValidationOk = false;
        let titleBarRunningPillOk = false;
        try {
            await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('table[aria-label="环境列表"]'))`),
            );

            // 1) Create 3 environments via real UI modal
            await cdp.eval(`window.__e2e.clickExact('新建环境', 'main button')`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('[role="dialog"] input[type="number"]'))`),
            );
            await cdp.eval(`(() => {
                const dlg = document.querySelector('[role="dialog"]');
                const qty = dlg.querySelector('input[type="number"]');
                window.__e2e.setReactValue(qty, '3');
            })()`);
            await waitUntil(() =>
                cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('名称前缀')`),
            );
            await cdp.eval(`(() => {
                const dlg = document.querySelector('[role="dialog"]');
                const nameInput = dlg.querySelector('input[placeholder*="美国商店"], input[placeholder*="US Storefront"], input[type="text"]');
                const groupInput = dlg.querySelector('input[placeholder*="选择或输入分组名称"]');
                const engineSel = dlg.querySelector('select');
                if (nameInput) window.__e2e.setReactValue(nameInput, 'MultiWin');
                if (groupInput) window.__e2e.setReactValue(groupInput, 'MultiGroup');
                if (engineSel) {
                    engineSel.value = 'system-chrome';
                    engineSel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            })()`);
            await sleep(100);
            await cdp.eval(`document.querySelector('[role="dialog"] button[type="submit"]')?.click()`);
            uiBulkCreateOk = await waitUntil(() =>
                cdp.eval(`(() => {
                    const txt = window.__e2e.bodyText();
                    return txt.includes('MultiWin 01') && txt.includes('MultiWin 02') && txt.includes('MultiWin 03');
                })()`),
                8000,
            );

            // Filter to MultiGroup in sidebar and check all 3 rows via real checkboxes
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('aside button[title="MultiGroup"]'))`),
            );
            await cdp.eval(`document.querySelector('aside button[title="MultiGroup"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])').length === 3`),
            );
            await cdp.eval(`document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"]) input[type="checkbox"]').forEach(cb => cb.click())`);
            await waitUntil(() =>
                cdp.eval(`(document.querySelector('[aria-label="批量操作栏"]')?.innerText || '').includes('已选 3 项')`),
            );

            // 2) Click real Batch Launch button and verify ALL 3 windows launch simultaneously
            await cdp.eval(`window.__e2e.clickByText('批量启动', '[aria-label="批量操作栏"] button')`);
            simultaneousLaunch3Ok = await waitUntil(
                () =>
                    cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => list.filter(e => e.groupName === 'MultiGroup' && e.isRunning).length === 3)`),
                30000,
                300,
            );

            // 3) Verify Single '窗口布局' Dropdown (no accidental direct tile), Split-Grid Dock + Reset App Window Size, Uniform Stack, Cascade & Pure-CDP Locate Window!
            const singleLayoutDropdownOk = await waitUntil(() =>
                cdp.eval(`(() => {
                    const layoutBtn = document.querySelector('button[aria-label="排列浏览器窗口"]');
                    const legacySplitChevron = document.querySelector('button[aria-label="更多窗口布局"]');
                    return Boolean(layoutBtn && !legacySplitChevron);
                })()`),
                5000,
            );
            let noMisfireOnOpenOk = false;
            let splitAndResetSizeOk = false;
            let stackUniformOk = false;
            let cascadeUniformOk = false;
            let focusLocateOk = false;
            let fallbackZeroRunningResetOk = false;
            let noDupBatchLayoutOk = false;
            let redCloseAllIconOk = false;

            if (singleLayoutDropdownOk) {
                const initialOuterW = await cdp.eval(`window.outerWidth`);

                // Wait for React to re-render the Batch Bar AND clear batchBusy after '批量启动' finishes
                await waitUntil(
                    () => cdp.eval(`(() => {
                        const btn = Array.from(document.querySelectorAll('[aria-label="批量操作栏"] button')).find(b => (b.innerText || '').includes('批量关闭'));
                        return Boolean(btn && !btn.disabled);
                    })()`),
                    5000,
                );
                // Verify ZERO duplicate close buttons:
                // When 3 running rows are selected:
                //   1) Batch bar has red-cross '批量关闭', hides irrelevant '批量启动', and has no '平铺所选'/'堆叠所选'
                //   2) Top header '关闭全部' is HIDDEN so there are never two close buttons on screen
                //   3) TitleBar shows '3 个运行中' pill
                const batchWhileRunningChecks = await cdp.eval(`(() => {
                    const batchText = document.querySelector('[aria-label="批量操作栏"]')?.innerText || '';
                    const noDupLayout = !batchText.includes('平铺所选') && !batchText.includes('堆叠所选');
                    const noIrrelevantLaunch = !batchText.includes('批量启动');
                    const batchStopBtn = Array.from(document.querySelectorAll('[aria-label="批量操作栏"] button')).find(b => (b.innerText || '').includes('批量关闭'));
                    const batchStopSvg = batchStopBtn?.querySelector('svg');
                    const batchStopColor = batchStopSvg ? getComputedStyle(batchStopSvg).color : '';
                    const headerCloseAll = Array.from(document.querySelectorAll('main button')).find(b => (b.innerText || '').includes('关闭全部'));
                    const titleBarRunning = (document.body.innerText || '').includes('3 个运行中');
                    return {
                        noDupLayout,
                        noIrrelevantLaunch,
                        headerHiddenWhenBatchStop: !headerCloseAll,
                        batchStopColor,
                        titleBarRunning,
                    };
                })()`);
                const batchStopRgb = String(batchWhileRunningChecks?.batchStopColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                const batchStopRed = Boolean(
                    batchStopRgb &&
                        Number(batchStopRgb[1]) > Number(batchStopRgb[2]) + 50 &&
                        Number(batchStopRgb[1]) > Number(batchStopRgb[3]) + 50,
                );
                titleBarRunningPillOk = Boolean(batchWhileRunningChecks?.titleBarRunning);

                // Briefly clear selection to verify header '关闭全部 (3)' reappears with red cross icon when 0 rows are selected
                await cdp.eval(`window.__e2e.clickByText('取消选择', '[aria-label="批量操作栏"] button')`);
                await waitUntil(() => cdp.eval(`!document.querySelector('[aria-label="批量操作栏"]')`), 3000);
                await waitUntil(
                    () => cdp.eval(`Array.from(document.querySelectorAll('main button')).some(b => (b.innerText || '').includes('关闭全部'))`),
                    3000,
                );
                const headerCloseAllColor = await cdp.eval(`(() => {
                    const btn = Array.from(document.querySelectorAll('main button')).find(b => (b.innerText || '').includes('关闭全部'));
                    const svg = btn?.querySelector('svg');
                    return svg ? getComputedStyle(svg).color : '';
                })()`);
                const closeAllRgb = String(headerCloseAllColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                const headerCloseAllRed = Boolean(
                    closeAllRgb &&
                        Number(closeAllRgb[1]) > Number(closeAllRgb[2]) + 50 &&
                        Number(closeAllRgb[1]) > Number(closeAllRgb[3]) + 50,
                );
                // Re-select all 3 running rows deterministically
                await cdp.eval(`document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"]) input[type="checkbox"]').forEach(cb => { if (!cb.checked) cb.click(); })`);
                await waitUntil(() =>
                    cdp.eval(`(document.querySelector('[aria-label="批量操作栏"]')?.innerText || '').includes('已选 3 项') && (document.querySelector('[aria-label="批量操作栏"]')?.innerText || '').includes('批量关闭')`),
                    4000,
                );

                noDupBatchLayoutOk = Boolean(
                    batchWhileRunningChecks?.noDupLayout &&
                        batchWhileRunningChecks?.noIrrelevantLaunch &&
                        batchWhileRunningChecks?.headerHiddenWhenBatchStop,
                );
                redCloseAllIconOk = Boolean(batchStopRed && headerCloseAllRed);

                // Clicking '窗口布局' MUST only open the menu without triggering an immediate tile toast!
                await cdp.eval(`document.querySelector('button[aria-label="排列浏览器窗口"]')?.click()`);
                const menuOpened = await waitUntil(
                    () => cdp.eval(`Boolean(document.querySelector('[role="menu"]'))`),
                    3000,
                );
                await sleep(250);
                const prematureToast = await cdp.eval(`(document.querySelector('[role="region"][aria-label*="通知"], [role="region"][aria-label*="Notification"]')?.innerText || '').includes('已宫格排列')`);
                noMisfireOnOpenOk = Boolean(menuOpened && !prematureToast);

                // Click '无缝宫格平铺' inside the open menu
                await cdp.eval(`window.__e2e.clickByText('无缝宫格平铺', '[role="menuitem"]')`);
                const gridToastOk = await waitUntil(() =>
                    cdp.eval(`(document.querySelector('[role="region"][aria-label*="通知"], [role="region"][aria-label*="Notification"]')?.innerText || '').includes('已宫格排列 3 个运行中窗口')`),
                    8000,
                );

                // Open '窗口布局' -> '分屏并排平铺' (docks MultiChrome narrow on left when display workArea >= 1040px) -> then '恢复主窗口大小'
                const canSplitConsole = await cdp.eval(`window.screen.availWidth >= 1040`);
                await cdp.eval(`document.querySelector('button[aria-label="排列浏览器窗口"]')?.click()`);
                await waitUntil(() =>
                    cdp.eval(`window.__e2e.clickByText('分屏并排平铺', '[role="menuitem"]')`),
                    4000,
                );
                const dockedNarrowOk = canSplitConsole
                    ? await waitUntil(() => cdp.eval(`window.outerWidth <= 580`), 5000)
                    : await waitUntil(
                          () =>
                              cdp.eval(
                                  `(document.querySelector('[role="region"][aria-label*="通知"], [role="region"][aria-label*="Notification"]')?.innerText || '').includes('已分屏并排平铺 3 个运行中窗口') && window.outerWidth > 580`,
                              ),
                          5000,
                      );

                await cdp.eval(`document.querySelector('button[aria-label="排列浏览器窗口"]')?.click()`);
                await waitUntil(() =>
                    cdp.eval(`window.__e2e.clickByText('恢复主窗口大小', '[role="menuitem"]')`),
                    4000,
                );
                const restoredWideOk = await waitUntil(
                    () => cdp.eval(`window.outerWidth >= Math.min(1260, ${Number(initialOuterW) || 1260})`),
                    5000,
                );
                // Verify running row's full Actions cell ([关闭][定位][⋯]) is NOT clipped at the right edge after restoring default size!
                const runningRowActionsUnclipped = await waitUntil(() => cdp.eval(`(() => {
                    const table = document.querySelector('table[aria-label="环境列表"]');
                    const wrap = table?.parentElement;
                    const row = Array.from(document.querySelectorAll('table[aria-label="环境列表"] tbody tr')).find(r => (r.innerText || '').includes('MultiWin 02'));
                    if (!wrap || !row) return false;
                    const wrapRect = wrap.getBoundingClientRect();
                    const locateBtn = row.querySelector('button[aria-label="定位窗口 MultiWin 02"]');
                    const menuBtn = row.querySelector('.mc-environment-row-menu');
                    if (!locateBtn || !menuBtn) return false;
                    const locR = locateBtn.getBoundingClientRect();
                    const menR = menuBtn.getBoundingClientRect();
                    return locR.right <= wrapRect.right + 0.5 && menR.right <= wrapRect.right + 0.5;
                })()`), 5000);
                if (!dockedNarrowOk || !restoredWideOk || !runningRowActionsUnclipped) {
                    console.log('[Window layout]', { dockedNarrowOk, restoredWideOk, runningRowActionsUnclipped });
                }
                splitAndResetSizeOk = Boolean(
                    dockedNarrowOk && restoredWideOk && runningRowActionsUnclipped,
                );

                // Open '窗口布局' -> Uniform Stack ('统一尺寸堆叠')
                await cdp.eval(`document.querySelector('button[aria-label="排列浏览器窗口"]')?.click()`);
                await waitUntil(() =>
                    cdp.eval(`window.__e2e.clickByText('统一尺寸堆叠', '[role="menuitem"]')`),
                    4000,
                );
                stackUniformOk = await waitUntil(() =>
                    cdp.eval(`(document.querySelector('[role="region"][aria-label*="通知"], [role="region"][aria-label*="Notification"]')?.innerText || '').includes('已统一尺寸堆叠 3 个运行中窗口')`),
                    8000,
                );

                // Open '窗口布局' -> Cascade ('阶梯错位层叠')
                await cdp.eval(`document.querySelector('button[aria-label="排列浏览器窗口"]')?.click()`);
                await waitUntil(() =>
                    cdp.eval(`window.__e2e.clickByText('阶梯错位层叠', '[role="menuitem"]')`),
                    4000,
                );
                cascadeUniformOk = await waitUntil(() =>
                    cdp.eval(`(document.querySelector('[role="region"][aria-label*="通知"], [role="region"][aria-label*="Notification"]')?.innerText || '').includes('已阶梯层叠 3 个运行中窗口')`),
                    8000,
                );

                // Test highlightOnly mode (must NOT steal OS focus) AND explicit '定位窗口' button (must truly bring target Chrome to OS foreground on Windows!)
                const targetEnv2Id = await cdp.eval(`
                    window.electronAPI.chromeEnvironments.getAll().then(list => {
                        const target = list.find(e => e.name === 'MultiWin 02');
                        return target ? target.id : '';
                    })
                `);
                const fgBeforeLocate =
                    process.platform === 'win32' && isNativeWindowFocusAvailable()
                        ? getForegroundWindowPid()
                        : null;
                const highlightOnlyRes = targetEnv2Id
                    ? await cdp.eval(
                          `window.electronAPI.chromeEnvironments.focusWindow(${JSON.stringify(targetEnv2Id)}, { highlightOnly: true })`,
                      )
                    : false;
                await sleep(180);
                const fgAfterHighlightOnly =
                    process.platform === 'win32' && isNativeWindowFocusAvailable()
                        ? getForegroundWindowPid()
                        : null;
                const highlightOnlyNoStealOk =
                    Boolean(highlightOnlyRes) &&
                    (fgBeforeLocate !== electronProc.pid ||
                        fgAfterHighlightOnly === electronProc.pid);

                const locateBtnClicked = await cdp.eval(`(() => {
                    const btn = document.querySelector('button[aria-label="定位窗口 MultiWin 02"]');
                    if (!btn) return false;
                    btn.click();
                    return true;
                })()`);
                const ipcFocusRes = targetEnv2Id
                    ? await cdp.eval(
                          `window.electronAPI.chromeEnvironments.focusWindow(${JSON.stringify(targetEnv2Id)}, { highlightOnly: false })`,
                      )
                    : false;

                let osForegroundJumpedOk = true;
                if (
                    process.platform === 'win32' &&
                    isNativeWindowFocusAvailable() &&
                    fgBeforeLocate === electronProc.pid
                ) {
                    osForegroundJumpedOk = await waitUntil(async () => {
                        const fgNow = getForegroundWindowPid();
                        return Boolean(
                            fgNow &&
                                fgNow > 0 &&
                                fgNow !== electronProc.pid,
                        );
                    }, 3000, 100);
                    // Wait 250ms while 1.2s highlight overlay is visible to verify showInactive() never steals focus back to Electron!
                    if (osForegroundJumpedOk) {
                        await sleep(250);
                        const fgDuringOverlay = getForegroundWindowPid();
                        osForegroundJumpedOk = Boolean(
                            fgDuringOverlay &&
                                fgDuringOverlay !== electronProc.pid,
                        );
                    }
                }
                focusLocateOk = Boolean(
                    locateBtnClicked &&
                        ipcFocusRes &&
                        highlightOnlyNoStealOk &&
                        osForegroundJumpedOk,
                );

                uiTile3Ok = Boolean(
                    noMisfireOnOpenOk &&
                        noDupBatchLayoutOk &&
                        redCloseAllIconOk &&
                        gridToastOk &&
                        splitAndResetSizeOk &&
                        stackUniformOk &&
                        cascadeUniformOk &&
                        focusLocateOk,
                );
            }

            // 4) Open MultiWin 01 details -> real CookieTransferDialog Import & Export (JSON + Netscape)
            await cdp.eval(`(() => {
                const row = Array.from(document.querySelectorAll('table[aria-label="环境列表"] tbody tr')).find(r => (r.innerText || '').includes('MultiWin 01'));
                row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            })()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('[data-details-panel]'))`),
            );
            await cdp.eval(`(() => {
                const btn = Array.from(document.querySelectorAll('[data-details-panel] button')).find(b => b.innerText.trim() === '导入');
                btn?.click();
            })()`);
            await waitUntil(() =>
                cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('导入 Cookie · MultiWin 01')`),
            );
            await cdp.eval(`(() => {
                const dlg = document.querySelector('[role="dialog"]');
                const ta = dlg.querySelector('textarea');
                if (ta) window.__e2e.setReactValue(ta, JSON.stringify([{ name: 'mc_e2e_session', value: 'ok_160', domain: '127.0.0.1', path: '/' }]));
            })()`);
            await sleep(100);
            await cdp.eval(`window.__e2e.clickExact('导入并写入', '[role="dialog"] button')`);
            await waitUntil(() =>
                cdp.eval(`!document.querySelector('[role="dialog"]')`),
                8000,
            );
            await cdp.eval(`(() => {
                const btn = Array.from(document.querySelectorAll('[data-details-panel] button')).find(b => b.innerText.trim() === '导出');
                btn?.click();
            })()`);
            const exportedJsonOk = await waitUntil(() =>
                cdp.eval(`(() => {
                    const ta = document.querySelector('[role="dialog"] textarea');
                    return Boolean(ta && ta.value.includes('mc_e2e_session') && ta.value.includes('ok_160'));
                })()`),
                8000,
            );
            await cdp.eval(`(() => {
                const sel = document.querySelector('[role="dialog"] select');
                if (sel) {
                    sel.value = 'netscape';
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            })()`);
            const exportedNetscapeOk = await waitUntil(() =>
                cdp.eval(`(() => {
                    const ta = document.querySelector('[role="dialog"] textarea');
                    return Boolean(ta && ta.value.includes('mc_e2e_session\\tok_160'));
                })()`),
                8000,
            );
            uiCookieTransferOk = Boolean(exportedJsonOk && exportedNetscapeOk);
            await cdp.eval(`window.__e2e.clickExact('关闭', '[role="dialog"] button')`);
            await waitUntil(() => cdp.eval(`!document.querySelector('[role="dialog"]')`));
            await cdp.eval(`document.querySelector('[data-details-panel] button[aria-label="关闭详情面板"]')?.click()`);

            // 5) Dock narrow via Split-Grid (on displays >= 1040px) -> Simultaneous Batch Stop -> Verify zero-running fallback '恢复主窗口' restores App Window!
            const canSplitConsoleStep5 = await cdp.eval(`window.screen.availWidth >= 1040`);
            const preStopNormalW = await cdp.eval(`window.outerWidth`);
            await cdp.eval(`document.querySelector('button[aria-label="排列浏览器窗口"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`window.__e2e.clickByText('分屏并排平铺', '[role="menuitem"]')`),
                4000,
            );
            if (canSplitConsoleStep5) {
                await waitUntil(() => cdp.eval(`window.outerWidth <= 580`), 5000);
            } else {
                await sleep(300);
            }

            await cdp.eval(`window.__e2e.clickByText('批量关闭', '[aria-label="批量操作栏"] button')`);
            simultaneousStop3Ok = await waitUntil(
                () =>
                    cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => list.filter(e => e.groupName === 'MultiGroup' && e.isRunning).length === 0)`),
                15000,
            );

            if (canSplitConsoleStep5) {
                const zeroRunningResetBtnVisible = await waitUntil(
                    () => cdp.eval(`Boolean(document.querySelector('button[aria-label="恢复主窗口"]'))`),
                    5000,
                );
                if (zeroRunningResetBtnVisible) {
                    await cdp.eval(`document.querySelector('button[aria-label="恢复主窗口"]')?.click()`);
                    const restoredFromZeroRunning = await waitUntil(
                        () => cdp.eval(`window.outerWidth >= Math.min(980, ${Number(preStopNormalW) || 1000})`),
                        5000,
                    );
                    const resetBtnCleared = await waitUntil(
                        () => cdp.eval(`!document.querySelector('button[aria-label="恢复主窗口"]')`),
                        3000,
                    );
                    fallbackZeroRunningResetOk = Boolean(restoredFromZeroRunning && resetBtnCleared);
                }
            } else {
                fallbackZeroRunningResetOk = await waitUntil(
                    () => cdp.eval(`window.outerWidth >= Math.min(980, ${Number(preStopNormalW) || 1000})`),
                    5000,
                );
            }
            uiTile3Ok = Boolean(uiTile3Ok && fallbackZeroRunningResetOk);
            uiTile3SubDetail = `(noMisfire=${noMisfireOnOpenOk},noDupBatch=${noDupBatchLayoutOk},redClose=${redCloseAllIconOk},splitReset=${splitAndResetSizeOk},zeroReset=${fallbackZeroRunningResetOk},stack=${stackUniformOk},cascade=${cascadeUniformOk},focus=${focusLocateOk})`;

            // 6) Enable Pre-Launch Check in Settings -> verify ALL 3 pre-checks are visible simultaneously in Batch Health Dialog & "启动全部（3）" launches & auto-tiles all 3 windows!
            await cdp.eval(`document.querySelector('nav button[aria-label="设置"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('[data-testid="settings-tab-privacy"]'))`),
            );
            await cdp.eval(`document.querySelector('[data-testid="settings-tab-privacy"]').click()`);
            const toggleHealthSetting = async (expectedState) => {
                const desired = Boolean(expectedState);
                await waitUntil(() =>
                    cdp.eval(`Array.from(document.querySelectorAll('span')).some(s => (s.textContent || '').trim() === '启动前安全检查')`),
                );
                await cdp.eval(`(() => {
                    const lbl = Array.from(document.querySelectorAll('span')).find(s => (s.textContent || '').trim() === '启动前安全检查');
                    const row = lbl?.closest('div');
                    const sw = row?.querySelector('input[type="checkbox"]');
                    if (sw && Boolean(sw.checked) !== ${desired}) {
                        sw.click();
                    }
                })()`);
                await sleep(150);
                const btnDirty = await waitUntil(() =>
                    cdp.eval(`(document.querySelector('main button[type="submit"]')?.innerText || '').includes('保存设置')`),
                    3000,
                );
                if (btnDirty) {
                    await cdp.eval(`window.__e2e.clickExact('保存设置', 'main button')`);
                    await waitUntil(() =>
                        cdp.eval(`(document.querySelector('main button[type="submit"]')?.innerText || '').includes('已保存')`),
                        5000,
                    );
                }
                const savedSetting = await cdp.eval(`window.electronAPI.settings.getSettings().then(s => Boolean(s.requireHealthCheckOnLaunch))`);
                if (savedSetting !== desired) {
                    throw new Error(`Failed to persist requireHealthCheckOnLaunch=${desired}, got ${savedSetting}`);
                }
            };
            await toggleHealthSetting(true);

            await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('aside button[title="MultiGroup"]'))`),
            );
            await cdp.eval(`document.querySelector('aside button[title="MultiGroup"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])').length === 3`),
            );
            // Select ALL 3 rows via header select-all checkbox
            await cdp.eval(`document.querySelector('table[aria-label="环境列表"] thead input[type="checkbox"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`(document.querySelector('[aria-label="批量操作栏"]')?.innerText || '').includes('已选 3 项')`),
                5000,
            );
            await cdp.eval(`window.__e2e.clickByText('批量启动', '[aria-label="批量操作栏"] button')`);
            const healthAllBtnReady = await waitUntil(() =>
                cdp.eval(`Boolean(Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => !b.disabled && (b.innerText || '').includes('启动全部（3）')))`),
                12000,
            );
            const all3PrechecksVisible = await cdp.eval(`(() => {
                const rows = Array.from(document.querySelectorAll('[role="dialog"] [data-testid="batch-health-row"]'));
                const text = rows.map((r) => r.innerText || '').join(' | ');
                if (
                    rows.length !== 3 ||
                    !text.includes('MultiWin 01') ||
                    !text.includes('MultiWin 02') ||
                    !text.includes('MultiWin 03')
                ) {
                    return false;
                }
                const row2 = rows.find((r) => (r.innerText || '').includes('MultiWin 02'));
                row2?.click();
                return true;
            })()`);
            const detailSwitchedOk = await waitUntil(() =>
                cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('检测明细 · MultiWin 02')`),
                3000,
            );
            if (healthAllBtnReady && all3PrechecksVisible && detailSwitchedOk) {
                await cdp.eval(`window.__e2e.clickByText('启动全部（3）', '[role="dialog"] button')`);
                healthQueueBatchOk = await waitUntil(
                    () =>
                        cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => list.filter(e => e.groupName === 'MultiGroup' && e.isRunning).length === 3)`),
                    25000,
                    300,
                );
            }

            // Cleanup settings toggle, close running windows, and batch-delete MultiGroup items via UI
            await cdp.eval(`document.querySelector('nav button[aria-label="设置"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('[data-testid="settings-tab-privacy"]'))`),
            );
            await cdp.eval(`document.querySelector('[data-testid="settings-tab-privacy"]').click()`);
            await toggleHealthSetting(false);

            await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`Boolean(document.querySelector('table[aria-label="环境列表"] thead input[type="checkbox"]'))`),
            );
            await cdp.eval(`window.electronAPI.chromeEnvironments.closeAll()`).catch(() => {});
            await waitUntil(() =>
                cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => list.filter(e => e.groupName === 'MultiGroup' && e.isRunning).length === 0)`),
                12000,
            );
            await cdp.eval(`document.querySelector('table[aria-label="环境列表"] thead input[type="checkbox"]')?.click()`);
            await waitUntil(() =>
                cdp.eval(`(document.querySelector('[aria-label="批量操作栏"]')?.innerText || '').includes('已选 3 项')`),
                5000,
            );
            await cdp.eval(`window.__e2e.clickByText('移入回收站', '[aria-label="批量操作栏"] button')`);
            await waitUntil(() =>
                cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => list.filter(e => e.groupName === 'MultiGroup').length === 0)`),
                8000,
            );

            backupValidationOk = await cdp.eval(`(async () => {
                try {
                    await window.electronAPI.app.exportBackup('short');
                    return false;
                } catch (err) {
                    const msg = err && err.message ? err.message : String(err);
                    return msg.includes('8');
                }
            })()`);
        } catch (err14) {
            e2e14Error = err14 instanceof Error ? err14.message : String(err14);
        } finally {
            await cdp.eval(`window.electronAPI.chromeEnvironments.closeAll()`).catch(() => {});
            await cdp.eval(`window.electronAPI.chromeEnvironments.tileWindows({ mode: 'reset-app-window' })`).catch(() => {});
        }

            // ---------------------------------------------------------------
            // E2E-15: Full App Shell Chrome (Zero-State Onboarding / TitleBar / Sidebar Collapse / StatusBar / AppLogs / ProxyLogs / InfoTip)
            // ---------------------------------------------------------------
            let e2e15Error = '';
            let sidebarCollapseOk = false;
            let statusBarMetaOk = false;
            let appLogsDialogOk = false;
            let proxyLogDockControlsOk = false;
            let infoTipPopoverOk = false;
            try {
                await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
                await waitUntil(() =>
                    cdp.eval(`Boolean(document.querySelector('aside[aria-label="主导航"]'))`),
                );
                await cdp.eval(`document.querySelector('aside button[title="全部环境"]')?.click()`);
                await sleep(150);

                // 1) Sidebar collapse & expand toggle
                const expandedAsideW = await cdp.eval(`document.querySelector('aside[aria-label="主导航"]').getBoundingClientRect().width`);
                await cdp.eval(`document.querySelector('button[aria-label="收起导航栏"]')?.click()`);
                const collapsedOk = await waitUntil(
                    () => cdp.eval(`document.querySelector('aside[aria-label="主导航"]').getBoundingClientRect().width < ${Math.round(expandedAsideW) - 60}`),
                    3000,
                );
                await cdp.eval(`document.querySelector('button[aria-label="展开导航栏"]')?.click()`);
                const reExpandedOk = await waitUntil(
                    () => cdp.eval(`document.querySelector('aside[aria-label="主导航"]').getBoundingClientRect().width >= ${Math.round(expandedAsideW) - 10}`),
                    3000,
                );
                sidebarCollapseOk = Boolean(collapsedOk && reExpandedOk);

                // 2) StatusBar metadata (selection label, sing-box version, app version, TitleBar brand icon SVG)
                statusBarMetaOk = await cdp.eval(`(() => {
                    const footer = document.querySelector('footer[aria-label="状态栏"]');
                    const ft = footer?.innerText || '';
                    const hasBrandSvg = Boolean(document.querySelector('header svg, [role="banner"] svg, svg'));
                    return Boolean(
                        footer &&
                            ft.includes('代理日志') &&
                            ft.includes('后台日志') &&
                            ft.includes(${JSON.stringify(appVersionTag)}) &&
                            hasBrandSvg,
                    );
                })()`);

                // 3) ApplicationLogsPanel: open, search, level select, pause/resume, refresh, follow latest, close
                await cdp.eval(`window.__e2e.clickByText('后台日志', 'footer button')`);
                const appLogsOpened = await waitUntil(
                    () => cdp.eval(`Boolean(document.querySelector('[data-application-logs]'))`),
                    4000,
                );
                if (appLogsOpened) {
                    await cdp.eval(`(() => {
                        const dlg = document.querySelector('[data-application-logs]');
                        const input = dlg?.querySelector('input[aria-label="搜索后台日志"]');
                        if (input) window.__e2e.setReactValue(input, 'Application');
                        const sel = dlg?.querySelector('select[aria-label="后台日志级别"]');
                        if (sel) {
                            sel.value = 'info';
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    })()`);
                    await cdp.eval(`window.__e2e.clickByText('暂停刷新', '[data-application-logs] button')`);
                    const pausedLabelOk = await waitUntil(
                        () => cdp.eval(`(document.querySelector('[data-application-logs]')?.innerText || '').includes('继续刷新')`),
                        2000,
                    );
                    await cdp.eval(`window.__e2e.clickByText('继续刷新', '[data-application-logs] button')`);
                    await cdp.eval(`window.__e2e.clickByText('刷新', '[data-application-logs] button')`);
                    await cdp.eval(`window.__e2e.clickByText('跟随最新', '[data-application-logs] button')`);
                    await cdp.eval(`document.querySelector('[data-application-logs] button[aria-label="关闭后台日志"]')?.click()`);
                    const appLogsClosed = await waitUntil(
                        () => cdp.eval(`!document.querySelector('[data-application-logs]')`),
                        3000,
                    );
                    appLogsDialogOk = Boolean(pausedLabelOk && appLogsClosed);
                }

                // 4) LogDockPanel (Proxy Logs): open, search, clear, close
                await cdp.eval(`window.__e2e.clickByText('代理日志', 'footer button')`);
                const proxyDockOpen = await waitUntil(
                    () => cdp.eval(`Boolean(document.querySelector('#proxy-log-dock'))`),
                    3000,
                );
                if (proxyDockOpen) {
                    await cdp.eval(`(() => {
                        const input = document.querySelector('#proxy-log-dock input');
                        if (input) window.__e2e.setReactValue(input, 'sing-box');
                    })()`);
                    await sleep(100);
                    await cdp.eval(`window.__e2e.clickByText('代理日志', 'footer button')`);
                    const proxyDockClosed = await waitUntil(
                        () => cdp.eval(`!document.querySelector('#proxy-log-dock')`),
                        3000,
                    );
                    proxyLogDockControlsOk = Boolean(proxyDockOpen && proxyDockClosed);
                }

                // 5) InfoTip interactive hover/focus verification inside Settings
                await cdp.eval(`document.querySelector('nav button[aria-label="设置"]')?.click()`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[data-testid="settings-tab-general"]'))`));
                infoTipPopoverOk = await cdp.eval(`(() => {
                    const tipBtn = document.querySelector('main button[data-infotip="true"]');
                    if (!tipBtn) return false;
                    tipBtn.focus();
                    tipBtn.click();
                    return true;
                })()`);
            } catch (err15) {
                e2e15Error = err15 instanceof Error ? err15.message : String(err15);
            }

            // ---------------------------------------------------------------
            // E2E-16: Environments Full Controls (Search + Empty Reset, Sort, TagEditor + Tag Filter AND/OR, Details Save, Batch Move/Proxy, Single Delete Confirm)
            // ---------------------------------------------------------------
            let e2e16Error = '';
            let envSearchAndResetOk = false;
            let envSortMenuOk = false;
            let envDetailsTagSaveOk = false;
            let envTagFilterAndOrOk = false;
            let envBatchMoveAndProxyOk = false;
            let envSingleDeleteConfirmOk = false;
            try {
                await cdp.eval(`document.querySelector('nav button[aria-label="环境"]')?.click()`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('aside button[title="全部环境"]'))`));
                await cdp.eval(`document.querySelector('aside button[title="全部环境"]')?.click()`);
                await waitUntil(() =>
                    cdp.eval(`document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])').length >= 2`),
                );

                // 1) Search filter -> empty state -> '清空筛选条件'
                await cdp.eval(`(() => {
                    const input = document.querySelector('input[placeholder*="搜索环境"]');
                    if (input) window.__e2e.setReactValue(input, 'NO_SUCH_ENV_ZZZ_999');
                })()`);
                const emptyFilterShown = await waitUntil(
                    () => cdp.eval(`window.__e2e.bodyText().includes('未找到匹配的环境')`),
                    3000,
                );
                await cdp.eval(`window.__e2e.clickExact('清空筛选条件', 'main button')`);
                const restoredRowsAfterReset = await waitUntil(
                    () => cdp.eval(`document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])').length >= 2`),
                    3000,
                );
                envSearchAndResetOk = Boolean(emptyFilterShown && restoredRowsAfterReset);

                // 2) Sort menu (名称 / 创建时间 / 最近使用)
                await openViewSubmenu(cdp, '排序方式');
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('名称', '[role="menuitem"]')`), 3000);
                await openViewSubmenu(cdp, '排序方式');
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('创建时间', '[role="menuitem"]')`), 3000);
                await openViewSubmenu(cdp, '排序方式');
                const sortRestored = await waitUntil(
                    () => cdp.eval(`window.__e2e.clickByText('最近使用', '[role="menuitem"]')`),
                    3000,
                );
                envSortMenuOk = Boolean(sortRestored);

                // 3) Details Panel: TagEditor add #vip & #us + Notes edit + '保存更改'
                await cdp.eval(`(() => {
                    const row = Array.from(document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])')).find(r => (r.innerText || '').includes('测试环境Beta'));
                    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                })()`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[data-details-panel]'))`), 4000);
                await cdp.eval(`(() => {
                    const panel = document.querySelector('[data-details-panel]');
                    const tagInput = panel?.querySelector('input[placeholder*="标签"], input[placeholder*="tag"]');
                    if (tagInput) {
                        window.__e2e.setReactValue(tagInput, 'vip, us,');
                    }
                    const notesTa = panel?.querySelector('textarea');
                    if (notesTa) window.__e2e.setReactValue(notesTa, 'E2E-16 details saved note');
                })()`);
                await waitUntil(
                    () => cdp.eval(`(document.querySelector('[data-details-panel]')?.innerText || '').includes('#vip') && (document.querySelector('[data-details-panel]')?.innerText || '').includes('保存更改')`),
                    3000,
                );
                const refreshId = await cdp.eval(`(async () => {
                    const api = window.electronAPI.chromeEnvironments;
                    const env = await api.create('Draft refresh fixture', 'Draft fixture', '', { browserEngine: 'system-chrome', startupUrl: 'about:blank' });
                    await api.launch(env.id);
                    return env.id;
                })()`);
                const refreshedWithDraft = await waitUntil(() => cdp.eval(`Boolean(
                    Array.from(document.querySelectorAll('tr[data-virtual-id]')).some(row => row.innerText.includes('Draft refresh fixture')) &&
                    document.querySelector('[data-details-panel] textarea')?.value === 'E2E-16 details saved note'
                )`), 5000);
                await cdp.eval(`window.electronAPI.chromeEnvironments.close(${JSON.stringify(refreshId)})`);
                await cdp.eval(`window.__e2e.clickExact('保存更改', '[data-details-panel] button')`);
                envDetailsTagSaveOk = refreshedWithDraft && await waitUntil(
                    () => cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => {
                        const beta = list.find(e => e.name === '测试环境Beta');
                        return Boolean(beta && Array.isArray(beta.tags) && beta.tags.includes('vip') && beta.tags.includes('us') && beta.notes === 'E2E-16 details saved note');
                    })`),
                    5000,
                );
                await cdp.eval(`document.querySelector('[data-details-panel] button[aria-label="关闭详情面板"]')?.click()`);
                await waitUntil(() => cdp.eval(`!document.querySelector('[data-details-panel]')`), 3000);

                // 4) Tag Filter Popover ('标签') + AND/OR toggle + clear
                const tagBtnFound = await waitUntil(
                    () => cdp.eval(`window.__e2e.clickByText('标签', 'main button')`),
                    3000,
                );
                if (tagBtnFound) {
                    await waitUntil(() => cdp.eval(`window.__e2e.clickByText('#vip', 'button')`), 3000);
                    const activeBarVisible = await waitUntil(
                        () => cdp.eval(`Boolean(document.querySelector('[aria-label="已启用标签筛选"]'))`),
                        3000,
                    );
                    await cdp.eval(`window.__e2e.clickByText('同时包含 (AND)', '[aria-label="已启用标签筛选"] button')`);
                    const switchedToOr = await waitUntil(
                        () => cdp.eval(`(document.querySelector('[aria-label="已启用标签筛选"]')?.innerText || '').includes('包含任一 (OR)')`),
                        3000,
                    );
                    await cdp.eval(`window.__e2e.clickExact('清空', '[aria-label="已启用标签筛选"] button')`);
                    const tagBarCleared = await waitUntil(
                        () => cdp.eval(`!document.querySelector('[aria-label="已启用标签筛选"]')`),
                        3000,
                    );
                    envTagFilterAndOrOk = Boolean(activeBarVisible && switchedToOr && tagBarCleared);
                }

                // 5) Batch Move Group & Assign Proxy via Batch Bar menus
                await cdp.eval(`(() => {
                    const rows = Array.from(document.querySelectorAll('table[aria-label="环境列表"] tbody tr:not([aria-hidden="true"])'));
                    const beta = rows.find(r => (r.innerText || '').includes('测试环境Beta'));
                    beta?.querySelector('input[type="checkbox"]')?.click();
                })()`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[aria-label="批量操作栏"]'))`), 3000);
                await cdp.eval(`window.__e2e.clickByText('切换代理', '[aria-label="批量操作栏"] button')`);
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('全局默认', '[role="menuitem"]')`), 3000);
                await sleep(200);
                await cdp.eval(`window.__e2e.clickByText('取消选择', '[aria-label="批量操作栏"] button')`);
                envBatchMoveAndProxyOk = true;

                // 6) Single-row Delete Confirm Dialog ('移入回收站') on a cloned/disposable profile
                const disposableEnv = await cdp.eval(`
                    window.electronAPI.chromeEnvironments.create('E2E_Trash_Target', '测试组重命名', 'for trash test', { browserEngine: 'system-chrome' })
                `);
                await reloadUI();
                await cdp.eval(`document.querySelector('aside button[title="全部环境"]')?.click()`);
                await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('E2E_Trash_Target')`), 4000);
                await cdp.eval(`document.querySelector('button[aria-label="更多操作 E2E_Trash_Target"]')?.click()`);
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('移入回收站', '[role="menuitem"]')`), 3000);
                const deleteDialogShown = await waitUntil(
                    () => cdp.eval(`Boolean(document.querySelector('[role="dialog"]')) && (document.querySelector('[role="dialog"]')?.innerText || '').includes('E2E_Trash_Target')`),
                    3000,
                );
                if (deleteDialogShown) {
                    await cdp.eval(`window.__e2e.clickByText('移入回收站', '[role="dialog"] button')`);
                    envSingleDeleteConfirmOk = await waitUntil(
                        () => cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => !list.some(e => e.id === ${JSON.stringify(disposableEnv.id)}))`),
                        5000,
                    );
                }
            } catch (err16) {
                e2e16Error = err16 instanceof Error ? err16.message : String(err16);
            }

            // ---------------------------------------------------------------
            // E2E-17: Trash Page Full Lifecycle (TrashPage.tsx: List, Restore, Delete Forever Confirm, Clean Up Expired Confirm)
            // ---------------------------------------------------------------
            let e2e17Error = '';
            let trashListRenderedOk = false;
            let trashRestoreOk = false;
            let trashPermDeleteOk = false;
            let trashCleanupDialogOk = false;
            try {
                await cdp.eval(`document.querySelector('nav button[aria-label="回收站"]')?.click()`);
                trashListRenderedOk = await waitUntil(
                    () => cdp.eval(`window.__e2e.bodyText().includes('MultiWin 01') && window.__e2e.bodyText().includes('E2E_Trash_Target')`),
                    5000,
                );

                // 1) Restore 'E2E_Trash_Target'
                await cdp.eval(`(() => {
                    const row = Array.from(document.querySelectorAll('main table tbody tr')).find(r => (r.innerText || '').includes('E2E_Trash_Target'));
                    const btn = Array.from(row?.querySelectorAll('button') || []).find(b => (b.innerText || '').includes('恢复'));
                    btn?.click();
                })()`);
                trashRestoreOk = await waitUntil(
                    () => cdp.eval(`window.electronAPI.chromeEnvironments.getAll().then(list => list.some(e => e.name === 'E2E_Trash_Target'))`),
                    5000,
                );
                // Wait for TrashPage's loadDeleted() + setBusyId(null) cycle to complete before clicking permanent delete
                await waitUntil(
                    () => cdp.eval(`!Array.from(document.querySelectorAll('main tbody tr')).some(row => row.innerText.includes('E2E_Trash_Target')) && Array.from(document.querySelectorAll('main button')).some(b => (b.innerText || '').includes('清理过期') && !b.disabled)`),
                    5000,
                );

                // 2) Permanently delete 'MultiWin 01' via confirmation dialog
                await cdp.eval(`(() => {
                    const row = Array.from(document.querySelectorAll('main table tbody tr')).find(r => (r.innerText || '').includes('MultiWin 01'));
                    const btn = Array.from(row?.querySelectorAll('button') || []).find(b => (b.innerText || '').includes('永久删除'));
                    btn?.click();
                })()`);
                const permDlgShown = await waitUntil(
                    () => cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('永久删除环境')`),
                    3000,
                );
                if (permDlgShown) {
                    await cdp.eval(`window.__e2e.clickExact('确认永久删除', '[role="dialog"] button')`);
                    trashPermDeleteOk = await waitUntil(
                        () => cdp.eval(`(async () => {
                            if (document.querySelector('[role="dialog"]') || Array.from(document.querySelectorAll('main tbody tr')).some(row => row.innerText.includes('MultiWin 01'))) return false;
                            const deleted = await window.electronAPI.trash.getDeletedEnvironments();
                            return !deleted.some(env => env.name === 'MultiWin 01');
                        })()`),
                        5000,
                    );
                }

                // 3) Clean Up Expired dialog open & cancel (wait until busyId clears after permanent delete)
                await waitUntil(
                    () => cdp.eval(`Array.from(document.querySelectorAll('main button')).some(b => (b.innerText || '').includes('清理过期') && !b.disabled)`),
                    5000,
                );
                const cleanupBtnClicked = await cdp.eval(`window.__e2e.clickByText('清理过期', 'main button')`);
                if (cleanupBtnClicked) {
                    const cleanupDlgShown = await waitUntil(
                        () => cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('清理过期环境')`),
                        3000,
                    );
                    if (cleanupDlgShown) {
                        await cdp.eval(`window.__e2e.clickExact('取消', '[role="dialog"] button')`);
                        await waitUntil(() => cdp.eval(`!document.querySelector('[role="dialog"]')`), 3000);
                        trashCleanupDialogOk = true;
                    }
                }
            } catch (err17) {
                e2e17Error = err17 instanceof Error ? err17.message : String(err17);
            }

            // ---------------------------------------------------------------
            // E2E-18: Proxies Full UI Suite (ProxyEditorDrawer 3 modes + Rotation URL, Search/Filter/Sort, ProxyDetailsPanel, ProxyConfigDrawer Redact/Reveal, Edit, Batch Delete)
            // ---------------------------------------------------------------
            let e2e18Error = '';
            let proxyEditorCreateOk = false;
            let proxySearchFilterSortOk = false;
            let proxyDetailsAndRotationBtnOk = false;
            let proxyConfigRedactRevealOk = false;
            let proxyEditAndBatchDeleteOk = false;
            try {
                await cdp.eval(`document.querySelector('nav button[aria-label="代理"]')?.click()`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('table[aria-label="代理列表"]'))`), 5000);

                // 1) Open '添加代理' drawer -> test all 3 tabs -> create Simple HTTP proxy with Rotation URL
                await cdp.eval(`window.__e2e.clickExact('添加代理', 'main button')`);
                await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('配置方式')`), 4000);
                await cdp.eval(`window.__e2e.clickExact('JSON', '[role="tab"]')`);
                await sleep(100);
                await cdp.eval(`window.__e2e.clickExact('手动表单', '[role="tab"]')`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('input[placeholder*="proxy.example.com"]'))`), 3000);
                await cdp.eval(`(() => {
                    const nameIn = document.querySelector('input[placeholder*="美国住宅"], input[placeholder*="US Residential"]');
                    const hostIn = document.querySelector('input[placeholder*="proxy.example.com"]');
                    const portIn = document.querySelector('input[placeholder="8080"]');
                    const passIn = document.querySelector('input[type="password"]');
                    const rotIn = document.querySelector('input[type="url"]');
                    const userLabel = Array.from(document.querySelectorAll('label')).find(l => (l.textContent || '').includes('用户名'));
                    const userIn = userLabel?.htmlFor ? document.getElementById(userLabel.htmlFor) : null;
                    if (nameIn) window.__e2e.setReactValue(nameIn, 'UI_Full_Proxy');
                    if (hostIn) window.__e2e.setReactValue(hostIn, '203.0.113.55');
                    if (portIn) window.__e2e.setReactValue(portIn, '18080');
                    if (userIn) window.__e2e.setReactValue(userIn, 'u_test');
                    if (passIn) window.__e2e.setReactValue(passIn, 'proxy_secret_pw_88');
                    if (rotIn) window.__e2e.setReactValue(rotIn, 'https://api.provider.example/rotate?k=test');
                })()`);
                await sleep(120);
                await cdp.eval(`window.__e2e.clickExact('校验并保存', 'button')`);
                proxyEditorCreateOk = await waitUntil(
                    () => cdp.eval(`window.__e2e.bodyText().includes('UI_Full_Proxy')`),
                    8000,
                );

                // 2) Search, Status Filter & Sort on Proxies page
                await cdp.eval(`(() => {
                    const s = document.querySelector('input[placeholder*="搜索代理"]');
                    if (s) window.__e2e.setReactValue(s, 'UI_Full_Proxy');
                })()`);
                const filteredTo1 = await waitUntil(
                    () => cdp.eval(`document.querySelectorAll('table[aria-label="代理列表"] tbody tr:not([aria-hidden="true"])').length === 1`),
                    3000,
                );
                await cdp.eval(`document.querySelector('button[aria-label="清空搜索"]')?.click()`);
                await cdp.eval(`document.querySelector('button[aria-label="代理排序方式"]')?.click()`);
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('添加顺序', '[role="menuitem"]')`), 3000);
                proxySearchFilterSortOk = Boolean(filteredTo1);

                // 3) Click 'UI_Full_Proxy' row -> verify ProxyDetailsPanel + '换 IP' button
                await cdp.eval(`(() => {
                    const row = Array.from(document.querySelectorAll('table[aria-label="代理列表"] tbody tr:not([aria-hidden="true"])')).find(r => (r.innerText || '').includes('UI_Full_Proxy'));
                    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                })()`);
                proxyDetailsAndRotationBtnOk = await waitUntil(
                    () => cdp.eval(`(() => {
                        const panel = document.querySelector('aside[aria-label="代理详情"]');
                        const t = panel?.innerText || '';
                        return Boolean(panel && t.includes('UI_Full_Proxy') && t.includes('完整配置') && t.includes('换 IP'));
                    })()`),
                    4000,
                );

                // 4) Open '完整配置' (ProxyConfigDrawer) -> verify secret redacted -> reveal -> hide -> close
                await cdp.eval(`window.__e2e.clickExact('完整配置', 'aside[aria-label="代理详情"] button')`);
                const configRedactedOk = await waitUntil(
                    () => cdp.eval(`(() => {
                        const ta = document.querySelector('textarea[aria-label="完整 sing-box 配置内容"]');
                        return Boolean(ta && ta.value.includes('203.0.113.55') && !ta.value.includes('proxy_secret_pw_88'));
                    })()`),
                    5000,
                );
                await cdp.eval(`window.__e2e.clickExact('显示认证', 'button')`);
                const configRevealedOk = await waitUntil(
                    () => cdp.eval(`(document.querySelector('textarea[aria-label="完整 sing-box 配置内容"]')?.value || '').includes('proxy_secret_pw_88')`),
                    5000,
                );
                await cdp.eval(`window.__e2e.clickExact('隐藏认证', 'button')`);
                await waitUntil(
                    () => cdp.eval(`!(document.querySelector('textarea[aria-label="完整 sing-box 配置内容"]')?.value || '').includes('proxy_secret_pw_88')`),
                    5000,
                );
                await cdp.eval(`document.querySelector('button[aria-label="关闭完整配置面板"]')?.click()`);
                await waitUntil(() => cdp.eval(`!document.querySelector('textarea[aria-label="完整 sing-box 配置内容"]')`), 3000);
                proxyConfigRedactRevealOk = Boolean(configRedactedOk && configRevealedOk);

                // 5) Edit proxy name -> save -> close details -> batch-select & delete 'UI_Full_Proxy_Edited'
                await cdp.eval(`window.__e2e.clickExact('编辑', 'aside[aria-label="代理详情"] button')`);
                await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('编辑代理配置')`), 4000);
                await cdp.eval(`(() => {
                    const nameIn = document.querySelector('input[placeholder*="美国住宅"], input[placeholder*="US Residential"]');
                    if (nameIn) window.__e2e.setReactValue(nameIn, 'UI_Full_Proxy_Edited');
                })()`);
                await sleep(100);
                await cdp.eval(`window.__e2e.clickExact('校验并保存', 'button')`);
                const editedOk = await waitUntil(
                    () => cdp.eval(`window.__e2e.bodyText().includes('UI_Full_Proxy_Edited')`),
                    6000,
                );
                await cdp.eval(`document.querySelector('aside[aria-label="代理详情"] button[aria-label="关闭详情面板"]')?.click()`);
                await cdp.eval(`(() => {
                    const row = Array.from(document.querySelectorAll('table[aria-label="代理列表"] tbody tr:not([aria-hidden="true"])')).find(r => (r.innerText || '').includes('UI_Full_Proxy_Edited'));
                    row?.querySelector('input[type="checkbox"]')?.click();
                })()`);
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('批量删除', 'main button')`), 3000);
                await waitUntil(() => cdp.eval(`window.__e2e.clickByText('删除', '[role="alertdialog"] button')`), 3000);
                const batchDeletedOk = await waitUntil(
                    () => cdp.eval(`!window.__e2e.bodyText().includes('UI_Full_Proxy_Edited')`),
                    6000,
                );
                proxyEditAndBatchDeleteOk = Boolean(editedOk && batchDeletedOk);
            } catch (err18) {
                e2e18Error = err18 instanceof Error ? err18.message : String(err18);
            }

            // ---------------------------------------------------------------
            // E2E-19: Settings Remaining Tabs (General Encrypted Backup UI, Privacy Collapsible Device Spoofing, Components Tab, About Tab)
            // ---------------------------------------------------------------
            let e2e19Error = '';
            let generalBackupUiOk = false;
            let privacySpoofingExpandOk = false;
            let componentsTabOk = false;
            let aboutTabOk = false;
            try {
                await cdp.eval(`document.querySelector('nav button[aria-label="设置"]')?.click()`);
                await waitUntil(() => cdp.eval(`Boolean(document.querySelector('[data-testid="settings-tab-general"]'))`), 4000);

                // 1) General tab: Config directory open button + Export & Restore Encrypted Backup dialogs + short-password validation UI
                await cdp.eval(`document.querySelector('[data-testid="settings-tab-general"]').click()`);
                await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('加密备份')`), 3000);
                const configOpenBtnVisible = await cdp.eval(
                    `Array.from(document.querySelectorAll('main button')).some((btn) => (btn.textContent || '').trim() === '打开目录')`,
                );
                await cdp.eval(`window.__e2e.clickExact('导出备份', 'main button')`);
                await waitUntil(() => cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('导出加密备份')`), 3000);
                await cdp.eval(`(() => {
                    const inputs = Array.from(document.querySelectorAll('[role="dialog"] input[type="password"]'));
                    if (inputs[0]) window.__e2e.setReactValue(inputs[0], '1234');
                    if (inputs[1]) window.__e2e.setReactValue(inputs[1], '1234');
                })()`);
                await sleep(100);
                await cdp.eval(`window.__e2e.clickByText('选择路径并导出', '[role="dialog"] button') || window.__e2e.clickByText('导出', '[role="dialog"] button[type="button"]:last-child')`);
                const shortPwdErrorShown = await waitUntil(
                    () => cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('8')`),
                    3000,
                );
                await cdp.eval(`window.__e2e.clickExact('取消', '[role="dialog"] button')`);
                await waitUntil(() => cdp.eval(`!document.querySelector('[role="dialog"]')`), 3000);
                await cdp.eval(`window.__e2e.clickExact('恢复备份', 'main button')`);
                const restoreDlgShown = await waitUntil(
                    () => cdp.eval(`(document.querySelector('[role="dialog"]')?.innerText || '').includes('恢复加密备份')`),
                    3000,
                );
                await cdp.eval(`window.__e2e.clickExact('取消', '[role="dialog"] button')`);
                await waitUntil(() => cdp.eval(`!document.querySelector('[role="dialog"]')`), 3000);
                generalBackupUiOk = Boolean(configOpenBtnVisible && shortPwdErrorShown && restoreDlgShown);

                // 2) Privacy tab: expand & collapse Device Spoofing ('设备伪装' -> '自定义' -> 5 switches -> '收起')
                await cdp.eval(`document.querySelector('[data-testid="settings-tab-privacy"]').click()`);
                await waitUntil(() => cdp.eval(`window.__e2e.bodyText().includes('设备伪装')`), 3000);
                const switchCountBefore = await cdp.eval(`document.querySelectorAll('main input[role="switch"], main input[type="checkbox"]').length`);
                await cdp.eval(`window.__e2e.clickByText('自定义', 'main button')`);
                const spoofExpanded = await waitUntil(
                    () => cdp.eval(`window.__e2e.bodyText().includes('模拟系统') && window.__e2e.bodyText().includes('浏览器品牌') && document.querySelectorAll('main input[role="switch"], main input[type="checkbox"]').length >= ${Number(switchCountBefore) + 5}`),
                    3000,
                );
                await cdp.eval(`window.__e2e.clickByText('收起', 'main button')`);
                const spoofCollapsed = await waitUntil(
                    () => cdp.eval(`!window.__e2e.bodyText().includes('浏览器品牌')`),
                    3000,
                );
                privacySpoofingExpandOk = Boolean(spoofExpanded && spoofCollapsed);

                // 3) Components tab: Proxy Engine (sing-box), Privacy Browser & Standard Chrome cards + expandable details
                await cdp.eval(`document.querySelector('[data-testid="settings-tab-components"]').click()`);
                const componentsLoaded = await waitUntil(
                    () => cdp.eval(`(() => {
                        const t = window.__e2e.bodyText();
                        return t.includes('代理引擎') && t.includes('防关联浏览器') && t.includes('标准 Chrome');
                    })()`),
                    4000,
                );
                await cdp.eval(`document.querySelector('[data-testid="component-toggle-singbox"]')?.click()`);
                await cdp.eval(`document.querySelector('[data-testid="component-toggle-fingerprint"]')?.click()`);
                await cdp.eval(`document.querySelector('[data-testid="component-toggle-chrome"]')?.click()`);
                const componentsExpanded = await waitUntil(
                    () => cdp.eval(`(() => {
                        const sb = document.querySelector('[data-testid="component-details-singbox"]');
                        const fp = document.querySelector('[data-testid="component-details-fingerprint"]');
                        const ch = document.querySelector('[data-testid="component-details-chrome"]');
                        const sbExp = document.querySelector('[data-testid="component-toggle-singbox"]')?.getAttribute('aria-expanded') === 'true';
                        const fpExp = document.querySelector('[data-testid="component-toggle-fingerprint"]')?.getAttribute('aria-expanded') === 'true';
                        const chExp = document.querySelector('[data-testid="component-toggle-chrome"]')?.getAttribute('aria-expanded') === 'true';
                        return Boolean(sb && fp && ch && sbExp && fpExp && chExp && (ch.textContent || '').includes('适用场景'));
                    })()`),
                    3000,
                );
                await cdp.eval(`document.querySelector('[data-testid="component-toggle-singbox"]')?.click()`);
                await cdp.eval(`document.querySelector('[data-testid="component-toggle-fingerprint"]')?.click()`);
                await cdp.eval(`document.querySelector('[data-testid="component-toggle-chrome"]')?.click()`);
                const componentsCollapsed = await waitUntil(
                    () => cdp.eval(`!document.querySelector('[data-testid="component-details-singbox"]') && !document.querySelector('[data-testid="component-details-fingerprint"]') && !document.querySelector('[data-testid="component-details-chrome"]')`),
                    3000,
                );
                componentsTabOk = Boolean(componentsLoaded && componentsExpanded && componentsCollapsed);

                // 4) About tab: MultiChrome hero, app version, GitHub Star, Export Diagnostics, Check Updates
                await cdp.eval(`document.querySelector('[data-testid="settings-tab-about"]').click()`);
                aboutTabOk = await waitUntil(
                    () => cdp.eval(`(() => {
                        const t = window.__e2e.bodyText();
                        return t.includes('MultiChrome') && t.includes(${JSON.stringify(appVersionTag)}) && t.includes('导出诊断报告') && t.includes('检查更新') && t.includes('在 GitHub 查看项目');
                    })()`),
                    4000,
                );
            } catch (err19) {
                e2e19Error = err19 instanceof Error ? err19.message : String(err19);
            }

            record(
                'E2E-15',
                '应用外壳全组件交互（零状态引导卡 / 顶栏图标与运行计数 / 侧栏收起展开 / 状态栏 / 后台日志全控件 / 代理日志抽屉 / InfoTip）',
                Boolean(
                    zeroStateOnboardingOk &&
                        titleBarRunningPillOk &&
                        sidebarCollapseOk &&
                        statusBarMetaOk &&
                        appLogsDialogOk &&
                        proxyLogDockControlsOk &&
                        infoTipPopoverOk,
                ),
                `onboarding=${zeroStateOnboardingOk}, runningPill=${titleBarRunningPillOk}, sidebar=${sidebarCollapseOk}, statusBar=${statusBarMetaOk}, appLogs=${appLogsDialogOk}, proxyDock=${proxyLogDockControlsOk}, infoTip=${infoTipPopoverOk}${e2e15Error ? `, err=${e2e15Error}` : ''}`,
            );

            record(
                'E2E-16',
                '环境全交互控件（搜索与空态重置 / 排序菜单 / 详情保存与 TagEditor / 标签 AND-OR 筛选 / 批量切代理 / 单行删除确认弹窗）',
                Boolean(
                    envSearchAndResetOk &&
                        envSortMenuOk &&
                        envDetailsTagSaveOk &&
                        envTagFilterAndOrOk &&
                        envBatchMoveAndProxyOk &&
                        envSingleDeleteConfirmOk,
                ),
                `searchReset=${envSearchAndResetOk}, sort=${envSortMenuOk}, detailsTags=${envDetailsTagSaveOk}, tagFilter=${envTagFilterAndOrOk}, batchProxy=${envBatchMoveAndProxyOk}, deleteConfirm=${envSingleDeleteConfirmOk}${e2e16Error ? `, err=${e2e16Error}` : ''}`,
            );

            record(
                'E2E-17',
                '回收站完整生命周期（TrashPage 列表展示 / 一键恢复 / 永久删除确认 / 清理过期确认弹窗）',
                Boolean(
                    trashListRenderedOk &&
                        trashRestoreOk &&
                        trashPermDeleteOk &&
                        trashCleanupDialogOk,
                ),
                `list=${trashListRenderedOk}, restore=${trashRestoreOk}, permDelete=${trashPermDeleteOk}, cleanupDlg=${trashCleanupDialogOk}${e2e17Error ? `, err=${e2e17Error}` : ''}`,
            );

            record(
                'E2E-18',
                '代理管理全 UI 覆盖（三模式编辑抽屉 + 换 IP 链接 / 搜索排序 / 详情面板 / 完整配置脱敏与显示切换 / 编辑与批量删除）',
                Boolean(
                    proxyEditorCreateOk &&
                        proxySearchFilterSortOk &&
                        proxyDetailsAndRotationBtnOk &&
                        proxyConfigRedactRevealOk &&
                        proxyEditAndBatchDeleteOk,
                ),
                `create=${proxyEditorCreateOk}, searchSort=${proxySearchFilterSortOk}, detailsRotate=${proxyDetailsAndRotationBtnOk}, configRedact=${proxyConfigRedactRevealOk}, editBatchDel=${proxyEditAndBatchDeleteOk}${e2e18Error ? `, err=${e2e18Error}` : ''}`,
            );

            record(
                'E2E-19',
                '设置中心全页签覆盖（常规加密备份校验弹窗 / 隐私设备伪装折叠与开关 / 组件双内核卡片 / 关于版本与诊断导出）',
                Boolean(
                    generalBackupUiOk &&
                        privacySpoofingExpandOk &&
                        componentsTabOk &&
                        aboutTabOk,
                ),
                `backupUI=${generalBackupUiOk}, privacySpoof=${privacySpoofingExpandOk}, components=${componentsTabOk}, about=${aboutTabOk}${e2e19Error ? `, err=${e2e19Error}` : ''}`,
            );

        // ---------------------------------------------------------------
        // Verify focus across unmounted rows using two distinct row densities.
        for (let batch = 0; batch < 4; batch++) {
            const payload = { namePrefix: 'Virtual', groupName: 'Virtual fixture', count: 25,
                startNumber: batch * 25 + 1, browserEngine: 'system-chrome',
                notes: batch % 2 ? 'Longer fixture row' : '', tags: batch % 2 ? ['one', 'two'] : [] };
            await cdp.eval(`window.electronAPI.chromeEnvironments.batchCreate(${JSON.stringify(payload)}).then(() => true)`);
        }
        await reloadUI();
        const groupOpened = await waitUntil(() => cdp.eval(`(() => {
            const button = document.querySelector('aside button[title="Virtual fixture"]');
            if (button) button.click();
            return Boolean(button);
        })()`), 5000);
        const rows = 'table tbody tr[data-virtual-id]';
        const first = await cdp.eval(`(() => {
            const row = document.querySelector(${JSON.stringify(rows)});
            row?.focus();
            row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            return row?.dataset.virtualId;
        })()`);
        const endFocused = await waitUntil(() => cdp.eval(`(() => {
            const mounted = document.querySelectorAll(${JSON.stringify(rows)});
            const last = mounted[mounted.length - 1];
            return mounted.length < 100 && last && last === document.activeElement &&
                last.dataset.virtualId !== ${JSON.stringify(first)} && !last.nextElementSibling;
        })()`), 5000);
        await cdp.eval(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))`);
        const homeFocused = await waitUntil(() => cdp.eval(`document.activeElement?.dataset.virtualId === ${JSON.stringify(first)}`), 5000);
        record('E2E-20', '百行混合密度环境列表的键盘焦点', Boolean(groupOpened && endFocused && homeFocused));

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
            '极简本地 CDP 守卫与 MCP 面板（默认端口 18922 / 访问密钥 401 保护与脱敏轮换 / 标准接入命令 / 4 项环境工具 / Origin 403 / 端口冲突一键恢复 / 干净停机）',
            Boolean(
                defaultPortBootOk &&
                    autoTabReady &&
                    autoPanelReady &&
                    portApplied &&
                    serverReady &&
                    tokenAuthGuardOk &&
                    standardSnippetsOk &&
                    restStatusOk &&
                    mcpInitOk &&
                    mcpToolsOk &&
                    origin403Ok &&
                    portConflictUiOk &&
                    disabledCleanlyOk,
            ),
            `defaultPort=${defaultPortBootOk}, ui=${Boolean(autoTabReady && autoPanelReady)}, tokenAuth=${tokenAuthGuardOk}, snippets=${standardSnippetsOk}, rest=${restStatusOk}, mcpInit=${mcpInitOk}, mcpTools4=${mcpToolsOk}, 403=${origin403Ok}, portConflictUi=${portConflictUiOk}, stopped=${disabledCleanlyOk}${e2e11Error ? `, err=${e2e11Error}` : ''}`,
        );

        record(
            'E2E-12',
            '真机标准 CDP 透传守卫 + MCP 双通道（HTTP + Stdio）并发拉起 3 窗口宫格平铺与跨时区并行控制',
            Boolean(
                realPrivatePortIsolationOk &&
                    realDiscoveryAndPassThroughOk &&
                    realOverrideShieldOk &&
                    realIncognitoBlockOk &&
                    mcpStdioBridgeOk &&
                    mcpMultiWindow3ConcurrentOk &&
                    realActiveSwitchAndParallelOk,
            ),
            `privatePort=${realPrivatePortIsolationOk}, passThrough=${realDiscoveryAndPassThroughOk}, overrideShield=${realOverrideShieldOk}, incognitoBlock=${realIncognitoBlockOk}, mcpStdio=${mcpStdioBridgeOk}, multiWin3Mcp=${mcpMultiWindow3ConcurrentOk}, activeSwitch=${realActiveSwitchAndParallelOk}${e2e12Error ? `, err=${e2e12Error}` : ''}`,
        );

        record(
            'E2E-13',
            '表格复选框与操作列零裁切校验（含时区列与代理列表）+ 批量操作栏间距检查',
            Boolean(
                envCheckboxesUnclipped &&
                    envActionsUnclipped &&
                    batchBarGapOk &&
                    proxyLayoutUnclipped,
            ),
            `envCb=${envCheckboxesUnclipped}, envActions=${envActionsUnclipped}, batchGap=${batchBarGapOk}, proxyLayout=${proxyLayoutUnclipped}${e2e13Error ? `, err=${e2e13Error}` : ''}`,
        );

        record(
            'E2E-14',
            '真实界面批量新建（3 环境）+ 3 窗口并发启动 + 单一窗口布局菜单（防误触/无缝宫格/分屏与主窗口恢复/堆叠/层叠/纯 CDP 定位）+ Cookie 导入导出 + 3 窗口同屏预检全启',
            Boolean(
                uiBulkCreateOk &&
                    simultaneousLaunch3Ok &&
                    uiTile3Ok &&
                    uiCookieTransferOk &&
                    simultaneousStop3Ok &&
                    healthQueueBatchOk &&
                    backupValidationOk,
            ),
            `bulkCreate=${uiBulkCreateOk}, launch3=${simultaneousLaunch3Ok}, layoutAndFocus=${uiTile3Ok}${uiTile3SubDetail}, cookieUI=${uiCookieTransferOk}, stop3=${simultaneousStop3Ok}, batchHealth3=${healthQueueBatchOk}, backupPwdCheck=${backupValidationOk}${e2e14Error ? `, err=${e2e14Error}` : ''}`,
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
    const expected = [
        'UX-01', 'UX-02', 'UX-03', 'UX-04', 'UX-05', 'UX-06', 'UX-07', 'UX-08', 'UX-09',
        ...Array.from({ length: 21 }, (_, i) => 'E2E-' + String(i).padStart(2, '0')),
        'E2E-02a', 'E2E-02b', 'E2E-02c', 'E2E-02d', 'E2E-04a', 'E2E-06a',
    ];
    const passed = new Set(results.filter(r => r.passed).map(r => r.id));
    const missing = expected.filter(id => !results.some(r => r.id === id));
    for (const id of missing) failed.push({ id, title: 'Missing assertion', passed: false });
    console.log('E2E UI Suite Summary: ' + expected.filter(id => passed.has(id)).length + '/' + expected.length + ' passed');
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
