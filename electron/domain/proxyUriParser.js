import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import {
    hasControls,
    hostValue,
    isObject,
    normalizeProxyConfig,
} from './singboxConfig.js';

export const ADVANCED_PROXY_SCHEMES = new Set([
    'vless',
    'vmess',
    'trojan',
    'ss',
    'hy2',
    'hysteria2',
    'tuic',
]);

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINE_LENGTH = 16384;
const MAX_NAME_LENGTH = 80;
const TUIC_CONGESTION_CONTROLS = new Set(['bbr', 'cubic', 'new_reno']);
const TUIC_UDP_MODES = new Set(['native', 'quic']);

function stripControls(value) {
    return [...value]
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
        .join('');
}

function hashIdentity(value) {
    return createHash('sha256')
        .update(String(value ?? ''))
        .digest('hex')
        .slice(0, 16);
}

function normalizeUuidForKey(value) {
    const trimmed = String(value ?? '').trim();
    return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function sanitizeSuggestedName(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        decoded = raw.replace(/%[0-9A-Fa-f]{2}/g, (sequence) => {
            try {
                return decodeURIComponent(sequence);
            } catch {
                return sequence;
            }
        });
    }
    return stripControls(decoded).trim().slice(0, MAX_NAME_LENGTH);
}

function decodeUriPart(raw, label = '代理凭据') {
    if (typeof raw !== 'string') return '';
    try {
        const decoded = decodeURIComponent(raw);
        if (hasControls(decoded)) throw new Error();
        return decoded;
    } catch {
        throw new Error(`${label}编码无效`);
    }
}

function decodeBase64Utf8(raw) {
    if (typeof raw !== 'string') throw new Error('代理配置 Base64 格式无效');
    const compact = raw.replace(/\s+/g, '');
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
        throw new Error('代理配置 Base64 格式无效');
    }
    const remainder = normalized.length % 4;
    if (remainder === 1) throw new Error('代理配置 Base64 格式无效');
    const padded =
        remainder === 0 ? normalized : normalized + '='.repeat(4 - remainder);
    const buffer = Buffer.from(padded, 'base64');
    if (buffer.length === 0) throw new Error('代理配置 Base64 内容为空');
    return buffer.toString('utf8');
}

function normalizePort(rawPort) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('代理端口必须为 1 到 65535 的整数');
    }
    return port;
}

function splitHostPort(serverPart) {
    const trimmed = String(serverPart || '').trim();
    if (!trimmed) throw new Error('代理服务器地址无效');
    if (trimmed.startsWith('[')) {
        const closeBracket = trimmed.indexOf(']');
        if (closeBracket < 2) throw new Error('代理服务器地址无效');
        const host = hostValue(trimmed.slice(1, closeBracket));
        const rest = trimmed.slice(closeBracket + 1);
        if (!rest.startsWith(':')) {
            throw new Error('代理端口必须为 1 到 65535 的整数');
        }
        const portText = rest.slice(1);
        if (!/^\d+$/.test(portText)) {
            throw new Error('代理端口必须为 1 到 65535 的整数');
        }
        return { host, port: normalizePort(Number(portText)) };
    }
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx <= 0) {
        throw new Error('代理端口必须为 1 到 65535 的整数');
    }
    const rawHost = trimmed.slice(0, colonIdx);
    const portText = trimmed.slice(colonIdx + 1);
    if (!/^\d+$/.test(portText)) {
        throw new Error('代理端口必须为 1 到 65535 的整数');
    }
    return { host: hostValue(rawHost), port: normalizePort(Number(portText)) };
}

function getParam(searchParams, ...names) {
    for (const name of names) {
        if (searchParams.has(name)) {
            return searchParams.get(name);
        }
    }
    const lowerMap = new Map();
    for (const [key, value] of searchParams.entries()) {
        const lower = key.toLowerCase();
        if (!lowerMap.has(lower)) lowerMap.set(lower, value);
    }
    for (const name of names) {
        const value = lowerMap.get(name.toLowerCase());
        if (value !== undefined) return value;
    }
    return null;
}

