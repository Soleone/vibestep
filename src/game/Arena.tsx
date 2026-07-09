import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Color } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { useRef } from 'react'
import { attackPhase } from './timing'
import { clamp01, judgementColors, laneColor, laneY, type Attack, type FeedbackEvent, type Lane, type Tuning } from './model'

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

export function Arena({ attacks, tuning, parryPulse, feedback, padTriggers, onPhaseChange }: { attacks: Attack[]; tuning: Tuning; parryPulse: number; feedback: FeedbackEvent | null; padTriggers: Record<Lane, number>; onPhaseChange: (phase: string) => void }) {
  const impactFlash = useRef<Mesh>(null)
  const cannonRefs = useRef<Partial<Record<Lane, Group | null>>>({})
  const parryShield = useRef<Mesh>(null)
  const padRefs = useRef<Partial<Record<Lane, Mesh | null>>>({})
  const padMaterials = useRef<Partial<Record<Lane, MeshStandardMaterial | null>>>({})
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
      const typedLane = lane as Lane
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
      const typedLane = lane as Lane
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
        const flashColor = new Color(feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good)
        const baseEmissive = new Color(color).multiplyScalar(0.35)
        const flashEmissive = new Color(feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good)
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
        const typedLane = lane as Lane
        return (
          <group key={lane}>
            <mesh ref={(mesh) => { padRefs.current[typedLane] = mesh }} position={[-1.02, laneY[typedLane], 0.11]}>
              <boxGeometry args={[0.065, 0.18, 0.12]} />
              <meshStandardMaterial ref={(material) => { padMaterials.current[typedLane] = material }} color={color} emissive={color} />
            </mesh>
            <Text position={[-1.23, laneY[typedLane] - 0.01, 0.12]} fontSize={0.07} color="#edf3ff" anchorX="center">{typedLane.toUpperCase()}</Text>
          </group>
        )
      })}
      <mesh ref={parryShield} position={[-0.98, laneY[feedback?.lane ?? 'mid'], 0.16]} visible={false}><torusGeometry args={[0.18, 0.018, 12, 48]} /><meshStandardMaterial color={judgementColors.perfect} emissive={judgementColors.perfect} transparent opacity={0.9} /></mesh>
      {Object.entries(laneColor).map(([lane, color]) => {
        const typedLane = lane as Lane
        return (
          <group key={`cannon-${lane}`} ref={(group) => { cannonRefs.current[typedLane] = group }} position={[1.55, laneY[typedLane], 0.08]}>
            <mesh><boxGeometry args={[0.23, 0.16, 0.11]} /><meshStandardMaterial color={color} emissive={color} /></mesh>
          </group>
        )
      })}
      {attacks.map((attack) => <ProjectileVisual key={attack.id} attack={attack} hidden={false} />)}
      <mesh ref={impactFlash} position={[-0.98, 0.06, 0.18]} visible={false}><ringGeometry args={[0.12, 0.15, 48]} /><meshStandardMaterial color={judgementColors.good} emissive={judgementColors.good} transparent opacity={0.95} /></mesh>
      <group ref={burst} position={[-0.98, laneY[feedback?.lane ?? 'mid'], 0.22]} visible={false}>
        <mesh><ringGeometry args={[0.18, 0.22, 64]} /><meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good} emissive={feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good} transparent opacity={0.62} /></mesh>
        <mesh rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.48, 0.028, 0.035]} /><meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good} emissive={feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good} transparent opacity={0.55} /></mesh>
        <mesh rotation={[0, 0, -Math.PI / 4]}><boxGeometry args={[0.48, 0.028, 0.035]} /><meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good} emissive={feedback?.kind === 'perfect-parry' ? judgementColors.perfect : judgementColors.good} transparent opacity={0.55} /></mesh>
      </group>
    </>
  )
}
