# 测试体系与平台核验（Verification）

[English](verification.md) · 简体中文

MultiChrome 采用四层测试结构，分别覆盖纯业务逻辑、离线安全与反检测对抗、界面冒烟以及外网真实检测站抽检。

## 1. 四层测试结构

| 层级 | 命令 | 定位与覆盖范围 |
| :--- | :--- | :--- |
| **L1 单元测试** | `npm test` | 验证纯业务逻辑、边界条件、安全规则、纵向架构单向依赖与真实 `sing-box` 核心隔离，涵盖 Fail-Closed 参数、WebRTC 锁定、GeoIP 时区/语言、健康自检、启动护栏、分组操作、批量代理导入、内存统计与 SHA-256 校验。每次推送与 PR 由 [CI 流水线](../.github/workflows/ci.yml) 在 Ubuntu 与 Windows 双平台自动运行。 |
| **L2 核心安全与本地对抗 E2E** | `npm run test:e2e` | **完全离线运行，无需真实代理**。使用本地模拟代理与泄密陷阱，覆盖 `fingerprint-chromium` 与官方 Chrome 双引擎：验证代理独占路由、断网 Fail-Closed 零直连泄露、WebRTC 零泄露、跨 `iframe` 原型链反 Hook（`lies=0`）、Canvas / Audio / DOMRect 同会话与跨重启确定性、以及默认 Google 搜索持久化。 |
| **L3 界面冒烟测试** | `npm run test:ui` | 通过 `MULTICHROME_USER_DATA` 使用隔离临时目录拉起真实 Electron 窗口，验证默认英文启动、即时切换中文、核心页面渲染、关键交互弹窗、标准 CDP 守卫/MCP 以及 0 未捕获 React / 控制台异常。 |
| **L4 外网检测站抽检** | `npm run audit:live -- --proxy="<代理名>"` 或 `--env="<环境名>"` | 手动按需执行（不进入离线 CI）。使用 `--proxy` 时默认创建隔离临时环境，**分别实测 C++ 隐私指纹内核（`fingerprint-chromium`）与系统 Chrome 内核（`system-chrome`）**（可通过 `--engine=both\|fingerprint-chromium\|system-chrome` 指定），经由真实代理访问主流第三方检测站点复核真实表现。 |

## 2. 第三方检测平台双内核核验记录

使用 `npm run audit:live -- --proxy="<代理名>"` 分别对 **C++ 隐私指纹内核（`fingerprint-chromium`）** 与 **系统 Chrome 内核（`system-chrome`）** 经由托管 `sing-box` 代理执行实测，结果如下：

| 平台 | C++ 隐私指纹内核 (`fingerprint-chromium`) | 系统 Chrome 内核 (`system-chrome`) | 观察指标 |
| :--- | :--- | :--- | :--- |
| **BrowserScan** | `100%` / `Bot: No` / `WebRTC: disabled` | `100%` / `Bot: No` / `WebRTC: disabled` | 均未检出自动化或反检测异常，时区、语言、WebRTC 与代理地区一致 |
| **CreepJS** | `0 Lies` / `0 Trash` / `0% Headless` / `0% Stealth` | `0 Lies` / `0 Trash` / `0% Headless` / `0% Stealth` | 零 JS 原型链 Hook 与扩展特征（`Resistance` 全部 `unknown`）；主线程与 Web Worker 的时区、语言/Intl、WebGL GPU 一致；C++ 内核额外具备独立伪装 GPU 与确定性指纹种子 |
| **BrowserLeaks (WebRTC)** | `No Leak`（Local/Public/IPv6 均 `-`） | `No Leak`（Local/Public/IPv6 均 `-`） | 未暴露宿主机局域网 IP 或真实公网 IP |
| **PixelScan** | `CAPTCHA/Challenge` | `CAPTCHA/Challenge` | 站点启用了 Cloudflare Turnstile 验证；本项目遵循不自动绕过验证码原则，自动化脚本如实报告验证拦截，用户可在客户端内启动环境后手动完成勾选验证 |

> 说明：上述结果为默认纯原生零扩展模式下的双内核分测表现。检测站规则会随时间更新，如手动加载第三方浏览器扩展或更改底层参数，实际结果会随之变化。

## 3. 自动化构建与发布

- **CI 流水线（[ci.yml](../.github/workflows/ci.yml)）**：每次推送至 `main` 或提交 PR 时自动执行 `npm run check`、`npm run lint`、`npm run prepare:singbox`、`npm test` 与 `npm run build`，并同步更新仓库测试状态徽章。
- **Release 流水线（[release.yml](../.github/workflows/release.yml)）**：推送与 `package.json` 版本号一致的 `v*` 标签（如 `git tag -a v1.4.0 -m "MultiChrome v1.4.0" && git push origin v1.4.0`）后，自动完成发布前校验，并行构建 Windows (`.exe`)、macOS (`.dmg` / `.zip`)、Linux (`.AppImage` / `.deb`) 安装包，生成 `SHA256SUMS.txt` 并发布到 GitHub Releases。
