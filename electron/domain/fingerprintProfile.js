import crypto from 'crypto';

export const BROWSER_ENGINES = ['system-chrome', 'fingerprint-chromium'];
export const FINGERPRINT_PLATFORMS = ['windows', 'macos', 'linux'];
export const FINGERPRINT_BRANDS = ['Chrome', 'Edge', 'Opera', 'Vivaldi'];
export const SPOOFING_KEYS = ['canvas', 'audio', 'font', 'clientrects', 'gpu'];

export const WINDOWS_PLATFORM_VERSIONS = ['10.0.0', '15.0.0'];
export const MACOS_PLATFORM_VERSIONS = ['14.6.1', '15.2.0', '15.3.1'];
export const LINUX_PLATFORM_VERSIONS = ['6.6.0', '6.8.0', '6.11.0'];

export const REALISTIC_CPU_CORES = [4, 6, 8, 12, 16];

export const REALISTIC_WINDOW_SIZES = [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
];

export const DEFAULT_SPOOFING_OPTIONS = {
    canvas: true,
    audio: true,
    font: true,
    clientrects: true,
    gpu: true,
};

export function getHostFingerprintPlatform(nodePlatform = process.platform) {
    if (nodePlatform === 'darwin') return 'macos';
    if (nodePlatform === 'linux') return 'linux';
    return 'windows';
}

export const DEFAULT_FINGERPRINT_SETTINGS = {
    defaultEngine: 'system-chrome',
    platform: getHostFingerprintPlatform(),
    brand: 'Chrome',
    autoMatchTimezone: true,
    autoMatchLanguage: false,
    autoMatchGeolocation: false,
    defaultLanguage: 'en-US',
    spoofing: { ...DEFAULT_SPOOFING_OPTIONS },
};

function pickRandom(items) {
    return items[crypto.randomInt(0, items.length)];
}

export function getPlatformVersions(platform) {
    switch (platform) {
        case 'macos':
            return MACOS_PLATFORM_VERSIONS;
        case 'linux':
            return LINUX_PLATFORM_VERSIONS;
        case 'windows':
        default:
            return WINDOWS_PLATFORM_VERSIONS;
    }
}

export function generateFingerprintSeed() {
    // 32-bit positive integer (100000 .. 2147483646)
    return crypto.randomInt(100000, 2147483647);
}

export function normalizeSpoofingOptions(raw, fallback = DEFAULT_SPOOFING_OPTIONS) {
    const base = { ...DEFAULT_SPOOFING_OPTIONS, ...(fallback || {}) };
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const result = {};
    for (const key of SPOOFING_KEYS) {
        result[key] = typeof raw[key] === 'boolean' ? raw[key] : Boolean(base[key]);
    }
    return result;
}

export function normalizeDefaultFingerprintSettings(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            ...DEFAULT_FINGERPRINT_SETTINGS,
            spoofing: { ...DEFAULT_SPOOFING_OPTIONS },
        };
    }

    const defaultEngine = BROWSER_ENGINES.includes(raw.defaultEngine)
        ? raw.defaultEngine
        : DEFAULT_FINGERPRINT_SETTINGS.defaultEngine;
    const platform = FINGERPRINT_PLATFORMS.includes(raw.platform)
        ? raw.platform
        : DEFAULT_FINGERPRINT_SETTINGS.platform;
    const brand = FINGERPRINT_BRANDS.includes(raw.brand)
        ? raw.brand
        : DEFAULT_FINGERPRINT_SETTINGS.brand;
    const autoMatchTimezone =
        typeof raw.autoMatchTimezone === 'boolean'
            ? raw.autoMatchTimezone
            : DEFAULT_FINGERPRINT_SETTINGS.autoMatchTimezone;
    const autoMatchLanguage =
        typeof raw.autoMatchLanguage === 'boolean'
            ? raw.autoMatchLanguage
            : DEFAULT_FINGERPRINT_SETTINGS.autoMatchLanguage;
    const autoMatchGeolocation =
        typeof raw.autoMatchGeolocation === 'boolean'
            ? raw.autoMatchGeolocation
            : DEFAULT_FINGERPRINT_SETTINGS.autoMatchGeolocation;
    const defaultLanguage =
        typeof raw.defaultLanguage === 'string' && raw.defaultLanguage.trim()
            ? raw.defaultLanguage.trim()
            : DEFAULT_FINGERPRINT_SETTINGS.defaultLanguage;

    return {
        defaultEngine,
        platform,
        brand,
        autoMatchTimezone,
        autoMatchLanguage,
        autoMatchGeolocation,
        defaultLanguage,
        spoofing: normalizeSpoofingOptions(raw.spoofing, DEFAULT_SPOOFING_OPTIONS),
    };
}

