import crypto from 'node:crypto';
import net, { isIP } from 'node:net';

export const DEFAULT_AUTOMATION_PORT = 18922;
export const AUTOMATION_PORT_SCAN_START = DEFAULT_AUTOMATION_PORT;
export const AUTOMATION_PORT_SCAN_COUNT = 80;
export const MIN_AUTOMATION_PORT = 1024;
export const MAX_AUTOMATION_PORT = 65535;
export const AUTOMATION_TOKEN_PREFIX = 'mc_live_';
const AUTOMATION_STORE_KEY = 'automation';

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

export function probeLoopbackPort(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        let settled = false;
        const finish = (available, boundPort = 0) => {
            if (settled) return;
            settled = true;
            resolve({ available, port: boundPort });
        };
        server.unref?.();
        server.once('error', () => {
            try {
                server.close();
            } catch {
                // ignore
            }
            finish(false, 0);
        });
        server.once('listening', () => {
            const addr = server.address();
            const actualPort =
                addr && typeof addr === 'object' ? addr.port : port;
            server.close(() => finish(true, actualPort));
        });
        try {
            server.listen({ host: '127.0.0.1', port, exclusive: true });
        } catch {
            finish(false, 0);
        }
    });
}

export async function findAvailableAutomationPort({
    preferredPort = DEFAULT_AUTOMATION_PORT,
    excludePorts = [],
    scanStart = AUTOMATION_PORT_SCAN_START,
    scanCount = AUTOMATION_PORT_SCAN_COUNT,
    probe = probeLoopbackPort,
    locale = 'zh-CN',
} = {}) {
    const excluded = new Set(
        (Array.isArray(excludePorts) ? excludePorts : []).filter(
            (p) =>
                Number.isInteger(p) &&
                p >= MIN_AUTOMATION_PORT &&
                p <= MAX_AUTOMATION_PORT,
        ),
    );

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (candidate) => {
        if (
            !Number.isInteger(candidate) ||
            candidate < MIN_AUTOMATION_PORT ||
            candidate > MAX_AUTOMATION_PORT ||
            excluded.has(candidate) ||
            seen.has(candidate)
        ) {
            return;
        }
        seen.add(candidate);
        candidates.push(candidate);
    };

    pushCandidate(preferredPort);
    for (let offset = 0; offset < scanCount; offset += 1) {
        pushCandidate(scanStart + offset);
    }

    for (const candidate of candidates) {
        const result = await probe(candidate);
        if (
            result &&
            result.available &&
            Number.isInteger(result.port) &&
            result.port >= MIN_AUTOMATION_PORT &&
            result.port <= MAX_AUTOMATION_PORT &&
            !excluded.has(result.port)
        ) {
            return result.port;
        }
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await probe(0);
        if (
            result &&
            result.available &&
            Number.isInteger(result.port) &&
            result.port >= MIN_AUTOMATION_PORT &&
            result.port <= MAX_AUTOMATION_PORT &&
            !excluded.has(result.port)
        ) {
            return result.port;
        }
    }

    throw new Error(
        locale === 'en-US'
            ? 'Unable to find an available local loopback port (127.0.0.1)'
            : '无法找到可用的本地回环端口（127.0.0.1）',
    );
}

