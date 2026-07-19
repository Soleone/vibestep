import { parseSongPackage, type SongPackage } from '../domain/song-package.ts'

const INDEX_KEY = 'vibestep:packages:index:v1'
const PACKAGE_PREFIX = 'vibestep:packages:item:v1:'
const AUDIO_PREFIX = 'vibestep:packages:audio:v1:'

const DATABASE_NAME = 'vibestep'
const DATABASE_VERSION = 1
const PACKAGE_STORE = 'song-packages'
const AUDIO_STORE = 'audio-associations'
const METADATA_STORE = 'metadata'
const LOCAL_STORAGE_MIGRATION_KEY = 'local-storage-packages-v1'

export type SongPackageSummary = {
  id: string
  title: string
  artist?: string
  durationMs?: number
  updatedAt: string
  beatmapCount: number
}

export type AudioAssociation = {
  audioId: string
  storage?: 'companion' | 'browser'
  sourceUrl?: string
  updatedAt: string
}

type StoredAudioAssociation = AudioAssociation & { packageId: string }
type RepositoryMetadata = { key: string; completedAt: string }

export interface SongPackageRepository {
  list(): Promise<SongPackageSummary[]>
  get(id: string): Promise<SongPackage | null>
  put(songPackage: SongPackage): Promise<void>
  delete(id: string): Promise<void>
  getAudioAssociation(packageId: string): Promise<AudioAssociation | null>
  setAudioAssociation(packageId: string, association: AudioAssociation): Promise<void>
}

export type IndexedDBSongPackageRepositoryOptions = {
  indexedDB?: IDBFactory
  legacyStorage?: Storage | null
  databaseName?: string
}

const packageKey = (id: string) => `${PACKAGE_PREFIX}${encodeURIComponent(id)}`
const audioKey = (id: string) => `${AUDIO_PREFIX}${encodeURIComponent(id)}`

function summaryOf(songPackage: SongPackage): SongPackageSummary {
  return { id: songPackage.id, title: songPackage.song.title, ...(songPackage.song.artist ? { artist: songPackage.song.artist } : {}), ...(songPackage.song.durationMs !== undefined ? { durationMs: songPackage.song.durationMs } : {}), updatedAt: songPackage.updatedAt, beatmapCount: songPackage.beatmaps.length }
}

function readIndex(storage: Storage): SongPackageSummary[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SongPackageSummary => typeof item === 'object' && item !== null && typeof (item as SongPackageSummary).id === 'string' && typeof (item as SongPackageSummary).title === 'string')
  } catch {
    return []
  }
}

function parseAudioAssociation(value: unknown): AudioAssociation | null {
  if (typeof value !== 'object' || value === null) return null
  const association = value as Partial<AudioAssociation>
  if (typeof association.audioId !== 'string' || !association.audioId || typeof association.updatedAt !== 'string') return null
  if (association.storage !== undefined && association.storage !== 'companion' && association.storage !== 'browser') return null
  if (association.sourceUrl !== undefined && typeof association.sourceUrl !== 'string') return null
  return {
    audioId: association.audioId,
    ...(association.storage ? { storage: association.storage } : {}),
    ...(association.sourceUrl ? { sourceUrl: association.sourceUrl } : {}),
    updatedAt: association.updatedAt,
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PACKAGE_STORE)) database.createObjectStore(PACKAGE_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(AUDIO_STORE)) database.createObjectStore(AUDIO_STORE, { keyPath: 'packageId' })
      if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'))
    // A blocked upgrade can continue after another tab closes its old connection.
    request.onblocked = () => undefined
  })
}

function legacyPackageIds(storage: Storage): Set<string> {
  const ids = new Set(readIndex(storage).map((item) => item.id))
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(PACKAGE_PREFIX)) continue
    try {
      ids.add(decodeURIComponent(key.slice(PACKAGE_PREFIX.length)))
    } catch {
      // Leave malformed legacy keys untouched.
    }
  }
  return ids
}

function readLegacyPackage(storage: Storage, id: string): SongPackage | null {
  const serialized = storage.getItem(packageKey(id))
  if (!serialized) return null
  try {
    return parseSongPackage(JSON.parse(serialized))
  } catch {
    return null
  }
}

function readLegacyAudioAssociation(storage: Storage, id: string): AudioAssociation | null {
  const serialized = storage.getItem(audioKey(id))
  if (!serialized) return null
  try {
    return parseAudioAssociation(JSON.parse(serialized))
  } catch {
    return null
  }
}

