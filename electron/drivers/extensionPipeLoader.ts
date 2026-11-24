import fs from 'fs';
import type { ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';
import log from 'electron-log';

/**
 * Load unpacked extensions over Chromium's `--remote-debugging-pipe` (fd3/fd4).
 * Chrome v137+ removed `--load-extension`, replacing it with `Extensions.loadUnpacked`.
 * Note: never close the pipe explicitly while Chrome is running — closing fd3/fd4 terminates Chrome.
 */
export function loadExtensionsViaCdpPipe(
    chromeProcess: ChildProcess,
    extensionPaths: string[],
    envName: string,
    installedTrackerPath?: string,
): void {
    const pipeWrite = chromeProcess.stdio[3] as Writable | undefined;
    const pipeRead = chromeProcess.stdio[4] as Readable | undefined;

    if (!pipeWrite || !pipeRead) {
        log.warn(`[${envName}] CDP pipe 不可用`);
        return;
    }

    let msgId = 0;
    let buffer = '';
    const pendingByMsgId = new Map<number, string>();

    const recordInstalledExtension = (extPath: string) => {
        if (!installedTrackerPath) return;
        try {
            let existing: string[] = [];
            if (fs.existsSync(installedTrackerPath)) {
                const parsed = JSON.parse(
                    fs.readFileSync(installedTrackerPath, 'utf-8'),
                );
                if (Array.isArray(parsed)) {
                    existing = parsed.filter(
                        (item): item is string => typeof item === 'string',
                    );
                }
            }
            if (!existing.includes(extPath)) {
                fs.writeFileSync(
                    installedTrackerPath,
                    JSON.stringify([...existing, extPath]),
                    'utf-8',
                );
            }
        } catch {
            // ignore tracker write failure
        }
    };

    pipeRead.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        let nullIdx: number;
        while ((nullIdx = buffer.indexOf('\0')) !== -1) {
            const msgStr = buffer.substring(0, nullIdx);
            buffer = buffer.substring(nullIdx + 1);
            try {
                const msg = JSON.parse(msgStr);
                const targetExtPath =
                    typeof msg.id === 'number'
                        ? pendingByMsgId.get(msg.id)
                        : undefined;
                if (typeof msg.id === 'number') {
                    pendingByMsgId.delete(msg.id);
                }
                if (msg.result?.id) {
                    log.info(
                        `[${envName}] 扩展已通过 CDP pipe 加载，ID: ${msg.result.id}`,
                    );
                    if (targetExtPath) {
                        recordInstalledExtension(targetExtPath);
                    }
                } else if (msg.error) {
                    log.warn(
                        `[${envName}] CDP pipe 扩展加载失败: ${msg.error.message || JSON.stringify(msg.error)}`,
                    );
                }
            } catch {
                // ignore non-JSON messages
            }
        }
    });

    pipeRead.on('error', () => {
        /* ignore */
    });
    pipeWrite.on('error', () => {
        /* ignore */
    });

    setTimeout(() => {
        for (const extPath of extensionPaths) {
            try {
                const id = ++msgId;
                pendingByMsgId.set(id, extPath);
                const cmd =
                    JSON.stringify({
                        id,
                        method: 'Extensions.loadUnpacked',
                        params: { path: extPath },
                    }) + '\0';
                pipeWrite.write(cmd);
                log.info(`[${envName}] 通过 CDP pipe 请求加载扩展: ${extPath}`);
            } catch (err) {
                log.warn(`[${envName}] CDP pipe 写入失败:`, err);
            }
        }
    }, 2000);
}
