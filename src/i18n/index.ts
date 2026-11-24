import React, { createContext, useCallback, useContext } from 'react';
import { AppLocale } from '../types';

export interface I18nContextValue {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export const I18nProvider: React.FC<{
    value: I18nContextValue;
    children: React.ReactNode;
}> = ({ value, children }) =>
    React.createElement(I18nContext.Provider, { value }, children);

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
        document.documentElement?.lang === 'zh-CN'
    ) {
        return 'zh-CN';
    }
    return 'en-US';
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

const EXACT_BACKEND_MESSAGES: Record<string, string> = {
    // ProxyManager
    'sing-box 启动失败，请检查核心、配置和本地端口':
        'sing-box failed to start. Check the core binary, config, and local ports.',
    '请填写不超过 80 个字符的代理名称': 'Proxy name must be 1–80 characters',
    '无法分配本地代理端口': 'Unable to allocate a local proxy port',
    '代理配置格式无效': 'Invalid proxy configuration format',
    '无法解密代理配置，请在原系统账户下使用，或重新配置此代理':
        'Unable to decrypt proxy configuration. Use the original OS account or reconfigure this proxy.',
    '代理配置无法解密，请重新配置':
        'Proxy configuration cannot be decrypted. Please reconfigure.',
    '代理不存在': 'Proxy not found',
    '请先停止此代理，再修改或删除':
        'Stop this proxy before modifying or deleting it',
    '代理配置保存失败': 'Failed to save proxy configuration',
    '代理服务正在退出': 'Proxy service is shutting down',
    '代理配置无效': 'Invalid proxy configuration',
    '代理输入方式无效': 'Invalid proxy input mode',
    '系统安全存储不可用，无法保存代理配置':
        'OS secure storage is unavailable; unable to save proxy configuration',
    '代理配置加密失败': 'Failed to encrypt proxy configuration',
    'sing-box 配置校验通过，已加密保存':
        'sing-box configuration validated and saved encrypted',
    '代理保存失败': 'Failed to save proxy',
    '请先启动代理，再检测出口': 'Start the proxy before testing its exit IP',
    '出口检测失败，请稍后重试；代理服务仍在运行':
        'Exit probe failed; please retry later (proxy service is still running)',
    '出口检测失败，请稍后重试': 'Exit probe failed; please retry later',
    '出口检测已取消': 'Exit probe canceled',
    'sing-box 意外退出，浏览器代理连接已中断；请关闭环境后重新启动':
        'sing-box exited unexpectedly; browser proxy connection lost. Close and relaunch the environment.',
    '代理服务启动已取消': 'Proxy service startup canceled',
    'sing-box 已启动': 'sing-box started',
    'sing-box 已停止': 'sing-box stopped',
    '检测到系统从休眠恢复，正在重建 sing-box 通道':
        'System resumed from sleep; rebuilding sing-box tunnel',
    '检测到代理先前出现连接异常，正在重建 sing-box 通道':
        'Previous proxy connection error detected; rebuilding sing-box tunnel',
    '检测到代理长时间闲置，正在重建 sing-box 通道以避免首开卡顿':
        'Idle proxy detected; rebuilding sing-box tunnel for reliable startup',

    // SingboxCore
    'sing-box 配置无法序列化': 'sing-box configuration cannot be serialized',
    'sing-box 配置超过大小限制': 'sing-box configuration exceeds the size limit',
    '此出口类型不受内置 sing-box 核心支持':
        'This outbound type is not supported by the built-in sing-box core',
    'sing-box 配置字段或语法无效，请检查当前核心版本的配置格式':
        'Invalid sing-box config field or syntax. Check the format for the current core version.',
    '配置使用了已移除的 sing-box 字段，请按当前核心版本迁移':
        'Config uses deprecated or removed sing-box fields. Migrate to the current core version format.',
    'sing-box UUID 配置无效': 'Invalid sing-box UUID configuration',
    'sing-box TLS 或密钥配置无效': 'Invalid sing-box TLS or key configuration',
    'sing-box 引用了不存在的出口': 'sing-box references a non-existent outbound',
    'sing-box 配置校验失败，请检查协议参数及依赖配置':
        'sing-box configuration validation failed. Check protocol parameters and dependencies.',
    'REALITY 握手校验失败，请检查公钥、Short ID 与 SNI，或排查透明代理的 TLS 域名嗅探覆写':
        'REALITY verification failed. Check public key, short ID, and SNI, or bypass TLS domain sniffing on your local transparent proxy.',
    '上游 TLS 握手失败，请检查证书、SNI 或协议配置':
        'Upstream TLS handshake failed. Check certificate, SNI, or protocol settings.',
    '上游代理认证失败，请检查认证配置':
        'Upstream proxy authentication failed. Check credentials.',
    '本地代理端口被占用': 'Local proxy port is already in use',
    '代理连接超时': 'Proxy connection timed out',
    '代理连接中断或上游不可达':
        'Proxy connection interrupted or upstream unreachable',
    'sing-box 连接或配置发生错误，请检查上游配置':
        'sing-box connection or config error. Check upstream settings.',
    'sing-box 核心已就绪': 'sing-box core ready',
    '尚未安装 sing-box 代理核心，请前往「设置 → 代理核心（sing-box）」下载官方核心':
        'sing-box proxy core is not installed. Go to Settings → Components to download the official core.',
    '无法启动 sing-box 核心，请前往「设置」重新下载官方核心':
        'Unable to start sing-box core. Re-download the official core in Settings.',
    'sing-box 配置校验超时': 'sing-box configuration validation timed out',
    '无法启动内置 sing-box，请重新安装程序':
        'Unable to start built-in sing-box. Please reinstall the application.',
    'sing-box 本地监听配置无效': 'Invalid sing-box local listener configuration',
    'sing-box 核心未能停止，请重试退出':
        'sing-box core failed to stop. Please retry exiting.',
    'sing-box 启动失败，请检查配置和本地端口':
        'sing-box failed to start. Check the config and local ports.',

    // SingboxConfig, ProxyBatch, ManagedProxyArgs, ProxyUriParser
    '代理服务器地址无效': 'Invalid proxy server host',
    '请选择 HTTP、HTTPS 或 SOCKS5': 'Choose HTTP, HTTPS, or SOCKS5',
    '代理端口必须为 1 到 65535 的整数':
        'Proxy port must be an integer between 1 and 65535',
    '代理认证信息无效': 'Invalid proxy authentication credentials',
    '填写密码时也需要填写用户名':
        'Username is required when a password is provided',
    'SOCKS5 用户名和密码均不能超过 255 字节':
        'SOCKS5 username and password must not exceed 255 bytes',
    'HTTP 用户名不能包含冒号': 'HTTP username cannot contain colons',
    '请粘贴一行有效代理地址': 'Paste a valid single-line proxy address',
    '请粘贴一行有效代理链接': 'Paste a valid single-line proxy URI',
    '代理格式无效，支持协议://账号:密码@主机:端口或主机:端口:账号:密码':
        'Invalid proxy format. Supported: protocol://user:pass@host:port or host:port:user:pass',
    '代理格式无效': 'Invalid proxy format',
    '代理链接格式无效': 'Invalid proxy URI format',
    '不支持的代理链接协议': 'Unsupported proxy URI protocol',
    'sing-box JSON 格式无效或超过 1 MiB，请检查括号、引号和逗号':
        'Invalid sing-box JSON or exceeds 1 MiB. Check brackets, quotes, and commas.',
    '请填写 sing-box 出口对象或配置片段':
        'Enter a sing-box outbound object or config fragment',
    '这里只接受出口、端点、DNS 和出口选择；监听、日志与系统路由由程序管理':
        'Only outbounds, endpoints, DNS, and selectors are accepted; inbounds, log, and system routes are managed automatically.',
    '配置需要 1 到 128 个出口或端点':
        'Configuration requires 1 to 128 outbounds or endpoints',
    '每个出口和端点都必须有有效的 type 和 tag':
        'Every outbound and endpoint must have a valid type and tag',
    '内置代理不允许 direct 出口，避免代理故障时直连':
        'Managed proxies disallow direct outbounds to prevent direct-connection leaks',
    '出口和端点的 tag 不能重复': 'Outbound and endpoint tags must be unique',
    'route 仅支持 final 和 default_domain_resolver，不能覆盖程序托管路由':
        'route only supports final and default_domain_resolver; managed routing cannot be overridden',
    'route.final 必须指向配置中存在的出口或端点':
        'route.final must reference an existing outbound or endpoint',
    'dns 必须是 sing-box DNS 对象': 'dns must be a sing-box DNS object',
    '出口组必须包含可用的 outbounds':
        'Outbound selector group must contain valid outbounds',
    '出口组默认项必须包含在 outbounds 中':
        'Outbound group default must be included in outbounds',
    '配置引用了不存在的出口或端点':
        'Configuration references a non-existent outbound or endpoint',
    '出口引用不能形成循环': 'Outbound references must not form a cycle',
    '本地代理端口无效': 'Invalid local proxy port',
    'dns.servers 必须为数组': 'dns.servers must be an array',
    '内置代理入口无效': 'Invalid managed proxy inbound address',
    '代理地址无效': 'Invalid proxy address',
    '代理配置 Base64 格式无效': 'Invalid Base64 proxy configuration format',
    '代理配置 Base64 内容为空': 'Base64 proxy configuration is empty',
    'ALPN 参数无效': 'Invalid ALPN parameter',
    'WebSocket path 参数无效': 'Invalid WebSocket path parameter',
    'WebSocket Host 参数无效': 'Invalid WebSocket Host parameter',
    'gRPC serviceName 参数无效': 'Invalid gRPC serviceName parameter',
    'HTTPUpgrade Host 参数无效': 'Invalid HTTPUpgrade Host parameter',
    'HTTPUpgrade path 参数无效': 'Invalid HTTPUpgrade path parameter',
    '当前 sing-box 核心不支持此传输协议类型':
        'This transport type is not supported by the current sing-box core',
    'HTTP 传输 Host 参数无效': 'Invalid HTTP transport Host parameter',
    'HTTP 传输 path 参数无效': 'Invalid HTTP transport path parameter',
    'VLESS 链接认证格式无效': 'Invalid VLESS URI authentication format',
    'VLESS 链接缺少有效的 UUID': 'VLESS URI is missing a valid UUID',
    'VLESS Reality 公钥格式无效': 'Invalid VLESS Reality public key format',
    'VLESS Reality Short ID 格式无效': 'Invalid VLESS Reality Short ID format',
    'VLESS 链接不支持此 security 类型':
        'Unsupported security type in VLESS URI',
    'TLS SNI 参数无效': 'Invalid TLS SNI parameter',
    'uTLS fingerprint 参数无效': 'Invalid uTLS fingerprint parameter',
    'VLESS flow 参数无效': 'Invalid VLESS flow parameter',
    'VLESS packet_encoding 参数无效': 'Invalid VLESS packet_encoding parameter',
    'VLESS Reality 链接缺少公钥 (pbk)':
        'VLESS Reality URI is missing public key (pbk)',
    'VMess 链接内容为空': 'VMess URI content is empty',
    'VMess 链接格式无效，请检查 Base64 JSON 内容':
        'Invalid VMess URI format; check Base64 JSON content',
    'VMess 链接内容必须为 JSON 对象': 'VMess URI payload must be a JSON object',
    'VMess 链接缺少有效的 UUID': 'VMess URI is missing a valid UUID',
    'VMess alterId (aid) 参数无效': 'Invalid VMess alterId (aid) parameter',
    'VMess 加密方式 (scy) 参数无效': 'Invalid VMess cipher (scy) parameter',
    'VMess TLS SNI 参数无效': 'Invalid VMess TLS SNI parameter',
    'VMess uTLS fingerprint 参数无效': 'Invalid VMess uTLS fingerprint parameter',
    'Trojan 链接缺少密码': 'Trojan URI is missing password',
    'Trojan 链接不支持此 security 类型':
        'Unsupported security type in Trojan URI',
    'Trojan TLS SNI 参数无效': 'Invalid Trojan TLS SNI parameter',
    'Trojan uTLS fingerprint 参数无效': 'Invalid Trojan uTLS fingerprint parameter',
    'Shadowsocks 链接内容为空': 'Shadowsocks URI content is empty',
    'Shadowsocks 链接格式无效': 'Invalid Shadowsocks URI format',
    'Shadowsocks 认证格式无效': 'Invalid Shadowsocks credential format',
    'Shadowsocks 加密方式无效': 'Invalid Shadowsocks cipher method',
    'Shadowsocks 密码格式无效': 'Invalid Shadowsocks password format',
    'Shadowsocks plugin 参数无效': 'Invalid Shadowsocks plugin parameter',
    'Shadowsocks plugin 名称无效': 'Invalid Shadowsocks plugin name',
    'Hysteria2 链接缺少密码': 'Hysteria2 URI is missing password',
    'Hysteria2 TLS SNI 参数无效': 'Invalid Hysteria2 TLS SNI parameter',
    'Hysteria2 仅支持 salamander 混淆方式':
        'Hysteria2 only supports salamander obfuscation',
    'Hysteria2 salamander 混淆缺少有效的 obfs-password':
        'Hysteria2 salamander obfuscation requires a valid obfs-password',
    'TUIC 链接缺少有效的 UUID': 'TUIC URI is missing a valid UUID',
    'TUIC TLS SNI 参数无效': 'Invalid TUIC TLS SNI parameter',
    'TUIC congestion_control 参数无效':
        'Invalid TUIC congestion_control parameter',
    'TUIC udp_relay_mode 参数无效': 'Invalid TUIC udp_relay_mode parameter',

    // ProxyIntegration
    '程序正在退出': 'Application is shutting down',
    '请先解除所有环境与此代理的绑定（包括回收站中的环境）':
        'Unbind all profiles from this proxy first (including profiles in Trash)',
    '仍有环境正在使用此代理，请先关闭对应浏览器':
        'Profiles are still using this proxy. Close those browsers first.',
    '请先关闭环境，再修改代理配置':
        'Close the profile before changing its proxy settings',
    '所选代理不存在，请刷新后重试':
        'Selected proxy does not exist. Refresh and try again.',

    // KernelManager, KernelPolicy & GithubProxyTransport
    'kernelManifest.json 格式无效': 'Invalid kernelManifest.json format',
    'DMG 镜像中未找到 .app 应用包': 'No .app bundle found inside the DMG image',
    '仅 macOS 支持挂载安装 .dmg 镜像':
        'Mounting .dmg images is only supported on macOS',
    '缺少 GitHub 官方 SHA-256 指纹，为保障安全已拒绝下载':
        'Missing official GitHub SHA-256 digest; download blocked for security',
    '正在校验 GitHub 官方 SHA-256 指纹…':
        'Verifying official GitHub SHA-256 digest…',
    '下载校验失败': 'Download verification failed',
    'SHA-256 校验通过，正在解压到数据目录…':
        'SHA-256 verified; extracting to data directory…',
    'SHA-256 校验通过，正在解压 sing-box…':
        'SHA-256 verified; extracting sing-box…',
    '解压后未找到浏览器可执行文件（chrome.exe、Chromium 或 chrome），压缩包结构可能不兼容':
        'Browser executable (chrome.exe, Chromium, or chrome) not found after extraction; archive layout may be incompatible',
    '内核解压安装失败': 'Failed to extract and install kernel',
    '解压后未找到 sing-box 可执行文件':
        'sing-box executable not found after extraction',
    'sing-box 安装失败': 'sing-box installation failed',
    '所选路径不存在': 'Selected path does not exist',
    '安装包中未找到浏览器可执行文件':
        'Browser executable not found in archive',
    '请选择 chrome.exe、内核目录或内核 .zip 压缩包':
        'Select chrome.exe, a kernel folder, or a kernel .zip archive',
    '所选目录中未找到浏览器可执行文件':
        'Browser executable not found in selected folder',
    '压缩包中未找到 sing-box 可执行文件':
        'sing-box executable not found in archive',
    '请选择 sing-box.exe 或官方压缩包':
        'Select sing-box.exe or an official archive',
    '所选目录中未找到 sing-box 可执行文件':
        'sing-box executable not found in selected folder',
    '不支持的文件类型': 'Unsupported file type',
    '指定的指纹内核不存在或文件已丢失':
        'Specified privacy browser kernel does not exist or files are missing',
    '指定的 sing-box 核心不存在或文件已丢失':
        'Specified sing-box core does not exist or files are missing',
    '无效的下载地址': 'Invalid download URL',
    '仅允许通过 HTTPS 从 GitHub 官方下载':
        'Only HTTPS downloads from official GitHub are allowed',
    '代理地址格式无效，请检查全局代理或托管代理设置':
        'Invalid proxy address format. Check global or managed proxy settings.',
    '代理端口无效，请检查代理地址配置':
        'Invalid proxy port. Check proxy configuration.',
    '通过 HTTP 代理连接 GitHub 时连接中断':
        'Connection interrupted while reaching GitHub via HTTP proxy',
    'HTTP 代理 CONNECT 响应头过长':
        'HTTP proxy CONNECT response header too long',
    '通过代理连接 GitHub 超时': 'Timed out connecting to GitHub through proxy',
    'SOCKS5 代理认证用户名或密码长度不能超过 255 字节':
        'SOCKS5 username and password must not exceed 255 bytes',
    '目标主机名无效': 'Invalid target hostname',
    '通过 SOCKS5 代理连接 GitHub 时连接中断':
        'Connection interrupted while reaching GitHub via SOCKS5 proxy',
    'SOCKS5 代理握手版本不兼容': 'Incompatible SOCKS5 handshake version',
    'SOCKS5 代理要求用户名和密码认证':
        'SOCKS5 proxy requires username and password authentication',
    'SOCKS5 代理不支持当前认证方式':
        'SOCKS5 proxy does not support the current auth method',
    'SOCKS5 代理用户名或密码认证失败': 'SOCKS5 proxy authentication failed',
    'SOCKS5 代理响应格式无效': 'Invalid SOCKS5 proxy response format',
    'SOCKS5 代理返回未知地址类型': 'SOCKS5 proxy returned unknown address type',
    'SOCKS5 代理握手响应过长': 'SOCKS5 handshake response too long',
    '通过 SOCKS5 代理连接 GitHub 超时':
        'Timed out connecting to GitHub through SOCKS5 proxy',
    '下载重定向次数过多': 'Too many download redirects',
    'GitHub 网络请求超时': 'GitHub network request timed out',
    '操作已取消': 'Operation canceled',
    '版本信息响应过大': 'Release metadata response too large',
    '解析版本信息失败': 'Failed to parse release metadata',

    // ChromeManager, CdpManager, GroupOperations, ProfileStorage
    '源环境不存在或已移入回收站':
        'Source profile does not exist or has been moved to Trash',
    '环境不存在': 'Profile not found',
    '仅支持 HTTP 或 HTTPS 链接': 'Only HTTP and HTTPS URLs are supported',
    '无效的检测页面链接': 'Invalid inspection URL',
    '请先启动此环境，再在环境内打开检测页面':
        'Launch this profile before opening an inspection URL',
    '环境正在运行，请先关闭后再重新生成指纹':
        'Profile is running; close it before regenerating fingerprint',
    '该环境已有浏览器窗口，请先关闭旧窗口，再启动以使用内置代理':
        'A browser window is already open for this profile; close it before launching with a managed proxy',
    '未安装 C++ 指纹内核。请前往「设置 → 浏览器内核」下载或导入 fingerprint-chromium，或将该环境切换为官方 Chrome。':
        'Privacy browser kernel is not installed. Go to Settings → Components to download or import fingerprint-chromium, or switch this profile to Standard Chrome.',
    'Chrome可执行文件未找到，请确认已安装 Google Chrome':
        'Chrome executable not found. Confirm Google Chrome is installed.',
    '环境正在运行，请先关闭浏览器后再清理缓存':
        'Profile is running; close the browser before clearing cache',
    '检测到该环境浏览器仍在运行，请先关闭后再清理缓存':
        'Browser for this profile is still running; close it before clearing cache',
    '不支持的操作系统': 'Unsupported operating system',
    '无法确认浏览器运行状态，请重试':
        'Unable to confirm browser process state; please retry',
    '缓存目录路径越界': 'Cache directory path is out of bounds',
    '分组名称不能为空': 'Group name cannot be empty',
    '不支持的分组删除方式': 'Unsupported group deletion mode',
    '目标分组不能与要删除的分组相同，请选择其他目标分组或将组内环境移入回收站':
        'Target group cannot be the same as the group being deleted; choose another group or move profiles to Trash',
    '原分组名称不能为空': 'Original group name cannot be empty',
    '新分组名称不能为空': 'New group name cannot be empty',
    '新分组名称不能与原名称相同':
        'New group name must differ from the original name',
    '后台日志记录器不可用': 'Background logger is unavailable',

    // main.ts
    '无效的ID格式': 'Invalid ID format',
    '更新数据格式无效': 'Invalid update payload format',
    '设置数据格式无效': 'Invalid settings payload format',
    'dataPath 必须是字符串': 'dataPath must be a string',
    '主窗口未初始化': 'Main window is not initialized',
    '无效的链接地址': 'Invalid URL',
    '仅允许打开官方项目页面': 'Only official project pages may be opened',
    '检查更新超时，请稍后重试': 'Update check timed out; please retry later',
    '网络不可达，无法检查更新': 'Network unreachable; unable to check for updates',
    '未获取到有效版本号': 'No valid version number received',

    // AutomationServer & AutomationConfig
    '系统安全存储不可用，无法启用或保存自动化访问令牌':
        'OS secure storage is unavailable; cannot encrypt or save automation token',
    '自动化访问令牌加密失败': 'Failed to encrypt automation token',
    '系统安全存储不可用，无法解密自动化访问令牌':
        'OS secure storage is unavailable; cannot decrypt automation token',
    '无法解密自动化访问令牌，请在原系统账户下使用或重置令牌':
        'Failed to decrypt automation token; use the original OS account or rotate the token',
    '系统安全存储不可用，无法读取自动化访问令牌':
        'OS secure storage is unavailable; cannot access automation token',
    '自动化配置格式无效': 'Invalid automation configuration',
    '系统安全存储不可用，无法启用自动化服务':
        'OS secure storage is unavailable; cannot enable automation API',
    '系统安全存储不可用，无法重置自动化访问令牌':
        'OS secure storage is unavailable; cannot rotate automation token',
    '无法找到可用的本地回环端口（127.0.0.1）':
        'Unable to find an available local loopback port (127.0.0.1)',
};

