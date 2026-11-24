/**
 * Proxy exit IP + Geo timezone parsing and default English language helpers.
 * All probes run exclusively through the environment's configured proxy.
 */

export const GEO_PROBE_TARGETS = [
    {
        host: 'ip-api.com',
        path: '/json/?fields=status,query,countryCode,timezone,lat,lon',
        kind: 'geo',
    },
    {
        host: 'ipinfo.io',
        path: '/json',
        kind: 'geo',
    },
    {
        host: 'ipwho.is',
        path: '/',
        kind: 'geo',
    },
];

export const IP_ONLY_PROBE_TARGETS = [
    { host: 'api.ipify.org', path: '/', kind: 'ip' },
    { host: 'ipinfo.io', path: '/ip', kind: 'ip' },
    { host: 'ipv4.icanhazip.com', path: '/', kind: 'ip' },
    { host: 'ifconfig.me', path: '/ip', kind: 'ip' },
    { host: 'checkip.amazonaws.com', path: '/', kind: 'ip' },
];

export const DEFAULT_AUTO_LANGUAGE = 'en-US';

export const COUNTRY_TO_LOCALE = {
    US: 'en-US',
    GB: 'en-GB',
    UK: 'en-GB',
    CA: 'en-CA',
    AU: 'en-AU',
    NZ: 'en-NZ',
    IE: 'en-IE',
    SG: 'en-SG',
    PH: 'en-PH',
    IN: 'en-IN',
    ZA: 'en-ZA',
    NG: 'en-NG',
    KE: 'en-KE',
    GH: 'en-GH',
    MT: 'en-MT',
    JP: 'ja-JP',
    KR: 'ko-KR',
    TW: 'zh-TW',
    HK: 'zh-HK',
    MO: 'zh-HK',
    CN: 'zh-CN',
    DE: 'de-DE',
    AT: 'de-AT',
    CH: 'de-CH',
    FR: 'fr-FR',
    BE: 'fr-BE',
    LU: 'fr-LU',
    ES: 'es-ES',
    MX: 'es-MX',
    AR: 'es-AR',
    CL: 'es-CL',
    CO: 'es-CO',
    BO: 'es-BO',
    PE: 'es-PE',
    EC: 'es-EC',
    UY: 'es-UY',
    PY: 'es-PY',
    VE: 'es-VE',
    CR: 'es-CR',
    PA: 'es-PA',
    GT: 'es-GT',
    DO: 'es-DO',
    PR: 'es-PR',
    HN: 'es-HN',
    NI: 'es-NI',
    SV: 'es-SV',
    CU: 'es-CU',
    IT: 'it-IT',
    NL: 'nl-NL',
    PT: 'pt-PT',
    BR: 'pt-BR',
    RU: 'ru-RU',
    KZ: 'ru-KZ',
    BY: 'be-BY',
    UA: 'uk-UA',
    PL: 'pl-PL',
    TR: 'tr-TR',
    GR: 'el-GR',
    CY: 'el-CY',
    RO: 'ro-RO',
    MD: 'ro-MD',
    HU: 'hu-HU',
    SK: 'sk-SK',
    BG: 'bg-BG',
    HR: 'hr-HR',
    RS: 'sr-RS',
    SI: 'sl-SI',
    LT: 'lt-LT',
    LV: 'lv-LV',
    EE: 'et-EE',
    IS: 'is-IS',
    VN: 'vi-VN',
    TH: 'th-TH',
    ID: 'id-ID',
    MY: 'ms-MY',
    KH: 'km-KH',
    MM: 'my-MM',
    LA: 'lo-LA',
    MN: 'mn-MN',
    PK: 'ur-PK',
    BD: 'bn-BD',
    LK: 'si-LK',
    NP: 'ne-NP',
    UZ: 'uz-UZ',
    SE: 'sv-SE',
    NO: 'nb-NO',
    DK: 'da-DK',
    FI: 'fi-FI',
    CZ: 'cs-CZ',
    AE: 'ar-AE',
    SA: 'ar-SA',
    EG: 'ar-EG',
    MA: 'ar-MA',
    QA: 'ar-QA',
    KW: 'ar-KW',
    OM: 'ar-OM',
    JO: 'ar-JO',
    IL: 'he-IL',
};

export function resolveLocaleForCountry(
    countryCode,
    fallback = DEFAULT_AUTO_LANGUAGE,
) {
    if (typeof countryCode === 'string') {
        const code = countryCode.trim().toUpperCase();
        if (COUNTRY_TO_LOCALE[code]) {
            return COUNTRY_TO_LOCALE[code];
        }
    }
    return typeof fallback === 'string' && fallback.trim()
        ? fallback.trim()
        : DEFAULT_AUTO_LANGUAGE;
}

export function resolveEffectiveLanguage(configuredLanguage, options = {}) {
    const raw =
        typeof configuredLanguage === 'string' ? configuredLanguage.trim() : '';
    const fallback =
        typeof options?.defaultLanguage === 'string' &&
        options.defaultLanguage.trim()
            ? options.defaultLanguage.trim()
            : DEFAULT_AUTO_LANGUAGE;

    if (raw.toLowerCase() === 'auto') {
        return resolveLocaleForCountry(options?.countryCode, fallback);
    }
    if (raw) {
        return raw;
    }
    if (options?.autoMatchLanguage && options?.countryCode) {
        return resolveLocaleForCountry(options.countryCode, fallback);
    }
    return fallback;
}

/**
 * 将语言区域（如 en-US / ja-JP / en-GB）映射为 Chromium 的 countryid_at_install 整数编码
 * （Chromium country_codes::CountryCharsToCountryID(c1, c2) = (c1 << 8) | c2）。
 * 用于避免新建环境在中文宿主机上被 Chromium 默认注入百度/搜狗等本土搜索引擎与 @书签。
 */
