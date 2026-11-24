# MultiChrome Agent Guidelines

## 1. 推送前隐私泄露检查（强制）

每次执行 `git push`（或准备提交对外推送）前，**必须**检查待提交与待推送的变更及历史，确认不包含任何隐私或敏感信息：

1. **代理与网络信息**：不得包含真实代理节点/订阅链接（`vless://`、`vmess://`、`trojan://`、`ss://`、`hy2://`、`tuic://`、`socks5://`、`http://user:pass@...`）、真实服务器 IP、私有域名、UUID 或代理鉴权凭据。
2. **密钥与账号凭据**：不得包含 API Key、Token、密码、私钥、Cookie、Session、`.env` 敏感配置或个人邮箱/手机号。
3. **本地环境与用户数据**：不得提交本地绝对路径中的真实用户名（如 `C:\Users\<name>\...`）、浏览器用户数据目录（`User Data` / SQLite 数据库 / 书签 / 历史记录）、运行日志、临时截图或测试导出的真实环境配置。
4. **核查方式**：推送前务必检查 `git status`、`git diff --cached` 以及待推送提交范围的 `git diff origin/<branch>..HEAD`，确认无敏感内容残留后再执行推送。

---

## 2. 产品定位与不可违背的底线

- **通用多环境指纹浏览器**：定位为开源、本地优先、Fail-Closed 代理防泄露、原生 C++ 隐匿的通用多环境浏览器。禁止在代码、字段或文案中引入特定垂类硬编码内容。
- **Fail-Closed 安全底线**：绑定代理时强制阻断直连回退、QUIC/UDP 绕过、本地 DNS 与 WebRTC 泄露；任何优化不得削弱此机制。
- **零 IP / DNS / WebRTC / 指纹泄露铁律**：涵盖首开瞬间、旧会话与缓存恢复、代理异常断连及外部 REST API / MCP 自动化调度全链路，强制贯彻 Fail-Closed 隔离与零宿主机特征暴露。
- **Profile 启动速度不劣化铁律**：严禁在环境启动关键路径引入同步阻塞扫描、重复系统密钥链（`safeStorage`）解密、串行冗余网络探测或额外子进程冷启动。
- **绝对正确性与零明文凭据铁律**：严禁静默吞错造假成功；严禁明文落盘代理节点、鉴权凭据或 API Token（加密不可用时直接拒绝而非降级明文）；严禁破坏 SQLite 与 `electron-store` 向后兼容；严禁在 API、MCP 响应或日志中回显未脱敏密钥。
- **外部自动化控制面（标准 CDP 透传守卫 & 极简环境 MCP）底线**：默认关闭；开启时强制仅监听 `127.0.0.1`，强制校验 `Host` 白名单并拒绝浏览器 `Origin` 请求头以防御跨站请求与 DNS Rebinding；内部 Chrome 调试端口迁离 `9222` 使用私有随机高端口防盲连错号。不重复造页面操作轮子（100% 兼容官方 `@playwright/mcp`、`chrome-devtools-mcp` 与原生 Playwright/Puppeteer），内置 MCP 仅保留环境查/启/停/切换，由轻量无状态 CDP 守卫统一防呆保护：**绑定 Fail-Closed 独立代理生命线（代理异常断连同步断开 CDP）+ 守住独立 C++ 指纹种子 + 静默忽略外部 `Emulation` 指纹/时区/语言/窗口尺寸覆盖指令 + 拦截无痕 `BrowserContext` 误创建防丢登录态（遇到人机验证交由人工处理，严禁绕过验证码）**。
- **C++ 纯原生零扩展隐匿**：`fingerprint-chromium` 环境默认不注入 JS 原型 Hook、不自动加载未打包扩展（除非用户在设置中显式开启），仅允许使用原生 CLI 参数、原生 `Preferences` 与底层 CDP Emulation（如时区/Geolocation）。
- **向后兼容**：不得破坏用户已有本地 SQLite 数据库或 `electron-store` 配置；新增列需做安全 `ALTER TABLE` 迁移，历史废弃列需在读取层安全兼容。
- **双语支持（i18n）**：所有新增或修改的用户可见文案必须同时提供中文与英文（渲染层使用 `useI18n()` 的 `t(zh, en)` 或 `tr(zh, en)`，主进程根据 `settings.locale` 区分 `zh-CN` / `en-US`）。
- **内部状态哨兵**：`'用户分组'` 为「全部环境」的内部状态值，仅在 UI 展示时翻译，不要修改其内部比较值。

---

## 3. UI/UX 设计与审美规范（强制遵循）

