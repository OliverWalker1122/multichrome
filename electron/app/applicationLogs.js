import { randomUUID } from 'node:crypto';

const MAX_ENTRIES = 1000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_STRING_LENGTH = 32000;
const MAX_OBJECT_ITEMS = 30;
const REDACTED = '[已隐藏]';
const SECRET_FIELD =
    /password|passwd|pwd|username|authorization|cookie|token|secret|credential|privatekey|apikey|headers|密码|令牌|凭据|^(?:auth|authentication|session|sessionid|env|processenv)$/i;

function sanitizeText(input) {
    return (
        input
            .slice(0, MAX_STRING_LENGTH)
            // Strip terminal escape/control characters from console-originated data.
            // eslint-disable-next-line no-control-regex
            .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
            .replace(
                /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
                '[私钥已隐藏]',
            )
            .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, (value) => {
                try {
                    const url = new URL(value);
                    if (url.protocol === 'file:') return 'file://[本地路径]';
                    if (!url.host) return '[链接已隐藏]';
                    // Paths can also contain a session identifier. The destination
                    // is enough to diagnose a backend request without retaining it.
                    return `${url.protocol}//${url.host}${url.pathname && url.pathname !== '/' ? '/[路径已隐藏]' : '/'}${url.search || url.hash ? '?[参数已隐藏]' : ''}`;
                } catch {
                    return '[链接已隐藏]';
                }
            })
            .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
            .replace(
                /(["']?(?:(?:proxy-)?authorization|(?:set-)?cookie)["']?\s*[:=]\s*)[^\r\n]*/gi,
                `$1${REDACTED}`,
            )
            .replace(
                /((?:["']?)(?:password|passwd|pwd|username|authorization|proxy-authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|client[_-]?secret|secret|credentials?|private[_-]?key|密码|令牌|凭据)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi,
                `$1${REDACTED}`,
            )
    );
}

function sanitizeValue(value, seen, depth = 0) {
    if (typeof value === 'string') return sanitizeText(value);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'undefined') return '[undefined]';
    if (typeof value !== 'object') return `[${typeof value}]`;
    if (seen.has(value)) return '[循环引用]';
    if (depth >= 4) return '[内容已折叠]';
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
        return '[二进制内容已隐藏]';

    seen.add(value);
    try {
        // Inspect only stored values: logging must not invoke getters, toJSON,
        // or a custom inspect implementation on an arbitrary backend object.
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys =
            value instanceof Error
                ? ['message', 'stack', 'code', 'cause']
                : Object.keys(descriptors).slice(0, MAX_OBJECT_ITEMS);
        const result = Object.create(null);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor) continue;
            const cleanKey = sanitizeText(key).slice(0, 100);
            result[cleanKey] = SECRET_FIELD.test(key.replace(/[-_\s]/g, ''))
                ? REDACTED
                : 'value' in descriptor
                  ? sanitizeValue(descriptor.value, seen, depth + 1)
                  : '[访问器已省略]';
        }
        if (Object.keys(descriptors).length > MAX_OBJECT_ITEMS)
            result['…'] = '[更多内容已省略]';
        return result;
    } catch {
        return '[内容无法显示]';
    } finally {
        seen.delete(value);
    }
}

function formatData(data) {
    const values = (Array.isArray(data) ? data : [data]).slice(
        0,
        MAX_OBJECT_ITEMS,
    );
    const text = values
        .map((value) => {
            const clean = sanitizeValue(value, new WeakSet());
            return typeof clean === 'string' ? clean : JSON.stringify(clean);
        })
        .join(' ');
    // Sanitize once more across argument boundaries (e.g. log('token:', value)).
    const sanitized = sanitizeText(text);
    return sanitized.length > MAX_MESSAGE_LENGTH
        ? `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}…`
        : sanitized;
}

/** Keep only sanitized logs from this application session; never read log files. */
export function createApplicationLogBuffer({ limit = MAX_ENTRIES } = {}) {
    const capacity = Number.isFinite(limit)
        ? Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)))
        : MAX_ENTRIES;
    let entries = [];
    const attachments = new WeakMap();

    function attach(logger) {
        const existing = attachments.get(logger);
        if (existing) return existing;
        if (!logger || !logger.transports)
            throw new Error('后台日志记录器不可用');
        const transportName = `applicationLogBuffer-${randomUUID()}`;
        const transport = (message) => {
            try {
                const messageTime = message.date;
                entries.push({
                    id: randomUUID(),
                    time:
                        messageTime instanceof Date &&
                        Number.isFinite(messageTime.getTime())
                            ? messageTime.toISOString()
                            : new Date().toISOString(),
                    level: ['error', 'warn', 'info'].includes(message.level)
                        ? message.level
                        : 'debug',
                    message: formatData(message.data),
                });
                if (entries.length > capacity)
                    entries.splice(0, entries.length - capacity);
            } catch {
                // The log viewer must never cause or recursively log a failure
                // in the existing application/file/console logging pipeline.
            }
        };
        transport.level = 'silly';
        transport.transforms = [];
        logger.transports[transportName] = transport;
        const detach = () => {
            if (logger.transports[transportName] === transport)
                delete logger.transports[transportName];
            attachments.delete(logger);
        };
        attachments.set(logger, detach);
        return detach;
    }

    return {
        attach,
        getLogs: () => entries.map((entry) => ({ ...entry })),
        clearLogs: () => {
            entries = [];
        },
    };
}
