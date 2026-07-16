import assert from 'node:assert/strict'
import test from 'node:test'
import { collectionPercent, countNotesByLane, createLaneCounts } from '../src/game/model.ts'

test('counts beatmap notes by lane', () => {
  assert.deepEqual(countNotesByLane([
    { lane: 'kick' },
    { lane: 'kick' },
    { lane: 'snare' },
    { lane: 'high' },
  ]), { kick: 2, snare: 1, low: 0, mid: 0, high: 1 })
})

test('converts collected notes into bounded percentages', () => {
  assert.equal(collectionPercent(3, 4), 75)
  assert.equal(collectionPercent(5, 4), 100)
  assert.equal(collectionPercent(-1, 4), 0)
  assert.equal(collectionPercent(1, 0), 0)
})

test('creates independent lane count records', () => {
  const first = createLaneCounts()
  const second = createLaneCounts()
  first.kick = 2
  assert.equal(second.kick, 0)
})
