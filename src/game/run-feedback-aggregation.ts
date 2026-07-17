import type { BeatmapNote } from './model'
import { createNoteRevisionKey, summarizeRunOccurrenceEntries, type PlayRun, type RunNoteSnapshot, type RunNoteSummary } from './run-history.ts'

export const MIN_TREND_ATTEMPTS = 3
export const DOMINANT_DIRECTION_RATIO = 0.7
export const MATERIAL_DIRECTION_RATIO = 0.3
export const CENTER_DEAD_ZONE_MS = 10

export type NoteFeedbackDirection = 'early' | 'late' | 'mixed' | 'centered' | 'no-input' | 'insufficient'
export type NoteFeedbackConfidence = 'low' | 'medium' | 'high'

export type NoteFeedbackAggregate = {
  noteId: string
  noteRevisionKey: string
  noteSnapshot: RunNoteSnapshot
  attemptCount: number
  runCount: number
  perfectCount: number
  goodCount: number
  mistimedMissCount: number
  noInputMissCount: number
  unresolvedFailureCount: number
  earlyInputCount: number
  lateInputCount: number
  centeredInputCount: number
  successRate: number
  perfectRate: number
  missRate: number
  medianDeltaMs: number | null
  medianAbsoluteDeviationMs: number | null
  direction: NoteFeedbackDirection
  confidence: NoteFeedbackConfidence
  latestResult: RunNoteSummary
}

type DirectionEvidence = {
  earlyInputCount: number
  lateInputCount: number
  centeredInputCount: number
  noInputMissCount?: number
  unresolvedFailureCount?: number
  medianDeltaMs: number | null
  medianAbsoluteDeviationMs: number | null
}

type AggregateBucket = {
  noteId: string
  noteRevisionKey: string
  noteSnapshot: RunNoteSnapshot
  summaries: RunNoteSummary[]
  runIds: Set<string>
  latestResult: RunNoteSummary
  latestRunIndex: number
  latestEventIndex: number
}

