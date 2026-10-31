import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { routeRises, serializeQuantityMark, type QuantityMark, type PartCondition } from '../src/core/quantity'

async function setup(conditions = ['管内', 'ラック']) {
  const store = new AnnotationStore()
  const fixtures: CountFixture[] = ['cv', 'pf', 'area', 'led'].map((id, order) => ({ id, order, code: id, name: id, category: '例',
    kind: id === 'area' ? 'area' : id === 'led' ? 'count' : 'length', method: id === 'area' ? 'polygon' : id === 'led' ? 'click' : 'polyline',
    style: nextCountStyle([]), conditions }))
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const a = store.create({ pageIndex: 0, kind: 'perimeter', rect: [0, 0, 10, 10], vertices: [[0, 0], [10, 0], [10, 10]],
    measure: { kind: 'perimeter', mmPerPoint: 1000, unit: 'm', decimals: 2 },
    quantity: { version: 1, id: 'q', itemId: 'cv', method: 'polyline', count: 2, slackM: 1,
      rises: [{ m: 1.25, at: 0 }, { m: 2.5, at: 1 }, { m: 3.75, at: 2 }],
      cond: { plan: 'ラック', rise: ['管内', null, 'ラック'], slack: '管内' },
      extra: [{ itemId: 'pf', count: 3, cond: { plan: null, rise: [undefined, 'ラック', '管内'], slack: null } }] } })
  return { store, a }
}

it('removes the middle rise and every member condition at the same index; preserves vertices and at; one Undo/Redo', async () => {
  const { store, a } = await setup(), original = store.get(a.id)!, memory = structuredClone(store.lastRouteConditions)
  store.removeRouteRise(a.id, 1)
  const changed = store.get(a.id)!
  expect(routeRises(changed.quantity!)).toEqual([{ m: 1.25, at: 0 }, { m: 3.75, at: 2 }])
  expect(changed.vertices).toEqual(original.vertices)
  expect(changed.quantity!.addM).toBe(5)
  expect(changed.quantity!.cond).toEqual({ plan: 'ラック', rise: ['管内', 'ラック'], slack: '管内' })
  expect(changed.quantity!.extra![0].cond!.rise).toEqual([undefined, '管内'])
  expect(store.quantityIndex().total('cv')).toBe(52)
  expect(store.quantityIndex().total('pf')).toBe(15)
  expect(store.quantityIndex().byCondition('cv').get('管内')!.rise).toBe(2.5)
  expect(store.quantityIndex().byCondition('cv').get('ラック')!.rise).toBe(7.5)
  store.undo(); expect(store.get(a.id)!.quantity).toEqual(original.quantity); expect(store.lastRouteConditions).toEqual(memory)
  store.redo(); expect(store.get(a.id)!.quantity).toEqual(changed.quantity)
})

it.each<PartCondition>(['管内', null, undefined])('leaves a shared rise condition unchanged: %s', async condition => {
  const { store, a } = await setup()
  for (const itemId of ['cv', 'pf']) store.setRouteCondition([a.id], itemId, 'rise', condition)
  const original = store.get(a.id)!.quantity
  store.removeRouteRise(a.id, 1)
  expect(store.get(a.id)!.quantity!.cond!.rise).toBe(condition)
  expect(store.get(a.id)!.quantity!.extra![0].cond!.rise).toBe(condition)
  store.undo(); expect(store.get(a.id)!.quantity).toEqual(original)
})

it('rejects invalid removal indices without adding history; removes the final rise without reviving addM', async () => {
  const { store, a } = await setup(), original = store.get(a.id)!.quantity
  for (const i of [-1, 3, 1.5, NaN]) store.removeRouteRise(a.id, i)
  store.removeRouteRise('missing', 0)
  expect(store.get(a.id)!.quantity).toEqual(original)
  store.undo(); expect(store.get(a.id)).toBeUndefined(); store.redo()
  store.removeRouteRise(a.id, 2); store.removeRouteRise(a.id, 0); store.removeRouteRise(a.id, 0)
  expect(store.get(a.id)!.quantity!.addM).toBe(0)
  expect(routeRises(store.get(a.id)!.quantity!)).toEqual([])
  expect(store.get(a.id)!.quantity!.cond!.rise).toEqual([])
})

