import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { provisionCompanionTools, provisionPinnedTool, toolPlatformKey } from './tools.js'

const bytes = Buffer.from('reviewed tool binary')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const descriptor = { version: 'test-1', fileName: 'tool', url: 'https://downloads.example/tool', sha256 }
const manifest = { tools: { ytDlp: { 'linux-x64': descriptor }, ffmpeg: { 'linux-x64': { ...descriptor, fileName: 'ffmpeg' } }, ffprobe: { 'linux-x64': { ...descriptor, fileName: 'ffprobe' } } } }
const response = { ok: true, arrayBuffer: async () => bytes }

test('provisions a checksum-verified executable and reuses it', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'vibestep-tools-'))
  let downloads = 0
  const fetchImpl = async () => { downloads += 1; return response }
  try {
    const destination = await provisionPinnedTool({ name: 'ytDlp', platformKey: 'linux-x64', dataDir, fetchImpl, manifest })
    assert.deepEqual(await readFile(destination), bytes)
    assert.equal(downloads, 1)
    assert.equal(await provisionPinnedTool({ name: 'ytDlp', platformKey: 'linux-x64', dataDir, fetchImpl, manifest }), destination)
    assert.equal(downloads, 1)
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('replaces a cached executable that fails checksum verification', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'vibestep-tools-'))
  try {
    const destination = path.join(dataDir, 'tools', descriptor.version, descriptor.fileName)
    await provisionPinnedTool({ name: 'ytDlp', platformKey: 'linux-x64', dataDir, fetchImpl: async () => response, manifest })
    await writeFile(destination, 'tampered')
    await provisionPinnedTool({ name: 'ytDlp', platformKey: 'linux-x64', dataDir, fetchImpl: async () => response, manifest })
    assert.deepEqual(await readFile(destination), bytes)
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('rejects checksum mismatches without installing the download', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'vibestep-tools-'))
  const badManifest = { tools: { ytDlp: { 'linux-x64': { ...descriptor, sha256: '0'.repeat(64) } } } }
  try {
    await assert.rejects(provisionPinnedTool({ name: 'ytDlp', platformKey: 'linux-x64', dataDir, fetchImpl: async () => response, manifest: badManifest }), /Checksum mismatch/)
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('uses explicit overrides while provisioning missing companion tools', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'vibestep-tools-'))
  try {
    const tools = await provisionCompanionTools({ dataDir, platform: 'linux', arch: 'x64', env: { VIBESTEP_YT_DLP: '/trusted/yt-dlp' }, fetchImpl: async () => response, manifest })
    assert.equal(tools.ytDlp, '/trusted/yt-dlp')
    assert.equal(tools.ffmpeg, path.join(dataDir, 'tools', 'test-1', 'ffmpeg'))
    assert.equal(tools.ffprobe, path.join(dataDir, 'tools', 'test-1', 'ffprobe'))
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('limits automatic provisioning to reviewed platform targets', async () => {
  assert.equal(toolPlatformKey('linux', 'x64'), 'linux-x64')
  assert.equal(toolPlatformKey('win32', 'x64'), 'win32-x64')
  assert.throws(() => toolPlatformKey('darwin', 'arm64'), /No reviewed media tools/)
  const overrides = { VIBESTEP_YT_DLP: '/tools/yt-dlp', VIBESTEP_FFMPEG: '/tools/ffmpeg', VIBESTEP_FFPROBE: '/tools/ffprobe' }
  assert.deepEqual(await provisionCompanionTools({ dataDir: '/unused', platform: 'darwin', arch: 'arm64', env: overrides }), { ytDlp: '/tools/yt-dlp', ffmpeg: '/tools/ffmpeg', ffprobe: '/tools/ffprobe' })
})
