import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildBulkEnvironmentSpecs } from '../electron/domain/bulkEnvironmentPolicy.js';
import {
    computeConsoleSplitWorkArea,
    computeDefaultMainWindowBounds,
    computeVisualHighlightBounds,
    computeWindowArrangement,
    computeWindowCascadeBounds,
    computeWindowGridBounds,
    computeWindowUniformStackBounds,
    normalizeWindowArrangeMode,
    sanitizeHighlightLabel,
    sanitizeWindowTitleTag,
} from '../electron/domain/windowTiling.js';
import {
    allowForegroundForPid,
    getForegroundWindowPid,
    isNativeWindowFocusAvailable,
} from '../electron/drivers/nativeWindowFocus.js';
import { DebugPortReservationPool } from '../electron/drivers/portAllocator.js';

test('buildBulkEnvironmentSpecs creates unique fingerprint seeds and sequential proxy distribution', () => {
    const specs = buildBulkEnvironmentSpecs(
        {
            namePrefix: 'Store',
            groupName: 'Retail',
            count: 5,
            startNumber: 8,
            proxyMode: 'sequential',
            proxyIds: ['proxy-a', 'proxy-b'],
            tags: ['us', 'prod'],
            browserEngine: 'fingerprint-chromium',
        },
        {
            defaultEngine: 'fingerprint-chromium',
            platform: 'windows',
            brand: 'Chrome',
            autoMatchTimezone: true,
            defaultLanguage: 'en-US',
            spoofing: {
                canvas: true,
                audio: true,
                font: true,
                clientrects: true,
                gpu: true,
            },
        },
    );

    assert.equal(specs.length, 5);
    assert.deepEqual(
        specs.map((s) => s.name),
        ['Store 08', 'Store 09', 'Store 10', 'Store 11', 'Store 12'],
    );
    assert.deepEqual(
        specs.map((s) => s.proxyId),
        ['proxy-a', 'proxy-b', 'proxy-a', 'proxy-b', 'proxy-a'],
    );
    const seeds = new Set(specs.map((s) => s.fingerprintConfig.seed));
    assert.equal(seeds.size, 5);
});

test('buildBulkEnvironmentSpecs validates count bounds and single-proxy assignment', () => {
    assert.throws(
        () =>
            buildBulkEnvironmentSpecs({
                namePrefix: 'Test',
                groupName: 'Default',
                count: 51,
            }),
        /1 至 50/,
    );
    const single = buildBulkEnvironmentSpecs({
        namePrefix: 'Batch',
        groupName: 'Default',
        count: 2,
        proxyMode: 'single',
        proxyIds: ['proxy-only'],
    });
    assert.deepEqual(
        single.map((s) => s.proxyId),
        ['proxy-only', 'proxy-only'],
    );
});

test('computeWindowGridBounds calculates seamless zero-gap integer grids and compensates win32 DWM borders', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
    const one = computeWindowGridBounds(1, workArea);
    assert.equal(one.length, 1);
    assert.ok(one[0].left >= 0 && one[0].width <= 1280);

    // Non-win32 seamless 2x2 grid: exact 0px gap between neighbors and outer edges
    const four = computeWindowGridBounds(4, workArea);
    assert.equal(four.length, 4);
    assert.equal(four[0].left, 0);
    assert.equal(four[0].left + four[0].width, four[1].left);
    assert.equal(four[1].left + four[1].width, workArea.width);
    assert.equal(four[0].top + four[0].height, four[2].top);
    assert.equal(four[2].top + four[2].height, workArea.height);

    // Win32 3x3 ultrawide grid (3440x1392): DWM visible bounds (+7 left, -7 right, -7 bottom) touch with 0px gap!
    const ultraArea = { x: 0, y: 0, width: 3440, height: 1392 };
    const nineWin = computeWindowGridBounds(9, ultraArea, { platform: 'win32' });
    assert.equal(nineWin.length, 9);
    const toVisibleDwm = (b) => ({
        left: b.left + 7,
        top: b.top,
        right: b.left + b.width - 7,
        bottom: b.top + b.height - 7,
    });
    const vis = nineWin.map(toVisibleDwm);
    // Row 0 seamless across full 3440px width (even though 3440 is not divisible by 3!)
    assert.equal(vis[0].left, 0);
    assert.equal(vis[0].right, vis[1].left);
    assert.equal(vis[1].right, vis[2].left);
    assert.equal(vis[2].right, 3440);
    // Column 0 seamless across full 1392px height
    assert.equal(vis[0].top, 0);
    assert.equal(vis[0].bottom, vis[3].top);
    assert.equal(vis[3].bottom, vis[6].top);
    assert.equal(vis[6].bottom, 1392);
});

