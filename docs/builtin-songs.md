# Built-in songs

Built-in songs are downloaded completely into session memory before playback. Vibestep verifies the byte length and SHA-256 digest, creates a local Blob URL, and does not write the audio to IndexedDB. Song packages and license metadata live in `public/builtin-song-catalog.json`.

## One-time Cloudflare R2 setup

1. Authenticate Wrangler:

   ```bash
   npm run r2:login
   ```

2. Create or select the R2 bucket and enable its public `r2.dev` development URL in the Cloudflare dashboard.

3. Copy `.env.r2.example` to `.env.r2.local` and enter the bucket name and public URL.

4. Apply browser CORS rules:

   ```bash
   npm run r2:cors
   ```

The committed policy permits GET and HEAD requests from local Vite, `vibestep.vercel.app`, `vibestep.app`, and `www.vibestep.app`. Update `config/r2-cors.json` if another web origin needs access.

Cloudflare documents `r2.dev` as a development endpoint. Before production traffic grows, connect a custom domain such as `audio.vibestep.app` to the bucket and update `R2_PUBLIC_BASE_URL`.

## Fast intake and mapping workflow

### 1. Intake the audio

Give the command a local audio file:

```bash
npm run song:intake -- "./incoming/Artist - Track.mp3"
```

Or give it a direct HTTP(S) audio URL. The command downloads the complete remote file immediately before processing and upload:

```bash
npm run song:intake -- "https://downloads.example/Artist%20-%20Track.mp3"
```

The command infers artist and title from an `Artist - Track` filename or URL. It asks only for missing details, the source or license evidence URL, the license, and explicit confirmation that redistribution is permitted. CC0 is the prompt default, but it is never assumed without confirmation.

Intake then:

1. downloads a remote source immediately when a URL is provided,
2. uploads the audio to `songs/<song-id>/<sha256>.<extension>`,
3. generates the song package, attribution, timing profile, and empty starter map,
4. updates `public/builtin-song-catalog.json`, and
5. makes the song available to local Vibestep after a refresh.

The starter package intentionally uses duration `0`. When the browser loads the verified audio, its `loadedmetadata` event supplies the authoritative duration to the editor. Saving or exporting the map persists that measured duration without requiring local media-analysis tools during intake.

For a non-interactive invocation, provide the important facts explicitly:

```bash
npm run song:intake -- "./incoming/track.mp3" \
  --artist "Artist" \
  --title "Track" \
  --source-url "https://artist.example/track" \
  --license cc0 \
  --yes
```

`--yes` means the operator has verified that the selected license permits redistribution. Supported shortcuts are `cc0` and `cc-by-4.0`.

### 2. Create the beatmap

Start or refresh local Vibestep, select the new song marked **Built-in**, and edit the generated draft map normally. The audio downloads fully into session memory before editing or playback. Saving the map stores the draft package in this browser's IndexedDB while continuing to use the verified R2 audio.

The starter BPM is 120. Supply a known value during intake when useful:

```bash
npm run song:intake -- "./incoming/track.mp3" --bpm 174
```

The editor can still correct BPM and beat offset before mapping.

### 3. Publish the finished map

Use the existing **Export** action for the saved beatmap, then pass the downloaded Vibestep JSON directly to:

```bash
npm run song:publish-map -- "$HOME/Downloads/track-draft.vibestep.json"
```

The command matches the song by package id, merges the exported timing and map into its existing catalog entry, preserves the R2 audio and license metadata, and removes the empty starter map when it has been replaced.

Commit and deploy the resulting catalog change:

```bash
git add public/builtin-song-catalog.json
git commit -m "content: publish built-in beatmap"
git push
```

## Safety properties

- Audio files are limited to 50 MiB each.
- Object keys include SHA-256 and are immutable.
- Replacing an existing song id with different audio is rejected by default because encoding changes can invalidate timing.
- Browser playback verifies byte length and SHA-256 before creating the local Blob URL.
- Wrangler credentials remain outside the application and repository.
- The deployed browser receives only public read URLs.

## Advanced metadata upload

The lower-level command remains available when a complete song package and custom license metadata already exist:

```bash
npm run song:upload -- \
  --source ./incoming/track.mp3 \
  --metadata ./incoming/track-metadata.json
```

Pass `--replace` only after revalidating every beatmap against revised audio bytes.
