import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { downloadSessionAudio } from '../src/audio/download-session-audio.ts'
import { BUILT_IN_SONG_CATALOG_FORMAT, BUILT_IN_SONG_CATALOG_VERSION, parseBuiltInSongCatalog } from '../src/builtin-songs/catalog.ts'

async function songPackage() {
  return JSON.parse(await readFile(new URL('../src/domain/fixtures/shared-timing.song-package.json', import.meta.url), 'utf8'))
}

async function catalogEntry() {
  return {
    songPackage: await songPackage(),
    audio: {
      url: 'https://audio.vibestep.app/songs/example/hash.mp3',
      sha256: 'a'.repeat(64),
      byteLength: 42,
      contentType: 'audio/mpeg',
    },
    license: {
      name: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'Example by Artist',
      sourceUrl: 'https://artist.example/example',
    },
  }
}

test('parses a built-in catalog and rejects duplicate song ids', async () => {
  const entry = await catalogEntry()
  const catalog = parseBuiltInSongCatalog({
    format: BUILT_IN_SONG_CATALOG_FORMAT,
    version: BUILT_IN_SONG_CATALOG_VERSION,
    songs: [entry],
  })
  assert.equal(catalog.songs[0].songPackage.id, entry.songPackage.id)
  assert.equal(catalog.songs[0].audio.sha256, 'a'.repeat(64))

  assert.throws(() => parseBuiltInSongCatalog({
    format: BUILT_IN_SONG_CATALOG_FORMAT,
    version: BUILT_IN_SONG_CATALOG_VERSION,
    songs: [entry, entry],
  }), /duplicate song id/)
})

test('downloads complete session audio and verifies its checksum', async () => {
  const bytes = new TextEncoder().encode('small audio fixture')
  const expectedHash = createHash('sha256').update(bytes).digest('hex')
  const originalFetch = globalThis.fetch
  let requestedCache: RequestCache | undefined
  globalThis.fetch = async (_input, init) => {
    requestedCache = init?.cache
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  }
  try {
    const blob = await downloadSessionAudio({
      url: 'https://audio.vibestep.app/songs/example/audio.mp3',
      sha256: expectedHash,
      byteLength: bytes.byteLength,
      contentType: 'audio/mpeg',
    })
    assert.equal(blob.size, bytes.byteLength)
    assert.equal(blob.type, 'audio/mpeg')
    assert.equal(requestedCache, 'no-store')

    await assert.rejects(downloadSessionAudio({
      url: 'https://audio.vibestep.app/songs/example/audio.mp3',
      sha256: '0'.repeat(64),
      byteLength: bytes.byteLength,
      contentType: 'audio/mpeg',
    }), /SHA-256/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
