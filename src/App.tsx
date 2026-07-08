import { Canvas, useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Color } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import './App.css'
import { Badge, Button, ButtonGroup, Card, CardDescription, CardHeader, CardTitle, Disclosure, DisclosureSummary, Field, FieldLabel, Input, Select, Slider, Stack, Tabs } from './components/base-ui'
import { attackPhase, judgeParryTiming, type ParryTimingResult } from './game/timing'

type Tuning = { parryWindowMs: number; perfectWindowMs: number; telegraphMs: number; recoveryMs: number; inputOffsetMs: number }
type Attack = { id: number; startMs: number; impactMs: number; travelMs: number; lane?: BeatmapNote['lane']; durationMs?: number }
type FeedbackEvent = { id: number; kind: 'good-parry' | 'perfect-parry' | 'miss'; startedAtMs: number; lane?: BeatmapNote['lane'] }
type SavedBeatmap = { id: string; title: string; difficulty: number; updatedAt?: string; noteCount: number; url: string }
type ImportResult = { id: string; title: string; durationMs: number; audioUrl: string; beatmapUrl: string; noteCount: number; sourceUrl?: string; cached?: boolean; beatmaps?: SavedBeatmap[] }
type Lane = 'kick' | 'snare' | 'low' | 'mid' | 'high'
type BeatmapNote = { id: string; impactTimeMs: number; rawTimeMs?: number; durationMs?: number; lane: Lane; strength: number; source: string; resolved?: boolean }
type Beatmap = { id: string; songId?: string; title: string; difficulty?: number; version?: number; bpm?: number; beatOffsetMs?: number; durationMs: number; notes: BeatmapNote[] }
type PlayStats = { hit: number; perfect: number; good: number; missed: number; streak: number; bestStreak: number }
type GridDivision = 4 | 8 | 16 | 32
type TimelineBounds = { startMs: number; endMs: number; spanMs: number }
type TimelineGridLine = { left: number; strength: 'bar' | 'beat' | 'sub'; label?: string }

const initialTuning: Tuning = { parryWindowMs: 80, perfectWindowMs: 40, telegraphMs: 1150, recoveryMs: 260, inputOffsetMs: 0 }
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const laneY: Record<Lane, number> = { kick: -0.58, snare: -0.32, low: 0.18, mid: 0.48, high: 0.78 }
const laneColor: Record<Lane, string> = {
  kick: '#4da3ff',
  snare: '#ff5570',
  low: '#83ff70',
  mid: '#b56cff',
  high: '#ff9f43',
}
const laneKey: Record<Lane, string> = { kick: 'Space', snare: 'W', low: 'Left', mid: 'Up', high: 'Right' }
const lanes = ['kick', 'snare', 'low', 'mid', 'high'] as const
const timelineRulerHeightPx = 28
const timelineLaneHeightPx = 58
const timelineLaneTopPx = timelineRulerHeightPx
const timelineLaneAreaHeightPx = lanes.length * timelineLaneHeightPx
const keyLane: Record<string, Lane> = { Space: 'kick', KeyW: 'snare', ArrowLeft: 'low', ArrowUp: 'mid', ArrowRight: 'high' }
const bpmStorageKey = (songId?: string, beatmapId?: string) => songId ? `flow-fight:bpm:${songId}:${beatmapId ?? 'song'}` : null

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"]'))
}

function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="slider"]'))
}

function playParrySound(kind: FeedbackEvent['kind']) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  const audio = new AudioContextClass()
  const now = audio.currentTime
  const master = audio.createGain()
  master.gain.setValueAtTime(0.0001, now)
  master.gain.exponentialRampToValueAtTime(kind === 'perfect-parry' ? 0.22 : 0.14, now + 0.01)
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
  master.connect(audio.destination)
  const hit = audio.createOscillator()
  const hitGain = audio.createGain()
  hit.type = kind === 'perfect-parry' ? 'triangle' : 'square'
  hit.frequency.setValueAtTime(kind === 'perfect-parry' ? 1180 : kind === 'good-parry' ? 520 : 150, now)
  hit.frequency.exponentialRampToValueAtTime(kind === 'perfect-parry' ? 1760 : 260, now + 0.08)
  hitGain.gain.setValueAtTime(0.7, now)
  hitGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  hit.connect(hitGain).connect(master)
  hit.start(now)
  hit.stop(now + 0.18)
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }

function normalizeLane(lane: unknown): Lane {
  if (lane === 'left') return 'low'
  if (lane === 'up' || lane === 'down') return 'mid'
  if (lane === 'right') return 'high'
  if (lane === 'kick' || lane === 'snare' || lane === 'low' || lane === 'mid' || lane === 'high') return lane
  return 'mid'
}

function normalizeBeatmap(beatmap: Beatmap): Beatmap {
  return { ...beatmap, beatOffsetMs: beatmap.beatOffsetMs ?? 0, notes: beatmap.notes.map((note) => ({ ...note, lane: normalizeLane(note.lane) })) }
}

function makeBeatmapAttack(timeUntilImpactMs: number, lane: BeatmapNote['lane'], durationMs?: number): Attack {
  const now = performance.now()
  const travelMs = Math.max(120, timeUntilImpactMs)
  return { id: Math.random(), startMs: now, travelMs, impactMs: now + travelMs, lane, durationMs } as Attack
}

