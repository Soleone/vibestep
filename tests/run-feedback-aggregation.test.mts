import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateNoteFeedback, classifyNoteFeedback, median, medianAbsoluteDeviation, noteFeedbackConfidence } from '../src/game/run-feedback-aggregation.ts'
import { createNoteRevisionKey, type PlayRun, type RunNoteJudgement } from '../src/game/run-history.ts'
import type { ParryGrade } from '../src/game/timing.ts'

const currentNote = { id: 'note-1', impactTimeMs: 1000, lane: 'kick' as const }
const currentRevision = createNoteRevisionKey(currentNote)

function judgement({
  id,
  occurrenceKey = 'note-1',
  grade = 'good',
  deltaMs = 20,
  noteId = 'note-1',
  noteRevisionKey = currentRevision,
  noteTimeMs = 1000,
}: {
  id: string
  occurrenceKey?: string
  grade?: ParryGrade
  deltaMs?: number | null
  noteId?: string
  noteRevisionKey?: string
  noteTimeMs?: number
}): RunNoteJudgement {
  return {
    id,
    noteId,
    noteRevisionKey,
    noteSnapshot: { impactTimeMs: noteTimeMs, lane: 'kick' },
    occurrenceKey,
    lane: 'kick',
    noteTimeMs,
    judgedAtSongTimeMs: noteTimeMs,
    grade,
    deltaMs,
  }
}

function run(id: string, startedAt: string, judgements: RunNoteJudgement[]): PlayRun {
  return { id, songId: 'song-1', beatmapId: 'map-1', startedAt, startedAtSongTimeMs: 0, judgements }
}

function evidence(deltas: number[]) {
  const earlyInputCount = deltas.filter((delta) => delta < -10).length
  const lateInputCount = deltas.filter((delta) => delta > 10).length
  const centeredInputCount = deltas.length - earlyInputCount - lateInputCount
  const medianDeltaMs = median(deltas)
  return { earlyInputCount, lateInputCount, centeredInputCount, medianDeltaMs, medianAbsoluteDeviationMs: medianAbsoluteDeviation(deltas, medianDeltaMs) }
}

test('calculates odd and even medians without mutating input', () => {
  const even = [9, 1, 5, 3]
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median(even), 4)
  assert.deepEqual(even, [9, 1, 5, 3])
})

test('calculates median absolute deviation', () => {
  assert.equal(medianAbsoluteDeviation([1, 2, 4, 8, 16]), 3)
})

test('classifies opposite timing as mixed instead of centered', () => {
  assert.equal(classifyNoteFeedback(evidence([-100, 0, 100])), 'mixed')
  assert.equal(classifyNoteFeedback(evidence([-100, -90, -80, 30, 35, 40, 45, 50, 55, 60])), 'mixed')
})

test('classifies repeated late, early, and centered input', () => {
  assert.equal(classifyNoteFeedback(evidence([18, 22, 25, 30, 34])), 'late')
  assert.equal(classifyNoteFeedback(evidence([-18, -22, -25, -30, -34])), 'early')
  assert.equal(classifyNoteFeedback(evidence([-4, 0, 3, 5, 7])), 'centered')
})

test('shows conflicting timing even with low-confidence evidence', () => {
  assert.equal(classifyNoteFeedback(evidence([-100, 100])), 'mixed')
  assert.equal(classifyNoteFeedback(evidence([100, 110])), 'insufficient')
})

test('classifies confidence from terminal attempt count boundaries', () => {
  assert.equal(noteFeedbackConfidence(2), 'low')
  assert.equal(noteFeedbackConfidence(3), 'medium')
  assert.equal(noteFeedbackConfidence(5), 'medium')
  assert.equal(noteFeedbackConfidence(6), 'high')
})

test('aggregates every occurrence and distinct run count', () => {
  const first = run('run-1', '2026-07-16T00:00:00.000Z', [
    judgement({ id: 'j1', occurrenceKey: 'note-1:0', grade: 'perfect', deltaMs: 2 }),
    judgement({ id: 'j2', occurrenceKey: 'note-1:1', grade: 'good', deltaMs: 18 }),
  ])
  const second = run('run-2', '2026-07-16T00:01:00.000Z', [judgement({ id: 'j3', grade: 'miss', deltaMs: null })])
  const aggregate = aggregateNoteFeedback([first, second], [currentNote]).get('note-1')
  assert.ok(aggregate)
  assert.equal(aggregate.attemptCount, 3)
  assert.equal(aggregate.runCount, 2)
  assert.equal(aggregate.perfectCount, 1)
  assert.equal(aggregate.goodCount, 1)
  assert.equal(aggregate.noInputMissCount, 1)
  assert.equal(aggregate.latestResult.grade, 'miss')
})

test('preserves grade counts and timing direction for three good and two late misses', () => {
  const judgements = [
    judgement({ id: 'j1', occurrenceKey: 'n:1', grade: 'good', deltaMs: 22 }),
    judgement({ id: 'j2', occurrenceKey: 'n:2', grade: 'good', deltaMs: 28 }),
    judgement({ id: 'j3', occurrenceKey: 'n:3', grade: 'good', deltaMs: 32 }),
    judgement({ id: 'j4a', occurrenceKey: 'n:4', grade: 'late', deltaMs: 95 }),
    judgement({ id: 'j4b', occurrenceKey: 'n:4', grade: 'miss', deltaMs: null }),
    judgement({ id: 'j5a', occurrenceKey: 'n:5', grade: 'late', deltaMs: 110 }),
    judgement({ id: 'j5b', occurrenceKey: 'n:5', grade: 'miss', deltaMs: null }),
  ]
  const aggregate = aggregateNoteFeedback([run('run-1', '2026-07-16T00:00:00.000Z', judgements)], [currentNote]).get('note-1')
  assert.ok(aggregate)
  assert.equal(aggregate.goodCount, 3)
  assert.equal(aggregate.mistimedMissCount, 2)
  assert.equal(aggregate.direction, 'late')
  assert.equal(aggregate.successRate, 0.6)
})

