# Releases and installation

This fork publishes to **leonardostagliano/SuperSonicCleaner**. The application, update manifest, repository links and release workflow use that repository explicitly. No upstream signing account or package-manager credentials are required.

## Automatic releases

`.github/workflows/automatic-release.yml` runs on pushes to `main` and can also be started from GitHub Actions. Enable Actions in the fork and allow its `GITHUB_TOKEN` to write repository contents. No personal access token is needed for a public repository.

The workflow runs the repository checks and packaged application smoke tests, calculates a stable version from Conventional Commits, builds Windows x64 NSIS and portable packages, macOS Intel/Apple Silicon DMG and ZIP packages, and Linux x64/arm64 AppImage and DEB packages, and creates a draft release. It verifies installer sizes and SHA-512 update metadata, uploads all assets plus `SHA256SUMS.txt`, verifies GitHub's SHA-256 upload digests, and only then publishes the release as Latest. Failed uploads leave a draft that can be recovered by rerunning the same commit.

- `fix`, `perf` and other changes increment the patch version.
- `feat` increments the minor version; `!` or `BREAKING CHANGE` increments the major version.
- Published fork releases are the version history. Inherited upstream tags are never mistaken for published fork releases.
- The calculated version is written only in the CI checkout before building. No bot commit is pushed to `main`.
- Rerunning an already released commit, or an older commit covered by a release, does not publish another version.
- Automatic and manual releases share one publication lock. Tags created using `GITHUB_TOKEN` do not trigger the separate tag-release workflow.

A release becomes Latest only after every platform and all four update manifests pass verification. This keeps the shared GitHub update feed usable on every supported platform. Manual tag releases remain available for explicit versioning and recovery.

## Install and update

Download `SuperSonicCleaner-Setup-<version>.exe` from [the fork's releases](https://github.com/leonardostagliano/SuperSonicCleaner/releases/latest). It installs for all users and asks for administrator permission because SuperSonicCleaner requires elevation for its system tools. Settings are retained during upgrades.

SuperSonicCleaner is an independent application with its own installer identity and data directory. Its first installation does not replace upstream Kudu or import that application's settings. Later SuperSonicCleaner upgrades retain SuperSonicCleaner settings.

Installed copies check this fork's GitHub Releases using `electron-updater`. About shows the available version, release notes and download progress; choose **Restart and install** when ready. Background downloads are controlled in Settings. Automatic restart is off for new installations; existing preferences are retained. A downloaded update can also install when the app exits, as supported by `electron-updater`.

Portable EXE and ZIP packages require manual updates: close SuperSonicCleaner, download the matching portable package from this fork and replace the application files. Keep your existing settings. Do not run the NSIS updater against a portable directory. Linux AppImage supports in-app updates; Linux package installations use their package manager.

The optional Linux `scripts/install.sh` installs the latest x64 or arm64 AppImage for the current desktop user and verifies it against the release's `SHA256SUMS.txt`. Run it without `sudo` after reviewing the script. It uses a user-owned directory so in-app updates can replace the AppImage. It does not install background services or change system packages; FUSE dependencies are managed by the Linux distribution.

## Optional signing

Unsigned Windows builds work, but Windows SmartScreen can display an unknown-publisher warning. To sign future builds, configure repository secrets `WINDOWS_CERTIFICATE_P12` (base64 certificate or supported certificate URL) and `WINDOWS_CERTIFICATE_PASSWORD`. Use a certificate belonging to the fork maintainer. The upstream Azure signing identity is not used.

For signed/notarized macOS builds, provide `MAC_CERTIFICATE_P12`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Without the required signing/notarization inputs, both workflows build without notarization. Unsigned macOS builds have platform restrictions; production in-app macOS updates require a signed app.

## Manual multi-platform releases

The existing `release.yml` remains available for `vMAJOR.MINOR.PATCH` tags and manual recovery. It validates the matching package version and changelog, builds every platform, verifies every manifest, then publishes. `npm run release -- patch|minor|major` commits and pushes a version bump and tag; run it only when you intend to publish. Automatic releases skip its `chore(release):` commit so the pipelines do not race.

The manual script fetches remote tags, calculates its bump from the highest stable version across those tags and package.json, and runs the standard checks before changing files. This prevents a stale package version from colliding with an automatic release. Existing recovery accepts an unpublished tag and optionally a completed artifact run. It will not overwrite an already published release.

Upstream Chocolatey, winget and website distribution is gated to the upstream repository and never runs in this fork. The fork's releases are distributed through GitHub Releases.

## Verification

Run `npm run check` before committing. Focused release checks:

```sh
npx vitest run scripts/automatic-release.test.ts scripts/release-artifacts.test.ts scripts/publish-release.test.ts scripts/verify-release-run.test.ts src/main/services/auto-updater.test.ts
```

A real end-to-end update needs two published versions and an installed copy of the older version. Local unit tests and packaging checks do not simulate GitHub publication or a Windows installer replacing a running installation.

## Startup troubleshooting

Run at startup requires an installed copy. If Windows Task Scheduler rejects the setting, SuperSonicCleaner restores the previous toggle value. Check whether organization policy restricts scheduled tasks, and use the installed application's administrator restart action when system permissions are required. Do not change security policy solely to enable startup; startup scheduling is optional and the app can be opened manually.
