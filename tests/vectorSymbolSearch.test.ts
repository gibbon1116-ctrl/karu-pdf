import { describe, expect, it } from 'vitest'
import * as mupdf from 'mupdf'
import { defaultVectorTolerance, prepareVectorTemplate, vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import type { Rect } from '../src/core/annotations'

const square = [[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]]
const symbol = [...square, [0, 0, 10, 10], [10, 0, 0, 10]]
const sample: Rect = [20, 20, 30, 30]
const stamp = (lines: number[][], x: number, y: number, angle = 0) => lines.flatMap(([x0, y0, x1, y1]) => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return [x + c * x0 - s * y0, y + s * x0 + c * y0, x + c * x1 - s * y1, y + s * x1 + c * y1]
})
const thin = [[0, 0, 3, 0], [3, 0, 3, 19], [3, 19, 0, 19], [0, 19, 0, 0]]
// Several diagonal strokes make the additional line length exceed 40%.
const hatched = [...thin, ...[0, 1, 2, 3, 4].map(y => [0, y, 3, 19 - y])]
describe('vector template preparation', () => {
  it('keeps short disconnected interior marks inside a closed ring, but still removes nearby outside marks', () => {
    const circle=Array.from({length:24},(_,i)=>[20+10*Math.cos(i*Math.PI/12),20+10*Math.sin(i*Math.PI/12),20+10*Math.cos((i+1)*Math.PI/12),20+10*Math.sin((i+1)*Math.PI/12)])
    const lines=new Float32Array([...circle.flat(),17,23,23,17, 32,14,33,15])
    const prepared=prepareVectorTemplate(lines,new Float32Array(lines.length/4).fill(.6),[9,9,34,31])
    expect(prepared.segments.length/4).toBe(25)
    expect(Array.from(prepared.segments.slice(-4))).toEqual([17,23,23,17])
    expect(prepared.removed.other).toBe(1)
  })
  it('keeps the thin fixture and polygon circle, removing neighboring text and a dashed wiring chain', () => {
    const circle = Array.from({ length: 12 }, (_, i) => [21.5 + 1.5 * Math.cos(i * Math.PI / 6), 29.5 + 1.5 * Math.sin(i * Math.PI / 6),
      21.5 + 1.5 * Math.cos((i + 1) * Math.PI / 6), 29.5 + 1.5 * Math.sin((i + 1) * Math.PI / 6)])
    const body = [...stamp(thin, 20, 20), ...circle.flat()]
    const text = [27, 22, 27, 24, 27, 24, 29, 24, 33, 25, 35, 25]
    const wiring = [16,17,18,17, ...[19,22,25,28,31,34,37].flatMap(x => [x,17,x+2,17]), 40,17,44,17]
    const segments = new Float32Array([...body, ...text, ...wiring])
    const widths = new Float32Array([...Array(16).fill(.7), ...Array(3).fill(.42), ...Array(9).fill(.84)])
    const result = prepareVectorTemplate(segments, widths, [18,15,39,42])
    expect(result.cleaned).toBe(true)
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed).toEqual({ wiring: 7, other: 3, thin: 0 })
    expect(result.total).toBe(26)
    expect(result.bounds).toEqual([20,20,23,39])
    expect(result.tolerance).toBeCloseTo(19 * .03)
    expect(Array.from(result.widths)).toEqual(Array(16).fill(Math.fround(.7)))
  })
  it('uses width proximity to keep nearby text out of the largest connected body', () => {
    const body = stamp(thin, 20, 20), text = [23.2,25,25,25, 25,25,25,26]
    const result = prepareVectorTemplate(new Float32Array([...body, ...text]), new Float32Array([.7,.7,.7,.7,.42,.42]), [19,19,26,40])
    expect(result.segments).toEqual(new Float32Array(body)); expect(result.removed.other).toBe(2)
    const compatible = prepareVectorTemplate(new Float32Array([...body, ...text]), new Float32Array([.7,.7,.7,.7,0,0]), [19,19,26,40])
    expect(compatible.removed.other).toBe(0)
  })
  it('restores the original when fewer than two lines remain', () => {
    const segments = new Float32Array([-3,0,1,0, 2,0,4,0, 5,0,7,0, 3,3,3,4])
    const result = prepareVectorTemplate(segments, new Float32Array(4), [0,-1,8,5])
    expect(result.cleaned).toBe(false); expect(result.total).toBe(3)
    expect(result.removed).toEqual({ wiring: 0, other: 0, thin: 0 }); expect(result.segments).toEqual(segments.slice(4))
  })
  it('restores the original when wiring removal leaves less than 40% of its length', () => {
    const segments = new Float32Array([-3,0,1,0, 2,0,12,0, 13,0,23,0, 4,4,5,4, 5,4,5,5])
    const result = prepareVectorTemplate(segments, new Float32Array(5), [0,-1,24,6])
    expect(result.cleaned).toBe(false); expect(result.segments).toEqual(segments.slice(4))
  })
  it('bounds cleanup for oversized or dense templates without discarding lines', () => {
    for (const count of [4100, 1000]) {
      const segments = new Float32Array(Array.from({length:count}, () => [0,0,1,0]).flat())
      const result = prepareVectorTemplate(segments, new Float32Array(count), [-1,-1,2,2])
      expect(result.cleaned).toBe(false); expect(result.total).toBe(count); expect(result.segments).toEqual(segments)
    }
  })
  it('clamps default tolerance between .3 and 1 using the longer dimension', () => {
    expect(defaultVectorTolerance([0,0,3,19])).toBeCloseTo(.57)
    expect(defaultVectorTolerance([0,0,1,1])).toBe(.3)
    expect(defaultVectorTolerance([0,0,100,2])).toBe(1)
  })
})
describe('vector symbol coverage search', () => {
  it('finds a .24pt width variation of a 3 × 19pt rectangle above .9', () => {
    const wider = [[0,0,3.24,0], [3.24,0,3.24,19], [3.24,19,0,19], [0,19,0,0]]
    const result = vectorSymbolSearch(new Float32Array([...stamp(thin,20,20), ...stamp(wider,60,20)]), [20,20,23,39], {threshold:.9})
    expect(result.matches).toHaveLength(2); expect(result.matches.every(m => m.score >= .9)).toBe(true)
    expect(result.template.rect).toEqual([20,20,23,39])
  })
  it('retains diagonally hatched candidates with extra > .4 and plain ones with extra ≤ .1, including rotations', () => {
    const result = vectorSymbolSearch(new Float32Array([...stamp(thin,20,20), ...stamp(hatched,60,20), ...stamp(hatched,100,20,Math.PI/2)]), [20,20,23,39], {threshold:.9,rotations:true})
    expect(result.matches).toHaveLength(3)
    expect(result.matches.find(m => m.center[0] < 30)!.extra).toBeLessThanOrEqual(.1)
    expect(result.matches.filter(m => m.center[0] > 30).every(m => m.extra > .4)).toBe(true)
  })
  it('measures the specified length fraction for a single diagonal without changing the cutoff', () => {
    const result = vectorSymbolSearch(new Float32Array([...stamp(thin,20,20), ...stamp([...thin, [0,0,3,19]],60,20)]), [20,20,23,39], {threshold:.9})
    const extra = result.matches.find(m => m.center[0] > 30)!.extra
    expect(extra).toBeGreaterThan(.1); expect(extra).toBeLessThan(.4)
  })
  it('finds exactly eight crossed squares, including the sample, excluding four plain squares', () => {
    const lines: number[] = []
    for (let i = 0; i < 12; i++) lines.push(...stamp(i < 8 ? symbol : square, 20 + i * 30, 20))
    const result = vectorSymbolSearch(new Float32Array(lines), sample)
    expect(result.matches).toHaveLength(8)
    expect(result.matches.map(m => Math.round(m.center[0])).sort((a, b) => a - b)).toEqual([25, 55, 85, 115, 145, 175, 205, 235])
    expect(result.template.segments).toBe(6)
    expect(result.template.length).toBeCloseTo(40 + 20 * Math.SQRT2)
    expect(result.matches.every(m => m.score > .999)).toBe(true)
  })
  it('accepts crossing dimension lines and subdivided sides', () => {
    const divided = symbol.flatMap(([x0, y0, x1, y1], i) => i < 4 ? [[x0, y0, (x0 + x1) / 2, (y0 + y1) / 2], [(x0 + x1) / 2, (y0 + y1) / 2, x1, y1]] : [[x0, y0, x1, y1]])
    const data = new Float32Array([...stamp(symbol, 20, 20), ...stamp(divided, 80, 20), 0, 25, 130, 25])
    expect(vectorSymbolSearch(data, sample).matches).toHaveLength(2)
    expect(vectorSymbolSearch(data, sample, { threshold: 1 }).matches).toHaveLength(2)
  })
  it('also covers a sample made of short lines on merged target sides', () => {
    const split = symbol.flatMap(([a, b, c, d], i) => i < 4 ? [[a, b, (a + c) / 2, (b + d) / 2], [(a + c) / 2, (b + d) / 2, c, d]] : [[a, b, c, d]])
    expect(vectorSymbolSearch(new Float32Array([...stamp(split, 20, 20), ...stamp(symbol, 80, 20)]), sample).matches).toHaveLength(2)
  })
  it('finds a non-symmetric 90 degree rotation only when rotations are enabled', () => {
    // A square with X has 90° symmetry; this asymmetric symbol can distinguish rotations.
    const asymmetric = [[0, 0, 12, 0], [0, 0, 0, 5], [0, 5, 3, 5], [3, 5, 3, 2]]
    const data = new Float32Array([...stamp(asymmetric, 20, 20), ...stamp(asymmetric, 90, 20, Math.PI / 2), ...stamp(asymmetric, 140, 20, .6)])
    const rect: Rect = [20, 20, 32, 25]
    expect(vectorSymbolSearch(data, rect).matches).toHaveLength(1)
    const matches = vectorSymbolSearch(data, rect, { rotations: true }).matches
    expect(matches).toHaveLength(3)
    expect(matches.some(m => Math.abs(m.angle - 90) < .01)).toBe(true)
  })
  it('respects region and result limits, with highest scores suppressing overlaps', () => {
    const data = new Float32Array([...stamp(symbol, 20, 20), ...stamp(symbol, 80, 20)])
    const result = vectorSymbolSearch(data, sample, { region: [75, 15, 100, 40] })
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].center).toEqual([85, 25])
    expect(vectorSymbolSearch(data, sample, { maxResults: 1 }).matches).toHaveLength(1)
    expect(vectorSymbolSearch(data, sample, { maxResults: 0 }).matches).toHaveLength(0)
    expect(vectorSymbolSearch(data, sample, { region: [80, 20, 89, 30] }).matches).toHaveLength(0)
  })
  it('uses the widened sample bounds, and reports an empty template', () => {
    expect(vectorSymbolSearch(new Float32Array(stamp(symbol, 20, 20)), [20.1, 20.1, 29.9, 29.9]).template.segments).toBe(6)
    expect(() => vectorSymbolSearch(new Float32Array([0, 0, 10, 0]), [0, 0, 10, 10])).toThrow('見本の範囲に線がありません')
    expect(() => vectorSymbolSearch(new Float32Array(stamp(symbol, 20, 20)), sample, { tolerance: 0 })).toThrow()
  })
  it('checks cancellation at 500-anchor intervals', () => {
    const data = new Float32Array(Array.from({ length: 600 }, (_, i) => stamp(symbol, 20 + i * 30, 20)).flat())
    let checks = 0
    const result = vectorSymbolSearch(data, sample, { shouldStop: () => ++checks >= 3 })
    expect(result.stats.anchorsTried).toBe(500)
    expect(checks).toBe(3)
  })
  it('measures 200 symbols among 100,000 unrelated segments (1s is advisory)', () => {
    const data: number[] = []
    let state = 42
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000)
    for (let i = 0; i < 100_000; i++) {
      const x = random() * 5000, y = 500 + random() * 5000, angle = random() * Math.PI * 2, length = 2 + random() * 28
      data.push(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    }
    for (let i = 0; i < 200; i++) data.push(...stamp(symbol, 20 + i % 40 * 30, 20 + Math.floor(i / 40) * 30))
    const result = vectorSymbolSearch(new Float32Array(data), sample)
    console.log('VECTOR_SYMBOL_SYNTHETIC_PERF', JSON.stringify({ unrelatedSegments: 100_000, symbols: 200, matches: result.matches.length, ...result.stats, underOneSecond: result.stats.ms < 1000 }))
    expect(result.matches).toHaveLength(200)
  }, 30_000)
})

