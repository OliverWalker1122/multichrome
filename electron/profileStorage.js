import fs from 'fs';
import path from 'path';

/**
 * 仅包含可安全删除的 Chromium 缓存目录；绝不触碰 Cookies、Local Storage、
 * IndexedDB、Login Data、Preferences、Extensions、Bookmarks、Sessions。
 */
export const SAFE_CACHE_RELATIVE_PATHS = [
    path.join('Default', 'Cache'),
    path.join('Default', 'Code Cache'),
    path.join('Default', 'GPUCache'),
    path.join('Default', 'DawnCache'),
    path.join('Default', 'DawnGraphiteCache'),
    path.join('Default', 'DawnWebGPUCache'),
    path.join('Default', 'Service Worker', 'CacheStorage'),
    path.join('Default', 'Service Worker', 'ScriptCache'),
    path.join('Default', 'blob_storage'),
    'ShaderCache',
    'GrShaderCache',
    'GraphiteDawnCache',
    path.join('Crashpad', 'reports'),
];

/**
 * 异步安全统计目录大小（不跟随符号链接）
 * @param {string} targetPath
 * @returns {Promise<number>}
 */
export async function getDirectorySizeBytes(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) return 0;
    let total = 0;
    const stack = [targetPath];

    while (stack.length > 0) {
        const current = stack.pop();
        let stat;
        try {
            stat = await fs.promises.lstat(current);
        } catch {
            continue;
        }
        if (stat.isSymbolicLink()) continue;
        if (stat.isFile()) {
            total += stat.size;
            continue;
        }
        if (!stat.isDirectory()) continue;

        let entries;
        try {
            entries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile()) {
                try {
                    const fileStat = await fs.promises.lstat(fullPath);
                    total += fileStat.size;
                } catch {
                    // 忽略并发移除或无权限文件
                }
            }
        }
    }
    return total;
}

function resolveContainedPath(rootDir, relativePath) {
    const resolvedRoot = path.resolve(rootDir);
    const candidate = path.resolve(resolvedRoot, relativePath);
    const rel = path.relative(resolvedRoot, candidate);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('缓存目录路径越界');
    }
    return candidate;
}

/**
 * 统计 Profile 总大小与可安全清理的缓存大小
 * @param {string} dataDir
 */
export async function inspectProfileStorage(dataDir) {
    if (!dataDir || !fs.existsSync(dataDir)) {
        return { exists: false, totalBytes: 0, cacheBytes: 0 };
    }
    const totalBytes = await getDirectorySizeBytes(dataDir);
    let cacheBytes = 0;
    for (const relPath of SAFE_CACHE_RELATIVE_PATHS) {
        const fullPath = resolveContainedPath(dataDir, relPath);
        if (fs.existsSync(fullPath)) {
            cacheBytes += await getDirectorySizeBytes(fullPath);
        }
    }
    return {
        exists: true,
        totalBytes,
        cacheBytes: Math.min(cacheBytes, totalBytes),
    };
}

/**
 * 清理 Profile 缓存目录（保留 Cookie 与登录态）
 * @param {string} dataDir
 */
export async function clearProfileCache(dataDir) {
    if (!dataDir || !fs.existsSync(dataDir)) {
        return {
            freedBytes: 0,
            removedCount: 0,
            afterTotalBytes: 0,
            afterCacheBytes: 0,
        };
    }

    const beforeTotal = await getDirectorySizeBytes(dataDir);
    let removedCount = 0;

    for (const relPath of SAFE_CACHE_RELATIVE_PATHS) {
        const fullPath = resolveContainedPath(dataDir, relPath);
        if (!fs.existsSync(fullPath)) continue;
        try {
            await fs.promises.rm(fullPath, { recursive: true, force: true });
            removedCount += 1;
        } catch {
            // 个别被占用的文件跳过
        }
    }

    const after = await inspectProfileStorage(dataDir);
    return {
        freedBytes: Math.max(0, beforeTotal - after.totalBytes),
        removedCount,
        afterTotalBytes: after.totalBytes,
        afterCacheBytes: after.cacheBytes,
    };
}
