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

- **轻量无状态 CDP 透传守卫（`cdpGuardRelay.js` + `cdpGuardPolicy.js`）**：对外提供标准 `/json/version`、`/json/list` 与 WebSocket 转发，可直接接入官方 `@playwright/mcp`（`--cdp-endpoint`）、`chrome-devtools-mcp`（`--browserUrl`）及 `chromium.connectOverCDP`。守卫原样直通标准页面操控指令，仅静默吸收会破坏环境一致性的外部覆盖指令（`Emulation.setUserAgentOverride`、`Network.setUserAgentOverride`、`setTimezoneOverride`、`setLocaleOverride`、`setGeolocationOverride`、`setDeviceMetricsOverride`），拦截误创建空白无痕上下文的 `Target.createBrowserContext`（引导复用 `browser.contexts()[0]` 登录态），并在绑定的 `sing-box` 代理异常断开时毫秒级同步掐断 CDP 会话。
- **私有调试端口与防连错号防呆**：浏览器内部真实调试端口迁离 `9222` 改用私有随机端口（避免外部工具无参盲连误伤主力环境），且不在外部接口回显；仅单环境运行时自动命中，多环境同时运行时强制要求指定目标环境。
- **极简环境调度 MCP（`POST /mcp` & `stdio` 桥接）**：不重复实现页面点击/填表轮子，仅保留官方单浏览器 MCP 缺失的 4 个多环境编排工具（`list_profiles`、`start_profile`、`stop_profile`、`switch_active_profile`，支持直接按环境名称或 UUID 调用）及对应本地 HTTP 辅助接口（`/api/v1/profiles`、`/api/v1/profiles/start` 等）。
- **防跨站请求与 DNS Rebinding**：严格校验 `Host` 仅允许 `127.0.0.1` / `localhost`（含绑定端口），并拒绝任何携带浏览器 `Origin` 请求头的 HTTP 与 WebSocket 升级请求（`403`），所有响应对代理凭据与本地路径自动脱敏。

## 6. 多协议单行与批量代理 URI 导入

- **统一多协议 URI 解析**：在保留基础 `http://`、`https://`、`socks5://` 及 `host:port[:user:pass]` 单行与批量格式完全兼容的同时，支持直接解析标准单行及批量分享链接，覆盖 `vless://`、`vmess://`、`trojan://`、`ss://`、`hy2://`（含 `hysteria2://`）与 `tuic://`（含 TLS / Reality / uTLS / 常见传输层参数）。
- **命名、查重与安全落盘**：批量导入支持显式命名（`名称 | URI`）与 URI `#remark` 片段自动提取，生成稳定的端点查重键；高级 URI 经 `sing-box` 配置规范化与校验（严禁生成 `direct` 回退出口）后，全程经 `safeStorage` 加密存储，避免明文节点或凭据落盘。

## 7. 自底向上纵向分层架构（Bottom-Up Vertical Layering）

主进程（`electron/`）与渲染层（`src/`）均遵循**严格单向依赖原则（上层依赖下层，下层对上层零感知）**，并由 [architectureLayering.test.js](../tests/architectureLayering.test.js) 在 CI 中自动校验，防止跨层穿透与架构退化：

