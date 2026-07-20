import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mediaDurationMs } from '../src/audio/media-duration.ts'
import { parseBuiltInSongDraft } from '../src/builtin-songs/catalog.ts'
import { parseSongPackage } from '../src/domain/song-package.ts'
import { acquireAudio, createStarterMetadata, inferArtistAndTitle, parseIntakeArguments, songSlug } from '../scripts/intake-builtin-song.mts'
import { mergePublishedPackage, packagesFromExport } from '../scripts/publish-builtin-map.mts'

async function fixture() {
  return parseSongPackage(JSON.parse(await readFile(new URL('../src/domain/fixtures/shared-timing.song-package.json', import.meta.url), 'utf8')))
}

test('infers intake identity and accepts a direct URL as the positional source', () => {
  assert.deepEqual(inferArtistAndTitle('Example Artist - Fast Track.mp3'), { artist: 'Example Artist', title: 'Fast Track' })
  assert.deepEqual(inferArtistAndTitle('Only_A_Title.ogg'), { artist: '', title: 'Only A Title' })
  assert.equal(songSlug('Beyoncé', 'Déjà Vu'), 'beyonce-deja-vu')
  assert.deepEqual(parseIntakeArguments(['https://audio.example/track', '--artist', 'Artist', '--title', 'Track', '--source-url', 'https://artist.example/track', '--license', 'cc0', '--yes']), {
    source: 'https://audio.example/track', artist: 'Artist', title: 'Track', sourceUrl: 'https://artist.example/track', license: 'cc0', bpm: 120, yes: true,
  })
})

test('downloads a remote audio URL without a filename extension using Content-Type', async () => {
  const bytes = Buffer.from('audio fixture bytes')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': bytes.byteLength })
    response.end(bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address')
  const directory = await mkdtemp(join(tmpdir(), 'vibestep-intake-test-'))
  try {
    const acquired = await acquireAudio(`http://127.0.0.1:${address.port}/download`, directory)
    assert.equal(acquired.extension, '.mp3')
    assert.equal(acquired.contentType, 'audio/mpeg')
    assert.deepEqual(await readFile(acquired.path), bytes)
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('creates a valid attributed starter package with an editable empty map', () => {
  const metadata = createStarterMetadata({
    id: 'artist-track', artist: 'Artist', title: 'Track', sourceUrl: 'https://artist.example/track', licenseKey: 'cc0', durationMs: 0, bpm: 128, now: '2026-07-20T00:00:00.000Z',
  })
  const draft = parseBuiltInSongDraft(metadata)
  assert.equal(draft.songPackage.song.artist, 'Artist')
  assert.equal(draft.songPackage.beatmaps[0].id, 'draft')
  assert.deepEqual(draft.songPackage.beatmaps[0].notes, [])
  assert.equal(draft.songPackage.song.durationMs, 0)
  assert.equal(draft.songPackage.beatmaps[0].durationMs, 0)
  assert.equal(draft.songPackage.timingProfiles[0].bpm, 128)
  assert.equal(draft.license.attribution, 'Track by Artist')
})

test('normalizes authoritative browser media duration', () => {
  assert.equal(mediaDurationMs(123.4564), 123_456)
  assert.equal(mediaDurationMs(Number.NaN), null)
  assert.equal(mediaDurationMs(0), null)
})

test('publishes an exported map while removing the untouched starter map', async () => {
  const incoming = await fixture()
  const current = parseSongPackage({
    ...incoming,
    beatmaps: [{ ...incoming.beatmaps[0], id: 'draft', title: 'Draft', notes: [], version: 0 }],
  })
  const merged = mergePublishedPackage(current, incoming)
  assert.equal(merged.beatmaps.some((map) => map.id === 'draft'), false)
  assert.deepEqual(merged.beatmaps, incoming.beatmaps)

  const exported = packagesFromExport({
    format: 'share-bundle', version: 1, id: 'share-1', title: 'Map', kind: 'song', createdAt: '2026-07-20T00:00:00.000Z', songs: [incoming],
  })
  assert.deepEqual(exported, [incoming])
})
