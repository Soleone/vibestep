# Beatmap precision notes

## Problem

Recording and replay can feel ambiguous when the editor has a BPM but no true musical downbeat. Many songs have intros, pickups, or silence before the first clear beat, so a grid starting at `0ms` can have the right spacing but the wrong phase. That makes it hard to tell whether a note was played badly, quantized unexpectedly, or replayed badly.

## Current precision model

Calibration now exists at two levels:

```ts
// song-level calibration, shared by every beatmap for that song
bpm: number
beatOffsetMs: number

// beatmap-level snapshot, saved with an individual map for portability
bpm: number
beatOffsetMs: number
```

The song-level values are authoritative inside the app. Setting BPM or **Set beat 1 here** persists for the current song and applies when switching between that song's beatmaps. Beatmap saves still include the current values as a child-level snapshot so exported maps remain portable.

`beatOffsetMs` is the time where musical **beat 1** starts. Timeline grid and quantization are relative to this offset:

```txt
beatOffsetMs + n * gridMs
```

instead of starting at zero.

## Editor UX added

In the Edit timeline toolbar:

- `Beat 1 · X.XXXs` shows the current downbeat offset.
- `Set beat 1 here` stores the current playhead time as beat 1, useful when the real song start happens after an intro.
- `-10ms` / `+10ms` nudges the whole grid earlier/later.
- Timeline ruler labels now show 4/4 bar numbers from `beatOffsetMs`, so bar starts count `1, 2, 3, 4` and continue forward.
- Quantized recording and click-to-add notes snap relative to `beatOffsetMs`.
- Clicking the ruler row moves the playhead to that point, using the same Snap behavior as dragging, without recentering the timeline viewport.
- Mouse wheel over the timeline scrolls the playhead through the song. When Snap is enabled, each wheel notch advances by the active grid unit. Hold Alt while scrolling for free/no-snap seeking. When wheel seeking reaches the edge guard near either side, two active grid units from the edge, the timeline scrolls so the playhead sticks at that relative position instead of disappearing.
- Shift + mouse wheel zooms the timeline in or out.
- Dragging the playhead also snaps to the current grid when Snap is enabled; hold Shift while clicking or dragging for free/no-snap seeking.

## Suggested calibration workflow

1. Import/load a song.
2. Estimate BPM with tap or manual entry.
3. Drag/play to the first clear downbeat after the intro.
4. Click **Set at playhead**.
5. Use the numbered bar ruler and nudge buttons until the grid visually matches the song.
6. Record or place notes with Snap enabled.
7. If notes feel wrong later, first check whether the grid phase is correct before assuming the performance was wrong.

## Follow-up ideas

- Add a metronome preview: high click on 1, low clicks on 2/3/4.
- Show raw recorded marker vs snapped marker with snap delta.
- Add non-destructive recording mode: record raw first, quantize selected/all later.
- Add finer nudges (`±1ms`) and larger nudges (`±beat`, `±bar`).
- Make playhead snap behavior more visible in the UI.
- Show selected note musical position, e.g. `Bar 8 Beat 2 +12ms`.
