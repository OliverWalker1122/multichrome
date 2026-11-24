import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BUNDLED_MANIFEST = require('./kernelManifest.json');

let cachedManifest = null;

export function loadKernelManifest(manifestInput = BUNDLED_MANIFEST) {
    if (manifestInput === BUNDLED_MANIFEST && cachedManifest) {
        return cachedManifest;
    }
    const parsed =
        typeof manifestInput === 'string'
            ? require(manifestInput)
            : manifestInput;
    if (
        !parsed ||
        typeof parsed !== 'object' ||
        !parsed.fingerprintChromium ||
        !parsed.singBox
    ) {
        throw new Error('kernelManifest.json 格式无效');
    }
    if (manifestInput === BUNDLED_MANIFEST) {
        cachedManifest = parsed;
    }
    return parsed;
}

export function compareDotVersions(a, b) {
    const parseParts = (ver) =>
        String(ver || '')
            .trim()
            .replace(/^v/i, '')
            .split(/[^0-9]+/)
            .filter(Boolean)
            .map((part) => Number.parseInt(part, 10));

    const partsA = parseParts(a);
    const partsB = parseParts(b);
    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i += 1) {
        const numA = partsA[i] ?? 0;
        const numB = partsB[i] ?? 0;
        if (numA !== numB) return numA > numB ? 1 : -1;
    }
    return 0;
}

export function getAllowedFingerprintReleases(
    platform = process.platform,
    manifest = loadKernelManifest(),
    locale = 'zh-CN',
) {
    const isEn =
        typeof locale === 'string' && locale.toLowerCase().startsWith('en');
    const key =
        platform === 'darwin'
            ? 'darwin'
            : platform === 'linux'
              ? 'linux'
              : 'win32';
    const list = [];
    for (const [version, info] of Object.entries(
        manifest.fingerprintChromium || {},
    )) {
        const asset = info?.assets?.[key];
        if (!asset) continue;
        const suffix = isEn
            ? info.recommended
                ? 'Source Auditable · Recommended'
                : info.sourceAuditable
                  ? 'Source Auditable'
                  : 'Latest · Delayed Source'
            : info.recommended
              ? '源码已公开 · 推荐'
              : info.sourceAuditable
                ? '源码已公开'
                : '最新版 · 延迟开源';
        list.push({
            version,
            chromeMajor: info.chromeMajor,
            name: `Chrome ${info.chromeMajor} (${suffix})`,
            publishedAt: info.publishedAt,
            sourceAuditable: Boolean(info.sourceAuditable),
            sourceTagUrl: info.sourceTagUrl,
            assetName: asset.name,
            downloadUrl: `https://github.com/adryfish/fingerprint-chromium/releases/download/${version}/${asset.name}`,
            sha256: asset.sha256,
            sizeBytes: asset.sizeBytes,
            recommended: Boolean(info.recommended),
        });
    }
    return list;
}

export function getAllowedSingboxReleases(
    platform = process.platform,
    arch = process.arch,
    manifest = loadKernelManifest(),
    locale = 'zh-CN',
) {
    const isEn =
        typeof locale === 'string' && locale.toLowerCase().startsWith('en');
    const key = `${platform}-${arch}`;
    const list = [];
    for (const [version, info] of Object.entries(manifest.singBox || {})) {
        const asset = info?.assets?.[key];
        if (!asset) continue;
        const suffix = isEn
            ? info.recommended
                ? 'Official Stable · Recommended'
                : 'Official Stable'
            : info.recommended
              ? '官方稳定版 · 推荐'
              : '官方稳定版';
        list.push({
            version,
            name: `sing-box v${version} (${suffix})`,
            publishedAt: info.publishedAt,
            assetName: asset.name,
            downloadUrl: `https://github.com/SagerNet/sing-box/releases/download/v${version}/${asset.name}`,
            releaseUrl: `https://github.com/SagerNet/sing-box/releases/tag/v${version}`,
            sha256: asset.sha256,
            sizeBytes: asset.sizeBytes,
            recommended: Boolean(info.recommended),
        });
    }
    return list;
}

export function assertAllowedFingerprintRelease(
    version,
    platform = process.platform,
    manifest = loadKernelManifest(),
) {
    const releases = getAllowedFingerprintReleases(platform, manifest);
    const found = releases.find((item) => item.version === version);
    if (!found) {
        throw new Error(
            `指纹内核版本 ${version} 不在受控白名单清单中，已禁止安装以保障兼容性`,
        );
    }
    return found;
}

export function assertAllowedSingboxRelease(
    version,
    platform = process.platform,
    arch = process.arch,
    manifest = loadKernelManifest(),
) {
    const releases = getAllowedSingboxReleases(platform, arch, manifest);
    const found = releases.find((item) => item.version === version);
    if (!found) {
        throw new Error(
            `sing-box 版本 ${version} 不在受控白名单清单中，已禁止安装以保障兼容性`,
        );
    }
    return found;
}

function pickCurrentInstalledVersion(items, activeId) {
    if (!Array.isArray(items) || items.length === 0) return null;
    if (activeId) {
        const active = items.find((item) => item?.id === activeId);
        if (active?.version) return active.version;
    }
    const sorted = [...items]
        .filter((item) => Boolean(item?.version))
        .sort((a, b) => compareDotVersions(b.version, a.version));
    return sorted[0]?.version || null;
}

export function getKernelUpdateSummary({
    installedKernels = [],
    activeKernelId = null,
    installedSingbox = [],
    activeSingboxId = null,
    platform = process.platform,
    arch = process.arch,
    manifest = loadKernelManifest(),
    locale = 'zh-CN',
} = {}) {
    const fpReleases = getAllowedFingerprintReleases(
        platform,
        manifest,
        locale,
    );
    const recommendedFp =
        fpReleases.find((item) => item.recommended) || fpReleases[0] || null;
    const currentFpVersion = pickCurrentInstalledVersion(
        installedKernels,
        activeKernelId,
    );
    const fpHasUpdate = Boolean(
        installedKernels.length > 0 &&
            currentFpVersion &&
            recommendedFp?.version &&
            compareDotVersions(recommendedFp.version, currentFpVersion) > 0,
    );

    const sbReleases = getAllowedSingboxReleases(
        platform,
        arch,
        manifest,
        locale,
    );
    const recommendedSb =
        sbReleases.find((item) => item.recommended) || sbReleases[0] || null;
    const currentSbVersion = pickCurrentInstalledVersion(
        installedSingbox,
        activeSingboxId,
    );
    const sbHasUpdate = Boolean(
        installedSingbox.length > 0 &&
            currentSbVersion &&
            recommendedSb?.version &&
            compareDotVersions(recommendedSb.version, currentSbVersion) > 0,
    );

    const updateCount = (fpHasUpdate ? 1 : 0) + (sbHasUpdate ? 1 : 0);

    return {
        policyMode: 'curated-manifest',
        manifestVersion: Number(manifest.schemaVersion) || 1,
        fingerprint: {
            hasUpdate: fpHasUpdate,
            currentVersion: currentFpVersion,
            recommendedVersion: recommendedFp?.version || null,
            recommendedChromeMajor: recommendedFp?.chromeMajor || null,
            recommendedName: recommendedFp?.name || null,
            installedCount: installedKernels.length,
        },
        singbox: {
            hasUpdate: sbHasUpdate,
            currentVersion: currentSbVersion,
            recommendedVersion: recommendedSb?.version || null,
            recommendedName: recommendedSb?.name || null,
            installedCount: installedSingbox.length,
        },
        hasAnyUpdate: updateCount > 0,
        updateCount,
    };
}