test('computeWindowArrangement supports console split, uniform stack, cascade, and title sanitization', () => {
    const workArea = { x: 0, y: 0, width: 2560, height: 1392 };

    const split = computeConsoleSplitWorkArea(workArea);
    assert.ok(split.consoleBounds);
    assert.equal(
        split.consoleBounds.width + split.browserWorkArea.width,
        workArea.width,
    );
    assert.equal(split.browserWorkArea.x, split.consoleBounds.width);

    const splitGridPlan = computeWindowArrangement('split-grid', 4, workArea, {
        platform: 'win32',
    });
    assert.equal(splitGridPlan.mode, 'split-grid');
    assert.ok(splitGridPlan.consoleBounds);
    assert.equal(splitGridPlan.boundsList.length, 4);

    const stackPlan = computeWindowArrangement('stack', 5, workArea, {
        platform: 'win32',
    });
    assert.equal(stackPlan.mode, 'stack');
    assert.equal(stackPlan.consoleBounds, null);
    assert.equal(stackPlan.boundsList.length, 5);
    // Every stacked window has identical dimensions & coordinates
    for (const b of stackPlan.boundsList) {
        assert.deepEqual(b, stackPlan.boundsList[0]);
    }

    const standaloneStack = computeWindowUniformStackBounds(3, workArea);
    assert.equal(standaloneStack.length, 3);
    assert.deepEqual(standaloneStack[0], standaloneStack[2]);

    const cascade = computeWindowCascadeBounds(4, workArea);
    assert.equal(cascade.length, 4);
    assert.equal(cascade[0].width, cascade[3].width);
    assert.equal(cascade[0].height, cascade[3].height);
    assert.ok(cascade[1].left > cascade[0].left && cascade[1].top > cascade[0].top);

    assert.equal(sanitizeWindowTitleTag('iphone-claude'), '[iphone-claude]');
    assert.equal(sanitizeWindowTitleTag('  美国2\n"test"  '), '[美国2 test]');
    assert.equal(sanitizeWindowTitleTag('   '), '');
    assert.equal(
        normalizeWindowArrangeMode('reset-app-window'),
        'reset-app-window',
    );

    // Unified default main window bounds (startup & reset share exact 1340x820 spec)
    const fhdDefault = computeDefaultMainWindowBounds({
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    });
    assert.deepEqual(fhdDefault, {
        x: 290,
        y: 110,
        width: 1340,
        height: 820,
    });
    const laptopDefault = computeDefaultMainWindowBounds({
        x: 0,
        y: 0,
        width: 1366,
        height: 728,
    });
    assert.equal(laptopDefault.width, 1286);
    assert.equal(laptopDefault.height, 660);
    assert.ok(laptopDefault.x >= 0 && laptopDefault.y >= 0);
});

