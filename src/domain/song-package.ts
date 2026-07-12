import type { BeatmapNote, Lane } from '../game/model'

export const SONG_PACKAGE_SCHEMA = 'beat-fiend/song-package' as const
export const SONG_PACKAGE_VERSION = 1 as const

export type SongSource = {
  kind: 'youtube' | 'url' | 'file-description'
  url?: string
  label?: string
}

export type SongReference = {
  id: string
  title: string
  artist?: string
  durationMs?: number
  sources: SongSource[]
}

export type TimingProfile = {
  id: string
  name: string
  bpm: number
  beatOffsetMs: number
  timeSignature: [number, number]
}

export type PackageBeatmap = {
  id: string
  title: string
  difficulty: 1 | 2 | 3 | 4 | 5
  timingProfileId: string
  durationMs: number
  notes: BeatmapNote[]
  version?: number
  createdAt?: string
  updatedAt?: string
}

export type SongPackage = {
  schema: typeof SONG_PACKAGE_SCHEMA
  schemaVersion: typeof SONG_PACKAGE_VERSION
  id: string
  song: SongReference
  timingProfiles: TimingProfile[]
  beatmaps: PackageBeatmap[]
  defaultTimingProfileId: string
  createdAt: string
  updatedAt: string
}

export type LegacySongPackage = {
  id?: unknown
  title?: unknown
  sourceUrl?: unknown
  durationMs?: unknown
  bpm?: unknown
  beatOffsetMs?: unknown
  beatmaps?: unknown
  beatmap?: unknown
}

const lanes = new Set<Lane>(['kick', 'snare', 'low', 'mid', 'high'])
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isIsoDate = (value: unknown): value is string => isNonEmptyString(value) && !Number.isNaN(Date.parse(value))

function issue(path: string, message: string): never {
  throw new Error(`Invalid song package at ${path}: ${message}`)
}

function parseSource(value: unknown, index: number): SongSource {
  if (!isRecord(value)) issue(`song.sources[${index}]`, 'expected object')
  if (value.kind !== 'youtube' && value.kind !== 'url' && value.kind !== 'file-description') issue(`song.sources[${index}].kind`, 'unsupported source kind')
  if (value.url !== undefined && !isNonEmptyString(value.url)) issue(`song.sources[${index}].url`, 'expected non-empty string')
  if (value.label !== undefined && !isNonEmptyString(value.label)) issue(`song.sources[${index}].label`, 'expected non-empty string')
  return { kind: value.kind, ...(value.url ? { url: value.url } : {}), ...(value.label ? { label: value.label } : {}) }
}

function parseNote(value: unknown, index: number): BeatmapNote {
  if (!isRecord(value)) issue(`beatmaps[].notes[${index}]`, 'expected object')
  if (!isNonEmptyString(value.id)) issue(`beatmaps[].notes[${index}].id`, 'expected non-empty string')
  if (!isFiniteNumber(value.impactTimeMs) || value.impactTimeMs < 0) issue(`beatmaps[].notes[${index}].impactTimeMs`, 'expected non-negative number')
  if (!isNonEmptyString(value.lane) || !lanes.has(value.lane as Lane)) issue(`beatmaps[].notes[${index}].lane`, 'unsupported lane')
  if (!isFiniteNumber(value.strength)) issue(`beatmaps[].notes[${index}].strength`, 'expected number')
  if (!isNonEmptyString(value.source)) issue(`beatmaps[].notes[${index}].source`, 'expected non-empty string')
  if (value.durationMs !== undefined && (!isFiniteNumber(value.durationMs) || value.durationMs < 0)) issue(`beatmaps[].notes[${index}].durationMs`, 'expected non-negative number')
  if (value.rawTimeMs !== undefined && !isFiniteNumber(value.rawTimeMs)) issue(`beatmaps[].notes[${index}].rawTimeMs`, 'expected number')
  return {
    id: value.id,
    impactTimeMs: value.impactTimeMs,
    lane: value.lane as Lane,
    strength: value.strength,
    source: value.source as BeatmapNote['source'],
    ...(isFiniteNumber(value.durationMs) ? { durationMs: value.durationMs } : {}),
    ...(isFiniteNumber(value.rawTimeMs) ? { rawTimeMs: value.rawTimeMs } : {}),
  }
}

