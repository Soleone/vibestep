import type { Lane } from './model'
import type { ParryGrade } from './timing'

export type RunNoteJudgement = {
  id: string
  noteId: string
  occurrenceKey: string
  lane: Lane
  noteTimeMs: number
  judgedAtSongTimeMs: number
  grade: ParryGrade
  deltaMs: number | null
}

export type PlayRun = {
  id: string
  songId: string
  beatmapId: string
  beatmapVersion?: number
  startedAt: string
  startedAtSongTimeMs: number
  completedAt?: string
  judgements: RunNoteJudgement[]
}

export type RunNoteSummary = {
  noteId: string
  occurrenceKey: string
  lane: Lane
  noteTimeMs: number
  grade: ParryGrade
  deltaMs: number | null
}

export function createPlayRun({
  id,
  songId,
  beatmapId,
  beatmapVersion,
  startedAt,
  startedAtSongTimeMs,
}: Omit<PlayRun, 'judgements' | 'completedAt'>): PlayRun {
  return { id, songId, beatmapId, beatmapVersion, startedAt, startedAtSongTimeMs, judgements: [] }
}

export function summarizeRunNotes(run: PlayRun | null | undefined) {
  const summariesByOccurrence = new Map<string, RunNoteSummary>()
  const failedDeltasByOccurrence = new Map<string, number>()

  for (const judgement of run?.judgements ?? []) {
    if ((judgement.grade === 'early' || judgement.grade === 'late') && judgement.deltaMs !== null) {
      const previousDelta = failedDeltasByOccurrence.get(judgement.occurrenceKey)
      if (previousDelta === undefined || Math.abs(judgement.deltaMs) < Math.abs(previousDelta)) {
        failedDeltasByOccurrence.set(judgement.occurrenceKey, judgement.deltaMs)
      }
    }

    const diagnosticDeltaMs = judgement.grade === 'miss'
      ? failedDeltasByOccurrence.get(judgement.occurrenceKey) ?? null
      : judgement.deltaMs
    summariesByOccurrence.set(judgement.occurrenceKey, {
      noteId: judgement.noteId,
      occurrenceKey: judgement.occurrenceKey,
      lane: judgement.lane,
      noteTimeMs: judgement.noteTimeMs,
      grade: judgement.grade,
      deltaMs: diagnosticDeltaMs,
    })
  }

  const summariesByNote = new Map<string, RunNoteSummary>()
  for (const summary of summariesByOccurrence.values()) summariesByNote.set(summary.noteId, summary)
  return summariesByNote
}

export function describeRunNoteSummary(summary: RunNoteSummary) {
  const label = summary.grade.charAt(0).toUpperCase() + summary.grade.slice(1)
  if (summary.deltaMs === null) return `${label}, no input`
  const roundedDeltaMs = Math.round(summary.deltaMs)
  if (roundedDeltaMs === 0) return `${label}, on time`
  return `${label}, ${Math.abs(roundedDeltaMs)}ms ${roundedDeltaMs < 0 ? 'early' : 'late'}`
}
