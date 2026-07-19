# Vibestep Companion

The companion is a headless local audio service for the hosted Vibestep web app. It binds only to `127.0.0.1`, extracts or imports audio locally, stores normalized playback files, and serves signed range requests. Beatmaps and song packages remain browser-owned.

## Development startup

Requirements:

- Node.js 24 or newer
- Internet access on first run to install checksum-verified media tools

```bash
npm install
npm run dev:all
```

This starts Vite and the companion together at `http://localhost:5173`. Running `npm run dev:companion` separately also targets the local Vite app. The companion uses a one-time pairing credential in the URL fragment, which Vibestep consumes and removes. Packaged builds continue to open the hosted app.

## Configuration

- `VIBESTEP_WEB_URL`: optional override for the app URL opened for pairing and automatically allowed as an exact origin. The default is centralized in `companion/config.js`.
- `VIBESTEP_ALLOWED_ORIGINS`: optional comma-separated additional exact browser origins
- `VIBESTEP_COMPANION_PORT`: loopback port, default `47831`
- `VIBESTEP_COMPANION_DATA_DIR`: private cache and secret directory
- `VIBESTEP_YT_DLP`, `VIBESTEP_FFMPEG`, `VIBESTEP_FFPROBE`: trusted command paths

The packaged companion uses the centralized hosted default without requiring environment variables or command-line setup. Do not use wildcard origins or bind the server to a public interface.

Windows packaging, update, and publishing instructions are in [RELEASE.md](./RELEASE.md). Third-party media tool information is in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Maintenance

```bash
npm run dev:companion -- --clear-cache
npm run dev:companion -- --rotate-secret
```

Rotating the secret invalidates paired browsers. Restart normally to pair again. Clearing the cache removes companion audio but does not remove browser-owned beatmaps.

## Tool provisioning

On first startup, `companion/tools.js` downloads release-pinned, checksum-verified x64 tools into the companion data directory. Later startups verify the cached files before reusing them. A corrupted or modified file is replaced from its pinned release.

Reviewed targets:

- Linux x64: official yt-dlp 2026.07.04 standalone binary; Shaka static FFmpeg and ffprobe 8.0.1-1
- Windows x64: official yt-dlp 2026.07.04 executable; Shaka static FFmpeg and ffprobe 8.0.1-1

The manifest uses immutable, version-specific download URLs rather than `latest` URLs. SHA-256 values are pinned from the corresponding upstream release metadata. GitHub redirects are allowed because the downloaded bytes must match the pinned checksum before installation.

Unsupported platforms must provide all required trusted command paths through `VIBESTEP_YT_DLP`, `VIBESTEP_FFMPEG`, and `VIBESTEP_FFPROBE`. These overrides are also useful for development and offline installation.

The standalone yt-dlp executable and the selected FFmpeg builds include GPL-licensed components. A distributed companion installer must ship the applicable third-party notices and satisfy source-offer requirements before release.

## Security boundary

The API accepts only supported YouTube hosts, invokes tools with argument arrays and no shell, requires the pairing credential for non-status APIs, checks `Host` and `Origin`, limits uploads and concurrent imports, returns opaque IDs, and uses expiring signed playback URLs. It never exposes local filesystem paths.
