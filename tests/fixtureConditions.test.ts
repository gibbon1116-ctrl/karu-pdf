import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { nextCountStyle, parseCountFixtures, serializeCountFixtures, setFixtureConditionRenames, FIXTURE_PRESETS, type CountFixture } from '../src/core/countFixtures'
import { QUANTITY_MASTER, masterEntries, searchQuantityMaster, fixtureFromPreset, standardConditionsForFixture } from '../src/core/quantityMaster'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { resolveRouteSet } from '../src/app/routeSets'
import type { QuantityMark } from '../src/core/quantity'

const fixture = (id = 'line', kind: CountFixture['kind'] = 'length'): CountFixture => ({ id, kind, method: kind === 'length' ? 'polyline' : kind === 'area' ? 'polygon' : 'click', name: id, code: id, category: '試験', order: 0, style: nextCountStyle([]) })
const read = (f: object) => parseCountFixtures(JSON.stringify({ version: 1, fixtures: [f] }))
const line = { ...fixture(), conditions: ['管内', 'ラック'], routeDefaults: { plan: 'ラック', rise: '管内', slack: null } }

it('round-trips ordered candidates, all three defaults and non-line defaults independently', () => {
  for (const f of [line, { ...line, routeDefaults: { plan: null, rise: ['管内', undefined, null], slack: 'ラック' } }, { ...fixture(), conditions: [], routeDefaults: {} }, { ...fixture(), routeDefaults: { plan: null, slack: null } }, { ...fixture('area', 'area'), conditions: ['屋内'], defaultCondition: '屋内' }, { ...fixture('count', 'count'), conditions: ['壁付'], defaultCondition: '壁付' }]) {
    expect(parseCountFixtures(serializeCountFixtures([f]))).toEqual([f])
  }
  const f = { ...fixture(), conditions: Array.from({ length: 30 }, (_, i) => String(i).padStart(30, 'あ')) }
  expect(read(f)).toEqual([f])
})

it.each([
  { conditions: null }, { conditions: '管内' }, { conditions: Array(31).fill('管内') }, { conditions: [''] }, { conditions: ['あ'.repeat(31)] },
  { conditions: [' 管内'] }, { conditions: ['管内 '] }, { conditions: ['管\n内'] }, { conditions: ['管\r内'] }, { conditions: ['管\u2028内'] }, { conditions: ['管\u2029内'] }, { conditions: ['管内', '管内'] }, { conditions: [null] },
  { routeDefaults: { plan: '候補外' } }, { routeDefaults: { rise: ['候補外'] } }, { routeDefaults: { rise: Array(21).fill(null) } }, { routeDefaults: null }, { routeDefaults: [] }, { routeDefaults: { plan: false } }, { routeDefaults: { invalid: null } },
  { kind: 'area', method: 'polygon' }, { defaultCondition: '管内' },
])('rejects invalid candidates or route defaults: %j', changes => {
  const invalid = { ...line, ...changes }
  expect(read(invalid)).toEqual([])
  expect(() => serializeCountFixtures([invalid as CountFixture])).toThrow()
})

it('rejects invalid single defaults without losing other valid items', () => {
  for (const defaultCondition of ['', ' 屋内', '屋外', null, 1]) {
    const f = { ...fixture('area', 'area'), conditions: ['屋内'], defaultCondition }
    expect(parseCountFixtures(JSON.stringify({ version: 1, fixtures: [fixture(), f] }))).toEqual([fixture()])
  }
})

it.each(['rise', 'noSlack', 'all'] as const)('migrates old fixture scope %s and writes the old compatibility field', routeScope => {
  const expected = routeScope === 'rise' ? { plan: null, slack: null } : routeScope === 'noSlack' ? { slack: null } : undefined
  const [parsed] = read({ ...fixture(), routeScope })
  expect(parsed).not.toHaveProperty('routeScope')
  expect(parsed.routeDefaults).toEqual(expected)
  const raw = serializeCountFixtures([parsed])
  expect(JSON.parse(raw).fixtures[0].routeScope).toBe(routeScope === 'all' ? undefined : routeScope)
  expect(parseCountFixtures(raw)).toEqual([parsed])
  expect(parsed.conditions).toBeUndefined()
})

