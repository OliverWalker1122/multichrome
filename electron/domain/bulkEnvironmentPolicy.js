import {
    generateFingerprintConfig,
    normalizeBrowserEngine,
    normalizeDefaultFingerprintSettings,
} from './fingerprintProfile.js';
import { normalizeEnvironmentTags } from './environmentTags.js';

export const MAX_BULK_CREATE_COUNT = 50;

export function buildBulkEnvironmentSpecs(input, defaultFingerprintSettings) {
    if (!input || typeof input !== 'object') {
        throw new Error('批量创建参数无效');
    }

    const namePrefix =
        typeof input.namePrefix === 'string' ? input.namePrefix.trim() : '';
    if (!namePrefix || namePrefix.length > 60) {
        throw new Error('请填写 1 至 60 个字符的环境名称前缀');
    }

    const groupName =
        typeof input.groupName === 'string' ? input.groupName.trim() : '';
    if (!groupName || groupName.length > 60) {
        throw new Error('请选择或填写有效的分组名称');
    }

    const count = Number(input.count);
    if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > MAX_BULK_CREATE_COUNT
    ) {
        throw new Error(`批量创建数量需为 1 至 ${MAX_BULK_CREATE_COUNT} 之间的整数`);
    }

    const startNumber =
        input.startNumber === undefined ? 1 : Number(input.startNumber);
    if (!Number.isInteger(startNumber) || startNumber < 1 || startNumber > 9999) {
        throw new Error('起始编号需为 1 至 9999 之间的整数');
    }

    const proxyMode =
        input.proxyMode === 'single' || input.proxyMode === 'sequential'
            ? input.proxyMode
            : 'none';
    const proxyIds = Array.isArray(input.proxyIds)
        ? input.proxyIds
              .filter((id) => typeof id === 'string' && id.trim().length > 0)
              .map((id) => id.trim())
        : [];

    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    const tags = normalizeEnvironmentTags(input.tags);
    const fpDefaults = normalizeDefaultFingerprintSettings(
        defaultFingerprintSettings,
    );
    const browserEngine = normalizeBrowserEngine(
        input.browserEngine || fpDefaults.defaultEngine,
    );

    const maxNumber = startNumber + count - 1;
    const padWidth = Math.max(2, String(maxNumber).length);
    const specs = [];

    for (let i = 0; i < count; i += 1) {
        const indexLabel = String(startNumber + i).padStart(padWidth, '0');
        const name = count === 1 && input.exactSingleName ? namePrefix : `${namePrefix} ${indexLabel}`;
        let proxyId;
        if (proxyMode === 'single' && proxyIds.length > 0) {
            proxyId = proxyIds[0];
        } else if (proxyMode === 'sequential' && proxyIds.length > 0) {
            proxyId = proxyIds[i % proxyIds.length];
        }

        specs.push({
            name,
            groupName,
            notes,
            tags: [...tags],
            browserEngine,
            proxyId,
            fingerprintConfig: generateFingerprintConfig(fpDefaults),
        });
    }

    return specs;
}