test('Batch bar has no duplicate tiling buttons and close actions use red cross instead of checkbox-like StopRegular', () => {
    const pageSrc = fs.readFileSync(
        path.resolve('src/components/environments/EnvironmentsPage.tsx'),
        'utf8',
    );
    const toolbarSrc = fs.readFileSync(
        path.resolve('src/components/environments/EnvironmentsToolbar.tsx'),
        'utf8',
    );
    assert.equal(
        /平铺所选|堆叠所选|Tile Selected|Stack Selected/.test(pageSrc),
        false,
        'EnvironmentsPage batch bar must not duplicate window layout buttons',
    );
    assert.equal(
        /StopRegular/.test(pageSrc),
        false,
        'EnvironmentsPage batch stop must not use hollow checkbox-like StopRegular',
    );
    assert.equal(
        /StopRegular/.test(toolbarSrc),
        false,
        'EnvironmentsToolbar Stop All must not use hollow checkbox-like StopRegular',
    );
    assert.equal(
        /hideCloseAll=\{selectedRunningCount > 0\}/.test(pageSrc),
        true,
        'EnvironmentsPage must hide header Stop All while batch Stop is visible (zero duplicate close buttons)',
    );
    assert.equal(
        /selectedStoppedCount > 0/.test(pageSrc) &&
            /selectedRunningCount > 0/.test(pageSrc),
        true,
        'EnvironmentsPage batch bar must conditionally render Launch/Stop by selection run state',
    );
});

test('Window locating uses in-process native Win32 API + CDP with zero AV-sensitive shell/WScript subprocesses', () => {
    assert.equal(
        fs.existsSync(path.resolve('electron/drivers/windowFocusDriver.js')),
        false,
        'windowFocusDriver.js must not exist',
    );
    const filesToCheck = [
        'electron/drivers/nativeWindowFocus.js',
        'electron/drivers/cdpManager.ts',
        'electron/app/windowHighlightOverlay.ts',
        'electron/services/browserLaunchService.ts',
        'electron/services/environmentService.ts',
        'electron/ipc/environmentIpc.ts',
    ];
    for (const rel of filesToCheck) {
        const raw = fs.readFileSync(path.resolve(rel), 'utf8');
        const src = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        assert.equal(
            /WScript\.Shell|AppActivate|powershell\.exe|child_process/i.test(src) &&
                rel !== 'electron/services/browserLaunchService.ts',
            false,
            `${rel} must not spawn subprocesses or invoke PowerShell/WScript.Shell`,
        );
        assert.equal(
            /WScript\.Shell|AppActivate|powershell\.exe/i.test(src),
            false,
            `${rel} must not invoke PowerShell or WScript.Shell for window focus`,
        );
    }

    // Visual highlight bounds remove Win32 7px DWM invisible shadow borders cleanly
    assert.deepEqual(
        computeVisualHighlightBounds(
            { left: -7, top: 0, width: 974, height: 523, windowState: 'normal' },
            'win32',
        ),
        { x: 0, y: 0, width: 960, height: 516 },
    );
    assert.deepEqual(
        computeVisualHighlightBounds(
            { left: 0, top: 0, width: 1920, height: 1040, windowState: 'maximized' },
            'win32',
        ),
        { x: 0, y: 0, width: 1920, height: 1040 },
    );
    assert.equal(computeVisualHighlightBounds(null, 'win32'), null);
    assert.equal(sanitizeHighlightLabel('  美国2\n<script>  '), '美国2 <script>');

    // On Windows, native in-process user32.dll bindings load cleanly and read current foreground PID
    if (process.platform === 'win32') {
        assert.equal(isNativeWindowFocusAvailable(), true);
        assert.equal(allowForegroundForPid(-1), false);
        const fgPid = getForegroundWindowPid();
        assert.ok(fgPid === null || (Number.isInteger(fgPid) && fgPid > 0));
    }
});

test('DebugPortReservationPool yields distinct ports under concurrent acquire()', async () => {
    const pool = new DebugPortReservationPool();
    const ports = await Promise.all(
        Array.from({ length: 8 }, () => pool.acquire(25000, 25020, 40)),
    );
    try {
        assert.equal(ports.length, 8);
        assert.equal(new Set(ports).size, 8);
        for (const p of ports) {
            assert.ok(Number.isInteger(p) && p > 1024);
        }
    } finally {
        for (const p of ports) pool.release(p);
    }
});
