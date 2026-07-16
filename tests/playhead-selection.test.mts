import assert from 'node:assert/strict'
import test from 'node:test'
import { notesTouchedByPlayhead } from '../src/editor/playhead-selection.ts'
import type { BeatmapNote } from '../src/game/model.ts'

const note = (id: string, impactTimeMs: number, durationMs?: number): BeatmapNote => ({
  id,
  impactTimeMs,
  durationMs,
  lane: 'kick',
  strength: 1,
  source: 'test',
})

test('finds notes crossed in either scroll direction', () => {
  const notes = [note('before', 90), note('start', 100), note('middle', 150), note('end', 200), note('after', 210)]

  assert.deepEqual([...notesTouchedByPlayhead(notes, 100, 200)], ['start', 'middle', 'end'])
  assert.deepEqual([...notesTouchedByPlayhead(notes, 200, 100)], ['start', 'middle', 'end'])
})

test('supports reversible selection sweeps anchored at the initial playhead', () => {
  const notes = [note('anchor', 100), note('middle', 150), note('overshoot', 200)]

  assert.deepEqual([...notesTouchedByPlayhead(notes, 100, 200, true)], ['middle', 'overshoot'])
  assert.deepEqual([...notesTouchedByPlayhead(notes, 100, 150, true)], ['middle'])
  assert.deepEqual([...notesTouchedByPlayhead(notes, 100, 100, true)], [])
})

test('selects a hold whenever the playhead traversal touches its span', () => {
  const notes = [note('hold', 100, 200), note('outside', 400, 50)]

  assert.deepEqual([...notesTouchedByPlayhead(notes, 250, 260)], ['hold'])
  assert.deepEqual([...notesTouchedByPlayhead(notes, 300, 350)], ['hold'])
})

test('finds notes at a stationary playhead', () => {
  assert.deepEqual([...notesTouchedByPlayhead([note('exact', 100)], 100, 100)], ['exact'])
})
