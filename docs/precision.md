# Beatmap precision notes

## Problem

Recording and replay can feel ambiguous when the editor has a BPM but no true musical downbeat. Many songs have intros, pickups, or silence before the first clear beat, so a grid starting at `0ms` can have the right spacing but the wrong phase. That makes it hard to tell whether a note was played badly, quantized unexpectedly, or replayed badly.

## Current precision model

Beatmaps now support:

```ts
beatOffsetMs: number
```

This is the time where musical **beat 1** starts. Timeline grid and quantization are relative to this offset:

```txt
beatOffsetMs + n * gridMs
```

instead of starting at zero.

## Editor UX added

In the Edit timeline toolbar:

- `Beat 1 · X.XXXs` shows the current downbeat offset.
- `Set at playhead` stores the current playhead time as beat 1.
- `-10ms` / `+10ms` nudges the whole grid earlier/later.
- Timeline ruler beat labels now count `1 2 3 4` repeatedly from `beatOffsetMs`.
- Quantized recording and click-to-add notes snap relative to `beatOffsetMs`.
- Dragging the playhead also snaps to the current grid when Snap is enabled; hold Shift while dragging for free/no-snap seeking.

## Suggested calibration workflow

1. Import/load a song.
2. Estimate BPM with tap or manual entry.
3. Drag/play to the first clear downbeat after the intro.
4. Click **Set at playhead**.
5. Use the 1-2-3-4 ruler and nudge buttons until the grid visually matches the song.
6. Record or place notes with Snap enabled.
7. If notes feel wrong later, first check whether the grid phase is correct before assuming the performance was wrong.

## Follow-up ideas

- Add a metronome preview: high click on 1, low clicks on 2/3/4.
- Show raw recorded marker vs snapped marker with snap delta.
- Add non-destructive recording mode: record raw first, quantize selected/all later.
- Add finer nudges (`±1ms`) and larger nudges (`±beat`, `±bar`).
- Make playhead snap behavior more visible in the UI.
- Show selected note musical position, e.g. `Bar 8 Beat 2 +12ms`.
