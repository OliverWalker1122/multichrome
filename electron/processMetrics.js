/**
 * Per-environment memory attribution, cross-platform browser process matching,
 * and safe Chromium memory-saver flags.
 */

const ENV_SHORT_ID_RE = /^[a-f0-9]{8}$/i;

export function filterBrowserProcessLines(stdout, platform = process.platform) {
    if (typeof stdout !== 'string' || !stdout) return '';
    if (platform === 'win32') return stdout;
    return stdout
        .split(/\r?\n/)
        .filter((line) => {
            if (!line) return false;
            if (platform === 'darwin') {
                // Match both Official Google Chrome and fingerprint-chromium (Chromium.app)
                return /google chrome|chromium/i.test(line);
            }
            // Linux: match google-chrome, chrome, chromium, chromium-browser
            return /chrom(?:e|ium)/i.test(line);
        })
        .join('\n');
}

export function buildForceKillProcessSpec(
    envIdShort,
    platform = process.platform,
) {
    const normalized =
        typeof envIdShort === 'string' ? envIdShort.trim().toLowerCase() : '';
    if (!ENV_SHORT_ID_RE.test(normalized)) {
        return null;
    }

    if (platform === 'win32') {
        // Match only browser processes whose command line targets this exact profile dir
        return {
            executable: 'powershell.exe',
            args: [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `Get-CimInstance -ClassName Win32_Process -Filter "Name like '%chrome%'" | Where-Object { $_.CommandLine -match 'environments[/\\\\]${normalized}\\b' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
            ],
        };
    }

    if (platform === 'darwin' || platform === 'linux') {
        return {
            executable: 'pkill',
            args: ['-f', `environments/${normalized}`],
        };
    }

    return null;
}

export function extractEnvIdShortFromCommandLine(commandLine) {
    if (typeof commandLine !== 'string' || !commandLine) return null;
    const match = commandLine.match(
        /--user-data-dir=(?:"[^"]*|'[^']*|\S*)[/\\]environments[/\\]([a-f0-9]{8})\b/i,
    );
    return match ? match[1].toLowerCase() : null;
}

export function aggregateProcessMemory(records) {
    /** @type {Record<string, { memoryBytes: number, processCount: number }>} */
    const byEnvIdShort = {};
    let totalBytes = 0;
    let totalProcesses = 0;

    for (const item of records || []) {
        const envIdShort = extractEnvIdShortFromCommandLine(item?.commandLine);
        if (!envIdShort) continue;
        const bytes = Number(item?.memoryBytes);
        const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
        if (!byEnvIdShort[envIdShort]) {
            byEnvIdShort[envIdShort] = { memoryBytes: 0, processCount: 0 };
        }
        byEnvIdShort[envIdShort].memoryBytes += safeBytes;
        byEnvIdShort[envIdShort].processCount += 1;
        totalBytes += safeBytes;
        totalProcesses += 1;
    }

    return {
        byEnvIdShort,
        totalBytes,
        totalProcesses,
    };
}

export function parseWindowsCimProcessJson(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) return [];
    try {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.map((row) => ({
            commandLine:
                typeof row?.CommandLine === 'string' ? row.CommandLine : '',
            memoryBytes: Number(row?.WorkingSetSize) || 0,
        }));
    } catch {
        return [];
    }
}

export function parseUnixPsOutput(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) return [];
    const records = [];
    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        if (!match) continue;
        const rssKb = Number(match[1]);
        records.push({
            memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : 0,
            commandLine: match[2],
        });
    }
    return records;
}

/**
 * Safe Chromium memory-saver flags that do NOT alter Web API fingerprint surfaces
 * (never touches navigator.deviceMemory or hardwareConcurrency).
 */
export function buildMemorySaverChromiumArgs() {
    return [
        '--enable-features=HighEfficiencyModeAvailable,MemorySaverModeAvailable',
        '--renderer-process-limit=4',
        '--disk-cache-size=104857600',
        '--media-cache-size=52428800',
    ];
}
