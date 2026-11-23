#!/usr/bin/env node
/**
 * MultiChrome Live External Fingerprint Audit Runner (`npm run audit:live`)
 *
 * Launches specified local profile(s) through their configured proxy and visits
 * real external fingerprint/leak checkers (CreepJS, BrowserScan, BrowserLeaks WebRTC,
 * PixelScan). Intended for manual on-demand verification after kernel/fingerprint/proxy
 * changes — NOT part of offline CI.
 *
 * Usage:
 *   npm run audit:live -- --env="Profile-1,Profile-2"
 *   npm run audit:live -- --proxy="MyProxy"                          # 默认双内核分别测试（C++ 隐私内核 + 系统 Chrome 内核）
 *   npm run audit:live -- --proxy="MyProxy" --engine=fingerprint-chromium
 *   npm run audit:live -- --proxy="MyProxy" --engine=system-chrome
 *   npm run audit:live -- --proxy="MyProxy" --sites=creepjs,browserscan,browserleaks
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
