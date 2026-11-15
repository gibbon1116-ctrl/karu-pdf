import { describe, expect, it } from 'vitest'
import mupdf from 'mupdf'
import type { Point, Rect } from '../src/core/annotations'
import type { VectorPaint } from '../src/core/vectorPaint'
import { detectTemplateHatches } from '../src/core/vectorStrokes'
import { createPaintMatcher } from '../src/core/vectorAppearance'
import { prepareVectorTemplate, scoreVectorPlacements, vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import type { VectorSymbolOptions } from '../src/core/vectorSymbolSearch'
import { extractVectorPage } from '../src/worker/vectorExtract'
import { recognitionFixture } from './symbolRecognitionFixtures'

type Polygon = Array<[number, number]>
const centers: Point[] = Array.from({ length: 8 }, (_, i) => [20 + i * 31.37, 20 + i * 23.13])
const rect = (center: Point, radius: number): Rect => [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius]
const circle = ([cx, cy]: Point, radius: number): Polygon => Array.from({ length: 20 }, (_, i) =>
  [cx + radius * Math.cos(i * Math.PI / 10), cy + radius * Math.sin(i * Math.PI / 10)])
const outline = (polygon: Polygon) => polygon.flatMap((a, i) => [...a, ...polygon[(i + 1) % polygon.length]])

function clipPolygon(polygon: Polygon, nx: number, ny: number, offset: number): Polygon {
  const result: Polygon = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const da = nx * a[0] + ny * a[1] - offset, db = nx * b[0] + ny * b[1] - offset
    if (da >= -1e-9) result.push(a)
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db)
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
  }
  return result
}

/** Intersect a global infinite line n.p=offset with a CCW convex polygon. */
function chord(polygon: Polygon, angle: number, offset: number): number[] {
  const ux = Math.cos(angle), uy = Math.sin(angle), ax = -uy * offset, ay = ux * offset
  let lo = -Infinity, hi = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], nx = a[1] - b[1], ny = b[0] - a[0]
    const d = nx * (ax - a[0]) + ny * (ay - a[1]), delta = nx * ux + ny * uy
    if (Math.abs(delta) < 1e-10) { if (d < -1e-8) return [] }
    else if (delta > 0) lo = Math.max(lo, -d / delta)
    else hi = Math.min(hi, -d / delta)
  }
  return hi - lo > 1e-7 ? [ax + ux * lo, ay + uy * lo, ax + ux * hi, ay + uy * hi] : []
}

function hatch(polygon: Polygon, angle: number, spacing: number): number[] {
  const offsets = polygon.map(([x, y]) => -Math.sin(angle) * x + Math.cos(angle) * y)
  const lines: number[] = []
  // The reference is always global (0,0), never the symbol's center.
  for (let k = Math.ceil(Math.min(...offsets) / spacing); k <= Math.floor(Math.max(...offsets) / spacing); k++) {
    lines.push(...chord(polygon, angle, k * spacing))
  }
  return lines
}

function hourglass(center: Point, spacing?: number): number[] {
  const polygon = circle(center, 6), [cx, cy] = center
  const result = outline(polygon)
  for (const angle of [Math.PI / 4, -Math.PI / 4]) result.push(...chord(polygon, angle, -Math.sin(angle) * cx + Math.cos(angle) * cy))
  if (spacing !== undefined) for (const sign of [1, -1]) {
    const triangle = clipPolygon(clipPolygon(polygon, -sign, sign, sign * (cy - cx)), sign, sign, sign * (cy + cx))
    result.push(...hatch(triangle, 0, spacing))
  }
  return result
}
function smallHourglass(center: Point, spacing?: number): number[] {
  const polygon = circle(center, 4), [cx, cy] = center
  const result = outline(polygon)
  for (const angle of [Math.PI / 4, -Math.PI / 4]) result.push(...chord(polygon, angle, -Math.sin(angle) * cx + Math.cos(angle) * cy))
  if (spacing !== undefined) for (const sign of [1, -1]) {
    const triangle = clipPolygon(clipPolygon(polygon, -sign, sign, sign * (cy - cx)), sign, sign, sign * (cy + cx))
    result.push(...hatch(triangle, 0, spacing))
  }
  return result
}
const diagonal = (center: Point, spacing = 1, angle = Math.PI / 4) => {
  const polygon = circle(center, 4)
  return [...outline(polygon), ...hatch(polygon, angle, spacing)]
}
function paint(lines: number[]): VectorPaint {
  const paths: number[] = []
  for (let i = 0; i < lines.length; i += 4) paths.push(i / 2, 2, 0, .15, 0, 1,
    Math.min(lines[i], lines[i + 2]), Math.min(lines[i + 1], lines[i + 3]), Math.max(lines[i], lines[i + 2]), Math.max(lines[i + 1], lines[i + 3]))
  return { points: new Float32Array(lines), moves: new Uint8Array(Array.from({ length: lines.length / 2 }, (_, i) => i % 2 ? 0 : 1)),
    paths: new Float32Array(paths), truncated: false, uncertain: false }
}
const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .5

