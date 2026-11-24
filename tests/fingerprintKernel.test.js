import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    buildFingerprintChromiumArgs,
    generateFingerprintConfig,
    getHostFingerprintPlatform,
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
    normalizeFingerprintConfig,
    parseFingerprintConfigJson,
    REALISTIC_CPU_CORES,
    REALISTIC_WINDOW_SIZES,
} from '../electron/domain/fingerprintProfile.js';
import {
    assertOfficialGitHubUrl,
    getCuratedFingerprintReleases,
    getCuratedSingboxReleases,
    KernelManager,
    normalizeGitHubReleases,
    normalizeSingboxReleases,
    parseGitHubSha256Digest,
} from '../electron/services/kernelService.js';
import { SingboxCore } from '../electron/drivers/singboxCore.js';

test('generateFingerprintConfig produces independent persistent profiles matching host OS', () => {
    const fp1 = generateFingerprintConfig();
    const fp2 = generateFingerprintConfig();

    assert.equal(fp1.platform, getHostFingerprintPlatform());
    assert.equal(fp1.brand, 'Chrome');
    assert.ok(Number.isInteger(fp1.seed) && fp1.seed >= 100000);
    assert.ok(REALISTIC_CPU_CORES.includes(fp1.hardwareConcurrency));
    assert.ok(
        REALISTIC_WINDOW_SIZES.some(
            (s) => s.width === fp1.windowSize.width && s.height === fp1.windowSize.height,
        ),
    );
    assert.notEqual(fp1.seed, fp2.seed);
    assert.deepEqual(fp1.spoofing, {
        canvas: true,
        audio: true,
        font: true,
        clientrects: true,
        gpu: true,
    });
});

test('buildFingerprintChromiumArgs emits native C++ switches and granular disable-spoofing', () => {
    const config = normalizeFingerprintConfig({
        seed: 123456789,
        platform: 'windows',
        platformVersion: '15.0.0',
        brand: 'Chrome',
        hardwareConcurrency: 8,
        windowSize: { width: 1536, height: 864 },
        spoofing: {
            canvas: true,
            audio: true,
            font: false,
            clientrects: true,
            gpu: false,
        },
    });

    const args = buildFingerprintChromiumArgs(config, {
        timezone: 'America/Los_Angeles',
    });

    assert.ok(args.includes('--fingerprint=123456789'));
    assert.ok(args.includes('--fingerprint-platform=windows'));
    assert.ok(args.includes('--fingerprint-platform-version=15.0.0'));
    assert.ok(args.includes('--fingerprint-brand=Chrome'));
    assert.ok(args.includes('--fingerprint-hardware-concurrency=8'));
    assert.ok(args.includes('--disable-non-proxied-udp'));
    assert.ok(args.includes('--window-size=1536,864'));
    assert.ok(args.includes('--timezone=America/Los_Angeles'));
    assert.ok(args.includes('--disable-spoofing=font,gpu'));
});

test('buildFingerprintChromiumArgs omits --disable-spoofing when all modules enabled', () => {
    const config = generateFingerprintConfig();
    const args = buildFingerprintChromiumArgs(config);
    assert.ok(!args.some((arg) => arg.startsWith('--disable-spoofing')));
});

test('normalizers safely fall back on invalid or legacy values', () => {
    assert.equal(normalizeBrowserEngine(undefined), 'system-chrome');
    assert.equal(normalizeBrowserEngine('unknown-engine'), 'system-chrome');
    assert.equal(normalizeBrowserEngine('fingerprint-chromium'), 'fingerprint-chromium');

    assert.equal(parseFingerprintConfigJson('not-json'), undefined);
    assert.equal(parseFingerprintConfigJson(null), undefined);

    const defaults = normalizeDefaultFingerprintSettings({
        defaultEngine: 'invalid',
        platform: 'bsd',
        autoMatchTimezone: false,
        defaultLanguage: 'en-GB',
        spoofing: { gpu: false },
    });
    assert.equal(defaults.defaultEngine, 'system-chrome');
    assert.equal(defaults.platform, getHostFingerprintPlatform());
    assert.equal(defaults.autoMatchTimezone, false);
    assert.equal(defaults.defaultLanguage, 'en-GB');
    assert.equal(defaults.spoofing.gpu, false);
    assert.equal(defaults.spoofing.canvas, true);
});

