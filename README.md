# Beat Fiend

Beat Fiend is a local-first tiny beatmap DAW with a rhythm-game playtest mode. The current focus is importing songs, aligning a 4/4 beat grid, recording lane events against the song timeline, refining beatmaps, and then playtesting the feel.

<img width="3726" height="1536" alt="image" src="https://github.com/user-attachments/assets/ebad07ec-73cf-47b3-bf62-45b395d33a4a" />

## Current controls

- `Space` - kick lane
- `W` - snare lane
- `Left Arrow` - low melody lane
- `Up Arrow` - mid melody lane
- `Right Arrow` - high melody lane

## Quickstart

Requirements:

- Node.js 24 or newer
- npm
- Linux x64 or Windows x64
- Internet access during installation and YouTube imports
- A modern browser

Install dependencies and start Beat Fiend:

```bash
npm install
npm run dev:all
```

The first companion startup downloads about 140 MB of pinned, checksum-verified media tools. It then opens Beat Fiend automatically. If the browser does not open, visit:

```txt
http://localhost:5173
```

No system installation of yt-dlp, FFmpeg, or ffprobe is required on Linux x64 or Windows x64. macOS, ARM64, and other platforms currently require trusted tool paths through `BEAT_FIEND_YT_DLP`, `BEAT_FIEND_FFMPEG`, and `BEAT_FIEND_FFPROBE`.

The development command starts:

- Beat Fiend on `http://localhost:5173`
- The legacy import/save server on `http://localhost:5174`
- The local audio companion on `http://127.0.0.1:47831`

## Local YouTube import

Start Beat Fiend, open **Config**, pair the local companion if necessary, and paste a YouTube URL. The companion downloads and normalizes the audio locally. Re-importing the same URL reuses its cached audio.

Beatmaps remain in browser storage and can be backed up with **Config → Beatmap backups → Export library**. Companion audio remains local and is not included in beatmap exports.

## App tabs

- **Play** - rhythm/parry gameplay for feeling the current beatmap.
- **Editor** - primary timeline for transport, beat grid calibration, recording, snapping, and saving.
- **Config** - YouTube import and input bindings.
- **Debug** - raw timing and developer controls.

## Build

```bash
npm run build
```

The current bundle is large because React Three Fiber / Drei / Three.js are bundled together. That is acceptable for this prototype.
