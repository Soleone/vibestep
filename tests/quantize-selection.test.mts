import assert from 'node:assert/strict'
import test from 'node:test'
import { quantizeSelectedNotes, snapTimeToGrid } from '../src/editor/quantize-selection.ts'
import type { BeatmapNote } from '../src/game/model.ts'

const note = (id: string, impactTimeMs: number, lane: BeatmapNote['lane'] = 'kick'): BeatmapNote => ({
  id,
  impactTimeMs,
  rawTimeMs: impactTimeMs - 12,
  lane,
  strength: 1,
  source: 'manual',
})

test('snapTimeToGrid uses the beat offset as the grid origin', () => {
  assert.equal(snapTimeToGrid(360, 100, 250), 350)
  assert.equal(snapTimeToGrid(490, 100, 250), 600)
})

test('snapTimeToGrid does not place notes before the song start', () => {
  assert.equal(snapTimeToGrid(20, 200, 250), 0)
})

test('quantizeSelectedNotes moves only selected notes and preserves their raw timing', () => {
  const selected = note('selected', 372)
  const untouched = note('untouched', 410, 'snare')

  const result = quantizeSelectedNotes([selected, untouched], new Set(['selected']), 100, 250)

  assert.deepEqual(result.map(({ id, impactTimeMs }) => ({ id, impactTimeMs })), [
    { id: 'selected', impactTimeMs: 350 },
    { id: 'untouched', impactTimeMs: 410 },
  ])
  assert.equal(result[0].rawTimeMs, selected.rawTimeMs)
  assert.strictEqual(result[1], untouched)
})

test('quantizeSelectedNotes captures the original timing when raw timing is absent', () => {
  const selected = { ...note('selected', 372), rawTimeMs: undefined, durationMs: 300 }

  const [result] = quantizeSelectedNotes([selected], new Set(['selected']), 100, 250)

  assert.equal(result.impactTimeMs, 350)
  assert.equal(result.rawTimeMs, 372)
  assert.equal(result.durationMs, 300)
})

test('quantizeSelectedNotes sorts notes after snapping', () => {
  const result = quantizeSelectedNotes(
    [note('later', 510), note('selected', 390)],
    new Set(['selected']),
    0,
    500,
  )

  assert.deepEqual(result.map((item) => item.id), ['selected', 'later'])
})
