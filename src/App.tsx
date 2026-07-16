import { ArrowLeftToLine, ArrowRightToLine, Check, Circle, CopyPlus, Database, Download, Edit3, FilePlus2, Gamepad2, Headphones, Redo2, Save, Star, Trash2, Undo2, Upload, X, Zap } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import './App.css'
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Disclosure, DisclosureSummary, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Stack, Tabs, TabsList, TabsTrigger } from './components/ui'
import { ConfigSection } from './components/ConfigSection'
import { Toolbar } from './components/Toolbar'
import { CompanionClient, type CompanionAudio } from './companion/client'
import { COMPANION_WINDOWS_DOWNLOAD_URL } from './config'
import { createShareBundle, parseShareBundle, SHARE_BUNDLE_SCHEMA } from './domain/share-bundle'
import { parseSongPackage, SONG_PACKAGE_SCHEMA, SONG_PACKAGE_VERSION, type SongPackage } from './domain/song-package'
import { EditorTimeline } from './editor/EditorTimeline'
import { planPatternSync } from './editor/pattern-sync'
import { notesTouchedByPlayhead } from './editor/playhead-selection'
import { planSmartDuplicate } from './editor/smart-duplicate'
import { windowTimelineNotes } from './editor/timeline-window'
import { HitNotify } from './game/HitNotify'
import { findDueNotes } from './game/note-scheduler'
import { judgeParryTiming, syncopationAmount, type ParryTimingResult } from './game/timing'
import { runtimeMetrics, type RuntimeMetricsSnapshot } from './performance/runtime-metrics'
import { getBrowserAudio, putBrowserAudio } from './storage/browser-audio-repository'
import { createLocalStorageSongPackageRepository } from './storage/song-package-repository'
import {
  collectionPercent,
  countNotesByLane,
  createLaneCounts,
  defaultControls,
  gamepadButtonLabels,
  initialTuning,
  judgementCssVars,
  laneColor,
  lanes,
  makeBeatmapAttack,
  missedProjectileLingerMs,
  normalizeBeatmap,
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
  type LaneCounts,
  type LaneFeedback,
  type LoopMarkers,
  type PlayStats,
  type SavedBeatmap,
  type Tuning,
} from './game/model'

const GameScene = lazy(() => import('./game/GameScene').then((module) => ({ default: module.GameScene })))

const storageKey = (name: string) => `beat-fiend:${name}`
const legacyStorageKey = (name: string) => `flow-fight:${name}`
const readAppStorage = (name: string) => localStorage.getItem(storageKey(name)) ?? localStorage.getItem(legacyStorageKey(name))

type EditorSnapshot = {
  beatmap: Beatmap | null
  recordedNotes: BeatmapNote[]
  mapTitle: string
  difficulty: number
  bpm: number
  beatOffsetMs: number
}

type CompanionConnectionStatus = 'idle' | 'connecting' | 'paired' | 'available' | 'unavailable' | 'permission-blocked'

type BeatmapLibraryBackup = {
  schema: 'beat-fiend/library-backup'
  schemaVersion: 1
  exportedAt: string
  packages: SongPackage[]
}

