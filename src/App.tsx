import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react'
import './App.css'
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Disclosure, DisclosureSummary, Field, FieldLabel, Input, Select, Slider, Stack, Tabs, TabsList, TabsTrigger } from './components/ui'
import { Toolbar } from './components/Toolbar'
import { EditorTimeline } from './editor/EditorTimeline'
import { Arena } from './game/Arena'
import { HitNotify } from './game/HitNotify'
import { judgeParryTiming, type ParryTimingResult } from './game/timing'
import {
  beatOffsetStorageKey,
  bpmStorageKey,
  defaultControls,
  gamepadButtonLabels,
  initialTuning,
  laneColor,
  lanes,
  makeBeatmapAttack,
  makeIdlePattern,
  normalizeBeatmap,
  readStoredNumber,
  timelineLaneAreaHeightPx,
  timelineLaneTopPx,
  type Attack,
  type Beatmap,
  type BeatmapNote,
  type FeedbackEvent,
  type GridDivision,
  type ImportResult,
  type Lane,
  type LaneControls,
  type LoopMarkers,
  type PlayStats,
  type SavedBeatmap,
  type Tuning,
} from './game/model'

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"]'))
}

function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]'))
}

function App() {
  const [tuning, setTuning] = useState<Tuning>(initialTuning)
  const [activeAttacks, setActiveAttacks] = useState<Attack[]>(() => makeIdlePattern())
  const [lastResult, setLastResult] = useState<ParryTimingResult | null>(null)
  const [lastAutoMiss, setLastAutoMiss] = useState(false)
  const [parryPulse, setParryPulse] = useState(0)
  const [feedback, setFeedback] = useState<FeedbackEvent | null>(null)
  const [phase, setPhase] = useState('queued')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importedSong, setImportedSong] = useState<ImportResult | null>(null)
  const [beatmap, setBeatmap] = useState<Beatmap | null>(null)
  const [savedImports, setSavedImports] = useState<ImportResult[]>([])
  const [isSongPlaying, setIsSongPlaying] = useState(false)
  const [armedLanes, setArmedLanes] = useState<Set<BeatmapNote['lane']>>(() => new Set(lanes))
  const [recordMode, setRecordMode] = useState<'add' | 'replace'>('add')
  const [isRecording, setIsRecording] = useState(false)
  const [recordStartMs, setRecordStartMs] = useState(0)
  const [recordedNotes, setRecordedNotes] = useState<BeatmapNote[]>([])
  const [songBeatmaps, setSongBeatmaps] = useState<SavedBeatmap[]>([])
  const [mapTitle, setMapTitle] = useState('My beatmap')
  const [difficulty, setDifficulty] = useState(1)
  const [stats, setStats] = useState<PlayStats>({ hit: 0, perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 })
  const [songTimeMs, setSongTimeMs] = useState(0)
  const [activeTab, setActiveTab] = useState<'play' | 'editor' | 'config' | 'debug'>(() => {
    const stored = localStorage.getItem('flow-fight:active-tab')
    return stored === 'play' || stored === 'editor' || stored === 'config' || stored === 'debug' ? stored : 'play'
  })
  const [controls, setControls] = useState<LaneControls>(() => {
    try { return { ...defaultControls, ...JSON.parse(localStorage.getItem('flow-fight:controls') ?? '{}') } }
    catch { return defaultControls }
  })
  const [bpm, setBpm] = useState(120)
  const [beatOffsetMs, setBeatOffsetMs] = useState(0)
  const [tapTimes, setTapTimes] = useState<number[]>([])
  const [tapMode, setTapMode] = useState(false)
  const [quantize, setQuantize] = useState(true)
  const [gridDivision, setGridDivision] = useState<GridDivision>(16)
  const [timelineZoomSeconds, setTimelineZoomSeconds] = useState<number | 'fit'>(30)
  const [timelineCenterMs, setTimelineCenterMs] = useState(0)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [loopMarkers, setLoopMarkers] = useState<LoopMarkers>({ startMs: null, endMs: null })
  const [padTriggers, setPadTriggers] = useState<Record<Lane, number>>({ kick: 0, snare: 0, low: 0, mid: 0, high: 0 })
  const audioRef = useRef<HTMLAudioElement>(null)
  const scheduledNoteIds = useRef(new Set<string>())
  const loopCycle = useRef(0)
  const isLoopSeeking = useRef(false)
  const heldStarts = useRef<Partial<Record<Lane, number>>>({})
  const previousGamepadButtons = useRef(new Set<number>())
  const calibrationHydrated = useRef(false)
  const persistedCalibration = useRef<string | null>(null)
  const restoredSongId = useRef<string | null>(localStorage.getItem('flow-fight:selected-song'))
  const resetScheduledNotes = useCallback(() => {
    scheduledNoteIds.current.clear()
    loopCycle.current += 1
  }, [])

  const loadImports = useCallback(async () => {
    try {
      const response = await fetch('/api/imports')
      const data = await response.json()
      setSavedImports(data.imports ?? [])
    } catch {
      // Import server is optional during plain Vite dev.
    }
  }, [])

  const loadImport = useCallback(async (song: ImportResult) => {
    calibrationHydrated.current = false
    localStorage.setItem('flow-fight:selected-song', song.id)
    setImportedSong(song)
    setSongBeatmaps(song.beatmaps ?? [])
    setImportStatus(`Loading ${song.title}...`)
    try {
      const beatmapResponse = await fetch(song.beatmapUrl)
      if (!beatmapResponse.ok) throw new Error(`Failed to load beatmap ${beatmapResponse.status}`)
      const loadedBeatmap = await beatmapResponse.json()
      const savedSongBpm = readStoredNumber(bpmStorageKey(song.id))
      const savedMapBpm = readStoredNumber(bpmStorageKey(song.id, loadedBeatmap.id))
      const savedSongBeatOffset = readStoredNumber(beatOffsetStorageKey(song.id))
      const savedMapBeatOffset = readStoredNumber(beatOffsetStorageKey(song.id, loadedBeatmap.id))
      setBeatmap(normalizeBeatmap(loadedBeatmap))
      setMapTitle(loadedBeatmap.title ?? song.title)
      setDifficulty(loadedBeatmap.difficulty ?? 1)
      const nextBpm = savedSongBpm && savedSongBpm > 0 ? savedSongBpm : song.bpm && song.bpm > 0 ? song.bpm : savedMapBpm && savedMapBpm > 0 ? savedMapBpm : loadedBeatmap.bpm ?? 120
      const nextBeatOffsetMs = savedSongBeatOffset ?? song.beatOffsetMs ?? savedMapBeatOffset ?? loadedBeatmap.beatOffsetMs ?? 0
      setBpm(nextBpm)
      setBeatOffsetMs(nextBeatOffsetMs)
      persistedCalibration.current = `${song.id}:${nextBpm}:${nextBeatOffsetMs}`
      calibrationHydrated.current = true
      resetScheduledNotes()
      setLoopMarkers({ startMs: null, endMs: null })
      setImportStatus(`Loaded ${song.noteCount} notes from cache`)
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Failed to load song')
    }
  }, [resetScheduledNotes])

  useEffect(() => { void loadImports() }, [loadImports])

  useEffect(() => { localStorage.setItem('flow-fight:active-tab', activeTab) }, [activeTab])

  useEffect(() => {
    const songId = restoredSongId.current
    if (!songId || importedSong || savedImports.length === 0) return
    const song = savedImports.find((item) => item.id === songId)
    if (!song) return
    restoredSongId.current = null
    void loadImport(song)
  }, [importedSong, loadImport, savedImports])

  useEffect(() => { localStorage.setItem('flow-fight:controls', JSON.stringify(controls)) }, [controls])

  useEffect(() => {
    if (!importedSong || !calibrationHydrated.current) return
    localStorage.setItem(bpmStorageKey(importedSong.id) ?? '', String(bpm))
    localStorage.setItem(beatOffsetStorageKey(importedSong.id) ?? '', String(beatOffsetMs))
    if (beatmap?.id) {
      localStorage.setItem(bpmStorageKey(importedSong.id, beatmap.id) ?? '', String(bpm))
      localStorage.setItem(beatOffsetStorageKey(importedSong.id, beatmap.id) ?? '', String(beatOffsetMs))
    }
    setBeatmap((current) => current && (current.bpm !== bpm || current.beatOffsetMs !== beatOffsetMs) ? { ...current, bpm, beatOffsetMs } : current)
    const calibrationKey = `${importedSong.id}:${bpm}:${beatOffsetMs}`
    if (persistedCalibration.current === calibrationKey) return
    const timer = window.setTimeout(() => {
      void fetch(`/api/imports/${importedSong.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bpm, beatOffsetMs }) }).then(() => { persistedCalibration.current = calibrationKey }).catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [beatOffsetMs, beatmap?.id, bpm, importedSong])

  const gridMs = useMemo(() => (60000 / bpm) * (4 / gridDivision), [bpm, gridDivision])
  const keyLane = useMemo(() => Object.fromEntries(lanes.map((lane) => [controls[lane].keyboard, lane])) as Record<string, Lane>, [controls])
  const gamepadLane = useMemo(() => Object.fromEntries(lanes.map((lane) => [controls[lane].gamepadButton, lane])) as Record<number, Lane>, [controls])
  const quantizeTime = useCallback((rawTimeMs: number) => {
    if (!quantize) return rawTimeMs
    const snapped = beatOffsetMs + Math.round((rawTimeMs - beatOffsetMs) / gridMs) * gridMs
    return Math.abs(snapped - rawTimeMs) <= Math.max(35, gridMs * 0.45) ? snapped : rawTimeMs
  }, [beatOffsetMs, gridMs, quantize])

  const nextAttack = useCallback(() => {
    setLastResult(null); setLastAutoMiss(false); setFeedback(null); resetScheduledNotes(); setActiveAttacks(makeIdlePattern())
  }, [resetScheduledNotes])

  const parry = useCallback((lane: BeatmapNote['lane'] = 'mid') => {
    const inputTimeMs = performance.now()
    const laneAttacks = activeAttacks.filter((attack) => (attack.lane ?? 'mid') === lane)
    const target = laneAttacks.reduce<Attack | null>((best, attack) => !best || Math.abs(attack.impactMs - inputTimeMs) < Math.abs(best.impactMs - inputTimeMs) ? attack : best, null)
    if (!target) return
    const result = judgeParryTiming({ inputTimeMs, impactTimeMs: target.impactMs, ...tuning })
    setLastResult(result); setLastAutoMiss(false); setParryPulse(inputTimeMs)
    const kind: FeedbackEvent['kind'] = result.success ? (result.grade === 'perfect' ? 'perfect-parry' : 'good-parry') : 'miss'
    setFeedback({ id: Math.random(), kind, startedAtMs: inputTimeMs, lane })
    if (result.success) {
      setStats((s) => ({ ...s, hit: s.hit + 1, perfect: s.perfect + (result.grade === 'perfect' ? 1 : 0), good: s.good + (result.grade === 'good' ? 1 : 0), streak: s.streak + 1, bestStreak: Math.max(s.bestStreak, s.streak + 1) }))
      setActiveAttacks((attacks) => attacks.filter((attack) => attack.id !== target.id))
    }
  }, [activeAttacks, tuning])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const lane = keyLane[event.code]
      if (isTextEditingTarget(event.target) || (!isRecording && isEditingTarget(event.target))) return
      if (activeTab === 'editor' && event.code === 'Space' && !isRecording && !tapMode) return
      if (lane) {
        event.preventDefault()
        if (event.repeat) return
        setPadTriggers((triggers) => ({ ...triggers, [lane]: performance.now() }))
        if (tapMode) {
          setTapTimes((times) => [...times.slice(-11), performance.now()])
          return
        }
        if (isRecording && armedLanes.has(lane) && audioRef.current) {
          const rawTimeMs = audioRef.current.currentTime * 1000
          heldStarts.current[lane] = rawTimeMs
        } else {
          parry(lane)
        }
      }
      if (event.code === 'KeyR') nextAttack()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const lane = keyLane[event.code]
      if (isTextEditingTarget(event.target) || (!isRecording && isEditingTarget(event.target))) return
      if (!lane || !isRecording || tapMode || !armedLanes.has(lane) || !audioRef.current) return
      const startMs = heldStarts.current[lane]
      delete heldStarts.current[lane]
      if (startMs === undefined) return
      const rawEndMs = audioRef.current.currentTime * 1000
      const rawDurationMs = Math.max(0, rawEndMs - startMs)
      const impactTimeMs = quantizeTime(startMs)
      const endTimeMs = quantizeTime(rawEndMs)
      const durationMs = rawDurationMs >= 200 ? Math.max(200, endTimeMs - impactTimeMs) : undefined
      setRecordedNotes((notes) => [...notes, { id: `manual-${Date.now()}-${notes.length}`, rawTimeMs: startMs, impactTimeMs, durationMs, lane, strength: 1, source: durationMs ? 'manual-hold' : quantize ? 'manual-quantized' : 'manual' }])
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeTab, armedLanes, isRecording, keyLane, nextAttack, parry, quantize, quantizeTime, tapMode])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const gamepad = navigator.getGamepads?.().find(Boolean)
      if (!gamepad) return
      const pressed = new Set<number>()
      gamepad.buttons.forEach((button, index) => { if (button.pressed) pressed.add(index) })
      pressed.forEach((buttonIndex) => {
        if (previousGamepadButtons.current.has(buttonIndex)) return
        const lane = gamepadLane[buttonIndex]
        if (!lane) return
        setPadTriggers((triggers) => ({ ...triggers, [lane]: performance.now() }))
        if (tapMode) {
          setTapTimes((times) => [...times.slice(-11), performance.now()])
          return
        }
        if (isRecording && armedLanes.has(lane) && audioRef.current) heldStarts.current[lane] = audioRef.current.currentTime * 1000
        else parry(lane)
      })
      previousGamepadButtons.current.forEach((buttonIndex) => {
        if (pressed.has(buttonIndex)) return
        const lane = gamepadLane[buttonIndex]
        if (!lane || !isRecording || tapMode || !armedLanes.has(lane) || !audioRef.current) return
        const startMs = heldStarts.current[lane]
        delete heldStarts.current[lane]
        if (startMs === undefined) return
        const rawEndMs = audioRef.current.currentTime * 1000
        const rawDurationMs = Math.max(0, rawEndMs - startMs)
        const impactTimeMs = quantizeTime(startMs)
        const endTimeMs = quantizeTime(rawEndMs)
        const durationMs = rawDurationMs >= 200 ? Math.max(200, endTimeMs - impactTimeMs) : undefined
        setRecordedNotes((notes) => [...notes, { id: `manual-${Date.now()}-${notes.length}`, rawTimeMs: startMs, impactTimeMs, durationMs, lane, strength: 1, source: durationMs ? 'manual-hold' : quantize ? 'manual-quantized' : 'manual' }])
      })
      previousGamepadButtons.current = pressed
    }, 16)
    return () => window.clearInterval(timer)
  }, [armedLanes, gamepadLane, isRecording, parry, quantize, quantizeTime, tapMode])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      setActiveAttacks((attacks) => {
        const expired = attacks.filter((attack) => now >= attack.impactMs + tuning.parryWindowMs && now < attack.impactMs + tuning.recoveryMs + 700)
        if (isSongPlaying && expired.length > 0) {
          setStats((s) => ({ ...s, missed: s.missed + expired.length, streak: 0 }))
          setLastResult(null)
          setLastAutoMiss(true)
          setFeedback({ id: Math.random(), kind: 'miss', startedAtMs: now, lane: expired[0]?.lane })
        }
        return attacks.filter((attack) => now < attack.impactMs + (isSongPlaying ? tuning.parryWindowMs : tuning.recoveryMs + 700))
      })
      if (!isSongPlaying && activeAttacks.length === 0) setActiveAttacks(makeIdlePattern())
    }, 100)
    return () => window.clearInterval(timer)
  }, [activeAttacks.length, isSongPlaying, tuning])

  useEffect(() => {
    const loopEndEpsilonMs = 0.5
    const loopSeekGuardMs = 6
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio || audio.paused) return
      const now = performance.now()
      let songTimeMs = audio.currentTime * 1000
      const hasLoop = loopMarkers.startMs !== null && loopMarkers.endMs !== null && loopMarkers.endMs > loopMarkers.startMs
      const loopStartMs = loopMarkers.startMs ?? 0
      const loopEndMs = loopMarkers.endMs ?? 0
      if (hasLoop && songTimeMs >= loopEndMs - loopSeekGuardMs) {
        songTimeMs = loopStartMs
        isLoopSeeking.current = true
        audio.currentTime = songTimeMs / 1000
        loopCycle.current += 1
      }
      setSongTimeMs(songTimeMs)
      if (activeTab === 'editor') setTimelineCenterMs(songTimeMs)
      if (!beatmap) return
      const spawnLeadMs = tuning.telegraphMs
      const dueNotes = beatmap.notes.flatMap((note) => {
        if (hasLoop) {
          if (note.impactTimeMs < loopStartMs || note.impactTimeMs >= loopEndMs - loopEndEpsilonMs) return []
          const directTimeUntilImpactMs = note.impactTimeMs - songTimeMs
          const scheduleCycle = directTimeUntilImpactMs > 0 ? loopCycle.current : loopCycle.current + 1
          const timeUntilImpactMs = directTimeUntilImpactMs > 0 ? directTimeUntilImpactMs : (loopEndMs - songTimeMs) + (note.impactTimeMs - loopStartMs)
          const scheduleKey = `${note.id}:${scheduleCycle}`
          return timeUntilImpactMs > 0 && timeUntilImpactMs <= spawnLeadMs && !scheduledNoteIds.current.has(scheduleKey)
            ? [{ note, timeUntilImpactMs, scheduleKey }]
            : []
        }
        const timeUntilImpactMs = note.impactTimeMs - songTimeMs
        const scheduleKey = note.id
        return timeUntilImpactMs > 0 && timeUntilImpactMs <= spawnLeadMs && !scheduledNoteIds.current.has(scheduleKey)
          ? [{ note, timeUntilImpactMs, scheduleKey }]
          : []
      }).slice(0, 6)
      if (dueNotes.length === 0) return
      setLastResult(null); setLastAutoMiss(false); setFeedback(null)
      setActiveAttacks((attacks) => {
        const activeScheduleKeys = new Set(attacks.map((attack) => attack.scheduleKey).filter(Boolean))
        const attacksToAdd = dueNotes.filter(({ scheduleKey }) => !activeScheduleKeys.has(scheduleKey))
        attacksToAdd.forEach(({ scheduleKey }) => scheduledNoteIds.current.add(scheduleKey))
        return [...attacks, ...attacksToAdd.map(({ note, timeUntilImpactMs, scheduleKey }) => makeBeatmapAttack(timeUntilImpactMs, note.lane, note.durationMs, note.id, scheduleKey))]
          .filter((attack) => attack.impactMs >= now - tuning.parryWindowMs)
          .sort((a, b) => a.impactMs - b.impactMs)
          .slice(0, 12)
      })
    }, 10)
    return () => window.clearInterval(timer)
  }, [activeTab, beatmap, loopMarkers, tuning.parryWindowMs, tuning.telegraphMs])

  const importYoutube = useCallback(async () => {
    const url = youtubeUrl.trim(); if (!url) return
    setImportStatus('Importing with local yt-dlp…')
    try {
      const response = await fetch('/api/import-youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Import failed')
      await loadImport(data)
      await loadImports()
      setImportStatus(`${data.cached ? 'Loaded cached' : 'Imported'} ${data.noteCount} notes`)
    } catch (error) { setImportStatus(error instanceof Error ? error.message : String(error)) }
  }, [loadImport, loadImports, youtubeUrl])

  const startRecording = useCallback(() => {
    if (!audioRef.current) return
    setArmedLanes(new Set(lanes))
    setRecordedNotes([])
    setRecordStartMs(audioRef.current.currentTime * 1000)
    setIsRecording(true)
    void audioRef.current.play()
  }, [])

  const stopRecording = useCallback(() => {
    const audio = audioRef.current
    const recordEndMs = audio ? audio.currentTime * 1000 : recordStartMs
    setIsRecording(false)
    setBeatmap((current) => {
      if (!current) return current
      const armed = armedLanes
      const kept = recordMode === 'replace'
        ? current.notes.filter((note) => !(armed.has(note.lane) && note.impactTimeMs >= recordStartMs && note.impactTimeMs <= recordEndMs))
        : current.notes
      const merged = [...kept, ...recordedNotes]
        .sort((a, b) => a.impactTimeMs - b.impactTimeMs)
        .filter((note, index, all) => index === 0 || note.lane !== all[index - 1].lane || Math.abs(note.impactTimeMs - all[index - 1].impactTimeMs) > 45)
      return { ...current, notes: merged }
    })
    resetScheduledNotes()
  }, [armedLanes, recordMode, recordStartMs, recordedNotes, resetScheduledNotes])

  const saveBeatmap = useCallback(async (saveAsNew = false) => {
    if (!beatmap || !importedSong) return
    const id = saveAsNew ? `${mapTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}` : beatmap.id
    const editable = { ...beatmap, id, title: mapTitle, difficulty, bpm, beatOffsetMs, songId: importedSong.id, source: 'manual' }
    const response = await fetch(`/api/imports/${importedSong.id}/beatmaps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beatmap: editable }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Save failed')
    setBeatmap(normalizeBeatmap(data.beatmap))
    localStorage.setItem(bpmStorageKey(importedSong.id, data.beatmap.id) ?? '', String(bpm))
    localStorage.setItem(bpmStorageKey(importedSong.id) ?? '', String(bpm))
    localStorage.setItem(beatOffsetStorageKey(importedSong.id, data.beatmap.id) ?? '', String(beatOffsetMs))
    localStorage.setItem(beatOffsetStorageKey(importedSong.id) ?? '', String(beatOffsetMs))
    setSongBeatmaps(data.beatmaps ?? [])
    setImportStatus(`Saved ${data.beatmap.title} v${data.beatmap.version}`)
  }, [beatOffsetMs, beatmap, bpm, difficulty, importedSong, mapTitle])

  const loadBeatmap = useCallback(async (mapId: string) => {
    const map = songBeatmaps.find((item) => item.id === mapId)
    if (!map) return
    const response = await fetch(map.url)
    const loaded = await response.json()
    setBeatmap(normalizeBeatmap(loaded))
    setMapTitle(loaded.title)
    setDifficulty(loaded.difficulty ?? 1)
    const songId = loaded.songId ?? importedSong?.id
    const savedSongBpm = readStoredNumber(bpmStorageKey(songId))
    const savedMapBpm = readStoredNumber(bpmStorageKey(songId, loaded.id))
    const savedSongBeatOffset = readStoredNumber(beatOffsetStorageKey(songId))
    const savedMapBeatOffset = readStoredNumber(beatOffsetStorageKey(songId, loaded.id))
    const nextBpm = savedSongBpm && savedSongBpm > 0 ? savedSongBpm : importedSong?.bpm && importedSong.bpm > 0 ? importedSong.bpm : savedMapBpm && savedMapBpm > 0 ? savedMapBpm : loaded.bpm ?? 120
    const nextBeatOffsetMs = savedSongBeatOffset ?? importedSong?.beatOffsetMs ?? savedMapBeatOffset ?? loaded.beatOffsetMs ?? 0
    setBpm(nextBpm)
    setBeatOffsetMs(nextBeatOffsetMs)
    if (songId) persistedCalibration.current = `${songId}:${nextBpm}:${nextBeatOffsetMs}`
    resetScheduledNotes()
  }, [importedSong?.id, resetScheduledNotes, songBeatmaps])

  const createBlankBeatmap = useCallback(() => {
    if (!importedSong) return
    const title = `${importedSong.title} custom`
    setBeatmap({ id: `new-${Date.now().toString(36)}`, songId: importedSong.id, title, difficulty, bpm, beatOffsetMs, durationMs: importedSong.durationMs, notes: [] })
    setMapTitle(title)
    setRecordedNotes([])
    resetScheduledNotes()
  }, [beatOffsetMs, bpm, difficulty, importedSong, resetScheduledNotes])

  const clearBeatmapEvents = useCallback(() => {
    setBeatmap((current) => current ? { ...current, notes: [] } : current)
    setRecordedNotes([])
    resetScheduledNotes()
  }, [resetScheduledNotes])

  const exportBeatmap = useCallback(() => {
    if (!beatmap) return
    const blob = new Blob([JSON.stringify({ ...beatmap, title: mapTitle, difficulty, bpm, beatOffsetMs }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${beatmap.id}-edited.beatmap.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [beatOffsetMs, beatmap, bpm, difficulty, mapTitle])

  const seekSong = useCallback((timeMs: number) => {
    const audio = audioRef.current
    const durationMs = importedSong?.durationMs ?? beatmap?.durationMs ?? 0
    const nextTimeMs = Math.min(Math.max(0, timeMs), durationMs || Math.max(0, timeMs))
    if (audio) audio.currentTime = nextTimeMs / 1000
    setSongTimeMs(nextTimeMs)
    resetScheduledNotes()
    setActiveAttacks([])
    setLastResult(null)
    setLastAutoMiss(false)
    setFeedback(null)
  }, [beatmap?.durationMs, importedSong?.durationMs, resetScheduledNotes])
  const snapTimelineTime = useCallback((timeMs: number, bypassSnap = false) => quantize && !bypassSnap ? beatOffsetMs + Math.round((timeMs - beatOffsetMs) / gridMs) * gridMs : timeMs, [beatOffsetMs, gridMs, quantize])
  const seekTimeline = useCallback((timeMs: number, bypassSnap = false) => {
    seekSong(Math.max(0, snapTimelineTime(timeMs, bypassSnap)))
  }, [seekSong, snapTimelineTime])
  const setLoopMarker = useCallback((timeMs: number, marker: 'start' | 'end', bypassSnap = false) => {
    const markerMs = Math.max(0, snapTimelineTime(timeMs, bypassSnap))
    setLoopMarkers((current) => marker === 'start'
      ? { startMs: markerMs, endMs: current.endMs && current.endMs > markerMs ? current.endMs : null }
      : { ...current, endMs: markerMs })
  }, [snapTimelineTime])
  const handleLoopRulerClick = useCallback((timeMs: number, marker: 'start' | 'end', bypassSnap = false) => {
    const markerMs = Math.max(0, snapTimelineTime(timeMs, bypassSnap))
    const markerHitWindowMs = Math.max(80, gridMs * 0.45)
    setLoopMarkers((current) => {
      if (marker === 'start') {
        if (current.startMs !== null && Math.abs(markerMs - current.startMs) <= markerHitWindowMs) return { startMs: null, endMs: current.endMs }
        return { startMs: markerMs, endMs: current.endMs && current.endMs > markerMs ? current.endMs : null }
      }
      if (current.endMs !== null && Math.abs(markerMs - current.endMs) <= markerHitWindowMs) return { ...current, endMs: null }
      return { ...current, endMs: markerMs }
    })
  }, [gridMs, snapTimelineTime])
  const playSong = useCallback(() => { void audioRef.current?.play() }, [])
  const pauseSong = useCallback(() => { audioRef.current?.pause() }, [])
  const seekRelativeSong = useCallback((deltaMs: number) => seekSong(songTimeMs + deltaMs), [seekSong, songTimeMs])
  const restartSong = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const restartMs = Math.max(0, loopMarkers.startMs ?? beatOffsetMs)
    audio.currentTime = restartMs / 1000
    setSongTimeMs(restartMs)
    setTimelineCenterMs(restartMs)
    resetScheduledNotes()
    setActiveAttacks([])
    setStats({ hit: 0, perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 })
    setLastResult(null)
    setLastAutoMiss(false)
    void audio.play()
  }, [beatOffsetMs, loopMarkers.startMs, resetScheduledNotes])

  const rows = useMemo(() => [
    ['Parry ±', tuning.parryWindowMs, 20, 260, 'ms', 'parryWindowMs'], ['Perfect ±', tuning.perfectWindowMs, 10, 120, 'ms', 'perfectWindowMs'], ['Avg travel', tuning.telegraphMs, 450, 2000, 'ms', 'telegraphMs'], ['Input offset', tuning.inputOffsetMs, -80, 80, 'ms', 'inputOffsetMs'],
  ] as const, [tuning])
  const currentAttack = activeAttacks[0]
  const detectedBpm = useMemo(() => {
    if (tapTimes.length < 2) return null
    const intervals = tapTimes.slice(1).map((time, index) => time - tapTimes[index]).filter((value) => value > 120 && value < 2000)
    if (intervals.length === 0) return null
    const avg = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    return Math.round((60000 / avg) * 10) / 10
  }, [tapTimes])
  const toggleTapBpm = useCallback(() => {
    if (tapMode) {
      if (detectedBpm) setBpm(detectedBpm)
      setTapMode(false)
    } else {
      setTapTimes([])
      setTapMode(true)
    }
  }, [detectedBpm, tapMode])
  const timelineNotes = useMemo(() => [
    ...(beatmap?.notes.map((note) => ({ ...note, pending: false })) ?? []),
    ...(isRecording ? recordedNotes.map((note) => ({ ...note, pending: true })) : []),
  ], [beatmap?.notes, isRecording, recordedNotes])
  const zoomOptions = useMemo(() => [1, 2, 5, 15, 30, 60, 120] as const, [])
  const timelineBounds = useMemo(() => {
    if (activeTab !== 'editor') return { startMs: songTimeMs - 5000, endMs: songTimeMs + 5000, spanMs: 10000 }
    if (timelineZoomSeconds === 'fit' && importedSong) return { startMs: 0, endMs: importedSong.durationMs, spanMs: Math.max(1, importedSong.durationMs) }
    const spanMs = (timelineZoomSeconds === 'fit' ? 60 : timelineZoomSeconds * 2) * 1000
    const durationMs = importedSong?.durationMs
    const maxStartMs = durationMs ? Math.max(0, durationMs - spanMs) : Number.POSITIVE_INFINITY
    const startMs = Math.min(Math.max(0, timelineCenterMs - spanMs / 2), maxStartMs)
    return { startMs, endMs: startMs + spanMs, spanMs }
  }, [activeTab, importedSong, songTimeMs, timelineCenterMs, timelineZoomSeconds])
  const removeNote = useCallback((noteId: string) => {
    setBeatmap((current) => current ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) } : current)
    setRecordedNotes((notes) => notes.filter((note) => note.id !== noteId))
    setSelectedNoteId((id) => id === noteId ? null : id)
    scheduledNoteIds.current.delete(noteId)
  }, [])
  const timelineGridLines = useMemo(() => {
    if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(gridMs) || gridMs <= 0) return []
    const quarterMs = 60000 / bpm
    const first = beatOffsetMs + Math.ceil((timelineBounds.startMs - beatOffsetMs) / gridMs) * gridMs
    const gridSpacingPercent = (gridMs / timelineBounds.spanMs) * 100
    const beatSpacingPercent = (quarterMs / timelineBounds.spanMs) * 100
    const showBeatLabels = beatSpacingPercent >= 4
    const lines: Array<{ left: number; strength: 'bar' | 'beat' | 'sub'; label?: string }> = []
    for (let timeMs = first; timeMs <= timelineBounds.endMs; timeMs += gridMs) {
      const left = ((timeMs - timelineBounds.startMs) / timelineBounds.spanMs) * 100
      const beatIndex = Math.round((timeMs - beatOffsetMs) / quarterMs)
      const isBeat = Math.abs(timeMs - (beatOffsetMs + beatIndex * quarterMs)) < 1
      const isBar = isBeat && beatIndex % 4 === 0
      const barNumber = Math.floor(beatIndex / 4) + 1
      const beatNumber = ((beatIndex % 4) + 4) % 4 + 1
      if (!isBeat && gridSpacingPercent < 1.2) continue
      if (isBeat && gridSpacingPercent < 0.35) continue
      lines.push({
        left,
        strength: isBar ? 'bar' : isBeat ? 'beat' : 'sub',
        label: isBar && barNumber > 0 ? String(barNumber) : showBeatLabels && isBeat && beatIndex >= 0 ? String(beatNumber) : undefined,
      })
      if (lines.length > 500) break
    }
    return lines
  }, [beatOffsetMs, bpm, gridMs, timelineBounds])

  const handleTimelineClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!beatmap) return
    const rect = event.currentTarget.getBoundingClientRect()
    const xRatio = (event.clientX - rect.left) / rect.width
    const yPx = event.clientY - rect.top - timelineLaneTopPx
    const yRatio = yPx / timelineLaneAreaHeightPx
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return
    const laneIndex = Math.min(lanes.length - 1, Math.max(0, Math.floor(yRatio * lanes.length)))
    const rawTimeMs = timelineBounds.startMs + xRatio * timelineBounds.spanMs
    const impactTimeMs = Math.max(0, quantize ? beatOffsetMs + Math.round((rawTimeMs - beatOffsetMs) / gridMs) * gridMs : rawTimeMs)
    const lane = lanes[laneIndex]
    const existing = beatmap.notes.find((note) => note.lane === lane && Math.abs(note.impactTimeMs - impactTimeMs) < Math.max(24, gridMs * 0.35))
    if (existing) {
      removeNote(existing.id)
      return
    }
    const note: BeatmapNote = { id: `manual-${Date.now()}-${Math.round(impactTimeMs)}`, impactTimeMs, rawTimeMs, lane, strength: 1, source: quantize ? 'manual-grid' : 'manual' }
    setBeatmap((current) => current ? { ...current, notes: [...current.notes, note].sort((a, b) => a.impactTimeMs - b.impactTimeMs) } : current)
    setSelectedNoteId(note.id)
  }, [beatOffsetMs, beatmap, gridMs, quantize, removeNote, timelineBounds])
  const zoomTimeline = useCallback((direction: 'in' | 'out') => {
    setTimelineZoomSeconds((current) => {
      if (current === 'fit') return direction === 'in' ? 120 : 'fit'
      const index = zoomOptions.indexOf(current as typeof zoomOptions[number])
      const safeIndex = index === -1 ? zoomOptions.indexOf(30) : index
      const nextIndex = direction === 'in' ? Math.max(0, safeIndex - 1) : Math.min(zoomOptions.length - 1, safeIndex + 1)
      return zoomOptions[nextIndex]
    })
  }, [zoomOptions])
  const handleTimelineWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.shiftKey) {
      zoomTimeline(event.deltaY < 0 ? 'in' : 'out')
      return
    }
    const wheelDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    let nextTimeMs: number
    if (quantize && !event.altKey) {
      const gridSteps = Math.max(1, Math.round(Math.abs(wheelDelta) / 100))
      nextTimeMs = songTimeMs + Math.sign(wheelDelta) * gridMs * gridSteps
    } else {
      nextTimeMs = songTimeMs + wheelDelta * (timelineBounds.spanMs / 2400)
    }
    const snappedTimeMs = quantize && !event.altKey ? beatOffsetMs + Math.round((nextTimeMs - beatOffsetMs) / gridMs) * gridMs : nextTimeMs
    seekTimeline(nextTimeMs, event.altKey)
    const previousTimeMs = quantize && !event.altKey ? beatOffsetMs + Math.round((songTimeMs - beatOffsetMs) / gridMs) * gridMs : songTimeMs
    const timelineDeltaMs = snappedTimeMs - previousTimeMs
    const edgeGuardMs = quantize && !event.altKey ? gridMs * 2 : timelineBounds.spanMs * 0.08
    const leftGuardMs = timelineBounds.startMs + edgeGuardMs
    const rightGuardMs = timelineBounds.endMs - edgeGuardMs
    if (timelineDeltaMs < 0 && snappedTimeMs <= leftGuardMs) {
      setTimelineCenterMs(snappedTimeMs + timelineBounds.spanMs / 2 - edgeGuardMs)
    }
    if (timelineDeltaMs > 0 && snappedTimeMs >= rightGuardMs) {
      setTimelineCenterMs(snappedTimeMs - timelineBounds.spanMs / 2 + edgeGuardMs)
    }
  }, [beatOffsetMs, gridMs, quantize, seekTimeline, songTimeMs, timelineBounds, zoomTimeline])
  const centerTimelineOnPlayhead = useCallback(() => setTimelineCenterMs(songTimeMs), [songTimeMs])
  const setBeatOneAtPlayhead = useCallback(() => setBeatOffsetMs(Math.max(0, songTimeMs)), [songTimeMs])
  const nudgeBeatOffset = useCallback((deltaMs: number) => setBeatOffsetMs((value) => Math.max(0, value + deltaMs)), [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'editor' || isEditingTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (event.shiftKey) restartSong()
        else if (isSongPlaying) pauseSong()
        else playSong()
        return
      }
      const numberIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(event.code)
      if (numberIndex !== -1) {
        event.preventDefault()
        if (event.shiftKey) {
          if (numberIndex < zoomOptions.length) setTimelineZoomSeconds(zoomOptions[numberIndex])
          else if (numberIndex === 7) setTimelineZoomSeconds('fit')
          else if (numberIndex === 8) centerTimelineOnPlayhead()
          return
        }
        const gridShortcuts: Array<GridDivision | 'snap'> = [4, 8, 16, 32, 64, 'snap']
        const shortcut = gridShortcuts[numberIndex]
        if (shortcut === 'snap') setQuantize((value) => !value)
        else if (shortcut) setGridDivision(shortcut)
        return
      }
      if (!selectedNoteId) return
      if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault()
        removeNote(selectedNoteId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab, centerTimelineOnPlayhead, isSongPlaying, pauseSong, playSong, removeNote, restartSong, selectedNoteId, zoomOptions])
  const restartTooltip = loopMarkers.startMs === null ? 'Restart to beat 1' : 'Restart to loop start'
  const transport = <div className="transport-bar" aria-label="Transport controls"><Button type="button" variant="ghost" className="transport-icon-button" onClick={restartSong} disabled={!importedSong} title={restartTooltip} tooltip={restartTooltip} shortcut="Shift+Space">↺</Button><Button type="button" variant="ghost" className="transport-icon-button" onClick={() => seekRelativeSong(-5000)} disabled={!importedSong} title="Back 5 seconds" tooltip="Back 5 seconds">⏪ 5</Button><Button type="button" className={`transport-play-button ${isSongPlaying ? 'transport-play-button--pause' : 'transport-play-button--play'}`} onClick={isSongPlaying ? pauseSong : playSong} disabled={!importedSong} title={isSongPlaying ? 'Pause' : 'Play'} tooltip={isSongPlaying ? 'Pause' : 'Play'} shortcut="Space">{isSongPlaying ? '⏸' : '▶'}</Button><Button type="button" variant="ghost" className="transport-icon-button" onClick={() => seekRelativeSong(5000)} disabled={!importedSong} title="Forward 5 seconds" tooltip="Forward 5 seconds">5 ⏩</Button></div>
  const songSelector = <Card><CardHeader><CardTitle>Current song</CardTitle><CardDescription>{importedSong ? importedSong.title : 'Choose a cached song or import one from Config.'}</CardDescription></CardHeader>{savedImports.length > 0 ? <Field><FieldLabel>Song</FieldLabel><Select value={importedSong?.id ?? ''} onChange={(event) => { const song = savedImports.find((item) => item.id === event.target.value); if (song) void loadImport(song) }}><option value="">Select cached song...</option>{savedImports.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</Select></Field> : <p className="editor-hint">No cached songs yet. Use Config to import from YouTube.</p>}{songBeatmaps.length > 0 && <Field><FieldLabel>Beatmap</FieldLabel><Select value={beatmap?.id ?? ''} onChange={(event) => void loadBeatmap(event.target.value)}>{songBeatmaps.map((map) => <option key={map.id} value={map.id}>{'★'.repeat(map.difficulty ?? 1)} {map.title} ({map.noteCount})</option>)}</Select></Field>}</Card>
  const judgementText = lastAutoMiss ? 'miss' : lastResult ? lastResult.grade : 'ready'
  const gradeColor = lastAutoMiss ? '#ff5570' : lastResult?.grade === 'perfect' ? '#ffd166' : lastResult?.grade === 'good' ? '#83ff70' : undefined
  const timingColor = lastResult?.success ? gradeColor : lastResult ? (lastResult.deltaMs < 0 ? '#83ff70' : '#ff5570') : undefined
  const roundedDeltaMs = lastResult ? Math.round(lastResult.deltaMs) : null
  const deltaText = roundedDeltaMs === null ? '-' : `${roundedDeltaMs > 0 ? '+' : ''}${roundedDeltaMs}ms`

  return (
    <main className={activeTab === 'editor' ? 'editing-layout' : undefined}>
      <section className={activeTab === 'editor' ? 'stage edit-stage' : 'stage'}>
        {activeTab === 'editor'
          ? <div className="edit-workspace"><div className="edit-workspace__header"><div className="edit-title-row"><div><span className="eyebrow">Editor</span><h2>{mapTitle || 'Untitled beatmap'}</h2><p>{recordedNotes.length} buffered · {beatmap?.notes.length ?? 0} saved · Record captures configured lane controls against the song timeline</p></div><div className="edit-primary-actions"><Button type="button" variant={isRecording ? 'warning' : 'secondary'} onClick={isRecording ? stopRecording : startRecording} tooltip={isRecording ? 'Stop recording' : 'Start recording'}>{isRecording ? 'Stop rec' : 'Record'}</Button><Button type="button" variant="secondary" onClick={() => void saveBeatmap(false)} disabled={!beatmap || !importedSong} tooltip="Save current beatmap">Save</Button></div></div>{transport}<Toolbar><div className="toolbar-section"><span className="toolbar-section__label">Record</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" className={recordMode === 'add' ? 'active' : ''} onClick={() => setRecordMode('add')} tooltip="Record adds new notes">Add</Button><Button type="button" variant="ghost" size="pill" className={recordMode === 'replace' ? 'active' : ''} onClick={() => setRecordMode('replace')} tooltip="Record replaces armed lanes in the recorded range">Replace</Button></div></div><div className="toolbar-section toolbar-section--wide"><span className="toolbar-section__label">Lanes</span><div className="toolbar-group">{lanes.map((lane) => <Button key={lane} type="button" variant="ghost" size="pill" className={armedLanes.has(lane) ? 'active' : ''} onClick={() => setArmedLanes((current) => { const next = new Set(current); if (next.has(lane)) next.delete(lane); else next.add(lane); return next })} tooltip={`Toggle ${lane} lane recording`}>{lane}</Button>)}</div></div><div className="toolbar-section"><span className="toolbar-section__label">Grid</span><div className="toolbar-group">{([4, 8, 16, 32, 64] as const).map((division) => <Button key={division} type="button" variant="ghost" size="pill" className={gridDivision === division ? 'active' : ''} onClick={() => setGridDivision(division)} tooltip={`Set grid to 1/${division}`} shortcut={String(([4, 8, 16, 32, 64] as const).indexOf(division) + 1)}>1/{division}</Button>)}<Button type="button" variant="ghost" size="pill" className={quantize ? 'active' : ''} onClick={() => setQuantize((value) => !value)} tooltip="Snap recording and edit actions to the grid" shortcut="6">Snap {quantize ? 'on' : 'off'}</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Zoom</span><div className="toolbar-group">{zoomOptions.map((seconds) => <Button key={seconds} type="button" variant="ghost" size="pill" className={timelineZoomSeconds === seconds ? 'active' : ''} onClick={() => setTimelineZoomSeconds(seconds)} tooltip={`Zoom to ${seconds * 2}s window`} shortcut={`Shift+${zoomOptions.indexOf(seconds) + 1}`}>{seconds * 2}s</Button>)}<Button type="button" variant="ghost" size="pill" className={timelineZoomSeconds === 'fit' ? 'active' : ''} onClick={() => setTimelineZoomSeconds('fit')} tooltip="Fit song in timeline" shortcut="Shift+8">Fit</Button><Button type="button" variant="ghost" size="pill" onClick={centerTimelineOnPlayhead} tooltip="Center timeline on playhead" shortcut="Shift+9">Follow</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Tempo{tapMode ? ` · ${detectedBpm ? `${detectedBpm} bpm` : 'tap keys'}` : ''}</span><div className="toolbar-group"><Input type="number" min="40" max="300" step="0.1" value={Number.isFinite(bpm) ? Math.round(bpm * 10) / 10 : ''} onChange={(event) => { const nextBpm = Number(event.target.value); if (Number.isFinite(nextBpm) && nextBpm > 0) setBpm(Math.round(nextBpm * 10) / 10) }} /><Button type="button" variant="ghost" size="pill" className={tapMode ? 'active' : ''} onClick={toggleTapBpm} tooltip={tapMode ? 'Use detected BPM' : 'Start tap BPM'}>{tapMode ? 'Stop + use' : 'Start tap'}</Button></div>{tapMode && <span className="tap-bpm-readout">{detectedBpm ? `Live BPM ${detectedBpm}` : 'Press Space/W/arrows on the beat…'}</span>}</div><div className="toolbar-section toolbar-section--wide"><span className="toolbar-section__label">Beat 1 · {(beatOffsetMs / 1000).toFixed(3)}s</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={setBeatOneAtPlayhead} tooltip="Set current playhead as beat 1">Set beat 1 here</Button><Button type="button" variant="ghost" size="pill" onClick={() => nudgeBeatOffset(-10)} tooltip="Move beat 1 earlier by 10ms">-10ms</Button><Button type="button" variant="ghost" size="pill" onClick={() => nudgeBeatOffset(10)} tooltip="Move beat 1 later by 10ms">+10ms</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Selection</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={() => selectedNoteId && removeNote(selectedNoteId)} disabled={!selectedNoteId} tooltip="Delete selected note" shortcut="Delete">Delete</Button></div></div></Toolbar></div><EditorTimeline notes={timelineNotes} gridLines={timelineGridLines} bounds={timelineBounds} songTimeMs={songTimeMs} selectedNoteId={selectedNoteId} loopMarkers={loopMarkers} onTimelineClick={handleTimelineClick} onTimelineWheel={handleTimelineWheel} onSeek={seekTimeline} onLoopRulerClick={handleLoopRulerClick} onLoopMarkerDrag={setLoopMarker} onRemoveNote={removeNote} /></div>
          : activeTab === 'play'
            ? <div className="play-stage"><div className="play-transport">{transport}</div><HitNotify feedback={feedback} /><Canvas camera={{ position: [0, 0.18, 7.2], fov: 42 }}><Arena attacks={activeAttacks} tuning={tuning} parryPulse={parryPulse} feedback={feedback} padTriggers={padTriggers} onPhaseChange={setPhase} /></Canvas></div>
            : <Canvas camera={{ position: [0, 0.18, 7.2], fov: 42 }}><Arena attacks={activeAttacks} tuning={tuning} parryPulse={parryPulse} feedback={feedback} padTriggers={padTriggers} onPhaseChange={setPhase} /></Canvas>}
      </section>
      {activeTab !== 'editor' && <div className="status-stack" aria-live="polite">
        <div className="toast"><strong>{phase}</strong></div>
        <div className="toast"><strong style={{ color: gradeColor }}>{judgementText}</strong></div>
        <div className="toast"><strong style={{ color: timingColor }}>{lastAutoMiss ? '-' : deltaText}</strong></div>
      </div>}
      {importedSong && <audio ref={audioRef} src={importedSong.audioUrl} onPlay={() => setIsSongPlaying(true)} onPause={() => setIsSongPlaying(false)} onEnded={() => setIsSongPlaying(false)} onTimeUpdate={(event) => setSongTimeMs(event.currentTarget.currentTime * 1000)} onSeeked={(event) => { setSongTimeMs(event.currentTarget.currentTime * 1000); if (isLoopSeeking.current) isLoopSeeking.current = false; else resetScheduledNotes() }} />}
      <aside className="panel">
        <div className="panel-hero"><span className="eyebrow">Beatmap DAW</span><h1>Flow Fight</h1><p>Import songs, align the beat grid, record lane events, then playtest the feel.</p></div>
        <Tabs value={activeTab} className="ui-tabs"><TabsList className="ui-tabs__list">{(['play', 'editor', 'config', 'debug'] as const).map((tab) => <TabsTrigger key={tab} value={tab} className="ui-tabs__trigger" onClick={() => setActiveTab(tab)}>{tab}</TabsTrigger>)}</TabsList></Tabs>

        {activeTab === 'play' && <>
          {songSelector}
          <Card><CardHeader><CardTitle>Run stats</CardTitle><CardDescription>Quick read on accuracy and streak health.</CardDescription></CardHeader><div className="stat-grid"><div><span>Accuracy</span><strong>{stats.hit + stats.missed ? Math.round((stats.hit / (stats.hit + stats.missed)) * 100) : 0}%</strong></div><div><span>Streak</span><strong>{stats.streak}</strong></div><div><span>Best</span><strong>{stats.bestStreak}</strong></div><div><span>Miss</span><strong>{stats.missed}</strong></div></div><div className="metric-row"><Badge tone="warning">Perfect {stats.perfect}</Badge><Badge tone="success">Good {stats.good}</Badge><Badge>Hit {stats.hit}</Badge></div></Card>
          <Disclosure><DisclosureSummary>Timing feel</DisclosureSummary>{rows.slice(0, 2).map(([label, value, min, max, unit, key]) => <Field key={key}><FieldLabel>{label}: <strong>{value}{unit}</strong></FieldLabel><Slider min={min} max={max} value={value} onChange={(e) => setTuning((t) => ({ ...t, [key]: Number(e.target.value) }))} /></Field>)}</Disclosure>
        </>}

        {activeTab === 'editor' && <>
          {songSelector}
          <Card><CardHeader><CardTitle>Map details</CardTitle><CardDescription>Sidebar is for metadata and destructive/new-map actions only. Active editing lives in the main pane.</CardDescription></CardHeader><Field><FieldLabel>Title</FieldLabel><Input value={mapTitle} onChange={(event) => setMapTitle(event.target.value)} placeholder="Beatmap title" /></Field><Field><FieldLabel>Difficulty <strong>{'★'.repeat(difficulty)}</strong></FieldLabel><Slider min="1" max="5" value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></Field><div className="action-grid"><Button type="button" variant="secondary" onClick={() => void saveBeatmap(true)} tooltip="Save a duplicate beatmap">Save as new</Button><Button type="button" variant="secondary" onClick={createBlankBeatmap} tooltip="Create an empty beatmap">New blank</Button><Button type="button" variant="secondary" onClick={exportBeatmap} tooltip="Export beatmap JSON">Export JSON</Button><Button type="button" variant="warning" onClick={clearBeatmapEvents} tooltip="Remove all notes from this beatmap">Wipe events</Button></div>{tapMode && <p className="editor-hint">Tap tempo is listening for lane keys. Use the main pane's Tap button to save.</p>}</Card>
        </>}

        {activeTab === 'config' && <>
          <Card className="import-card"><CardHeader><CardTitle>Import from YouTube</CardTitle><CardDescription>Paste a URL once. Flow Fight caches audio and metadata locally, then starts with a blank map.</CardDescription></CardHeader><div className="url-row"><Input type="url" placeholder="https://www.youtube.com/watch?v=..." value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} /><Button type="button" onClick={importYoutube} tooltip="Import YouTube audio">Import</Button></div>{importStatus && <p className="import-status">{importStatus}</p>}{importedSong && <div className="song-card"><strong>{importedSong.title}</strong><span>{Math.round(importedSong.durationMs / 1000)}s · {beatmap?.notes.length ?? importedSong.noteCount} notes</span><a href={importedSong.beatmapUrl} target="_blank">Open original beatmap JSON</a></div>}</Card>
          <Card><CardHeader><CardTitle>Controls</CardTitle><CardDescription>Configure keyboard event codes and Xbox-style gamepad buttons for each lane.</CardDescription></CardHeader><div className="controls-grid">{lanes.map((lane) => <div key={lane} className="control-row"><strong style={{ color: laneColor[lane] }}>{lane}</strong><Input value={controls[lane].keyboard} onChange={(event) => setControls((current) => ({ ...current, [lane]: { ...current[lane], keyboard: event.target.value } }))} /><Select value={String(controls[lane].gamepadButton)} onChange={(event) => setControls((current) => ({ ...current, [lane]: { ...current[lane], gamepadButton: Number(event.target.value) } }))}>{Object.entries(gamepadButtonLabels).map(([button, label]) => <option key={button} value={button}>{label}</option>)}</Select></div>)}</div><Button type="button" variant="secondary" onClick={() => setControls(defaultControls)} tooltip="Restore default keyboard and gamepad bindings">Reset controls</Button></Card>
        </>}

        {activeTab === 'debug' && <><Card><CardHeader><CardTitle>Tuning</CardTitle><CardDescription>Adjust judgement windows and projectile timing.</CardDescription></CardHeader>{rows.map(([label, value, min, max, unit, key]) => <Field key={key}><FieldLabel>{label}: <strong>{value}{unit}</strong></FieldLabel><Slider min={min} max={max} value={value} onChange={(e) => setTuning((t) => ({ ...t, [key]: Number(e.target.value) }))} /></Field>)}</Card><Card className="timing-debug-card"><CardHeader><CardTitle>Timing debug</CardTitle></CardHeader><Stack><code>zero point: leading edge touches shield</code><code>active projectiles: {activeAttacks.length}</code><code>impactTime: {currentAttack ? currentAttack.impactMs.toFixed(2) : '-'}ms</code><code>this travel: {currentAttack ? currentAttack.travelMs.toFixed(0) : '-'}ms</code><code>song mode: {isSongPlaying && beatmap ? `${beatmap.notes.length} notes` : 'off'}</code><code>parry: ±{tuning.parryWindowMs}ms ({tuning.parryWindowMs * 2}ms total)</code><code>perfect: ±{tuning.perfectWindowMs}ms ({tuning.perfectWindowMs * 2}ms total)</code><code>delta: {lastResult ? `${lastResult.deltaMs.toFixed(2)}ms` : '-'}</code><code>result: {lastResult ? `${lastResult.grade} / ${lastResult.success ? 'success' : 'miss'}` : '-'}</code></Stack></Card></>}
      </aside>
    </main>
  )
}

export default App
