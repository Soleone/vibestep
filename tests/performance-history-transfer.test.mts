import assert from 'node:assert/strict'
import test from 'node:test'
import { createPerformanceHistoryTransfer, parsePerformanceHistoryTransfer, PERFORMANCE_HISTORY_FORMAT, PERFORMANCE_HISTORY_VERSION } from '../src/domain/performance-history-transfer.ts'
import { createNoteRevisionKey, type PlayRun } from '../src/game/run-history.ts'

const noteSnapshot = { impactTimeMs: 1250, lane: 'kick' as const }
const run: PlayRun = {
  id: 'run-1',
  songId: 'song-1',
  beatmapId: 'map-1',
  beatmapVersion: 3,
  startedAt: '2026-07-16T00:00:00.000Z',
  startedAtSongTimeMs: 0,
  completedAt: '2026-07-16T00:01:00.000Z',
  judgements: [{
    id: 'judgement-1',
    noteId: 'note-1',
    noteRevisionKey: createNoteRevisionKey(noteSnapshot),
    noteSnapshot,
    occurrenceKey: 'note-1',
    lane: 'kick',
    noteTimeMs: 1250,
    judgedAtSongTimeMs: 1272,
    grade: 'perfect',
    deltaMs: 22,
  }],
}

test('round trips a versioned performance history backup', () => {
  const backup = createPerformanceHistoryTransfer([run], '2026-07-17T00:00:00.000Z')
  assert.equal(backup.format, PERFORMANCE_HISTORY_FORMAT)
  assert.equal(backup.version, PERFORMANCE_HISTORY_VERSION)
  assert.deepEqual(parsePerformanceHistoryTransfer(JSON.parse(JSON.stringify(backup))), backup)
})

test('preserves interrupted runs without a completion timestamp', () => {
  const backup = createPerformanceHistoryTransfer([{ ...run, completedAt: undefined }])
  assert.equal(backup.runs[0].completedAt, undefined)
})

test('rejects unsupported versions and duplicate run ids', () => {
  const backup = createPerformanceHistoryTransfer([run])
  assert.throws(() => parsePerformanceHistoryTransfer({ ...backup, version: 2 }), /Unsupported performance history version/)
  assert.throws(() => parsePerformanceHistoryTransfer({ ...backup, runs: [run, run] }), /duplicate run ids/)
})

test('rejects invalid nested judgement data', () => {
  const backup = createPerformanceHistoryTransfer([run])
  const invalidGrade = structuredClone(backup)
  invalidGrade.runs[0].judgements[0].grade = 'amazing' as 'perfect'
  assert.throws(() => parsePerformanceHistoryTransfer(invalidGrade), /grade is invalid/)

  const invalidRevision = structuredClone(backup)
  invalidRevision.runs[0].judgements[0].noteRevisionKey = 'stale-revision'
  assert.throws(() => parsePerformanceHistoryTransfer(invalidRevision), /does not match its note snapshot/)

  const mismatchedLane = structuredClone(backup)
  mismatchedLane.runs[0].judgements[0].lane = 'snare'
  assert.throws(() => parsePerformanceHistoryTransfer(mismatchedLane), /lane does not match/)
})

test('rejects malformed timestamps, inconsistent note times, and duplicate judgement ids', () => {
  const backup = createPerformanceHistoryTransfer([run])
  assert.throws(() => parsePerformanceHistoryTransfer({ ...backup, exportedAt: 'not-a-date' }), /valid canonical ISO date/)
  assert.throws(() => parsePerformanceHistoryTransfer({ ...backup, exportedAt: '2026-02-30T00:00:00.000Z' }), /valid canonical ISO date/)
  assert.throws(() => parsePerformanceHistoryTransfer({ ...backup, runs: [{ ...run, judgements: [{ ...run.judgements[0], noteTimeMs: 1300 }] }] }), /noteTimeMs does not match/)
  assert.throws(() => parsePerformanceHistoryTransfer({ ...backup, runs: [{ ...run, judgements: [run.judgements[0], run.judgements[0]] }] }), /duplicate judgement ids/)
})
