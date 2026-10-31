import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { routeSetSummary } from '../src/app/routeSets'
import { parseQuantityMark, routeRises } from '../src/core/quantity'

async function setup() {
  const store = new AnnotationStore()
  const fixtures: CountFixture[] = ['cv', 'pf', 'other'].map((id, order) => ({ id, order, name: id, code: id, category: '例', kind: 'length', method: 'polyline', style: nextCountStyle([]), conditions: ['ラック', '管内'] }))
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const a = store.create({ pageIndex: 2, kind: 'perimeter', rect: [0, 0, 10, 10], vertices: [[0, 0], [10, 0], [10, 10], [20, 10]],
    measure: { kind: 'perimeter', mmPerPoint: 1000, unit: 'm', decimals: 2 },
    quantity: { version: 1, id: 'quantity', itemId: 'cv', method: 'polyline', floor: '2階', room: '廊下', count: 2, slackM: 1,
      rises: [{ m: 1 }, { m: 2, at: 0 }, { m: 3, at: 1 }, { m: 4, at: 2 }, { m: 5, at: 3 }],
      cond: { plan: 'ラック', rise: ['管内', null, 'ラック', undefined, '管内'], slack: '管内' },
      extra: [{ itemId: 'pf', count: 3, cond: { plan: null, rise: [null, '管内', 'ラック', '管内', undefined], slack: null } }] } })
  return { store, a }
}
it('splits vertices, rise positions and each member condition without changing per-condition totals; one Undo and Redo', async () => {
  const { store, a } = await setup()
  const original = store.get(a.id)!, totals = ['cv', 'pf'].map(id => store.quantityIndex().total(id))
  const breakdown = ['cv', 'pf'].map(id => [...store.quantityIndex().byCondition(id)].map(([c, v]) => [c, v.total]).sort())
  const id = store.splitRoute(a.id, 1)!
  const left = store.get(a.id)!, right = store.get(id)!
  expect(left.vertices).toEqual([[0, 0], [10, 0]])
  expect(right.vertices).toEqual([[10, 0], [10, 10], [20, 10]])
  expect(routeRises(left.quantity!)).toEqual([{ m: 1 }, { m: 2, at: 0 }])
  expect(routeRises(right.quantity!)).toEqual([{ m: 3, at: 0 }, { m: 4, at: 1 }, { m: 5, at: 2 }])
  expect(left.quantity!.cond!.rise).toEqual(['管内', null])
  expect(right.quantity!.cond!.rise).toEqual(['ラック', undefined, '管内'])
  expect(right.quantity!.extra![0].cond!.rise).toEqual(['ラック', '管内', undefined])
  expect(right.quantity).toMatchObject({ count: 2, floor: '2階', room: '廊下', slackM: 0 })
  expect(left.quantity!.slackM).toBe(1)
  expect(right.quantity!.id).not.toBe(original.quantity!.id)
  for (const key of ['pageIndex', 'measure', 'color', 'fontSize', 'quantityDash'] as const) expect(right[key]).toEqual(original[key])
  expect(store.selectedIds()).toEqual([id])
  expect(['cv', 'pf'].map(id => store.quantityIndex().total(id))).toEqual(totals)
  expect(['cv', 'pf'].map(id => [...store.quantityIndex().byCondition(id)].map(([c, v]) => [c, v.total]).sort())).toEqual(breakdown)
  store.undo(); expect(store.get(id)).toBeUndefined(); expect(store.get(a.id)!.quantity).toEqual(original.quantity); expect(store.get(a.id)!.vertices).toEqual(original.vertices)
  store.redo(); expect(store.get(id)!.vertices).toEqual(right.vertices)
})
it('rejects endpoints, fractions and non-route annotations without adding Undo', async () => {
  const { store, a } = await setup()
  for (const index of [0, 3, -1, 1.5, NaN]) expect(store.splitRoute(a.id, index)).toBeUndefined()
  expect(store.splitRoute('missing', 1)).toBeUndefined()
  store.undo(); expect(store.get(a.id)).toBeUndefined()
})
it('bulk conditions ignore routes without the member and undo in one step', async () => {
  const { store, a } = await setup()
  const other = store.create({ ...a, quantity: { version: 1, id: 'other', method: 'polyline', itemId: 'other' } })
  const second = store.create({ ...a, quantity: { ...a.quantity!, id: 'second' } })
  const originals = [a.id, other.id, second.id].map(id => store.get(id)!.quantity)
  store.setRouteCondition([a.id, other.id, second.id], 'pf', 'plan', 'ラック')
  expect(store.get(other.id)!.quantity).toEqual(originals[1])
  expect(store.get(a.id)!.quantity!.extra![0].cond!.plan).toBe('ラック')
  expect(store.get(second.id)!.quantity!.extra![0].cond!.plan).toBe('ラック')
  store.undo(); expect([a.id, other.id, second.id].map(id => store.get(id)!.quantity)).toEqual(originals)
})
it('clears inherited composition and conditions for the item while preserving the drawing and defaults', async () => {
  const { store, a } = await setup()
  const original = store.get(a.id)!.quantity
  store.clearRouteInheritance('cv')
  expect(store.lastRouteConditions.has('cv')).toBe(false)
  expect(store.routeTemplateItems('cv')).toEqual({ cond: {} })
  expect(store.get(a.id)!.quantity).toEqual(original)
  store.undo(); expect(store.get(a.id)).toBeUndefined()
})
it('vertex highlight has no quantity invalidation, dirty edit or Undo entry', async () => {
  const { store, a } = await setup(), index = store.quantityIndex()
  store.setHighlightedVertex({ annotationId: a.id, vertexIndex: 1 })
  expect(store.highlightedVertex).toEqual({ annotationId: a.id, vertexIndex: 1 })
  expect(store.quantityIndex()).toBe(index)
  store.setHighlightedVertex(null); store.undo(); expect(store.get(a.id)).toBeUndefined()
})
it('keeps legacy rise-only totals and shows conditions in saved-composition summaries', () => {
  expect(parseQuantityMark(JSON.stringify({ version: 1, id: 'old', itemId: 'cv', method: 'polyline', addM: 3, scope: 'rise' }))!.cond).toEqual({ plan: null, slack: null })
  expect(routeSetSummary({ items: [{ code: 'CV', spec: '5.5sq-3C', name: 'CV', category: '例', count: 1, cond: { plan: 'ラック', rise: '管内' } }, { code: 'PF22', name: 'PF', category: '例', count: 1, cond: { plan: null, slack: null } }] })).toBe('CV 5.5sq-3C（ラック／管内）＋PF22（立上り）')
})

it('abbreviates long construction names in saved composition summaries', () => {
  expect(routeSetSummary({ items: [{ code: 'CV', name: 'CV', category: '例', count: 1, cond: { plan: 'ケーブルラック配線', rise: '管内配線' } }] })).toBe('CV（ラック／管内）')
})
