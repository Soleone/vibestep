# Vibestep Design Notes: Open Browser Rhythm Game + Powerful Map Editor

## Current direction

Vibestep is now aimed at being an **open Guitar Hero / Beat Saber-style rhythm game that runs in the browser** and ships with a serious built-in map editor.

The project should be understood as two tightly connected products:

1. **A browser rhythm game** for playing local/imported songs and custom charts.
2. **A powerful, low-friction map editor** for generating, recording, correcting, saving, and sharing beatmaps.

The editor is not secondary. The core promise is:

> Import a song, get or make a chart quickly, refine it by feel, then play it immediately in the browser.

## One-sentence pitch

Vibestep is an open, browser-based rhythm game and map editor where players can import songs, create charts by playing along, manually polish them on a DAW-like grid, and own/export their maps.

## Product identity

Vibestep should sit closest to:

- Guitar Hero / Clone Hero
- Beat Saber
- StepMania
- Osu-style community mapping
- lightweight DAW/piano-roll editors

The distinctive value is not just “a rhythm game in the browser.” It is:

- open formats
- local-first ownership
- instant browser play
- jam-based chart creation
- DAW-like manual correction
- import/generation workflow
- modding/remix potential

## Design priority

The chart is the game.

Presentation can be parry/combat-flavored, but gameplay and editor readability matter more than enemy content. Avoid building bespoke enemies or scripted encounters until the core song → map → play loop feels excellent.

## Core user loop

1. Import or select a song.
2. Load or generate a draft beatmap.
3. Press play and test the chart.
4. Press record and play lane keys by feel.
5. Use the timeline grid for precise cleanup.
6. Save/export the beatmap.
7. Replay immediately.

The editor should support both creator mindsets:

### Feel recording

This is the main charting workflow:

- press Record
- song plays
- user taps lanes with keyboard/pad controls
- inputs are captured as notes
- optional quantization snaps them to the grid
- stop recording merges/overdubs/replaces notes

Current lane keys:

- Space = kick
- W = snare
- Left Arrow = low
- Up Arrow = mid
- Right Arrow = high

### Manual adjustment

When not recording, the timeline behaves like an editor:

- click empty lane area to add a snapped note
- click an existing note to remove it
- use grid divisions for precision
- zoom to see more or less of the song
- eventually drag notes, select ranges, copy/paste, loop sections

## Editor direction

The editor should become DAW-like, but focused and approachable.

Important editor concepts:

- fixed lane rows
- beat ruler at the top
- clear bar/beat/subdivision grid lines
- zoom that changes visible song duration
- snap grid independent of zoom
- current-time/playhead marker
- compact transport controls
- prominent record controls
- metadata and destructive actions separated from active editing

### Current editor principles learned

- The main editing surface should live in the main pane, not hidden in a scrollable sidebar.
- Sidebar controls should be secondary: metadata, library, save-as/new/export/wipe.
- Primary controls belong above the timeline: play/pause, record, mode, lanes, grid, zoom, tempo, selection.
- Do not duplicate controls between sidebar and main pane.
- The layout must not reflow when switching tabs; tabs and panels should remain stable.
- Focused text inputs must not be intercepted by gameplay key handlers.

### Zoom vs grid

Zoom and grid are separate concepts:

- **Zoom** controls how much of the song is visible: e.g. 2s, 4s, 10s, 30s, whole song.
- **Grid division** controls musical snapping/subdivision: 1/4, 1/8, 1/16, 1/32.

Changing zoom should make the same musical beats appear larger or smaller on screen. Changing grid should add/remove subdivision lines and change snap precision.

### Lane layout

The timeline should show exactly the active lanes, currently five:

1. kick
2. snare
3. low
4. mid
5. high

Lane rows should be compact, clearly separated, and labelled on the left side of the lane. Empty space below the active lanes should remain empty and available for future tools, not appear as fake lanes.

## Gameplay model

### Inputs

Current five-lane keyboard layout:

- Space = kick
- W = snare
- Left Arrow = low
- Up Arrow = mid
- Right Arrow = high

