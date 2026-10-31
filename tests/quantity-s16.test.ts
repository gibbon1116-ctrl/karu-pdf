import { describe, expect, it } from 'vitest'
import type { Point } from '../src/core/annotations'
import {
  parseQuantityMark, quantityLabel, quantityValue, serializeQuantityMark,
  type QuantityMark, type QuantityOpening,
} from '../src/core/quantity'

const outer: Point[] = [[0, 0], [5, 0], [5, 5], [0, 5]]
const hole: Point[] = [[.5, .5], [4.5, .5], [4.5, 1.3], [.5, 1.3]]
const mark = (method: QuantityMark['method'], values: Partial<QuantityMark> = {}): QuantityMark =>
  ({ version: 1, id: 'mark', itemId: 'area', method, ...values })
const label = (points: Point[], value: QuantityMark) => quantityLabel(points, 1000, value, '', false)

describe('SPEC-S16 quantity persistence', () => {
  it('preserves holes and openings', () => {
    const value = mark('polygon', {
      holes: [hole],
      openings: [{ itemId: 'door', widthM: .9, heightM: 2.4, count: 2 }],
    })
    expect(parseQuantityMark(serializeQuantityMark(value))).toEqual(value)
  })

  it('preserves the old wire strings without deductions', () => {
    expect(serializeQuantityMark(mark('polygon')))
      .toBe('{"version":1,"id":"mark","itemId":"area","method":"polygon"}')
    expect(serializeQuantityMark(mark('lengthHeight', { heightM: 2.7 })))
      .toBe('{"version":1,"id":"mark","itemId":"area","method":"lengthHeight","heightM":2.7}')
    expect(serializeQuantityMark(mark('polygonDepth', { depthM: .3 })))
      .toBe('{"version":1,"id":"mark","itemId":"area","method":"polygonDepth","depthM":0.3}')
    expect(serializeQuantityMark(mark('polyline')))
      .toBe('{"version":1,"id":"mark","itemId":"area","method":"polyline"}')
  })

  it.each([
    null, {}, [[[]]], [[[0, 0], [1, 0]]],
    [Array.from({ length: 501 }, () => [0, 0])],
    Array.from({ length: 51 }, () => hole),
    [[[0, 0], [1, 0], ['bad', 1]]],
    [[[0, 0], [1, 0], [1, 1, 2]]],
  ])('discards the entire invalid holes field only: %j', holes => {
    const value = { ...mark('polygon'), holes, openings: [{ widthM: 1, heightM: 2, count: 1 }] }
    const parsed = parseQuantityMark(JSON.stringify(value))
    expect(parsed).not.toBeNull()
    expect(parsed?.holes).toBeUndefined()
    expect(parsed?.openings).toEqual(value.openings)
    const saved = parseQuantityMark(serializeQuantityMark(value as unknown as QuantityMark))
    expect(saved?.holes).toBeUndefined()
    expect(saved?.openings).toEqual(value.openings)
  })

  it('rejects non-finite coordinates before JSON can turn them into null', () => {
    const value = mark('polygon', { holes: [[[0, 0], [1, 0], [Infinity, 1]]] })
    expect(JSON.parse(serializeQuantityMark(value)).holes).toBeUndefined()
    expect(parseQuantityMark(JSON.stringify(value))?.holes).toBeUndefined()
  })

  it.each([
    null, {}, [{ widthM: 1, heightM: 2, count: 0 }],
    [{ widthM: 1, heightM: 2, count: 1000 }],
    [{ widthM: 1, heightM: 2, count: 1.5 }],
    [{ widthM: 0, heightM: 2, count: 1 }],
    [{ widthM: 101, heightM: 2, count: 1 }],
    [{ widthM: 1, heightM: -2, count: 1 }],
    [{ widthM: 1, count: 1 }],
    [{ itemId: '', count: 1 }],
    [{ itemId: 'x'.repeat(81), count: 1 }],
    Array.from({ length: 51 }, () => ({ itemId: 'door', count: 1 })),
    [{ itemId: 'door', count: 1 }, { widthM: 0, heightM: 2, count: 1 }],
  ])('discards the entire invalid openings field only: %j', openings => {
    const value = { ...mark('polygon'), holes: [hole], openings }
    const parsed = parseQuantityMark(JSON.stringify(value))
    expect(parsed).not.toBeNull()
    expect(parsed?.holes).toEqual([hole])
    expect(parsed?.openings).toBeUndefined()
    const saved = parseQuantityMark(serializeQuantityMark(value as unknown as QuantityMark))
    expect(saved?.holes).toEqual([hole])
    expect(saved?.openings).toBeUndefined()
  })

  it('accepts the inclusive limits and a reference without fallback dimensions', () => {
    const openings: QuantityOpening[] = [{ itemId: 'x'.repeat(80), count: 999 }, { widthM: 100, heightM: 100, count: 999 }]
    expect(parseQuantityMark(serializeQuantityMark(mark('polygon', { openings })))?.openings).toEqual(openings)
    const holes = Array.from({ length: 50 }, () => hole)
    expect(parseQuantityMark(serializeQuantityMark(mark('polygon', { holes })))?.holes).toHaveLength(50)
    const polygon = Array.from({ length: 500 }, (_, i) => [i, i % 2] as Point)
    expect(parseQuantityMark(serializeQuantityMark(mark('polygon', { holes: [polygon] })))?.holes?.[0]).toHaveLength(500)
  })

  it.each(['polyline', 'lengthHeight', 'polygonDepth', 'lengthWidthDepth'] as const)(
    'discards fields unsupported by %s', method => {
      const value = mark(method, { holes: [hole], openings: [{ widthM: 1, heightM: 2, count: 1 }] })
      for (const parsed of [
        parseQuantityMark(JSON.stringify(value)),
        parseQuantityMark(serializeQuantityMark(value)),
      ]) {
        expect(parsed).not.toBeNull()
        expect(parsed?.holes).toEqual(method === 'polygonDepth' ? [hole] : undefined)
        expect(parsed?.openings).toEqual(method === 'lengthHeight' ? value.openings : undefined)
      }
    },
  )

  it('reads valid metadata longer than the old 8,000-character limit', () => {
    const polygon = Array.from({ length: 300 }, (_, i) => [i + .1234567890123, i + .9876543210123] as Point)
    const raw = serializeQuantityMark(mark('polygon', { holes: [polygon] }))
    expect(raw.length).toBeGreaterThan(8000)
    expect(raw.length).toBeLessThanOrEqual(64_000)
    expect(parseQuantityMark(raw)?.holes?.[0]).toEqual(polygon)
  })

  it('rejects oversized metadata on both read and write', () => {
    const polygon = Array.from({ length: 500 }, (_, i) => [i + .1234567890123, i + .9876543210123] as Point)
    const value = mark('polygon', { holes: Array.from({ length: 50 }, () => polygon) })
    expect(JSON.stringify(value).length).toBeGreaterThan(64_000)
    expect(parseQuantityMark(JSON.stringify(value))).toBeNull()
    expect(() => serializeQuantityMark(value)).toThrow()
  })
})