export function resolveChromiumCountryId(language) {
    const effective = resolveEffectiveLanguage(language);
    const regionMatch = effective.match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
    const country = regionMatch
        ? regionMatch[1].toUpperCase()
        : effective.toLowerCase().startsWith('en')
          ? 'US'
          : null;
    if (!country) return undefined;
    return (country.charCodeAt(0) << 8) | country.charCodeAt(1);
}

export function applyLanguagePreferences(prefs, language) {
    const next = prefs && typeof prefs === 'object' ? prefs : {};
    const effective = resolveEffectiveLanguage(language);
    if (!next.intl || typeof next.intl !== 'object') {
        next.intl = {};
    }
    const lower = effective.toLowerCase();
    const acceptList = lower.startsWith('en')
        ? `${effective},en`
        : `${effective},en-US,en`;
    // 必须同时覆盖 accept_languages 与 selected_languages，否则旧环境残留的
    // selected_languages: "zh-CN,zh" 会在 Chrome 启动时被重新合并回 Accept-Language
    next.intl.accept_languages = acceptList;
    next.intl.selected_languages = acceptList;

    if (typeof next.countryid_at_install !== 'number') {
        const countryId = resolveChromiumCountryId(effective);
        if (countryId !== undefined) {
            next.countryid_at_install = countryId;
        }
    }

    if (!lower.startsWith('zh') && Array.isArray(next.translate_blocked_languages)) {
        next.translate_blocked_languages = next.translate_blocked_languages.filter(
            (item) => typeof item === 'string' && !item.toLowerCase().startsWith('zh'),
        );
        if (next.translate_blocked_languages.length === 0) {
            next.translate_blocked_languages = ['en'];
        }
    }
    return next;
}

export function extractValidIPv4(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/);
    if (!match) return null;
    const octets = match.slice(1, 5).map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return null;
    }
    return match[0];
}

export function isValidIanaTimeZone(timezone) {
    if (
        typeof timezone !== 'string' ||
        timezone.length < 3 ||
        timezone.length > 64 ||
        !/^[A-Za-z0-9_/+.-]+$/.test(timezone)
    ) {
        return false;
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}

function decodeChunkedBody(rawBody) {
    const parts = [];
    let cursor = 0;
    while (cursor < rawBody.length) {
        const lineEnd = rawBody.indexOf('\r\n', cursor);
        if (lineEnd === -1) break;
        const sizeHex = rawBody.slice(cursor, lineEnd).split(';')[0].trim();
        const size = Number.parseInt(sizeHex, 16);
        if (!Number.isFinite(size) || size < 0) return rawBody;
        if (size === 0) break;
        const chunkStart = lineEnd + 2;
        parts.push(rawBody.slice(chunkStart, chunkStart + size));
        cursor = chunkStart + size + 2;
    }
    return parts.length > 0 ? parts.join('') : rawBody;
}

export function parseHttpResponseBody(buffer) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
    const sepIndex = text.indexOf('\r\n\r\n');
    if (sepIndex === -1) {
        return { statusCode: 200, body: text };
    }
    const headerBlock = text.slice(0, sepIndex);
    const rawBody = text.slice(sepIndex + 4);
    const statusMatch = headerBlock.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
    const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
    const isChunked = /transfer-encoding:\s*chunked/i.test(headerBlock);
    return {
        statusCode,
        body: isChunked ? decodeChunkedBody(rawBody) : rawBody,
    };
}

export function parseGeoProbeResponse(buffer) {
    const { statusCode, body } = parseHttpResponseBody(buffer);
    if (statusCode && (statusCode < 200 || statusCode >= 300)) {
        return null;
    }

    // Extract outermost JSON object defensively in case of trailing whitespace
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start) {
        return null;
    }

    let data;
    try {
        data = JSON.parse(body.slice(start, end + 1));
    } catch {
        return null;
    }

    if (!data || typeof data !== 'object') return null;
    if (data.status === 'fail' || data.success === false) return null;

    const ip = extractValidIPv4(
        typeof data.query === 'string'
            ? data.query
            : typeof data.ip === 'string'
              ? data.ip
              : '',
    );
    if (!ip) return null;

    const rawTz =
        typeof data.timezone === 'string'
            ? data.timezone
            : data.timezone && typeof data.timezone === 'object' && typeof data.timezone.id === 'string'
              ? data.timezone.id
              : undefined;
    const timezone = rawTz && isValidIanaTimeZone(rawTz) ? rawTz : undefined;

    const countryCode =
        typeof data.countryCode === 'string'
            ? data.countryCode
            : typeof data.country_code === 'string'
              ? data.country_code
              : typeof data.country === 'string' && data.country.length === 2
                ? data.country
                : undefined;

    const result = { ip, timezone, countryCode };

    let lat;
    let lon;
    if (typeof data.lat === 'number' && typeof data.lon === 'number') {
        lat = data.lat;
        lon = data.lon;
    } else if (
        typeof data.latitude === 'number' &&
        typeof data.longitude === 'number'
    ) {
        lat = data.latitude;
        lon = data.longitude;
    } else if (typeof data.loc === 'string' && data.loc.includes(',')) {
        const [rawLat, rawLon] = data.loc.split(',').map((s) => Number(s.trim()));
        if (Number.isFinite(rawLat) && Number.isFinite(rawLon)) {
            lat = rawLat;
            lon = rawLon;
        }
    }
    if (
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
    ) {
        result.latitude = lat;
        result.longitude = lon;
    }

    return result;
}
