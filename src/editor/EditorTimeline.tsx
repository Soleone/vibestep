import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { clamp01, laneColor, lanes, timelineLaneAreaHeightPx, timelineLaneHeightPx, timelineLaneTopPx, type Lane, type LoopMarkers, type TimelineBounds, type TimelineGridLine } from '../game/model'
import type { TimelineNote } from './timeline-window'

export function EditorTimeline({
  notes,
  gridLines,
  bounds,
  songTimeMs,
  playheadActive,
  selectedNoteIds,
  loopMarkers,
  onTimelineClick,
  onTimelineWheel,
  onSeek,
  onLoopRulerClick,
  onLoopMarkerDrag,
  onLoopMarkerRemove,
  onNoteDrag,
  onHoldCreate,
  onHoldResize,
  onLaneSelect,
  onSelectionChange,
  onRemoveNote,
}: {
  notes: TimelineNote[]
  gridLines: TimelineGridLine[]
  bounds: TimelineBounds
  songTimeMs: number
  playheadActive: boolean
  selectedNoteIds: Set<string>
  loopMarkers: LoopMarkers
  onTimelineClick: (event: MouseEvent<HTMLDivElement>) => void
  onTimelineWheel: (event: globalThis.WheelEvent, zoomFromRuler: boolean) => void
  onSeek: (timeMs: number, bypassSnap?: boolean) => void
  onLoopRulerClick: (timeMs: number, marker: 'start' | 'end', bypassSnap?: boolean) => void
  onLoopMarkerDrag: (timeMs: number, marker: 'start' | 'end', bypassSnap?: boolean) => void
  onLoopMarkerRemove: (marker: 'start' | 'end') => void
  onNoteDrag: (noteId: string, timeMs: number, lane: Lane, bypassSnap?: boolean) => void
  onHoldCreate: (startMs: number, endMs: number, lane: Lane, bypassSnap?: boolean) => void
  onHoldResize: (noteId: string, endMs: number, bypassSnap?: boolean) => void
  onLaneSelect: (lane: Lane) => void
  onSelectionChange: (noteIds: Set<string>) => void
  onRemoveNote: (noteId: string) => void
}) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const notePointer = useRef<{ noteId: string; startedAt: number; pointerId: number; dragging: boolean } | null>(null)
  const markerPointer = useRef<{ marker: 'start' | 'end'; startedAt: number; pointerId: number; dragging: boolean } | null>(null)
  const selectionPointer = useRef<{ pointerId: number; startX: number; startY: number; currentX: number; currentY: number; dragging: boolean; creatingHold: boolean; lane: Lane; bypassSnap: boolean } | null>(null)
  const suppressNextClick = useRef(false)
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const playheadLeft = ((songTimeMs - bounds.startMs) / bounds.spanMs) * 100
  const loopStartLeft = loopMarkers.startMs === null ? null : ((loopMarkers.startMs - bounds.startMs) / bounds.spanMs) * 100
  const loopEndLeft = loopMarkers.endMs === null ? null : ((loopMarkers.endMs - bounds.startMs) / bounds.spanMs) * 100
  const hasVisibleLoopRange = loopStartLeft !== null && loopEndLeft !== null && loopStartLeft >= 0 && loopEndLeft <= 100 && loopEndLeft > loopStartLeft
  const noteTriggerWindowMs = 180
  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    const handleWheel = (event: globalThis.WheelEvent) => {
      const rect = timeline.getBoundingClientRect()
      onTimelineWheel(event, event.clientY - rect.top < timelineLaneTopPx)
    }
    timeline.addEventListener('wheel', handleWheel, { passive: false })
    return () => timeline.removeEventListener('wheel', handleWheel)
  }, [onTimelineWheel])
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
  const startMarkerPointer = (event: PointerEvent<HTMLDivElement>, marker: 'start' | 'end') => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    markerPointer.current = { marker, startedAt: performance.now(), pointerId: event.pointerId, dragging: false }
  }
  const moveMarkerPointer = (event: PointerEvent<HTMLDivElement>, marker: 'start' | 'end') => {
    const pointer = markerPointer.current
    if (!pointer || pointer.marker !== marker || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    if (performance.now() - pointer.startedAt < 300) return
    pointer.dragging = true
    dragLoopMarker(event, marker)
  }
  const endMarkerPointer = (event: PointerEvent<HTMLDivElement>, marker: 'start' | 'end') => {
    event.stopPropagation()
    const pointer = markerPointer.current
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    markerPointer.current = null
    if (!pointer || pointer.marker !== marker || pointer.dragging || performance.now() - pointer.startedAt >= 300) return
    onLoopMarkerRemove(marker)
  }
  const dragNote = (event: PointerEvent<HTMLElement>, noteId: string) => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const yPx = event.clientY - rect.top - timelineLaneTopPx
    const yRatio = clamp01(yPx / timelineLaneAreaHeightPx)
    const laneIndex = Math.min(lanes.length - 1, Math.max(0, Math.floor(yRatio * lanes.length)))
    onNoteDrag(noteId, timeFromPointer(event.clientX, rect.width, rect.left), lanes[laneIndex], event.shiftKey)
  }
  const startNotePointer = (event: PointerEvent<HTMLElement>, noteId: string) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    notePointer.current = { noteId, startedAt: performance.now(), pointerId: event.pointerId, dragging: false }
  }
  const moveNotePointer = (event: PointerEvent<HTMLElement>, noteId: string) => {
    const pointer = notePointer.current
    if (!pointer || pointer.noteId !== noteId || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    if (performance.now() - pointer.startedAt < 300) return
    pointer.dragging = true
    dragNote(event, noteId)
  }
  const endNotePointer = (event: PointerEvent<HTMLElement>, noteId: string) => {
    event.stopPropagation()
    const pointer = notePointer.current
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    notePointer.current = null
    if (!pointer || pointer.noteId !== noteId || pointer.dragging || performance.now() - pointer.startedAt >= 300) return
    onRemoveNote(noteId)
  }
  const updateBoxSelection = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = selectionPointer.current
    if (!pointer || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const currentX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
    const currentY = Math.min(Math.max(event.clientY - rect.top, timelineLaneTopPx), timelineLaneTopPx + timelineLaneAreaHeightPx)
    pointer.currentX = currentX
    pointer.currentY = currentY
    const box = {
      left: Math.min(pointer.startX, currentX),
      top: Math.min(pointer.startY, currentY),
      width: Math.abs(currentX - pointer.startX),
      height: Math.abs(currentY - pointer.startY),
    }
    pointer.dragging = pointer.dragging || box.width > 4 || box.height > 4
    if (!pointer.dragging) return
    setSelectionBox(box)
    if (pointer.creatingHold) return
    const startTimeMs = bounds.startMs + (box.left / rect.width) * bounds.spanMs
    const endTimeMs = bounds.startMs + ((box.left + box.width) / rect.width) * bounds.spanMs
    const startLaneIndex = Math.min(lanes.length - 1, Math.max(0, Math.floor(((box.top - timelineLaneTopPx) / timelineLaneAreaHeightPx) * lanes.length)))
    const endLaneIndex = Math.min(lanes.length - 1, Math.max(0, Math.floor((((box.top + box.height) - timelineLaneTopPx) / timelineLaneAreaHeightPx) * lanes.length)))
    const selected = new Set(notes.filter((note) => note.impactTimeMs >= startTimeMs && note.impactTimeMs <= endTimeMs && lanes.indexOf(note.lane) >= startLaneIndex && lanes.indexOf(note.lane) <= endLaneIndex).map((note) => note.id))
    onSelectionChange(selected)
  }
  const startSelectionPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const yPx = event.clientY - rect.top
    if (yPx < timelineLaneTopPx || yPx > timelineLaneTopPx + timelineLaneAreaHeightPx) return
    const laneIndex = Math.min(lanes.length - 1, Math.max(0, Math.floor(((yPx - timelineLaneTopPx) / timelineLaneAreaHeightPx) * lanes.length)))
    event.currentTarget.setPointerCapture(event.pointerId)
    selectionPointer.current = { pointerId: event.pointerId, startX: event.clientX - rect.left, startY: yPx, currentX: event.clientX - rect.left, currentY: yPx, dragging: false, creatingHold: event.ctrlKey || event.metaKey, lane: lanes[laneIndex], bypassSnap: event.shiftKey }
  }
  const moveSelectionPointer = (event: PointerEvent<HTMLDivElement>) => updateBoxSelection(event)
  const endSelectionPointer = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = selectionPointer.current
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    selectionPointer.current = null
    setSelectionBox(null)
    if (pointer?.dragging) {
      suppressNextClick.current = true
      if (pointer.creatingHold) {
        const rect = event.currentTarget.getBoundingClientRect()
        const startMs = bounds.startMs + (pointer.startX / rect.width) * bounds.spanMs
        const endMs = bounds.startMs + (pointer.currentX / rect.width) * bounds.spanMs
        onHoldCreate(Math.min(startMs, endMs), Math.max(startMs, endMs), pointer.lane, pointer.bypassSnap)
      }
    }
  }
  const handleTimelineRootClick = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      event.preventDefault()
      return
    }
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
    <div ref={timelineRef} className="timeline timeline--expanded" onClick={handleTimelineRootClick} onPointerDown={startSelectionPointer} onPointerMove={moveSelectionPointer} onPointerUp={endSelectionPointer} onPointerCancel={endSelectionPointer}>
      <div className="timeline-ruler">{gridLines.filter((line) => line.label).map((line, index) => <span key={`label-${line.left}-${index}`} className={`timeline-ruler__mark timeline-ruler__mark--${line.strength}`} style={{ left: `${line.left}%` }}>{line.label}</span>)}</div>
      {hasVisibleLoopRange && <div className="timeline-loop-range" style={{ left: `${loopStartLeft}%`, width: `${loopEndLeft - loopStartLeft}%` }} />}
      {loopStartLeft !== null && loopStartLeft >= 0 && loopStartLeft <= 100 && <div className="timeline-loop-marker timeline-loop-marker--start" style={{ left: `${loopStartLeft}%` }} title="Click to remove. Hold 300ms and drag loop start." onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startMarkerPointer(event, 'start')} onPointerMove={(event) => moveMarkerPointer(event, 'start')} onPointerUp={(event) => endMarkerPointer(event, 'start')} onPointerCancel={(event) => endMarkerPointer(event, 'start')} />}
      {loopEndLeft !== null && loopEndLeft >= 0 && loopEndLeft <= 100 && <div className="timeline-loop-marker timeline-loop-marker--end" style={{ left: `${loopEndLeft}%` }} title="Click to remove. Hold 300ms and drag loop stop." onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startMarkerPointer(event, 'end')} onPointerMove={(event) => moveMarkerPointer(event, 'end')} onPointerUp={(event) => endMarkerPointer(event, 'end')} onPointerCancel={(event) => endMarkerPointer(event, 'end')} />}
      <div className="timeline-grid">{gridLines.map((line, index) => <span key={`${line.left}-${index}`} className={`timeline-grid__line timeline-grid__line--${line.strength}`} style={{ left: `${line.left}%` }} />)}</div>
      <div className="timeline-labels" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>{lanes.map((lane) => <span key={lane} role="button" tabIndex={0} title={`Select all ${lane} notes`} onClick={(event) => { event.stopPropagation(); onLaneSelect(lane) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onLaneSelect(lane) } }}>{lane}</span>)}</div>
      {selectionBox && <div className="timeline-selection-box" style={selectionBox} />}
      {playheadLeft >= 0 && playheadLeft <= 100 && <div className="playhead" style={{ left: `${playheadLeft}%` }}><div className="playhead-handle" title="Drag to seek" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragPlayhead(event) }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragPlayhead(event) }} onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} /></div>}
      {notes.map((note) => {
        const triggerAgeMs = songTimeMs - note.impactTimeMs
        const holdEndMs = note.impactTimeMs + (note.durationMs ?? 0)
        const isTriggered = playheadActive && (note.durationMs ? songTimeMs >= note.impactTimeMs && songTimeMs <= holdEndMs + noteTriggerWindowMs : triggerAgeMs >= 0 && triggerAgeMs <= noteTriggerWindowMs)
        const isHeavy = note.strength >= 2
        return <i key={`stage-${note.pending ? 'pending' : 'saved'}-${note.id}`} className={`${note.pending ? 'pending ' : ''}${note.recording ? 'recording ' : ''}${note.durationMs ? 'hold ' : ''}${isHeavy ? 'heavy ' : ''}${selectedNoteIds.has(note.id) ? 'selected ' : ''}${isTriggered ? 'triggered' : ''}`} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => startNotePointer(event, note.id)} onPointerMove={(event) => moveNotePointer(event, note.id)} onPointerUp={(event) => endNotePointer(event, note.id)} onPointerCancel={(event) => endNotePointer(event, note.id)} title={note.recording ? `Recording ${note.lane} hold` : `${isHeavy ? 'Heavy note. ' : ''}Click to remove. Hold 300ms and drag ${note.lane} ${Math.round(note.impactTimeMs)}ms.`} style={{ left: `${((note.impactTimeMs - bounds.startMs) / bounds.spanMs) * 100}%`, top: `${timelineLaneTopPx + lanes.indexOf(note.lane) * timelineLaneHeightPx + 14}px`, width: note.durationMs ? `max(14px, ${(note.durationMs / bounds.spanMs) * 100}%)` : undefined, background: laneColor[note.lane], color: laneColor[note.lane] }}>{note.durationMs ? <span className="timeline-note-end" title="Drag to resize hold" onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { event.stopPropagation(); if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect(); if (rect) onHoldResize(note.id, timeFromPointer(event.clientX, rect.width, rect.left), event.shiftKey) }} onPointerUp={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} /> : null}</i>
      })}
    </div>
  )
}
