import crypto from 'node:crypto';
import { isIP } from 'node:net';

export const DEFAULT_AUTOMATION_PORT = 18922;
export const MIN_AUTOMATION_PORT = 1024;
export const MAX_AUTOMATION_PORT = 65535;
export const AUTOMATION_TOKEN_PREFIX = 'mc_live_';

export function generateAutomationToken() {
    return `${AUTOMATION_TOKEN_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
}

export function isValidAutomationTokenFormat(token) {
    return (
        typeof token === 'string' &&
        /^mc_live_[A-Za-z0-9_-]{20,128}$/.test(token.trim())
    );
}

export function verifyAutomationTokenConstantTime(candidate, expectedToken) {
    if (
        typeof candidate !== 'string' ||
        !candidate ||
        typeof expectedToken !== 'string' ||
        !expectedToken
    ) {
        return false;
    }
    const hashCandidate = crypto
        .createHash('sha256')
        .update(candidate, 'utf8')
        .digest();
    const hashExpected = crypto
        .createHash('sha256')
        .update(expectedToken, 'utf8')
        .digest();
    return crypto.timingSafeEqual(hashCandidate, hashExpected);
}

export function authenticateAutomationRequest(req, expectedToken, basePort = DEFAULT_AUTOMATION_PORT) {
    let urlObj;
    try {
        urlObj = new URL(
            req?.url || '/',
            `http://127.0.0.1:${basePort || DEFAULT_AUTOMATION_PORT}`,
        );
    } catch {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_URL',
            message: 'Malformed request URL',
            pathname: '/',
            urlObj: null,
        };
    }

    let pathname = urlObj.pathname || '/';
    let pathToken = '';
    const pathCapMatch = pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
    if (pathCapMatch) {
        try {
            pathToken = decodeURIComponent(pathCapMatch[1]);
        } catch {
            pathToken = '';
        }
        pathname = pathCapMatch[2] || '/';
        urlObj.pathname = pathname;
    }

    if (typeof expectedToken !== 'string' || !expectedToken.trim()) {
        return {
            ok: true,
            pathname,
            urlObj,
        };
    }

    const headers = req && typeof req === 'object' ? req.headers || {} : {};
    let headerToken = '';
    const rawAuth =
        typeof headers.authorization === 'string'
            ? headers.authorization.trim()
            : '';
    if (/^Bearer\s+/i.test(rawAuth)) {
        headerToken = rawAuth.replace(/^Bearer\s+/i, '').trim();
    } else if (
        typeof headers['x-multichrome-token'] === 'string' &&
        headers['x-multichrome-token'].trim()
    ) {
        headerToken = headers['x-multichrome-token'].trim();
    }

    const queryToken = (urlObj.searchParams.get('token') || '').trim();
    const candidate = pathToken || headerToken || queryToken;

    if (!verifyAutomationTokenConstantTime(candidate, expectedToken)) {
        return {
            ok: false,
            status: 401,
            code: 'UNAUTHORIZED',
            message:
                'Missing or invalid MultiChrome access token. Copy the current token or integration snippet from Settings -> Automation & MCP.',
            pathname,
            urlObj,
        };
    }

    return {
        ok: true,
        pathname,
        urlObj,
    };
}

export function formatAutomationBindError(error, port) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    if (code === 'EADDRINUSE') {
        return `端口 ${port} 已被占用或被系统保留，无法启动自动化控制面`;
    }
    if (code === 'EACCES') {
        return `端口 ${port} 被系统保留或权限受限，无法启动自动化控制面`;
    }
    return sanitizeAutomationErrorMessage(
        error,
        'Failed to start local automation server',
    );
}

export function validateAutomationPort(port, locale = 'zh-CN') {
    const parsed =
        typeof port === 'string' && /^\d+$/.test(port.trim())
            ? Number(port.trim())
            : port;
    if (
        typeof parsed !== 'number' ||
        !Number.isInteger(parsed) ||
        parsed < MIN_AUTOMATION_PORT ||
        parsed > MAX_AUTOMATION_PORT
    ) {
        throw new Error(
            locale === 'en-US'
                ? `Automation port must be an integer between ${MIN_AUTOMATION_PORT} and ${MAX_AUTOMATION_PORT}`
                : `自动化服务端口必须为 ${MIN_AUTOMATION_PORT} 到 ${MAX_AUTOMATION_PORT} 的整数`,
        );
    }
    return parsed;
}

function isLoopbackRemoteAddress(remoteAddress) {
    if (typeof remoteAddress !== 'string' || !remoteAddress) {
        return true;
    }
    const normalized = remoteAddress.trim().toLowerCase();
    return (
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === '::ffff:127.0.0.1'
    );
}

