import type { BeatmapNote, Lane } from './model'
import type { ParryGrade } from './timing'

export type RunNoteSnapshot = {
  impactTimeMs: number
  lane: Lane
  durationMs?: number
}

export type RunNoteJudgement = {
  id: string
  noteId: string
  noteRevisionKey: string
  noteSnapshot: RunNoteSnapshot
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
  noteRevisionKey: string
  noteSnapshot: RunNoteSnapshot
  occurrenceKey: string
  lane: Lane
  noteTimeMs: number
  grade: ParryGrade
  deltaMs: number | null
}

const normalizeRevisionTime = (timeMs: number) => Math.round(timeMs * 1000) / 1000

export function createRunNoteSnapshot(note: Pick<BeatmapNote, 'impactTimeMs' | 'lane' | 'durationMs'>): RunNoteSnapshot {
  return {
    impactTimeMs: normalizeRevisionTime(note.impactTimeMs),
    lane: note.lane,
    ...(note.durationMs === undefined ? {} : { durationMs: normalizeRevisionTime(note.durationMs) }),
  }
}

export function createNoteRevisionKey(note: Pick<BeatmapNote, 'impactTimeMs' | 'lane' | 'durationMs'>) {
  const snapshot = createRunNoteSnapshot(note)
  return `note-v1:${snapshot.lane}:${snapshot.impactTimeMs}:${snapshot.durationMs ?? 'tap'}`
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

export type RunOccurrenceSummary = {
  summary: RunNoteSummary
  summaryEventIndex: number
}

export function summarizeRunOccurrenceEntries(run: PlayRun | null | undefined) {
  const entriesByOccurrence = new Map<string, RunOccurrenceSummary>()
  const failedDeltasByOccurrence = new Map<string, number>()
  const terminalOccurrences = new Set<string>()

  for (const [eventIndex, judgement] of (run?.judgements ?? []).entries()) {
    if (terminalOccurrences.has(judgement.occurrenceKey)) continue

    if ((judgement.grade === 'early' || judgement.grade === 'late') && judgement.deltaMs !== null) {
      const previousDelta = failedDeltasByOccurrence.get(judgement.occurrenceKey)
      if (previousDelta !== undefined && Math.abs(judgement.deltaMs) >= Math.abs(previousDelta)) {
        const existing = entriesByOccurrence.get(judgement.occurrenceKey)
        if (existing) existing.summaryEventIndex = eventIndex
        continue
      }
      failedDeltasByOccurrence.set(judgement.occurrenceKey, judgement.deltaMs)
    }

    const diagnosticDeltaMs = judgement.grade === 'miss'
      ? failedDeltasByOccurrence.get(judgement.occurrenceKey) ?? null
      : judgement.deltaMs
    entriesByOccurrence.set(judgement.occurrenceKey, {
      summary: {
        noteId: judgement.noteId,
        noteRevisionKey: judgement.noteRevisionKey,
        noteSnapshot: judgement.noteSnapshot,
        occurrenceKey: judgement.occurrenceKey,
        lane: judgement.lane,
        noteTimeMs: judgement.noteTimeMs,
        grade: judgement.grade,
        deltaMs: diagnosticDeltaMs,
      },
      summaryEventIndex: eventIndex,
    })
    if (judgement.grade === 'perfect' || judgement.grade === 'good' || judgement.grade === 'miss') {
      terminalOccurrences.add(judgement.occurrenceKey)
    }
  }

  return entriesByOccurrence
}

export function summarizeRunOccurrences(run: PlayRun | null | undefined) {
  return new Map([...summarizeRunOccurrenceEntries(run)].map(([occurrenceKey, entry]) => [occurrenceKey, entry.summary]))
}

export function summarizeRunNotes(run: PlayRun | null | undefined) {
  const latestByNote = new Map<string, RunOccurrenceSummary>()
  for (const entry of summarizeRunOccurrenceEntries(run).values()) {
    const previous = latestByNote.get(entry.summary.noteId)
    if (!previous || entry.summaryEventIndex > previous.summaryEventIndex) latestByNote.set(entry.summary.noteId, entry)
  }
  return new Map([...latestByNote].map(([noteId, entry]) => [noteId, entry.summary]))
}

export function filterCurrentNoteRevisions(summaries: ReadonlyMap<string, RunNoteSummary>, notes: Array<Pick<BeatmapNote, 'id' | 'impactTimeMs' | 'lane' | 'durationMs'>>) {
  const currentRevisionKeys = new Map(notes.map((note) => [note.id, createNoteRevisionKey(note)]))
  return new Map([...summaries].filter(([noteId, summary]) => currentRevisionKeys.get(noteId) === summary.noteRevisionKey))
}

export function summarizeLatestValidNoteResults(runs: PlayRun[], notes: Array<Pick<BeatmapNote, 'id' | 'impactTimeMs' | 'lane' | 'durationMs'>>) {
  const currentRevisionKeys = new Map(notes.map((note) => [note.id, createNoteRevisionKey(note)]))
  const latestResults = new Map<string, RunNoteSummary>()
  for (const run of runs.toSorted((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    for (const [noteId, summary] of summarizeRunNotes(run)) {
      if (currentRevisionKeys.get(noteId) === summary.noteRevisionKey) latestResults.set(noteId, summary)
    }
  }
  return latestResults
}

export function describeRunNoteSummary(summary: RunNoteSummary) {
  const label = summary.grade.charAt(0).toUpperCase() + summary.grade.slice(1)
  if (summary.deltaMs === null) return `${label}, no input`
  const roundedDeltaMs = Math.round(summary.deltaMs)
  if (roundedDeltaMs === 0) return `${label}, on time`
  return `${label}, ${Math.abs(roundedDeltaMs)}ms ${roundedDeltaMs < 0 ? 'early' : 'late'}`
}
