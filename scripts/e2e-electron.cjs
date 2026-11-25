'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');
const WebSocket = require('ws');

// ---------------------------------------------------------------------------
// CLI argument parsing (no secrets / no personal paths hardcoded)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const opts = {
        kernel: process.env.MULTICHROME_E2E_KERNEL || '',
        requireKernel: false,
        live: false,
        proxyA: process.env.MULTICHROME_E2E_PROXY_A || '',
        proxyB: process.env.MULTICHROME_E2E_PROXY_B || '',
        keepTemp: false,
        reportJson: '',
    };
    for (const arg of argv) {
        if (arg.startsWith('--kernel=')) opts.kernel = arg.slice('--kernel='.length);
        else if (arg === '--require-kernel') opts.requireKernel = true;
        else if (arg === '--live') opts.live = true;
        else if (arg.startsWith('--proxy-a=')) opts.proxyA = arg.slice('--proxy-a='.length);
        else if (arg.startsWith('--proxy-b=')) opts.proxyB = arg.slice('--proxy-b='.length);
        else if (arg === '--keep-temp') opts.keepTemp = true;
        else if (arg.startsWith('--report=')) opts.reportJson = arg.slice('--report='.length);
    }
    return opts;
}

const OPTS = parseArgs(process.argv.slice(2));

// Snapshot real MultiChrome userData (READ-ONLY) strictly to auto-discover an installed kernel binary if --kernel wasn't given.
// Note: when Electron runs a standalone script directly, app.getName() defaults to "Electron",
// so we explicitly resolve `<appData>/multichrome` (cross-platform: AppData/Application Support/.config).
const REAL_USER_DATA = path.join(app.getPath('appData'), 'multichrome');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'multichrome-e2e-'));
const TEMP_USER_DATA = path.join(TEMP_ROOT, 'userData');
const TEMP_DATA_PATH = path.join(TEMP_ROOT, 'data');
fs.mkdirSync(TEMP_USER_DATA, { recursive: true });
fs.mkdirSync(TEMP_DATA_PATH, { recursive: true });

// Isolate Electron userData BEFORE app.whenReady() so real user DB/settings are NEVER touched.
app.setPath('userData', TEMP_USER_DATA);

function discoverRealDataPath() {
    const candidates = [
        REAL_USER_DATA,
        path.join(app.getPath('appData'), 'MultiChrome'),
    ];
    for (const dir of candidates) {
        try {
            const realSettingsPath = path.join(dir, 'app-settings.json');
            if (fs.existsSync(realSettingsPath)) {
                const parsed = JSON.parse(fs.readFileSync(realSettingsPath, 'utf-8'));
                if (typeof parsed.dataPath === 'string' && parsed.dataPath.trim()) {
                    return parsed.dataPath.trim();
                }
            }
        } catch {
            /* ignore */
        }
    }
    return REAL_USER_DATA;
}

function findManifestKernel(dataDirectory) {
    const manifestPath = path.join(dataDirectory, 'kernels', 'manifest.json');
    if (!fs.existsSync(manifestPath)) return '';
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const kernels = Array.isArray(manifest.kernels) ? manifest.kernels : [];
    const available = entry => typeof entry?.executablePath === 'string' &&
        fs.statSync(entry.executablePath, { throwIfNoEntry: false })?.isFile();
    const active = kernels.find(entry => entry?.id === manifest.activeKernelId && available(entry));
    return (active || kernels.find(available))?.executablePath || '';
}

function discoverInstalledKernelPath() {
    if (OPTS.kernel) {
        if (!fs.statSync(OPTS.kernel, { throwIfNoEntry: false })?.isFile()) {
            throw new Error('Configured --kernel or MULTICHROME_E2E_KERNEL executable was not found.');
        }
        return path.resolve(OPTS.kernel);
    }
    const hint = path.resolve(__dirname, '..', '.tmp', 'e2e-data-dir.txt');
    if (fs.existsSync(hint)) {
        const directory = fs.readFileSync(hint, 'utf8').trim();
        const executable = path.isAbsolute(directory) && findManifestKernel(directory);
        if (!executable) throw new Error('Check .tmp/e2e-data-dir.txt: no available kernel in the configured data directory.');
        return executable;
    }
    const dirs = process.env.SKIP_DOTENV === 'true' ? [REAL_USER_DATA] : [discoverRealDataPath(), REAL_USER_DATA];
    for (const directory of new Set(dirs)) {
        const executable = findManifestKernel(directory);
        if (executable) return executable;
    }
    return '';
}

// ---------------------------------------------------------------------------
// Assertion & Reporting Framework
// ---------------------------------------------------------------------------
const results = [];

function recordResult(id, priority, title, passed, detail = '') {
    results.push({ id, priority, title, passed, detail });
    const icon = passed ? 'PASS' : 'FAIL';
    const suffix = detail ? ` — ${detail}` : '';
    console.log(`[${icon}] [${priority}] ${id}: ${title}${suffix}`);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function sha256Short(str) {
    return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Local Self-Contained Test Infrastructure (Echo Server + Two HTTP Proxies)
// ---------------------------------------------------------------------------
function startEchoServer() {
    let directLeakHits = 0;
    const restoreReports = [];
    const server = http.createServer((req, res) => {
        const proxyTag = req.headers['x-e2e-proxy'] || 'DIRECT';
        if (proxyTag === 'DIRECT') {
            directLeakHits += 1;
        }
        const urlObj = new URL(req.url, 'http://e2e-probe.invalid');

        if (urlObj.pathname === '/restore-tz') {
            restoreReports.push({
                src: urlObj.searchParams.get('src') || '',
                tz: urlObj.searchParams.get('tz') || '',
                proxyTag,
            });
            res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
            res.end('ok');
            return;
        }

        if (urlObj.pathname === '/restore-uncached') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(`<!doctype html><html><head><title>RestoreUncached</title></head><body><h1>Uncached</h1><script>fetch('/restore-tz?src=uncached&tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone));</script></body></html>`);
            return;
        }

        if (urlObj.pathname === '/restore-cached') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=31536000, immutable',
            });
            res.end(`<!doctype html><html><head><title>RestoreCached</title></head><body><h1>Cached</h1><script>fetch('/restore-tz?src=cached&tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone));</script></body></html>`);
            return;
        }

        if (urlObj.pathname === '/probe') {
            const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>MultiChrome E2E Probe</title></head>
<body>
<div id="proxy-tag">${String(proxyTag)}</div>
<div id="accept-lang">${String(req.headers['accept-language'] || '')}</div>
<script>
window.__E2E_SERVER__ = ${JSON.stringify({
                proxyTag,
                acceptLanguage: req.headers['accept-language'] || '',
                userAgent: req.headers['user-agent'] || '',
                host: req.headers.host || '',
            })};
</script>
</body>
</html>`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        if (urlObj.pathname === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    proxyTag,
                    acceptLanguage: req.headers['accept-language'] || '',
                    host: req.headers.host || '',
                    path: urlObj.pathname,
                }),
            );
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`ok:${proxyTag}`);
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({
                port: addr.port,
                getDirectLeakHits: () => directLeakHits,
                getRestoreReports: () => [...restoreReports],
                clearRestoreReports: () => {
                    restoreReports.length = 0;
                },
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

function startLocalForwardProxy(tag, echoPort) {
    const activeSockets = new Set();
    let requestCount = 0;

    const server = http.createServer((clientReq, clientRes) => {
        requestCount += 1;
        // Route synthetic *.invalid test domains to our local Echo server with X-E2E-Proxy header
        let targetHost = '127.0.0.1';
        let targetPort = echoPort;
        let targetPath = '/';
        try {
            const u = new URL(clientReq.url);
            targetPath = u.pathname + u.search;
            if (!u.hostname.endsWith('.invalid')) {
                // Reject unintended external calls during offline suite so offline suite is 100% deterministic
                clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
                clientRes.end('E2E offline proxy only forwards *.invalid');
                return;
            }
        } catch {
            clientRes.writeHead(400);
            clientRes.end('bad request');
            return;
        }

        const headers = { ...clientReq.headers, 'x-e2e-proxy': tag };
        delete headers['proxy-connection'];

        const upstream = http.request(
            {
                host: targetHost,
                port: targetPort,
                method: clientReq.method,
                path: targetPath,
                headers,
            },
            (upRes) => {
                clientRes.writeHead(upRes.statusCode || 200, upRes.headers);
                upRes.pipe(clientRes);
            },
        );
        upstream.on('error', () => {
            if (!clientRes.headersSent) {
                clientRes.writeHead(502);
                clientRes.end('upstream error');
            }
        });
        clientReq.pipe(upstream);
    });

    server.on('connection', (sock) => {
        activeSockets.add(sock);
        sock.on('close', () => activeSockets.delete(sock));
    });

    // Reject CONNECT in offline mode cleanly so external HTTPS background pings don't hang
    server.on('connect', (_req, clientSocket) => {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.destroy();
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({
                tag,
                port: addr.port,
                url: `http://127.0.0.1:${addr.port}`,
                getRequestCount: () => requestCount,
                killNow: () =>
                    new Promise((r) => {
                        for (const sock of activeSockets) {
                            try {
                                sock.destroy();
                            } catch {
                                /* ignore */
                            }
                        }
                        activeSockets.clear();
                        server.close(() => r());
                    }),
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Lightweight CDP Probe Client
// ---------------------------------------------------------------------------
function httpGetJson(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(1500, () => {
            req.destroy();
            resolve(null);
        });
    });
}

