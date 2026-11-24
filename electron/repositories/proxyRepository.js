import path from 'node:path';
import { simpleProxyToConfig } from '../domain/singboxConfig.js';
import { buildProxyEndpointKey } from '../domain/proxyBatch.js';
import { buildOutboundEndpointKey } from '../domain/proxyUriParser.js';

export function buildRecordCacheToken(record) {
    if (record.payload) return `v2:${record.payload}`;
    return `v1:${record.protocol || ''}|${record.host || ''}|${record.port || 0}|${record.credentials || ''}`;
}

export function extractSummaryMetadata(data) {
    const config = data?.config;
    const main = [
        ...(config?.outbounds || []),
        ...(config?.endpoints || []),
    ].find((item) => item.tag === config?.route?.final);
    const simple = data?.simple;
    return {
        mode: data?.mode || 'json',
        protocol: simple?.protocol || main?.type || 'sing-box',
        host: simple?.host || main?.server || '',
        port: simple?.port || main?.server_port || 0,
        username: simple?.username || '',
        hasPassword: data?.mode === 'json' ? true : Boolean(simple?.password),
        endpointKey: simple
            ? buildProxyEndpointKey(simple)
            : buildOutboundEndpointKey(main),
        hasRotationUrl: Boolean(data?.rotationUrl),
    };
}

/**
 * Encrypted Proxy Persistence Repository (`safeStorage` + `electron-store`).
 * Strictly Fail-Closed: refuses plaintext fallback when OS keyring is unavailable,
 * and caches only redacted summary metadata in memory.
 */
export class ProxyRepository {
    constructor({ store, secretStorage, configDirectory = '' }) {
        this.store = store;
        this.secretStorage = secretStorage;
        this.sourcePath =
            store.path || path.join(configDirectory, 'managed-proxies.json');
        this.summaryCache = new Map();
        const saved = store.get('proxies', []);
        if (!Array.isArray(saved)) throw new Error('代理配置格式无效');
        this.records = saved;
    }

    encryptionAvailable() {
        return (
            this.secretStorage.isEncryptionAvailable() &&
            this.secretStorage.getSelectedStorageBackend?.() !== 'basic_text'
        );
    }

    decrypt(value) {
        try {
            if (!this.encryptionAvailable()) throw new Error();
            return JSON.parse(
                this.secretStorage.decryptString(Buffer.from(value, 'base64')),
            );
        } catch {
            throw new Error(
                '无法解密代理配置，请在原系统账户下使用，或重新配置此代理',
            );
        }
    }

    encryptPayload(data) {
        if (!this.encryptionAvailable()) {
            throw new Error('系统安全存储不可用，无法保存代理配置');
        }
        try {
            return this.secretStorage
                .encryptString(JSON.stringify(data))
                .toString('base64');
        } catch {
            throw new Error('代理配置加密失败');
        }
    }

    decodePayload(record) {
        if (record.payload) return this.decrypt(record.payload);
        // Backward compatibility with v1 records
        const credentials = record.credentials
            ? this.decrypt(record.credentials)
            : { username: '', password: '' };
        const simple = {
            protocol: record.protocol,
            host: record.host,
            port: record.port,
            username: credentials.username,
            password: credentials.password,
        };
        return { mode: 'simple', simple, config: simpleProxyToConfig(simple) };
    }

    getRecords() {
        return this.records;
    }

    find(id) {
        const record = this.records.find((item) => item.id === id);
        if (!record) throw new Error('代理不存在');
        return record;
    }

    resolveSummaryMetadata(record) {
        if (!this.encryptionAvailable()) {
            this.summaryCache.clear();
            return {
                meta: null,
                credentialError: '代理配置无法解密，请重新配置',
            };
        }

        const token = buildRecordCacheToken(record);
        const cached = this.summaryCache.get(record.id);
        if (cached && cached.token === token) {
            return { meta: cached.meta, credentialError: undefined };
        }

        try {
            const data = this.decodePayload(record);
            const meta = extractSummaryMetadata(data);
            this.summaryCache.set(record.id, { token, meta });
            return { meta, credentialError: undefined };
        } catch {
            this.summaryCache.delete(record.id);
            return {
                meta: null,
                credentialError: '代理配置无法解密，请重新配置',
            };
        }
    }

    persist(records) {
        try {
            this.store.set('proxies', records);
            this.records = records;
            const validIds = new Set(records.map((item) => item.id));
            for (const key of this.summaryCache.keys()) {
                if (!validIds.has(key)) {
                    this.summaryCache.delete(key);
                }
            }
        } catch {
            throw new Error('代理配置保存失败');
        }
    }

    saveRecord(record, data, replacing = false) {
        const nextRecords = replacing
            ? this.records.map((item) =>
                  item.id === record.id ? record : item,
              )
            : [...this.records, record];
        this.persist(nextRecords);
        this.summaryCache.set(record.id, {
            token: buildRecordCacheToken(record),
            meta: extractSummaryMetadata(data),
        });
    }

    appendBatch(newRecords, newMetaEntries) {
        this.persist([...this.records, ...newRecords]);
        for (const entry of newMetaEntries) {
            this.summaryCache.set(entry.id, {
                token: entry.token,
                meta: entry.meta,
            });
        }
    }

    removeRecord(id) {
        this.persist(this.records.filter((item) => item.id !== id));
        this.summaryCache.delete(id);
    }

    clearCache() {
        this.summaryCache.clear();
    }
}
