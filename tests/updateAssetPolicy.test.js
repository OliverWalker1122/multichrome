import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildReleasePayloadFromTagAndSums,
    normalizeGitHubAssetName,
    parseLatestReleaseTagFromLocation,
    parseSha256Sums,
    selectPlatformReleaseAsset,
} from '../electron/domain/updateAssetPolicy.js';

const REPO_URL = 'https://github.com/OliverWalker1122/multichrome';
const SAMPLE_SUMS = [
    '561747a4203c85702dc34b9eb6293f1efdd8061fe25315f9a55bfd685c41ac7e  MultiChrome Setup 1.6.0.exe',
    '957777e58f358a6e65ae0661487191a5afe594ec3e7f0d21cfe3eea2fe6ddb91  MultiChrome-1.6.0-arm64.dmg',
    'dde2b0e7ad86d8493b5da823d0935424a7436d5041c7e2087c0559087ee9da20  MultiChrome-1.6.0.AppImage',
    'c68c5528395843861fb30f7284865c359a14d7bc314fd2bcf7bc31f585de3357  multichrome_1.6.0_amd64.deb',
].join('\n');

test('parseLatestReleaseTagFromLocation extracts official release tags and rejects untrusted redirects', () => {
    const parsed = parseLatestReleaseTagFromLocation(
        'https://github.com/OliverWalker1122/multichrome/releases/tag/v1.6.0',
        REPO_URL,
    );
    assert.deepEqual(parsed, {
        tagName: 'v1.6.0',
        releaseUrl: 'https://github.com/OliverWalker1122/multichrome/releases/tag/v1.6.0',
    });

    assert.throws(
        () =>
            parseLatestReleaseTagFromLocation(
                'https://evil.example/OliverWalker1122/multichrome/releases/tag/v1.6.0',
                REPO_URL,
            ),
        /非官方/,
    );
    assert.throws(
        () =>
            parseLatestReleaseTagFromLocation(
                'https://github.com/OliverWalker1122/multichrome/releases',
                REPO_URL,
            ),
        /标签/,
    );
});

test('parseSha256Sums matches both exact names and GitHub dot-normalized Windows installer names', () => {
    assert.equal(
        normalizeGitHubAssetName('./MultiChrome Setup 1.6.0.exe'),
        'MultiChrome.Setup.1.6.0.exe',
    );
    assert.equal(
        parseSha256Sums(SAMPLE_SUMS, 'MultiChrome Setup 1.6.0.exe'),
        '561747a4203c85702dc34b9eb6293f1efdd8061fe25315f9a55bfd685c41ac7e',
    );
    assert.equal(
        parseSha256Sums(SAMPLE_SUMS, 'MultiChrome.Setup.1.6.0.exe'),
        '561747a4203c85702dc34b9eb6293f1efdd8061fe25315f9a55bfd685c41ac7e',
    );
});

test('buildReleasePayloadFromTagAndSums reconstructs verifiable multi-platform assets when GitHub API is rate-limited', () => {
    const payload = buildReleasePayloadFromTagAndSums({
        repoUrl: REPO_URL,
        tagName: 'v1.6.0',
        sumsText: SAMPLE_SUMS,
    });
    assert.equal(payload.tag_name, 'v1.6.0');
    assert.equal(
        payload.html_url,
        'https://github.com/OliverWalker1122/multichrome/releases/tag/v1.6.0',
    );

    const win = selectPlatformReleaseAsset(payload.assets, 'win32', 'x64');
    assert.equal(win.installer?.name, 'MultiChrome.Setup.1.6.0.exe');
    assert.equal(
        win.installer?.downloadUrl,
        'https://github.com/OliverWalker1122/multichrome/releases/download/v1.6.0/MultiChrome.Setup.1.6.0.exe',
    );
    assert.equal(
        win.checksumAsset?.downloadUrl,
        'https://github.com/OliverWalker1122/multichrome/releases/download/v1.6.0/SHA256SUMS.txt',
    );
    assert.equal(
        parseSha256Sums(SAMPLE_SUMS, win.installer.name),
        '561747a4203c85702dc34b9eb6293f1efdd8061fe25315f9a55bfd685c41ac7e',
    );

    const mac = selectPlatformReleaseAsset(payload.assets, 'darwin', 'arm64');
    assert.equal(mac.installer?.name, 'MultiChrome-1.6.0-arm64.dmg');

    const linux = selectPlatformReleaseAsset(payload.assets, 'linux', 'x64');
    assert.equal(linux.installer?.name, 'MultiChrome-1.6.0.AppImage');
});
