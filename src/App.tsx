import { Canvas, useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type { Mesh } from 'three'
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

function makeAttack(tuning: Tuning, delayMs = 500): Attack {
  const startMs = performance.now() + delayMs
  return {
    id: Math.random(),
    startMs,
    impactMs: startMs + tuning.telegraphMs,
  }
}

function Arena({ attack, tuning, lastResult, parryPulse }: { attack: Attack; tuning: Tuning; lastResult: ParryTimingResult | null; parryPulse: number }) {
  const attacker = useRef<Mesh>(null)
  const player = useRef<Mesh>(null)
  const projectile = useRef<Mesh>(null)
  const trail = useRef<Mesh>(null)
  const impactFlash = useRef<Mesh>(null)
  const parryShield = useRef<Mesh>(null)
  const [phase, setPhase] = useState('charging')

  useFrame(() => {
    const now = performance.now()
    const currentPhase = attackPhase(now, attack.startMs, attack.impactMs, tuning.recoveryMs)
    setPhase(currentPhase === 'windup' ? 'incoming' : currentPhase)

    const travel = clamp01((now - attack.startMs) / (attack.impactMs - attack.startMs))
    const impactAge = now - attack.impactMs
    const parryAge = now - parryPulse
    const startX = 1.6
    const shieldRightEdgeX = -0.96
    const projectileRadius = 0.18
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
      projectile.current.position.x = x
      projectile.current.position.y = y
      projectile.current.rotation.z = 0
      projectile.current.scale.setScalar(0.7 + easeOut(travel) * 0.45)
      projectile.current.visible = now >= attack.startMs && impactAge < 120
    }

    if (trail.current) {
      const length = 0.25 + travel * 0.85
      trail.current.position.x = x + length * 0.52
      trail.current.position.y = y
      trail.current.scale.x = length
      trail.current.visible = now >= attack.startMs && impactAge < 80
    }

    if (impactFlash.current) {
      const visible = impactAge >= 0 && impactAge < 130
      const flash = visible ? 1 - impactAge / 130 : 0
      impactFlash.current.scale.setScalar(0.45 + flash * 1.8)
      impactFlash.current.visible = visible
    }

    if (parryShield.current) {
      const visible = parryAge >= 0 && parryAge < 180
      const pulse = visible ? 1 - parryAge / 180 : 0
      parryShield.current.visible = visible
      parryShield.current.scale.setScalar(0.9 + pulse * 0.65)
    }

    if (player.current) {
      const recoil = impactAge >= 0 && impactAge < 120 ? (1 - impactAge / 120) * 0.08 : 0
      player.current.position.x = -1.35 - recoil
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
      <mesh position={[-1.02, 0.04, 0.11]}>
        <boxGeometry args={[0.12, 1.05, 0.12]} />
        <meshStandardMaterial color="#d9ecff" emissive="#16324c" />
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
      <mesh ref={trail} position={[1.6, 0.16, 0.06]} visible={false}>
        <boxGeometry args={[1, 0.09, 0.05]} />
        <meshStandardMaterial color="#ff8a4d" emissive="#7a2100" transparent opacity={0.45} />
      </mesh>
      <mesh ref={projectile} position={[1.6, 0.16, 0.12]} visible={false}>
        <sphereGeometry args={[0.18, 32, 16]} />
        <meshStandardMaterial color="#ffd166" emissive="#704900" />
      </mesh>

      <mesh ref={impactFlash} position={[-0.98, 0.06, 0.18]} visible={false}>
        <ringGeometry args={[0.24, 0.29, 48]} />
        <meshStandardMaterial color="#fff1b8" emissive="#ffd166" transparent opacity={0.95} />
      </mesh>

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

  const nextAttack = useCallback(() => {
    setLastResult(null)
    setAttack(makeAttack(tuning))
  }, [tuning])

  const parry = useCallback(() => {
    const inputTimeMs = performance.now()
    const result = judgeParryTiming({ inputTimeMs, impactTimeMs: attack.impactMs, ...tuning })
    setLastResult(result)
    setParryPulse(inputTimeMs)
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
    ['Parry window', tuning.parryWindowMs, 20, 260, 'ms', 'parryWindowMs'],
    ['Perfect window', tuning.perfectWindowMs, 10, 120, 'ms', 'perfectWindowMs'],
    ['Travel time', tuning.telegraphMs, 450, 2000, 'ms', 'telegraphMs'],
    ['Input offset', tuning.inputOffsetMs, -80, 80, 'ms', 'inputOffsetMs'],
  ] as const, [tuning])

  return (
    <main>
      <section className="stage">
        <Canvas camera={{ position: [0, 0.25, 5.2], fov: 48 }}>
          <Arena attack={attack} tuning={tuning} lastResult={lastResult} parryPulse={parryPulse} />
        </Canvas>
      </section>
      <aside className="panel">
        <h1>Flow Fight: Parry Lab</h1>
        <p>Projectile-first read. Press <kbd>Space</kbd> when the incoming threat physically reaches the shield. The projectile motion itself defines impact timing.</p>
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
          <code>window: ±{(tuning.parryWindowMs / 2).toFixed(1)}ms</code>
          <code>perfect: ±{(tuning.perfectWindowMs / 2).toFixed(1)}ms</code>
          <code>delta: {lastResult ? `${lastResult.deltaMs.toFixed(2)}ms` : '—'}</code>
          <code>result: {lastResult ? `${lastResult.grade} / ${lastResult.success ? 'success' : 'miss'}` : '—'}</code>
        </div>
      </aside>
    </main>
  )
}

export default App
