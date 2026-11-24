# Testing & Platform Verification

English · [简体中文](verification_zh.md)

MultiChrome uses a four-tier verification pyramid covering pure domain rules, offline anti-leak & anti-detection E2E, full Electron UI flows, and live external fingerprint checker audits.

## 1. Four-Layer Verification Suite

| Layer | Command | Scope & Responsibilities |
| :--- | :--- | :--- |
| **L1 Unit & Integration Tests** | `npm test` | Validates pure domain logic, edge cases, security policies, downward architecture layering, and real `sing-box` process isolation — covering fail-closed flags, WebRTC locks, GeoIP timezone/locale matching, health inspection, launch consistency guards, group operations, batch proxy URI import, memory metrics, and SHA-256 verification. Runs automatically on Ubuntu and Windows via [ci.yml](../.github/workflows/ci.yml). |
| **L2 Core Security & Local Anti-Detection E2E** | `npm run test:e2e` | **100% offline — requires no live proxy.** Uses local mock proxies and leak traps across both `fingerprint-chromium` and official Google Chrome: verifies exclusive proxy routing, fail-closed zero direct leaks on disconnect, WebRTC zero-leak, cross-`iframe` prototype anti-hook (`lies=0`), same-session and cross-restart Canvas / Audio / DOMRect determinism, and default Google Search persistence. |
| **L3 UI Smoke Suite** | `npm run test:ui` | Launches the compiled Electron app against an isolated `MULTICHROME_USER_DATA` directory over CDP to verify default English boot, instant Chinese switching, core workspaces, dialogs, guarded CDP / MCP flows, light/dark acrylic materials, and zero uncaught React or console exceptions. |
| **L4 Live External Dual-Engine Audit** | `npm run audit:live -- --proxy="<ProxyName>"` or `--env="<ProfileName>"` | Manual on-demand audit (excluded from offline CI). Passing `--proxy` creates isolated ephemeral profiles to **separately audit the C++ Privacy Kernel (`fingerprint-chromium`) and System Chrome (`system-chrome`)** (`--engine=both\|fingerprint-chromium\|system-chrome`) through a real proxy against third-party fingerprint checkers. |

## 2. External Fingerprint Checker Observations (Dual-Engine)

Audited via `npm run audit:live -- --proxy="<ProxyName>"` separately for the **C++ Privacy Kernel (`fingerprint-chromium`)** and **System Chrome (`system-chrome`)** over managed `sing-box` routing:

| Platform | C++ Privacy Kernel (`fingerprint-chromium`) | System Chrome (`system-chrome`) | Observed Signals |
| :--- | :--- | :--- | :--- |
| **BrowserScan** | `100%` / `Bot: No` / `WebRTC: disabled` | `100%` / `Bot: No` / `WebRTC: disabled` | Zero automation flags; timezone, locale, and WebRTC match the proxy exit region |
| **CreepJS** | `0 Lies` / `0 Trash` / `0% Headless` / `0% Stealth` | `0 Lies` / `0 Trash` / `0% Headless` / `0% Stealth` | Zero JS prototype hooks or extension artifacts (`Resistance: unknown`); main thread and Web Worker timezone, Intl/locale, and WebGL GPU match; C++ kernel additionally provides an isolated spoofed GPU and deterministic seed |
| **BrowserLeaks (WebRTC)** | `No Leak` (Local/Public/IPv6 all `-`) | `No Leak` (Local/Public/IPv6 all `-`) | Zero LAN IP or real public IP exposure |
| **PixelScan** | `CAPTCHA/Challenge` | `CAPTCHA/Challenge` | Protected by Cloudflare Turnstile; MultiChrome strictly prohibits automated CAPTCHA bypassing, so the script reports `CAPTCHA/Challenge` and stops (users can complete verification manually in an interactive window) |

> Note: Results reflect the default pure native zero-extension mode. External checker heuristics evolve over time, and manually loading third-party extensions or altering flags may change scores.

## 3. CI & Automated Releases

- **Continuous Integration ([ci.yml](../.github/workflows/ci.yml))**: Runs `npm run check`, `npm run lint`, `npm run prepare:singbox`, `npm test`, and `npm run build` on every push to `main` and every pull request, and updates test status badges.
- **Release Pipeline ([release.yml](../.github/workflows/release.yml))**: Pushing a `v*` tag matching `package.json` (`git tag -a v1.5.0 -m "MultiChrome v1.5.0" && git push origin v1.5.0`) runs pre-release checks, builds Windows (`.exe`), macOS (`.dmg` / `.zip`), and Linux (`.AppImage` / `.deb`) installers in parallel, generates `SHA256SUMS.txt`, and publishes to GitHub Releases.
