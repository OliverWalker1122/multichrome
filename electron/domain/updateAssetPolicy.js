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

export function parseSha256Sums(sumsText, targetFileName) {
    if (typeof sumsText !== 'string' || !targetFileName) {
        throw new Error('校验和文件或目标文件名无效');
    }
    const normalizedTarget = targetFileName.trim();
    const lines = sumsText.split(/\r?\n/);
    for (const rawLine of lines) {
        const match = rawLine
            .trim()
            .match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
        if (!match) continue;
        const digest = match[1].toLowerCase();
        const fileName = match[2].trim().replace(/^\.\//, '');
        if (fileName === normalizedTarget) {
            return digest;
        }
    }
    throw new Error(`在 SHA256SUMS.txt 中未找到 ${normalizedTarget} 的校验摘要`);
}
