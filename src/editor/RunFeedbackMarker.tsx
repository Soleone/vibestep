import { memo, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { NoteFeedbackAggregate } from '../game/run-feedback-aggregation'
import { describeRunNoteSummary } from '../game/run-history'

export type RunFeedbackQuality = 'perfect' | 'successful' | 'problem' | 'muted'

function markerQuality(aggregate: NoteFeedbackAggregate): RunFeedbackQuality {
  if (aggregate.attemptCount < 3) return 'muted'
  if (aggregate.noInputMissCount / aggregate.attemptCount >= 0.5 || aggregate.missRate >= 0.3) return 'problem'
  if (aggregate.perfectRate >= 0.6) return 'perfect'
  if (aggregate.successRate >= 0.7) return 'successful'
  return 'problem'
}

function markerGlyph(aggregate: NoteFeedbackAggregate) {
  if (aggregate.direction === 'early') return '←'
  if (aggregate.direction === 'late') return '→'
  if (aggregate.direction === 'mixed') return '↔'
  if (aggregate.direction === 'centered') return '✓'
  if (aggregate.direction === 'no-input') return '×'
  if (aggregate.latestResult.deltaMs === null) return '×'
  if (aggregate.latestResult.deltaMs < 0) return '←'
  if (aggregate.latestResult.deltaMs > 0) return '→'
  return aggregate.latestResult.grade === 'perfect' ? '✓' : '•'
}

function timingDescription(deltaMs: number | null) {
  if (deltaMs === null) return 'No timed input'
  const rounded = Math.round(deltaMs)
  if (rounded === 0) return '0ms, on time'
  return `${rounded > 0 ? '+' : ''}${rounded}ms ${rounded < 0 ? 'early' : 'late'}`
}

function directionDescription(aggregate: NoteFeedbackAggregate) {
  return `${aggregate.earlyInputCount} early, ${aggregate.centeredInputCount} centered, ${aggregate.lateInputCount} late`
}

function confidenceDescription(aggregate: NoteFeedbackAggregate) {
  const spread = aggregate.medianAbsoluteDeviationMs === null ? 'no timed spread' : `MAD ${Math.round(aggregate.medianAbsoluteDeviationMs)}ms`
  return `${aggregate.confidence}, ${spread}`
}

function stopPointerEvent(event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) {
  event.stopPropagation()
}

export const RunFeedbackMarker = memo(function RunFeedbackMarker({ aggregate, left }: { aggregate: NoteFeedbackAggregate; left: string }) {
  const detailId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, above: false })
  const quality = markerQuality(aggregate)
  const glyph = markerGlyph(aggregate)
  const ariaLabel = `${aggregate.attemptCount} attempts across ${aggregate.runCount} runs. ${aggregate.direction} timing, ${aggregate.confidence} confidence. Latest ${describeRunNoteSummary(aggregate.latestResult)}.`

  useEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const above = rect.bottom + 250 > window.innerHeight
      const detailHalfWidth = Math.min(155, Math.max(0, (window.innerWidth - 24) / 2))
      setPosition({
        left: Math.min(window.innerWidth - 12 - detailHalfWidth, Math.max(12 + detailHalfWidth, rect.left + rect.width / 2)),
        top: above ? rect.top - 10 : rect.bottom + 10,
        above,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const show = () => setOpen(true)
  const hideOnBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`timeline-run-feedback timeline-run-feedback--${quality} timeline-run-feedback--confidence-${aggregate.confidence}`}
        style={{ left }}
        aria-label={ariaLabel}
        aria-describedby={open ? detailId : undefined}
        title=""
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={hideOnBlur}
        onKeyDown={handleKeyDown}
        onClick={stopPointerEvent}
        onPointerDown={stopPointerEvent}
        onPointerUp={stopPointerEvent}
        onPointerMove={stopPointerEvent}
      >
        <span aria-hidden="true">{glyph}</span>
        <small aria-hidden="true">{aggregate.attemptCount > 99 ? '99+' : aggregate.attemptCount}</small>
      </button>
      {open ? createPortal(
        <div
          id={detailId}
          role="tooltip"
          className={`run-feedback-detail${position.above ? ' run-feedback-detail--above' : ''}`}
          style={{ left: position.left, top: position.top }}
        >
          <strong>{aggregate.attemptCount} attempts across {aggregate.runCount} {aggregate.runCount === 1 ? 'run' : 'runs'}</strong>
          <span className="run-feedback-detail__trend">{aggregate.direction === 'insufficient' ? 'Not enough consistent evidence yet' : `${aggregate.direction} timing`}</span>
          <dl>
            <div><dt>Perfect</dt><dd>{aggregate.perfectCount}</dd></div>
            <div><dt>Good</dt><dd>{aggregate.goodCount}</dd></div>
            <div><dt>Mistimed miss</dt><dd>{aggregate.mistimedMissCount}</dd></div>
            <div><dt>No input</dt><dd>{aggregate.noInputMissCount}</dd></div>
            {aggregate.unresolvedFailureCount > 0 ? <div><dt>Interrupted</dt><dd>{aggregate.unresolvedFailureCount}</dd></div> : null}
            <div><dt>Typical timing</dt><dd>{timingDescription(aggregate.medianDeltaMs)}</dd></div>
            <div><dt>Direction</dt><dd>{directionDescription(aggregate)}</dd></div>
            <div><dt>Consistency</dt><dd>{confidenceDescription(aggregate)}</dd></div>
            <div><dt>Latest</dt><dd>{describeRunNoteSummary(aggregate.latestResult)}</dd></div>
          </dl>
        </div>,
        document.body,
      ) : null}
    </>
  )
})
