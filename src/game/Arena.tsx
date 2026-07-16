import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color } from 'three'
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { useRef } from 'react'
import { attackPhase } from './timing'
import { clamp01, judgementColors, laneColor, laneY, lanes, missedProjectileLingerMs, type Attack, type Lane, type LaneFeedback, type Tuning } from './model'

const PROJECTILE_START_X = 1.34
const IMPACT_X = -0.91
const basePadColors = Object.fromEntries(lanes.map((lane) => [lane, new Color(laneColor[lane])])) as Record<Lane, Color>
const basePadEmissives = Object.fromEntries(lanes.map((lane) => [lane, new Color(laneColor[lane]).multiplyScalar(0.3)])) as Record<Lane, Color>
const perfectColor = new Color(judgementColors.perfect)
const goodColor = new Color(judgementColors.good)
const missColor = new Color(judgementColors.miss)
const inputFlashColor = new Color('#ffffff')

type LaneGroups = Partial<Record<Lane, Group | null>>
type LaneMeshes = Partial<Record<Lane, Mesh | null>>
type LaneBasicMaterials = Partial<Record<Lane, MeshBasicMaterial | null>>
type LaneStandardMaterials = Partial<Record<Lane, MeshStandardMaterial | null>>

function holdVisualLength(durationMs = 0) {
  return Math.min(1.5, 0.46 + durationMs / 2200)
}

function dampedImpulse(ageMs: number, durationMs: number, frequency = 34) {
  if (ageMs < 0 || ageMs >= durationMs) return 0
  return Math.exp(-ageMs / (durationMs * 0.34)) * Math.cos(ageMs / frequency)
}

function sharpRecoil(ageMs: number) {
  if (ageMs < 0 || ageMs >= 190) return 0
  return Math.exp(-ageMs / 58) * (0.86 + Math.cos(ageMs / 24) * 0.14)
}