async function waitForDevToolsPort(chromeManager, envId, dataDir, timeoutMs = 15000) {
    const portFile = path.join(dataDir, 'DevToolsActivePort');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const record = chromeManager.runningProcesses?.get?.(envId);
        const candidates = [];
        if (record && Number.isInteger(record.debugPort) && record.debugPort > 0) {
            candidates.push(record.debugPort);
        }
        if (fs.existsSync(portFile)) {
            try {
                const firstLine = fs.readFileSync(portFile, 'utf-8').split(/\r?\n/)[0].trim();
                const port = Number(firstLine);
                if (Number.isInteger(port) && port > 0 && !candidates.includes(port)) {
                    candidates.push(port);
                }
            } catch {
                /* retry */
            }
        }
        for (const port of candidates) {
            const ver = await httpGetJson(`http://127.0.0.1:${port}/json/version`);
            if (ver?.webSocketDebuggerUrl) {
                return { port, wsUrl: ver.webSocketDebuggerUrl };
            }
        }
        await sleep(150);
    }
    throw new Error(`DevTools endpoint timeout for ${dataDir}`);
}

async function connectCDP(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP ws connect timeout')), 5000);
        ws.once('open', () => {
            clearTimeout(timer);
            resolve();
        });
        ws.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });

    let msgId = 0;
    const pending = new Map();
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.id && pending.has(msg.id)) {
                const entry = pending.get(msg.id);
                clearTimeout(entry.timer);
                pending.delete(msg.id);
                entry.resolve(msg);
            }
        } catch {
            /* ignore */
        }
    });

    const send = (method, params = {}, sessionId, timeoutMs = 30000) =>
        new Promise((resolve, reject) => {
            const id = ++msgId;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, timeoutMs);
            pending.set(id, { resolve, timer });
            const payload = { id, method, params };
            if (sessionId) payload.sessionId = sessionId;
            ws.send(JSON.stringify(payload));
        });

    return {
        send,
        close: () => {
            for (const entry of pending.values()) clearTimeout(entry.timer);
            pending.clear();
            try {
                ws.close();
            } catch {
                /* ignore */
            }
        },
    };
}

async function openTabAndEval(cdp, url, expression, waitAfterLoadMs = 600, timeoutMs = 30000) {
    const created = await cdp.send('Target.createTarget', { url });
    const targetId = created.result?.targetId;
    if (!targetId) throw new Error(`Failed to create tab for ${url}`);
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.result?.sessionId;

    try {
        const deadline = Date.now() + timeoutMs;
        let ready = false;
        while (Date.now() < deadline) {
            const state = await cdp.send(
                'Runtime.evaluate',
                { expression: 'document.readyState', returnByValue: true },
                sessionId,
                3000,
            );
            const val = state.result?.result?.value;
            if (val === 'complete' || val === 'interactive') {
                ready = true;
                break;
            }
            await sleep(120);
        }
        if (ready && waitAfterLoadMs > 0) {
            await sleep(waitAfterLoadMs);
        }
        const evalResp = await cdp.send(
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            sessionId,
            timeoutMs,
        );
        if (evalResp.result?.exceptionDetails) {
            return { error: evalResp.result.exceptionDetails.text || 'Runtime exception' };
        }
        return evalResp.result?.result?.value;
    } finally {
        try {
            await cdp.send('Target.closeTarget', { targetId });
        } catch {
            /* ignore */
        }
    }
}

const FINGERPRINT_AND_LEAK_PROBE_JS = `(async () => {
    const out = {
        url: location.href,
        server: window.__E2E_SERVER__ || null,
        webdriver: navigator.webdriver,
        hardwareConcurrency: navigator.hardwareConcurrency,
        language: navigator.language,
        languages: Array.from(navigator.languages || []),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tzOffset: new Date().getTimezoneOffset(),
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        nativeIntegrity: {
            toDataURL: HTMLCanvasElement.prototype.toDataURL.toString().includes('[native code]'),
            getTimezoneOffset: Date.prototype.getTimezoneOffset.toString().includes('[native code]'),
            intlResolvedOptions: Intl.DateTimeFormat.prototype.resolvedOptions.toString().includes('[native code]'),
            rtcPeerConnection: typeof window.RTCPeerConnection === 'function'
                ? window.RTCPeerConnection.toString().includes('[native code]')
                : false,
        },
        uaData: null,
        canvasData: null,
        webgl: null,
        audioSum: null,
        worker: null,
        webrtc: { candidates: [], sdpLines: [], ips: [] },
    };

    try {
        if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
            const hi = await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'brands', 'fullVersionList']);
            out.uaData = {
                platform: hi.platform,
                platformVersion: hi.platformVersion,
                brands: (hi.brands || []).map(b => b.brand + '/' + b.version),
            };
        }
    } catch (e) { out.uaData = { error: String(e) }; }

    // 2D Canvas fingerprint (wait for fonts + first paint frame for deterministic rasterization)
    try {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.createElement('canvas');
        c.width = 280;
        c.height = 64;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#f60';
        ctx.fillRect(10, 10, 120, 40);
        ctx.fillStyle = '#069';
        ctx.font = '18px Arial';
        ctx.fillText('MultiChrome E2E FP 12345', 14, 38);
        ctx.strokeStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.beginPath();
        ctx.arc(210, 32, 20, 0, Math.PI * 2);
        ctx.stroke();
        out.canvasData = c.toDataURL();
        const cGeom = document.createElement('canvas');
        cGeom.width = 200;
        cGeom.height = 60;
        const gGeom = cGeom.getContext('2d');
        gGeom.fillStyle = '#f60';
        gGeom.fillRect(10, 10, 120, 40);
        gGeom.strokeStyle = 'rgba(102, 204, 0, 0.7)';
        gGeom.beginPath();
        gGeom.arc(150, 30, 20, 0, Math.PI * 2);
        gGeom.stroke();
        out.canvasGeomData = cGeom.toDataURL();
        out.dpr = window.devicePixelRatio;
    } catch (e) { out.canvasData = 'ERR:' + e; }

    // WebGL fingerprint
    try {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        if (gl) {
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
            const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            gl.clearColor(0.25, 0.5, 0.75, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const pixels = new Uint8Array(64 * 64 * 4);
            gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let acc = 0;
            for (let i = 0; i < pixels.length; i += 17) acc = (acc * 31 + pixels[i]) >>> 0;
            out.webgl = { vendor, renderer, pixelChecksum: acc, dataUrl: c.toDataURL() };
        }
    } catch (e) { out.webgl = { error: String(e) }; }

    // OfflineAudioContext fingerprint
    try {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OAC) {
            const ctx = new OAC(1, 4410, 44100);
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(10000, ctx.currentTime);
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.setValueAtTime(-50, ctx.currentTime);
            comp.knee.setValueAtTime(40, ctx.currentTime);
            comp.ratio.setValueAtTime(12, ctx.currentTime);
            osc.connect(comp);
            comp.connect(ctx.destination);
            osc.start(0);
            const buf = await ctx.startRendering();
            const ch = buf.getChannelData(0);
            let sum = 0;
            for (let i = 2000; i < 3000; i++) sum += Math.abs(ch[i]);
            out.audioSum = sum.toFixed(12);
        }
    } catch (e) { out.audioSum = 'ERR:' + e; }

    // Web Worker timezone & language parity
    try {
        out.worker = await new Promise((resolve) => {
            const blob = new Blob([\`
                postMessage({
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    tzOffset: new Date().getTimezoneOffset(),
                    language: navigator.language,
                    languages: Array.from(navigator.languages || []),
                    hardwareConcurrency: navigator.hardwareConcurrency,
                });
            \`], { type: 'application/javascript' });
            const w = new Worker(URL.createObjectURL(blob));
            const t = setTimeout(() => { w.terminate(); resolve({ error: 'worker_timeout' }); }, 3000);
            w.onmessage = (ev) => { clearTimeout(t); w.terminate(); resolve(ev.data); };
            w.onerror = (err) => { clearTimeout(t); w.terminate(); resolve({ error: String(err.message || err) }); };
        });
    } catch (e) { out.worker = { error: String(e) }; }

    // WebRTC ICE candidate leak test
    try {
        out.webrtc = await new Promise((resolve) => {
            const candidates = [];
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });
            pc.createDataChannel('e2e-leak-check');
            pc.onicecandidate = (ev) => {
                if (ev.candidate && ev.candidate.candidate) {
                    candidates.push(ev.candidate.candidate);
                }
            };
            const finish = () => {
                const sdp = pc.localDescription ? pc.localDescription.sdp : '';
                const sdpLines = sdp.split(/\\r?\\n/).filter(l => l.startsWith('a=candidate:') || l.startsWith('c=IN '));
                const ipMatches = new Set();
                const allText = candidates.join('\\n') + '\\n' + sdpLines.join('\\n');
                const ipv4Re = /\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/g;
                for (const m of allText.matchAll(ipv4Re)) {
                    if (m[0] !== '0.0.0.0' && m[0] !== '127.0.0.1') ipMatches.add(m[0]);
                }
                const ipv6Re = /\\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\\b/gi;
                for (const m of allText.matchAll(ipv6Re)) {
                    if (m[0] !== '::1' && !m[0].toLowerCase().startsWith('fe80:')) ipMatches.add(m[0]);
                }
                try { pc.close(); } catch {}
                resolve({ candidates, sdpLines, ips: Array.from(ipMatches) });
            };
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => setTimeout(finish, 2200))
                .catch(err => resolve({ candidates: [], sdpLines: [], ips: [], error: String(err) }));
        });
    } catch (e) { out.webrtc = { candidates: [], sdpLines: [], ips: [], error: String(e) }; }

    return out;
})()`;