function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return false;
    const lower = value.trim().toLowerCase();
    return lower === '1' || lower === 'true' || lower === 'yes';
}

function parseAlpn(raw) {
    if (Array.isArray(raw)) {
        const list = raw
            .map((item) => String(item ?? '').trim())
            .filter(Boolean);
        for (const item of list) {
            if (hasControls(item)) throw new Error('ALPN 参数无效');
        }
        return list;
    }
    if (typeof raw !== 'string' || !raw.trim()) return [];
    const list = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    for (const item of list) {
        if (hasControls(item)) throw new Error('ALPN 参数无效');
    }
    return list;
}

function assertNoControls(value, message) {
    if (typeof value !== 'string' || hasControls(value)) {
        throw new Error(message);
    }
}

function buildTransport({ type, headerType, host, path, serviceName }) {
    const normalizedType = String(type || 'tcp')
        .trim()
        .toLowerCase();
    const normalizedHeader = String(headerType || '')
        .trim()
        .toLowerCase();

    if (
        !normalizedType ||
        normalizedType === 'tcp' ||
        normalizedType === 'raw' ||
        normalizedType === 'none'
    ) {
        if (normalizedHeader === 'http') {
            return buildHttpTransport(host, path);
        }
        return undefined;
    }

    if (normalizedType === 'ws') {
        const ws = { type: 'ws' };
        if (path) {
            assertNoControls(path, 'WebSocket path 参数无效');
            ws.path = path;
        }
        const hostHeader = String(host || '')
            .split(',')[0]
            .trim();
        if (hostHeader) {
            assertNoControls(hostHeader, 'WebSocket Host 参数无效');
            ws.headers = { Host: hostHeader };
        }
        return ws;
    }

    if (normalizedType === 'grpc') {
        const grpc = { type: 'grpc' };
        const svc = String(serviceName || path || '').trim();
        if (svc) {
            assertNoControls(svc, 'gRPC serviceName 参数无效');
            grpc.service_name = svc;
        }
        return grpc;
    }

    if (normalizedType === 'http' || normalizedType === 'h2') {
        return buildHttpTransport(host, path);
    }

    if (normalizedType === 'httpupgrade') {
        const hu = { type: 'httpupgrade' };
        const hostHeader = String(host || '')
            .split(',')[0]
            .trim();
        if (hostHeader) {
            assertNoControls(hostHeader, 'HTTPUpgrade Host 参数无效');
            hu.host = hostHeader;
        }
        if (path) {
            assertNoControls(path, 'HTTPUpgrade path 参数无效');
            hu.path = path;
        }
        return hu;
    }

    throw new Error('当前 sing-box 核心不支持此传输协议类型');
}

function buildHttpTransport(host, path) {
    const http = { type: 'http' };
    const hosts = String(host || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    for (const item of hosts) {
        assertNoControls(item, 'HTTP 传输 Host 参数无效');
    }
    if (hosts.length > 0) http.host = hosts;
    if (path) {
        assertNoControls(path, 'HTTP 传输 path 参数无效');
        http.path = path;
    }
    return http;
}

function parseStandardUri(trimmed, schemeLabel) {
    let url;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error(`${schemeLabel} 链接格式无效`);
    }
    if (url.pathname && url.pathname !== '/') {
        throw new Error(`${schemeLabel} 链接路径格式无效`);
    }
    if (!url.hostname) {
        throw new Error('代理服务器地址无效');
    }
    return url;
}

function extractRawFragment(trimmed) {
    const hashIdx = trimmed.indexOf('#');
    if (hashIdx < 0) return { body: trimmed, suggestedName: '' };
    return {
        body: trimmed.slice(0, hashIdx),
        suggestedName: sanitizeSuggestedName(trimmed.slice(hashIdx + 1)),
    };
}

