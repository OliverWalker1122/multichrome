import fs from 'node:fs';
import path from 'node:path';
import { applyFailClosedWebRTCPreferences } from '../domain/managedProxyArgs.js';
import { cleanupLegacyFingerprintExtension } from './proxyStartupGate.js';
import { applyLanguagePreferences } from '../domain/proxyGeo.js';

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
