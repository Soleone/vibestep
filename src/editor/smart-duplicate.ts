import type { BeatmapNote, Lane } from '../game/model.ts'

export type SmartDuplicatePlan = {
  sourceNotes: BeatmapNote[]
  shiftMs: number
}

type SmartDuplicateOptions = {
  notes: BeatmapNote[]
  selectedNoteIds: ReadonlySet<string>
  playheadMs: number
  bpm: number
  beatOffsetMs: number
  songEndMs: number
}

const barIndexAt = (timeMs: number, beatOffsetMs: number, barMs: number) =>
  Math.floor((timeMs - beatOffsetMs) / barMs)

const barStartAt = (barIndex: number, beatOffsetMs: number, barMs: number) =>
  beatOffsetMs + barIndex * barMs

const noteOverlapsRange = (note: BeatmapNote, startMs: number, endMs: number) => {
  const noteEndMs = note.impactTimeMs + Math.max(0, note.durationMs ?? 0)
  return note.durationMs
    ? note.impactTimeMs < endMs && noteEndMs > startMs
    : note.impactTimeMs >= startMs && note.impactTimeMs < endMs
}

export function planSmartDuplicate({
  notes,
  selectedNoteIds,
  playheadMs,
  bpm,
  beatOffsetMs,
  songEndMs,
}: SmartDuplicateOptions): SmartDuplicatePlan | null {
  if (!Number.isFinite(bpm) || bpm <= 0 || songEndMs <= 0) return null

  const barMs = 4 * (60000 / bpm)
  let sourceNotes: BeatmapNote[]
  let sourceStartBar: number
  let sourceEndBar: number

  if (selectedNoteIds.size > 0) {
    sourceNotes = notes.filter((note) => selectedNoteIds.has(note.id))
    if (sourceNotes.length === 0) return null

    sourceStartBar = Math.min(...sourceNotes.map((note) => barIndexAt(note.impactTimeMs, beatOffsetMs, barMs)))
    sourceEndBar = Math.max(...sourceNotes.map((note) => {
      const durationMs = Math.max(0, note.durationMs ?? 0)
      const finalOccupiedTimeMs = durationMs > 0 ? note.impactTimeMs + durationMs - 0.001 : note.impactTimeMs
      return barIndexAt(finalOccupiedTimeMs, beatOffsetMs, barMs)
    }))
  } else {
    sourceStartBar = barIndexAt(Math.max(0, playheadMs), beatOffsetMs, barMs)
    sourceEndBar = sourceStartBar

    const barHasNotes = (barIndex: number) => {
      const startMs = barStartAt(barIndex, beatOffsetMs, barMs)
      return notes.some((note) => note.impactTimeMs >= startMs && note.impactTimeMs < startMs + barMs)
    }

    if (!barHasNotes(sourceStartBar)) return null
    while (barHasNotes(sourceEndBar + 1)) sourceEndBar += 1

    const sourceStartMs = barStartAt(sourceStartBar, beatOffsetMs, barMs)
    const sourceEndMs = barStartAt(sourceEndBar + 1, beatOffsetMs, barMs)
    sourceNotes = notes.filter((note) => note.impactTimeMs >= sourceStartMs && note.impactTimeMs < sourceEndMs)
  }

  if (sourceNotes.length === 0) return null

  const sourceLanes = new Set<Lane>(sourceNotes.map((note) => note.lane))
  const barCount = sourceEndBar - sourceStartBar + 1
  let targetStartBar = sourceEndBar + 1

  while (true) {
    const targetStartMs = barStartAt(targetStartBar, beatOffsetMs, barMs)
    const targetEndMs = barStartAt(targetStartBar + barCount, beatOffsetMs, barMs)
    if (targetEndMs > songEndMs + 0.001) return null

    const targetIsEmpty = !notes.some((note) =>
      sourceLanes.has(note.lane) && noteOverlapsRange(note, targetStartMs, targetEndMs),
    )
    if (targetIsEmpty) {
      const sourceStartMs = barStartAt(sourceStartBar, beatOffsetMs, barMs)
      return {
        sourceNotes: sourceNotes.toSorted((a, b) => a.impactTimeMs - b.impactTimeMs),
        shiftMs: targetStartMs - sourceStartMs,
      }
    }

    targetStartBar += 1
  }
}