const BACKEND_FIELD_LABELS: Record<string, string> = {
    环境名称: 'Profile name',
    分组名称: 'Group name',
    原分组名称: 'Original group name',
    新分组名称: 'New group name',
    页面地址: 'Page URL',
    内核版本号: 'Kernel version',
    'sing-box 版本号': 'sing-box version',
    'sing-box 核心ID': 'sing-box core ID',
    内核ID: 'Kernel ID',
    代理凭据: 'Proxy credential',
    'Trojan 密码': 'Trojan password',
    'Shadowsocks 认证信息': 'Shadowsocks credentials',
    'Shadowsocks 加密方式': 'Shadowsocks cipher method',
    'Shadowsocks 密码': 'Shadowsocks password',
    'Hysteria2 密码': 'Hysteria2 password',
    'TUIC 密码': 'TUIC password',
};

const ESCAPE_REGEXP = /[.*+?^${}()|[\]\\]/g;
const SORTED_EXACT_REPLACEMENTS: Array<[RegExp, string]> = Object.entries(
    EXACT_BACKEND_MESSAGES,
)
    .sort(([a], [b]) => b.length - a.length)
    .map(([zh, en]) => [new RegExp(zh.replace(ESCAPE_REGEXP, '\\$&'), 'g'), en]);

const BACKEND_TEMPLATE_REPLACEMENTS: Array<
    [RegExp, string | ((...args: string[]) => string)]
