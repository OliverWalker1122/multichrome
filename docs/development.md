# Development & Packaging Guide

English · [简体中文](development_zh.md)

## Prerequisites

- Node.js 22.23.4 (the version used by CI)
- npm 9+
- Git

## Local Development

```bash
git clone https://github.com/OliverWalker1122/multichrome.git
cd multichrome

# Install dependencies
npm install

# Start Vite HMR renderer + Electron main process in development mode
npm run dev
```

## Verification Commands

```bash
# TypeScript type-checking
npm run check

# ESLint checks
npm run lint

# L1 unit, integration & architecture layering tests
npm test

# Production build (Vite renderer + Electron main process)
npm run build
```

To run the real `sing-box` integration tests in `tests/singboxCore.test.js` locally, download a SHA-256-verified test `sing-box` binary first (gitignored and excluded from release installers):

```bash
npm run prepare:singbox
npm test
```

## End-to-End & Live External Audits

```bash
# L2 offline E2E regression (dual-engine fail-closed routing + anti-detection checks)
npm run test:e2e

# Optional: run L2 against live local proxies (uses an isolated temp directory cleaned up on exit)
npm run test:e2e -- --live --proxy-a=http://127.0.0.1:10808 --proxy-b=http://127.0.0.1:10809

# L3 UI smoke suite (isolated temp userData; append -- --screenshots to capture light/dark home screenshots)
npm run test:ui

# L4 live external dual-engine fingerprint audit (manual on demand, excluded from CI)
npm run audit:live -- --proxy="MyProxy"
npm run audit:live -- --env="Profile-1"
```

## Building Platform Installers

Run `npm run build` before packaging:

```bash
npm run build

# Package for target OS (artifacts output to release/)
npm run package:win    # Windows x64 NSIS installer
npm run package:mac    # macOS .dmg / .zip
npm run package:linux  # Linux .AppImage / .deb
```

## Desktop UI conventions

| Area | Implementation |
| --- | --- |
| Materials and spacing | Reuse the [Win11 theme](../src/theme/win11Theme.ts) and [semantic colors](../src/theme/semanticColors.css). Use `--glass-shell`, `--glass-workspace` and `--glass-card` for their respective surfaces. Standard cards use a 14px radius, 16px 18px padding, a 1px `--glass-border` and `--glass-shadow`. Allow one inner surface with `--glass-card-inner` and an 8–10px radius. Use `--glass-pill` for chips. |
| Color and status | Use 24×24px section icons with a 7px radius. Apply semantic colors through `getToneStyle` to icons and chips. Check light, dark and forced-colors modes. Use tinted Fluent badges with text for success, warning, failure and neutral states. |
| Settings and help | Give ordinary settings rows a minimum height of 34px, a label on the left, a control on the right and a 1px `colorNeutralStroke2` divider. Put technical details in [InfoTip](../src/components/common/InfoTip.tsx). Keep advanced settings and connection examples collapsed initially, show a summary and update `aria-expanded` on the toggle. |
| Copy and actions | Give each title or button a single purpose, such as “Health check” or “Import local file”. Put protocol and algorithm details in help text or examples. Avoid slash-separated synonyms. Use a clear primary action and subtle buttons, accessible labeled icon buttons with tooltips, or an overflow menu for secondary actions. Show Save on immediate-effect tabs only when a draft has changes. |
| Layout and input | Show code in a single inner surface with `white-space: pre-wrap`. Verify action columns, dialogs and drawers at narrow widths. Keep keyboard focus visible and support arrows, Home and End on tabs. Use 100–140ms transitions and respect `prefers-reduced-motion`. |

## Contributor Notes

- The application defaults to English (`en-US`) and supports Simplified Chinese (`zh-CN`). All user-facing strings must provide both languages (`useI18n()` in the renderer and `settings.locale` in the main process).
- Before committing or pushing, verify that diffs contain no real proxy URIs/IPs, credentials, local OS usernames, or browser profile data (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
