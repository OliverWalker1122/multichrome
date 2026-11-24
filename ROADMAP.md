# MultiChrome Roadmap

English · [简体中文](ROADMAP_ZH.md)

MultiChrome is an **open-source, local-first, fail-closed proxy-isolated, native C++ stealth** multi-profile browser manager.

---

## Completed Milestones

- [x] **1. Smart Startup URL Deduplication**: Skips opening duplicate startup tabs when Chrome restores an existing session containing the same URL.
- [x] **2. Active-Profile Quit Protection**: Prompts when closing the main window while profiles are running (close all & quit / minimize to tray / cancel) to prevent abrupt proxy drops.
- [x] **3. Group Management & Filtering**: Group color badges, rename/delete dialogs, run-status pills (All / Running / Stopped), and row context menus.
- [x] **4. Profile Cloning**: One-click clone of group, proxy, engine, timezone, language, and notes with a fresh isolated directory and new 32-bit deterministic fingerprint seed.
- [x] **5. Profile Disk Usage & Safe Cache Cleanup**: Displays profile storage size, opens the profile folder, and clears `Cache` / `Code Cache` / `GPUCache` while preserving cookies and login sessions.
- [x] **6. Batch Proxy Import & Shared-Proxy Warnings**: Multi-line batch import across HTTP/SOCKS5 and share URIs (`vless`, `vmess`, `trojan`, `ss`, `hy2`, `tuic`), staged batch health checks, and clear warnings when multiple profiles share one proxy.
- [x] **7. Optional Auto-Matched Region Language**: Automatically aligns `Accept-Language` and `navigator.language` with the proxy exit country when enabled.
- [x] **8. Pre-Launch Consistency Guard & 4D Geo Alignment**: Aligns IP + Timezone + Language + Geolocation and warns before launch with one-click alignment if conflicts are detected.
- [x] **9. One-Click Leak & Fingerprint Health Check**: Inspects exit IP, region, timezone, language, WebRTC/DNS leak locks, and C++ kernel status with quick links to external checkers.
- [x] **10. Multi-Profile Memory Governance**: Live per-profile and total RAM monitoring, optional Memory Saver launch flags, and one-click Close All Running.
- [x] **11. Bookmark & Unpacked Extension Templates**: Distributes common bookmark templates and group/profile startup URLs, and manages local unpacked extensions with transparent stealth notices.
- [x] **12. Standard Guarded CDP & Minimal 4-Tool MCP**: Opt-in `127.0.0.1` CDP pass-through guard (`Host` allowlist + `Origin` block, override shield, incognito block, proxy-drop disconnect) + Streamable HTTP `/mcp` & `stdio` bridge (`list_profiles`, `start_profile`, `stop_profile`, `switch_active_profile`).
- [x] **13. Curated Kernel Allowlist & Verified Upgrade Reminders**: Mandatory SHA-256 verification against `electron/domain/kernelManifest.json` with non-intrusive upgrade badges.
- [x] **14. Multi-Tag Organization**: Colored profile tags with AND/OR multi-tag filtering.
- [x] **15. Multi-Select Batch Actions & Bulk Profile Creation**: Select multiple profiles to batch launch, stop, move groups, assign proxies, add tags, or move to Trash; create up to 50 numbered profiles in bulk with sequential or single proxy assignment.
- [x] **16. One-Click Window Grid Tiling**: Automatically arrange all running profile windows across the primary display work area via native CDP `Browser.setWindowBounds`.
- [x] **17. One-Click Proxy IP Rotation (Webhook URL)**: Trigger encrypted rotation URLs for 4G/5G mobile and rotating residential proxies and automatically re-probe exit IP and region.
- [x] **18. Local End-to-End Encrypted (E2EE) Backup Bundles (`.mcbackup`)**: Export and restore portable settings, re-encrypted managed proxies, and profile metadata + 32-bit fingerprint seeds using `scrypt + AES-256-GCM` password encryption (zero cloud upload).
- [x] **19. Native Extensionless Cookie Import & Export**: Import and export standard JSON and Netscape HTTP cookies directly over private CDP (`Storage.getCookies` / `Storage.setCookies`).
- [x] **20. Sanitized Diagnostics & SHA-256 Verified In-App Update Download**: Export redacted JSON diagnostics bundles and verify release installers directly against `SHA256SUMS.txt` plus SLSA build provenance attestations.

---

## Planned Backlog

### Window Orchestration & Sync Safety
- [ ] **Input Synchronizer**: Synchronize clicks, scrolling, and typing across selected profile windows with randomized micro-jitter.
- [ ] **Cross-Device Sync Lockfile Guard**: Prevent concurrent launches across WebDAV / Syncthing folders from corrupting SQLite cookies.

### Natural Session Tooling
- [ ] **Cookie Warm-Up Runner**: Browse a user-defined list of everyday sites to build natural cookie history on fresh profiles.
- [ ] **Humanized Paste**: Type clipboard text over CDP with natural keystroke intervals for strict forms.
