import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayRun, describeRunNoteSummary, summarizeRunNotes, type PlayRun, type RunNoteJudgement } from '../src/game/run-history.ts'

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

test('describes signed timing direction', () => {
  assert.equal(describeRunNoteSummary({ noteId: 'a', occurrenceKey: 'a', lane: 'mid', noteTimeMs: 0, grade: 'good', deltaMs: -24.4 }), 'Good, 24ms early')
  assert.equal(describeRunNoteSummary({ noteId: 'b', occurrenceKey: 'b', lane: 'mid', noteTimeMs: 0, grade: 'late', deltaMs: 17.8 }), 'Late, 18ms late')
})
