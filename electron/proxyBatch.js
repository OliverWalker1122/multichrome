import { parseProxyLine } from './singboxConfig.js';

export function buildProxyEndpointKey(simple) {
    if (!simple) return '';
    const protocol = String(simple.protocol || '').toLowerCase();
    const host = String(simple.host || '').toLowerCase();
    const port = Number(simple.port) || 0;
    const username = String(simple.username || '');
    return `${protocol}://${username}@${host}:${port}`;
}

/**
 * Parse multi-line proxy text into structured batch items.
 * Supports:
 *   - Plain lines: protocol://user:pass@host:port, host:port:user:pass, host:port
 *   - Named lines: "名称 | 代理地址" or "名称\t代理地址"
 *   - Ignores empty lines and lines starting with # or //
 */
export function parseBatchProxyText(
    text,
    { namePrefix = '代理', existingKeys = [] } = {},
) {
    const rawText = typeof text === 'string' ? text : '';
    const lines = rawText.split(/\r?\n/);
    const seenKeys = new Set(
        Array.isArray(existingKeys) ? existingKeys.filter(Boolean) : [],
    );
    const prefix =
        typeof namePrefix === 'string' && namePrefix.trim()
            ? namePrefix.trim().slice(0, 60)
            : '';

    const items = [];
    const errors = [];
    let validIndex = 0;

    lines.forEach((rawLine, idx) => {
        const lineNumber = idx + 1;
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
            return;
        }

        let explicitName = '';
        let proxySpec = trimmed;

        // Support "Name | proxy" or "Name\tproxy"
        const pipeIdx = trimmed.indexOf('|');
        const tabIdx = trimmed.indexOf('\t');
        if (pipeIdx > 0 && !trimmed.slice(0, pipeIdx).includes('://')) {
            explicitName = trimmed.slice(0, pipeIdx).trim();
            proxySpec = trimmed.slice(pipeIdx + 1).trim();
        } else if (tabIdx > 0 && !trimmed.slice(0, tabIdx).includes('://')) {
            explicitName = trimmed.slice(0, tabIdx).trim();
            proxySpec = trimmed.slice(tabIdx + 1).trim();
        }

        try {
            const simple = parseProxyLine(proxySpec);
            const key = buildProxyEndpointKey(simple);
            const duplicate = seenKeys.has(key);
            seenKeys.add(key);
            validIndex += 1;

            const name =
                explicitName ||
                (prefix ? `${prefix}-${validIndex}` : `${simple.host}:${simple.port}`);

            items.push({
                lineNumber,
                name: name.slice(0, 80),
                line: proxySpec,
                simple,
                key,
                duplicate,
            });
        } catch (error) {
            errors.push({
                lineNumber,
                raw: trimmed.slice(0, 120),
                error:
                    error instanceof Error
                        ? error.message
                        : '代理格式无效',
            });
        }
    });

    return { items, errors };
}

/**
 * Group environments by proxyId to detect duplicate proxy usage across environments.
 */
export function buildProxyUsageMap(environments) {
    const usage = new Map();
    for (const env of environments || []) {
        if (!env?.proxyId) continue;
        const list = usage.get(env.proxyId) || [];
        list.push({
            id: env.id,
            name: env.name,
            groupName: env.groupName,
            isRunning: Boolean(env.isRunning),
        });
        usage.set(env.proxyId, list);
    }
    return usage;
}
