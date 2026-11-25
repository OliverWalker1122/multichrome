const MAX_RECENT_LOGS = 200;

export function sanitizeDiagnosticText(input) {
    if (typeof input !== 'string') return '';
    return (
        input
            // Mask credentials inside URLs
            .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s@:]+):([^/\s@]+)@/gi, '$1[REDACTED]:[REDACTED]@')
            // Mask OS home directories across Windows, macOS, and Linux
            .replace(/([A-Za-z]:\\Users\\)([^\\\s"']+)/g, '$1[REDACTED]')
            .replace(/(\/Users\/)([^/\s"']+)/g, '$1[REDACTED]')
            .replace(/(\/home\/)([^/\s"']+)/g, '$1[REDACTED]')
            // Mask public IPv4 addresses while preserving local loopback & unspecified
            .replace(
                /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
                (ip) => {
                    if (ip === '127.0.0.1' || ip === '0.0.0.0') return ip;
                    const parts = ip.split('.').map(Number);
                    if (parts.some((n) => !Number.isInteger(n) || n > 255)) return ip;
                    if (
                        parts[0] === 10 ||
                        parts[0] === 127 ||
                        (parts[0] === 192 && parts[1] === 168) ||
                        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
                    ) {
                        return '[PRIVATE_IP]';
                    }
                    return '[REDACTED_IP]';
                },
            )
    );
}

/**
 * @param {{
 *   appVersion?: string;
 *   locale?: string;
 *   platform?: string;
 *   arch?: string;
 *   osRelease?: string;
 *   electronVersion?: string;
 *   chromeVersion?: string;
 *   nodeVersion?: string;
 *   dbIntegrity?: string;
 *   sharedProfileDirectories?: number;
 *   activeProfiles?: number;
 *   deletedProfiles?: number;
 *   runningProfiles?: number;
 *   systemChromeAvailable?: boolean;
 *   activePrivacyKernelVersion?: string | null;
 *   activeSingboxVersion?: string | null;
 *   proxies?: Array<Record<string, unknown>>;
 *   automation?: { enabled?: boolean; port?: number; running?: boolean } | null;
 *   recentLogs?: Array<unknown>;
 *   generatedAt?: string;
 * }} [options]
 */
export function buildSanitizedSupportBundle({
    appVersion = '1.6.1',
    locale = 'en-US',
    platform = process.platform,
    arch = process.arch,
    osRelease = '',
    electronVersion = '',
    chromeVersion = '',
    nodeVersion = process.version,
    dbIntegrity = 'unknown',
    sharedProfileDirectories = 0,
    activeProfiles = 0,
    deletedProfiles = 0,
    runningProfiles = 0,
    systemChromeAvailable = false,
    activePrivacyKernelVersion = null,
    activeSingboxVersion = null,
    proxies = [],
    automation = null,
    recentLogs = [],
    generatedAt = new Date().toISOString(),
} = {}) {
    const safeProxies = Array.isArray(proxies) ? proxies : [];
    const protocols = {};
    let runningProxies = 0;
    for (const p of safeProxies) {
        if (p?.status === 'running') runningProxies += 1;
        const proto = String(p?.protocol || 'unknown').toLowerCase();
        protocols[proto] = (protocols[proto] || 0) + 1;
    }

    const safeLogs = (Array.isArray(recentLogs) ? recentLogs : [])
        .slice(-MAX_RECENT_LOGS)
        .map((entry) => ({
            timestamp: entry?.timestamp || '',
            level: entry?.level || 'info',
            message: sanitizeDiagnosticText(String(entry?.message || '')),
        }));

    return {
        schemaVersion: 1,
        generatedAt,
        app: {
            name: 'MultiChrome',
            version: appVersion,
            locale,
        },
        runtime: {
            platform,
            arch,
            osRelease,
            electron: electronVersion,
            chrome: chromeVersion,
            node: nodeVersion,
        },
        database: {
            integrity: String(dbIntegrity || 'unknown'),
            sharedProfileDirectories: Number(sharedProfileDirectories) || 0,
            activeProfiles: Number(activeProfiles) || 0,
            deletedProfiles: Number(deletedProfiles) || 0,
            runningProfiles: Number(runningProfiles) || 0,
        },
        components: {
            systemChromeAvailable: Boolean(systemChromeAvailable),
            activePrivacyKernelVersion: activePrivacyKernelVersion || null,
            activeSingboxVersion: activeSingboxVersion || null,
        },
        proxies: {
            total: safeProxies.length,
            running: runningProxies,
            protocols,
        },
        automation: {
            enabled: Boolean(automation?.enabled),
            port: Number(automation?.port) || 0,
            running: Boolean(automation?.running),
        },
        recentLogs: safeLogs,
    };
}