const LEGACY_RECOVERY_URL = '/legacy-song-packages.json'
const editorSignature = (beatmap: Beatmap | null, title: string, difficulty: number, bpm: number, beatOffsetMs: number) => JSON.stringify({ beatmap, title, difficulty, bpm, beatOffsetMs })

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

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
  const [activeAttacks, setActiveAttacks] = useState<Attack[]>([])
  const [lastResult, setLastResult] = useState<ParryTimingResult | null>(null)
  const [lastAutoMiss, setLastAutoMiss] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackEvent | null>(null)
  const [laneFeedback, setLaneFeedback] = useState<LaneFeedback>({})
  const [phase, setPhase] = useState('queued')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [companionStatus, setCompanionStatus] = useState<CompanionConnectionStatus>('idle')
  const [companionDialogOpen, setCompanionDialogOpen] = useState(false)
  const [activeImportJobId, setActiveImportJobId] = useState<string | null>(null)
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
  const [renameDraft, setRenameDraft] = useState('My beatmap')
  const [renameOpen, setRenameOpen] = useState(false)
  const [difficultyOpen, setDifficultyOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [stats, setStats] = useState<PlayStats>({ hit: 0, perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 })
  const [collectedNotes, setCollectedNotes] = useState<LaneCounts>(() => createLaneCounts())
  const [songTimeMs, setSongTimeMs] = useState(0)
  const [performanceSnapshot, setPerformanceSnapshot] = useState<RuntimeMetricsSnapshot>(() => runtimeMetrics.snapshot())
  const [activeTab, setActiveTab] = useState<'play' | 'editor' | 'config' | 'debug'>(() => {
    const stored = readAppStorage('active-tab')
    return stored === 'play' || stored === 'editor' || stored === 'config' || stored === 'debug' ? stored : 'play'
  })
  const [controls, setControls] = useState<LaneControls>(() => {
    try { return { ...defaultControls, ...JSON.parse(readAppStorage('controls') ?? '{}') } }
    catch { return defaultControls }
  })
  const [bpm, setBpm] = useState(120)
  const [beatOffsetMs, setBeatOffsetMs] = useState(0)
  const [tapTimes, setTapTimes] = useState<number[]>([])
  const [tapMode, setTapMode] = useState(false)
  const [quantize, setQuantize] = useState(true)
  const [gridDivision, setGridDivision] = useState<GridDivision>(16)
  const [tripletGrid, setTripletGrid] = useState(false)
  const [timelineZoomSeconds, setTimelineZoomSeconds] = useState<number | 'fit'>(4)
  const [timelineCenterMs, setTimelineCenterMs] = useState(0)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(() => new Set())
  const [copiedNotes, setCopiedNotes] = useState<BeatmapNote[]>([])
  const [loopMarkers, setLoopMarkers] = useState<LoopMarkers>({ startMs: null, endMs: null })
  const [padTriggers, setPadTriggers] = useState<Record<Lane, number>>({ kick: 0, snare: 0, low: 0, mid: 0, high: 0 })
  const [heldPlayLanes, setHeldPlayLanes] = useState<Set<Lane>>(() => new Set())
  const audioRef = useRef<HTMLAudioElement>(null)
  const browserAudioUrl = useRef<string | null>(null)
  const audioLoadSequence = useRef(0)
  const localAudioInputRef = useRef<HTMLInputElement>(null)
  const libraryImportInputRef = useRef<HTMLInputElement>(null)
  const shareImportInputRef = useRef<HTMLInputElement>(null)
  const [savedEditorSignature, setSavedEditorSignature] = useState<string | null>(null)
  const companion = useMemo(() => new CompanionClient(), [])
  const packageRepository = useMemo(() => createLocalStorageSongPackageRepository(), [])
  const scheduledNoteIds = useRef(new Set<string>())
  const shiftWheelSelection = useRef<{ anchorTimeMs: number; baselineIds: Set<string> } | null>(null)
  const loopCycle = useRef(0)
  const isLoopSeeking = useRef(false)
  const playbackResetAt = useRef(0)
  const lastUiTimePublishAt = useRef(0)
  const heldStarts = useRef<Partial<Record<Lane, number>>>({})
  const previousGamepadButtons = useRef(new Set<number>())
  const calibrationHydrated = useRef(false)
  const persistedCalibration = useRef<string | null>(null)
  const restoredSongId = useRef<string | null>(readAppStorage('selected-song'))
  const undoStack = useRef<EditorSnapshot[]>([])
  const redoStack = useRef<EditorSnapshot[]>([])
  const lastHistoryKey = useRef<string | null>(null)
  const historyKeyTimer = useRef<number | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const editorState = useRef<EditorSnapshot>({ beatmap, recordedNotes, mapTitle, difficulty, bpm, beatOffsetMs })
  editorState.current = { beatmap, recordedNotes, mapTitle, difficulty, bpm, beatOffsetMs }
  const currentEditorSignature = editorSignature(beatmap, mapTitle, difficulty, bpm, beatOffsetMs)
  const hasUnsavedChanges = beatmap !== null && currentEditorSignature !== savedEditorSignature
  const laneNoteTotals = useMemo(() => countNotesByLane(beatmap?.notes ?? []), [beatmap?.notes])
  const collectionProgress = useMemo(() => Object.fromEntries(lanes.map((lane) => [lane, collectionPercent(collectedNotes[lane], laneNoteTotals[lane])])) as Record<Lane, number>, [collectedNotes, laneNoteTotals])

  useEffect(() => {
    setCollectedNotes(createLaneCounts())
  }, [beatmap?.id, importedSong?.id])

  useEffect(() => {
    const stopMetrics = runtimeMetrics.start()
    const publishMetrics = window.setInterval(() => setPerformanceSnapshot(runtimeMetrics.snapshot()), 1000)
    return () => { stopMetrics(); window.clearInterval(publishMetrics) }
  }, [])

  useEffect(() => {
    const endShiftWheelSelection = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftWheelSelection.current = null
    }
    const cancelShiftWheelSelection = () => { shiftWheelSelection.current = null }
    window.addEventListener('keyup', endShiftWheelSelection)
    window.addEventListener('blur', cancelShiftWheelSelection)
    return () => {
      window.removeEventListener('keyup', endShiftWheelSelection)
      window.removeEventListener('blur', cancelShiftWheelSelection)
    }
  }, [])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  const confirmDiscardChanges = useCallback(() => !hasUnsavedChanges || window.confirm('Discard unsaved beatmap changes?'), [hasUnsavedChanges])

  const restoreEditorSnapshot = useCallback((snapshot: EditorSnapshot) => {
    setBeatmap(snapshot.beatmap)
    setRecordedNotes(snapshot.recordedNotes)
    setMapTitle(snapshot.mapTitle)
    setDifficulty(snapshot.difficulty)
    setBpm(snapshot.bpm)
    setBeatOffsetMs(snapshot.beatOffsetMs)
    setSelectedNoteIds(new Set())
    scheduledNoteIds.current.clear()
    loopCycle.current += 1
  }, [])
  const checkpointEditor = useCallback((key?: string) => {
    if (key && lastHistoryKey.current === key) return
    const current = editorState.current
    undoStack.current.push({ ...current, beatmap: current.beatmap ? { ...current.beatmap, notes: current.beatmap.notes.map((note) => ({ ...note })) } : null, recordedNotes: current.recordedNotes.map((note) => ({ ...note })) })
    if (undoStack.current.length > 100) undoStack.current.shift()
    redoStack.current = []
    lastHistoryKey.current = key ?? null
    if (historyKeyTimer.current !== null) window.clearTimeout(historyKeyTimer.current)
    if (key) historyKeyTimer.current = window.setTimeout(() => { lastHistoryKey.current = null }, 300)
    setHistoryVersion((version) => version + 1)
  }, [])
  const undoEditor = useCallback(() => {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(editorState.current)
    lastHistoryKey.current = null
    restoreEditorSnapshot(previous)
    setHistoryVersion((version) => version + 1)
  }, [restoreEditorSnapshot])
  const redoEditor = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(editorState.current)
    lastHistoryKey.current = null
    restoreEditorSnapshot(next)
    setHistoryVersion((version) => version + 1)
  }, [restoreEditorSnapshot])
  const resetEditorHistory = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    lastHistoryKey.current = null
    if (historyKeyTimer.current !== null) window.clearTimeout(historyKeyTimer.current)
    historyKeyTimer.current = null
    setHistoryVersion((version) => version + 1)
  }, [])

  const resetScheduledNotes = useCallback(() => {
    scheduledNoteIds.current.clear()
    loopCycle.current += 1
  }, [])
  const resetGameplayPlayback = useCallback(() => {
    playbackResetAt.current = performance.now()
    resetScheduledNotes()
    setActiveAttacks([])
    setLastResult(null)
    setLastAutoMiss(false)
    setFeedback(null)
    setLaneFeedback({})
  }, [resetScheduledNotes])

  const packageToImport = useCallback(async (songPackage: SongPackage): Promise<ImportResult> => {
    const maps = songPackage.beatmaps.map((map) => ({ id: map.id, title: map.title, difficulty: map.difficulty, updatedAt: map.updatedAt, noteCount: map.notes.length, url: `package:${songPackage.id}:${map.id}` }))
    const firstMap = maps[0]
    const timing = songPackage.timingProfiles.find((profile) => profile.id === songPackage.defaultTimingProfileId) ?? songPackage.timingProfiles[0]
    return { id: songPackage.id, title: songPackage.song.title, durationMs: songPackage.song.durationMs ?? songPackage.beatmaps[0]?.durationMs ?? 0, audioUrl: '', beatmapUrl: firstMap?.url ?? `package:${songPackage.id}:new`, noteCount: firstMap?.noteCount ?? 0, sourceUrl: songPackage.song.sources.find((source) => source.url)?.url, bpm: timing?.bpm, beatOffsetMs: timing?.beatOffsetMs, beatmaps: maps }
  }, [])

  const loadImports = useCallback(async () => {
    const packageImports = (await packageRepository.list()).map((summary) => packageRepository.get(summary.id))
    const local = (await Promise.all(packageImports)).filter((item): item is SongPackage => item !== null)
    const localIds = new Set(local.map((item) => item.id))
    let recoveryPackages: SongPackage[] = []
    try {
      const response = await fetch(LEGACY_RECOVERY_URL, { cache: 'no-store' })
      if (response.ok) {
        const backup = await response.json() as BeatmapLibraryBackup
        recoveryPackages = backup.packages.map(parseSongPackage).filter((item) => !localIds.has(item.id))
      }
    } catch {
      // Recovery catalog is optional in deployments without legacy songs.
    }
    const localImports = await Promise.all(local.map(packageToImport))
    const recoveryImports = (await Promise.all(recoveryPackages.map(packageToImport))).map((item) => ({ ...item, beatmapUrl: `legacy:${item.id}`, beatmaps: item.beatmaps?.map((map) => ({ ...map, url: `legacy:${item.id}:${map.id}` })) }))
    setSavedImports([...localImports, ...recoveryImports])
  }, [packageRepository, packageToImport])

  const loadImport = useCallback(async (song: ImportResult) => {
    const loadSequence = ++audioLoadSequence.current
    resetGameplayPlayback()
    calibrationHydrated.current = false
    localStorage.setItem(storageKey('selected-song'), song.id)
    setSongBeatmaps(song.beatmaps ?? [])
    setImportStatus(`Loading ${song.title}...`)
    try {
      let songPackage = await packageRepository.get(song.id)
      if (!songPackage && song.beatmapUrl.startsWith('legacy:')) {
        setImportStatus(`Restoring ${song.title} into browser storage...`)
        const response = await fetch(LEGACY_RECOVERY_URL, { cache: 'no-store' })
        if (!response.ok) throw new Error('Legacy recovery catalog is unavailable')
        const backup = await response.json() as BeatmapLibraryBackup
        songPackage = backup.packages.map(parseSongPackage).find((item) => item.id === song.id) ?? null
        if (!songPackage) throw new Error('Legacy song package was not found')
        const sourceUrl = songPackage.song.sources.find((source) => source.url)?.url
        if (!sourceUrl) throw new Error('Choose the original audio file to restore this song')
        const matched = await companion.lookupSource(sourceUrl)
        let audio = matched.audio
        if (!audio) {
          const job = await companion.startImport(sourceUrl)
          const complete = job.state === 'complete' ? job : await companion.waitForImport(job.id, (progress) => setImportStatus(`Restoring ${song.title}: ${progress.progress}%`))
          audio = complete.audio ?? null
        }
        if (!audio) throw new Error('Could not restore the song audio')
        await packageRepository.put(songPackage)
        await packageRepository.setAudioAssociation(songPackage.id, { audioId: audio.audioId, sourceUrl, updatedAt: new Date().toISOString() })
      }
      if (!songPackage) throw new Error('Song package not found')
      const resolvedSong = await packageToImport(songPackage)
      let audioAssociation = await packageRepository.getAudioAssociation(songPackage.id)
      if (!audioAssociation) {
        const sourceUrl = songPackage.song.sources.find((source) => source.url)?.url
        if (!sourceUrl) throw new Error('Choose the original audio file to attach to this shared song')
        if (!companion.paired) throw new Error('Start and pair the companion to retrieve this shared song')
        setImportStatus(`Retrieving ${song.title} from its shared source...`)
        const matched = await companion.lookupSource(sourceUrl)
        let audio = matched.audio
        if (!audio) {
          const job = await companion.startImport(sourceUrl)
          const complete = job.state === 'complete' ? job : await companion.waitForImport(job.id, (progress) => setImportStatus(`Retrieving ${song.title}: ${progress.progress}%`))
          audio = complete.audio ?? null
        }
        if (!audio) throw new Error('Could not retrieve audio from the shared source')
        audioAssociation = { audioId: audio.audioId, sourceUrl, updatedAt: new Date().toISOString() }
        await packageRepository.setAudioAssociation(songPackage.id, audioAssociation)
      }
      setImportStatus(`Copying ${song.title} into this browser session...`)
      let audioBlob: Blob | null = null
      if (audioAssociation.storage === 'browser') {
        audioBlob = await getBrowserAudio(audioAssociation.audioId)
      } else if (companion.paired) {
        try {
          audioBlob = await companion.downloadAudio(audioAssociation.audioId)
        } catch {
          const sourceUrl = audioAssociation.sourceUrl ?? songPackage.song.sources.find((source) => source.url)?.url
          if (!sourceUrl) throw new Error('Audio is no longer available locally and this song has no downloadable source')
          setImportStatus(`Restoring ${song.title} from its source...`)
          const matched = await companion.lookupSource(sourceUrl)
          let audio = matched.audio
          if (!audio) {
            const job = await companion.startImport(sourceUrl)
            const complete = job.state === 'complete' ? job : await companion.waitForImport(job.id, (progress) => setImportStatus(`Restoring ${song.title}: ${progress.progress}%`))
            audio = complete.audio ?? null
          }
          if (!audio) throw new Error('Could not restore the song audio')
          audioAssociation = { audioId: audio.audioId, storage: 'companion', sourceUrl, updatedAt: new Date().toISOString() }
          await packageRepository.setAudioAssociation(songPackage.id, audioAssociation)
          audioBlob = await companion.downloadAudio(audio.audioId)
        }
      }
      if (!audioBlob) throw new Error(audioAssociation.storage === 'browser' ? 'Choose the original audio file to restore this song' : 'Start and pair the companion to load this song')
      if (loadSequence !== audioLoadSequence.current) return
      const nextAudioUrl = URL.createObjectURL(audioBlob)
      const previousAudioUrl = browserAudioUrl.current
      browserAudioUrl.current = nextAudioUrl
      resolvedSong.audioUrl = nextAudioUrl
      if (previousAudioUrl) URL.revokeObjectURL(previousAudioUrl)
      const requestedMapId = song.beatmapUrl.split(':').at(-1)
      const packageMap = songPackage.beatmaps.find((map) => map.id === requestedMapId) ?? songPackage.beatmaps[0]
      if (!packageMap) throw new Error('Create a beatmap before loading this song')
      const timing = songPackage.timingProfiles.find((profile) => profile.id === packageMap.timingProfileId) ?? songPackage.timingProfiles[0]
      const loadedBeatmap: Beatmap = { ...packageMap, songId: songPackage.id, bpm: timing?.bpm, beatOffsetMs: timing?.beatOffsetMs }
      if (loadSequence !== audioLoadSequence.current) return
      setImportedSong(resolvedSong)
      resetEditorHistory()
      const normalizedBeatmap = normalizeBeatmap(loadedBeatmap)
      const loadedTitle = loadedBeatmap.title ?? song.title
      const loadedDifficulty = loadedBeatmap.difficulty ?? 1
      setBeatmap(normalizedBeatmap)
      setMapTitle(loadedTitle)
      setDifficulty(loadedDifficulty)
      const nextBpm = loadedBeatmap.bpm ?? 120
      const nextBeatOffsetMs = loadedBeatmap.beatOffsetMs ?? 0
      setBpm(nextBpm)
      setBeatOffsetMs(nextBeatOffsetMs)
      setSavedEditorSignature(editorSignature(normalizedBeatmap, loadedTitle, loadedDifficulty, nextBpm, nextBeatOffsetMs))
      persistedCalibration.current = `${song.id}:${nextBpm}:${nextBeatOffsetMs}`
      calibrationHydrated.current = true
      resetGameplayPlayback()
      setLoopMarkers({ startMs: null, endMs: null })
      setImportStatus(`Loaded ${loadedBeatmap.notes.length} notes from browser storage`)
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Failed to load song')
    }
  }, [companion, packageRepository, packageToImport, resetEditorHistory, resetGameplayPlayback])

  const connectCompanion = useCallback(async ({ pairWhenAvailable = true, timeoutMs = 30_000 } = {}) => {
    const permissionBefore = await companion.permissionState()
    if (permissionBefore === 'denied') {
      setCompanionStatus('permission-blocked')
      return
    }

    setCompanionStatus('connecting')
    const requestController = new AbortController()
    const timeout = window.setTimeout(() => requestController.abort(), timeoutMs)
    try {
      await companion.status(requestController.signal)
      if (companion.paired) {
        setCompanionStatus('paired')
      } else {
        setCompanionStatus('available')
        if (pairWhenAvailable) companion.pair()
      }
    } catch {
      const permissionAfter = await companion.permissionState()
      setCompanionStatus(permissionAfter === 'denied' ? 'permission-blocked' : 'unavailable')
    } finally {
      window.clearTimeout(timeout)
    }
  }, [companion])

  useEffect(() => {
    if (!companion.paired) return
    let stopped = false

    void companion.permissionState().then((permission) => {
      if (stopped) return
      if (permission === 'denied') {
        setCompanionStatus('permission-blocked')
        if (companion.pairingReceived) setCompanionDialogOpen(true)
        return
      }
      if (companion.pairingReceived && permission !== 'granted' && permission !== 'not-required') {
        setCompanionDialogOpen(true)
        return
      }
      void connectCompanion({ pairWhenAvailable: false, timeoutMs: 5_000 })
    })

    return () => { stopped = true }
  }, [companion, connectCompanion])

  useEffect(() => { void loadImports() }, [loadImports])

  useEffect(() => () => {
    audioLoadSequence.current += 1
    if (browserAudioUrl.current) URL.revokeObjectURL(browserAudioUrl.current)
  }, [])

  useEffect(() => { localStorage.setItem(storageKey('active-tab'), activeTab) }, [activeTab])
  useEffect(() => {
    if (activeTab === 'play') resetGameplayPlayback()
  }, [activeTab, beatmap?.id, beatmap?.notes, importedSong?.id, resetGameplayPlayback])
  useEffect(() => { setRenameDraft(mapTitle) }, [mapTitle])

  useEffect(() => {
    const songId = restoredSongId.current
    if (!songId || importedSong || savedImports.length === 0) return
    const song = savedImports.find((item) => item.id === songId)
    if (!song) return
    restoredSongId.current = null
    void loadImport(song)
  }, [importedSong, loadImport, savedImports])

  useEffect(() => { localStorage.setItem(storageKey('controls'), JSON.stringify(controls)) }, [controls])

  useEffect(() => {
    if (!importedSong || !calibrationHydrated.current) return
    setBeatmap((current) => current && (current.bpm !== bpm || current.beatOffsetMs !== beatOffsetMs) ? { ...current, bpm, beatOffsetMs } : current)
    persistedCalibration.current = `${importedSong.id}:${bpm}:${beatOffsetMs}`
  }, [beatOffsetMs, beatmap?.id, bpm, importedSong])

  const gridMs = useMemo(() => {
    const straightGridMs = (60000 / bpm) * (4 / gridDivision)
    return tripletGrid ? straightGridMs * (2 / 3) : straightGridMs
  }, [bpm, gridDivision, tripletGrid])
  const keyLane = useMemo(() => Object.fromEntries(lanes.map((lane) => [controls[lane].keyboard, lane])) as Record<string, Lane>, [controls])
  const gamepadLane = useMemo(() => Object.fromEntries(lanes.map((lane) => [controls[lane].gamepadButton, lane])) as Record<number, Lane>, [controls])
  const quantizeTime = useCallback((rawTimeMs: number) => {
    if (!quantize) return rawTimeMs
    const snapped = beatOffsetMs + Math.round((rawTimeMs - beatOffsetMs) / gridMs) * gridMs
    return Math.abs(snapped - rawTimeMs) <= Math.max(35, gridMs * 0.45) ? snapped : rawTimeMs
  }, [beatOffsetMs, gridMs, quantize])

  const nextAttack = useCallback(() => {
    setLastResult(null); setLastAutoMiss(false); setFeedback(null); setLaneFeedback({}); resetScheduledNotes(); setActiveAttacks([])
  }, [resetScheduledNotes])

  const parry = useCallback((lane: BeatmapNote['lane'] = 'mid') => {
    const inputTimeMs = performance.now()
    const laneAttacks = activeAttacks.filter((attack) => (attack.lane ?? 'mid') === lane)
    const catchableHold = laneAttacks.find((attack) => (attack.durationMs ?? 0) > 0 && !attack.holdStarted && inputTimeMs > attack.impactMs + tuning.parryWindowMs && inputTimeMs < attack.impactMs + (attack.durationMs ?? 0))
    const target = catchableHold ?? laneAttacks.filter((attack) => !attack.initialMissed).reduce<Attack | null>((best, attack) => !best || Math.abs(attack.impactMs - inputTimeMs) < Math.abs(best.impactMs - inputTimeMs) ? attack : best, null)
    if (!target) return
    const timingResult = judgeParryTiming({ inputTimeMs, impactTimeMs: target.impactMs, ...tuning })
    const result: ParryTimingResult = catchableHold ? { ...timingResult, success: true, grade: 'good' } : timingResult
    setLastResult(result); setLastAutoMiss(false)
    const kind: FeedbackEvent['kind'] = result.success ? (result.grade === 'perfect' ? 'perfect-parry' : 'good-parry') : 'miss'
    const nextFeedback = { id: Math.random(), kind, startedAtMs: inputTimeMs, lane, deltaMs: result.deltaMs, strength: target.strength }
    setFeedback(nextFeedback)
    setLaneFeedback((current) => ({ ...current, [lane]: nextFeedback }))
    if (result.success) {
      setStats((s) => ({ ...s, hit: s.hit + 1, perfect: s.perfect + (result.grade === 'perfect' ? 1 : 0), good: s.good + (result.grade === 'good' ? 1 : 0), streak: s.streak + 1, bestStreak: Math.max(s.bestStreak, s.streak + 1) }))
      setCollectedNotes((counts) => ({ ...counts, [lane]: counts[lane] + 1 }))
      setActiveAttacks((attacks) => (target.durationMs ?? 0) > 0
        ? attacks.map((attack) => attack.id === target.id ? { ...attack, holdStarted: true } : attack)
        : attacks.filter((attack) => attack.id !== target.id))
    } else {
      setStats((s) => ({ ...s, streak: 0 }))
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
        setHeldPlayLanes((held) => new Set(held).add(lane))
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
      if (lane) setHeldPlayLanes((held) => { const next = new Set(held); next.delete(lane); return next })
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
    let frameId = 0
    const pollGamepad = () => {
      frameId = window.requestAnimationFrame(pollGamepad)
      const gamepad = navigator.getGamepads?.().find(Boolean)
      if (!gamepad) return
      const pressed = new Set<number>()
      gamepad.buttons.forEach((button, index) => { if (button.pressed) pressed.add(index) })
      pressed.forEach((buttonIndex) => {
        if (previousGamepadButtons.current.has(buttonIndex)) return
        const lane = gamepadLane[buttonIndex]
        if (!lane) return
        setPadTriggers((triggers) => ({ ...triggers, [lane]: performance.now() }))
        setHeldPlayLanes((held) => new Set(held).add(lane))
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
        if (lane) setHeldPlayLanes((held) => { const next = new Set(held); next.delete(lane); return next })
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
    }
    frameId = window.requestAnimationFrame(pollGamepad)
    return () => window.cancelAnimationFrame(frameId)
  }, [armedLanes, gamepadLane, isRecording, parry, quantize, quantizeTime, tapMode])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      setActiveAttacks((attacks) => {
        const expired = attacks.filter((attack) => !attack.holdStarted && !attack.initialMissed && now >= attack.impactMs + tuning.parryWindowMs)
        if (isSongPlaying && expired.length > 0) {
          setStats((s) => ({ ...s, missed: s.missed + expired.length, streak: 0 }))
          setLastResult(null)
          setLastAutoMiss(true)
          const missedFeedback = expired.map((attack) => ({ id: Math.random(), kind: 'miss' as const, startedAtMs: now, lane: attack.lane, strength: attack.strength }))
          setFeedback(missedFeedback[0] ?? null)
          setLaneFeedback((current) => {
            const next = { ...current }
            missedFeedback.forEach((event) => { if (event.lane) next[event.lane] = event })
            return next
          })
        }
        const expiredIds = new Set(expired.map((attack) => attack.id))
        return attacks
          .map((attack) => expiredIds.has(attack.id) ? { ...attack, initialMissed: true } : attack)
          .filter((attack) => now < attack.impactMs + ((attack.durationMs ?? 0) > 0 ? (attack.durationMs ?? 0) : isSongPlaying ? (attack.initialMissed || expiredIds.has(attack.id) ? missedProjectileLingerMs : tuning.parryWindowMs) : tuning.recoveryMs + 700))
      })
    }, 100)
    return () => window.clearInterval(timer)
  }, [isSongPlaying, tuning])

  useEffect(() => {
    const loopEndEpsilonMs = 0.5
    const loopSeekGuardMs = 6
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio || audio.paused || !isSongPlaying || !importedSong || !beatmap) return
      const now = performance.now()
      if (now - playbackResetAt.current < 60) return
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
      if (now - lastUiTimePublishAt.current >= 16) {
        lastUiTimePublishAt.current = now
        setSongTimeMs(songTimeMs)
        if (activeTab === 'editor') setTimelineCenterMs(songTimeMs)
      }
      const schedulerStartedAt = performance.now()
      const { dueNotes, examinedNotes } = findDueNotes({
        notes: beatmap.notes,
        songTimeMs,
        spawnLeadMs: tuning.telegraphMs,
        scheduledKeys: scheduledNoteIds.current,
        ...(hasLoop ? { loopStartMs, loopEndMs: loopEndMs - loopEndEpsilonMs, loopCycle: loopCycle.current } : {}),
      })
      runtimeMetrics.recordScheduler(performance.now() - schedulerStartedAt, examinedNotes)
      if (dueNotes.length === 0) return
      setLastResult(null); setLastAutoMiss(false)
      setActiveAttacks((attacks) => {
        const activeScheduleKeys = new Set(attacks.map((attack) => attack.scheduleKey).filter(Boolean))
        const attacksToAdd = dueNotes.filter(({ scheduleKey }) => !activeScheduleKeys.has(scheduleKey))
        attacksToAdd.forEach(({ scheduleKey }) => scheduledNoteIds.current.add(scheduleKey))
        return [...attacks, ...attacksToAdd.map(({ note, timeUntilImpactMs, scheduleKey }) => makeBeatmapAttack(timeUntilImpactMs, note.lane, note.durationMs, note.id, scheduleKey, note.strength, syncopationAmount(note.impactTimeMs, bpm, beatOffsetMs)))]
          .filter((attack) => (attack.durationMs ?? 0) > 0
            ? now < attack.impactMs + (attack.durationMs ?? 0)
            : attack.impactMs >= now - (attack.initialMissed ? missedProjectileLingerMs : tuning.parryWindowMs))
          .sort((a, b) => a.impactMs - b.impactMs)
          .slice(0, 12)
      })
    }, 10)
    return () => window.clearInterval(timer)
  }, [activeTab, beatOffsetMs, beatmap, bpm, importedSong, isSongPlaying, loopMarkers, tuning.parryWindowMs, tuning.telegraphMs])

  const createPackageForAudio = useCallback(async (audio: CompanionAudio, sourceUrl?: string, browserAudio?: Blob) => {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const mapId = 'custom-1'
    const songPackage: SongPackage = {
      schema: SONG_PACKAGE_SCHEMA,
      schemaVersion: SONG_PACKAGE_VERSION,
      id,
      song: { id, title: audio.title, durationMs: audio.durationMs, sources: sourceUrl ? [{ kind: 'youtube', url: sourceUrl }] : [{ kind: 'file-description', label: audio.title }] },
      timingProfiles: [{ id: 'default', name: 'Default', bpm: 120, beatOffsetMs: 0, timeSignature: [4, 4] }],
      beatmaps: [{ id: mapId, title: `${audio.title} custom`, difficulty: 1, timingProfileId: 'default', durationMs: audio.durationMs, notes: [], version: 1, createdAt: now, updatedAt: now }],
      defaultTimingProfileId: 'default',
      createdAt: now,
      updatedAt: now,
    }
    if (browserAudio) await putBrowserAudio(audio.audioId, browserAudio)
    await packageRepository.put(songPackage)
    await packageRepository.setAudioAssociation(id, { audioId: audio.audioId, storage: browserAudio ? 'browser' : 'companion', ...(sourceUrl ? { sourceUrl } : {}), updatedAt: now })
    const imported = await packageToImport(songPackage)
    await loadImport(imported)
    await loadImports()
    return imported
  }, [loadImport, loadImports, packageRepository, packageToImport])

  const importYoutube = useCallback(async () => {
    const url = youtubeUrl.trim(); if (!url) return
    if (companionStatus !== 'paired') {
      setImportStatus('Connect Beat Fiend Companion to import YouTube audio.')
      setCompanionDialogOpen(true)
      return
    }
    setImportStatus('Starting local companion import...')
    try {
      const initial = await companion.startImport(url)
      setActiveImportJobId(initial.id)
      const complete = initial.state === 'complete' ? initial : await companion.waitForImport(initial.id, (job) => setImportStatus(`Importing locally: ${job.progress}%`))
      if (!complete.audio) throw new Error('Companion did not return audio')
      await createPackageForAudio(complete.audio, complete.audio.sourceUrl ?? url)
      setImportStatus(complete.cached ? 'Reused cached companion audio and created a custom map.' : 'Imported audio locally and created a custom map.')
    } catch (error) { setImportStatus(error instanceof Error ? error.message : String(error)) }
    finally { setActiveImportJobId(null) }
  }, [companion, companionStatus, createPackageForAudio, youtubeUrl])

  const cancelCompanionImport = useCallback(async () => {
    if (!activeImportJobId) return
    try { await companion.cancelImport(activeImportJobId); setImportStatus('Import cancelled.') }
    catch (error) { setImportStatus(error instanceof Error ? error.message : 'Could not cancel import') }
    finally { setActiveImportJobId(null) }
  }, [activeImportJobId, companion])

  const importLocalAudio = useCallback(async (file: File) => {
    const useCompanion = companionStatus === 'paired'
    setImportStatus(useCompanion ? 'Copying audio into the local companion...' : 'Saving audio in this browser...')
    try {
      if (useCompanion) {
        const { audio } = await companion.uploadFile(file)
        await createPackageForAudio(audio)
      } else {
        const objectUrl = URL.createObjectURL(file)
        const durationMs = await new Promise<number>((resolve, reject) => {
          const audioElement = new Audio()
          audioElement.preload = 'metadata'
          audioElement.onloadedmetadata = () => resolve(Number.isFinite(audioElement.duration) ? audioElement.duration * 1000 : 0)
          audioElement.onerror = () => reject(new Error('The browser could not read this audio file'))
          audioElement.src = objectUrl
        }).finally(() => URL.revokeObjectURL(objectUrl))
        const audio: CompanionAudio = { audioId: crypto.randomUUID(), title: file.name, durationMs, contentType: file.type || 'application/octet-stream', size: file.size }
        await createPackageForAudio(audio, undefined, file)
      }
      setImportStatus('Local audio attached. Add timing and custom notes in the editor.')
    } catch (error) { setImportStatus(error instanceof Error ? error.message : 'Local file import failed') }
  }, [companion, companionStatus, createPackageForAudio])

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
    checkpointEditor()
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
  }, [armedLanes, checkpointEditor, recordMode, recordStartMs, recordedNotes, resetScheduledNotes])

  useEffect(() => {
    if (activeTab === 'editor' || !isRecording) return
    setIsRecording(false)
    setRecordedNotes([])
    heldStarts.current = {}
  }, [activeTab, isRecording])

  const saveBeatmap = useCallback(async (saveAsNew = false, overrides?: { title?: string; difficulty?: number }) => {
    if (!beatmap || !importedSong) return false
    const titleToSave = overrides?.title ?? mapTitle
    const difficultyToSave = overrides?.difficulty ?? difficulty
    try {
      const id = saveAsNew ? `${titleToSave.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}` : beatmap.id
      const editable = { ...beatmap, id, title: titleToSave, difficulty: difficultyToSave, bpm, beatOffsetMs, songId: importedSong.id, source: 'manual' }
      setImportStatus(`Saving ${titleToSave}...`)
      const songPackage = await packageRepository.get(importedSong.id)
        if (!songPackage) throw new Error('Song package not found')
        const now = new Date().toISOString()
        const currentProfileId = songPackage.beatmaps.find((map) => map.id === beatmap.id)?.timingProfileId ?? songPackage.defaultTimingProfileId
        const currentProfile = songPackage.timingProfiles.find((profile) => profile.id === currentProfileId)
        const sharedProfile = songPackage.beatmaps.some((map) => map.id !== beatmap.id && map.timingProfileId === currentProfileId)
        const needsOwnProfile = saveAsNew || (sharedProfile && (currentProfile?.bpm !== bpm || currentProfile?.beatOffsetMs !== beatOffsetMs))
        const timingProfileId = needsOwnProfile ? `timing-${Date.now().toString(36)}` : currentProfileId
        const nextMap = { id, title: titleToSave, difficulty: Math.min(5, Math.max(1, Math.round(difficultyToSave))) as 1 | 2 | 3 | 4 | 5, timingProfileId, durationMs: editable.durationMs, notes: editable.notes, version: (saveAsNew ? 0 : beatmap.version ?? 0) + 1, createdAt: saveAsNew ? now : songPackage.beatmaps.find((map) => map.id === id)?.createdAt ?? now, updatedAt: now }
        const maps = [...songPackage.beatmaps.filter((map) => map.id !== id), nextMap]
        const profiles = needsOwnProfile
          ? [...songPackage.timingProfiles, { id: timingProfileId, name: `${titleToSave} timing`, bpm, beatOffsetMs, timeSignature: currentProfile?.timeSignature ?? [4, 4] as [number, number] }]
          : songPackage.timingProfiles.map((profile) => profile.id === timingProfileId ? { ...profile, bpm, beatOffsetMs } : profile)
        const nextPackage = { ...songPackage, beatmaps: maps, timingProfiles: profiles, updatedAt: now }
        await packageRepository.put(nextPackage)
        const nextImport = await packageToImport(nextPackage)
        setImportedSong({ ...nextImport, beatmapUrl: `package:${nextPackage.id}:${id}` })
        const savedBeatmap = normalizeBeatmap({ ...editable, version: nextMap.version })
        setBeatmap(savedBeatmap)
        setSavedEditorSignature(editorSignature(savedBeatmap, titleToSave, difficultyToSave, bpm, beatOffsetMs))
        setSongBeatmaps(nextImport.beatmaps ?? [])
        setSavedImports((imports) => imports.map((song) => song.id === importedSong.id ? nextImport : song))
        setImportStatus(`Saved ${titleToSave} v${nextMap.version} in browser storage`)
        return true
    } catch (error) {
      setImportStatus(error instanceof Error ? `Save failed: ${error.message}` : 'Save failed')
      return false
    }
  }, [beatOffsetMs, beatmap, bpm, difficulty, importedSong, mapTitle, packageRepository, packageToImport])

  const loadBeatmap = useCallback(async (mapId: string) => {
    resetGameplayPlayback()
    const map = songBeatmaps.find((item) => item.id === mapId)
    if (!map) return
    try {
      setImportStatus(`Loading ${map.title}...`)
      const songPackage = await packageRepository.get(importedSong?.id ?? '')
      const packageMap = songPackage?.beatmaps.find((item) => item.id === mapId)
      if (!songPackage || !packageMap) throw new Error('Beatmap not found in browser storage')
      const timing = songPackage.timingProfiles.find((profile) => profile.id === packageMap.timingProfileId) ?? songPackage.timingProfiles[0]
      const loaded: Beatmap = { ...packageMap, songId: songPackage.id, bpm: timing?.bpm, beatOffsetMs: timing?.beatOffsetMs }
      setImportedSong((song) => song ? { ...song, beatmapUrl: map.url } : song)
      resetEditorHistory()
      const normalizedBeatmap = normalizeBeatmap(loaded)
      const loadedDifficulty = loaded.difficulty ?? 1
      setBeatmap(normalizedBeatmap)
      setMapTitle(loaded.title)
      setDifficulty(loadedDifficulty)
      const songId = loaded.songId ?? importedSong?.id
      const nextBpm = loaded.bpm ?? 120
      const nextBeatOffsetMs = loaded.beatOffsetMs ?? 0
      setBpm(nextBpm)
      setBeatOffsetMs(nextBeatOffsetMs)
      setSavedEditorSignature(editorSignature(normalizedBeatmap, loaded.title, loadedDifficulty, nextBpm, nextBeatOffsetMs))
      if (songId) persistedCalibration.current = `${songId}:${nextBpm}:${nextBeatOffsetMs}`
      resetGameplayPlayback()
      setImportStatus(`Loaded ${loaded.title ?? map.title} v${loaded.version ?? 0}`)
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Failed to load beatmap')
    }
  }, [importedSong, packageRepository, resetEditorHistory, resetGameplayPlayback, songBeatmaps])

  const refreshSaveState = useCallback(async () => {
    await loadImports()
    if (beatmap?.id) await loadBeatmap(beatmap.id)
    setImportStatus('Reloaded save state from disk')
  }, [beatmap?.id, loadBeatmap, loadImports])

  const deleteBeatmap = useCallback(async () => {
    if (!beatmap || !importedSong) return
    const deletedTitle = mapTitle
    try {
      const songPackage = await packageRepository.get(importedSong.id)
        if (!songPackage) throw new Error('Song package not found')
        const now = new Date().toISOString()
        let maps = songPackage.beatmaps.filter((map) => map.id !== beatmap.id)
        if (maps.length === 0) maps = [{ id: `new-${Date.now().toString(36)}`, title: `${importedSong.title} custom`, difficulty: 1, timingProfileId: songPackage.defaultTimingProfileId, durationMs: importedSong.durationMs, notes: [], version: 0, createdAt: now, updatedAt: now }]
        const nextPackage = { ...songPackage, beatmaps: maps, updatedAt: now }
        await packageRepository.put(nextPackage)
        const nextImport = await packageToImport(nextPackage)
        setImportedSong(nextImport)
        setSongBeatmaps(nextImport.beatmaps ?? [])
        setSavedImports((imports) => imports.map((song) => song.id === importedSong.id ? nextImport : song))
        const next = maps[0]
        const nextBeatmap = normalizeBeatmap({ ...next, songId: importedSong.id, bpm, beatOffsetMs })
        setBeatmap(nextBeatmap)
        setSavedEditorSignature(editorSignature(nextBeatmap, next.title, next.difficulty, bpm, beatOffsetMs))
        setMapTitle(next.title)
        setDifficulty(next.difficulty)
        setDeleteOpen(false)
        setImportStatus(`Deleted ${deletedTitle}`)
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Delete failed')
    }
  }, [beatOffsetMs, beatmap, bpm, importedSong, mapTitle, packageRepository, packageToImport])

  const createBlankBeatmap = useCallback(() => {
    if (!importedSong || !confirmDiscardChanges()) return
    resetEditorHistory()
    const title = `${importedSong.title} custom`
    setBeatmap({ id: `new-${Date.now().toString(36)}`, songId: importedSong.id, title, difficulty, bpm, beatOffsetMs, durationMs: importedSong.durationMs, notes: [] })
    setSavedEditorSignature(null)
    setMapTitle(title)
    setRecordedNotes([])
    resetScheduledNotes()
  }, [beatOffsetMs, bpm, confirmDiscardChanges, difficulty, importedSong, resetEditorHistory, resetScheduledNotes])
  const applyRenameBeatmap = useCallback((title = renameDraft) => {
    if (!beatmap) return
    const nextTitle = title.trim()
    if (!nextTitle) return
    checkpointEditor()
    setMapTitle(nextTitle)
    setRenameDraft(nextTitle)
    setBeatmap((current) => current ? { ...current, title: nextTitle } : current)
    setSongBeatmaps((maps) => maps.map((map) => map.id === beatmap.id ? { ...map, title: nextTitle } : map))
    setSavedImports((imports) => imports.map((song) => song.id === importedSong?.id ? { ...song, beatmaps: song.beatmaps?.map((map) => map.id === beatmap.id ? { ...map, title: nextTitle } : map) } : song))
    setRenameOpen(false)
  }, [beatmap, checkpointEditor, importedSong?.id, renameDraft])
  const setBeatmapDifficulty = useCallback((nextDifficulty: number) => {
    if (!beatmap) return
    const clampedDifficulty = Math.min(5, Math.max(1, Math.round(nextDifficulty)))
    checkpointEditor('difficulty')
    setDifficulty(clampedDifficulty)
    setBeatmap((current) => current ? { ...current, difficulty: clampedDifficulty } : current)
    setSongBeatmaps((maps) => maps.map((map) => map.id === beatmap.id ? { ...map, difficulty: clampedDifficulty } : map))
    setSavedImports((imports) => imports.map((song) => song.id === importedSong?.id ? { ...song, beatmaps: song.beatmaps?.map((map) => map.id === beatmap.id ? { ...map, difficulty: clampedDifficulty } : map) } : song))
  }, [beatmap, checkpointEditor, importedSong?.id])

  const clearBeatmapEvents = useCallback(() => {
    checkpointEditor()
    setBeatmap((current) => current ? { ...current, notes: [] } : current)
    setRecordedNotes([])
    resetScheduledNotes()
  }, [checkpointEditor, resetScheduledNotes])

  const exportLibrary = useCallback(async () => {
    try {
      const summaries = await packageRepository.list()
      const packages = (await Promise.all(summaries.map((summary) => packageRepository.get(summary.id)))).filter((item): item is SongPackage => item !== null)
      const backup: BeatmapLibraryBackup = { schema: 'beat-fiend/library-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), packages }
      downloadJson(backup, `beat-fiend-library-${new Date().toISOString().slice(0, 10)}.json`)
      setImportStatus(`Exported ${packages.length} song package${packages.length === 1 ? '' : 's'}`)
    } catch (error) {
      setImportStatus(error instanceof Error ? `Library export failed: ${error.message}` : 'Library export failed')
    }
  }, [packageRepository])

  const exportSharedBeatmap = useCallback(async () => {
    if (hasUnsavedChanges && !await saveBeatmap(false)) return
    try {
      if (!importedSong || !beatmap) throw new Error('Choose a beatmap to export')
      const songPackage = await packageRepository.get(importedSong.id)
      if (!songPackage) throw new Error('Song package not found')
      const selectedMap = songPackage.beatmaps.find((item) => item.id === beatmap.id)
      if (!selectedMap) throw new Error('Save this beatmap before exporting it')
      const profile = songPackage.timingProfiles.find((item) => item.id === selectedMap.timingProfileId)
      if (!profile) throw new Error('Beatmap timing profile not found')
      const portableSong = { ...songPackage, beatmaps: [selectedMap], timingProfiles: [profile], defaultTimingProfileId: profile.id }
      const bundle = createShareBundle({ title: `${songPackage.song.title} · ${selectedMap.title}`, songs: [portableSong] })
      const slug = `${songPackage.song.title}-${selectedMap.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'beat-fiend-beatmap'
      downloadJson(bundle, `${slug}.beat-fiend.json`)
      setImportStatus(`Exported ${selectedMap.title} for sharing`)
    } catch (error) {
      setImportStatus(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed')
    }
  }, [beatmap, hasUnsavedChanges, importedSong, packageRepository, saveBeatmap])

  const importSharedBundle = useCallback(async (file: File) => {
    try {
      const value: unknown = JSON.parse(await file.text())
      const bundle = parseShareBundle(value)
      if (bundle.songs.length !== 1 || bundle.songs[0].beatmaps.length !== 1) throw new Error('Choose a single-song, single-difficulty Beat Fiend export')
      const existingIds = new Set((await packageRepository.list()).map((summary) => summary.id))
      const replacementCount = bundle.songs.filter((songPackage) => existingIds.has(songPackage.id)).length
      if (replacementCount > 0 && !window.confirm(`Replace ${replacementCount} existing song package${replacementCount === 1 ? '' : 's'} from this share?`)) return
      await Promise.all(bundle.songs.map((songPackage) => packageRepository.put(songPackage)))
      await loadImports()
      setImportStatus(`Imported ${bundle.title}: ${bundle.songs.length} song${bundle.songs.length === 1 ? '' : 's'}, audio will be retrieved from each shared source when played`)
    } catch (error) {
      setImportStatus(error instanceof Error ? `Share import failed: ${error.message}` : 'Share import failed')
    }
  }, [loadImports, packageRepository])

  const importLibrary = useCallback(async (file: File) => {
    try {
      const value: unknown = JSON.parse(await file.text())
      const candidates = typeof value === 'object' && value !== null && 'schema' in value && value.schema === 'beat-fiend/library-backup'
        ? ('packages' in value && Array.isArray(value.packages) ? value.packages : (() => { throw new Error('Backup has no packages') })())
        : typeof value === 'object' && value !== null && 'schema' in value && value.schema === SHARE_BUNDLE_SCHEMA
          ? parseShareBundle(value).songs
          : [value]
      const packages = candidates.map(parseSongPackage)
      const existingIds = new Set((await packageRepository.list()).map((summary) => summary.id))
      const replacementCount = packages.filter((songPackage) => existingIds.has(songPackage.id)).length
      if (replacementCount > 0 && !window.confirm(`Replace ${replacementCount} existing song package${replacementCount === 1 ? '' : 's'} with the imported backup?`)) return
      for (const songPackage of packages) await packageRepository.put(songPackage)
      await loadImports()
      setImportStatus(`Imported ${packages.length} song package${packages.length === 1 ? '' : 's'} into browser storage`)
    } catch (error) {
      setImportStatus(error instanceof Error ? `Library import failed: ${error.message}` : 'Library import failed')
    }
  }, [loadImports, packageRepository])

  const seekSong = useCallback((timeMs: number) => {
    const audio = audioRef.current
    const durationMs = importedSong?.durationMs ?? beatmap?.durationMs ?? 0
    const nextTimeMs = Math.min(Math.max(0, timeMs), durationMs || Math.max(0, timeMs))
    if (audio) audio.currentTime = nextTimeMs / 1000
    setSongTimeMs(nextTimeMs)
    resetGameplayPlayback()
  }, [beatmap?.durationMs, importedSong?.durationMs, resetGameplayPlayback])
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
  const removeLoopMarker = useCallback((marker: 'start' | 'end') => {
    setLoopMarkers((current) => marker === 'start' ? { ...current, startMs: null } : { ...current, endMs: null })
  }, [])
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
  const playSong = useCallback(() => {
    resetGameplayPlayback()
    void audioRef.current?.play()
  }, [resetGameplayPlayback])
  const pauseSong = useCallback(() => { audioRef.current?.pause() }, [])
  const seekRelativeSong = useCallback((deltaMs: number) => seekSong(songTimeMs + deltaMs), [seekSong, songTimeMs])
  const restartSong = useCallback((fromLoopStart = false) => {
    const audio = audioRef.current
    if (!audio) return
    const restartMs = Math.max(0, fromLoopStart ? loopMarkers.startMs ?? 0 : 0)
    audio.currentTime = restartMs / 1000
    setSongTimeMs(restartMs)
    setTimelineCenterMs(restartMs)
    resetGameplayPlayback()
    setStats({ hit: 0, perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 })
    setCollectedNotes(createLaneCounts())
    setLastResult(null)
    setLastAutoMiss(false)
    void audio.play()
  }, [loopMarkers.startMs, resetGameplayPlayback])

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
  const timelineNotes = useMemo(() => {
    const recordingPreviews = isRecording ? lanes.flatMap((lane) => {
      const startMs = heldStarts.current[lane]
      if (startMs === undefined || !heldPlayLanes.has(lane)) return []
      return [{
        id: `recording-preview-${lane}`,
        impactTimeMs: startMs,
        rawTimeMs: startMs,
        durationMs: Math.max(50, songTimeMs - startMs),
        lane,
        strength: 1,
        source: 'recording-preview',
        pending: true,
        recording: true,
      }]
    }) : []
    return [
      ...(beatmap?.notes.map((note) => ({ ...note, pending: false })) ?? []),
      ...(isRecording ? recordedNotes.map((note) => ({ ...note, pending: true })) : []),
      ...recordingPreviews,
    ].sort((a, b) => a.impactTimeMs - b.impactTimeMs)
  }, [beatmap?.notes, heldPlayLanes, isRecording, recordedNotes, songTimeMs])
  const zoomOptions = useMemo(() => [1, 2, 4, 8, 16, 30, 60] as const, [])
  const timelineBounds = useMemo(() => {
    if (activeTab !== 'editor') return { startMs: songTimeMs - 5000, endMs: songTimeMs + 5000, spanMs: 10000 }
    if (timelineZoomSeconds === 'fit' && importedSong) return { startMs: 0, endMs: importedSong.durationMs, spanMs: Math.max(1, importedSong.durationMs) }
    const spanMs = (timelineZoomSeconds === 'fit' ? 60 : timelineZoomSeconds * 2) * 1000
    const durationMs = importedSong?.durationMs
    const maxStartMs = durationMs ? Math.max(0, durationMs - spanMs) : Number.POSITIVE_INFINITY
    const startMs = Math.min(Math.max(0, timelineCenterMs - spanMs / 2), maxStartMs)
    return { startMs, endMs: startMs + spanMs, spanMs }
  }, [activeTab, importedSong, songTimeMs, timelineCenterMs, timelineZoomSeconds])
  const maximumHoldDurationMs = useMemo(() => timelineNotes.reduce((maximum, note) => Math.max(maximum, note.durationMs ?? 0), 0), [timelineNotes])
  const visibleTimelineNotes = useMemo(() => windowTimelineNotes(
    timelineNotes,
    timelineBounds.startMs,
    timelineBounds.endMs,
    selectedNoteIds,
    2500,
    maximumHoldDurationMs,
  ), [maximumHoldDurationMs, selectedNoteIds, timelineBounds.endMs, timelineBounds.startMs, timelineNotes])
  const removeNote = useCallback((noteId: string) => {
    checkpointEditor()
    setBeatmap((current) => current ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) } : current)
    setRecordedNotes((notes) => notes.filter((note) => note.id !== noteId))
    setSelectedNoteIds((ids) => {
      if (!ids.has(noteId)) return ids
      const next = new Set(ids)
      next.delete(noteId)
      return next
    })
    scheduledNoteIds.current.delete(noteId)
  }, [checkpointEditor])
  const deleteSelection = useCallback(() => {
    if (selectedNoteIds.size === 0) return
    checkpointEditor()
    setBeatmap((current) => current ? { ...current, notes: current.notes.filter((note) => !selectedNoteIds.has(note.id)) } : current)
    setRecordedNotes((notes) => notes.filter((note) => !selectedNoteIds.has(note.id)))
    selectedNoteIds.forEach((id) => scheduledNoteIds.current.delete(id))
    setSelectedNoteIds(new Set())
  }, [checkpointEditor, selectedNoteIds])
  const selectedNotes = useMemo(() => [...(beatmap?.notes ?? []), ...recordedNotes].filter((note) => selectedNoteIds.has(note.id)), [beatmap?.notes, recordedNotes, selectedNoteIds])
  const selectedNotesAreHeavy = selectedNotes.length > 0 && selectedNotes.every((note) => note.strength >= 2)
  const toggleHeavySelection = useCallback(() => {
    if (selectedNoteIds.size === 0) return
    checkpointEditor('note-strength')
    const strength = selectedNotesAreHeavy ? 1 : 2
    const update = (note: BeatmapNote) => selectedNoteIds.has(note.id) ? { ...note, strength } : note
    setBeatmap((current) => current ? { ...current, notes: current.notes.map(update) } : current)
    setRecordedNotes((notes) => notes.map(update))
    selectedNoteIds.forEach((id) => scheduledNoteIds.current.delete(id))
  }, [checkpointEditor, selectedNoteIds, selectedNotesAreHeavy])
  const copySelection = useCallback(() => {
    const selected = selectedNotes.toSorted((a, b) => a.impactTimeMs - b.impactTimeMs)
    setCopiedNotes(selected.map((note) => ({ ...note })))
  }, [selectedNotes])
  const pasteSelectionAtPlayhead = useCallback(() => {
    if (!beatmap || copiedNotes.length === 0) return
    checkpointEditor()
    const anchorMs = copiedNotes[0].impactTimeMs
    const pasteStartMs = Math.max(0, snapTimelineTime(songTimeMs))
    const songEndMs = importedSong?.durationMs ?? beatmap.durationMs
    const pastedIds = new Set<string>()
    const pasted = copiedNotes.flatMap((note, index) => {
      const offsetMs = note.impactTimeMs - anchorMs
      const impactTimeMs = pasteStartMs + offsetMs
      if (impactTimeMs > songEndMs) return []
      const id = `paste-${Date.now()}-${index}-${note.id}`
      pastedIds.add(id)
      return [{ ...note, id, impactTimeMs, rawTimeMs: (note.rawTimeMs ?? note.impactTimeMs) + (pasteStartMs - anchorMs), source: `${note.source}-paste` }]
    })
    if (pasted.length === 0) return
    setBeatmap((current) => {
      if (!current) return current
      const merged = [...current.notes]
      pasted.forEach((copy) => {
        const duplicate = merged.some((note) => note.lane === copy.lane && Math.abs(note.impactTimeMs - copy.impactTimeMs) < Math.max(30, gridMs * 0.25))
        if (!duplicate) merged.push(copy)
      })
      return { ...current, notes: merged.sort((a, b) => a.impactTimeMs - b.impactTimeMs) }
    })
    setSelectedNoteIds(pastedIds)
  }, [beatmap, checkpointEditor, copiedNotes, gridMs, importedSong?.durationMs, snapTimelineTime, songTimeMs])
  const insertNoteCopies = useCallback((copies: BeatmapNote[]) => {
    if (copies.length === 0) return
    checkpointEditor()
    const copiedIds = new Set(copies.map((note) => note.id))
    setBeatmap((current) => {
      if (!current) return current
      const merged = [...current.notes]
      copies.forEach((copy) => {
        const duplicate = merged.some((note) => note.lane === copy.lane && Math.abs(note.impactTimeMs - copy.impactTimeMs) < Math.max(30, gridMs * 0.25))
        if (!duplicate) merged.push(copy)
      })
      return { ...current, notes: merged.sort((a, b) => a.impactTimeMs - b.impactTimeMs) }
    })
    setSelectedNoteIds(copiedIds)
  }, [checkpointEditor, gridMs])
  const duplicateSelection = useCallback(() => {
    if (!beatmap) return
    const songEndMs = importedSong?.durationMs ?? beatmap.durationMs
    const plan = planSmartDuplicate({
      notes: [...beatmap.notes, ...recordedNotes],
      selectedNoteIds,
      playheadMs: songTimeMs,
      bpm,
      beatOffsetMs,
      songEndMs,
    })
    if (!plan) return

    const duplicateTimestamp = Date.now()
    insertNoteCopies(plan.sourceNotes.flatMap((note, index) => {
      const impactTimeMs = note.impactTimeMs + plan.shiftMs
      if (impactTimeMs > songEndMs) return []
      return [{
        ...note,
        id: `duplicate-${duplicateTimestamp}-${index}-${note.id}`,
        impactTimeMs,
        rawTimeMs: (note.rawTimeMs ?? note.impactTimeMs) + plan.shiftMs,
        source: `${note.source}-duplicate`,
      }]
    }))
  }, [beatOffsetMs, beatmap, bpm, importedSong?.durationMs, insertNoteCopies, recordedNotes, selectedNoteIds, songTimeMs])
  const syncFollowingPatterns = useCallback(() => {
    if (!beatmap || selectedNoteIds.size === 0) return
    const plan = planPatternSync({
      notes: [...beatmap.notes, ...recordedNotes],
      selectedNoteIds,
      bpm,
      beatOffsetMs,
      songEndMs: importedSong?.durationMs ?? beatmap.durationMs,
    })
    if (!plan) return

    checkpointEditor()
    const updatesById = new Map(plan.updates.map((note) => [note.id, note]))
    const applyUpdates = (notes: BeatmapNote[]) => notes
      .map((note) => updatesById.get(note.id) ?? note)
      .sort((a, b) => a.impactTimeMs - b.impactTimeMs)
    setBeatmap((current) => current ? { ...current, notes: applyUpdates(current.notes) } : current)
    setRecordedNotes(applyUpdates)
    plan.updates.forEach((note) => scheduledNoteIds.current.delete(note.id))
  }, [beatOffsetMs, beatmap, bpm, checkpointEditor, importedSong?.durationMs, recordedNotes, selectedNoteIds])
  const selectLaneNotes = useCallback((lane: Lane) => {
    const ids = new Set<string>()
    const playheadMs = Math.max(0, songTimeMs)
    beatmap?.notes.forEach((note) => { if (note.lane === lane && note.impactTimeMs >= playheadMs) ids.add(note.id) })
    recordedNotes.forEach((note) => { if (note.lane === lane && note.impactTimeMs >= playheadMs) ids.add(note.id) })
    setSelectedNoteIds(ids)
  }, [beatmap?.notes, recordedNotes, songTimeMs])
  const moveNote = useCallback((noteId: string, rawTimeMs: number, lane: Lane, bypassSnap = false) => {
    const allNotes = [...(beatmap?.notes ?? []), ...recordedNotes]
    const source = allNotes.find((note) => note.id === noteId)
    if (!source) return
    checkpointEditor(`move:${noteId}`)
    const selectedIds = selectedNoteIds.has(noteId) ? selectedNoteIds : new Set([noteId])
    const impactTimeMs = Math.max(0, snapTimelineTime(rawTimeMs, bypassSnap))
    const timeDeltaMs = impactTimeMs - source.impactTimeMs
    const laneDelta = lanes.indexOf(lane) - lanes.indexOf(source.lane)
    const move = (note: BeatmapNote): BeatmapNote => {
      if (!selectedIds.has(note.id)) return note
      const nextLane = lanes[Math.min(lanes.length - 1, Math.max(0, lanes.indexOf(note.lane) + laneDelta))]
      const nextImpactTimeMs = Math.max(0, note.impactTimeMs + timeDeltaMs)
      return { ...note, rawTimeMs: (note.rawTimeMs ?? note.impactTimeMs) + timeDeltaMs, impactTimeMs: nextImpactTimeMs, lane: nextLane }
    }
    setBeatmap((current) => current ? { ...current, notes: current.notes.map(move).sort((a, b) => a.impactTimeMs - b.impactTimeMs) } : current)
    setRecordedNotes((notes) => notes.map(move).sort((a, b) => a.impactTimeMs - b.impactTimeMs))
    setSelectedNoteIds(new Set(selectedIds))
    selectedIds.forEach((id) => scheduledNoteIds.current.delete(id))
  }, [beatmap?.notes, checkpointEditor, recordedNotes, selectedNoteIds, snapTimelineTime])
  const createHoldNote = useCallback((rawStartMs: number, rawEndMs: number, lane: Lane, bypassSnap = false) => {
    if (!beatmap) return
    const impactTimeMs = Math.max(0, snapTimelineTime(rawStartMs, bypassSnap))
    const endTimeMs = Math.max(impactTimeMs + 50, snapTimelineTime(rawEndMs, bypassSnap))
    checkpointEditor()
    const note: BeatmapNote = { id: `manual-hold-${Date.now()}-${Math.round(impactTimeMs)}`, impactTimeMs, rawTimeMs: rawStartMs, durationMs: endTimeMs - impactTimeMs, lane, strength: 1, source: 'manual-hold' }
    setBeatmap((current) => current ? { ...current, notes: [...current.notes, note].sort((a, b) => a.impactTimeMs - b.impactTimeMs) } : current)
    setSelectedNoteIds(new Set([note.id]))
  }, [beatmap, checkpointEditor, snapTimelineTime])
  const resizeHoldNote = useCallback((noteId: string, rawEndMs: number, bypassSnap = false) => {
    checkpointEditor(`resize:${noteId}`)
    const resize = (note: BeatmapNote) => note.id === noteId ? { ...note, durationMs: Math.max(50, snapTimelineTime(rawEndMs, bypassSnap) - note.impactTimeMs), source: 'manual-hold' } : note
    setBeatmap((current) => current ? { ...current, notes: current.notes.map(resize) } : current)
    setRecordedNotes((notes) => notes.map(resize))
    scheduledNoteIds.current.delete(noteId)
  }, [checkpointEditor, snapTimelineTime])
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
    checkpointEditor()
    const note: BeatmapNote = { id: `manual-${Date.now()}-${Math.round(impactTimeMs)}`, impactTimeMs, rawTimeMs, lane, strength: 1, source: quantize ? 'manual-grid' : 'manual' }
    setBeatmap((current) => current ? { ...current, notes: [...current.notes, note].sort((a, b) => a.impactTimeMs - b.impactTimeMs) } : current)
    setSelectedNoteIds(new Set([note.id]))
  }, [beatOffsetMs, beatmap, checkpointEditor, gridMs, quantize, removeNote, timelineBounds])
  const setTimelineZoomPreservingPlayhead = useCallback((nextZoom: number | 'fit') => {
    const playheadRatio = Math.min(1, Math.max(0, (songTimeMs - timelineBounds.startMs) / timelineBounds.spanMs))
    const nextSpanMs = nextZoom === 'fit'
      ? Math.max(1, importedSong?.durationMs ?? timelineBounds.spanMs)
      : nextZoom * 2 * 1000
    setTimelineCenterMs(songTimeMs + (0.5 - playheadRatio) * nextSpanMs)
    setTimelineZoomSeconds(nextZoom)
  }, [importedSong?.durationMs, songTimeMs, timelineBounds])
  const zoomTimeline = useCallback((direction: 'in' | 'out') => {
    if (timelineZoomSeconds === 'fit') {
      if (direction === 'in') setTimelineZoomPreservingPlayhead(60)
      return
    }
    const index = zoomOptions.indexOf(timelineZoomSeconds as typeof zoomOptions[number])
    const safeIndex = index === -1 ? zoomOptions.indexOf(4) : index
    const nextIndex = direction === 'in' ? Math.max(0, safeIndex - 1) : Math.min(zoomOptions.length - 1, safeIndex + 1)
    setTimelineZoomPreservingPlayhead(zoomOptions[nextIndex])
  }, [setTimelineZoomPreservingPlayhead, timelineZoomSeconds, zoomOptions])
  const handleTimelineWheel = useCallback((event: globalThis.WheelEvent) => {
    event.preventDefault()
    const wheelDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (event.ctrlKey || event.metaKey) {
      shiftWheelSelection.current = null
      if (wheelDelta !== 0) zoomTimeline(wheelDelta < 0 ? 'in' : 'out')
      return
    }
    if (!event.shiftKey) shiftWheelSelection.current = null
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
    if (event.shiftKey) {
      const selection = shiftWheelSelection.current ?? {
        anchorTimeMs: previousTimeMs,
        baselineIds: new Set(selectedNoteIds),
      }
      shiftWheelSelection.current = selection
      const touchedNoteIds = notesTouchedByPlayhead(
        [...(beatmap?.notes ?? []), ...recordedNotes],
        selection.anchorTimeMs,
        snappedTimeMs,
        true,
      )
      const nextSelection = new Set(selection.baselineIds)
      touchedNoteIds.forEach((id) => nextSelection.add(id))
      setSelectedNoteIds(nextSelection)
    }
    const edgeGuardMs = quantize && !event.altKey ? gridMs * 2 : timelineBounds.spanMs * 0.08
    const leftGuardMs = timelineBounds.startMs + edgeGuardMs
    const rightGuardMs = timelineBounds.endMs - edgeGuardMs
    if (timelineDeltaMs < 0 && snappedTimeMs <= leftGuardMs) {
      setTimelineCenterMs(snappedTimeMs + timelineBounds.spanMs / 2 - edgeGuardMs)
    }
    if (timelineDeltaMs > 0 && snappedTimeMs >= rightGuardMs) {
      setTimelineCenterMs(snappedTimeMs - timelineBounds.spanMs / 2 + edgeGuardMs)
    }
  }, [beatOffsetMs, beatmap?.notes, gridMs, quantize, recordedNotes, seekTimeline, selectedNoteIds, songTimeMs, timelineBounds, zoomTimeline])
  const centerTimelineOnPlayhead = useCallback(() => setTimelineCenterMs(songTimeMs), [songTimeMs])
  const setBeatOneAtPlayhead = useCallback(() => { checkpointEditor(); setBeatOffsetMs(Math.max(0, songTimeMs)) }, [checkpointEditor, songTimeMs])
  const nudgeBeatOffset = useCallback((deltaMs: number) => { checkpointEditor('beat-offset'); setBeatOffsetMs((value) => Math.max(0, value + deltaMs)) }, [checkpointEditor])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'editor' || isEditingTarget(event.target)) return
      if (event.code === 'Space') {
        const hasCommandModifier = event.ctrlKey || event.metaKey
        if (hasCommandModifier && !event.shiftKey) return
        event.preventDefault()
        if (hasCommandModifier && event.shiftKey) restartSong(true)
        else if (event.shiftKey) restartSong(false)
        else if (isSongPlaying) pauseSong()
        else playSong()
        return
      }
      const numberIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(event.code)
      if (numberIndex !== -1) {
        event.preventDefault()
        if (event.shiftKey) {
          if (numberIndex < zoomOptions.length) setTimelineZoomPreservingPlayhead(zoomOptions[numberIndex])
          else if (numberIndex === 7) setTimelineZoomPreservingPlayhead('fit')
          else if (numberIndex === 8) centerTimelineOnPlayhead()
          return
        }
        const gridShortcuts: Array<GridDivision | 'snap' | 'triplet'> = [4, 8, 16, 32, 64, 'snap', 'triplet']
        const shortcut = gridShortcuts[numberIndex]
        if (shortcut === 'snap') setQuantize((value) => !value)
        else if (shortcut === 'triplet') setTripletGrid((value) => !value)
        else if (shortcut) setGridDivision(shortcut)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) redoEditor()
        else undoEditor()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyY') {
        event.preventDefault()
        redoEditor()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyC' && selectedNoteIds.size > 0) {
        event.preventDefault()
        copySelection()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyV' && copiedNotes.length > 0) {
        event.preventDefault()
        pasteSelectionAtPlayhead()
        return
      }
      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        event.preventDefault()
        handleLoopRulerClick(songTimeMs, event.code === 'BracketLeft' ? 'start' : 'end')
        return
      }
      if (selectedNoteIds.size === 0) return
      if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault()
        deleteSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab, centerTimelineOnPlayhead, copiedNotes.length, copySelection, deleteSelection, handleLoopRulerClick, isSongPlaying, pasteSelectionAtPlayhead, pauseSong, playSong, redoEditor, restartSong, selectedNoteIds, setTimelineZoomPreservingPlayhead, songTimeMs, undoEditor, zoomOptions])
  const canUndo = historyVersion >= 0 && undoStack.current.length > 0
  const canRedo = historyVersion >= 0 && redoStack.current.length > 0
  const restartTooltip = 'Restart from beginning'
  const difficultyColor = ['#83ff70', '#4da3ff', '#ffd166', '#ff9f43', '#ff5570'][difficulty - 1] ?? '#83ff70'
  const transport = <div className="transport-bar" aria-label="Transport controls"><Button type="button" variant="ghost" className="transport-icon-button" onClick={(event) => restartSong((event.ctrlKey || event.metaKey) && loopMarkers.startMs !== null)} disabled={!importedSong} title={restartTooltip} tooltip={`${restartTooltip}. Ctrl click restarts from the loop start.`} shortcut="Shift+Space">↺</Button><Button type="button" variant="ghost" className="transport-icon-button" onClick={() => seekRelativeSong(-5000)} disabled={!importedSong} title="Back 5 seconds" tooltip="Back 5 seconds">-5s</Button><Button type="button" className={`transport-play-button ${isSongPlaying ? 'transport-play-button--pause' : 'transport-play-button--play'}`} onClick={isSongPlaying ? pauseSong : playSong} disabled={!importedSong} title={isSongPlaying ? 'Pause' : 'Play'} tooltip={isSongPlaying ? 'Pause' : 'Play'} shortcut="Space">{isSongPlaying ? '⏸' : '▶'}</Button><Button type="button" variant="ghost" className="transport-icon-button" onClick={() => seekRelativeSong(5000)} disabled={!importedSong} title="Forward 5 seconds" tooltip="Forward 5 seconds">+5s</Button>{activeTab === 'editor' && <><span className="transport-divider" /><Button type="button" variant="ghost" size="icon" className={`transport-loop-button transport-loop-button--start ${loopMarkers.startMs !== null ? 'transport-loop-button--active' : ''}`} onClick={() => handleLoopRulerClick(songTimeMs, 'start')} disabled={!importedSong} tooltip={loopMarkers.startMs !== null && Math.abs(loopMarkers.startMs - snapTimelineTime(songTimeMs)) <= Math.max(80, gridMs * 0.45) ? 'Remove loop start' : 'Set loop start at playhead'} shortcut="[" aria-label="Set loop start at playhead"><ArrowLeftToLine /></Button><Button type="button" variant="ghost" size="icon" className={`transport-loop-button transport-loop-button--end ${loopMarkers.endMs !== null ? 'transport-loop-button--active' : ''}`} onClick={() => handleLoopRulerClick(songTimeMs, 'end')} disabled={!importedSong} tooltip={loopMarkers.endMs !== null && Math.abs(loopMarkers.endMs - snapTimelineTime(songTimeMs)) <= Math.max(80, gridMs * 0.45) ? 'Remove loop end' : 'Set loop end at playhead'} shortcut="]" aria-label="Set loop end at playhead"><ArrowRightToLine /></Button><span className="transport-divider" /><Button type="button" variant="ghost" className={`transport-record-button ${isRecording ? 'transport-record-button--active' : ''}`} onClick={isRecording ? stopRecording : startRecording} tooltip={isRecording ? 'Stop recording' : 'Start recording'} aria-label={isRecording ? 'Stop recording' : 'Start recording'}><Circle fill="currentColor" /></Button></>}</div>
  const beatmapControls = <Card className="beatmap-controls"><CardHeader><CardTitle>Beatmaps {hasUnsavedChanges && <Badge tone="warning">Unsaved</Badge>}</CardTitle><CardDescription>{importedSong ? importedSong.title : 'Choose a cached song or import one from Config.'}</CardDescription></CardHeader>{savedImports.length > 0 ? <Field><FieldLabel>Song</FieldLabel><Select value={importedSong?.id ?? null} onValueChange={(songId) => { const song = savedImports.find((item) => item.id === songId); if (song && confirmDiscardChanges()) void loadImport(song) }}><SelectTrigger className="ui-select"><SelectValue>{(songId: string | null) => savedImports.find((song) => song.id === songId)?.title ?? 'Select cached song...'}</SelectValue></SelectTrigger><SelectContent>{savedImports.map((song) => <SelectItem key={song.id} value={song.id}>{song.title}</SelectItem>)}</SelectContent></Select></Field> : <p className="editor-hint">No cached songs yet. Use Config to import from YouTube.</p>}<Field><FieldLabel>Beatmap</FieldLabel><Select value={beatmap?.id ?? null} onValueChange={(beatmapId) => { if (beatmapId && confirmDiscardChanges()) void loadBeatmap(beatmapId) }} disabled={!importedSong || (!beatmap && songBeatmaps.length === 0)}><SelectTrigger className="ui-select"><SelectValue>{(beatmapId: string | null) => { if (beatmap?.id === beatmapId) return `${mapTitle} (${beatmap.notes.length}) ${'★'.repeat(difficulty)}`; const selectedMap = songBeatmaps.find((map) => map.id === beatmapId); if (selectedMap) return `${selectedMap.title} (${selectedMap.noteCount}) ${'★'.repeat(selectedMap.difficulty ?? 1)}`; return songBeatmaps.length || beatmap ? 'Select beatmap...' : 'No beatmaps' }}</SelectValue></SelectTrigger><SelectContent>{beatmap && !songBeatmaps.some((map) => map.id === beatmap.id) && <SelectItem value={beatmap.id}>{mapTitle} (unsaved) {'★'.repeat(difficulty)}</SelectItem>}{songBeatmaps.map((map) => <SelectItem key={map.id} value={map.id}>{map.title} ({map.noteCount}) {'★'.repeat(map.difficulty ?? 1)}</SelectItem>)}</SelectContent></Select></Field>{activeTab === 'editor' && <><div className="beatmap-action-grid"><Button type="button" variant="secondary" onClick={() => void saveBeatmap(false)} disabled={!beatmap || !importedSong} tooltip="Save changes"><Save />Save</Button><Button type="button" variant="secondary" onClick={createBlankBeatmap} disabled={!importedSong} tooltip="Create an empty beatmap"><FilePlus2 />Create</Button><div className="inline-popover"><Button type="button" variant="secondary" onClick={() => { setRenameDraft(mapTitle); setRenameOpen((open) => !open) }} disabled={!beatmap} tooltip="Rename this beatmap"><Edit3 />Rename</Button>{renameOpen && <div className="inline-popover__panel"><button type="button" className="popover-close" onClick={() => setRenameOpen(false)} aria-label="Close rename dialog"><X /></button><div className="popover-title">Rename beatmap</div><Input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyRenameBeatmap(event.currentTarget.value) } }} autoFocus /><div className="popover-actions popover-actions--single"><Button type="button" variant="secondary" size="sm" onClick={() => applyRenameBeatmap()}><Check />Apply</Button></div></div>}</div><Button type="button" variant="secondary" onClick={() => void saveBeatmap(true)} disabled={!beatmap || !importedSong} tooltip="Save a duplicate beatmap"><CopyPlus />Duplicate</Button><div className="inline-popover"><Button type="button" variant="secondary" onClick={() => setDifficultyOpen((open) => !open)} disabled={!beatmap} tooltip={`Difficulty ${difficulty}`} style={{ color: difficultyColor }}><Star fill="currentColor" />Difficulty</Button>{difficultyOpen && <div className="inline-popover__panel"><div className="popover-title">Difficulty</div><Slider min={1} max={5} step={1} value={[difficulty]} onValueChange={(value) => setBeatmapDifficulty(Array.isArray(value) ? value[0] : value)} /><div className="popover-actions"><span style={{ color: difficultyColor }}><Star size={14} fill="currentColor" /> Level {difficulty}</span><Button type="button" variant="secondary" size="sm" onClick={() => setDifficultyOpen(false)}><Check />Done</Button></div></div>}</div><div className="inline-popover"><Button type="button" variant="warning" onClick={() => setDeleteOpen((open) => !open)} disabled={!beatmap || !importedSong || !songBeatmaps.some((map) => map.id === beatmap.id)} tooltip="Delete this saved beatmap"><Trash2 />Delete</Button>{deleteOpen && <div className="inline-popover__panel inline-popover__panel--danger"><button type="button" className="popover-close" onClick={() => setDeleteOpen(false)} aria-label="Close delete confirmation"><X /></button><div className="popover-title">Delete beatmap?</div><p>This removes {mapTitle} from this song.</p><div className="popover-actions popover-actions--single"><Button type="button" variant="warning" size="sm" onClick={() => void deleteBeatmap()}><Trash2 />Delete</Button></div></div>}</div><Button type="button" variant="secondary" onClick={() => void exportSharedBeatmap()} disabled={!beatmap || !importedSong} tooltip="Export this beatmap with its song link and timing"><Download />Export</Button><input ref={shareImportInputRef} type="file" accept="application/json,.json,.beat-fiend.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importSharedBundle(file); event.currentTarget.value = '' }} /><Button type="button" variant="secondary" onClick={() => shareImportInputRef.current?.click()} tooltip="Import a shared Beat Fiend beatmap"><Upload />Import</Button></div><div className="beatmap-secondary-actions"><Button type="button" variant="ghost" onClick={clearBeatmapEvents} disabled={!beatmap} tooltip="Remove all notes from this beatmap"><Edit3 />Wipe notes</Button></div>{tapMode && <p className="editor-hint">Tap tempo is listening for lane keys. Use the main pane's Tap button to save.</p>}</>}</Card>
  const judgementText = lastAutoMiss ? 'miss' : lastResult ? lastResult.grade : 'ready'
  const gradeColor = lastAutoMiss ? judgementCssVars.miss : lastResult?.grade === 'perfect' ? judgementCssVars.perfect : lastResult?.grade === 'good' ? judgementCssVars.good : undefined
  const timingColor = lastResult?.success ? gradeColor : lastResult ? (lastResult.deltaMs < 0 ? judgementCssVars.early : judgementCssVars.late) : undefined
  const roundedDeltaMs = lastResult ? Math.round(lastResult.deltaMs) : null
  const deltaText = roundedDeltaMs === null ? '-' : `${roundedDeltaMs > 0 ? '+' : ''}${roundedDeltaMs}ms`
  const companionStatusLabel: Record<CompanionConnectionStatus, string> = {
    idle: 'optional',
    connecting: 'connecting',
    paired: 'connected',
    available: 'pairing',
    unavailable: 'not found',
    'permission-blocked': 'permission blocked',
  }

  return (
    <main className={activeTab === 'editor' ? 'editing-layout' : undefined}>
      <section className={activeTab === 'editor' ? 'stage edit-stage' : 'stage'}>
        {activeTab === 'editor'
          ? <div className="edit-workspace"><div className="edit-workspace__header"><div className="edit-title-row"><div><span className="eyebrow">Editor</span><div className="edit-title-line"><h2>{mapTitle || 'Untitled beatmap'}</h2><span className="edit-status">{recordedNotes.length} buffered · {beatmap?.notes.length ?? 0} notes</span></div></div>{transport}</div><Toolbar><div className="toolbar-section"><span className="toolbar-section__label">History</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={undoEditor} disabled={!canUndo} tooltip="Undo the last editor change" shortcut="Ctrl+Z"><Undo2 />Undo</Button><Button type="button" variant="ghost" size="pill" onClick={redoEditor} disabled={!canRedo} tooltip="Redo the last undone editor change" shortcut="Ctrl+Y"><Redo2 />Redo</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Record</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" className={recordMode === 'add' ? 'active' : ''} onClick={() => setRecordMode('add')} tooltip="Record adds new notes">Add</Button><Button type="button" variant="ghost" size="pill" className={recordMode === 'replace' ? 'active' : ''} onClick={() => setRecordMode('replace')} tooltip="Record replaces armed lanes in the recorded range">Replace</Button></div></div><div className="toolbar-section toolbar-section--wide"><span className="toolbar-section__label">Lanes</span><div className="toolbar-group">{lanes.map((lane) => <Button key={lane} type="button" variant="ghost" size="pill" className={armedLanes.has(lane) ? 'active' : ''} onClick={() => setArmedLanes((current) => { const next = new Set(current); if (next.has(lane)) next.delete(lane); else next.add(lane); return next })} tooltip={`Toggle ${lane} lane recording`}>{lane}</Button>)}</div></div><div className="toolbar-section"><span className="toolbar-section__label">Grid</span><div className="toolbar-group">{([4, 8, 16, 32, 64] as const).map((division) => <Button key={division} type="button" variant="ghost" size="pill" className={gridDivision === division ? 'active' : ''} onClick={() => setGridDivision(division)} tooltip={`Set grid to 1/${division}${tripletGrid ? ' triplet' : ''}`} shortcut={String(([4, 8, 16, 32, 64] as const).indexOf(division) + 1)}>1/{division}{tripletGrid ? 'T' : ''}</Button>)}<Button type="button" variant="ghost" size="pill" className={quantize ? 'active' : ''} onClick={() => setQuantize((value) => !value)} tooltip="Snap recording and edit actions to the grid" shortcut="6">Snap {quantize ? 'on' : 'off'}</Button><Button type="button" variant="ghost" size="pill" className={tripletGrid ? 'active' : ''} onClick={() => setTripletGrid((value) => !value)} tooltip="Use triplet spacing for the selected grid division" shortcut="7">Triplet {tripletGrid ? 'on' : 'off'}</Button></div></div><span className="toolbar-break" aria-hidden="true" /><div className="toolbar-section"><span className="toolbar-section__label">Zoom</span><div className="toolbar-group">{zoomOptions.map((seconds) => <Button key={seconds} type="button" variant="ghost" size="pill" className={timelineZoomSeconds === seconds ? 'active' : ''} onClick={() => setTimelineZoomPreservingPlayhead(seconds)} tooltip={`Zoom to ${seconds >= 30 ? `${seconds / 30}m` : `${seconds * 2}s`} window`} shortcut={`Shift+${zoomOptions.indexOf(seconds) + 1}`}>{seconds >= 30 ? `${seconds / 30}m` : `${seconds * 2}s`}</Button>)}<Button type="button" variant="ghost" size="pill" className={timelineZoomSeconds === 'fit' ? 'active' : ''} onClick={() => setTimelineZoomPreservingPlayhead('fit')} tooltip="Fit song in timeline" shortcut="Shift+8">Fit</Button><Button type="button" variant="ghost" size="pill" onClick={centerTimelineOnPlayhead} tooltip="Center timeline on playhead" shortcut="Shift+9">Follow</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Tempo{tapMode ? ` · ${detectedBpm ? `${detectedBpm} bpm` : 'tap keys'}` : ''}</span><div className="toolbar-group"><Input type="number" min="40" max="300" step="0.1" value={Number.isFinite(bpm) ? Math.round(bpm * 10) / 10 : ''} onChange={(event) => { const nextBpm = Number(event.target.value); if (Number.isFinite(nextBpm) && nextBpm > 0) { checkpointEditor('bpm'); setBpm(Math.round(nextBpm * 10) / 10) } }} /><Button type="button" variant="ghost" size="pill" className={tapMode ? 'active' : ''} onClick={toggleTapBpm} tooltip={tapMode ? 'Use detected BPM' : 'Start tap BPM'}>{tapMode ? 'Stop + use' : 'Start tap'}</Button></div>{tapMode && <span className="tap-bpm-readout">{detectedBpm ? `Live BPM ${detectedBpm}` : 'Press Space/W/arrows on the beat…'}</span>}</div><div className="toolbar-section toolbar-section--wide"><span className="toolbar-section__label">Beat 1 · {(beatOffsetMs / 1000).toFixed(3)}s</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={setBeatOneAtPlayhead} tooltip="Set current playhead as beat 1">Set beat 1 here</Button><Button type="button" variant="ghost" size="pill" onClick={() => nudgeBeatOffset(-10)} tooltip="Move beat 1 earlier by 10ms">-10ms</Button><Button type="button" variant="ghost" size="pill" onClick={() => nudgeBeatOffset(10)} tooltip="Move beat 1 later by 10ms">+10ms</Button></div></div><div className="toolbar-section toolbar-section--impact"><span className="toolbar-section__label">Impact</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" className={selectedNotesAreHeavy ? 'active' : ''} onClick={toggleHeavySelection} disabled={selectedNoteIds.size === 0} tooltip={selectedNotesAreHeavy ? 'Make selected notes standard' : 'Mark selected notes as heavy'}><Zap />Heavy</Button></div></div><div className="toolbar-section toolbar-section--contextual"><span className="toolbar-section__label">Notes · {selectedNoteIds.size} selected</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={() => setSelectedNoteIds(new Set())} disabled={selectedNoteIds.size === 0} tooltip="Clear the current note selection">Clear</Button><Button type="button" variant="ghost" size="pill" onClick={deleteSelection} disabled={selectedNoteIds.size === 0} tooltip="Delete selected notes" shortcut="Delete">Delete</Button><Button type="button" variant="ghost" size="pill" onClick={copySelection} disabled={selectedNoteIds.size === 0} tooltip="Copy selected notes" shortcut="Ctrl+C">Copy</Button><Button type="button" variant="ghost" size="pill" onClick={pasteSelectionAtPlayhead} disabled={!beatmap || copiedNotes.length === 0} tooltip="Paste copied notes at the playhead" shortcut="Ctrl+V">Paste</Button><Button type="button" variant="ghost" size="pill" onClick={duplicateSelection} disabled={!beatmap || !Number.isFinite(bpm) || bpm <= 0} tooltip={selectedNoteIds.size > 0 ? 'Duplicate selected bars into the next empty bars on those lanes' : 'Duplicate the contiguous phrase at the playhead into the next empty bars'}>Duplicate</Button><Button type="button" variant="ghost" size="pill" onClick={syncFollowingPatterns} disabled={!beatmap || selectedNoteIds.size === 0 || !Number.isFinite(bpm) || bpm <= 0} tooltip="Apply the selected pattern to consecutive matching sections without adding or removing notes">Sync repeats</Button></div></div></Toolbar></div><EditorTimeline notes={visibleTimelineNotes} gridLines={timelineGridLines} bounds={timelineBounds} songTimeMs={songTimeMs} playheadActive={isSongPlaying} selectedNoteIds={selectedNoteIds} loopMarkers={loopMarkers} onTimelineClick={handleTimelineClick} onTimelineWheel={handleTimelineWheel} onSeek={seekTimeline} onLoopRulerClick={handleLoopRulerClick} onLoopMarkerDrag={setLoopMarker} onLoopMarkerRemove={removeLoopMarker} onNoteDrag={moveNote} onHoldCreate={createHoldNote} onHoldResize={resizeHoldNote} onLaneSelect={selectLaneNotes} onSelectionChange={setSelectedNoteIds} onRemoveNote={removeNote} /></div>
          : activeTab === 'play'
            ? <div className="play-stage"><div className="play-transport">{transport}</div><HitNotify feedback={feedback} streak={stats.streak} /><Suspense fallback={<div className="game-loading">Loading playfield…</div>}><GameScene attacks={activeAttacks} tuning={tuning} bpm={bpm} collectionProgress={collectionProgress} collectionTotals={laneNoteTotals} laneFeedback={laneFeedback} padTriggers={padTriggers} heldLanes={heldPlayLanes} onPhaseChange={setPhase} /></Suspense></div>
            : <Suspense fallback={<div className="game-loading">Loading playfield…</div>}><GameScene attacks={activeAttacks} tuning={tuning} bpm={bpm} collectionProgress={collectionProgress} collectionTotals={laneNoteTotals} laneFeedback={laneFeedback} padTriggers={padTriggers} heldLanes={heldPlayLanes} onPhaseChange={setPhase} /></Suspense>}
      </section>
      {activeTab !== 'editor' && <div className="status-stack" aria-live="polite">
        <div className="toast"><strong>{phase}</strong></div>
        <div className="toast"><strong style={{ color: gradeColor }}>{judgementText}</strong></div>
        <div className="toast"><strong style={{ color: timingColor }}>{lastAutoMiss ? '-' : deltaText}</strong></div>
      </div>}
      {importedSong && <audio ref={audioRef} src={importedSong.audioUrl} preload="auto" onPlay={() => setIsSongPlaying(true)} onPause={() => setIsSongPlaying(false)} onEnded={() => setIsSongPlaying(false)} onTimeUpdate={(event) => setSongTimeMs(event.currentTarget.currentTime * 1000)} onSeeked={(event) => { setSongTimeMs(event.currentTarget.currentTime * 1000); if (isLoopSeeking.current) isLoopSeeking.current = false; else resetScheduledNotes() }} />}
      <Dialog open={companionDialogOpen} onOpenChange={setCompanionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{companionStatus === 'permission-blocked' ? 'Allow companion access' : 'Connect Beat Fiend Companion'}</DialogTitle>
            <DialogDescription>{companionStatus === 'permission-blocked' ? 'Chrome has blocked Beat Fiend from contacting software on this computer.' : 'The companion is optional. Browser file imports continue to work without it.'}</DialogDescription>
          </DialogHeader>
          {companionStatus === 'permission-blocked'
            ? <div className="companion-dialog-copy"><p>Open the site controls beside Chrome&apos;s address bar, enable <strong>Apps on device</strong>, then try again.</p><p>Other browsers may call this Local Network Access.</p></div>
            : <div className="companion-dialog-copy"><p>Beat Fiend needs permission to contact the companion running only on this computer.</p><p>Your browser may ask you to allow <strong>Apps on device</strong>. Beat Fiend uses this access only for the local companion.</p></div>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>Not now</DialogClose>
            <Button type="button" onClick={() => { setCompanionDialogOpen(false); void connectCompanion() }}>{companionStatus === 'permission-blocked' ? 'Try connection again' : 'Continue'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <aside className="panel">
        <div className="panel-hero"><div className="panel-brand"><img src="/beat-fiend-logo.png" alt="" /><h1>Beat Fiend</h1></div><p>Import songs, align the beat grid, record lane events, then playtest the feel.</p></div>
        <Tabs value={activeTab} className="ui-tabs"><TabsList className="ui-tabs__list">{(['play', 'editor', 'config', 'debug'] as const).map((tab) => <TabsTrigger key={tab} value={tab} className="ui-tabs__trigger" onClick={() => setActiveTab(tab)}>{tab}</TabsTrigger>)}</TabsList></Tabs>

        {activeTab === 'play' && <>
          {beatmapControls}
          <Card><CardHeader><CardTitle>Run stats</CardTitle><CardDescription>Quick read on accuracy and streak health.</CardDescription></CardHeader><div className="stat-grid"><div><span>Accuracy</span><strong>{stats.hit + stats.missed ? Math.round((stats.hit / (stats.hit + stats.missed)) * 100) : 0}%</strong></div><div><span>Streak</span><strong>{stats.streak}</strong></div><div><span>Best</span><strong>{stats.bestStreak}</strong></div><div><span>Miss</span><strong>{stats.missed}</strong></div></div><div className="metric-row"><Badge tone="success">Perfect {stats.perfect}</Badge><Badge tone="warning">Good {stats.good}</Badge><Badge>Hit {stats.hit}</Badge></div></Card>
          <Disclosure><DisclosureSummary>Timing feel</DisclosureSummary>{rows.slice(0, 2).map(([label, value, min, max, unit, key]) => <Field key={key}><FieldLabel>{label}: <strong>{value}{unit}</strong></FieldLabel><Slider min={min} max={max} value={[value]} onValueChange={(nextValue) => setTuning((t) => ({ ...t, [key]: Array.isArray(nextValue) ? nextValue[0] : nextValue }))} /></Field>)}</Disclosure>
        </>}

        {activeTab === 'editor' && <>
          {beatmapControls}
        </>}

        {activeTab === 'config' && <>
          <ConfigSection className="import-card" icon={<Headphones />} title="Import audio" description="Choose a file in any browser. The optional companion additionally enables YouTube imports and local caching." status={<Badge tone={companionStatus === 'paired' ? 'success' : companionStatus === 'available' || companionStatus === 'connecting' ? 'warning' : companionStatus === 'permission-blocked' || companionStatus === 'unavailable' ? 'danger' : 'muted'}>{companionStatusLabel[companionStatus]}</Badge>}>
            <div className="import-card__content">
              {companionStatus !== 'paired' && <div className="companion-connect"><p>{companionStatus === 'permission-blocked' ? 'Chrome is blocking access to the companion on this computer.' : companionStatus === 'unavailable' ? 'The companion was not found. Make sure it is running, then try again.' : 'Use browser file imports without the companion, or connect it for YouTube imports and local caching.'}</p><div className="companion-connect__actions"><Button type="button" disabled={companionStatus === 'connecting'} onClick={() => setCompanionDialogOpen(true)}>{companionStatus === 'connecting' ? 'Waiting for browser…' : companionStatus === 'permission-blocked' ? 'Permission help' : companionStatus === 'unavailable' ? 'Try again' : 'Connect companion'}</Button><Button type="button" variant="secondary" onClick={() => window.location.assign(COMPANION_WINDOWS_DOWNLOAD_URL)}>Download for Windows</Button></div></div>}
              {companionStatus === 'available' && <Button type="button" onClick={() => companion.pair()}>Finish pairing companion</Button>}
              <div className="url-row">
                <Input type="url" aria-label="YouTube URL" placeholder="Paste a YouTube URL" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} />
                <Button type="button" variant="secondary" onClick={activeImportJobId ? cancelCompanionImport : importYoutube} tooltip={activeImportJobId ? 'Cancel local import' : 'Import YouTube audio locally'}>{activeImportJobId ? 'Cancel' : 'Import'}</Button>
              </div>
              <div className="import-card__divider"><span>or</span></div>
              <input ref={localAudioInputRef} type="file" accept="audio/mp4,audio/mpeg,audio/webm,audio/ogg,audio/wav" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importLocalAudio(file); event.currentTarget.value = '' }} />
              <Button className="import-card__file-button" type="button" variant="secondary" onClick={() => localAudioInputRef.current?.click()}>Choose an audio file</Button>
              {importStatus && <p className={`import-status${importStatus.toLowerCase().includes('failed') ? ' import-status--error' : ''}`}>{importStatus}</p>}
            </div>
          </ConfigSection>
          <ConfigSection className="library-transfer-card" icon={<Database />} title="Library transfer" description="Back up your collection or move it to another browser.">
            <div className="library-transfer-card__details"><Badge tone="muted">Metadata only</Badge><span className="library-transfer-card__detail-copy">Includes songs, YouTube links, BPM, beat 1, and every beatmap. Audio downloads locally when needed.</span></div>
            <div className="library-transfer-card__actions">
              <Button type="button" variant="secondary" className="library-transfer-action" onClick={() => void exportLibrary()}><span className="library-transfer-action__icon"><Download /></span><span className="library-transfer-action__copy"><strong>Export library</strong><small>Download one portable backup</small></span></Button>
              <input ref={libraryImportInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importLibrary(file); event.currentTarget.value = '' }} />
              <Button type="button" variant="secondary" className="library-transfer-action" onClick={() => libraryImportInputRef.current?.click()}><span className="library-transfer-action__icon"><Upload /></span><span className="library-transfer-action__copy"><strong>Import library</strong><small>Restore or move a backup here</small></span></Button>
            </div>
          </ConfigSection>
          <ConfigSection icon={<Gamepad2 />} title="Controls" description="Configure keyboard event codes and Xbox-style gamepad buttons for each lane."><div className="controls-grid">{lanes.map((lane) => <div key={lane} className="control-row"><strong style={{ color: laneColor[lane] }}>{lane}</strong><Input value={controls[lane].keyboard} onChange={(event) => setControls((current) => ({ ...current, [lane]: { ...current[lane], keyboard: event.target.value } }))} /><Select value={String(controls[lane].gamepadButton)} onValueChange={(button) => setControls((current) => ({ ...current, [lane]: { ...current[lane], gamepadButton: Number(button) } }))}><SelectTrigger className="ui-select"><SelectValue>{(button: string | null) => button === null ? 'Select button...' : gamepadButtonLabels[Number(button)]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(gamepadButtonLabels).map(([button, label]) => <SelectItem key={button} value={button}>{label}</SelectItem>)}</SelectContent></Select></div>)}</div><Button type="button" variant="secondary" onClick={() => setControls(defaultControls)} tooltip="Restore default keyboard and gamepad bindings">Reset controls</Button></ConfigSection>
        </>}

        {activeTab === 'debug' && <><Card><CardHeader><CardTitle>Runtime performance</CardTitle><CardDescription>Rolling development metrics. Frame targets: p99 below 25ms, no long tasks, scheduler p99 below 10ms.</CardDescription></CardHeader><Stack><code>frame p99: {performanceSnapshot.frameP99Ms.toFixed(1)}ms</code><code>frame max: {performanceSnapshot.frameMaxMs.toFixed(1)}ms</code><code>frames over 25ms: {performanceSnapshot.droppedFrames}</code><code>long tasks: {performanceSnapshot.longTasks}</code><code>scheduler p99: {performanceSnapshot.schedulerP99Ms.toFixed(3)}ms</code><code>scheduler max: {performanceSnapshot.schedulerMaxMs.toFixed(3)}ms</code><code>notes examined max/tick: {performanceSnapshot.schedulerNotesMax}</code></Stack></Card><Card><CardHeader><CardTitle>Save trust</CardTitle><CardDescription>Force a fresh read from the local server if the browser or UI looks stale.</CardDescription></CardHeader><Stack><Button type="button" variant="secondary" onClick={() => void refreshSaveState()} disabled={!importedSong}>Reload saved beatmap from disk</Button><code>current map: {beatmap ? `${beatmap.title} v${beatmap.version ?? 0} (${beatmap.notes.length} notes)` : '-'}</code><code>status: {importStatus || '-'}</code></Stack></Card><Card><CardHeader><CardTitle>Tuning</CardTitle><CardDescription>Adjust judgement windows and projectile timing.</CardDescription></CardHeader>{rows.map(([label, value, min, max, unit, key]) => <Field key={key}><FieldLabel>{label}: <strong>{value}{unit}</strong></FieldLabel><Slider min={min} max={max} value={[value]} onValueChange={(nextValue) => setTuning((t) => ({ ...t, [key]: Array.isArray(nextValue) ? nextValue[0] : nextValue }))} /></Field>)}</Card><Card className="timing-debug-card"><CardHeader><CardTitle>Timing debug</CardTitle></CardHeader><Stack><code>zero point: leading edge touches shield</code><code>active projectiles: {activeAttacks.length}</code><code>impactTime: {currentAttack ? currentAttack.impactMs.toFixed(2) : '-'}ms</code><code>this travel: {currentAttack ? currentAttack.travelMs.toFixed(0) : '-'}ms</code><code>song mode: {isSongPlaying && beatmap ? `${beatmap.notes.length} notes` : 'off'}</code><code>parry: ±{tuning.parryWindowMs}ms ({tuning.parryWindowMs * 2}ms total)</code><code>perfect: ±{tuning.perfectWindowMs}ms ({tuning.perfectWindowMs * 2}ms total)</code><code>delta: {lastResult ? `${lastResult.deltaMs.toFixed(2)}ms` : '-'}</code><code>result: {lastResult ? `${lastResult.grade} / ${lastResult.success ? 'success' : 'miss'}` : '-'}</code></Stack></Card></>}
      </aside>
    </main>
  )
}

export default App
