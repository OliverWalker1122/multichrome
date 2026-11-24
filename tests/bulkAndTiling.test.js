import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkEnvironmentSpecs } from '../electron/domain/bulkEnvironmentPolicy.js';
import { computeWindowGridBounds } from '../electron/domain/windowTiling.js';
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

test('computeWindowGridBounds calculates non-overlapping integer grids within display workArea', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
    const one = computeWindowGridBounds(1, workArea);
    assert.equal(one.length, 1);
    assert.ok(one[0].left >= 0 && one[0].width <= 1280);

    const four = computeWindowGridBounds(4, workArea);
    assert.equal(four.length, 4);
    // 2x2 grid: top-left vs top-right must not overlap
    assert.ok(four[0].left + four[0].width <= four[1].left);
    assert.ok(four[0].top + four[0].height <= four[2].top);
    for (const box of four) {
        assert.ok(Number.isInteger(box.left) && Number.isInteger(box.width));
        assert.ok(box.left + box.width <= workArea.width);
        assert.ok(box.top + box.height <= workArea.height);
    }

    const six = computeWindowGridBounds(6, workArea);
    assert.equal(six.length, 6);
    assert.ok(six[0].top === six[2].top);
    assert.ok(six[3].top > six[0].top);
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
