import { Canvas } from '@react-three/fiber'
import { Arena } from './Arena'
import type { Attack, Lane, LaneFeedback, Tuning } from './model'

type GameSceneProps = {
  attacks: Attack[]
  tuning: Tuning
  bpm: number
  collectionProgress: Record<Lane, number>
  collectionTotals: Record<Lane, number>
  laneFeedback: LaneFeedback
  padTriggers: Record<Lane, number>
  heldLanes: Set<Lane>
  onPhaseChange: (phase: string) => void
}

export function GameScene({ attacks, tuning, bpm, collectionProgress, collectionTotals, laneFeedback, padTriggers, heldLanes, onPhaseChange }: GameSceneProps) {
  return (
    <Canvas camera={{ position: [0, 0.18, 7.2], fov: 42 }} dpr={[1, 1.5]}>
      <Arena attacks={attacks} tuning={tuning} bpm={bpm} collectionProgress={collectionProgress} collectionTotals={collectionTotals} laneFeedback={laneFeedback} padTriggers={padTriggers} heldLanes={heldLanes} onPhaseChange={onPhaseChange} />
    </Canvas>
  )
}