function ProjectileVisual({ attack }: { attack: Attack }) {
  const head = useRef<Group>(null)
  const halo = useRef<Mesh>(null)
  const ribbonSegments = useRef<Array<Mesh | null>>([])
  const ribbonMaterials = useRef<Array<MeshBasicMaterial | null>>([])
  const tether = useRef<Mesh>(null)
  const tetherCore = useRef<Mesh>(null)
  const holdPulses = useRef<Array<Mesh | null>>([])
  const ghosts = useRef<Array<Mesh | null>>([])
  const lane = attack.lane ?? 'mid'
  const color = laneColor[lane]
  const isHold = (attack.durationMs ?? 0) > 0
  const isHeavy = (attack.strength ?? 1) >= 2
  const syncopation = clamp01(attack.syncopation ?? 0)
  const holdLength = holdVisualLength(attack.durationMs)

  useFrame(() => {
    const now = performance.now()
    const impactAge = now - attack.impactMs
    const travel = clamp01((now - attack.startMs) / attack.travelMs)
    const travelX = PROJECTILE_START_X + (IMPACT_X - PROJECTILE_START_X) * travel
    const missedAfterImpact = Boolean(!isHold && attack.initialMissed && impactAge >= 0)
    const missProgress = missedAfterImpact ? clamp01(impactAge / missedProjectileLingerMs) : 0
    const x = missedAfterImpact ? IMPACT_X - missProgress * 0.52 : travelX
    const visibleBeforeImpact = now >= attack.startMs
    const holdProgress = isHold && impactAge >= 0 ? clamp01(impactAge / (attack.durationMs ?? 1)) : 0
    const holding = isHold && Boolean(attack.holdStarted) && impactAge >= 0 && holdProgress < 1
    const awaitingHold = isHold && !attack.holdStarted && impactAge >= 0 && holdProgress < 1
    const missVisible = missedAfterImpact && impactAge < missedProjectileLingerMs
    const headVisible = visibleBeforeImpact && (impactAge < 0 || holding || awaitingHold || missVisible)
    const energyPulse = 0.94 + Math.sin((now - attack.startMs) / 54) * 0.06
    const completionFade = holding || awaitingHold ? Math.min(1, (1 - holdProgress) * 6) : 1

    if (head.current) {
      head.current.visible = headVisible
      head.current.position.set(holding || awaitingHold ? IMPACT_X : x, laneY[lane], 0.2)
      head.current.rotation.x = (now - attack.startMs) / (430 - syncopation * 110)
      head.current.rotation.z = (now - attack.startMs) / (310 - syncopation * 90)
      head.current.scale.setScalar((isHold ? 1.08 : 1) * (isHeavy ? 1.2 : 1) * energyPulse * completionFade * (missedAfterImpact ? 1 - missProgress * 0.45 : 1))
    }
    if (halo.current) halo.current.scale.setScalar(0.92 + Math.sin(now / 42) * 0.12)

    const ribbonLength = (isHeavy ? 0.4 : 0.34) - syncopation * 0.17 + Math.sin(now / 70) * 0.025
    const ribbonGap = 0.006 + syncopation * 0.028
    const ribbonSegmentLength = Math.max(0.025, (ribbonLength - ribbonGap * 2) / 3)
    const ribbonVisible = !isHold && visibleBeforeImpact && (impactAge < 0 || missVisible)
    ribbonSegments.current.forEach((segment, index) => {
      if (!segment) return
      segment.visible = ribbonVisible
      segment.position.set(x + 0.04 + ribbonSegmentLength / 2 + index * (ribbonSegmentLength + ribbonGap), laneY[lane], 0.13)
      segment.scale.x = ribbonSegmentLength
      const material = ribbonMaterials.current[index]
      if (material) material.opacity = (missedAfterImpact ? 0.42 * (1 - missProgress) : isHeavy ? 0.62 : 0.48) * (1 - index * syncopation * 0.12)
    })

    const tetherRemaining = holding || awaitingHold ? 1 - holdProgress : 1
    const activeTetherLength = Math.max(0.035, holdLength * tetherRemaining)
    const tetherVisible = isHold && visibleBeforeImpact && (impactAge < 0 || holding || awaitingHold)
    const tetherAnchorX = holding || awaitingHold ? IMPACT_X : x
    const tetherFade = missedAfterImpact ? 1 - missProgress : Math.min(1, tetherRemaining * 4)
    if (tether.current) {
      tether.current.visible = tetherVisible
      tether.current.position.set(tetherAnchorX + activeTetherLength / 2 + 0.05, laneY[lane], 0.13)
      tether.current.scale.set(activeTetherLength, missedAfterImpact ? 0.55 + missProgress * 0.4 : 1, 1)
      const material = tether.current.material as MeshBasicMaterial
      material.opacity = 0.36 * tetherFade
    }
    if (tetherCore.current) {
      tetherCore.current.visible = tetherVisible
      tetherCore.current.position.set(tetherAnchorX + activeTetherLength / 2 + 0.05, laneY[lane], 0.17)
      tetherCore.current.scale.set(activeTetherLength, 1, 1)
      const material = tetherCore.current.material as MeshBasicMaterial
      material.opacity = 0.84 * tetherFade
    }
    holdPulses.current.forEach((pulse, index) => {
      if (!pulse) return
      const pulseTravel = ((now - attack.startMs) / 360 + index / 3) % 1
      pulse.visible = tetherVisible && !missedAfterImpact && activeTetherLength > 0.12
      pulse.position.set(tetherAnchorX + 0.05 + activeTetherLength * (1 - pulseTravel), laneY[lane], 0.19)
      pulse.scale.setScalar(0.72 + Math.sin(pulseTravel * Math.PI) * 0.45)
    })

    ghosts.current.forEach((ghost, index) => {
      if (!ghost) return
      const lagMs = 48 * (index + 1)
      const ghostTravel = clamp01((now - lagMs - attack.startMs) / attack.travelMs)
      ghost.position.set(PROJECTILE_START_X + (IMPACT_X - PROJECTILE_START_X) * ghostTravel, laneY[lane], 0.1)
      ghost.visible = !isHold && !missedAfterImpact && now >= attack.startMs + lagMs && impactAge < 25
    })
  })

  return (
    <>
      {[0.2, 0.1].map((opacity, index) => (
        <mesh key={opacity} ref={(mesh) => { ghosts.current[index] = mesh }} visible={false}>
          <sphereGeometry args={[0.07 - index * 0.012, 12, 8]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {[0, 1, 2].map((index) => <mesh key={`ribbon-${index}`} ref={(mesh) => { ribbonSegments.current[index] = mesh }} visible={false}>
        <boxGeometry args={[1, isHeavy ? 0.062 : 0.045, 0.025]} />
        <meshBasicMaterial ref={(material) => { ribbonMaterials.current[index] = material }} color={color} transparent opacity={isHeavy ? 0.62 : 0.48} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>)}
      {isHold ? <>
        <mesh ref={tether} visible={false}><boxGeometry args={[1, 0.13, 0.035]} /><meshBasicMaterial color={color} transparent opacity={0.36} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
        <mesh ref={tetherCore} visible={false}><boxGeometry args={[1, 0.035, 0.02]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.84} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
        {[0, 1, 2].map((index) => <mesh key={index} ref={(mesh) => { holdPulses.current[index] = mesh }} visible={false}><octahedronGeometry args={[0.055, 0]} /><meshBasicMaterial color="#ffffff" blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>)}
      </> : null}
      <group ref={head} visible={false}>
        <mesh ref={halo}><sphereGeometry args={[isHold ? 0.15 : isHeavy ? 0.155 : 0.125, 16, 10]} /><meshBasicMaterial color={color} transparent opacity={isHeavy ? 0.3 : 0.2} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
        <mesh rotation={[0, 0, Math.PI / 4]}><octahedronGeometry args={[isHold ? 0.105 : isHeavy ? 0.098 : 0.082, 0]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={isHeavy ? 3 : 2.1} roughness={0.25} /></mesh>
        <mesh><sphereGeometry args={[isHold ? 0.045 : isHeavy ? 0.045 : 0.035, 12, 8]} /><meshBasicMaterial color="#ffffff" blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      </group>
    </>
  )
}

type ArenaProps = {
  attacks: Attack[]
  tuning: Tuning
  laneFeedback: LaneFeedback
  padTriggers: Record<Lane, number>
  heldLanes: Set<Lane>
  onPhaseChange: (phase: string) => void
}

export function Arena({ attacks, tuning, laneFeedback, padTriggers, heldLanes, onPhaseChange }: ArenaProps) {
  const cannonRefs = useRef<LaneGroups>({})
  const cannonChambers = useRef<LaneStandardMaterials>({})
  const muzzleFlashes = useRef<LaneGroups>({})
  const muzzleMaterials = useRef<LaneBasicMaterials>({})
  const padRefs = useRef<LaneGroups>({})
  const padMaterials = useRef<LaneStandardMaterials>({})
  const padRims = useRef<LaneStandardMaterials>({})
  const grindSparks = useRef<LaneGroups>({})
  const impactRings = useRef<LaneMeshes>({})
  const impactRingMaterials = useRef<LaneBasicMaterials>({})
  const impactBursts = useRef<LaneGroups>({})
  const impactBurstMaterials = useRef<Partial<Record<Lane, Array<MeshBasicMaterial | null>>>>({})
  const heavyImpactRings = useRef<LaneMeshes>({})
  const heavyImpactRingMaterials = useRef<LaneBasicMaterials>({})
  const heavyConfetti = useRef<LaneGroups>({})
  const heavyConfettiMaterials = useRef<Partial<Record<Lane, Array<MeshBasicMaterial | null>>>>({})
  const publishedPhase = useRef('queued')
  const primaryAttack = attacks[0]

  useFrame(() => {
    const now = performance.now()
    const rawPhase = primaryAttack ? attackPhase(now, primaryAttack.startMs, primaryAttack.impactMs, tuning.recoveryMs) : 'queued'
    const nextPhase = rawPhase === 'windup' ? 'incoming' : rawPhase
    if (nextPhase !== publishedPhase.current) {
      publishedPhase.current = nextPhase
      onPhaseChange(nextPhase)
    }

    const latestShots: Partial<Record<Lane, Attack>> = {}
    const activeHolds: Partial<Record<Lane, Attack>> = {}
    for (const attack of attacks) {
      const lane = attack.lane ?? 'mid'
      if (now >= attack.startMs && (!latestShots[lane] || attack.startMs > latestShots[lane]!.startMs)) latestShots[lane] = attack
      if ((attack.durationMs ?? 0) > 0 && now >= attack.impactMs && now <= attack.impactMs + (attack.durationMs ?? 0)) activeHolds[lane] = attack
    }

    for (const lane of lanes) {
      const shotAge = latestShots[lane] ? now - latestShots[lane]!.startMs : Number.POSITIVE_INFINITY
      const recoil = sharpRecoil(shotAge)
      const heavyShot = (latestShots[lane]?.strength ?? 1) >= 2
      const recoilWeight = heavyShot ? 1.42 : 1
      const cannon = cannonRefs.current[lane]
      if (cannon) cannon.position.x = 1.55 + recoil * 0.11 * recoilWeight
      const chamber = cannonChambers.current[lane]
      if (chamber) chamber.emissiveIntensity = 0.65 + recoil * (heavyShot ? 4.6 : 3.1)
      const muzzle = muzzleFlashes.current[lane]
      const muzzleMaterial = muzzleMaterials.current[lane]
      const muzzleVisible = shotAge >= 0 && shotAge < 105
      if (muzzle) {
        muzzle.visible = muzzleVisible
        muzzle.scale.setScalar(0.45 + recoil * (heavyShot ? 2.05 : 1.45))
        muzzle.rotation.x = shotAge / 95
      }
      if (muzzleMaterial) muzzleMaterial.opacity = Math.max(0, recoil * 0.9)

      const event = laneFeedback[lane]
      const feedbackAge = event ? now - event.startedAtMs : Number.POSITIVE_INFINITY
      const successful = event?.kind === 'good-parry' || event?.kind === 'perfect-parry'
      const perfect = event?.kind === 'perfect-parry'
      const heavyImpact = successful && (event?.strength ?? 1) >= 2
      const feedbackDuration = successful ? (heavyImpact ? 520 : perfect ? 390 : 300) : 210
      const feedbackLife = feedbackAge >= 0 && feedbackAge < feedbackDuration ? 1 - feedbackAge / feedbackDuration : 0
      const hitColor = perfect ? perfectColor : successful ? goodColor : missColor
      const inputAge = now - (padTriggers[lane] || -Infinity)
      const inputImpulse = dampedImpulse(inputAge, 190)
      const inputFlash = inputAge >= 0 && inputAge < 130 ? Math.pow(1 - inputAge / 130, 1.7) : 0
      const contactImpulse = successful ? dampedImpulse(feedbackAge, perfect ? 250 : 210, 27) : 0
      const activeHold = activeHolds[lane]
      const grinding = Boolean(activeHold?.holdStarted && heldLanes.has(lane))
      const grindJitter = grinding ? Math.sin(now / 19) * 0.008 : 0
      const pad = padRefs.current[lane]
      if (pad) {
        pad.position.x = -1.02 + inputImpulse * 0.065 + contactImpulse * 0.035 - (grinding ? 0.04 : 0)
        pad.position.y = laneY[lane] + grindJitter
        pad.scale.x = 1 + inputFlash * 0.08 + Math.max(0, contactImpulse) * 0.18 + (grinding ? 0.28 : 0)
        pad.scale.y = 1 - Math.max(0, inputImpulse) * 0.08 - inputFlash * 0.1 + Math.max(0, contactImpulse) * 0.12 - (grinding ? 0.2 : 0)
      }
      const padMaterial = padMaterials.current[lane]
      if (padMaterial) {
        const flash = successful ? Math.pow(feedbackLife, 0.55) : 0
        padMaterial.color.copy(basePadColors[lane]).lerp(hitColor, flash * 0.82).lerp(inputFlashColor, inputFlash * 0.22)
        padMaterial.emissive.copy(basePadEmissives[lane]).lerp(hitColor, flash).lerp(inputFlashColor, inputFlash * 0.32)
        padMaterial.emissiveIntensity = 1.1 + inputFlash * 3 + flash * (perfect ? 3.8 : 2.5) + (grinding ? 1.2 : 0)
      }
      const rimMaterial = padRims.current[lane]
      if (rimMaterial) rimMaterial.emissiveIntensity = 0.42 + feedbackLife * (perfect ? 3.2 : 1.8) + (grinding ? 0.8 : 0)

      const sparks = grindSparks.current[lane]
      if (sparks) {
        sparks.visible = grinding
        sparks.rotation.z = now / 68
        sparks.scale.setScalar(0.78 + Math.sin(now / 29) * 0.13)
      }

      const ring = impactRings.current[lane]
      const ringMaterial = impactRingMaterials.current[lane]
      const burst = impactBursts.current[lane]
      const burstMaterials = impactBurstMaterials.current[lane]
      const impactVisible = feedbackLife > 0
      if (ring) {
        ring.visible = impactVisible
        ring.scale.setScalar((successful ? 0.45 : 0.28) + (1 - feedbackLife) * (heavyImpact ? 3.1 : successful ? 2.4 : 1.1))
        ring.rotation.z = (event?.deltaMs ?? 0) < 0 ? -0.12 : 0.12
      }
      if (ringMaterial) {
        ringMaterial.color.copy(hitColor)
        ringMaterial.opacity = feedbackLife * (successful ? 0.85 : 0.45)
      }
      if (burst) {
        burst.visible = impactVisible
        burst.scale.setScalar((heavyImpact ? 1.38 : perfect ? 1.15 : successful ? 0.88 : 0.52) * (0.48 + (1 - feedbackLife) * 1.15))
        burst.rotation.z = feedbackAge / (successful ? 120 : 180) * ((event?.deltaMs ?? 1) < 0 ? -1 : 1)
      }
      burstMaterials?.forEach((material) => {
        if (!material) return
        material.color.copy(hitColor)
        material.opacity = Math.pow(feedbackLife, 0.7) * (successful ? 0.8 : 0.42)
      })

      const heavyRing = heavyImpactRings.current[lane]
      const heavyRingMaterial = heavyImpactRingMaterials.current[lane]
      const confetti = heavyConfetti.current[lane]
      const confettiMaterials = heavyConfettiMaterials.current[lane]
      if (heavyRing) {
        heavyRing.visible = heavyImpact && feedbackLife > 0
        heavyRing.scale.setScalar(0.35 + (1 - feedbackLife) * 3.8)
        heavyRing.rotation.z = -feedbackAge / 170
      }
      if (heavyRingMaterial) heavyRingMaterial.opacity = heavyImpact ? Math.pow(feedbackLife, 0.82) * 0.72 : 0
      if (confetti) {
        confetti.visible = heavyImpact && feedbackLife > 0
        confetti.scale.setScalar(0.35 + (1 - feedbackLife) * 2.3)
        confetti.rotation.z = -feedbackAge / 210
      }
      confettiMaterials?.forEach((material) => { if (material) material.opacity = heavyImpact ? Math.pow(feedbackLife, 0.55) * 0.9 : 0 })
    }
  })

  return (
    <>
      <color attach="background" args={["#050611"]} />
      <ambientLight intensity={0.72} />
      <directionalLight position={[0, 4, 5]} intensity={2.25} />
      <mesh position={[0, -0.92, 0]}><boxGeometry args={[6.2, 0.04, 1.4]} /><meshStandardMaterial color="#151d35" roughness={0.72} metalness={0.22} /></mesh>
      <mesh position={[0, -0.89, 0.2]}><boxGeometry args={[5.6, 0.012, 0.16]} /><meshBasicMaterial color="#28345a" transparent opacity={0.42} /></mesh>
      <mesh position={[-1.08, 0.1, -0.05]}><boxGeometry args={[0.08, 1.72, 0.08]} /><meshStandardMaterial color="#11192c" metalness={0.55} roughness={0.45} /></mesh>
      <mesh position={[1.56, 0.1, -0.05]}><boxGeometry args={[0.1, 1.72, 0.08]} /><meshStandardMaterial color="#11192c" metalness={0.55} roughness={0.45} /></mesh>

      {lanes.map((lane) => {
        const color = laneColor[lane]
        return (
          <group key={lane}>
            <mesh position={[-1.09, laneY[lane], 0.06]}><boxGeometry args={[0.12, 0.25, 0.1]} /><meshStandardMaterial color="#1b263e" metalness={0.68} roughness={0.38} /></mesh>
            <mesh position={[-1.055, laneY[lane], 0.12]}><boxGeometry args={[0.078, 0.205, 0.075]} /><meshStandardMaterial ref={(material) => { padRims.current[lane] = material }} color="#253753" emissive={color} emissiveIntensity={0.42} metalness={0.52} roughness={0.32} /></mesh>
            <group ref={(group) => { padRefs.current[lane] = group }} position={[-1.02, laneY[lane], 0.17]}>
              <mesh><boxGeometry args={[0.055, 0.145, 0.09]} /><meshStandardMaterial ref={(material) => { padMaterials.current[lane] = material }} color={color} emissive={color} emissiveIntensity={1.1} metalness={0.18} roughness={0.28} /></mesh>
              <mesh position={[0.031, 0, 0.015]}><boxGeometry args={[0.008, 0.09, 0.05]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.48} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
            </group>
            <group ref={(group) => { grindSparks.current[lane] = group }} position={[-0.88, laneY[lane], 0.25]} visible={false}>
              {[0, 1, 2, 3, 4, 5].map((index) => <mesh key={index} rotation={[0, 0, index * Math.PI / 3]} position={[0.105, 0, 0]}><boxGeometry args={[0.13, 0.012, 0.012]} /><meshBasicMaterial color={index % 2 ? '#ff9f43' : '#fff2a8'} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>)}
            </group>
            <group position={[IMPACT_X, laneY[lane], 0.28]}>
              <mesh ref={(mesh) => { impactRings.current[lane] = mesh }} visible={false}><ringGeometry args={[0.11, 0.135, 32]} /><meshBasicMaterial ref={(material) => { impactRingMaterials.current[lane] = material }} color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
              <group ref={(group) => { impactBursts.current[lane] = group }} visible={false}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <mesh key={index} rotation={[0, 0, index * Math.PI / 4]} position={[0.13, 0, 0]}><boxGeometry args={[0.2, 0.012, 0.012]} /><meshBasicMaterial ref={(material) => { const materials = impactBurstMaterials.current[lane] ?? []; materials[index] = material; impactBurstMaterials.current[lane] = materials }} color={color} transparent opacity={0.72} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>)}
              </group>
              <mesh ref={(mesh) => { heavyImpactRings.current[lane] = mesh }} visible={false}><ringGeometry args={[0.16, 0.18, 32]} /><meshBasicMaterial ref={(material) => { heavyImpactRingMaterials.current[lane] = material }} color="#fff2a8" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
              <group ref={(group) => { heavyConfetti.current[lane] = group }} visible={false}>
                {Array.from({ length: 12 }, (_, index) => {
                  const angle = index * Math.PI / 6
                  const shardColor = index % 3 === 0 ? '#ffffff' : index % 2 === 0 ? '#fff2a8' : color
                  return <mesh key={index} rotation={[0, 0, angle + index * 0.17]} position={[Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, index % 2 ? 0.025 : 0]}><boxGeometry args={[0.055 + (index % 3) * 0.012, 0.018, 0.014]} /><meshBasicMaterial ref={(material) => { const materials = heavyConfettiMaterials.current[lane] ?? []; materials[index] = material; heavyConfettiMaterials.current[lane] = materials }} color={shardColor} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
                })}
              </group>
            </group>
            <Text position={[-1.29, laneY[lane] - 0.01, 0.14]} fontSize={0.068} color="#d9e5ff" anchorX="center">{lane.toUpperCase()}</Text>
          </group>
        )
      })}

      {lanes.map((lane) => {
        const color = laneColor[lane]
        return (
          <group key={`cannon-${lane}`}>
            <mesh position={[1.59, laneY[lane], 0.02]}><boxGeometry args={[0.11, 0.23, 0.1]} /><meshStandardMaterial color="#182138" metalness={0.72} roughness={0.38} /></mesh>
            <group ref={(group) => { cannonRefs.current[lane] = group }} position={[1.55, laneY[lane], 0.12]}>
              <mesh position={[0.03, 0, 0]}><boxGeometry args={[0.25, 0.17, 0.13]} /><meshStandardMaterial color="#253451" metalness={0.66} roughness={0.32} /></mesh>
              <mesh position={[-0.135, 0, 0]}><boxGeometry args={[0.18, 0.095, 0.085]} /><meshStandardMaterial color="#3a4c6a" metalness={0.72} roughness={0.26} /></mesh>
              <mesh position={[0.04, 0, 0.075]}><boxGeometry args={[0.11, 0.09, 0.035]} /><meshStandardMaterial ref={(material) => { cannonChambers.current[lane] = material }} color={color} emissive={color} emissiveIntensity={0.65} roughness={0.2} /></mesh>
              <group ref={(group) => { muzzleFlashes.current[lane] = group }} position={[-0.245, 0, 0.02]} visible={false}>
                <mesh rotation={[0, Math.PI / 2, 0]}><ringGeometry args={[0.045, 0.075, 20]} /><meshBasicMaterial ref={(material) => { muzzleMaterials.current[lane] = material }} color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
                <mesh rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.18, 0.018, 0.018]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
              </group>
            </group>
          </group>
        )
      })}

      {attacks.map((attack) => <ProjectileVisual key={attack.id} attack={attack} />)}
    </>
  )
}
