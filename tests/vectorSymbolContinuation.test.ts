import { describe, expect, it } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import { vectorSymbolSearch, type VectorSymbolOptions } from '../src/core/vectorSymbolSearch'

// Synthetic pt geometry. Manual samples isolate the gate from sample cleanup.
type Line = [number, number, number, number]
const circle = (radius: number, x = 0, y = 0): Line[] => Array.from({ length: 16 }, (_, i) => [
  x + radius * Math.cos(i * Math.PI / 8), y + radius * Math.sin(i * Math.PI / 8),
  x + radius * Math.cos((i + 1) * Math.PI / 8), y + radius * Math.sin((i + 1) * Math.PI / 8),
])
const square = (side: number): Line[] => [[0, 0, side, 0], [side, 0, side, side], [side, side, 0, side], [0, side, 0, 0]]
const boxedCircle: Line[] = [...square(4.3), ...circle(1.8, 2.15, 2.15)]
const boxedH: Line[] = [...square(5), [1.5, 1, 1.5, 4], [3.5, 1, 3.5, 4], [1.5, 2.5, 3.5, 2.5]]

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
function expectCenters(result: ReturnType<typeof search>, centers: Point[]) {
  expect(result.matches).toHaveLength(centers.length)
  for (const [x, y] of centers) expect(result.matches.some(m => Math.hypot(m.center[0] - x, m.center[1] - y) < .3)).toBe(true)
}

