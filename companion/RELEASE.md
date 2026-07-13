# Companion release process

The Windows companion is a per-user, one-click NSIS installer. It embeds Electron and the Beat Fiend loopback service, so users do not need Node.js, npm, or a terminal. Media tools are downloaded on first launch from pinned release URLs and verified with SHA-256 before use.

## User flow

1. Download `Beat-Fiend-Companion-Setup.exe` from the Beat Fiend Config screen or GitHub Releases.
2. Run the installer. It installs without administrator access and launches the companion.
3. The companion provisions verified media tools, starts on `127.0.0.1:47831`, and opens `https://beatfiend.vercel.app` with pairing data in the URL fragment.
4. Closing the status window keeps the tray process running. The companion does not start at login. Use the tray menu to reopen Beat Fiend, pair another browser, view status, or quit.
5. Updates download automatically from GitHub Releases. The status window prompts before restarting to install them.

Uninstall from Windows Settings under Apps. Browser-owned songs and beatmaps remain in the browser. Companion cache data remains in `%LOCALAPPDATA%\Beat Fiend Companion` unless the user removes it manually.

## Local packaging

```bash
npm ci
npm test
npm run build
npm run companion:dist:win
```

Builds are unsigned. The installer is written to `release/Beat-Fiend-Companion-Setup.exe`.

## GitHub release

Releases are built by `.github/workflows/companion-release.yml` on `windows-2025`. No paid signing service or external release credentials are required. Update the version in `package.json`, commit it, and push a tag such as:

```bash
git tag companion-v0.1.0
git push origin companion-v0.1.0
```

Electron Builder emits updater metadata and publishes the installer to GitHub Releases. CI records a GitHub build-provenance attestation.

## Windows SmartScreen

The installer is intentionally unsigned, so Windows may show a SmartScreen warning. Users can select **More info**, verify that the download came from `github.com/Soleone/beatfiend`, then select **Run anyway**. Publish the installer checksum and provenance attestation with every release. Do not claim that Windows recognizes or verifies the publisher.

Review dependency updates, especially Electron and `electron-updater`, before every release.

## GPL media tools

The companion downloads yt-dlp and FFmpeg-family executables on demand. Before a public installer release, review `companion/THIRD_PARTY_NOTICES.md`, verify every source link still corresponds to the pinned binary, and preserve the notices in release materials. If distribution behavior changes from on-demand download to bundling, obtain legal review and update the source-offer process first.
