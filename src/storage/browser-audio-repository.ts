const DATABASE_NAME = 'beat-fiend-audio'
const DATABASE_VERSION = 1
const STORE_NAME = 'audio'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open browser audio storage'))
  })
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser audio storage failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser audio storage was cancelled'))
  })
}

export async function putBrowserAudio(id: string, blob: Blob): Promise<void> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(blob, id)
    await completeTransaction(transaction)
  } finally {
    database.close()
  }
}

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  try {
    return await navigator.storage?.persist?.() ?? false
  } catch {
    return false
  }
}

export async function getBrowserAudio(id: string): Promise<Blob | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(id)
    const result = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not read browser audio'))
    })
    return result instanceof Blob ? result : null
  } finally {
    database.close()
  }
}