test('normalizeGitHubReleases supports Windows, macOS (.dmg) and Linux (.tar.xz) assets with SHA-256', () => {
    const shaWin = 'a'.repeat(64);
    const shaMac = 'b'.repeat(64);
    const shaLinux = 'c'.repeat(64);
    const mockApi = [
        {
            tag_name: '150.0.7871.186',
            published_at: '2026-10-02T14:02:29Z',
            assets: [
                {
                    name: 'ungoogled-chromium_150.0.7871.186-1.1_windows_x64.zip',
                    browser_download_url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/150/win.zip',
                    digest: `sha256:${shaWin}`,
                    size: 193000000,
                },
                {
                    name: 'ungoogled-chromium-150.0.7871.186-1-x86_64_linux.tar.xz',
                    browser_download_url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/150/linux.tar.xz',
                    digest: `sha256:${shaLinux}`,
                    size: 145000000,
                },
            ],
        },
        {
            tag_name: '148.0.7778.215',
            published_at: '2026-06-21T04:34:00Z',
            assets: [
                {
                    name: 'ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip',
                    browser_download_url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/148/win.zip',
                    digest: `sha256:${shaWin}`,
                    size: 189000000,
                },
                {
                    name: 'ungoogled-chromium_148.0.7778.215-1.1_macos.dmg',
                    browser_download_url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/148/mac.dmg',
                    digest: `sha256:${shaMac}`,
                    size: 140000000,
                },
                {
                    name: 'ungoogled-chromium-148.0.7778.215-1-x86_64_linux.tar.xz',
                    browser_download_url: 'https://github.com/adryfish/fingerprint-chromium/releases/download/148/linux.tar.xz',
                    digest: `sha256:${shaLinux}`,
                    size: 141000000,
                },
            ],
        },
    ];

    const winList = normalizeGitHubReleases(mockApi, 'win32');
    assert.equal(winList.length, 2);
    assert.equal(winList[0].sourceAuditable, false);
    assert.equal(winList[1].sourceAuditable, true);
    assert.equal(winList[1].recommended, true);

    // macOS only shows releases that actually ship a macos.dmg asset
    const macList = normalizeGitHubReleases(mockApi, 'darwin');
    assert.equal(macList.length, 1);
    assert.equal(macList[0].version, '148.0.7778.215');
    assert.equal(macList[0].sha256, shaMac);
    assert.equal(macList[0].sourceAuditable, true);
    assert.equal(macList[0].recommended, true);

    const linuxList = normalizeGitHubReleases(mockApi, 'linux');
    assert.equal(linuxList.length, 2);
    assert.match(linuxList[0].assetName, /linux\.tar\.xz$/);
    assert.equal(linuxList[1].recommended, true);

    // Curated manifest covers all three platforms
    assert.ok(getCuratedFingerprintReleases('win32').length >= 1);
    assert.ok(getCuratedFingerprintReleases('darwin').length >= 1);
    assert.ok(getCuratedFingerprintReleases('linux').length >= 1);

    // Host OS auto default platform
    assert.equal(getHostFingerprintPlatform('win32'), 'windows');
    assert.equal(getHostFingerprintPlatform('darwin'), 'macos');
    assert.equal(getHostFingerprintPlatform('linux'), 'linux');
});

test('assertOfficialGitHubUrl enforces HTTPS official GitHub hosts and parses SHA-256 digests', () => {
    assert.doesNotThrow(() =>
        assertOfficialGitHubUrl(
            'https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box.zip',
        ),
    );
    assert.doesNotThrow(() =>
        assertOfficialGitHubUrl(
            'https://objects.githubusercontent.com/github-production-release-asset/123',
        ),
    );
    assert.throws(() =>
        assertOfficialGitHubUrl('http://github.com/SagerNet/sing-box'),
    );
    assert.throws(() =>
        assertOfficialGitHubUrl('https://evil-mirror.example.com/sing-box.zip'),
    );

    const validHex = '99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df';
    assert.equal(parseGitHubSha256Digest(`sha256:${validHex}`), validHex);
    assert.equal(parseGitHubSha256Digest('md5:1234'), '');
    assert.equal(parseGitHubSha256Digest(undefined), '');
});

