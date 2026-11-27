#!/usr/bin/env node
/**
 * MultiChrome End-to-End Verification Runner (`npm run test:e2e`)
 *
 * Compiles the Electron main process (unless --no-build is passed) and runs the
 * isolated E2E verification harness inside Electron, verifying:
 *   Priority #1: Fail-Closed IP / Proxy routing & WebRTC zero-leak
 *   Priority #2: C++ Anti-Fingerprinting isolation, deterministic persistence,
 *                Pure Native Stealth integrity, Timezone/Language parity, and
 *                Google default search engine configuration.
 *
 * Optional flags forwarded to scripts/e2e-electron.cjs:
 *   --no-build               Skip `npm run build:electron`
 *   --kernel=<path>          Explicit path to fingerprint-chromium executable
 *   --require-kernel         Fail if fingerprint-chromium is not installed
 *   --live                   Also run optional live external network checks
 *   --proxy-a=<proxyUrl>     Proxy A URL for --live mode (e.g. http://127.0.0.1:10808)
 *   --proxy-b=<proxyUrl>     Optional second proxy URL for --live dual-IP check
 *   --report=<path.json>     Save structured JSON test report
 */

import path from 'node:path';
import './require-browser-supervisor.cjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const skipBuild = rawArgs.includes('--no-build');
const forwardedArgs = rawArgs.filter((a) => a !== '--no-build');

if (!skipBuild) {
    console.log('[E2E] Building Electron main process (npm run build:electron)...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const buildRes = spawnSync(npmCmd, ['run', 'build:electron'], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (buildRes.status !== 0) {
        console.error('[E2E] build:electron failed.');
        process.exit(buildRes.status || 1);
    }
}

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const entryScript = path.join(__dirname, 'e2e-electron.cjs');

const childEnv = { ...process.env };
// Ensure Electron runs as Electron (not Node) even if parent set ELECTRON_RUN_AS_NODE
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [entryScript, ...forwardedArgs], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: childEnv,
});

child.on('error', (err) => {
    console.error('[E2E] Failed to launch Electron runner:', err);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        console.error(`[E2E] Runner terminated by signal: ${signal}`);
        process.exit(1);
    }
    process.exit(code ?? 1);
});
