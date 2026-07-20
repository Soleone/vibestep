import { parseSongPackage, type SongPackage } from '../domain/song-package.ts'

export const BUILT_IN_SONG_CATALOG_FORMAT = 'vibestep-built-in-songs' as const
export const BUILT_IN_SONG_CATALOG_VERSION = 1 as const
export const BUILT_IN_SONG_CATALOG_URL = '/builtin-song-catalog.json'

export type BuiltInSongLicense = {
  name: string
  url: string
  attribution: string
  sourceUrl: string
}

export type BuiltInSongAudio = {
  url: string
  sha256: string
  byteLength: number
  contentType: string
}

export type BuiltInSongEntry = {
  songPackage: SongPackage
  audio: BuiltInSongAudio
  license: BuiltInSongLicense
}

export type BuiltInSongDraft = Omit<BuiltInSongEntry, 'audio'>

export type BuiltInSongCatalog = {
  format: typeof BUILT_IN_SONG_CATALOG_FORMAT
  version: typeof BUILT_IN_SONG_CATALOG_VERSION
  songs: BuiltInSongEntry[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function parseWebUrl(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) throw new Error(`Invalid built-in song catalog at ${path}: expected URL`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid built-in song catalog at ${path}: expected absolute URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Invalid built-in song catalog at ${path}: expected HTTP(S) URL`)
  return url.toString()
}

function parseLicense(value: unknown, path: string): BuiltInSongLicense {
  if (!isRecord(value)) throw new Error(`Invalid built-in song catalog at ${path}: expected object`)
  if (!isNonEmptyString(value.name) || !isNonEmptyString(value.attribution)) throw new Error(`Invalid built-in song catalog at ${path}: name and attribution are required`)
  return {
    name: value.name.trim(),
    url: parseWebUrl(value.url, `${path}.url`),
    attribution: value.attribution.trim(),
    sourceUrl: parseWebUrl(value.sourceUrl, `${path}.sourceUrl`),
  }
}

function parseAudio(value: unknown, path: string): BuiltInSongAudio {
  if (!isRecord(value)) throw new Error(`Invalid built-in song catalog at ${path}: expected object`)
  if (!isNonEmptyString(value.sha256) || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error(`Invalid built-in song catalog at ${path}.sha256: expected SHA-256 hex digest`)
  if (!Number.isInteger(value.byteLength) || Number(value.byteLength) <= 0) throw new Error(`Invalid built-in song catalog at ${path}.byteLength: expected positive integer`)
  if (!isNonEmptyString(value.contentType) || !value.contentType.startsWith('audio/')) throw new Error(`Invalid built-in song catalog at ${path}.contentType: expected audio MIME type`)
  return {
    url: parseWebUrl(value.url, `${path}.url`),
    sha256: value.sha256.toLowerCase(),
    byteLength: Number(value.byteLength),
    contentType: value.contentType,
  }
}

export function parseBuiltInSongDraft(value: unknown): BuiltInSongDraft {
  if (!isRecord(value)) throw new Error('Invalid built-in song metadata: expected object')
  return {
    songPackage: parseSongPackage(value.songPackage),
    license: parseLicense(value.license, 'license'),
  }
}

export function parseBuiltInSongCatalog(value: unknown): BuiltInSongCatalog {
  if (!isRecord(value) || value.format !== BUILT_IN_SONG_CATALOG_FORMAT) throw new Error('Not a valid built-in song catalog')
  if (value.version !== BUILT_IN_SONG_CATALOG_VERSION) throw new Error(`Unsupported built-in song catalog version: ${String(value.version)}`)
  if (!Array.isArray(value.songs)) throw new Error('Built-in song catalog has no songs array')
  const songs = value.songs.map((item, index): BuiltInSongEntry => {
    if (!isRecord(item)) throw new Error(`Invalid built-in song catalog at songs[${index}]: expected object`)
    return {
      songPackage: parseSongPackage(item.songPackage),
      audio: parseAudio(item.audio, `songs[${index}].audio`),
      license: parseLicense(item.license, `songs[${index}].license`),
    }
  })
  const ids = new Set<string>()
  for (const entry of songs) {
    if (ids.has(entry.songPackage.id)) throw new Error(`Built-in song catalog has duplicate song id: ${entry.songPackage.id}`)
    ids.add(entry.songPackage.id)
  }
  return { format: BUILT_IN_SONG_CATALOG_FORMAT, version: BUILT_IN_SONG_CATALOG_VERSION, songs }
}
