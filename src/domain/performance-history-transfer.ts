import { createNoteRevisionKey, type PlayRun, type RunNoteJudgement, type RunNoteSnapshot } from '../game/run-history.ts'
import type { Lane } from '../game/model'
import type { ParryGrade } from '../game/timing'

export const PERFORMANCE_HISTORY_SCHEMA = 'beat-fiend/performance-history'
export const PERFORMANCE_HISTORY_VERSION = 1

export type PerformanceHistoryTransfer = {
  schema: typeof PERFORMANCE_HISTORY_SCHEMA
  schemaVersion: typeof PERFORMANCE_HISTORY_VERSION
  exportedAt: string
  runs: PlayRun[]
}

const lanes = new Set<Lane>(['kick', 'snare', 'low', 'mid', 'high'])
const grades = new Set<ParryGrade>(['perfect', 'good', 'early', 'late', 'miss'])
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function requiredString(value: unknown, path: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`)
  return value
}

function finiteNumber(value: unknown, path: string, { nonNegative = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonNegative && value < 0)) throw new Error(`${path} must be a ${nonNegative ? 'non-negative ' : ''}finite number`)
  return value
}

function optionalIsoDate(value: unknown, path: string) {
  if (value === undefined) return undefined
  const date = requiredString(value, path)
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== date) throw new Error(`${path} must be a valid canonical ISO date`)
  return date
}

function parseNoteSnapshot(value: unknown, path: string): RunNoteSnapshot {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  const lane = requiredString(value.lane, `${path}.lane`) as Lane
  if (!lanes.has(lane)) throw new Error(`${path}.lane is invalid`)
  const durationMs = value.durationMs === undefined ? undefined : finiteNumber(value.durationMs, `${path}.durationMs`, { nonNegative: true })
  return {
    impactTimeMs: finiteNumber(value.impactTimeMs, `${path}.impactTimeMs`, { nonNegative: true }),
    lane,
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

function parseJudgement(value: unknown, path: string): RunNoteJudgement {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  const lane = requiredString(value.lane, `${path}.lane`) as Lane
  if (!lanes.has(lane)) throw new Error(`${path}.lane is invalid`)
  const grade = requiredString(value.grade, `${path}.grade`) as ParryGrade
  if (!grades.has(grade)) throw new Error(`${path}.grade is invalid`)
  const noteSnapshot = parseNoteSnapshot(value.noteSnapshot, `${path}.noteSnapshot`)
  if (lane !== noteSnapshot.lane) throw new Error(`${path}.lane does not match its note snapshot`)
  const noteRevisionKey = requiredString(value.noteRevisionKey, `${path}.noteRevisionKey`)
  if (noteRevisionKey !== createNoteRevisionKey(noteSnapshot)) throw new Error(`${path}.noteRevisionKey does not match its note snapshot`)
  const deltaMs = value.deltaMs === null ? null : finiteNumber(value.deltaMs, `${path}.deltaMs`)
  const noteTimeMs = finiteNumber(value.noteTimeMs, `${path}.noteTimeMs`, { nonNegative: true })
  if (Math.round(noteTimeMs * 1000) / 1000 !== noteSnapshot.impactTimeMs) throw new Error(`${path}.noteTimeMs does not match its note snapshot`)
  return {
    id: requiredString(value.id, `${path}.id`),
    noteId: requiredString(value.noteId, `${path}.noteId`),
    noteRevisionKey,
    noteSnapshot,
    occurrenceKey: requiredString(value.occurrenceKey, `${path}.occurrenceKey`),
    lane,
    noteTimeMs,
    judgedAtSongTimeMs: finiteNumber(value.judgedAtSongTimeMs, `${path}.judgedAtSongTimeMs`, { nonNegative: true }),
    grade,
    deltaMs,
  }
}

export function parsePlayRun(value: unknown, path = 'run'): PlayRun {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  if (!Array.isArray(value.judgements)) throw new Error(`${path}.judgements must be an array`)
  const judgements = value.judgements.map((judgement, index) => parseJudgement(judgement, `${path}.judgements[${index}]`))
  const judgementIds = new Set(judgements.map((judgement) => judgement.id))
  if (judgementIds.size !== judgements.length) throw new Error(`${path} contains duplicate judgement ids`)
  const beatmapVersion = value.beatmapVersion === undefined ? undefined : finiteNumber(value.beatmapVersion, `${path}.beatmapVersion`, { nonNegative: true })
  const startedAt = optionalIsoDate(value.startedAt, `${path}.startedAt`)
  if (!startedAt) throw new Error(`${path}.startedAt is required`)
  const completedAt = optionalIsoDate(value.completedAt, `${path}.completedAt`)
  return {
    id: requiredString(value.id, `${path}.id`),
    songId: requiredString(value.songId, `${path}.songId`),
    beatmapId: requiredString(value.beatmapId, `${path}.beatmapId`),
    ...(beatmapVersion === undefined ? {} : { beatmapVersion }),
    startedAt,
    startedAtSongTimeMs: finiteNumber(value.startedAtSongTimeMs, `${path}.startedAtSongTimeMs`, { nonNegative: true }),
    ...(completedAt === undefined ? {} : { completedAt }),
    judgements,
  }
}

export function createPerformanceHistoryTransfer(runs: PlayRun[], exportedAt = new Date().toISOString()): PerformanceHistoryTransfer {
  return {
    schema: PERFORMANCE_HISTORY_SCHEMA,
    schemaVersion: PERFORMANCE_HISTORY_VERSION,
    exportedAt,
    runs: runs.map((run, index) => parsePlayRun(run, `runs[${index}]`)),
  }
}

export function parsePerformanceHistoryTransfer(value: unknown): PerformanceHistoryTransfer {
  if (!isRecord(value) || value.schema !== PERFORMANCE_HISTORY_SCHEMA) throw new Error('Not a valid performance history backup')
  if (value.schemaVersion !== PERFORMANCE_HISTORY_VERSION) throw new Error(`Unsupported performance history version: ${String(value.schemaVersion)}`)
  if (!Array.isArray(value.runs)) throw new Error('Performance history runs must be an array')
  const runs = value.runs.map((run, index) => parsePlayRun(run, `runs[${index}]`))
  const runIds = new Set(runs.map((run) => run.id))
  if (runIds.size !== runs.length) throw new Error('Performance history contains duplicate run ids')
  const exportedAt = optionalIsoDate(value.exportedAt, 'exportedAt')
  if (!exportedAt) throw new Error('Performance history exportedAt is required')
  return { schema: PERFORMANCE_HISTORY_SCHEMA, schemaVersion: PERFORMANCE_HISTORY_VERSION, exportedAt, runs }
}