MultiChrome 确立了统一、克制、原生级的 **Windows 11 Fluent 2 + 轻量毛玻璃（Glassmorphism）** 桌面视觉体系。所有新增或修改的界面（含设置页、弹窗、抽屉、表格、详情面板）必须严格遵守，严禁回退为臃肿表单或堆叠说明墙：

1. **材质与层次纪律（禁止“盒套盒”）**：
   - 严格复用 [win11Theme.ts](src/theme/win11Theme.ts) 与 [semanticColors.css](src/theme/semanticColors.css) 的主题 token 和玻璃变量：`--glass-shell` → `--glass-workspace` → `--glass-card`（`borderRadius: 14px`、`padding: 16px 18px`、`border: 1px solid var(--glass-border)`、`boxShadow: var(--glass-shadow)`）→ `--glass-card-inner`（`borderRadius: 8px–10px`）→ `--glass-pill`。
   - **最多两层容器嵌套**（`--glass-card` 内最多一层 `--glass-card-inner`），严禁 `card → subPanel → codeBlock` 三层描边盒套盒，严禁在玻璃卡片内硬贴割裂的高对比实心灰底块或出现丑陋的横向滚动条裁断。
   - **克制使用语义色**：仅通过 `getToneStyle('blue' | 'teal' | 'violet' | 'amber' | 'green' | 'rose')` 给 `24×24`（`borderRadius: 7px`）的 `sectionIcon`、分组图标、协议/标签芯片着色；禁止额外装饰性小图标或高饱和大面积色块；必须完整适配浅色与深色模式（禁止硬编码浅/深色 hex）。

2. **极简呼吸感与渐进式披露（Zero Text Wall · InfoTip First）**：
   - **单行清爽设置行**：设置项统一使用单行 `row`（`minHeight: 34px`，左标签 + 右控件，中间用 `1px` `colorNeutralStroke2` 分隔线），**严禁在每个开关/输入框下堆砌大段灰色解释副标题（`rowDesc`）**，更不得同时写长副标题又挂 `<InfoTip>` 重复解释。
   - **解释收敛进 `<InfoTip>`**：原理说明、安全防线、路径与参数细节统一放进 [InfoTip.tsx](src/components/common/InfoTip.tsx)（`?` 悬浮提示），**严禁单独开辟大段「安全说明 / 科普 / Bullet 列表」卡片**（参考「设置 → 隐私 → 网络保护」）。
   - **低频/高阶区块默认折叠**：高级配置、接入代码片段等非核心常驻内容采用「右侧摘要 + `subtle` 展开/收起按钮（`ChevronDownRegular` / `ChevronUpRegular`）」折叠展示（参考「设置 → 隐私 → 设备伪装」），确保常规设置页默认一屏内即可完成核心操作、无压迫感。
   - **自然人话文案**：标题与选项名精炼直观（如「防关联浏览器」「代理引擎」「本地服务」），避免在主标题和开关名称上堆砌括号技术术语（如 `(/api/v1)`、`(Streamable HTTP)`、`SHA-256 + timingSafeEqual`），技术细节按需放入 `<InfoTip>` 或代码片段中。

3. **动作层级与控件克制**：
   - 保持清晰的主次按钮层级：次要操作优先使用 `appearance="subtle"`、带 `<Tooltip>` 的小图标按钮，或收纳至 `⋯`（`MoreHorizontalRegular`）`<Menu>`，**禁止同一行横排多个带边框的 `outline` 按钮**造成视觉噪音。
   - 与保存表单无关的即时生效页签（如「自动化与 MCP」「组件」「关于」）在无未保存表单改动（`!isDirty`）时，不显示无意义的禁用态「已保存」按钮。
   - 状态反馈使用 Fluent `Badge`（`appearance="tint"`：`success` / `warning` / `danger` / `subtle`）精准表达；命令/代码展示使用单层 `--glass-card-inner` 并配合 `whiteSpace: 'pre-wrap'` 自动换行，避免裁断与粗横滚条；动效统一克制在 `100–140ms` 并尊重 `prefers-reduced-motion`。

---

## 4. 测试分层标准（四层测试金字塔）

