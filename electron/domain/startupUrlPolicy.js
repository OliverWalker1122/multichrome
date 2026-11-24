const BLANK_URL_PATTERNS = [
    /^$/,
    /^about:blank$/i,
    /^chrome:\/\/newtab\/?$/i,
    /^chrome:\/\/new-tab-page\/?$/i,
    /^chrome-search:\/\/local-ntp\/?$/i,
    /^edge:\/\/newtab\/?$/i,
];

/**
 * 判断标签页 URL 是否为空白/新标签页
 * @param {unknown} url
 * @returns {boolean}
 */
export function isBlankTabUrl(url) {
    if (typeof url !== 'string') return true;
    const trimmed = url.trim();
    return BLANK_URL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * 规范化 URL 以便比较是否属于同一启动页（忽略尾部斜杠、协议大小写及默认端口）
 * @param {unknown} rawUrl
 * @returns {string}
 */
export function normalizeStartupUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
        }
        const pathname = parsed.pathname.replace(/\/+$/, '') || '';
        return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
    } catch {
        return '';
    }
}

/**
 * 判断两个 URL 是否代表同一个启动页（完全匹配，或目标启动页为根路径时同 host 匹配）
 * @param {string} existingUrl
 * @param {string} startupUrl
 * @returns {boolean}
 */
export function isSameStartupPage(existingUrl, startupUrl) {
    const normExisting = normalizeStartupUrl(existingUrl);
    const normStartup = normalizeStartupUrl(startupUrl);
    if (!normExisting || !normStartup) return false;
    if (normExisting === normStartup) return true;

    try {
        const a = new URL(normExisting);
        const b = new URL(normStartup);
        const stripWww = (h) => h.toLowerCase().replace(/^www\./, '');
        if (stripWww(a.host) !== stripWww(b.host)) return false;
        const bPath = b.pathname.replace(/\/+$/, '');
        // 启动页本身是站点首页（如 https://ip125.com/）时，同一站点的任意重定向页也视为已存在
        if (!bPath && !b.search) return true;
    } catch {
        return false;
    }
    return false;
}

/**
 * 根据当前浏览器已打开的页面目标，决定是否需要打开启动页（纯领域决策，零 I/O）。
 *
 * 规则：
 * 1. 若已打开页面中已包含相同启动页 -> 跳过（避免重复堆叠）
 * 2. 若当前存在空白/新标签页 -> 复用第一个空白页导航到启动页
 * 3. 若已恢复其他业务页面但没有启动页 -> 新建 1 个标签页打开启动页
 *
 * @param {Array<{ targetId: string; url?: string; type?: string }>} targets
 * @param {string} startupUrl
 * @returns {{ action: 'skip'; reason: string } | { action: 'navigate'; targetId: string; url: string } | { action: 'create'; url: string }}
 */
export function decideStartupUrlAction(targets, startupUrl) {
    const trimmed = typeof startupUrl === 'string' ? startupUrl.trim() : '';
    const normalizedStartup = normalizeStartupUrl(trimmed);
    if (!normalizedStartup) {
        return { action: 'skip', reason: 'invalid-or-empty-startup-url' };
    }

    const pages = Array.isArray(targets)
        ? targets.filter((t) => t && t.type === 'page' && typeof t.targetId === 'string')
        : [];

    for (const page of pages) {
        if (typeof page.url === 'string' && isSameStartupPage(page.url, trimmed)) {
            return { action: 'skip', reason: 'already-open' };
        }
    }

    const blankPage = pages.find((p) => isBlankTabUrl(p.url));
    if (blankPage) {
        return {
            action: 'navigate',
            targetId: blankPage.targetId,
            url: trimmed,
        };
    }

    return {
        action: 'create',
        url: trimmed,
    };
}
