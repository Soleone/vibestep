# Flow Fight Agent Primer

This file is for coding agents starting fresh in this repo.

## Writing style

Do not use em dashes in agent responses, docs, UI copy, or code comments. Use commas, semicolons, parentheses, or short sentences instead.

## Project vision

Flow Fight is a tiny beatmap DAW with a rhythm/parry playtest mode. The long-term idea is: import any song, align a 4/4 beat grid, generate or record a draft beatmap from musical events, refine the beatmap by jamming along, then playtest it with rhythm-game timing plus parry/defense feedback.

Current gameplay is lane-based:

- `Space` = kick
- `W` = snare
- `Left Arrow` = low melody lane
- `Up Arrow` = mid melody lane
- `Right Arrow` = high melody lane

Projectiles should **hit the pad on the beat**. Do not schedule notes so projectiles launch on the beat.

## Tech stack

- React 19 + TypeScript + Vite
- React Three Fiber / Drei / Three.js for the game view
- Local Express server for YouTube import, cache, beatmap persistence
- `yt-dlp`, `ffmpeg`, `ffprobe` are required for local importing
- `fft-js` is used by the server for rough audio onset analysis

Important files:

```txt
src/App.tsx          Main app, scene, tabs, gameplay state, editor UI
src/App.css          Layout and UI styling
src/game/timing.ts   Timing judgement logic
server/index.js      Local import/cache/beatmap API
public/imports/      Local imported song cache
```

## How to run

Use the full local dev command for almost all work:

```bash
npm run dev:all
```

`npm run dev` only starts Vite, so import/cache/save APIs will not work.

Validate changes with:

```bash
./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build
```

## Current implementation details

### Timing

Timing judgement lives in `src/game/timing.ts`.

The current rhythm-game model is symmetric:

```txt
Parry ±80ms means 80ms early or 80ms late succeeds.
Perfect ±40ms means 40ms early or 40ms late is perfect.
```

This is intentional for rhythm mode. Combat-only parry might eventually use early-only windows, but not right now.

### Lanes and projectiles

Lane definitions are currently in `src/App.tsx`:

```ts
Lane = 'kick' | 'snare' | 'low' | 'mid' | 'high'
```

Colors:

- kick: blue
- snare: red
- low: green
- mid: purple
- high: orange

The game screen shows five small pads on the left and five horizontal cannons on the right. Static lane guide lines are intentionally hidden; lanes are implied by projectile paths/trails.

Pad and cannon trigger animations use the same small eased horizontal nudge. The pad nudge happens on key press. The cannon nudge happens when a projectile starts.

Idle/default mode fires a simple 1-2-3-4 pattern:

```txt
kick, snare, kick, snare
```

### Status cards

Bottom-right status uses fixed-width subtle cards:

1. phase: `queued`, `incoming`, etc.
2. judgement: `perfect`, `good`, `early`, `late`, `miss`, `ready`
3. ms delta: e.g. `-12.4ms`, `+8.0ms`, or `-`

Color rules:

- perfect = gold
- good = green
- successful ms delta matches judgement color
- missed early ms = green
- missed late ms = red
- auto miss shows `miss` red and `-` for ms

These cards should eventually be toggleable.

### Song import/cache

`server/index.js` implements:

- `GET /api/health`
- `GET /api/imports`
- `GET /api/imports/:songId/beatmaps`
- `POST /api/import-youtube`
- `POST /api/imports/:songId/beatmaps`

Imports are cached by `sourceUrl` in `meta.json`. If the same YouTube URL is imported again, the server should return the cached import rather than downloading again.

### Beatmap storage

Each imported song can have multiple beatmaps:

```txt
public/imports/<songId>/
  audio.mp3
  meta.json
  beatmap.json              legacy/current generated map
  beatmaps/
    auto-kick-snare.json
    my-map.json
    .history/
```

Saving a beatmap writes to `beatmaps/<id>.json`, increments `version`, and copies previous versions into `.history` when possible.

Beatmaps include metadata such as:

```ts
{
  id,
  songId,
  title,
  difficulty: 1 | 2 | 3 | 4 | 5,
  bpm,
  version,
  notes
}
```

### Beatmap generation

The current automatic analyzer is intentionally simple and drum-focused. It only generates:

- kick notes on `Space`
- snare/clap notes on `W`

It uses FFT band onset/flux peak picking. It tries to hit snares and thins kicks to every second detected kick. The analyzer is still rough and may feel wrong on many songs. Manual jam editing is expected.

### Beatmap editor / jam recorder

The Editor tab is the primary product surface and supports:

- selecting current beatmap
- setting title
- setting difficulty stars
- saving current map
- saving as new map
- exporting JSON
- arming lanes
- add/replace recording modes
- quantization
- tap BPM with live detected BPM feedback
- beat 1 offset/downbeat alignment
- playhead dragging with snap support
- timeline view around current playback time

Manual note recording:

- keydown starts a note
- keyup ends a note
- hold shorter than 200ms becomes a tap
- hold 200ms or longer stores `durationMs`

Hold notes currently render as larger projectiles. Full hold gameplay/scoring is not complete yet.

### Run stats

Playtest stats track:

- hits
- perfects
- goods
- misses
- current streak
- best streak
- accuracy

Misses are counted when an active projectile passes beyond the hit window without being hit.

## Open plans / next work

High-priority UX/game-feel tasks:

1. Improve beatmap timeline/editor visualization.
2. Make saved beatmap management safer and clearer: duplicate, delete, rename, auto map read-only by default.
3. Improve auto drum extraction, especially snare reliability and kick thinning.
4. Add proper hold gameplay: hold start judgement, drain/shrink visual, early release miss, hold completion.
5. Add options/toggles for status cards and debug overlays.
6. Improve playfield layout and lane readability as more simultaneous notes appear.
7. Continue polishing BPM/grid support: metronome, raw-vs-snapped note display, and note inspector.
8. Eventually support melody/high-hat lanes from better analysis or manual mapping.

Design principles learned so far:

- Do not rely on helper timing UI in the main game. The projectile motion/path should communicate timing.
- Note impact time is the source of truth; projectile launch time is calculated backward from travel time.
- Multiple projectiles must coexist. Hitting one note must never hide unrelated projectiles.
- UI should avoid overwhelming the player; advanced tuning belongs in Options/Debug/Edit.
- Auto beatmaps are drafts. Manual jam editing is core to the workflow.