it('prefers new defaults over the legacy projection, including custom masks', () => {
  expect(read({ ...line, routeScope: 'rise' })[0]).toEqual(line)
  expect(JSON.parse(serializeCountFixtures([{ ...line, routeDefaults: { plan: null, rise: null, slack: null } }])).fixtures[0].routeScope).toBe('rise')
})

const wire = ['管内配線', '合成樹脂管内配線（PF・CD・FEP）', 'ケーブルラック配線', '二重天井内・二重床内・ピット内・トラフ内配線']
const cable = [...wire, 'サドル止め（コンクリート）', 'サドル止め・ステープル止め（木造）', '地中管路内', '架空（ちょう架）']
const pipes = ['屋内一般配管', '機械室・便所配管', '屋外配管（架空・暗渠内・共同溝内）', '屋外露出配管', '地中配管']
const insulation = ['屋内露出（一般居室・廊下）', '屋内隠ぺい（天井内・パイプシャフト）', '機械室・書庫・倉庫', '屋外露出・浴室・厨房', '暗渠内']

it('attaches exactly the specified candidates to every actual master type', () => {
  for (const t of QUANTITY_MASTER) {
    let expected: string[] = []
    if (t.category === '電線') expected = [...wire, 'ダクト内配線']
    if (['ケーブル（低圧）', 'ケーブル（高圧）', '制御ケーブル', '通信・弱電ケーブル', '耐火・耐熱ケーブル'].includes(t.category)) expected = cable
    if (t.category === '電線管') expected = t.type === 'CD' ? ['コンクリート埋込配管'] : t.type === 'FEP' ? ['地中埋設', '露出配管'] : ['隠ぺい配管', '露出配管', 'コンクリート埋込配管', '地中埋設']
    if (t.category === 'ケーブルラック・ダクト') expected = ['屋内', '屋外']
    if (t.category === '照明器具') expected = ['天井直付', '天井埋込', '壁付', '吊下げ', '床置・据置']
    if (['配管（給水・給湯）', '配管（排水・通気）', '配管（消火・冷温水・蒸気）', '冷媒管', 'ドレン管'].includes(t.category)) expected = pipes
    if (t.category === 'ダクト') expected = ['屋内一般', '機械室', '屋外露出']
    if (t.category === '保温') expected = insulation
    if (t.category === '塗装' || t.type === '塗装') expected = ['屋内', '屋外']
    if (t.category === '土工' && t.type === '根切り') expected = ['直掘り工法', '法付け工法']
    if (t.category === '撤去') expected = ['撤去（廃棄）', '取外し（再使用）']
    if (['スイッチ', 'コンセント', '配線器具'].includes(t.category)) expected = ['隠ぺい（埋込）', '露出']
    expect(t.conditions, t.type).toEqual(expected)
  }
  for (const p of [...masterEntries(), ...Object.values(FIXTURE_PRESETS).flat()]) {
    const f = fixtureFromPreset(p, [])
    expect(f.conditions).toEqual(p.conditions ?? standardConditionsForFixture(p))
    expect(f.routeDefaults).toBeUndefined(); expect(f.defaultCondition).toBeUndefined()
    expect(parseCountFixtures(serializeCountFixtures([f]))).toHaveLength(1)
  }
  expect(standardConditionsForFixture({ category: '電線管', code: 'PF22' })).toEqual(['隠ぺい配管', '露出配管', 'コンクリート埋込配管', '地中埋設'])
  expect(standardConditionsForFixture({ category: '電線管', code: 'CD16' })).toEqual(['コンクリート埋込配管'])
  expect(standardConditionsForFixture({ category: '電線管', code: 'UNKNOWN' })).toEqual([])
})

