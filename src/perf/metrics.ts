export type MetricName = 'open' | 'open-sharp' | 'render-job-worker' | 'render-job-roundtrip' | 'zoom-settle' | 'pan-settle'

export interface SeriesSummary {
  latest: number | null
  average: number | null
  p95: number | null
  count: number
}

export interface MetricsSnapshot {
  open: SeriesSummary
  openSharp: SeriesSummary
  renderWorker: SeriesSummary
  renderRoundTrip: SeriesSummary
  zoomSettle: SeriesSummary
  panSettle: SeriesSummary
  blankFrames: { total: number; blank: number; ratio: number; longestMs: number }
}

const values = new Map<MetricName, number[]>()
let blankTotal = 0
let blankCount = 0
let blankStarted: number | null = null
let longestBlank = 0

function measureName(name: MetricName): string {
  return `karu-${name}-${performance.now()}-${Math.random()}`
}

export function recordMetric(name: MetricName, duration: number): void {
  const series = values.get(name) ?? []
  series.push(duration)
  if (series.length > 2000) series.shift()
  values.set(name, series)
}

export function startMeasure(name: MetricName): () => number {
  const id = measureName(name)
  const start = `${id}-start`
  const end = `${id}-end`
  performance.mark(start)
  return () => {
    performance.mark(end)
    const measure = performance.measure(id, start, end)
    recordMetric(name, measure.duration)
    performance.clearMarks(start)
    performance.clearMarks(end)
    performance.clearMeasures(id)
    return measure.duration
  }
}

export function recordBlankFrame(isBlank: boolean, at = performance.now()): void {
  blankTotal += 1
  if (isBlank) {
    blankCount += 1
    if (blankStarted === null) blankStarted = at
  } else if (blankStarted !== null) {
    longestBlank = Math.max(longestBlank, at - blankStarted)
    blankStarted = null
  }
}

export function resetBlankFrames(): void {
  blankTotal = 0
  blankCount = 0
  blankStarted = null
  longestBlank = 0
}

function summarize(name: MetricName): SeriesSummary {
  const series = values.get(name) ?? []
  if (series.length === 0) return { latest: null, average: null, p95: null, count: 0 }
  const sorted = [...series].sort((a, b) => a - b)
  return {
    latest: series.at(-1) ?? null,
    average: series.reduce((sum, value) => sum + value, 0) / series.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    count: series.length,
  }
}

export function getMetrics(): MetricsSnapshot {
  const activeLongest = blankStarted === null ? 0 : performance.now() - blankStarted
  return {
    open: summarize('open'),
    openSharp: summarize('open-sharp'),
    renderWorker: summarize('render-job-worker'),
    renderRoundTrip: summarize('render-job-roundtrip'),
    zoomSettle: summarize('zoom-settle'),
    panSettle: summarize('pan-settle'),
    blankFrames: {
      total: blankTotal,
      blank: blankCount,
      ratio: blankTotal === 0 ? 0 : blankCount / blankTotal,
      longestMs: Math.max(longestBlank, activeLongest),
    },
  }
}
