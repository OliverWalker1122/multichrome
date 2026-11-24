import test from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateProcessMemory,
    buildForceKillProcessSpec,
    buildMemorySaverChromiumArgs,
    extractEnvIdShortFromCommandLine,
    filterBrowserProcessLines,
    parseUnixPsOutput,
    parseWindowsCimProcessJson,
} from '../electron/domain/processMetrics.js';

test('extractEnvIdShortFromCommandLine parses Windows and POSIX user-data-dir flags', () => {
    assert.equal(
        extractEnvIdShortFromCommandLine(
            '"C:\\Program Files\\Google\\Chrome\\chrome.exe" --user-data-dir="C:\\Users\\demo\\AppData\\Roaming\\multichrome\\environments\\a1b2c3d4" --type=renderer',
        ),
        'a1b2c3d4',
    );
    assert.equal(
        extractEnvIdShortFromCommandLine(
            '/Applications/Chrome --user-data-dir=/Users/demo/environments/DEADBEEF --no-first-run',
        ),
        'deadbeef',
    );
    assert.equal(
        extractEnvIdShortFromCommandLine('chrome.exe --profile-directory=Default'),
        null,
    );
});

test('aggregateProcessMemory sums multi-process memory per environment', () => {
    const winJson = JSON.stringify([
        {
            WorkingSetSize: 100_000_000,
            CommandLine:
                'chrome.exe --user-data-dir="D:\\data\\environments\\11223344"',
        },
        {
            WorkingSetSize: 55_000_000,
            CommandLine:
                'chrome.exe --type=renderer --user-data-dir="D:\\data\\environments\\11223344"',
        },
        {
            WorkingSetSize: 80_000_000,
            CommandLine:
                'chrome.exe --user-data-dir="D:\\data\\environments\\aabbccdd"',
        },
        {
            WorkingSetSize: 200_000_000,
            CommandLine: 'chrome.exe --profile-directory=Default',
        },
    ]);

    const parsed = parseWindowsCimProcessJson(winJson);
    const agg = aggregateProcessMemory(parsed);
    assert.equal(agg.totalProcesses, 3);
    assert.equal(agg.totalBytes, 235_000_000);
    assert.deepEqual(agg.byEnvIdShort['11223344'], {
        memoryBytes: 155_000_000,
        processCount: 2,
    });
    assert.deepEqual(agg.byEnvIdShort['aabbccdd'], {
        memoryBytes: 80_000_000,
        processCount: 1,
    });

    const unixOut =
        ' 51200 /usr/bin/chromium --user-data-dir=/tmp/environments/00112233\n';
    const unixAgg = aggregateProcessMemory(parseUnixPsOutput(unixOut));
    assert.equal(unixAgg.byEnvIdShort['00112233'].memoryBytes, 51200 * 1024);
});

test('buildMemorySaverChromiumArgs avoids fingerprint-altering low-end-device-mode', () => {
    const args = buildMemorySaverChromiumArgs();
    assert.ok(args.some((a) => a.includes('MemorySaverModeAvailable')));
    assert.ok(!args.some((a) => a.includes('low-end-device-mode')));
});

test('filterBrowserProcessLines matches both Official Chrome and fingerprint-chromium on macOS and Linux', () => {
    const psOutput = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/environments/11223344',
        '/Users/demo/kernels/Chromium.app/Contents/MacOS/Chromium --user-data-dir=/tmp/environments/55667788',
        '/usr/bin/node /Users/demo/server.js --user-data-dir=/tmp/environments/99999999',
        '/opt/kernels/chromium --user-data-dir=/tmp/environments/aabbccdd',
    ].join('\n');

    const macFiltered = filterBrowserProcessLines(psOutput, 'darwin');
    assert.ok(macFiltered.includes('11223344'));
    assert.ok(macFiltered.includes('55667788'));
    assert.ok(macFiltered.includes('aabbccdd'));
    assert.ok(!macFiltered.includes('99999999'));

    const linuxFiltered = filterBrowserProcessLines(psOutput, 'linux');
    assert.ok(linuxFiltered.includes('11223344'));
    assert.ok(linuxFiltered.includes('55667788'));
    assert.ok(linuxFiltered.includes('aabbccdd'));
    assert.ok(!linuxFiltered.includes('99999999'));
});

test('buildForceKillProcessSpec validates 8-hex envIdShort and scopes kill targets precisely', () => {
    assert.equal(buildForceKillProcessSpec('not-valid', 'win32'), null);
    assert.equal(buildForceKillProcessSpec('11223344; rm -rf /', 'linux'), null);

    const winSpec = buildForceKillProcessSpec('A1B2C3D4', 'win32');
    assert.equal(winSpec.executable, 'powershell.exe');
    assert.ok(
        winSpec.args.some((arg) =>
            arg.includes("environments[/\\\\]a1b2c3d4\\b"),
        ),
    );

    const macSpec = buildForceKillProcessSpec('a1b2c3d4', 'darwin');
    assert.deepEqual(macSpec, {
        executable: 'pkill',
        args: ['-f', 'environments/a1b2c3d4'],
    });
});
