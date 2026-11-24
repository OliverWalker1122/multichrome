import { resolveEffectiveLanguage } from './proxyGeo.js';
import { evaluateLaunchConsistency } from './launchGuard.js';

/**
 * Evaluate full anti-leak & fingerprint health report for an environment.
 * @param {{
 *   env: any,
 *   proxy?: any,
 *   proxyAddress?: string,
 *   exitInfo?: any,
 *   fpDefaults?: any,
 *   hasFingerprintKernel?: boolean,
 *   prefsSnapshot?: any,
 *   locale?: string,
 * }} params
 */
export function evaluateEnvironmentHealth({
    env,
    proxy = null,
    proxyAddress = '',
    exitInfo = null,
    fpDefaults = {},
    hasFingerprintKernel = false,
    prefsSnapshot = null,
    locale = 'zh-CN',
}) {
    const isEn = locale === 'en-US';
    const items = [];
    const consistency = evaluateLaunchConsistency({
        env,
        proxy,
        exitInfo,
        hasFingerprintKernel,
        locale,
    });
    const issueById = new Map(consistency.issues.map((i) => [i.id, i]));

    // 1. Proxy & Exit IP
    const proxyMode = env?.proxyId
        ? 'managed'
        : env?.proxy?.trim()
          ? 'manual'
          : proxyAddress
            ? 'global'
            : 'direct';

    const proxyLabel = isEn ? 'Proxy & Exit IP' : '代理与出口 IP';
    if (proxyMode === 'managed') {
        if (!proxy) {
            items.push({
                id: 'proxy',
                label: proxyLabel,
                status: 'fail',
                value: isEn ? 'Proxy Missing' : '代理已缺失',
                detail: isEn
                    ? 'The bound built-in proxy does not exist; Fail-Closed will block launch.'
                    : '绑定的内置代理不存在，Fail-Closed 策略将阻断启动。',
            });
        } else if (proxy.status === 'error') {
            items.push({
                id: 'proxy',
                label: proxyLabel,
                status: 'fail',
                value: isEn ? `${proxy.name} (Error)` : `${proxy.name}（异常）`,
                detail:
                    proxy.lastError ||
                    (isEn
                        ? 'Built-in proxy service error. Please inspect proxy logs.'
                        : '内置代理服务异常，请查看代理日志。'),
            });
        } else if (exitInfo?.ip) {
            items.push({
                id: 'proxy',
                label: proxyLabel,
                status: 'pass',
                value: `${exitInfo.ip}${exitInfo.countryCode ? ` (${exitInfo.countryCode})` : ''}`,
                detail: isEn
                    ? `Built-in sing-box proxy "${proxy.name}" is running normally; all traffic routes through the local loopback tunnel.`
                    : `内置 sing-box 代理「${proxy.name}」运行正常，全流量经本地回环隧道转发。`,
            });
        } else {
            items.push({
                id: 'proxy',
                label: proxyLabel,
                status: 'warn',
                value: isEn
                    ? `${proxy.name} (${proxy.status === 'running' ? 'Exit Unprobed' : 'Stopped'})`
                    : `${proxy.name}（${proxy.status === 'running' ? '出口未探测' : '未启动'}）`,
                detail:
                    proxy.status === 'running'
                        ? isEn
                            ? 'Local proxy is running, but external GeoIP probe did not respond yet.'
                            : '本地代理已启动，但暂未获取到外部 GeoIP 出口响应。'
                        : isEn
                          ? 'Built-in proxy is not started yet; exit IP will be probed once started.'
                          : '内置代理尚未启动；启动环境或启动代理后将自动探测出口 IP。',
            });
        }
    } else if (proxyMode === 'manual' || proxyMode === 'global') {
        if (exitInfo?.ip) {
            items.push({
                id: 'proxy',
                label: proxyLabel,
                status: 'pass',
                value: `${exitInfo.ip}${exitInfo.countryCode ? ` (${exitInfo.countryCode})` : ''}`,
                detail: isEn
                    ? `${proxyMode === 'manual' ? 'Manual proxy' : 'Global default proxy'} is reachable with Fail-Closed flags enabled.`
                    : `${proxyMode === 'manual' ? '手动代理' : '全局默认代理'}连通正常，已启用 Fail-Closed 参数。`,
            });
        } else {
            items.push({
                id: 'proxy',
                label: proxyLabel,
                status: 'warn',
                value: isEn
                    ? proxyMode === 'manual'
                        ? 'Manual Proxy (Pending)'
                        : 'Global Proxy (Pending)'
                    : proxyMode === 'manual'
                      ? '手动代理（待探测）'
                      : '全局代理（待探测）',
                detail: isEn
                    ? 'Could not probe exit IP through proxy yet. Ensure the proxy server is running and reachable.'
                    : '暂未通过代理探测到出口 IP，请确认代理服务已运行并可连通外网。',
            });
        }
    } else {
        items.push({
            id: 'proxy',
            label: proxyLabel,
            status: 'warn',
            value: isEn ? 'Direct Connection' : '直连本机网络',
            detail: isEn
                ? 'No proxy configured for this environment; target sites will see your real local IP.'
                : '当前环境未配置代理，访问目标站点将暴露本机真实公网 IP。',
        });
    }

    // 2. Timezone & Geolocation
    const geoLabel = isEn ? 'Timezone & Geolocation' : '时区与 Geolocation';
    const manualTz = env?.timezone?.trim() || '';
    const effectiveTimezone =
        manualTz ||
        (fpDefaults?.autoMatchTimezone !== false ? exitInfo?.timezone : '') ||
        '';
    const hasCoords =
        typeof exitInfo?.latitude === 'number' &&
        typeof exitInfo?.longitude === 'number';
    const tzIssue = issueById.get('timezone-mismatch');

    if (tzIssue) {
        items.push({
            id: 'geo',
            label: geoLabel,
            status: 'warn',
            value: `${manualTz} ≠ ${exitInfo?.timezone || (isEn ? 'Unknown' : '未知')}`,
            detail: tzIssue.detail,
        });
    } else if (effectiveTimezone) {
        const geoEnabled = Boolean(fpDefaults?.autoMatchGeolocation);
        items.push({
            id: 'geo',
            label: geoLabel,
            status: 'pass',
            value: `${effectiveTimezone}${hasCoords ? ` · GPS ${exitInfo.latitude.toFixed(2)}, ${exitInfo.longitude.toFixed(2)}` : ''}`,
            detail: manualTz
                ? isEn
                    ? 'Using manually configured timezone, consistent with current proxy region.'
                    : '使用手动配置时区，与当前代理地区一致。'
                : geoEnabled
                  ? isEn
                      ? 'Auto-aligned timezone and GPS coordinates from proxy exit IP (4D consistent).'
                      : '已开启按代理出口 IP 自动对齐时区与经纬度（四维一致）。'
                  : isEn
                    ? 'Timezone auto-aligned from proxy exit IP; GPS override is off by default (zero page-level CDP attachment for C++ kernel) and can be enabled in Settings → Privacy.'
                    : '已按代理出口 IP 自动对齐时区；GPS 经纬度覆盖默认关闭（保持 C++ 零页面 CDP 挂载），如需启用可在「设置 → 隐私」开启。',
        });
    } else {
        items.push({
            id: 'geo',
            label: geoLabel,
            status: proxyMode === 'direct' ? 'pass' : 'warn',
            value:
                proxyMode === 'direct'
                    ? isEn
                        ? 'System Timezone'
                        : '跟随系统'
                    : isEn
                      ? 'Auto-match on Launch'
                      : '启动时自动匹配',
            detail:
                proxyMode === 'direct'
                    ? isEn
                        ? 'Direct mode uses the host system timezone.'
                        : '直连模式使用本机系统时区。'
                    : isEn
                      ? 'IANA timezone and GPS coordinates will be probed via proxy upon launch.'
                      : '启动环境时将通过代理自动探测 IANA 时区与 GPS 坐标。',
        });
    }

    // 3. Language alignment
    const langLabel = isEn ? 'Language Strategy' : '语言策略';
    const effectiveLanguage = resolveEffectiveLanguage(env?.language, {
        autoMatchLanguage: Boolean(fpDefaults?.autoMatchLanguage),
        countryCode: exitInfo?.countryCode,
        defaultLanguage: fpDefaults?.defaultLanguage || 'en-US',
    });
    const langIssue = issueById.get('language-mismatch');
    if (langIssue) {
        items.push({
            id: 'language',
            label: langLabel,
            status: 'warn',
            value: effectiveLanguage,
            detail: langIssue.detail,
        });
    } else {
        items.push({
            id: 'language',
            label: langLabel,
            status: 'pass',
            value: effectiveLanguage,
            detail:
                env?.language?.trim().toLowerCase() === 'auto' ||
                (!env?.language?.trim() && fpDefaults?.autoMatchLanguage)
                    ? isEn
                        ? 'Automatically matches Accept-Language and navigator.language to proxy exit country.'
                        : '按代理出口地区自动匹配 Accept-Language 与 navigator.language。'
                    : isEn
                      ? 'Overrides HTTP Accept-Language, navigator.language, and Chrome Preferences to prevent host locale leakage.'
                      : '同步覆盖 HTTP Accept-Language、navigator.language 与 Chrome Preferences，避免暴露宿主机语言。',
        });
    }

    // 4. WebRTC & DNS Fail-Closed
    const webrtcLabel = isEn ? 'WebRTC & DNS Anti-Leak' : 'WebRTC & DNS 防泄露';
    const prefsWebRTC = prefsSnapshot?.webrtc?.ip_handling_policy;
    if (proxyMode === 'direct') {
        items.push({
            id: 'webrtc',
            label: webrtcLabel,
            status: 'warn',
            value: isEn ? 'Direct Mode (Unrestricted)' : '直连模式（未拦截）',
            detail: isEn
                ? 'disable_non_proxied_udp and QUIC and UDP blocking apply only when a proxy is bound.'
                : '仅在绑定代理时自动锁定 disable_non_proxied_udp 与阻断 QUIC 及 UDP 绕过。',
        });
    } else {
        const lockedInPrefs = prefsWebRTC === 'disable_non_proxied_udp';
        items.push({
            id: 'webrtc',
            label: webrtcLabel,
            status: 'pass',
            value: lockedInPrefs
                ? isEn
                    ? 'Fail-Closed Locked'
                    : 'Fail-Closed 已锁定'
                : isEn
                  ? 'Enforced on Launch'
                  : '启动时强制启用 Fail-Closed',
            detail: isEn
                ? 'Enforces --disable-quic + disable_non_proxied_udp + remote proxy DNS resolution to block local UDP & DNS leaks.'
                : '强制 --disable-quic + disable_non_proxied_udp + 代理端远程 DNS 解析，阻断本地 UDP 与 DNS 泄露。',
        });
    }

    // 5. Browser engine & C++ fingerprint status
    const engineLabel = isEn ? 'Kernel & Anti-Fingerprint' : '内核与抗指纹引擎';
    const engine = env?.browserEngine || 'system-chrome';
    if (engine === 'fingerprint-chromium') {
        if (!hasFingerprintKernel) {
            items.push({
                id: 'fingerprint',
                label: engineLabel,
                status: 'fail',
                value: isEn ? 'Kernel Missing' : '缺少指纹内核',
                detail: isEn
                    ? 'Install and activate fingerprint-chromium in "Settings → Components".'
                    : '请前往「设置 → 组件」安装并激活 fingerprint-chromium。',
            });
        } else {
            const fp = env?.fingerprintConfig;
            const enabledSpoofing = fp?.spoofing
                ? Object.values(fp.spoofing).filter(Boolean).length
                : 5;
            items.push({
                id: 'fingerprint',
                label: engineLabel,
                status: 'pass',
                value: isEn
                    ? `C++ Native Stealth · Seed #${fp?.seed || 'Auto'}`
                    : `C++ 纯原生隐匿 · Seed #${fp?.seed || '自动'}`,
                detail: isEn
                    ? `Zero extensions, zero JS hooks · ${fp?.brand || 'Chrome'} (${fp?.platform || 'host'}) · ${enabledSpoofing} of 5 C++ hardware noise modules active.`
                    : `零扩展、零 JS Hook · ${fp?.brand || 'Chrome'} (${fp?.platform || 'host'}) · 已启用 ${enabledSpoofing} 项 C++ 硬件噪声伪装。`,
            });
        }
    } else {
        items.push({
            id: 'fingerprint',
            label: engineLabel,
            status: 'pass',
            value: isEn ? 'Official Chrome (Isolated)' : '官方 Chrome（隔离模式）',
            detail: isEn
                ? 'Isolated User-Data-Dir + CDP timezone, language, and geolocation override for high-security accounts; switch to C++ Fingerprint Kernel for hardware-level anti-correlation.'
                : '独立 User-Data-Dir + CDP 时区、语言与地理位置覆盖，适合高安全主号；若需强硬件抗指纹可切换 C++ 指纹内核。',
        });
    }

    const overall = items.some((item) => item.status === 'fail')
        ? 'fail'
        : items.some((item) => item.status === 'warn')
          ? 'warn'
          : 'pass';

    return {
        overall,
        checkedAt: new Date().toISOString(),
        summary: {
            ip: exitInfo?.ip,
            countryCode: exitInfo?.countryCode,
            timezone: effectiveTimezone || undefined,
            language: effectiveLanguage,
            geolocation: hasCoords
                ? { latitude: exitInfo.latitude, longitude: exitInfo.longitude }
                : undefined,
            proxyMode,
            browserEngine: engine,
        },
        items,
    };
}
