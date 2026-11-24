import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const resourceDirectory = path.join(projectDirectory, 'resources', 'sing-box');
const cacheDirectory = path.join(
    projectDirectory,
    '.tmp',
    'sing-box-downloads',
);

async function digest(filePath) {
    return createHash('sha256')
        .update(await fs.readFile(filePath))
        .digest('hex');
}

async function download(url, filePath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
            throw new Error(`sing-box 下载失败：HTTP ${response.status}`);
        const content = Buffer.from(await response.arrayBuffer());
        if (content.length > 150 * 1024 * 1024)
            throw new Error('sing-box 下载文件大小异常');
        await fs.writeFile(filePath, content);
    } catch (error) {
        if (error.message.startsWith('sing-box')) throw error;
        throw new Error('sing-box 下载失败，请检查网络后重试');
    } finally {
        clearTimeout(timer);
    }
}

export async function prepareSingBox({
    platform = process.platform,
    arch = process.arch,
} = {}) {
    const kernelManifest = JSON.parse(
        await fs.readFile(
            path.join(
                projectDirectory,
                'electron',
                'domain',
                'kernelManifest.json',
            ),
            'utf8',
        ),
    );
    const singboxEntries = Object.entries(kernelManifest.singBox || {});
    const chosen =
        singboxEntries.find(([, info]) => Boolean(info?.recommended)) ||
        singboxEntries[0];
    if (!chosen) {
        throw new Error(
            'electron/domain/kernelManifest.json 中未配置 sing-box 版本',
        );
    }
    const [version, info] = chosen;
    const manifest = {
        version,
        release: `https://github.com/SagerNet/sing-box/releases/tag/v${version}`,
        source: `https://github.com/SagerNet/sing-box/tree/v${version}`,
        assets: info.assets || {},
    };
    const asset = manifest.assets[`${platform}-${arch}`];
    if (!asset)
        throw new Error(`尚未提供此目标的 sing-box 内核：${platform}-${arch}`);
    await fs.mkdir(cacheDirectory, { recursive: true });
    const archive = path.join(cacheDirectory, asset.name);
    let validArchive = false;
    try {
        validArchive = (await digest(archive)) === asset.sha256;
    } catch {
        /* first download */
    }
    if (!validArchive) {
        const staging = `${archive}.${process.pid}.download`;
        try {
            console.log(
                `准备 sing-box ${manifest.version} (${platform}-${arch})`,
            );
            await download(
                `https://github.com/SagerNet/sing-box/releases/download/v${manifest.version}/${asset.name}`,
                staging,
            );
            if ((await digest(staging)) !== asset.sha256)
                throw new Error('sing-box 官方发行包 SHA256 校验失败');
            await fs.rename(staging, archive);
        } finally {
            await fs.rm(staging, { force: true });
        }
    }

    const extractionDirectory = await fs.mkdtemp(
        path.join(cacheDirectory, 'extract-'),
    );
    const resolvedExtraction = path.resolve(extractionDirectory);
    if (
        path.dirname(resolvedExtraction) !== cacheDirectory ||
        !path.basename(resolvedExtraction).startsWith('extract-')
    ) {
        throw new Error('内核临时目录不在预期范围内');
    }
    const executableName = platform === 'win32' ? 'sing-box.exe' : 'sing-box';
    const archiveFolder = asset.name.replace(/\.(?:zip|tar\.gz)$/, '');
    try {
        // Extract one known member from a checksum-verified official archive.
        await execFileAsync(
            'tar',
            [
                '-xf',
                archive,
                '-C',
                extractionDirectory,
                `${archiveFolder}/${executableName}`,
            ],
            {
                windowsHide: true,
                timeout: 30000,
            },
        );
        const extractedExecutable = path.join(
            extractionDirectory,
            archiveFolder,
            executableName,
        );
        const binarySha256 = await digest(extractedExecutable);
        const destination = path.join(resourceDirectory, executableName);
        let unchanged = false;
        try {
            unchanged = (await digest(destination)) === binarySha256;
        } catch {
            /* first preparation */
        }
        if (!unchanged) await fs.copyFile(extractedExecutable, destination);
        if (platform !== 'win32') await fs.chmod(destination, 0o755);
        await fs.rm(
            path.join(
                resourceDirectory,
                platform === 'win32' ? 'sing-box' : 'sing-box.exe',
            ),
            { force: true },
        );
        await fs.writeFile(
            path.join(resourceDirectory, 'core.json'),
            `${JSON.stringify(
                {
                    version: manifest.version,
                    platform,
                    arch,
                    executable: executableName,
                    archive: asset.name,
                    archiveSha256: asset.sha256,
                    binarySha256,
                    release: manifest.release,
                    source: manifest.source,
                },
                null,
                4,
            )}\n`,
        );
        console.log(
            `sing-box ${manifest.version} 校验完成 (${platform}-${arch})`,
        );
        return destination;
    } finally {
        await fs.rm(resolvedExtraction, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const [platform = process.platform, arch = process.arch] =
        process.argv.slice(2);
    prepareSingBox({ platform, arch }).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