export function verifyLoopbackRequestSecurity(req, boundPort) {
    const headers = req && typeof req === 'object' ? req.headers || {} : {};

    if (
        Object.prototype.hasOwnProperty.call(headers, 'origin') &&
        headers.origin !== undefined
    ) {
        return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN_ORIGIN',
            message: 'Cross-origin browser requests are forbidden',
        };
    }

    const remoteAddress = req?.socket?.remoteAddress;
    if (
        typeof remoteAddress === 'string' &&
        remoteAddress &&
        !isLoopbackRemoteAddress(remoteAddress)
    ) {
        return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN_REMOTE',
            message: 'Non-loopback client address is forbidden',
        };
    }

    const rawHost = headers.host;
    if (typeof rawHost !== 'string' || !rawHost.trim()) {
        return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN_HOST',
            message: 'Missing or invalid Host header',
        };
    }

    const host = rawHost.trim().toLowerCase();
    const allowedHosts = new Set(['127.0.0.1', 'localhost']);
    if (
        typeof boundPort === 'number' &&
        Number.isInteger(boundPort) &&
        boundPort > 0
    ) {
        allowedHosts.add(`127.0.0.1:${boundPort}`);
        allowedHosts.add(`localhost:${boundPort}`);
    }

    if (!allowedHosts.has(host)) {
        return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN_HOST',
            message:
                'Host header must target loopback 127.0.0.1 or localhost',
        };
    }

    return { ok: true };
}

function redactManualProxyCredentials(proxyStr) {
    if (typeof proxyStr !== 'string') {
        return undefined;
    }
    const trimmed = proxyStr.trim();
    if (!trimmed) {
        return undefined;
    }

    if (
        !trimmed.includes('://') &&
        !trimmed.includes('@') &&
        !trimmed.startsWith('[')
    ) {
        const parts = trimmed.split(':');
        if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
            return `${parts[0]}:${parts[1]}:[redacted]`;
        }
    }

    const hasScheme = trimmed.includes('://');
    try {
        const parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
        if (parsed.username || parsed.password) {
            const pathSuffix =
                parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
            const prefix = hasScheme ? `${parsed.protocol}//` : '';
            return `${prefix}[redacted]@${parsed.host}${pathSuffix}`;
        }
        return trimmed;
    } catch {
        return trimmed.replace(/(\/\/|^)[^/\s@]+@/g, '$1[redacted]@');
    }
}

export function normalizeCdpConnectionInfo(connectionInfo) {
    if (!connectionInfo || typeof connectionInfo !== 'object') {
        return null;
    }
    let debugPort = connectionInfo.debugPort;
    const wsEndpoint =
        typeof connectionInfo.wsEndpoint === 'string' &&
        connectionInfo.wsEndpoint.trim()
            ? connectionInfo.wsEndpoint.trim()
            : typeof connectionInfo.webSocketDebuggerUrl === 'string' &&
                connectionInfo.webSocketDebuggerUrl.trim()
              ? connectionInfo.webSocketDebuggerUrl.trim()
              : null;

    if (
        (!Number.isInteger(debugPort) || debugPort <= 0) &&
        wsEndpoint
    ) {
        try {
            const parsedWs = new URL(wsEndpoint);
            const parsedPort = Number(parsedWs.port);
            if (Number.isInteger(parsedPort) && parsedPort > 0) {
                debugPort = parsedPort;
            }
        } catch {
            // ignore unparseable wsEndpoint
        }
    }

    if (!Number.isInteger(debugPort) || debugPort <= 0) {
        return null;
    }

    return {
        debugPort,
        httpEndpoint:
            typeof connectionInfo.httpEndpoint === 'string' &&
            connectionInfo.httpEndpoint.trim()
                ? connectionInfo.httpEndpoint.trim()
                : `http://127.0.0.1:${debugPort}`,
        wsEndpoint,
        debuggerAddress:
            typeof connectionInfo.debuggerAddress === 'string' &&
            connectionInfo.debuggerAddress.trim()
                ? connectionInfo.debuggerAddress.trim()
                : `127.0.0.1:${debugPort}`,
    };
}

function sanitizeProxyForAutomation(proxySummary) {
    if (!proxySummary || typeof proxySummary !== 'object') {
        return null;
    }
    return {
        id: proxySummary.id,
        name: typeof proxySummary.name === 'string' ? proxySummary.name : '',
        protocol:
            typeof proxySummary.protocol === 'string' && proxySummary.protocol
                ? proxySummary.protocol
                : 'sing-box',
        status:
            typeof proxySummary.status === 'string' && proxySummary.status
                ? proxySummary.status
                : 'stopped',
        exitInfo:
            proxySummary.exitInfo && typeof proxySummary.exitInfo === 'object'
                ? structuredClone(proxySummary.exitInfo)
                : { status: 'idle' },
    };
}

