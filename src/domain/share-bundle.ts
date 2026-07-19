import { parseSongPackage, type SongPackage } from './song-package.ts'

export const SHARE_BUNDLE_FORMAT = 'share-bundle' as const
export const SHARE_BUNDLE_VERSION = 1 as const

export type ShareBundle = {
  format: typeof SHARE_BUNDLE_FORMAT
  version: typeof SHARE_BUNDLE_VERSION
  id: string
  title: string
  kind: 'song' | 'mixtape'
  description?: string
  createdAt: string
  songs: SongPackage[]
}

type CreateShareBundleOptions = {
  title: string
  songs: SongPackage[]
  description?: string
  id?: string
  createdAt?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function invalid(path: string, message: string): never {
  throw new Error(`Invalid share bundle at ${path}: ${message}`)
}

export function createShareBundle(options: CreateShareBundleOptions): ShareBundle {
  if (!options.songs.length) invalid('songs', 'at least one song is required')
  const createdAt = options.createdAt ?? new Date().toISOString()
  return parseShareBundle({
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    id: options.id ?? crypto.randomUUID(),
    title: options.title,
    kind: options.songs.length === 1 ? 'song' : 'mixtape',
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    createdAt,
    songs: options.songs,
  })
}

export function parseShareBundle(value: unknown): ShareBundle {
  if (!isRecord(value)) invalid('$', 'expected object')
  if (value.format !== SHARE_BUNDLE_FORMAT || value.version !== SHARE_BUNDLE_VERSION) invalid('format', `expected ${SHARE_BUNDLE_FORMAT} version ${SHARE_BUNDLE_VERSION}`)
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title)) invalid('$', 'id and title are required')
  if (value.kind !== 'song' && value.kind !== 'mixtape') invalid('kind', 'expected song or mixtape')
  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) invalid('createdAt', 'expected ISO timestamp')
  if (value.description !== undefined && !isNonEmptyString(value.description)) invalid('description', 'expected non-empty string')
  if (!Array.isArray(value.songs) || value.songs.length === 0) invalid('songs', 'at least one song is required')
  if (value.kind === 'song' && value.songs.length !== 1) invalid('kind', 'song bundles must contain exactly one song')
  if (value.kind === 'mixtape' && value.songs.length < 2) invalid('kind', 'mixtapes must contain at least two songs')
  const songs = value.songs.map(parseSongPackage)
  const ids = new Set(songs.map((song) => song.id))
  if (ids.size !== songs.length) invalid('songs', 'song ids must be unique')
  return {
    format: SHARE_BUNDLE_FORMAT,
    version: SHARE_BUNDLE_VERSION,
    id: value.id,
    title: value.title,
    kind: value.kind,
    ...(isNonEmptyString(value.description) ? { description: value.description } : {}),
    createdAt: value.createdAt,
    songs,
  }
}