test('excludes no-input misses from timing statistics', () => {
  const aggregate = aggregateNoteFeedback([run('run-1', '2026-07-16T00:00:00.000Z', [
    judgement({ id: 'j1', occurrenceKey: 'n:1', grade: 'miss', deltaMs: null }),
    judgement({ id: 'j2', occurrenceKey: 'n:2', grade: 'miss', deltaMs: null }),
    judgement({ id: 'j3', occurrenceKey: 'n:3', grade: 'miss', deltaMs: null }),
  ])], [currentNote]).get('note-1')
  assert.ok(aggregate)
  assert.equal(aggregate.medianDeltaMs, null)
  assert.equal(aggregate.medianAbsoluteDeviationMs, null)
  assert.equal(aggregate.direction, 'no-input')
})

test('filters prior revisions while retaining unchanged notes', () => {
  const secondNote = { id: 'note-2', impactTimeMs: 2000, lane: 'kick' as const }
  const history = run('run-1', '2026-07-16T00:00:00.000Z', [
    judgement({ id: 'j1', noteRevisionKey: createNoteRevisionKey({ ...currentNote, impactTimeMs: 990 }), noteTimeMs: 990 }),
    judgement({ id: 'j2', noteId: 'note-2', occurrenceKey: 'note-2', noteRevisionKey: createNoteRevisionKey(secondNote), noteTimeMs: 2000 }),
  ])
  const aggregates = aggregateNoteFeedback([history], [currentNote, secondNote])
  assert.equal(aggregates.has('note-1'), false)
  assert.equal(aggregates.has('note-2'), true)
})

test('ignores post-terminal events when selecting the latest occurrence', () => {
  const history = run('run-1', '2026-07-16T00:00:00.000Z', [
    judgement({ id: 'j1', occurrenceKey: 'n:1', grade: 'good', deltaMs: -30 }),
    judgement({ id: 'j2', occurrenceKey: 'n:2', grade: 'perfect', deltaMs: 2 }),
    judgement({ id: 'j3', occurrenceKey: 'n:1', grade: 'late', deltaMs: 100 }),
  ])
  const aggregate = aggregateNoteFeedback([history], [currentNote]).get('note-1')
  assert.equal(aggregate?.latestResult.occurrenceKey, 'n:2')
  assert.equal(aggregate?.attemptCount, 2)
})

test('uses the latest unresolved input for occurrence chronology while keeping the closest delta', () => {
  const history = run('run-1', '2026-07-16T00:00:00.000Z', [
    judgement({ id: 'j1', occurrenceKey: 'n:1', grade: 'early', deltaMs: -40 }),
    judgement({ id: 'j2', occurrenceKey: 'n:2', grade: 'early', deltaMs: -30 }),
    judgement({ id: 'j3', occurrenceKey: 'n:1', grade: 'late', deltaMs: 100 }),
  ])
  const aggregate = aggregateNoteFeedback([history], [currentNote]).get('note-1')
  assert.equal(aggregate?.latestResult.occurrenceKey, 'n:1')
  assert.equal(aggregate?.latestResult.deltaMs, -40)
})

test('run input order does not change aggregation or chronological latest result', () => {
  const older = run('run-old', '2026-07-16T00:00:00.000Z', [judgement({ id: 'j1', grade: 'perfect', deltaMs: 0 })])
  const newer = run('run-new', '2026-07-16T00:01:00.000Z', [judgement({ id: 'j2', grade: 'good', deltaMs: 25 })])
  const forward = aggregateNoteFeedback([older, newer], [currentNote]).get('note-1')
  const reverse = aggregateNoteFeedback([newer, older], [currentNote]).get('note-1')
  assert.deepEqual(reverse, forward)
  assert.equal(forward?.latestResult.grade, 'good')
})

test('falls back to remaining evidence when a run is removed', () => {
  const older = run('run-old', '2026-07-16T00:00:00.000Z', [judgement({ id: 'j1', grade: 'perfect', deltaMs: 0 })])
  const newer = run('run-new', '2026-07-16T00:01:00.000Z', [judgement({ id: 'j2', grade: 'miss', deltaMs: null })])
  assert.equal(aggregateNoteFeedback([older, newer], [currentNote]).get('note-1')?.latestResult.grade, 'miss')
  assert.equal(aggregateNoteFeedback([older], [currentNote]).get('note-1')?.latestResult.grade, 'perfect')
})

test('tracks unresolved interrupted failures separately', () => {
  const aggregate = aggregateNoteFeedback([run('run-1', '2026-07-16T00:00:00.000Z', [
    judgement({ id: 'j1', occurrenceKey: 'n:1', grade: 'early', deltaMs: -90 }),
  ])], [currentNote]).get('note-1')
  assert.ok(aggregate)
  assert.equal(aggregate.unresolvedFailureCount, 1)
  assert.equal(aggregate.mistimedMissCount, 0)
  assert.equal(aggregate.direction, 'insufficient')

  const missingDelta = aggregateNoteFeedback([run('run-2', '2026-07-16T00:01:00.000Z', [
    judgement({ id: 'j2', occurrenceKey: 'n:2', grade: 'early', deltaMs: null }),
  ])], [currentNote]).get('note-1')
  assert.equal(missingDelta?.direction, 'insufficient')
})
