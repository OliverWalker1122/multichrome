// A single fixed local proxy, with no DIRECT fallback. Keep these restrictions
// for the whole browser session, including after a successful exit-IP probe.
export function buildManagedProxyArgs(localAddress) {
    let address;
    try {
        address = new URL(localAddress);
    } catch {
        throw new Error('内置代理入口无效');
    }
    if (
        address.protocol !== 'http:' ||
        address.hostname !== '127.0.0.1' ||
        !address.port ||
        address.username ||
        address.password ||
        address.pathname !== '/' ||
        address.search ||
        address.hash
    ) {
        throw new Error('内置代理入口无效');
    }
    return [
        `--proxy-server=${address.origin}`,
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ];
}

// Fail-closed Chrome arguments for manual or global proxy addresses so that
// QUIC, non-proxied WebRTC UDP, and local DNS resolution cannot leak real IP
// even if the proxy drops or CDP disconnects.
export function buildManualProxyArgs(proxyAddress) {
    if (typeof proxyAddress !== 'string' || !proxyAddress.trim()) {
        throw new Error('代理地址无效');
    }
    const raw = proxyAddress.trim();
    const normalized = raw.includes('://') ? raw : `http://${raw}`;
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error('代理地址无效');
    }

    const host = parsed.hostname.replace(/^\[([^\]]+)\]$/, '$1');
    const excludes = new Set(['127.0.0.1', 'localhost']);
    if (host && !/[\s,;]/.test(host)) {
        excludes.add(host);
    }
    const excludeRules = [...excludes].map((entry) => `EXCLUDE ${entry}`).join(', ');

    return [
        `--proxy-server=${raw}`,
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        `--host-resolver-rules=MAP * ~NOTFOUND, ${excludeRules}`,
    ];
}

// Enforce kernel-level WebRTC leak prevention inside Chrome's Preferences file
// as a second layer of defense alongside command-line flags.
export function applyFailClosedWebRTCPreferences(prefs) {
    const next = prefs && typeof prefs === 'object' ? prefs : {};
    if (!next.webrtc || typeof next.webrtc !== 'object') {
        next.webrtc = {};
    }
    next.webrtc.ip_handling_policy = 'disable_non_proxied_udp';
    next.webrtc.multiple_routes_enabled = false;
    next.webrtc.nonproxied_udp_enabled = false;
    return next;
}
