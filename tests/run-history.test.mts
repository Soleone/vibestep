import assert from 'node:assert/strict'
import test from 'node:test'
import { createNoteRevisionKey, createPlayRun, describeRunNoteSummary, filterCurrentNoteRevisions, summarizeLatestValidNoteResults, summarizeRunNotes, type PlayRun, type RunNoteJudgement, type RunNoteSummary } from '../src/game/run-history.ts'

const baseRun = createPlayRun({
  id: 'run-1',
  songId: 'song-1',
  beatmapId: 'map-1',
  beatmapVersion: 2,
  startedAt: '2026-07-16T00:00:00.000Z',
  startedAtSongTimeMs: 0,
})

function judgement(overrides: Partial<RunNoteJudgement>): RunNoteJudgement {
  return {
    id: 'judgement-1',
    noteId: 'note-1',
    noteRevisionKey: 'note-v1:kick:1000:tap',
    noteSnapshot: { impactTimeMs: 1000, lane: 'kick' },
    occurrenceKey: 'note-1',
    lane: 'kick',
    noteTimeMs: 1000,
    judgedAtSongTimeMs: 1000,
    grade: 'perfect',
    deltaMs: 0,
    ...overrides,
  }
}

function withJudgements(judgements: RunNoteJudgement[]): PlayRun {
  return { ...baseRun, judgements }
}

test('creates a run prepared for multiple per-note judgements', () => {
  assert.deepEqual(baseRun.judgements, [])
  assert.equal(baseRun.beatmapId, 'map-1')
  assert.equal(baseRun.beatmapVersion, 2)
})

test('summarizes the latest loop occurrence for each beatmap note', () => {
  const summaries = summarizeRunNotes(withJudgements([
    judgement({ occurrenceKey: 'note-1:0', grade: 'good', deltaMs: -54 }),
    judgement({ id: 'judgement-2', occurrenceKey: 'note-1:1', grade: 'perfect', deltaMs: 8 }),
  ]))
  assert.deepEqual(summaries.get('note-1'), {
    noteId: 'note-1',
    noteRevisionKey: 'note-v1:kick:1000:tap',
    noteSnapshot: { impactTimeMs: 1000, lane: 'kick' },
    occurrenceKey: 'note-1:1',
    lane: 'kick',
    noteTimeMs: 1000,
    grade: 'perfect',
    deltaMs: 8,
  })
})

test('keeps the closest failed input as timing evidence for an eventual miss', () => {
  const summaries = summarizeRunNotes(withJudgements([
    judgement({ grade: 'early', deltaMs: -130 }),
    judgement({ id: 'judgement-2', grade: 'late', deltaMs: 92 }),
    judgement({ id: 'judgement-3', grade: 'miss', deltaMs: null }),
  ]))
  assert.equal(summaries.get('note-1')?.grade, 'miss')
  assert.equal(summaries.get('note-1')?.deltaMs, 92)
})

test('distinguishes an automatic miss with no input', () => {
  const summary = summarizeRunNotes(withJudgements([judgement({ grade: 'miss', deltaMs: null })])).get('note-1')
  assert.ok(summary)
  assert.equal(describeRunNoteSummary(summary), 'Miss, no input')
})

test('keeps unchanged note feedback while excluding an edited note revision', () => {
  const run = withJudgements([
    judgement({ noteId: 'note-1', occurrenceKey: 'note-1' }),
    judgement({ id: 'judgement-2', noteId: 'note-2', occurrenceKey: 'note-2', noteRevisionKey: 'note-v1:snare:2000:tap', noteSnapshot: { impactTimeMs: 2000, lane: 'snare' }, lane: 'snare', noteTimeMs: 2000 }),
  ])
  const current = filterCurrentNoteRevisions(summarizeRunNotes(run), [
    { id: 'note-1', impactTimeMs: 1010, lane: 'kick' },
    { id: 'note-2', impactTimeMs: 2000, lane: 'snare' },
  ])
  assert.equal(current.has('note-1'), false)
  assert.equal(current.has('note-2'), true)
})

test('keeps the newest valid feedback for each note across multiple runs', () => {
  const firstRun = withJudgements([
    judgement({ noteId: 'note-1', occurrenceKey: 'note-1', grade: 'good', deltaMs: -35 }),
    judgement({ id: 'judgement-2', noteId: 'note-2', occurrenceKey: 'note-2', noteRevisionKey: 'note-v1:snare:2000:tap', noteSnapshot: { impactTimeMs: 2000, lane: 'snare' }, lane: 'snare', noteTimeMs: 2000, grade: 'good', deltaMs: 30 }),
  ])
  const newerRun = {
    ...withJudgements([
      judgement({ noteId: 'note-1', occurrenceKey: 'note-1', noteRevisionKey: 'note-v1:kick:1010:tap', noteSnapshot: { impactTimeMs: 1010, lane: 'kick' }, noteTimeMs: 1010, grade: 'miss', deltaMs: null }),
      judgement({ id: 'judgement-3', noteId: 'note-2', occurrenceKey: 'note-2', noteRevisionKey: 'note-v1:snare:2000:tap', noteSnapshot: { impactTimeMs: 2000, lane: 'snare' }, lane: 'snare', noteTimeMs: 2000, grade: 'perfect', deltaMs: 4 }),
    ]),
    id: 'run-2',
    startedAt: '2026-07-16T00:01:00.000Z',
  }
  const results = summarizeLatestValidNoteResults([newerRun, firstRun], [
    { id: 'note-1', impactTimeMs: 1000, lane: 'kick' },
    { id: 'note-2', impactTimeMs: 2000, lane: 'snare' },
  ])
  assert.equal(results.get('note-1')?.grade, 'good')
  assert.equal(results.get('note-1')?.deltaMs, -35)
  assert.equal(results.get('note-2')?.grade, 'perfect')
  assert.equal(results.get('note-2')?.deltaMs, 4)
})

test('revisions change only for gameplay-relevant note configuration', () => {
  const original = { impactTimeMs: 1000, lane: 'kick' as const, durationMs: undefined, strength: 1 }
  assert.equal(createNoteRevisionKey(original), createNoteRevisionKey({ ...original, strength: 3 }))
  assert.notEqual(createNoteRevisionKey(original), createNoteRevisionKey({ ...original, impactTimeMs: 1010 }))
  assert.notEqual(createNoteRevisionKey(original), createNoteRevisionKey({ ...original, lane: 'snare' }))
  assert.notEqual(createNoteRevisionKey(original), createNoteRevisionKey({ ...original, durationMs: 250 }))
})

test('normalizes harmless floating-point noise in revision keys', () => {
  assert.equal(
    createNoteRevisionKey({ impactTimeMs: 1000.00001, lane: 'kick' }),
    createNoteRevisionKey({ impactTimeMs: 1000.00002, lane: 'kick' }),
  )
})

test('describes signed timing direction', () => {
  const summary = (overrides: Partial<RunNoteSummary>): RunNoteSummary => ({
    noteId: 'a',
    noteRevisionKey: 'note-v1:mid:0:tap',
    noteSnapshot: { impactTimeMs: 0, lane: 'mid' },
    occurrenceKey: 'a',
    lane: 'mid',
    noteTimeMs: 0,
    grade: 'good',
    deltaMs: -24.4,
    ...overrides,
  })
  assert.equal(describeRunNoteSummary(summary({})), 'Good, 24ms early')
  assert.equal(describeRunNoteSummary(summary({ noteId: 'b', occurrenceKey: 'b', grade: 'late', deltaMs: 17.8 })), 'Late, 18ms late')
})
