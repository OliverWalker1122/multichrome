import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const scripts = path.dirname(fileURLToPath(import.meta.url));
const entries = new Map([['e2e', 'e2e-verify.mjs'], ['ui', 'e2e-ui-suite.mjs'], ['live', 'audit-live-sites.mjs']]);
function run(directory) {
    const entry = entries.get(process.argv[2]);
    if (!entry) throw new Error('Unknown browser test suite');
    const child = spawn(process.execPath, [path.join(scripts, entry), ...process.argv.slice(3)], {
        stdio: 'inherit',
        env: directory ? { ...process.env, MULTICHROME_TEST_AUDIT_DIR: directory } : process.env,
    });
    return { child, done: new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => resolve(code ?? 1));
    }) };
}

async function audit(...args) {
    try {
        const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'windows-browser-audit.ps1'), ...args],
        { windowsHide: true, timeout: 15000 });
        return stdout.trim();
    } catch (error) {
        // Only the failure message is useful. PowerShell also emits paths and source lines.
        throw new Error(error.stderr?.trim().split(/\r?\n/)[0] || 'Windows Security event audit unavailable');
    }
}

async function runWindows() {
    const baseline = await audit('-Mode', 'Start');
    if (!/^\d+$/.test(baseline)) throw new Error('Security log baseline unavailable');
    const lock = net.createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
        lock.once('error', reject);
        lock.listen('\\\\.\\pipe\\MultiChrome-WindowsBrowserTests', resolve);
    }).catch(() => { throw new Error('Another Windows browser test suite is running or the test lock is unavailable'); });
    try {
        const check = directory => audit('-Mode', 'Check', '-Baseline', baseline, '-Directory', directory);
        const start = async directory => {
            await audit('-Mode', 'PrepareProfile', '-Directory', directory);
            return run(directory);
        };
        return await supervise(start, check, 2000, (engine, count) => {
            console.log(`[Windows audit] ${engine}: ${count} starts, 0 matched 4625, 0 test-account 4740`);
        });
    } finally {
        lock.close();
    }
}

export async function supervise(startSuite, checkEvents, observationMs, report = () => {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multichrome-browser-audit-'));
    const check = () => checkEvents(directory);
    const permitted = new Map();
    let active;
    try {
        active = await startSuite(directory);
        let finished = false;
        const result = active.done.finally(() => { finished = true; });
        result.catch(() => {});
        let nextCheck = Date.now() + 3000;
        while (!finished) {
            const files = fs.readdirSync(directory);
            const request = files.find(name => /^[a-f\d-]{36}\.request$/.test(name));
            if (request) {
                await check();
                const key = request.slice(0, -'.request'.length);
                // A fresh permit timestamps this spawn, including when multiple windows are requested together.
                fs.writeFileSync(path.join(directory, key + '.go'), '', { flag: 'wx' });
                fs.unlinkSync(path.join(directory, request));
                const deadline = Date.now() + 10000;
                let receipt;
                while (!(receipt = fs.readdirSync(directory).find(name => name.startsWith(key + '.') && name.endsWith('.started')))) {
                    if (finished || Date.now() >= deadline) throw new Error('Missing browser PID after launch permit');
                    await delay(50);
                }
                const engine = receipt.split('.')[2];
                const firstForEngine = !permitted.has(engine);
                permitted.set(engine, (permitted.get(engine) ?? 0) + 1);
                // The first real profile for each engine runs alone. Apply the same
                // observation interval to later launches; existing windows remain open.
                await delay(firstForEngine ? 3 * observationMs : observationMs);
                await check();
                nextCheck = Date.now() + 3000;
            } else if (Date.now() >= nextCheck) {
                await check();
                nextCheck = Date.now() + 3000;
            } else {
                await delay(75);
            }
        }
        const code = await result;
        await delay(observationMs);
        await check();
        if (!permitted.size && code === 0) throw new Error('No browser starts observed. Windows audit unverified.');
        for (const [engine, count] of permitted) report(engine, count);
        return code;
    } catch (error) {
        fs.writeFileSync(path.join(directory, 'stop'), '');
        if (active?.child.pid && active.child.exitCode === null && active.child.signalCode === null) {
            await exec('taskkill.exe', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
        }
        throw error;
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exitCode = process.platform === 'win32' ? await runWindows() : await run().done;
    } catch (error) {
        console.error('[Browser tests]', error.message);
        process.exitCode = 1;
    }
}
