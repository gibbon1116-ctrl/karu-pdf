import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/core/annotations'
import { vectorSymbolSearch, type VectorSymbolOptions } from '../src/core/vectorSymbolSearch'

// Synthetic figures reused from vectorSymbolKeyStrokes.test.ts. No drawing data.
type Line = [number, number, number, number]
const square: Line[] = [[-2, -2, 2, -2], [2, -2, 2, 2], [2, 2, -2, 2], [-2, 2, -2, -2]]
const markedSquare: Line[] = [...square, [-1, -1, -.3, -.6]]
const circle = (n: number, radius = 2.07): Line[] => Array.from({ length: n }, (_, i) => [
  radius * Math.cos(i * 2 * Math.PI / n), radius * Math.sin(i * 2 * Math.PI / n),
  radius * Math.cos((i + 1) * 2 * Math.PI / n), radius * Math.sin((i + 1) * 2 * Math.PI / n),
])
const bars = (shift = 0): Line[] => [1.68, 1.2, .6].map((length, i) => [-length / 2, 2.25 + i * .3 + shift, length / 2, 2.25 + i * .3 + shift])
const slots = (length: number, offset: number): Line[] => [-offset, offset].map(x => [x, -length / 2, x, length / 2])
const outlet: Line[] = [...circle(10), ...slots(3.9, .84), ...bars()]

