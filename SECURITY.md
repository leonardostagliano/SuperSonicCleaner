# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older versions | No |

We recommend always running the latest version of SuperSonicCleaner.

## Reporting a Vulnerability

If you discover a security vulnerability in SuperSonicCleaner, **please do not open a public issue.**

Instead, report it privately via [GitHub Security Advisories](https://github.com/leonardostagliano/SuperSonicCleaner/security/advisories/new).

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Reports are reviewed privately. Coordinated fixes can credit the reporter in release notes unless they prefer otherwise.

## Scope

This policy covers the SuperSonicCleaner desktop application and its source code. It does not cover third-party dependencies — please report those to the respective maintainers.

## Security Design

SuperSonicCleaner is a system cleaner that operates with elevated permissions. We take this responsibility seriously:

- **Local scanning and cleaning** — File scanning and cleanup operate on the device. Application updates and optional package-manager operations use their respective network services.
- **Optional AI analysis** — Analysis is off by default. Each request requires an explicit action and sends only validated, pseudonymous metadata through the existing Codex login. File names, paths and contents are excluded. See [the AI data boundary](docs/AI_ANALYSIS.md).
- **Open source** — Every operation is auditable. We encourage security researchers to review our code.
- **Verified release artifacts** — Release workflows verify package checksums and update manifests before publishing. Code signing is optional for this fork; see [release and installation details](RELEASE.md).
