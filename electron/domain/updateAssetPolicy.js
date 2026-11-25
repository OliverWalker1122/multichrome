export function selectPlatformReleaseAsset(
    assets,
    platform = process.platform,
    arch = process.arch,
) {
    if (!Array.isArray(assets) || assets.length === 0) {
        return { installer: null, checksumAsset: null };
    }

    const checksumAsset =
        assets.find(
            (a) =>
                typeof a?.name === 'string' &&
                a.name.trim().toUpperCase() === 'SHA256SUMS.TXT',
        ) || null;

    const validUrl = (a) =>
        typeof a?.name === 'string' &&
        typeof a?.browser_download_url === 'string' &&
        a.browser_download_url.startsWith('https://');

    const candidates = assets.filter(validUrl);
    let installer = null;

    if (platform === 'win32') {
        installer =
            candidates.find((a) => /\.exe$/i.test(a.name)) || null;
    } else if (platform === 'darwin') {
        const dmgList = candidates.filter((a) => /\.dmg$/i.test(a.name));
        if (arch === 'arm64') {
            installer =
                dmgList.find((a) => /arm64|aarch64/i.test(a.name)) ||
                dmgList[0] ||
                null;
        } else {
            installer =
                dmgList.find((a) => /x64|x86_64|universal/i.test(a.name)) ||
                dmgList[0] ||
                null;
        }
    } else if (platform === 'linux') {
        const appImages = candidates.filter((a) => /\.AppImage$/i.test(a.name));
        const debs = candidates.filter((a) => /\.deb$/i.test(a.name));
        if (arch === 'arm64') {
            installer =
                appImages.find((a) => /arm64|aarch64/i.test(a.name)) ||
                debs.find((a) => /arm64|aarch64/i.test(a.name)) ||
                appImages[0] ||
                debs[0] ||
                null;
        } else {
            installer =
                appImages.find((a) => /x86_64|amd64|x64/i.test(a.name)) ||
                appImages[0] ||
                debs[0] ||
                null;
        }
    }

    return {
        installer: installer
            ? {
                  name: installer.name,
                  downloadUrl: installer.browser_download_url,
                  sizeBytes: Number(installer.size) || 0,
              }
            : null,
        checksumAsset: checksumAsset
            ? {
                  name: checksumAsset.name,
                  downloadUrl: checksumAsset.browser_download_url,
              }
            : null,
    };
}

export function normalizeGitHubAssetName(fileName) {
    return String(fileName || '')
        .trim()
        .replace(/^\.\//, '')
        .replace(/\s+/g, '.');
}

export function parseSha256SumsEntries(sumsText) {
    if (typeof sumsText !== 'string') return [];
    const entries = [];
    for (const rawLine of sumsText.split(/\r?\n/)) {
        const match = rawLine
            .trim()
            .match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
        if (!match) continue;
        const digest = match[1].toLowerCase();
        const fileName = match[2].trim().replace(/^\.\//, '');
        if (!fileName) continue;
        entries.push({ digest, fileName });
    }
    return entries;
}

export function parseSha256Sums(sumsText, targetFileName) {
    if (typeof sumsText !== 'string' || !targetFileName) {
        throw new Error('校验和文件或目标文件名无效');
    }
    const normalizedTarget = targetFileName.trim().replace(/^\.\//, '');
    const githubNormalizedTarget = normalizeGitHubAssetName(normalizedTarget);
    const entries = parseSha256SumsEntries(sumsText);

    const exact = entries.find((entry) => entry.fileName === normalizedTarget);
    if (exact) return exact.digest;

    const normalizedMatch = entries.find(
        (entry) =>
            normalizeGitHubAssetName(entry.fileName) === githubNormalizedTarget,
    );
    if (normalizedMatch) return normalizedMatch.digest;

    throw new Error(`在 SHA256SUMS.txt 中未找到 ${normalizedTarget} 的校验摘要`);
}

export function parseLatestReleaseTagFromLocation(locationUrl, expectedRepoUrl) {
    if (typeof locationUrl !== 'string' || typeof expectedRepoUrl !== 'string') {
        throw new Error('未获取到有效版本跳转地址');
    }
    let location;
    let repo;
    try {
        location = new URL(locationUrl);
        repo = new URL(expectedRepoUrl);
    } catch {
        throw new Error('版本跳转地址格式无效');
    }
    if (
        location.protocol !== 'https:' ||
        location.hostname.toLowerCase() !== repo.hostname.toLowerCase()
    ) {
        throw new Error('已拦截非官方发布页跳转');
    }
    const repoPrefix = repo.pathname.replace(/\/+$/, '');
    const expectedPrefix = `${repoPrefix}/releases/tag/`.toLowerCase();
    if (!location.pathname.toLowerCase().startsWith(expectedPrefix)) {
        throw new Error('未获取到有效版本标签');
    }
    const rawSegment = location.pathname
        .slice(expectedPrefix.length)
        .split('/')[0];
    let tagName = '';
    try {
        tagName = decodeURIComponent(rawSegment).trim();
    } catch {
        throw new Error('版本标签解码失败');
    }
    if (!tagName || /[/?#\\\s]/.test(tagName)) {
        throw new Error('版本标签格式无效');
    }
    return {
        tagName,
        releaseUrl: `${repo.origin}${repoPrefix}/releases/tag/${encodeURIComponent(tagName)}`,
    };
}

export function buildReleasePayloadFromTagAndSums({
    repoUrl,
    tagName,
    sumsText = '',
}) {
    const cleanRepo = String(repoUrl || '').replace(/\/+$/, '');
    const cleanTag = String(tagName || '').trim();
    const encodedTag = encodeURIComponent(cleanTag);
    const baseDownload = `${cleanRepo}/releases/download/${encodedTag}`;
    const entries = parseSha256SumsEntries(sumsText);
    const seen = new Set();
    const assets = [];

    for (const entry of entries) {
        const assetName = normalizeGitHubAssetName(entry.fileName);
        if (!assetName || seen.has(assetName)) continue;
        seen.add(assetName);
        assets.push({
            name: assetName,
            browser_download_url: `${baseDownload}/${encodeURIComponent(assetName)}`,
            size: 0,
        });
    }
    if (entries.length > 0 && !seen.has('SHA256SUMS.txt')) {
        assets.push({
            name: 'SHA256SUMS.txt',
            browser_download_url: `${baseDownload}/SHA256SUMS.txt`,
            size: 0,
        });
    }

    return {
        tag_name: cleanTag,
        html_url: `${cleanRepo}/releases/tag/${encodedTag}`,
        assets,
    };
}
