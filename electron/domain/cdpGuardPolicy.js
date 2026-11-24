/**
 * Pure CDP Guard Domain Policy (Zero I/O, Zero Network).
 *
 * Inspects client->browser CDP JSON-RPC frames and rewrites CDP HTTP/WS discovery payloads
 * so external Playwright / Puppeteer / MCP clients cannot clobber MultiChrome's C++ fingerprint
 * or proxy-matched timezone/locale/geolocation, nor create empty incognito contexts.
 */
export const IGNORED_CDP_OVERRIDE_METHODS = new Set([
    'Emulation.setUserAgentOverride',
    'Network.setUserAgentOverride',
    'Emulation.setTimezoneOverride',
    'Emulation.setLocaleOverride',
    'Emulation.setGeolocationOverride',
    'Emulation.clearGeolocationOverride',
    'Emulation.setDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
]);

export const BLOCKED_CDP_CONTEXT_METHODS = new Set([
    'Target.createBrowserContext',
]);

export function inspectClientCdpMessage(rawData) {
    let text;
    if (typeof rawData === 'string') {
        text = rawData;
    } else if (Buffer.isBuffer(rawData)) {
        text = rawData.toString('utf8');
    } else if (rawData instanceof ArrayBuffer) {
        text = Buffer.from(rawData).toString('utf8');
    } else if (Array.isArray(rawData)) {
        text = Buffer.concat(rawData).toString('utf8');
    } else {
        return { action: 'forward' };
    }

    if (
        !text.includes('Override') &&
        !text.includes('createBrowserContext')
    ) {
        return { action: 'forward' };
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { action: 'forward' };
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof parsed.method !== 'string'
    ) {
        return { action: 'forward' };
    }

    const { id, method, sessionId } = parsed;
    if (id === undefined || id === null) {
        return { action: 'forward' };
    }

    if (IGNORED_CDP_OVERRIDE_METHODS.has(method)) {
        const payload = { id, result: {} };
        if (typeof sessionId === 'string' && sessionId) {
            payload.sessionId = sessionId;
        }
        return {
            action: 'reply',
            reason: 'ignored_override',
            method,
            payload,
        };
    }

    if (BLOCKED_CDP_CONTEXT_METHODS.has(method)) {
        const payload = {
            id,
            error: {
                code: -32000,
                message:
                    'MultiChrome CDP Guard: Do not call browser.newContext() (Target.createBrowserContext), which opens an empty incognito context without profile cookies. Use browser.contexts()[0] instead.',
            },
        };
        if (typeof sessionId === 'string' && sessionId) {
            payload.sessionId = sessionId;
        }
        return {
            action: 'reply',
            reason: 'blocked_incognito_context',
            method,
            payload,
        };
    }

    return { action: 'forward' };
}

export function buildGuardedBrowserWsUrl(boundPort, profileId, isActiveSlot = false) {
    const suffix = isActiveSlot
        ? `/devtools/browser/active/${encodeURIComponent(profileId)}`
        : `/devtools/browser/${encodeURIComponent(profileId)}`;
    return `ws://127.0.0.1:${boundPort}${suffix}`;
}

export function buildGuardedPageWsUrl(boundPort, profileId, targetId, isActiveSlot = false) {
    const prefix = isActiveSlot
        ? `/devtools/page/active/${encodeURIComponent(profileId)}`
        : `/devtools/page/${encodeURIComponent(profileId)}`;
    return `ws://127.0.0.1:${boundPort}${prefix}/${encodeURIComponent(targetId)}`;
}

export function rewriteVersionMetadata(rawVersion, { boundPort, profileId, isActiveSlot = false }) {
    const base =
        rawVersion && typeof rawVersion === 'object' ? { ...rawVersion } : {};
    base.webSocketDebuggerUrl = buildGuardedBrowserWsUrl(
        boundPort,
        profileId,
        isActiveSlot,
    );
    return base;
}

export function rewriteTargetList(rawList, { boundPort, profileId, isActiveSlot = false }) {
    if (!Array.isArray(rawList)) {
        return [];
    }
    return rawList.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            return entry;
        }
        const next = { ...entry };
        const targetId =
            typeof entry.id === 'string' && entry.id.trim()
                ? entry.id.trim()
                : '';
        if (targetId && typeof entry.webSocketDebuggerUrl === 'string') {
            const wsHostPath = `127.0.0.1:${boundPort}${
                isActiveSlot
                    ? `/devtools/page/active/${encodeURIComponent(profileId)}/${encodeURIComponent(targetId)}`
                    : `/devtools/page/${encodeURIComponent(profileId)}/${encodeURIComponent(targetId)}`
            }`;
            next.webSocketDebuggerUrl = `ws://${wsHostPath}`;
            if (typeof next.devtoolsFrontendUrl === 'string') {
                next.devtoolsFrontendUrl = `/devtools/inspector.html?ws=${wsHostPath}`;
            }
        }
        return next;
    });
}

export function parseCdpHttpRoute(pathname) {
    if (pathname === '/json/version' || pathname === '/json/version/') {
        return { kind: 'version', profileId: null, isActiveSlot: true };
    }
    if (
        pathname === '/json' ||
        pathname === '/json/' ||
        pathname === '/json/list' ||
        pathname === '/json/list/'
    ) {
        return { kind: 'list', profileId: null, isActiveSlot: true };
    }

    const scopedMatch = pathname.match(
        /^\/cdp\/([^/]+)\/json(?:\/(version|list))?\/?$/,
    );
    if (scopedMatch) {
        const profileId = decodeURIComponent(scopedMatch[1]);
        const sub = scopedMatch[2] || 'list';
        return {
            kind: sub === 'version' ? 'version' : 'list',
            profileId,
            isActiveSlot: false,
        };
    }

    return null;
}

export function parseCdpWsRoute(pathname) {
    if (pathname === '/devtools/browser' || pathname === '/devtools/browser/') {
        return {
            targetType: 'browser',
            profileId: null,
            targetId: null,
            isActiveSlot: true,
        };
    }

    const activeBrowserMatch = pathname.match(
        /^\/devtools\/browser\/active\/([^/]+)\/?$/,
    );
    if (activeBrowserMatch) {
        return {
            targetType: 'browser',
            profileId: decodeURIComponent(activeBrowserMatch[1]),
            targetId: null,
            isActiveSlot: true,
        };
    }

    const explicitBrowserMatch = pathname.match(
        /^\/devtools\/browser\/([^/]+)\/?$/,
    );
    if (explicitBrowserMatch) {
        return {
            targetType: 'browser',
            profileId: decodeURIComponent(explicitBrowserMatch[1]),
            targetId: null,
            isActiveSlot: false,
        };
    }

    const activePageMatch = pathname.match(
        /^\/devtools\/page\/active\/([^/]+)\/([^/]+)\/?$/,
    );
    if (activePageMatch) {
        return {
            targetType: 'page',
            profileId: decodeURIComponent(activePageMatch[1]),
            targetId: decodeURIComponent(activePageMatch[2]),
            isActiveSlot: true,
        };
    }

    const explicitPageMatch = pathname.match(
        /^\/devtools\/page\/([^/]+)\/([^/]+)\/?$/,
    );
    if (explicitPageMatch) {
        return {
            targetType: 'page',
            profileId: decodeURIComponent(explicitPageMatch[1]),
            targetId: decodeURIComponent(explicitPageMatch[2]),
            isActiveSlot: false,
        };
    }

    return null;
}
