import { expect, it } from 'vitest'
import { parseQuantityMark, quantityLabel, quantityValue, routeLength, type QuantityMark } from '../src/core/quantity'
import { nextCountStyle, parseCountFixtures, serializeCountFixtures, FIXTURE_PRESETS, type CountFixture } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { createQuantityCsv } from '../src/app/annotationCsv'
import type { Point } from '../src/core/annotations'

const points: Point[] = [[0, 0], [9.35, 0]]
const mark: QuantityMark = { version: 1, id: 'route', itemId: 'cv', method: 'polyline', addM: 3, slackM: 1, count: 2, extra: [{ itemId: 'pf', count: 1, scope: 'rise' }, { itemId: 'rack', count: 1, scope: 'noSlack' }] }
const fixtures: CountFixture[] = ['cv', 'pf', 'rack'].map((id, order) => ({ id, order, code: id, name: id, category: '例', kind: 'length', method: 'polyline', style: nextCountStyle([]) }))
const annotation = (q = mark) => ({ id: 'route', pageIndex: 0, vertices: points, measure: { mmPerPoint: 1000 }, quantity: q })

it('calculates all three scopes for every route item and both CSVs', () => {
  expect(routeLength(9.35, mark)).toBeCloseTo(13.35)
  expect(routeLength(9.35, mark, 'noSlack')).toBeCloseTo(12.35)
  expect(routeLength(9.35, mark, 'rise')).toBe(3)
  const index = QuantityIndex.build([annotation()], fixtures)
  expect(index.total('cv')).toBeCloseTo(26.70)
  expect(index.total('pf')).toBe(3)
  expect(index.total('rack')).toBeCloseTo(12.35)
  expect(index.entries('pf')[0]).toMatchObject({ scope: 'rise', routeCount: 1, value: 3 })
  expect(QuantityIndex.build([annotation({ ...mark, scope: 'rise' })], fixtures).total('cv')).toBe(6)
  expect(QuantityIndex.build([annotation({ ...mark, scope: 'noSlack' })], fixtures).total('cv')).toBeCloseTo(24.7)
  for (const type of ['summary', 'detail'] as const) {
    const csv = createQuantityCsv(index, fixtures, 0, type)
    for (const value of ['26.70', '3.00', '12.35']) expect(csv).toContain(value)
  }
})
it('labels the full route while adding item scope suffixes', () => {
  const q = { ...mark, extra: mark.extra!.slice(0, 1) }
  expect(quantityLabel(points, 1000, q, 'CV 38sq-3C', true, () => 'PF28')).toBe('CV 38sq-3C×2, PF28（立上り）  9.35+3.00+余1.00=13.35 m')
  expect(quantityLabel(points, 1000, { ...q, addM: 0 }, '', false)).toBe('9.35+余1.00=10.35 m')
  expect(quantityLabel(points, 1000, { ...mark, count: undefined, extra: undefined, scope: 'noSlack' }, 'CR', true)).toBe('CR（平面＋立上り） 9.35+3.00+余1.00=13.35 m')
  expect(quantityValue(points, 1000, { ...mark, scope: 'rise' })).toBeCloseTo(13.35)
})
it('keeps old route values and labels, omits zero slack and default scopes', () => {
  const old = { version: 1 as const, id: 'old', itemId: 'cv', method: 'polyline' as const, addM: 3 }
  expect(parseQuantityMark(JSON.stringify(old))).toEqual(old)
  expect(quantityValue(points, 1000, old)).toBeCloseTo(12.35)
  expect(quantityLabel(points, 1000, old, 'CV', true)).toBe('CV 9.35+3.00=12.35 m')
  expect(QuantityIndex.build([annotation(old)], fixtures).total('cv')).toBeCloseTo(12.35)
  expect(parseQuantityMark(JSON.stringify({ ...old, slackM: 0, scope: 'all', extra: [{ itemId: 'pf', count: 1, scope: 'all' }] }))).toEqual({ ...old, extra: [{ itemId: 'pf', count: 1 }] })
})
it('validates new route fields only for polylines', () => {
  expect(parseQuantityMark(JSON.stringify(mark))).toEqual(mark)
  for (const scope of ['invalid', '', null, 1]) {
    expect(parseQuantityMark(JSON.stringify({ ...mark, scope }))).toBeNull()
    expect(parseQuantityMark(JSON.stringify({ ...mark, extra: [{ itemId: 'pf', count: 1, scope }] }))).toBeNull()
  }
  for (const slackM of [-1, 1001, null, '1']) expect(parseQuantityMark(JSON.stringify({ ...mark, slackM }))).toBeNull()
  expect(parseQuantityMark(JSON.stringify({ ...mark, slackM: 1000 }))?.slackM).toBe(1000)
  for (const method of ['polygon', 'lengthHeight', 'polygonDepth', 'lengthWidthDepth']) {
    const parsed = parseQuantityMark(JSON.stringify({ ...mark, method, slackM: 'invalid', scope: 'invalid' }))
    expect(parsed).not.toBeNull()
    for (const key of ['slackM', 'scope', 'extra', 'count']) expect(parsed).not.toHaveProperty(key)
  }
})
it('round-trips fixture defaults and rejects only invalid fixtures', () => {
  const pf: CountFixture = { ...fixtures[1], routeScope: 'rise', defaults: { addM: 3, slackM: 1 } }
  expect(parseCountFixtures(serializeCountFixtures([pf]))).toEqual([pf])
  for (const changes of [{ routeScope: 'invalid' }, { routeScope: null }, { defaults: { slackM: -1 } }, { defaults: { slackM: 1001 } }, { defaults: { slackM: '1' } }, { kind: 'area', method: 'polygon', routeScope: 'rise' }, { kind: 'count', method: 'click', defaults: { slackM: 1 } }]) {
    expect(parseCountFixtures(JSON.stringify({ version: 1, fixtures: [fixtures[0], { ...pf, ...changes }] }))).toEqual([fixtures[0]])
  }
  const zero = parseCountFixtures(serializeCountFixtures([{ ...pf, routeScope: 'all', defaults: { slackM: 0 } }]))[0]
  expect(zero).not.toHaveProperty('routeScope'); expect(zero.defaults).not.toHaveProperty('slackM')
  expect(Object.values(FIXTURE_PRESETS).flat().every(f => !('routeScope' in f))).toBe(true)
})
it('updates slack and both item scopes with Undo, copy and main-item promotion', async () => {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const a = store.create({ ...annotation(), kind: 'perimeter', rect: [0, 0, 10, 10], measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 1000 } })
  store.updateQuantityValues(a.id, { slackM: 2 }); expect(store.quantityIndex().total('cv')).toBeCloseTo(28.7)
  expect(store.quantityIndex().total('pf')).toBe(3)
  store.undo(); expect(store.get(a.id)?.quantity?.slackM).toBe(1)
  for (const slackM of [NaN, Infinity, -1, 1001, .123]) store.updateQuantityValues(a.id, { slackM })
  expect(store.get(a.id)?.quantity?.slackM).toBe(1)
  store.updateRoute(a.id, 2, mark.extra!, 'rise'); expect(store.quantityIndex().total('cv')).toBe(6)
  store.undo(); expect(store.quantityIndex().total('cv')).toBeCloseTo(26.7)
  store.updateRoute(a.id, 2, [{ itemId: 'pf', count: 1, scope: 'noSlack' }]); expect(store.quantityIndex().total('pf')).toBeCloseTo(12.35)
  store.undo(); expect(store.quantityIndex().total('pf')).toBe(3)
  expect(store.reassignCounts([a.id], 'pf')).toContain('範囲が異なる')
  store.selectOnly(a.id)
  const [copy] = store.pasteAnnotations(store.copySelected(), 1, { width: 500, height: 500 }, 10)
  expect(store.get(copy)?.quantity).toMatchObject({ slackM: 1, extra: mark.extra })
  store.undo()
  store.setCountFixtures(fixtures.slice(1), ['cv'])
  expect(store.get(a.id)?.quantity).toMatchObject({ itemId: 'pf', scope: 'rise', slackM: 1 })
  expect(store.quantityIndex().total('pf')).toBe(3)
  store.undo(); expect(store.quantityIndex().total('cv')).toBeCloseTo(26.7)
  store.updateQuantityValues(a.id, { slackM: 0 }); expect(store.get(a.id)?.quantity).not.toHaveProperty('slackM')
})
