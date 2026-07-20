import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const CONTENT_TYPES: Record<string, string> = {
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}
const EXTENSIONS_BY_CONTENT_TYPE: Record<string, string> = Object.fromEntries(Object.entries(CONTENT_TYPES).map(([extension, contentType]) => [contentType, extension]))
const LICENSES = {
  cc0: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'cc-by-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
} as const

type LicenseKey = keyof typeof LICENSES

type IntakeArguments = {
  source?: string
  artist?: string
  title?: string
  sourceUrl?: string
  license?: LicenseKey
  id?: string
  bpm: number
  yes: boolean
}

export type AcquiredAudio = {
  path: string
  extension: string
  contentType: string
  suggestedName: string
}

export function inferArtistAndTitle(fileName: string): { artist: string; title: string } {
  const stem = basename(fileName, extname(fileName)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = stem.split(/\s+(?:-|–)\s+/, 2)
  return parts.length === 2 ? { artist: parts[0].trim(), title: parts[1].trim() } : { artist: '', title: stem }
}

export function songSlug(artist: string, title: string): string {
  const slug = `${artist}-${title}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || `song-${Date.now().toString(36)}`
}

function usage(): never {
  console.error(`Usage:
  npm run song:intake -- <audio-file-or-direct-url> [options]

Options:
  --artist <name>          Override the inferred artist
  --title <title>          Override the inferred title
  --source-url <url>       Page proving the source and license
  --license <id>           cc0 or cc-by-4.0 (default: cc0)
  --id <slug>              Stable song id
  --bpm <number>           Starter BPM (default: 120)
  --yes                    Confirm licensing non-interactively

Remote HTTP(S) URLs are downloaded immediately before upload.`)
  process.exit(1)
}

export function parseIntakeArguments(argv: string[]): IntakeArguments {
  const result: IntakeArguments = { bpm: 120, yes: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--yes') {
      result.yes = true
      continue
    }
    if (!argument.startsWith('--') && !result.source) {
      result.source = argument
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) usage()
    index += 1
    if (argument === '--artist') result.artist = value
    else if (argument === '--title') result.title = value
    else if (argument === '--source-url') result.sourceUrl = value
    else if (argument === '--license' && (value === 'cc0' || value === 'cc-by-4.0')) result.license = value
    else if (argument === '--id') result.id = value
    else if (argument === '--bpm') result.bpm = Number(value)
    else usage()
  }
  if (!Number.isFinite(result.bpm) || result.bpm <= 0) throw new Error('BPM must be a positive number')
  return result
}

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

function cleanContentType(value: string | null): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || undefined
}

function responseFileName(response: Response, fallbackUrl: string): string {
  const disposition = response.headers.get('content-disposition')
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1]
  const candidate = encoded ? decodeURIComponent(encoded) : plain
  if (candidate) return basename(candidate)
  const responsePath = new URL(response.url || fallbackUrl).pathname
  return basename(decodeURIComponent(responsePath)) || 'remote-audio'
}

export async function acquireAudio(source: string, temporaryDirectory: string): Promise<AcquiredAudio> {
  if (!isRemoteSource(source)) {
    const path = resolve(source)
    const extension = extname(path).toLowerCase()
    const contentType = CONTENT_TYPES[extension]
    if (!contentType) throw new Error(`Unsupported audio extension: ${extension || '(none)'}`)
    return { path, extension, contentType, suggestedName: basename(path) }
  }

  const url = new URL(source)
  console.log(`Downloading ${url.toString()}...`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Remote audio download failed with HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) throw new Error('Remote audio exceeds the 50 MiB limit')
  const suggestedName = responseFileName(response, source)
  const responseContentType = cleanContentType(response.headers.get('content-type'))
  const nameExtension = extname(suggestedName).toLowerCase()
  const extension = CONTENT_TYPES[nameExtension] ? nameExtension : responseContentType ? EXTENSIONS_BY_CONTENT_TYPE[responseContentType] : undefined
  const contentType = responseContentType?.startsWith('audio/') ? responseContentType : extension ? CONTENT_TYPES[extension] : undefined
  if (!extension || !contentType) throw new Error('Could not identify the remote audio format from its URL or Content-Type header')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error('Remote audio must be between 1 byte and 50 MiB')
  const path = join(temporaryDirectory, `audio${extension}`)
  await writeFile(path, bytes)
  console.log(`Downloaded ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB.`)
  return { path, extension, contentType, suggestedName }
}

async function promptWithDefault(prompt: ReturnType<typeof createInterface>, label: string, defaultValue = ''): Promise<string> {
  const answer = (await prompt.question(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `)).trim()
  return answer || defaultValue
}

