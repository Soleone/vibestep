import type { FeedbackEvent } from './model'

export function HitNotify({ feedback, streak }: { feedback: FeedbackEvent | null; streak: number }) {
  if (!feedback) return null
  const isPerfect = feedback.kind === 'perfect-parry'
  const isGood = feedback.kind === 'good-parry'
  const label = isPerfect ? 'Perfect' : isGood ? 'Hit' : 'Miss'
  const count = isGood || isPerfect ? streak : 0
  return (
    <div key={feedback.id} className={`hit-notify ${isPerfect ? 'hit-notify--perfect' : isGood ? 'hit-notify--good' : 'hit-notify--miss'}`} aria-live="polite">
      <span className="hit-notify__count">{count}</span>
      <span className="hit-notify__label">{label}</span>
    </div>
  )
}
