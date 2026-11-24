# Development & Packaging Guide

English · [简体中文](development_zh.md)

## Prerequisites

- Node.js 20+
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

## Contributor Notes

- The application defaults to English (`en-US`) and supports Simplified Chinese (`zh-CN`). All user-facing strings must provide both languages (`useI18n()` in the renderer and `settings.locale` in the main process).
- Before committing or pushing, verify that diffs contain no real proxy URIs/IPs, credentials, local OS usernames, or browser profile data (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
