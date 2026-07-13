import type { BeatmapNote } from '../game/model'

export type TimelineNote = BeatmapNote & { pending: boolean; recording?: boolean }

function lowerBound(notes: TimelineNote[], timeMs: number) {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (notes[middle].impactTimeMs < timeMs) low = middle + 1
    else high = middle
  }
  return low
}

function upperBound(notes: TimelineNote[], timeMs: number) {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (notes[middle].impactTimeMs <= timeMs) low = middle + 1
    else high = middle
  }
  return low
}

export function windowTimelineNotes(
  notes: TimelineNote[],
  startMs: number,
  endMs: number,
  selectedNoteIds: ReadonlySet<string>,
  maximumRenderedNotes = 2500,
  holdLookbackMs = 0,
) {
  const candidates = notes.slice(lowerBound(notes, startMs - holdLookbackMs), upperBound(notes, endMs))
  const visible = candidates.filter((note) => note.impactTimeMs <= endMs && note.impactTimeMs + (note.durationMs ?? 0) >= startMs)
  if (visible.length <= maximumRenderedNotes) return visible

  const mustRender = visible.filter((note) => note.pending || selectedNoteIds.has(note.id))
  const mustRenderIds = new Set(mustRender.map((note) => note.id))
  const sampleBudget = Math.max(0, maximumRenderedNotes - mustRender.length)
  if (sampleBudget === 0) return mustRender.sort((a, b) => a.impactTimeMs - b.impactTimeMs)

  const sampleCandidates = visible.filter((note) => !mustRenderIds.has(note.id))
  const stride = sampleCandidates.length / sampleBudget
  const sampled = Array.from({ length: sampleBudget }, (_, index) => sampleCandidates[Math.floor(index * stride)])
  return [...mustRender, ...sampled].sort((a, b) => a.impactTimeMs - b.impactTimeMs)
}
