import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const SIMPLE_PROTOCOLS = new Set(['http', 'https', 'socks5']);
const MAX_CONFIG_BYTES = 1024 * 1024;
const REDACTED = '[已隐藏]';
export const hasControls = (value) =>
    [...value].some(
        (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );
export const isObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export function hostValue(value) {
    if (typeof value !== 'string') throw new Error('代理服务器地址无效');
    const host = value.trim().replace(/^\[([^\]]+)\]$/, '$1');
    if (isIP(host)) return host;
    if (!host || host.length > 253 || /[\s/@?#:\\]/u.test(host))
        throw new Error('代理服务器地址无效');
    const ascii = domainToASCII(host);
    if (
        !ascii ||
        !ascii
            .split('.')
            .every((part) =>
                /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part),
            )
    ) {
        throw new Error('代理服务器地址无效');
    }
    return ascii;
}

function simpleFields(input) {
    if (!isObject(input) || !SIMPLE_PROTOCOLS.has(input.protocol))
        throw new Error('请选择 HTTP、HTTPS 或 SOCKS5');
    const host = hostValue(input.host);
    const port = input.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('代理端口必须为 1 到 65535 的整数');
    const username = input.username ?? '';
    const password = input.password ?? '';
    for (const value of [username, password]) {
        if (
            typeof value !== 'string' ||
            value.length > 4096 ||
            hasControls(value)
        )
            throw new Error('代理认证信息无效');
    }
    if (password && !username) throw new Error('填写密码时也需要填写用户名');
    if (
        input.protocol === 'socks5' &&
        (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255)
    ) {
        throw new Error('SOCKS5 用户名和密码均不能超过 255 字节');
    }
    if (input.protocol !== 'socks5' && username.includes(':'))
        throw new Error('HTTP 用户名不能包含冒号');
    return { protocol: input.protocol, host, port, username, password };
}

export function parseProxyLine(text) {
    if (
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 16384 ||
        hasControls(text.trim())
    ) {
        throw new Error('请粘贴一行有效代理地址');
    }
    try {
        const line = text.trim();
        if (
            !line.includes('://') &&
            !line.includes('@') &&
            !line.startsWith('[')
        ) {
            const parts = line.split(':');
            if (parts.length >= 4) {
                return simpleFields({
                    protocol: 'http',
                    host: parts[0],
                    port: Number(parts[1]),
                    username: parts[2],
                    password: parts.slice(3).join(':'),
                });
            }
        }
        const normalized = line.includes('://') ? line : `http://${line}`;
        const url = new URL(normalized);
        let protocol = url.protocol.slice(0, -1).toLowerCase();
        if (protocol === 'socks' || protocol === 'socks5h') protocol = 'socks5';
        if (
            !SIMPLE_PROTOCOLS.has(protocol) ||
            (url.pathname && url.pathname !== '/') ||
            url.search ||
            url.hash
        )
            throw new Error();
        // URL removes default HTTP(S) ports, which remain valid explicit inputs.
        const port = Number(
            url.port ||
                (protocol === 'http' ? 80 : protocol === 'https' ? 443 : 1080),
        );
        return simpleFields({
            protocol,
            host: url.hostname,
            port,
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
        });
    } catch {
        throw new Error(
            '代理格式无效，支持协议://账号:密码@主机:端口或主机:端口:账号:密码',
        );
    }
}

export function simpleProxyToConfig(input) {
    const { protocol, host, port, username, password } = simpleFields(input);
    return normalizeProxyConfig({
        type: protocol === 'socks5' ? 'socks' : 'http',
        tag: 'proxy',
        server: host,
        server_port: port,
        ...(protocol === 'socks5' ? { version: '5' } : {}),
        ...(protocol === 'https'
            ? { tls: { enabled: true, server_name: host } }
            : {}),
        ...(username ? { username, password } : {}),
    });
}

// sing-box accepts JSON with comments and trailing commas. Strip only outside
// strings; URL slashes and escaped quotes inside authentication remain intact.
function parseJsonConfig(text) {
    let stripped = '';
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
            stripped += character;
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') {
            quoted = true;
            stripped += character;
        } else if (character === '/' && text[index + 1] === '/') {
            while (index < text.length && text[index] !== '\n') index++;
            stripped += '\n';
        } else if (character === '/' && text[index + 1] === '*') {
            const end = text.indexOf('*/', index + 2);
            if (end < 0) throw new Error();
            index = end + 1;
            stripped += ' ';
        } else stripped += character;
    }
    let cleaned = '';
    quoted = false;
    escaped = false;
    for (let index = 0; index < stripped.length; index++) {
        const character = stripped[index];
        if (
            !quoted &&
            character === ',' &&
            /^\s*[}\]]/.test(stripped.slice(index + 1))
        )
            continue;
        cleaned += character;
        if (escaped) escaped = false;
        else if (quoted && character === '\\') escaped = true;
        else if (character === '"') quoted = !quoted;
    }
    return JSON.parse(cleaned);
}