function makeIdlePattern(): Attack[] {
  const now = performance.now()
  const beatMs = 520
  const firstImpactMs = 900
  return [
    { id: Math.random(), startMs: now, travelMs: firstImpactMs, impactMs: now + firstImpactMs, lane: 'kick' },
    { id: Math.random(), startMs: now + beatMs, travelMs: firstImpactMs, impactMs: now + firstImpactMs + beatMs, lane: 'snare' },
    { id: Math.random(), startMs: now + beatMs * 2, travelMs: firstImpactMs, impactMs: now + firstImpactMs + beatMs * 2, lane: 'kick' },
    { id: Math.random(), startMs: now + beatMs * 3, travelMs: firstImpactMs, impactMs: now + firstImpactMs + beatMs * 3, lane: 'snare' },
  ]
}

function ProjectileVisual({ attack, hidden }: { attack: Attack; hidden: boolean }) {
  const projectile = useRef<Mesh>(null)
  const ghosts = useRef<Array<Mesh | null>>([])
  const lane = attack.lane ?? 'mid'
  const color = laneColor[lane]
  const isHold = (attack.durationMs ?? 0) >= 200

  useFrame(() => {
    const now = performance.now()
    const startX = 1.6
    const shieldRightEdgeX = -0.96
    const projectileRadius = 0.09
    const impactX = shieldRightEdgeX + projectileRadius
    const travel = clamp01((now - attack.startMs) / attack.travelMs)
    const x = startX + (impactX - startX) * travel
    const y = laneY[lane]
    const impactAge = now - attack.impactMs

    if (projectile.current) {
      projectile.current.position.x = x
      projectile.current.position.y = y
      projectile.current.visible = !hidden && now >= attack.startMs && impactAge < 120
    }

    ghosts.current.forEach((ghost, index) => {
      if (!ghost) return
      const lagMs = 55 * (index + 1)
      const ghostTravel = clamp01((now - lagMs - attack.startMs) / attack.travelMs)
      ghost.position.x = startX + (impactX - startX) * ghostTravel
      ghost.position.y = laneY[lane]
      ghost.visible = !hidden && now >= attack.startMs + lagMs && impactAge < 40
    })
  })

  return (
    <>
      {[0.22, 0.14, 0.08].map((opacity, index) => (
        <mesh key={opacity} ref={(mesh) => { ghosts.current[index] = mesh }} visible={false} position={[1.6, laneY[lane], 0.06]}>
          <sphereGeometry args={[(isHold ? 0.15 : 0.09) - index * 0.014, 24, 12]} />
          <meshStandardMaterial color={color} emissive={color} transparent opacity={opacity} />
        </mesh>
      ))}
      <mesh ref={projectile} position={[1.6, laneY[lane], 0.12]} visible={false}>
        <sphereGeometry args={[isHold ? 0.18 : 0.09, 32, 16]} />
        <meshStandardMaterial color={color} emissive={color} />
      </mesh>
    </>
  )
}

function PlayPauseButton({ isPlaying, onPlay, onPause }: { isPlaying: boolean; onPlay: () => void; onPause: () => void }) {
  return <Button type="button" className={isPlaying ? 'play-pause play-pause--pause' : 'play-pause play-pause--play'} onClick={isPlaying ? onPause : onPlay}>{isPlaying ? 'Ⅱ Pause' : '▶ Play'}</Button>
}

function EditorTimeline({
  notes,
  gridLines,
  bounds,
  songTimeMs,
  selectedNoteId,
  onTimelineClick,
  onTimelineWheel,
  onSeek,
  onRemoveNote,
}: {
  notes: Array<BeatmapNote & { pending: boolean }>
  gridLines: TimelineGridLine[]
  bounds: TimelineBounds
  songTimeMs: number
  selectedNoteId: string | null
  onTimelineClick: (event: MouseEvent<HTMLDivElement>) => void
  onTimelineWheel: (event: WheelEvent<HTMLDivElement>) => void
  onSeek: (timeMs: number, bypassSnap?: boolean) => void
  onRemoveNote: (noteId: string) => void
}) {
  const playheadLeft = ((songTimeMs - bounds.startMs) / bounds.spanMs) * 100
  const dragPlayhead = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const xRatio = clamp01((event.clientX - rect.left) / rect.width)
    onSeek(bounds.startMs + xRatio * bounds.spanMs, event.shiftKey)
  }

  return (
    <div className="timeline timeline--expanded" onClick={onTimelineClick} onWheel={onTimelineWheel}>
      <div className="timeline-ruler">{gridLines.filter((line) => line.label).map((line, index) => <span key={`label-${line.left}-${index}`} className={`timeline-ruler__mark timeline-ruler__mark--${line.strength}`} style={{ left: `${line.left}%` }}>{line.label}</span>)}</div>
      <div className="timeline-grid">{gridLines.map((line, index) => <span key={`${line.left}-${index}`} className={`timeline-grid__line timeline-grid__line--${line.strength}`} style={{ left: `${line.left}%` }} />)}</div>
      <div className="timeline-labels">{lanes.map((lane) => <span key={lane}>{lane}</span>)}</div>
      {playheadLeft >= 0 && playheadLeft <= 100 && <div className="playhead" style={{ left: `${playheadLeft}%` }} title="Drag to seek" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragPlayhead(event) }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragPlayhead(event) }} onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />}
      {notes.filter((note) => note.impactTimeMs >= bounds.startMs && note.impactTimeMs <= bounds.endMs).map((note) => <i key={`stage-${note.pending ? 'pending' : 'saved'}-${note.id}`} className={`${note.pending ? 'pending ' : ''}${selectedNoteId === note.id ? 'selected' : ''}`} onClick={(event) => { event.stopPropagation(); onRemoveNote(note.id) }} title={`Remove ${note.lane} ${Math.round(note.impactTimeMs)}ms`} style={{ left: `${((note.impactTimeMs - bounds.startMs) / bounds.spanMs) * 100}%`, top: `${timelineLaneTopPx + lanes.indexOf(note.lane) * timelineLaneHeightPx + 14}px`, width: note.durationMs ? `${Math.max(8, (note.durationMs / bounds.spanMs) * 100)}%` : undefined, background: laneColor[note.lane] }} />)}
    </div>
  )
}