function parseVlessUri(trimmed) {
    const { suggestedName } = extractRawFragment(trimmed);
    const url = parseStandardUri(trimmed, 'VLESS');
    if (url.password) {
        throw new Error('VLESS 链接认证格式无效');
    }
    const uuid = decodeUriPart(url.username, 'VLESS UUID').trim();
    if (!uuid) {
        throw new Error('VLESS 链接缺少有效的 UUID');
    }
    const host = hostValue(url.hostname);
    if (!url.port || !/^\d+$/.test(url.port)) {
        throw new Error('代理端口必须为 1 到 65535 的整数');
    }
    const port = normalizePort(Number(url.port));
    const sp = url.searchParams;

    const pbk = (
        getParam(sp, 'pbk', 'publicKey', 'public_key') || ''
    ).trim();
    const sid = (getParam(sp, 'sid', 'shortId', 'short_id') || '').trim();
    assertNoControls(pbk, 'VLESS Reality 公钥格式无效');
    assertNoControls(sid, 'VLESS Reality Short ID 格式无效');

    const rawSecurity = getParam(sp, 'security');
    const security = rawSecurity
        ? rawSecurity.trim().toLowerCase()
        : pbk
          ? 'reality'
          : 'none';
    if (!['none', 'tls', 'reality'].includes(security)) {
        throw new Error('VLESS 链接不支持此 security 类型');
    }

    const sni = (
        getParam(sp, 'sni', 'serverName', 'servername') || ''
    ).trim();
    assertNoControls(sni, 'TLS SNI 参数无效');
    const fp = (getParam(sp, 'fp', 'fingerprint') || '').trim();
    assertNoControls(fp, 'uTLS fingerprint 参数无效');
    const alpn = parseAlpn(getParam(sp, 'alpn'));
    const insecure = isTruthyFlag(
        getParam(sp, 'allowInsecure', 'allow_insecure', 'insecure'),
    );
    const flow = (getParam(sp, 'flow') || '').trim();
    assertNoControls(flow, 'VLESS flow 参数无效');
    const packetEncoding = (
        getParam(sp, 'packetEncoding', 'packet_encoding') || ''
    ).trim();
    assertNoControls(packetEncoding, 'VLESS packet_encoding 参数无效');

    let tls;
    if (security === 'reality') {
        if (!pbk) {
            throw new Error('VLESS Reality 链接缺少公钥 (pbk)');
        }
        const serverName = sni || (!isIP(host) ? host : '');
        const utlsFingerprint = fp && fp.toLowerCase() !== 'none' ? fp : 'chrome';
        tls = {
            enabled: true,
            ...(serverName ? { server_name: serverName } : {}),
            ...(alpn.length > 0 ? { alpn } : {}),
            ...(insecure ? { insecure: true } : {}),
            utls: { enabled: true, fingerprint: utlsFingerprint },
            reality: {
                enabled: true,
                public_key: pbk,
                ...(sid ? { short_id: sid } : {}),
            },
        };
    } else if (security === 'tls') {
        const serverName = sni || (!isIP(host) ? host : '');
        tls = {
            enabled: true,
            ...(serverName ? { server_name: serverName } : {}),
            ...(alpn.length > 0 ? { alpn } : {}),
            ...(insecure ? { insecure: true } : {}),
            ...(fp && fp.toLowerCase() !== 'none'
                ? { utls: { enabled: true, fingerprint: fp } }
                : {}),
        };
    }

    const transport = buildTransport({
        type: getParam(sp, 'type', 'net') || 'tcp',
        headerType: getParam(sp, 'headerType', 'headertype') || '',
        host: getParam(sp, 'host') || '',
        path: getParam(sp, 'path') || '',
        serviceName: getParam(sp, 'serviceName', 'servicename') || '',
    });

    const outbound = {
        type: 'vless',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid,
        ...(flow && flow.toLowerCase() !== 'none' ? { flow } : {}),
        ...(packetEncoding ? { packet_encoding: packetEncoding } : {}),
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
    };

    return { outbound, suggestedName, rawIdentity: normalizeUuidForKey(uuid) };
}

