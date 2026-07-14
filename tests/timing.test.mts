import test from 'node:test'
import assert from 'node:assert/strict'
import { syncopationAmount } from '../src/game/timing.ts'

test('measures rhythmic distance from the nearest quarter-note beat', () => {
  const bpm = 120
  const beatOffsetMs = 100
  assert.equal(syncopationAmount(100, bpm, beatOffsetMs), 0)
  assert.equal(syncopationAmount(600, bpm, beatOffsetMs), 0)
  assert.equal(syncopationAmount(350, bpm, beatOffsetMs), 1)
  assert.equal(syncopationAmount(225, bpm, beatOffsetMs), 0.5)
  assert.equal(syncopationAmount(475, bpm, beatOffsetMs), 0.5)
})

test('handles fractional BPM and invalid timing data safely', () => {
  const offbeat = syncopationAmount(60000 / 103 / 2, 103, 0)
  assert.ok(Math.abs(offbeat - 1) < 1e-9)
  assert.equal(syncopationAmount(250, 0, 0), 0)
  assert.equal(syncopationAmount(Number.NaN, 120, 0), 0)
})