function Arena({ attacks, tuning, parryPulse, feedback, padTriggers, onPhaseChange }: { attacks: Attack[]; tuning: Tuning; parryPulse: number; feedback: FeedbackEvent | null; padTriggers: Record<Lane, number>; onPhaseChange: (phase: string) => void }) {
  const impactFlash = useRef<Mesh>(null)
  const cannonRefs = useRef<Partial<Record<BeatmapNote['lane'], Group | null>>>({})
  const parryShield = useRef<Mesh>(null)
  const padRefs = useRef<Partial<Record<BeatmapNote['lane'], Mesh | null>>>({})
  const padMaterials = useRef<Partial<Record<BeatmapNote['lane'], MeshStandardMaterial | null>>>({})
  const burst = useRef<Group>(null)
  const primaryAttack = attacks[0]

  useFrame(() => {
    const now = performance.now()
    const attack = primaryAttack
    onPhaseChange(attack ? (attackPhase(now, attack.startMs, attack.impactMs, tuning.recoveryMs) === 'windup' ? 'incoming' : attackPhase(now, attack.startMs, attack.impactMs, tuning.recoveryMs)) : 'queued')

    const impactAge = attack ? now - attack.impactMs : Number.POSITIVE_INFINITY
    const parryAge = now - parryPulse
    const feedbackAge = feedback ? now - feedback.startedAtMs : Number.POSITIVE_INFINITY
    const isSuccessfulParry = feedback?.kind === 'good-parry' || feedback?.kind === 'perfect-parry'

    Object.entries(laneColor).forEach(([lane]) => {
      const typedLane = lane as BeatmapNote['lane']
      const latestShot = attacks
        .filter((candidate) => (candidate.lane ?? 'mid') === typedLane && now >= candidate.startMs)
        .sort((a, b) => b.startMs - a.startMs)[0]
      const shotAge = latestShot ? now - latestShot.startMs : Number.POSITIVE_INFINITY
      const trigger = shotAge >= 0 && shotAge < 130 ? Math.sin((1 - shotAge / 130) * Math.PI) : 0
      const cannon = cannonRefs.current[typedLane]
      if (cannon) cannon.position.x = 1.55 - trigger * 0.075
    })

    if (impactFlash.current) {
      const visible = impactAge >= 0 && impactAge < 130
      const flash = visible ? 1 - impactAge / 130 : 0
      impactFlash.current.scale.setScalar(0.45 + flash * 1.8)
      impactFlash.current.visible = visible
      impactFlash.current.position.y = attack ? laneY[attack.lane ?? 'mid'] : 0.06
    }
    if (parryShield.current) {
      const duration = feedback?.kind === 'perfect-parry' ? 360 : 210
      const visible = parryAge >= 0 && parryAge < duration
      const pulse = visible ? 1 - parryAge / duration : 0
      parryShield.current.visible = visible
      parryShield.current.scale.setScalar(0.82 + pulse * (feedback?.kind === 'perfect-parry' ? 0.72 : 0.42))
    }

    const shieldFlashDurationMs = 200
    const shieldFlash = feedbackAge < shieldFlashDurationMs && isSuccessfulParry ? Math.pow(Math.max(0, Math.sin((feedbackAge / shieldFlashDurationMs) * Math.PI * 4)), 0.35) * (1 - feedbackAge / shieldFlashDurationMs * 0.35) : 0
    Object.entries(laneColor).forEach(([lane, color]) => {
      const typedLane = lane as BeatmapNote['lane']
      const isHitLane = feedback?.lane === typedLane
      const padFlash = isHitLane ? shieldFlash : 0
      const pad = padRefs.current[typedLane]
      const material = padMaterials.current[typedLane]
      const triggerAge = now - (padTriggers[typedLane] || -Infinity)
      const trigger = triggerAge >= 0 && triggerAge < 130 ? Math.sin((1 - triggerAge / 130) * Math.PI) : 0
      if (pad) {
        pad.position.x = -1.02 + trigger * 0.075
        pad.scale.y = 1 + padFlash * 0.18
        pad.scale.x = 1 + padFlash * 0.12
      }
      if (material) {
        const baseColor = new Color(color)
        const flashColor = new Color(feedback?.kind === 'perfect-parry' ? '#fff4a3' : '#ffd166')
        const baseEmissive = new Color(color).multiplyScalar(0.35)
        const flashEmissive = new Color(feedback?.kind === 'perfect-parry' ? '#ffdd00' : '#ff9500')
        material.color.copy(baseColor.lerp(flashColor, padFlash))
        material.emissive.copy(baseEmissive.lerp(flashEmissive, padFlash))
      }
    })
    if (burst.current) {
      const visible = feedbackAge >= 0 && feedbackAge < 360 && isSuccessfulParry
      const pulse = visible ? 1 - feedbackAge / 360 : 0
      burst.current.visible = visible
      burst.current.scale.setScalar((feedback?.kind === 'perfect-parry' ? 1.0 : 0.72) * (0.18 + (1 - pulse) * 1.25))
      burst.current.rotation.z = feedbackAge / 150
    }
  })

  return (
    <>
      <color attach="background" args={["#070812"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[0, 4, 5]} intensity={2.5} />
      <mesh position={[0, -0.92, 0]}><boxGeometry args={[6.2, 0.04, 1.4]} /><meshStandardMaterial color="#1d2540" /></mesh>
      {Object.entries(laneColor).map(([lane, color]) => {
        const typedLane = lane as BeatmapNote['lane']
        return (
          <group key={lane}>
            <mesh ref={(mesh) => { padRefs.current[typedLane] = mesh }} position={[-1.02, laneY[typedLane], 0.11]}>
              <boxGeometry args={[0.065, 0.18, 0.12]} />
              <meshStandardMaterial ref={(material) => { padMaterials.current[typedLane] = material }} color={color} emissive={color} />
            </mesh>
            <Text position={[-1.23, laneY[typedLane] - 0.01, 0.12]} fontSize={0.08} color="#edf3ff" anchorX="center">{laneKey[typedLane]}</Text>
          </group>
        )
      })}
      <mesh ref={parryShield} position={[-0.98, laneY[feedback?.lane ?? 'mid'], 0.16]} visible={false}><torusGeometry args={[0.18, 0.018, 12, 48]} /><meshStandardMaterial color="#7df9ff" emissive="#2de8ff" transparent opacity={0.9} /></mesh>
      {Object.entries(laneColor).map(([lane, color]) => {
        const typedLane = lane as BeatmapNote['lane']
        return (
          <group key={`cannon-${lane}`} ref={(group) => { cannonRefs.current[typedLane] = group }} position={[1.55, laneY[typedLane], 0.08]}>
            <mesh><boxGeometry args={[0.23, 0.16, 0.11]} /><meshStandardMaterial color={color} emissive={color} /></mesh>
          </group>
        )
      })}
      {attacks.map((attack) => <ProjectileVisual key={attack.id} attack={attack} hidden={false} />)}
      <mesh ref={impactFlash} position={[-0.98, 0.06, 0.18]} visible={false}><ringGeometry args={[0.12, 0.15, 48]} /><meshStandardMaterial color="#fff1b8" emissive="#ffd166" transparent opacity={0.95} /></mesh>
      <group ref={burst} position={[-0.98, laneY[feedback?.lane ?? 'mid'], 0.22]} visible={false}>
        <mesh><ringGeometry args={[0.18, 0.22, 64]} /><meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? '#ffffff' : '#7df9ff'} emissive={feedback?.kind === 'perfect-parry' ? '#7df9ff' : '#2de8ff'} transparent opacity={0.62} /></mesh>
        <mesh rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.48, 0.028, 0.035]} /><meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? '#ffffff' : '#83ff70'} emissive="#7df9ff" transparent opacity={0.55} /></mesh>
        <mesh rotation={[0, 0, -Math.PI / 4]}><boxGeometry args={[0.48, 0.028, 0.035]} /><meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? '#ffffff' : '#83ff70'} emissive="#7df9ff" transparent opacity={0.55} /></mesh>
      </group>
    </>
  )
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
  const [activeTab, setActiveTab] = useState<'play' | 'edit' | 'import' | 'debug'>('play')
  const [bpm, setBpm] = useState(120)
  const [beatOffsetMs, setBeatOffsetMs] = useState(0)
  const [tapTimes, setTapTimes] = useState<number[]>([])
  const [tapMode, setTapMode] = useState(false)
  const [quantize, setQuantize] = useState(true)
  const [gridDivision, setGridDivision] = useState<GridDivision>(16)
  const [timelineZoomSeconds, setTimelineZoomSeconds] = useState<number | 'fit'>(30)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [padTriggers, setPadTriggers] = useState<Record<Lane, number>>({ kick: 0, snare: 0, low: 0, mid: 0, high: 0 })
  const audioRef = useRef<HTMLAudioElement>(null)
  const scheduledNoteIds = useRef(new Set<string>())
  const heldStarts = useRef<Partial<Record<Lane, number>>>({})

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
    setImportedSong(song)
    const beatmapResponse = await fetch(song.beatmapUrl)
    const loadedBeatmap = await beatmapResponse.json()
    const savedBpm = Number(localStorage.getItem(bpmStorageKey(song.id, loadedBeatmap.id) ?? '') ?? localStorage.getItem(bpmStorageKey(song.id) ?? '') ?? '')
    setBeatmap(normalizeBeatmap(loadedBeatmap))
    setMapTitle(loadedBeatmap.title ?? song.title)
    setDifficulty(loadedBeatmap.difficulty ?? 1)
    setBpm(Number.isFinite(savedBpm) && savedBpm > 0 ? savedBpm : loadedBeatmap.bpm ?? 120)
    setBeatOffsetMs(loadedBeatmap.beatOffsetMs ?? 0)
    setSongBeatmaps(song.beatmaps ?? [])
    scheduledNoteIds.current.clear()
    setImportStatus(`Loaded ${song.noteCount} notes from cache`)
  }, [])

  useEffect(() => { void loadImports() }, [loadImports])

  useEffect(() => {
    if (!importedSong) return
    localStorage.setItem(bpmStorageKey(importedSong.id) ?? '', String(bpm))
    if (beatmap?.id) localStorage.setItem(bpmStorageKey(importedSong.id, beatmap.id) ?? '', String(bpm))
    setBeatmap((current) => current && (current.bpm !== bpm || current.beatOffsetMs !== beatOffsetMs) ? { ...current, bpm, beatOffsetMs } : current)
  }, [beatOffsetMs, beatmap?.id, bpm, importedSong])

  const gridMs = useMemo(() => (60000 / bpm) * (4 / gridDivision), [bpm, gridDivision])
  const quantizeTime = useCallback((rawTimeMs: number) => {
    if (!quantize) return rawTimeMs
    const snapped = beatOffsetMs + Math.round((rawTimeMs - beatOffsetMs) / gridMs) * gridMs
    return Math.abs(snapped - rawTimeMs) <= Math.max(35, gridMs * 0.45) ? snapped : rawTimeMs
  }, [beatOffsetMs, gridMs, quantize])

  const nextAttack = useCallback(() => {
    setLastResult(null); setLastAutoMiss(false); setFeedback(null); scheduledNoteIds.current.clear(); setActiveAttacks(makeIdlePattern())
  }, [tuning])

  const parry = useCallback((lane: BeatmapNote['lane'] = 'mid') => {
    const inputTimeMs = performance.now()
    const laneAttacks = activeAttacks.filter((attack) => (attack.lane ?? 'mid') === lane)
    const target = laneAttacks.reduce<Attack | null>((best, attack) => !best || Math.abs(attack.impactMs - inputTimeMs) < Math.abs(best.impactMs - inputTimeMs) ? attack : best, null)
    if (!target) return
    const result = judgeParryTiming({ inputTimeMs, impactTimeMs: target.impactMs, ...tuning })
    setLastResult(result); setLastAutoMiss(false); setParryPulse(inputTimeMs)
    const kind: FeedbackEvent['kind'] = result.success ? (result.grade === 'perfect' ? 'perfect-parry' : 'good-parry') : 'miss'
    setFeedback({ id: Math.random(), kind, startedAtMs: inputTimeMs, lane }); playParrySound(kind)
    if (result.success) {
      setStats((s) => ({ ...s, hit: s.hit + 1, perfect: s.perfect + (result.grade === 'perfect' ? 1 : 0), good: s.good + (result.grade === 'good' ? 1 : 0), streak: s.streak + 1, bestStreak: Math.max(s.bestStreak, s.streak + 1) }))
      setActiveAttacks((attacks) => attacks.filter((attack) => attack.id !== target.id))
    }
  }, [activeAttacks, tuning])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const lane = keyLane[event.code]
      if (isTextEditingTarget(event.target) || (!isRecording && isEditingTarget(event.target))) return
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
  }, [armedLanes, isRecording, nextAttack, parry, quantize, quantizeTime, tapMode])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      setActiveAttacks((attacks) => {
        const expired = attacks.filter((attack) => now >= attack.impactMs + tuning.parryWindowMs && now < attack.impactMs + tuning.recoveryMs + 700)
        if (isSongPlaying && expired.length > 0) {
          setStats((s) => ({ ...s, missed: s.missed + expired.length, streak: 0 }))
          setLastResult(null)
          setLastAutoMiss(true)
        }
        return attacks.filter((attack) => now < attack.impactMs + (isSongPlaying ? tuning.parryWindowMs : tuning.recoveryMs + 700))
      })
      if (!isSongPlaying && activeAttacks.length === 0) setActiveAttacks(makeIdlePattern())
    }, 100)
    return () => window.clearInterval(timer)
  }, [activeAttacks.length, isSongPlaying, tuning])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio || audio.paused) return
      const songTimeMs = audio.currentTime * 1000
      setSongTimeMs(songTimeMs)
      if (!beatmap) return
      const spawnLeadMs = tuning.telegraphMs
      const dueNotes = beatmap.notes.filter((note) => {
        const timeUntilImpactMs = note.impactTimeMs - songTimeMs
        return !scheduledNoteIds.current.has(note.id) && timeUntilImpactMs > 0 && timeUntilImpactMs <= spawnLeadMs
      }).slice(0, 6)
      if (dueNotes.length === 0) return
      dueNotes.forEach((note) => scheduledNoteIds.current.add(note.id))
      setLastResult(null); setLastAutoMiss(false); setFeedback(null)
      setActiveAttacks((attacks) => [...attacks, ...dueNotes.map((note) => makeBeatmapAttack(note.impactTimeMs - songTimeMs, note.lane, note.durationMs))].sort((a, b) => a.impactMs - b.impactMs).slice(0, 12))
    }, 25)
    return () => window.clearInterval(timer)
  }, [beatmap, tuning.telegraphMs])

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
    scheduledNoteIds.current.clear()
  }, [armedLanes, recordMode, recordStartMs, recordedNotes])

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
    const savedBpm = Number(localStorage.getItem(bpmStorageKey(loaded.songId, loaded.id) ?? '') ?? localStorage.getItem(bpmStorageKey(loaded.songId) ?? '') ?? '')
    setBpm(Number.isFinite(savedBpm) && savedBpm > 0 ? savedBpm : loaded.bpm ?? 120)
    setBeatOffsetMs(loaded.beatOffsetMs ?? 0)
    scheduledNoteIds.current.clear()
  }, [songBeatmaps])

  const createBlankBeatmap = useCallback(() => {
    if (!importedSong) return
    const title = `${importedSong.title} custom`
    setBeatmap({ id: `new-${Date.now().toString(36)}`, songId: importedSong.id, title, difficulty, bpm, beatOffsetMs, durationMs: importedSong.durationMs, notes: [] })
    setMapTitle(title)
    setRecordedNotes([])
    scheduledNoteIds.current.clear()
  }, [beatOffsetMs, bpm, difficulty, importedSong])

  const clearBeatmapEvents = useCallback(() => {
    setBeatmap((current) => current ? { ...current, notes: [] } : current)
    setRecordedNotes([])
    scheduledNoteIds.current.clear()
  }, [])

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
    scheduledNoteIds.current.clear()
    setActiveAttacks([])
    setLastResult(null)
    setLastAutoMiss(false)
    setFeedback(null)
  }, [beatmap?.durationMs, importedSong?.durationMs])
  const seekTimeline = useCallback((timeMs: number, bypassSnap = false) => {
    const snappedTimeMs = quantize && !bypassSnap ? beatOffsetMs + Math.round((timeMs - beatOffsetMs) / gridMs) * gridMs : timeMs
    seekSong(Math.max(0, snappedTimeMs))
  }, [beatOffsetMs, gridMs, quantize, seekSong])
  const playSong = useCallback(() => { void audioRef.current?.play() }, [])
  const pauseSong = useCallback(() => { audioRef.current?.pause() }, [])
  const restartSong = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setSongTimeMs(0)
    scheduledNoteIds.current.clear()
    setActiveAttacks([])
    setStats({ hit: 0, perfect: 0, good: 0, missed: 0, streak: 0, bestStreak: 0 })
    setLastResult(null)
    setLastAutoMiss(false)
    void audio.play()
  }, [])

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
      if (detectedBpm) setBpm(Math.round(detectedBpm))
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
    if (activeTab !== 'edit') return { startMs: songTimeMs - 5000, endMs: songTimeMs + 5000, spanMs: 10000 }
    if (timelineZoomSeconds === 'fit' && importedSong) return { startMs: 0, endMs: importedSong.durationMs, spanMs: importedSong.durationMs }
    const spanMs = (timelineZoomSeconds === 'fit' ? 60 : timelineZoomSeconds * 2) * 1000
    const durationMs = importedSong?.durationMs
    const maxStartMs = durationMs ? Math.max(0, durationMs - spanMs) : Number.POSITIVE_INFINITY
    const startMs = Math.min(Math.max(0, songTimeMs - spanMs / 2), maxStartMs)
    return { startMs, endMs: startMs + spanMs, spanMs }
  }, [activeTab, importedSong, songTimeMs, timelineZoomSeconds])
  const removeNote = useCallback((noteId: string) => {
    setBeatmap((current) => current ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) } : current)
    setRecordedNotes((notes) => notes.filter((note) => note.id !== noteId))
    setSelectedNoteId((id) => id === noteId ? null : id)
    scheduledNoteIds.current.delete(noteId)
  }, [])
  const timelineGridLines = useMemo(() => {
    const quarterMs = 60000 / bpm
    const first = beatOffsetMs + Math.ceil((timelineBounds.startMs - beatOffsetMs) / gridMs) * gridMs
    const gridSpacingPercent = (gridMs / timelineBounds.spanMs) * 100
    const lines: Array<{ left: number; strength: 'bar' | 'beat' | 'sub'; label?: string }> = []
    for (let timeMs = first; timeMs <= timelineBounds.endMs; timeMs += gridMs) {
      const left = ((timeMs - timelineBounds.startMs) / timelineBounds.spanMs) * 100
      const beatIndex = Math.round((timeMs - beatOffsetMs) / quarterMs)
      const isBeat = Math.abs(timeMs - (beatOffsetMs + beatIndex * quarterMs)) < 1
      const isBar = isBeat && beatIndex % 4 === 0
      const beatNumber = ((beatIndex % 4) + 4) % 4 + 1
      if (!isBeat && gridSpacingPercent < 1.2) continue
      if (isBeat && gridSpacingPercent < 0.35) continue
      lines.push({ left, strength: isBar ? 'bar' : isBeat ? 'beat' : 'sub', label: isBeat ? String(beatNumber) : undefined })
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
    zoomTimeline(event.deltaY < 0 ? 'in' : 'out')
  }, [zoomTimeline])
  const setBeatOneAtPlayhead = useCallback(() => setBeatOffsetMs(Math.max(0, songTimeMs)), [songTimeMs])
  const nudgeBeatOffset = useCallback((deltaMs: number) => setBeatOffsetMs((value) => Math.max(0, value + deltaMs)), [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeTab !== 'edit' || isEditingTarget(event.target) || !selectedNoteId) return
      if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault()
        removeNote(selectedNoteId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab, removeNote, selectedNoteId])
  const songProgress = importedSong ? Math.min(100, (songTimeMs / importedSong.durationMs) * 100) : 0
  const transport = <Card className="transport-card"><CardHeader><CardTitle>Now playing</CardTitle><CardDescription>{importedSong ? importedSong.title : 'Import a song to start mapping and playing.'}</CardDescription></CardHeader>{savedImports.length > 0 && <Field><FieldLabel>Song library</FieldLabel><Select value={importedSong?.id ?? ''} onChange={(event) => { const song = savedImports.find((item) => item.id === event.target.value); if (song) void loadImport(song) }}><option value="">Select cached song…</option>{savedImports.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</Select></Field>}{importedSong ? <>{songBeatmaps.length > 0 && <Field><FieldLabel>Beatmap</FieldLabel><Select value={beatmap?.id ?? ''} onChange={(event) => void loadBeatmap(event.target.value)}>{songBeatmaps.map((map) => <option key={map.id} value={map.id}>{'★'.repeat(map.difficulty ?? 1)} {map.title} ({map.noteCount})</option>)}</Select></Field>}<div className="transport-progress"><span>{Math.round(songTimeMs / 1000)}s</span><div><i style={{ width: `${songProgress}%` }} /></div><span>{Math.round(importedSong.durationMs / 1000)}s</span></div><div className="metric-row"><Badge>{beatmap?.notes.length ?? importedSong.noteCount} notes</Badge><Badge tone={isSongPlaying ? 'success' : 'muted'}>{isSongPlaying ? 'Playing' : 'Paused'}</Badge></div><ButtonGroup className="transport-actions"><PlayPauseButton isPlaying={isSongPlaying} onPlay={playSong} onPause={pauseSong} /><Button type="button" variant="secondary" onClick={restartSong}>Restart</Button></ButtonGroup></> : <Button type="button" variant="secondary" onClick={() => setActiveTab('import')}>Import a song</Button>}</Card>
  const judgementText = lastAutoMiss ? 'miss' : lastResult ? lastResult.grade : 'ready'
  const gradeColor = lastAutoMiss ? '#ff5570' : lastResult?.grade === 'perfect' ? '#ffd166' : lastResult?.grade === 'good' ? '#83ff70' : undefined
  const timingColor = lastResult?.success ? gradeColor : lastResult ? (lastResult.deltaMs < 0 ? '#83ff70' : '#ff5570') : undefined
  const roundedDeltaMs = lastResult ? Math.round(lastResult.deltaMs) : null
  const deltaText = roundedDeltaMs === null ? '—' : `${roundedDeltaMs > 0 ? '+' : ''}${roundedDeltaMs}ms`

  return (
    <main className={activeTab === 'edit' ? 'editing-layout' : undefined}>
      <section className={activeTab === 'edit' ? 'stage edit-stage' : 'stage'}>
        {activeTab === 'edit'
          ? <div className="edit-workspace"><div className="edit-workspace__header"><div className="edit-title-row"><div><span className="eyebrow">Pattern editor</span><h2>{mapTitle || 'Untitled beatmap'}</h2><p>{recordedNotes.length} buffered · {beatmap?.notes.length ?? 0} saved · Record captures Space/W/arrows by feel · click notes to remove</p></div><div className="edit-primary-actions"><PlayPauseButton isPlaying={isSongPlaying} onPlay={playSong} onPause={pauseSong} /><Button type="button" variant={isRecording ? 'warning' : 'secondary'} onClick={isRecording ? stopRecording : startRecording}>{isRecording ? 'Stop rec' : 'Record'}</Button><Button type="button" variant="secondary" onClick={() => void saveBeatmap(false)} disabled={!beatmap || !importedSong}>Save</Button></div></div><div className="edit-toolbar"><div className="toolbar-section"><span className="toolbar-section__label">Record</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" className={recordMode === 'add' ? 'active' : ''} onClick={() => setRecordMode('add')}>Add</Button><Button type="button" variant="ghost" size="pill" className={recordMode === 'replace' ? 'active' : ''} onClick={() => setRecordMode('replace')}>Replace</Button></div></div><div className="toolbar-section toolbar-section--wide"><span className="toolbar-section__label">Lanes</span><div className="toolbar-group">{lanes.map((lane) => <Button key={lane} type="button" variant="ghost" size="pill" className={armedLanes.has(lane) ? 'active' : ''} onClick={() => setArmedLanes((current) => { const next = new Set(current); if (next.has(lane)) next.delete(lane); else next.add(lane); return next })}>{lane}</Button>)}</div></div><div className="toolbar-section"><span className="toolbar-section__label">Grid</span><div className="toolbar-group">{([4, 8, 16, 32] as const).map((division) => <Button key={division} type="button" variant="ghost" size="pill" className={gridDivision === division ? 'active' : ''} onClick={() => setGridDivision(division)}>1/{division}</Button>)}<Button type="button" variant="ghost" size="pill" className={quantize ? 'active' : ''} onClick={() => setQuantize((value) => !value)}>Snap</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Zoom</span><div className="toolbar-group">{zoomOptions.map((seconds) => <Button key={seconds} type="button" variant="ghost" size="pill" className={timelineZoomSeconds === seconds ? 'active' : ''} onClick={() => setTimelineZoomSeconds(seconds)}>{seconds * 2}s</Button>)}<Button type="button" variant="ghost" size="pill" className={timelineZoomSeconds === 'fit' ? 'active' : ''} onClick={() => setTimelineZoomSeconds('fit')}>Fit</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Tempo{tapMode ? ` · ${detectedBpm ? `${detectedBpm} bpm` : 'tap keys'}` : ''}</span><div className="toolbar-group"><Input type="number" min="40" max="300" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} /><Button type="button" variant="ghost" size="pill" className={tapMode ? 'active' : ''} onClick={toggleTapBpm}>{tapMode ? 'Stop + use' : 'Start tap'}</Button></div>{tapMode && <span className="tap-bpm-readout">{detectedBpm ? `Live BPM ${detectedBpm}` : 'Press Space/W/arrows on the beat…'}</span>}</div><div className="toolbar-section toolbar-section--wide"><span className="toolbar-section__label">Beat 1 · {(beatOffsetMs / 1000).toFixed(3)}s</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={setBeatOneAtPlayhead}>Set at playhead</Button><Button type="button" variant="ghost" size="pill" onClick={() => nudgeBeatOffset(-10)}>-10ms</Button><Button type="button" variant="ghost" size="pill" onClick={() => nudgeBeatOffset(10)}>+10ms</Button></div></div><div className="toolbar-section"><span className="toolbar-section__label">Selection</span><div className="toolbar-group"><Button type="button" variant="ghost" size="pill" onClick={() => selectedNoteId && removeNote(selectedNoteId)} disabled={!selectedNoteId}>Delete</Button></div></div></div></div><EditorTimeline notes={timelineNotes} gridLines={timelineGridLines} bounds={timelineBounds} songTimeMs={songTimeMs} selectedNoteId={selectedNoteId} onTimelineClick={handleTimelineClick} onTimelineWheel={handleTimelineWheel} onSeek={seekTimeline} onRemoveNote={removeNote} /></div>
          : <Canvas camera={{ position: [0, 0.18, 7.2], fov: 42 }}><Arena attacks={activeAttacks} tuning={tuning} parryPulse={parryPulse} feedback={feedback} padTriggers={padTriggers} onPhaseChange={setPhase} /></Canvas>}
      </section>
      {activeTab !== 'edit' && <div className="status-stack" aria-live="polite">
        <div className="toast"><strong>{phase}</strong></div>
        <div className="toast"><strong style={{ color: gradeColor }}>{judgementText}</strong></div>
        <div className="toast"><strong style={{ color: timingColor }}>{lastAutoMiss ? '—' : deltaText}</strong></div>
      </div>}
      {importedSong && <audio ref={audioRef} src={importedSong.audioUrl} onPlay={() => setIsSongPlaying(true)} onPause={() => setIsSongPlaying(false)} onEnded={() => setIsSongPlaying(false)} onTimeUpdate={(event) => setSongTimeMs(event.currentTarget.currentTime * 1000)} onSeeked={(event) => { setSongTimeMs(event.currentTarget.currentTime * 1000); scheduledNoteIds.current.clear() }} />}
      <aside className="panel">
        <div className="panel-hero"><span className="eyebrow">Rhythm parry lab</span><h1>Flow Fight</h1><p>Schedule impacts on beat, test the feel, then refine the map by jamming.</p></div>
        <Tabs>{(['play', 'edit', 'import', 'debug'] as const).map((tab) => <Button key={tab} type="button" variant="ghost" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</Button>)}</Tabs>

        {activeTab === 'play' && <>
          {transport}
          <Card><CardHeader><CardTitle>Run stats</CardTitle><CardDescription>Quick read on accuracy and streak health.</CardDescription></CardHeader><div className="stat-grid"><div><span>Accuracy</span><strong>{stats.hit + stats.missed ? Math.round((stats.hit / (stats.hit + stats.missed)) * 100) : 0}%</strong></div><div><span>Streak</span><strong>{stats.streak}</strong></div><div><span>Best</span><strong>{stats.bestStreak}</strong></div><div><span>Miss</span><strong>{stats.missed}</strong></div></div><div className="metric-row"><Badge tone="warning">Perfect {stats.perfect}</Badge><Badge tone="success">Good {stats.good}</Badge><Badge>Hit {stats.hit}</Badge></div></Card>
          <Disclosure><DisclosureSummary>Timing feel</DisclosureSummary>{rows.slice(0, 2).map(([label, value, min, max, unit, key]) => <Field key={key}><FieldLabel>{label}: <strong>{value}{unit}</strong></FieldLabel><Slider min={min} max={max} value={value} onChange={(e) => setTuning((t) => ({ ...t, [key]: Number(e.target.value) }))} /></Field>)}</Disclosure>
        </>}

        {activeTab === 'edit' && <>
          {transport}
          <Card><CardHeader><CardTitle>Map details</CardTitle><CardDescription>Sidebar is for metadata and destructive/new-map actions only. Active editing lives in the main pane.</CardDescription></CardHeader><Field><FieldLabel>Title</FieldLabel><Input value={mapTitle} onChange={(event) => setMapTitle(event.target.value)} placeholder="Beatmap title" /></Field><Field><FieldLabel>Difficulty <strong>{'★'.repeat(difficulty)}</strong></FieldLabel><Slider min="1" max="5" value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></Field><div className="action-grid"><Button type="button" variant="secondary" onClick={() => void saveBeatmap(true)}>Save as new</Button><Button type="button" variant="secondary" onClick={createBlankBeatmap}>New blank</Button><Button type="button" variant="secondary" onClick={exportBeatmap}>Export JSON</Button><Button type="button" variant="warning" onClick={clearBeatmapEvents}>Wipe events</Button></div>{tapMode && <p className="editor-hint">Tap tempo is listening for lane keys. Use the main pane's Tap button to save.</p>}</Card>
        </>}

        {activeTab === 'import' && <Card className="import-card"><CardHeader><CardTitle>Import from YouTube</CardTitle><CardDescription>Paste a URL once. Flow Fight caches audio, metadata, and the generated draft map locally.</CardDescription></CardHeader><div className="url-row"><Input type="url" placeholder="https://www.youtube.com/watch?v=…" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} /><Button type="button" onClick={importYoutube}>Import</Button></div>{importStatus && <p className="import-status">{importStatus}</p>}{importedSong && <div className="song-card"><strong>{importedSong.title}</strong><span>{Math.round(importedSong.durationMs / 1000)}s · {beatmap?.notes.length ?? importedSong.noteCount} notes</span><a href={importedSong.beatmapUrl} target="_blank">Open original beatmap JSON</a></div>}</Card>}

        {activeTab === 'debug' && <><Card><CardHeader><CardTitle>Tuning</CardTitle><CardDescription>Adjust judgement windows and projectile timing.</CardDescription></CardHeader>{rows.map(([label, value, min, max, unit, key]) => <Field key={key}><FieldLabel>{label}: <strong>{value}{unit}</strong></FieldLabel><Slider min={min} max={max} value={value} onChange={(e) => setTuning((t) => ({ ...t, [key]: Number(e.target.value) }))} /></Field>)}</Card><Card><CardHeader><CardTitle>Timing debug</CardTitle></CardHeader><Stack><code>zero point: leading edge touches shield</code><code>active projectiles: {activeAttacks.length}</code><code>impactTime: {currentAttack ? currentAttack.impactMs.toFixed(2) : '—'}ms</code><code>this travel: {currentAttack ? currentAttack.travelMs.toFixed(0) : '—'}ms</code><code>song mode: {isSongPlaying && beatmap ? `${beatmap.notes.length} notes` : 'off'}</code><code>parry: ±{tuning.parryWindowMs}ms ({tuning.parryWindowMs * 2}ms total)</code><code>perfect: ±{tuning.perfectWindowMs}ms ({tuning.perfectWindowMs * 2}ms total)</code><code>delta: {lastResult ? `${lastResult.deltaMs.toFixed(2)}ms` : '—'}</code><code>result: {lastResult ? `${lastResult.grade} / ${lastResult.success ? 'success' : 'miss'}` : '—'}</code></Stack></Card></>}
      </aside>
    </main>
  )
}

export default App
