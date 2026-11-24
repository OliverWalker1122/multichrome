# 开发与构建指南（Development）

[English](development.md) · 简体中文

## 环境要求

- Node.js 20+
- npm 9+
- Git

## 本地开发

```bash
git clone https://github.com/OliverWalker1122/multichrome.git
cd multichrome

# 安装依赖
npm install

# 启动 Vite 前端热更新 + Electron 开发模式
npm run dev
```

## 常用校验命令

```bash
# TypeScript 类型检查
npm run check

# ESLint 代码规范检查
npm run lint

# L1 单元测试、集成测试与分层架构检查
npm test

# 完整生产构建（Vite 渲染进程 + Electron 主进程）
npm run build
```

如需在本地完整运行 `tests/singboxCore.test.js` 中的真实代理核心集成测试，可先临时拉取经 SHA-256 校验的测试用 `sing-box` 二进制（该目录已被 `.gitignore` 忽略，不会进入仓库或安装包）：

```bash
npm run prepare:singbox
npm test
```

## 端到端与真站抽检

```bash
# L2 离线端到端回归（双引擎 Fail-Closed + 反检测对抗）
npm run test:e2e

# 可选：指定外部本地代理执行 L2 线上模式（数据隔离在临时目录，结束后自动清理）
npm run test:e2e -- --live --proxy-a=http://127.0.0.1:10808 --proxy-b=http://127.0.0.1:10809

# L3 界面主流程冒烟测试（独立临时 userData；附加 -- --screenshots 可输出浅深主页对比截图）
npm run test:ui

# L4 外网真站双内核指纹抽检（手动按需执行，不进 CI；--proxy 默认分别实测 C++ 隐私内核与系统 Chrome 内核）
npm run audit:live -- --proxy="MyProxy"
npm run audit:live -- --env="Profile-1"
```

## 本地打包安装包

在执行打包前请先运行 `npm run build`：

```bash
npm run build

# 按目标平台打包（产物输出至 release/ 目录）
npm run package:win    # Windows x64 NSIS 安装包
npm run package:mac    # macOS .dmg / .zip
npm run package:linux  # Linux .AppImage / .deb
```

## 贡献约定

- 应用默认语言为英文（`en-US`），支持一键切换简体中文（`zh-CN`）。所有新增或修改的用户可见文案需同时提供中英双语（渲染层使用 `useI18n()`，主进程读取 `settings.locale`）。
- 提交与推送前请核查变更，避免包含真实代理节点、凭据、本地路径用户名或用户数据文件（详见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。
