#!/usr/bin/env node
/**
 * Generates clean, synthetic README and website screenshots by launching
 * the compiled Electron app against an isolated temporary userData directory.
 * Uses RFC-5737 documentation IPs and generic workspace profiles only.
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
                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }
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

async function waitUntil(fn, timeoutMs = 10000, intervalMs = 150) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await fn();
        if (last) return last;
        await sleep(intervalMs);
    }
    return last;
}

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-shot-'));
    const tempUserData = path.join(tempRoot, 'userData');
    fs.mkdirSync(tempUserData, { recursive: true });

    const outDir = path.join(projectRoot, 'docs', 'images');
    fs.mkdirSync(outDir, { recursive: true });

    const debugPort = await findFreePort();
    const childEnv = {
        ...process.env,
        MULTICHROME_USER_DATA: tempUserData,
        NODE_ENV: 'production',
    };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const electronProc = spawn(
        electronBinary,
        [projectRoot, `--remote-debugging-port=${debugPort}`],
        {
            cwd: projectRoot,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );

    let cdp = null;
    try {
        const target = await waitForRendererTarget(debugPort, 25000);
        cdp = new SimpleCDP(target.webSocketDebuggerUrl);
        await cdp.connect();

        await waitUntil(() =>
            cdp.eval(`Boolean(window.electronAPI && document.body && document.body.innerText.includes('New Environment'))`),
        );

        await cdp.eval(`(async () => {
            const pUs = await window.electronAPI.proxies.save({
                mode: 'simple',
                name: 'US East · Node 01',
                protocol: 'http',
                host: '198.51.100.12',
                port: 8080,
                username: '',
            });
            const pDe = await window.electronAPI.proxies.save({
                mode: 'simple',
                name: 'EU Central · Node 02',
                protocol: 'socks5',
                host: '203.0.113.45',
                port: 1080,
                username: '',
            });
            const pJp = await window.electronAPI.proxies.save({
                mode: 'simple',
                name: 'AP Tokyo · Node 03',
                protocol: 'http',
                host: '192.0.2.88',
                port: 3128,
                username: '',
            });

            await window.electronAPI.chromeEnvironments.create(
                'US · Storefront',
                'Operations',
                'Primary regional storefront session',
                {
                    browserEngine: 'fingerprint-chromium',
                    proxyId: pUs.id,
                    tags: ['us-east', 'verified'],
                },
            );
            await window.electronAPI.chromeEnvironments.create(
                'DE · Research',
                'Research',
                'Isolated academic search workspace',
                {
                    browserEngine: 'system-chrome',
                    proxyId: pDe.id,
                    tags: ['eu-central'],
                },
            );
            await window.electronAPI.chromeEnvironments.create(
                'JP · Analytics',
                'Operations',
                'Regional QA verification profile',
                {
                    browserEngine: 'fingerprint-chromium',
                    proxyId: pJp.id,
                    tags: ['ap-east', 'verified'],
                },
            );
            await window.electronAPI.chromeEnvironments.create(
                'SG · Automation',
                'Automation',
                'Playwright MCP guarded profile',
                {
                    browserEngine: 'fingerprint-chromium',
                    proxyId: pJp.id,
                    tags: ['mcp', 'automation'],
                },
            );
            return true;
        })()`);

        const capturePass = async ({ locale, theme, fileName, expectedText }) => {
            await cdp.eval(`(async () => {
                const s = await window.electronAPI.settings.getSettings();
                await window.electronAPI.settings.saveSettings({ ...s, locale: '${locale}', theme: '${theme}' });
                await window.electronAPI.app.setTheme('${theme}', ${theme === 'dark'});
                window.location.reload();
                return true;
            })()`);
            await sleep(500);
            await waitUntil(
                () =>
                    cdp
                        .eval(`Boolean(
                            document.documentElement.lang === '${locale}' &&
                            document.documentElement.dataset.theme === '${theme}' &&
                            document.body.innerText.includes(${JSON.stringify(expectedText)}) &&
                            document.body.innerText.includes('US · Storefront')
                        )`)
                        .catch(() => false),
                12000,
            );
            await cdp.eval(`(async () => {
                const backdrop = ${theme === 'dark'} ? '#121722' : '#e8eef7';
                document.body.style.backgroundColor = backdrop;
                await document.fonts.ready;
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                return true;
            })()`);
            await sleep(250);
            const { data } = await cdp.send('Page.captureScreenshot', {
                format: 'png',
                fromSurface: true,
            });
            const dest = path.join(outDir, fileName);
            fs.writeFileSync(dest, Buffer.from(data, 'base64'));
            console.log(`Saved ${dest}`);
        };

        await capturePass({
            locale: 'en-US',
            theme: 'light',
            fileName: 'overview-light.png',
            expectedText: 'New Environment',
        });
        await capturePass({
            locale: 'en-US',
            theme: 'dark',
            fileName: 'overview-dark.png',
            expectedText: 'New Environment',
        });
        await capturePass({
            locale: 'zh-CN',
            theme: 'light',
            fileName: 'overview-zh.png',
            expectedText: '新建环境',
        });
    } finally {
        cdp?.close();
        try {
            electronProc.kill('SIGTERM');
        } catch {
            // ignore
        }
        await sleep(600);
        if (!electronProc.killed) {
            try {
                electronProc.kill('SIGKILL');
            } catch {
                // ignore
            }
        }
        try {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
}

main().catch((err) => {
    console.error('[capture-readme-screenshots] Failed:', err);
    process.exit(1);
});
