import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafeId, songPath, validateBeatmap } from './beatmap-validation.js'

const validMap = {
  id: 'draft-map',
  songId: 'song-123',
  title: 'Draft map',
  durationMs: 120000,
  difficulty: 3,
  version: 0,
  notes: [{ id: 'note-1', impactTimeMs: 500, lane: 'kick', strength: 1, source: 'manual' }],
}

test('rejects unsafe identifiers and paths', () => {
  assert.throws(() => assertSafeId('../outside', 'song id'), /Invalid song id/)
  assert.throws(() => songPath('/tmp/imports', '..', 'meta.json'), /Invalid song id/)
  assert.equal(songPath('/tmp/imports', 'safe-song', 'meta.json'), '/tmp/imports/safe-song/meta.json')
})

test('normalizes a valid beatmap to the persisted contract', () => {
  const map = validateBeatmap(validMap)
  assert.deepEqual(map, validMap)
})

test('rejects malformed notes before persistence', () => {
  assert.throws(() => validateBeatmap({ ...validMap, notes: 'not an array' }), /notes array/)
  assert.throws(() => validateBeatmap({ ...validMap, notes: [{ ...validMap.notes[0], lane: 'laser' }] }), /invalid lane/)
  assert.throws(() => validateBeatmap({ ...validMap, notes: [{ ...validMap.notes[0], impactTimeMs: Infinity }] }), /invalid impact time/)
  assert.throws(() => validateBeatmap({ ...validMap, notes: [validMap.notes[0], validMap.notes[0]] }), /unique id/)
})
