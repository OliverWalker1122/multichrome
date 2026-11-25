# Changelog

All notable changes to MultiChrome are documented in this file.

## [1.6.0] - 2026-11-25

### Added
- **Runtime & Toolchain Upgrade**: Upgraded to Electron `44.11.6`, Node.js `22.23.4` (CI & Release), `better-sqlite3` `13.2.0` (N-API), and `electron-builder` `26.18.0`, with pinned local MCP client verification (`@modelcontextprotocol/sdk` `1.32.2`, `@playwright/mcp` `0.0.86`, `chrome-devtools-mcp` `1.14.0`) wired into Windows CI, Release, and packaged `stdio` bridge checks.
- **Password-Encrypted Local Backup & Migration (`.mcbackup`)**: Export and restore portable settings, re-encrypted managed proxies, and browser profile metadata + persistent 32-bit fingerprint seeds locally using `scrypt` + `AES-256-GCM` authenticated encryption (`Settings -> General -> Encrypted Backup`), with destination writability checks, directory collision rollback, and safe retry. Zero cloud storage.
- **Native Extensionless CDP Cookie Import & Export**: Transfer browser cookies in JSON or Netscape HTTP Cookie format over MultiChrome's private loopback CDP connection (`Storage.getCookies` / `Storage.setCookies`) directly from each environment's action menu without injecting any browser extension.
- **Multi-Select Batch Operations & Bulk Profile Creation**:
  - Bulk-create up to 50 numbered profiles with unique 32-bit fingerprint seeds and optional sequential or single proxy assignment (`Create Environment -> Bulk Create`).
  - Select multiple profiles to batch launch, stop, move groups, bind proxies, add tags, or move to Trash, plus multi-select batch proxy removal and full-keyboard navigation across virtualized mixed-density environment lists (`Home` / `End` / arrow focus).
- **Multi-Window Workspace Layouts & Native Foreground Window Locating**: Unified `Window Layout` dropdown supporting zero-gap DWM-compensated seamless grid tiling, console-beside-browsers split tiling, uniform-size stacking, diagonal cascade, minimize or restore all, one-click main app window size restoration (`1340×820` default with zero-running fallback button), native `--window-name` taskbar identification, in-process Win32 foreground handoff (`AllowSetForegroundWindow` + CDP activation, zero external shell/WScript subprocesses), and a 1.2s non-focusable click-through highlight beacon overlay with profile name badge (zero webpage DOM injection).
- **Encrypted Token Authentication & Version-Aware Discovery for Local CDP & MCP**: Protected `/mcp`, `/json/*`, `/devtools/*`, and `/api/v1/*` with an OS `safeStorage`-encrypted 256-bit random access token verified via constant-time SHA-256 (`Authorization: Bearer <token>` and `/t/<token>/...` path capability URLs for `@playwright/mcp` & `chrome-devtools-mcp`), per-launch dedicated `profileCdpEndpoint` / `wsEndpoint`, strict selector validation, `server/discover` protocol negotiation, screenshot-safe UI masking, and live token reset that disconnects active sessions.
- **Proxy IP Rotation Webhook URL & Legacy Address Encryption**: Store an encrypted per-proxy rotation webhook URL, trigger IP rotation from Proxy Details or Proxies table, automatically force-refresh exit IP and region metadata, and encrypt legacy manual/fallback proxy addresses on explicit save while refusing plaintext writes when OS secure storage is unavailable.
- **Zero-State Onboarding Card, Sanitized Support Diagnostics & Verified Installer Download**:
  - Actionable 3-step empty-state onboarding card guiding new users to engine setup, proxy creation, and their first isolated profile.
  - Export sanitized JSON support diagnostics (`Settings -> About -> Export Diagnostics`) with OS, SQLite integrity, engine status, redacted proxy summaries, and recent logs.
  - Direct in-app verified update installer download (`Settings -> About -> Download Installer`) verified against `SHA256SUMS.txt` before saving.
- **Visual Brand Refresh & Storefront**:
  - Original pure solid two-color flat icon (`#1877F2` + `#FFFFFF`) across Windows `.ico`, macOS `.icns`, Linux `.png`, tray, title bar, and GitHub social preview, with an explicit non-affiliation notice for Google LLC trademarks.
  - Real synthetic dark/light/Chinese screenshots (`docs/images/`), static landing page (`site/index.html` + GitHub Pages deployment), and CI main-process TypeScript type checking (`electron/tsconfig.json`).
- **Release Supply-Chain & Runner Hardening**:
  - Switched macOS release builds to `macos-14` to avoid hosted `macos-15` queue starvation and added SLSA build provenance attestations (`actions/attest-build-provenance@v2`).

### Fixed
- Guarded corrupt historical proxy payload decoding in `ProxyService.save` when updating legacy records, and added database/filesystem collision checks when reserving profile directories.
- Hardened cold automation token restoration so unavailable secure storage never overwrites an existing encrypted token record.
- Hardened live L4 PixelScan auditing to read explicit single/two-line consistency verdicts and stop immediately on active human-verification challenges without exposing page contents.
- Ensured global single-term bilingual UI copy consistency (`uiCopyPolicy.test.js`) with zero slash-paired labels across `src/` and `electron/`.

---

## [1.5.0] - 2026-11-23

### Added
- **Default English Locale & Optional Simplified Chinese**: Switched default first-run UI and primary README/docs to English (`en-US`) with instant one-click Simplified Chinese (`zh-CN`) switching.
- **Standard Guarded CDP Pass-Through & Minimal 4-Tool Profile MCP**: Opt-in `127.0.0.1` loopback automation endpoint (`18922`) with DNS-rebinding protection (`Host` allowlist + `Origin` block), external override absorption, incognito context blocking, fail-closed proxy-drop CDP disconnect, Streamable HTTP `/mcp`, and `stdio` bridge (`list_profiles`, `start_profile`, `stop_profile`, `switch_active_profile`).
- **Multi-Protocol Share-URI Import**: Direct single-line and batch import for `vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`, `hysteria2://`, and `tuic://` URIs alongside `http`/`https`/`socks5`.
- **Single-Flight Exit Geo Probing & Dual-Engine Live Audit (`npm run audit:live`)**: Pre-launch HTTPS `CONNECT` exit probing with timezone fallback and separate live external auditing across `fingerprint-chromium` and `system-chrome`.