describe('straight key strokes at corners', () => {
  it('bounds corner placements on a 40 by 40 array of half-point squares', () => {
    const small = square(.5), target: number[] = []
    for (let row = 0; row < 40; row++) for (let col = 0; col < 40; col++) {
      // Half-point sides separated by half-point gaps.
      target.push(...stamp(small, 20 + col, 20 + row))
    }
    const result = search(boxedCircle, target, { rotations: true, scaleRange: 0 })
    expect(result.stats.junctionPlacements).toBeLessThanOrEqual(2_000)
    expect(result.stats.junctionLimited).toBe(false)
    expect(result.matches).toHaveLength(0)
  })

  it('requires a long enough partner at each end before counting a corner placement', () => {
    const target: Line[] = [[0, 0, 30, 0]]
    for (let i = 0; i < 6; i++) {
      const x = 2 + i * 4.3
      target.push([x, 0, x, .5])
    }
    const result = search(boxedCircle, stamp(target, 20, 20), { rotations: false, scaleRange: 0 })
    expect(result.stats.junctionPlacements).toBe(0)
    expect(result.matches).toHaveLength(0)
  })

  const root = Math.sqrt(12)
  const triangle: Line[] = [[0, -4, -root, 2], [-root, 2, root, 2], [root, 2, 0, -4]]
  // Two mirrored perturbations exercise the left and right sloping edges.
  // Each changed coordinate moves by 0.12pt. The base remains horizontal.
  const changedTriangle = (sign: number): Line[] => [
    [sign * .12, -3.88, -root - sign * .12, 2],
    [-root - sign * .12, 2, root - sign * .12, 2],
    [root - sign * .12, 2, sign * .12, -3.88],
  ]
  for (const rotations of [false, true]) it(`finds small slope differences without continuation (rotations=${rotations})`, () => {
    const sample = [...circle(4), ...triangle]
    for (const sign of [-1, 1]) {
      const changed = changedTriangle(sign), edge = sign === 1 ? 0 : 2
      const angle = (line: Line) => Math.atan2(line[3] - line[1], line[2] - line[0])
      const difference = Math.abs(angle(changed[edge]) - angle(triangle[edge])) * 180 / Math.PI
      expect(difference).toBeGreaterThan(2)
      expect(difference).toBeLessThan(3)
    }
    const target = [-1, 1].flatMap((sign, i) => stamp([...circle(4), ...changedTriangle(sign)], 20 + i * 20, 20))
    const result = search(sample, target, { rotations, threshold: .99, scaleRange: 0 })
    expect(result.stats.keyStrokes).toBeGreaterThan(0)
    expectCenters(result, [[20, 20], [40, 20]])
    expect(result.matches.every(m => m.continued === undefined)).toBe(true)
  })

  it('finds all four shared boxes from each selected horizontal box', () => {
    const row: Line[] = [[0, 0, 17.2, 0], [0, 4.3, 17.2, 4.3]]
    for (let i = 0; i <= 4; i++) row.push([i * 4.3, 0, i * 4.3, 4.3])
    for (let i = 0; i < 4; i++) row.push(...circle(1.8, i * 4.3 + 2.15, 2.15))
    const target = stamp(row, 20, 20)
    for (let selected = 0; selected < 4; selected++) {
      const sample = boxedCircle.map(([ax, ay, bx, by]): Line => [20 + selected * 4.3 + ax, 20 + ay, 20 + selected * 4.3 + bx, 20 + by])
      const result = search(sample, target, { rotations: false, scaleRange: 0, threshold: .99 })
      expectCenters(result, Array.from({ length: 4 }, (_, i): Point => [22.15 + i * 4.3, 22.15]))
      expect(result.matches.every(m => m.continued === true)).toBe(true)
    }
  })

  it('finds three vertically shared H boxes from the middle box', () => {
    const column: Line[] = [[0, 0, 0, 15], [5, 0, 5, 15]]
    for (let i = 0; i <= 3; i++) column.push([0, i * 5, 5, i * 5])
    for (let i = 0; i < 3; i++) for (const [ax, ay, bx, by] of boxedH.slice(4)) column.push([ax, ay + i * 5, bx, by + i * 5])
    const sample = boxedH.map(([ax, ay, bx, by]): Line => [20 + ax, 25 + ay, 20 + bx, 25 + by])
    const result = search(sample, stamp(column, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 })
    expectCenters(result, [[22.5, 22.5], [22.5, 27.5], [22.5, 32.5]])
    expect(result.matches.every(m => m.continued === true)).toBe(true)
  })

  it('finds one square beside a 10pt continuation line without exhaustive search', () => {
    const wired: Line[] = [...boxedCircle, [4.3, 0, 4.3, -10]]
    const result = search(boxedCircle, stamp(wired, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 })
    expectCenters(result, [[22.15, 22.15]])
    expect(result.matches[0].source).not.toBe('exhaustive')
  })

  it('keeps an isolated box and circle uncontinued with and without a corner wire when an untrimmed alignment remains', () => {
    const options = { rotations: false, threshold: .99, scaleRange: 0 }
    const unwired = search(boxedCircle, stamp(boxedCircle, 20, 20), options)
    const wired: Line[] = [...boxedCircle, [4.3, 0, 4.3, -10], [4.5, 0, 4.5, 4.3]]
    const withWire = search(boxedCircle, stamp(wired, 20, 20), options)
    for (const result of [unwired, withWire]) {
      expectCenters(result, [[22.15, 22.15]])
      expect(result.matches[0].continued).toBeUndefined()
    }
  })

  it('prefers an untrimmed key component even when a continued component is present', () => {
    const target: Line[] = [...boxedCircle, [4.3, 0, 4.3, -10], [4.5, 0, 4.5, 4.3]]
    const result = search(boxedCircle, stamp(target, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 })
    expectCenters(result, [[22.15, 22.15]])
    expect(result.matches[0].continued).toBeUndefined()
  })

  it('uses corners on longer strokes when no length-matched anchor exists', () => {
    // Both orientations are longer than every box edge. All three selected
    // anchors therefore require a corner placement, including the anchor key.
    const grid: Line[] = []
    for (let i = 0; i <= 2; i++) {
      grid.push([0, i * 4.3, 8.6, i * 4.3], [i * 4.3, 0, i * 4.3, 8.6])
    }
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) grid.push(...circle(1.8, col * 4.3 + 2.15, row * 4.3 + 2.15))
    const result = search(boxedCircle, stamp(grid, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 })
    expect(result.stats.anchorsTried).toBe(0)
    expect(result.stats.junctionPlacements).toBeGreaterThan(0)
    expect(result.stats.junctionLimited).toBe(false)
    expectCenters(result, [[22.15, 22.15], [26.45, 22.15], [22.15, 26.45], [26.45, 26.45]])
    expect(result.matches.every(m => m.source === 'secondary' && m.continued === true && m.scale === undefined)).toBe(true)
  })

  it('finds all twelve boxes sharing four columns and three rows', () => {
    const grid: Line[] = []
    for (let row = 0; row <= 3; row++) grid.push([0, row * 4.3, 17.2, row * 4.3])
    for (let col = 0; col <= 4; col++) grid.push([col * 4.3, 0, col * 4.3, 12.9])
    const centers: Point[] = []
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      grid.push(...circle(1.8, col * 4.3 + 2.15, row * 4.3 + 2.15))
      centers.push([20 + col * 4.3 + 2.15, 20 + row * 4.3 + 2.15])
    }
    const result = search(boxedCircle, stamp(grid, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 })
    expectCenters(result, centers)
    expect(result.stats.junctionPlacements).toBeGreaterThan(0)
    expect(result.stats.junctionLimited).toBe(false)
  })

  it('prunes wall intersections before evaluating corner placements', () => {
    const walls: Line[] = [[0, 0, 30, 0]]
    for (let i = 0; i < 40; i++) walls.push([.7 * (i + 1), -5, .7 * (i + 1), 5])
    const result = search(boxedCircle, stamp(walls, 20, 20), { rotations: false, scaleRange: 0 })
    expect(result.stats.junctionPlacements).toBeLessThanOrEqual(1_000)
    expect(result.stats.junctionLimited).toBe(false)
    expect(result.matches).toHaveLength(0)
    expect(result.rejected).toHaveLength(0)
  })

  it('requires a matching partner direction at both corners', () => {
    const wrongDirections: Line[] = [[0, 0, 30, 0]]
    for (let i = 0; i < 6; i++) {
      const x = 2 + i * 4.3
      wrongDirections.push([x - 2.5, -Math.sqrt(18.75), x + 2.5, Math.sqrt(18.75)])
    }
    const missingOtherCorner: Line[] = [[0, 0, 30, 0], [15, -5, 15, 5]]
    const bareEndpoints: Line[] = [[0, 0, 30, 0], [0, 10, 30, 10]]
    for (const target of [wrongDirections, missingOtherCorner, bareEndpoints]) {
      const result = search(boxedCircle, stamp(target, 20, 20), { rotations: false, scaleRange: 0 })
      expect(result.stats.junctionPlacements).toBe(0)
      expect(result.matches).toHaveLength(0)
    }
  })

  for (const exhaustiveWhenEmpty of [false, true]) it(`rejects missing skeletons and parallel walls (exhaustive=${exhaustiveWhenEmpty})`, () => {
    const distractors: Line[][] = [
      Array.from({ length: 24 }, (_, i): Line => [0, -.3 + i * .22, 4.3, -.3 + i * .22]),
      [...circle(1.8, 2.15, 2.15)],
      [...square(4.3), ...Array.from({ length: 12 }, (_, i): Line => [.6 + i % 3, .5 + Math.floor(i / 3) * .9, 1 + i % 3, .5 + Math.floor(i / 3) * .9])],
      [[-40, 0, 60, 0], [-40, 4.3, 60, 4.3]],
    ]
    for (const lines of distractors) {
      const result = search(boxedCircle, stamp(lines, 20, 20), { exhaustiveWhenEmpty, scaleRange: 0 })
      expect(result.matches).toHaveLength(0)
      expect(result.rejected).toHaveLength(0)
    }
    // Also retain the slot-skeleton distractors used by the key-stroke tests.
    const slotted: Line[] = [...circle(2.07), [-.84, -1.95, -.84, 1.95], [.84, -1.95, .84, 1.95],
      [-.84, 2.25, .84, 2.25], [-.6, 2.55, .6, 2.55], [-.3, 2.85, .3, 2.85]]
    const falseSlots: Line[][] = [
      [...circle(2.07), [-2.07, 0, 2.07, 0]],
      [...square(4.3), ...Array.from({ length: 15 }, (_, i): Line => [.5 + i % 3, .5 + Math.floor(i / 3) * .7, .9 + i % 3, .5 + Math.floor(i / 3) * .7])],
    ]
    for (const lines of falseSlots) expect(search(slotted, stamp(lines, 20, 20), { exhaustiveWhenEmpty }).matches).toHaveLength(0)
  })

  it('keeps detached or shallow-angle endpoints subject to the strict boundary', () => {
    const open: Line[] = [[0, 0, 4, 0], [0, 2, 4, 2], [1, 1, 2, 1]]
    const extended: Line[] = [[-8, 0, 12, 0], [-8, 2, 12, 2], open[2]]
    expect(search(open, stamp(extended, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 }).matches).toHaveLength(0)
    const shallow: Line[] = [...open, [4, 0, 5, .2], [4, 2, 5, 2.2]]
    const target: Line[] = [...extended, ...shallow.slice(3)]
    expect(search(shallow, stamp(target, 20, 20), { rotations: false, threshold: .99, scaleRange: 0 }).matches).toHaveLength(0)
  })

  it('retains ordinary untrimmed matches without continued', () => {
    const result = search(boxedCircle, stamp(boxedCircle, 20, 20), { rotations: false, threshold: .99 })
    expectCenters(result, [[22.15, 22.15]])
    expect(result.matches[0].continued).toBeUndefined()
    expect(result.stats.junctionPlacements).toBe(0)
  })

  it('caps corner positions at 64 per longer stroke', () => {
    const target: Line[] = [[0, 0, 34.4, 0]]
    // Partner edges must extend at least 0.75x the template side, so the crossing lines are full-height.
    for (let i = 1; i <= 100; i++) target.push([i * .32, 0, i * .32, 4.3])
    const result = search(boxedCircle, stamp(target, 20, 20), { rotations: false, scaleRange: 0 })
    // Only the two horizontal anchors can use the long line. Each has two
    // corner ends and two directions, before the other-end range check.
    expect(result.stats.junctionPlacements).toBeGreaterThan(0)
    expect(result.stats.junctionPlacements).toBeLessThanOrEqual(2 * 64 * 2 * 2)
    expect(result.stats.junctionLimited).toBe(false)
    expect(result.matches).toHaveLength(0)
  })

  it('stops corner evaluations at 200,000 and reports the limit', () => {
    const target: Line[] = Array.from({ length: 30_000 }, (_, i): Line[] => {
      const y = i * 10
      return [[0, y, 8.6, y], [0, y, 0, y + 4.3], [4.3, y, 4.3, y + 4.3], [8.6, y, 8.6, y + 4.3]]
    }).flat()
    const result = search(boxedCircle, stamp(target, 20, 20), {
      rotations: false, scaleRange: 0, region: [1_000_000, 1_000_000, 1_000_010, 1_000_010],
    })
    expect(result.stats.junctionPlacements).toBe(200_000)
    expect(result.stats.junctionLimited).toBe(true)
    expect(result.stats.stopped).toBe(false)
    expect(result.matches).toHaveLength(0)
  }, 120_000)

  it('records the existing 100,000-segment / 200-symbol benchmark and a supplied baseline ratio', () => {
    const symbol: Line[] = [...square(10), [0, 0, 10, 10], [10, 0, 0, 10]]
    let state = 42
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000)
    const target: number[] = []
    for (let i = 0; i < 100_000; i++) {
      const x = random() * 5000, y = 500 + random() * 5000, angle = random() * Math.PI * 2, length = 2 + random() * 28
      target.push(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    }
    for (let i = 0; i < 200; i++) target.push(...stamp(symbol, 20 + i % 40 * 30, 20 + Math.floor(i / 40) * 30))
    const result = vectorSymbolSearch(new Float32Array(target), [20, 20, 30, 30])
    expect(result.matches).toHaveLength(200)
    expect(result.stats.junctionPlacements).toBeLessThanOrEqual(200_000)
    // The existing benchmark uses advisory timing. A baseline from that same
    // pre-change fixture and machine enables the requested 1.5x assertion.
    const baseline = process.env.CORNER_BASELINE_MS
    const baselineMs = baseline === undefined ? undefined : Number(baseline)
    console.log('VECTOR_CONTINUATION_PERF', { unrelatedSegments: 100_000, symbols: 200, matches: result.matches.length,
      ms: result.stats.ms, baselineMs, ratio: baselineMs ? result.stats.ms / baselineMs : undefined, underOneSecond: result.stats.ms < 1000 })
    if (baselineMs !== undefined) {
      expect(Number.isFinite(baselineMs) && baselineMs > 0).toBe(true)
      expect(result.stats.ms).toBeLessThanOrEqual(baselineMs * 1.5)
    }
  }, 120_000)
})
