import express from 'express'
import { mkdir, stat, writeFile, readdir, readFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { nanoid } from 'nanoid'
import fftPackage from 'fft-js'

const { fft, util: fftUtil } = fftPackage

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const importsDir = path.join(rootDir, 'public', 'imports')
const port = Number(process.env.IMPORT_SERVER_PORT ?? 5174)

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use('/imports', express.static(importsDir))

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} exited ${code}\n${stderr || stdout}`))
    })
  })
}

function runBuffer(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    const chunks = []
    let stderr = ''
    child.stdout.on('data', (chunk) => { chunks.push(chunk) })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`${command} exited ${code}\n${stderr}`))
    })
  })
}

async function assertCli(name) {
  const versionFlag = name === 'ffmpeg' || name === 'ffprobe' ? '-version' : '--version'
  try {
    await run(name, [versionFlag])
  } catch {
    throw new Error(`Missing local dependency: ${name}. Install it and retry. Example: sudo apt install ffmpeg && pipx install yt-dlp`)
  }
}

function makeBlankBeatmap(id, title, durationMs) {
  return {
    id,
    title: `${title} blank map`,
    generatedAt: new Date().toISOString(),
    kind: 'blank',
    durationMs,
    lanes: ['kick', 'snare', 'low', 'mid', 'high'],
    controls: { kick: 'Space', snare: 'W', low: 'ArrowLeft', mid: 'ArrowUp', high: 'ArrowRight' },
    notes: [],
  }
}

async function makeAnalyzedBeatmap(id, title, audioPath, durationMs) {
  const sampleRate = 22050
  const frameSize = 2048
  const hopSize = 512
  const raw = await runBuffer('ffmpeg', ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'])
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
  const bands = [
    { lane: 'kick', source: 'kick-low-onset', min: 35, max: 155, threshold: 1.55, minGapMs: 240 },
    { lane: 'snare', source: 'snare-clap-onset', min: 900, max: 5200, threshold: 1.42, minGapMs: 165 },
  ]
  const envelopes = bands.map((band) => ({ band, frames: [] }))

  for (let offset = 0; offset + frameSize < samples.length; offset += hopSize) {
    const frame = Array.from(samples.subarray(offset, offset + frameSize), (sample, index) => {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1))
      return sample * window
    })
    const magnitudes = fftUtil.fftMag(fft(frame))
    const timeMs = (offset / sampleRate) * 1000

    envelopes.forEach(({ band, frames }) => {
      const minBin = Math.max(1, Math.floor((band.min / sampleRate) * frameSize))
      const maxBin = Math.min(magnitudes.length - 1, Math.ceil((band.max / sampleRate) * frameSize))
      let energy = 0
      for (let bin = minBin; bin <= maxBin; bin += 1) energy += magnitudes[bin] * magnitudes[bin]
      frames.push({ timeMs, energy: Math.sqrt(energy / Math.max(1, maxBin - minBin + 1)) })
    })
  }

  const notes = []
  envelopes.forEach(({ band, frames }) => {
    const flux = frames.map((frame, index) => ({
      timeMs: frame.timeMs,
      value: Math.max(0, frame.energy - (frames[index - 1]?.energy ?? frame.energy)),
      energy: frame.energy,
    }))
    const candidates = []
    for (let index = 4; index < flux.length - 4; index += 1) {
      const local = flux.slice(Math.max(0, index - 24), index)
      const avg = local.reduce((sum, item) => sum + item.value, 0) / Math.max(1, local.length)
      const isLocalPeak = flux[index].value >= flux[index - 1].value && flux[index].value > flux[index + 1].value
      if (flux[index].timeMs > 1200 && isLocalPeak && flux[index].value > avg * band.threshold) {
        candidates.push({ timeMs: flux[index].timeMs, strength: flux[index].value / Math.max(avg * band.threshold, 0.0001) })
      }
    }

    let lastAccepted = -Infinity
    const accepted = []
    candidates.forEach((candidate) => {
      if (candidate.timeMs - lastAccepted >= band.minGapMs) {
        accepted.push(candidate)
        lastAccepted = candidate.timeMs
      } else if (candidate.strength > accepted.at(-1).strength * 1.25) {
        accepted[accepted.length - 1] = candidate
        lastAccepted = candidate.timeMs
      }
    })

    const thinned = band.lane === 'kick' ? accepted.filter((_candidate, index) => index % 2 === 0) : accepted
    thinned.forEach((candidate) => {
      notes.push({
        id: `${id}-${notes.length}`,
        impactTimeMs: Math.round(candidate.timeMs),
        lane: band.lane,
        strength: Math.min(1, candidate.strength),
        source: band.source,
      })
    })
  })

  const sortedNotes = notes
    .sort((a, b) => a.impactTimeMs - b.impactTimeMs)
    .filter((note, index, all) => index === 0 || note.impactTimeMs - all[index - 1].impactTimeMs > 55 || note.lane !== all[index - 1].lane)

  return {
    id,
    title,
    generatedAt: new Date().toISOString(),
    kind: 'drum-onset-kick-every-second-snare-v2',
    durationMs,
    lanes: ['kick', 'snare'],
    controls: { kick: 'Space', snare: 'W', low: 'ArrowLeft', mid: 'ArrowUp', high: 'ArrowRight' },
    notes: sortedNotes.slice(0, 2500),
  }
}

async function getDurationMs(audioPath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ])
  return Math.round(Number(stdout.trim()) * 1000) || 0
}

async function listBeatmaps(songId) {
  const dir = path.join(importsDir, songId, 'beatmaps')
  await mkdir(dir, { recursive: true })
  const files = await readdir(dir).catch(() => [])
  const maps = []
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    try {
      const map = JSON.parse(await readFile(path.join(dir, file), 'utf8'))
      maps.push({ id: map.id, title: map.title, difficulty: map.difficulty ?? 1, updatedAt: map.updatedAt, noteCount: map.notes?.length ?? 0, url: `/imports/${songId}/beatmaps/${file}` })
    } catch {}
  }
  return maps.sort((a, b) => String(a.title).localeCompare(String(b.title)))
}

async function listImports() {
  await mkdir(importsDir, { recursive: true })
  const entries = await readdir(importsDir, { withFileTypes: true })
  const imports = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const meta = JSON.parse(await readFile(path.join(importsDir, entry.name, 'meta.json'), 'utf8'))
      const beatmap = JSON.parse(await readFile(path.join(importsDir, entry.name, 'beatmap.json'), 'utf8'))
      imports.push({
        id: meta.id ?? entry.name,
        title: meta.title ?? 'Imported song',
        sourceUrl: meta.sourceUrl,
        durationMs: meta.durationMs ?? beatmap.durationMs ?? 0,
        bpm: meta.bpm,
        beatOffsetMs: meta.beatOffsetMs,
        audioUrl: `/imports/${entry.name}/audio.mp3`,
        beatmapUrl: `/imports/${entry.name}/beatmap.json`,
        noteCount: beatmap.notes?.length ?? 0,
        beatmaps: await listBeatmaps(entry.name),
      })
    } catch {
      // Ignore partial/failed imports.
    }
  }
  return imports.sort((a, b) => a.title.localeCompare(b.title))
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/imports', async (_req, res) => {
  res.json({ imports: await listImports() })
})

app.get('/api/imports/:songId/beatmaps', async (req, res) => {
  res.json({ beatmaps: await listBeatmaps(req.params.songId) })
})

app.patch('/api/imports/:songId', async (req, res) => {
  const songId = req.params.songId
  const file = path.join(importsDir, songId, 'meta.json')
  try {
    const meta = JSON.parse(await readFile(file, 'utf8'))
    const next = { ...meta }
    if (Number.isFinite(Number(req.body?.bpm)) && Number(req.body.bpm) > 0) next.bpm = Number(req.body.bpm)
    if (Number.isFinite(Number(req.body?.beatOffsetMs)) && Number(req.body.beatOffsetMs) >= 0) next.beatOffsetMs = Number(req.body.beatOffsetMs)
    await writeFile(file, JSON.stringify(next, null, 2))
    res.json({ song: next })
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Song not found' })
  }
})

app.post('/api/imports/:songId/beatmaps', async (req, res) => {
  const songId = req.params.songId
  const incoming = req.body?.beatmap
  if (!incoming?.notes) return res.status(400).json({ error: 'Missing beatmap' })
  const dir = path.join(importsDir, songId, 'beatmaps')
  const historyDir = path.join(dir, '.history')
  await mkdir(dir, { recursive: true })
  await mkdir(historyDir, { recursive: true })
  const now = new Date().toISOString()
  const id = String(incoming.id || nanoid(8)).replace(/[^a-zA-Z0-9_-]/g, '-')
  const file = path.join(dir, `${id}.json`)
  try { await copyFile(file, path.join(historyDir, `${id}-${Date.now()}.json`)) } catch {}
  const beatmap = { ...incoming, id, songId, updatedAt: now, createdAt: incoming.createdAt ?? now, version: (incoming.version ?? 0) + 1 }
  await writeFile(file, JSON.stringify(beatmap, null, 2))
  res.json({ beatmap, url: `/imports/${songId}/beatmaps/${id}.json`, beatmaps: await listBeatmaps(songId) })
})

app.post('/api/import-youtube', async (req, res) => {
  const url = String(req.body?.url ?? '').trim()
  if (!url) {
    res.status(400).json({ error: 'Missing url' })
    return
  }

  try {
    await assertCli('yt-dlp')
    await assertCli('ffmpeg')
    await assertCli('ffprobe')

    const force = Boolean(req.body?.force)
    if (!force) {
      const existing = (await listImports()).find((item) => item.sourceUrl === url)
      if (existing) {
        res.json({ ...existing, cached: true })
        return
      }
    }

    const id = nanoid(10)
    const outDir = path.join(importsDir, id)
    await mkdir(outDir, { recursive: true })

    const infoResult = await run('yt-dlp', ['--dump-json', '--no-playlist', url])
    const info = JSON.parse(infoResult.stdout.split('\n').find(Boolean) ?? '{}')
    const title = String(info.title ?? 'Imported song')

    const rawTemplate = path.join(outDir, 'source.%(ext)s')
    await run('yt-dlp', [
      '--no-playlist',
      '-f', 'bestaudio/best',
      '-o', rawTemplate,
      url,
    ])

    const rawExt = info.ext ? `source.${info.ext}` : 'source.webm'
    let rawPath = path.join(outDir, rawExt)
    try {
      await stat(rawPath)
    } catch {
      const files = await import('node:fs/promises').then((fs) => fs.readdir(outDir))
      const sourceFile = files.find((file) => file.startsWith('source.'))
      if (!sourceFile) throw new Error('Downloaded audio file was not found')
      rawPath = path.join(outDir, sourceFile)
    }

    const audioPath = path.join(outDir, 'audio.mp3')
    await run('ffmpeg', ['-y', '-i', rawPath, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', audioPath])

    const durationMs = await getDurationMs(audioPath)
    const beatmap = makeBlankBeatmap(id, title, durationMs)
    const now = new Date().toISOString()
    await writeFile(path.join(outDir, 'beatmap.json'), JSON.stringify(beatmap, null, 2))
    await mkdir(path.join(outDir, 'beatmaps'), { recursive: true })
    await writeFile(path.join(outDir, 'beatmaps', 'blank.json'), JSON.stringify({ ...beatmap, id: 'blank', songId: id, difficulty: 1, version: 1, source: 'blank', createdAt: now, updatedAt: now }, null, 2))
    await writeFile(path.join(outDir, 'meta.json'), JSON.stringify({ id, title, sourceUrl: url, durationMs }, null, 2))

    res.json({
      id,
      title,
      durationMs,
      audioUrl: `/imports/${id}/audio.mp3`,
      beatmapUrl: `/imports/${id}/beatmap.json`,
      noteCount: beatmap.notes.length,
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.listen(port, () => {
  console.log(`Local import server listening on http://localhost:${port}`)
})