export function sanitizeProfileForAutomation(
    env,
    guardedCdp = null,
    proxySummary = null,
    isActiveTarget = false,
) {
    if (!env || typeof env !== 'object') {
        return null;
    }
    const sanitizedManagedProxy = proxySummary
        ? sanitizeProxyForAutomation(proxySummary)
        : null;

    let cdp = null;
    if (
        guardedCdp &&
        typeof guardedCdp === 'object' &&
        typeof guardedCdp.wsEndpoint === 'string' &&
        guardedCdp.wsEndpoint.trim()
    ) {
        cdp = {
            wsEndpoint: guardedCdp.wsEndpoint.trim(),
            ...(typeof guardedCdp.httpEndpoint === 'string' &&
            guardedCdp.httpEndpoint.trim()
                ? { httpEndpoint: guardedCdp.httpEndpoint.trim() }
                : {}),
        };
    }

    const result = {
        id: env.id,
        name: env.name,
        groupName: env.groupName,
        notes: typeof env.notes === 'string' ? env.notes : '',
        tags: Array.isArray(env.tags) ? [...env.tags] : [],
        proxy: redactManualProxyCredentials(env.proxy),
        proxyId: env.proxyId || undefined,
        proxyLabel: env.proxyLabel || undefined,
        userAgent: env.userAgent || undefined,
        timezone: env.timezone || undefined,
        language: env.language || undefined,
        startupUrl: env.startupUrl || undefined,
        browserEngine: env.browserEngine || 'system-chrome',
        fingerprintConfig: env.fingerprintConfig
            ? structuredClone(env.fingerprintConfig)
            : undefined,
        createdAt: env.createdAt,
        lastUsed: env.lastUsed,
        isRunning: Boolean(env.isRunning || cdp),
        isActiveTarget: Boolean(isActiveTarget),
        cdp,
    };

    if (sanitizedManagedProxy) {
        result.managedProxy = sanitizedManagedProxy;
    }

    return result;
}

export function sanitizeAutomationErrorMessage(
    error,
    fallbackMessage = 'Operation failed',
) {
    const raw =
        error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : '';
    if (!raw || !raw.trim()) {
        return fallbackMessage;
    }
    const firstLine = raw.split(/\r?\n/)[0].trim();
    if (!firstLine) {
        return fallbackMessage;
    }
    return firstLine
        .replace(/\/t\/[^/\s"'?#]+/g, '/t/[redacted]')
        .replace(/mc_live_[A-Za-z0-9_-]+/g, 'mc_live_[redacted]')
        .replace(
            /Bearer[ \t]+(?!token\b|auth(?:orization)?\b|header\b)[^\s]+/gi,
            'Bearer [redacted]',
        )
        .replace(
            /(https?|socks5h?|socks|vless|vmess|trojan|ss|hy2|hysteria2|tuic):\/\/[^/\s@]+@/gi,
            '$1://[redacted]@',
        )
        .replace(
            /\b((?:[0-9]{1,3}\.){3}[0-9]{1,3}):(\d{1,5}):([^:\s]+):([^\s]+)/g,
            (full, ip, port) => (isIP(ip) ? `${ip}:${port}:[redacted]` : full),
        )
        .replace(/([A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+/g, '$1[user]')
        .slice(0, 500);
}

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasControlCharacters(value) {
    return [...value].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127;
    });
}

export function createValidationError(
    message,
    code = 'VALIDATION_ERROR',
    statusCode = 400,
) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

export function validateUuid(value, label = 'id') {
    if (typeof value !== 'string' || !UUID_REGEX.test(value.trim())) {
        throw createValidationError(
            `Invalid ${label}: expected a valid UUID`,
            'INVALID_ID',
            400,
        );
    }
    return value.trim().toLowerCase();
}

export function validateOptionalString(
    value,
    label = 'value',
    { maxLength = 500, allowNewlines = false } = {},
) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw createValidationError(
            `${label} must be a string`,
            'INVALID_INPUT',
            400,
        );
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
        throw createValidationError(
            `${label} must not exceed ${maxLength} characters`,
            'INVALID_INPUT',
            400,
        );
    }
    if (!allowNewlines && hasControlCharacters(trimmed)) {
        throw createValidationError(
            `${label} contains invalid control characters`,
            'INVALID_INPUT',
            400,
        );
    }
    return trimmed;
}

const VALID_PROFILE_STATUS_FILTERS = new Set(['all', 'running', 'stopped']);

export function validateProfileListFilters(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw createValidationError(
            'Profile filters must be an object',
            'INVALID_FILTER',
            400,
        );
    }
    const group = validateOptionalString(raw.group, 'group', { maxLength: 120 });
    const tag = validateOptionalString(raw.tag, 'tag', { maxLength: 60 });
    const query = validateOptionalString(raw.query, 'query', { maxLength: 200 });
    const rawStatus =
        raw.status === undefined || raw.status === null || raw.status === ''
            ? 'all'
            : raw.status;
    if (
        typeof rawStatus !== 'string' ||
        !VALID_PROFILE_STATUS_FILTERS.has(rawStatus)
    ) {
        throw createValidationError(
            'status must be one of: all, running, stopped',
            'INVALID_FILTER',
            400,
        );
    }
    return {
        group: group || undefined,
        tag: tag || undefined,
        status: rawStatus,
        query: query || undefined,
    };
}