async function migrateLocalStorage(database: IDBDatabase, storage: Storage | null): Promise<void> {
  const transaction = database.transaction([PACKAGE_STORE, AUDIO_STORE, METADATA_STORE], 'readwrite')
  const completed = transactionComplete(transaction)
  const packages = transaction.objectStore(PACKAGE_STORE)
  const audio = transaction.objectStore(AUDIO_STORE)
  const metadata = transaction.objectStore(METADATA_STORE)

  try {
    const previousMigration = await requestResult(metadata.get(LOCAL_STORAGE_MIGRATION_KEY)) as RepositoryMetadata | undefined
    if (storage) {
      for (const legacyId of legacyPackageIds(storage)) {
        const songPackage = readLegacyPackage(storage, legacyId)
        if (!songPackage) continue
        const existingPackage = await requestResult(packages.get(songPackage.id)) as SongPackage | undefined
        if (!existingPackage || songPackage.updatedAt > existingPackage.updatedAt) packages.put(songPackage)

        const association = readLegacyAudioAssociation(storage, legacyId)
        const existingAssociation = await requestResult(audio.get(songPackage.id)) as StoredAudioAssociation | undefined
        if (association && (!existingAssociation || association.updatedAt > existingAssociation.updatedAt)) {
          audio.put({ packageId: songPackage.id, ...association } satisfies StoredAudioAssociation)
        }
      }
    }

    if (!previousMigration) metadata.put({ key: LOCAL_STORAGE_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies RepositoryMetadata)
    await completed
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // The transaction may already have aborted because of the failed request.
    }
    await completed.catch(() => undefined)
    throw error
  }
}

function resolveLegacyStorage(storage: Storage | null | undefined): Storage | null {
  if (storage !== undefined) return storage
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function createIndexedDBSongPackageRepository(options: IndexedDBSongPackageRepositoryOptions = {}): SongPackageRepository {
  const factory = options.indexedDB ?? globalThis.indexedDB
  if (!factory) throw new Error('IndexedDB is not available in this browser')
  const legacyStorage = resolveLegacyStorage(options.legacyStorage)
  const initialized = openDatabase(factory, options.databaseName ?? DATABASE_NAME).then(async (database) => {
    await migrateLocalStorage(database, legacyStorage)
    return database
  })

  return {
    async list() {
      const database = await initialized
      const values = await requestResult(database.transaction(PACKAGE_STORE).objectStore(PACKAGE_STORE).getAll())
      return values.map(parseSongPackage).map(summaryOf).toSorted((a, b) => a.title.localeCompare(b.title))
    },
    async get(id) {
      const database = await initialized
      const value = await requestResult(database.transaction(PACKAGE_STORE).objectStore(PACKAGE_STORE).get(id))
      return value === undefined ? null : parseSongPackage(value)
    },
    async put(songPackage) {
      const validated = parseSongPackage(songPackage)
      const database = await initialized
      const transaction = database.transaction(PACKAGE_STORE, 'readwrite')
      const completed = transactionComplete(transaction)
      transaction.objectStore(PACKAGE_STORE).put(validated)
      await completed
    },
    async delete(id) {
      const database = await initialized
      const transaction = database.transaction([PACKAGE_STORE, AUDIO_STORE], 'readwrite')
      const completed = transactionComplete(transaction)
      transaction.objectStore(PACKAGE_STORE).delete(id)
      transaction.objectStore(AUDIO_STORE).delete(id)
      await completed
      try {
        legacyStorage?.removeItem(packageKey(id))
        legacyStorage?.removeItem(audioKey(id))
      } catch {
        // IndexedDB is authoritative after migration, so legacy cleanup is best effort.
      }
    },
    async getAudioAssociation(packageId) {
      const database = await initialized
      const value = await requestResult(database.transaction(AUDIO_STORE).objectStore(AUDIO_STORE).get(packageId)) as StoredAudioAssociation | undefined
      if (!value) return null
      return parseAudioAssociation(value)
    },
    async setAudioAssociation(packageId, association) {
      const validated = parseAudioAssociation(association)
      if (!validated) throw new Error('Missing or invalid companion audio association')
      const database = await initialized
      const transaction = database.transaction(AUDIO_STORE, 'readwrite')
      const completed = transactionComplete(transaction)
      transaction.objectStore(AUDIO_STORE).put({ packageId, ...validated } satisfies StoredAudioAssociation)
      await completed
    },
  }
}

export function createLocalStorageSongPackageRepository(storage: Storage = localStorage): SongPackageRepository {
  return {
    async list() {
      return readIndex(storage).toSorted((a, b) => a.title.localeCompare(b.title))
    },
    async get(id) {
      const serialized = storage.getItem(packageKey(id))
      if (!serialized) return null
      return parseSongPackage(JSON.parse(serialized))
    },
    async put(songPackage) {
      const validated = parseSongPackage(songPackage)
      storage.setItem(packageKey(validated.id), JSON.stringify(validated))
      const next = readIndex(storage).filter((item) => item.id !== validated.id)
      next.push(summaryOf(validated))
      storage.setItem(INDEX_KEY, JSON.stringify(next))
    },
    async delete(id) {
      storage.removeItem(packageKey(id))
      storage.removeItem(audioKey(id))
      storage.setItem(INDEX_KEY, JSON.stringify(readIndex(storage).filter((item) => item.id !== id)))
    },
    async getAudioAssociation(packageId) {
      try {
        return parseAudioAssociation(JSON.parse(storage.getItem(audioKey(packageId)) ?? 'null'))
      } catch {
        return null
      }
    },
    async setAudioAssociation(packageId, association) {
      const validated = parseAudioAssociation(association)
      if (!validated) throw new Error('Missing or invalid companion audio association')
      storage.setItem(audioKey(packageId), JSON.stringify(validated))
    },
  }
}
