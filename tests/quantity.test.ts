import { describe, expect, it } from 'vitest'
import { parseQuantityMark, quantityLabel, quantityPoints, quantityValue, type QuantityMark } from '../src/core/quantity'
import type { Point } from '../src/core/annotations'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'

const mark = (method: QuantityMark['method'], values = {}): QuantityMark => ({ version: 1, id: 'mark', itemId: 'cv', method, ...values })
const square: Point[] = [[0, 0], [4, 0], [4, 3], [0, 3]]
describe('quantity calculations and parsing', () => {
  it('uses scale without rounding, including additions and every non-click method', () => {
    const p: Point[] = [[0, 0], [72, 0]], scale = 25.4 / 72 * 100
    expect(quantityValue(p, scale, mark('polyline'))).toBeCloseTo(2.54)
    expect(quantityValue(p, scale, mark('polyline', { addM: 3 }))).toBeCloseTo(5.54)
    expect(quantityValue(square, 1000, mark('polygon'))).toBe(12)
    expect(quantityValue([[0, 0], [24, 0]], 1000, mark('lengthHeight', { heightM: 3.5 }))).toBe(84)
    expect(quantityValue(square, 1000, mark('polygonDepth', { depthM: 1.2 }))).toBeCloseTo(14.4)
    expect(quantityValue([[0, 0], [10, 0]], 1000, mark('lengthWidthDepth', { widthM: .6, depthM: .8 }))).toBeCloseTo(4.8)
    const l: Point[] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]
    expect(quantityValue(l, 1000, mark('polygon'))).toBe(3)
    expect(quantityValue([...l].reverse(), 1000, mark('polygonDepth', { depthM: 2 }))).toBe(6)
    expect(quantityPoints('polygonDepth')).toBe('polygon')
    expect(quantityPoints('lengthHeight')).toBe('polyline')
  })
  it('formats the six label examples with fixed decimals, grouping and optional code', () => {
    const label = (p: Point[], m: QuantityMark, code: string, show = true) => quantityLabel(p, 1000, m, code, show)
    expect(label([[0, 0], [12.345, 0]], mark('polyline'), 'CV')).toBe('CV 12.35 m')
    expect(label([[0, 0], [9.35, 0]], mark('polyline', { addM: 3 }), 'CV')).toBe('CV 9.35+3.00=12.35 m')
    expect(label([[0, 0], [8, 0], [8, 6], [0, 6]], mark('polygon'), '内部足場')).toBe('内部足場 48.00 m²')
    expect(label([[0, 0], [24, 0]], mark('lengthHeight', { heightM: 3.5 }), '外部足場')).toBe('外部足場 24.00×H3.50=84.00 m²')
    expect(label(square, mark('polygonDepth', { depthM: 1.2 }), '根切り')).toBe('根切り 12.00×D1.20=14.40 m³')
    expect(label([[0, 0], [10, 0]], mark('lengthWidthDepth', { widthM: .6, depthM: .8 }), '溝掘削')).toBe('溝掘削 10.00×W0.60×D0.80=4.80 m³')
    expect(label([[0, 0], [1234.567, 0]], mark('polyline', { addM: 0 }), 'CV', false)).toBe('1,234.57 m')
  })
  it('rejects malformed, unknown and out of range metadata', () => {
    const good = mark('polyline', { addM: 3 })
    expect(parseQuantityMark(JSON.stringify(good))).toEqual(good)
    for (const raw of [null, '{', ' '.repeat(401), JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, id: '' }), JSON.stringify({ ...good, itemId: 'x'.repeat(81) }), JSON.stringify({ ...good, method: 'click' }), JSON.stringify({ ...good, method: 'unknown' })]) expect(parseQuantityMark(raw)).toBeNull()
    for (const key of ['addM', 'heightM', 'widthM', 'depthM']) for (const n of [-1, 1001, null, '3']) expect(parseQuantityMark(JSON.stringify({ ...good, [key]: n }))).toBeNull()
    expect(parseQuantityMark(JSON.stringify(mark('polyline', { addM: 1000 })))).not.toBeNull()
  })
})

it('keeps totals, edits, copy identities, styles and visibility in the existing store history', async () => {
  const store = new AnnotationStore()
  const f: CountFixture = { id: 'cv', name: 'ケーブル（CV）', code: 'CV', category: '電線・ケーブル', kind: 'length', style: nextCountStyle([]), order: 0, line: { width: 2, dash: 'dashed' } }
  const other = { ...f, id: 'cvt', code: 'CVT', order: 1 }
  await store.ensureCountFixtures(async () => [f, other], async () => {})
  const a = store.create({ pageIndex: 0, kind: 'perimeter', measure: { kind: 'perimeter', mmPerPoint: 25.4 / 72 * 100, unit: 'mm', decimals: null }, vertices: [[100, 200], [172, 200]], rect: [95, 180, 180, 220], quantity: mark('polyline'), quantityDash: 'dashed', text: 'CV 2.54 m' })
  expect(store.countTotals().get('cv')?.get(0)).toBeCloseTo(2.54)
  store.updateQuantityAdd(a.id, 3)
  expect(store.get(a.id)?.text).toBe('CV 2.54+3.00=5.54 m')
  store.undo(); expect(store.get(a.id)?.text).toBe('CV 2.54 m')
  store.updateMeasureVertices(a.id, [[100, 200], [244, 200]])
  expect(store.get(a.id)?.text).toBe('CV 5.08 m')
  store.reassignCounts([a.id], 'cvt'); expect(store.get(a.id)?.text).toBe('CVT 5.08 m')
  store.undo(); expect(store.get(a.id)?.quantity?.itemId).toBe('cv')
  store.selectOnly(a.id)
  const [copy] = store.pasteAnnotations(store.copySelected(), 0, { width: 500, height: 500 }, 10)
  expect(store.get(copy)?.quantity?.id).not.toBe('mark')
  expect(store.get(copy)?.quantityDash).toBe('dashed')
  expect(store.countTotals().get('cv')?.get(0)).toBeCloseTo(10.16)
  store.setFixtureVisible(['cv'], false); expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(false)
  store.selectFixture('cv'); store.prepareCountTool(); expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(true)
  store.setCountFixtures([{ ...f, code: 'C', style: { ...f.style, showCode: false } }, other])
  expect(store.get(a.id)?.text).toBe('5.08 m')
  store.undo(); expect(store.get(a.id)?.text).toBe('CV 5.08 m')
  expect(store.fixtureMarkCount('cv')).toBe(2)
  store.setCountFixtures([other], ['cv']); expect(store.get(a.id)).toBeUndefined()
  store.undo(); expect(store.countTotals().get('cv')?.get(0)).toBeCloseTo(10.16)
})
