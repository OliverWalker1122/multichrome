import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertAllowedFingerprintRelease,
    assertAllowedSingboxRelease,
    compareDotVersions,
    getAllowedFingerprintReleases,
    getAllowedSingboxReleases,
    getKernelUpdateSummary,
    loadKernelManifest,
} from '../electron/kernelPolicy.js';

test('kernelManifest.json contains valid SHA-256 entries and exactly one recommended version per core', () => {
    const manifest = loadKernelManifest();
    assert.equal(manifest.schemaVersion, 1);

    const fpEntries = Object.entries(manifest.fingerprintChromium);
    assert.ok(fpEntries.length > 0);
    for (const [, info] of fpEntries) {
        assert.ok(Number.isInteger(info.chromeMajor));
        for (const asset of Object.values(info.assets)) {
            assert.match(asset.sha256, /^[a-f0-9]{64}$/);
            assert.ok(typeof asset.name === 'string' && asset.name.length > 0);
        }
    }

    const sbEntries = Object.entries(manifest.singBox);
    assert.ok(sbEntries.length > 0);
    for (const [, info] of sbEntries) {
        for (const asset of Object.values(info.assets)) {
            assert.match(asset.sha256, /^[a-f0-9]{64}$/);
            assert.ok(typeof asset.name === 'string' && asset.name.length > 0);
        }
    }

    const winFp = getAllowedFingerprintReleases('win32', manifest);
    assert.equal(winFp.length, 1);
    assert.equal(winFp[0].recommended, true);

    const winSb = getAllowedSingboxReleases('win32', 'x64', manifest);
    assert.equal(winSb.length, 1);
    assert.equal(winSb[0].recommended, true);
});

test('compareDotVersions handles multi-segment versions and optional v prefix', () => {
    assert.equal(compareDotVersions('148.0.7778.215', '144.0.7559.132'), 1);
    assert.equal(compareDotVersions('144.0.7559.132', '148.0.7778.215'), -1);
    assert.equal(compareDotVersions('v1.14.4', '1.14.4'), 0);
    assert.equal(compareDotVersions('1.14.4', '1.14.3'), 1);
    assert.equal(compareDotVersions('1.14.2', '1.14.4'), -1);
});

test('assertAllowedFingerprintRelease and assertAllowedSingboxRelease block unapproved versions', () => {
    const allowedFp = assertAllowedFingerprintRelease('148.0.7778.215', 'win32');
    assert.equal(allowedFp.version, '148.0.7778.215');
    assert.match(allowedFp.sha256, /^[a-f0-9]{64}$/);

    assert.throws(
        () => assertAllowedFingerprintRelease('150.0.7871.186', 'win32'),
        /受控白名单清单/,
    );

    const allowedSb = assertAllowedSingboxRelease('1.14.4', 'win32', 'x64');
    assert.equal(allowedSb.version, '1.14.4');
    assert.match(allowedSb.sha256, /^[a-f0-9]{64}$/);

    assert.throws(
        () => assertAllowedSingboxRelease('1.14.3', 'win32', 'x64'),
        /受控白名单清单/,
    );
});

test('getKernelUpdateSummary suppresses badge when uninstalled and flags outdated active versions', () => {
    const empty = getKernelUpdateSummary({
        installedKernels: [],
        activeKernelId: null,
        installedSingbox: [],
        activeSingboxId: null,
        platform: 'win32',
        arch: 'x64',
    });
    assert.equal(empty.hasAnyUpdate, false);
    assert.equal(empty.updateCount, 0);
    assert.equal(empty.fingerprint.hasUpdate, false);
    assert.equal(empty.singbox.hasUpdate, false);

    const outdated = getKernelUpdateSummary({
        installedKernels: [
            { id: 'fp-144', version: '144.0.7559.132' },
        ],
        activeKernelId: 'fp-144',
        installedSingbox: [
            { id: 'sb-1142', version: '1.14.2' },
        ],
        activeSingboxId: 'sb-1142',
        platform: 'win32',
        arch: 'x64',
    });
    assert.equal(outdated.hasAnyUpdate, true);
    assert.equal(outdated.updateCount, 2);
    assert.equal(outdated.fingerprint.hasUpdate, true);
    assert.equal(outdated.fingerprint.currentVersion, '144.0.7559.132');
    assert.equal(outdated.fingerprint.recommendedVersion, '148.0.7778.215');
    assert.equal(outdated.singbox.hasUpdate, true);
    assert.equal(outdated.singbox.currentVersion, '1.14.2');
    assert.equal(outdated.singbox.recommendedVersion, '1.14.4');

    const upToDate = getKernelUpdateSummary({
        installedKernels: [
            { id: 'fp-148', version: '148.0.7778.215' },
        ],
        activeKernelId: 'fp-148',
        installedSingbox: [
            { id: 'sb-1144', version: '1.14.4' },
        ],
        activeSingboxId: 'sb-1144',
        platform: 'win32',
        arch: 'x64',
    });
    assert.equal(upToDate.hasAnyUpdate, false);
    assert.equal(upToDate.updateCount, 0);

    const newerThanRecommended = getKernelUpdateSummary({
        installedKernels: [
            { id: 'fp-150', version: '150.0.7871.186' },
        ],
        activeKernelId: 'fp-150',
        installedSingbox: [
            { id: 'sb-1144', version: '1.14.4' },
        ],
        activeSingboxId: 'sb-1144',
        platform: 'win32',
        arch: 'x64',
    });
    assert.equal(newerThanRecommended.fingerprint.hasUpdate, false);
    assert.equal(newerThanRecommended.hasAnyUpdate, false);
});
