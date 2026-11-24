# Changelog

All notable changes to MultiChrome are documented in this file.

## [1.6.0] - 2026-11-24

### Added
- **Password-Encrypted Local Backup & Migration (`.mcbackup`)**: Export and restore portable settings, re-encrypted managed proxies, and browser profile metadata + persistent 32-bit fingerprint seeds locally using `scrypt` + `AES-256-GCM` authenticated encryption (`Settings -> General -> Encrypted Backup`). Zero cloud storage.
- **Native Extensionless CDP Cookie Import & Export**: Transfer browser cookies in JSON or Netscape HTTP Cookie format over MultiChrome's private loopback CDP connection (`Storage.getCookies` / `Storage.setCookies`) directly from each environment's action menu without injecting any browser extension.
- **Multi-Select Batch Operations & Bulk Profile Creation**:
  - Bulk-create up to 50 numbered profiles with unique 32-bit fingerprint seeds and optional sequential or single proxy assignment (`Create Environment -> Bulk Create`).
  - Select multiple profiles to batch launch, stop, move groups, bind proxies, add tags, or move to Trash, plus multi-select batch proxy removal.
- **One-Click & Automatic Multi-Window Grid Tiling**: Arrange all running MultiChrome browser windows across the primary display work area (`Browser.setWindowBounds` grid calculation) with one click or automatically when batch-launching multiple profiles, paired with unified concurrent multi-profile pre-launch health & consistency overview dialogs.
- **Proxy IP Rotation Webhook URL**: Store an encrypted per-proxy rotation webhook URL, trigger IP rotation from Proxy Details or Proxies table, and automatically force-refresh exit IP and region metadata.
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
- Guarded corrupt historical proxy payload decoding in `ProxyService.save` when updating legacy records.
- Ensured global single-term bilingual UI copy consistency (`uiCopyPolicy.test.js`) with zero slash-paired labels across `src/` and `electron/`.

---

## [1.5.0] - 2026-11-23

### Added
- **Default English Locale & Optional Simplified Chinese**: Switched default first-run UI and primary README/docs to English (`en-US`) with instant one-click Simplified Chinese (`zh-CN`) switching.
- **Standard Guarded CDP Pass-Through & Minimal 4-Tool Profile MCP**: Opt-in `127.0.0.1` loopback automation endpoint (`18922`) with DNS-rebinding protection (`Host` allowlist + `Origin` block), external override absorption, incognito context blocking, fail-closed proxy-drop CDP disconnect, Streamable HTTP `/mcp`, and `stdio` bridge (`list_profiles`, `start_profile`, `stop_profile`, `switch_active_profile`).
- **Multi-Protocol Share-URI Import**: Direct single-line and batch import for `vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`, `hysteria2://`, and `tuic://` URIs alongside `http`/`https`/`socks5`.
- **Single-Flight Exit Geo Probing & Dual-Engine Live Audit (`npm run audit:live`)**: Pre-launch HTTPS `CONNECT` exit probing with timezone fallback and separate live external auditing across `fingerprint-chromium` and `system-chrome`.
