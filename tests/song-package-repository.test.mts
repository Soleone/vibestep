import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { parseSongPackage, type SongPackage } from '../src/domain/song-package.ts'
import { createIndexedDBSongPackageRepository, createLocalStorageSongPackageRepository } from '../src/storage/song-package-repository.ts'

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, String(value)) }
}

async function fixture(): Promise<SongPackage> {
  const serialized = await readFile(new URL('../src/domain/fixtures/shared-timing.song-package.json', import.meta.url), 'utf8')
  return parseSongPackage(JSON.parse(serialized))
}

function repository(factory: IDBFactory, storage: Storage | null, databaseName: string) {
  return createIndexedDBSongPackageRepository({ indexedDB: factory, legacyStorage: storage, databaseName })
}

test('migrates the localStorage library and reconciles writes from an older open tab', async () => {
  const storage = new MemoryStorage()
  const songPackage = await fixture()
  const legacy = createLocalStorageSongPackageRepository(storage)
  const association = { audioId: 'audio-1', storage: 'companion' as const, sourceUrl: 'https://example.com/song', updatedAt: '2026-07-17T00:00:00.000Z' }
  await legacy.put(songPackage)
  await legacy.setAudioAssociation(songPackage.id, association)

  const factory = new IDBFactory()
  const migrated = repository(factory, storage, 'migration-test')
  assert.deepEqual(await migrated.get(songPackage.id), songPackage)
  assert.deepEqual(await migrated.getAudioAssociation(songPackage.id), association)
  assert.deepEqual(await legacy.get(songPackage.id), songPackage)

  const laterPackage = { ...songPackage, id: 'added-after-migration', song: { ...songPackage.song, id: 'added-after-migration' } }
  await legacy.put(laterPackage)
  const reopened = repository(factory, storage, 'migration-test')
  assert.deepEqual(await reopened.get(laterPackage.id), laterPackage)
})

test('preserves repository semantics and portable package export/import compatibility', async () => {
  const songPackage = await fixture()
  const factory = new IDBFactory()
  const source = repository(factory, null, 'source-library')
  await source.put(songPackage)

  assert.deepEqual(await source.list(), [{
    id: songPackage.id,
    title: songPackage.song.title,
    durationMs: songPackage.song.durationMs,
    updatedAt: songPackage.updatedAt,
    beatmapCount: songPackage.beatmaps.length,
  }])

  const exported = JSON.stringify(await source.get(songPackage.id))
  const importedPackage = parseSongPackage(JSON.parse(exported))
  const destination = repository(factory, null, 'destination-library')
  await destination.put(importedPackage)
  assert.deepEqual(await destination.get(songPackage.id), songPackage)

  await destination.setAudioAssociation(songPackage.id, { audioId: 'browser-audio', storage: 'browser', updatedAt: '2026-07-17T01:00:00.000Z' })
  await destination.delete(songPackage.id)
  assert.equal(await destination.get(songPackage.id), null)
  assert.equal(await destination.getAudioAssociation(songPackage.id), null)
  assert.deepEqual(await destination.list(), [])
})

test('recovers valid package records missing from a stale localStorage index', async () => {
  const storage = new MemoryStorage()
  const songPackage = await fixture()
  await createLocalStorageSongPackageRepository(storage).put(songPackage)
  storage.removeItem('beat-fiend:packages:index:v1')

  const migrated = repository(new IDBFactory(), storage, 'stale-index-test')
  assert.deepEqual(await migrated.get(songPackage.id), songPackage)
})

test('retries migration after a transient legacy storage failure', async () => {
  class FailingStorage extends MemoryStorage {
    #shouldFail = true
    override get length() {
      if (this.#shouldFail) {
        this.#shouldFail = false
        throw new Error('storage temporarily unavailable')
      }
      return super.length
    }
  }

  const storage = new FailingStorage()
  const songPackage = await fixture()
  await createLocalStorageSongPackageRepository(storage).put(songPackage)
  const factory = new IDBFactory()
  await assert.rejects(repository(factory, storage, 'retry-test').list(), /temporarily unavailable/)

  const retried = repository(factory, storage, 'retry-test')
  assert.deepEqual(await retried.get(songPackage.id), songPackage)
})
