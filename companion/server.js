import express from 'express'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { AudioCache } from './cache.js'
import { ImportManager } from './imports.js'
import { parseByteRange } from './range.js'
import { isAllowedHost, normalizeSourceUrl, secureEqual, signPlayback, verifyPlayback } from './security.js'
import { companionName } from '../brand.config.js'

export const COMPANION_VERSION = '0.1.0'
export const DEFAULT_PORT = 47831
const MAX_FILE_BYTES = 512 * 1024 * 1024
const ALLOWED_FILE_TYPES = new Map([
  ['audio/mp4', '.m4a'], ['audio/mpeg', '.mp3'], ['audio/webm', '.webm'], ['audio/ogg', '.ogg'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'],
])

async function loadSecret(dataDir, override) {
  if (override) return override
  const file = path.join(dataDir, 'secret')
  try { return (await readFile(file, 'utf8')).trim() } catch {}
  const secret = randomBytes(32).toString('base64url')
  await writeFile(file, `${secret}\n`, { mode: 0o600 })
  return secret
}

export async function createCompanionApp(options = {}) {
  const port = options.port ?? DEFAULT_PORT
  const dataDir = options.dataDir
  if (!dataDir) throw new Error('Companion data directory is required')
  await mkdir(dataDir, { recursive: true })
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const webUrl = options.webUrl ?? 'http://localhost:5173/'
  const secret = await loadSecret(dataDir, options.secret)
  const cache = options.cache ?? new AudioCache(dataDir)
  await cache.init()
  const imports = options.imports ?? new ImportManager({ cache, dataDir, tools: options.tools, maxConcurrent: options.maxConcurrent ?? 1 })
  await imports.init()
  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    if (!isAllowedHost(req.headers.host, port)) return res.status(400).json({ error: 'Invalid host' })
    const origin = req.headers.origin
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origin not allowed' })
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Vary', 'Origin')
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Companion-Filename')
      res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS')
      if (req.headers['access-control-request-private-network'] === 'true') res.set('Access-Control-Allow-Private-Network', 'true')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })

  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token || !secureEqual(token, secret)) return res.status(401).json({ error: 'Authentication required' })
    next()
  }

  app.get('/v1/status', (_req, res) => res.json({ ok: true, name: companionName, version: COMPANION_VERSION, paired: true }))
  app.get('/v1/pair', (_req, res) => {
    const pairing = Buffer.from(JSON.stringify({ credential: secret, baseUrl: `http://127.0.0.1:${port}` })).toString('base64url')
    const target = new URL(webUrl)
    target.hash = `vibestep-companion=${pairing}`
    res.redirect(302, target.toString())
  })
  app.use('/v1/library', requireAuth)
  app.use('/v1/imports', requireAuth)
  app.use('/v1/files', requireAuth)

  app.get('/v1/library/by-source', (req, res) => {
    try {
      const sourceUrl = normalizeSourceUrl(req.query.url)
      const item = cache.bySource(sourceUrl)
      res.set('Cache-Control', 'no-store').json({ audio: item ? cache.publicItem(item) : null })
    } catch (error) { res.status(400).json({ error: error.message }) }
  })

  app.post('/v1/imports', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const sourceUrl = normalizeSourceUrl(req.body?.url)
      const job = imports.start(sourceUrl)
      res.status(job.cached ? 200 : 202).json(imports.publicJob(job))
    } catch (error) {
      res.status(error.message === 'Another import is already running' ? 429 : 400).json({ error: error.message })
    }
  })

  app.get('/v1/imports/:jobId', (req, res) => {
    const job = imports.get(req.params.jobId)
    if (!job) return res.status(404).json({ error: 'Import job not found' })
    res.set('Cache-Control', 'no-store').json(imports.publicJob(job))
  })

  app.delete('/v1/imports/:jobId', (req, res) => {
    const job = imports.get(req.params.jobId)
    if (!job) return res.status(404).json({ error: 'Import job not found' })
    imports.cancel(job)
    res.json(imports.publicJob(job))
  })

  app.post('/v1/files', express.raw({ type: [...ALLOWED_FILE_TYPES.keys()], limit: MAX_FILE_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'A supported audio file is required' })
    const extension = ALLOWED_FILE_TYPES.get(req.headers['content-type']?.split(';')[0])
    if (!extension) return res.status(415).json({ error: 'Unsupported audio format' })
    const temporary = path.join(cache.audioDir, `${nanoid(16)}${extension}.tmp`)
    try {
      await writeFile(temporary, req.body, { mode: 0o600 })
      let title = 'Local audio file'
      try { title = decodeURIComponent(String(req.headers['x-companion-filename'] ?? title)).slice(0, 300) } catch {}
      const audio = await imports.importFile(temporary, title)
      res.status(201).json({ audio })
    } catch (error) {
      res.status(400).json({ error: error?.code === 'ENOENT' ? 'A required media tool is unavailable' : 'Could not normalize the audio file' })
    } finally {
      await rm(temporary, { force: true })
    }
  })

  app.get('/v1/audio/:audioId', async (req, res, next) => {
    if (req.query.sign !== '1') return next()
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token || !secureEqual(token, secret)) return res.status(401).json({ error: 'Authentication required' })
    const item = cache.get(req.params.audioId)
    if (!item) return res.status(404).json({ error: 'Audio not found' })
    const expiresAt = Date.now() + 5 * 60_000
    const signature = signPlayback(secret, item.id, expiresAt)
    const url = `http://127.0.0.1:${port}/v1/audio/${encodeURIComponent(item.id)}?expires=${expiresAt}&signature=${signature}`
    res.set('Cache-Control', 'no-store').json({ url, expiresAt: new Date(expiresAt).toISOString() })
  })

  const streamAudio = async (req, res) => {
    const item = cache.get(req.params.audioId)
    if (!item) return res.status(404).json({ error: 'Audio not found' })
    if (!verifyPlayback(secret, item.id, req.query.expires, req.query.signature)) return res.status(401).json({ error: 'Playback URL is invalid or expired' })
    let fileStat
    try { fileStat = await stat(cache.filePath(item)) } catch { return res.status(404).json({ error: 'Audio not found' }) }
    res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': item.contentType, 'Cache-Control': 'private, no-store' })
    let range
    try { range = parseByteRange(req.headers.range, fileStat.size) } catch {
      res.set('Content-Range', `bytes */${fileStat.size}`)
      return res.status(416).end()
    }
    if (range) {
      const length = range.end - range.start + 1
      res.status(206).set({ 'Content-Length': String(length), 'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}` })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(cache.filePath(item), range).pipe(res)
    }
    res.set('Content-Length', String(fileStat.size))
    if (req.method === 'HEAD') return res.end()
    createReadStream(cache.filePath(item)).pipe(res)
  }
  app.get('/v1/audio/:audioId', streamAudio)
  app.head('/v1/audio/:audioId', streamAudio)

  app.delete('/v1/audio/:audioId', requireAuth, async (req, res) => {
    const deleted = await cache.delete(req.params.audioId)
    res.status(deleted ? 204 : 404).end()
  })

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' })
    res.status(400).json({ error: 'Invalid request' })
  })
  return { app, secret, cache, imports }
}