interface PaintFixture {
  content: string
  segments: number[]
  widths: number[]
}

// The PDF and the known coverage geometry share the same cubic paths.
// Geometry is authored here; this helper does not test the production extractor.
function circleFixturePath(x: number, y: number, radius: number) {
  const k = radius * .5522847498307936
  const curves = [
    [x + radius,y, x + radius,y + k, x + k,y + radius, x,y + radius],
    [x,y + radius, x - k,y + radius, x - radius,y + k, x - radius,y],
    [x - radius,y, x - radius,y - k, x - k,y - radius, x,y - radius],
    [x,y - radius, x + k,y - radius, x + radius,y - k, x + radius,y],
  ]
  const segments: number[] = []
  for (const [ax,ay,bx,by,cx,cy,dx,dy] of curves) {
    const point = (t: number) => {
      const u = 1 - t
      return [u ** 3 * ax + 3 * u * u * t * bx + 3 * u * t * t * cx + t ** 3 * dx,
        u ** 3 * ay + 3 * u * u * t * by + 3 * u * t * t * cy + t ** 3 * dy]
    }
    for (let i = 0; i < 12; i++) segments.push(...point(i / 12), ...point((i + 1) / 12))
  }
  const content = `${x + radius} ${y} m\n${curves.map(curve => `${curve.slice(2).join(' ')} c`).join('\n')}\nh\n`
  return { content, segments }
}
function circleFixture(x: number, y: number, width: number): PaintFixture {
  const circle = circleFixturePath(x, y, 8)
  return { content: width > 0 ? `${width} w\n${circle.content}S\n` : `${circle.content}f\n`,
    segments: circle.segments, widths: Array(circle.segments.length / 4).fill(width) }
}
function letterOFixture(x: number, y: number): PaintFixture {
  const outer = circleFixturePath(x, y, 8), inner = circleFixturePath(x, y, 7.25)
  const segments = [...outer.segments, ...inner.segments]
  return { content: `${outer.content}${inner.content}f*\n`,
    segments, widths: Array(segments.length / 4).fill(0) }
}
function triangleFixture(x: number, y: number, width = 0): PaintFixture {
  const segments = [x - 2,y - 2,x + 2,y - 2, x + 2,y - 2,x,y + 2, x,y + 2,x - 2,y - 2]
  const path = `${x - 2} ${y - 2} m\n${x + 2} ${y - 2} l\n${x} ${y + 2} l\nh\n`
  return { content: width > 0 ? `${width} w\n${path}S\n` : `${path}f\n`,
    segments, widths: Array(3).fill(width) }
}
function syntheticVectorPage(parts: PaintFixture[]) {
  const doc = new mupdf.PDFDocument()
  try {
    const object = doc.addPage([0,0,240,100], 0, {}, `0 G\n0 g\n${parts.map(part => part.content).join('')}`)
    try { doc.insertPage(-1, object) } finally { object.destroy() }
    const page = doc.loadPage(0)
    try {
      const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
      try {
        expect(pixmap.getWidth()).toBe(240)
        expect(pixmap.getHeight()).toBe(100)
      } finally { pixmap.destroy() }
    } finally { page.destroy() }
    return {
      segments: new Float32Array(parts.flatMap(part => part.segments)),
      widths: new Float32Array(parts.flatMap(part => part.widths)),
    }
  } finally { doc.destroy() }
}
describe('vector symbol stroke and fill coverage', () => {
  const rect: Rect = [11,31,29,49]
  const centers = (result: ReturnType<typeof vectorSymbolSearch>) =>
    result.matches.map(match => Math.round(match.center[0])).sort((a, b) => a - b)

  it('finds only the two .54pt stroke circles, retaining all four matches without target widths', () => {
    const page = syntheticVectorPage([
      circleFixture(20,40,.54), circleFixture(75,40,.54),
      letterOFixture(130,40), letterOFixture(185,40),
    ])
    const originalSegments = page.segments.slice(), originalWidths = page.widths.slice()
    const options = { threshold: .98 }
    const result = vectorSymbolSearch(page.segments, rect, options, page.segments, page.widths, page.widths)
    expect(result.template.strokeWidth).toBeCloseTo(.54)
    expect(result.matches).toHaveLength(2)
    expect(centers(result)).toEqual([20,75])
    const legacy = vectorSymbolSearch(page.segments, rect, options, page.segments, page.widths)
    expect(legacy.matches).toHaveLength(4)
    expect(centers(legacy)).toEqual([20,75,130,185])
    expect(page.segments).toEqual(originalSegments)
    expect(page.widths).toEqual(originalWidths)
  })

  it('keeps filled-circle templates compatible with filled circles and stroke contours', () => {
    const page = syntheticVectorPage([
      circleFixture(20,40,0), circleFixture(75,40,0), circleFixture(130,40,.54),
    ])
    const options = { threshold: .98 }
    const result = vectorSymbolSearch(page.segments, rect, options, page.segments, page.widths, page.widths)
    const legacy = vectorSymbolSearch(page.segments, rect, options, page.segments, page.widths)
    expect(result.template.strokeWidth).toBe(0)
    expect(result.matches).toHaveLength(3)
    expect(centers(result)).toEqual([20,75,130])
    expect(result.matches).toEqual(legacy.matches)
  })

  it('matches stroke circles with filled triangles, excluding a fill-contour circle with the same triangle', () => {
    const page = syntheticVectorPage([
      circleFixture(20,40,.54), triangleFixture(20,40),
      circleFixture(75,40,.54), triangleFixture(75,40),
      letterOFixture(130,40), triangleFixture(130,40),
    ])
    const prepared = prepareVectorTemplate(page.segments, page.widths, rect)
    expect(prepared.widths.some(width => width > 0)).toBe(true)
    expect(prepared.widths.some(width => width === 0)).toBe(true)
    expect(prepared.segments.length / 4).toBe(51)
    const options = { threshold: .98 }
    const result = vectorSymbolSearch(page.segments, rect, options, page.segments, page.widths, page.widths)
    expect(result.matches).toHaveLength(2)
    expect(centers(result)).toEqual([20,75])
    const legacy = vectorSymbolSearch(page.segments, rect, options, page.segments, page.widths)
    expect(legacy.matches).toHaveLength(3)
    expect(centers(legacy)).toEqual([20,75,130])
  })

  it('allows fill samples to hit stroke lines in a mixed template', () => {
    const page = syntheticVectorPage([
      circleFixture(20,40,.54), triangleFixture(20,40),
      circleFixture(75,40,.54), triangleFixture(75,40,.54),
    ])
    const result = vectorSymbolSearch(page.segments, rect, { threshold: .98 }, page.segments, page.widths, page.widths)
    expect(result.matches).toHaveLength(2)
    expect(centers(result)).toEqual([20,75])
  })

  it('retains the .5W and 2W boundaries while excluding narrower strokes and fill contours', () => {
    const page = syntheticVectorPage([
      circleFixture(20,40,.54), circleFixture(75,40,.27),
      circleFixture(130,40,1.08), circleFixture(185,40,.26),
      letterOFixture(220,40),
    ])
    const result = vectorSymbolSearch(page.segments, rect, { threshold: .98 }, page.segments, page.widths, page.widths)
    expect(result.matches).toHaveLength(3)
    expect(centers(result)).toEqual([20,75,130])
  })

  it('keeps fill contours in reverse extra and surrounding-line measurements', () => {
    const target = [
      circleFixture(20,40,.54), triangleFixture(20,40),
      { content: '30 38 m\n30 42 l\nS\n', segments: [30,38,30,42], widths: [0] },
    ]
    // The surrounding mark is a fill contour in the known geometry.
    target[2].content = '30 38 m\n30 42 l\n30.1 42 l\n30.1 38 l\nh\nf\n'
    target[2].segments = [30,38,30,42, 30,42,30.1,42, 30.1,42,30.1,38, 30.1,38,30,38]
    target[2].widths = [0,0,0,0]
    const page = syntheticVectorPage(target)
    const samplePart = circleFixture(20,40,.54)
    const sampleSegments = new Float32Array(samplePart.segments), sampleWidths = new Float32Array(samplePart.widths)
    const options = { threshold: .98 }
    const result = vectorSymbolSearch(page.segments, rect, options, sampleSegments, sampleWidths, page.widths)
    const legacy = vectorSymbolSearch(page.segments, rect, options, sampleSegments, sampleWidths)
    expect(result.matches).toHaveLength(1)
    expect(legacy.matches).toHaveLength(1)
    expect(result.matches[0].extra).toBeGreaterThan(.1)
    expect(result.matches[0].around).toBeGreaterThan(0)
    expect(result.matches[0].extra).toBeCloseTo(legacy.matches[0].extra)
    expect(result.matches[0].around).toBeCloseTo(legacy.matches[0].around)
  })

  it('returns no matches when a stroke template searches a target containing only fill contours', () => {
    const page = syntheticVectorPage([letterOFixture(75,40), letterOFixture(130,40)])
    const samplePart = circleFixture(20,40,.54)
    const sampleSegments = new Float32Array(samplePart.segments), sampleWidths = new Float32Array(samplePart.widths)
    const options = { threshold: .98 }
    expect(vectorSymbolSearch(page.segments, rect, options, sampleSegments, sampleWidths, page.widths).matches).toHaveLength(0)
    expect(vectorSymbolSearch(page.segments, rect, options, sampleSegments, sampleWidths).matches).toHaveLength(2)
  })

  it('preserves cancellation checks when stroke-only coverage is enabled', () => {
    const data = new Float32Array(Array.from({ length: 600 }, (_, i) => stamp(symbol, 20 + i * 30, 20)).flat())
    const widths = new Float32Array(data.length / 4).fill(.54)
    let checks = 0
    const result = vectorSymbolSearch(data, sample, { shouldStop: () => ++checks >= 3 }, data, widths, widths)
    expect(result.stats.anchorsTried).toBe(500)
    expect(checks).toBe(3)
  })
})
