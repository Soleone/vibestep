# Tiny beatmap DAW pivot

See the detailed implementation plan at:

```txt
/home/soleone/data/plans/2026-07-07-flow-fight-tiny-beatmap-daw-pivot.md
```

## Direction

Flow Fight should be treated as a tiny beatmap DAW where Editor is the primary product surface and Playtest is how the user feels the current chart.

The imported song audio is the source of truth. The playhead, beat grid, notes, quantization, and gameplay all derive from that timeline.

## Immediate priorities

1. Rename app structure around Library, Editor, Playtest, and Debug.
2. Make transport and playhead first-class.
3. Improve BPM and beat 1 calibration.
4. Preserve raw versus snapped note timing.
5. Add note inspector and non-destructive quantization.
6. Add loop regions for editing and practice.
