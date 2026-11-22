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
- **C++ 纯原生零扩展隐匿**：`fingerprint-chromium` 环境默认不注入 JS 原型 Hook、不自动加载未打包扩展（除非用户在设置中显式开启），仅允许使用原生 CLI 参数、原生 `Preferences` 与底层 CDP Emulation（如时区/Geolocation）。
- **向后兼容**：不得破坏用户已有本地 SQLite 数据库或 `electron-store` 配置；新增列需做安全 `ALTER TABLE` 迁移，历史废弃列需在读取层安全兼容。
- **双语支持（i18n）**：所有新增或修改的用户可见文案必须同时提供中文与英文（渲染层使用 `useI18n()` 的 `t(zh, en)` 或 `tr(zh, en)`，主进程根据 `settings.locale` 区分 `zh-CN` / `en-US`）。
- **内部状态哨兵**：`'用户分组'` 为「全部环境」的内部状态值，仅在 UI 展示时翻译，不要修改其内部比较值。

---

## 3. 测试分层标准（四层测试金字塔）

| 层级 | 命令 | 脚本位置 | 定位与职责 | 何时运行 |
| :--- | :--- | :--- | :--- | :--- |
| **L1 单元测试（主力）** | `npm test` | `tests/*.test.js` | 验证纯业务逻辑、边界条件、数据解析与安全规则（秒级完成）。**90% 的新功能逻辑应下沉为纯 JS 模块（`electron/*.js`）并在此覆盖** | 每次修改必跑 |
| **L2 核心底盘 + 本地对抗 E2E** | `npm run test:e2e` | [scripts/e2e-verify.mjs](scripts/e2e-verify.mjs) + [scripts/e2e-electron.cjs](scripts/e2e-electron.cjs) | 离线验证**安全红线 + 类 CreepJS/BotD 本地对抗算法**：双代理零直连、Fail-Closed 断网阻断、WebRTC 零泄露、跨 `iframe` 原型链反 Hook（`lies=0`）、Canvas/Audio/DOMRect 同会话确定性、跨维度自洽、C++ 指纹隔离与持久化、默认 Google 搜索 | 修改代理、内核、CDP、指纹参数、启动逻辑或发版前必跑 |
| **L3 界面冒烟测试（UI Test）** | `npm run test:ui` | [scripts/e2e-ui-suite.mjs](scripts/e2e-ui-suite.mjs) | 隔离临时 `userData`（`MULTICHROME_USER_DATA`）拉起真实 Electron 窗口，验证核心页面渲染、关键交互弹窗、前后端状态同步与 0 未捕获 React/控制台异常 | 大改前端页面/交互、新增核心面板或发版前运行 |
| **L4 外网真站指纹抽检** | `npm run audit:live -- --env="<环境名>"` | [scripts/audit-live-sites.mjs](scripts/audit-live-sites.mjs) + [scripts/audit-live-sites-electron.cjs](scripts/audit-live-sites-electron.cjs) | 用真实本地环境走代理访问 **CreepJS、BrowserScan、BrowserLeaks WebRTC、PixelScan** 四大权威外部检测站，核验真站打分与实际风控表现（**不进离线 CI**） | 升级 Chromium 指纹内核 / sing-box 版本、改动 WebRTC/语言/时区/指纹策略、或发大版本前手动按需抽检 |

### 测试边界与安全红线
- L4 脚本禁止硬编码个人环境名或代理凭据（一律通过 `--env` 传参）；遇到 Cloudflare/Turnstile 等人机验证（如 PixelScan）必须如实报告 `CAPTCHA/Challenge` 并停止，**严禁自动绕过验证码**。

---

## 4. 交付与验收检查清单

1. **常规代码改动必跑**：
   - `npm run check`（TypeScript 类型检查，0 errors）
   - `npm run lint`（ESLint 检查，0 errors）
   - `npm test`（L1 单元测试）
   - `npm run build`（Vite 前端 + Electron 后端完整构建）
2. **涉及底层安全 / 代理 / 内核 / 指纹 / 启动逻辑**：额外运行 `npm run test:e2e`（L2）。
3. **涉及前端核心交互 / 弹窗 / 状态流转或发版前**：额外运行 `npm run test:ui`（L3）。
4. **诚实汇报验证范围**：汇报完成情况时如实区分已运行的验证层级（L1 / L2 / L3 / L4），未实际运行的层级不得宣称已完成实测。
