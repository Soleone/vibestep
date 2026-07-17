import { RoundedBox, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { useRef } from 'react'
import { PLAYFIELD_IMPACT_X } from './playfield-grid'
import { clamp01, collectionProgressColor, laneColor, laneY, lanes, type FeedbackEvent, type Lane } from './model'

const CENTER_X = -1.44
const WIDTH = 0.36
const INNER_WIDTH = 0.32
const LEFT_X = CENTER_X - INNER_WIDTH / 2
const RIGHT_X = LEFT_X + INNER_WIDTH
const LANDING_INSET = 0.024
const CAPTURE_MS = 520
const PARTICLE_POOL_SIZE = 6

type CollectionParticle = { eventId: number; startedAtMs: number; perfect: boolean; targetProgress: number; released: boolean }

export function CollectionReservoir({ lane, progress: targetProgress, total, feedback }: { lane: Lane; progress: number; total: number; feedback?: FeedbackEvent }) {
  const moteRefs = useRef<Array<Group | null>>([])
  const particles = useRef<Array<CollectionParticle | null>>(Array(PARTICLE_POOL_SIZE).fill(null))
  const seenEventId = useRef<number | null>(null)
  const fillRef = useRef<Mesh>(null)
  const displayedProgress = useRef(0)
  const fillTarget = useRef(0)
  const splashAt = useRef(-Infinity)
  const color = laneColor[lane]
  const percentageColor = collectionProgressColor(targetProgress, '#f3f7ff')
  const laneIndex = lanes.indexOf(lane)

  useFrame(() => {
    const now = performance.now()
    const successful = feedback?.kind === 'good-parry' || feedback?.kind === 'perfect-parry'
    if (feedback && feedback.id !== seenEventId.current) {
      seenEventId.current = feedback.id
      if (successful) {
        let slot = particles.current.findIndex((particle) => particle === null || now - particle.startedAtMs >= CAPTURE_MS)
        if (slot === -1) slot = particles.current.reduce((oldestIndex, particle, index) => (particle?.startedAtMs ?? Infinity) < (particles.current[oldestIndex]?.startedAtMs ?? Infinity) ? index : oldestIndex, 0)
        particles.current[slot] = { eventId: feedback.id, startedAtMs: feedback.startedAtMs, perfect: feedback.kind === 'perfect-parry', targetProgress: Math.max(displayedProgress.current, targetProgress), released: false }
      }
    }

    let activeParticles = 0
    particles.current.forEach((particle, index) => {
      const mote = moteRefs.current[index]
      if (!particle || !mote) return
      const age = now - particle.startedAtMs
      const captureProgress = clamp01(age / CAPTURE_MS)
      if (age < 0 || age >= CAPTURE_MS) {
        mote.visible = false
        if (age >= CAPTURE_MS) particles.current[index] = null
        return
      }
      activeParticles += 1
      const easedCapture = 1 - Math.pow(1 - captureProgress, 3)
      const landingProgress = Math.max(particle.targetProgress, displayedProgress.current, targetProgress)
      const fluidEdgeX = LEFT_X + INNER_WIDTH * landingProgress / 100
      const moteScale = (particle.perfect ? 1.34 : 1.14) * (1 - captureProgress * 0.78)
      const moteRadius = 0.052 * moteScale
      const landingX = Math.min(
        RIGHT_X - moteRadius - LANDING_INSET,
        Math.max(LEFT_X + moteRadius + LANDING_INSET, fluidEdgeX + moteRadius + LANDING_INSET),
      )
      mote.visible = true
      mote.position.set(PLAYFIELD_IMPACT_X + (landingX - PLAYFIELD_IMPACT_X) * easedCapture, laneY[lane] + Math.sin(captureProgress * Math.PI) * 0.085, 0.31)
      mote.rotation.z = age / 85 + index * 0.35
      mote.scale.setScalar(moteScale)
      const splashProgress = clamp01((captureProgress - 0.7) / 0.3)
      for (let dropletIndex = 0; dropletIndex < 3; dropletIndex += 1) {
        const droplet = mote.children[dropletIndex + 3]
        if (!droplet) continue
        const angle = dropletIndex * Math.PI * 2 / 3 + index * 0.45
        if (splashProgress > 0) droplet.position.set(0, Math.sin(angle) * splashProgress * 0.055, 0.012)
        else droplet.position.set(0.045 + dropletIndex * 0.025, Math.sin(age / 42 + dropletIndex) * 0.018, -0.008)
        droplet.scale.setScalar(0.78 - splashProgress * 0.38)
      }
      if (!particle.released && captureProgress >= 0.7) {
        particle.released = true
        particle.targetProgress = landingProgress
        fillTarget.current = Math.max(fillTarget.current, landingProgress)
        splashAt.current = now
      }
    })

    if (targetProgress < fillTarget.current || targetProgress < displayedProgress.current) fillTarget.current = targetProgress
    else if (activeParticles === 0 && targetProgress > fillTarget.current) fillTarget.current = targetProgress
    const nextProgress = displayedProgress.current + (fillTarget.current - displayedProgress.current) * 0.16
    displayedProgress.current = Math.abs(fillTarget.current - nextProgress) < 0.1 ? fillTarget.current : nextProgress

    if (!fillRef.current) return
    const displayedWidth = INNER_WIDTH * displayedProgress.current / 100
    const splashAge = now - splashAt.current
    const splashEnergy = splashAge >= 0 ? Math.exp(-splashAge / 190) : 0
    fillRef.current.visible = displayedWidth > 0.001
    fillRef.current.position.x = LEFT_X + displayedWidth / 2
    fillRef.current.scale.x = displayedProgress.current / 100
    fillRef.current.scale.y = 0.97 + Math.sin(now / 150 + laneIndex * 0.8) * 0.035 + splashEnergy * 0.13
    const material = fillRef.current.material as MeshStandardMaterial
    material.emissiveIntensity = 1.4 + Math.sin(now / 190 + laneIndex) * 0.2 + splashEnergy * 2.1
  })

  return <group>
    {total > 0 ? <Text position={[-1.67, laneY[lane] - 0.004, 0.15]} fontSize={0.06} fontWeight={800} color={percentageColor} outlineWidth={0.003} outlineColor="#050812" anchorX="right" anchorY="middle">{targetProgress}%</Text> : null}
    <RoundedBox position={[CENTER_X, laneY[lane], 0.07]} args={[WIDTH, 0.17, 0.08]} radius={0.035} smoothness={4}><meshStandardMaterial color="#1a2a43" emissive="#29405f" emissiveIntensity={0.18} roughness={0.24} metalness={0.1} /></RoundedBox>
    <mesh ref={fillRef} position={[LEFT_X, laneY[lane], 0.115]} scale={[0, 1, 1]} visible={false}><boxGeometry args={[INNER_WIDTH, 0.115, 0.018]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.25} transparent opacity={0.94} roughness={0.16} metalness={0.02} toneMapped={false} /></mesh>
    <RoundedBox position={[CENTER_X, laneY[lane], 0.135]} args={[WIDTH, 0.17, 0.018]} radius={0.035} smoothness={4}><meshBasicMaterial color="#d7ebff" transparent opacity={0.1} depthWrite={false} /></RoundedBox>
    <RoundedBox position={[CENTER_X, laneY[lane] + 0.055, 0.158]} args={[0.29, 0.008, 0.006]} radius={0.004} smoothness={3}><meshBasicMaterial color="#ffffff" transparent opacity={0.22} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></RoundedBox>
    {Array.from({ length: PARTICLE_POOL_SIZE }, (_, particleIndex) => <group key={particleIndex} ref={(group) => { moteRefs.current[particleIndex] = group }} visible={false}>
      <mesh><sphereGeometry args={[0.052, 14, 9]} /><meshBasicMaterial color={color} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[0.024, 10, 6]} /><meshBasicMaterial color="#ffffff" blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      <mesh scale={1.75}><sphereGeometry args={[0.052, 12, 8]} /><meshBasicMaterial color={color} transparent opacity={0.18} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      {[0, 1, 2].map((dropletIndex) => <mesh key={dropletIndex}><sphereGeometry args={[0.016 - dropletIndex * 0.002, 8, 6]} /><meshBasicMaterial color={dropletIndex === 1 ? '#ffffff' : color} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>)}
    </group>)}
  </group>
}