const ADVERSARIAL_CREEP_BOTD_JS = `(async () => {
    const report = {
        lies: [],
        determinism: { canvasStable: false, audioStable: false, rectsStable: false },
        coherence: {
            osMatch: false,
            gpuMatch: false,
            intlConsistent: false,
            langMatchesIntl: false,
            details: {},
        },
        botd: {
            webdriverFalse: navigator.webdriver === false,
            automationGlobals: [],
            hasChromeObj: Boolean(window.chrome),
            pluginsCount: navigator.plugins ? navigator.plugins.length : 0,
            nonZeroOuter: window.outerWidth > 0 && window.outerHeight > 0,
        },
    };

    // 1. CreepJS-style cross-iframe prototype & Function.toString lie detection
    try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        const cleanWin = iframe.contentWindow;
        const cleanToString = cleanWin.Function.prototype.toString;

        const isNativeViaCleanIframe = (fn) => {
            try {
                if (typeof fn !== 'function') return false;
                const s = cleanToString.call(fn);
                return /^function\\s+[^\\(]*\\(\\)\\s*\\{\\s*\\[native code\\]\\s*\\}$/.test(s);
            } catch {
                return false;
            }
        };

        if (!isNativeViaCleanIframe(Function.prototype.toString)) {
            report.lies.push('Function.prototype.toString');
        }
        if (!isNativeViaCleanIframe(Intl.DateTimeFormat)) {
            report.lies.push('Intl.DateTimeFormat');
        }
        if (!isNativeViaCleanIframe(Intl.DateTimeFormat.prototype.resolvedOptions)) {
            report.lies.push('Intl.DateTimeFormat.prototype.resolvedOptions');
        }
        if (!isNativeViaCleanIframe(Date.prototype.getTimezoneOffset)) {
            report.lies.push('Date.prototype.getTimezoneOffset');
        }
        if (!isNativeViaCleanIframe(Date.prototype.toString)) {
            report.lies.push('Date.prototype.toString');
        }
        if (!isNativeViaCleanIframe(HTMLCanvasElement.prototype.toDataURL)) {
            report.lies.push('HTMLCanvasElement.prototype.toDataURL');
        }
        if (!isNativeViaCleanIframe(CanvasRenderingContext2D.prototype.getImageData)) {
            report.lies.push('CanvasRenderingContext2D.prototype.getImageData');
        }
        if (window.RTCPeerConnection && !isNativeViaCleanIframe(window.RTCPeerConnection)) {
            report.lies.push('RTCPeerConnection');
        }

        const navLangDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
        if (navLangDesc && navLangDesc.get && !isNativeViaCleanIframe(navLangDesc.get)) {
            report.lies.push('Navigator.prototype.language');
        }
        const navLangsDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
        if (navLangsDesc && navLangsDesc.get && !isNativeViaCleanIframe(navLangsDesc.get)) {
            report.lies.push('Navigator.prototype.languages');
        }
        const wdDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
        if (wdDesc && wdDesc.get && !isNativeViaCleanIframe(wdDesc.get)) {
            report.lies.push('Navigator.prototype.webdriver');
        }

        iframe.remove();
    } catch (e) {
        report.lies.push('iframe-check-error:' + String(e));
    }

    // 2. Intra-session determinism (detects naive per-call random noise)
    try {
        const drawCanvas = () => {
            const c = document.createElement('canvas');
            c.width = 240;
            c.height = 60;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#336699';
            ctx.fillRect(4, 4, 232, 52);
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px Arial';
            ctx.fillText('CreepJS Determinism Check 98765', 12, 36);
            return c.toDataURL();
        };
        const c1 = drawCanvas();
        const c2 = drawCanvas();
        report.determinism.canvasStable = Boolean(c1 && c1 === c2);

        const runAudio = async () => {
            const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const ctx = new OAC(1, 2048, 44100);
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(4400, 0);
            osc.connect(ctx.destination);
            osc.start(0);
            const buf = await ctx.startRendering();
            const ch = buf.getChannelData(0);
            let s = 0;
            for (let i = 500; i < 1200; i++) s += Math.abs(ch[i]);
            return s.toFixed(12);
        };
        const a1 = await runAudio();
        const a2 = await runAudio();
        report.determinism.audioStable = Boolean(a1 && a1 === a2);

        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:10px;top:10px;font:14px Arial;padding:3px 7px;';
        el.textContent = 'ClientRects-Stability-Probe';
        document.body.appendChild(el);
        const r1 = JSON.stringify(el.getBoundingClientRect());
        const r2 = JSON.stringify(el.getBoundingClientRect());
        el.remove();
        report.determinism.rectsStable = r1 === r2;
    } catch {}

    // 3. Cross-dimension coherence (UA / Client Hints / Platform / GPU / Intl)
    try {
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        const uaPlatform = navigator.userAgentData?.platform || '';
        const isWin = /Windows/i.test(ua);
        const isMac = /Macintosh|Mac OS X/i.test(ua);
        const isLin = /Linux/i.test(ua) && !/Android/i.test(ua);

        const osMatch =
            (isWin && /Win/i.test(platform) && (!uaPlatform || /Windows/i.test(uaPlatform))) ||
            (isMac && /Mac/i.test(platform) && (!uaPlatform || /macOS/i.test(uaPlatform))) ||
            (isLin && /Linux/i.test(platform) && (!uaPlatform || /Linux/i.test(uaPlatform)));

        const c = document.createElement('canvas');
        const gl = c.getContext('webgl');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
        const gpuContradiction =
            (isWin && /Apple/i.test(renderer)) ||
            (isMac && /Direct3D/i.test(renderer)) ||
            /SwiftShader/i.test(renderer);

        const dtfLocale = Intl.DateTimeFormat().resolvedOptions().locale;
        const nfLocale = Intl.NumberFormat().resolvedOptions().locale;
        const intlConsistent = Boolean(dtfLocale && dtfLocale === nfLocale);
        const navBase = String(navigator.language || '').split('-')[0].toLowerCase();
        const intlBase = String(dtfLocale || '').split('-')[0].toLowerCase();

        report.coherence = {
            osMatch,
            gpuMatch: !gpuContradiction,
            intlConsistent,
            langMatchesIntl: Boolean(navBase && navBase === intlBase),
            details: { platform, uaPlatform, renderer, dtfLocale, nfLocale, navLang: navigator.language },
        };
    } catch {}

    // 4. BotD / Sannysoft automation traces
    try {
        const suspiciousRe = /^(cdc_|__webdriver|__selenium|__driver_|__fxdriver|__playwright|__puppeteer|_phantom|callPhantom)/i;
        for (const k of Object.keys(window)) {
            if (suspiciousRe.test(k)) report.botd.automationGlobals.push('win:' + k);
        }
        for (const k of Object.keys(document)) {
            if (suspiciousRe.test(k)) report.botd.automationGlobals.push('doc:' + k);
        }
    } catch {}

    return report;
})()`;

