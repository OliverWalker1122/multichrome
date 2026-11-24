# Architecture & Core Design

English · [简体中文](architecture_zh.md)

This document describes MultiChrome's core design principles, browser and proxy isolation mechanisms, and bottom-up vertical directory architecture.

## 1. Security-Tiered Dual Browser Engines

MultiChrome lets you choose between two browser engines per profile:

| Engine | Best For | Core Mechanism |
| :--- | :--- | :--- |
| **Official Google Chrome (`system-chrome`)** | Security-sensitive workflows and primary accounts | Launches the host's official Google-signed Chrome with full upstream security updates; isolates profiles via dedicated `user-data-dir`, fail-closed proxy routing, and native CDP `Emulation` (timezone, locale, geolocation) |
| **C++ Privacy Kernel (`fingerprint-chromium`)** | Multi-profile hardware & rendering anti-correlation | Persists an independent 32-bit deterministic seed per profile to isolate Canvas, WebGL, Audio, Fonts, ClientRects, and hardware concurrency natively in C++; runs in **pure native zero-extension, zero-JS-hook stealth mode** by default and upgrades Ungoogled Chromium's default `No Search` engine to Google Search |

## 2. Fail-Closed Proxy Leak Prevention

Managed proxies are powered by on-demand `SagerNet/sing-box` binaries supporting HTTP, HTTPS, SOCKS5, VLESS, VMess, Trojan, Shadowsocks, Hysteria2, and TUIC. Both the proxy layer and browser layer enforce fail-closed rules so network hiccups never expose your host IP:

- **No Direct Fallback**: Managed `sing-box` configs reject `direct` outbound fallbacks; traffic drops immediately if the upstream tunnel disconnects or exits.
- **Block UDP / QUIC Bypass**: Launch flags inject `--disable-quic` and lock Chromium `Preferences` WebRTC policy to `disable_non_proxied_udp`.
- **Remote DNS Resolution**: Domain resolution occurs remotely over the proxy tunnel (`--host-resolver-rules=MAP * ~NOTFOUND`) to prevent local DNS leaks.
- **Encrypted Credentials & Live Audit**: Sensitive proxy credentials are encrypted via OS-backed Electron `safeStorage`; the bottom log dock streams outbound target hostnames while redacting secrets.

## 3. Environment Consistency & Health Inspection

- **Single-Flight Geo Alignment**: When timezone is unset, MultiChrome reuses a single-flight HTTPS `CONNECT` exit probe before browser spawn to match the proxy's IANA timezone (covering both the main thread and Dedicated/Shared Web Workers, with country-level timezone fallback); language defaults to clean `en-US` with optional automatic region matching; geolocation spoofing is available on demand.
- **Pre-Launch Consistency Guard**: Verifies kernel availability, bound proxy state, and timezone/language alignment against the proxy exit country before launch, offering one-click auto-alignment if mismatches are detected.
- **Optional Mandatory Health Check**: Enable **Require health check before launch** in Settings to verify proxy exit IP, timezone/geolocation, language policy, WebRTC & DNS leak locks, and kernel status prior to every launch.

## 4. Supply-Chain Security & SHA-256 Verification

- Source control and release installers **do not bundle** any third-party binaries.
- `sing-box` and `fingerprint-chromium` are downloaded on demand inside **Settings → Components** exclusively over HTTPS from allowlisted official GitHub domains, and verified against official GitHub Release SHA-256 digests before extraction. Any mismatch aborts installation and removes temporary files.
- Downloaded components live under `<dataPath>/kernels/` alongside profile data `<dataPath>/environments/` for portable local backup and migration.

## 5. Standard CDP Pass-Through Guard & Minimal Profile MCP

To let Claude Code, Cursor, Antigravity, and Playwright / Puppeteer scripts automate isolated profiles safely without reinventing page-automation wheels, MultiChrome provides an opt-in local control plane (disabled by default; binds strictly to `127.0.0.1`, default port `18922`):

