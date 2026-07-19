import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createLibraryBackup, LIBRARY_BACKUP_FORMAT, LIBRARY_BACKUP_VERSION, parseLibraryBackup } from '../src/domain/library-backup.ts'
import { parseSongPackage } from '../src/domain/song-package.ts'

const fixture = parseSongPackage(JSON.parse(readFileSync(new URL('../src/domain/fixtures/shared-timing.song-package.json', import.meta.url), 'utf8')))
const exportedAt = '2026-07-19T00:00:00.000Z'

test('round trips a brand-neutral library backup', () => {
  const backup = createLibraryBackup([fixture], exportedAt)
  assert.equal(backup.format, LIBRARY_BACKUP_FORMAT)
  assert.equal(backup.version, LIBRARY_BACKUP_VERSION)
  assert.equal('schema' in backup, false)
  assert.equal('schemaVersion' in backup, false)
  assert.deepEqual(parseLibraryBackup(JSON.parse(JSON.stringify(backup))), backup)
})

test('rejects unsupported and malformed library backups', () => {
  const backup = createLibraryBackup([fixture], exportedAt)
  assert.throws(() => parseLibraryBackup({ ...backup, version: 2 }), /Unsupported library backup version/)
  assert.throws(() => parseLibraryBackup({ ...backup, packages: null }), /has no packages/)
  assert.throws(() => parseLibraryBackup({ ...backup, exportedAt: 'yesterday' }), /ISO timestamp/)
})
