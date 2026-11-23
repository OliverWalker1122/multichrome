# 架构与核心机制（Architecture）

本文档说明 MultiChrome 的底层设计原则、浏览器与代理隔离机制以及代码目录结构。

## 1. 安全分级双引擎

MultiChrome 允许按环境粒度选择两种浏览器内核：

| 引擎 | 适用场景 | 核心机制 |
| :--- | :--- | :--- |
| **Google 官方 Chrome** | 高安全要求的敏感业务与主账号 | 直接调用宿主机官方签名 Chrome，具备完整的官方安全更新链路；通过独立 `user-data-dir`、代理隔离与 CDP Emulation（时区/语言/地理位置）实现环境隔离 |
| **C++ 指纹内核（`fingerprint-chromium`）** | 需要硬件与渲染层指纹隔离的多环境场景 | 为每个环境持久化独立 32-bit 确定性种子，在浏览器 C++ 原生层完成 Canvas / WebGL / Audio / Fonts / ClientRects / 硬件参数隔离；默认采用**纯原生零扩展模式**（不自动加载未打包扩展，不注入 JS 原型链 Hook），并自动将 Ungoogled Chromium 默认搜索引擎从 `No Search` 调整为 Google 搜索 |

## 2. Fail-Closed 代理防泄露机制

托管代理由按需下载的 `SagerNet/sing-box` 驱动，支持 HTTP、SOCKS5、VLESS、VMess、Trojan、Shadowsocks、Hysteria2 与 TUIC 协议。为避免网络波动时暴露本机真实 IP，系统在浏览器与代理两层实施 Fail-Closed 约束：

- **禁止直连回退**：托管代理配置中不包含 `direct` 出口回退规则；上游断开或进程异常退出时直接阻断流量。
- **阻断 UDP / QUIC 绕过**：启动参数强制注入 `--disable-quic`，并在浏览器 `Preferences` 中锁定 WebRTC 策略为 `disable_non_proxied_udp`。
- **远程 DNS 解析**：域名解析经由代理隧道在远端完成，避免本地 DNS 泄露。
- **凭据加密与审计**：代理配置中的敏感凭据通过 Electron `safeStorage` 加密存储；应用底部日志面板实时展示代理外联目标域名，后台运行日志默认做脱敏处理。

## 3. 环境一致性与健康自检

- **自动对齐**：未手动指定时区时，启动前会通过代理探测出口 IP 并自动匹配对应 IANA 时区（同步覆盖页面主线程与 Web Worker）；语言默认使用纯净 `en-US`，可选开启「跟随代理出口地区自动匹配语言」；地理位置（Geolocation）支持按需启用覆盖。
- **启动前防呆护栏**：启动前自动核验内核就绪状态、绑定代理状态以及时区/语言与出口地区的一致性；发现冲突时提供一键自动对齐修复。
- **强制健康自检**：可在「设置」中开启「启动前强制执行健康自检」，每次启动前自动完成代理与出口 IP、时区/Geolocation、语言策略、WebRTC & DNS 防泄露、内核状态五项核验，确认后再决定是否继续启动。

## 4. 供应链安全与 SHA-256 校验

- 仓库与安装包**不捆绑**任何第三方二进制文件。
- `sing-box` 与 `fingerprint-chromium` 均由用户在应用「设置 → 核心与内核」内按需下载，仅允许通过 HTTPS 访问 GitHub 官方域名白名单，并在解压前强制比对 GitHub Release 官方 SHA-256 摘要；校验不通过将立即中止并清理临时文件。
- 所有下载的内核统一存放于 `<数据目录>/kernels/`，与环境数据 `<数据目录>/environments/` 保持同一目录树，便于整体备份与迁移。

## 5. 标准 CDP 透传守卫与极简环境 MCP

为让 Claude Code、Cursor、Antigravity 等 AI Agent 及 Playwright / Puppeteer 脚本安全复用防关联环境，MultiChrome 采用**零造轮子、100% 兼容业界标准**的轻量控制面（默认关闭，开启后仅绑定 `127.0.0.1`，默认端口 `18922`）：

