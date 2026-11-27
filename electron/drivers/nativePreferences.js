import fs from 'node:fs';
import path from 'node:path';
import { applyFailClosedWebRTCPreferences } from '../domain/managedProxyArgs.js';
import { cleanupLegacyFingerprintExtension } from './proxyStartupGate.js';
import { applyLanguagePreferences } from '../domain/proxyGeo.js';

const WINDOWS_TO_UNIX_EPOCH_MICROS = 11644473600000000n;
const PASSWORD_CHECK_SKEW_MICROS = 5000000n;

/**
 * Build a Chromium Local State payload that marks the Windows OS account as
 * password-protected (`os_password_blank: false`) as of `nowMs`, preventing
 * fresh profiles from invoking blank-password `LogonUserW` probes (Event 4625)
 * while keeping device reauthentication required.
 *
 * @param {number} [nowMs]
 * @returns {string}
 */
export function buildWindowsPasswordLocalState(nowMs = Date.now()) {
    const micros =
        BigInt(Math.trunc(nowMs)) * 1000n +
        WINDOWS_TO_UNIX_EPOCH_MICROS +
        PASSWORD_CHECK_SKEW_MICROS;
    return JSON.stringify({
        password_manager: {
            os_password_blank: false,
            os_password_last_changed: String(micros),
        },
    });
}

/**
 * Atomically seed `<dataDir>/Local State` ONLY when no `Local State` file
 * exists yet (`wx`). Existing browser state is never opened or overwritten.
 *
 * @param {string} dataDir
 * @param {{ platform?: string, nowMs?: number }} [options]
 * @returns {boolean} true if a new Local State file was created
 */
export function ensureFreshWindowsLocalState(
    dataDir,
    { platform = process.platform, nowMs = Date.now() } = {},
) {
    if (
        platform !== 'win32' ||
        typeof dataDir !== 'string' ||
        !dataDir.trim()
    ) {
        return false;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const localStatePath = path.join(dataDir, 'Local State');
    try {
        fs.writeFileSync(localStatePath, buildWindowsPasswordLocalState(nowMs), {
            flag: 'wx',
        });
        return true;
    } catch (error) {
        if (error && error.code === 'EEXIST') {
            return false;
        }
        throw error;
    }
}

/**
 * Persist pure native Chromium stealth & Fail-Closed preferences before launch:
 * - Locks WebRTC non-proxied UDP policy in Default/Preferences when proxied
 * - Writes language / countryid_at_install preferences
 * - Sets native Chromium profile display name (`profile.name`) for toolbar avatar identification
 * - Cleans up legacy `_tz_extension` artifacts without touching user extensions
 *
 * @param {{
 *   dataDir: string,
 *   enforceWebRTCFailClosed?: boolean,
 *   language?: string,
 *   profileName?: string,
 *   disableDeveloperMode?: boolean,
 *   logger?: { info?: (...args: any[]) => void, warn?: (...args: any[]) => void },
 * }} options
 */
export function writeNativeStealthPreferences({
    dataDir,
    enforceWebRTCFailClosed = false,
    language = undefined,
    profileName = undefined,
    disableDeveloperMode = false,
    logger = undefined,
}) {
    try {
        ensureFreshWindowsLocalState(dataDir);
        const prefDir = path.join(dataDir, 'Default');
        const prefPath = path.join(prefDir, 'Preferences');
        fs.mkdirSync(prefDir, { recursive: true });

        let prefs = {};
        if (fs.existsSync(prefPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(prefPath, 'utf-8'));
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    prefs = parsed;
                }
            } catch {
                prefs = {};
            }
        }

        const cleaned = cleanupLegacyFingerprintExtension(dataDir, prefs, {
            disableDeveloperMode: Boolean(disableDeveloperMode),
        });
        if (cleaned.removedIds.length > 0 || cleaned.removedDir) {
            logger?.info?.(
                `[原生隐匿] 已清理旧版指纹扩展残留 (ids=${cleaned.removedIds.join(',') || 'none'}, dir=${cleaned.removedDir})`,
            );
        }

        if (enforceWebRTCFailClosed) {
            applyFailClosedWebRTCPreferences(prefs);
        }
        if (language) {
            applyLanguagePreferences(prefs, language);
        }
        if (typeof profileName === 'string' && profileName.trim()) {
            const existingProfile =
                prefs.profile &&
                typeof prefs.profile === 'object' &&
                !Array.isArray(prefs.profile)
                    ? prefs.profile
                    : {};
            prefs.profile = {
                ...existingProfile,
                name: profileName.trim().slice(0, 64),
            };
        }

        fs.writeFileSync(prefPath, JSON.stringify(prefs));
    } catch (error) {
        logger?.warn?.('[原生隐匿] 写入 Preferences 失败:', error);
    }
}
