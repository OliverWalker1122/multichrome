import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { spawnAuditedTestBrowser, windowsTestArgs } from '../electron/drivers/windowsTestBrowser.js';
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
        done: Promise.all(engines.map(engine => spawnAuditedTestBrowser(directory, engine, [], () => {
            launched.push(engine);
            return { pid: 100 + launched.length };
        }))).then(() => 0),
    });
}

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
