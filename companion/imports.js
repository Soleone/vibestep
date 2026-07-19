import { spawn } from 'node:child_process'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { configuredTools } from './tools.js'

const MAX_AUDIO_BYTES = 512 * 1024 * 1024

function spawnCommand(command, args, options = {}) {
  const child = spawn(command, args, { ...options, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk })
  child.stderr?.on('data', (chunk) => { stderr += chunk })
  const result = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr })
      const detail = stderr.trim().split('\n').slice(-8).join('\n')
      reject(new Error(`Process failed (${signal ?? code})${detail ? `\n${detail}` : ''}`))
    })
  })
  return { child, result, readOutput: () => ({ stdout, stderr }) }
}

async function probeAudio(ffprobe, file) {
  const process = spawnCommand(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:format_tags=title', '-of', 'json', file])
  const { stdout } = await process.result
  const parsed = JSON.parse(stdout || '{}')
  return { durationMs: Math.max(0, Math.round(Number(parsed.format?.duration ?? 0) * 1000)), title: String(parsed.format?.tags?.title ?? '') }
}

export class ImportManager {
  constructor({ cache, dataDir, tools = configuredTools(), maxConcurrent = 1 }) {
    this.cache = cache
    this.jobsDir = path.join(dataDir, 'jobs')
    this.tools = tools
    this.maxConcurrent = maxConcurrent
    this.jobs = new Map()
    this.active = 0
  }

  async init() { await mkdir(this.jobsDir, { recursive: true }) }

  publicJob(job) {
    return { id: job.id, state: job.state, progress: job.progress, ...(job.error ? { error: job.error } : {}), ...(job.audio ? { audio: job.audio } : {}), ...(job.cached ? { cached: true } : {}) }
  }

  get(id) { return this.jobs.get(id) ?? null }

  start(sourceUrl) {
    const cached = this.cache.bySource(sourceUrl)
    const job = { id: nanoid(12), sourceUrl, state: cached ? 'complete' : 'queued', progress: cached ? 100 : 0, cached: Boolean(cached), audio: cached ? this.cache.publicItem(cached) : undefined, child: null }
    this.jobs.set(job.id, job)
    if (!cached) {
      if (this.active >= this.maxConcurrent) throw new Error('Another import is already running')
      this.active += 1
      void this.run(job).finally(() => { this.active -= 1 })
    }
    return job
  }

  cancel(job) {
    if (job.state === 'complete' || job.state === 'failed' || job.state === 'cancelled') return
    job.state = 'cancelled'
    job.error = 'Import cancelled'
    job.child?.kill('SIGTERM')
  }

  async importFile(sourceFile, title) {
    const probe = await probeAudio(this.tools.ffprobe, sourceFile)
    if (!probe.durationMs) throw new Error('Uploaded file is not valid audio')
    const id = nanoid(16)
    const fileName = `${id}.m4a`
    const destination = path.join(this.cache.audioDir, fileName)
    const conversion = spawnCommand(this.tools.ffmpeg, ['-v', 'error', '-i', sourceFile, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', destination])
    await conversion.result
    const fileStat = await stat(destination)
    if (fileStat.size <= 0 || fileStat.size > MAX_AUDIO_BYTES) {
      await rm(destination, { force: true })
      throw new Error('Uploaded audio exceeds the allowed size')
    }
    const item = { id, fileName, title: String(probe.title || title || 'Local audio file').slice(0, 300), durationMs: probe.durationMs, contentType: 'audio/mp4', size: fileStat.size, createdAt: new Date().toISOString() }
    await this.cache.add(item)
    return this.cache.publicItem(item)
  }

  async run(job) {
    const dir = path.join(this.jobsDir, job.id)
    try {
      await mkdir(dir, { recursive: true })
      job.state = 'running'
      job.progress = 1
      const output = path.join(dir, 'source.%(ext)s')
      const ffmpegLocation = path.isAbsolute(this.tools.ffmpeg) || this.tools.ffmpeg.includes(path.sep)
        ? ['--ffmpeg-location', this.tools.ffmpeg]
        : []
      const download = spawnCommand(this.tools.ytDlp, ['--no-playlist', '--newline', '--js-runtimes', 'node', '--remote-components', 'ejs:github', '--print', 'after_move:vibestep-title=%(title)s', '--print', 'after_move:vibestep-id=%(id)s', '-f', 'bestaudio[ext=m4a]/bestaudio', '--extract-audio', '--audio-format', 'm4a', ...ffmpegLocation, '-o', output, job.sourceUrl])
      job.child = download.child
      const updateProgress = (chunk) => {
        const matches = String(chunk).matchAll(/\[download\]\s+([\d.]+)%/g)
        for (const match of matches) job.progress = Math.min(94, Math.max(job.progress, Math.round(Number(match[1]) * 0.9)))
      }
      download.child.stdout?.on('data', updateProgress)
      download.child.stderr?.on('data', updateProgress)
      await download.result
      if (job.state === 'cancelled') return
      job.progress = 95
      const files = await readdir(dir)
      const sourceName = files.find((name) => name.startsWith('source.') && !name.endsWith('.part'))
      if (!sourceName) throw new Error('No playable audio was produced')
      const sourceFile = path.join(dir, sourceName)
      const fileStat = await stat(sourceFile)
      if (fileStat.size <= 0 || fileStat.size > MAX_AUDIO_BYTES) throw new Error('Imported audio exceeds the allowed size')
      const probe = await probeAudio(this.tools.ffprobe, sourceFile)
      const outputText = download.readOutput().stdout
      const title = outputText.match(/^vibestep-title=(.+)$/m)?.[1]?.trim().slice(0, 300) || probe.title || 'Imported song'
      const extractorId = outputText.match(/^vibestep-id=(.+)$/m)?.[1]?.trim() || ''
      const id = nanoid(16)
      const fileName = `${id}.m4a`
      await rename(sourceFile, path.join(this.cache.audioDir, fileName))
      const item = { id, fileName, title, durationMs: probe.durationMs, contentType: 'audio/mp4', size: fileStat.size, sourceUrl: job.sourceUrl, extractorId, createdAt: new Date().toISOString() }
      await this.cache.add(item)
      job.audio = this.cache.publicItem(item)
      job.progress = 100
      job.state = 'complete'
    } catch (error) {
      if (job.state !== 'cancelled') {
        job.state = 'failed'
        job.error = error?.code === 'ENOENT' ? 'A required media tool is unavailable' : 'Audio import failed'
        console.error(`[companion] Import ${job.id} failed for ${job.sourceUrl}:\n${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      job.child = null
      await rm(dir, { recursive: true, force: true })
    }
  }
}