- **Stateless CDP Pass-Through Guard (`cdpGuardRelay.js` + `cdpGuardPolicy.js`)**: Exposes standard `/json/version`, `/json/list`, and WebSocket forwarding compatible out-of-the-box with official `@playwright/mcp` (`--cdp-endpoint`), `chrome-devtools-mcp` (`--browserUrl`), and `chromium.connectOverCDP`. Standard page commands pass straight through, while external commands that would clobber profile identity (`Emulation.setUserAgentOverride`, `Network.setUserAgentOverride`, `setTimezoneOverride`, `setLocaleOverride`, `setGeolocationOverride`, `setDeviceMetricsOverride`) are silently absorbed, `Target.createBrowserContext` is blocked to preserve `browser.contexts()[0]` login state, and active CDP sessions close immediately if a bound `sing-box` proxy drops.
- **Private Randomized Debug Ports**: Internal Chrome debug ports avoid `9222` in favor of private randomized high ports (never echoed in external responses) so blind local tools cannot accidentally attach to sensitive profiles.
- **Minimal 4-Tool Profile MCP (`POST /mcp` & `stdio` bridge)**: Exposes only the 4 multi-profile orchestration tools missing from single-browser MCPs (`list_profiles`, `start_profile`, `stop_profile`, `switch_active_profile`, callable by profile name or UUID) plus local HTTP helpers (`/api/v1/profiles`, `/api/v1/profiles/start`, etc.).
- **DNS-Rebinding & Cross-Origin Defense**: Enforces a strict loopback `Host` allowlist (`127.0.0.1` / `localhost`) and rejects any HTTP or WebSocket upgrade request carrying a browser `Origin` header (`403`), with automatic credential and path redaction.

## 6. Single-Line & Batch Multi-Protocol Proxy URI Import

- **Unified Share-URI Parser**: Alongside `http://`, `https://`, `socks5://`, and `host:port[:user:pass]` lines, directly parses single and multi-line share links for `vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://` (`hysteria2://`), and `tuic://` (including TLS, Reality, uTLS, and common transports).
- **Naming, Deduplication & Encrypted Storage**: Batch import supports explicit `Name | URI` prefixes and `#remark` fragment extraction, computes deterministic endpoint keys to skip duplicates, validates `sing-box` outbound fragments (forbidding `direct`), and encrypts payloads via `safeStorage`.

## 7. Local Encrypted Backup (`scrypt + AES-256-GCM`) & Native CDP Session Tooling

- **Offline Migration Bundles ([encryptedBackup.js](../electron/domain/encryptedBackup.js) + [backupService.js](../electron/services/backupService.js))**: Exports portable settings, decrypted-then-re-encrypted managed proxy definitions, and profile metadata + 32-bit fingerprint seeds into password-protected `.mcbackup` JSON envelopes (`v=1`, `scrypt` key derivation with per-export random 16-byte salt, and authenticated `AES-256-GCM` payload encryption). Heavy Chrome cache/User Data folders remain excluded for compact portability; there is zero cloud dependency.
- **Extensionless CDP Cookie Transfer & Window Tiling ([cookieCodec.js](../electron/domain/cookieCodec.js) + [windowTiling.js](../electron/domain/windowTiling.js))**: Cookie import/export supports both JSON arrays and Netscape HTTP Cookie format (including `#HttpOnly_` entries) directly through private browser-level CDP sessions (`Storage.getCookies` / `Storage.setCookies`). Window grid tiling computes non-overlapping integer rectangles from the primary display's `workArea` and applies them through `Browser.setWindowBounds`.

## 8. Bottom-Up Vertical Architecture

Both the Electron main process (`electron/`) and React renderer (`src/`) follow a **strict downward dependency DAG (upper layers depend on lower layers; lower layers have zero upward imports)**, mechanically verified in CI by [architectureLayering.test.js](../tests/architectureLayering.test.js):

