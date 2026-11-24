#!/usr/bin/env node
/**
 * MultiChrome Live External Fingerprint Audit Runner (`npm run audit:live`)
 *
 * Launches specified local profile(s) or temporary dual-engine profiles simultaneously
 * via MultiChrome's loopback MCP + Guarded CDP server, tiles all browser windows side-by-side
 * on screen, and audits real external fingerprint/leak checkers concurrently
 * (CreepJS, BrowserScan, BrowserLeaks WebRTC, PixelScan).
 * Intended for manual on-demand verification — NOT part of offline CI.
 *
 * Usage:
 *   npm run audit:live -- --proxy="MyProxy"                          # 默认 MCP 并行拉起双内核同屏实测（C++ 隐私内核 + 系统 Chrome）
 *   npm run audit:live -- --proxy="ProxyA,ProxyB"                    # MCP 并行拉起 4 窗口（2 代理 × 双内核）宫格平铺同时实测
 *   npm run audit:live -- --auto-proxies=2                           # 自动挑选本地 2 个可用内置代理并行拉起 4 窗口同时实测
 *   npm run audit:live -- --env="Profile-1,Profile-2"                # MCP 并行拉起多个本地环境同时实测
 *   npm run audit:live -- --proxy="MyProxy" --engine=fingerprint-chromium
 *   npm run audit:live -- --proxy="MyProxy" --engine=system-chrome
 *   npm run audit:live -- --proxy="MyProxy" --serial                 # 可选串行逐窗口模式
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const entryScript = path.join(__dirname, 'audit-live-sites-electron.cjs');

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [entryScript, ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: childEnv,
});

child.on('error', (err) => {
    console.error('[audit:live] Failed to launch Electron:', err);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        console.error(`[audit:live] Terminated by signal: ${signal}`);
        process.exit(1);
    }
    process.exit(code ?? 1);
});