> = [
    // AutomationServer & AutomationConfig templates
    [
        /端口\s*(\d+)\s*已被占用或被系统保留，无法启动自动化控制面/g,
        'Port $1 is in use or reserved by the system; unable to start local automation server',
    ],
    [
        /端口\s*(\d+)\s*被系统保留或权限受限，无法启动自动化控制面/g,
        'Port $1 is reserved by the system or permission denied; unable to start local automation server',
    ],
    [
        /端口\s*(\d+)\s*已被占用，无法启动自动化控制面/g,
        'Port $1 is already in use; unable to start local automation server',
    ],
    [
        /自动化服务端口必须为\s*(\d+)\s*到\s*(\d+)\s*的整数/g,
        'Automation port must be an integer between $1 and $2',
    ],
    // Compound error prefixes
    [/sing-box 启动失败[:：]\s*/g, 'sing-box failed to start: '],
    [/Chrome 启动失败[:：]\s*/g, 'Chrome launch failed: '],
    // KernelPolicy & KernelManager templates
    [
        /指纹内核版本\s+(.+?)\s+不在受控白名单清单中，已禁止安装以保障兼容性/g,
        'Privacy browser version $1 is not in the curated allowlist and cannot be installed',
    ],
    [
        /sing-box 版本\s+(.+?)\s+不在受控白名单清单中，已禁止安装以保障兼容性/g,
        'sing-box version $1 is not in the curated allowlist and cannot be installed',
    ],
    [
        /官方 SHA-256 指纹校验失败（预期\s*([^，]+)，实际\s*([^）]+)），已删除异常文件/g,
        'Official SHA-256 verification failed (expected $1, got $2); removed corrupted file',
    ],
    [
        /正在下载\s+(.+?)，请稍候完成/g,
        'Downloading $1, please wait…',
    ],
    [/正在从 GitHub 官方下载\s+(.+?)…/g, 'Downloading $1 from official GitHub…'],
    [/下载中\s*(\d+)%/g, 'Downloading $1%'],
    [/指纹内核\s+(.+?)\s+校验并安装完成/g, 'Privacy browser $1 verified and installed'],
    [/sing-box v(.+?)\s+校验并安装完成/g, 'sing-box v$1 verified and installed'],
    [/解压 tar 压缩包失败:\s*/g, 'Failed to extract tar archive: '],
    [/解压内核压缩包失败:\s*/g, 'Failed to extract kernel archive: '],
    [
        /已拦截非 GitHub 官方域名下载[:：]\s*(.+)/g,
        'Blocked download from non-GitHub domain: $1',
    ],
    [
        /暂不支持的代理协议\s*\(([^)]+)\)，请使用 http:\/\/、https:\/\/ 或 socks5:\/\//g,
        'Unsupported proxy protocol ($1). Use http://, https://, or socks5://.',
    ],
    [/代理 CONNECT 失败:\s*/g, 'Proxy CONNECT failed: '],
    [
        /SOCKS5 代理连接目标失败\s*\(code=(\d+)\)/g,
        'SOCKS5 proxy failed to connect to target (code=$1)',
    ],
    [/HTTP\s*(\d+):\s*无法访问\s*(.+)/g, 'HTTP $1: Unable to reach $2'],
    // ChromeManager, GroupOperations, main.ts, proxyUriParser templates
    [
        /无法找到可用的调试端口\s*\(尝试范围:\s*([^)]+)\)/g,
        'Unable to find an available debug port (tried range: $1)',
    ],
    [
        /「([^」]+)」安全防护初始化超时，已拦截本次启动以防止时区泄露，请重试启动。/g,
        'Security guard initialization timed out for "$1"; launch aborted to prevent timezone leak. Please retry.',
    ],
    [/环境未找到[:：]\s*/g, 'Profile not found: '],
    [
        /系统保留分组“([^”]+)”不可删除/g,
        'System-reserved group "$1" cannot be deleted',
    ],
    [
        /不能将环境移动到系统保留分组“([^”]+)”/g,
        'Cannot move profiles into system-reserved group "$1"',
    ],
    [
        /系统保留分组“([^”]+)”不可重命名/g,
        'System-reserved group "$1" cannot be renamed',
    ],
    [
        /不能重命名为系统保留分组“([^”]+)”/g,
        'Cannot rename to system-reserved group "$1"',
    ],
    [
        /([^\s]+(?:\s+[^\s]+)?)\s+必须是非空字符串/g,
        (_full, name) =>
            `${BACKEND_FIELD_LABELS[name] || name} must be a non-empty string`,
    ],
    [
        /([^\s]+(?:\s+[^\s]+)?)\s*编码无效/g,
        (_full, label) =>
            `Invalid ${(BACKEND_FIELD_LABELS[label] || label).toLowerCase()} encoding`,
    ],
    [/(\S+)\s+链接格式无效/g, 'Invalid $1 URI format'],
    [/(\S+)\s+链接路径格式无效/g, 'Invalid $1 URI path format'],
    // Redaction & placeholders
    [/\[私钥已隐藏\]/g, '[private key hidden]'],
    [/file:\/\/\[本地路径\]/g, 'file://[local path]'],
    [/\[链接已隐藏\]/g, '[url hidden]'],
    [/\[路径已隐藏\]/g, '[path hidden]'],
    [/\[参数已隐藏\]/g, '[params hidden]'],
    [/\[循环引用\]/g, '[circular]'],
    [/\[内容已折叠\]/g, '[truncated]'],
    [/\[二进制内容已隐藏\]/g, '[binary hidden]'],
    [/\[访问器已省略\]/g, '[accessor omitted]'],
    [/\[更多内容已省略\]/g, '[more omitted]'],
    [/\[内容无法显示\]/g, '[unprintable]'],
    [/\[已隐藏\]/g, '[hidden]'],
    // Proxy & sing-box logs
    [/连接目标\s+/g, 'Connecting to '],
    [/出口检测完成[:：]\s*/g, 'Exit probe done: '],
    // CDP & launch lifecycle logs
    [
        /指纹扩展已安装，跳过 pipe[:：]\s*/g,
        'Fingerprint extension installed, skipping pipe: ',
    ],
    [/启动Chrome\s*-\s*PID:/g, 'Launched Chrome - PID:'],
    [/,\s*端口:/g, ', Port:'],
    [
        /页面已附加，施加原生覆盖[:：]\s*/g,
        'Page attached, applying native overrides: ',
    ],
    [
        /页面已附加，注入覆盖[:：]\s*/g,
        'Page attached, injecting overrides: ',
    ],
    [
        /已施加\s*(\d+)\s*条原生 Emulation 命令到 session/g,
        'Applied $1 native Emulation command(s) to session',
    ],
    [
        /已注入\s*(\d+)\s*条命令到\s*session/g,
        'Injected $1 command(s) into session',
    ],
    [
        /\[CDP\]\s*原生 Emulation 覆盖已就绪\s*\((\d+)\s*个页面，零 JS Hook\)[:：]\s*/g,
        '[CDP] Native Emulation overrides ready ($1 page(s), zero JS hooks): ',
    ],
    [
        /\[CDP\]\s*应用覆盖时暂未发现页面 session，后续新标签页仍将自动附加/g,
        '[CDP] No page session found yet; subsequent new tabs will attach automatically',
    ],
    [
        /CDP 连接不存在，无法应用覆盖[:：]\s*/g,
        'CDP connection missing; cannot apply overrides: ',
    ],
    [/CDP 应用覆盖失败[:：]\s*/g, 'CDP override error: '],
    [/CDP连接成功/g, 'CDP connected'],
    [
        /CDP连接失败，使用轮询检测/g,
        'CDP connection failed, falling back to polling',
    ],
    [/调试端口未就绪，使用轮询检测/g, 'Debug port not ready, falling back to polling'],
    [/已启用\s*Target\.setAutoAttach[:：]\s*/g, 'Enabled Target.setAutoAttach: '],
    [
        /覆盖脚本已设置到\s*(\d+)\s*个页面[:：]\s*/g,
        'Override script applied to $1 page(s): ',
    ],
    [/CDP原生覆盖成功[:：]\s*/g, 'CDP native overrides succeeded: '],
    [/CDP原生覆盖失败[:：]\s*/g, 'CDP native overrides failed: '],
    [/CDP覆盖成功[:：]\s*/g, 'CDP overrides applied: '],
    [
        /\[CDP\]\s*启动闸门已放行（无离线缓存抢跑）[:：]\s*/g,
        '[CDP] Startup gate released (no offline cache race): ',
    ],
    [
        /\[CDP\]\s*启动闸门检测到\s*(\d+)\s*个离线缓存抢跑页，已卸载旧页、丢弃\s*(\d+)\s*条旧连接并重载\s*(\d+)\s*个标签页/g,
        '[CDP] Startup gate caught $1 pre-committed cached tab(s), unloaded old pages, dropped $2 stale connection(s), and reloaded $3 tab(s)',
    ],
    [
        /\[CDP\]\s*C\+\+\s*内核默认搜索引擎检查完成\s*\(([^)]+)\)[:：]\s*/g,
        '[CDP] Privacy kernel default search check complete ($1): ',
    ],
    [/保留用户现有设置/g, 'kept existing user setting'],
    [/已设为\s*/g, 'set to '],
    [
        /\[CDP\]\s*C\+\+\s*内核设置默认 Google 搜索未成功\s*\(([^)]+)\)/g,
        '[CDP] Failed to set default Google search on privacy kernel ($1)',
    ],
    [
        /\[CDP\]\s*设置默认搜索引擎异常\s*\(([^)]+)\)/g,
        '[CDP] Default search engine setup error ($1)',
    ],
    [
        /\[启动闸门\]\s*等待 CDP 超时\s*\(([^)]+)\)，Fail-Closed 已阻断并中止启动/g,
        '[Startup Gate] Timed out waiting for CDP ($1); Fail-Closed blocked and aborted launch',
    ],
    [
        /\[启动闸门\]\s*等待 CDP 超时\s*\(([^)]+)\)，已自动放行\s*(\d+)\s*条连接/g,
        '[Startup Gate] Timed out waiting for CDP ($1); auto-released $2 connection(s)',
    ],
    [
        /\[原生隐匿\]\s*已清理旧版指纹扩展残留/g,
        '[Native Stealth] Cleaned up legacy fingerprint extension residue',
    ],
    [/启动页已跳过/g, 'Startup page skipped'],
    [/已在空白标签页打开启动页/g, 'Opened startup page in blank tab'],
    [/已新建标签页打开启动页/g, 'Opened startup page in new tab'],
    [/启动页智能处理异常/g, 'Startup page handling error'],
    [/命令发送失败[:：]\s*/g, 'Command failed: '],
    [/恢复目标失败[:：]\s*/g, 'Failed to resume target: '],
    [/WebRTC 伪装 IP 已设置[:：]\s*/g, 'WebRTC spoof IP set: '],
    [
        /WebRTC IP 更新，刷新到\s*(\d+)\s*个\s*sessions/g,
        'WebRTC IP updated, refreshed $1 session(s)',
    ],
    [
        /\[指纹扩展\]\s*已创建或更新[:：]\s*/g,
        '[Fingerprint Ext] Created or updated: ',
    ],
    [
        /\[时区扩展\]\s*已注册到 Preferences[:：]\s*/g,
        '[Timezone Ext] Registered in Preferences: ',
    ],
    [/\(WebRTC Fail-Closed 已锁定\)/g, '(WebRTC Fail-Closed locked)'],
    [
        /扩展已通过 CDP pipe 加载，ID[:：]\s*/g,
        'Extension loaded via CDP pipe, ID: ',
    ],
    [
        /通过 CDP pipe 请求加载扩展[:：]\s*/g,
        'Requesting extension load via CDP pipe: ',
    ],
    [/CDP pipe 不可用/g, 'CDP pipe unavailable'],
    [
        /已启用内置代理（Fail-Closed 模式）/g,
        'Managed proxy enabled (Fail-Closed mode)',
    ],
    [
        /已启用手动代理（Fail-Closed 模式）/g,
        'Manual proxy enabled (Fail-Closed mode)',
    ],
    [
        /已启用 Fail-Closed 启动流量闸门/g,
        'Fail-Closed startup traffic gate enabled',
    ],
    [
        /已启用 C\+\+ 纯原生隐匿模式（零扩展、零 JS Hook）[:：]\s*/g,
        'C++ native stealth enabled (zero extensions, zero JS hooks): ',
    ],
    [
        /已启用标准 Chrome 原生隐匿模式（零扩展、零 JS Hook）[:：]\s*/g,
        'Standard Chrome native stealth enabled (zero extensions, zero JS hooks): ',
    ],
    [
        /已分发\s*(\d+)\s*条书签模板（跳过重复\s*(\d+)\s*条）/g,
        'Distributed $1 bookmark template(s) ($2 duplicate(s) skipped)',
    ],
    [
        /将通过 CDP pipe 安装\s*(\d+)\s*个本地扩展模板/g,
        'Installing $1 local extension template(s) via CDP pipe',
    ],
    [/启用 CDP pipe（首次安装扩展）/g, 'Enabled CDP pipe (first-time extension install)'],
    [
        /已启用省内存启动策略（Memory Saver \+ 渲染进程与缓存上限）/g,
        'Memory Saver launch policy enabled (Memory Saver + renderer and cache caps)',
    ],
    [/使用 C\+\+ 指纹内核/g, 'Using privacy browser kernel'],
    [/启动前已解析代理出口[:：]\s*/g, 'Pre-launch proxy exit resolved: '],
    [
        /启动前未能解析代理 IP，已通过内核 Fail-Closed 策略防止首开泄露/g,
        'Pre-launch exit IP probe unresolved; kernel Fail-Closed policy protects first navigation',
    ],
    [/使用语言[:：]\s*/g, 'Language: '],
    [/（按代理地区\s*([^ ]+)\s*自动匹配）/g, ' (auto-matched to proxy region $1)'],
    [/（默认策略）/g, ' (default policy)'],
    [
        /未配置时区，已按代理 IP 自动匹配时区[:：]\s*/g,
        'No timezone configured; auto-matched to proxy IP: ',
    ],
    [/分配端口[:：]\s*/g, 'Assigned port: '],
    [
        /后台补测代理出口成功并已刷新[:：]\s*/g,
        'Background exit probe succeeded and refreshed: ',
    ],
    [
        /后台补测代理出口仍未返回，继续保持内核 Fail-Closed 防泄露保护/g,
        'Background exit IP probe did not respond; keeping kernel Fail-Closed leak protection',
    ],
    [
        /启动安全防护超时未就绪，已 Fail-Closed 阻断并终止本次启动/g,
        'Launch security guard timed out; Fail-Closed aborted launch',
    ],
    [/轮询确认运行中/g, 'Confirmed running via polling'],
    [/Chrome进程已强制关闭/g, 'Chrome process force-closed'],
    [/Chrome进程已关闭/g, 'Chrome process closed'],
    [/浏览器已关闭/g, 'Browser closed'],
    [
        /检测到Chrome环境进程已结束[:：]\s*/g,
        'Detected Chrome profile process exited: ',
    ],
    [
        /进程状态发生变化，通知前端更新[:：]\s*变化数量=/g,
        'Process state changed, notifying UI: count=',
    ],
    [
        /收到启动Chrome环境请求，环境ID[:：]\s*/g,
        'Received launch request for environment ID: ',
    ],
    [/环境已在运行[:：]\s*/g, 'Environment already running: '],
    [
        /已清理环境缓存\s*\(([^)]+)\):\s*释放\s*(\d+)\s*字节，清理目录数=(\d+)/g,
        'Cleared profile cache ($1): freed $2 bytes, removed $3 folder(s)',
    ],
    [/创建新环境[:：]\s*/g, 'Created profile: '],
    [/克隆环境[:：]\s*/g, 'Cloned profile: '],
    [/更新Chrome环境[:：]\s*/g, 'Updated Chrome environment: '],
    [/软删除Chrome环境[:：]\s*/g, 'Moved Chrome environment to trash: '],
    [/恢复Chrome环境[:：]\s*/g, 'Restored Chrome environment: '],
    [/永久删除Chrome环境[:：]\s*/g, 'Permanently deleted Chrome environment: '],
    [
        /清理回收站[:：]\s*删除了\s*(\d+)\s*个过期环境/g,
        'Trash cleanup: removed $1 expired environment(s)',
    ],
    [/重命名分组[:：]\s*/g, 'Renamed group: '],
    [/删除分组[:：]\s*/g, 'Deleted group: '],
    [/,\s*引擎=/g, ', engine='],
    [/,\s*新指纹种子=/g, ', newSeed='],
    [/,\s*指纹种子=/g, ', seed='],
    [/,\s*方式=/g, ', mode='],
    [/,\s*影响环境数=/g, ', affected='],
    [/,\s*目标分组=/g, ', targetGroup='],
    // Settings & database logs
    [/数据路径已更改[:：]\s*/g, 'Data path changed: '],
    [/设置已保存/g, 'Settings saved'],
    [
        /数据库已迁移[:：]\s*添加\s*(\w+)\s*列/g,
        'Database migrated: added $1 column',
    ],
    [/当前数据库列[:：]\s*/g, 'Current database columns: '],
    [/浏览器崩溃[:：]\s*/g, 'Browser crashed: '],
];

