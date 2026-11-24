import type {
    AppLocale,
    DefaultFingerprintSettings,
    FingerprintPlatform,
} from '../../types';
import { tr, translateBackendMessage } from '../../i18n';
import { systemApi } from '../../services';

export function getHostDefaultPlatform(): FingerprintPlatform {
    const p = systemApi.getPlatform();
    if (p === 'darwin') return 'macos';
    if (p === 'linux') return 'linux';
    return 'windows';
}

export const QUICK_STARTUP_URLS = [
    { zh: 'ippure.com', en: 'ippure.com', url: 'https://ippure.com/' },
    {
        zh: 'BrowserScan',
        en: 'BrowserScan',
        url: 'https://www.browserscan.net/',
    },
    {
        zh: 'BrowserLeaks',
        en: 'BrowserLeaks',
        url: 'https://browserleaks.com/webrtc',
    },
    { zh: '留空', en: 'Blank', url: '' },
];

export const COMMON_LANGUAGES = [
    { value: 'en-US', zh: '英语（美国）', en: 'English (US)' },
    { value: 'en-GB', zh: '英语（英国）', en: 'English (UK)' },
    { value: 'ja-JP', zh: '日语', en: 'Japanese' },
    { value: 'ko-KR', zh: '韩语', en: 'Korean' },
    { value: 'zh-TW', zh: '繁体中文', en: 'Traditional Chinese' },
];

export const SPOOFING_ITEMS: Array<{
    key: keyof DefaultFingerprintSettings['spoofing'];
    zh: string;
    en: string;
    tipZh: string;
    tipEn: string;
}> = [
    {
        key: 'canvas',
        zh: '画布特征',
        en: 'Canvas',
        tipZh: '为每个环境生成独立的 Canvas 绘图特征，避免跨账号关联',
        tipEn: 'Generates unique Canvas drawing signatures per profile',
    },
    {
        key: 'audio',
        zh: '音频特征',
        en: 'Audio',
        tipZh: '隔离音频处理指纹，防止通过声卡特征关联',
        tipEn: 'Isolates AudioContext signatures across profiles',
    },
    {
        key: 'font',
        zh: '字体列表',
        en: 'Fonts',
        tipZh: '防止网站读取本机已安装的字体列表',
        tipEn: 'Prevents sites from enumerating host fonts',
    },
    {
        key: 'clientrects',
        zh: '页面布局度量',
        en: 'Layout Metrics',
        tipZh: '微调元素渲染尺寸特征，避免跨环境撞脸',
        tipEn: 'Perturbs DOM ClientRects measurements per profile',
    },
    {
        key: 'gpu',
        zh: '显卡与图形',
        en: 'Graphics / WebGL',
        tipZh: '隔离 WebGL 图形渲染特征与显卡标识',
        tipEn: 'Isolates WebGL rendering output and GPU identifiers',
    },
];

export function formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
}

export function cleanIpcError(err: unknown, locale: AppLocale): string {
    const raw =
        err instanceof Error
            ? err.message.replace(
                  /^Error invoking remote method '[^']+': (?:Error: )?/,
                  '',
              )
            : typeof err === 'string' && err.trim()
              ? err.replace(
                    /^Error invoking remote method '[^']+': (?:Error: )?/,
                    '',
                )
              : '';
    if (raw.trim()) {
        return translateBackendMessage(raw.trim(), locale);
    }
    return tr(
        '操作失败，请稍后重试',
        'Operation failed. Please try again.',
        locale,
    );
}

export function normalizeFpState(
    raw?: DefaultFingerprintSettings,
): DefaultFingerprintSettings {
    return {
        defaultEngine: raw?.defaultEngine || 'system-chrome',
        platform: raw?.platform || getHostDefaultPlatform(),
        brand: raw?.brand || 'Chrome',
        autoMatchTimezone: raw?.autoMatchTimezone !== false,
        autoMatchLanguage: Boolean(raw?.autoMatchLanguage),
        autoMatchGeolocation: Boolean(raw?.autoMatchGeolocation),
        defaultLanguage: raw?.defaultLanguage || 'en-US',
        spoofing: {
            canvas: raw?.spoofing?.canvas !== false,
            audio: raw?.spoofing?.audio !== false,
            font: raw?.spoofing?.font !== false,
            clientrects: raw?.spoofing?.clientrects !== false,
            gpu: raw?.spoofing?.gpu !== false,
        },
    };
}