it('finds the three added mechanical types and preserves all 770 prior keys and their order', () => {
  for (const name of ['配管保温（グラスウール）', 'ダクト保温', '配管塗装']) expect(searchQuantityMaster(name).total).toBeGreaterThan(0)
  const additions = QUANTITY_MASTER.filter(t => ['GW', 'DUCT-GW', 'PIPE-PAINT'].includes(t.type))
  expect(additions.map(t => [t.kind, t.method, t.specs.length])).toEqual([['length', 'polyline', 11], ['area', 'lengthHeight', 0], ['length', 'polyline', 11]])
  expect(additions.every(t => t.field === '機械設備')).toBe(true)
  const keys = masterEntries().filter(e => !additions.some(t => t.field === e.field && t.type === e.type)).map(e => e.key)
  expect(keys).toHaveLength(770)
  expect(createHash('sha256').update(JSON.stringify(keys)).digest('hex')).toBe('9017979bdaabdb2b7764c337b69005324e474619601c188122a989445fab2552')
})

const input = (q: QuantityMark) => ({ pageIndex: 0, kind: 'perimeter' as const, rect: [0, 0, 10, 1] as [number, number, number, number], vertices: [[0, 0], [10, 0]] as [number, number][], measure: { kind: 'perimeter' as const, mmPerPoint: 1000, unit: 'mm' as const, decimals: null }, quantity: q })

it('renames main/extra/scalar/array/area/count conditions and memories with one Undo/Redo', async () => {
  const items = [line, { ...fixture('extra'), conditions: ['管内'] }, { ...fixture('area', 'area'), conditions: ['管内'] }, { ...fixture('count', 'count'), conditions: ['管内'] }]
  const store = new AnnotationStore(); await store.ensureCountFixtures(async () => items, async () => {})
  const route = store.create(input({ version: 1, id: 'route', itemId: 'line', method: 'polyline', rises: [{ m: 1 }, { m: 2 }, { m: 3 }], cond: { plan: '管内', rise: ['管内', undefined, null], slack: '管内' }, extra: [{ itemId: 'extra', count: 1, cond: { plan: '管内', rise: '管内', slack: null } }] }))
  const area = store.create(input({ version: 1, id: 'area', itemId: 'area', method: 'polygon', condition: '管内' }))
  const [count] = store.createCountMarks('count', [{ pageIndex: 0, center: [0, 0] }]); store.setQuantityCondition([count], '管内')
  store.setRouteTemplate({ itemId: 'line', count: 1, name: '例', cond: { plan: '管内' }, extra: [{ itemId: 'extra', count: 1, cond: { rise: '管内' } }] })
  const ids = [route.id, area.id, count], snapshot = () => ids.map(id => { const a = store.get(id)!; return { quantity: a.quantity, count: a.count, color: a.color, text: a.text, borderWidth: a.borderWidth } }), before = snapshot(), memory = structuredClone(store.lastRouteConditions), template = structuredClone(store.routeTemplate)
  const next = items.map(f => {
    const updated = { ...f, conditions: f.conditions!.map(c => c === '管内' ? '露出' : c), ...(f.routeDefaults ? { routeDefaults: { ...f.routeDefaults, rise: '露出' } } : {}) }
    setFixtureConditionRenames(updated, new Map([['管内', '露出']]))
    return updated
  })
  store.setCountFixtures(next)
  expect(store.get(route.id)!.quantity).toMatchObject({ cond: { plan: '露出', rise: ['露出', undefined, null], slack: '露出' }, extra: [{ cond: { plan: '露出', rise: '露出', slack: null } }] })
  expect(store.get(area.id)!.quantity!.condition).toBe('露出'); expect(store.get(count)!.count).toMatchObject({ condition: '露出' })
  expect(store.lastCondition.get('count')).toBe('露出'); expect(store.routeTemplate!.cond).toEqual({ plan: '露出' })
  const after = snapshot()
  store.undo(); expect(store.getCountFixtures()).toEqual(items); expect(snapshot()).toEqual(before); expect(store.lastRouteConditions).toEqual(memory); expect(store.routeTemplate).toEqual(template)
  expect(store.lastCondition.get('count')).toBe('管内')
  store.redo(); expect(store.getCountFixtures()).toEqual(next); expect(snapshot()).toEqual(after)
  expect(store.routeTemplate!.extra[0].cond).toEqual({ rise: '露出' })
})

