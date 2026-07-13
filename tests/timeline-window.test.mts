import test from 'node:test'
import assert from 'node:assert/strict'
import { windowTimelineNotes, type TimelineNote } from '../src/editor/timeline-window.ts'

const note = (index: number, pending = false): TimelineNote => ({ id: String(index), impactTimeMs: index * 10, lane: 'kick', strength: 1, source: 'test', pending })

test('returns only notes inside timeline bounds', () => {
  const notes = Array.from({ length: 100_000 }, (_, index) => note(index))
  const visible = windowTimelineNotes(notes, 500_000, 500_100, new Set())
  assert.deepEqual(visible.map((item) => item.id), Array.from({ length: 11 }, (_, index) => String(50_000 + index)))
})

test('keeps a hold visible when its beginning is off screen', () => {
  const hold = { ...note(10), durationMs: 2000 }
  const visible = windowTimelineNotes([hold, note(500)], 1500, 2000, new Set(), 2500, 2000)
  assert.deepEqual(visible.map((item) => item.id), ['10'])
})

test('caps dense fit views while retaining selected and pending notes', () => {
  const notes = Array.from({ length: 10_000 }, (_, index) => note(index, index === 9998))
  const visible = windowTimelineNotes(notes, 0, 100_000, new Set(['9999']), 100)
  assert.equal(visible.length, 100)
  assert.ok(visible.some((item) => item.id === '9998'))
  assert.ok(visible.some((item) => item.id === '9999'))
})
