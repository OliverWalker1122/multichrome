import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/**
 * Probe Chrome's local DevTools HTTP endpoint to verify whether the browser
 * listening on `port` is alive.
 */
export function isDebugPortAlive(port, timeoutMs = 200) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
            res.resume();
            done(res.statusCode === 200);
        });
        req.on('error', () => done(false));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            done(false);
        });
    });
}

/**
 * Read Chrome's DevToolsActivePort file in a profile directory, if present.
 */
export function readDevToolsActivePort(dataDir) {
    if (!dataDir) return null;
    const portFile = path.join(dataDir, 'DevToolsActivePort');
    try {
        const content = fs.readFileSync(portFile, 'utf8');
        const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
        const port = Number.parseInt(firstLine || '', 10);
        if (Number.isInteger(port) && port >= 1 && port <= 65535) {
            return port;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Non-destructively check whether Chrome currently holds the OS-level profile
 * lock inside `dataDir`.
 *
 * - Windows: Chrome holds an exclusive write lock on `<dataDir>/lockfile`.
 *   Attempting to open it with `r+` immediately fails with EBUSY/EPERM/EACCES
 *   while Chrome is alive, and succeeds (or ENOENT) once Chrome exits.
 * - macOS / Linux: Chrome creates a `SingletonLock` symlink pointing to
 *   `<hostname>-<pid>`. Checking `process.kill(pid, 0)` determines liveness.
 */
export function isLockfileHeldSync(dataDir) {
    if (!dataDir) return false;

    if (process.platform === 'win32') {
        const lockPath = path.join(dataDir, 'lockfile');
        let fd;
        try {
            fd = fs.openSync(lockPath, 'r+');
            fs.closeSync(fd);
            return false;
        } catch (error) {
            if (fd !== undefined) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // ignore close error
                }
            }
            const code = error && typeof error === 'object' ? error.code : '';
            if (code === 'ENOENT' || code === 'ENOTDIR') {
                return false;
            }
            if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
                return true;
            }
            return false;
        }
    }

    const singletonLock = path.join(dataDir, 'SingletonLock');
    try {
        const target = fs.readlinkSync(singletonLock);
        const match = target.match(/-(\d+)$/);
        if (!match) return false;
        const pid = Number.parseInt(match[1], 10);
        if (!Number.isInteger(pid) || pid <= 0) return false;
        try {
            process.kill(pid, 0);
            return true;
        } catch (killErr) {
            return killErr && killErr.code === 'EPERM';
        }
    } catch {
        return false;
    }
}

/**
 * Fast (<5ms) local check to determine whether a Chrome profile directory is
 * currently running without spawning PowerShell/WMI process scans.
 */
export async function isProfileRunningLocally(dataDir, knownDebugPort) {
    if (knownDebugPort && (await isDebugPortAlive(knownDebugPort))) {
        return { running: true, source: 'debug-port', debugPort: knownDebugPort };
    }

    const activePort = readDevToolsActivePort(dataDir);
    if (
        activePort &&
        activePort !== knownDebugPort &&
        (await isDebugPortAlive(activePort))
    ) {
        return { running: true, source: 'devtools-file', debugPort: activePort };
    }

    if (isLockfileHeldSync(dataDir)) {
        return { running: true, source: 'lockfile', debugPort: activePort || undefined };
    }

    return { running: false, source: 'none' };
}
