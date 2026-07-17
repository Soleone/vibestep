import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attack, Beatmap } from './model'
import { createPlayRun, summarizeRunNotes, type PlayRun, type RunNoteJudgement } from './run-history'
import type { ParryGrade } from './timing'

export type RecordedRunJudgement = {
  attack: Attack
  grade: ParryGrade
  deltaMs: number | null
}

type ActiveRunIdentity = {
  id: string
  songId: string
  beatmapId: string
}

type UsePlayRunHistoryOptions = {
  songId?: string
  beatmap: Beatmap | null
  bpm: number
  beatOffsetMs: number
}

export function usePlayRunHistory({ songId, beatmap, bpm, beatOffsetMs }: UsePlayRunHistoryOptions) {
  const [runs, setRuns] = useState<PlayRun[]>([])
  const activeRun = useRef<ActiveRunIdentity | null>(null)

  const beginRun = useCallback((startedAtSongTimeMs: number) => {
    if (!beatmap || !songId) return null
    if (activeRun.current?.songId === songId && activeRun.current.beatmapId === beatmap.id) return activeRun.current.id
    const run = createPlayRun({
      id: crypto.randomUUID(),
      songId,
      beatmapId: beatmap.id,
      beatmapVersion: beatmap.version,
      startedAt: new Date().toISOString(),
      startedAtSongTimeMs,
    })
    activeRun.current = { id: run.id, songId: run.songId, beatmapId: run.beatmapId }
    setRuns((currentRuns) => [...currentRuns, run])
    return run.id
  }, [beatmap, songId])

  const finishRun = useCallback(() => {
    const runId = activeRun.current?.id
    if (!runId) return
    activeRun.current = null
    const completedAt = new Date().toISOString()
    setRuns((currentRuns) => currentRuns.flatMap((run) => run.id !== runId ? [run] : run.judgements.length > 0 ? [{ ...run, completedAt }] : []))
  }, [])

  const recordJudgements = useCallback((results: RecordedRunJudgement[], judgedAtSongTimeMs: number) => {
    if (!beatmap || !songId) return
    const judgements = results.flatMap<RunNoteJudgement>(({ attack, grade, deltaMs }) => {
      if (!attack.noteId) return []
      return [{
        id: crypto.randomUUID(),
        noteId: attack.noteId,
        occurrenceKey: attack.scheduleKey ?? attack.noteId,
        lane: attack.lane ?? 'mid',
        noteTimeMs: attack.noteTimeMs ?? 0,
        judgedAtSongTimeMs,
        grade,
        deltaMs,
      }]
    })
    if (judgements.length === 0) return

    let runId = activeRun.current?.songId === songId && activeRun.current.beatmapId === beatmap.id ? activeRun.current.id : null
    let newRun: PlayRun | null = null
    if (!runId) {
      newRun = createPlayRun({
        id: crypto.randomUUID(),
        songId,
        beatmapId: beatmap.id,
        beatmapVersion: beatmap.version,
        startedAt: new Date().toISOString(),
        startedAtSongTimeMs: judgedAtSongTimeMs,
      })
      runId = newRun.id
      activeRun.current = { id: newRun.id, songId: newRun.songId, beatmapId: newRun.beatmapId }
    }
    const targetRunId = runId
    setRuns((currentRuns) => {
      const runsWithTarget = newRun ? [...currentRuns, newRun] : currentRuns
      return runsWithTarget.map((run) => {
        if (run.id !== targetRunId) return run
        const recordedMisses = new Set(run.judgements.filter((judgement) => judgement.grade === 'miss').map((judgement) => judgement.occurrenceKey))
        const newJudgements = judgements.filter((judgement) => judgement.grade !== 'miss' || !recordedMisses.has(judgement.occurrenceKey))
        return newJudgements.length > 0 ? { ...run, judgements: [...run.judgements, ...newJudgements] } : run
      })
    })
  }, [beatmap, songId])

  useEffect(() => {
    if (activeRun.current && (activeRun.current.songId !== songId || activeRun.current.beatmapId !== beatmap?.id)) finishRun()
  }, [beatmap?.id, finishRun, songId])

  useEffect(() => {
    if (activeRun.current) finishRun()
  }, [beatOffsetMs, beatmap?.notes, bpm, finishRun])

  const lastRun = useMemo(() => [...runs].reverse().find((run) => run.songId === songId && run.beatmapId === beatmap?.id) ?? null, [beatmap?.id, runs, songId])
  const lastRunNoteResults = useMemo(() => summarizeRunNotes(lastRun), [lastRun])
  const lastRunCounts = useMemo(() => {
    const counts = { perfect: 0, good: 0, missed: 0 }
    lastRunNoteResults.forEach((result) => {
      if (result.grade === 'perfect') counts.perfect += 1
      else if (result.grade === 'good') counts.good += 1
      else counts.missed += 1
    })
    return counts
  }, [lastRunNoteResults])

  return {
    runs,
    lastRun,
    lastRunNoteResults,
    lastRunCounts,
    beginRun,
    finishRun,
    recordJudgements,
  }
}
