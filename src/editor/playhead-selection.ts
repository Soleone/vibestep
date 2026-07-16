import type { BeatmapNote } from '../game/model.ts'

export function notesTouchedByPlayhead(
  notes: BeatmapNote[],
  startTimeMs: number,
  endTimeMs: number,
  excludeStart = false,
): Set<string> {
  if (excludeStart && startTimeMs === endTimeMs) return new Set()

  const movingForward = endTimeMs >= startTimeMs
  const rangeStartMs = Math.min(startTimeMs, endTimeMs)
  const rangeEndMs = Math.max(startTimeMs, endTimeMs)
  const touchedIds = new Set<string>()

  notes.forEach((note) => {
    const noteEndMs = note.impactTimeMs + Math.max(0, note.durationMs ?? 0)
    const touched = note.durationMs
      ? movingForward
        ? note.impactTimeMs <= rangeEndMs && noteEndMs >= rangeStartMs && (!excludeStart || noteEndMs > startTimeMs)
        : note.impactTimeMs <= rangeEndMs && noteEndMs >= rangeStartMs && (!excludeStart || note.impactTimeMs < startTimeMs)
      : note.impactTimeMs >= rangeStartMs
        && note.impactTimeMs <= rangeEndMs
        && (!excludeStart || note.impactTimeMs !== startTimeMs)
    if (touched) touchedIds.add(note.id)
  })

  return touchedIds
}