describe('SPEC-S16 quantity calculations and labels', () => {
  it('subtracts holes and openings from polygon area using drawing scale', () => {
    const value = mark('polygon', { holes: [hole], openings: [{ widthM: .9, heightM: 2.4, count: 2 }] })
    expect(quantityValue(outer, 1000, value)).toBeCloseTo(17.48)
    expect(quantityValue(outer, 500, value)).toBeCloseTo(1.13)
    expect(label(outer, value)).toBe('25.00−3.20−開口4.32=17.48 m²')
  })

  it('formats the polygon and volume examples', () => {
    expect(label(outer, mark('polygon', { holes: [hole] }))).toBe('25.00−3.20=21.80 m²')
    const value = mark('polygonDepth', { holes: [hole], depthM: .3 })
    expect(quantityValue(outer, 1000, value)).toBeCloseTo(6.54)
    expect(label(outer, value)).toBe('(25.00−3.20)×D0.30=6.54 m³')
  })

  it('subtracts openings from length times height', () => {
    const points: Point[] = [[0, 0], [12, 0]]
    const value = mark('lengthHeight', { heightM: 2.7, openings: [{ widthM: .9, heightM: 2.4, count: 2 }] })
    expect(quantityValue(points, 1000, value)).toBeCloseTo(28.08)
    expect(label(points, value)).toBe('12.00×H2.70−開口4.32=28.08 m²')
  })

  it('clamps the net area before multiplying depth', () => {
    const hugeHole: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    expect(quantityValue(outer, 1000, mark('polygon', { holes: [hugeHole] }))).toBe(0)
    expect(quantityValue(outer, 1000, mark('polygonDepth', { holes: [hugeHole], depthM: .3 }))).toBe(0)
    expect(quantityValue([[0, 0], [1, 0]], 1000, mark('lengthHeight', {
      heightM: 1, openings: [{ widthM: 2, heightM: 2, count: 1 }],
    }))).toBe(0)
  })

  it('uses current fixture dimensions, then complete fallback dimensions', () => {
    const value = mark('polygon', { openings: [{ itemId: 'door', widthM: 1, heightM: 2, count: 2 }] })
    expect(quantityValue(outer, 1000, value, () => ({ widthM: 2, heightM: 3 }))).toBe(13)
    expect(quantityValue(outer, 1000, value, () => ({ widthM: 1, heightM: 3 }))).toBe(19)
    expect(quantityValue(outer, 1000, value, () => undefined)).toBe(21)
    expect(quantityValue(outer, 1000, value)).toBe(21)
    expect(quantityLabel(outer, 1000, value, '', false, undefined, () => ({ widthM: 2, heightM: 3 })))
      .toBe('25.00−開口12.00=13.00 m²')
  })

  it('counts unresolved openings as zero and marks a mixed opening total with ?', () => {
    const value = mark('polygon', { openings: [
      { widthM: .9, heightM: 2.4, count: 2 },
      { itemId: 'deleted-door', count: 1 },
    ] })
    expect(quantityValue(outer, 1000, value)).toBeCloseTo(20.68)
    expect(label(outer, value)).toBe('25.00−開口4.32?=20.68 m²')
    expect(label(outer, mark('polygon', { openings: [{ itemId: 'deleted-door', count: 1 }] })))
      .toBe('25.00−開口0.00?=25.00 m²')
  })

  it('keeps old values and labels when deductions are absent or empty', () => {
    const points: Point[] = [[0, 0], [12, 0]]
    expect(label(outer, mark('polygon'))).toBe('25.00 m²')
    expect(label(outer, mark('polygon', { holes: [], openings: [] }))).toBe('25.00 m²')
    expect(label(points, mark('lengthHeight', { heightM: 2.7 }))).toBe('12.00×H2.70=32.40 m²')
    expect(label(outer, mark('polygonDepth', { depthM: .3 }))).toBe('25.00×D0.30=7.50 m³')
    expect(quantityValue(outer, 1000, mark('polygon'))).toBe(25)
    expect(quantityValue(outer, 1000, mark('polygonDepth', { depthM: .3 }))).toBe(7.5)
  })
})
