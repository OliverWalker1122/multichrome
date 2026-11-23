<div align="center">

<img src="assets/icon.png" alt="MultiChrome" width="72" />

# MultiChrome

本地优先的跨平台多环境浏览器管理工具。

[![CI](https://github.com/OliverWalker1122/multichrome/actions/workflows/ci.yml/badge.svg)](https://github.com/OliverWalker1122/multichrome/actions/workflows/ci.yml)
[![Release](https://github.com/OliverWalker1122/multichrome/actions/workflows/release.yml/badge.svg)](https://github.com/OliverWalker1122/multichrome/actions/workflows/release.yml)
[![Tests](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OliverWalker1122/multichrome/badges/test-badge.json)](https://github.com/OliverWalker1122/multichrome/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/OliverWalker1122/multichrome.svg)](https://github.com/OliverWalker1122/multichrome/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/OliverWalker1122/multichrome)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](README_EN.md) · 简体中文

</div>

---

## 简介

MultiChrome 是一款基于 Electron 与 Fluent UI 构建的桌面端浏览器环境管理器，用于在一台设备上隔离并管理多个独立的浏览器配置、网络代理与运行环境。所有配置与凭据均保存在本地，不依赖云端服务。

## 主要功能

- **双浏览器引擎支持**：支持按环境选择系统官方 Google Chrome，或按需下载的开源 `fingerprint-chromium` 内核。
- **独立代理隔离**：基于 `sing-box` 提供托管代理管理，支持常见代理协议、批量导入、出口测活与复用提醒，代理异常时自动阻断直连回退。
- **环境一致性检查**：支持根据代理出口自动对齐时区、语言与地理位置，提供启动前一致性检查与健康自检面板。
- **多环境生命周期管理**：支持分组管理、环境克隆、回收站保护、运行态内存统计、缓存清理与模板分发。
- **标准 CDP 守卫与 MCP 接入**：内置默认关闭的本地 `127.0.0.1` 受保护 CDP 入口与极简环境启停 MCP，原生兼容 `@playwright/mcp`、`chrome-devtools-mcp` 与 Playwright，自动拦截外部对窗口尺寸、UA 与代理时区的误覆盖。
- **全本地存储与双语界面**：代理凭据经系统安全存储加密保存，内置实时外联日志审计，支持简体中文与英文即时切换，适配 Windows、macOS 与 Linux。

## 安装与使用

从 [Releases](https://github.com/OliverWalker1122/multichrome/releases) 下载对应平台安装包即可使用。应用内置运行环境，无需额外安装框架或运行库。

> 首次打开提示：本项目未购买商业代码签名证书。Windows 出现 SmartScreen 提示时点击「更多信息 → 仍要运行」；macOS 若提示无法验证开发者，可在「系统设置 → 隐私与安全性」中允许打开，或执行 `xattr -cr /Applications/MultiChrome.app`。

如需托管代理或自定义指纹内核，可在应用内 **「设置 → 核心与内核」** 中按需从官方 GitHub Releases 下载并校验，或手动导入本地构建版本。

如需从源码运行：

```bash
git clone https://github.com/OliverWalker1122/multichrome.git
cd multichrome
npm install
npm run dev
```

## 本地 UI 验证

运行 `npm run build` 后，用 `npm run test:ui` 在临时用户目录中启动真实 Electron 窗口，检查主要页面、交互流程，以及浅深主题在标准、降低透明度和强制颜色模式下的界面材质。

运行 `npm run test:ui -- --screenshots` 可额外保存浅色和深色主页到 `.tmp/ui-screenshots/home-light.png` 和 `home-dark.png`。两张图使用合成测试环境和固定底色，便于对照。

## 文档

- [架构与核心机制](docs/architecture.md) — 双引擎设计、Fail-Closed 代理策略、供应链校验与目录结构
- [测试体系与平台核验](docs/verification.md) — 四层测试说明、外部检测平台实测记录与自动发布流程
- [开发与构建指南](docs/development.md) — 本地开发、测试命令与三端打包说明
- [安全策略](SECURITY.md) — 安全模型与漏洞反馈方式
- [功能路线图](ROADMAP.md) — 已完成项与后续规划

## 许可证

本项目采用 [MIT License](LICENSE)。按需下载的第三方组件（`sing-box`、`fingerprint-chromium`）各自遵循其上游开源许可证。