function parseVmessUri(trimmed) {
    const { body, suggestedName: fragmentName } = extractRawFragment(trimmed);
    const encoded = body.slice('vmess://'.length).trim();
    if (!encoded) {
        throw new Error('VMess 链接内容为空');
    }
    let payload;
    try {
        const decodedText = decodeBase64Utf8(encoded);
        payload = JSON.parse(decodedText);
    } catch {
        throw new Error('VMess 链接格式无效，请检查 Base64 JSON 内容');
    }
    if (!isObject(payload)) {
        throw new Error('VMess 链接内容必须为 JSON 对象');
    }

    const host = hostValue(String(payload.add ?? ''));
    const port = normalizePort(Number(payload.port));
    const uuid = String(payload.id ?? '').trim();
    if (!uuid || hasControls(uuid)) {
        throw new Error('VMess 链接缺少有效的 UUID');
    }

    let alterId = 0;
    if (
        payload.aid !== undefined &&
        payload.aid !== null &&
        payload.aid !== ''
    ) {
        const parsedAid = Number(payload.aid);
        if (!Number.isInteger(parsedAid) || parsedAid < 0 || parsedAid > 65535) {
            throw new Error('VMess alterId (aid) 参数无效');
        }
        alterId = parsedAid;
    }

    const security = String(payload.scy || payload.security || 'auto').trim();
    assertNoControls(security, 'VMess 加密方式 (scy) 参数无效');

    const net = String(payload.net || 'tcp')
        .trim()
        .toLowerCase();
    const headerType = String(payload.type || '').trim();
    const transportHost = String(payload.host || '').trim();
    const path = String(payload.path || '');
    const serviceName =
        net === 'grpc'
            ? String(payload.serviceName || path || '').trim()
            : '';
    const transport = buildTransport({
        type: net,
        headerType,
        host: transportHost,
        path,
        serviceName,
    });

    const tlsRaw = String(payload.tls ?? '')
        .trim()
        .toLowerCase();
    const tlsEnabled =
        tlsRaw === 'tls' || tlsRaw === '1' || tlsRaw === 'true';

    let tls;
    if (tlsEnabled) {
        const sni = String(payload.sni ?? '').trim();
        assertNoControls(sni, 'VMess TLS SNI 参数无效');
        const fp = String(payload.fp ?? '').trim();
        assertNoControls(fp, 'VMess uTLS fingerprint 参数无效');
        const alpn = parseAlpn(payload.alpn);
        const insecure = isTruthyFlag(
            payload.allowInsecure ?? payload.insecure,
        );
        const singleTransportHost =
            transportHost && !transportHost.includes(',') && !isIP(transportHost)
                ? transportHost
                : '';
        const serverName =
            sni || singleTransportHost || (!isIP(host) ? host : '');
        tls = {
            enabled: true,
            ...(serverName ? { server_name: serverName } : {}),
            ...(alpn.length > 0 ? { alpn } : {}),
            ...(insecure ? { insecure: true } : {}),
            ...(fp && fp.toLowerCase() !== 'none'
                ? { utls: { enabled: true, fingerprint: fp } }
                : {}),
        };
    }

    const psName =
        typeof payload.ps === 'string'
            ? stripControls(payload.ps).trim().slice(0, MAX_NAME_LENGTH)
            : '';

    const outbound = {
        type: 'vmess',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid,
        security,
        alter_id: alterId,
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
    };

    return {
        outbound,
        suggestedName: fragmentName || psName,
        rawIdentity: normalizeUuidForKey(uuid),
    };
}

