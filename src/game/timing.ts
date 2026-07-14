export type ParryGrade = 'perfect' | 'good' | 'early' | 'late' | 'miss'

export type ParryTimingInput = {
  inputTimeMs: number
  impactTimeMs: number
  parryWindowMs: number
  perfectWindowMs: number
  inputOffsetMs: number
}

export type ParryTimingResult = {
  deltaMs: number
  absDeltaMs: number
  success: boolean
  grade: ParryGrade
}

export function judgeParryTiming({
  inputTimeMs,
  impactTimeMs,
  parryWindowMs,
  perfectWindowMs,
  inputOffsetMs,
}: ParryTimingInput): ParryTimingResult {
  const adjustedInputMs = inputTimeMs + inputOffsetMs
  const deltaMs = adjustedInputMs - impactTimeMs
  const absDeltaMs = Math.abs(deltaMs)
  const leniencyMs = parryWindowMs
  const perfectLeniencyMs = perfectWindowMs

  if (absDeltaMs <= perfectLeniencyMs) {
    return { deltaMs, absDeltaMs, success: true, grade: 'perfect' }
  }

  if (absDeltaMs <= leniencyMs) {
    return { deltaMs, absDeltaMs, success: true, grade: 'good' }
  }

  return {
    deltaMs,
    absDeltaMs,
    success: false,
    grade: deltaMs < 0 ? 'early' : 'late',
  }
}

export function syncopationAmount(impactTimeMs: number, bpm: number, beatOffsetMs: number) {
  if (!Number.isFinite(impactTimeMs) || !Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(beatOffsetMs)) return 0
  const beatPosition = (impactTimeMs - beatOffsetMs) / (60000 / bpm)
  const distanceFromBeat = Math.abs(beatPosition - Math.round(beatPosition))
  return Math.min(1, Math.max(0, distanceFromBeat / 0.5))
}

export function attackPhase(nowMs: number, startMs: number, impactMs: number, recoveryMs: number) {
  const t = nowMs - startMs
  if (t < 0) return 'queued'
  if (nowMs < impactMs) return 'windup'
  if (nowMs < impactMs + recoveryMs) return 'strike'
  return 'done'
}
