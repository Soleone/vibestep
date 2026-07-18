import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color } from 'three'
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { useRef } from 'react'
import { playfieldFontUrl } from './playfield-font'
import { PLAYFIELD_IMPACT_X } from './playfield-grid'
import { judgementColors, laneColor, laneY, lanes, type Attack, type FeedbackEvent, type Lane } from './model'

const perfectColor = new Color(judgementColors.perfect)
const goodColor = new Color(judgementColors.good)
const missColor = new Color(judgementColors.miss)
const inputFlashColor = new Color('#ffffff')
const basePadColors = Object.fromEntries(lanes.map((lane) => [lane, new Color(laneColor[lane])])) as Record<Lane, Color>
const basePadEmissives = Object.fromEntries(lanes.map((lane) => [lane, new Color(laneColor[lane]).multiplyScalar(0.3)])) as Record<Lane, Color>

function dampedImpulse(ageMs: number, durationMs: number, frequency = 34) {
  if (ageMs < 0 || ageMs >= durationMs) return 0
  return Math.exp(-ageMs / (durationMs * 0.34)) * Math.cos(ageMs / frequency)
}

function sharpRecoil(ageMs: number) {
  if (ageMs < 0 || ageMs >= 190) return 0
  return Math.exp(-ageMs / 58) * (0.86 + Math.cos(ageMs / 24) * 0.14)
}

