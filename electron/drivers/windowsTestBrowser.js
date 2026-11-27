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

// Create a synthetic first-run Local State exclusively inside this suite's
// disposable profiles. Never open, copy from, or overwrite existing browser state.
export function prepareTestProfile(auditDirectory, fixtureRoot, profileDirectory) {
    if (!fixtureRoot || !profileDirectory) return;
    const relative = path.relative(fs.realpathSync.native(fixtureRoot), fs.realpathSync.native(profileDirectory));
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return;
    try {
        fs.copyFileSync(path.join(auditDirectory, 'test-local-state.json'),
            path.join(profileDirectory, 'Local State'), fs.constants.COPYFILE_EXCL);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

/**
 * Wait for a supervisor permit before using the normal executable and startup gate.
 * @param {string} directory
 * @param {string} engine
 */
export async function reserveWindowsTestLaunch(directory, engine) {
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
    let attempted = false;
    return {
        cancel() {
            if (!attempted && fs.existsSync(directory)) fs.writeFileSync(file('.cancelled'), '');
        },
        /** @param {string[]} args @param {(args: string[]) => import('node:child_process').ChildProcess} launch */
        spawn(args, launch) {
            if (!fs.existsSync(file('.go')) || fs.existsSync(path.join(directory, 'stop'))) throw new Error('Windows browser test audit stopped');
            const dataArg = args.find(arg => arg.startsWith('--user-data-dir='));
            prepareTestProfile(directory, process.env.MULTICHROME_TEST_PROFILE_ROOT, dataArg?.slice('--user-data-dir='.length));
            const testArgs = windowsTestArgs(args);
            if (engine === 'fingerprint-chromium' && process.env.MULTICHROME_TEST_SOFTWARE_GL === '1') {
                testArgs.unshift('--use-gl=angle', '--use-angle=swiftshader');
            }
            attempted = true;
            const child = launch(testArgs);
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
        },
    };
}
