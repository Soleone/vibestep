import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readableAudioFileName } from './audio-filename.js'
import { AudioCache } from './cache.js'

test('builds a lowercase readable filename from the song title', () => {
  assert.equal(
    readableAudioFileName('Beyoncé - Déjà Vu (Live).mp3', 'AbC_123'),
    'beyonce-deja-vu-live-abc_123.m4a',
  )
})

test('keeps non-Latin titles readable', () => {
  assert.equal(readableAudioFileName('東京ナイト', 'song1'), '東京ナイト-song1.m4a')
})

test('renames legacy opaque cache files on startup', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'vibestep-audio-cache-'))
  const audioDir = path.join(dataDir, 'audio')
  const legacyName = 'XYwWCMSm4tg7pD5W.m4a'
  const item = { id: 'XYwWCMSm4tg7pD5W', fileName: legacyName, title: 'My Favorite Song', durationMs: 1000, contentType: 'audio/mp4', size: 5 }
  await writeFile(path.join(dataDir, 'library.json'), JSON.stringify([item]))
  await mkdir(audioDir, { recursive: true })
  await writeFile(path.join(audioDir, legacyName), 'audio')

  const cache = new AudioCache(dataDir)
  await cache.init()

  const readableName = 'my-favorite-song-xywwcmsm4tg7pd5w.m4a'
  assert.equal(cache.get(item.id).fileName, readableName)
  assert.equal(await readFile(path.join(audioDir, readableName), 'utf8'), 'audio')
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8'))[0].fileName, readableName)
})
