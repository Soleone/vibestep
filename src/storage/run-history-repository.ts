import { parsePlayRun } from '../domain/performance-history-transfer'
import type { PlayRun } from '../game/run-history'

const DATABASE_NAME = 'vibestep-run-history'
const DATABASE_VERSION = 1
const RUNS_STORE = 'runs'
const SONG_BEATMAP_INDEX = 'by-song-beatmap'
const STARTED_AT_INDEX = 'by-started-at'

export interface RunHistoryRepository {
  list(): Promise<PlayRun[]>
  put(run: PlayRun): Promise<void>
  putMany(runs: PlayRun[]): Promise<void>
  delete(id: string): Promise<void>
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(RUNS_STORE)
        ? request.transaction?.objectStore(RUNS_STORE)
        : database.createObjectStore(RUNS_STORE, { keyPath: 'id' })
      if (store && !store.indexNames.contains(SONG_BEATMAP_INDEX)) store.createIndex(SONG_BEATMAP_INDEX, ['songId', 'beatmapId'])
      if (store && !store.indexNames.contains(STARTED_AT_INDEX)) store.createIndex(STARTED_AT_INDEX, 'startedAt')
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open performance history storage'))
    request.onblocked = () => reject(new Error('Performance history storage upgrade is blocked by another app tab'))
  })
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Performance history storage failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Performance history storage was cancelled'))
  })
}

function readRequest<T>(request: IDBRequest<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(message))
  })
}

export function createIndexedDbRunHistoryRepository(factory: IDBFactory = indexedDB): RunHistoryRepository {
  return {
    async list() {
      const database = await openDatabase(factory)
      try {
        const transaction = database.transaction(RUNS_STORE, 'readonly')
        const storedRuns = await readRequest(transaction.objectStore(RUNS_STORE).getAll(), 'Could not read performance history')
        return storedRuns.map((run, index) => parsePlayRun(run, `storedRuns[${index}]`)).toSorted((a, b) => a.startedAt.localeCompare(b.startedAt))
      } finally {
        database.close()
      }
    },
    async put(run) {
      const validated = parsePlayRun(run)
      const database = await openDatabase(factory)
      try {
        const transaction = database.transaction(RUNS_STORE, 'readwrite')
        transaction.objectStore(RUNS_STORE).put(validated)
        await completeTransaction(transaction)
      } finally {
        database.close()
      }
    },
    async putMany(runs) {
      const validatedRuns = runs.map((run, index) => parsePlayRun(run, `runs[${index}]`))
      const database = await openDatabase(factory)
      try {
        const transaction = database.transaction(RUNS_STORE, 'readwrite')
        const store = transaction.objectStore(RUNS_STORE)
        validatedRuns.forEach((run) => store.put(run))
        await completeTransaction(transaction)
      } finally {
        database.close()
      }
    },
    async delete(id) {
      const database = await openDatabase(factory)
      try {
        const transaction = database.transaction(RUNS_STORE, 'readwrite')
        transaction.objectStore(RUNS_STORE).delete(id)
        await completeTransaction(transaction)
      } finally {
        database.close()
      }
    },
  }
}
