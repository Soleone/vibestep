export function mediaDurationMs(durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  return Math.round(durationSeconds * 1000)
}
