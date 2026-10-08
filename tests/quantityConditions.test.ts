import { afterEach, expect, it, vi } from 'vitest'
import { parseQuantityMark, serializeQuantityMark, routeMembers, routeRises, riseCondition, routePortions, routeMemberLength, conditionScope, withRouteScope, quantityLabel, type QuantityMark, type RouteConditions } from '../src/core/quantity'
import { parseCount } from '../src/core/counts'
import { QuantityIndex } from '../src/core/quantityIndex'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { loadRouteSets, saveRouteSets } from '../src/app/routeSets'
import { legacyParseQuantityMark } from './legacyQuantityParser'

const base: QuantityMark = { version: 1, id: 'route', itemId: 'cv', method: 'polyline' }
const parse = (q: object) => parseQuantityMark(JSON.stringify(q))
const fixtures: CountFixture[] = ['cv', 'pf', 'rack', 'area', 'led'].map((id, order) => ({ id, order, code: id, name: id, category: '例', kind: id === 'led' ? 'count' : id === 'area' ? 'area' : 'length', method: id === 'led' ? 'click' : id === 'area' ? 'polygon' : 'polyline', style: nextCountStyle([]) }))
const annotation = (id: string, quantity: QuantityMark, pageIndex = 0) => ({ id, pageIndex, quantity, vertices: [[0, 0], [10, 0], [10, 2], [0, 2]] as [number, number][], measure: { mmPerPoint: 1000 } })
const routeInput = (q: QuantityMark = base, pageIndex = 0) => ({ pageIndex, kind: 'perimeter' as const, rect: [0, 0, 10, 1] as [number, number, number, number], vertices: [[0, 0], [10, 0]] as [number, number][], measure: { kind: 'perimeter' as const, mmPerPoint: 1000, unit: 'mm' as const, decimals: null }, quantity: q })
async function setup(q: QuantityMark = { ...base, addM: 3, slackM: 1 }) {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const a = store.create(routeInput(q))
  return { store, id: a.id }
}
afterEach(() => vi.unstubAllGlobals())

it.each(['all', 'noSlack', 'rise'] as const)('migrates legacy %s and extra scopes without inventing conditions', scope => {
  const q = parse({ ...base, addM: 3, slackM: 1, count: 2, scope, extra: [{ itemId: 'pf', count: 3, scope: 'rise' }, { itemId: 'rack', count: 1, scope: 'noSlack' }] })!
  expect(q).not.toHaveProperty('scope')
  expect(q.rises).toEqual([{ m: 3 }])
  expect(q.cond).toEqual(scope === 'rise' ? { plan: null, slack: null } : scope === 'noSlack' ? { slack: null } : {})
  expect(q.extra).toEqual([{ itemId: 'pf', count: 3, cond: { plan: null, slack: null } }, { itemId: 'rack', count: 1, cond: { slack: null } }])
  expect(routeMemberLength(10, q, q.cond)).toBe(scope === 'rise' ? 3 : scope === 'noSlack' ? 13 : 14)
  const legacy = legacyParseQuantityMark(serializeQuantityMark(q))!
  expect(legacy).not.toBeNull()
  for (const [i, member] of routeMembers(q).entries()) {
    const oldMember = i ? legacy.extra![i - 1] : { count: legacy.count ?? 1, scope: legacy.scope }
    const oldLength = oldMember.scope === 'rise' ? legacy.addM! : 10 + legacy.addM! + (oldMember.scope === 'noSlack' ? 0 : legacy.slackM!)
    expect(routeMemberLength(10, q, member.cond) * member.count).toBe(oldLength * oldMember.count)
  }
})

it('prefers new rises and conditions over conflicting legacy fields', () => {
  const q = parse({ ...base, addM: 900, rises: [{ m: 1.01, at: 0 }, { m: 2.02 }], scope: 'rise', cond: { plan: 'ラック', rise: ['管内', null] }, extra: [{ itemId: 'pf', count: 1, scope: 'bad', cond: { slack: null } }] })!
  expect(q.addM).toBe(3.03)
  expect(q.cond).toEqual({ plan: 'ラック', rise: ['管内', null] })
  expect(q.extra![0].cond).toEqual({ slack: null })
  expect(routeMemberLength(10, q, q.cond)).toBe(11.01)
})

