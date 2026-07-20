# Built-in songs

Built-in songs are downloaded completely into session memory before playback. Vibestep verifies the byte length and SHA-256 digest, creates a local Blob URL, and does not write the audio to IndexedDB. The song package and license metadata remain in `public/builtin-song-catalog.json`.

## One-time Cloudflare R2 setup

1. Authenticate Wrangler:

   ```bash
   npm run r2:login
   ```

2. Create the bucket:

   ```bash
   npx wrangler r2 bucket create vibestep-songs
   ```

3. Enable the bucket's public `r2.dev` development URL in the Cloudflare dashboard.

4. Copy `.env.r2.example` to `.env.r2.local` and enter the bucket name and public URL.

5. Apply browser CORS rules:

   ```bash
   npm run r2:cors
   ```

The committed policy permits GET and HEAD requests from local Vite, `vibestep.vercel.app`, `vibestep.app`, and `www.vibestep.app`. Update `config/r2-cors.json` if another web origin needs access.

Cloudflare documents `r2.dev` as a development endpoint. Before production traffic grows, connect a custom domain such as `audio.vibestep.app` to the bucket and update `R2_PUBLIC_BASE_URL`.

## Prepare metadata

Create one JSON file containing a valid Vibestep song package and the redistribution license:

```json
{
  "songPackage": {
    "format": "song-package",
    "version": 1,
    "id": "example-track",
    "song": {
      "id": "example-track",
      "title": "Example Track",
      "artist": "Example Artist",
      "durationMs": 180000,
      "sources": [
        {
          "kind": "url",
          "url": "https://artist.example/tracks/example-track",
          "label": "Original release page"
        }
      ]
    },
    "timingProfiles": [
      {
        "id": "default",
        "name": "Default",
        "bpm": 120,
        "beatOffsetMs": 0,
        "timeSignature": [4, 4]
      }
    ],
    "beatmaps": [
      {
        "id": "normal",
        "title": "Normal",
        "difficulty": 2,
        "timingProfileId": "default",
        "durationMs": 180000,
        "notes": []
      }
    ],
    "defaultTimingProfileId": "default",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "license": {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Example Track by Example Artist",
    "sourceUrl": "https://artist.example/tracks/example-track"
  }
}
```

The package must contain at least one beatmap. Its timing must be authored against the exact audio bytes being uploaded.

## Upload

Upload a local file:

```bash
npm run song:upload -- \
  --source ./incoming/example-track.mp3 \
  --metadata ./incoming/example-track.json
```

A remote HTTP(S) source also works because the upload command runs locally in Node:

```bash
npm run song:upload -- \
  --source https://downloads.example/example-track.mp3 \
  --metadata ./incoming/example-track.json
```

The command:

1. validates the metadata and song package,
2. limits individual audio files to 50 MiB,
3. calculates SHA-256,
4. uploads to `songs/<song-id>/<sha256>.<extension>`,
5. sets an immutable cache header on the object, and
6. updates `public/builtin-song-catalog.json`.

Commit the catalog change with the beatmap metadata. Audio stays outside Git.

Replacing a song id with different bytes is rejected because encoding changes can invalidate timing. After revalidating every beatmap against the new file, replacement can be made explicitly:

```bash
npm run song:upload -- --source ./revised.mp3 --metadata ./revised.json --replace
```

Wrangler credentials are held outside the application. The deployed browser only receives public read URLs.