test('normalizeSingboxReleases skips prereleases and requires official SHA-256 digest', () => {
    const shaStable = 'c'.repeat(64);
    const list = normalizeSingboxReleases(
        [
            {
                tag_name: 'v1.15.0-alpha.1',
                prerelease: true,
                assets: [
                    {
                        name: 'sing-box-1.15.0-alpha.1-windows-amd64.zip',
                        browser_download_url: 'https://github.com/SagerNet/sing-box/releases/download/v1.15.0-alpha.1/a.zip',
                        digest: `sha256:${'d'.repeat(64)}`,
                    },
                ],
            },
            {
                tag_name: 'v1.14.9',
                prerelease: false,
                assets: [
                    {
                        name: 'sing-box-1.14.9-windows-amd64.zip',
                        browser_download_url: 'https://github.com/SagerNet/sing-box/releases/download/v1.14.9/b.zip',
                        digest: `sha256:${shaStable}`,
                        size: 32000000,
                    },
                ],
            },
        ],
        'win32',
        'x64',
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].version, '1.14.9');
    assert.equal(list[0].sha256, shaStable);
    assert.equal(list[0].recommended, true);
    assert.ok(getCuratedSingboxReleases('win32', 'x64').length >= 1);
});

test('KernelManager manages sing-box cores and SingboxCore resolves active binary dynamically', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-singbox-mgr-'));
    try {
        const dataPath = path.join(tmpRoot, 'data');
        const extDir = path.join(tmpRoot, 'sing-box-1.14.4');
        fs.mkdirSync(extDir, { recursive: true });
        const exeName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
        const fakeExe = path.join(extDir, exeName);
        fs.writeFileSync(fakeExe, 'fake-singbox-binary');

        const manager = new KernelManager({ getDataPath: () => dataPath });
        const core = new SingboxCore({
            resolveBinary: () => {
                const active = manager.getActiveSingbox();
                return active
                    ? { binaryPath: active.executablePath, version: active.version }
                    : null;
            },
        });

        assert.equal(core.getInfo().available, false);

        const imported = await manager.importLocalSingbox(fakeExe);
        assert.equal(imported.version, '1.14.4');
        assert.equal(core.getInfo().available, true);
        assert.equal(core.getInfo().version, '1.14.4');

        manager.removeSingbox(imported.id);
        assert.equal(core.getInfo().available, false);
        assert.ok(fs.existsSync(fakeExe));
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('KernelManager stores manifest under <dataPath>/kernels and manages imported kernels safely', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-kernel-test-'));
    try {
        const dataPath = path.join(tmpRoot, 'data');
        const externalDir = path.join(tmpRoot, 'external-chrome-148.0.7778.215');
        fs.mkdirSync(externalDir, { recursive: true });
        const exeName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
        const fakeExe = path.join(externalDir, exeName);
        fs.writeFileSync(fakeExe, 'fake-chromium-binary');

        const manager = new KernelManager({ getDataPath: () => dataPath });
        assert.equal(manager.getKernelsDir(), path.join(dataPath, 'kernels'));
        assert.equal(manager.getActiveKernel(), null);

        const imported = await manager.importLocalKernel(externalDir);
        assert.equal(imported.version, '148.0.7778.215');
        assert.equal(imported.executablePath, fakeExe);
        assert.equal(imported.executableSha256.length, 64);

        const active = manager.getActiveKernel();
        assert.equal(active?.id, imported.id);
        assert.ok(fs.existsSync(path.join(dataPath, 'kernels', 'manifest.json')));

        // Removing an externally imported kernel must NOT delete the user's external folder
        manager.removeKernel(imported.id);
        assert.equal(manager.getActiveKernel(), null);
        assert.ok(fs.existsSync(fakeExe));
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
