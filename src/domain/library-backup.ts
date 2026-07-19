import { parseSongPackage, type SongPackage } from './song-package.ts'

export const LIBRARY_BACKUP_FORMAT = 'library-backup' as const
export const LIBRARY_BACKUP_VERSION = 1 as const

export type LibraryBackup = {
  format: typeof LIBRARY_BACKUP_FORMAT
  version: typeof LIBRARY_BACKUP_VERSION
  exportedAt: string
  packages: SongPackage[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function parseExportedAt(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Library backup exportedAt must be an ISO timestamp')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error('Library backup exportedAt must be an ISO timestamp')
  return value
}

export function createLibraryBackup(packages: SongPackage[], exportedAt = new Date().toISOString()): LibraryBackup {
  return parseLibraryBackup({
    format: LIBRARY_BACKUP_FORMAT,
    version: LIBRARY_BACKUP_VERSION,
    exportedAt,
    packages,
  })
}

export function parseLibraryBackup(value: unknown): LibraryBackup {
  if (!isRecord(value) || value.format !== LIBRARY_BACKUP_FORMAT) throw new Error('Not a valid library backup')
  if (value.version !== LIBRARY_BACKUP_VERSION) throw new Error(`Unsupported library backup version: ${String(value.version)}`)
  if (!Array.isArray(value.packages)) throw new Error('Library backup has no packages')
  return {
    format: LIBRARY_BACKUP_FORMAT,
    version: LIBRARY_BACKUP_VERSION,
    exportedAt: parseExportedAt(value.exportedAt),
    packages: value.packages.map(parseSongPackage),
  }
}
