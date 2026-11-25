const prefix = 'protected:v1:';

export function createProxyAddressStorage(storage) {
    const cache = new Map();
    function requireEncryption() {
        if (!storage?.isEncryptionAvailable() || (process.platform === 'linux' && storage.getSelectedStorageBackend?.() === 'basic_text')) {
            throw new Error('系统安全存储不可用，无法保存代理配置');
        }
    }
    return {
        seal(key, value) {
            if (!value) { cache.delete(key); return ''; }
            requireEncryption();
            const previous = cache.get(key);
            if (previous?.value === value) return previous.cipher;
            const cipher = prefix + storage.encryptString(value).toString('base64');
            cache.set(key, { cipher, value });
            return cipher;
        },
        open(key, stored) {
            if (!stored) return '';
            if (!stored.startsWith(prefix)) return stored;
            const previous = cache.get(key);
            if (previous?.cipher === stored) return previous.value;
            requireEncryption();
            let value;
            try {
                value = storage.decryptString(Buffer.from(stored.slice(prefix.length), 'base64'));
            } catch {
                throw new Error('系统安全存储无法解密代理地址');
            }
            cache.set(key, { cipher: stored, value });
            return value;
        },
    };
}