function parseTrojanUri(trimmed) {
    const { suggestedName } = extractRawFragment(trimmed);
    const url = parseStandardUri(trimmed, 'Trojan');
    const password = url.password
        ? `${decodeUriPart(url.username, 'Trojan 密码')}:${decodeUriPart(url.password, 'Trojan 密码')}`
        : decodeUriPart(url.username, 'Trojan 密码');
    if (!password) {
        throw new Error('Trojan 链接缺少密码');
    }
    const host = hostValue(url.hostname);
    if (!url.port || !/^\d+$/.test(url.port)) {
        throw new Error('代理端口必须为 1 到 65535 的整数');
    }
    const port = normalizePort(Number(url.port));
    const sp = url.searchParams;

    const security = (getParam(sp, 'security') || 'tls').trim().toLowerCase();
    if (security !== 'tls' && security !== 'none') {
        throw new Error('Trojan 链接不支持此 security 类型');
    }

    let tls;
    if (security !== 'none') {
        const sni = (
            getParam(sp, 'sni', 'peer', 'serverName', 'servername') || ''
        ).trim();
        assertNoControls(sni, 'Trojan TLS SNI 参数无效');
        const fp = (getParam(sp, 'fp', 'fingerprint') || '').trim();
        assertNoControls(fp, 'Trojan uTLS fingerprint 参数无效');
        const alpn = parseAlpn(getParam(sp, 'alpn'));
        const insecure = isTruthyFlag(
            getParam(sp, 'allowInsecure', 'allow_insecure', 'insecure'),
        );
        const serverName = sni || (!isIP(host) ? host : '');
        tls = {
            enabled: true,
            ...(serverName ? { server_name: serverName } : {}),
            ...(alpn.length > 0 ? { alpn } : {}),
            ...(insecure ? { insecure: true } : {}),
            ...(fp && fp.toLowerCase() !== 'none'
                ? { utls: { enabled: true, fingerprint: fp } }
                : {}),
        };
    }

    const transport = buildTransport({
        type: getParam(sp, 'type', 'net') || 'tcp',
        headerType: getParam(sp, 'headerType', 'headertype') || '',
        host: getParam(sp, 'host') || '',
        path: getParam(sp, 'path') || '',
        serviceName: getParam(sp, 'serviceName', 'servicename') || '',
    });

    const outbound = {
        type: 'trojan',
        tag: 'proxy',
        server: host,
        server_port: port,
        password,
        ...(tls ? { tls } : {}),
        ...(transport ? { transport } : {}),
    };

    return { outbound, suggestedName, rawIdentity: password };
}

function parseShadowsocksUri(trimmed) {
    const { body, suggestedName } = extractRawFragment(trimmed);
    const rest = body.slice('ss://'.length);
    if (!rest) {
        throw new Error('Shadowsocks 链接内容为空');
    }

    const queryIdx = rest.indexOf('?');
    const authorityPart = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest;
    const queryString = queryIdx >= 0 ? rest.slice(queryIdx + 1) : '';
    const sp = new URLSearchParams(queryString);

    let method = '';
    let password = '';
    let host = '';
    let port = 0;

    const atIdx = authorityPart.lastIndexOf('@');
    if (atIdx >= 0) {
        const authRaw = authorityPart.slice(0, atIdx);
        const serverRaw = authorityPart.slice(atIdx + 1).replace(/\/+$/, '');
        if (!authRaw || !serverRaw) {
            throw new Error('Shadowsocks 链接格式无效');
        }
        ({ host, port } = splitHostPort(serverRaw));
        const maybeDecodedAuth = authRaw.includes('%')
            ? decodeUriPart(authRaw, 'Shadowsocks 认证信息')
            : authRaw;
        if (authRaw.includes(':')) {
            const colonIdx = authRaw.indexOf(':');
            method = decodeUriPart(
                authRaw.slice(0, colonIdx),
                'Shadowsocks 加密方式',
            );
            password = decodeUriPart(
                authRaw.slice(colonIdx + 1),
                'Shadowsocks 密码',
            );
        } else if (maybeDecodedAuth.includes(':')) {
            const colonIdx = maybeDecodedAuth.indexOf(':');
            method = maybeDecodedAuth.slice(0, colonIdx);
            password = maybeDecodedAuth.slice(colonIdx + 1);
        } else {
            const decodedAuth = decodeBase64Utf8(maybeDecodedAuth);
            const colonIdx = decodedAuth.indexOf(':');
            if (colonIdx <= 0) {
                throw new Error('Shadowsocks 认证格式无效');
            }
            method = decodedAuth.slice(0, colonIdx);
            password = decodedAuth.slice(colonIdx + 1);
        }
    } else {
        const cleanBody = authorityPart.replace(/\/+$/, '');
        const decoded = decodeBase64Utf8(cleanBody);
        const decodedAt = decoded.lastIndexOf('@');
        if (decodedAt <= 0) {
            throw new Error('Shadowsocks 链接格式无效');
        }
        const authPart = decoded.slice(0, decodedAt);
        const serverPart = decoded.slice(decodedAt + 1);
        const colonIdx = authPart.indexOf(':');
        if (colonIdx <= 0) {
            throw new Error('Shadowsocks 认证格式无效');
        }
        method = authPart.slice(0, colonIdx);
        password = authPart.slice(colonIdx + 1);
        ({ host, port } = splitHostPort(serverPart));
    }

    method = method.trim();
    if (!method || hasControls(method)) {
        throw new Error('Shadowsocks 加密方式无效');
    }
    assertNoControls(password, 'Shadowsocks 密码格式无效');

    const rawPlugin = (getParam(sp, 'plugin') || '').trim();
    assertNoControls(rawPlugin, 'Shadowsocks plugin 参数无效');
    let plugin = '';
    let pluginOpts = '';
    if (rawPlugin) {
        const semiIdx = rawPlugin.indexOf(';');
        if (semiIdx >= 0) {
            plugin = rawPlugin.slice(0, semiIdx).trim();
            pluginOpts = rawPlugin.slice(semiIdx + 1).trim();
        } else {
            plugin = rawPlugin;
        }
        if (!plugin) {
            throw new Error('Shadowsocks plugin 名称无效');
        }
    }

    const outbound = {
        type: 'shadowsocks',
        tag: 'proxy',
        server: host,
        server_port: port,
        method,
        password,
        ...(plugin ? { plugin } : {}),
        ...(pluginOpts ? { plugin_opts: pluginOpts } : {}),
    };

    return {
        outbound,
        suggestedName,
        rawIdentity: `${method.toLowerCase()}:${password}`,
    };
}

