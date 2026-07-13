# Beat Fiend

Beat Fiend is a local-first beatmap studio with a rhythm-game playtest mode. Import a song, align its beat grid, record or edit lane events, then playtest the result.

<img width="3726" height="1536" alt="Beat Fiend editor" src="https://github.com/user-attachments/assets/ebad07ec-73cf-47b3-bf62-45b395d33a4a" />

## Quick start

Open **[beatfiend.vercel.app](https://beatfiend.vercel.app)** in a modern desktop browser. No account or installation is required. Chrome or Edge on Windows is the currently tested setup.

### 1. Playing

To play an existing map:

1. Import its shared JSON bundle from the **Beatmaps** card, or select a map already in your local library.
2. Provide the corresponding audio. Under **Config → Import audio**, choose a supported MP3, M4A, WebM, Ogg, or WAV file.
3. Open **Play**, select the song and beatmap, then start playback.

The file is copied into this browser profile's IndexedDB storage. It is not uploaded to Beat Fiend.

For YouTube audio, install the optional Windows companion from **Config → Download companion for Windows**. Run `Beat-Fiend-Companion-Setup.exe`, keep its window open, paste a supported YouTube URL, then select **Import**. The unsigned early installer may require **More info → Run anyway**. Confirm that it came from `github.com/Soleone/beatfiend`.

First companion launch downloads checksum-verified media tools and can take longer. YouTube audio remains in its private cache. Closing the companion stops it completely.

### 2. Editing

Before recording or moving notes, establish these two essentials:

1. **Find the song's BPM.** Look it up, enter a known value, or use **Start tap** in the Editor to tap along and detect it.
2. **Set beat 1.** Move the playhead to the first downbeat, then select **Set beat 1 here**.

These values define the beat grid. If either is wrong, snapping, quantization, bar repeats, timeline grid lines, and rhythm timing will not line up reliably. Recording purely by feel can still capture input, but later editing against the grid will fail.

Once the foundation is correct:

1. Select the song and beatmap in **Editor**.
2. Arm the lanes you want to record.
3. Choose add or replace recording, then perform along with playback.
4. Refine notes in the timeline and select **Save**.
5. Open **Play** to test the finished map.

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
