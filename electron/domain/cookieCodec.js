const VALID_SAME_SITE = new Map([
    ['strict', 'Strict'],
    ['lax', 'Lax'],
    ['no_restriction', 'None'],
    ['none', 'None'],
]);

function normalizeSameSite(raw) {
    if (typeof raw !== 'string') return undefined;
    return VALID_SAME_SITE.get(raw.trim().toLowerCase());
}

function normalizeCookieRecord(item) {
    if (!item || typeof item !== 'object') return null;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const value = item.value === undefined || item.value === null ? '' : String(item.value);
    const domain = typeof item.domain === 'string' ? item.domain.trim() : '';
    if (!name || !domain) return null;

    const path =
        typeof item.path === 'string' && item.path.trim().startsWith('/')
            ? item.path.trim()
            : '/';
    const rawExpires =
        item.expires !== undefined ? item.expires : item.expirationDate;
    const expires = Number(rawExpires);
    const sameSite = normalizeSameSite(item.sameSite);

    const out = {
        name,
        value,
        domain,
        path,
        secure: Boolean(item.secure),
        httpOnly: Boolean(item.httpOnly),
    };
    if (sameSite) {
        out.sameSite = sameSite;
    }
    if (Number.isFinite(expires) && expires > 0) {
        out.expires = expires;
    }
    return out;
}

function parseNetscapeCookies(rawText) {
    const cookies = [];
    const lines = rawText.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        let httpOnlyPrefix = false;
        let normalizedLine = line;
        if (normalizedLine.startsWith('#HttpOnly_')) {
            httpOnlyPrefix = true;
            normalizedLine = normalizedLine.slice('#HttpOnly_'.length);
        } else if (normalizedLine.startsWith('#')) {
            continue;
        }

        const parts = normalizedLine.split('\t');
        if (parts.length < 7) continue;

        const [domain, , path, secureFlag, expiryStr, name, ...valueRest] = parts;
        const value = valueRest.join('\t');
        const expires = Number(expiryStr);
        const cookie = normalizeCookieRecord({
            domain,
            path,
            secure: String(secureFlag).trim().toUpperCase() === 'TRUE',
            httpOnly: httpOnlyPrefix,
            expires: Number.isFinite(expires) && expires > 0 ? expires : undefined,
            name,
            value,
        });
        if (cookie) {
            cookies.push(cookie);
        }
    }
    return cookies;
}

export function parseCookiesInput(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) {
        throw new Error('请输入 JSON 或 Netscape 格式的 Cookie 数据');
    }
    const trimmed = rawText.trim();

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            throw new Error('Cookie JSON 格式无效，请检查语法');
        }
        const rawList = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.cookies)
              ? parsed.cookies
              : null;
        if (!rawList) {
            throw new Error('Cookie JSON 必须为数组或包含 cookies 字段');
        }
        const normalized = rawList
            .map((item) => normalizeCookieRecord(item))
            .filter(Boolean);
        if (normalized.length === 0) {
            throw new Error('未在输入中解析到有效的 Cookie 条目');
        }
        return normalized;
    }

    const netscapeCookies = parseNetscapeCookies(trimmed);
    if (netscapeCookies.length === 0) {
        throw new Error('未解析到有效的 JSON 或 Netscape Cookie 条目');
    }
    return netscapeCookies;
}

export function serializeCookiesJson(cookies) {
    const list = Array.isArray(cookies)
        ? cookies.map((item) => normalizeCookieRecord(item)).filter(Boolean)
        : [];
    return JSON.stringify(list, null, 2);
}

export function serializeCookiesNetscape(cookies) {
    const header = [
        '# Netscape HTTP Cookie File',
        '# Exported by MultiChrome',
        '',
    ];
    const list = Array.isArray(cookies)
        ? cookies.map((item) => normalizeCookieRecord(item)).filter(Boolean)
        : [];
    const lines = list.map((c) => {
        const domainField = `${c.httpOnly ? '#HttpOnly_' : ''}${c.domain}`;
        const includeSubdomains = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry =
            Number.isFinite(c.expires) && c.expires > 0
                ? Math.floor(c.expires)
                : 0;
        return [
            domainField,
            includeSubdomains,
            c.path || '/',
            secure,
            expiry,
            c.name,
            c.value,
        ].join('\t');
    });
    return [...header, ...lines].join('\n');
}
