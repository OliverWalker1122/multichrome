# Testing & Platform Verification

English · [简体中文](verification_zh.md)

MultiChrome uses a four-tier verification pyramid covering pure domain rules, offline anti-leak & anti-detection E2E, full Electron UI flows, and live external fingerprint checker audits.

## 1. Four-Layer Verification Suite

| Layer | Command | Scope & Responsibilities |
| :--- | :--- | :--- |
| **L1 Unit and integration tests** | `npm test`, `npm run test:coverage` | Checks domain policies, credential recovery, proxy behavior and protocol contracts. See the current CI results for counts and coverage. |
| **L2 Core Security & Local Anti-Detection E2E** | `npm run test:e2e` | Runs offline with local proxy fixtures. Uses local mock proxies and leak traps across both `fingerprint-chromium` and official Google Chrome: verifies exclusive proxy routing, fail-closed zero direct leaks on disconnect, WebRTC zero-leak, cross-`iframe` prototype anti-hook (`lies=0`), same-session and cross-restart Canvas / Audio / DOMRect determinism, and default Google Search persistence. |
| **L3 Desktop and MCP clients** | `npm run test:ui` | Exercises windows, settings, batch actions and local clients with an isolated data directory. Reports the scenario IDs that passed. |
| **L4 Live External Dual-Engine Audit** | `npm run audit:live -- --proxy="<ProxyName>"` or `--env="<ProfileName>"` | Manual on-demand audit (excluded from offline CI). Passing `--proxy` creates isolated ephemeral profiles to **separately audit the C++ Privacy Kernel (`fingerprint-chromium`) and System Chrome (`system-chrome`)** (`--engine=both\|fingerprint-chromium\|system-chrome`) through a real proxy against third-party fingerprint checkers. |

For a custom data directory, put its absolute path on one UTF-8 line in the checkout's `.tmp/e2e-data-dir.txt`. L2 selects the executable from that directory's kernel manifest and creates test profiles in a temporary directory. Pass `--kernel=<executable>` for a one-run override. Use `npm run test:e2e -- --require-kernel` to fail if the fingerprint kernel cannot be located.

## Verification and release requirements

- Run `npm run ci` for ordinary code changes. It prepares the test sing-box binary, runs lint, type checking and L1, and builds the application. Isolate offline tests with `SKIP_DOTENV=true`, `DOTENV_CONFIG_PATH=/dev/null`, temporary user directories and synthetic settings.
- Add L2 for proxy, kernel, CDP, fingerprint or launch changes. Add L3 for core UI, dialog and state changes. For dual-engine acceptance, pass `--require-kernel` and verify that the report includes actual checks for both engines. Label a system-Chrome-only run accordingly.
- Run L4 over a real managed proxy for kernel or sing-box upgrades, changes to WebRTC, language, timezone or fingerprint policies, or full release acceptance. Use `npm run audit:live -- --auto-proxies=1 --engine=both` to test two temporary profiles through the same available proxy. Record observations, load failures and `CAPTCHA/Challenge` per engine and site. Stop checking a site when challenged. A page with no reported metrics is inconclusive. Omit actual proxy names, exit addresses, credentials and profile identifiers from reports.
- Before tagging a release, check both READMEs and the relevant docs. After the final code, version or documentation edit, rerun base CI, L2, L3 and applicable L4. Record each result and tag only after the applicable gates pass. List challenges separately from passes. Review the outgoing history before pushing. After pushing a tag, check CI, Windows, macOS and Linux builds, and the assets on the GitHub Release.

## 2. Live dual-engine observations

On 2026-11-25, MCP launched two temporary profiles on Windows through one managed proxy. The table lists the metrics available on each page during that run.

| Site | C++ fingerprint kernel 148.0.7778.215 | System Chrome 157.0.8103.80 |
| --- | --- | --- |
| CreepJS | 0 Lies, 0 Trash, Headless 0%, Stealth 0% | 0 Lies, 0 Trash, Headless 0%, Stealth 0% |
| BrowserScan | Authenticity 100%, Bot: NoDetection, WebRTC disabled | Authenticity 100%, Bot: NoDetection, WebRTC disabled |
| BrowserLeaks WebRTC | Site reported No Leak | Site reported No Leak |
| PixelScan | Site reported inconsistent | Site reported inconsistent |

All eight site and engine combinations returned explicit verdicts, with PixelScan reporting `inconsistent` on both engines. Record an observed human-verification challenge separately as `CAPTCHA/Challenge`. Results depend on the browser version, proxy and site at the time of the run.

## 3. CI & Automated Releases

- **Continuous Integration ([ci.yml](../.github/workflows/ci.yml))**: Runs `npm run check`, `npm run lint`, `npm run prepare:singbox`, `npm test`, and `npm run build` on every push to `main` and every pull request, and updates test status badges.
- **Release Pipeline ([release.yml](../.github/workflows/release.yml))**: Pushing a `v*` tag matching `package.json` (`git tag -a v1.6.0 -m "MultiChrome v1.6.0" && git push origin v1.6.0`) runs pre-release checks, builds Windows (`.exe`), macOS (`.dmg` / `.zip`), and Linux (`.AppImage` / `.deb`) installers in parallel, generates `SHA256SUMS.txt` + SLSA build provenance attestations, and publishes to GitHub Releases.

## Local client verification

The Windows UI suite pins MCP SDK 1.32.2, Playwright MCP 0.0.86 and Chrome DevTools MCP 1.14.0. The SDK exercises HTTP and stdio, enumerates four tools and requests a profile summary. Both page clients connect to a profile-specific endpoint and list local fixture tabs. See E2E-12 in the current run.

Windows packaging also starts the unpacked stdio entry point with Node and verifies tool discovery. The offline Electron suite uses a temporary SQLite database, settings store and synthetic proxy addresses to exercise legacy reads, encryption on explicit save, storage outages, restore rollback and retry.
