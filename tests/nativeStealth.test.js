import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { decideStartupUrlAction } from '../electron/domain/startupUrlPolicy.js';

const require = createRequire(import.meta.url);

function loadCDPManagerClass() {
    const source = fs.readFileSync(path.resolve('electron/drivers/cdpManager.ts'), 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;

    const moduleObj = { exports: {} };
    const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
    const customRequire = (specifier) => {
        if (specifier === 'electron-log') return { default: noopLogger, ...noopLogger };
        if (specifier === '../domain/startupUrlPolicy.js') {
            return { decideStartupUrlAction };
        }
        return require(specifier);
    };

    vm.runInNewContext(transpiled, {
        module: moduleObj,
        exports: moduleObj.exports,
        require: customRequire,
        process,
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
    });

    return moduleObj.exports.CDPManager;
}

test('CDPManager uses pure native V8/Blink Emulation (zero JS prototype hooks) for all engines', () => {
    const CDPManager = loadCDPManagerClass();
    const cdp = new CDPManager();

    // C++ fingerprint kernel without geolocation needs no CDP overrides at all
    cdp.primeEnvironment('env-cpp', {});
    assert.equal(cdp.shouldEnableOverrides('env-cpp'), false);

    // Adding a fallback timezone or geolocation enables native Emulation overrides
    cdp.envTimezones.set('env-cpp', 'America/New_York');
    assert.equal(cdp.shouldEnableOverrides('env-cpp'), true);

    // Official Chrome registers timezone/locale/geo for native Emulation only (no JS injection method)
    cdp.primeEnvironment('env-chrome', {
        timezone: 'America/Los_Angeles',
        locale: 'en-US',
        geolocation: { latitude: 34.05, longitude: -118.24 },
    });
    assert.equal(cdp.shouldEnableOverrides('env-chrome'), true);
    assert.equal(typeof cdp.getFullInjectionScript, 'undefined');

    // Disconnect clears all primed state cleanly
    cdp.disconnect('env-cpp');
    cdp.disconnect('env-chrome');
    assert.equal(cdp.shouldEnableOverrides('env-cpp'), false);
    assert.equal(cdp.shouldEnableOverrides('env-chrome'), false);
});
