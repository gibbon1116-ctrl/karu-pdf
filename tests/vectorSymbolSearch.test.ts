import { describe, expect, it } from 'vitest'
import { vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import type { Rect } from '../src/core/annotations'

const square = [[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]]
const symbol = [...square, [0, 0, 10, 10], [10, 0, 0, 10]]
const sample: Rect = [20, 20, 30, 30]
const stamp = (lines: number[][], x: number, y: number, angle = 0) => lines.flatMap(([x0, y0, x1, y1]) => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return [x + c * x0 - s * y0, y + s * x0 + c * y0, x + c * x1 - s * y1, y + s * x1 + c * y1]
})
describe('vector symbol coverage search', () => {
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
