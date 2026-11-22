import test from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateProcessMemory,
    buildMemorySaverChromiumArgs,
    extractEnvIdShortFromCommandLine,
    parseUnixPsOutput,
    parseWindowsCimProcessJson,
} from '../electron/processMetrics.js';

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