```text
multichrome/
├── electron/                               # 主进程：5 层自底向上单向依赖架构
│   ├── domain/                             # [L0 纯领域核心层] 零 I/O、零 Electron、零 SQLite 纯函数规则
│   │   ├── fingerprintProfile.js           #   32-bit 持久化指纹种子与设备特征生成
│   │   ├── managedProxyArgs.js             #   Fail-Closed 启动参数与 WebRTC 策略锁
│   │   ├── singboxConfig.js                #   sing-box 配置校验、脱敏与禁直连构建
│   │   ├── proxyUriParser.js               #   VLESS/VMess/Trojan/SS/Hy2/TUIC 分享链接解析
│   │   ├── proxyBatch.js                   #   多行批量代理文本解析与查重
│   │   ├── proxyGeo.js                     #   出口国家、IANA 时区与语言映射
│   │   ├── launchGuard.js                  #   启动前地区/时区/内核一致性评估
│   │   ├── healthCheck.js                  #   五维防泄露与指纹健康评估
│   │   ├── environmentTags.js              #   多标签归一化与 AND/OR 筛选规则
│   │   ├── groupPolicy.js                  #   分组重命名与删除校验规则
│   │   ├── startupUrlPolicy.js             #   启动页规范化与会话去重决策
│   │   ├── profileTemplatePolicy.js        #   书签合并、扩展模板与启动页优先级规则
│   │   ├── processMetrics.js               #   浏览器进程输出解析、内存聚合与省内存参数
│   │   ├── automationPolicy.js             #   回环安全校验、输入验证与响应脱敏规则
│   │   ├── cdpGuardPolicy.js               #   CDP 覆盖指令拦截与路由重写规则
│   │   ├── kernelPolicy.js                 #   SHA-256 强制校验与受控推荐版本策略
│   │   └── kernelManifest.json             #   官方版本白名单与 SHA-256 摘要清单
│   ├── repositories/                       # [L1a 持久化仓储层] 封装 SQLite / safeStorage / electron-store
│   │   ├── environmentRepository.ts        #   SQLite 环境建表、兼容迁移与 CRUD 仓储
│   │   ├── groupRepository.js              #   分组批量迁移与软删除 SQL 操作
│   │   ├── proxyRepository.js              #   safeStorage 加密代理存取与脱敏摘要缓存
│   │   ├── settingsRepository.ts           #   应用偏好、模板与默认指纹策略存储
│   │   └── automationConfigRepository.js   #   本地自动化控制面配置持久化
│   ├── drivers/                            # [L1b 外部进程与协议驱动层] OS / FS / 子进程 / 网络协议适配
│   │   ├── singboxCore.js                  #   sing-box 子进程守护与日志脱敏诊断
│   │   ├── cdpManager.ts                   #   CDP WebSocket 会话与原生 V8 Emulation 驱动
│   │   ├── portAllocator.js                #   回环端口探测与私有随机高调试端口分配池
│   │   ├── browserProcessScanner.ts        #   宿主机浏览器进程扫描、内存采样与强杀兜底
│   │   ├── proxyStartupGate.js             #   标准 Chrome 启动流量闸门（防恢复标签抢跑泄露）
│   │   ├── proxyProbeClient.js             #   HTTP/SOCKS5 分阶段 Geo 与 IP 探测客户端
│   │   ├── proxyExitProbe.js               #   托管代理出口探测驱动
│   │   ├── githubProxyTransport.js         #   GitHub 官方域名白名单与代理下载传输
│   │   ├── chromeDiscovery.js              #   跨平台官方 Google Chrome 路径探测
│   │   ├── nativePreferences.js            #   原生 Chromium Preferences 防泄露与语言落盘
│   │   ├── extensionPipeLoader.js          #   --remote-debugging-pipe 解压扩展安装驱动
│   │   ├── profileLock.js                  #   本地目录锁与运行态快速探活
│   │   ├── profileStorage.js               #   Profile 磁盘占用统计与安全清缓存
│   │   └── profileTemplateDriver.js        #   书签文件写入、扩展清单校验与会话文件探测
│   ├── services/                           # [L2 应用用例编排层] 零 BrowserWindow / 零 ipcMain / 零裸 SQL
│   │   ├── environmentService.ts           #   环境生命周期、克隆、分组、回收站与健康自检编排
│   │   ├── browserLaunchService.ts         #   双引擎启动、流量闸门握手、CDP 挂载与状态监控编排
│   │   ├── proxyService.js                 #   托管代理通道池、闲置/休眠自愈与出口探测编排
│   │   ├── proxyCoordinator.js             #   代理变更与多环境并发启动互斥协调器
│   │   ├── kernelService.js                #   fingerprint-chromium 与 sing-box 下载/解压/导入服务
│   │   └── automationService.js            #   多环境活动目标切换、代理断连联动与控制面生命周期
│   ├── ipc/                                # [L3a 渲染进程 IPC 接入层] 100% 收敛 ipcMain.handle 路由
│   │   ├── index.ts                        #   统一 IPC 路由装配入口
│   │   ├── validators.ts                   #   UUID、字符串与配置载荷清洗校验
│   │   ├── environmentIpc.ts               #   环境、分组、回收站、存储与健康自检 IPC
│   │   ├── proxyIpc.js                     #   托管代理管理与日志 IPC
│   │   ├── automationIpc.js                #   自动化控制面配置与活动环境切换 IPC
│   │   └── systemIpc.ts                    #   设置、内核管理、主题与版本检查 IPC
│   ├── transport/                          # [L3b 外部本地控制面传输层] 127.0.0.1 HTTP / WS / MCP / Stdio
│   │   ├── automationServer.js             #   本地回环 HTTP / WebSocket 守卫服务入口
│   │   ├── cdpGuardRelay.js                #   无状态 CDP WebSocket 透传守卫中继
│   │   ├── mcpServer.js                    #   Streamable HTTP MCP 与 4 项极简环境工具
│   │   └── mcpStdioBridge.js               #   stdio MCP 桥接适配器
│   ├── app/                                # [L3c Electron 宿主壳层]
│   │   ├── windowManager.ts                #   主窗口创建、CSP 安全头、退出确认与状态广播转发
│   │   ├── trayManager.ts                  #   系统托盘与中英双语菜单管理
│   │   └── applicationLogs.js              #   内存脱敏日志缓冲
│   ├── preload.cjs                         # 沙盒隔离 contextBridge 预加载层
│   └── main.ts                             # [L4 组合根 Composition Root] 依赖注入装配与优雅退出
├── src/                                    # 渲染层：4 层自底向上单向依赖架构
│   ├── types/ utils/ theme/ i18n/          # [L0 原子基础层] 类型契约、纯工具函数、Fluent 2 语义色与双语词典
│   ├── components/common/                  # [L0 通用基础控件] InfoTip、TagEditor、RunStatusFilter 等无业务耦合组件
│   ├── services/                           # [L1 前端 IPC 数据网关层] 唯一允许访问 window.electronAPI 的类型化封装
│   ├── contexts/ & hooks/                  # [L2 状态与交互编排层] 全局 Context 与页面筛选/排序/批量操作控制器 Hook
│   ├── components/{layout,environments,proxies,settings}/ # [L3 页面与业务视图层] 按域拆分的轻量化视图、表格行与抽屉弹窗
│   └── App.tsx                             # [L3 应用壳层装配]
├── tests/                                  # L1 单元、真实 sing-box 集成与架构分层防退化测试
├── scripts/                                # 构建辅助、L2 E2E、L3 UI 冒烟、L4 真站抽检与打包脚本
├── resources/sing-box/                     # 上游许可证声明（不含二进制）
└── docs/                                   # 架构、测试与开发文档
```
