import { execFile } from 'child_process';
import log from 'electron-log';
import {
    aggregateProcessMemory,
    buildForceKillProcessSpec,
    filterBrowserProcessLines,
    parseUnixPsOutput,
    parseWindowsCimProcessJson,
} from '../domain/processMetrics.js';

export function parseEnvironmentIdsFromCommandLines(output: string): string[] {
    const envIds: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (
            trimmed.includes('--user-data-dir=') &&
            trimmed.includes('environments')
        ) {
            const match = trimmed.match(
                /--user-data-dir=.*?environments[\\/]([a-f0-9]{8})/,
            );
            if (match && match[1]) {
                envIds.push(match[1]);
            }
        }
    }

    return [...new Set(envIds)];
}

/**
 * OS-level browser process inspection & fallback termination driver.
 */
export class BrowserProcessScanner {
    private processScanCache: { ids: string[]; expiresAt: number } | null = null;
    private readonly cacheTtlMs: number;

    constructor(cacheTtlMs = 2500) {
        this.cacheTtlMs = cacheTtlMs;
    }

    public async scanRunningEnvironmentShortIds(strict = false): Promise<string[]> {
        if (
            this.processScanCache &&
            this.processScanCache.expiresAt > Date.now()
        ) {
            return this.processScanCache.ids;
        }
        try {
            const windows = process.platform === 'win32';
            if (
                !windows &&
                process.platform !== 'darwin' &&
                process.platform !== 'linux'
            ) {
                throw new Error('不支持的操作系统');
            }
            const executable = windows ? 'powershell.exe' : 'ps';
            const args = windows
                ? [
                      '-NoProfile',
                      '-NonInteractive',
                      '-Command',
                      "$ErrorActionPreference = 'Stop'; Get-CimInstance -ClassName Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }",
                  ]
                : ['-ax', '-o', 'command='];

            const ids = await new Promise<string[]>((resolve, reject) => {
                execFile(
                    executable,
                    args,
                    {
                        encoding: 'utf8',
                        timeout: 8000,
                        maxBuffer: 4 * 1024 * 1024,
                        windowsHide: true,
                    },
                    (error, stdout) => {
                        if (error) {
                            reject(new Error('无法确认浏览器运行状态，请重试'));
                            return;
                        }
                        const chromeCommands = filterBrowserProcessLines(
                            stdout,
                            process.platform,
                        );
                        resolve(
                            parseEnvironmentIdsFromCommandLines(chromeCommands),
                        );
                    },
                );
            });

            this.processScanCache = {
                ids,
                expiresAt: Date.now() + this.cacheTtlMs,
            };
            return ids;
        } catch {
            log.debug('Chrome进程状态查询失败');
            if (strict) throw new Error('无法确认浏览器运行状态，请重试');
            return [];
        }
    }

    public async collectRunningResourceStats(runningEnvIds: string[]): Promise<{
        totalMemoryBytes: number;
        totalProcesses: number;
        environments: Record<
            string,
            { memoryBytes: number; processCount: number }
        >;
    }> {
        if (runningEnvIds.length === 0) {
            return { totalMemoryBytes: 0, totalProcesses: 0, environments: {} };
        }

        const shortToFullId = new Map<string, string>();
        for (const envId of runningEnvIds) {
            shortToFullId.set(envId.substring(0, 8).toLowerCase(), envId);
        }

        const records = await new Promise<
            Array<{ commandLine: string; memoryBytes: number }>
        >((resolve) => {
            if (process.platform === 'win32') {
                execFile(
                    'powershell.exe',
                    [
                        '-NoProfile',
                        '-NonInteractive',
                        '-Command',
                        "Get-CimInstance Win32_Process -Filter \"Name like '%chrome%'\" | Select-Object WorkingSetSize,CommandLine | ConvertTo-Json -Compress",
                    ],
                    { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
                    (error, stdout) => {
                        if (error || !stdout) {
                            resolve([]);
                            return;
                        }
                        resolve(parseWindowsCimProcessJson(stdout));
                    },
                );
            } else {
                execFile(
                    'ps',
                    ['-ax', '-o', 'rss=,command='],
                    { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
                    (error, stdout) => {
                        if (error || !stdout) {
                            resolve([]);
                            return;
                        }
                        resolve(parseUnixPsOutput(stdout));
                    },
                );
            }
        });

        const agg = aggregateProcessMemory(records);
        const environments: Record<
            string,
            { memoryBytes: number; processCount: number }
        > = {};
        let totalMemoryBytes = 0;
        let totalProcesses = 0;

        for (const [shortId, metrics] of Object.entries(agg.byEnvIdShort)) {
            const fullId = shortToFullId.get(shortId);
            if (!fullId) continue;
            environments[fullId] = metrics;
            totalMemoryBytes += metrics.memoryBytes;
            totalProcesses += metrics.processCount;
        }

        return {
            totalMemoryBytes,
            totalProcesses,
            environments,
        };
    }

    public async forceKillEnvironmentProcesses(
        envIdShort: string,
        envName: string,
    ): Promise<void> {
        const killSpec = buildForceKillProcessSpec(
            envIdShort,
            process.platform,
        );
        if (!killSpec) return;

        await new Promise<void>((resolve) => {
            execFile(
                killSpec.executable,
                killSpec.args,
                {
                    windowsHide: true,
                    timeout: 4000,
                    maxBuffer: 1024 * 1024,
                },
                (error) => {
                    if (!error) {
                        log.info(
                            `[${envName}] Chrome进程已强制关闭 - ID:${envIdShort}`,
                        );
                    }
                    resolve();
                },
            );
        });
    }
}
