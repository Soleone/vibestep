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
  const halfWindowMs = parryWindowMs / 2
  const halfPerfectMs = perfectWindowMs / 2

  if (absDeltaMs <= halfPerfectMs) {
    return { deltaMs, absDeltaMs, success: true, grade: 'perfect' }
  }

  if (absDeltaMs <= halfWindowMs) {
    return { deltaMs, absDeltaMs, success: true, grade: 'good' }
  }

  return {
    deltaMs,
    absDeltaMs,
    success: false,
    grade: deltaMs < 0 ? 'early' : 'late',
  }
}

export function attackPhase(nowMs: number, startMs: number, impactMs: number, recoveryMs: number) {
  const t = nowMs - startMs
  if (t < 0) return 'queued'
  if (nowMs < impactMs) return 'windup'
  if (nowMs < impactMs + recoveryMs) return 'strike'
  return 'done'
}
