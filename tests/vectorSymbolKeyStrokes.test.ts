import { describe, expect, it } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import { vectorSymbolSearch, type VectorSymbolOptions } from '../src/core/vectorSymbolSearch'
import { AnnotationStore } from '../src/editor/AnnotationStore'

// Entirely synthetic, in pt. Manual templates keep the fixtures independent of
// automatic sample cleanup, so these tests exercise the skeleton gate itself.
type Line = [number, number, number, number]
const circle = (n: number, radius = 2.07): Line[] => Array.from({ length: n }, (_, i) => [
  radius * Math.cos(i * 2 * Math.PI / n), radius * Math.sin(i * 2 * Math.PI / n),
  radius * Math.cos((i + 1) * 2 * Math.PI / n), radius * Math.sin((i + 1) * 2 * Math.PI / n),
])
const bars = (shift = 0): Line[] => [1.68, 1.2, .6].map((length, i) => [-length / 2, 2.25 + i * .3 + shift, length / 2, 2.25 + i * .3 + shift])
const slots = (length: number, offset: number): Line[] => [-offset, offset].map(x => [x, -length / 2, x, length / 2])
const a: Line[] = [...circle(10), ...slots(3.9, .84), ...bars()]
const b = (n = 10, divided = false): Line[] => [...circle(n), ...(divided ? split(slots(3.4, 1.08), 2) : slots(3.4, 1.08)), ...bars(-.15)]
function split(lines: Line[], parts: number): Line[] {
  return lines.flatMap(([x0, y0, x1, y1]) => Array.from({ length: parts }, (_, i) => [
    x0 + (x1 - x0) * i / parts, y0 + (y1 - y0) * i / parts,
    x0 + (x1 - x0) * (i + 1) / parts, y0 + (y1 - y0) * (i + 1) / parts,
  ] as Line))
}
function stamp(lines: Line[], x = 0, y = 0, angle = 0): number[] {
  const c = Math.cos(angle), s = Math.sin(angle)
  return lines.flatMap(([ax, ay, bx, by]) => [x + c * ax - s * ay, y + s * ax + c * ay, x + c * bx - s * by, y + s * bx + c * by])
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

const falseSymbols: Array<[string, Line[]]> = [
  ['horizontal hatching', [
    ...Array.from({ length: 24 }, (_, i) => [-1.7, -3.45 + i * .3, 1.7, -3.45 + i * .3] as Line),
    // Anchor-sized marks beside the hatch ensure a placement is actually tried.
    ...bars(2),
  ]],
  ['circle without slots', [...circle(10), ...bars(-.15)]],
  ['rectangle with short text-like lines', [
    [-2, -4, 2, -4], [2, -4, 2, 4], [2, 4, -2, 4], [-2, 4, -2, -4],
    ...Array.from({ length: 15 }, (_, i) => [-1.4 + i % 3, -3 + Math.floor(i / 3) * 1.2, -.8 + i % 3, -3 + Math.floor(i / 3) * 1.2] as Line),
  ]],
  ['circle with one diameter', [...circle(10), [-2.07, 0, 2.07, 0]]],
]

describe('key stroke gate at tolerance 0.3pt', () => {
  it('finds changed slot length/spacing, rotation, split slots and a differently divided ring', () => {
    const poses = [0, Math.PI / 2, 0, Math.PI / 2]
    const variants = [b(), b(), b(10, true), b(16, true)]
    const result = search(a, variants.flatMap((lines, i) => stamp(lines, 20 + i * 20, 20, poses[i])))
    expect(result.stats.keyStrokes).toBeGreaterThanOrEqual(2)
    expect(result.matches).toHaveLength(4)
    const r = bounds(a), cy = (r[1] + r[3]) / 2 - .15
    for (const [i, angle] of poses.entries()) {
      const expected: Point = [20 + i * 20 - Math.sin(angle) * cy, 20 + Math.cos(angle) * cy]
      expect(result.matches.some(m => Math.hypot(m.center[0] - expected[0], m.center[1] - expected[1]) < .3)).toBe(true)
    }
  })

  for (const exhaustiveWhenEmpty of [false, true]) {
    it(`rejects all four distractors together (exhaustiveWhenEmpty=${exhaustiveWhenEmpty})`, () => {
      const target = falseSymbols.flatMap(([, lines], i) => stamp(lines, 20 + i * 20, 20))
      const result = search(a, target, { exhaustiveWhenEmpty })
      expect(result.matches).toHaveLength(0)
      expect(result.rejected).toHaveLength(0)
      expect(result.stats.keyStrokes).toBeGreaterThanOrEqual(2)
      expect(result.stats.keyStrokeRejected).toBeGreaterThan(0)
      expect(result.stats.exhaustiveRan).toBe(exhaustiveWhenEmpty)
    })
    for (const [name, lines] of falseSymbols) it(`rejects ${name} alone (exhaustiveWhenEmpty=${exhaustiveWhenEmpty})`, () => {
      const result = search(a, stamp(lines, 20, 20), { exhaustiveWhenEmpty })
      expect(result.matches).toHaveLength(0)
      // The gate runs after coverage, so a shape may already fail coverage (0 gate rejections).
      expect(result.matches.length + result.rejected.length).toBe(0)
    })
  }

  it('leaves circle-only templates ungated across 24, 40 and 12 sides', () => {
    const result = search(circle(24), [...stamp(circle(40), 20, 20), ...stamp(circle(12), 40, 20)])
    expect(result.stats.keyStrokes).toBe(0)
    expect(result.stats.keyStrokeRejected).toBe(0)
    expect(result.matches).toHaveLength(2)
    for (const x of [20, 40]) expect(result.matches.some(m => Math.hypot(m.center[0] - x, m.center[1] - 20) < .3)).toBe(true)
  })

  const square: Line[] = [[-2, -2, 2, -2], [2, -2, 2, 2], [2, 2, -2, 2], [-2, 2, -2, -2]]
  const crossed: Line[] = [...square, [-2, -2, 2, 2], [2, -2, -2, 2]]
  for (const sample of [square, crossed]) it(`keeps 2/7-way subdivisions of ${sample === square ? 'square' : 'square plus cross'}`, () => {
    const result = search(sample, [...stamp(split(sample, 2), 20, 20), ...stamp(split(sample, 7), 40, 20)])
    expect(result.matches).toHaveLength(2)
    if (sample === square) expect(result.stats.keyStrokes).toBeGreaterThan(0)
    for (const x of [20, 40]) expect(result.matches.some(m => Math.hypot(m.center[0] - x, m.center[1] - 20) < .01)).toBe(true)
  })

  it('marks extended-wire recovery as exhaustive and forces stored confidence to check', async () => {
    const sample: Line[] = [[-2, -2, 2, -2], [2, -2, 2, 2], [2, 2, -2, 2], [-2, 2, -2, -2], [-1, -1, -.3, -.6]]
    const wired: Line[] = [[-60, -2, 60, -2], [2, -60, 2, 60], [60, 2, -60, 2], ...sample.slice(3)]
    const target = stamp(wired, 20, 20)
    expect(search(sample, target, { threshold: .99, exhaustiveWhenEmpty: false, scaleRange: 0 }).matches).toHaveLength(0)
    const result = search(sample, target, { threshold: .99, exhaustiveWhenEmpty: true, scaleRange: 0 })
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ source: 'exhaustive', center: [20, 20] }); expect(result.matches[0].score).toBeCloseTo(1, 9)
    expect(result.stats.exhaustiveFound).toBe(1)
    const fixture: CountFixture = { id: 'key-stroke', code: 'KS', name: 'Synthetic', category: '電気', order: 0,
      style: { shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: .8, showCode: true } }
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => [fixture], async () => {})
    store.selectFixture(fixture.id)
    store.beginSymbolCandidates(fixture.id, bounds(sample))
    store.appendSymbolCandidates(result.matches.map(m => ({ ...m, pageIndex: 0, confidence: 'high' as const })))
    expect(store.symbolCandidates).toHaveLength(1)
    expect(store.symbolCandidates![0]).toMatchObject({ source: 'exhaustive', confidence: 'check' })
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
      const symbol = i % 2 ? [...circle(10), ...split(slots(3.9, .84), 2), ...bars()] : a
      target.push(...stamp(symbol, 20 + i % 40 * 10, 20 + Math.floor(i / 40) * 10))
    }
    const started = performance.now(), result = search(a, target)
    console.log('KEYSTROKE_PERF', { ms: performance.now() - started, count: result.matches.length,
      keyStrokes: result.stats.keyStrokes, keyStrokeRejected: result.stats.keyStrokeRejected })
    // Advisory only: neither elapsed time nor count is a pass/fail condition.
  }, 120_000)
})
