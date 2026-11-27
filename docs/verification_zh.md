# 测试体系与平台核验（Verification）

[English](verification.md) · 简体中文

MultiChrome 采用四层测试结构，分别覆盖纯业务逻辑、离线安全与反检测对抗、界面冒烟以及外网真实检测站抽检。

## 1. 四层测试结构

| 层级 | 命令 | 定位与覆盖范围 |
| :--- | :--- | :--- |
| **L1 单元与集成测试** | `npm test`、`npm run test:coverage` | 验证领域策略、凭据恢复、代理和协议。测试及覆盖率以当前 CI 输出为准。 |
| **L2 核心安全与本地对抗 E2E** | `npm run test:e2e` | 使用本地模拟代理与泄露探针，覆盖 `fingerprint-chromium` 与官方 Chrome 双引擎：验证代理独占路由、断网 Fail-Closed 零直连泄露、WebRTC 零泄露、跨 `iframe` 原型链反 Hook（`lies=0`）、Canvas / Audio / DOMRect 同会话与跨重启确定性、以及默认 Google 搜索持久化。 |
| **L3 桌面与 MCP 客户端** | `npm run test:ui` | 使用隔离用户目录，验证窗口、设置、批量操作和本地客户端。按实际通过的场景 ID 统计结果。 |
| **L4 外网检测站抽检** | `npm run audit:live -- --proxy="<代理名>"` 或 `--env="<环境名>"` | 手动按需执行（不进入离线 CI）。使用 `--proxy` 时默认创建隔离临时环境，**分别实测 C++ 隐私指纹内核（`fingerprint-chromium`）与系统 Chrome 内核（`system-chrome`）**（可通过 `--engine=both\|fingerprint-chromium\|system-chrome` 指定），经由真实代理访问主流第三方检测站点复核真实表现。 |

使用自定义数据目录时，在当前工程的 `.tmp/e2e-data-dir.txt` 中写入该目录的绝对路径（单行 UTF-8）。L2 从该目录的内核清单选取可执行文件，测试环境继续使用临时目录。单次运行可用 `--kernel=<可执行文件>` 覆盖选择。使用 `npm run test:e2e -- --require-kernel` 可在未发现指纹内核时立即报错。

## 验收与发布要求

Windows 的 L2、L3 和 L4 通过表中的 npm 命令启动。日常账户默认只运行基础 CI。真浏览器测试使用 GitHub 托管 Windows VM，或在专用测试机上使用本地组 `MultiChromeTestRunners` 的专用账户（加入后重新登录）。专用账户需要有权读取 Security 日志，且系统须启用“登录”的失败审计和“用户账户管理”的成功审计。GitHub 作业会在临时 VM 内准备这些审计设置。

测试启动器对真实浏览器合并 Chromium 上游的两个自动填充测试开关，逐个放行新进程并记录 PID。遇到与浏览器 PID 匹配的 4625、测试账户的 4740 或无法核验日志，剩余启动会被阻断。已有窗口仍可同时运行。普通应用启动沿用用户的浏览器参数。[Chromium 缺陷记录](https://issues.chromium.org/issues/541310282)

- 常规代码变更运行 `npm run ci`，包含准备测试用 sing-box、Lint、类型检查、L1 和完整构建。离线测试启用 `SKIP_DOTENV=true` 与 `DOTENV_CONFIG_PATH=/dev/null`；使用临时用户目录和合成配置。
- 代理、内核、CDP、指纹或启动行为变更追加 L2；核心界面、弹窗或状态流转变更追加 L3。需要双内核验收时使用 `--require-kernel`，并在报告中核对两种引擎各自的实际检查。仅有系统 Chrome 结果时标为单内核。
- 更换内核或 sing-box、修改 WebRTC、语言、时区或指纹策略，或执行完整发版验收时，在真实受管代理下运行 L4。可用 `npm run audit:live -- --auto-proxies=1 --engine=both` 让两个临时环境共用一个可用代理。按内核和站点分别记录观测值、加载失败或 `CAPTCHA/Challenge`；遇到验证停止该站点检查。页面仅加载或未返回指标时记为未判定。报告中排除真实代理名、出口 IP、凭据和环境标识。
- 打标签前核对中英文 README 和相关文档，并在最后一次代码、版本或文档改动后重跑基础 CI、L2、L3 及适用的 L4。按项记录结果，适用门禁通过后再打标签。外站验证拦截单列，不能计为通过。推送前审查实际将发布的提交历史。推送标签后检查 CI、Windows、macOS、Linux 打包任务和 GitHub Release 产物。

## 2. 外网双内核抽检记录

2026-11-25 在 Windows 上通过 MCP 同时启动两个临时环境，共用一个受管代理。表格记录本次页面可读取的指标。

| 站点 | C++ 指纹内核 148.0.7778.215 | 系统 Chrome 157.0.8103.80 |
| --- | --- | --- |
| CreepJS | 0 Lies，0 Trash，Headless 0%，Stealth 0% | 0 Lies，0 Trash，Headless 0%，Stealth 0% |
| BrowserScan | 真实性 100%，Bot 未检出，WebRTC 显示 disabled | 真实性 100%，Bot 未检出，WebRTC 显示 disabled |
| BrowserLeaks WebRTC | 站点报告 No Leak | 站点报告 No Leak |
| PixelScan | 站点报告 inconsistent | 站点报告 inconsistent |

本次取得 8 组明确观测，其中 PixelScan 在两枚内核下均报告 `inconsistent`。遇到人机验证时应单列为 `CAPTCHA/Challenge`。新的版本、出口或站点页面需要单独验证。

## 3. 自动化构建与发布

- **CI 流水线（[ci.yml](../.github/workflows/ci.yml)）**：每次推送至 `main` 或提交 PR 时自动执行 `npm run check`、`npm run lint`、`npm run prepare:singbox`、`npm test` 与 `npm run build`，并同步更新仓库测试状态徽章。
- **Release 流水线（[release.yml](../.github/workflows/release.yml)）**：推送与 `package.json` 版本号一致的 `v*` 标签（如 `git tag -a v1.7.0 -m "MultiChrome v1.7.0" && git push origin v1.7.0`）后，自动完成发布前校验，并行构建 Windows (`.exe`)、macOS (`.dmg` / `.zip`)、Linux (`.AppImage` / `.deb`) 安装包，生成 `SHA256SUMS.txt` 与 SLSA 构建溯源证明并发布到 GitHub Releases。

## 本地客户端验收

Windows 界面套件使用固定版本的 MCP SDK 1.32.2、Playwright MCP 0.0.86 和 Chrome DevTools MCP 1.14.0。SDK 连接 HTTP 和 stdio、枚举四个工具并请求环境摘要。两个页面客户端连接环境专属地址并列出本地测试标签页。检查本次运行的 E2E-12 结果。

Windows 打包还会用 Node 启动解包后的 stdio 入口并枚举工具。离线 Electron 套件使用临时 SQLite 数据库、设置存储和虚构代理地址，验收旧配置读取、主动保存加密、密钥库不可用、恢复回滚与重试。
