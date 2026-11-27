import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildWindowsPasswordLocalState } from './nativePreferences.js';

const REQUIRED_DISABLED_FEATURES = [
    'AutofillAiWalletPrivatePasses',
    'AutofillAmbientAutofill',
];

/** @param {string[]} args */
export function windowsTestArgs(args) {
    const prefix = '--disable-features=';
    const switches = args.filter(arg => arg.startsWith(prefix));
    const features = new Set(switches.flatMap(arg => arg.slice(prefix.length).split(',')).filter(Boolean));
    for (const item of REQUIRED_DISABLED_FEATURES) {
        features.add(item);
    }
    return [prefix + [...features].join(','), ...args.filter(arg => !arg.startsWith(prefix))];
}

function isInsideRoot(fixtureRoot, profileDirectory) {
    if (!fixtureRoot || !profileDirectory) return false;
    if (!fs.existsSync(fixtureRoot) || !fs.existsSync(profileDirectory)) return false;
    const relative = path.relative(fs.realpathSync.native(fixtureRoot), fs.realpathSync.native(profileDirectory));
    return Boolean(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// Create a synthetic first-run Local State exclusively inside this suite's
// disposable profiles. Never open, copy from, or overwrite existing browser state.
export function prepareTestProfile(auditDirectory, fixtureRoot, profileDirectory) {
    if (!isInsideRoot(fixtureRoot, profileDirectory)) return;
    const targetPath = path.join(profileDirectory, 'Local State');
    const templatePath = auditDirectory ? path.join(auditDirectory, 'test-local-state.json') : '';
    try {
        if (templatePath && fs.existsSync(templatePath)) {
            fs.copyFileSync(templatePath, targetPath, fs.constants.COPYFILE_EXCL);
        } else {
            fs.writeFileSync(targetPath, buildWindowsPasswordLocalState(), { flag: 'wx' });
        }
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

export function verifyWindowsTestLaunchReady(fixtureRoot, profileDirectory, testArgs) {
    const prefix = '--disable-features=';
    const featureArg = testArgs.find(arg => arg.startsWith(prefix)) || '';
    const activeFeatures = new Set(featureArg.slice(prefix.length).split(',').filter(Boolean));
    for (const required of REQUIRED_DISABLED_FEATURES) {
        if (!activeFeatures.has(required)) {
            throw new Error(`Missing required Windows lockout protection flag: ${required}`);
        }
    }
    if (!profileDirectory) return;
    const localStatePath = path.join(profileDirectory, 'Local State');
    if (!fs.existsSync(localStatePath)) {
        throw new Error('Windows test browser Local State was not initialized before launch');
    }
    if (isInsideRoot(fixtureRoot, profileDirectory)) {
        const parsed = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
        const pm = parsed?.password_manager;
        if (pm?.os_password_blank !== false || !/^\d+$/.test(String(pm?.os_password_last_changed || ''))) {
            throw new Error('Disposable Windows test profile is missing non-blank password cache');
        }
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
            const profileDirectory = dataArg?.slice('--user-data-dir='.length);
            const fixtureRoot = process.env.MULTICHROME_TEST_PROFILE_ROOT;
            prepareTestProfile(directory, fixtureRoot, profileDirectory);
            const testArgs = windowsTestArgs(args);
            if (engine === 'fingerprint-chromium' && process.env.MULTICHROME_TEST_SOFTWARE_GL === '1') {
                testArgs.unshift('--use-gl=angle', '--use-angle=swiftshader');
            }
            verifyWindowsTestLaunchReady(fixtureRoot, profileDirectory, testArgs);
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
