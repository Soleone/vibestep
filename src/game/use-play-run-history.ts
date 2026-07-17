import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunHistoryRepository } from '../storage/run-history-repository'
import type { Attack, Beatmap } from './model'
import { aggregateNoteFeedback, type NoteFeedbackAggregate } from './run-feedback-aggregation'
import { createNoteRevisionKey, createPlayRun, createRunNoteSnapshot, type PlayRun, type RunNoteJudgement } from './run-history'
import type { ParryGrade } from './timing'

export type RecordedRunJudgement = {
  attack: Attack
  grade: ParryGrade
  deltaMs: number | null
}

type ActiveRun = {
  run: PlayRun
}

type UsePlayRunHistoryOptions = {
  songId?: string
  beatmap: Beatmap | null
  bpm: number
  beatOffsetMs: number
  enabled: boolean
  repository: RunHistoryRepository
}

const sortRuns = (runs: PlayRun[]) => runs.toSorted((a, b) => a.startedAt.localeCompare(b.startedAt))

function summarizeFeedback(aggregates: ReadonlyMap<string, NoteFeedbackAggregate>) {
  const summary = {
    notesWithFeedback: aggregates.size,
    repeatedIssues: 0,
    consistentlyEarly: 0,
    consistentlyLate: 0,
    mixedTiming: 0,
    perfectNotes: 0,
    goodNotes: 0,
    needsWorkNotes: 0,
  }
  aggregates.forEach((aggregate) => {
    if (aggregate.direction === 'early') summary.consistentlyEarly += 1
    if (aggregate.direction === 'late') summary.consistentlyLate += 1
    if (aggregate.direction === 'mixed') summary.mixedTiming += 1
    if (aggregate.attemptCount >= 3 && (aggregate.direction === 'early' || aggregate.direction === 'late' || aggregate.direction === 'mixed' || aggregate.direction === 'no-input' || aggregate.missRate >= 0.3)) summary.repeatedIssues += 1
    if (aggregate.latestResult.grade === 'perfect') summary.perfectNotes += 1
    else if (aggregate.latestResult.grade === 'good') summary.goodNotes += 1
    else summary.needsWorkNotes += 1
  })
  return summary
}

