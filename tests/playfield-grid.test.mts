import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLAYFIELD_IMPACT_X,
  PLAYFIELD_PROJECTILE_START_X,
  makePlayfieldBeatDividers,
} from '../src/game/playfield-grid.ts'

test('spaces playfield dividers by half beats across projectile travel', () => {
  const dividers = makePlayfieldBeatDividers(120, 1150)

  assert.equal(dividers.length, 4)
  assert.deepEqual(dividers.map(({ strength }) => strength), ['sub', 'beat', 'sub', 'beat'])
  assert.ok(Math.abs(dividers[0].x - (PLAYFIELD_IMPACT_X + (PLAYFIELD_PROJECTILE_START_X - PLAYFIELD_IMPACT_X) * (250 / 1150))) < 0.000001)
  assert.ok(dividers.every(({ x }) => x > PLAYFIELD_IMPACT_X && x < PLAYFIELD_PROJECTILE_START_X))
})

test('adapts divider density to BPM', () => {
  assert.equal(makePlayfieldBeatDividers(60, 1150).length, 2)
  assert.equal(makePlayfieldBeatDividers(180, 1150).length, 6)
})

test('rejects invalid tempo and travel values', () => {
  assert.deepEqual(makePlayfieldBeatDividers(0, 1150), [])
  assert.deepEqual(makePlayfieldBeatDividers(Number.NaN, 1150), [])
  assert.deepEqual(makePlayfieldBeatDividers(120, 0), [])
})
