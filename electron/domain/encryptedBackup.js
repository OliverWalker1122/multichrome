import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const BACKUP_MAGIC = 'MULTICHROME_E2EE_BACKUP_V1';
export const BACKUP_VERSION = 1;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 256;
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function validateBackupPassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
        throw new Error('备份密码长度不能少于 8 个字符');
    }
    if (password.length > MAX_PASSWORD_LEN) {
        throw new Error('备份密码长度不能超过 256 个字符');
    }
    return password;
}

export function sanitizePortableSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {};
    }
    const clone = JSON.parse(JSON.stringify(settings));
    delete clone.dataPath;
    return clone;
}

export function encryptBackupBundle(
    bundle,
    password,
    { appVersion = '1.7.1', nowIso = new Date().toISOString() } = {},
) {
    validateBackupPassword(password);
    if (!bundle || typeof bundle !== 'object') {
        throw new Error('备份数据格式无效');
    }

    const normalizedPayload = {
        schemaVersion: BACKUP_VERSION,
        exportedAt: nowIso,
        appVersion: String(appVersion || '1.7.1'),
        settings: sanitizePortableSettings(bundle.settings),
        proxies: Array.isArray(bundle.proxies) ? bundle.proxies : [],
        environments: Array.isArray(bundle.environments) ? bundle.environments : [],
    };

    const compressed = zlib.gzipSync(
        Buffer.from(JSON.stringify(normalizedPayload), 'utf8'),
    );
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(password, salt, 32, SCRYPT_PARAMS);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify(
        {
            magic: BACKUP_MAGIC,
            version: BACKUP_VERSION,
            createdAt: nowIso,
            appVersion: String(appVersion || '1.7.1'),
            kdf: {
                name: 'scrypt',
                ...SCRYPT_PARAMS,
                salt: salt.toString('base64'),
            },
            cipher: {
                name: 'aes-256-gcm',
                iv: iv.toString('base64'),
                tag: tag.toString('base64'),
            },
            ciphertext: ciphertext.toString('base64'),
        },
        null,
        2,
    );
}

export function decryptBackupBundle(rawInput, password) {
    validateBackupPassword(password);
    if (typeof rawInput !== 'string' || !rawInput.trim()) {
        throw new Error('备份文件内容为空或格式无效');
    }

    let envelope;
    try {
        envelope = JSON.parse(rawInput);
    } catch {
        throw new Error('无法解析加密备份文件，请确认文件完整');
    }

    if (
        !envelope ||
        envelope.magic !== BACKUP_MAGIC ||
        envelope.version !== BACKUP_VERSION ||
        envelope.kdf?.name !== 'scrypt' ||
        envelope.cipher?.name !== 'aes-256-gcm' ||
        typeof envelope.kdf?.salt !== 'string' ||
        typeof envelope.cipher?.iv !== 'string' ||
        typeof envelope.cipher?.tag !== 'string' ||
        typeof envelope.ciphertext !== 'string'
    ) {
        throw new Error('不支持的备份文件格式或版本');
    }

    const salt = Buffer.from(envelope.kdf.salt, 'base64');
    const iv = Buffer.from(envelope.cipher.iv, 'base64');
    const tag = Buffer.from(envelope.cipher.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const N = Number(envelope.kdf.N) || SCRYPT_PARAMS.N;
    const r = Number(envelope.kdf.r) || SCRYPT_PARAMS.r;
    const p = Number(envelope.kdf.p) || SCRYPT_PARAMS.p;

    if (
        salt.length !== 16 ||
        iv.length !== 12 ||
        tag.length !== 16 ||
        N < 1024 ||
        N > 131072
    ) {
        throw new Error('备份加密头参数无效');
    }

    let compressed;
    try {
        const key = crypto.scryptSync(password, salt, 32, { N, r, p });
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        compressed = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
    } catch {
        throw new Error('备份密码错误或文件已被篡改');
    }

    let parsed;
    try {
        const jsonBuf = zlib.gunzipSync(compressed, {
            maxOutputLength: MAX_UNZIPPED_BYTES,
        });
        parsed = JSON.parse(jsonBuf.toString('utf8'));
    } catch {
        throw new Error('备份数据解压或校验失败');
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray(parsed.proxies) ||
        !Array.isArray(parsed.environments)
    ) {
        throw new Error('备份载荷结构不完整');
    }

    return {
        schemaVersion: parsed.schemaVersion || 1,
        exportedAt: parsed.exportedAt || envelope.createdAt || '',
        appVersion: parsed.appVersion || envelope.appVersion || '',
        settings: sanitizePortableSettings(parsed.settings),
        proxies: parsed.proxies,
        environments: parsed.environments,
    };
}