// Keep the prepared all-lines template identical, but fail hatch self-check with
// three copies of its page lines. With no paint, this isolates the legacy pass.
function legacyOnly(lines: Float32Array, bounds: Rect, options: Partial<VectorSymbolOptions>) {
  const template = prepareVectorTemplate(lines, new Float32Array(lines.length / 4), bounds)
  const page = new Float32Array([...template.segments, ...template.segments, ...template.segments])
  const result = vectorSymbolSearch(lines, bounds, options, page, new Float32Array(page.length / 4), undefined, undefined, template)
  expect(result.stats.hatchGroups).toBe(0)
  return result
}
function expectLegacyPreserved(result: ReturnType<typeof vectorSymbolSearch>, legacy: ReturnType<typeof vectorSymbolSearch>) {
  // Compare full match objects: pose, score, extra, continued and ordering all survive.
  expect(result.matches.slice(0, legacy.matches.length)).toEqual(legacy.matches)
  expect(result.matches.slice(legacy.matches.length).every(match => match.hatchRescued === true)).toBe(true)
  expect(result.stats.hatchRescued).toBe(result.matches.length - legacy.matches.length)
}

describe('phase-independent CAD hatches', () => {
  it('finds ten phase-shifted five-row circles among 300 bare circles with at most 1,000 rescue placements', () => {
    const positions: Point[] = Array.from({ length: 10 }, (_, i) => [20 + i * 20, 20])
    const barePositions: Point[] = Array.from({ length: 300 }, (_, i) => [20 + i % 30 * 20, 60 + Math.floor(i / 30) * 20])
    const polygon = ([cx, cy]: Point, sides: number): Polygon => Array.from({ length: sides }, (_, i) =>
      [cx + 3 * Math.cos(i * 2 * Math.PI / sides), cy + 3 * Math.sin(i * 2 * Math.PI / sides)])
    const symbol = (center: Point, phase: number, sides: number) => {
      const boundary = polygon(center, sides)
      return [...outline(boundary), ...Array.from({ length: 5 }, (_, i) =>
        chord(boundary, Math.PI / 2, -center[0] + (i - 2) * .9 + phase)).flat()]
    }
    const sample = new Float32Array(symbol(positions[0], -.4, 20)), widths = new Float32Array(sample.length / 4).fill(.5)
    // Preserve the ring-path regression's differing contour subdivisions and
    // interleave many same-radius distractors without changing the hatch rows.
    const target = new Float32Array(positions.flatMap((center, i) => [
      ...symbol(center, -.4 + i * .09, 64),
      ...barePositions.slice(i * 30, (i + 1) * 30).flatMap(center => outline(polygon(center, 64))),
    ]))
    const result = vectorSymbolSearch(target, rect(positions[0], 3), { threshold: .99, rotations: true, scaleRange: 0 },
      sample, widths, new Float32Array(target.length / 4).fill(.5), undefined, { segments: sample, widths })
    expect(result.stats.hatchGroups).toBe(1)
    expect(result.matches).toHaveLength(10)
    for (const center of positions) expect(result.matches.some(match => near(match.center, center))).toBe(true)
    expect(result.matches.every(match => !barePositions.some(center => near(match.center, center)))).toBe(true)
    expect(result.stats.hatchRescued).toBeGreaterThan(0)
    expect(result.stats.hatchRejected).toBeGreaterThan(0)
    expect(result.stats.hatchRescuePlacements).toBeGreaterThan(0)
    expect(result.stats.hatchRescuePlacements).toBeLessThanOrEqual(1_000)
    expect(result.stats.hatchRescueLimited).toBe(false)
  })

  it('finds ten phase-shifted five-row circles with at most 5,000 rescue placements', () => {
    const positions: Point[] = Array.from({ length: 10 }, (_, i) => [20 + i * 20, 20])
    const symbol = (center: Point, phase: number, sides = 20) => {
      const polygon: Polygon = Array.from({ length: sides }, (_, i) => [
        center[0] + 3 * Math.cos(i * 2 * Math.PI / sides), center[1] + 3 * Math.sin(i * 2 * Math.PI / sides),
      ])
      return [...outline(polygon), ...Array.from({ length: 5 }, (_, i) =>
        chord(polygon, Math.PI / 2, -center[0] + (i - 2) * .9 + phase)).flat()]
    }
    const sample = new Float32Array(symbol(positions[0], -.4)), widths = new Float32Array(sample.length / 4).fill(.5)
    // Different circle subdivision prevents length-matched skeleton anchors
    // from bypassing the ring path that this regression is intended to cover.
    const target = new Float32Array(positions.flatMap((center, i) => symbol(center, -.4 + i * .09, 64)))
    const result = vectorSymbolSearch(target, rect(positions[0], 3), { threshold: .99, rotations: true, scaleRange: 0 },
      sample, widths, new Float32Array(target.length / 4).fill(.5), undefined, { segments: sample, widths })
    expect(result.stats.hatchGroups).toBe(1)
    expect(result.matches).toHaveLength(10)
    for (const center of positions) expect(result.matches.some(match => near(match.center, center))).toBe(true)
    expect(result.stats.hatchRescued).toBeGreaterThan(0)
    expect(result.stats.ringAnchor).toBe(true)
    expect(result.stats.hatchRescuePlacements).toBeGreaterThan(0)
    expect(result.stats.hatchRescuePlacements).toBeLessThanOrEqual(5_000)
    expect(result.stats.hatchRescueLimited).toBe(false)
  })

  const fiveCenters = centers.slice(0, 5)
  const denseCircle = (center: Point) => {
    const polygon = circle(center, 2.7), lines = outline(polygon)
    for (let i = 0; i < 30; i++) lines.push(...chord(polygon, 0, center[1] + (i - 14.5) * .09))
    return lines
  }
  const doubleRoundedSquare = ([cx, cy]: Point) => {
    const rounded = (side: number, radius: number): Polygon => {
      const corner = side / 2 - radius
      return [[corner, corner], [-corner, corner], [-corner, -corner], [corner, -corner]].flatMap(([x, y], cornerIndex) =>
        Array.from({ length: 5 }, (_, step): Point => {
          const angle = cornerIndex * Math.PI / 2 + step * Math.PI / 8
          return [cx + x + radius * Math.cos(angle), cy + y + radius * Math.sin(angle)]
        }))
    }
    return [...outline(rounded(9, 1)), ...outline(rounded(8.4, .7))]
  }
  const notchedCircle = ([cx, cy]: Point) => {
    const polygon: Polygon = Array.from({ length: 48 }, (_, i) =>
      [cx + 5 * Math.cos(i * Math.PI / 24), cy + 5 * Math.sin(i * Math.PI / 24)])
    const lines = outline(polygon)
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, ux = Math.cos(angle), uy = Math.sin(angle)
      lines.push(cx + 5 * ux, cy + 5 * uy, cx + 4.5 * ux, cy + 4.5 * uy)
    }
    return lines
  }
  for (const [name, radius, shape] of [
    ['a circle filled by thirty rows at 0.09pt', 2.7, denseCircle],
    ['a rounded double square separated by 0.3pt', 4.5, doubleRoundedSquare],
    ['a radius-5 circle with twenty-four 0.5pt notches', 5, notchedCircle],
  ] as const) it(`keeps ${name} in the skeleton and finds all five copies`, () => {
    const sample = new Float32Array(shape(fiveCenters[0]))
    expect(detectTemplateHatches(sample, .3)).toEqual([])
    const lines = new Float32Array(fiveCenters.flatMap(center => shape(center)))
    const result = vectorSymbolSearch(lines, rect(fiveCenters[0], radius), { rotations: false })
    expect(result.stats.hatchGroups).toBe(0)
    expect(result.stats.hatchSelfDropped).toBe(0)
    expect(result.matches).toHaveLength(5)
    for (const center of fiveCenters) expect(result.matches.some(match => near(match.center, center))).toBe(true)
  })

  for (const extraWidth of [.5, 5]) it(`self-checks against sample-page lines filtered by width (extra width ${extraWidth})`, () => {
    const sample = new Float32Array(smallHourglass(centers[0], 1.3)), sampleWidths = new Float32Array(sample.length / 4).fill(.5)
    const page = new Float32Array([...sample, ...sample, ...sample])
    const pageWidths = new Float32Array([...sampleWidths, ...new Float32Array(sample.length / 2).fill(extraWidth)])
    const groups = detectTemplateHatches(sample, .3)
    expect(groups.length).toBeGreaterThan(0)
    const manual = { segments: sample, widths: sampleWidths }, bounds = rect(centers[0], 4)
    const result = vectorSymbolSearch(sample, bounds, { rotations: false }, page, pageWidths, sampleWidths, undefined, manual)
    const dropped = extraWidth === .5 ? groups.length : 0
    expect(result.stats.hatchSelfDropped).toBe(dropped)
    expect(result.stats.hatchGroups).toBe(groups.length - dropped)
    expect(result.matches).toHaveLength(1)
    const scored = scoreVectorPlacements(sample, bounds, [{ center: centers[0], angle: 0 }], page, pageWidths, sampleWidths, manual)
    expect(scored.hatchSelfDropped).toBe(dropped)
    expect(scored.scores[0]).toBeCloseTo(1, 5)
  })

  it('finds all eight radius-4 hourglasses and excludes four without hatches at each spacing', () => {
    const bareCenters: Point[] = Array.from({ length: 4 }, (_, i) => [320 + i * 31.37, 20 + i * 23.13])
    for (const spacing of [.7, .9, 1.1, 1.3]) {
      const lines = new Float32Array([...centers.flatMap(center => smallHourglass(center, spacing)),
        ...bareCenters.flatMap(center => smallHourglass(center))])
      const result = vectorSymbolSearch(lines, rect(centers[0], 4), { threshold: .85, rotations: true })
      expectLegacyPreserved(result, legacyOnly(lines, rect(centers[0], 4), { threshold: .85, rotations: true }))
      expect(result.stats.hatchGroups).toBeGreaterThan(0)
      expect(result.matches).toHaveLength(8)
      for (const center of centers) expect(result.matches.some(match => near(match.center, center))).toBe(true)
      expect(result.matches.every(match => !bareCenters.some(center => near(match.center, center)))).toBe(true)
    }
  })

  for (const spacing of [.7, .9, 1.1, 1.3]) for (const rotations of [false, true]) {
    it(`finds all eight hourglasses at spacing ${spacing}, rotations=${rotations}`, () => {
      const bareCenters: Point[] = Array.from({ length: 4 }, (_, i) => [320 + i * 31.37, 20 + i * 23.13])
      const lines = [...centers.flatMap(center => hourglass(center, spacing)), ...bareCenters.flatMap(center => hourglass(center))]
      const before = new Float32Array(lines)
      const result = vectorSymbolSearch(before, rect(centers[0], 6), { threshold: .85, rotations })
      expectLegacyPreserved(result, legacyOnly(before, rect(centers[0], 6), { threshold: .85, rotations }))
      expect(result.stats.hatchGroups).toBeGreaterThan(0)
      expect(result.matches).toHaveLength(8)
      for (const center of centers) expect(result.matches.some(m => near(m.center, center))).toBe(true)
      expect(result.matches.every(m => m.score >= .85)).toBe(true)
      expect(result.matches.every(m => !bareCenters.some(c => near(m.center, c)))).toBe(true)
      expect(before).toEqual(new Float32Array(lines))
    })
  }

  it('drops hatch mismatches without publishing structural rejections', () => {
    const bareCenters: Point[] = Array.from({ length: 4 }, (_, i) => [320 + i * 31.37, 20 + i * 23.13])
    const lines = new Float32Array([...centers.flatMap(c => hourglass(c, 1.3)), ...bareCenters.flatMap(c => hourglass(c))])
    const result = vectorSymbolSearch(lines, rect(centers[0], 6), { threshold: .85 })
    expect(result.matches).toHaveLength(8)
    expect(result.stats.hatchRejected).toBeGreaterThan(0)
    expect(result.matches.every(m => !bareCenters.some(c => near(m.center, c)))).toBe(true)
    for (const center of bareCenters) {
      expect(result.rejected.some(m => near(m.center, center))).toBe(false)
    }
  })

  it('finds diagonal hatches but excludes opposite directions and double spacing', () => {
    const wrong: Point[] = [[320, 20], [360, 20]]
    const lines = new Float32Array([...centers.flatMap(c => diagonal(c)), ...diagonal(wrong[0], 1, -Math.PI / 4), ...diagonal(wrong[1], 2)])
    const result = vectorSymbolSearch(lines, rect(centers[0], 4), { threshold: .85, rotations: false })
    const legacy = legacyOnly(lines, rect(centers[0], 4), { threshold: .85, rotations: false })
    expectLegacyPreserved(result, legacy)
    // The first pass may align one symbol on a hatch row about 1pt off; it is still a candidate on that symbol (radius 4pt).
    for (const center of centers) expect(result.matches.some(m => Math.hypot(m.center[0] - center[0], m.center[1] - center[1]) < 3)).toBe(true)
    // The rescue pass never adds a wrong hatch; the first pass keeps whatever 1.15.0 found.
    expect(result.matches.filter(m => wrong.some(c => near(m.center, c))).every(m => !m.hatchRescued && legacy.matches.some(l => near(l.center, m.center)))).toBe(true)
  })

  it('rescues phase-shifted image placements and caps missing or mismatched hatches of four or more rows', () => {
    const wrong: Point[] = [[320, 20], [360, 20], [400, 20]], sample = new Float32Array(diagonal(centers[0]))
    expect(detectTemplateHatches(sample, .3).some(group => group.count >= 4)).toBe(true)
    const lines = new Float32Array([...centers.flatMap(c => diagonal(c)), ...diagonal(wrong[0], 1, -Math.PI / 4),
      ...diagonal(wrong[1], 2), ...outline(circle(wrong[2], 4))])
    const targets = [...centers, ...wrong].map(center => ({ center, angle: 0 }))
    for (const threshold of [.85, .4]) {
      const result = scoreVectorPlacements(lines, rect(centers[0], 4), targets, sample, new Float32Array(sample.length / 4), undefined, undefined, { threshold })
      for (let i = 0; i < 8; i++) expect(result.scores[i]).toBeCloseTo(1, 5)
      for (let i = 8; i < targets.length; i++) expect(result.scores[i]).toBeLessThan(threshold - .009)
    }
  })

  const threeChords = (center: Point) => {
    const polygon = circle(center, 3)
    return [...outline(polygon), ...[-.9, 0, .9].flatMap(offset => chord(polygon, Math.PI / 2, -center[0] + offset))]
  }
  it('preserves ten legacy outlet matches even when three touching chords are classified as hatch', () => {
    const positions: Point[] = Array.from({ length: 10 }, (_, i) => [20 + i * 20, 20])
    const lines = new Float32Array(positions.flatMap(threeChords)), bounds = rect(positions[0], 3)
    const result = vectorSymbolSearch(lines, bounds, { threshold: .85, rotations: false })
    expect(result.stats.hatchGroups).toBeGreaterThan(0)
    expect(result.matches).toHaveLength(10)
    for (const center of positions) expect(result.matches.some(match => near(match.center, center))).toBe(true)
    expect(result.matches.every(match => match.hatchRescued === undefined)).toBe(true)
    expectLegacyPreserved(result, legacyOnly(lines, bounds, { threshold: .85, rotations: false }))
  })

  it('does not rescue a site already rejected by the legacy paint comparison', () => {
    const positions = centers.slice(0, 3), sample = new Float32Array(threeChords(positions[0]))
    const lines = new Float32Array(positions.flatMap(threeChords))
    // Deliberately keep geometry constant and remove chords only from target paint:
    // full-line paint rejects them, while ignoring hatch cells could accept them.
    const result = vectorSymbolSearch(lines, rect(positions[0], 3), { threshold: .85, rotations: false }, sample,
      new Float32Array(sample.length / 4), undefined,
      { sample: paint(Array.from(sample)), target: paint(positions.flatMap(center => outline(circle(center, 3)))) })
    expect(result.stats.hatchGroups).toBeGreaterThan(0)
    for (const center of positions) expect(result.rejected.some(match => near(match.center, center) && match.rejectReason === 'structure')).toBe(true)
    expect(result.matches).toEqual([])
    expect(result.stats.hatchRescued).toBe(0)
  })

  it('keeps the legacy image-placement score when only a three-row group fails', () => {
    const sample = new Float32Array(threeChords(centers[0])), widths = new Float32Array(sample.length / 4)
    const groups = detectTemplateHatches(sample, .3)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    const bare = new Float32Array(outline(circle(centers[1], 3))), targets = [{ center: centers[1], angle: 0 }]
    const page = new Float32Array([...sample, ...sample, ...sample]), bounds = rect(centers[0], 3)
    const manual = { segments: sample, widths }
    const legacy = scoreVectorPlacements(bare, bounds, targets, page, new Float32Array(page.length / 4), undefined, manual, { threshold: .4 })
    expect(legacy.hatchSelfDropped).toBe(1)
    const result = scoreVectorPlacements(bare, bounds, targets, sample, widths, undefined, manual, { threshold: .4 })
    expect(result.hatchSelfDropped).toBe(0)
    expect(result.scores).toEqual(legacy.scores)
    expect(result.centers).toEqual(legacy.centers)
    expect(result.scores[0]).toBeGreaterThan(.4)
  })

  it('honors the combined result limit with legacy candidates first', () => {
    const lines = new Float32Array(centers.flatMap(center => hourglass(center, 1.3))), bounds = rect(centers[0], 6)
    for (const maxResults of [1, 3]) {
      const options = { threshold: .85, maxResults, rotations: false }
      const result = vectorSymbolSearch(lines, bounds, options)
      expect(result.matches.length).toBeLessThanOrEqual(maxResults)
      expectLegacyPreserved(result, legacyOnly(lines, bounds, options))
    }
  })

  it('does not run rescue after a stopped legacy pass', () => {
    const lines = new Float32Array(hourglass(centers[0], 1.3))
    const result = vectorSymbolSearch(lines, rect(centers[0], 6), { shouldStop: () => true })
    expect(result.stats.stopped).toBe(true)
    expect(result.stats.hatchGroups).toBeGreaterThan(0)
    expect(result.stats.hatchRejected).toBe(0)
    expect(result.stats.hatchRescued).toBe(0)
    expect(result.matches).toEqual([])
  })

  it('does not classify three floating outlet slots as a hatch', () => {
    const [cx, cy] = centers[0], lines = new Float32Array([...outline(circle(centers[0], 4)),
      ...[-1, 0, 1].flatMap(x => [cx + x, cy - 1.5, cx + x, cy + 1.5])])
    expect(detectTemplateHatches(lines, .3)).toEqual([])
    const result = vectorSymbolSearch(lines, rect(centers[0], 4))
    expect(result.stats.hatchGroups).toBe(0)
    expect(result.stats.hatchRejected).toBe(0)
    expect(result.matches).toHaveLength(1)
  })

  it('detects clipped regular rows, returns original offsets and bounds oversized input', () => {
    const lines = new Float32Array([0,0,10,0, 10,0,10,6, 10,6,0,6, 0,6,0,0,
      0,1,10,1, 0,2,10,2, 0,3,10,3, 0,4,10,4, 0,5,10,5])
    const groups = detectTemplateHatches(lines, .3)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ angle: 0, spacing: 1, count: 5, length: 50 })
    expect(groups[0].ids.every(id => id % 4 === 0)).toBe(true)
    expect(groups[0].hull).toHaveLength(4)
    expect(detectTemplateHatches(new Float32Array(4097 * 4), .3)).toEqual([])
    const irregular = new Float32Array([0,0,0,10, 10,0,10,10, 0,1,10,1, 0,2,10,2, 0,5,10,5])
    expect(detectTemplateHatches(irregular, .3)).toEqual([])
  })

  it('falls back to legacy matching when the skeleton is below 25 percent of the length', () => {
    const lines = new Float32Array([0,0,10,0, 10,0,10,6, 10,6,0,6, 0,6,0,0,
      0,.5,10,.5, 0,1,10,1, 0,1.5,10,1.5, 0,2,10,2, 0,2.5,10,2.5,
      0,3,10,3, 0,3.5,10,3.5, 0,4,10,4, 0,4.5,10,4.5, 0,5,10,5,
      0,5.5,10,5.5])
    expect(detectTemplateHatches(lines, .3)).toHaveLength(1)
    const result = vectorSymbolSearch(lines, [0,0,10,6])
    expect(result.stats.hatchGroups).toBe(0)
    expect(result.stats.hatchRejected).toBe(0)
    expect(result.matches).toHaveLength(1)
  })

  it('ignores hatch cells for lines in both directions while preserving fills', () => {
    const a = hourglass(centers[0], 1.3), b = hourglass(centers[1], 1.3), samplePaint = paint(a), targetPaint = paint(b)
    const groups = detectTemplateHatches(new Float32Array(a), .36), bounds = rect(centers[0], 6)
    expect(groups.length).toBeGreaterThan(0)
    const ignored = createPaintMatcher(samplePaint, targetPaint, bounds, .36, groups.map(g => g.hull))(centers[1], 0)
    const normal = createPaintMatcher(samplePaint, targetPaint, bounds, .36)(centers[1], 0)
    expect(ignored.known).toBe(true)
    expect(ignored.lineScore).toBeGreaterThanOrEqual(.9)
    expect(ignored.fillScore).toBe(normal.fillScore)
    const data = new Float32Array([...a, ...b]), stream = paint([...a, ...b])
    expect(vectorSymbolSearch(data, bounds, { threshold: .85 }, data, new Float32Array(data.length / 4), undefined,
      { sample: stream, target: stream }).matches).toHaveLength(2)
  })

  it('preserves the existing paint fixture expectations when ignoreLines is omitted', () => {
    const fixture = recognitionFixture(), doc = new mupdf.PDFDocument(fixture.bytes)
    try {
      for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
        const page = extractVectorPage(doc, pageIndex, undefined, true)
        for (const sample of fixture.truth.filter(t => t.pageIndex === pageIndex && t.id.endsWith('-0'))) {
          const template = prepareVectorTemplate(page.segments, page.widths, sample.rect)
          const normal = createPaintMatcher(page.paint!, page.paint!, template.bounds, template.tolerance)
          const explicit = createPaintMatcher(page.paint!, page.paint!, template.bounds, template.tolerance, undefined)
          const empty = createPaintMatcher(page.paint!, page.paint!, template.bounds, template.tolerance, [])
          for (const target of fixture.truth.filter(t => t.pageIndex === pageIndex)) {
            const result = normal(target.center, 0)
            expect(explicit(target.center, 0)).toEqual(result)
            expect(empty(target.center, 0)).toEqual(result)
            if (sample.id.startsWith('text-overlap') || target.id.startsWith('text-overlap')) expect(result.known).toBe(false)
            else {
              expect(result.known).toBe(true)
              if (sample.group === target.group) expect(result.score).toBeGreaterThanOrEqual(.9)
              else expect(result.score).toBeLessThan(.9)
            }
          }
        }
      }
    } finally { doc.destroy() }
  })

  it('measures the existing 100k-line/200-symbol fixture against a supplied pre-change baseline', () => {
    const data: number[] = [], square = [0,0,10,0, 10,0,10,10, 10,10,0,10, 0,10,0,0, 0,0,10,10, 10,0,0,10]
    let state = 42
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000)
    for (let i = 0; i < 100_000; i++) {
      const x = random() * 5000, y = 500 + random() * 5000, angle = random() * Math.PI * 2, length = 2 + random() * 28
      data.push(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    }
    for (let i = 0; i < 200; i++) for (let j = 0; j < square.length; j += 4) {
      const x = 20 + i % 40 * 30, y = 20 + Math.floor(i / 40) * 30, parts = i % 2 ? 2 : 1
      for (let part = 0; part < parts; part++) for (const t of [part / parts, (part + 1) / parts]) {
        data.push(x + square[j] + (square[j + 2] - square[j]) * t, y + square[j + 1] + (square[j + 3] - square[j + 1]) * t)
      }
    }
    const lines = new Float32Array(data), times: number[] = []
    for (let run = 0; run < 3; run++) {
      const started = performance.now(), result = vectorSymbolSearch(lines, [20,20,30,30])
      times.push(performance.now() - started)
      expect(result.matches).toHaveLength(200)
      expect(result.stats.hatchGroups).toBe(0)
    }
    const medianMs = [...times].sort((a, b) => a - b)[1], baselineMs = Number(process.env.HATCH_BASELINE_MS)
    console.log('VECTOR_HATCH_PERF', JSON.stringify({ times, medianMs, baselineMs: baselineMs > 0 ? baselineMs : null }))
    // Set the median from the unchanged crossed-square fixture on the same machine.
    // Without it this reports timing only; it cannot establish the 1.2x requirement.
    if (Number.isFinite(baselineMs) && baselineMs > 0) expect(medianMs).toBeLessThanOrEqual(baselineMs * 1.2)
  }, 60_000)
})
