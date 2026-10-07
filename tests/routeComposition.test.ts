import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { nextCountStyle, nextQuantityLineStyle, sameFixtureAppearance, type CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { loadRouteSets, resolveRouteSet, saveRouteSets, type RouteSet } from '../src/app/routeSets'
import { MeasurementShape } from '../src/editor/MeasurementOverlay'

const fixtures: CountFixture[] = Array.from({ length: 12 }, (_, i) => ({ id: 'line' + i, order: i, code: 'L' + i, spec: '5.5sq', name: '線' + i, category: '電線', kind: 'length', method: 'polyline', style: { ...nextCountStyle([]), color: i === 1 ? [0, 0, 1] : [1, 0, 0] }, line: { width: i === 1 ? 3 : 1.5, dash: i === 1 ? 'dotted' : 'solid' } }))
async function setup() {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const a = store.create({ pageIndex: 0, kind: 'perimeter', rect: [0, 0, 72, 20], vertices: [[0, 0], [72, 0]], measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 1000 }, quantity: { version: 1, id: 'route', itemId: 'line0', method: 'polyline', addM: 3, slackM: 1 } })
  return { store, id: a.id }
}
afterEach(() => vi.unstubAllGlobals())
it('promotes the main item, applies its appearance and undoes/redoes once', async () => {
  const { store, id } = await setup(), before = store.get(id)!
  store.setRouteItems(id, [{ itemId: 'line1', count: 2, scope: 'rise' }, { itemId: 'line0', count: 3, scope: 'noSlack' }])
  expect(store.get(id)).toMatchObject({ color: [0, 0, 1], borderWidth: 3, quantityDash: 'dotted', quantity: { itemId: 'line1', count: 2, scope: 'rise', extra: [{ itemId: 'line0', count: 3, scope: 'noSlack' }], addM: 3, slackM: 1 } })
  expect(store.quantityIndex().total('line1')).toBe(6)
  store.undo(); expect(store.get(id)?.quantity).toEqual(before.quantity); expect(store.get(id)?.color).toEqual(before.color)
  store.redo(); expect(store.get(id)?.quantity?.itemId).toBe('line1')
})
it('rejects duplicates, twelve entries, invalid counts/scopes and non-length items without history', async () => {
  for (const items of [
    [{ itemId: 'line0', count: 1 }, { itemId: 'line0', count: 2 }],
    fixtures.map(f => ({ itemId: f.id, count: 1 })),
    [{ itemId: 'line0', count: 0 }], [{ itemId: 'line0', count: 100 }], [{ itemId: 'line0', count: 1.5 }],
    [{ itemId: 'missing', count: 1 }], [],
    [{ itemId: 'line0', count: 1, scope: 'invalid' as 'all' }],
  ]) {
    const { store, id } = await setup(), before = store.get(id)?.quantity
    store.setRouteItems(id, items); expect(store.get(id)?.quantity).toEqual(before)
    store.undo(); expect(store.get(id)).toBeUndefined()
  }
  const { store, id } = await setup()
  store.setCountFixtures([...fixtures, { ...fixtures[0], id: 'count', kind: 'count', method: 'click' }])
  store.setRouteItems(id, [{ itemId: 'count', count: 1 }]); expect(store.get(id)?.quantity?.itemId).toBe('line0')
  store.undo(); expect(store.getCountFixture('count')).toBeUndefined()
})
it('allows eleven entries and 99 strands and treats default scopes as unchanged', async () => {
  const { store, id } = await setup()
  const items = fixtures.slice(0, 11).map(f => ({ itemId: f.id, count: 99, scope: 'all' as const }))
  store.setRouteItems(id, items); expect(store.get(id)?.quantity?.extra).toHaveLength(10)
  store.setRouteItems(id, items.map(e => ({ ...e, scope: undefined })))
  store.undo(); expect(store.get(id)?.quantity?.extra).toBeUndefined()
  store.setRouteItems(id, [{ itemId: 'line0', count: 1, scope: 'all' }])
  store.undo(); expect(store.get(id)).toBeUndefined()
})
it('adds catalog items and replaces a route in one atomic history step', async () => {
  const { store, id } = await setup(), appearance = nextQuantityLineStyle(fixtures)
  const newFixture: CountFixture = { ...fixtures[0], id: 'new', order: 12, code: 'PF28', name: '管', style: { ...fixtures[0].style, color: appearance.color }, line: appearance.line }
  store.addFixturesAndSetRouteItems([newFixture], id, [{ itemId: 'new', count: 2, scope: 'rise' }, { itemId: 'line0', count: 1 }])
  expect(store.getCountFixture('new')).toBeDefined(); expect(store.get(id)?.quantity?.itemId).toBe('new')
  store.undo(); expect(store.getCountFixture('new')).toBeUndefined(); expect(store.get(id)?.quantity).toMatchObject({ itemId: 'line0' }); expect(store.get(id)?.quantity?.extra).toBeUndefined()
  store.redo(); expect(store.getCountFixture('new')).toBeDefined(); expect(store.get(id)?.quantity).toMatchObject({ itemId: 'new', count: 2, scope: 'rise', extra: [{ itemId: 'line0', count: 1 }] })
})
it('does not add fixtures when the proposed route is invalid', async () => {
  const { store, id } = await setup()
  store.addFixturesAndSetRouteItems([{ ...fixtures[0], id: 'new', order: 12 }], id, [{ itemId: 'new', count: 0 }])
  expect(store.getCountFixture('new')).toBeUndefined(); store.undo(); expect(store.get(id)).toBeUndefined()
})
it('uses the template for a new route, filters deleted items and clears on another fixture', async () => {
  const { store } = await setup()
  store.selectFixture('line0')
  store.setRouteTemplate({ itemId: 'line0', count: 2, scope: 'noSlack', extra: [{ itemId: 'line1', count: 3, scope: 'rise' }, { itemId: 'deleted', count: 1 }], name: '幹線A' })
  const template = store.routeTemplateItems('line0')
  expect(template).toEqual({ count: 2, scope: 'noSlack', extra: [{ itemId: 'line1', count: 3, scope: 'rise' }] })
  const a = store.create({ pageIndex: 0, kind: 'perimeter', rect: [0, 0, 72, 20], vertices: [[0, 0], [72, 0]], measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 1000 }, quantity: { version: 1, id: 'new', itemId: 'line0', method: 'polyline', ...template } })
  expect(a.quantity).toMatchObject({ count: 2, extra: [{ itemId: 'line1', count: 3, scope: 'rise' }] })
  store.selectFixture('line0'); expect(store.routeTemplate).not.toBeNull()
  store.selectFixture('line1'); expect(store.routeTemplate).toBeNull(); expect(store.routeTemplateItems('line1')).toEqual({})
  store.setRouteTemplate({ itemId: 'missing', count: 1, extra: [], name: '欠損' }); expect(store.routeTemplateItems('missing')).toEqual({})
})
const set: RouteSet = { id: 'set', name: '幹線A', items: [{ code: 'L0', spec: '5.5sq', name: '線0', category: '別分類', count: 2 }, { code: 'PF28', name: '管', category: '電線管', count: 1, scope: 'rise' }, { code: 'IV', spec: '14sq', name: '接地線', category: '電線', count: 1 }] }
function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  return values
}
it('saves and loads route sets, caps at 50 and safely handles corrupt/unavailable storage', () => {
  const values = storage(); saveRouteSets([set]); expect(loadRouteSets()).toEqual([set])
  saveRouteSets(Array.from({ length: 51 }, (_, i) => ({ ...set, id: String(i) }))); expect(loadRouteSets()).toHaveLength(50)
  for (const invalid of ['{', 'null', '{}', '[{"id":"broken"}]']) { values.set('karu-pdf:route-sets', invalid); expect(loadRouteSets()).toEqual([]) }
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } })
  expect(loadRouteSets()).toEqual([]); expect(() => saveRouteSets([set])).not.toThrow()
})
it('matches code/spec/name only for length items and allocates distinct appearances for missing ones', () => {
  const result = resolveRouteSet(set, fixtures)
  expect(result.items[0]).toEqual({ itemId: 'line0', count: 2, scope: undefined }); expect(result.newFixtures).toHaveLength(2)
  expect(result.items[1]).toMatchObject({ count: 1, scope: 'rise' })
  const all = [...fixtures]
  for (const f of result.newFixtures) { expect(all.some(existing => sameFixtureAppearance(existing, f))).toBe(false); all.push(f) }
  const wrongSpec = { ...fixtures[0], spec: '14sq' }, wrongName = { ...fixtures[0], name: '別名' }, count = { ...fixtures[0], kind: 'count' as const, method: 'click' as const }
  for (const f of [wrongSpec, wrongName, count]) expect(resolveRouteSet({ ...set, items: set.items.slice(0, 1) }, [f]).newFixtures).toHaveLength(1)
})
it('renders the composite badge at the start even with quantity values hidden; single routes have none', () => {
  const props = { points: [[10, 20], [72, 20]] as [number, number][], kind: 'perimeter' as const, text: 'quantity', fontSize: 10, color: '#123456', width: 1.5, opacity: 1, showText: false }
  const single = renderToStaticMarkup(createElement(MeasurementShape, props))
  expect(single).not.toContain('route-composition-badge')
  const composite = renderToStaticMarkup(createElement(MeasurementShape, { ...props, routeComposition: { count: 3, title: 'CV×2、PF28（立上り）、IV' } }))
  expect(composite).toContain('transform="translate(10 20)"'); expect(composite).toContain('pointer-events="none"')
  expect(composite).toContain('height="12"'); expect(composite).toContain('<title>CV×2、PF28（立上り）、IV</title>')
  expect(composite).not.toContain('measurement-label'); expect(composite).toContain('>3</text>')
})
