import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readableAudioFileName } from './audio-filename.js'

const OPAQUE_AUDIO_FILE_NAME = /^[A-Za-z0-9_-]{16}\.m4a$/

export class AudioCache {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.audioDir = path.join(dataDir, 'audio')
    this.indexFile = path.join(dataDir, 'library.json')
    this.items = new Map()
  }

  async init() {
    await mkdir(this.audioDir, { recursive: true })
    try {
      const items = JSON.parse(await readFile(this.indexFile, 'utf8'))
      if (Array.isArray(items)) items.forEach((item) => { if (item?.id && item?.fileName) this.items.set(item.id, item) })
      if (await this.renameOpaqueFiles()) await this.save()
    } catch {}
  }

  publicItem(item) {
    return { audioId: item.id, title: item.title, durationMs: item.durationMs, contentType: item.contentType, size: item.size, ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}), ...(item.extractorId ? { extractorId: item.extractorId } : {}), ...(item.codec ? { codec: item.codec } : {}) }
  }

  get(id) { return this.items.get(id) ?? null }
  filePath(item) { return path.join(this.audioDir, item.fileName) }
  bySource(sourceUrl) { return [...this.items.values()].find((item) => item.sourceUrl === sourceUrl) ?? null }

  async renameOpaqueFiles() {
    let changed = false
    for (const item of this.items.values()) {
      if (!OPAQUE_AUDIO_FILE_NAME.test(item.fileName)) continue
      const readableName = readableAudioFileName(item.title, item.id)
      const source = this.filePath(item)
      const destination = path.join(this.audioDir, readableName)
      try {
        await access(destination)
        try {
          await access(source)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            item.fileName = readableName
            changed = true
          }
        }
        continue
      } catch (error) {
        if (error?.code !== 'ENOENT') continue
      }
      try {
        await rename(source, destination)
        item.fileName = readableName
        changed = true
      } catch {}
    }
    return changed
  }

  async add(item) {
    this.items.set(item.id, item)
    await this.save()
  }

  async delete(id) {
    const item = this.items.get(id)
    if (!item) return false
    this.items.delete(id)
    await Promise.all([rm(this.filePath(item), { force: true }), this.save()])
    return true
  }

  async save() {
    const temp = `${this.indexFile}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify([...this.items.values()], null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.indexFile)
  }
}