function split(lines: Line[], parts: number): Line[] {
  return lines.flatMap(([x0, y0, x1, y1]) => Array.from({ length: parts }, (_, i) => [
    x0 + (x1 - x0) * i / parts, y0 + (y1 - y0) * i / parts,
    x0 + (x1 - x0) * (i + 1) / parts, y0 + (y1 - y0) * (i + 1) / parts,
  ] as Line))
}
function stamp(lines: Line[], x = 20, y = 20): number[] {
  return lines.flatMap(([ax, ay, bx, by]) => [x + ax, y + ay, x + bx, y + by])
}
function bounds(lines: Line[]): Rect {
  const xs = lines.flatMap(l => [l[0], l[2]]), ys = lines.flatMap(l => [l[1], l[3]])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
function search(sample: Line[], target: number[], options: Partial<VectorSymbolOptions> = {}) {
  const segments = new Float32Array(sample.flat()), widths = new Float32Array(sample.length).fill(.5)
  return vectorSymbolSearch(new Float32Array(target), bounds(sample), { threshold: .85, rotations: true, ...options },
    segments, widths, new Float32Array(target.length / 4).fill(.5), undefined, { segments, widths })
}
function stableStats(stats: ReturnType<typeof search>['stats']) {
  const { placements, ms, mergeMs, candidateMs, verifyMs, ...rest } = stats
  return rest
}
function summarizedMatches(matches: ReturnType<typeof search>['matches']) {
  return matches.map(({ center, score, extra, source }) => ({
    center: center.map(value => Number(value.toFixed(9))),
    score: Number(score.toFixed(9)), extra: Number(extra.toFixed(9)), source,
  }))
}

// Pre-change expectations derived by tracing the old loop, not by running it.
// The tight region admits two primary poses and skips four later poses. Six
// other poses leave the region. All admitted poses pass both gates, so these
// fixtures also have identical keyStrokeRejected/exhaustivePlacements counters.
const squareStats = {
  anchorsTried: 2, targetSegments: 4, widthFilteredSegments: 4,
  targetStrokes: 4, templateStrokes: 4, anchors: 3, ringAnchor: false,
  skippedPlacements: 4, regionExcluded: 6, geometryPassed: 2, geometrySites: 1,
  structureExcluded: 0, structureExcludedSites: 0, rotationExcluded: 0,
  duplicates: 1, limited: 0, final: 1, stopped: false, ringLimited: false, scaled: 0,
  exhaustiveRan: false, exhaustivePlacements: 0, exhaustiveFound: 0,
  keyStrokes: 3, keyStrokeRejected: 0,
}

describe('coverage before the key stroke gate', () => {
  for (const exhaustiveWhenEmpty of [false, true]) {
    it(`does not check keys after coverage fails (exhaustive=${exhaustiveWhenEmpty})`, () => {
      // Anchor-sized fragments generate primary and additional placements, but
      // neither isolated fragment can cover the complete marked square.
      const target = [...stamp([square[0]]), ...stamp([markedSquare[4]], 100, 100)]
      const result = search(markedSquare, target, { threshold: .99, scaleRange: 0, exhaustiveWhenEmpty })
      // A cheap midpoint probe of the strict gate runs before coverage and
      // counts its rejections in keyStrokeRejected; every pose is still either probed out or measured.
      expect(result.stats.placements + result.stats.keyStrokeRejected).toBeGreaterThan(0)
      expect(result.stats.geometryPassed).toBe(0)
      expect(result.matches).toEqual([])
      expect(result.rejected).toEqual([])
      expect(result.stats.exhaustiveRan).toBe(exhaustiveWhenEmpty)
      // Recovery poses may now fail the loose gate before coverage (counted in keyStrokeRejected).
      if (exhaustiveWhenEmpty) expect(result.stats.exhaustivePlacements + result.stats.keyStrokeRejected).toBeGreaterThan(0)
    })
  }

  for (const parts of [1, 3, 7]) for (const exhaustiveWhenEmpty of [false, true]) {
    it(`preserves fixed square results and counters (${parts} parts, exhaustive=${exhaustiveWhenEmpty})`, () => {
      const result = search(square, stamp(split(square, parts)), {
        rotations: false, scaleRange: 0, region: [18, 18, 22, 22], exhaustiveWhenEmpty,
      })
      expect(summarizedMatches(result.matches)).toEqual([
        { center: [20, 20], score: 1, extra: 0, source: 'primary' },
      ])
      expect(result.rejected).toEqual([])
      expect(stableStats(result.stats)).toEqual({
        ...squareStats, targetSegments: 4 * parts, widthFilteredSegments: 4 * parts,
      })
    })
  }

  for (const parts of [3, 7]) {
    it(`accepts ${parts}-part outlet slots through the strict gate`, () => {
      const target: Line[] = [...circle(10), ...split(slots(3.4, 1.08), parts), ...bars(-.15)]
      const result = search(outlet, stamp(target), { exhaustiveWhenEmpty: false })
      expect(result.stats.keyStrokes).toBeGreaterThanOrEqual(2)
      expect(result.stats.exhaustiveRan).toBe(false)
      expect(result.matches).toHaveLength(1)
      expect(result.rejected).toEqual([])
      expect(result.matches[0].source).not.toBe('exhaustive')
      const rect = bounds(outlet), cy = (rect[1] + rect[3]) / 2 - .15
      expect(Math.hypot(result.matches[0].center[0] - 20, result.matches[0].center[1] - 20 - cy)).toBeLessThan(.3)
    })
  }

  it('rejects a one-ended 1.5x key stroke joined across a 0.1pt gap', () => {
    // The asymmetric mark prevents a half-turn from moving the extension onto
    // the unselected fourth side. The total right-side span is exactly 6pt.
    const extended: Line[] = [...markedSquare, [2, 2.1, 2, 4]]
    const result = search(markedSquare, stamp(extended), {
      threshold: .99, rotations: false, scaleRange: 0, exhaustiveWhenEmpty: false,
    })
    expect(result.matches).toEqual([])
    expect(result.rejected).toEqual([])
    expect(result.stats.keyStrokeRejected).toBeGreaterThan(0)
    expect(result.stats.geometryPassed).toBe(0)
    expect(result.stats.geometrySites).toBe(0)
    expect(result.stats.structureExcluded).toBe(0)
    expect(result.stats.exhaustiveRan).toBe(false)
  })

  it('rejects a connected interval reaching the local search boundary', () => {
    const extended: Line[] = [...markedSquare, ...split([[2, 2.1, 2, 20]], 70)]
    const result = search(markedSquare, stamp(extended), {
      threshold: .99, rotations: false, scaleRange: 0, exhaustiveWhenEmpty: false,
    })
    expect(result.matches).toEqual([])
    expect(result.rejected).toEqual([])
    expect(result.stats.keyStrokeRejected).toBeGreaterThan(0)
    expect(result.stats.geometryPassed).toBe(0)
  })

  it('keeps the fixed extended-wire recovery result through the loose gate', () => {
    const wired: Line[] = [[-60, -2, 60, -2], [2, -60, 2, 60], [60, 2, -60, 2], ...markedSquare.slice(3)]
    const result = search(markedSquare, stamp(wired), {
      threshold: .99, exhaustiveWhenEmpty: true, scaleRange: 0,
    })
    expect(summarizedMatches(result.matches)).toEqual([
      { center: [20, 20], score: 1, extra: 0, source: 'exhaustive' },
    ])
    expect(result.rejected).toEqual([])
    expect(result.stats.exhaustiveRan).toBe(true)
    expect(result.stats.exhaustiveFound).toBe(1)
  })

  it('logs advisory timing for 100,000 random segments and 200 small symbols', () => {
    let state = 7123
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000)
    const target: number[] = []
    for (let i = 0; i < 100_000; i++) {
      const x = random() * 4000, y = 500 + random() * 4000, angle = random() * 2 * Math.PI, length = .5 + random() * 12
      target.push(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    }
    for (let i = 0; i < 200; i++) {
      const symbol = i % 2 ? [...circle(10), ...split(slots(3.9, .84), 2), ...bars()] : outlet
      target.push(...stamp(symbol, 20 + i % 40 * 10, 20 + Math.floor(i / 40) * 10))
    }
    const started = performance.now(), result = search(outlet, target)
    console.log('KEYSTROKE_ORDER_PERF', {
      ms: performance.now() - started, count: result.matches.length, keyStrokeRejected: result.stats.keyStrokeRejected,
    })
    // Advisory only. Timing and result count do not decide pass/fail.
  }, 120_000)
})