function cloneInput(input) {
    try {
        if (typeof input === 'string') {
            if (Buffer.byteLength(input) > MAX_CONFIG_BYTES) throw new Error();
            return parseJsonConfig(input);
        }
        const serialized = JSON.stringify(input);
        if (!serialized || Buffer.byteLength(serialized) > MAX_CONFIG_BYTES)
            throw new Error();
        return JSON.parse(serialized);
    } catch {
        throw new Error(
            'sing-box JSON 格式无效或超过 1 MiB，请检查括号、引号和逗号',
        );
    }
}

function safeTag(tag) {
    return (
        typeof tag === 'string' &&
        tag.length > 0 &&
        tag.length <= 128 &&
        !hasControls(tag)
    );
}

export function normalizeProxyConfig(input) {
    const value = cloneInput(input);
    if (!isObject(value)) throw new Error('请填写 sing-box 出口对象或配置片段');
    const fragment =
        'type' in value
            ? { outbounds: [{ ...value, tag: value.tag || 'proxy' }] }
            : value;
    if (
        Object.keys(fragment).some(
            (key) => !['outbounds', 'endpoints', 'dns', 'route'].includes(key),
        )
    ) {
        throw new Error(
            '这里只接受出口、端点、DNS 和出口选择；监听、日志与系统路由由程序管理',
        );
    }
    const outbounds = fragment.outbounds ?? [];
    const endpoints = fragment.endpoints ?? [];
    if (
        !Array.isArray(outbounds) ||
        !Array.isArray(endpoints) ||
        outbounds.length + endpoints.length < 1 ||
        outbounds.length + endpoints.length > 128
    ) {
        throw new Error('配置需要 1 到 128 个出口或端点');
    }
    const nodes = [...outbounds, ...endpoints];
    const tags = new Set();
    for (const node of nodes) {
        if (
            !isObject(node) ||
            typeof node.type !== 'string' ||
            !/^[a-z0-9_-]+$/.test(node.type) ||
            !safeTag(node.tag)
        ) {
            throw new Error('每个出口和端点都必须有有效的 type 和 tag');
        }
        if (node.type === 'direct')
            throw new Error('内置代理不允许 direct 出口，避免代理故障时直连');
        if (tags.has(node.tag)) throw new Error('出口和端点的 tag 不能重复');
        tags.add(node.tag);
    }
    const route = fragment.route ?? {};
    if (
        !isObject(route) ||
        Object.keys(route).some(
            (key) => !['final', 'default_domain_resolver'].includes(key),
        )
    ) {
        throw new Error(
            'route 仅支持 final 和 default_domain_resolver，不能覆盖程序托管路由',
        );
    }
    const final = route.final ?? nodes[0].tag;
    if (!tags.has(final))
        throw new Error('route.final 必须指向配置中存在的出口或端点');
    if (fragment.dns !== undefined && !isObject(fragment.dns))
        throw new Error('dns 必须是 sing-box DNS 对象');

    const links = new Map();
    for (const node of nodes) {
        const references = [];
        if (node.detour !== undefined) references.push(node.detour);
        if (node.type === 'selector' || node.type === 'urltest') {
            if (!Array.isArray(node.outbounds) || !node.outbounds.length)
                throw new Error('出口组必须包含可用的 outbounds');
            references.push(...node.outbounds);
            if (
                node.default !== undefined &&
                !node.outbounds.includes(node.default)
            )
                throw new Error('出口组默认项必须包含在 outbounds 中');
        }
        if (references.some((tag) => !tags.has(tag)))
            throw new Error('配置引用了不存在的出口或端点');
        links.set(node.tag, references);
    }
    const completed = new Set();
    const visiting = new Set();
    const visit = (tag) => {
        if (visiting.has(tag)) throw new Error('出口引用不能形成循环');
        if (completed.has(tag)) return;
        visiting.add(tag);
        for (const reference of links.get(tag)) visit(reference);
        visiting.delete(tag);
        completed.add(tag);
    };
    for (const tag of tags) visit(tag);
    return {
        outbounds,
        ...(endpoints.length ? { endpoints } : {}),
        ...(fragment.dns ? { dns: fragment.dns } : {}),
        route: { ...route, final },
    };
}