it('adds a route candidate and applies it to the selected member/rise in one Undo/Redo, including inheritance', async () => {
  const { store, a } = await setup(), fixtures = store.getCountFixtures(), original = store.get(a.id)!.quantity, memory = structuredClone(store.lastRouteConditions)
  expect(store.addConditionAndSetRoute('pf', '工区A', [a.id], 'pf', 'rise', 1)).toBeUndefined()
  expect(store.getCountFixture('pf')!.conditions).toEqual(['管内', 'ラック', '工区A'])
  expect(store.getCountFixture('cv')!.conditions).toEqual(['管内', 'ラック'])
  expect(store.get(a.id)!.quantity!.extra![0].cond!.rise).toEqual([undefined, '工区A', '管内'])
  expect(store.get(a.id)!.quantity!.cond).toEqual(original!.cond)
  store.undo(); expect(store.getCountFixtures()).toEqual(fixtures); expect(store.get(a.id)!.quantity).toEqual(original); expect(store.lastRouteConditions).toEqual(memory)
  store.redo(); expect(store.getCountFixture('pf')!.conditions).toContain('工区A'); expect(store.get(a.id)!.quantity!.extra![0].cond!.rise![1]).toBe('工区A')
})

it('adds and applies to multiple routes while ignoring routes without the member', async () => {
  const { store, a } = await setup()
  const second = store.create({ ...a, quantity: { ...a.quantity!, id: 'second' } })
  const other = store.create({ ...a, quantity: { version: 1, id: 'other', itemId: 'cv', method: 'polyline', extra: [], cond: {} } })
  const originals = [a.id, second.id, other.id].map(id => store.get(id)!.quantity)
  store.addConditionAndSetRoute('pf', '工区B', [a.id, second.id, other.id], 'pf', 'plan')
  for (const id of [a.id, second.id]) expect(store.get(id)!.quantity!.extra![0].cond!.plan).toBe('工区B')
  expect(store.get(other.id)!.quantity).toEqual(originals[2])
  store.undo(); expect([a.id, second.id, other.id].map(id => store.get(id)!.quantity)).toEqual(originals); expect(store.getCountFixture('pf')!.conditions).not.toContain('工区B')
})

it.each(['area', 'led'])('adds and applies to multiple %s pickups with one Undo/Redo', async itemId => {
  const { store, a } = await setup()
  const ids = itemId === 'led' ? store.createCountMarks('led', [{ pageIndex: 0, center: [0, 0] }, { pageIndex: 0, center: [20, 0] }])
    : [0, 1].map(i => store.create({ ...a, kind: 'area', measure: { kind: 'area', mmPerPoint: 1000, unit: 'm', decimals: 2 },
      quantity: { version: 1, id: 'area' + i, itemId: 'area', method: 'polygon' } }).id)
  const marks = () => ids.map(id => { const a = store.get(id)!; return { quantity: a.quantity, count: a.count } })
  const fixtures = store.getCountFixtures(), original = marks(), memory = structuredClone(store.lastCondition)
  expect(store.addConditionAndSetQuantity(itemId, '工区C', [...ids, a.id])).toBeUndefined()
  for (const id of ids) expect(store.get(id)!.quantity?.condition ?? (store.get(id)!.count as { condition?: string }).condition).toBe('工区C')
  expect(store.getCountFixture(itemId)!.conditions).toContain('工区C')
  expect(store.get(a.id)!.quantity!.condition).toBeUndefined()
  store.undo(); expect(store.getCountFixtures()).toEqual(fixtures); expect(marks()).toEqual(original); expect(store.lastCondition).toEqual(memory)
  store.redo(); expect(store.getCountFixture(itemId)!.conditions).toContain('工区C'); expect(store.quantityIndex().byCondition(itemId).has('工区C')).toBe(true)
})

it('existing candidates apply even at capacity without duplicates or an extra Undo', async () => {
  const conditions = Array.from({ length: 30 }, (_, i) => '条件' + i), { store, a } = await setup(conditions)
  const original = store.get(a.id)!.quantity
  expect(store.addConditionAndSetRoute('cv', conditions[29], [a.id], 'cv', 'plan')).toBeUndefined()
  expect(store.getCountFixture('cv')!.conditions).toEqual(conditions)
  expect(store.get(a.id)!.quantity!.cond!.plan).toBe(conditions[29])
  store.undo(); expect(store.get(a.id)!.quantity).toEqual(original)
})

