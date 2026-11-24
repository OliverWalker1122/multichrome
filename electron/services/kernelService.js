import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import {
    assertOfficialGitHubUrl,
    openOfficialGitHubStream,
} from '../drivers/githubProxyTransport.js';
import {
    assertAllowedFingerprintRelease,
    assertAllowedSingboxRelease,
    getAllowedFingerprintReleases,
    getAllowedSingboxReleases,
    getKernelUpdateSummary,
} from '../domain/kernelPolicy.js';

export { assertOfficialGitHubUrl };

export function getCuratedFingerprintReleases(platform = process.platform) {
    return getAllowedFingerprintReleases(platform);
}

export const CURATED_FINGERPRINT_RELEASES = getCuratedFingerprintReleases();

export function getCuratedSingboxReleases(
    platform = process.platform,
    arch = process.arch,
) {
    return getAllowedSingboxReleases(platform, arch);
}

export function parseGitHubSha256Digest(digest) {
    if (typeof digest !== 'string') return '';
    const match = digest.trim().match(/^sha256:([a-f0-9]{64})$/i);
    return match ? match[1].toLowerCase() : '';
}

function parseMajorVersion(versionStr) {
    const match = String(versionStr || '').match(/^(\d+)/);
    return match ? Number(match[1]) : 0;
}

function findExecutableInDir(rootDir, targetNames, maxDepth = 3) {
    function search(currentDir, depth) {
        if (depth > maxDepth || !fs.existsSync(currentDir)) return null;
        let entries;
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return null;
        }
        for (const entry of entries) {
            if (entry.isFile() && targetNames.includes(entry.name)) {
                return path.join(currentDir, entry.name);
            }
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const found = search(path.join(currentDir, entry.name), depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    return search(rootDir, 0);
}

export function findChromeExecutableInDir(rootDir, maxDepth = 5) {
    const targetNames =
        process.platform === 'win32'
            ? ['chrome.exe']
            : process.platform === 'darwin'
              ? ['Chromium', 'Google Chrome']
              : ['chrome', 'chromium'];
    return findExecutableInDir(rootDir, targetNames, maxDepth);
}

export function findSingboxExecutableInDir(rootDir, maxDepth = 3) {
    const targetNames =
        process.platform === 'win32' ? ['sing-box.exe'] : ['sing-box'];
    return findExecutableInDir(rootDir, targetNames, maxDepth);
}

export function computeFileSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function getDirectorySizeBytes(dirPath) {
    let total = 0;
    const stack = [dirPath];
    while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
            entries = await fs.promises.readdir(current, {
                withFileTypes: true,
            });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            try {
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                } else if (entry.isFile()) {
                    const stat = await fs.promises.stat(fullPath);
                    total += stat.size;
                }
            } catch {
                // ignore unreadable entries
            }
        }
    }
    return total;
}

