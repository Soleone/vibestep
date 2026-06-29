import { Canvas, useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Color } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { attackPhase, judgeParryTiming, type ParryTimingResult } from './game/timing'

type Tuning = {
  parryWindowMs: number
  perfectWindowMs: number
  telegraphMs: number
  recoveryMs: number
  inputOffsetMs: number
}

type Attack = {
  id: number
  startMs: number
  impactMs: number
  travelMs: number
}

type FeedbackEvent = {
  id: number
  kind: 'good-parry' | 'perfect-parry' | 'miss'
  startedAtMs: number
}

const initialTuning: Tuning = {
  parryWindowMs: 120,
  perfectWindowMs: 40,
  telegraphMs: 1150,
  recoveryMs: 260,
  inputOffsetMs: 0,
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const easeOut = (value: number) => 1 - Math.pow(1 - value, 3)

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

  if (kind === 'perfect-parry') {
    const shimmer = audio.createOscillator()
    const shimmerGain = audio.createGain()
    shimmer.type = 'sine'
    shimmer.frequency.setValueAtTime(2400, now + 0.02)
    shimmer.frequency.exponentialRampToValueAtTime(3600, now + 0.16)
    shimmerGain.gain.setValueAtTime(0.35, now + 0.02)
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)
    shimmer.connect(shimmerGain).connect(master)
    shimmer.start(now + 0.02)
    shimmer.stop(now + 0.22)
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

function makeAttack(tuning: Tuning, delayMs = 500): Attack {
  const startMs = performance.now() + delayMs
  const variability = 0.72
  const minTravelMs = Math.max(260, tuning.telegraphMs * (1 - variability))
  const maxTravelMs = tuning.telegraphMs * (1 + variability)
  const travelMs = minTravelMs + Math.random() * (maxTravelMs - minTravelMs)

  return {
    id: Math.random(),
    startMs,
    travelMs,
    impactMs: startMs + travelMs,
  }
}

function Arena({ attack, tuning, lastResult, parryPulse, feedback }: { attack: Attack; tuning: Tuning; lastResult: ParryTimingResult | null; parryPulse: number; feedback: FeedbackEvent | null }) {
  const attacker = useRef<Mesh>(null)
  const player = useRef<Mesh>(null)
  const projectile = useRef<Mesh>(null)
  const trailGhosts = useRef<Array<Mesh | null>>([])
  const impactFlash = useRef<Mesh>(null)
  const parryShield = useRef<Mesh>(null)
  const shieldBoard = useRef<Mesh>(null)
  const shieldBoardMaterial = useRef<MeshStandardMaterial>(null)
  const burst = useRef<Group>(null)
  const [phase, setPhase] = useState('charging')

  useFrame(() => {
    const now = performance.now()
    const currentPhase = attackPhase(now, attack.startMs, attack.impactMs, tuning.recoveryMs)
    setPhase(currentPhase === 'windup' ? 'incoming' : currentPhase)

    const travel = clamp01((now - attack.startMs) / attack.travelMs)
    const impactAge = now - attack.impactMs
    const parryAge = now - parryPulse
    const feedbackAge = feedback ? now - feedback.startedAtMs : Number.POSITIVE_INFINITY
    const isSuccessfulParry = feedback?.kind === 'good-parry' || feedback?.kind === 'perfect-parry'
    const startX = 1.6
    const shieldRightEdgeX = -0.96
    const projectileRadius = 0.09
    // Zero point is first visible contact: projectile leading edge touches shield face.
    // Since the projectile travels left, its leading edge is centerX - radius.
    const impactX = shieldRightEdgeX + projectileRadius
    const x = startX + (impactX - startX) * travel
    const y = 0.16 + Math.sin(travel * Math.PI) * 0.12

    if (attacker.current) {
      const charge = now < attack.startMs ? clamp01(1 - (attack.startMs - now) / 500) : 1
      attacker.current.scale.setScalar(1 + Math.sin(charge * Math.PI) * 0.12)
    }

    if (projectile.current) {
      if (feedback?.kind === 'perfect-parry' && feedbackAge < 420) {
        const reflect = easeOut(clamp01(feedbackAge / 420))
        projectile.current.position.x = -0.78 + reflect * 1.85
        projectile.current.position.y = 0.16 + Math.sin(reflect * Math.PI) * 0.22
        projectile.current.scale.setScalar(1)
        projectile.current.visible = true
      } else {
        projectile.current.position.x = x
        projectile.current.position.y = y
        projectile.current.scale.setScalar(1)
        projectile.current.visible = now >= attack.startMs && impactAge < 120 && !(isSuccessfulParry && feedbackAge < 420)
      }
      projectile.current.rotation.z = 0
    }

    trailGhosts.current.forEach((ghost, index) => {
      if (!ghost) return
      const lagMs = 55 * (index + 1)
      const ghostTravel = clamp01((now - lagMs - attack.startMs) / attack.travelMs)
      const ghostX = startX + (impactX - startX) * ghostTravel
      const ghostY = 0.16 + Math.sin(ghostTravel * Math.PI) * 0.12
      ghost.position.x = ghostX
      ghost.position.y = ghostY
      ghost.visible = now >= attack.startMs + lagMs && impactAge < 40 && !isSuccessfulParry
    })

    if (impactFlash.current) {
      const visible = impactAge >= 0 && impactAge < 130
      const flash = visible ? 1 - impactAge / 130 : 0
      impactFlash.current.scale.setScalar(0.45 + flash * 1.8)
      impactFlash.current.visible = visible
    }

    if (parryShield.current) {
      const duration = feedback?.kind === 'perfect-parry' ? 360 : 210
      const visible = parryAge >= 0 && parryAge < duration
      const pulse = visible ? 1 - parryAge / duration : 0
      parryShield.current.visible = visible
      parryShield.current.scale.setScalar(0.82 + pulse * (feedback?.kind === 'perfect-parry' ? 0.72 : 0.42))
    }

    const shieldFlashDurationMs = 200
    const shieldFlash = feedbackAge < shieldFlashDurationMs && isSuccessfulParry
      ? Math.pow(Math.max(0, Math.sin((feedbackAge / shieldFlashDurationMs) * Math.PI * 4)), 0.35) * (1 - feedbackAge / shieldFlashDurationMs * 0.35)
      : 0

    if (shieldBoard.current) {
      shieldBoard.current.scale.y = 1 + shieldFlash * 0.2
      shieldBoard.current.scale.x = 1 + shieldFlash * 0.08
    }

    if (shieldBoardMaterial.current) {
      const baseColor = new Color('#d9ecff')
      const flashColor = new Color(feedback?.kind === 'perfect-parry' ? '#fff4a3' : '#ffd166')
      const baseEmissive = new Color('#16324c')
      const flashEmissive = new Color(feedback?.kind === 'perfect-parry' ? '#ffdd00' : '#ff9500')
      shieldBoardMaterial.current.color.copy(baseColor.lerp(flashColor, shieldFlash))
      shieldBoardMaterial.current.emissive.copy(baseEmissive.lerp(flashEmissive, shieldFlash))
    }

    if (burst.current) {
      const visible = feedbackAge >= 0 && feedbackAge < 360 && isSuccessfulParry
      const pulse = visible ? 1 - feedbackAge / 360 : 0
      burst.current.visible = visible
      burst.current.scale.setScalar((feedback?.kind === 'perfect-parry' ? 1.0 : 0.72) * (0.18 + (1 - pulse) * 1.25))
      burst.current.rotation.z = feedbackAge / 150
    }

    if (player.current) {
      const recoil = impactAge >= 0 && impactAge < 120 ? (1 - impactAge / 120) * 0.08 : 0
      const shake = feedbackAge < 140 ? Math.sin(feedbackAge * 0.8) * (feedback?.kind === 'perfect-parry' ? 0.032 : 0.016) * (1 - feedbackAge / 140) : 0
      player.current.position.x = -1.35 - recoil + shake
    }
  })

  const resultColor = lastResult?.success ? (lastResult.grade === 'perfect' ? '#7df9ff' : '#83ff70') : '#ff5570'

  return (
    <>
      <color attach="background" args={["#070812"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[0, 4, 5]} intensity={2.5} />

      <mesh position={[0, -1.05, 0]}>
        <boxGeometry args={[6.2, 0.08, 1.4]} />
        <meshStandardMaterial color="#1d2540" />
      </mesh>

      <mesh ref={player} position={[-1.35, 0, 0]}>
        <capsuleGeometry args={[0.28, 0.9, 8, 18]} />
        <meshStandardMaterial color="#4da3ff" emissive="#061f40" />
      </mesh>
      <mesh ref={shieldBoard} position={[-1.02, 0.04, 0.11]}>
        <boxGeometry args={[0.12, 1.05, 0.12]} />
        <meshStandardMaterial ref={shieldBoardMaterial} color="#d9ecff" emissive="#16324c" />
      </mesh>
      <mesh ref={parryShield} position={[-0.98, 0.05, 0.16]} visible={false}>
        <torusGeometry args={[0.5, 0.035, 12, 48]} />
        <meshStandardMaterial color="#7df9ff" emissive="#2de8ff" transparent opacity={0.9} />
      </mesh>

      <mesh ref={attacker} position={[1.85, 0, 0]}>
        <capsuleGeometry args={[0.3, 0.95, 8, 18]} />
        <meshStandardMaterial color="#ff4d67" emissive="#3b0810" />
      </mesh>
      <mesh position={[1.47, 0.16, 0.02]}>
        <boxGeometry args={[0.42, 0.12, 0.08]} />
        <meshStandardMaterial color="#ff4d67" emissive="#3b0810" />
      </mesh>

      {/* The projectile is the attack, not a helper UI: its contact with the shield is the impact. */}
      {[0.28, 0.18, 0.1, 0.05].map((opacity, index) => (
        <mesh
          key={opacity}
          ref={(mesh) => { trailGhosts.current[index] = mesh }}
          position={[1.6, 0.16, 0.06]}
          visible={false}
        >
          <sphereGeometry args={[0.09 - index * 0.012, 24, 12]} />
          <meshStandardMaterial color="#d8f3ff" emissive="#3aa8ff" transparent opacity={opacity} />
        </mesh>
      ))}
      <mesh ref={projectile} position={[1.6, 0.16, 0.12]} visible={false}>
        <sphereGeometry args={[0.09, 32, 16]} />
        <meshStandardMaterial color="#ffd166" emissive="#704900" />
      </mesh>

      <mesh ref={impactFlash} position={[-0.98, 0.06, 0.18]} visible={false}>
        <ringGeometry args={[0.24, 0.29, 48]} />
        <meshStandardMaterial color="#fff1b8" emissive="#ffd166" transparent opacity={0.95} />
      </mesh>

      <group ref={burst} position={[-0.98, 0.06, 0.22]} visible={false}>
        <mesh>
          <ringGeometry args={[0.18, 0.22, 64]} />
          <meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? '#ffffff' : '#7df9ff'} emissive={feedback?.kind === 'perfect-parry' ? '#7df9ff' : '#2de8ff'} transparent opacity={0.62} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.48, 0.028, 0.035]} />
          <meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? '#ffffff' : '#83ff70'} emissive="#7df9ff" transparent opacity={0.55} />
        </mesh>
        <mesh rotation={[0, 0, -Math.PI / 4]}>
          <boxGeometry args={[0.48, 0.028, 0.035]} />
          <meshStandardMaterial color={feedback?.kind === 'perfect-parry' ? '#ffffff' : '#83ff70'} emissive="#7df9ff" transparent opacity={0.55} />
        </mesh>
      </group>

      <Text position={[0, 1.45, 0]} fontSize={0.16} color="#cdd8ea" anchorX="center">
        {phase.toUpperCase()}
      </Text>
      {lastResult && (
        <Text position={[0, 1.12, 0]} fontSize={0.23} color={resultColor} anchorX="center">
          {lastResult.grade.toUpperCase()} {lastResult.deltaMs.toFixed(1)}ms
        </Text>
      )}
    </>
  )
}

