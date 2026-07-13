import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createShareBundle, parseShareBundle } from '../src/domain/share-bundle.ts'
import { parseSongPackage } from '../src/domain/song-package.ts'

const songFixture = async () => parseSongPackage(JSON.parse(await readFile(new URL('../src/domain/fixtures/shared-timing.song-package.json', import.meta.url), 'utf8')))

test('creates a portable share for one song with multiple difficulties', async () => {
  const song = await songFixture()
  const bundle = createShareBundle({ id: 'share-1', title: 'Shared song', songs: [song], createdAt: '2026-07-12T00:00:00.000Z' })
  assert.equal(bundle.kind, 'song')
  assert.equal(bundle.songs[0].beatmaps.length, 2)
  assert.equal(JSON.stringify(bundle).includes('audioId'), false)
})

test('creates a mixtape from multiple songs', async () => {
  const song = await songFixture()
  const second = { ...song, id: 'second-package', song: { ...song.song, id: 'second-song', title: 'Second song' } }
  const bundle = createShareBundle({ id: 'mix-1', title: 'Mixtape', songs: [song, second], createdAt: '2026-07-12T00:00:00.000Z' })
  assert.equal(bundle.kind, 'mixtape')
  assert.equal(bundle.songs.length, 2)
})

test('rejects malformed bundle kinds and duplicate songs', async () => {
  const song = await songFixture()
  const base = createShareBundle({ id: 'share-1', title: 'Shared song', songs: [song], createdAt: '2026-07-12T00:00:00.000Z' })
  assert.throws(() => parseShareBundle({ ...base, kind: 'mixtape' }), /at least two songs/)
  assert.throws(() => parseShareBundle({ ...base, kind: 'mixtape', songs: [song, song] }), /unique/)
})

test('revalidates nested song packages and rejects audio data', async () => {
  const song = await songFixture()
  const bundle = createShareBundle({ id: 'share-1', title: 'Shared song', songs: [song], createdAt: '2026-07-12T00:00:00.000Z' })
  const unsafe = structuredClone(bundle) as unknown as { songs: Array<Record<string, unknown>> }
  unsafe.songs[0].audioData = 'copyrighted bytes'
  assert.throws(() => parseShareBundle(unsafe), /not portable/)
})
