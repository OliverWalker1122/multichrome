# 开发与构建指南（Development）

[English](development.md) · 简体中文

## 环境要求

- Node.js 22.23.4（与 CI 一致）
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

## 桌面界面规范

| 场景 | 实现约定 |
| --- | --- |
| 材质与间距 | 复用 [Win11 主题](../src/theme/win11Theme.ts) 和[语义颜色](../src/theme/semanticColors.css)。外壳、工作区、卡片分别使用 `--glass-shell`、`--glass-workspace`、`--glass-card`。标准卡片圆角 14px、内边距 16px 18px，边框为 1px `--glass-border`，阴影用 `--glass-shadow`。卡片内最多一层 `--glass-card-inner`（圆角 8–10px），小标签用 `--glass-pill`。 |
| 颜色与状态 | 分区图标用 24×24px、圆角 7px；图标和标签通过 `getToneStyle` 取语义色。在浅色、深色和强制颜色模式下检查可读性。成功、警告、失败和中性状态用 Fluent `Badge` 的 tint 样式，同时保留文字。 |
| 设置与说明 | 普通设置行最小高度 34px，左侧标签、右侧控件，使用 1px `colorNeutralStroke2` 分隔。原理、路径和参数放进 [InfoTip](../src/components/common/InfoTip.tsx)，避免同一说明同时出现在副标题和提示中。高级设置和接入示例默认折叠，右侧显示摘要，展开按钮同步更新 `aria-expanded`。 |
| 文案与操作 | 每个按钮和标题表达一个动作，例如“健康自检”或“导入本地文件”。协议名、参数和算法名放入提示或示例。避免用斜杠堆叠近义词。保留一个清晰的主要操作，次要操作用 subtle 按钮、带提示及可访问名称的图标，或更多菜单。即时生效的设置页仅在有待保存改动时显示保存动作。 |
| 布局与输入 | 代码示例放在单层内卡片，使用 `white-space: pre-wrap` 换行。窄窗口下检查操作列、弹窗与抽屉是否完整可用。保留可见键盘焦点，页签支持方向键、Home 和 End。过渡使用 100–140ms，并尊重 `prefers-reduced-motion`。 |

## 贡献约定

- 应用默认语言为英文（`en-US`），支持一键切换简体中文（`zh-CN`）。所有新增或修改的用户可见文案需同时提供中英双语（渲染层使用 `useI18n()`，主进程读取 `settings.locale`）。
- 提交与推送前请核查变更，避免包含真实代理节点、凭据、本地路径用户名或用户数据文件（详见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。
