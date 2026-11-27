import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    prepareTestProfile,
    reserveWindowsTestLaunch,
    verifyWindowsTestLaunchReady,
    windowsTestArgs,
} from '../electron/drivers/windowsTestBrowser.js';
import {
    buildWindowsPasswordLocalState,
    ensureFreshWindowsLocalState,
} from '../electron/drivers/nativePreferences.js';
import { supervise } from '../scripts/run-browser-suite.mjs';

test('Windows test launches merge disabled features without changing the caller or other arguments', () => {
    const original = ['--disable-features=X', '--example', '--disable-features=Y,X', 'about:blank'];
    const merged = windowsTestArgs(original);
    assert.deepEqual(merged, [
        '--disable-features=X,Y,AutofillAiWalletPrivatePasses,AutofillAmbientAutofill', '--example', 'about:blank',
    ]);
    assert.equal(original.length, 4);
});

function simulate(engines, launched) {
    return directory => ({
        child: {},
        done: Promise.all(engines.map(async engine => {
            const permit = await reserveWindowsTestLaunch(directory, engine);
            permit.spawn([], () => {
                launched.push(engine);
                return { pid: 100 + launched.length };
            });
        })).then(() => 0),
    });
}

test('only a fresh profile inside the suite receives the synthetic non-blank account fixture', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-test-local-state-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const fixtures = fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
    const profile = fs.mkdirSync(path.join(fixtures, 'new'), { recursive: true });
    const outside = fs.mkdirSync(path.join(root, 'fixtures-other'), { recursive: true });
    const synthetic = JSON.stringify({ password_manager: { os_password_blank: false, os_password_last_changed: '123' } });
    fs.writeFileSync(path.join(root, 'test-local-state.json'), synthetic);
    prepareTestProfile(root, fixtures, profile);
    assert.equal(fs.readFileSync(path.join(profile, 'Local State'), 'utf8'), synthetic);
    fs.writeFileSync(path.join(profile, 'Local State'), 'existing synthetic fixture');
    prepareTestProfile(root, fixtures, profile);
    assert.equal(fs.readFileSync(path.join(profile, 'Local State'), 'utf8'), 'existing synthetic fixture');
    prepareTestProfile(root, fixtures, outside);
    assert.equal(fs.existsSync(path.join(outside, 'Local State')), false);
});

test('concurrent engine requests each have a PID receipt before the next permit and final audit', async () => {
    const launched = [];
    const checked = [];
    const code = await supervise(simulate(['system-chrome', 'fingerprint-chromium'], launched), directory => {
        checked.push(fs.readdirSync(directory).filter(file => file.endsWith('.started')).length);
    }, 1);
    assert.equal(code, 0);
    assert.deepEqual(new Set(launched), new Set(['system-chrome', 'fingerprint-chromium']));
    assert.deepEqual(checked, [0, 1, 1, 2, 2]);
});

test('one matched login failure stops a queued launch and fails the suite', async () => {
    const launched = [];
    const check = directory => {
        if (fs.readdirSync(directory).some(name => name.endsWith('.started'))) throw new Error('4625');
    };
    await assert.rejects(supervise(simulate(['system-chrome', 'system-chrome'], launched), check, 1), /4625/);
    assert.equal(launched.length, 1);
});

test('a missing audit or an unobserved successful suite cannot pass', async () => {
    const launched = [];
    await assert.rejects(supervise(simulate(['system-chrome'], launched), () => {
        throw new Error('Security log unavailable');
    }, 1), /Security log unavailable/);
    assert.equal(launched.length, 0);
    await assert.rejects(supervise(simulate([], launched), () => {}, 1), /No browser starts observed/);
});

test('pure-JS Windows password cache seeds only fresh profiles and blocks unprotected test spawns', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pure-local-state-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const profileA = path.join(root, 'profile-a');
    assert.equal(ensureFreshWindowsLocalState(profileA, { platform: 'linux' }), false);
    assert.equal(fs.existsSync(path.join(profileA, 'Local State')), false);

    const fixedNow = Date.UTC(2026, 10, 27, 8, 0, 0);
    assert.equal(ensureFreshWindowsLocalState(profileA, { platform: 'win32', nowMs: fixedNow }), true);
    const parsed = JSON.parse(fs.readFileSync(path.join(profileA, 'Local State'), 'utf8'));
    assert.equal(parsed.password_manager.os_password_blank, false);
    assert.match(parsed.password_manager.os_password_last_changed, /^\d{17,}$/);

    // Existing Local State is never overwritten
    fs.writeFileSync(path.join(profileA, 'Local State'), '{"custom":true}');
    assert.equal(ensureFreshWindowsLocalState(profileA, { platform: 'win32', nowMs: fixedNow }), false);
    assert.equal(fs.readFileSync(path.join(profileA, 'Local State'), 'utf8'), '{"custom":true}');

    // Disposable test profile without a PowerShell template still gets seeded and verified before spawn
    const auditDir = fs.mkdirSync(path.join(root, 'audit'), { recursive: true });
    const fixtureRoot = fs.mkdirSync(path.join(root, 'suite-fixtures'), { recursive: true });
    const freshTestProfile = fs.mkdirSync(path.join(fixtureRoot, 'env-1'), { recursive: true });
    prepareTestProfile(auditDir, fixtureRoot, freshTestProfile);
    const mergedArgs = windowsTestArgs([`--user-data-dir=${freshTestProfile}`]);
    assert.doesNotThrow(() => verifyWindowsTestLaunchReady(fixtureRoot, freshTestProfile, mergedArgs));

    // Missing Autofill disable flag or blank password cache throws BEFORE spawn
    assert.throws(
        () => verifyWindowsTestLaunchReady(fixtureRoot, freshTestProfile, [`--user-data-dir=${freshTestProfile}`]),
        /Missing required Windows lockout protection flag/,
    );
    fs.writeFileSync(
        path.join(freshTestProfile, 'Local State'),
        JSON.stringify({ password_manager: { os_password_blank: true, os_password_last_changed: '1' } }),
    );
    assert.throws(
        () => verifyWindowsTestLaunchReady(fixtureRoot, freshTestProfile, mergedArgs),
        /missing non-blank password cache/,
    );
    assert.equal(JSON.parse(buildWindowsPasswordLocalState(fixedNow)).password_manager.os_password_blank, false);
});