it('round-trips multiple rises, excluded parts, unset array positions and condition labels', () => {
  const q = parse({ ...base, count: 2, rises: [{ m: 2, at: 0 }, { m: 3 }, { m: 0 }], slackM: 1, cond: { plan: 'ラック', rise: ['管内', null], slack: null }, extra: [{ itemId: 'pf', count: 3, cond: { plan: null, rise: '露出', slack: null } }] })!
  q.cond!.rise = ['管内', undefined, null]
  expect(parseQuantityMark(serializeQuantityMark(q))).toStrictEqual(q)
  expect(routePortions(10, q, q.cond!)).toEqual([{ part: 'plan', lengthM: 10, condition: 'ラック' }, { part: 'rise', riseIndex: 0, lengthM: 2, condition: '管内' }, { part: 'rise', riseIndex: 1, lengthM: 3 }])
  expect(riseCondition(q.cond!, 1)).toBeUndefined()
  expect(quantityLabel([[0, 0], [10, 0]], 1000, q, 'CV', true, () => 'PF')).toContain('CV（ラック／管内）×2, PF（立上り）×3')
})

it('writes short single rises and empty conditions, and preserves zero/empty rises', () => {
  const q = parse({ ...base, addM: 3, scope: 'noSlack' })!
  const raw = JSON.parse(serializeQuantityMark(q))
  expect(raw.rises).toBeUndefined()
  expect(raw.scope).toBe('noSlack')
  expect(raw.cond).toEqual({ slack: null })
  expect(JSON.parse(serializeQuantityMark(parse(base)!))).not.toHaveProperty('cond')
  for (const rises of [[], [{ m: 0 }], [{ m: 3, at: 0 }]]) {
    const mark = parse({ ...base, rises })!
    expect(parseQuantityMark(serializeQuantityMark(mark))).toStrictEqual(mark)
  }
  // Legacy sub-centimetre addM remains intact even though new explicit rises use centimetres.
  for (const addM of [.123, 1e-12, Math.PI / 10]) {
    const old = parse({ ...base, addM })!
    expect(parseQuantityMark(serializeQuantityMark(old))).toStrictEqual(old)
  }
})

it('uses documented approximate scopes for masks the old app cannot represent', () => {
  for (const cond of [{ plan: null }, { rise: [null, '管内'], slack: null }, { plan: null, slack: null, rise: null }]) {
    const q = parse({ ...base, rises: [{ m: 2 }, { m: 3 }], slackM: 1, cond })!
    const old = legacyParseQuantityMark(serializeQuantityMark(q))!
    expect(old).not.toBeNull()
    expect(old.scope).toBe(cond.plan === null && cond.slack === null ? 'rise' : cond.slack === null ? 'noSlack' : undefined)
    expect(parseQuantityMark(serializeQuantityMark(q))).toStrictEqual(q)
  }
})

it('validates all new fields and retains the larger parse limit', () => {
  for (const condition of ['', ' ラック', 'ラック ', '管\n内', 'a'.repeat(31), 1, null]) {
    if (condition === null) expect(parse({ ...base, cond: { plan: condition } })).not.toBeNull()
    else expect(parse({ ...base, cond: { plan: condition } })).toBeNull()
    expect(parse({ ...base, method: 'polygon', condition })).toBeNull()
    expect(parseCount(JSON.stringify({ version: 2, id: 'c', fixtureId: 'led', condition }))).toBeNull()
  }
  for (const cond of [null, [], 1, { rise: Array(21).fill('管内') }, { rise: [''] }, { slack: 3 }, { rise: [null], riseUnset: [1] }]) expect(parse({ ...base, cond })).toBeNull()
  for (const rises of [null, Array(21).fill({ m: 1 }), [null], [{ m: -1 }], [{ m: 1001 }], [{ m: .001 }], [{ m: 1, at: -1 }], [{ m: 1, at: 1.2 }]]) expect(parse({ ...base, rises })).toBeNull()
  const q = { ...base, rises: Array(20).fill({ m: 1000 }), cond: { rise: Array(20).fill('管内') }, ignored: 'x'.repeat(2100) }
  expect(parse(q)?.addM).toBe(20000)
  expect(parseQuantityMark(JSON.stringify(q) + ' '.repeat(8000))).toBeNull()
  expect(routeRises({ addM: 3 })).toEqual([{ m: 3 }])
})