function assertWebUrl(value: string, label: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${label} must be an absolute URL`) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${label} must use HTTP or HTTPS`)
  return url.toString()
}

export function createStarterMetadata(options: { id: string; artist: string; title: string; sourceUrl: string; licenseKey: LicenseKey; durationMs: number; bpm: number; now?: string }) {
  const now = options.now ?? new Date().toISOString()
  const license = LICENSES[options.licenseKey]
  return {
    songPackage: {
      format: 'song-package', version: 1, id: options.id,
      song: { id: options.id, title: options.title, artist: options.artist, durationMs: options.durationMs, sources: [{ kind: 'url', url: options.sourceUrl, label: 'License and source page' }] },
      timingProfiles: [{ id: 'default', name: 'Starter timing', bpm: options.bpm, beatOffsetMs: 0, timeSignature: [4, 4] }],
      beatmaps: [{ id: 'draft', title: `${options.title} draft`, difficulty: 1, timingProfileId: 'default', durationMs: options.durationMs, notes: [], version: 0, createdAt: now, updatedAt: now }],
      defaultTimingProfileId: 'default', createdAt: now, updatedAt: now,
    },
    license: { ...license, attribution: `${options.title} by ${options.artist}`, sourceUrl: options.sourceUrl },
  }
}

async function runUploader(audio: AcquiredAudio, metadataPath: string): Promise<void> {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', resolve('scripts/upload-builtin-song.mts'), '--source', audio.path, '--metadata', metadataPath, '--extension', audio.extension, '--content-type', audio.contentType], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Song upload failed with exit code ${String(result.status)}`)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseIntakeArguments(argv)
  if (!args.source) usage()
  if (args.yes && (!args.license || !args.sourceUrl)) throw new Error('--yes requires explicit --license and --source-url values')
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vibestep-intake-'))
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const audio = await acquireAudio(args.source, temporaryDirectory)
    const fileStat = await stat(audio.path)
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_AUDIO_BYTES) throw new Error('Audio must be a file between 1 byte and 50 MiB')
    const inferred = inferArtistAndTitle(audio.suggestedName)
    const artistDefault = args.artist ?? inferred.artist
    const titleDefault = args.title ?? inferred.title
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !args.yes
    const artist = args.artist ?? (interactive ? await promptWithDefault(prompt, 'Artist', artistDefault) : artistDefault)
    const title = args.title ?? (interactive ? await promptWithDefault(prompt, 'Title', titleDefault) : titleDefault)
    if (!artist || !title) throw new Error('Artist and title are required. Use --artist and --title when they cannot be inferred.')
    const defaultSourceUrl = args.sourceUrl ?? (isRemoteSource(args.source) ? args.source : '')
    const sourceUrl = assertWebUrl(args.sourceUrl ?? (interactive ? await promptWithDefault(prompt, 'Source or license evidence URL', defaultSourceUrl) : defaultSourceUrl), 'Source URL')
    const licenseInput = args.license ?? (interactive ? await promptWithDefault(prompt, 'License (cc0 or cc-by-4.0)', 'cc0') : 'cc0')
    if (licenseInput !== 'cc0' && licenseInput !== 'cc-by-4.0') throw new Error('License must be cc0 or cc-by-4.0')
    const licenseKey = licenseInput as LicenseKey
    const license = LICENSES[licenseKey]
    if (!args.yes) {
      if (!interactive) throw new Error('Use --yes only after verifying the source license permits redistribution')
      const confirmation = (await prompt.question(`Confirm you verified ${license.name} permits redistribution of this audio? [y/N]: `)).trim().toLowerCase()
      if (confirmation !== 'y' && confirmation !== 'yes') throw new Error('Song intake cancelled because licensing was not confirmed')
    }
    const id = args.id ?? songSlug(artist, title)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Song id may contain only letters, numbers, underscores, and hyphens')
    const metadata = createStarterMetadata({ id, artist, title, sourceUrl, licenseKey, durationMs: 0, bpm: args.bpm })
    const metadataPath = join(temporaryDirectory, 'metadata.json')
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    console.log(`Preparing ${title} by ${artist} (${license.name}).`)
    await runUploader(audio, metadataPath)
    console.log('Open or refresh local Vibestep, then select the new Built-in song to start mapping.')
  } finally {
    prompt.close()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
