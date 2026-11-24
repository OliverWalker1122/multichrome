import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Locate an installed official Google Chrome / Chromium executable on the host OS.
 *
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, homedir?: string }} [options]
 * @returns {string}
 */
export function findSystemChromeExecutable({
    platform = process.platform,
    env = process.env,
    homedir = os.homedir(),
} = {}) {
    if (platform === 'win32') {
        const commonPaths = [
            path.join(
                'C:',
                'Program Files',
                'Google',
                'Chrome',
                'Application',
                'chrome.exe',
            ),
            path.join(
                'C:',
                'Program Files (x86)',
                'Google',
                'Chrome',
                'Application',
                'chrome.exe',
            ),
            path.join(
                env.LOCALAPPDATA || '',
                'Google',
                'Chrome',
                'Application',
                'chrome.exe',
            ),
        ];

        for (const chromePath of commonPaths) {
            if (fs.existsSync(chromePath)) {
                return chromePath;
            }
        }
        return '';
    }

    if (platform === 'darwin') {
        const macPaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(
                homedir,
                'Applications',
                'Google Chrome.app',
                'Contents',
                'MacOS',
                'Google Chrome',
            ),
        ];
        for (const chromePath of macPaths) {
            if (fs.existsSync(chromePath)) {
                return chromePath;
            }
        }
        return '';
    }

    if (platform === 'linux') {
        const possibleNames = [
            'google-chrome',
            'chrome',
            'chromium-browser',
            'chromium',
        ];
        for (const name of possibleNames) {
            try {
                const chromePath = execSync(`which ${name}`).toString().trim();
                if (chromePath) {
                    return chromePath;
                }
            } catch {
                // try next binary candidate
            }
        }
    }

    return '';
}