const TRAILING_FALLBACK_REPLACEMENTS: Array<[RegExp, string]> = [
    [/启动失败/g, 'Launch failed'],
    [/开始关闭/g, 'Stopping'],
];

/**
 * Translate common dynamic backend log / error messages when rendering in English.
 */
export function translateBackendMessage(
    message: string,
    locale: AppLocale,
): string {
    if (locale !== 'en-US' || !message || !/[\u4e00-\u9fff]/.test(message)) {
        return message;
    }

    const exact = EXACT_BACKEND_MESSAGES[message];
    if (exact) {
        return exact;
    }

    let translated = message;
    for (const [pattern, replacement] of BACKEND_TEMPLATE_REPLACEMENTS) {
        translated =
            typeof replacement === 'function'
                ? translated.replace(pattern, replacement)
                : translated.replace(pattern, replacement);
    }

    if (/[\u4e00-\u9fff]/.test(translated)) {
        for (const [pattern, replacement] of SORTED_EXACT_REPLACEMENTS) {
            translated = translated.replace(pattern, replacement);
        }
    }

    if (/[\u4e00-\u9fff]/.test(translated)) {
        for (const [pattern, replacement] of TRAILING_FALLBACK_REPLACEMENTS) {
            translated = translated.replace(pattern, replacement);
        }
    }

    return translated;
}

export function useI18n() {
    const ctx = useContext(I18nContext);
    const locale = ctx ? ctx.locale : getStoredLocale();
    const isEn = locale === 'en-US';
    const t = useCallback(
        (zh: string, en: string) => (isEn ? en : zh),
        [isEn],
    );
    const fallbackSetLocale = useCallback(async (next: AppLocale) => {
        saveStoredLocale(next);
    }, []);
    return {
        locale,
        isEn,
        setLocale: ctx ? ctx.setLocale : fallbackSetLocale,
        t,
    };
}
