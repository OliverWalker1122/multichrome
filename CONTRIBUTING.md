# Contributing to MultiChrome

Thank you for your interest in contributing to **MultiChrome**! Issues and Pull Requests in either English or Simplified Chinese are welcome.

---

## 1. Core Principles & Non-Negotiables

1. **Local-First & Zero Cloud Sync**: All profiles, fingerprint seeds, and encrypted proxy configurations stay strictly on the user's machine.
2. **Fail-Closed Proxy Isolation**: Bound proxies must never fall back to `direct` routing, must disable QUIC (`--disable-quic`), lock WebRTC to `disable_non_proxied_udp`, and resolve DNS remotely.
3. **Pure Native Stealth**: `fingerprint-chromium` profiles do not inject JS prototype hooks or auto-load unpacked extensions by default; only native C++ CLI flags, Chromium `Preferences`, and native CDP `Emulation` are used.
4. **Zero Plaintext Credentials**: Proxy configs and credentials must be encrypted via Electron `safeStorage` and redacted in logs and API/MCP responses.
5. **Backward Compatibility**: SQLite schema changes must use safe `ALTER TABLE` migrations; `electron-store` schemas must remain compatible with existing local installations.

---

## 2. Bottom-Up Vertical Layering

Dependencies strictly flow **downward** (`Upper Layer -> Lower Layer`), mechanically enforced by `tests/architectureLayering.test.js`:

```text
multichrome/
├── electron/                       # Main process (5-layer bottom-up DAG)
│   ├── domain/                     # [L0] 100% pure rules, parsers & security policies (zero I/O, zero Electron)
│   ├── repositories/               # [L1a] SQLite (`better-sqlite3`) & encrypted `safeStorage` / `electron-store` persistence
│   ├── drivers/                    # [L1b] OS, child_process (`sing-box`), CDP WebSocket, TCP gate & probe drivers
│   ├── services/                   # [L2] Use-case orchestration (environment, launch, proxy, kernel, automation; zero BrowserWindow/ipcMain)
│   ├── ipc/                        # [L3a] Renderer `ipcMain.handle` route adapters & input validators
│   ├── transport/                  # [L3b] Local `127.0.0.1` HTTP/WS CDP pass-through guard & 4-tool MCP server
│   ├── app/                        # [L3c] Electron host shell (`windowManager`, `trayManager`, `applicationLogs`)
│   ├── preload.cjs                 # Isolated `contextBridge` preload API
│   └── main.ts                     # [L4] Composition root & graceful lifecycle bootstrap
├── src/                            # Renderer (4-layer bottom-up DAG)
│   ├── types/ utils/ theme/ i18n/  # [L0] Shared types, pure helpers, Fluent 2 glass tokens & bilingual dictionary
│   ├── components/common/          # [L0] Reusable domain-agnostic UI primitives
│   ├── services/                   # [L1] Typed IPC gateway (sole layer permitted to access `window.electronAPI`)
│   ├── contexts/ & hooks/          # [L2] Domain state providers & page/workspace orchestration hooks
│   ├── components/{layout,environments,proxies,settings}/ # [L3] Feature views, drawers & dialogs
│   └── App.tsx                     # [L3] Application shell composition
├── tests/                          # L1 unit, integration & architecture fitness tests
└── scripts/                        # Build helpers, L2 E2E, L3 UI suite & L4 live audit runners
```

- **Downward Logic Placement**: Place ~90% of new business rules, parsers, and security policies in pure JS modules under `electron/domain/*.js` (or I/O adapters in `electron/drivers/*.js`) with comprehensive L1 unit tests in `tests/*.test.js`.
- **IPC Gateway Rule**: Renderer components, hooks, and contexts must call `src/services/*` rather than `window.electronAPI` directly.
- **English-First Bilingual UI (i18n)**: The app defaults to English (`en-US`) with optional Simplified Chinese (`zh-CN`). Every user-visible string must provide both English and Simplified Chinese via `useI18n()`.

---

## 3. Development & Verification Gates

```bash
npm install
npm run dev
```

Before opening a Pull Request, run the required verification commands:

```bash
npm run check      # TypeScript check (0 errors)
npm run lint       # ESLint check (0 errors)
npm test           # L1 unit, integration & layering tests
npm run build      # Vite renderer + Electron main build
```

- If modifying proxy, kernel, CDP, fingerprint, or launch logic, also run `npm run test:e2e` (L2 offline dual-engine E2E).
- If modifying UI pages, dialogs, or IPC state flows, also run `npm run test:ui` (L3 isolated Electron UI suite).

---

## 4. Pre-Commit Privacy Checklist

Never commit or include in issues/PRs:
- Real proxy nodes or share URIs (`vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`, `tuic://`, `socks5://user:pass@...`), real server IPs, private domains, or UUIDs.
- API keys, tokens, `.env*` files, cookies, or browser `User Data` directories.
- Local absolute paths containing real OS usernames (use synthetic RFC 5737 test IPs `192.0.2.x` / `198.51.100.x` / `203.0.113.x` and `.invalid` / `example.com` domains in tests).