function execFileAsync(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

async function extractMacDmg(dmgPath, targetDir) {
    const mountDir = path.join(
        path.dirname(targetDir),
        `.dmg-mount-${Date.now()}`,
    );
    fs.mkdirSync(mountDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    try {
        await execFileAsync(
            'hdiutil',
            ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountDir],
            { timeout: 120000 },
        );
        const entries = fs.readdirSync(mountDir, { withFileTypes: true });
        const appBundle = entries.find(
            (entry) => entry.isDirectory() && /\.app$/i.test(entry.name),
        );
        if (!appBundle) {
            throw new Error('DMG 镜像中未找到 .app 应用包');
        }
        const sourceApp = path.join(mountDir, appBundle.name);
        const destApp = path.join(targetDir, appBundle.name);
        await execFileAsync('ditto', [sourceApp, destApp], { timeout: 180000 });
        // 清理 macOS 下载隔离标记，避免 Gatekeeper 阻止已校验内核启动
        try {
            await execFileAsync(
                'xattr',
                ['-dr', 'com.apple.quarantine', destApp],
                { timeout: 30000 },
            );
        } catch {
            // ignore if xattr absent or attribute unset
        }
    } finally {
        try {
            await execFileAsync('hdiutil', ['detach', mountDir, '-force'], {
                timeout: 30000,
            });
        } catch {
            // ignore detach failure
        }
        try {
            fs.rmSync(mountDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failure
        }
    }
}

export function extractArchive(archivePath, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const isTarGz = /\.tar\.gz$/i.test(archivePath);
    const isTarXz = /\.tar\.xz$/i.test(archivePath);
    const isDmg = /\.dmg$/i.test(archivePath);

    if (isDmg) {
        if (process.platform !== 'darwin') {
            return Promise.reject(new Error('仅 macOS 支持挂载安装 .dmg 镜像'));
        }
        return extractMacDmg(archivePath, targetDir);
    }

    return new Promise((resolve, reject) => {
        if (process.platform === 'win32') {
            execFile(
                'tar.exe',
                ['-xf', archivePath, '-C', targetDir],
                { windowsHide: true, timeout: 180000 },
                (tarErr) => {
                    if (!tarErr) {
                        resolve();
                        return;
                    }
                    if (isTarGz || isTarXz) {
                        reject(
                            new Error(
                                `解压 tar 压缩包失败: ${tarErr.message}`,
                            ),
                        );
                        return;
                    }
                    const escapedZip = archivePath.replace(/'/g, "''");
                    const escapedTarget = targetDir.replace(/'/g, "''");
                    execFile(
                        'powershell.exe',
                        [
                            '-NoProfile',
                            '-NonInteractive',
                            '-Command',
                            `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedTarget}' -Force`,
                        ],
                        { windowsHide: true, timeout: 300000 },
                        (psErr) => {
                            if (psErr) {
                                reject(
                                    new Error(
                                        `解压内核压缩包失败: ${psErr.message || tarErr.message}`,
                                    ),
                                );
                                return;
                            }
                            resolve();
                        },
                    );
                },
            );
            return;
        }

        const cmd = isTarGz || isTarXz ? 'tar' : 'unzip';
        const args = isTarXz
            ? ['-xJf', archivePath, '-C', targetDir]
            : isTarGz
              ? ['-xzf', archivePath, '-C', targetDir]
              : ['-o', archivePath, '-d', targetDir];
        execFile(cmd, args, { timeout: 180000 }, (err) => {
            if (err) {
                reject(new Error(`解压内核压缩包失败: ${err.message}`));
                return;
            }
            resolve();
        });
    });
}

function getFingerprintAssetPattern(platform = process.platform) {
    if (platform === 'darwin') return /macos\.dmg$/i;
    if (platform === 'linux') return /linux\.tar\.xz$/i;
    return /windows_x64\.zip$/i;
}

export function normalizeGitHubReleases(
    rawReleases,
    platform = process.platform,
) {
    const fallback = getCuratedFingerprintReleases(platform);
    if (!Array.isArray(rawReleases) || rawReleases.length === 0) {
        return fallback;
    }

    const pattern = getFingerprintAssetPattern(platform);
    const parsed = [];
    for (let i = 0; i < rawReleases.length; i++) {
        const rel = rawReleases[i];
        if (!rel || rel.draft || !rel.tag_name || !Array.isArray(rel.assets)) continue;
        const matchedAsset = rel.assets.find(
            (asset) =>
                typeof asset?.name === 'string' &&
                pattern.test(asset.name) &&
                typeof asset?.browser_download_url === 'string',
        );
        if (!matchedAsset) continue;

        const version = String(rel.tag_name).trim();
        const chromeMajor = parseMajorVersion(version);
        const apiSha256 = parseGitHubSha256Digest(matchedAsset.digest);
        const curated = fallback.find((item) => item.version === version);
        const sha256 = apiSha256 || curated?.sha256 || '';
        if (!sha256) continue; // 安全策略：仅展示含官方 SHA-256 指纹的发行版

        parsed.push({
            version,
            chromeMajor,
            publishedAt: rel.published_at || '',
            assetName: matchedAsset.name,
            downloadUrl: matchedAsset.browser_download_url,
            sha256,
            sizeBytes: Number(matchedAsset.size) || undefined,
            sourceTagUrl: `https://github.com/adryfish/fingerprint-chromium/tree/${encodeURIComponent(version)}`,
            // 最新上游 release（rawReleases[0]）处于延迟开源窗口，其余历史 tag 源码均已公开
            sourceAuditable: i > 0,
        });
    }

    if (parsed.length === 0) {
        return fallback;
    }

    const firstAuditableIdx = parsed.findIndex((item) => item.sourceAuditable);
    const recommendedIdx = firstAuditableIdx >= 0 ? firstAuditableIdx : 0;

    return parsed.slice(0, 6).map((item, index) => {
        const recommended = index === recommendedIdx;
        const suffix = recommended
            ? item.sourceAuditable
                ? '源码已公开 · 推荐'
                : '推荐'
            : item.sourceAuditable
              ? '源码已公开'
              : '最新版 · 延迟开源';
        return {
            ...item,
            recommended,
            name: `Chrome ${item.chromeMajor || item.version} (${suffix})`,
        };
    });
}

function getSingboxAssetPattern(platform = process.platform, arch = process.arch) {
    const osPart =
        platform === 'win32'
            ? 'windows'
            : platform === 'darwin'
              ? 'darwin'
              : 'linux';
    const archPart = arch === 'arm64' ? 'arm64' : 'amd64';
    const ext = platform === 'win32' ? '\\.zip' : '\\.tar\\.gz';
    return new RegExp(`^sing-box-[^-]+-${osPart}-${archPart}${ext}$`, 'i');
}

export function normalizeSingboxReleases(
    rawReleases,
    platform = process.platform,
    arch = process.arch,
) {
    const fallback = getCuratedSingboxReleases(platform, arch);
    if (!Array.isArray(rawReleases) || rawReleases.length === 0) {
        return fallback;
    }

    const pattern = getSingboxAssetPattern(platform, arch);
    const parsed = [];
    for (const rel of rawReleases) {
        if (
            !rel ||
            rel.draft ||
            rel.prerelease ||
            !rel.tag_name ||
            !Array.isArray(rel.assets)
        ) {
            continue;
        }
        const asset = rel.assets.find(
            (item) =>
                typeof item?.name === 'string' &&
                pattern.test(item.name) &&
                typeof item?.browser_download_url === 'string',
        );
        if (!asset) continue;

        const version = String(rel.tag_name).replace(/^v/i, '').trim();
        const apiSha256 = parseGitHubSha256Digest(asset.digest);
        const curated = fallback.find((item) => item.version === version);
        const sha256 = apiSha256 || curated?.sha256 || '';
        if (!sha256) continue; // 安全策略：必须具备 GitHub 官方 SHA-256 指纹

        parsed.push({
            version,
            publishedAt: rel.published_at || '',
            assetName: asset.name,
            downloadUrl: asset.browser_download_url,
            releaseUrl: `https://github.com/SagerNet/sing-box/releases/tag/v${encodeURIComponent(version)}`,
            sha256,
            sizeBytes: Number(asset.size) || undefined,
        });
    }

    if (parsed.length === 0) {
        return fallback;
    }

    return parsed.slice(0, 6).map((item, index) => ({
        ...item,
        recommended: index === 0,
        name:
            index === 0
                ? `sing-box v${item.version} (最新稳定版 · 推荐)`
                : `sing-box v${item.version} (官方稳定版)`,
    }));
}

export class KernelManager {
    /**
     * @param {{ getDataPath: () => string, logger?: { info?: (...args: unknown[]) => void, warn?: (...args: unknown[]) => void, error?: (...args: unknown[]) => void } }} options
     */
    constructor({ getDataPath, logger = console }) {
        this.getDataPath = getDataPath;
        this.logger = logger;
        this.activeDownloads = new Map();
        this.cachedReleases = null;
        this.cachedSingboxReleases = null;
    }

    getKernelsDir() {
        const dataPath = this.getDataPath();
        return path.join(dataPath, 'kernels');
    }

    getSingboxDir() {
        return path.join(this.getKernelsDir(), 'sing-box');
    }

    getManifestPath() {
        return path.join(this.getKernelsDir(), 'manifest.json');
    }

    readManifest() {
        const manifestPath = this.getManifestPath();
        if (!fs.existsSync(manifestPath)) {
            return {
                activeKernelId: null,
                kernels: [],
                activeSingboxId: null,
                singboxKernels: [],
            };
        }
        try {
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const kernels = Array.isArray(raw.kernels) ? raw.kernels : [];
            const validKernels = kernels.filter(
                (item) =>
                    item &&
                    typeof item.id === 'string' &&
                    typeof item.executablePath === 'string' &&
                    fs.existsSync(item.executablePath),
            );
            const activeKernelId = validKernels.some(
                (k) => k.id === raw.activeKernelId,
            )
                ? raw.activeKernelId
                : validKernels[0]?.id || null;

            const singboxKernels = Array.isArray(raw.singboxKernels)
                ? raw.singboxKernels
                : [];
            const validSingbox = singboxKernels.filter(
                (item) =>
                    item &&
                    typeof item.id === 'string' &&
                    typeof item.executablePath === 'string' &&
                    fs.existsSync(item.executablePath),
            );
            const activeSingboxId = validSingbox.some(
                (k) => k.id === raw.activeSingboxId,
            )
                ? raw.activeSingboxId
                : validSingbox[0]?.id || null;

            return {
                activeKernelId,
                kernels: validKernels,
                activeSingboxId,
                singboxKernels: validSingbox,
            };
        } catch {
            return {
                activeKernelId: null,
                kernels: [],
                activeSingboxId: null,
                singboxKernels: [],
            };
        }
    }

    writeManifest(manifest) {
        const dir = this.getKernelsDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            this.getManifestPath(),
            JSON.stringify(manifest, null, 2),
            'utf8',
        );
    }

    getStatus(systemChromePath = '', locale = 'zh-CN') {
        const manifest = this.readManifest();
        const fpDl = this.activeDownloads.get('fingerprint-chromium');
        const sbDl = this.activeDownloads.get('sing-box');
        const availableReleases = getAllowedFingerprintReleases(
            process.platform,
            undefined,
            locale,
        );
        const availableSingboxReleases = getAllowedSingboxReleases(
            process.platform,
            process.arch,
            undefined,
            locale,
        );
        const updateSummary = getKernelUpdateSummary({
            installedKernels: manifest.kernels,
            activeKernelId: manifest.activeKernelId,
            installedSingbox: manifest.singboxKernels,
            activeSingboxId: manifest.activeSingboxId,
            locale,
        });
        return {
            kernelsDir: this.getKernelsDir(),
            activeKernelId: manifest.activeKernelId,
            installedKernels: manifest.kernels,
            availableReleases,
            systemChromePath: systemChromePath || '',
            systemChromeAvailable: Boolean(
                systemChromePath && fs.existsSync(systemChromePath),
            ),
            downloading: fpDl
                ? {
                      version: fpDl.version,
                      stage: fpDl.stage,
                      percent: fpDl.percent,
                  }
                : null,
            singboxDir: this.getSingboxDir(),
            activeSingboxId: manifest.activeSingboxId,
            installedSingbox: manifest.singboxKernels,
            availableSingboxReleases,
            downloadingSingbox: sbDl
                ? {
                      version: sbDl.version,
                      stage: sbDl.stage,
                      percent: sbDl.percent,
                  }
                : null,
            updateSummary,
        };
    }

    getActiveKernel() {
        const manifest = this.readManifest();
        if (!manifest.activeKernelId) return null;
        const found = manifest.kernels.find(
            (item) => item.id === manifest.activeKernelId,
        );
        if (!found || !fs.existsSync(found.executablePath)) return null;
        return found;
    }

    getActiveSingbox() {
        const manifest = this.readManifest();
        if (!manifest.activeSingboxId) return null;
        const found = manifest.singboxKernels.find(
            (item) => item.id === manifest.activeSingboxId,
        );
        if (!found || !fs.existsSync(found.executablePath)) return null;
        return found;
    }

    async fetchAvailableReleases(_proxyAddress) {
        void _proxyAddress;
        // 严格只返回受控白名单清单中已验证兼容的版本，避免用户误装未验证上游版本
        this.cachedReleases = getAllowedFingerprintReleases();
        return this.cachedReleases;
    }

    async fetchAvailableSingboxReleases(_proxyAddress) {
        void _proxyAddress;
        // 严格只返回受控白名单清单中已验证兼容的版本，避免 sing-box 配置 schema 不兼容
        this.cachedSingboxReleases = getAllowedSingboxReleases();
        return this.cachedSingboxReleases;
    }

    async _downloadVerifiedArchive({
        targetKey,
        version,
        assetName,
        downloadUrl,
        expectedSha256,
        expectedSizeBytes,
        downloadsDir,
        proxyAddress,
        onProgress,
    }) {
        if (this.activeDownloads.has(targetKey)) {
            throw new Error(`正在下载 ${targetKey}，请稍候完成`);
        }
        if (!expectedSha256 || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
            throw new Error(
                '缺少 GitHub 官方 SHA-256 指纹，为保障安全已拒绝下载',
            );
        }
        assertOfficialGitHubUrl(downloadUrl);

        fs.mkdirSync(downloadsDir, { recursive: true });
        const archivePath = path.join(downloadsDir, assetName);
        const partPath = `${archivePath}.part`;

        const controller = new AbortController();
        const state = {
            version,
            stage: 'downloading',
            percent: 0,
            controller,
        };
        this.activeDownloads.set(targetKey, state);

        const emit = (payload) => {
            state.stage = payload.stage;
            state.percent = payload.percent;
            if (typeof onProgress === 'function') {
                onProgress({ target: targetKey, version, ...payload });
            }
        };

        try {
            emit({
                stage: 'downloading',
                percent: 0,
                receivedBytes: 0,
                totalBytes: expectedSizeBytes || 0,
                message: `正在从 GitHub 官方下载 ${assetName}…`,
            });

            const res = await openOfficialGitHubStream(downloadUrl, {
                proxyAddress,
                signal: controller.signal,
                timeoutMs: 60000,
            });

            const totalBytes =
                Number(res.headers['content-length']) || expectedSizeBytes || 0;
            let receivedBytes = 0;
            let lastEmitAt = 0;
            const hash = crypto.createHash('sha256');
            const out = fs.createWriteStream(partPath);

            await new Promise((resolve, reject) => {
                const cleanupError = (err) => {
                    out.destroy();
                    reject(err);
                };
                res.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    hash.update(chunk);
                    const now = Date.now();
                    if (now - lastEmitAt >= 200) {
                        lastEmitAt = now;
                        const percent =
                            totalBytes > 0
                                ? Math.min(
                                      99,
                                      Math.floor(
                                          (receivedBytes / totalBytes) * 100,
                                      ),
                                  )
                                : 0;
                        emit({
                            stage: 'downloading',
                            percent,
                            receivedBytes,
                            totalBytes,
                            message: `下载中 ${percent}%`,
                        });
                    }
                });
                res.on('error', cleanupError);
                out.on('error', cleanupError);
                out.on('finish', resolve);
                res.pipe(out);
            });

            emit({
                stage: 'verifying',
                percent: 100,
                receivedBytes,
                totalBytes,
                message: '正在校验 GitHub 官方 SHA-256 指纹…',
            });

            const actualSha256 = hash.digest('hex').toLowerCase();
            if (actualSha256 !== expectedSha256.toLowerCase()) {
                try {
                    fs.unlinkSync(partPath);
                } catch {
                    // ignore
                }
                throw new Error(
                    `官方 SHA-256 指纹校验失败（预期 ${expectedSha256.slice(0, 12)}…，实际 ${actualSha256.slice(0, 12)}…），已删除异常文件`,
                );
            }

            if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
            fs.renameSync(partPath, archivePath);
            return { archivePath, archiveSha256: actualSha256, receivedBytes, totalBytes, emit };
        } catch (error) {
            try {
                if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
            } catch {
                // ignore
            }
            emit({
                stage: 'error',
                percent: 0,
                message: error?.message || '下载校验失败',
            });
            this.activeDownloads.delete(targetKey);
            throw error;
        }
    }

    async downloadAndInstall(version, { proxyAddress, onProgress } = {}) {
        const release = assertAllowedFingerprintRelease(version);

        const kernelsDir = this.getKernelsDir();
        const downloadsDir = path.join(kernelsDir, '.downloads');
        const installDir = path.join(
            kernelsDir,
            `fingerprint-chromium-${release.version}`,
        );

        const { archivePath, archiveSha256, receivedBytes, totalBytes, emit } =
            await this._downloadVerifiedArchive({
                targetKey: 'fingerprint-chromium',
                version: release.version,
                assetName: release.assetName,
                downloadUrl: release.downloadUrl,
                expectedSha256: release.sha256,
                expectedSizeBytes: release.sizeBytes,
                downloadsDir,
                proxyAddress,
                onProgress,
            });

        try {
            emit({
                stage: 'extracting',
                percent: 100,
                receivedBytes,
                totalBytes,
                message: 'SHA-256 校验通过，正在解压到数据目录…',
            });

            if (fs.existsSync(installDir)) {
                fs.rmSync(installDir, { recursive: true, force: true });
            }
            await extractArchive(archivePath, installDir);

            const executablePath = findChromeExecutableInDir(installDir, 5);
            if (!executablePath) {
                throw new Error(
                    '解压后未找到浏览器可执行文件（chrome.exe / Chromium / chrome），压缩包结构可能不兼容',
                );
            }
            if (process.platform !== 'win32') {
                fs.chmodSync(executablePath, 0o755);
            }

            const executableSha256 = await computeFileSha256(executablePath);
            const sizeBytes = await getDirectorySizeBytes(installDir);

            try {
                fs.unlinkSync(archivePath);
            } catch {
                // ignore
            }

            const kernelId = `fingerprint-chromium-${release.version}`;
            const record = {
                id: kernelId,
                kind: 'fingerprint-chromium',
                name: `Fingerprint Chromium ${release.version}`,
                version: release.version,
                chromeMajor:
                    release.chromeMajor || parseMajorVersion(release.version),
                installDir,
                executablePath,
                source: 'github-release',
                sourceUrl: release.downloadUrl,
                sourceTagUrl: release.sourceTagUrl,
                sourceAuditable: Boolean(release.sourceAuditable),
                checksumVerified: true,
                archiveSha256,
                executableSha256,
                sizeBytes,
                installedAt: new Date().toISOString(),
            };

            const manifest = this.readManifest();
            manifest.kernels = manifest.kernels.filter(
                (item) => item.id !== kernelId,
            );
            manifest.kernels.unshift(record);
            manifest.activeKernelId = kernelId;
            this.writeManifest(manifest);

            emit({
                stage: 'done',
                percent: 100,
                receivedBytes,
                totalBytes,
                message: `指纹内核 ${release.version} 校验并安装完成`,
            });

            return record;
        } catch (error) {
            emit({
                stage: 'error',
                percent: 0,
                message: error?.message || '内核解压安装失败',
            });
            throw error;
        } finally {
            this.activeDownloads.delete('fingerprint-chromium');
        }
    }

    async downloadAndInstallSingbox(version, { proxyAddress, onProgress } = {}) {
        const release = assertAllowedSingboxRelease(version);

        const singboxRoot = this.getSingboxDir();
        const downloadsDir = path.join(this.getKernelsDir(), '.downloads');
        const installDir = path.join(singboxRoot, `sing-box-${release.version}`);

        const { archivePath, archiveSha256, receivedBytes, totalBytes, emit } =
            await this._downloadVerifiedArchive({
                targetKey: 'sing-box',
                version: release.version,
                assetName: release.assetName,
                downloadUrl: release.downloadUrl,
                expectedSha256: release.sha256,
                expectedSizeBytes: release.sizeBytes,
                downloadsDir,
                proxyAddress,
                onProgress,
            });

        try {
            emit({
                stage: 'extracting',
                percent: 100,
                receivedBytes,
                totalBytes,
                message: 'SHA-256 校验通过，正在解压 sing-box…',
            });

            if (fs.existsSync(installDir)) {
                fs.rmSync(installDir, { recursive: true, force: true });
            }
            await extractArchive(archivePath, installDir);

            const executablePath = findSingboxExecutableInDir(installDir, 3);
            if (!executablePath) {
                throw new Error('解压后未找到 sing-box 可执行文件');
            }
            if (process.platform !== 'win32') {
                fs.chmodSync(executablePath, 0o755);
            }

            const executableSha256 = await computeFileSha256(executablePath);
            const sizeBytes = fs.statSync(executablePath).size;

            // 写入 core.json 方便兼容元数据读取
            try {
                fs.writeFileSync(
                    path.join(path.dirname(executablePath), 'core.json'),
                    JSON.stringify(
                        {
                            version: release.version,
                            executable: path.basename(executablePath),
                            archive: release.assetName,
                            archiveSha256,
                            binarySha256: executableSha256,
                            release: release.releaseUrl,
                        },
                        null,
                        2,
                    ),
                    'utf8',
                );
            } catch {
                // ignore
            }

            try {
                fs.unlinkSync(archivePath);
            } catch {
                // ignore
            }

            const kernelId = `sing-box-${release.version}`;
            const record = {
                id: kernelId,
                kind: 'sing-box',
                name: `sing-box v${release.version}`,
                version: release.version,
                installDir,
                executablePath,
                source: 'github-release',
                sourceUrl: release.downloadUrl,
                releaseUrl: release.releaseUrl,
                checksumVerified: true,
                archiveSha256,
                executableSha256,
                sizeBytes,
                installedAt: new Date().toISOString(),
            };

            const manifest = this.readManifest();
            manifest.singboxKernels = manifest.singboxKernels.filter(
                (item) => item.id !== kernelId,
            );
            manifest.singboxKernels.unshift(record);
            manifest.activeSingboxId = kernelId;
            this.writeManifest(manifest);

            emit({
                stage: 'done',
                percent: 100,
                receivedBytes,
                totalBytes,
                message: `sing-box v${release.version} 校验并安装完成`,
            });

            return record;
        } catch (error) {
            emit({
                stage: 'error',
                percent: 0,
                message: error?.message || 'sing-box 安装失败',
            });
            throw error;
        } finally {
            this.activeDownloads.delete('sing-box');
        }
    }

    cancelDownload(targetKey = 'fingerprint-chromium') {
        const dl = this.activeDownloads.get(targetKey);
        if (dl?.controller) {
            dl.controller.abort();
            return true;
        }
        return false;
    }

    async importLocalKernel(selectedPath) {
        if (!selectedPath || !fs.existsSync(selectedPath)) {
            throw new Error('所选路径不存在');
        }

        const stat = fs.statSync(selectedPath);
        let installDir;
        let executablePath;
        let version = 'custom';
        let archiveSha256;

        if (stat.isFile() && /\.(?:zip|tar\.xz|tar\.gz|dmg)$/i.test(selectedPath)) {
            const versionMatch = path
                .basename(selectedPath)
                .match(/(\d+\.\d+\.\d+\.\d+)/);
            version = versionMatch ? versionMatch[1] : `local-${Date.now()}`;
            installDir = path.join(
                this.getKernelsDir(),
                `fingerprint-chromium-${version}`,
            );
            archiveSha256 = await computeFileSha256(selectedPath);
            if (fs.existsSync(installDir)) {
                fs.rmSync(installDir, { recursive: true, force: true });
            }
            await extractArchive(selectedPath, installDir);
            executablePath = findChromeExecutableInDir(installDir, 5);
            if (!executablePath) {
                throw new Error('安装包中未找到浏览器可执行文件');
            }
        } else if (stat.isFile()) {
            const base = path.basename(selectedPath).toLowerCase();
            if (process.platform === 'win32' && base !== 'chrome.exe') {
                throw new Error('请选择 chrome.exe、内核目录或内核 .zip 压缩包');
            }
            executablePath = selectedPath;
            installDir = path.dirname(selectedPath);
            const versionMatch = installDir.match(/(\d+\.\d+\.\d+\.\d+)/);
            if (versionMatch) version = versionMatch[1];
        } else if (stat.isDirectory()) {
            executablePath = findChromeExecutableInDir(selectedPath, 5);
            if (!executablePath) {
                throw new Error('所选目录中未找到浏览器可执行文件');
            }
            installDir = selectedPath;
            const versionMatch = selectedPath.match(/(\d+\.\d+\.\d+\.\d+)/);
            if (versionMatch) version = versionMatch[1];
        } else {
            throw new Error('不支持的文件类型');
        }

        if (process.platform !== 'win32') {
            fs.chmodSync(executablePath, 0o755);
        }

        const executableSha256 = await computeFileSha256(executablePath);
        const sizeBytes = await getDirectorySizeBytes(installDir);
        const kernelId = `local-${version}-${executableSha256.slice(0, 8)}`;

        const record = {
            id: kernelId,
            kind: 'fingerprint-chromium',
            name:
                version === 'custom'
                    ? `本地指纹内核 (${path.basename(installDir)})`
                    : `Fingerprint Chromium ${version} (本地导入)`,
            version,
            chromeMajor: parseMajorVersion(version),
            installDir,
            executablePath,
            source: 'local-import',
            sourceAuditable: true,
            checksumVerified: false,
            archiveSha256,
            executableSha256,
            sizeBytes,
            installedAt: new Date().toISOString(),
        };

        const manifest = this.readManifest();
        manifest.kernels = manifest.kernels.filter((item) => item.id !== kernelId);
        manifest.kernels.unshift(record);
        manifest.activeKernelId = kernelId;
        this.writeManifest(manifest);
        return record;
    }

    async importLocalSingbox(selectedPath) {
        if (!selectedPath || !fs.existsSync(selectedPath)) {
            throw new Error('所选路径不存在');
        }
        const stat = fs.statSync(selectedPath);
        let installDir;
        let executablePath;
        let version = 'custom';
        let archiveSha256;

        if (stat.isFile() && /\.(?:zip|tar\.gz)$/i.test(selectedPath)) {
            const versionMatch = path
                .basename(selectedPath)
                .match(/(\d+\.\d+\.\d+(?:-[0-9a-z.]+)?)/i);
            version = versionMatch ? versionMatch[1] : `local-${Date.now()}`;
            installDir = path.join(this.getSingboxDir(), `sing-box-${version}`);
            archiveSha256 = await computeFileSha256(selectedPath);
            if (fs.existsSync(installDir)) {
                fs.rmSync(installDir, { recursive: true, force: true });
            }
            await extractArchive(selectedPath, installDir);
            executablePath = findSingboxExecutableInDir(installDir, 3);
            if (!executablePath) {
                throw new Error('压缩包中未找到 sing-box 可执行文件');
            }
        } else if (stat.isFile()) {
            const base = path.basename(selectedPath).toLowerCase();
            if (process.platform === 'win32' && base !== 'sing-box.exe') {
                throw new Error('请选择 sing-box.exe 或官方 .zip/.tar.gz 压缩包');
            }
            executablePath = selectedPath;
            installDir = path.dirname(selectedPath);
            const versionMatch = installDir.match(/(\d+\.\d+\.\d+)/);
            if (versionMatch) version = versionMatch[1];
        } else if (stat.isDirectory()) {
            executablePath = findSingboxExecutableInDir(selectedPath, 3);
            if (!executablePath) {
                throw new Error('所选目录中未找到 sing-box 可执行文件');
            }
            installDir = selectedPath;
            const versionMatch = selectedPath.match(/(\d+\.\d+\.\d+)/);
            if (versionMatch) version = versionMatch[1];
        } else {
            throw new Error('不支持的文件类型');
        }

        if (process.platform !== 'win32') {
            fs.chmodSync(executablePath, 0o755);
        }

        const executableSha256 = await computeFileSha256(executablePath);
        const sizeBytes = fs.statSync(executablePath).size;
        const kernelId = `local-singbox-${version}-${executableSha256.slice(0, 8)}`;

        const record = {
            id: kernelId,
            kind: 'sing-box',
            name:
                version === 'custom'
                    ? `本地 sing-box (${path.basename(installDir)})`
                    : `sing-box v${version} (本地导入)`,
            version,
            installDir,
            executablePath,
            source: 'local-import',
            checksumVerified: false,
            archiveSha256,
            executableSha256,
            sizeBytes,
            installedAt: new Date().toISOString(),
        };

        const manifest = this.readManifest();
        manifest.singboxKernels = manifest.singboxKernels.filter(
            (item) => item.id !== kernelId,
        );
        manifest.singboxKernels.unshift(record);
        manifest.activeSingboxId = kernelId;
        this.writeManifest(manifest);
        return record;
    }

    setActiveKernel(kernelId) {
        const manifest = this.readManifest();
        const exists = manifest.kernels.some((item) => item.id === kernelId);
        if (!exists) {
            throw new Error('指定的指纹内核不存在或文件已丢失');
        }
        manifest.activeKernelId = kernelId;
        this.writeManifest(manifest);
        return manifest;
    }

    setActiveSingbox(kernelId) {
        const manifest = this.readManifest();
        const exists = manifest.singboxKernels.some(
            (item) => item.id === kernelId,
        );
        if (!exists) {
            throw new Error('指定的 sing-box 核心不存在或文件已丢失');
        }
        manifest.activeSingboxId = kernelId;
        this.writeManifest(manifest);
        return manifest;
    }

    removeKernel(kernelId) {
        const manifest = this.readManifest();
        const target = manifest.kernels.find((item) => item.id === kernelId);
        if (!target) {
            return false;
        }

        manifest.kernels = manifest.kernels.filter((item) => item.id !== kernelId);
        if (manifest.activeKernelId === kernelId) {
            manifest.activeKernelId = manifest.kernels[0]?.id || null;
        }
        this.writeManifest(manifest);

        const kernelsDir = path.resolve(this.getKernelsDir());
        const targetDir = path.resolve(target.installDir || '');
        if (
            targetDir &&
            targetDir.startsWith(`${kernelsDir}${path.sep}`) &&
            fs.existsSync(targetDir)
        ) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        return true;
    }

    removeSingbox(kernelId) {
        const manifest = this.readManifest();
        const target = manifest.singboxKernels.find(
            (item) => item.id === kernelId,
        );
        if (!target) {
            return false;
        }

        manifest.singboxKernels = manifest.singboxKernels.filter(
            (item) => item.id !== kernelId,
        );
        if (manifest.activeSingboxId === kernelId) {
            manifest.activeSingboxId = manifest.singboxKernels[0]?.id || null;
        }
        this.writeManifest(manifest);

        const singboxDir = path.resolve(this.getSingboxDir());
        const targetDir = path.resolve(target.installDir || '');
        if (
            targetDir &&
            targetDir.startsWith(`${singboxDir}${path.sep}`) &&
            fs.existsSync(targetDir)
        ) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        return true;
    }
}

export { KernelManager as KernelService };