export function LaneStation({ lane, attacks, feedback, padTrigger, held }: { lane: Lane; attacks: Attack[]; feedback?: FeedbackEvent; padTrigger: number; held: boolean }) {
  const cannon = useRef<Group>(null)
  const chamber = useRef<MeshStandardMaterial>(null)
  const muzzle = useRef<Group>(null)
  const muzzleMaterial = useRef<MeshBasicMaterial>(null)
  const pad = useRef<Group>(null)
  const padMaterial = useRef<MeshStandardMaterial>(null)
  const padRim = useRef<MeshStandardMaterial>(null)
  const grindSparks = useRef<Group>(null)
  const impactRing = useRef<Mesh>(null)
  const impactRingMaterial = useRef<MeshBasicMaterial>(null)
  const impactBurst = useRef<Group>(null)
  const impactBurstMaterials = useRef<Array<MeshBasicMaterial | null>>([])
  const heavyImpactRing = useRef<Mesh>(null)
  const heavyImpactRingMaterial = useRef<MeshBasicMaterial>(null)
  const heavyConfetti = useRef<Group>(null)
  const heavyConfettiMaterials = useRef<Array<MeshBasicMaterial | null>>([])
  const color = laneColor[lane]

  useFrame(() => {
    const now = performance.now()
    let latestShot: Attack | undefined
    let activeHold: Attack | undefined
    for (const attack of attacks) {
      if (now >= attack.startMs && (!latestShot || attack.startMs > latestShot.startMs)) latestShot = attack
      if ((attack.durationMs ?? 0) > 0 && now >= attack.impactMs && now <= attack.impactMs + (attack.durationMs ?? 0)) activeHold = attack
    }

    const shotAge = latestShot ? now - latestShot.startMs : Infinity
    const recoil = sharpRecoil(shotAge)
    const heavyShot = (latestShot?.strength ?? 1) >= 2
    if (cannon.current) cannon.current.position.x = 1.55 + recoil * 0.11 * (heavyShot ? 1.42 : 1)
    if (chamber.current) chamber.current.emissiveIntensity = 0.65 + recoil * (heavyShot ? 4.6 : 3.1)
    const muzzleVisible = shotAge >= 0 && shotAge < 105
    if (muzzle.current) {
      muzzle.current.visible = muzzleVisible
      muzzle.current.scale.setScalar(0.45 + recoil * (heavyShot ? 2.05 : 1.45))
      muzzle.current.rotation.x = shotAge / 95
    }
    if (muzzleMaterial.current) muzzleMaterial.current.opacity = Math.max(0, recoil * 0.9)

    const feedbackAge = feedback ? now - feedback.startedAtMs : Infinity
    const successful = feedback?.kind === 'good-parry' || feedback?.kind === 'perfect-parry'
    const perfect = feedback?.kind === 'perfect-parry'
    const heavyImpact = successful && (feedback?.strength ?? 1) >= 2
    const feedbackDuration = successful ? (heavyImpact ? 520 : perfect ? 390 : 300) : 210
    const feedbackLife = feedbackAge >= 0 && feedbackAge < feedbackDuration ? 1 - feedbackAge / feedbackDuration : 0
    const hitColor = perfect ? perfectColor : successful ? goodColor : missColor
    const inputAge = now - (padTrigger || -Infinity)
    const inputImpulse = dampedImpulse(inputAge, 190)
    const inputFlash = inputAge >= 0 && inputAge < 130 ? Math.pow(1 - inputAge / 130, 1.7) : 0
    const contactImpulse = successful ? dampedImpulse(feedbackAge, perfect ? 250 : 210, 27) : 0
    const grinding = Boolean(activeHold?.holdStarted && held)
    const grindJitter = grinding ? Math.sin(now / 19) * 0.008 : 0

    if (pad.current) {
      pad.current.position.x = -1.02 + inputImpulse * 0.065 + contactImpulse * 0.035 - (grinding ? 0.04 : 0)
      pad.current.position.y = laneY[lane] + grindJitter
      pad.current.scale.x = 1 + inputFlash * 0.08 + Math.max(0, contactImpulse) * 0.18 + (grinding ? 0.28 : 0)
      pad.current.scale.y = 1 - Math.max(0, inputImpulse) * 0.08 - inputFlash * 0.1 + Math.max(0, contactImpulse) * 0.12 - (grinding ? 0.2 : 0)
    }
    if (padMaterial.current) {
      const flash = successful ? Math.pow(feedbackLife, 0.55) : 0
      padMaterial.current.color.copy(basePadColors[lane]).lerp(hitColor, flash * 0.82).lerp(inputFlashColor, inputFlash * 0.22)
      padMaterial.current.emissive.copy(basePadEmissives[lane]).lerp(hitColor, flash).lerp(inputFlashColor, inputFlash * 0.32)
      padMaterial.current.emissiveIntensity = 1.1 + inputFlash * 3 + flash * (perfect ? 3.8 : 2.5) + (grinding ? 1.2 : 0)
    }
    if (padRim.current) padRim.current.emissiveIntensity = 0.42 + feedbackLife * (perfect ? 3.2 : 1.8) + (grinding ? 0.8 : 0)
    if (grindSparks.current) {
      grindSparks.current.visible = grinding
      grindSparks.current.rotation.z = now / 68
      grindSparks.current.scale.setScalar(0.78 + Math.sin(now / 29) * 0.13)
    }

    const impactVisible = feedbackLife > 0
    if (impactRing.current) {
      impactRing.current.visible = impactVisible
      impactRing.current.scale.setScalar((successful ? 0.45 : 0.28) + (1 - feedbackLife) * (heavyImpact ? 3.1 : successful ? 2.4 : 1.1))
      impactRing.current.rotation.z = (feedback?.deltaMs ?? 0) < 0 ? -0.12 : 0.12
    }
    if (impactRingMaterial.current) {
      impactRingMaterial.current.color.copy(hitColor)
      impactRingMaterial.current.opacity = feedbackLife * (successful ? 0.85 : 0.45)
    }
    if (impactBurst.current) {
      impactBurst.current.visible = impactVisible
      impactBurst.current.scale.setScalar((heavyImpact ? 1.38 : perfect ? 1.15 : successful ? 0.88 : 0.52) * (0.48 + (1 - feedbackLife) * 1.15))
      impactBurst.current.rotation.z = feedbackAge / (successful ? 120 : 180) * ((feedback?.deltaMs ?? 1) < 0 ? -1 : 1)
    }
    impactBurstMaterials.current.forEach((material) => {
      if (!material) return
      material.color.copy(hitColor)
      material.opacity = Math.pow(feedbackLife, 0.7) * (successful ? 0.8 : 0.42)
    })
    if (heavyImpactRing.current) {
      heavyImpactRing.current.visible = heavyImpact && feedbackLife > 0
      heavyImpactRing.current.scale.setScalar(0.35 + (1 - feedbackLife) * 3.8)
      heavyImpactRing.current.rotation.z = -feedbackAge / 170
    }
    if (heavyImpactRingMaterial.current) heavyImpactRingMaterial.current.opacity = heavyImpact ? Math.pow(feedbackLife, 0.82) * 0.72 : 0
    if (heavyConfetti.current) {
      heavyConfetti.current.visible = heavyImpact && feedbackLife > 0
      heavyConfetti.current.scale.setScalar(0.35 + (1 - feedbackLife) * 2.3)
      heavyConfetti.current.rotation.z = -feedbackAge / 210
    }
    heavyConfettiMaterials.current.forEach((material) => { if (material) material.opacity = heavyImpact ? Math.pow(feedbackLife, 0.55) * 0.9 : 0 })
  })

  return <group>
    <mesh position={[-1.055, laneY[lane], 0.12]}><boxGeometry args={[0.078, 0.205, 0.075]} /><meshStandardMaterial ref={padRim} color="#253753" emissive={color} emissiveIntensity={0.42} metalness={0.52} roughness={0.32} /></mesh>
    <group ref={pad} position={[-1.02, laneY[lane], 0.17]}>
      <mesh><boxGeometry args={[0.055, 0.145, 0.09]} /><meshStandardMaterial ref={padMaterial} color={color} emissive={color} emissiveIntensity={1.1} metalness={0.18} roughness={0.28} /></mesh>
      <mesh position={[0.031, 0, 0.015]}><boxGeometry args={[0.008, 0.09, 0.05]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.48} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    </group>
    <group ref={grindSparks} position={[-0.88, laneY[lane], 0.25]} visible={false}>{[0, 1, 2, 3, 4, 5].map((index) => <mesh key={index} rotation={[0, 0, index * Math.PI / 3]} position={[0.105, 0, 0]}><boxGeometry args={[0.13, 0.012, 0.012]} /><meshBasicMaterial color={index % 2 ? '#ff9f43' : '#fff2a8'} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>)}</group>
    <group position={[PLAYFIELD_IMPACT_X, laneY[lane], 0.28]}>
      <mesh ref={impactRing} visible={false}><ringGeometry args={[0.11, 0.135, 32]} /><meshBasicMaterial ref={impactRingMaterial} color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      <group ref={impactBurst} visible={false}>{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <mesh key={index} rotation={[0, 0, index * Math.PI / 4]} position={[0.13, 0, 0]}><boxGeometry args={[0.2, 0.012, 0.012]} /><meshBasicMaterial ref={(material) => { impactBurstMaterials.current[index] = material }} color={color} transparent opacity={0.72} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>)}</group>
      <mesh ref={heavyImpactRing} visible={false}><ringGeometry args={[0.16, 0.18, 32]} /><meshBasicMaterial ref={heavyImpactRingMaterial} color="#fff2a8" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      <group ref={heavyConfetti} visible={false}>{Array.from({ length: 12 }, (_, index) => {
        const angle = index * Math.PI / 6
        const shardColor = index % 3 === 0 ? '#ffffff' : index % 2 === 0 ? '#fff2a8' : color
        return <mesh key={index} rotation={[0, 0, angle + index * 0.17]} position={[Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, index % 2 ? 0.025 : 0]}><boxGeometry args={[0.055 + (index % 3) * 0.012, 0.018, 0.014]} /><meshBasicMaterial ref={(material) => { heavyConfettiMaterials.current[index] = material }} color={shardColor} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      })}</group>
    </group>
    <group ref={cannon} position={[1.55, laneY[lane], 0.12]}>
      <mesh position={[0.03, 0, 0]}><boxGeometry args={[0.24, 0.15, 0.1]} /><meshBasicMaterial color="#1d2e4b" /></mesh>
      <mesh position={[-0.145, 0, 0]}><boxGeometry args={[0.18, 0.072, 0.065]} /><meshBasicMaterial color="#2b4367" /></mesh>
      <mesh position={[0.04, 0, 0.055]}><boxGeometry args={[0.105, 0.082, 0.025]} /><meshStandardMaterial ref={chamber} color={color} emissive={color} emissiveIntensity={0.8} roughness={0.28} metalness={0.1} /></mesh>
      <group ref={muzzle} position={[-0.245, 0, 0.02]} visible={false}>
        <mesh rotation={[0, Math.PI / 2, 0]}><ringGeometry args={[0.045, 0.075, 20]} /><meshBasicMaterial ref={muzzleMaterial} color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
        <mesh rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.18, 0.018, 0.018]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
      </group>
    </group>
    <Text position={[1.88, laneY[lane] - 0.004, 0.14]} font={playfieldFontUrl} fontSize={0.064} color="#d9e5ff" anchorX="left" anchorY="middle">{lane.toUpperCase()}</Text>
  </group>
}