it('caches condition subtotals and includes area/count conditions with unset keys', () => {
  const q = parse({ ...base, count: 2, rises: [{ m: 2 }, { m: 3 }], slackM: 1, cond: { plan: 'ラック', rise: ['ラック', '管内'] }, extra: [{ itemId: 'pf', count: 3, cond: { plan: null, rise: [null, '露出'], slack: null } }] })!
  const index = QuantityIndex.build([annotation('a', q), annotation('area', { ...base, itemId: 'area', method: 'polygon', condition: '屋外' }, 1), { id: 'count', pageIndex: 1, count: { version: 2, id: 'c', fixtureId: 'led', condition: '壁付' } }], fixtures)
  // The polygon-shaped line's plan length is 22 m.
  expect(index.total('cv')).toBe(56)
  expect(index.byPage('cv').get(0)).toBe(56)
  expect(index.entries('cv')).toHaveLength(4)
  expect(index.total('pf')).toBe(9)
  const totals = index.byCondition('cv')
  expect(totals.get('ラック')).toEqual({ plan: 44, rise: 4, slack: 0, other: 0, total: 48, annotationIds: new Set(['a']) })
  expect(totals.get('管内')?.rise).toBe(6)
  expect(totals.get('')?.slack).toBe(2)
  expect(index.byCondition('area').get('屋外')?.other).toBe(20)
  expect(index.byCondition('led').get('壁付')?.other).toBe(1)
  const entries = vi.spyOn(index, 'entries').mockImplementation(() => { throw new Error('condition cache must not scan entries') })
  totals.get('ラック')!.annotationIds.clear(); totals.get('ラック')!.total = -1
  expect(index.byCondition('cv').get('ラック')!.annotationIds.size).toBe(1)
  expect(index.byCondition('cv').get('ラック')!.total).toBe(48)
  entries.mockRestore()
})

it('keeps the temporary scope selector compatible while preserving counted-part names', () => {
  const c: RouteConditions = { plan: 'ラック', rise: ['管内', '露出'], slack: '盤内' }
  expect(conditionScope(c)).toBe('all')
  expect(withRouteScope(c, 'noSlack')).toEqual({ ...c, slack: null })
  expect(withRouteScope(c, 'rise')).toEqual({ ...c, plan: null, slack: null })
  expect(withRouteScope(withRouteScope(c, 'rise'), 'all', c)).toEqual(c)
  expect(conditionScope({ rise: [null] })).toBe('custom')
  expect(conditionScope({ plan: null, slack: '盤内' })).toBe('custom')
})

