# Security Policy

## Security Architecture & Trust Boundaries

MultiChrome is designed as a **100% local-first** desktop application:

- **Zero Cloud Sync**: Profiles, cookies, fingerprint seeds, and encrypted proxy configurations never leave your local machine.
- **Credential Protection**: Managed proxy configurations and credentials are encrypted with OS-backed Electron `safeStorage`. Plaintext fallback is rejected when OS secure storage is unavailable.
- **Fail-Closed Proxy Isolation**: Managed and manual proxy profiles disable QUIC, lock WebRTC non-proxied UDP policies (via CLI flags and Chromium `Preferences`), force remote DNS resolution, and reject `direct` proxy fallbacks.
- **Log Redaction**: Application logs and proxy logs redact credentials, tokens, URLs with embedded secrets, and query parameters before entering in-memory buffers.

## Supply-Chain Verification for Third-Party Components

MultiChrome does **not** bundle third-party binaries (`sing-box` or `fingerprint-chromium`) in source control or release installers. Instead, users download them on demand inside **Settings**:

1. **Official GitHub Allowlist**: Automated downloads strictly enforce HTTPS and allow only official GitHub hosts (`github.com`, `api.github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`) across all redirects.
2. **Mandatory SHA-256 Integrity Check**: Every download is verified against its official GitHub Release `sha256` digest before extraction. Any mismatch immediately aborts installation and removes temporary files.
3. **Self-Compiled / Local Import Support**: Users who prefer full build provenance can compile `sing-box` or `fingerprint-chromium` from source and import the local binary directly in Settings.

## Recommended Engine Tiering

- **Official Google Chrome** (`system-chrome`): Strongly recommended for security-sensitive workflows, enterprise/banking accounts, and primary accounts due to Google code signing and fastest zero-day security patching.
- **C++ Anti-Fingerprint Kernel** (`fingerprint-chromium`): Intended for multi-account anti-correlation workflows. Prefer releases marked **Source Auditable** (whose upstream patch tags are already published on GitHub) or self-compiled builds, and monitor outbound hostnames via the built-in proxy log panel.

## Reporting a Vulnerability

If you discover a security issue (such as an IP/DNS/WebRTC leak, credential exposure, or download verification bypass):

- Please avoid posting exploitable details publicly in issues before a fix is available.
- Open a private security advisory via GitHub Security Advisories on this repository, or report reproducible non-sensitive findings via [GitHub Issues](https://github.com/OliverWalker1122/multichrome/issues).
