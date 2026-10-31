export interface PerfCounter {
  count: number
  totalMs: number
  maxMs: number
}

declare global {
  interface Window {
    __karuPerf?: {
      get(): Record<string, PerfCounter>
      reset(): void
    }
  }
}

let enabled = (() => {
  try {
    return typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('perf') === '1'
  } catch {
    return false
  }
})()

const counters = new Map<string, PerfCounter>()

function updatePerfWindow(): void {
  if (typeof window === 'undefined') return
  if (enabled) {
    window.__karuPerf = { get: getPerfCounters, reset: resetPerfCounters }
  } else {
    delete window.__karuPerf
  }
}

export function isPerfEnabled(): boolean {
  return enabled
}

export function setPerfEnabled(value: boolean): void {
  enabled = value
  updatePerfWindow()
}

export function perfCount(name: string, amount = 1): void {
  if (!enabled) return
  const counter = counters.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 }
  counter.count += amount
  counters.set(name, counter)
}

export function perfTime<T>(name: string, fn: () => T): T {
  if (!enabled) return fn()
  const start = performance.now()
  try {
    return fn()
  } finally {
    const duration = performance.now() - start
    const counter = counters.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 }
    counter.count += 1
    counter.totalMs += duration
    counter.maxMs = Math.max(counter.maxMs, duration)
    counters.set(name, counter)
  }
}

export function getPerfCounters(): Record<string, PerfCounter> {
  return Object.fromEntries(
    [...counters].map(([name, counter]) => [name, { ...counter }]),
  )
}

export function resetPerfCounters(): void {
  counters.clear()
}

if (enabled) updatePerfWindow()