function parseHysteria2Uri(trimmed) {
    const { suggestedName } = extractRawFragment(trimmed);
    const url = parseStandardUri(trimmed, 'Hysteria2');
    const password = url.password
        ? `${decodeUriPart(url.username, 'Hysteria2 密码')}:${decodeUriPart(url.password, 'Hysteria2 密码')}`
        : decodeUriPart(url.username, 'Hysteria2 密码');
    if (!password) {
        throw new Error('Hysteria2 链接缺少密码');
    }
    const host = hostValue(url.hostname);
    const port = url.port
        ? /^\d+$/.test(url.port)
            ? normalizePort(Number(url.port))
            : (() => {
                  throw new Error('代理端口必须为 1 到 65535 的整数');
              })()
        : 443;
    const sp = url.searchParams;

    const sni = (
        getParam(sp, 'sni', 'peer', 'serverName', 'servername') || ''
    ).trim();
    assertNoControls(sni, 'Hysteria2 TLS SNI 参数无效');
    const alpn = parseAlpn(getParam(sp, 'alpn'));
    const insecure = isTruthyFlag(
        getParam(sp, 'insecure', 'allowInsecure', 'allow_insecure'),
    );
    const serverName = sni || (!isIP(host) ? host : '');

    const obfs = (getParam(sp, 'obfs') || '').trim().toLowerCase();
    const obfsPassword =
        getParam(sp, 'obfs-password', 'obfs_password', 'obfsPassword') || '';
    let obfsConfig;
    if (obfs && obfs !== 'none') {
        if (obfs !== 'salamander') {
            throw new Error('Hysteria2 仅支持 salamander 混淆方式');
        }
        if (!obfsPassword || hasControls(obfsPassword)) {
            throw new Error('Hysteria2 salamander 混淆缺少有效的 obfs-password');
        }
        obfsConfig = { type: 'salamander', password: obfsPassword };
    }

    const outbound = {
        type: 'hysteria2',
        tag: 'proxy',
        server: host,
        server_port: port,
        password,
        ...(obfsConfig ? { obfs: obfsConfig } : {}),
        tls: {
            enabled: true,
            ...(serverName ? { server_name: serverName } : {}),
            ...(alpn.length > 0 ? { alpn } : {}),
            ...(insecure ? { insecure: true } : {}),
        },
    };

    return { outbound, suggestedName, rawIdentity: password };
}

