import { ChartNoAxesCombined, Download, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { appBrand } from '../branding'
import { createPerformanceHistoryTransfer, parsePerformanceHistoryTransfer } from '../domain/performance-history-transfer'
import type { PlayRun } from '../game/run-history'
import { Badge, Button } from './ui'
import { ConfigSection } from './ConfigSection'

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

type PerformanceHistoryTransferProps = {
  runs: PlayRun[]
  storageError?: string | null
  snapshotRuns: () => Promise<PlayRun[]>
  importRuns: (runs: PlayRun[]) => Promise<void>
}

export function PerformanceHistoryTransfer({ runs, storageError, snapshotRuns, importRuns }: PerformanceHistoryTransferProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const exportHistory = useCallback(async () => {
    setBusy(true)
    try {
      const storedRuns = await snapshotRuns()
      const backup = createPerformanceHistoryTransfer(storedRuns)
      downloadJson(backup, `${appBrand.slug}-performance-history-${new Date().toISOString().slice(0, 10)}.json`)
      setStatus(`Exported ${storedRuns.length} run${storedRuns.length === 1 ? '' : 's'}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not export performance history')
    } finally {
      setBusy(false)
    }
  }, [snapshotRuns])

  const importHistory = useCallback(async (file: File) => {
    setBusy(true)
    try {
      const backup = parsePerformanceHistoryTransfer(JSON.parse(await file.text()))
      const existingRuns = await snapshotRuns()
      const existingIds = new Set(existingRuns.map((run) => run.id))
      const replacementCount = backup.runs.filter((run) => existingIds.has(run.id)).length
      if (replacementCount > 0 && !window.confirm(`Replace ${replacementCount} existing run${replacementCount === 1 ? '' : 's'} with the imported copies?`)) {
        setStatus('Import cancelled')
        return
      }
      await importRuns(backup.runs)
      setStatus(`Imported ${backup.runs.length} run${backup.runs.length === 1 ? '' : 's'}${replacementCount > 0 ? `, replaced ${replacementCount}` : ''}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not import performance history')
    } finally {
      setBusy(false)
    }
  }, [importRuns, snapshotRuns])

  return <ConfigSection className="library-transfer-card" icon={<ChartNoAxesCombined />} title="Performance history" description="Back up or restore your personal run and note-timing data separately from beatmaps." status={<Badge tone={storageError ? 'danger' : 'muted'}>{runs.length} run{runs.length === 1 ? '' : 's'}</Badge>}>
    <div className="library-transfer-card__details"><Badge tone="muted">Personal data</Badge><span className="library-transfer-card__detail-copy">Includes run results, timing deltas, note revisions, and interrupted runs. It does not include songs, beatmaps, or audio.</span></div>
    <div className="library-transfer-card__actions">
      <Button type="button" variant="secondary" className="library-transfer-action" onClick={() => void exportHistory()} disabled={busy || runs.length === 0}><span className="library-transfer-action__icon"><Download /></span><span className="library-transfer-action__copy"><strong>Export performance history</strong><small>Download a separate analytics backup</small></span></Button>
      <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importHistory(file); event.currentTarget.value = '' }} />
      <Button type="button" variant="secondary" className="library-transfer-action" onClick={() => inputRef.current?.click()} disabled={busy}><span className="library-transfer-action__icon"><Upload /></span><span className="library-transfer-action__copy"><strong>Import performance history</strong><small>Merge a performance backup into this browser</small></span></Button>
    </div>
    {(storageError || status) && <p className={`import-status${storageError ? ' import-status--error' : ''}`}>{storageError || status}</p>}
  </ConfigSection>
}
