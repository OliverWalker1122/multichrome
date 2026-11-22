import { resolveLocaleForCountry } from './proxyGeo.js';

/**
 * Compute approximate UTC offset in minutes for an IANA timezone at a given Date.
 */
export function getTimeZoneOffsetMinutes(timeZone, date = new Date()) {
    try {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const parts = dtf.formatToParts(date);
        const map = {};
        for (const p of parts) {
            map[p.type] = p.value;
        }
        const hour = map.hour === '24' ? 0 : Number(map.hour);
        const asUtc = Date.UTC(
            Number(map.year),
            Number(map.month) - 1,
            Number(map.day),
            hour,
            Number(map.minute),
            Number(map.second),
        );
        return Math.round((asUtc - date.getTime()) / 60000);
    } catch {
        return null;
    }
}

const ZH_FRIENDLY_COUNTRIES = new Set(['CN', 'HK', 'TW', 'MO', 'SG']);

/**
 * Evaluate pre-launch consistency across proxy, kernel, timezone, and language.
 * @param {{ env: any, proxy?: any, exitInfo?: any, hasFingerprintKernel?: boolean, now?: Date, locale?: string }} params
 */
export function evaluateLaunchConsistency({
    env,
    proxy = null,
    exitInfo = null,
    hasFingerprintKernel = true,
    now = new Date(),
    locale = 'zh-CN',
}) {
    const isEn = locale === 'en-US';
    const issues = [];
    const suggestedPatch = {};

    // 1. Fingerprint kernel readiness check
    if (env?.browserEngine === 'fingerprint-chromium' && !hasFingerprintKernel) {
        issues.push({
            id: 'missing-kernel',
            severity: 'error',
            title: isEn
                ? 'C++ Fingerprint Kernel Missing'
                : '缺少 C++ 指纹浏览器内核',
            detail: isEn
                ? 'This environment is configured to use the C++ fingerprint kernel, which is not installed or activated yet. Download or import it in "Settings → Cores & Kernels", or switch to Official Chrome.'
                : '当前环境配置了 C++ 指纹内核，但尚未安装或激活可用内核。请先前往「设置 → 浏览器内核」下载或导入，或切换为官方 Chrome。',
        });
    }

    // 2. Managed proxy existence / error state check
    if (env?.proxyId) {
        if (!proxy) {
            issues.push({
                id: 'missing-proxy',
                severity: 'error',
                title: isEn
                    ? 'Bound Built-in Proxy Not Found'
                    : '绑定的内置代理已不存在',
                detail: isEn
                    ? 'The bound built-in proxy may have been deleted. Fail-Closed protection will block launch. Please assign another proxy.'
                    : '此环境绑定的内置代理可能已被删除，继续启动将被 Fail-Closed 策略阻断。请重新分配代理。',
            });
        } else if (proxy.status === 'error') {
            issues.push({
                id: 'proxy-error',
                severity: 'warning',
                title: isEn
                    ? 'Built-in Proxy in Error State'
                    : '内置代理处于异常状态',
                detail:
                    proxy.lastError ||
                    (isEn
                        ? 'The proxy service failed to start last time. Check upstream connectivity and proxy logs.'
                        : '代理服务上次启动失败，请检查上游连通性与代理日志。'),
            });
        }
    }

    const exitCountry =
        typeof exitInfo?.countryCode === 'string' && exitInfo.countryCode.trim()
            ? exitInfo.countryCode.trim().toUpperCase()
            : '';
    const exitTimezone =
        typeof exitInfo?.timezone === 'string' && exitInfo.timezone.trim()
            ? exitInfo.timezone.trim()
            : '';

    // 3. Manual timezone vs proxy exit timezone check
    const manualTz = typeof env?.timezone === 'string' ? env.timezone.trim() : '';
    if (manualTz && exitTimezone && manualTz !== exitTimezone) {
        const manualOffset = getTimeZoneOffsetMinutes(manualTz, now);
        const exitOffset = getTimeZoneOffsetMinutes(exitTimezone, now);
        const diffHours =
            manualOffset !== null && exitOffset !== null
                ? Math.abs(manualOffset - exitOffset) / 60
                : null;
        if (diffHours === null || diffHours >= 2) {
            const diffText =
                diffHours !== null
                    ? isEn
                        ? ` (~${diffHours.toFixed(1)}h difference)`
                        : `（时差约 ${diffHours.toFixed(1)} 小时）`
                    : '';
            issues.push({
                id: 'timezone-mismatch',
                severity: 'warning',
                title: isEn
                    ? 'Manual Timezone Mismatches Proxy Region'
                    : '手动时区与代理出口地区不一致',
                detail: isEn
                    ? `Manual timezone is ${manualTz}, while proxy exit${exitCountry ? ` (${exitCountry})` : ''} uses ${exitTimezone}${diffText}. Clearing manual timezone for auto-alignment is recommended.`
                    : `当前手动时区为 ${manualTz}，而代理出口${exitCountry ? ` (${exitCountry})` : ''} 归属时区为 ${exitTimezone}${diffText}。建议清空手动时区以自动对齐。`,
                autoFixPatch: { timezone: '' },
            });
            suggestedPatch.timezone = '';
        }
    }

    // 4. Manual language vs proxy exit country check
    const manualLang = typeof env?.language === 'string' ? env.language.trim() : '';
    if (manualLang && manualLang.toLowerCase() !== 'auto' && exitCountry) {
        const lowerLang = manualLang.toLowerCase();
        const expectedLocale = resolveLocaleForCountry(exitCountry, 'en-US');
        const expectedBase = expectedLocale.split('-')[0].toLowerCase();
        const manualBase = lowerLang.split(/[-_]/)[0];

        const isChineseMismatch =
            manualBase === 'zh' && !ZH_FRIENDLY_COUNTRIES.has(exitCountry);
        const isNonEnglishMismatch =
            manualBase !== 'en' &&
            manualBase !== 'zh' &&
            manualBase !== expectedBase;

        if (isChineseMismatch || isNonEnglishMismatch) {
            issues.push({
                id: 'language-mismatch',
                severity: 'warning',
                title: isEn
                    ? 'Manual Language Conflicts with Proxy Country'
                    : '手动语言与代理出口国家存在冲突',
                detail: isEn
                    ? `Manual language is ${manualLang}, while proxy exit is in ${exitCountry} (recommended: ${expectedLocale}). Setting language to auto is recommended.`
                    : `当前手动语言为 ${manualLang}，而代理出口位于 ${exitCountry}（推荐语言 ${expectedLocale}）。建议改为 auto 自动跟随代理地区。`,
                autoFixPatch: { language: 'auto' },
            });
            suggestedPatch.language = 'auto';
        }
    }

    const hasError = issues.some((item) => item.severity === 'error');
    const canAutoAlign =
        !hasError && Object.keys(suggestedPatch).length > 0;

    return {
        ok: issues.length === 0,
        hasError,
        canAutoAlign,
        issues,
        suggestedPatch:
            Object.keys(suggestedPatch).length > 0 ? suggestedPatch : undefined,
        exitSummary: exitInfo
            ? {
                  ip: exitInfo.ip,
                  countryCode: exitCountry || undefined,
                  timezone: exitTimezone || undefined,
                  latitude: exitInfo.latitude,
                  longitude: exitInfo.longitude,
              }
            : undefined,
    };
}