export function generateFingerprintConfig(defaults = {}) {
    const normalizedDefaults = normalizeDefaultFingerprintSettings(defaults);
    const platform = normalizedDefaults.platform;
    const versions = getPlatformVersions(platform);

    return {
        seed: generateFingerprintSeed(),
        platform,
        platformVersion: pickRandom(versions),
        brand: normalizedDefaults.brand,
        hardwareConcurrency: pickRandom(REALISTIC_CPU_CORES),
        windowSize: { ...pickRandom(REALISTIC_WINDOW_SIZES) },
        spoofing: { ...normalizedDefaults.spoofing },
    };
}

export function normalizeFingerprintConfig(raw, defaults = {}) {
    if (!raw || typeof raw !== 'object') {
        return generateFingerprintConfig(defaults);
    }

    const normalizedDefaults = normalizeDefaultFingerprintSettings(defaults);
    const platform = FINGERPRINT_PLATFORMS.includes(raw.platform)
        ? raw.platform
        : normalizedDefaults.platform;
    const versions = getPlatformVersions(platform);

    const parsedSeed = Number(raw.seed);
    const seed =
        Number.isInteger(parsedSeed) && parsedSeed >= 1 && parsedSeed <= 2147483647
            ? parsedSeed
            : generateFingerprintSeed();

    const platformVersion =
        typeof raw.platformVersion === 'string' && raw.platformVersion.trim()
            ? raw.platformVersion.trim()
            : versions[0];

    const brand = FINGERPRINT_BRANDS.includes(raw.brand)
        ? raw.brand
        : normalizedDefaults.brand;

    const parsedCores = Number(raw.hardwareConcurrency);
    const hardwareConcurrency =
        Number.isInteger(parsedCores) && parsedCores >= 2 && parsedCores <= 32
            ? parsedCores
            : pickRandom(REALISTIC_CPU_CORES);

    const rawW = Number(raw.windowSize?.width);
    const rawH = Number(raw.windowSize?.height);
    const windowSize =
        Number.isInteger(rawW) &&
        Number.isInteger(rawH) &&
        rawW >= 800 &&
        rawW <= 3840 &&
        rawH >= 600 &&
        rawH <= 2160
            ? { width: rawW, height: rawH }
            : { ...pickRandom(REALISTIC_WINDOW_SIZES) };

    return {
        seed,
        platform,
        platformVersion,
        brand,
        hardwareConcurrency,
        windowSize,
        spoofing: normalizeSpoofingOptions(raw.spoofing, normalizedDefaults.spoofing),
    };
}

export function parseFingerprintConfigJson(raw) {
    if (!raw) return undefined;
    if (typeof raw === 'object') {
        return normalizeFingerprintConfig(raw);
    }
    if (typeof raw !== 'string') return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return undefined;
        return normalizeFingerprintConfig(parsed);
    } catch {
        return undefined;
    }
}

export function normalizeBrowserEngine(raw) {
    return BROWSER_ENGINES.includes(raw) ? raw : 'system-chrome';
}

/**
 * 构建 adryfish/fingerprint-chromium 的 C++ 引擎级抗指纹命令行参数
 */
export function buildFingerprintChromiumArgs(config, options = {}) {
    const normalized = normalizeFingerprintConfig(config);
    const args = [
        `--fingerprint=${normalized.seed}`,
        `--fingerprint-platform=${normalized.platform}`,
        `--fingerprint-brand=${normalized.brand}`,
        `--fingerprint-hardware-concurrency=${normalized.hardwareConcurrency}`,
        '--disable-non-proxied-udp',
        // 禁用 Chromium 148 的 W3C DeviceBoundSessions (DBSC)：
        // 1) 其在高延迟/住宅代理下刷新 /RotateBoundCookies 时无独立超时，且阻塞全部 *.google.com 凭据请求，易导致 Gmail 等站点永久卡加载屏；
        // 2) DBSC 将短生命周期 Cookie 绑定到宿主机 TPM，破坏多环境迁移与跨环境隔离。
        '--disable-features=DeviceBoundSessions,PersistDeviceBoundSessions',
    ];

    if (normalized.platformVersion) {
        args.push(`--fingerprint-platform-version=${normalized.platformVersion}`);
    }

    if (normalized.windowSize?.width && normalized.windowSize?.height) {
        args.push(
            `--window-size=${normalized.windowSize.width},${normalized.windowSize.height}`,
        );
    }

    if (options.timezone && typeof options.timezone === 'string' && options.timezone.trim()) {
        args.push(`--timezone=${options.timezone.trim()}`);
    }

    const disabledSpoofing = SPOOFING_KEYS.filter(
        (key) => normalized.spoofing[key] === false,
    );
    if (disabledSpoofing.length > 0) {
        args.push(`--disable-spoofing=${disabledSpoofing.join(',')}`);
    }

    return args;
}
