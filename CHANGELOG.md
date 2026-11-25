# Changelog

All notable changes to MultiChrome are documented in this file.

## [1.6.2] - 2026-11-26

### Added
- **Expandable Component Details & Config Folder Shortcut**: Added expandable component path, manifest, and status details in `Settings -> Components`, plus a quick `Open Config Folder` action in `Settings -> General`.

### Changed
- **Client-Agnostic Quick Connect Panel**: Streamlined `Settings -> Automation & MCP -> Quick Connect` into three side-by-side tabs (`CDP Script`, `DevTools MCP`, `Playwright MCP`) that output universal `mcpServers` JSON (bundling HTTP profile management with standard CDP page control) instead of client-specific CLI commands.

### Fixed
- **Chromium 148 DBSC & Proxy Tunnel Stability**: Preserved native `DeviceBoundSessions` (DBSC) while adding a zero-MITM `CONNECT`/DBSC stall watchdog, `sing-box` dialer and keep-alive timeouts, and non-poisoning loopback EOF / upstream `403` log handling so persistent sessions stay responsive without deadlocks or spurious upstream-error teardowns.
- **Health Check Proxy Isolation & Auto-Attach Filtering**: Excluded the target profile when evaluating active proxy usage during health checks, filtered `service_worker` targets from CDP auto-attach to prevent unnecessary pauses, and removed the inner scrollbar in `EnvironmentHealthDialog` so all check items display directly.
- **Zero Layout Shift on Profile Start & Stop**: Fixed the environment table action column width, kept the page header invariant by placing inline live memory telemetry and running-window actions on the toolbar row, bounded running-row memory line height, and compacted the Details panel Locate button to eliminate UI jumps when launching and closing profiles.

---

## [1.6.1] - 2026-11-25

### Fixed
- **Update Check Fallback Under GitHub API Rate Limits**: Automatically fall back from `api.github.com/repos/.../releases/latest` to the official `github.com/.../releases/latest` redirect plus `SHA256SUMS.txt` when anonymous API requests hit `HTTP 403`/`429` rate limits, keeping both in-app update checks and verified installer downloads working without extra endpoints or credentials.
- **Windows Installer SHA-256 Verification Matching**: Normalized spaces vs. dots (`MultiChrome Setup <ver>.exe` vs. GitHub's uploaded `MultiChrome.Setup.<ver>.exe`) when resolving digests in `SHA256SUMS.txt`.
- **Windows Permanent-Delete Lockfile Release**: Waited for Chrome `lockfile` release after force-killing and ensured lingering profile processes are cleared before deleting trashed profile directories and SQLite rows, preventing `EBUSY` deletion failures.

---

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
  - Added SLSA build provenance attestations (`actions/attest-build-provenance@v2`) and Node 24-native GitHub Actions workflows across Windows, macOS (`macos-latest`), and Linux release pipelines.

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
