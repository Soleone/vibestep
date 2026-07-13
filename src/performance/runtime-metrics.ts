export type RuntimeMetricsSnapshot = {
  frameP99Ms: number
  frameMaxMs: number
  droppedFrames: number
  longTasks: number
  schedulerP99Ms: number
  schedulerMaxMs: number
  schedulerNotesMax: number
}

const sampleLimit = 600

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

class RuntimeMetrics {
  private frameIntervals: number[] = []
  private schedulerDurations: number[] = []
  private schedulerNotesMax = 0
  private longTasks = 0
  private frameId: number | null = null
  private observer: PerformanceObserver | null = null

  start() {
    if (this.frameId !== null || typeof window === 'undefined') return () => undefined
    let previous = performance.now()
    const frame = (now: number) => {
      this.push(this.frameIntervals, now - previous)
      previous = now
      this.frameId = requestAnimationFrame(frame)
    }
    this.frameId = requestAnimationFrame(frame)
    if ('PerformanceObserver' in window) {
      try {
        this.observer = new PerformanceObserver((list) => { this.longTasks += list.getEntries().length })
        this.observer.observe({ type: 'longtask', buffered: true })
      } catch { this.observer = null }
    }
    return () => this.stop()
  }

  stop() {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.observer?.disconnect()
    this.observer = null
  }

  recordScheduler(durationMs: number, examinedNotes: number) {
    this.push(this.schedulerDurations, durationMs)
    this.schedulerNotesMax = Math.max(this.schedulerNotesMax, examinedNotes)
  }

  snapshot(): RuntimeMetricsSnapshot {
    return {
      frameP99Ms: percentile(this.frameIntervals, 0.99),
      frameMaxMs: Math.max(0, ...this.frameIntervals),
      droppedFrames: this.frameIntervals.filter((duration) => duration > 25).length,
      longTasks: this.longTasks,
      schedulerP99Ms: percentile(this.schedulerDurations, 0.99),
      schedulerMaxMs: Math.max(0, ...this.schedulerDurations),
      schedulerNotesMax: this.schedulerNotesMax,
    }
  }

  private push(target: number[], value: number) {
    target.push(value)
    if (target.length > sampleLimit) target.shift()
  }
}

export const runtimeMetrics = new RuntimeMetrics()