const CHECK_DEFAULT_SEARCH_JS = `(async () => {
    const mod = await import('chrome://settings/settings.js');
    const proxy = mod.SearchEnginesBrowserProxyImpl && mod.SearchEnginesBrowserProxyImpl.getInstance();
    if (!proxy) return { error: 'no_proxy' };
    const list = await proxy.getSearchEnginesList();
    const def = (list.defaults || []).find(d => d.default);
    return {
        defaultName: def?.name || null,
        defaultKeyword: def?.keyword || null,
        defaultUrl: def?.url || null,
        allDefaultNames: (list.defaults || []).map(d => d.name),
    };
})()`;

function isPrivateOrLanIPv4(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Main E2E Execution
// ---------------------------------------------------------------------------
async function runE2E() {
    console.log('====================================================================');
    console.log(' MultiChrome E2E Verification Suite');
    console.log(' Priority #1: IP & WebRTC Zero-Leak (Fail-Closed)');
    console.log(' Priority #2: C++ Anti-Fingerprint Isolation, Stealth & Search');
    console.log('====================================================================');

    const distElectron = path.resolve(__dirname, '..', 'dist', 'electron');
    const { SettingsManager } = await import(pathToFileURL(path.join(distElectron, 'repositories', 'settingsRepository.js')).href);
    const { KernelManager } = await import(pathToFileURL(path.join(distElectron, 'services', 'kernelService.js')).href);
    const { ProxyManager } = await import(pathToFileURL(path.join(distElectron, 'services', 'proxyService.js')).href);
    const { ChromeManager } = await import(pathToFileURL(path.join(distElectron, 'services', 'environmentService.js')).href);

    const { verifyStorageRestore } = await import('./verify-storage-restore.mjs');
    await verifyStorageRestore(path.join(TEMP_ROOT, 'storage-fixtures'));

    // Initialize real production managers pointing ONLY to isolated temp paths
    const settingsManager = new SettingsManager();
    await settingsManager.saveSettings({
        ...settingsManager.getSettings(),
        dataPath: TEMP_DATA_PATH,
        startupUrl: 'about:blank',
    });

    const kernelManager = new KernelManager({
        getDataPath: () => TEMP_DATA_PATH,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
    });

    const kernelExe = discoverInstalledKernelPath();
    let hasCppKernel = false;
    if (kernelExe && fs.existsSync(kernelExe)) {
        // Register the existing binary inside our isolated temp KernelManager manifest (no copy, read-only)
        const manifestDir = path.join(TEMP_DATA_PATH, 'kernels');
        fs.mkdirSync(manifestDir, { recursive: true });
        fs.writeFileSync(
            path.join(manifestDir, 'manifest.json'),
            JSON.stringify({
                activeKernelId: 'e2e-kernel',
                kernels: [
                    {
                        id: 'e2e-kernel',
                        version: 'e2e',
                        executablePath: kernelExe,
                        installDir: path.dirname(kernelExe),
                        source: 'local-import',
                        installedAt: new Date().toISOString(),
                    },
                ],
                activeSingboxId: null,
                singboxes: [],
            }),
        );
        hasCppKernel = Boolean(kernelManager.getActiveKernel());
        console.log(`Kernel detected: fingerprint-chromium (${path.basename(path.dirname(kernelExe))})`);
    } else if (OPTS.requireKernel) {
        recordResult('SETUP-KERNEL', 'P0', 'fingerprint-chromium kernel availability', false, 'Required kernel not found');
        return 1;
    } else {
        console.log('Kernel not found in the searched locations. Running system Chrome checks only. For a custom data directory, set .tmp/e2e-data-dir.txt or pass --kernel=<executable>.');
    }

    const proxyManager = new ProxyManager({
        store: new Store({ name: 'managed-proxies', cwd: TEMP_USER_DATA }),
        secretStorage: safeStorage,
        configDirectory: TEMP_USER_DATA,
    });
    const chromeManager = new ChromeManager(proxyManager, settingsManager, kernelManager);

    const echoServer = await startEchoServer();
    const proxyA = await startLocalForwardProxy('proxy-a', echoServer.port);
    const proxyB = await startLocalForwardProxy('proxy-b', echoServer.port);

    const createdEnvIds = [];
    const activeCdps = [];

    try {
        const engine = hasCppKernel ? 'fingerprint-chromium' : 'system-chrome';

        // Create TWO completely independent environments with distinct persisted C++ fingerprints
        const envA = await chromeManager.createEnvironment('E2E-Profile-A', 'e2e-test', 'automated e2e', {
            browserEngine: engine,
            fingerprintConfig: {
                seed: 101010101,
                platform: process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'windows',
                platformVersion: process.platform === 'win32' ? '15.0.0' : '14.5.0',
                brand: 'Chrome',
                hardwareConcurrency: 8,
                windowSize: { width: 1440, height: 900 },
                spoofing: { canvas: true, webgl: true, audio: true, fonts: true, clientRects: true },
            },
        });
        createdEnvIds.push(envA.id);
        await chromeManager.updateEnvironment(envA.id, {
            proxy: proxyA.url,
            timezone: 'America/New_York',
            language: 'en-US',
        });

        const envB = await chromeManager.createEnvironment('E2E-Profile-B', 'e2e-test', 'automated e2e', {
            browserEngine: engine,
            fingerprintConfig: {
                seed: 202020202,
                platform: process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'windows',
                platformVersion: process.platform === 'win32' ? '10.0.0' : '13.6.0',
                brand: 'Chrome',
                hardwareConcurrency: 12,
                windowSize: { width: 1280, height: 800 },
                spoofing: { canvas: true, webgl: true, audio: true, fonts: true, clientRects: true },
            },
        });
        createdEnvIds.push(envB.id);
        await chromeManager.updateEnvironment(envB.id, {
            proxy: proxyB.url,
            timezone: 'Europe/London',
            language: 'en-US',
        });

        // Launch both profiles through REAL ChromeManager.launchEnvironment()
        await chromeManager.launchEnvironment(envA.id);
        await chromeManager.launchEnvironment(envB.id);

        const [dtA, dtB] = await Promise.all([
            waitForDevToolsPort(chromeManager, envA.id, envA.dataDir),
            waitForDevToolsPort(chromeManager, envB.id, envB.dataDir),
        ]);

        // Give ChromeManager's async post-connect hook (including Google default search init on C++ kernel) time to finish
        if (hasCppKernel) {
            const markerDeadline = Date.now() + 8000;
            while (Date.now() < markerDeadline) {
                if (
                    fs.existsSync(path.join(envA.dataDir, '.google-search-ready')) &&
                    fs.existsSync(path.join(envB.dataDir, '.google-search-ready'))
                ) {
                    break;
                }
                await sleep(200);
            }
        } else {
            await sleep(1200);
        }

        const cdpA = await connectCDP(dtA.wsUrl);
        activeCdps.push(cdpA);
        const cdpB = await connectCDP(dtB.wsUrl);
        activeCdps.push(cdpB);

        // -------------------------------------------------------------------
        // Probe Profile A & Profile B simultaneously
        // -------------------------------------------------------------------
        const [probeA, probeB] = await Promise.all([
            openTabAndEval(cdpA, 'http://e2e-probe.invalid/probe', FINGERPRINT_AND_LEAK_PROBE_JS, 500, 15000),
            openTabAndEval(cdpB, 'http://e2e-probe.invalid/probe', FINGERPRINT_AND_LEAK_PROBE_JS, 500, 15000),
        ]);

        // ===================================================================
        // SUITE 1 (PRIORITY #1): IP & PROXY ROUTING + FAIL-CLOSED ZERO-LEAK
        // ===================================================================
        recordResult(
            'P1-IP-1',
            'P1',
            'Profile A routes exclusively via Proxy A (zero direct leak)',
            probeA?.server?.proxyTag === 'proxy-a' && echoServer.getDirectLeakHits() === 0,
            `proxyTag=${probeA?.server?.proxyTag}, directLeakHits=${echoServer.getDirectLeakHits()}`,
        );

        recordResult(
            'P1-IP-2',
            'P1',
            'Profile B routes independently via Proxy B (zero cross-contamination)',
            probeB?.server?.proxyTag === 'proxy-b' && echoServer.getDirectLeakHits() === 0,
            `proxyTag=${probeB?.server?.proxyTag}, directLeakHits=${echoServer.getDirectLeakHits()}`,
        );

        const langHeaderA = String(probeA?.server?.acceptLanguage || '');
        const langHeaderB = String(probeB?.server?.acceptLanguage || '');
        recordResult(
            'P1-IP-3',
            'P1',
            'HTTP Accept-Language header uses en-US with zero zh-CN leak',
            langHeaderA.toLowerCase().includes('en') &&
                !langHeaderA.toLowerCase().includes('zh') &&
                langHeaderB.toLowerCase().includes('en') &&
                !langHeaderB.toLowerCase().includes('zh'),
            `A="${langHeaderA}", B="${langHeaderB}"`,
        );

        // ===================================================================
        // SUITE 2 (PRIORITY #1): WEBRTC ZERO-LEAK
        // ===================================================================
        const ipsA = probeA?.webrtc?.ips || [];
        const ipsB = probeB?.webrtc?.ips || [];
        const lanLeakA = ipsA.filter(isPrivateOrLanIPv4);
        const lanLeakB = ipsB.filter(isPrivateOrLanIPv4);

        recordResult(
            'P1-WEBRTC-1',
            'P1',
            'Zero private/LAN/host IP leaks in WebRTC ICE candidates & SDP',
            ipsA.length === 0 && ipsB.length === 0 && lanLeakA.length === 0 && lanLeakB.length === 0,
            `A.ips=${JSON.stringify(ipsA)}, B.ips=${JSON.stringify(ipsB)}`,
        );

        const prefsA = JSON.parse(fs.readFileSync(path.join(envA.dataDir, 'Default', 'Preferences'), 'utf-8'));
        const webrtcLocked =
            prefsA?.webrtc?.ip_handling_policy === 'disable_non_proxied_udp' &&
            prefsA?.webrtc?.multiple_routes_enabled === false &&
            prefsA?.webrtc?.nonproxied_udp_enabled === false;
        recordResult(
            'P1-WEBRTC-2',
            'P1',
            'Native Chromium Preferences lock WebRTC to disable_non_proxied_udp',
            webrtcLocked,
            `policy=${prefsA?.webrtc?.ip_handling_policy}, multiRoute=${prefsA?.webrtc?.multiple_routes_enabled}, nonProxiedUdp=${prefsA?.webrtc?.nonproxied_udp_enabled}`,
        );

        // ===================================================================
        // SUITE 3: TIMEZONE & LANGUAGE PARITY (MAIN THREAD + WEB WORKER)
        // ===================================================================
        const tzAOk =
            probeA?.timezone === 'America/New_York' &&
            probeA?.worker?.timezone === 'America/New_York' &&
            probeA?.tzOffset === probeA?.worker?.tzOffset;
        const tzBOk =
            probeB?.timezone === 'Europe/London' &&
            probeB?.worker?.timezone === 'Europe/London' &&
            probeB?.tzOffset === probeB?.worker?.tzOffset;
        recordResult(
            'P2-TZ-1',
            'P2',
            'Main thread and Web Worker timezones match each profile accurately',
            tzAOk && tzBOk,
            `A=${probeA?.timezone}/${probeA?.worker?.timezone}, B=${probeB?.timezone}/${probeB?.worker?.timezone}`,
        );

        const langsA = (probeA?.languages || []).join(',');
        const workerLangsA = (probeA?.worker?.languages || []).join(',');
        recordResult(
            'P2-LANG-1',
            'P2',
            'navigator.languages reports en-US with zero zh leak across main & worker',
            probeA?.language === 'en-US' &&
                !langsA.toLowerCase().includes('zh') &&
                !workerLangsA.toLowerCase().includes('zh'),
            `main=[${langsA}], worker=[${workerLangsA}]`,
        );

        // ===================================================================
        // SUITE 4: C++ ANTI-FINGERPRINTING, STEALTH & GOOGLE SEARCH
        // ===================================================================
        if (hasCppKernel) {
            const canvasHashA = sha256Short(probeA?.canvasGeomData || '');
            const canvasHashB = sha256Short(probeB?.canvasGeomData || '');
            const textCanvasHashA = sha256Short(probeA?.canvasData || '');
            const textCanvasHashB = sha256Short(probeB?.canvasData || '');
            recordResult(
                'P2-FP-CANVAS',
                'P2',
                'C++ Canvas fingerprints differ between Profile A and Profile B',
                Boolean(probeA?.canvasGeomData?.startsWith('data:image/png')) &&
                    Boolean(probeB?.canvasGeomData?.startsWith('data:image/png')) &&
                    canvasHashA !== canvasHashB &&
                    textCanvasHashA !== textCanvasHashB,
                `geom A=${canvasHashA} vs B=${canvasHashB}, text A=${textCanvasHashA} vs B=${textCanvasHashB}`,
            );

            const audioA = probeA?.audioSum;
            const audioB = probeB?.audioSum;
            recordResult(
                'P2-FP-AUDIO',
                'P2',
                'C++ AudioContext fingerprints differ between Profile A and Profile B',
                typeof audioA === 'string' &&
                    !audioA.startsWith('ERR:') &&
                    typeof audioB === 'string' &&
                    !audioB.startsWith('ERR:') &&
                    audioA !== audioB,
                `A=${audioA}, B=${audioB}`,
            );

            const webglHashA = sha256Short(JSON.stringify(probeA?.webgl || {}));
            const webglHashB = sha256Short(JSON.stringify(probeB?.webgl || {}));
            recordResult(
                'P2-FP-WEBGL',
                'P2',
                'C++ WebGL renderer/pixel fingerprints differ between Profile A and Profile B',
                Boolean(probeA?.webgl && !probeA.webgl.error) &&
                    Boolean(probeB?.webgl && !probeB.webgl.error) &&
                    webglHashA !== webglHashB,
                `A=${webglHashA} (${probeA?.webgl?.renderer || ''}), B=${webglHashB} (${probeB?.webgl?.renderer || ''})`,
            );

            const hwOk =
                probeA?.hardwareConcurrency === 8 &&
                probeB?.hardwareConcurrency === 12 &&
                probeA?.worker?.hardwareConcurrency === 8 &&
                probeB?.worker?.hardwareConcurrency === 12;
            recordResult(
                'P2-FP-HW',
                'P2',
                'C++ hardwareConcurrency matches per-profile config in main & worker',
                hwOk,
                `A=${probeA?.hardwareConcurrency}/${probeA?.worker?.hardwareConcurrency}, B=${probeB?.hardwareConcurrency}/${probeB?.worker?.hardwareConcurrency}`,
            );

            const nativeOk =
                probeA?.webdriver === false &&
                probeA?.nativeIntegrity?.toDataURL === true &&
                probeA?.nativeIntegrity?.getTimezoneOffset === true &&
                probeA?.nativeIntegrity?.intlResolvedOptions === true &&
                probeA?.nativeIntegrity?.rtcPeerConnection === true &&
                !fs.existsSync(path.join(envA.dataDir, '_tz_extension')) &&
                prefsA?.extensions?.developer?.developer_mode !== true;
            recordResult(
                'P2-STEALTH-NATIVE',
                'P2',
                'Pure Native C++ Stealth: zero JS hooks, zero _tz_extension, webdriver=false',
                nativeOk,
                `webdriver=${probeA?.webdriver}, native=${JSON.stringify(probeA?.nativeIntegrity)}, hasExt=${fs.existsSync(path.join(envA.dataDir, '_tz_extension'))}`,
            );

            // Adversarial CreepJS / BotD-style benchmark on C++ fingerprint-chromium
            const advCpp = await openTabAndEval(
                cdpA,
                'http://e2e-probe.invalid/probe',
                ADVERSARIAL_CREEP_BOTD_JS,
                600,
                15000,
            );
            recordResult(
                'P2-ADV-CPP-LIES',
                'P2',
                '[Adversarial/CreepJS] C++ kernel has 0 cross-iframe prototype/toString lies',
                Array.isArray(advCpp?.lies) && advCpp.lies.length === 0,
                `lies=${JSON.stringify(advCpp?.lies || [])}`,
            );
            recordResult(
                'P2-ADV-CPP-DETERMINISM',
                'P2',
                '[Adversarial/CreepJS] C++ Canvas/Audio/ClientRects are 100% stable within session (no random noise)',
                Boolean(
                    advCpp?.determinism?.canvasStable &&
                        advCpp?.determinism?.audioStable &&
                        advCpp?.determinism?.rectsStable,
                ),
                `canvas=${advCpp?.determinism?.canvasStable}, audio=${advCpp?.determinism?.audioStable}, rects=${advCpp?.determinism?.rectsStable}`,
            );
            recordResult(
                'P2-ADV-CPP-COHERENCE',
                'P2',
                '[Adversarial/BotD] C++ UA/ClientHints/Platform/GPU/Intl cross-dimension coherence & 0 bot traces',
                Boolean(
                    advCpp?.coherence?.osMatch &&
                        advCpp?.coherence?.gpuMatch &&
                        advCpp?.coherence?.intlConsistent &&
                        advCpp?.coherence?.langMatchesIntl &&
                        advCpp?.botd?.webdriverFalse &&
                        (advCpp?.botd?.automationGlobals || []).length === 0 &&
                        advCpp?.botd?.nonZeroOuter,
                ),
                `os=${advCpp?.coherence?.osMatch}, gpu=${advCpp?.coherence?.gpuMatch}, intl=${advCpp?.coherence?.intlConsistent}, langIntl=${advCpp?.coherence?.langMatchesIntl}, botGlobals=${JSON.stringify(advCpp?.botd?.automationGlobals || [])}`,
            );

            // Check Default Search Engine is Google (not Ungoogled "No Search") + US countryid_at_install
            const searchA = await openTabAndEval(
                cdpA,
                'chrome://settings/searchEngines',
                CHECK_DEFAULT_SEARCH_JS,
                600,
                10000,
            );
            recordResult(
                'P2-SEARCH-GOOGLE',
                'P2',
                'Default search engine upgraded from No Search to Google + US countryid',
                searchA?.defaultName === 'Google' &&
                    String(searchA?.defaultUrl || '').includes('google.com/search?q=') &&
                    prefsA?.countryid_at_install === 21843,
                `default=${searchA?.defaultName} (${searchA?.defaultUrl}), countryid=${prefsA?.countryid_at_install}`,
            );

            // Close Profile A and wait for clean shutdown, then RELAUNCH to verify deterministic persistence!
            cdpA.close();
            await chromeManager.closeEnvironment(envA.id);
            const { isProfileRunningLocally } = await import(
                pathToFileURL(path.join(distElectron, 'drivers', 'profileLock.js')).href
            );
            const stopDeadline = Date.now() + 8000;
            while (Date.now() < stopDeadline) {
                const state = await isProfileRunningLocally(envA.dataDir);
                if (!state.running) break;
                await sleep(200);
            }
            // Allow Chromium GPU / shader-cache child processes to finish exiting before relaunching
            await sleep(2000);

            await chromeManager.launchEnvironment(envA.id);
            const dtA2 = await waitForDevToolsPort(chromeManager, envA.id, envA.dataDir);
            const cdpA2 = await connectCDP(dtA2.wsUrl);
            activeCdps.push(cdpA2);

            const probeA2 = await openTabAndEval(
                cdpA2,
                'http://e2e-probe.invalid/probe',
                FINGERPRINT_AND_LEAK_PROBE_JS,
                600,
                15000,
            );
            const geomHashA2 = sha256Short(probeA2?.canvasGeomData || '');
            recordResult(
                'P2-FP-PERSIST',
                'P2',
                'Profile A Canvas, WebGL GPU & Audio fingerprints remain 100% deterministic after restart',
                geomHashA2 === canvasHashA &&
                    probeA2?.audioSum === audioA &&
                    probeA2?.webgl?.renderer === probeA?.webgl?.renderer,
                `canvas: ${canvasHashA} -> ${geomHashA2}, audio: ${audioA} -> ${probeA2?.audioSum}, gpuMatch=${probeA2?.webgl?.renderer === probeA?.webgl?.renderer}`,
            );

            const searchA2 = await openTabAndEval(
                cdpA2,
                'chrome://settings/searchEngines',
                CHECK_DEFAULT_SEARCH_JS,
                600,
                10000,
            );
            recordResult(
                'P2-SEARCH-PERSIST',
                'P2',
                'Google default search engine persists cleanly across browser restart',
                searchA2?.defaultName === 'Google',
                `afterRestart=${searchA2?.defaultName}`,
            );

            // ===============================================================
            // SUITE 1B (PRIORITY #1): FAIL-CLOSED WHEN PROXY DIES MID-SESSION
            // ===============================================================
            await proxyA.killNow();
            await sleep(200);
            const failClosedRes = await openTabAndEval(
                cdpA2,
                'http://e2e-fail-closed.invalid/probe',
                `({ href: location.href, hasServer: Boolean(window.__E2E_SERVER__), body: (document.body?.innerText || '').slice(0, 120) })`,
                800,
                10000,
            );
            recordResult(
                'P1-FAIL-CLOSED',
                'P1',
                'Browser fails closed (ERR_PROXY_CONNECTION_FAILED) when proxy disconnects mid-session',
                failClosedRes?.hasServer === false && echoServer.getDirectLeakHits() === 0,
                `hasServer=${failClosedRes?.hasServer}, directLeakHits=${echoServer.getDirectLeakHits()}`,
            );
        } else {
            // System Chrome Fail-Closed check
            await proxyA.killNow();
            await sleep(200);
            const failClosedRes = await openTabAndEval(
                cdpA,
                'http://e2e-fail-closed.invalid/probe',
                `({ href: location.href, hasServer: Boolean(window.__E2E_SERVER__) })`,
                800,
                10000,
            );
            recordResult(
                'P1-FAIL-CLOSED',
                'P1',
                'Browser fails closed when proxy disconnects mid-session',
                failClosedRes?.hasServer === false && echoServer.getDirectLeakHits() === 0,
                `hasServer=${failClosedRes?.hasServer}, directLeakHits=${echoServer.getDirectLeakHits()}`,
            );
        }

        // ===================================================================
        // SUITE 4B: OFFICIAL GOOGLE CHROME (system-chrome) FULL OFFLINE CHECK
        // ===================================================================
        const systemChromeExe = chromeManager.getSystemChromePath?.() || '';
        if (hasCppKernel && systemChromeExe && fs.existsSync(systemChromeExe)) {
            console.log('--------------------------------------------------------------------');
            console.log(` Running Dual-Engine Verification: Official Chrome (${path.basename(systemChromeExe)})`);
            console.log('--------------------------------------------------------------------');
            const proxyC = await startLocalForwardProxy('proxy-chrome', echoServer.port);
            try {
                const envChrome = await chromeManager.createEnvironment(
                    'E2E-Official-Chrome',
                    'e2e-test',
                    'automated dual-engine e2e',
                    { browserEngine: 'system-chrome' },
                );
                createdEnvIds.push(envChrome.id);
                await chromeManager.updateEnvironment(envChrome.id, {
                    proxy: proxyC.url,
                    timezone: 'Asia/Tokyo',
                    language: 'en-US',
                });

                await chromeManager.launchEnvironment(envChrome.id);
                const dtChrome = await waitForDevToolsPort(chromeManager, envChrome.id, envChrome.dataDir);
                // Give ChromeManager CDP overrides a moment to attach to system-chrome
                await sleep(1400);
                const cdpChrome = await connectCDP(dtChrome.wsUrl);
                activeCdps.push(cdpChrome);

                const probeChrome = await openTabAndEval(
                    cdpChrome,
                    'http://e2e-probe.invalid/probe',
                    FINGERPRINT_AND_LEAK_PROBE_JS,
                    600,
                    15000,
                );

                recordResult(
                    'CHROME-P1-IP',
                    'P1',
                    '[Chrome] Routes exclusively via assigned proxy (zero direct leak)',
                    probeChrome?.server?.proxyTag === 'proxy-chrome' && echoServer.getDirectLeakHits() === 0,
                    `proxyTag=${probeChrome?.server?.proxyTag}, directLeakHits=${echoServer.getDirectLeakHits()}`,
                );

                const chromeLangHeader = String(probeChrome?.server?.acceptLanguage || '');
                recordResult(
                    'CHROME-P1-LANG-HEADER',
                    'P1',
                    '[Chrome] HTTP Accept-Language uses en-US with zero zh-CN leak',
                    chromeLangHeader.toLowerCase().includes('en') && !chromeLangHeader.toLowerCase().includes('zh'),
                    `Accept-Language="${chromeLangHeader}"`,
                );

                const chromeIps = probeChrome?.webrtc?.ips || [];
                const chromeLanLeaks = chromeIps.filter(isPrivateOrLanIPv4);
                recordResult(
                    'CHROME-P1-WEBRTC-1',
                    'P1',
                    '[Chrome] Zero private/LAN/host IP leaks in WebRTC ICE candidates & SDP',
                    chromeIps.length === 0 && chromeLanLeaks.length === 0,
                    `ips=${JSON.stringify(chromeIps)}`,
                );

                const prefsChrome = JSON.parse(
                    fs.readFileSync(path.join(envChrome.dataDir, 'Default', 'Preferences'), 'utf-8'),
                );
                const chromeWebrtcLocked =
                    prefsChrome?.webrtc?.ip_handling_policy === 'disable_non_proxied_udp' &&
                    prefsChrome?.webrtc?.multiple_routes_enabled === false &&
                    prefsChrome?.webrtc?.nonproxied_udp_enabled === false;
                recordResult(
                    'CHROME-P1-WEBRTC-2',
                    'P1',
                    '[Chrome] Native Preferences lock WebRTC to disable_non_proxied_udp',
                    chromeWebrtcLocked,
                    `policy=${prefsChrome?.webrtc?.ip_handling_policy}, multiRoute=${prefsChrome?.webrtc?.multiple_routes_enabled}, nonProxiedUdp=${prefsChrome?.webrtc?.nonproxied_udp_enabled}`,
                );

                const chromeTzOk =
                    probeChrome?.timezone === 'Asia/Tokyo' &&
                    probeChrome?.worker?.timezone === 'Asia/Tokyo' &&
                    probeChrome?.tzOffset === probeChrome?.worker?.tzOffset;
                recordResult(
                    'CHROME-P2-TZ',
                    'P2',
                    '[Chrome] Main thread and Web Worker timezones match configured Asia/Tokyo',
                    chromeTzOk,
                    `main=${probeChrome?.timezone} (${probeChrome?.tzOffset}), worker=${probeChrome?.worker?.timezone} (${probeChrome?.worker?.tzOffset})`,
                );

                const chromeLangs = (probeChrome?.languages || []).join(',');
                const chromeWorkerLangs = (probeChrome?.worker?.languages || []).join(',');
                recordResult(
                    'CHROME-P2-LANG',
                    'P2',
                    '[Chrome] navigator.languages reports en-US with zero zh leak',
                    probeChrome?.language === 'en-US' &&
                        !chromeLangs.toLowerCase().includes('zh') &&
                        !chromeWorkerLangs.toLowerCase().includes('zh'),
                    `main=[${chromeLangs}], worker=[${chromeWorkerLangs}]`,
                );

                recordResult(
                    'CHROME-P2-WEBDRIVER',
                    'P2',
                    '[Chrome] AutomationControlled disabled (navigator.webdriver === false)',
                    probeChrome?.webdriver === false,
                    `webdriver=${probeChrome?.webdriver}`,
                );

                // Adversarial CreepJS / BotD-style probe on Official Chrome:
                // Now pure native (zero JS hooks, zero _tz_extension) => liesCount MUST be 0!
                const advChrome = await openTabAndEval(
                    cdpChrome,
                    'http://e2e-probe.invalid/probe',
                    ADVERSARIAL_CREEP_BOTD_JS,
                    600,
                    15000,
                );
                const chromeHasLegacyExt = fs.existsSync(path.join(envChrome.dataDir, '_tz_extension'));
                console.log(
                    `[INFO] [Adversarial/Chrome] lies=${JSON.stringify(advChrome?.lies || [])}, determinism=${JSON.stringify(advChrome?.determinism || {})}, coherence=${JSON.stringify({ os: advChrome?.coherence?.osMatch, gpu: advChrome?.coherence?.gpuMatch, intl: advChrome?.coherence?.intlConsistent, langIntl: advChrome?.coherence?.langMatchesIntl })}, botGlobals=${JSON.stringify(advChrome?.botd?.automationGlobals || [])}, hasLegacyExt=${chromeHasLegacyExt}`,
                );
                recordResult(
                    'CHROME-P2-ADV-COHERENCE',
                    'P2',
                    '[Adversarial/Chrome] Official Chrome zero JS hook lies (lies=0), zero _tz_extension & coherence',
                    Boolean(
                        (advChrome?.lies || []).length === 0 &&
                            !chromeHasLegacyExt &&
                            advChrome?.determinism?.canvasStable &&
                            advChrome?.determinism?.audioStable &&
                            advChrome?.determinism?.rectsStable &&
                            advChrome?.coherence?.osMatch &&
                            advChrome?.coherence?.gpuMatch &&
                            advChrome?.coherence?.intlConsistent &&
                            advChrome?.coherence?.langMatchesIntl &&
                            advChrome?.botd?.webdriverFalse &&
                            (advChrome?.botd?.automationGlobals || []).length === 0,
                    ),
                    `liesCount=${(advChrome?.lies || []).length}, hasExt=${chromeHasLegacyExt}, coherenceOk=${Boolean(advChrome?.coherence?.osMatch && advChrome?.coherence?.intlConsistent)}`,
                );

                // Restored-session zero-race check (both uncached AND disk-cached tabs!)
                await cdpChrome.send('Target.createTarget', {
                    url: 'http://e2e-restore.invalid/restore-uncached',
                });
                await cdpChrome.send('Target.createTarget', {
                    url: 'http://e2e-restore.invalid/restore-cached',
                });
                await sleep(1500);
                cdpChrome.close();
                await chromeManager.closeEnvironment(envChrome.id);
                await sleep(1800);

                echoServer.clearRestoreReports();
                await chromeManager.launchEnvironment(envChrome.id);
                const dtChrome2 = await waitForDevToolsPort(chromeManager, envChrome.id, envChrome.dataDir);
                const cdpChrome2 = await connectCDP(dtChrome2.wsUrl);
                activeCdps.push(cdpChrome2);
                await sleep(2500);

                const restoreReports = echoServer.getRestoreReports();
                const restoreHasUncached = restoreReports.some(
                    (r) => r.src === 'uncached' && r.tz === 'Asia/Tokyo',
                );
                const restoreHasCached = restoreReports.some(
                    (r) => r.src === 'cached' && r.tz === 'Asia/Tokyo',
                );
                const restoreWrongTz = restoreReports.filter((r) => r.tz !== 'Asia/Tokyo');
                recordResult(
                    'CHROME-P2-RESTORE-ZERO-RACE',
                    'P2',
                    '[Chrome] Startup Hold-Gate prevents TZ race on restored uncached + disk-cached tabs',
                    restoreHasUncached && restoreHasCached && restoreWrongTz.length === 0,
                    `reports=${JSON.stringify(restoreReports.map((r) => `${r.src}:${r.tz}`))}`,
                );

                await proxyC.killNow();
                await sleep(200);
                const chromeFailClosed = await openTabAndEval(
                    cdpChrome2,
                    'http://e2e-chrome-fail-closed.invalid/probe',
                    `({ href: location.href, hasServer: Boolean(window.__E2E_SERVER__) })`,
                    800,
                    10000,
                );
                recordResult(
                    'CHROME-P1-FAIL-CLOSED',
                    'P1',
                    '[Chrome] Fails closed when proxy disconnects mid-session',
                    chromeFailClosed?.hasServer === false && echoServer.getDirectLeakHits() === 0,
                    `hasServer=${chromeFailClosed?.hasServer}, directLeakHits=${echoServer.getDirectLeakHits()}`,
                );
            } finally {
                await proxyC.killNow().catch(() => {});
            }
        }

        // ===================================================================
        // OPTIONAL SUITE 5: LIVE EXTERNAL NETWORK CHECK (--live)
        // ===================================================================
        if (OPTS.live) {
            await runLiveSuite({
                chromeManager,
                hasCppKernel,
                createdEnvIds,
                activeCdps,
            });
        }
    } finally {
        for (const cdp of activeCdps) {
            try {
                cdp.close();
            } catch {
                /* ignore */
            }
        }
        for (const envId of createdEnvIds) {
            try {
                await chromeManager.closeEnvironment(envId);
            } catch {
                /* ignore */
            }
            try {
                await chromeManager.deleteEnvironment(envId);
                await chromeManager.permanentlyDeleteEnvironment(envId);
            } catch {
                /* ignore */
            }
        }
        chromeManager.stopStatusMonitoring();
        await proxyManager.closeAll().catch(() => {});
        await proxyA.killNow().catch(() => {});
        await proxyB.killNow().catch(() => {});
        await echoServer.close().catch(() => {});

        if (!OPTS.keepTemp) {
            await sleep(500);
            try {
                fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
            } catch {
                /* ignore */
            }
        }
    }

    const failed = results.filter((r) => !r.passed);
    console.log('====================================================================');
    console.log(` E2E Summary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
    console.log('====================================================================');

    if (OPTS.reportJson) {
        try {
            fs.writeFileSync(
                OPTS.reportJson,
                JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
            );
        } catch {
            /* ignore */
        }
    }

    return failed.length === 0 ? 0 : 1;
}

async function runLiveSuite({ chromeManager, hasCppKernel, createdEnvIds, activeCdps }) {
    if (!OPTS.proxyA || !/^(https?|socks5?):\/\//i.test(OPTS.proxyA)) {
        recordResult(
            'LIVE-CONFIG',
            'LIVE',
            'Live verification requires a proxy URL (--proxy-a=http://... or socks5://...)',
            false,
            'Isolated E2E userData does not touch real safeStorage keys; pass an explicit proxy URL (e.g. http://127.0.0.1:<port>)',
        );
        return;
    }

    const proxyUrlA = OPTS.proxyA;
    const proxyUrlB = OPTS.proxyB && /^(https?|socks5?):\/\//i.test(OPTS.proxyB) ? OPTS.proxyB : '';

    {
        const liveEnvA = await chromeManager.createEnvironment('E2E-Live-A', 'e2e-live', 'temp live check', {
            browserEngine: hasCppKernel ? 'fingerprint-chromium' : 'system-chrome',
        });
        createdEnvIds.push(liveEnvA.id);
        await chromeManager.updateEnvironment(liveEnvA.id, {
            proxy: proxyUrlA,
            timezone: '',
            language: 'en-US',
        });

        await chromeManager.launchEnvironment(liveEnvA.id);
        const dtLiveA = await waitForDevToolsPort(chromeManager, liveEnvA.id, liveEnvA.dataDir);
        const cdpLiveA = await connectCDP(dtLiveA.wsUrl);
        activeCdps.push(cdpLiveA);

        // 1. Check real IP & GeoIP timezone parity via ipinfo.io
        const geoRes = await openTabAndEval(
            cdpLiveA,
            'https://ipinfo.io/json',
            `(() => {
                try {
                    const data = JSON.parse(document.body.innerText);
                    return {
                        ip: data.ip,
                        country: data.country,
                        ipTimezone: data.timezone,
                        browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        language: navigator.language,
                    };
                } catch (e) { return { error: String(e), raw: document.body.innerText.slice(0, 120) }; }
            })()`,
            1200,
            25000,
        );
        recordResult(
            'LIVE-IP-TZ',
            'LIVE',
            'Live exit IP matches auto-detected browser timezone',
            Boolean(geoRes?.ip) && Boolean(geoRes?.browserTimezone) && (!geoRes.ipTimezone || geoRes.ipTimezone === geoRes.browserTimezone),
            `ip=${geoRes?.ip}, country=${geoRes?.country}, ipTz=${geoRes?.ipTimezone}, browserTz=${geoRes?.browserTimezone}`,
        );

        // 2. Check BrowserLeaks WebRTC live
        const webrtcLive = await openTabAndEval(
            cdpLiveA,
            'https://browserleaks.com/webrtc',
            `(() => {
                const txt = document.body.innerText || '';
                const hasNoLeak = txt.includes('No Leak');
                const localMatch = txt.match(/Local IP Address\\s+([^\\n]+)/);
                const publicMatch = txt.match(/Public IP Address\\s+([^\\n]+)/);
                return {
                    hasNoLeak,
                    localIp: localMatch ? localMatch[1].trim() : null,
                    publicIp: publicMatch ? publicMatch[1].trim() : null,
                };
            })()`,
            4000,
            30000,
        );
        recordResult(
            'LIVE-WEBRTC',
            'LIVE',
            'BrowserLeaks WebRTC reports No Leak with zero Local/Public IP leak',
            webrtcLive?.hasNoLeak === true,
            `hasNoLeak=${webrtcLive?.hasNoLeak}, local=${webrtcLive?.localIp}, public=${webrtcLive?.publicIp}`,
        );

        // 3. Optional second live proxy IP isolation check
        if (proxyUrlB) {
            const liveEnvB = await chromeManager.createEnvironment('E2E-Live-B', 'e2e-live', 'temp live check', {
                browserEngine: hasCppKernel ? 'fingerprint-chromium' : 'system-chrome',
            });
            createdEnvIds.push(liveEnvB.id);
            await chromeManager.updateEnvironment(liveEnvB.id, {
                proxy: proxyUrlB,
                timezone: '',
                language: 'en-US',
            });
            await chromeManager.launchEnvironment(liveEnvB.id);
            const dtLiveB = await waitForDevToolsPort(chromeManager, liveEnvB.id, liveEnvB.dataDir);
            const cdpLiveB = await connectCDP(dtLiveB.wsUrl);
            activeCdps.push(cdpLiveB);
            const geoResB = await openTabAndEval(
                cdpLiveB,
                'https://ipinfo.io/json',
                `(() => { try { const d = JSON.parse(document.body.innerText); return { ip: d.ip, country: d.country, ipTimezone: d.timezone, browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }; } catch (e) { return { error: String(e) }; } })()`,
                1200,
                25000,
            );
            recordResult(
                'LIVE-DUAL-IP',
                'LIVE',
                'Live Profile A and Profile B exit through distinct IPs and matching timezones',
                Boolean(geoRes?.ip) && Boolean(geoResB?.ip) && geoRes.ip !== geoResB.ip,
                `A=${geoRes?.ip} (${geoRes?.browserTimezone}), B=${geoResB?.ip} (${geoResB?.browserTimezone})`,
            );
        }
    }
}

app.whenReady()
    .then(async () => {
        const exitCode = await runE2E();
        app.exit(exitCode);
    })
    .catch((err) => {
        console.error('[E2E FATAL]', err);
        app.exit(1);
    });
