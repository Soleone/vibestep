import assert from 'node:assert/strict'
import test from 'node:test'
import { planSmartDuplicate } from '../src/editor/smart-duplicate.ts'
import type { BeatmapNote, Lane } from '../src/game/model.ts'

const note = (id: string, bar: number, lane: Lane = 'kick', withinBarMs = 0): BeatmapNote => ({
  id,
  impactTimeMs: bar * 2000 + withinBarMs,
  lane,
  strength: 1,
  source: 'test',
})

const plan = (notes: BeatmapNote[], selectedIds: string[] = [], playheadMs = 0) => planSmartDuplicate({
  notes,
  selectedNoteIds: new Set(selectedIds),
  playheadMs,
  bpm: 120,
  beatOffsetMs: 0,
  songEndMs: 30000,
})

test('duplicates selected bars into the next empty span on the selected lanes', () => {
  const notes = [note('a', 0, 'kick', 500), note('b', 1, 'snare', 250), note('occupied', 2, 'kick')]
  const result = plan(notes, ['a', 'b'])

  assert.ok(result)
  assert.equal(result.shiftMs, 6000)
  assert.deepEqual(result.sourceNotes.map(({ id }) => id), ['a', 'b'])
})

test('ignores notes on lanes outside the selected phrase', () => {
  const notes = [note('source', 0, 'kick', 500), note('melody', 1, 'mid')]
  const result = plan(notes, ['source'])

  assert.ok(result)
  assert.equal(result.shiftMs, 2000)
})

test('uses the contiguous filled phrase from the playhead bar when nothing is selected', () => {
  const notes = [note('a', 2, 'kick'), note('b', 3, 'snare'), note('later', 5, 'kick')]
  const result = plan(notes, [], 4500)

  assert.ok(result)
  assert.deepEqual(result.sourceNotes.map(({ id }) => id), ['a', 'b'])
  assert.equal(result.shiftMs, 8000)
})

test('does nothing when the playhead bar is empty and nothing is selected', () => {
  assert.equal(plan([note('later', 2)], [], 0), null)
})

test('treats holds crossing a target bar as occupied', () => {
  const held = { ...note('held', 0, 'kick', 1500), durationMs: 1000 }
  const result = plan([note('source', -1, 'kick'), held], ['source'])

  assert.ok(result)
  assert.equal(result.shiftMs, 6000)
})
