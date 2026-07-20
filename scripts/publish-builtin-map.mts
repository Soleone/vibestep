import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseBuiltInSongCatalog, type BuiltInSongCatalog } from '../src/builtin-songs/catalog.ts'
import { parseLibraryBackup } from '../src/domain/library-backup.ts'
import { parseShareBundle } from '../src/domain/share-bundle.ts'
import { parseSongPackage, type SongPackage } from '../src/domain/song-package.ts'

const DEFAULT_CATALOG_PATH = 'public/builtin-song-catalog.json'

type Arguments = { exportPath?: string; catalog: string; songId?: string }

function usage(): never {
  console.error(`Usage:
  npm run song:publish-map -- <vibestep-export.json> [options]

Options:
  --song <id>        Select one song from a multi-song export
  --catalog <path>   Catalog path (default: ${DEFAULT_CATALOG_PATH})`)
  process.exit(1)
}

function parseArguments(argv: string[]): Arguments {
  const result: Arguments = { catalog: DEFAULT_CATALOG_PATH }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--') && !result.exportPath) {
      result.exportPath = argument
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) usage()
    index += 1
    if (argument === '--song') result.songId = value
    else if (argument === '--catalog') result.catalog = value
    else usage()
  }
  return result
}

export function packagesFromExport(value: unknown): SongPackage[] {
  if (typeof value !== 'object' || value === null || !('format' in value)) throw new Error('File is not a Vibestep song, share, or library export')
  if (value.format === 'share-bundle') return parseShareBundle(value).songs
  if (value.format === 'library-backup') return parseLibraryBackup(value).packages
  if (value.format === 'song-package') return [parseSongPackage(value)]
  throw new Error(`Unsupported Vibestep export format: ${String(value.format)}`)
}

export function mergePublishedPackage(current: SongPackage, incoming: SongPackage): SongPackage {
  if (current.id !== incoming.id) throw new Error(`Cannot merge song ${incoming.id} into ${current.id}`)
  const incomingMapIds = new Set(incoming.beatmaps.map((map) => map.id))
  const removeEmptyStarter = incoming.beatmaps.length > 0 && !incomingMapIds.has('draft')
  const retainedMaps = current.beatmaps.filter((map) => !incomingMapIds.has(map.id) && !(removeEmptyStarter && map.id === 'draft' && map.notes.length === 0))
  const incomingProfileIds = new Set(incoming.timingProfiles.map((profile) => profile.id))
  const retainedProfiles = current.timingProfiles.filter((profile) => !incomingProfileIds.has(profile.id))
  return parseSongPackage({
    ...current,
    song: incoming.song,
    timingProfiles: [...retainedProfiles, ...incoming.timingProfiles],
    beatmaps: [...retainedMaps, ...incoming.beatmaps],
    defaultTimingProfileId: incoming.defaultTimingProfileId,
    updatedAt: incoming.updatedAt,
  })
}

async function writeCatalog(path: string, catalog: BuiltInSongCatalog): Promise<void> {
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`)
  await rename(temporaryPath, path)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv)
  if (!args.exportPath) usage()
  const exported = packagesFromExport(JSON.parse(await readFile(resolve(args.exportPath), 'utf8')))
  const selected = args.songId ? exported.filter((songPackage) => songPackage.id === args.songId) : exported
  if (args.songId && selected.length === 0) throw new Error(`Export does not contain song ${args.songId}`)
  const catalogPath = resolve(args.catalog)
  const catalog = parseBuiltInSongCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  const catalogIds = new Set(catalog.songs.map((entry) => entry.songPackage.id))
  const matching = selected.filter((songPackage) => catalogIds.has(songPackage.id))
  if (matching.length === 0) throw new Error('Export does not match any built-in catalog song id')
  if (!args.songId && matching.length > 1) throw new Error('Export matches multiple built-in songs. Pass --song <id>.')
  const incoming = matching[0]
  const songs = catalog.songs.map((entry) => entry.songPackage.id === incoming.id
    ? { ...entry, songPackage: mergePublishedPackage(entry.songPackage, incoming) }
    : entry)
  await writeCatalog(catalogPath, parseBuiltInSongCatalog({ ...catalog, songs }))
  console.log(`Published ${incoming.beatmaps.length} beatmap${incoming.beatmaps.length === 1 ? '' : 's'} for ${incoming.song.title}.`)
  console.log(`Updated ${catalogPath}. Commit this catalog change and deploy it when the map is ready.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
