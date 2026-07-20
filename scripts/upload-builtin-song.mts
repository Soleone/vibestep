import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseBuiltInSongCatalog, parseBuiltInSongDraft, BUILT_IN_SONG_CATALOG_FORMAT, BUILT_IN_SONG_CATALOG_VERSION, type BuiltInSongCatalog } from '../src/builtin-songs/catalog.ts'

const DEFAULT_CATALOG_PATH = 'public/builtin-song-catalog.json'
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const CONTENT_TYPES: Record<string, string> = {
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}

type Arguments = {
  source?: string
  metadata?: string
  bucket?: string
  publicBaseUrl?: string
  catalog: string
  contentType?: string
  extension?: string
  replace: boolean
}

function usage(): never {
  console.error(`Usage:
  npm run song:upload -- --source <file-or-url> --metadata <json> [options]

Options:
  --bucket <name>             R2 bucket, or set R2_BUCKET
  --public-base-url <url>     Public R2/custom-domain URL, or set R2_PUBLIC_BASE_URL
  --catalog <path>            Catalog path (default: ${DEFAULT_CATALOG_PATH})
  --content-type <audio/...>  Required if the source extension is unknown
  --extension <.mp3>          Required if the source URL has no useful extension
  --replace                   Allow a song id to point at different audio bytes

Local settings can be stored in .env.r2.local.`)
  process.exit(1)
}

function parseArguments(argv: string[]): Arguments {
  const result: Arguments = { catalog: DEFAULT_CATALOG_PATH, replace: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--replace') {
      result.replace = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) usage()
    index += 1
    if (argument === '--source') result.source = value
    else if (argument === '--metadata') result.metadata = value
    else if (argument === '--bucket') result.bucket = value
    else if (argument === '--public-base-url') result.publicBaseUrl = value
    else if (argument === '--catalog') result.catalog = value
    else if (argument === '--content-type') result.contentType = value
    else if (argument === '--extension') result.extension = value
    else usage()
  }
  return result
}

async function loadLocalEnvironment(path = '.env.r2.local'): Promise<Record<string, string>> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const values: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`Invalid ${path} line: ${rawLine}`)
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

function sourceExtension(source: string, override?: string): string {
  const rawExtension = override ?? (isRemoteSource(source) ? extname(new URL(source).pathname) : extname(source))
  if (!rawExtension) return ''
  return `${rawExtension.startsWith('.') ? '' : '.'}${rawExtension.toLowerCase()}`
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function acquireSource(source: string, temporaryDirectory: string, extension: string): Promise<string> {
  if (!isRemoteSource(source)) return resolve(source)
  const url = new URL(source)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Remote source must use HTTP or HTTPS')
  console.log(`Downloading ${url.toString()}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Source download failed with HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) throw new Error(`Audio exceeds the ${MAX_AUDIO_BYTES / 1024 / 1024} MiB limit`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new Error(`Audio exceeds the ${MAX_AUDIO_BYTES / 1024 / 1024} MiB limit`)
  const path = join(temporaryDirectory, `source${extension}`)
  await writeFile(path, bytes)
  return path
}

async function readCatalog(path: string): Promise<BuiltInSongCatalog> {
  try {
    return parseBuiltInSongCatalog(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: BUILT_IN_SONG_CATALOG_FORMAT, version: BUILT_IN_SONG_CATALOG_VERSION, songs: [] }
    throw error
  }
}

async function writeCatalog(path: string, catalog: BuiltInSongCatalog): Promise<void> {
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`)
  await rename(temporaryPath, path)
}

function uploadWithWrangler(bucket: string, key: string, path: string, contentType: string): void {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(executable, ['--yes', 'wrangler@4.112.0', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', path, '--content-type', contentType, '--cache-control', 'public, max-age=31536000, immutable', '--remote', '--force'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Wrangler upload failed with exit code ${String(result.status)}`)
}

const args = parseArguments(process.argv.slice(2))
const localEnvironment = await loadLocalEnvironment()
const source = args.source
const metadataPath = args.metadata
const bucket = args.bucket ?? process.env.R2_BUCKET ?? localEnvironment.R2_BUCKET
const publicBaseUrl = args.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL ?? localEnvironment.R2_PUBLIC_BASE_URL
if (!source || !metadataPath || !bucket || !publicBaseUrl) usage()

const extension = sourceExtension(source, args.extension)
const contentType = args.contentType ?? CONTENT_TYPES[extension]
if (!extension || !contentType?.startsWith('audio/')) throw new Error('Could not determine a supported audio format. Pass --extension and --content-type explicitly.')

const draft = parseBuiltInSongDraft(JSON.parse(await readFile(resolve(metadataPath), 'utf8')))
if (draft.songPackage.beatmaps.length === 0) throw new Error('Built-in songs need at least one beatmap before publication')
if (!/^[a-zA-Z0-9_-]+$/.test(draft.songPackage.id)) throw new Error('Built-in song package id may contain only letters, numbers, underscores, and hyphens')

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vibestep-song-'))
try {
  const audioPath = await acquireSource(source, temporaryDirectory, extension)
  const audioStat = await stat(audioPath)
  if (!audioStat.isFile()) throw new Error(`Audio source is not a file: ${audioPath}`)
  if (audioStat.size <= 0 || audioStat.size > MAX_AUDIO_BYTES) throw new Error(`Audio must be between 1 byte and ${MAX_AUDIO_BYTES / 1024 / 1024} MiB`)
  const digest = await sha256(audioPath)
  const key = `songs/${draft.songPackage.id}/${digest}${extension}`
  const baseUrl = new URL(publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`)
  const audioUrl = new URL(key, baseUrl).toString()
  const catalogPath = resolve(args.catalog)
  const catalog = await readCatalog(catalogPath)
  const existing = catalog.songs.find((entry) => entry.songPackage.id === draft.songPackage.id)
  if (existing && existing.audio.sha256 !== digest && !args.replace) throw new Error(`Song ${draft.songPackage.id} already uses different audio. Pass --replace only after revalidating every beatmap timing.`)

  console.log(`Uploading ${basename(audioPath)} (${audioStat.size} bytes) to r2://${bucket}/${key}`)
  uploadWithWrangler(bucket, key, audioPath, contentType)

  const entry = {
    ...draft,
    audio: { url: audioUrl, sha256: digest, byteLength: audioStat.size, contentType },
  }
  const songs = [...catalog.songs.filter((item) => item.songPackage.id !== draft.songPackage.id), entry]
    .sort((left, right) => left.songPackage.song.title.localeCompare(right.songPackage.song.title))
  await writeCatalog(catalogPath, { ...catalog, songs })
  console.log(`Updated ${catalogPath}`)
  console.log(`Published ${draft.songPackage.song.title}: ${audioUrl}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
