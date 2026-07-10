import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const laneNames = ['kick', 'snare', 'low', 'mid', 'high']
const laneSet = new Set(laneNames)
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/
const maxNotes = 5000
const maxDurationMs = 1000 * 60 * 60 * 12

export function isSafeId(value) {
  return typeof value === 'string' && idPattern.test(value)
}

export function assertSafeId(value, label) {
  if (!isSafeId(value)) throw new Error(`Invalid ${label}`)
  return value
}

export function songPath(importsDir, songId, ...segments) {
  assertSafeId(songId, 'song id')
  const root = path.resolve(importsDir)
  const target = path.resolve(root, songId, ...segments)
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid song path')
  return target
}

function finiteNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function optionalString(value, fallback = undefined, maxLength = 160) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

export function validateBeatmap(input, { id, songId } = {}) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.notes)) {
    throw new Error('Beatmap must include a notes array')
  }
  if (input.notes.length > maxNotes) throw new Error(`Beatmap cannot exceed ${maxNotes} notes`)

  const title = optionalString(input.title)
  if (!title) throw new Error('Beatmap title is required')
  const mapDurationMs = finiteNumber(input.durationMs, NaN, { min: 0, max: maxDurationMs })
  if (!Number.isFinite(mapDurationMs)) throw new Error('Beatmap duration is invalid')

  const noteIds = new Set()
  const notes = input.notes.map((note, index) => {
    if (!note || typeof note !== 'object') throw new Error(`Note ${index + 1} is invalid`)
    const noteId = optionalString(note.id, undefined, 160)
    if (!noteId || noteIds.has(noteId)) throw new Error(`Note ${index + 1} must have a unique id`)
    if (!laneSet.has(note.lane)) throw new Error(`Note ${index + 1} has an invalid lane`)
    const impactTimeMs = finiteNumber(note.impactTimeMs, NaN, { min: 0, max: mapDurationMs })
    if (!Number.isFinite(impactTimeMs)) throw new Error(`Note ${index + 1} has an invalid impact time`)
    const noteDurationMs = note.durationMs === undefined ? undefined : finiteNumber(note.durationMs, NaN, { min: 0, max: maxDurationMs })
    if (noteDurationMs !== undefined && !Number.isFinite(noteDurationMs)) throw new Error(`Note ${index + 1} has an invalid duration`)
    noteIds.add(noteId)
    return {
      id: noteId,
      impactTimeMs,
      ...(note.rawTimeMs === undefined ? {} : { rawTimeMs: finiteNumber(note.rawTimeMs, impactTimeMs, { min: 0, max: mapDurationMs }) }),
      ...(noteDurationMs === undefined ? {} : { durationMs: noteDurationMs }),
      lane: note.lane,
      strength: finiteNumber(note.strength, 1, { min: 0, max: 1 }),
      source: optionalString(note.source, 'manual', 80),
      ...(note.resolved === true ? { resolved: true } : {}),
    }
  }).sort((a, b) => a.impactTimeMs - b.impactTimeMs)

  return {
    id: assertSafeId(id ?? input.id, 'beatmap id'),
    songId: assertSafeId(songId ?? input.songId, 'song id'),
    title,
    difficulty: Math.round(finiteNumber(input.difficulty, 1, { min: 1, max: 5 })),
    version: Math.max(0, Math.floor(finiteNumber(input.version, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }))),
    ...(input.bpm === undefined ? {} : { bpm: finiteNumber(input.bpm, 120, { min: 20, max: 400 }) }),
    ...(input.beatOffsetMs === undefined ? {} : { beatOffsetMs: finiteNumber(input.beatOffsetMs, 0, { min: 0, max: mapDurationMs }) }),
    durationMs: mapDurationMs,
    notes,
  }
}

export async function writeJsonAtomically(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryFile, JSON.stringify(value, null, 2))
  await rename(temporaryFile, file)
}
