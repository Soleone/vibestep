export type Lane = 'kick' | 'snare' | 'low' | 'mid' | 'high'
export type Tuning = { parryWindowMs: number; perfectWindowMs: number; telegraphMs: number; recoveryMs: number; inputOffsetMs: number }
export type Attack = { id: number; startMs: number; impactMs: number; travelMs: number; lane?: Lane; durationMs?: number; holdStarted?: boolean; initialMissed?: boolean; noteId?: string; scheduleKey?: string }
export type FeedbackEvent = { id: number; kind: 'good-parry' | 'perfect-parry' | 'miss'; startedAtMs: number; lane?: Lane }
export type SavedBeatmap = { id: string; title: string; difficulty: number; updatedAt?: string; noteCount: number; url: string }
export type ImportResult = { id: string; title: string; durationMs: number; audioUrl: string; beatmapUrl: string; noteCount: number; sourceUrl?: string; cached?: boolean; bpm?: number; beatOffsetMs?: number; beatmaps?: SavedBeatmap[] }
export type BeatmapNote = { id: string; impactTimeMs: number; rawTimeMs?: number; durationMs?: number; lane: Lane; strength: number; source: string; resolved?: boolean }
export type Beatmap = { id: string; songId?: string; title: string; difficulty?: number; version?: number; bpm?: number; beatOffsetMs?: number; durationMs: number; notes: BeatmapNote[] }
export type PlayStats = { hit: number; perfect: number; good: number; missed: number; streak: number; bestStreak: number }
export type GridDivision = 4 | 8 | 16 | 32 | 64
export type LaneControls = Record<Lane, { keyboard: string; gamepadButton: number }>
export type TimelineBounds = { startMs: number; endMs: number; spanMs: number }
export type TimelineGridLine = { left: number; strength: 'bar' | 'beat' | 'sub'; label?: string }
export type LoopMarkers = { startMs: number | null; endMs: number | null }

export const initialTuning: Tuning = { parryWindowMs: 80, perfectWindowMs: 40, telegraphMs: 1150, recoveryMs: 260, inputOffsetMs: 0 }
export const judgementColors = {
  perfect: '#83ff70',
  good: '#ffd166',
  miss: '#ff5570',
  early: '#ffd166',
  late: '#ff5570',
} as const
export const judgementCssVars = {
  perfect: 'var(--ff-judgement-perfect)',
  good: 'var(--ff-judgement-good)',
  miss: 'var(--ff-judgement-miss)',
  early: 'var(--ff-judgement-early)',
  late: 'var(--ff-judgement-late)',
} as const
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const laneY: Record<Lane, number> = { kick: -0.58, snare: -0.32, low: 0.18, mid: 0.48, high: 0.78 }
export const laneColor: Record<Lane, string> = {
  kick: '#ff5570',
  snare: '#ff9f43',
  low: '#4da3ff',
  mid: '#b56cff',
  high: '#83ff70',
}
export const lanes = ['kick', 'snare', 'low', 'mid', 'high'] as const
export const defaultControls: LaneControls = {
  kick: { keyboard: 'KeyA', gamepadButton: 0 },
  snare: { keyboard: 'KeyD', gamepadButton: 1 },
  low: { keyboard: 'ArrowLeft', gamepadButton: 14 },
  mid: { keyboard: 'ArrowDown', gamepadButton: 13 },
  high: { keyboard: 'ArrowRight', gamepadButton: 15 },
}
export const gamepadButtonLabels: Record<number, string> = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 12: 'D-pad Up', 13: 'D-pad Down', 14: 'D-pad Left', 15: 'D-pad Right' }

export const timelineRulerHeightPx = 28
export const timelineLaneHeightPx = 58
export const timelineLaneTopPx = timelineRulerHeightPx
export const timelineLaneAreaHeightPx = lanes.length * timelineLaneHeightPx

export function normalizeLane(lane: unknown): Lane {
  if (lane === 'left') return 'low'
  if (lane === 'up' || lane === 'down') return 'mid'
  if (lane === 'right') return 'high'
  if (lane === 'kick' || lane === 'snare' || lane === 'low' || lane === 'mid' || lane === 'high') return lane
  return 'mid'
}

export function normalizeBeatmap(beatmap: Beatmap): Beatmap {
  return {
    ...beatmap,
    beatOffsetMs: beatmap.beatOffsetMs ?? 0,
    notes: beatmap.notes
      .map((note) => ({ ...note, lane: normalizeLane(note.lane) }))
      .sort((a, b) => a.impactTimeMs - b.impactTimeMs),
  }
}

export function makeBeatmapAttack(timeUntilImpactMs: number, lane: Lane, durationMs?: number, noteId?: string, scheduleKey?: string): Attack {
  const now = performance.now()
  const travelMs = Math.max(120, timeUntilImpactMs)
  return { id: Math.random(), startMs: now, travelMs, impactMs: now + travelMs, lane, durationMs, noteId, scheduleKey }
}

export function makeIdlePattern(): Attack[] {
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
