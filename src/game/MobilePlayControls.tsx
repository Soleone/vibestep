import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react'
import { laneColor, type Lane } from './model'

const drumLanes: Lane[] = ['kick', 'snare']
const melodyLanes: Lane[] = ['low', 'mid', 'high']

export function MobilePlayControls({
  heldLanes,
  onLanePress,
  onLaneRelease,
}: {
  heldLanes: ReadonlySet<Lane>
  onLanePress: (lane: Lane) => void
  onLaneRelease: (lane: Lane) => void
}) {
  const pointerLanes = useRef(new Map<number, Lane>())
  const activationTimers = useRef(new Map<Lane, number>())

  useEffect(() => () => {
    activationTimers.current.forEach(window.clearTimeout)
    new Set([...pointerLanes.current.values(), ...activationTimers.current.keys()]).forEach(onLaneRelease)
    activationTimers.current.clear()
    pointerLanes.current.clear()
  }, [onLaneRelease])

  const pressLane = (event: PointerEvent<HTMLButtonElement>, lane: Lane) => {
    event.preventDefault()
    if (pointerLanes.current.has(event.pointerId) || [...pointerLanes.current.values()].includes(lane)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerLanes.current.set(event.pointerId, lane)
    onLanePress(lane)
  }

  const releaseLane = (event: PointerEvent<HTMLButtonElement>) => {
    const lane = pointerLanes.current.get(event.pointerId)
    if (!lane) return
    pointerLanes.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    onLaneRelease(lane)
  }

  const activateLaneWithoutPointer = (lane: Lane) => {
    if ([...pointerLanes.current.values()].includes(lane)) return
    const previousTimer = activationTimers.current.get(lane)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    else onLanePress(lane)
    activationTimers.current.set(lane, window.setTimeout(() => {
      activationTimers.current.delete(lane)
      onLaneRelease(lane)
    }, 120))
  }

  const renderLane = (lane: Lane) => (
    <button
      key={lane}
      type="button"
      className={`mobile-lane-pad ${heldLanes.has(lane) ? 'mobile-lane-pad--held' : ''}`}
      style={{ '--mobile-lane-color': laneColor[lane] } as CSSProperties}
      aria-label={`Play ${lane} lane`}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => { if (event.detail === 0) activateLaneWithoutPointer(lane) }}
      onPointerDown={(event) => pressLane(event, lane)}
      onPointerUp={releaseLane}
      onPointerCancel={releaseLane}
      onLostPointerCapture={releaseLane}
    >
      {lane}
    </button>
  )

  return (
    <div className="mobile-play-controls" aria-label="Touch lane controls">
      <div className="mobile-play-controls__group mobile-play-controls__group--drums">{drumLanes.map(renderLane)}</div>
      <div className="mobile-play-controls__group mobile-play-controls__group--melody">{melodyLanes.map(renderLane)}</div>
    </div>
  )
}