it('leaves deleted and reordered candidates on existing marks, without inferring a rename', async () => {
  const store = new AnnotationStore(); await store.ensureCountFixtures(async () => [line], async () => {})
  const a = store.create(input({ version: 1, id: 'a', itemId: 'line', method: 'polyline', cond: { plan: '管内' } }))
  store.setCountFixtures([{ ...line, conditions: ['ラック', '管内'] }]); expect(store.get(a.id)!.quantity!.cond).toEqual({ plan: '管内' })
  store.setCountFixtures([{ ...line, conditions: ['ラック'], routeDefaults: { plan: 'ラック', slack: null } }]); expect(store.get(a.id)!.quantity!.cond).toEqual({ plan: '管内' })
  store.undo(); expect(store.getCountFixture('line')!.conditions).toEqual(['ラック', '管内'])
})

it('rejects a rename exceeding the route read limit without changing data or consuming Undo', async () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ ...fixture('line' + i), order: i, conditions: ['x'] }))
  const store = new AnnotationStore(); await store.ensureCountFixtures(async () => items, async () => {})
  const members = items.map(f => ({ itemId: f.id, count: 1, cond: { plan: 'x', rise: Array(20).fill('x'), slack: 'x' } }))
  const [main, ...extra] = members
  const route = store.create(input({ version: 1, id: 'r', method: 'polyline', ...main, rises: Array.from({ length: 20 }, () => ({ m: 1 })), extra }))
  const original = store.get(route.id)!.quantity, memory = structuredClone(store.lastRouteConditions)
  const next = items.map(f => { const changed = { ...f, conditions: ['あ'.repeat(30)] }; setFixtureConditionRenames(changed, new Map([['x', 'あ'.repeat(30)]])); return changed })
  expect(() => store.setCountFixtures(next)).toThrow('保存容量')
  expect(store.getCountFixtures()).toEqual(items); expect(store.get(route.id)!.quantity).toEqual(original); expect(store.lastRouteConditions).toEqual(memory)
  store.undo(); expect(store.get(route.id)).toBeUndefined()
})

it('uses inherited conditions before item defaults, and remembers an explicit unset with Undo', async () => {
  const area = { ...fixture('area', 'area'), conditions: ['屋内', '屋外'], defaultCondition: '屋内' }
  const count = { ...fixture('count', 'count'), conditions: ['壁付'], defaultCondition: '壁付' }
  const items = [line, area, count, fixture('unset')], store = new AnnotationStore()
  await store.ensureCountFixtures(async () => items, async () => {})
  const q = (itemId: string, method: QuantityMark['method'] = 'polyline'): QuantityMark => ({ version: 1, id: itemId, itemId, method })
  const first = store.create(input(q('line'))); expect(first.quantity!.cond).toEqual(line.routeDefaults)
  store.setRouteCondition([first.id], 'line', 'plan', '管内'); expect(store.create(input(q('line'))).quantity!.cond!.plan).toBe('管内')
  expect(store.create(input(q('line'))).quantity!.cond!.slack).toBeNull()
  expect(store.create(input(q('unset'))).quantity!.cond).toEqual({})
  const a = store.create(input(q('area', 'polygon'))); expect(a.quantity!.condition).toBe('屋内')
  store.setQuantityCondition([a.id], '屋外'); expect(store.create(input(q('area', 'polygon'))).quantity!.condition).toBe('屋外')
  store.setQuantityCondition([a.id], undefined); expect(store.lastCondition.has('area')).toBe(true)
  store.undo(); expect(store.lastCondition.get('area')).toBe('屋外'); store.redo()
  expect(store.create(input(q('area', 'polygon'))).quantity!.condition).toBeUndefined()
  const [c] = store.createCountMarks('count', [{ pageIndex: 0, center: [0, 0] }]); expect(store.get(c)!.count).toMatchObject({ condition: '壁付' })
  store.setQuantityCondition([c], undefined)
  const [unset] = store.createCountMarks('count', [{ pageIndex: 0, center: [10, 0] }]); expect(store.get(unset)!.count).not.toHaveProperty('condition', '壁付')
  const resolved = resolveRouteSet({ id: 's', name: '例', items: [{ ...line, count: 1 }] }, items)
  expect(resolved.items[0].cond).toEqual(line.routeDefaults)
  expect(resolveRouteSet({ id: 's', name: '例', items: [{ ...line, count: 1, cond: {} }] }, items).items[0].cond).toEqual({})
})