it('sets members and rises with isolated snapshots, resizing arrays and Undo/Redo', async () => {
  const { store, id } = await setup()
  const original = store.get(id)!.quantity
  store.setRouteMembers(id, [{ itemId: 'cv', count: 2, cond: { rise: ['管内'] } }, { itemId: 'pf', count: 3, cond: { rise: [null] } }])
  const members = store.get(id)!.quantity
  store.undo(); expect(store.get(id)!.quantity).toStrictEqual(original)
  store.redo(); expect(store.get(id)!.quantity).toStrictEqual(members)
  store.setRouteRises(id, [{ m: 2, at: 0 }, { m: 3 }])
  expect(store.get(id)!.quantity).toMatchObject({ addM: 5, rises: [{ m: 2, at: 0 }, { m: 3 }] })
  expect(store.get(id)!.quantity!.cond!.rise).toStrictEqual(['管内', undefined])
  expect(store.get(id)!.quantity!.extra![0].cond!.rise).toStrictEqual([null, undefined])
  const two = store.get(id)!.quantity
  const externalRise = store.get(id)!.quantity!.cond!.rise as Array<string | null | undefined>
  externalRise[0] = 'outside snapshot mutation'
  store.updateQuantityAdd(id, 10); expect(store.get(id)!.quantity).toStrictEqual(two)
  store.updateQuantityValues(id, { addM: 10 }); expect(store.get(id)!.quantity).toStrictEqual(two)
  store.undo(); expect(store.get(id)!.quantity).toStrictEqual(members)
  store.redo(); expect(store.get(id)!.quantity).toStrictEqual(two)
  store.setRouteRises(id, [{ m: 4 }]); expect(store.get(id)!.quantity!.cond!.rise).toEqual(['管内'])
  store.undo(); expect(store.get(id)!.quantity).toStrictEqual(two)
  store.redo(); store.updateQuantityAdd(id, 0)
  expect(store.get(id)!.quantity!.rises).toEqual([{ m: 0 }])
  expect(parseQuantityMark(serializeQuantityMark(store.get(id)!.quantity!))).toStrictEqual(store.get(id)!.quantity)
})

it('sets specific/all rise conditions across a selection in one Undo, including null-to-unset', async () => {
  const { store, id } = await setup({ ...base, rises: [{ m: 2 }, { m: 3 }], cond: { rise: '管内' }, extra: [{ itemId: 'pf', count: 1, cond: { rise: [null, null] } }] })
  const second = store.create(routeInput(store.get(id)!.quantity!, 1))
  const before = [store.get(id)!.quantity, store.get(second.id)!.quantity]
  store.setRouteCondition([id, second.id, id, 'missing'], 'pf', 'rise', undefined, 0)
  for (const a of [id, second.id]) expect(store.get(a)!.quantity!.extra![0].cond!.rise).toStrictEqual([undefined, null])
  store.undo(); expect([store.get(id)!.quantity, store.get(second.id)!.quantity]).toStrictEqual(before)
  store.redo()
  store.setRouteCondition([id, second.id], 'cv', 'rise', '露出')
  for (const a of [id, second.id]) expect(store.get(a)!.quantity!.cond!.rise).toBe('露出')
  store.undo(); expect(store.get(id)!.quantity!.cond!.rise).toBe('管内')
  store.redo(); expect(store.get(second.id)!.quantity!.cond!.rise).toBe('露出')
})

it('sets area/count conditions together, inherits them, and leaves lines unchanged', async () => {
  const { store, id } = await setup()
  const area = store.create(routeInput({ ...base, itemId: 'area', method: 'polygon' }))
  const count = store.create({ pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10], count: { version: 1, id: 'c', group: 'legacy' } })
  const before = [store.get(area.id)!.quantity, store.get(count.id)!.count]
  store.setQuantityCondition([id, area.id, count.id], '屋外')
  expect(store.get(id)!.quantity).not.toHaveProperty('condition')
  expect(store.get(area.id)!.quantity!.condition).toBe('屋外')
  expect(store.get(count.id)!.count).toMatchObject({ version: 2, condition: '屋外' })
  const changed = [store.get(area.id)!.quantity, store.get(count.id)!.count]
  store.undo(); expect([store.get(area.id)!.quantity, store.get(count.id)!.count]).toStrictEqual(before)
  store.redo(); expect([store.get(area.id)!.quantity, store.get(count.id)!.count]).toStrictEqual(changed)
  const next = store.create(routeInput({ ...base, itemId: 'area', method: 'polygon' }))
  expect(next.quantity!.condition).toBe('屋外')
  store.setQuantityCondition([area.id], undefined); expect(store.lastCondition.has('area')).toBe(true); expect(store.lastCondition.get('area')).toBeUndefined()
  store.undo(); expect(store.get(area.id)!.quantity!.condition).toBe('屋外')
  store.redo(); expect(store.get(area.id)!.quantity).not.toHaveProperty('condition')
  const [led] = store.createCountMarks('led', [{ pageIndex: 0, center: [20, 20] }])
  store.setQuantityCondition([led], '壁付')
  const [nextLed] = store.createCountMarks('led', [{ pageIndex: 0, center: [30, 30] }])
  expect(store.get(nextLed)!.count).toMatchObject({ condition: '壁付' })
})

