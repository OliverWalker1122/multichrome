import { useCallback } from 'react';
import { AppLocale } from '../types';
import { useSettings } from '../contexts/SettingsContext';

export const LOCALE_STORAGE_KEY = 'multichrome.locale';

export function getStoredLocale(): AppLocale {
    try {
        const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (stored === 'en-US' || stored === 'zh-CN') return stored;
    } catch {
        // ignore storage errors
    }
    if (
        typeof document !== 'undefined' &&
        document.documentElement?.lang === 'en-US'
    ) {
        return 'en-US';
    }
    return 'zh-CN';
}

export function saveStoredLocale(locale: AppLocale): void {
    try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
        // ignore storage errors
    }
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = locale;
    }
}

export function tr(zh: string, en: string, locale: AppLocale = getStoredLocale()): string {
    return locale === 'en-US' ? en : zh;
}

/**
 * Translate common dynamic backend log / error messages when rendering in English.
 */
export function translateBackendMessage(
    message: string,
    locale: AppLocale,
): string {
    if (locale !== 'en-US' || !message) return message;
    return message
        // Proxy logs
        .replace(/连接目标\s+/g, 'Connecting to ')
        .replace(/出口检测完成[:：]\s*/g, 'Exit probe done: ')
        .replace(
            /代理连接中断或上游不可达/g,
            'Proxy connection interrupted or upstream unreachable',
        )
        .replace(/sing-box 已启动/g, 'sing-box started')
        .replace(/sing-box 已停止/g, 'sing-box stopped')
        .replace(
            /sing-box 意外退出，浏览器代理连接已中断；请关闭环境后重新启动/g,
            'sing-box exited unexpectedly; browser proxy connection lost. Close and relaunch the environment.',
        )
        .replace(
            /sing-box 启动失败，请检查核心、配置和本地端口/g,
            'sing-box failed to start. Check the core binary, config, and local ports.',
        )
        // Redaction & common placeholders
        .replace(/\[路径已隐藏\]/g, '[path hidden]')
        // CDP & launch lifecycle logs
        .replace(
            /指纹扩展已安装，跳过 pipe[:：]\s*/g,
            'Fingerprint extension installed, skipping pipe: ',
        )
        .replace(/启动Chrome\s*-\s*PID:/g, 'Launched Chrome - PID:')
        .replace(/,\s*端口:/g, ', Port:')
        .replace(/页面已附加，注入覆盖[:：]\s*/g, 'Page attached, injecting overrides: ')
        .replace(/已注入\s*(\d+)\s*条命令到\s*session/g, 'Injected $1 command(s) into session')
        .replace(/CDP连接成功/g, 'CDP connected')
        .replace(/CDP连接失败，使用轮询检测/g, 'CDP connection failed, falling back to polling')
        .replace(/已启用\s*Target\.setAutoAttach[:：]\s*/g, 'Enabled Target.setAutoAttach: ')
        .replace(
            /覆盖脚本已设置到\s*(\d+)\s*个页面[:：]\s*/g,
            'Override script applied to $1 page(s): ',
        )
        .replace(/CDP覆盖成功[:：]\s*/g, 'CDP overrides applied: ')
        .replace(/启动页已跳过/g, 'Startup page skipped')
        .replace(/已在空白标签页打开启动页/g, 'Opened startup page in blank tab')
        .replace(/已新建标签页打开启动页/g, 'Opened startup page in new tab')
        .replace(/启动页智能处理异常/g, 'Startup page handling error')
        .replace(/命令发送失败[:：]\s*/g, 'Command failed: ')
        .replace(/恢复目标失败[:：]\s*/g, 'Failed to resume target: ')
        .replace(/WebRTC 伪装 IP 已设置[:：]\s*/g, 'WebRTC spoof IP set: ')
        .replace(
            /WebRTC IP 更新，刷新到\s*(\d+)\s*个\s*sessions/g,
            'WebRTC IP updated, refreshed $1 session(s)',
        )
        .replace(/\[指纹扩展\]\s*已创建\/更新[:：]\s*/g, '[Fingerprint Ext] Created/updated: ')
        .replace(/\[时区扩展\]\s*已注册到 Preferences[:：]\s*/g, '[Timezone Ext] Registered in Preferences: ')
        .replace(/\(WebRTC Fail-Closed 已锁定\)/g, '(WebRTC Fail-Closed locked)')
        .replace(/扩展已通过 CDP pipe 加载，ID[:：]\s*/g, 'Extension loaded via CDP pipe, ID: ')
        .replace(/通过 CDP pipe 请求加载扩展[:：]\s*/g, 'Requesting extension load via CDP pipe: ')
        .replace(/CDP pipe 不可用/g, 'CDP pipe unavailable')
        .replace(/已启用内置代理（Fail-Closed 模式）/g, 'Managed proxy enabled (Fail-Closed mode)')
        .replace(/已启用手动代理（Fail-Closed 模式）/g, 'Manual proxy enabled (Fail-Closed mode)')
        .replace(/分配端口[:：]\s*/g, 'Assigned port: ')
        .replace(
            /后台补测代理出口仍未返回，继续保持内核 Fail-Closed 防泄露保护/g,
            'Background exit IP probe did not respond; keeping kernel Fail-Closed leak protection',
        )
        .replace(/轮询确认运行中/g, 'Confirmed running via polling')
        .replace(/启动失败/g, 'Launch failed')
        .replace(/开始关闭/g, 'Stopping')
        .replace(/Chrome进程已关闭/g, 'Chrome process closed')
        .replace(/检测到Chrome环境进程已结束[:：]\s*/g, 'Detected Chrome profile process exited: ')
        .replace(
            /进程状态发生变化，通知前端更新[:：]\s*变化数量=/g,
            'Process state changed, notifying UI: count=',
        )
        .replace(/收到启动Chrome环境请求，环境ID[:：]\s*/g, 'Received launch request for environment ID: ')
        .replace(/环境已在运行[:：]\s*/g, 'Environment already running: ')
        .replace(/更新Chrome环境[:：]\s*/g, 'Updated Chrome environment: ')
        .replace(/软删除Chrome环境[:：]\s*/g, 'Moved Chrome environment to trash: ')
        .replace(/恢复Chrome环境[:：]\s*/g, 'Restored Chrome environment: ')
        .replace(/永久删除Chrome环境[:：]\s*/g, 'Permanently deleted Chrome environment: ')
        .replace(
            /清理回收站[:：]\s*删除了\s*(\d+)\s*个过期环境/g,
            'Trash cleanup: removed $1 expired environment(s)',
        )
        // Settings & database logs
        .replace(/数据路径已更改[:：]\s*/g, 'Data path changed: ')
        .replace(/设置已保存/g, 'Settings saved')
        .replace(/数据库已迁移[:：]\s*添加\s*(\w+)\s*列/g, 'Database migrated: added $1 column')
        .replace(/当前数据库列[:：]\s*/g, 'Current database columns: ')
        .replace(/浏览器崩溃[:：]\s*/g, 'Browser crashed: ');
}

export function useI18n() {
    const { locale, actions } = useSettings();
    const isEn = locale === 'en-US';
    const t = useCallback(
        (zh: string, en: string) => (isEn ? en : zh),
        [isEn],
    );
    return {
        locale,
        isEn,
        setLocale: actions.setLocale,
        t,
    };
}