export function median(values: readonly number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function medianAbsoluteDeviation(values: readonly number[], center = median(values)) {
  if (values.length === 0 || center === null) return null
  return median(values.map((value) => Math.abs(value - center)))
}

export function classifyNoteFeedback({
  earlyInputCount,
  lateInputCount,
  centeredInputCount,
  noInputMissCount = 0,
  unresolvedFailureCount = 0,
  medianDeltaMs,
  medianAbsoluteDeviationMs,
}: DirectionEvidence): NoteFeedbackDirection {
  const timedAttemptCount = earlyInputCount + lateInputCount + centeredInputCount
  if (timedAttemptCount === 0) return noInputMissCount > 0 && unresolvedFailureCount === 0 ? 'no-input' : 'insufficient'
  if (medianDeltaMs === null || medianAbsoluteDeviationMs === null) return 'insufficient'

  const earlyShare = earlyInputCount / timedAttemptCount
  const lateShare = lateInputCount / timedAttemptCount
  const opposingDirectionsAreMaterial = earlyInputCount > 0 && lateInputCount > 0
    && earlyShare >= MATERIAL_DIRECTION_RATIO && lateShare >= MATERIAL_DIRECTION_RATIO
  if (opposingDirectionsAreMaterial && medianAbsoluteDeviationMs > CENTER_DEAD_ZONE_MS) return 'mixed'
  if (timedAttemptCount < MIN_TREND_ATTEMPTS) return 'insufficient'
  if (earlyShare >= DOMINANT_DIRECTION_RATIO && medianDeltaMs < -CENTER_DEAD_ZONE_MS) return 'early'
  if (lateShare >= DOMINANT_DIRECTION_RATIO && medianDeltaMs > CENTER_DEAD_ZONE_MS) return 'late'
  if (Math.abs(medianDeltaMs) <= CENTER_DEAD_ZONE_MS && medianAbsoluteDeviationMs <= CENTER_DEAD_ZONE_MS) return 'centered'
  return 'mixed'
}

export function noteFeedbackConfidence(attemptCount: number): NoteFeedbackConfidence {
  if (attemptCount < MIN_TREND_ATTEMPTS) return 'low'
  return attemptCount < 6 ? 'medium' : 'high'
}

export function aggregateNoteFeedback(
  runs: readonly PlayRun[],
  currentNotes: Array<Pick<BeatmapNote, 'id' | 'impactTimeMs' | 'lane' | 'durationMs'>>,
) {
  const currentRevisionKeys = new Map(currentNotes.map((note) => [note.id, createNoteRevisionKey(note)]))
  const buckets = new Map<string, AggregateBucket>()
  const chronologicalRuns = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))

  chronologicalRuns.forEach((run, runIndex) => {
    for (const { summary, summaryEventIndex: latestEventIndex } of summarizeRunOccurrenceEntries(run).values()) {
      if (currentRevisionKeys.get(summary.noteId) !== summary.noteRevisionKey) continue
      const existing = buckets.get(summary.noteId)
      if (!existing) {
        buckets.set(summary.noteId, {
          noteId: summary.noteId,
          noteRevisionKey: summary.noteRevisionKey,
          noteSnapshot: summary.noteSnapshot,
          summaries: [summary],
          runIds: new Set([run.id]),
          latestResult: summary,
          latestRunIndex: runIndex,
          latestEventIndex,
        })
        continue
      }
      existing.summaries.push(summary)
      existing.runIds.add(run.id)
      if (runIndex > existing.latestRunIndex || (runIndex === existing.latestRunIndex && latestEventIndex > existing.latestEventIndex)) {
        existing.latestResult = summary
        existing.latestRunIndex = runIndex
        existing.latestEventIndex = latestEventIndex
      }
    }
  })

  const aggregates = new Map<string, NoteFeedbackAggregate>()
  for (const bucket of buckets.values()) {
    let perfectCount = 0
    let goodCount = 0
    let mistimedMissCount = 0
    let noInputMissCount = 0
    let unresolvedFailureCount = 0
    let earlyInputCount = 0
    let lateInputCount = 0
    let centeredInputCount = 0
    const timedDeltas: number[] = []

    for (const summary of bucket.summaries) {
      if (summary.grade === 'perfect') perfectCount += 1
      else if (summary.grade === 'good') goodCount += 1
      else if (summary.grade === 'miss') {
        if (summary.deltaMs === null) noInputMissCount += 1
        else mistimedMissCount += 1
      } else unresolvedFailureCount += 1

      if (summary.deltaMs === null) continue
      timedDeltas.push(summary.deltaMs)
      if (summary.deltaMs < -CENTER_DEAD_ZONE_MS) earlyInputCount += 1
      else if (summary.deltaMs > CENTER_DEAD_ZONE_MS) lateInputCount += 1
      else centeredInputCount += 1
    }

    const attemptCount = bucket.summaries.length
    const medianDeltaMs = median(timedDeltas)
    const medianAbsoluteDeviationMs = medianAbsoluteDeviation(timedDeltas, medianDeltaMs)
    const missCount = mistimedMissCount + noInputMissCount + unresolvedFailureCount
    aggregates.set(bucket.noteId, {
      noteId: bucket.noteId,
      noteRevisionKey: bucket.noteRevisionKey,
      noteSnapshot: bucket.noteSnapshot,
      attemptCount,
      runCount: bucket.runIds.size,
      perfectCount,
      goodCount,
      mistimedMissCount,
      noInputMissCount,
      unresolvedFailureCount,
      earlyInputCount,
      lateInputCount,
      centeredInputCount,
      successRate: (perfectCount + goodCount) / attemptCount,
      perfectRate: perfectCount / attemptCount,
      missRate: missCount / attemptCount,
      medianDeltaMs,
      medianAbsoluteDeviationMs,
      direction: classifyNoteFeedback({ earlyInputCount, lateInputCount, centeredInputCount, noInputMissCount, unresolvedFailureCount, medianDeltaMs, medianAbsoluteDeviationMs }),
      confidence: noteFeedbackConfidence(attemptCount),
      latestResult: bucket.latestResult,
    })
  }
  return aggregates
}