function isEnLocale(getLocale) {
    try {
        return typeof getLocale === 'function' && getLocale() === 'en-US';
    } catch {
        return false;
    }
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

export function generateAutomationToken() {
    return `${AUTOMATION_TOKEN_PREFIX}${crypto.randomBytes(36).toString('base64url')}`;
}

export function maskAutomationToken(token) {
    if (typeof token !== 'string' || !token) {
        return '';
    }
    if (token.length <= 4) {
        return '•'.repeat(token.length);
    }
    if (token.startsWith(AUTOMATION_TOKEN_PREFIX)) {
        if (token.length <= AUTOMATION_TOKEN_PREFIX.length + 4) {
            return `${AUTOMATION_TOKEN_PREFIX}••••`;
        }
        return `${AUTOMATION_TOKEN_PREFIX}••••••••••••${token.slice(-4)}`;
    }
    if (token.length <= 8) {
        return '••••••••';
    }
    return `••••••••••••${token.slice(-4)}`;
}

export function verifyBearerToken(authHeader, expectedToken) {
    if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
        return false;
    }
    if (typeof authHeader !== 'string') {
        return false;
    }
    const match = authHeader.match(/^Bearer[ \t]+([^\r\n\t ]+)[ \t]*$/i);
    if (!match) {
        return false;
    }
    const providedToken = match[1];
    const providedDigest = crypto
        .createHash('sha256')
        .update(providedToken, 'utf8')
        .digest();
    const expectedDigest = crypto
        .createHash('sha256')
        .update(expectedToken, 'utf8')
        .digest();
    return crypto.timingSafeEqual(providedDigest, expectedDigest);
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

export function redactManualProxyCredentials(proxyStr) {
    if (typeof proxyStr !== 'string') {
        return undefined;
    }
    const trimmed = proxyStr.trim();
    if (!trimmed) {
        return undefined;
    }

    // Support host:port:user:pass shorthand (matching singboxConfig.parseProxyLine)
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
        // Fallback regex redaction if URL parsing fails on unusual characters
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

export function sanitizeProxyForAutomation(proxySummary) {
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

export function hasControlCharacters(value) {
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

export function validateHttpUrl(value, label = 'url') {
    if (typeof value !== 'string' || !value.trim()) {
        throw createValidationError(
            `Invalid ${label}: expected an http or https URL`,
            'INVALID_URL',
            400,
        );
    }
    const trimmed = value.trim();
    if (trimmed.length > 4096 || hasControlCharacters(trimmed)) {
        throw createValidationError(
            `Invalid ${label}: URL contains illegal characters or exceeds length limit`,
            'INVALID_URL',
            400,
        );
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw createValidationError(
            `Invalid ${label}: malformed URL`,
            'INVALID_URL',
            400,
        );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw createValidationError(
            `Invalid ${label}: only http and https protocols are allowed`,
            'INVALID_URL',
            400,
        );
    }
    return parsed.toString();
}

export function validateRequiredString(
    value,
    label = 'value',
    { maxLength = 120 } = {},
) {
    if (typeof value !== 'string' || !value.trim()) {
        throw createValidationError(
            `${label} must be a non-empty string`,
            'INVALID_INPUT',
            400,
        );
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength || hasControlCharacters(trimmed)) {
        throw createValidationError(
            `${label} exceeds ${maxLength} characters or contains control characters`,
            'INVALID_INPUT',
            400,
        );
    }
    return trimmed;
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
const VALID_BROWSER_ENGINES = new Set(['system-chrome', 'fingerprint-chromium']);

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

export function validateCreateProfileInput(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw createValidationError(
            'Profile payload must be a JSON object',
            'INVALID_BODY',
            400,
        );
    }
    const name = validateRequiredString(raw.name, 'name', { maxLength: 120 });
    const rawGroup = validateOptionalString(raw.groupName, 'groupName', {
        maxLength: 80,
    });
    if (rawGroup === '用户分组') {
        throw createValidationError(
            'Reserved group sentinel cannot be used as groupName',
            'INVALID_INPUT',
            400,
        );
    }
    const groupName = rawGroup || '默认分组';
    const notes =
        validateOptionalString(raw.notes, 'notes', {
            maxLength: 2000,
            allowNewlines: true,
        }) ?? '';

    let tags;
    if ('tags' in raw && raw.tags !== undefined) {
        if (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string')) {
            throw createValidationError(
                'tags must be an array of strings',
                'INVALID_INPUT',
                400,
            );
        }
        tags = [];
        const seen = new Set();
        for (const entry of raw.tags) {
            const cleaned = entry.trim().replace(/\s+/g, ' ').slice(0, 24).trim();
            if (!cleaned || hasControlCharacters(cleaned)) continue;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            tags.push(cleaned);
            if (tags.length >= 12) break;
        }
    }

    let proxyId;
    if ('proxyId' in raw && raw.proxyId !== undefined && raw.proxyId !== null) {
        if (typeof raw.proxyId !== 'string') {
            throw createValidationError(
                'proxyId must be a UUID string',
                'INVALID_ID',
                400,
            );
        }
        if (raw.proxyId.trim()) {
            proxyId = validateUuid(raw.proxyId, 'proxyId');
        }
    }

    const proxy = validateOptionalString(raw.proxy, 'proxy', { maxLength: 500 });
    const proxyLabel = validateOptionalString(raw.proxyLabel, 'proxyLabel', {
        maxLength: 80,
    });

    let browserEngine;
    if ('browserEngine' in raw && raw.browserEngine !== undefined) {
        if (
            typeof raw.browserEngine !== 'string' ||
            !VALID_BROWSER_ENGINES.has(raw.browserEngine)
        ) {
            throw createValidationError(
                'browserEngine must be "system-chrome" or "fingerprint-chromium"',
                'INVALID_INPUT',
                400,
            );
        }
        browserEngine = raw.browserEngine;
    }

    const timezone = validateOptionalString(raw.timezone, 'timezone', {
        maxLength: 100,
    });
    const language = validateOptionalString(raw.language, 'language', {
        maxLength: 32,
    });

    let startupUrl;
    if (
        'startupUrl' in raw &&
        raw.startupUrl !== undefined &&
        raw.startupUrl !== null
    ) {
        if (typeof raw.startupUrl !== 'string') {
            throw createValidationError(
                'startupUrl must be an http/https URL string',
                'INVALID_URL',
                400,
            );
        }
        if (raw.startupUrl.trim()) {
            startupUrl = validateHttpUrl(raw.startupUrl, 'startupUrl');
        }
    }

    return {
        name,
        groupName,
        notes,
        ...(tags !== undefined ? { tags } : {}),
        ...(proxyId ? { proxyId } : {}),
        ...(proxy ? { proxy } : {}),
        ...(proxyLabel ? { proxyLabel } : {}),
        ...(browserEngine ? { browserEngine } : {}),
        ...(timezone ? { timezone } : {}),
        ...(language ? { language } : {}),
        ...(startupUrl ? { startupUrl } : {}),
    };
}

export function validateUpdateProfileInput(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw createValidationError(
            'Profile update payload must be a JSON object',
            'INVALID_BODY',
            400,
        );
    }

    const patch = {};

    if ('name' in raw && raw.name !== undefined) {
        patch.name = validateRequiredString(raw.name, 'name', { maxLength: 120 });
    }
    if ('groupName' in raw && raw.groupName !== undefined) {
        const g = validateRequiredString(raw.groupName, 'groupName', {
            maxLength: 80,
        });
        if (g === '用户分组') {
            throw createValidationError(
                'Reserved group sentinel cannot be used as groupName',
                'INVALID_INPUT',
                400,
            );
        }
        patch.groupName = g;
    }
    if ('notes' in raw && raw.notes !== undefined) {
        patch.notes =
            validateOptionalString(raw.notes, 'notes', {
                maxLength: 2000,
                allowNewlines: true,
            }) ?? '';
    }
    if ('tags' in raw && raw.tags !== undefined) {
        if (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string')) {
            throw createValidationError(
                'tags must be an array of strings',
                'INVALID_INPUT',
                400,
            );
        }
        const tags = [];
        const seen = new Set();
        for (const entry of raw.tags) {
            const cleaned = entry.trim().replace(/\s+/g, ' ').slice(0, 24).trim();
            if (!cleaned || hasControlCharacters(cleaned)) continue;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            tags.push(cleaned);
            if (tags.length >= 12) break;
        }
        patch.tags = tags;
    }
    if ('proxyId' in raw && raw.proxyId !== undefined) {
        if (raw.proxyId === null || raw.proxyId === '') {
            patch.proxyId = '';
        } else if (typeof raw.proxyId === 'string') {
            patch.proxyId = raw.proxyId.trim()
                ? validateUuid(raw.proxyId, 'proxyId')
                : '';
        } else {
            throw createValidationError(
                'proxyId must be a UUID string or empty string',
                'INVALID_ID',
                400,
            );
        }
    }
    if ('proxy' in raw && raw.proxy !== undefined) {
        patch.proxy =
            raw.proxy === null
                ? ''
                : validateOptionalString(raw.proxy, 'proxy', {
                      maxLength: 500,
                  }) ?? '';
    }
    if ('proxyLabel' in raw && raw.proxyLabel !== undefined) {
        patch.proxyLabel =
            raw.proxyLabel === null
                ? ''
                : validateOptionalString(raw.proxyLabel, 'proxyLabel', {
                      maxLength: 80,
                  }) ?? '';
    }
    if ('browserEngine' in raw && raw.browserEngine !== undefined) {
        if (
            typeof raw.browserEngine !== 'string' ||
            !VALID_BROWSER_ENGINES.has(raw.browserEngine)
        ) {
            throw createValidationError(
                'browserEngine must be "system-chrome" or "fingerprint-chromium"',
                'INVALID_INPUT',
                400,
            );
        }
        patch.browserEngine = raw.browserEngine;
    }
    if ('timezone' in raw && raw.timezone !== undefined) {
        patch.timezone =
            raw.timezone === null
                ? ''
                : validateOptionalString(raw.timezone, 'timezone', {
                      maxLength: 100,
                  }) ?? '';
    }
    if ('language' in raw && raw.language !== undefined) {
        patch.language =
            raw.language === null
                ? ''
                : validateOptionalString(raw.language, 'language', {
                      maxLength: 32,
                  }) ?? '';
    }
    if ('startupUrl' in raw && raw.startupUrl !== undefined) {
        if (raw.startupUrl === null || raw.startupUrl === '') {
            patch.startupUrl = '';
        } else if (typeof raw.startupUrl === 'string') {
            patch.startupUrl = raw.startupUrl.trim()
                ? validateHttpUrl(raw.startupUrl, 'startupUrl')
                : '';
        } else {
            throw createValidationError(
                'startupUrl must be an http/https URL string or empty string',
                'INVALID_URL',
                400,
            );
        }
    }

    if (Object.keys(patch).length === 0) {
        throw createValidationError(
            'At least one updatable field is required',
            'INVALID_INPUT',
            400,
        );
    }

    return patch;
}

export class AutomationConfigManager {
    /**
     * @param {{
     *   store: { get: (key: string, fallback?: any) => any, set: (key: string, value: any) => void },
     *   secretStorage?: any,
     *   defaultPort?: number,
     *   getLocale?: (() => string) | null,
     * }} options
     */
    constructor({
        store,
        secretStorage = null,
        defaultPort = DEFAULT_AUTOMATION_PORT,
        getLocale = null,
    }) {
        if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
            throw new Error('AutomationConfigManager requires a valid store');
        }
        this.store = store;
        this.secretStorage = secretStorage;
        this.getLocale = typeof getLocale === 'function' ? getLocale : null;

        let validatedDefaultPort = DEFAULT_AUTOMATION_PORT;
        try {
            validatedDefaultPort = validateAutomationPort(defaultPort);
        } catch {
            validatedDefaultPort = DEFAULT_AUTOMATION_PORT;
        }
        this.defaultPort = validatedDefaultPort;

        this.state = this.loadState();
    }

    encryptionAvailable() {
        return Boolean(
            this.secretStorage &&
                typeof this.secretStorage.isEncryptionAvailable === 'function' &&
                this.secretStorage.isEncryptionAvailable() &&
                this.secretStorage.getSelectedStorageBackend?.() !== 'basic_text',
        );
    }

    loadState() {
        const raw = this.store.get(AUTOMATION_STORE_KEY, null);
        const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

        let port = this.defaultPort;
        try {
            if (obj.port !== undefined) {
                port = validateAutomationPort(obj.port);
            }
        } catch {
            port = this.defaultPort;
        }

        const enabled =
            typeof obj.enabled === 'boolean'
                ? obj.enabled
                : Boolean(obj.localApiEnabled || obj.mcpEnabled);

        return {
            enabled,
            port,
        };
    }

    persistState(nextState) {
        const enabled = Boolean(nextState.enabled);
        const persisted = {
            enabled,
            // Preserve legacy booleans in store for backward compatibility across versions
            localApiEnabled: enabled,
            mcpEnabled: enabled,
            port: nextState.port,
        };
        this.store.set(AUTOMATION_STORE_KEY, persisted);
        this.state = {
            enabled,
            port: nextState.port,
        };
        return this.state;
    }

    getConfig() {
        return {
            enabled: this.state.enabled,
            localApiEnabled: this.state.enabled,
            mcpEnabled: this.state.enabled,
            port: this.state.port,
        };
    }

    updateConfig(patch = {}) {
        const en = isEnLocale(this.getLocale);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new Error(
                en ? 'Invalid automation configuration' : '自动化配置格式无效',
            );
        }

        let nextEnabled = this.state.enabled;
        if ('enabled' in patch) {
            nextEnabled = Boolean(patch.enabled);
        } else if ('localApiEnabled' in patch || 'mcpEnabled' in patch) {
            const nextLocal =
                'localApiEnabled' in patch
                    ? Boolean(patch.localApiEnabled)
                    : this.state.enabled;
            const nextMcp =
                'mcpEnabled' in patch
                    ? Boolean(patch.mcpEnabled)
                    : this.state.enabled;
            nextEnabled = Boolean(nextLocal || nextMcp);
        }

        const nextPort =
            'port' in patch && patch.port !== undefined
                ? validateAutomationPort(
                      patch.port,
                      en ? 'en-US' : 'zh-CN',
                  )
                : this.state.port;

        this.persistState({
            enabled: nextEnabled,
            port: nextPort,
        });

        return this.getConfig();
    }

    getStatus({
        running = false,
        lastError = undefined,
        stdioBridgePath = '',
        activeProfileId = null,
        activeProfileName = null,
        runningProfiles = [],
    } = {}) {
        const resolvedError =
            typeof lastError === 'string' && lastError.trim()
                ? lastError.trim()
                : undefined;
        const baseUrl = `http://127.0.0.1:${this.state.port}`;

        return {
            enabled: this.state.enabled,
            localApiEnabled: this.state.enabled,
            mcpEnabled: this.state.enabled,
            port: this.state.port,
            baseUrl,
            cdpEndpoint: baseUrl,
            mcpEndpoint: `${baseUrl}/mcp`,
            running: Boolean(running),
            ...(resolvedError ? { lastError: resolvedError } : {}),
            activeProfileId:
                typeof activeProfileId === 'string' && activeProfileId
                    ? activeProfileId
                    : null,
            activeProfileName:
                typeof activeProfileName === 'string' && activeProfileName
                    ? activeProfileName
                    : null,
            runningProfiles: Array.isArray(runningProfiles)
                ? runningProfiles
                : [],
            stdioBridgePath:
                typeof stdioBridgePath === 'string' ? stdioBridgePath : '',
        };
    }
}