const NON_DIALER_OUTBOUND_TYPES = new Set([
    'selector',
    'urltest',
    'block',
    'dns',
    'direct',
]);

function withSafeDialDefaults(outbound) {
    if (
        !isObject(outbound) ||
        NON_DIALER_OUTBOUND_TYPES.has(outbound.type) ||
        typeof outbound.server !== 'string' ||
        !outbound.server.trim()
    ) {
        return outbound;
    }
    const next = { ...outbound };
    if (next.connect_timeout === undefined) {
        next.connect_timeout = '15s';
    }
    if (next.disable_tcp_keep_alive !== true) {
        if (next.tcp_keep_alive === undefined) {
            next.tcp_keep_alive = '30s';
        }
        if (next.tcp_keep_alive_interval === undefined) {
            next.tcp_keep_alive_interval = '15s';
        }
    }
    return next;
}

export function buildSingboxConfig(input, port) {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error('本地代理端口无效');
    const spec = normalizeProxyConfig(input);
    const dns = spec.dns ? structuredClone(spec.dns) : {};
    if (dns.servers !== undefined && !Array.isArray(dns.servers))
        throw new Error('dns.servers 必须为数组');
    const servers = dns.servers ?? [];
    let bootstrapTag = 'multichrome-bootstrap';
    while (servers.some((server) => server?.tag === bootstrapTag))
        bootstrapTag += '-local';
    const defaultResolver = spec.route.default_domain_resolver ?? bootstrapTag;
    if (spec.route.default_domain_resolver === undefined) {
        servers.push({ type: 'local', tag: bootstrapTag });
    }
    return {
        log: { level: 'info', timestamp: true },
        dns: { ...dns, servers },
        inbounds: [
            {
                type: 'http',
                tag: 'multichrome-in',
                listen: '127.0.0.1',
                listen_port: port,
            },
        ],
        outbounds: spec.outbounds.map(withSafeDialDefaults),
        ...(spec.endpoints ? { endpoints: spec.endpoints } : {}),
        route: { ...spec.route, default_domain_resolver: defaultResolver },
    };
}

export function redactConfig(config) {
    const sensitive =
        /(?:password|passwd|username|uuid|key|psk|secret|token|auth|cookie|credential|certificate|short.?id|client.?id)/i;
    const walk = (value) => {
        if (Array.isArray(value)) return value.map(walk);
        if (!isObject(value)) return value;
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => {
                if (sensitive.test(key) || key === 'headers')
                    return [key, REDACTED];
                // URLs may contain authentication in their user-info or query.
                if (
                    typeof item === 'string' &&
                    /^[a-z][a-z\d+.-]*:\/\//i.test(item)
                ) {
                    try {
                        const url = new URL(item);
                        if (
                            url.username ||
                            url.password ||
                            url.search ||
                            url.hash
                        )
                            return [key, REDACTED];
                    } catch {
                        return [key, REDACTED];
                    }
                }
                return [key, walk(item)];
            }),
        );
    };
    return walk(config);
}