- **轻量无状态 CDP 透传守卫（`cdpGuard.js`）**：对外提供标准 `/json/version`、`/json/list` 与 WebSocket 转发，可直接接入官方 `@playwright/mcp`（`--cdp-endpoint`）、`chrome-devtools-mcp`（`--browserUrl`）及 `chromium.connectOverCDP`。守卫原样直通标准页面操控指令，仅静默吸收会破坏环境一致性的外部覆盖指令（`Emulation.setUserAgentOverride`、`Network.setUserAgentOverride`、`setTimezoneOverride`、`setLocaleOverride`、`setGeolocationOverride`、`setDeviceMetricsOverride`），拦截误创建空白无痕上下文的 `Target.createBrowserContext`（引导复用 `browser.contexts()[0]` 登录态），并在绑定的 `sing-box` 代理异常断开时毫秒级同步掐断 CDP 会话。
- **私有调试端口与防连错号防呆**：浏览器内部真实调试端口迁离 `9222` 改用私有随机端口（避免外部工具无参盲连误伤主力环境），且不在外部接口回显；仅单环境运行时自动命中，多环境同时运行时强制要求指定目标环境。
- **极简环境调度 MCP（`POST /mcp` & `stdio` 桥接）**：不重复实现页面点击/填表轮子，仅保留官方单浏览器 MCP 缺失的 4 个多环境编排工具（`list_profiles`、`start_profile`、`stop_profile`、`switch_active_profile`，支持直接按环境名称或 UUID 调用）及对应本地 HTTP 辅助接口（`/api/v1/profiles`、`/api/v1/profiles/start` 等）。
- **防跨站请求与 DNS Rebinding**：严格校验 `Host` 仅允许 `127.0.0.1` / `localhost`（含绑定端口），并拒绝任何携带浏览器 `Origin` 请求头的 HTTP 与 WebSocket 升级请求（`403`），所有响应对代理凭据与本地路径自动脱敏。

## 6. 多协议单行与批量代理 URI 导入

- **统一多协议 URI 解析**：在保留基础 `http://`、`https://`、`socks5://` 及 `host:port[:user:pass]` 单行与批量格式完全兼容的同时，支持直接解析标准单行及批量分享链接，覆盖 `vless://`、`vmess://`、`trojan://`、`ss://`、`hy2://`（含 `hysteria2://`）与 `tuic://`（含 TLS / Reality / uTLS / 常见传输层参数）。
- **命名、查重与安全落盘**：批量导入支持显式命名（`名称 | URI`）与 URI `#remark` 片段自动提取，生成稳定的端点查重键；高级 URI 经 `sing-box` 配置规范化与校验（严禁生成 `direct` 回退出口）后，全程经 `safeStorage` 加密存储，避免明文节点或凭据落盘。

## 7. 目录结构

```text
multichrome/
├── electron/
│   ├── main.ts                 # Electron 主进程、托盘/菜单双语与 IPC 路由
│   ├── preload.cjs             # contextBridge 预加载脚本
│   ├── chromeManager.ts        # 环境管理、双引擎启动、资源治理与自检编排
│   ├── kernelManager.js        # sing-box & fingerprint-chromium 官方下载与 SHA-256 校验
│   ├── githubProxyTransport.js # GitHub 官方域名白名单与 HTTP/HTTPS/SOCKS5 代理通道
│   ├── fingerprintProfile.js   # 持久化指纹种子与设备配置生成
│   ├── healthCheck.js          # 五维健康自检引擎
│   ├── launchGuard.js          # 启动前一致性校验
│   ├── cdpManager.ts           # CDP 会话与原生 V8 Emulation 管理
│   ├── cdpGuard.js             # 轻量无状态 CDP 透传守卫（防指纹篡改与代理断连熔断）
│   ├── automationConfig.js     # 本地服务配置、回环请求校验、端口探测与数据脱敏
│   ├── automationServer.js     # 本地 127.0.0.1 标准 CDP 入口、/mcp 与辅助 HTTP 路由
│   ├── automationIntegration.js# 多环境目标切换、Fail-Closed 代理联动与 IPC 桥接
│   ├── mcpServer.js            # Streamable HTTP MCP 协议与 4 个极简环境调度工具
│   ├── mcpStdioBridge.js       # 标准输入输出 MCP 桥接适配器
│   ├── proxyManager.js         # 加密代理管理与进程生命周期
│   ├── proxyUriParser.js       # 多协议分享链接 (VLESS/VMess/Trojan/SS/Hy2/TUIC) 解析
│   ├── proxyBatch.js           # 批量代理文本解析
│   ├── singboxCore.js          # sing-box 子进程封装
│   ├── singboxConfig.js        # sing-box 配置校验、脱敏与 Fail-Closed 构建
│   ├── managedProxyArgs.js     # 浏览器 Fail-Closed 参数与 Preferences 锁
│   ├── proxyGeo.js             # 出口 IP / 时区 / 语言探测
│   ├── groupOperations.js      # 分组重命名与删除迁移逻辑
│   ├── processMetrics.js       # 浏览器进程内存统计
│   ├── profileStorage.js       # Profile 体积统计与缓存清理
│   ├── profileTemplates.js     # 书签与扩展模板同步
│   ├── startupUrl.js           # 启动页智能去重
│   └── settingsManager.ts      # 应用配置与语言持久化
├── src/                        # React 18 + TypeScript + Fluent UI v9 渲染层（含 src/i18n）
├── tests/                      # L1 Node.js 单元与集成测试
├── scripts/                    # E2E、UI 冒烟、外网抽检与本地打包脚本
├── resources/sing-box/         # 官方版本校验清单与许可声明（不含二进制）
└── docs/                       # 项目文档
```