it('inherits last per-item composition/conditions without contaminating explicit marks', async () => {
  const { store, id } = await setup()
  store.setRouteMembers(id, [{ itemId: 'cv', count: 2, cond: { plan: 'ラック' } }, { itemId: 'pf', count: 1, cond: { plan: null, rise: '管内', slack: null } }])
  store.setRouteCondition([id], 'pf', 'rise', '露出')
  const next = store.create(routeInput())
  expect(next.quantity).toMatchObject({ count: 2, cond: { plan: 'ラック' }, extra: [{ itemId: 'pf', count: 1, cond: { rise: '露出' } }] })
  const explicit = store.create(routeInput({ ...base, cond: {} }))
  expect(explicit.quantity!.cond).toEqual({}); expect(explicit.quantity!.extra).toBeUndefined()
  const pf = store.create(routeInput({ ...base, itemId: 'pf' }))
  expect(pf.quantity!.cond).toEqual({ plan: null, rise: '露出', slack: null })
  expect(serializeQuantityMark(next.quantity!)).not.toContain('lastRoute')
})

it('rejects mismatched member conditions before reassignment, then merges with Undo/Redo', async () => {
  const { store, id } = await setup({ ...base, addM: 3, cond: { rise: [null] }, extra: [{ itemId: 'pf', count: 2, cond: { rise: [null] } }] })
  store.setRouteCondition([id], 'pf', 'rise', undefined, 0)
  expect(store.reassignCounts([id], 'pf')).toBe('施工条件または数える部分が異なるため、項目を変更できません。先にそろえてください。')
  store.setRouteCondition([id], 'cv', 'rise', undefined, 0)
  const before = store.get(id)!.quantity
  expect(store.reassignCounts([id], 'pf')).toBeUndefined()
  expect(store.get(id)!.quantity).toMatchObject({ itemId: 'pf', count: 3 })
  store.undo(); expect(store.get(id)!.quantity).toStrictEqual(before)
  store.redo(); expect(store.get(id)!.quantity!.itemId).toBe('pf')
})

it('rejects invalid store edits without consuming history', async () => {
  const { store, id } = await setup()
  const before = store.get(id)!.quantity
  store.setRouteMembers(id, [{ itemId: 'cv', count: 1, cond: { plan: ' padded ' } }])
  store.setRouteRises(id, [{ m: .001 }])
  store.setRouteCondition([id], 'cv', 'plan', 'bad\ncondition')
  store.setRouteCondition([id], 'cv', 'rise', null, 10)
  expect(store.get(id)!.quantity).toStrictEqual(before)
  store.undo(); expect(store.get(id)).toBeUndefined()
})

it('reads old localStorage scopes and round-trips new sets with unset rise positions', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  values.set('karu-pdf:route-sets', JSON.stringify([{ id: 'old', name: '旧構成', items: [{ code: 'PF', name: '管', category: '管', count: 1, scope: 'rise' }] }]))
  expect(loadRouteSets()[0].items[0]).toEqual({ code: 'PF', name: '管', category: '管', count: 1, cond: { plan: null, slack: null } })
  const set = { id: 'new', name: '新構成', items: [{ code: 'CV', name: '線', category: '線', count: 2, cond: { rise: ['管内', undefined, null] } }] }
  saveRouteSets([set]); expect(loadRouteSets()).toStrictEqual([set])
  expect(values.get('karu-pdf:route-sets')).not.toContain('scope')
})

