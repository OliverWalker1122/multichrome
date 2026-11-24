/**
 * Native In-Process OS Window Foreground Focus Driver (Layer 1 Driver).
 *
 * Uses official documented Win32 `user32.dll` window-management APIs directly
 * in-process via prebuilt N-API FFI (`koffi`), with ZERO external shell spawns
 * and ZERO cross-process injection or native callback trampolines.
 *
 * Why this exists:
 * When the user clicks a profile inside MultiChrome, MultiChrome holds the
 * Windows Foreground Lock. Sending CDP `Page.bringToFront` to a background
 * `chrome.exe` process alone causes Windows to deny `SetForegroundWindow` and
 * downgrade it to a subtle taskbar flash. Calling `AllowSetForegroundWindow(pid)`
 * (and, if needed, `SetForegroundWindow(hwnd)` from the foreground parent process)
 * cleanly and legitimately hands OS focus to the target Chrome window in < 2ms.
 */
import { createRequire } from 'node:module';

const GW_OWNER = 4;
const SW_RESTORE = 9;
const MAX_WINDOW_SCAN = 2000;

let win32Bindings = null;
let win32LoadAttempted = false;

function loadWin32Bindings() {
    if (process.platform !== 'win32') return null;
    if (win32LoadAttempted) return win32Bindings;
    win32LoadAttempted = true;
    try {
        const require = createRequire(import.meta.url);
        const koffi = require('koffi');
        const user32 = koffi.load('user32.dll');
        const HWND = koffi.pointer('HWND', koffi.opaque());
        const Uint32Out = koffi.out(koffi.pointer('uint32'));

        win32Bindings = {
            AllowSetForegroundWindow: user32.func(
                '__stdcall',
                'AllowSetForegroundWindow',
                'bool',
                ['uint32'],
            ),
            GetForegroundWindow: user32.func(
                '__stdcall',
                'GetForegroundWindow',
                HWND,
                [],
            ),
            GetWindowThreadProcessId: user32.func(
                '__stdcall',
                'GetWindowThreadProcessId',
                'uint32',
                [HWND, Uint32Out],
            ),
            FindWindowExW: user32.func('__stdcall', 'FindWindowExW', HWND, [
                HWND,
                HWND,
                'str16',
                'str16',
            ]),
            GetWindow: user32.func('__stdcall', 'GetWindow', HWND, [
                HWND,
                'uint32',
            ]),
            IsWindowVisible: user32.func(
                '__stdcall',
                'IsWindowVisible',
                'int',
                [HWND],
            ),
            IsIconic: user32.func('__stdcall', 'IsIconic', 'int', [HWND]),
            GetWindowTextLengthW: user32.func(
                '__stdcall',
                'GetWindowTextLengthW',
                'int',
                [HWND],
            ),
            ShowWindow: user32.func('__stdcall', 'ShowWindow', 'int', [
                HWND,
                'int',
            ]),
            BringWindowToTop: user32.func(
                '__stdcall',
                'BringWindowToTop',
                'int',
                [HWND],
            ),
            SetForegroundWindow: user32.func(
                '__stdcall',
                'SetForegroundWindow',
                'int',
                [HWND],
            ),
        };
    } catch {
        win32Bindings = null;
    }
    return win32Bindings;
}

export function isNativeWindowFocusAvailable() {
    return Boolean(loadWin32Bindings());
}

/**
 * Grant Windows Foreground Lock permission from the current foreground process
 * (MultiChrome) to the specified child browser PID so its own `Page.bringToFront`
 * / `SetForegroundWindow` succeeds natively.
 */
export function allowForegroundForPid(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const api = loadWin32Bindings();
    if (!api) return false;
    try {
        return Boolean(api.AllowSetForegroundWindow(pid));
    } catch {
        return false;
    }
}

/**
 * Return the process ID owning the current OS foreground window (Windows only).
 */
export function getForegroundWindowPid() {
    const api = loadWin32Bindings();
    if (!api) return null;
    try {
        const hwnd = api.GetForegroundWindow();
        if (!hwnd) return null;
        const pidBuf = [0];
        api.GetWindowThreadProcessId(hwnd, pidBuf);
        const pid = Number(pidBuf[0]);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

function findPrimaryWindowByPid(api, targetPid, className) {
    let hwnd = null;
    let fallbackHwnd = null;
    const pidBuf = [0];

    for (let i = 0; i < MAX_WINDOW_SCAN; i += 1) {
        hwnd = api.FindWindowExW(null, hwnd, className, null);
        if (!hwnd) break;
        pidBuf[0] = 0;
        api.GetWindowThreadProcessId(hwnd, pidBuf);
        if (pidBuf[0] !== targetPid) continue;
        if (!api.IsWindowVisible(hwnd)) continue;
        if (api.GetWindow(hwnd, GW_OWNER)) continue;

        if (api.GetWindowTextLengthW(hwnd) > 0) {
            return hwnd;
        }
        if (!fallbackHwnd) {
            fallbackHwnd = hwnd;
        }
    }
    return fallbackHwnd;
}

/**
 * Locate the target Chrome browser's primary top-level window by PID and bring it
 * cleanly to the front with OS keyboard/mouse focus directly from the active
 * foreground parent process (MultiChrome).
 */
export function activateProcessWindowByPid(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const api = loadWin32Bindings();
    if (!api) return false;
    try {
        const hwnd =
            findPrimaryWindowByPid(api, pid, 'Chrome_WidgetWin_1') ||
            findPrimaryWindowByPid(api, pid, null);
        if (!hwnd) return false;

        if (api.IsIconic(hwnd)) {
            api.ShowWindow(hwnd, SW_RESTORE);
        }
        api.AllowSetForegroundWindow(pid);
        api.BringWindowToTop(hwnd);
        const focused = Boolean(api.SetForegroundWindow(hwnd));
        return focused || getForegroundWindowPid() === pid;
    } catch {
        return false;
    }
}
