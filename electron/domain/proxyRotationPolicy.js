import net from 'node:net';

function isPrivateOrLoopbackIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return false;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

function isPrivateOrLoopbackIPv6(host) {
    const lower = host.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
        return true;
    }
    if (lower.startsWith('::ffff:')) {
        return isPrivateOrLoopbackIPv4(lower.slice('::ffff:'.length));
    }
    return false;
}

export function validateProxyRotationUrl(rawUrl) {
    if (rawUrl === undefined || rawUrl === null) return '';
    if (typeof rawUrl !== 'string') {
        throw new Error('代理换 IP 链接格式无效');
    }
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (trimmed.length > 1024) {
        throw new Error('代理换 IP 链接长度不能超过 1024 个字符');
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('代理换 IP 链接格式无效，请填写完整 http 或 https 地址');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('代理换 IP 链接仅支持 http 或 https 协议');
    }
    if (!parsed.hostname) {
        throw new Error('代理换 IP 链接缺少有效主机名');
    }

    const host = parsed.hostname.replace(/^\[([^\]]+)\]$/, '$1').toLowerCase();
    if (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.internal')
    ) {
        throw new Error('代理换 IP 链接禁止指向本机或内网域名');
    }

    const ipFamily = net.isIP(host);
    if (ipFamily === 4 && isPrivateOrLoopbackIPv4(host)) {
        throw new Error('代理换 IP 链接禁止指向本机或内网 IP 地址');
    }
    if (ipFamily === 6 && isPrivateOrLoopbackIPv6(host)) {
        throw new Error('代理换 IP 链接禁止指向本机或内网 IPv6 地址');
    }

    return parsed.toString();
}
