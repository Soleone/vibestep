import { Canvas } from '@react-three/fiber'
import { Arena } from './Arena'
import type { Attack, Lane, LaneFeedback, Tuning } from './model'

type GameSceneProps = {
  attacks: Attack[]
  tuning: Tuning
  bpm: number
  laneFeedback: LaneFeedback
  padTriggers: Record<Lane, number>
  heldLanes: Set<Lane>
  onPhaseChange: (phase: string) => void
}

export function GameScene({ attacks, tuning, bpm, laneFeedback, padTriggers, heldLanes, onPhaseChange }: GameSceneProps) {
  return (
    <Canvas camera={{ position: [0, 0.18, 7.2], fov: 42 }} dpr={1}>
      <Arena attacks={attacks} tuning={tuning} bpm={bpm} laneFeedback={laneFeedback} padTriggers={padTriggers} heldLanes={heldLanes} onPhaseChange={onPhaseChange} />
    </Canvas>
  )
}