| 层级 | 命令 | 脚本位置 | 定位与职责 | 何时运行 |
| :--- | :--- | :--- | :--- | :--- |
| **L1 单元测试（主力）** | `npm test` | `tests/*.test.js` | 验证纯业务逻辑、边界条件、数据解析与安全规则（秒级完成）。**90% 的新功能逻辑应下沉为按职责分层的纯 JS 模块（`electron/<layer>/*.js`）并在此覆盖** | 每次修改必跑 |
| **L2 核心底盘 + 本地对抗 E2E** | `npm run test:e2e` | [scripts/e2e-verify.mjs](scripts/e2e-verify.mjs) + [scripts/e2e-electron.cjs](scripts/e2e-electron.cjs) | 离线验证**安全红线 + 类 CreepJS/BotD 本地对抗算法**：双代理零直连、Fail-Closed 断网阻断、WebRTC 零泄露、跨 `iframe` 原型链反 Hook（`lies=0`）、Canvas/Audio/DOMRect 同会话确定性、跨维度自洽、C++ 指纹隔离与持久化、默认 Google 搜索 | 修改代理、内核、CDP、指纹参数、启动逻辑或发版前必跑 |
| **L3 界面冒烟测试（UI Test）** | `npm run test:ui` | [scripts/e2e-ui-suite.mjs](scripts/e2e-ui-suite.mjs) | 隔离临时 `userData`（`MULTICHROME_USER_DATA`）拉起真实 Electron 窗口，验证核心页面渲染、关键交互弹窗、前后端状态同步与 0 未捕获 React/控制台异常 | 大改前端页面/交互、新增核心面板或发版前运行 |
| **L4 外网真站指纹抽检** | `npm run audit:live -- --proxy="<代理名>"`（默认双内核分别实测）或 `--env="<环境名>"` | [scripts/audit-live-sites.mjs](scripts/audit-live-sites.mjs) + [scripts/audit-live-sites-electron.cjs](scripts/audit-live-sites-electron.cjs) | 基于指定内置代理创建隔离临时环境，默认**分别实测 C++ 隐私指纹内核（`fingerprint-chromium`）与系统 Chrome 内核（`system-chrome`）**（支持 `--engine=both\|fingerprint-chromium\|system-chrome`），或指定本地环境，走代理访问 **CreepJS、BrowserScan、BrowserLeaks WebRTC、PixelScan** 四大权威外部检测站，分内核汇报真站打分与风控表现（**不进离线 CI**） | 升级 Chromium 指纹内核 / sing-box 版本、改动 WebRTC/语言/时区/指纹策略、或发大版本前手动按需抽检 |

### 测试边界与安全红线
- L4 脚本禁止硬编码个人环境名、内置代理名或代理凭据（一律通过 `--env` / `--proxy` 传参）；报告 L4 结果时必须明确区分 **C++ 隐私指纹内核（`fingerprint-chromium`）** 与 **系统 Chrome 内核（`system-chrome`）** 并分别实测，严禁混为一谈；遇到 Cloudflare/Turnstile 等人机验证（如 PixelScan）必须如实报告 `CAPTCHA/Challenge` 并停止，**严禁自动绕过验证码**。

---

## 5. 交付、发版与打 Tag 前置门禁（强制）

1. **常规代码改动必跑**：
   - `npm run check`（TypeScript 类型检查，0 errors）
   - `npm run lint`（ESLint 检查，0 errors）
   - `npm test`（L1 单元测试）
   - `npm run build`（Vite 前端 + Electron 后端完整构建）
2. **涉及底层安全 / 代理 / 内核 / 指纹 / 启动逻辑**：额外运行 `npm run test:e2e`（L2）。
3. **涉及前端核心交互 / 弹窗 / 状态流转**：额外运行 `npm run test:ui`（L3）。
4. **每次打新 Tag / 发版前（强制全套门禁）**：
   - **文档同步核查**：逐一核对并按需更新 [README.md](README.md)、[README_EN.md](README_EN.md) 及相关 `docs/` 文档，确保新增功能、架构说明、测试命令、版本号与当前代码保持一致。
   - **基于最终待发版代码全量复测**：在最后一次代码/版本号/文档修改完成后，**必须完整执行全套测试**（`npm run check`、`npm run lint`、`npm test`、`npm run build`、`npm run test:e2e`、`npm run test:ui`；如涉及内核/代理/指纹改动或完整发版验收，同步运行双内核 L4 `npm run audit:live -- --proxy="<代理名>"` 分别验证 C++ 隐私内核与系统 Chrome 内核），全部通过后才允许打 Tag。
   - **推送与发布核验**：推送前严格执行第 1 节隐私泄露检查；推送 Tag 后持续检查 GitHub Actions（CI + 三端打包）与 GitHub Release 产物是否全部成功。
5. **诚实汇报验证范围**：汇报完成情况时如实区分已运行的验证层级（L1 / L2 / L3 / L4），未实际运行的层级不得宣称已完成实测。
