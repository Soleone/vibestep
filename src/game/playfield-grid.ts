export const PLAYFIELD_PROJECTILE_START_X = 1.34
export const PLAYFIELD_IMPACT_X = -0.91

export type PlayfieldBeatDivider = {
  x: number
  strength: 'beat' | 'sub'
}

export function makePlayfieldBeatDividers(bpm: number, travelMs: number): PlayfieldBeatDivider[] {
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(travelMs) || travelMs <= 0) return []

  const halfBeatMs = 30000 / bpm
  const dividerCount = Math.floor((travelMs - 0.001) / halfBeatMs)
  const travelDistance = PLAYFIELD_PROJECTILE_START_X - PLAYFIELD_IMPACT_X

  return Array.from({ length: dividerCount }, (_, index) => {
    const halfBeatIndex = index + 1
    const travelProgress = (halfBeatIndex * halfBeatMs) / travelMs
    return {
      x: PLAYFIELD_IMPACT_X + travelDistance * travelProgress,
      strength: halfBeatIndex % 2 === 0 ? 'beat' : 'sub',
    }
  })
}