it('retains zero-route page/location membership without manufacturing portions', () => {
 const index = QuantityIndex.build([annotation('zero', { ...base, floor: '1階', room: '事務室', cond: { plan: null, rise: null, slack: null } }, 2)], fixtures)
 expect(index.entries('cv')).toEqual([])
 expect(index.total('cv')).toBe(0)
 expect(index.byPage('cv')).toEqual(new Map([[2, 0]]))
 expect(index.pagesOf('cv')).toEqual([2])
 expect(index.byFloorRoom('cv').get('1階')!.get('事務室')).toBe(0)
 expect(index.byCondition('cv')).toEqual(new Map())
})
it('preserves a singleton rise vertex when editing its length', async () => {
 const { store, id } = await setup({ ...base, rises: [{ m: 2, at: 3 }] })
 store.updateQuantityAdd(id, 4)
 expect(store.get(id)!.quantity!.rises).toEqual([{ m: 4, at: 3 }])
 store.updateQuantityValues(id, { addM: 5, slackM: 1 })
 expect(store.get(id)!.quantity!.rises).toEqual([{ m: 5, at: 3 }])
 store.undo(); expect(store.get(id)!.quantity!.rises).toEqual([{ m: 4, at: 3 }])
})

it('restores condition inheritance memories with member/condition Undo and Redo', async () => {
 const { store, id } = await setup()
 const before = structuredClone(store.lastRouteConditions)
 store.setRouteMembers(id, [{ itemId: 'cv', count: 2, cond: { plan: 'ラック' } }, { itemId: 'pf', count: 1, cond: { rise: '管内' } }])
 const after = structuredClone(store.lastRouteConditions)
 store.undo(); expect(store.lastRouteConditions).toEqual(before)
 store.redo(); expect(store.lastRouteConditions).toEqual(after)
 store.setRouteCondition([id], 'pf', 'rise', '露出')
 store.undo(); expect(store.lastRouteConditions.get('pf')).toEqual({ rise: '管内' })
 store.redo(); expect(store.lastRouteConditions.get('pf')).toEqual({ rise: '露出' })
 const area = store.create(routeInput({ ...base, itemId: 'area', method: 'polygon' }))
 store.setQuantityCondition([area.id], '屋外')
 store.undo(); expect(store.lastCondition.has('area')).toBe(false)
 store.redo(); expect(store.lastCondition.get('area')).toBe('屋外')
 store.setQuantityCondition([area.id], undefined)
 store.undo(); expect(store.lastCondition.get('area')).toBe('屋外')
 store.redo(); expect(store.lastCondition.has('area')).toBe(true); expect(store.lastCondition.get('area')).toBeUndefined()
})
it('remembers explicitly placed configurations and keeps every mutated mark round-trippable', async () => {
 const { store } = await setup()
 const first = store.create(routeInput({ ...base, cond: { plan: 'ラック' }, count: 2, extra: [{ itemId: 'pf', count: 3, cond: { rise: '管内' } }] }))
 const next = store.create(routeInput())
 expect(next.quantity).toStrictEqual(first.quantity)
 store.setRouteMembers(first.id, [{ itemId: 'cv', count: 1 }])
 expect(parseQuantityMark(serializeQuantityMark(store.get(first.id)!.quantity!))).toStrictEqual(store.get(first.id)!.quantity)
})

it('rejects compositions beyond the 8000-character read limit before changing fixtures/marks/memories', async () => {
 const { store, id } = await setup()
 const newFixtures = Array.from({ length: 8 }, (_, i) => ({ ...fixtures[0], id: 'new' + i, code: 'N' + i, order: i + 5 }))
 const members = ['cv', 'pf', 'rack', ...newFixtures.map(f => f.id)].map(itemId => ({ itemId, count: 1, cond: { plan: 'p'.repeat(30), rise: Array(20).fill('r'.repeat(30)), slack: 's'.repeat(30) } }))
 const [main, ...extra] = members
 const original = store.get(id)!.quantity!, index = store.quantityIndex(), memory = structuredClone(store.lastRouteConditions)
 expect(serializeQuantityMark({ ...original, ...main, extra }).length).toBeGreaterThan(8000)
 store.addFixturesAndSetRouteItems(newFixtures, id, members)
 expect(store.get(id)!.quantity).toStrictEqual(original)
 expect(store.getCountFixture('new0')).toBeUndefined()
 expect(store.lastRouteConditions).toEqual(memory)
 expect(store.quantityIndex()).toBe(index)
})
