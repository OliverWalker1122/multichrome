import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkEnvironmentSpecs } from '../electron/domain/bulkEnvironmentPolicy.js';
import {
    computeConsoleSplitWorkArea,
    computeWindowArrangement,
    computeWindowCascadeBounds,
    computeWindowGridBounds,
    computeWindowUniformStackBounds,
    sanitizeWindowTitleTag,
} from '../electron/domain/windowTiling.js';
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
