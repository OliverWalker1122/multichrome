## Summary

<!-- Briefly describe what problem this PR solves and the approach taken. -->

## Affected Layers

- [ ] `electron/domain` — Pure domain rules, fingerprint math, URI/sing-box config, or security policies (L0)
- [ ] `electron/repositories` / `electron/drivers` — SQLite / `safeStorage` persistence or OS/process/CDP/network drivers (L1)
- [ ] `electron/services` — Environment, launch, proxy, kernel, or automation orchestration services (L2)
- [ ] `electron/ipc` / `electron/transport` / `electron/app` — IPC handlers, `127.0.0.1` CDP/MCP server, or window/tray shell (L3)
- [ ] `src/services` / `src/hooks` / `src/contexts` — Frontend IPC gateway or state/controller hooks (L1–L2)
- [ ] `src/components` / `src/theme` / `src/i18n` — Renderer views, Fluent 2 theme, or bilingual i18n (L0/L3)
- [ ] `docs/` / `scripts/` / `tests/` — Documentation, build scripts, or test suites

## Verification Checklist

- [ ] `npm run check` passes (0 TypeScript errors)
- [ ] `npm run lint` passes (0 ESLint errors)
- [ ] `npm test` passes (L1 unit, integration & layering tests)
- [ ] `npm run build` succeeds
- [ ] `npm run test:e2e` passes (required for proxy / kernel / CDP / launch changes)
- [ ] `npm run test:ui` passes (required for UI / dialog / IPC state changes)
- [ ] Bilingual (`en-US` default & `zh-CN`) strings provided for all user-facing text
- [ ] Privacy check passed: zero real proxy URIs/IPs, credentials, `.env` values, or personal local paths in diff
