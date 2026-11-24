import { spawn } from 'node:child_process';

const recentFocusByPid = new Map();

/**
 * Non-blocking OS-level foreground Z-order promotion helper (Layer 1 Driver).
 *
 * Complements CDP `Page.bringToFront` + `Browser.setWindowBounds(normal)` so
 * clicking a running profile inside MultiChrome reliably raises its browser
 * window above sibling OS windows without blocking the Electron main thread.
 */
export function bringProcessWindowToFront(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    const now = Date.now();
    const last = recentFocusByPid.get(pid) || 0;
    if (now - last < 250) {
        return true;
    }
    recentFocusByPid.set(pid, now);
    if (recentFocusByPid.size > 128) {
        recentFocusByPid.clear();
    }

    try {
        if (process.platform === 'win32') {
            const child = spawn(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-WindowStyle',
                    'Hidden',
                    '-Command',
                    `(New-Object -ComObject WScript.Shell).AppActivate(${pid}) | Out-Null`,
                ],
                {
                    stdio: 'ignore',
                    windowsHide: true,
                    detached: false,
                },
            );
            child.on('error', () => {});
            child.unref();
            return true;
        }

        if (process.platform === 'darwin') {
            const child = spawn(
                'osascript',
                [
                    '-e',
                    `tell application "System Events" to set frontmost of (every process whose unix id is ${pid}) to true`,
                ],
                { stdio: 'ignore' },
            );
            child.on('error', () => {});
            child.unref();
            return true;
        }
    } catch {
        return false;
    }

    return false;
}