Five lanes are expressive but may be awkward for some players. A four-lane mode and configurable key bindings are likely needed later.

### Timing

Use rhythm-game timing as the baseline:

- symmetric early/late hit windows
- perfect/good/miss
- visible timing delta
- calibration eventually

Key principle:

> Notes should arrive on the beat. Projectiles should not launch on the beat.

### Visual layout

The current parry/projectile view gives the game identity, but the project should remain open to a more conventional highway if readability demands it.

Candidate modes:

1. Current right-to-left parry lanes.
2. Conventional note highway toward a hit line.
3. Hybrid combat highway with avatars/sources at the far end.

Evaluate by readability and density handling, not theme preference.

## Beatmap model

Beatmaps remain the playable source of truth.

```ts
type Beatmap = {
  id: string;
  songId: string;
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  bpm: number;
  offsetMs?: number;
  version: number;
  durationMs: number;
  notes: Note[];
};
```

Notes should support:

- lane
- impact time
- optional duration for holds
- source metadata: generated/manual/manual-grid/manual-hold/imported
- confidence for generated notes later

BPM is fundamental editor state and must stick per song/beatmap. Future work should persist BPM, offset, downbeat, and grid preferences in the saved beatmap and/or song metadata.

## Song/map ownership

Vibestep should be local-first by default:

- local imports
- local cached audio
- local beatmaps
- transparent JSON
- no account required
- easy export/import
- no required central server

Sharing should avoid redistributing copyrighted audio. Beatmaps should be separable from source audio.

## Auto-generation

Auto-generation is a draft helper, not magic.

The generated chart only needs to be useful enough to edit. The editor must make correction fast.

Near-term generated-map goals:

- better BPM detection
- beat offset/downbeat calibration
- stronger kick/snare onset extraction
- confidence metadata
- region replacement tools
- difficulty thinning/intensifying

## Open-source angle

Open source should be concrete:

- documented map format
- documented import/cache structure
- modular analyzers
- import/export tools
- theme/skin support
- configurable lanes/inputs
- browser-first deployment
- local-first defaults

Potential contributor areas:

- chart generators
- format import/export
- timing calibration
- editor tools
- visual themes
- accessibility modes
- performance optimization

## Near-term goals

Highest priority now:

1. Make the editor feel professional and maintainable.
2. Keep extracting editor UI into proper components instead of inline JSX blobs.
3. Improve timeline correctness: ruler, zoom, playhead, lane layout, snapping.
4. Add drag/move notes and range selection.
5. Add beat offset/downbeat calibration.
6. Improve save/duplicate/delete/rename safety for beatmaps.
7. Improve generated draft maps.
8. Make recording-by-feel satisfying and reliable.
9. Keep the play view readable as charts become denser.

## Engineering guidance

The editor is becoming complex enough to require real abstractions:

- separate timeline component
- separate toolbar/transport components
- typed timeline bounds/grid helpers
- isolated note editing operations
- reusable play/pause control
- eventually separate editor state management from `App.tsx`

Avoid large inline JSX blocks for complex UI. The code should make the product model obvious: song, beatmap, transport, timeline, grid, recording, selection.

## Risks

### Risk: It is just another rhythm game

Mitigation: focus on open import/edit/share workflow, not only gameplay.

### Risk: Editor becomes messy

Mitigation: componentize aggressively and keep interaction modes simple.

### Risk: Generated maps feel bad

Mitigation: treat generation as a draft and make manual correction fast.

### Risk: Browser timing issues

Mitigation: calibration, explicit timing logic, browser testing.

### Risk: Five lanes are awkward

Mitigation: configurable layouts and possible four-lane mode.

### Risk: Copyright/sharing problems

Mitigation: local-first audio, separate beatmap export.

## Decision checkpoint

After the editor and play loop are stronger, evaluate:

- Can a user create a fun map quickly?
- Is feel-recording faster than manual charting?
- Is manual cleanup pleasant enough?
- Does the parry theme help or hurt readability?
- Should the game view become a more conventional highway?

Current north star:

> Build the most accessible open rhythm charting and playback loop possible in the browser, with a powerful map editor as a first-class feature.