```text
multichrome/
├── electron/                               # Main process: 5-layer bottom-up unidirectional DAG
│   ├── domain/                             # [L0 Pure Domain Core] Zero I/O, zero Electron, zero SQLite
│   │   ├── fingerprintProfile.js           #   32-bit persistent fingerprint seed & hardware profile generation
│   │   ├── managedProxyArgs.js             #   Fail-Closed Chromium flags & WebRTC policy locks
│   │   ├── singboxConfig.js                #   sing-box validation, redaction & no-direct config builder
│   │   ├── proxyUriParser.js               #   VLESS/VMess/Trojan/SS/Hy2/TUIC share-URI parser
│   │   ├── proxyBatch.js                   #   Batch proxy line parser & endpoint deduplication
│   │   ├── proxyGeo.js                     #   Exit country, IANA timezone & locale resolution
│   │   ├── proxyRotationPolicy.js          #   Encrypted proxy rotation webhook URL validation
│   │   ├── launchGuard.js                  #   Pre-launch region/timezone/kernel consistency checks
│   │   ├── healthCheck.js                  #   5-dimension leak & fingerprint health evaluator
│   │   ├── environmentTags.js              #   Multi-tag normalization & AND/OR filter matching
│   │   ├── bulkEnvironmentPolicy.js        #   Bulk profile naming, unique seeds & sequential proxy policy
│   │   ├── windowTiling.js                 #   Display workArea grid calculation for running windows
│   │   ├── cookieCodec.js                  #   JSON & Netscape HTTP cookie parsing & serialization
│   │   ├── encryptedBackup.js              #   scrypt + AES-256-GCM .mcbackup sealing & validation
│   │   ├── groupPolicy.js                  #   Group rename & deletion validation rules
│   │   ├── startupUrlPolicy.js             #   Startup URL normalization & session deduplication
│   │   ├── profileTemplatePolicy.js        #   Bookmark merge, extension template & startup URL precedence
│   │   ├── processMetrics.js               #   Process scan parsing, memory aggregation & Memory Saver flags
│   │   ├── automationPolicy.js             #   Loopback security validation & response redaction
│   │   ├── cdpGuardPolicy.js               #   CDP override shield & endpoint rewrite rules
│   │   ├── kernelPolicy.js                 #   Mandatory SHA-256 verification & curated release policy
│   │   ├── supportBundle.js                #   Sanitized JSON diagnostics report builder
│   │   ├── updateAssetPolicy.js            #   Platform release asset selection & SHA256SUMS.txt parser
│   │   └── kernelManifest.json             #   Curated upstream release allowlist & SHA-256 digests
│   ├── repositories/                       # [L1a Persistence Repositories] SQLite / safeStorage / electron-store
│   │   ├── environmentRepository.ts        #   SQLite schema, integrity check, safe migrations & profile CRUD
│   │   ├── groupRepository.js              #   Batch group rename/move/trash SQL operations
│   │   ├── proxyRepository.js              #   safeStorage-encrypted proxy records & sanitized summaries
│   │   ├── settingsRepository.ts           #   App preferences (English default), templates & fingerprint defaults
│   │   └── automationConfigRepository.js   #   Local automation control-plane configuration store
│   ├── drivers/                            # [L1b External Process & Protocol Drivers] OS / FS / child_process / net
│   │   ├── singboxCore.js                  #   sing-box process supervisor & sanitized error diagnostics
│   │   ├── cdpManager.ts                   #   CDP WebSocket session, cookies, window bounds & native Emulation
│   │   ├── portAllocator.js                #   Loopback port probing & randomized private debug port pool
│   │   ├── browserProcessScanner.ts        #   Host browser process scanner, memory sampler & force-kill fallback
│   │   ├── proxyStartupGate.js             #   Standard Chrome fail-closed startup hold gate
│   │   ├── proxyProbeClient.js             #   HTTP/HTTPS/SOCKS5 staged Geo & IP probe client
│   │   ├── proxyExitProbe.js               #   Managed loopback HTTPS CONNECT exit & timezone probe
│   │   ├── proxyRotationClient.js          #   HTTPS proxy rotation webhook dispatcher
│   │   ├── githubProxyTransport.js         #   Allowlisted GitHub HTTPS downloader over HTTP/SOCKS5 proxies
│   │   ├── chromeDiscovery.js              #   Cross-platform official Google Chrome executable discovery
│   │   ├── nativePreferences.js            #   Native Chromium Preferences leak-lock & language writer
│   │   ├── extensionPipeLoader.ts          #   --remote-debugging-pipe unpacked extension installer
│   │   ├── profileLock.js                  #   Local profile lock & liveness probe
│   │   ├── profileStorage.js               #   Profile disk usage stats & safe cache cleaner
│   │   └── profileTemplateDriver.js        #   Bookmark sync, extension manifest check & session detector
│   ├── services/                           # [L2 Application Services] Zero BrowserWindow / zero ipcMain / zero SQL
│   │   ├── environmentService.ts           #   Profile lifecycle, batch ops, clone, groups, trash & health
│   │   ├── browserLaunchService.ts         #   Dual-engine launch, cookies, tiling, single-flight geo & gate
│   │   ├── proxyService.js                 #   Managed sing-box pool, IP rotation, idle/resume & exit probing
│   │   ├── proxyCoordinator.js             #   Proxy mutation & concurrent browser launch mutex coordinator
│   │   ├── backupService.js                #   Encrypted .mcbackup export & restore orchestration
│   │   ├── kernelService.js                #   fingerprint-chromium & sing-box download/extract/import service
│   │   └── automationService.js            #   Active target switching, proxy-drop disconnect & server lifecycle
│   ├── ipc/                                # [L3a Renderer IPC Adapters] 100% of ipcMain.handle routes
│   │   ├── index.ts                        #   Unified IPC registration entry
│   │   ├── validators.ts                   #   UUID, string & settings payload validators
│   │   ├── environmentIpc.ts               #   Profile, batch, cookie, tiling, group & health IPC handlers
│   │   ├── proxyIpc.js                     #   Managed proxy, rotation, batch remove & log IPC handlers
│   │   ├── automationIpc.js                #   Automation control-plane IPC handlers
│   │   └── systemIpc.ts                    #   Settings, backup, diagnostics, component & update IPC handlers
│   ├── transport/                          # [L3b Local Control-Plane Transport] 127.0.0.1 HTTP / WS / MCP / Stdio
│   │   ├── automationServer.js             #   Loopback HTTP / WebSocket server entry
│   │   ├── cdpGuardRelay.js                #   Stateless CDP WebSocket pass-through guard relay
│   │   ├── mcpServer.js                    #   Streamable HTTP MCP & 4 profile orchestration tools
│   │   └── mcpStdioBridge.js               #   stdio MCP bridge adapter
│   ├── app/                                # [L3c Electron Host Shell]
│   │   ├── windowManager.ts                #   Main window, CSP headers, quit confirmation & IPC broadcasts
│   │   ├── trayManager.ts                  #   System tray & bilingual context menu
│   │   └── applicationLogs.js              #   Sanitized in-memory log buffer
│   ├── preload.cjs                         # Sandboxed contextBridge preload API
│   └── main.ts                             # [L4 Composition Root] Dependency injection & graceful shutdown
├── src/                                    # Renderer: 4-layer bottom-up unidirectional DAG
│   ├── types/ utils/ theme/ i18n/          # [L0 Foundation] Contracts, pure helpers, Fluent 2 tokens & i18n
│   ├── components/common/                  # [L0 Primitives] InfoTip, TagEditor, RunStatusFilter, etc.
│   ├── services/                           # [L1 IPC Gateway] Sole layer permitted to call window.electronAPI
│   ├── contexts/ & hooks/                  # [L2 State & Controllers] Providers & workspace filter/sort/batch hooks
│   ├── components/{layout,environments,proxies,settings}/ # [L3 Views] Domain pages, rows, drawers & dialogs
│   └── App.tsx                             # [L3 App Shell]
├── tests/                                  # L1 unit, real sing-box integration & architecture fitness tests
├── scripts/                                # Build helpers, L2 E2E, L3 UI suite, L4 live audit & packaging scripts
├── resources/sing-box/                     # Upstream license notice (no bundled binaries)
└── docs/                                   # English & Chinese architecture, verification & development guides
```
