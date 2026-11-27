import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** @param {string[]} args */
export function windowsTestArgs(args) {
    const prefix = '--disable-features=';
    const switches = args.filter(arg => arg.startsWith(prefix));
    const features = new Set(switches.flatMap(arg => arg.slice(prefix.length).split(',')).filter(Boolean));
    features.add('AutofillAiWalletPrivatePasses');
    features.add('AutofillAmbientAutofill');
    return [prefix + [...features].join(','), ...args.filter(arg => !arg.startsWith(prefix))];
}

/**
 * Wait for a supervisor permit before using the normal executable and startup gate.
 * @param {string} directory
 * @param {string} engine
 * @param {string[]} args
 * @param {(args: string[]) => import('node:child_process').ChildProcess} launch
 */
export async function spawnAuditedTestBrowser(directory, engine, args, launch) {
    const key = randomUUID();
    const file = suffix => path.join(directory, key + suffix);
    fs.writeFileSync(file('.request'), '', { flag: 'wx' });
    const deadline = Date.now() + 60000;
    while (!fs.existsSync(file('.go'))) {
        if (!fs.existsSync(directory) || fs.existsSync(path.join(directory, 'stop')) || Date.now() >= deadline) {
            throw new Error('Windows browser test audit stopped or unavailable');
        }
        await delay(50);
    }
    if (fs.existsSync(path.join(directory, 'stop'))) throw new Error('Windows browser test audit stopped');
    const child = launch(windowsTestArgs(args));
    if (!Number.isSafeInteger(child.pid)) {
        child.once('error', () => {});
        throw new Error('Windows test browser did not start');
    }
    try {
        fs.writeFileSync(file(`.${child.pid}.${engine}.started`), '', { flag: 'wx' });
    } catch (error) {
        child.kill();
        throw error;
    }
    return child;
}