function parseTuicUri(trimmed) {
    const { suggestedName } = extractRawFragment(trimmed);
    const url = parseStandardUri(trimmed, 'TUIC');
    const uuid = decodeUriPart(url.username, 'TUIC UUID').trim();
    if (!UUID_PATTERN.test(uuid)) {
        throw new Error('TUIC 链接缺少有效的 UUID');
    }
    const password = decodeUriPart(url.password || '', 'TUIC 密码');
    const host = hostValue(url.hostname);
    if (!url.port || !/^\d+$/.test(url.port)) {
        throw new Error('代理端口必须为 1 到 65535 的整数');
    }
    const port = normalizePort(Number(url.port));
    const sp = url.searchParams;

    const sni = (
        getParam(sp, 'sni', 'serverName', 'servername') || ''
    ).trim();
    assertNoControls(sni, 'TUIC TLS SNI 参数无效');
    const parsedAlpn = parseAlpn(getParam(sp, 'alpn'));
    const alpn = parsedAlpn.length > 0 ? parsedAlpn : ['h3'];
    const insecure = isTruthyFlag(
        getParam(sp, 'allow_insecure', 'allowInsecure', 'insecure'),
    );
    const congestionControl = (
        getParam(sp, 'congestion_control', 'congestion-control', 'congestionControl') ||
        'bbr'
    )
        .trim()
        .toLowerCase();
    if (!TUIC_CONGESTION_CONTROLS.has(congestionControl)) {
        throw new Error('TUIC congestion_control 参数无效');
    }
    const udpRelayMode = (
        getParam(sp, 'udp_relay_mode', 'udp-relay-mode', 'udpRelayMode') ||
        'native'
    )
        .trim()
        .toLowerCase();
    if (!TUIC_UDP_MODES.has(udpRelayMode)) {
        throw new Error('TUIC udp_relay_mode 参数无效');
    }
    const zeroRtt = isTruthyFlag(
        getParam(sp, 'reduce_rtt', 'zero_rtt_handshake', 'zeroRtt'),
    );
    const serverName = sni || (!isIP(host) ? host : '');

    const outbound = {
        type: 'tuic',
        tag: 'proxy',
        server: host,
        server_port: port,
        uuid,
        ...(password ? { password } : {}),
        congestion_control: congestionControl,
        udp_relay_mode: udpRelayMode,
        ...(zeroRtt ? { zero_rtt_handshake: true } : {}),
        tls: {
            enabled: true,
            ...(serverName ? { server_name: serverName } : {}),
            alpn,
            ...(insecure ? { insecure: true } : {}),
        },
    };

    return {
        outbound,
        suggestedName,
        rawIdentity: `${normalizeUuidForKey(uuid)}:${password}`,
    };
}

export function isAdvancedProxyUri(line) {
    if (typeof line !== 'string') return false;
    const trimmed = line.trim();
    const match = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    return Boolean(match && ADVANCED_PROXY_SCHEMES.has(match[1].toLowerCase()));
}

function stripQueryAndFragment(value) {
    const hashIdx = value.indexOf('#');
    const withoutFragment = hashIdx >= 0 ? value.slice(0, hashIdx) : value;
    const queryIdx = withoutFragment.indexOf('?');
    return queryIdx >= 0
        ? withoutFragment.slice(0, queryIdx)
        : withoutFragment;
}

export function redactProxyUri(line) {
    if (typeof line !== 'string') return '';
    const trimmed = line.trim();
    if (!trimmed) return '';
    const match = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!match) {
        const withoutQuery = stripQueryAndFragment(trimmed);
        const atIdx = withoutQuery.lastIndexOf('@');
        if (atIdx >= 0) {
            const hostPart = withoutQuery.slice(atIdx + 1).replace(/\/+$/, '');
            return hostPart ? `***@${hostPart}` : '[已隐藏]';
        }
        if (trimmed.startsWith('[')) {
            const ipv6Match = trimmed.match(/^(\[[^\]]+\]:\d+):.+$/);
            return ipv6Match ? `${ipv6Match[1]}:[已隐藏]` : trimmed;
        }
        if (isIP(trimmed) !== 6) {
            const parts = trimmed.split(':');
            if (parts.length >= 3) {
                return `${parts[0]}:${parts[1]}:[已隐藏]`;
            }
        }
        return trimmed;
    }
    const scheme = match[1].toLowerCase();
    if (scheme === 'vmess') {
        return 'vmess://[已隐藏]';
    }
    const withoutQuery = stripQueryAndFragment(trimmed);
    const atIdx = withoutQuery.lastIndexOf('@');
    if (atIdx >= 0) {
        const hostPart = withoutQuery.slice(atIdx + 1).replace(/\/+$/, '');
        return hostPart ? `${scheme}://***@${hostPart}` : `${scheme}://[已隐藏]`;
    }
    if (scheme === 'ss') {
        return 'ss://[已隐藏]';
    }
    return `${scheme}://[已隐藏]`;
}

