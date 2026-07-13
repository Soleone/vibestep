# Beat Fiend

Beat Fiend is a local-first beatmap studio with a rhythm-game playtest mode. Import a song, align its beat grid, record or edit lane events, then playtest the result.

<img width="3726" height="1536" alt="Beat Fiend editor" src="https://github.com/user-attachments/assets/ebad07ec-73cf-47b3-bf62-45b395d33a4a" />

## Quick start

Open **[beatfiend.vercel.app](https://beatfiend.vercel.app)** in a modern desktop browser. No account or installation is required. Chrome or Edge on Windows is the currently tested setup.

### Add an audio file

1. Open **Config**.
2. Under **Import audio**, select **Choose an audio file**.
3. Choose a supported MP3, M4A, WebM, Ogg, or WAV file.
4. Wait for Beat Fiend to load the song and its empty custom beatmap.

The file is copied into this browser profile's IndexedDB storage. It is not uploaded to Beat Fiend.

### Import from YouTube

YouTube import uses the optional Windows companion:

1. Open **Config** and select **Download companion for Windows**.
2. Run `Beat-Fiend-Companion-Setup.exe`. The early installer is unsigned, so Windows may require **More info → Run anyway**. Confirm that it came from `github.com/Soleone/beatfiend`.
3. Keep the companion window open while importing. It opens Beat Fiend and pairs the browser automatically.
4. Paste a supported YouTube URL under **Import audio**, then select **Import**.

First launch downloads checksum-verified media tools and can take longer. YouTube audio remains in the companion cache on this computer. Closing the companion window stops it completely. The companion is not needed for file uploads, editing, playtesting, backups, or shared beatmap metadata.

### Create and play a beatmap

1. Open **Editor** and select the song and beatmap.
2. Set the BPM and place beat 1 on the correct downbeat.
3. Arm lanes, choose add or replace recording, then record along with playback.
4. Refine notes in the timeline and select **Save**.
5. Open **Play** to playtest the saved map.

## Default controls

| Lane | Keyboard | Gamepad |
| --- | --- | --- |
| Kick | `A` | `A` |
| Snare | `D` | `B` |
| Low melody | `Left Arrow` | D-pad left |
| Mid melody | `Down Arrow` | D-pad down |
| High melody | `Right Arrow` | D-pad right |

Controls can be changed from Config.

## Storage and backups

Beat Fiend has no cloud account or central song library.

| Data | Storage |
| --- | --- |
| Songs, timing profiles, and beatmaps | This browser's local storage |
| Files selected without the companion | This browser's IndexedDB storage |
| YouTube and companion-imported audio | The companion's private cache on your computer |
| Portable backups and shared maps | JSON files you explicitly export |

The hosted app serves only the application. It does not receive or store imported audio. Browser storage belongs to one browser profile on one device.

Open **Config → Library transfer → Export library** regularly. Exported backups contain source links, timing profiles, and beatmaps, but intentionally exclude audio. Keep original audio files because restoring in another browser may ask for them.

Clearing site data, resetting the browser profile, or uninstalling the browser can remove the local library. Beat Fiend has no cloud recovery service.

## Sharing beatmaps

The prerequisite sharing model from task `j7s` is complete. Export from the **Beatmaps** card to create a portable JSON bundle for one map, multiple difficulties, or a multi-song mixtape. Bundles include source links, timing, and notes, but no copyrighted audio.

Recipients import the bundle and provide the original file or retrieve the corresponding YouTube source locally with the companion.

## Troubleshooting

### Companion is offline

Start **Beat Fiend Companion**, leave its window open, and use **Pair this browser** if Beat Fiend does not switch to `paired` automatically.

### A saved song has no audio

Choose the original file again. Backups and shared bundles intentionally do not contain audio.

### YouTube import fails

Confirm that the companion says **Ready**, the URL is a supported YouTube URL, and the computer is online. Close and reopen the companion if its first-run tool download was interrupted.

### Update check fails

Download the newest installer from [GitHub Releases](https://github.com/Soleone/beatfiend/releases/latest). Installing it over the existing version keeps the companion cache.

## Development

Requirements:

- Node.js 24 or newer
- npm
- Linux x64 or Windows x64 for automatic media-tool provisioning

Install the exact locked dependencies and start Vite plus the companion:

```bash
npm ci
npm run dev:all
```

Open `http://localhost:5173` if it does not open automatically. The first companion startup downloads pinned, checksum-verified media tools.

Useful commands:

```bash
npm test
npm run lint
npm run build
npm run dev:companion
```

The app is a static Vite deployment. Companion development and Windows releases are documented in [companion/README.md](./companion/README.md) and [companion/RELEASE.md](./companion/RELEASE.md).