it('records a candidate-only edit when the selected part already has that condition', async () => {
  const { store, a } = await setup([]), original = store.get(a.id)!.quantity
  store.addConditionAndSetRoute('cv', 'ラック', [a.id], 'cv', 'plan')
  expect(store.getCountFixture('cv')!.conditions).toEqual(['ラック'])
  store.undo(); expect(store.getCountFixture('cv')!.conditions).toEqual([]); expect(store.get(a.id)!.quantity).toEqual(original)
  store.redo(); expect(store.getCountFixture('cv')!.conditions).toEqual(['ラック'])
})

it.each(['', ' ', 'あ'.repeat(31), ' 管内', '管内 ', '管\n内', '管\r内', '管\u2028内', '管\u2029内'])('invalid names do nothing and return a reason: %j', async condition => {
  const { store, a } = await setup(), original = store.get(a.id)!.quantity, fixtures = store.getCountFixtures(), memory = structuredClone(store.lastRouteConditions)
  expect(store.addConditionAndSetRoute('cv', condition, [a.id], 'cv', 'plan')).toMatch(/1〜30文字/)
  expect(store.addConditionAndSetQuantity('area', condition, [a.id])).toMatch(/1〜30文字/)
  expect(store.getCountFixtures()).toEqual(fixtures); expect(store.get(a.id)!.quantity).toEqual(original); expect(store.lastRouteConditions).toEqual(memory)
  store.undo(); expect(store.get(a.id)).toBeUndefined()
})

it('rejects the 31st candidate without changing fixtures, pickups, memory or Undo', async () => {
  const { store, a } = await setup(Array.from({ length: 30 }, (_, i) => '条件' + i)), original = store.get(a.id)!.quantity, fixtures = store.getCountFixtures()
  expect(store.addConditionAndSetRoute('cv', '追加', [a.id], 'cv', 'rise', 1)).toMatch(/30件/)
  expect(store.addConditionAndSetQuantity('area', '追加', [a.id])).toMatch(/30件/)
  expect(store.getCountFixtures()).toEqual(fixtures); expect(store.get(a.id)!.quantity).toEqual(original)
  store.undo(); expect(store.get(a.id)).toBeUndefined()
})

it('rejects a route exceeding save capacity without leaving candidates, partial bulk edits or inheritance behind', async () => {
  const store = new AnnotationStore(), long = 'あ'.repeat(30)
  const fixtures: CountFixture[] = Array.from({ length: 11 }, (_, order) => ({ id: 'line' + order, order, code: 'L' + order, name: 'line', category: '例',
    kind: 'length', method: 'polyline', style: nextCountStyle([]), conditions: ['x'] }))
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const members = fixtures.map(f => ({ itemId: f.id, count: 1, cond: { plan: long, slack: long, rise: Array<string>(20).fill('x') } }))
  const [main, ...extra] = members
  const mark: QuantityMark = { version: 1, id: 'full', method: 'polyline', ...main, rises: Array.from({ length: 20 }, () => ({ m: 1 })), extra }
  delete mark.count // The store omits a single primary run on creation.
  for (const member of members) for (let i = 0; i < 20; i++) {
    if (member === main && i === 0) continue
    member.cond.rise[i] = long
    if (serializeQuantityMark(mark).length > 8000) member.cond.rise[i] = 'x'
  }
  const input = (quantity: QuantityMark) => ({ pageIndex: 0, kind: 'perimeter' as const, rect: [0, 0, 10, 10] as [number, number, number, number],
    vertices: [[0, 0], [10, 0]] as [number, number][], measure: { kind: 'perimeter' as const, mmPerPoint: 1000, unit: 'm' as const, decimals: 2 as const }, quantity })
  const full = store.create(input(mark))
  const small = store.create(input({ version: 1, id: 'small', itemId: 'line0', method: 'polyline', count: 1, extra: [], rises: [{ m: 1 }], cond: {} }))
  const originals = [small.id, full.id].map(id => store.get(id)!.quantity), memory = structuredClone(store.lastRouteConditions)
  const proposed = structuredClone(store.get(full.id)!.quantity!)
  ;(proposed.cond!.rise as string[])[0] = long
  expect(serializeQuantityMark(proposed).length).toBeGreaterThan(8000)
  const index = store.quantityIndex()
  expect(store.addConditionAndSetRoute('line0', long, [small.id, full.id], 'line0', 'rise', 0)).toMatch(/保存容量/)
  expect([small.id, full.id].map(id => store.get(id)!.quantity)).toEqual(originals)
  expect(store.getCountFixtures()).toEqual(fixtures); expect(store.lastRouteConditions).toEqual(memory); expect(store.quantityIndex()).toBe(index)
  store.undo(); expect(store.get(small.id)).toBeUndefined()
})