export function buildOutboundEndpointKey(outbound) {
    if (!isObject(outbound)) return '';
    const type = String(outbound.type || '')
        .trim()
        .toLowerCase();
    const host = String(outbound.server || '')
        .trim()
        .replace(/^\[([^\]]+)\]$/, '$1')
        .toLowerCase();
    const port = Number(outbound.server_port) || 0;
    if (!type || !host || !port) return '';

    if (type === 'http') {
        const protocol = outbound.tls?.enabled ? 'https' : 'http';
        return `${protocol}://${String(outbound.username || '')}@${host}:${port}`;
    }
    if (type === 'socks') {
        return `socks5://${String(outbound.username || '')}@${host}:${port}`;
    }
    if (type === 'vless' || type === 'vmess') {
        const identity = hashIdentity(normalizeUuidForKey(outbound.uuid));
        return `${type}://${identity}@${host}:${port}`;
    }
    if (type === 'tuic') {
        const identity = hashIdentity(
            `${normalizeUuidForKey(outbound.uuid)}:${String(outbound.password || '')}`,
        );
        return `tuic://${identity}@${host}:${port}`;
    }
    if (type === 'trojan' || type === 'hysteria2') {
        const identity = hashIdentity(String(outbound.password || ''));
        return `${type}://${identity}@${host}:${port}`;
    }
    if (type === 'shadowsocks') {
        const identity = hashIdentity(
            `${String(outbound.method || '').toLowerCase()}:${String(outbound.password || '')}`,
        );
        return `shadowsocks://${identity}@${host}:${port}`;
    }
    return `${type}://@${host}:${port}`;
}

export function parseProxyUriToOutbound(line) {
    if (
        typeof line !== 'string' ||
        !line.trim() ||
        line.length > MAX_LINE_LENGTH ||
        hasControls(line.trim())
    ) {
        throw new Error('请粘贴一行有效代理链接');
    }
    const trimmed = line.trim();
    const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!schemeMatch) {
        throw new Error('代理链接格式无效');
    }
    const scheme = schemeMatch[1].toLowerCase();
    if (!ADVANCED_PROXY_SCHEMES.has(scheme)) {
        throw new Error('不支持的代理链接协议');
    }

    let parsed;
    if (scheme === 'vless') parsed = parseVlessUri(trimmed);
    else if (scheme === 'vmess') parsed = parseVmessUri(trimmed);
    else if (scheme === 'trojan') parsed = parseTrojanUri(trimmed);
    else if (scheme === 'ss') parsed = parseShadowsocksUri(trimmed);
    else if (scheme === 'hy2' || scheme === 'hysteria2')
        parsed = parseHysteria2Uri(trimmed);
    else if (scheme === 'tuic') parsed = parseTuicUri(trimmed);

    if (!parsed || parsed.outbound.type === 'direct') {
        throw new Error('内置代理不允许 direct 出口，避免代理故障时直连');
    }

    const config = normalizeProxyConfig(parsed.outbound);
    const outbound = config.outbounds[0];
    const protocol = outbound.type;
    const host = outbound.server;
    const port = outbound.server_port;
    const identity = hashIdentity(parsed.rawIdentity);
    const endpointKey = `${protocol}://${identity}@${host.toLowerCase()}:${port}`;

    return {
        outbound,
        config,
        protocol,
        host,
        port,
        identity,
        suggestedName: parsed.suggestedName,
        endpointKey,
    };
}
