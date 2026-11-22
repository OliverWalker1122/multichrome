/**
 * Per-environment memory attribution and safe Chromium memory-saver flags.
 */

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
