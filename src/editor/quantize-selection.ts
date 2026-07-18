import type { BeatmapNote } from '../game/model'

export function snapTimeToGrid(timeMs: number, beatOffsetMs: number, gridMs: number) {
  return Math.max(0, beatOffsetMs + Math.round((timeMs - beatOffsetMs) / gridMs) * gridMs)
}

export function quantizeSelectedNotes(
  notes: BeatmapNote[],
  selectedNoteIds: ReadonlySet<string>,
  beatOffsetMs: number,
  gridMs: number,
) {
  return notes
    .map((note) => selectedNoteIds.has(note.id)
      ? {
          ...note,
          rawTimeMs: note.rawTimeMs ?? note.impactTimeMs,
          impactTimeMs: snapTimeToGrid(note.impactTimeMs, beatOffsetMs, gridMs),
        }
      : note)
    .sort((a, b) => a.impactTimeMs - b.impactTimeMs)
}
