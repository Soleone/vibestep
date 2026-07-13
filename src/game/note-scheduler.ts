import type { BeatmapNote } from './model'

export type DueNote = {
  note: BeatmapNote
  timeUntilImpactMs: number
  scheduleKey: string
}

function lowerBound(notes: BeatmapNote[], timeMs: number) {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (notes[middle].impactTimeMs < timeMs) low = middle + 1
    else high = middle
  }
  return low
}

function upperBound(notes: BeatmapNote[], timeMs: number) {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (notes[middle].impactTimeMs <= timeMs) low = middle + 1
    else high = middle
  }
  return low
}

function collectRange(notes: BeatmapNote[], startMs: number, endMs: number) {
  return notes.slice(lowerBound(notes, startMs), upperBound(notes, endMs))
}

export function findDueNotes({
  notes,
  songTimeMs,
  spawnLeadMs,
  scheduledKeys,
  loopStartMs,
  loopEndMs,
  loopCycle = 0,
  limit = 6,
}: {
  notes: BeatmapNote[]
  songTimeMs: number
  spawnLeadMs: number
  scheduledKeys: ReadonlySet<string>
  loopStartMs?: number
  loopEndMs?: number
  loopCycle?: number
  limit?: number
}): { dueNotes: DueNote[]; examinedNotes: number } {
  const hasLoop = loopStartMs !== undefined && loopEndMs !== undefined && loopEndMs > loopStartMs
  if (!hasLoop) {
    const candidates = collectRange(notes, songTimeMs, songTimeMs + spawnLeadMs)
    const dueNotes = candidates
      .filter((note) => note.impactTimeMs > songTimeMs && !scheduledKeys.has(note.id))
      .map((note) => ({ note, timeUntilImpactMs: note.impactTimeMs - songTimeMs, scheduleKey: note.id }))
      .slice(0, limit)
    return { dueNotes, examinedNotes: candidates.length }
  }

  const durationMs = loopEndMs - loopStartMs
  const normalizedSongTimeMs = Math.min(loopEndMs, Math.max(loopStartMs, songTimeMs))
  const candidates: Array<{ note: BeatmapNote; timeUntilImpactMs: number; scheduleCycle: number }> = []
  const directEndMs = Math.min(loopEndMs, normalizedSongTimeMs + spawnLeadMs)
  collectRange(notes, normalizedSongTimeMs, directEndMs).forEach((note) => {
    if (note.impactTimeMs > normalizedSongTimeMs && note.impactTimeMs < loopEndMs) {
      candidates.push({ note, timeUntilImpactMs: note.impactTimeMs - normalizedSongTimeMs, scheduleCycle: loopCycle })
    }
  })

  let remainingLeadMs = spawnLeadMs - (loopEndMs - normalizedSongTimeMs)
  let cycleOffset = 1
  while (remainingLeadMs > 0 && candidates.length < limit) {
    const rangeEndMs = Math.min(loopEndMs, loopStartMs + remainingLeadMs)
    collectRange(notes, loopStartMs, rangeEndMs).forEach((note) => {
      if (note.impactTimeMs >= loopStartMs && note.impactTimeMs < loopEndMs) {
        candidates.push({
          note,
          timeUntilImpactMs: (loopEndMs - normalizedSongTimeMs) + (cycleOffset - 1) * durationMs + (note.impactTimeMs - loopStartMs),
          scheduleCycle: loopCycle + cycleOffset,
        })
      }
    })
    remainingLeadMs -= durationMs
    cycleOffset += 1
  }

  const dueNotes = candidates
    .sort((a, b) => a.timeUntilImpactMs - b.timeUntilImpactMs)
    .flatMap(({ note, timeUntilImpactMs, scheduleCycle }) => {
      const scheduleKey = `${note.id}:${scheduleCycle}`
      return scheduledKeys.has(scheduleKey) ? [] : [{ note, timeUntilImpactMs, scheduleKey }]
    })
    .slice(0, limit)
  return { dueNotes, examinedNotes: candidates.length }
}
