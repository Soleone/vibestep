# Flow Fight

Flow Fight is a local-first tiny beatmap DAW with a rhythm/parry playtest mode. The current focus is importing songs, aligning a 4/4 beat grid, recording lane events against the song timeline, refining beatmaps, and then playtesting the feel.

## Current controls

- `Space` - kick lane
- `W` - snare lane
- `Left Arrow` - low melody lane
- `Up Arrow` - mid melody lane
- `Right Arrow` - high melody lane

## Quickstart

Install dependencies:

```bash
npm install
```

Run the full local tool, including the React app and local import/save server:

```bash
npm run dev:all
```

Open the Vite URL, usually:

```txt
http://localhost:5173
```

## Local YouTube import

YouTube import is local/dev-only. It shells out to:

- `yt-dlp`
- `ffmpeg`
- `ffprobe`

Install them first, for example:

```bash
sudo apt install ffmpeg yt-dlp
```

Then use the **Config** tab to paste a YouTube URL. Imported songs are cached under:

```txt
public/imports/<songId>/
  audio.mp3
  source.webm
  meta.json
  beatmap.json
  beatmaps/
```

Re-importing the same URL reuses the cached song instead of downloading it again.

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
