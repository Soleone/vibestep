import type { MouseEvent, PointerEvent, WheelEvent } from 'react'
import { clamp01, laneColor, lanes, timelineLaneHeightPx, timelineLaneTopPx, type BeatmapNote, type LoopMarkers, type TimelineBounds, type TimelineGridLine } from '../game/model'

export function EditorTimeline({
  notes,
  gridLines,
  bounds,
  songTimeMs,
  selectedNoteId,
  loopMarkers,
  onTimelineClick,
  onTimelineWheel,
  onSeek,
  onLoopRulerClick,
  onLoopMarkerDrag,
  onRemoveNote,
}: {
  notes: Array<BeatmapNote & { pending: boolean }>
  gridLines: TimelineGridLine[]
  bounds: TimelineBounds
  songTimeMs: number
  selectedNoteId: string | null
  loopMarkers: LoopMarkers
  onTimelineClick: (event: MouseEvent<HTMLDivElement>) => void
  onTimelineWheel: (event: WheelEvent<HTMLDivElement>) => void
  onSeek: (timeMs: number, bypassSnap?: boolean) => void
  onLoopRulerClick: (timeMs: number, marker: 'start' | 'end', bypassSnap?: boolean) => void
  onLoopMarkerDrag: (timeMs: number, marker: 'start' | 'end', bypassSnap?: boolean) => void
  onRemoveNote: (noteId: string) => void
}) {
  const playheadLeft = ((songTimeMs - bounds.startMs) / bounds.spanMs) * 100
  const loopStartLeft = loopMarkers.startMs === null ? null : ((loopMarkers.startMs - bounds.startMs) / bounds.spanMs) * 100
  const loopEndLeft = loopMarkers.endMs === null ? null : ((loopMarkers.endMs - bounds.startMs) / bounds.spanMs) * 100
  const hasVisibleLoopRange = loopStartLeft !== null && loopEndLeft !== null && loopStartLeft >= 0 && loopEndLeft <= 100 && loopEndLeft > loopStartLeft
  const seekFromPointer = (clientX: number, width: number, left: number, bypassSnap = false) => {
    const xRatio = clamp01((clientX - left) / width)
    onSeek(bounds.startMs + xRatio * bounds.spanMs, bypassSnap)
  }
  const timeFromPointer = (clientX: number, width: number, left: number) => {
    const xRatio = clamp01((clientX - left) / width)
    return bounds.startMs + xRatio * bounds.spanMs
  }
  const dragPlayhead = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    seekFromPointer(event.clientX, rect.width, rect.left, event.shiftKey)
  }
  const dragLoopMarker = (event: PointerEvent<HTMLDivElement>, marker: 'start' | 'end') => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    onLoopMarkerDrag(timeFromPointer(event.clientX, rect.width, rect.left), marker, event.shiftKey)
  }
  const handleTimelineRootClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const yPx = event.clientY - rect.top
    if (yPx < timelineLaneTopPx) {
      const xRatio = clamp01((event.clientX - rect.left) / rect.width)
      const timeMs = bounds.startMs + xRatio * bounds.spanMs
      if (event.ctrlKey) onLoopRulerClick(timeMs, event.altKey ? 'end' : 'start', event.shiftKey)
      else seekFromPointer(event.clientX, rect.width, rect.left, event.shiftKey)
      return
    }
    onTimelineClick(event)
  }

  return (
    <div className="timeline timeline--expanded" onClick={handleTimelineRootClick} onWheel={onTimelineWheel}>
      <div className="timeline-ruler">{gridLines.filter((line) => line.label).map((line, index) => <span key={`label-${line.left}-${index}`} className={`timeline-ruler__mark timeline-ruler__mark--${line.strength}`} style={{ left: `${line.left}%` }}>{line.label}</span>)}</div>
      {hasVisibleLoopRange && <div className="timeline-loop-range" style={{ left: `${loopStartLeft}%`, width: `${loopEndLeft - loopStartLeft}%` }} />}
      {loopStartLeft !== null && loopStartLeft >= 0 && loopStartLeft <= 100 && <div className="timeline-loop-marker timeline-loop-marker--start" style={{ left: `${loopStartLeft}%` }} title="Drag loop start" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragLoopMarker(event, 'start') }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragLoopMarker(event, 'start') }} onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />}
      {loopEndLeft !== null && loopEndLeft >= 0 && loopEndLeft <= 100 && <div className="timeline-loop-marker timeline-loop-marker--end" style={{ left: `${loopEndLeft}%` }} title="Drag loop stop" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragLoopMarker(event, 'end') }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragLoopMarker(event, 'end') }} onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />}
      <div className="timeline-grid">{gridLines.map((line, index) => <span key={`${line.left}-${index}`} className={`timeline-grid__line timeline-grid__line--${line.strength}`} style={{ left: `${line.left}%` }} />)}</div>
      <div className="timeline-labels">{lanes.map((lane) => <span key={lane}>{lane}</span>)}</div>
      {playheadLeft >= 0 && playheadLeft <= 100 && <div className="playhead" style={{ left: `${playheadLeft}%` }}><div className="playhead-handle" title="Drag to seek" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragPlayhead(event) }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragPlayhead(event) }} onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} /></div>}
      {notes.filter((note) => note.impactTimeMs >= bounds.startMs && note.impactTimeMs <= bounds.endMs).map((note) => <i key={`stage-${note.pending ? 'pending' : 'saved'}-${note.id}`} className={`${note.pending ? 'pending ' : ''}${selectedNoteId === note.id ? 'selected' : ''}`} onClick={(event) => { event.stopPropagation(); onRemoveNote(note.id) }} title={`Remove ${note.lane} ${Math.round(note.impactTimeMs)}ms`} style={{ left: `${((note.impactTimeMs - bounds.startMs) / bounds.spanMs) * 100}%`, top: `${timelineLaneTopPx + lanes.indexOf(note.lane) * timelineLaneHeightPx + 14}px`, width: note.durationMs ? `${Math.max(8, (note.durationMs / bounds.spanMs) * 100)}%` : undefined, background: laneColor[note.lane] }} />)}
    </div>
  )
}