export function usePlayRunHistory({ songId, beatmap, bpm, beatOffsetMs, enabled, repository }: UsePlayRunHistoryOptions) {
  const [runs, setRuns] = useState<PlayRun[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)
  const [showLastRunOnly, setShowLastRunOnly] = useState(false)
  const activeRun = useRef<ActiveRun | null>(null)
  const stateRevision = useRef(0)
  const operationQueue = useRef<Promise<void>>(Promise.resolve())

  const enqueueOperation = useCallback(function enqueueOperation<T>(operation: () => Promise<T>) {
    const result = operationQueue.current.then(operation)
    operationQueue.current = result.then(
      () => undefined,
      (error: unknown) => {
        setStorageError(error instanceof Error ? error.message : 'Performance history storage failed')
      },
    )
    return result.then((value) => {
      setStorageError(null)
      return value
    })
  }, [])

  const persist = useCallback((operation: () => Promise<void>) => {
    void enqueueOperation(operation).catch(() => undefined)
  }, [enqueueOperation])

  useEffect(() => {
    const revisionAtStart = stateRevision.current
    void enqueueOperation(() => repository.list()).then((storedRuns) => {
      setRuns((currentRuns) => {
        if (stateRevision.current === revisionAtStart) return storedRuns
        const currentIds = new Set(currentRuns.map((run) => run.id))
        return sortRuns([...storedRuns.filter((run) => !currentIds.has(run.id)), ...currentRuns])
      })
    }).catch(() => undefined)
  }, [enqueueOperation, repository])

  const beginRun = useCallback((startedAtSongTimeMs: number) => {
    if (!enabled || !beatmap || !songId) return null
    const active = activeRun.current?.run
    if (active?.songId === songId && active.beatmapId === beatmap.id) return active.id
    const run = createPlayRun({
      id: crypto.randomUUID(),
      songId,
      beatmapId: beatmap.id,
      beatmapVersion: beatmap.version,
      startedAt: new Date().toISOString(),
      startedAtSongTimeMs,
    })
    activeRun.current = { run }
    stateRevision.current += 1
    setRuns((currentRuns) => [...currentRuns, run])
    return run.id
  }, [beatmap, enabled, songId])

  const finishRun = useCallback(() => {
    const run = activeRun.current?.run
    if (!run) return
    activeRun.current = null
    stateRevision.current += 1
    if (run.judgements.length === 0) {
      setRuns((currentRuns) => currentRuns.filter((candidate) => candidate.id !== run.id))
      return
    }
    const completedRun = { ...run, completedAt: new Date().toISOString() }
    setRuns((currentRuns) => currentRuns.map((candidate) => candidate.id === run.id ? completedRun : candidate))
    persist(() => repository.put(completedRun))
  }, [persist, repository])

  const recordJudgements = useCallback((results: RecordedRunJudgement[], judgedAtSongTimeMs: number) => {
    if (!enabled || !beatmap || !songId) return
    const judgements = results.flatMap<RunNoteJudgement>(({ attack, grade, deltaMs }) => {
      if (!attack.noteId) return []
      const noteSnapshot = createRunNoteSnapshot({ impactTimeMs: attack.noteTimeMs ?? 0, lane: attack.lane ?? 'mid', durationMs: attack.durationMs })
      return [{
        id: crypto.randomUUID(),
        noteId: attack.noteId,
        noteRevisionKey: createNoteRevisionKey(noteSnapshot),
        noteSnapshot,
        occurrenceKey: attack.scheduleKey ?? attack.noteId,
        lane: attack.lane ?? 'mid',
        noteTimeMs: attack.noteTimeMs ?? 0,
        judgedAtSongTimeMs,
        grade,
        deltaMs,
      }]
    })
    if (judgements.length === 0) return

    const active = activeRun.current?.run
    const currentRun = active?.songId === songId && active.beatmapId === beatmap.id
      ? active
      : createPlayRun({
          id: crypto.randomUUID(),
          songId,
          beatmapId: beatmap.id,
          beatmapVersion: beatmap.version,
          startedAt: new Date().toISOString(),
          startedAtSongTimeMs: judgedAtSongTimeMs,
        })
    const recordedMisses = new Set(currentRun.judgements.filter((judgement) => judgement.grade === 'miss').map((judgement) => judgement.occurrenceKey))
    const newJudgements = judgements.filter((judgement) => judgement.grade !== 'miss' || !recordedMisses.has(judgement.occurrenceKey))
    if (newJudgements.length === 0) return
    const updatedRun = { ...currentRun, judgements: [...currentRun.judgements, ...newJudgements] }
    activeRun.current = { run: updatedRun }
    stateRevision.current += 1
    setRuns((currentRuns) => currentRuns.some((run) => run.id === updatedRun.id)
      ? currentRuns.map((run) => run.id === updatedRun.id ? updatedRun : run)
      : [...currentRuns, updatedRun])
    persist(() => repository.put(updatedRun))
  }, [beatmap, enabled, persist, repository, songId])

  useEffect(() => {
    const active = activeRun.current?.run
    if (active && (!enabled || active.songId !== songId || active.beatmapId !== beatmap?.id)) finishRun()
  }, [beatmap?.id, enabled, finishRun, songId])

  useEffect(() => {
    if (activeRun.current) finishRun()
  }, [beatOffsetMs, beatmap?.notes, bpm, finishRun])

  const snapshotRuns = useCallback(() => enqueueOperation(() => repository.list()), [enqueueOperation, repository])
  const importRuns = useCallback(async (importedRuns: PlayRun[]) => {
    finishRun()
    await enqueueOperation(() => repository.putMany(importedRuns))
    const importedIds = new Set(importedRuns.map((run) => run.id))
    stateRevision.current += 1
    setRuns((currentRuns) => sortRuns([...currentRuns.filter((run) => !importedIds.has(run.id)), ...importedRuns]))
  }, [enqueueOperation, finishRun, repository])
  const deleteRun = useCallback(async (runId: string) => {
    if (activeRun.current?.run.id === runId) activeRun.current = null
    await enqueueOperation(() => repository.delete(runId))
    stateRevision.current += 1
    setRuns((currentRuns) => currentRuns.filter((run) => run.id !== runId))
  }, [enqueueOperation, repository])

  const matchingRuns = useMemo(() => sortRuns(runs.filter((run) => run.songId === songId && run.beatmapId === beatmap?.id)), [beatmap?.id, runs, songId])
  const lastRun = matchingRuns.at(-1) ?? null
  const noteFeedbackAggregates = useMemo(() => aggregateNoteFeedback(matchingRuns, beatmap?.notes ?? []), [beatmap?.notes, matchingRuns])
  const lastRunFeedbackAggregates = useMemo(() => aggregateNoteFeedback(lastRun ? [lastRun] : [], beatmap?.notes ?? []), [beatmap?.notes, lastRun])
  const displayedFeedbackAggregates = showLastRunOnly ? lastRunFeedbackAggregates : noteFeedbackAggregates
  const feedbackSummary = useMemo(() => summarizeFeedback(displayedFeedbackAggregates), [displayedFeedbackAggregates])

  return {
    runs,
    lastRun,
    displayedFeedbackAggregates,
    feedbackSummary,
    showLastRunOnly,
    setShowLastRunOnly,
    storageError,
    beginRun,
    finishRun,
    recordJudgements,
    snapshotRuns,
    importRuns,
    deleteRun,
  }
}
