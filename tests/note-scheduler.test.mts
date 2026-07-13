import test from 'node:test'
import assert from 'node:assert/strict'
import { findDueNotes } from '../src/game/note-scheduler.ts'
import type { BeatmapNote } from '../src/game/model.ts'

const note = (id: string, impactTimeMs: number): BeatmapNote => ({ id, impactTimeMs, lane: 'kick', strength: 1, source: 'test' })

test('examines only notes inside the scheduling window', () => {
  const notes = Array.from({ length: 100_000 }, (_, index) => note(String(index), index * 10))
  const result = findDueNotes({ notes, songTimeMs: 500_000, spawnLeadMs: 50, scheduledKeys: new Set(), limit: 20 })
  assert.deepEqual(result.dueNotes.map(({ note: item }) => item.id), ['50001', '50002', '50003', '50004', '50005'])
  assert.ok(result.examinedNotes <= 6)
})

test('keeps same-time chords and excludes already scheduled notes', () => {
  const notes = [note('a', 1100), note('b', 1100), note('c', 1200)]
  const result = findDueNotes({ notes, songTimeMs: 1000, spawnLeadMs: 200, scheduledKeys: new Set(['a']), limit: 6 })
  assert.deepEqual(result.dueNotes.map(({ note: item }) => item.id), ['b', 'c'])
})

test('schedules across an exclusive loop boundary', () => {
  const notes = [note('start', 1000), note('middle', 1500), note('end', 2000)]
  const result = findDueNotes({ notes, songTimeMs: 1900, spawnLeadMs: 250, scheduledKeys: new Set(), loopStartMs: 1000, loopEndMs: 2000, loopCycle: 3 })
  assert.deepEqual(result.dueNotes.map(({ note: item, scheduleKey }) => [item.id, scheduleKey]), [['start', 'start:4']])
  assert.equal(Math.round(result.dueNotes[0].timeUntilImpactMs), 100)
})

test('does not schedule a note exactly at loop end', () => {
  const result = findDueNotes({ notes: [note('end', 2000)], songTimeMs: 1900, spawnLeadMs: 250, scheduledKeys: new Set(), loopStartMs: 1000, loopEndMs: 2000 })
  assert.equal(result.dueNotes.length, 0)
})