function App() {
  const [tuning, setTuning] = useState<Tuning>(initialTuning)
  const [attack, setAttack] = useState(() => makeAttack(initialTuning))
  const [lastResult, setLastResult] = useState<ParryTimingResult | null>(null)
  const [parryPulse, setParryPulse] = useState(0)
  const [feedback, setFeedback] = useState<FeedbackEvent | null>(null)

  const nextAttack = useCallback(() => {
    setLastResult(null)
    setFeedback(null)
    setAttack(makeAttack(tuning))
  }, [tuning])

  const parry = useCallback(() => {
    const inputTimeMs = performance.now()
    const result = judgeParryTiming({ inputTimeMs, impactTimeMs: attack.impactMs, ...tuning })
    setLastResult(result)
    setParryPulse(inputTimeMs)
    const kind: FeedbackEvent['kind'] = result.success ? (result.grade === 'perfect' ? 'perfect-parry' : 'good-parry') : 'miss'
    setFeedback({ id: Math.random(), kind, startedAtMs: inputTimeMs })
    playParrySound(kind)
  }, [attack.impactMs, tuning])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault()
        parry()
      }
      if (event.code === 'KeyR') nextAttack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nextAttack, parry])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (performance.now() > attack.impactMs + tuning.recoveryMs + 700) nextAttack()
    }, 100)
    return () => window.clearInterval(timer)
  }, [attack.impactMs, nextAttack, tuning.recoveryMs])

  const rows = useMemo(() => [
    ['Parry total', tuning.parryWindowMs, 20, 260, 'ms', 'parryWindowMs'],
    ['Perfect total', tuning.perfectWindowMs, 10, 120, 'ms', 'perfectWindowMs'],
    ['Avg travel', tuning.telegraphMs, 450, 2000, 'ms', 'telegraphMs'],
    ['Input offset', tuning.inputOffsetMs, -80, 80, 'ms', 'inputOffsetMs'],
  ] as const, [tuning])

  return (
    <main>
      <section className="stage">
        <Canvas camera={{ position: [0, 0.25, 5.2], fov: 48 }}>
          <Arena attack={attack} tuning={tuning} lastResult={lastResult} parryPulse={parryPulse} feedback={feedback} />
        </Canvas>
      </section>
      <aside className="panel">
        <h1>Flow Fight: Parry Lab</h1>
        <p>Projectile-first read. Press <kbd>Space</kbd> when the incoming threat physically reaches the shield. Each shot now randomizes travel speed heavily around the average.</p>
        <button onClick={parry}>Parry now</button>
        <button onClick={nextAttack}>New attack</button>
        {rows.map(([label, value, min, max, unit, key]) => (
          <label key={key}>
            <span>{label}: <strong>{value}{unit}</strong></span>
            <input type="range" min={min} max={max} value={value} onChange={(e) => setTuning((t) => ({ ...t, [key]: Number(e.target.value) }))} />
          </label>
        ))}
        <div className="debug">
          <h2>Timing debug</h2>
          <code>zero point: leading edge touches shield</code>
          <code>impactTime: {attack.impactMs.toFixed(2)}ms</code>
          <code>this travel: {attack.travelMs.toFixed(0)}ms</code>
          <code>parry: ±{(tuning.parryWindowMs / 2).toFixed(1)}ms ({tuning.parryWindowMs}ms total)</code>
          <code>perfect: ±{(tuning.perfectWindowMs / 2).toFixed(1)}ms ({tuning.perfectWindowMs}ms total)</code>
          <code>delta: {lastResult ? `${lastResult.deltaMs.toFixed(2)}ms` : '—'}</code>
          <code>result: {lastResult ? `${lastResult.grade} / ${lastResult.success ? 'success' : 'miss'}` : '—'}</code>
        </div>
      </aside>
    </main>
  )
}

export default App