function parseTiming(value: unknown, index: number): TimingProfile {
  if (!isRecord(value)) issue(`timingProfiles[${index}]`, 'expected object')
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name)) issue(`timingProfiles[${index}]`, 'id and name are required')
  if (!isFiniteNumber(value.bpm) || value.bpm <= 0) issue(`timingProfiles[${index}].bpm`, 'expected positive number')
  if (!isFiniteNumber(value.beatOffsetMs)) issue(`timingProfiles[${index}].beatOffsetMs`, 'expected finite number')
  if (!Array.isArray(value.timeSignature) || value.timeSignature.length !== 2 || !value.timeSignature.every((part) => Number.isInteger(part) && part > 0)) issue(`timingProfiles[${index}].timeSignature`, 'expected two positive integers')
  return { id: value.id, name: value.name, bpm: value.bpm, beatOffsetMs: value.beatOffsetMs, timeSignature: [Number(value.timeSignature[0]), Number(value.timeSignature[1])] }
}

function parseBeatmap(value: unknown, index: number): PackageBeatmap {
  if (!isRecord(value)) issue(`beatmaps[${index}]`, 'expected object')
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title) || !isNonEmptyString(value.timingProfileId)) issue(`beatmaps[${index}]`, 'id, title, and timingProfileId are required')
  if (!Number.isInteger(value.difficulty) || Number(value.difficulty) < 1 || Number(value.difficulty) > 5) issue(`beatmaps[${index}].difficulty`, 'expected integer from 1 to 5')
  if (!isFiniteNumber(value.durationMs) || value.durationMs < 0) issue(`beatmaps[${index}].durationMs`, 'expected non-negative number')
  if (!Array.isArray(value.notes)) issue(`beatmaps[${index}].notes`, 'expected array')
  return {
    id: value.id,
    title: value.title,
    difficulty: value.difficulty as PackageBeatmap['difficulty'],
    timingProfileId: value.timingProfileId,
    durationMs: value.durationMs,
    notes: value.notes.map(parseNote),
    ...(isFiniteNumber(value.version) ? { version: value.version } : {}),
    ...(isIsoDate(value.createdAt) ? { createdAt: value.createdAt } : {}),
    ...(isIsoDate(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
  }
}

export function parseSongPackage(value: unknown): SongPackage {
  if (!isRecord(value)) issue('$', 'expected object')
  if (value.schema !== SONG_PACKAGE_SCHEMA || value.schemaVersion !== SONG_PACKAGE_VERSION) issue('schema', `expected ${SONG_PACKAGE_SCHEMA} version ${SONG_PACKAGE_VERSION}`)
  if (!isNonEmptyString(value.id) || !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) issue('$', 'id and ISO timestamps are required')
  if (!isRecord(value.song) || !isNonEmptyString(value.song.id) || !isNonEmptyString(value.song.title) || !Array.isArray(value.song.sources)) issue('song', 'id, title, and sources are required')
  if (value.song.durationMs !== undefined && (!isFiniteNumber(value.song.durationMs) || value.song.durationMs < 0)) issue('song.durationMs', 'expected non-negative number')
  if (!Array.isArray(value.timingProfiles) || value.timingProfiles.length === 0 || !Array.isArray(value.beatmaps)) issue('$', 'timingProfiles and beatmaps are required')
  if (!isNonEmptyString(value.defaultTimingProfileId)) issue('defaultTimingProfileId', 'expected non-empty string')
  const timingProfiles = value.timingProfiles.map(parseTiming)
  const beatmaps = value.beatmaps.map(parseBeatmap)
  const timingIds = new Set(timingProfiles.map((profile) => profile.id))
  if (!timingIds.has(value.defaultTimingProfileId)) issue('defaultTimingProfileId', 'profile does not exist')
  beatmaps.forEach((map, index) => { if (!timingIds.has(map.timingProfileId)) issue(`beatmaps[${index}].timingProfileId`, 'profile does not exist') })
  const forbiddenKeys = new Set(['audio', 'audioBytes', 'audioData', 'audioUrl', 'filePath', 'localPath', 'playbackUrl', 'credential', 'token'])
  const visit = (node: unknown, path = '$') => {
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`))
    if (!isRecord(node)) return
    Object.entries(node).forEach(([key, child]) => {
      if (forbiddenKeys.has(key)) issue(`${path}.${key}`, 'audio, local paths, playback URLs, and credentials are not portable')
      visit(child, `${path}.${key}`)
    })
  }
  visit(value)
  return {
    schema: SONG_PACKAGE_SCHEMA,
    schemaVersion: SONG_PACKAGE_VERSION,
    id: value.id,
    song: {
      id: value.song.id,
      title: value.song.title,
      ...(isNonEmptyString(value.song.artist) ? { artist: value.song.artist } : {}),
      ...(isFiniteNumber(value.song.durationMs) ? { durationMs: value.song.durationMs } : {}),
      sources: value.song.sources.map(parseSource),
    },
    timingProfiles,
    beatmaps,
    defaultTimingProfileId: value.defaultTimingProfileId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function migrateLegacySongPackage(value: LegacySongPackage, now = new Date().toISOString()): SongPackage {
  const id = isNonEmptyString(value.id) ? value.id : crypto.randomUUID()
  const title = isNonEmptyString(value.title) ? value.title : 'Imported song'
  const durationMs = isFiniteNumber(value.durationMs) && value.durationMs >= 0 ? value.durationMs : 0
  const bpm = isFiniteNumber(value.bpm) && value.bpm > 0 ? value.bpm : 120
  const beatOffsetMs = isFiniteNumber(value.beatOffsetMs) ? value.beatOffsetMs : 0
  const source = isNonEmptyString(value.sourceUrl) ? [{ kind: 'youtube' as const, url: value.sourceUrl }] : [{ kind: 'file-description' as const, label: title }]
  const rawMaps = (Array.isArray(value.beatmaps) ? value.beatmaps : value.beatmap ? [value.beatmap] : []).filter(isRecord)
  const timingProfiles: TimingProfile[] = [{ id: 'default', name: 'Default', bpm, beatOffsetMs, timeSignature: [4, 4] }]
  const profileByTiming = new Map([[`${bpm}:${beatOffsetMs}`, 'default']])
  const beatmaps = rawMaps.map((map, index): PackageBeatmap => {
    const mapBpm = isFiniteNumber(map.bpm) && map.bpm > 0 ? map.bpm : bpm
    const mapOffset = isFiniteNumber(map.beatOffsetMs) ? map.beatOffsetMs : beatOffsetMs
    const timingKey = `${mapBpm}:${mapOffset}`
    let timingProfileId = profileByTiming.get(timingKey)
    if (!timingProfileId) {
      timingProfileId = `timing-${timingProfiles.length + 1}`
      profileByTiming.set(timingKey, timingProfileId)
      timingProfiles.push({ id: timingProfileId, name: `Alternate timing ${timingProfiles.length}`, bpm: mapBpm, beatOffsetMs: mapOffset, timeSignature: [4, 4] })
    }
    return {
      id: isNonEmptyString(map.id) ? map.id : `map-${index + 1}`,
      title: isNonEmptyString(map.title) ? map.title : `${title} map ${index + 1}`,
      difficulty: Number.isInteger(map.difficulty) && Number(map.difficulty) >= 1 && Number(map.difficulty) <= 5 ? map.difficulty as PackageBeatmap['difficulty'] : 1,
      timingProfileId,
      durationMs: isFiniteNumber(map.durationMs) ? map.durationMs : durationMs,
      notes: Array.isArray(map.notes) ? map.notes.map(parseNote) : [],
      version: isFiniteNumber(map.version) ? map.version : 1,
    }
  })
  return parseSongPackage({ schema: SONG_PACKAGE_SCHEMA, schemaVersion: SONG_PACKAGE_VERSION, id, song: { id, title, durationMs, sources: source }, timingProfiles, beatmaps, defaultTimingProfileId: 'default', createdAt: now, updatedAt: now })
}
