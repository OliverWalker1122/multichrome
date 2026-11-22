<div align="center">

<img src="assets/icon.png" alt="MultiChrome" width="72" />

# MultiChrome

A local-first, cross-platform desktop manager for isolated browser profiles.

[![CI](https://github.com/OliverWalker1122/multichrome/actions/workflows/ci.yml/badge.svg)](https://github.com/OliverWalker1122/multichrome/actions/workflows/ci.yml)
[![Release](https://github.com/OliverWalker1122/multichrome/actions/workflows/release.yml/badge.svg)](https://github.com/OliverWalker1122/multichrome/actions/workflows/release.yml)
[![Tests](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OliverWalker1122/multichrome/badges/test-badge.json)](https://github.com/OliverWalker1122/multichrome/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/OliverWalker1122/multichrome.svg)](https://github.com/OliverWalker1122/multichrome/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/OliverWalker1122/multichrome)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

English · [简体中文](README.md)

</div>

---

## Overview

MultiChrome is a desktop application built with Electron and Fluent UI for isolating and managing multiple browser profiles, proxy configurations, and runtime environments on a single machine. All profiles, settings, and credentials stay local with no cloud dependency.

## Features

- **Dual Browser Engines**: Choose between official Google Chrome or an on-demand open-source `fingerprint-chromium` kernel per profile.
- **Isolated Proxy Management**: Managed `sing-box` proxy routing with multi-protocol support, batch import, exit probing, reuse warnings, and fail-closed leak protection.
- **Environment Consistency**: Optional automatic alignment for timezone, language, and geolocation based on proxy exit region, with pre-launch consistency checks and a health inspection dialog.
- **Profile Lifecycle & Resource Tools**: Group management, profile cloning, 30-day trash recovery, live memory monitoring, cache cleanup, and bookmark/extension templates.
- **Local-First & Bilingual**: Credentials encrypted via OS secure storage, live outbound host audit logs, instant English / Chinese switching, and Windows / macOS / Linux support.

## Installation

Download the installer for your platform from [GitHub Releases](https://github.com/OliverWalker1122/multichrome/releases). The app bundles its runtime and requires no extra frameworks.

> First-launch note: Releases are not commercially code-signed. On Windows, click **More info → Run anyway** if SmartScreen appears. On macOS, allow the app in **System Settings → Privacy & Security** or run `xattr -cr /Applications/MultiChrome.app`.

Optional third-party components (`sing-box` and `fingerprint-chromium`) are not bundled. You can download and verify them on demand inside **Settings → Cores & Kernels**, or import local builds.

To run from source:

```bash
git clone https://github.com/OliverWalker1122/multichrome.git
cd multichrome
npm install
npm run dev
```

## Documentation

- [Architecture & Design](docs/architecture.md) — Dual-engine model, fail-closed networking, supply-chain verification, and repository layout
- [Testing & Verification](docs/verification.md) — 4-layer test suite, external checker observations, and release automation
- [Development & Packaging](docs/development.md) — Building from source, running tests, and creating platform installers
- [Security Policy](SECURITY.md) — Threat model and vulnerability disclosure
- [Roadmap](ROADMAP.md) — Completed milestones and planned work

## License

Released under the [MIT License](LICENSE). Optional user-downloaded components (`sing-box`, `fingerprint-chromium`) remain subject to their respective upstream licenses.
