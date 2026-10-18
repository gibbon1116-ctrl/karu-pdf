import { expect, it } from 'vitest'
import {
  parseCountFixtures, serializeCountFixtures, type CountFixture,
} from '../src/core/countFixtures'
import {
  computeLinks, fixtureLinkError, readFixtureLink, type FixtureLink, type LinkSourceEntry,
  fixtureLinkSources as selectB072Sources,
} from '../src/core/fixtureLink'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0],
  size: 10, opacity: .8, showCode: true,
}
function fixture(id: string, kind: CountFixture['kind'] = 'count'): CountFixture {
  return { id, name: id, code: id, category: '例', kind, style, order: 0 }
}
function linked(
  id: string, link: FixtureLink, kind: CountFixture['kind'] = 'count',
): CountFixture {
  return { ...fixture(id, kind), link }
}
function row(
  itemId: string, value: number, annotationId = itemId,
  options: Partial<LinkSourceEntry> = {},
): LinkSourceEntry {
  return { itemId, value, annotationId, pageIndex: 0, ...options }
}
function calculate(fixtures: CountFixture[], rows: LinkSourceEntry[]) {
  return computeLinks(fixtures, id => rows.filter(entry => entry.itemId === id))
}
function error(link: unknown, convert?: CountFixture['convert']) {
  return fixtureLinkError({ id: 'L', link: link as FixtureLink, convert })
}

it('accepts valid links, optional defaults and inclusive upper limits', () => {
  expect(fixtureLinkError({ id: 'L' })).toBeUndefined()
  expect(error({ kind: 'factor', sources: [] })).toBeUndefined()
  expect(error({
    kind: 'factor',
    sources: [
      { itemId: 'A', factor: 10000, conditions: ['', '露出'] },
      { itemId: 'B', perM: 1000, conditions: [] },
    ],
    condition: { mode: 'fixed', value: '撤去' },
    rounding: 'each',
    override: { value: 1e9, note: 'あ'.repeat(200) },
  })).toBeUndefined()
  expect(error({
    kind: 'mass', sources: [{ itemId: 'A', factor: .5 }],
    densityTPerM3: 30, override: { value: 0, note: '' },
  })).toBeUndefined()
  expect(error({
    kind: 'factor', sources: [{ itemId: 'A', conditions: Array(30).fill('露出') }],
  })).toBeUndefined()
})

const invalidLinks: unknown[] = [
  null, [], {}, { kind: 'unknown', sources: [] },
  { kind: 'factor', sources: null },
  { kind: 'factor', sources: [null] },
  { kind: 'factor', sources: [{ itemId: '' }] },
  { kind: 'factor', sources: [{ itemId: 'x'.repeat(81) }] },
  { kind: 'factor', sources: [{ itemId: 'A', factor: 1, perM: 1 }] },
  { kind: 'factor', sources: [{ itemId: 'A' }, { itemId: 'A' }] },
  { kind: 'factor', sources: [{ itemId: 'L' }] },
  { kind: 'factor', sources: [{ itemId: 'A', conditions: null }] },
  { kind: 'factor', sources: [{ itemId: 'A', conditions: Array(31).fill('露出') }] },
  { kind: 'factor', sources: [{ itemId: 'A', conditions: [' padded '] }] },
  { kind: 'factor', sources: [{ itemId: 'A', conditions: ['あ'.repeat(31)] }] },
  { kind: 'factor', sources: [{ itemId: 'A', conditions: ['改\n行'] }] },
  { kind: 'factor', sources: [{ itemId: 'A', conditions: [1] }] },
  { kind: 'factor', sources: [], condition: null },
  { kind: 'factor', sources: [], condition: { mode: 'other', value: '露出' } },
  { kind: 'factor', sources: [], condition: { mode: 'fixed', value: '' } },
  { kind: 'factor', sources: [], condition: { mode: 'fixed', value: ' padded ' } },
  { kind: 'factor', sources: [], rounding: 'invalid' },
  { kind: 'factor', sources: [], densityTPerM3: 1 },
  { kind: 'mass', sources: [], override: null },
  { kind: 'mass', sources: [], override: { value: '1' } },
  { kind: 'mass', sources: [], override: { value: 0, note: 'あ'.repeat(201) } },
  { kind: 'mass', sources: [], override: { value: 0, note: '改\n行' } },
  { kind: 'mass', sources: [], override: { value: 0, note: '改\r行' } },
  { kind: 'mass', sources: [], override: { value: 0, note: '改\u2028行' } },
  { kind: 'mass', sources: [], override: { value: 0, note: 1 } },
  ...[0, -1, 10000.01, NaN, Infinity, '1'].map(factor => ({
    kind: 'factor', sources: [{ itemId: 'A', factor }],
  })),
  ...[0, -1, 1000.01, NaN, Infinity, '1'].map(perM => ({
    kind: 'factor', sources: [{ itemId: 'A', perM }],
  })),
  ...[0, -1, 30.01, NaN, Infinity, '1'].map(densityTPerM3 => ({
    kind: 'mass', sources: [], densityTPerM3,
  })),
  ...[-1, 1e9 + 1, NaN, Infinity].map(value => ({
    kind: 'mass', sources: [], override: { value },
  })),
]

it.each(invalidLinks.map((link, index) => ({ link, index })))(
  'rejects malformed link $index', ({ link }) => {
    expect(error(link)).toBeTypeOf('string')
  },
)

it('rejects 51 sources and link/convert coexistence', () => {
  expect(error({
    kind: 'factor', sources: Array.from({ length: 50 }, (_, i) => ({ itemId: 'A' + i })),
  })).toBeUndefined()
  expect(error({
    kind: 'factor', sources: Array.from({ length: 51 }, (_, i) => ({ itemId: 'A' + i })),
  })).toBe('連動の元は50項目までです。')
  expect(error({ kind: 'factor', sources: [] }, {
    factor: 1, unit: 't', basis: '',
  })).toBeTypeOf('string')
})

it('round-trips links and strips unknown fields and empty conditions', () => {
  const link = {
    kind: 'mass',
    sources: [
      { itemId: 'A', factor: 2, conditions: [], unwanted: true },
      { itemId: 'B', perM: 1.5, conditions: ['', '露出'], unwanted: true },
    ],
    condition: { mode: 'fixed', value: '撤去', unwanted: true },
    rounding: 'none', densityTPerM3: .5,
    override: { value: .12, note: '確認済み', unwanted: true },
    unwanted: true,
  } as unknown as FixtureLink
  const original = linked('L', link, 'volume')
  const expected: FixtureLink = {
    kind: 'mass',
    sources: [
      { itemId: 'A', factor: 2 },
      { itemId: 'B', perM: 1.5, conditions: ['', '露出'] },
    ],
    condition: { mode: 'fixed', value: '撤去' },
    rounding: 'none', densityTPerM3: .5,
    override: { value: .12, note: '確認済み' },
  }
  const raw = serializeCountFixtures([original])
  expect(JSON.parse(raw).fixtures[0].link).toEqual(expected)
  expect(parseCountFixtures(raw)[0].link).toEqual(expected)

  const parsed = parseCountFixtures(JSON.stringify({ version: 1, fixtures: [original] }))[0]
  expect(parsed.link).toEqual(expected)
  parsed.link!.sources[1].conditions!.push('別条件')
  expect(original.link!.sources[1].conditions).toEqual(['', '露出'])
})

it('drops only invalid links and retains the fixture and valid conversion', () => {
  const original = {
    ...fixture('A'),
    convert: { factor: 2, unit: 't' as const, basis: '元の数量' },
    link: { kind: 'factor' as const, sources: [] },
  }
  const parsed = parseCountFixtures(JSON.stringify({ version: 1, fixtures: [original] }))
  expect(parsed).toHaveLength(1)
  expect(parsed[0].id).toBe('A')
  expect(parsed[0].link).toBeUndefined()
  expect(parsed[0].convert).toEqual(original.convert)
  expect(() => serializeCountFixtures([original])).toThrow()

  for (const link of invalidLinks) {
    const items = parseCountFixtures(JSON.stringify({
      version: 1, fixtures: [{ ...fixture('L'), link }],
    }))
    expect(items).toHaveLength(1)
    expect(items[0].link).toBeUndefined()
  }
})

it('rejects malformed links on serialization but permits missing sources and cycles', () => {
  for (const link of invalidLinks) {
    expect(() => serializeCountFixtures([linked('L', link as FixtureLink)])).toThrow()
  }
  const fixtures = [
    linked('B', { kind: 'factor', sources: [{ itemId: 'C' }, { itemId: 'missing' }] }),
    linked('C', { kind: 'factor', sources: [{ itemId: 'B' }] }),
  ]
  expect(parseCountFixtures(serializeCountFixtures(fixtures))).toHaveLength(2)
})

it('calculates DL 10 × 1 plus SL 3 × 2 and records unrounded source bases', () => {
  const result = calculate([
    fixture('DL'), fixture('SL'),
    linked('L', { kind: 'factor', sources: [{ itemId: 'DL' }, { itemId: 'SL', factor: 2 }] }),
  ], [row('DL', 10), row('SL', 3)]).get('L')!
  expect(result.total).toBe(16)
  expect(result.computed).toBe(16)
  expect(result.sources).toEqual([
    { itemId: 'DL', quantity: 10, subtotal: 10 },
    { itemId: 'SL', quantity: 3, factor: 2, subtotal: 6 },
  ])
  expect(result.entries.map(entry => entry.itemId)).toEqual(['L', 'L'])
  expect(result.error).toBeUndefined()
  expect(result.overridden).toBe(false)
})

it('divides lengths by spacing and distinguishes total, each and no rounding', () => {
  const sources = [{ itemId: 'E25', perM: 1.5 }, { itemId: 'E31', perM: 1.5 }]
  const fixtures = [
    fixture('E25', 'length'), fixture('E31', 'length'),
    linked('total', { kind: 'factor', sources }),
    linked('none', { kind: 'factor', sources, rounding: 'none' }),
    linked('each', {
      kind: 'factor', sources: [{ itemId: 'E25', perM: 1.5 }], rounding: 'each',
    }),
  ]
  const results = calculate(fixtures, [
    row('E25', 3, 'a'), row('E25', 3, 'b'), row('E25', 4.2, 'c'),
    row('E31', 4, 'd'),
  ])
  expect(results.get('total')!.total).toBe(10)
  expect(results.get('total')!.entries.reduce((sum, entry) => sum + entry.value, 0))
    .toBeCloseTo(14.2 / 1.5)
  expect(results.get('none')!.total).toBeCloseTo(9.4666666667)
  expect(results.get('each')!.total).toBe(7)
  expect(results.get('each')!.entries.map(entry => entry.value)).toEqual([2, 2, 3])
  expect(results.get('each')!.sources[0]).toMatchObject({ quantity: 10.2, perM: 1.5 })
  expect(results.get('each')!.sources[0].subtotal).toBeCloseTo(6.8, 9)
})

it('rounds each annotation across portions and sources, distributing proportionally', () => {
  const result = calculate([
    fixture('A', 'length'), fixture('B', 'length'),
    linked('L', {
      kind: 'factor', sources: [{ itemId: 'A' }, { itemId: 'B' }], rounding: 'each',
    }),
  ], [
    row('A', 1, 'same', { part: 'plan', condition: '露出' }),
    row('B', 1.2, 'same', { part: 'rise', condition: '隠ぺい' }),
  ]).get('L')!
  expect(result.total).toBeCloseTo(3)
  expect(result.entries[0].value).toBeCloseTo(3 / 2.2)
  expect(result.entries[1].value).toBeCloseTo(3 * 1.2 / 2.2)
  expect(result.sources.map(source => source.subtotal)).toEqual([1, 1.2])
})

it('rounds count targets and spacing sources only, including the numerical tolerance', () => {
  const results = calculate([
    fixture('A', 'length'),
    linked('count', { kind: 'factor', sources: [{ itemId: 'A', factor: .1 }] }),
    linked('length', {
      kind: 'factor', sources: [{ itemId: 'A', factor: .1 }], rounding: 'each',
    }, 'length'),
    linked('spacing', {
      kind: 'factor', sources: [{ itemId: 'A', perM: 10 }],
    }, 'length'),
    linked('empty', { kind: 'factor', sources: [] }),
  ], [row('A', 10.000000001)])
  expect(results.get('count')!.total).toBe(1)
  expect(results.get('spacing')!.total).toBe(1)
  expect(results.get('length')!.total).toBeCloseTo(1.0000000001, 12)
  expect(results.get('empty')!.total).toBe(0)
})

it('calculates mass, density and factors, prefers unit mass, and warns for missing mass', () => {
  const results = calculate([
    { ...fixture('撤去器具'), attributes: { massKg: 12 } },
    { ...fixture('管', 'length'), attributes: { unitMassKg: 2, massKg: 999 } },
    { ...fixture('長さだけ', 'length'), attributes: { massKg: 12 } },
    fixture('質量なし'),
    linked('t', { kind: 'mass', sources: [{ itemId: '撤去器具' }] }, 'length'),
    linked('m3', {
      kind: 'mass', sources: [{ itemId: '撤去器具' }], densityTPerM3: .5,
    }, 'volume'),
    linked('factor', {
      kind: 'mass', sources: [{ itemId: '管', factor: 3 }], rounding: 'each',
    }, 'length'),
    linked('missing', {
      kind: 'mass', sources: [{ itemId: '質量なし' }, { itemId: '長さだけ' }],
    }, 'length'),
  ], [
    row('撤去器具', 5), row('管', 10), row('質量なし', 4), row('長さだけ', 10),
  ])
  expect(results.get('t')!.total).toBeCloseTo(.06)
  expect(results.get('t')!.sources[0]).toEqual({
    itemId: '撤去器具', quantity: 5, unitMassKg: 12, subtotal: .06,
  })
  expect(results.get('m3')!.total).toBeCloseTo(.12)
  expect(results.get('factor')!.total).toBeCloseTo(.06)
  expect(results.get('factor')!.sources[0].unitMassKg).toBe(2)
  expect(results.get('missing')!.total).toBe(0)
  expect(results.get('missing')!.warnings).toEqual([
    '質量なしの質量が未設定です。', '長さだけの質量が未設定です。',
  ])
})

it('inherits and fixes conditions, filters exposed/unset rows and preserves locations', () => {
  const fixtures = [
    fixture('A'),
    linked('inherit', { kind: 'factor', sources: [{ itemId: 'A' }], rounding: 'none' }),
    linked('fixed', {
      kind: 'factor', sources: [{ itemId: 'A' }],
      condition: { mode: 'fixed', value: '撤去' },
    }),
    linked('exposed', {
      kind: 'factor', sources: [{ itemId: 'A', conditions: ['露出'] }],
    }),
    linked('unset', {
      kind: 'factor', sources: [{ itemId: 'A', conditions: [''] }],
    }),
  ]
  const results = calculate(fixtures, [
    row('A', 2, 'a', {
      condition: '露出', pageIndex: 3, floor: '2階', room: '倉庫', part: 'rise',
    }),
    row('A', 3, 'b', { condition: '隠ぺい' }),
    row('A', 4, 'c'),
  ])
  expect(results.get('inherit')!.entries.map(entry => [entry.condition, entry.value]))
    .toEqual([['露出', 2], ['隠ぺい', 3], [undefined, 4]])
  expect(results.get('inherit')!.entries[0]).toMatchObject({
    itemId: 'inherit', annotationId: 'a', pageIndex: 3,
    floor: '2階', room: '倉庫', part: 'rise',
  })
  expect(results.get('fixed')!.entries.every(entry => entry.condition === '撤去')).toBe(true)
  expect(results.get('fixed')!.total).toBe(9)
  expect(results.get('exposed')!.total).toBe(2)
  expect(results.get('exposed')!.sources[0].quantity).toBe(2)
  expect(results.get('unset')!.total).toBe(4)
})

it('computes dependencies first, independent of fixture order', () => {
  const results = calculate([
    linked('C', { kind: 'factor', sources: [{ itemId: 'B', factor: 3 }] }),
    linked('B', { kind: 'factor', sources: [{ itemId: 'A', factor: 2 }] }),
    fixture('A'),
  ], [row('A', 5, 'pickup', { floor: '1階' })])
  expect([...results.keys()]).toEqual(['B', 'C'])
  expect(results.get('B')!.total).toBe(10)
  expect(results.get('C')!.total).toBe(30)
  expect(results.get('C')!.sources[0].quantity).toBe(10)
  expect(results.get('C')!.entries[0]).toMatchObject({
    itemId: 'C', annotationId: 'pickup', floor: '1階',
  })
})

it('calculates linked sources from their entries, before total-only rounding', () => {
  const results = calculate([
    fixture('A', 'length'),
    linked('B', { kind: 'factor', sources: [{ itemId: 'A', perM: 1.5 }] }),
    linked('C', {
      kind: 'factor', sources: [{ itemId: 'B', factor: 2 }], rounding: 'none',
    }),
  ], [row('A', 4)])
  expect(results.get('B')!.total).toBe(3)
  expect(results.get('C')!.total).toBeCloseTo(16 / 3)
  expect(results.get('C')!.sources[0].quantity).toBeCloseTo(8 / 3)
})

it('zeros cycle members, ignores their external sources and preserves downstream other sources', () => {
  const results = calculate([
    fixture('A'),
    linked('B', {
      kind: 'factor', sources: [{ itemId: 'C' }, { itemId: 'A' }],
      override: { value: 99 },
    }),
    linked('C', { kind: 'factor', sources: [{ itemId: 'B' }] }),
    linked('D', { kind: 'factor', sources: [{ itemId: 'B' }, { itemId: 'A' }] }),
  ], [row('A', 5)])
  for (const id of ['B', 'C']) {
    expect(results.get(id)).toMatchObject({
      error: '連動の元が循環しています。',
      total: 0, computed: 0, entries: [], overridden: false,
    })
  }
  expect(results.get('D')!.total).toBe(5)
  expect(results.get('D')!.error).toBeUndefined()
})

it('marks all members of overlapping cycles', () => {
  const results = calculate([
    linked('B', { kind: 'factor', sources: [{ itemId: 'C' }, { itemId: 'D' }] }),
    linked('C', { kind: 'factor', sources: [{ itemId: 'B' }] }),
    linked('D', { kind: 'factor', sources: [{ itemId: 'C' }] }),
  ], [])
  for (const result of results.values()) {
    expect(result.error).toBe('連動の元が循環しています。')
    expect(result.total).toBe(0)
  }
})

it('retains quantities from existing sources when another source is missing', () => {
  const result = calculate([
    fixture('A'),
    linked('L', {
      kind: 'factor', sources: [{ itemId: 'missing' }, { itemId: 'A', factor: 2 }],
    }),
  ], [row('A', 3)]).get('L')!
  expect(result.error).toBe('連動の元の項目が見つかりません。')
  expect(result.total).toBe(6)
  expect(result.sources).toEqual([{ itemId: 'A', quantity: 3, factor: 2, subtotal: 6 }])
})

it('overrides after calculation and rounding while retaining bases', () => {
  const results = calculate([
    fixture('A', 'length'),
    linked('L', {
      kind: 'factor', sources: [{ itemId: 'A', perM: 1.5 }],
      override: { value: 12, note: '手動確認' },
    }),
    linked('next', { kind: 'factor', sources: [{ itemId: 'L' }] }),
  ], [row('A', 14.2)])
  expect(results.get('L')).toMatchObject({
    total: 12, computed: 10, entries: [], overridden: true,
  })
  expect(results.get('L')!.sources[0].subtotal).toBeCloseTo(14.2 / 1.5)
  expect(results.get('next')!.total).toBe(0)
})

it('returns an empty map and never reads entries when no fixture is linked', () => {
  expect(computeLinks([fixture('A')], () => {
    throw new Error('must not read entries')
  }).size).toBe(0)
})

async function setupStore() {
  const store = new AnnotationStore()
  const fixtures = [
    fixture('A'), fixture('B'),
    fixture('route', 'length'),
    linked('L', {
      kind: 'factor',
      sources: [{ itemId: 'A', factor: 2, conditions: ['露出'] }, { itemId: 'B' }],
    }),
    linked('linkedRoute', { kind: 'factor', sources: [{ itemId: 'route' }] }, 'length'),
  ]
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  return store
}

it('detaches removed sources and restores fixtures and pickups with one undo/redo', async () => {
  const store = await setupStore()
  const ids = store.createCountMarks('A', [{ pageIndex: 0, center: [10, 10] }])
  expect(store.linkDependents('A').map(f => f.id)).toEqual(['L'])
  const dependents = store.linkDependents('A')
  dependents[0].link!.sources.length = 0
  expect(store.getCountFixture('L')!.link!.sources).toHaveLength(2)
  expect(store.fixtureRemovalCounts('A')).toEqual({ deleted: 1, detached: 0 })

  store.setCountFixtures(store.getCountFixtures().filter(f => f.id !== 'A'), ['A'])
  expect(store.getCountFixture('L')!.link!.sources).toEqual([{ itemId: 'B' }])
  expect(store.get(ids[0])).toBeUndefined()
  expect(store.linkDependents('A')).toEqual([])

  store.undo()
  expect(store.getCountFixture('A')).toBeDefined()
  expect(store.get(ids[0])).toBeDefined()
  expect(store.getCountFixture('L')!.link!.sources).toEqual([
    { itemId: 'A', factor: 2, conditions: ['露出'] }, { itemId: 'B' },
  ])
  store.redo()
  expect(store.getCountFixture('A')).toBeUndefined()
  expect(store.getCountFixture('L')!.link!.sources).toEqual([{ itemId: 'B' }])
})

it('retains a linked fixture with empty sources after removing every source', async () => {
  const store = await setupStore()
  store.setCountFixtures(
    store.getCountFixtures().filter(f => !['A', 'B'].includes(f.id)), ['A', 'B'],
  )
  expect(store.getCountFixture('L')!.link!.sources).toEqual([])
  expect(store.quantityIndex().total('L')).toBe(0)
  expect(store.quantityIndex().linkResult('L')!.error).toBeUndefined()
  store.undo()
  expect(store.getCountFixture('L')!.link!.sources).toHaveLength(2)
})

it('rejects linked marks, direct create, reassignment and components without adding history', async () => {
  const store = await setupStore()
  const id = store.createCountMarks('A', [{ pageIndex: 0, center: [10, 10] }])[0]
  const before = store.get(id), fixtures = store.getCountFixtures()

  expect(() => store.createCountMarks('L', [])).toThrow('連動の項目は図面に拾いません')
  expect(() => store.create({
    pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10],
    count: { version: 2, id: 'linked', fixtureId: 'L' },
  })).toThrow('数量拾いの値が不正です。')
  expect(() => store.create({
    pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10],
    count: { version: 2, id: 'extra', fixtureId: 'A', extra: [{ itemId: 'L', count: 1 }] },
  })).toThrow()
  expect(() => store.create({
    pageIndex: 0, kind: 'perimeter', rect: [0, 0, 10, 10],
    vertices: [[0, 0], [10, 0]],
    measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 1000 },
    quantity: { version: 1, id: 'linked-route', itemId: 'linkedRoute', method: 'polyline' },
  })).toThrow()
  expect(store.reassignCounts([id], 'L')).toBeTypeOf('string')
  expect(store.setCountComponents([id], [{ itemId: 'L', count: 1 }], [fixture('NEW')]))
    .toBeTypeOf('string')
  expect(store.get(id)).toEqual(before)
  expect(store.getCountFixtures()).toEqual(fixtures)
  expect(store.getPageAnnotations(0)).toHaveLength(1)

  store.undo()
  expect(store.get(id)).toBeUndefined()
})

it('rejects linked route members and newly proposed linked members atomically', async () => {
  const store = await setupStore()
  const route = store.create({
    pageIndex: 0, kind: 'perimeter', rect: [0, 0, 10, 10],
    vertices: [[0, 0], [10, 0]],
    measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 1000 },
    quantity: { version: 1, id: 'route', itemId: 'route', method: 'polyline' },
  })
  const before = store.get(route.id), fixtures = store.getCountFixtures()
  store.setRouteMembers(route.id, [
    { itemId: 'route', count: 1 }, { itemId: 'linkedRoute', count: 1 },
  ])
  store.addFixturesAndSetRouteItems([
    linked('NEW', { kind: 'factor', sources: [] }, 'length'),
  ], route.id, [{ itemId: 'route', count: 1 }, { itemId: 'NEW', count: 1 }])
  expect(store.get(route.id)).toEqual(before)
  expect(store.getCountFixtures()).toEqual(fixtures)
  store.undo()
  expect(store.get(route.id)).toBeUndefined()
})

it('filters linked inherited route members and count components', async () => {
  const store = await setupStore()
  const main = store.createCountMarks('A', [{ pageIndex: 0, center: [10, 10] }])[0]
  store.setCountComponents([main], [{ itemId: 'B', count: 2 }])
  store.setCountFixtures(store.getCountFixtures().map(f => f.id === 'B'
    ? { ...f, link: { kind: 'factor' as const, sources: [] } } : f))
  const next = store.createCountMarks('A', [{ pageIndex: 0, center: [20, 20] }])[0]
  const count = store.get(next)!.count!
  expect(count.version === 2 ? count.extra : undefined).toBeUndefined()

  store.setRouteTemplate({
    itemId: 'route', count: 1, name: '',
    extra: [{ itemId: 'linkedRoute', count: 1 }],
  })
  expect(store.routeTemplateItems('route').extra).toEqual([])
  expect(store.supportsPickupMethod(store.getCountFixture('L')!, 'click')).toBe(false)
})

it('skips pasted pickups whose fixture has become linked', async () => {
  const store = await setupStore()
  const id = store.createCountMarks('A', [{ pageIndex: 0, center: [10, 10] }])[0]
  store.selectOnly(id)
  const copied = store.copySelected()
  store.setCountFixtures(store.getCountFixtures().map(f => f.id === 'A'
    ? { ...f, link: { kind: 'factor' as const, sources: [] } } : f))
  const before = store.getPageAnnotations(0)
  expect(store.pasteAnnotations(copied, 0, { width: 600, height: 800 }, 20)).toEqual([])
  expect(store.getPageAnnotations(0)).toEqual(before)
})

it('B06 resolves auto sources again, excludes linked items and deduplicates manual sources', () => {
  const dl = { ...fixture('DL'), category: '照明器具' }
  const sl = { ...fixture('SL'), category: '照明器具' }
  const cv = { ...fixture('CV', 'length'), category: '電気' }
  const install = {
    ...linked('器具取付', {
      kind: 'factor', sources: [],
      auto: { categories: ['照明器具'], kinds: ['count'] },
    }),
    category: '照明器具',
  }
  const anotherLink = {
    ...linked('別の連動', { kind: 'factor', sources: [{ itemId: 'DL' }] }),
    category: '照明器具',
  }
  const fixtures = [dl, sl, cv, install, anotherLink]
  const rows = [row('DL', 10), row('SL', 3), row('CV', 100)]
  const first = calculate(fixtures, rows).get('器具取付')!
  expect(first.total).toBe(13)
  expect(first.sources).toEqual([
    { itemId: 'DL', quantity: 10, factor: 1, subtotal: 10, auto: true },
    { itemId: 'SL', quantity: 3, factor: 1, subtotal: 3, auto: true },
  ])

  fixtures.push({ ...fixture('追加器具'), category: '照明器具' })
  rows.push(row('追加器具', 5))
  expect(calculate(fixtures, rows).get('器具取付')!.total).toBe(18)

  install.link!.sources = [{ itemId: 'DL', factor: 2 }]
  const manual = calculate(fixtures, rows).get('器具取付')!
  expect(manual.total).toBe(28)
  expect(manual.sources.map(source => source.itemId)).toEqual(['DL', 'SL', '追加器具'])
  expect(manual.sources[0]).toEqual({
    itemId: 'DL', quantity: 10, factor: 2, subtotal: 20,
  })
  expect(manual.sources.slice(1).every(source => source.auto === true)).toBe(true)
  expect(manual.error).toBeUndefined()
})

it('B06 intersects all auto filters and uses the persisted rule factor', () => {
  const candidate: CountFixture = {
    ...fixture('一致'),
    name: '対象の盤', category: '盤類', conditions: ['撤去（廃棄）'],
    attributes: { massKg: 100 },
  }
  const fixtures: CountFixture[] = [
    candidate,
    { ...candidate, id: '分類違い', category: '照明器具' },
    { ...candidate, id: '名称違い', name: '対象の機器' },
    { ...candidate, id: '条件違い', conditions: ['新設'] },
    { ...candidate, id: '種別違い', kind: 'length' },
    { ...candidate, id: '質量不足', attributes: { massKg: 99 } },
    { ...candidate, id: '質量なし', attributes: undefined },
    linked('L', {
      kind: 'factor', sources: [], factor: 2.5, rounding: 'none',
      auto: {
        categories: ['盤類'], nameIncludes: ['盤'],
        condition: '撤去（廃棄）', kinds: ['count'], minMassKg: 100,
      },
    }),
  ]
  const rows = fixtures.filter(f => !f.link).map(f =>
    row(f.id, 2, f.id, { condition: '撤去（廃棄）' }))
  const result = calculate(fixtures, rows).get('L')!
  expect(result.total).toBe(5)
  expect(result.sources).toEqual([
    { itemId: '一致', quantity: 2, factor: 2.5, subtotal: 5, auto: true },
  ])

  const l = fixtures[fixtures.length - 1]
  l.link!.auto = { minMassKg: 0 }
  expect(calculate(fixtures, rows).get('L')!.sources.some(source =>
    source.itemId === '質量なし')).toBe(false)

  l.link!.auto = { categories: [] }
  expect(calculate(fixtures, rows).get('L')!.sources).toEqual([])
})

it('B06 auto condition requires a candidate and filters only that condition’s rows', () => {
  const result = calculate([
    { ...fixture('A'), conditions: ['新設', '撤去（廃棄）'] },
    { ...fixture('B'), conditions: ['新設'] },
    fixture('C'),
    linked('L', {
      kind: 'factor', sources: [],
      auto: { condition: '撤去（廃棄）' },
    }),
  ], [
    row('A', 2, 'remove', { condition: '撤去（廃棄）', floor: '2階' }),
    row('A', 10, 'install', { condition: '新設' }),
    row('A', 20, 'unset'),
    row('B', 30, 'not-a-candidate', { condition: '撤去（廃棄）' }),
    row('C', 40, 'no-candidates', { condition: '撤去（廃棄）' }),
  ]).get('L')!
  expect(result.total).toBe(2)
  expect(result.sources).toEqual([
    { itemId: 'A', quantity: 2, factor: 1, subtotal: 2, auto: true },
  ])
  expect(result.entries).toEqual([
    row('L', 2, 'remove', { condition: '撤去（廃棄）', floor: '2階' }),
  ])
})

it('B06 keeps auto sources outside cycle detection and retains manual cycle behavior', () => {
  const results = calculate([
    { ...fixture('A'), category: '照明器具' },
    {
      ...linked('B', {
        kind: 'factor', sources: [{ itemId: 'C' }],
        auto: { categories: ['照明器具'] },
      }),
      category: '照明器具',
    },
    {
      ...linked('C', { kind: 'factor', sources: [{ itemId: 'B' }] }),
      category: '照明器具',
    },
    linked('D', {
      kind: 'factor', sources: [],
      auto: { categories: ['照明器具'] },
    }),
  ], [row('A', 3)])
  expect(results.get('B')!.error).toBe('連動の元が循環しています。')
  expect(results.get('C')!.error).toBe('連動の元が循環しています。')
  expect(results.get('D')!.error).toBeUndefined()
  expect(results.get('D')!.total).toBe(3)
  expect(results.get('D')!.sources.map(source => source.itemId)).toEqual(['A'])
})

it('B06 calculates heavy and bulky carry, alone increase and excluded source bases', () => {
  const sources = ['盤A', '容積機器', '小型機器', '外形なし', '質量なし']
    .map(itemId => ({ itemId }))
  const results = calculate([
    {
      ...fixture('盤A'),
      attributes: { massKg: 1200, widthMm: 800, depthMm: 400, heightMm: 1800 },
    },
    {
      ...fixture('容積機器'),
      attributes: { massKg: 300, widthMm: 1000, depthMm: 1000, heightMm: 1500 },
    },
    { ...fixture('小型機器'), attributes: { massKg: 80 } },
    { ...fixture('外形なし'), attributes: { massKg: 300, widthMm: 1000, depthMm: 1000 } },
    fixture('質量なし'),
    linked('heavy', {
      kind: 'carry', sources, carry: { class: 'heavy' }, rounding: 'each',
    }),
    linked('alone', {
      kind: 'carry', sources: [{ itemId: '盤A', factor: 9 }],
      carry: { class: 'heavy', alone: true },
    }),
    linked('bulky', {
      kind: 'carry', sources, carry: { class: 'bulky' },
    }),
  ], [
    row('盤A', 2, 'panel', { pageIndex: 2, floor: '1階', room: '電気室', condition: '新設' }),
    row('容積機器', 1),
    row('小型機器', 10),
    row('外形なし', 4),
    row('質量なし', 3),
  ])

  const heavy = results.get('heavy')!
  expect(heavy.total).toBeCloseTo(2.04, 12)
  expect(heavy.computed).toBeCloseTo(2.04, 12)
  expect(heavy.entries).toHaveLength(1)
  expect(heavy.entries[0]).toMatchObject({
    itemId: 'heavy', annotationId: 'panel', pageIndex: 2,
    floor: '1階', room: '電気室', condition: '新設',
  })
  expect(heavy.sources[0]).toMatchObject({
    itemId: '盤A', quantity: 2, unitMassKg: 1200, factor: .85,
  })
  expect(heavy.sources[0].subtotal).toBeCloseTo(2.04, 12)
  expect(heavy.sources[1]).toMatchObject({
    itemId: '容積機器', quantity: 1, subtotal: 0,
    note: '容積品 200kg/㎥（区分違い: 重量品だけ）',
  })
  expect(heavy.sources[2]).toMatchObject({
    itemId: '小型機器', quantity: 10, subtotal: 0, note: '100kg未満',
  })
  expect(heavy.sources[3]).toMatchObject({
    itemId: '外形なし', quantity: 4, subtotal: 0, note: '外形未設定',
  })
  expect(heavy.sources[4]).toMatchObject({
    itemId: '質量なし', quantity: 3, unitMassKg: 0, subtotal: 0,
  })
  expect(heavy.warnings).toEqual([
    '容積機器は容積品（200kg/㎥）のため、'
    + '区分『重量品』のこの項目には入れていません。'
    + '区分を外すと重量品・容積品の両方を合計します。',
    '外形なしの外形（幅・奥行・高さ）が未設定です。',
    '質量なしの質量が未設定です。',
  ])

  const alone = results.get('alone')!
  expect(alone.total).toBeCloseTo(2.04 * 1.3, 12)
  expect(alone.sources[0].factor).toBeCloseTo(.85 * 1.3, 12)

  const bulky = results.get('bulky')!
  expect(bulky.total).toBeCloseTo(.51, 12)
  expect(bulky.sources[0]).toMatchObject({
    subtotal: 0,
    note: '重量品 1,200kg（区分違い: 容積品だけ）',
  })
  expect(bulky.sources[1]).toMatchObject({ unitMassKg: 300, factor: 1.7 })
  expect(bulky.sources[1].subtotal).toBeCloseTo(.51, 12)
})

it.each([
  [100, 1.30], [250, 1.30], [250.1, 1.20], [500, 1.20],
  [500.1, 1.10], [800, 1.10], [800.1, 1.00], [1000, 1.00],
  [1000.1, .85], [3000, .85], [3000.1, .75], [5000, .75],
  [5000.1, .70], [7000, .70], [7000.1, .60], [10000, .60],
  [10000.1, .50], [15000, .50], [15000.1, .50],
])('B06 heavy mass %s kg uses correction %s with inclusive upper bounds', (massKg, factor) => {
  const result = calculate([
    {
      ...fixture('機器'),
      attributes: { massKg, widthMm: 100, depthMm: 100, heightMm: 100 },
    },
    linked('L', {
      kind: 'carry', sources: [{ itemId: '機器' }], carry: { class: 'heavy' },
    }),
  ], [row('機器', 1)]).get('L')!
  expect(result.sources[0].factor).toBe(factor)
  expect(result.total).toBeCloseTo(massKg / 1000 * factor, 12)
  expect(result.warnings).toEqual(massKg > 15000
    ? ['機器は補正率の表（15,000kg）を超えます。'] : [])
})

it.each([
  [99, 2.50], [100, 2.00], [199, 2.00], [200, 1.70],
  [299, 1.70], [300, 1.40], [399, 1.40], [400, 1.20],
  [499, 1.20], [500, 1.00], [599, 1.00],
])('B06 bulky density %s kg/m3 uses correction %s with exclusive bounds', (density, factor) => {
  const massKg = density * 2
  const result = calculate([
    {
      ...fixture('機器'),
      attributes: { massKg, widthMm: 1000, depthMm: 1000, heightMm: 2000 },
    },
    linked('L', {
      kind: 'carry', sources: [{ itemId: '機器' }], carry: { class: 'bulky' },
    }),
  ], [row('機器', 1)]).get('L')!
  expect(result.sources[0].factor).toBe(factor)
  expect(result.total).toBeCloseTo(massKg / 1000 * factor, 12)
  expect(result.warnings).toEqual([])
})

it('B06 treats exactly 600 kg/m3 as heavy and ignores non-count carry sources', () => {
  const results = calculate([
    {
      ...fixture('境界'),
      attributes: { massKg: 600, widthMm: 1000, depthMm: 1000, heightMm: 1000 },
    },
    {
      ...fixture('長さ', 'length'),
      attributes: { massKg: 600, widthMm: 1000, depthMm: 1000, heightMm: 1000 },
    },
    linked('heavy', {
      kind: 'carry', sources: [{ itemId: '境界' }, { itemId: '長さ' }],
      carry: { class: 'heavy' },
    }),
    linked('bulky', {
      kind: 'carry', sources: [{ itemId: '境界' }], carry: { class: 'bulky' },
    }),
  ], [row('境界', 1), row('長さ', 10)])
  expect(results.get('heavy')!.total).toBeCloseTo(.66, 12)
  expect(results.get('heavy')!.warnings).toEqual([
    '長さは個数の項目ではないため、搬入の元から除外します。',
  ])
  expect(results.get('heavy')!.sources[1]).toMatchObject({
    itemId: '長さ', subtotal: 0, note: '対象外の機器（個数以外）',
  })
  expect(results.get('bulky')!.total).toBe(0)
  expect(results.get('bulky')!.sources[0].note).toBe('重量品 600kg（区分違い: 容積品だけ）')
  expect(results.get('bulky')!.sources[0].carryClass).toBe('heavy')
})

it('B06 auto carry filters disposal rows, preserves bases and applies overrides last', () => {
  const results = calculate([
    {
      ...fixture('盤'),
      conditions: ['新設', '撤去（廃棄）'],
      attributes: { massKg: 1200, widthMm: 800, depthMm: 400, heightMm: 1800 },
    },
    { ...fixture('小型'), attributes: { massKg: 80 } },
    linked('搬出', {
      kind: 'carry', sources: [], carry: { class: 'heavy' },
      auto: { kinds: ['count'], minMassKg: 100, condition: '撤去（廃棄）' },
      override: { value: 9, note: '確認済み' },
    }),
  ], [
    row('盤', 2, 'remove', { condition: '撤去（廃棄）' }),
    row('盤', 10, 'install', { condition: '新設' }),
    row('小型', 10),
  ])
  const result = results.get('搬出')!
  expect(result.computed).toBeCloseTo(2.04, 12)
  expect(result.total).toBe(9)
  expect(result.overridden).toBe(true)
  expect(result.entries).toEqual([])
  expect(result.sources).toHaveLength(1)
  expect(result.sources[0]).toMatchObject({
    itemId: '盤', quantity: 2, unitMassKg: 1200, factor: .85, auto: true,
  })
})

it('B06 carry outputs t, two decimals and mass for every target kind without rounding', async () => {
  const { quantityUnit, quantityDecimals, quantityOutputKind } =
    await import('../src/core/countFixtures')
  const { fixtureLinkRoundsUp } = await import('../src/core/fixtureLink')
  for (const kind of ['count', 'length', 'area', 'volume'] as const) {
    const target = linked('L', {
      kind: 'carry', sources: [{ itemId: 'A' }],
      carry: { class: 'heavy' }, rounding: 'each',
    }, kind)
    expect(quantityUnit(target)).toBe('t')
    expect(quantityDecimals(target)).toBe(2)
    expect(quantityOutputKind(target)).toBe('mass')
    expect(fixtureLinkRoundsUp(target)).toBe(false)
    const result = calculate([
      {
        ...fixture('A'),
        attributes: { massKg: 1200, widthMm: 800, depthMm: 400, heightMm: 1800 },
      },
      target,
    ], [row('A', 1, 'a'), row('A', 1, 'b')]).get('L')!
    expect(result.total).toBeCloseTo(2.04, 12)
    expect(result.entries.map(entry => entry.value)).toEqual([1.02, 1.02])
  }
  expect(quantityUnit({
    link: { kind: 'carry', sources: [], carry: { class: 'bulky' } },
  })).toBe('t')
})

it('B06 defaults E25 unit mass and waste density, with explicit density taking precedence', async () => {
  const { quantityUnit, quantityDecimals, quantityOutputKind } =
    await import('../src/core/countFixtures')
  const source: CountFixture = {
    ...fixture('配管撤去', 'length'),
    code: 'E', spec: '25', conditions: ['撤去（廃棄）'],
  }
  const waste = {
    ...linked('発生材', {
      kind: 'mass', sources: [],
      auto: { condition: '撤去（廃棄）' },
    }),
    attributes: { wasteType: '金属くず' },
  }
  const explicit = {
    ...waste, id: '明示比重',
    link: { ...waste.link!, densityTPerM3: .5 },
  }
  const results = calculate([
    source, waste, explicit,
    linked('質量', { kind: 'mass', sources: [{ itemId: '配管撤去' }] }),
  ], [row('配管撤去', 10, 'pipe', { condition: '撤去（廃棄）', part: 'plan' })])

  const mass = results.get('質量')!
  expect(mass.total).toBeCloseTo(.00716, 12)
  expect(mass.densityTPerM3).toBeUndefined()
  expect(mass.sources[0]).toMatchObject({
    quantity: 10, unitMassKg: .716, note: 'JIS C 8305 の質量',
  })
  expect(mass.warnings).toEqual([])

  const result = results.get('発生材')!
  expect(result.total).toBeCloseTo(.00716 / 1.13, 12)
  expect(result.densityTPerM3).toBe(1.13)
  expect(result.sources[0]).toMatchObject({
    itemId: '配管撤去', quantity: 10, unitMassKg: .716, auto: true,
    note: 'JIS C 8305 の質量',
  })
  expect(result.entries[0]).toMatchObject({
    itemId: '発生材', annotationId: 'pipe', condition: '撤去（廃棄）', part: 'plan',
  })
  expect(result.warnings).toEqual([])
  expect(quantityUnit(waste)).toBe('㎥')
  expect(quantityDecimals(waste)).toBe(2)
  expect(quantityOutputKind(waste)).toBe('volume')

  expect(results.get('明示比重')!.total).toBeCloseTo(.00716 / .5, 12)
  expect(results.get('明示比重')!.densityTPerM3).toBe(.5)
  expect(quantityUnit(explicit)).toBe('㎥')
})

it('B06 conduit lookup removes whitespace, supports code-only keys and respects explicit mass', () => {
  const originals: CountFixture[] = [
    { ...fixture('分割', 'length'), code: ' E ', spec: ' 25 ' },
    { ...fixture('一体', 'length'), code: 'E25' },
    { ...fixture('優先', 'length'), code: 'E', spec: '25', attributes: { unitMassKg: 2 } },
    { ...fixture('個数'), code: 'E25', attributes: { massKg: 12 } },
    { ...fixture('長さ質量', 'length'), code: 'E25', attributes: { massKg: 12 } },
    { ...fixture('不明', 'length'), code: 'unknown' },
    { ...fixture('継承キー', 'length'), code: 'constructor' },
  ]
  const result = calculate([
    ...originals,
    linked('L', {
      kind: 'mass', sources: originals.map(original => ({ itemId: original.id })),
    }),
  ], originals.map(original => row(original.id, 10))).get('L')!
  expect(result.total).toBeCloseTo(.00716 * 2 + .02 + .12, 12)
  expect(result.sources.map(source => source.unitMassKg))
    .toEqual([.716, .716, 2, 12, undefined, undefined, undefined])
  expect(result.sources.slice(0, 2).every(source => source.note === 'JIS C 8305 の質量'))
    .toBe(true)
  expect(result.sources.slice(2).every(source => source.note === undefined)).toBe(true)
  expect(result.warnings).toEqual([
    '長さ質量の質量が未設定です。',
    '不明の質量が未設定です。',
    '継承キーの質量が未設定です。',
  ])
})

it('B06 unknown waste types preserve mass output and explicit density overrides defaults', async () => {
  const { quantityUnit, quantityOutputKind } = await import('../src/core/countFixtures')
  const targets: CountFixture[] = [
    {
      ...linked('unknown', { kind: 'mass', sources: [{ itemId: 'A' }] }),
      attributes: { wasteType: '未登録' },
    },
    {
      ...linked('explicit', {
        kind: 'mass', sources: [{ itemId: 'A' }], densityTPerM3: .5,
      }),
      attributes: { wasteType: '金属くず' },
    },
  ]
  const results = calculate([
    { ...fixture('A'), attributes: { massKg: 12 } }, ...targets,
  ], [row('A', 5)])
  expect(results.get('unknown')!.total).toBeCloseTo(.06, 12)
  expect(results.get('unknown')!.densityTPerM3).toBeUndefined()
  expect(quantityUnit(targets[0])).toBe('t')
  expect(quantityOutputKind(targets[0])).toBe('mass')
  expect(results.get('explicit')!.total).toBeCloseTo(.12, 12)
  expect(results.get('explicit')!.densityTPerM3).toBe(.5)
})

const b06InvalidLinks: unknown[] = [
  { kind: 'carry', sources: [] },
  // SPEC-T15: carry: {}（区分の省略＝重量品・容積品の両方）は正しい形
  ...[null, { class: 'other' }, { class: 'heavy', alone: 1 }].map(carry => ({
    kind: 'carry', sources: [], carry,
  })),
  { kind: 'factor', sources: [], carry: { class: 'heavy' } },
  { kind: 'mass', sources: [], carry: { class: 'bulky' } },
  { kind: 'carry', sources: [], carry: { class: 'heavy' }, densityTPerM3: 1 },
  ...[null, [], 1].map(auto => ({ kind: 'factor', sources: [], auto })),
  ...[null, '照明器具', [1], [''], [' padded '], ['改\n行'], ['あ'.repeat(41)],
    Array(21).fill('照明器具')].flatMap(values => [
    { kind: 'factor', sources: [], auto: { categories: values } },
    { kind: 'factor', sources: [], auto: { nameIncludes: values } },
  ]),
  ...['', ' padded ', '改\n行', 'あ'.repeat(31), 1].map(condition => ({
    kind: 'factor', sources: [], auto: { condition },
  })),
  ...[null, 'count', ['mass'], [1], ['count', 'unknown']].map(kinds => ({
    kind: 'factor', sources: [], auto: { kinds },
  })),
  ...[-1, 1e6 + 1, NaN, Infinity, '100'].map(minMassKg => ({
    kind: 'factor', sources: [], auto: { minMassKg },
  })),
  ...[0, -1, 10000.01, NaN, Infinity, '1'].map(factor => ({
    kind: 'factor', sources: [], auto: {}, factor,
  })),
]

it.each(b06InvalidLinks.map((link, index) => ({ link, index })))(
  'B06 rejects malformed carry or auto configuration $index', ({ link }) => {
    expect(error(link)).toBeTypeOf('string')
    expect(() => serializeCountFixtures([linked('L', link as FixtureLink)])).toThrow()
    const parsed = parseCountFixtures(JSON.stringify({
      version: 1, fixtures: [linked('L', link as FixtureLink)],
    }))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].link).toBeUndefined()
  },
)

it('B06 validates inclusive auto limits, empty arrays and optional carry alone', () => {
  expect(error({
    kind: 'factor', sources: [], factor: 10000,
    auto: {
      categories: Array(20).fill('あ'.repeat(40)),
      nameIncludes: Array(20).fill('い'.repeat(40)),
      condition: 'あ'.repeat(30),
      kinds: ['count', 'length', 'area', 'volume'], minMassKg: 1e6,
    },
  })).toBeUndefined()
  expect(error({
    kind: 'factor', sources: [],
    auto: { categories: [], nameIncludes: [], kinds: [], minMassKg: 0 },
  })).toBeUndefined()
  for (const carry of [
    { class: 'heavy' }, { class: 'bulky', alone: false }, { class: 'heavy', alone: true },
  ]) {
    expect(error({ kind: 'carry', sources: [], carry })).toBeUndefined()
  }
})

it('B06 round-trips auto and carry while stripping unknown fields and cloning arrays', () => {
  const original = linked('L', {
    kind: 'carry',
    sources: [{ itemId: 'A', conditions: ['撤去（廃棄）'] }],
    auto: {
      categories: ['盤類'], nameIncludes: ['盤'], kinds: ['count'],
      condition: '撤去（廃棄）', minMassKg: 100, unwanted: true,
    },
    factor: 2,
    carry: { class: 'heavy', alone: false, unwanted: true },
    rounding: 'none',
    unwanted: true,
  } as unknown as FixtureLink)
  const expected: FixtureLink = {
    kind: 'carry',
    sources: [{ itemId: 'A', conditions: ['撤去（廃棄）'] }],
    auto: {
      categories: ['盤類'], nameIncludes: ['盤'], kinds: ['count'],
      condition: '撤去（廃棄）', minMassKg: 100,
    },
    factor: 2, carry: { class: 'heavy', alone: false }, rounding: 'none',
  }
  const raw = serializeCountFixtures([original])
  expect(JSON.parse(raw).fixtures[0].link).toEqual(expected)
  for (const parsed of [
    parseCountFixtures(raw)[0],
    parseCountFixtures(JSON.stringify({ version: 1, fixtures: [original] }))[0],
  ]) {
    expect(parsed.link).toEqual(expected)
    expect(parsed.link!.auto!.categories).not.toBe(original.link!.auto!.categories)
    expect(parsed.link!.auto!.nameIncludes).not.toBe(original.link!.auto!.nameIncludes)
    expect(parsed.link!.auto!.kinds).not.toBe(original.link!.auto!.kinds)
    expect(parsed.link!.carry).not.toBe(original.link!.carry)
  }

  const empty = linked('empty', {
    kind: 'factor', sources: [], auto: { categories: [], nameIncludes: [], kinds: [], minMassKg: 0 },
  })
  expect(parseCountFixtures(serializeCountFixtures([empty]))[0].link).toEqual(empty.link)
})

it('selects converted rectangular duct area and excludes spiral duct length', () => {
  const rectangular: CountFixture = {
    ...fixture('rectangular', 'length'),
    category: 'ダクト',
    name: '長方形ダクト',
    code: 'SD300×200',
    method: 'polyline',
    convert: { factor: 1, unit: '㎡', basis: '周長 2×(300＋200)mm' },
  }
  const spiral: CountFixture = {
    ...fixture('spiral', 'length'),
    category: 'ダクト',
    name: 'スパイラルダクト',
    method: 'polyline',
  }
  const otherCategory: CountFixture = {
    ...rectangular, id: 'other-category', category: '例',
  }
  const otherKind: CountFixture = {
    ...fixture('other-kind', 'area'), category: 'ダクト',
  }
  const insulation = linked('insulation', {
    kind: 'factor',
    sources: [],
    auto: { categories: ['ダクト'], kinds: ['length'], outputKinds: ['area'] },
  }, 'area')

  const result = calculate(
    [rectangular, spiral, otherCategory, otherKind, insulation],
    [
      row(rectangular.id, 12),
      row(spiral.id, 30),
      row(otherCategory.id, 40),
      row(otherKind.id, 50),
    ],
  ).get(insulation.id)!

  expect(result.error).toBeUndefined()
  expect(result.total).toBe(12)
  expect(result.sources).toEqual([
    { itemId: rectangular.id, quantity: 12, factor: 1, auto: true, subtotal: 12 },
  ])
  expect(result.entries).toEqual([
    row(insulation.id, 12, rectangular.id),
  ])
})

it('validates automatic output kinds and their five-entry limit', () => {
  const outputKindError = '連動の自動の元の出力の種別は個数・長さ・面積・体積・質量から5件までで選んでください。'

  for (const outputKinds of [[], ['area'], ['count', 'length', 'area', 'volume', 'mass']]) {
    expect(error({ kind: 'factor', sources: [], auto: { outputKinds } })).toBeUndefined()
  }
  for (const outputKinds of [
    ['invalid'],
    ['㎡'],
    ['area', null],
    ['count', 'length', 'area', 'volume', 'mass', 'count'],
    'area',
    null,
    Array(1),
  ]) {
    expect(error({ kind: 'factor', sources: [], auto: { outputKinds } })).toBe(outputKindError)
  }
})

it('preserves and clones automatic output kinds when reading and serializing links', () => {
  const original = linked('output-kinds', {
    kind: 'factor',
    sources: [],
    auto: { outputKinds: ['count', 'length', 'area', 'volume', 'mass'] },
  })
  const read = readFixtureLink(original)!
  expect(read).toEqual(original.link)
  expect(read.auto!.outputKinds).not.toBe(original.link!.auto!.outputKinds)

  const parsed = parseCountFixtures(serializeCountFixtures([original]))[0]
  expect(parsed.link).toEqual(original.link)
  expect(parsed.link!.auto!.outputKinds).not.toBe(original.link!.auto!.outputKinds)

  const empty = linked('empty-kinds', { // the id is also the code (16 characters at most)
    kind: 'factor', sources: [], auto: { outputKinds: [] },
  })
  expect(readFixtureLink(empty)).toEqual(empty.link)
  expect(parseCountFixtures(serializeCountFixtures([empty]))[0].link).toEqual(empty.link)
  expect(calculate([fixture('source'), empty], [row('source', 10)]).get(empty.id)!.sources).toEqual([])
})

it('B07-2a: empty rcKinds selects every ordinary RC member and excludes non-RC items', () => {
  const kinds: NonNullable<NonNullable<FixtureLink['auto']>['rcKinds']> = [
    'slab', 'foundationSlab', 'wall', 'beam', 'foundationBeam', 'column', 'footing',
  ]
  const originals: CountFixture[] = kinds.map((kind, index) => ({
    ...fixture(`rc${index}`, 'area'),
    rc: { kind, bars: [] },
  }))
  const target = linked('B072-all', {
    kind: 'rc', rc: { output: 'concrete' }, sources: [], auto: { rcKinds: [] },
  })
  const alreadyLinked: CountFixture = {
    ...originals[0],
    id: 'B072-linked',
    link: { kind: 'factor', sources: [] },
  }
  expect(selectB072Sources([
    ...originals, fixture('ordinary', 'area'), alreadyLinked, target,
  ], target).map(source => source.itemId)).toEqual(originals.map(item => item.id))

  target.link!.auto = { rcKinds: ['slab', 'footing'] }
  expect(selectB072Sources(originals, target).map(source => source.itemId))
    .toEqual(['rc0', 'rc6'])
})

it('B07-2a: rcKinds is combined with every other automatic source condition', () => {
  const matching: CountFixture = {
    ...fixture('B072-match', 'area'),
    category: '対象',
    name: '地下の床板',
    conditions: ['地下'],
    attributes: { massKg: 100 },
    rc: { kind: 'slab', bars: [] },
  }
  const originals: CountFixture[] = [
    matching,
    { ...matching, id: 'B072-category', category: '対象外' },
    { ...matching, id: 'B072-name', name: '壁' },
    { ...matching, id: 'B072-condition', conditions: ['地上'] },
    { ...matching, id: 'B072-kind', kind: 'count' },
    { ...matching, id: 'B072-output', convert: { factor: 1, unit: '㎥', basis: '試験' } },
    { ...matching, id: 'B072-mass', attributes: { massKg: 99 } },
    { ...matching, id: 'B072-member', rc: { kind: 'wall', bars: [] } },
    { ...matching, id: 'B072-no-rc', rc: undefined },
  ]
  const target = linked('B072-filter', {
    kind: 'rc', rc: { output: 'concrete' }, sources: [],
    auto: {
      rcKinds: ['slab'],
      categories: ['対象'],
      nameIncludes: ['床板'],
      condition: '地下',
      kinds: ['area'],
      outputKinds: ['area'],
      minMassKg: 100,
    },
  })
  expect(selectB072Sources(originals, target)).toEqual([
    { itemId: matching.id, factor: 1, auto: true, conditions: ['地下'] },
  ])
})

it('B07-2a: validates and round-trips rcKinds, including the empty array', () => {
  const allKinds = [
    'slab', 'foundationSlab', 'wall', 'beam', 'foundationBeam', 'column', 'footing',
  ] as const
  expect(error({
    kind: 'rc', rc: { output: 'concrete' }, sources: [], auto: { rcKinds: allKinds },
  })).toBeUndefined()
  for (const rcKinds of [null, {}, ['unknown'], [1], Array(1), Array(8).fill('slab')]) {
    expect(error({
      kind: 'rc', rc: { output: 'concrete' }, sources: [], auto: { rcKinds },
    })).toBeDefined()
  }
  for (const rcKinds of [[], ['slab', 'footing']] as Array<
    NonNullable<NonNullable<FixtureLink['auto']>['rcKinds']>
  >) {
    const target = linked('B072-auto', {
      kind: 'rc', rc: { output: 'rebar', basis: 'required' },
      sources: [], auto: { rcKinds },
    })
    const read = readFixtureLink(target)!
    expect(read).toEqual(target.link)
    expect(read.auto!.rcKinds).not.toBe(rcKinds)
    expect(parseCountFixtures(serializeCountFixtures([target]))[0].link)
      .toEqual(target.link)
  }
})

it('B07-2a: validates and round-trips clearanceM without adding marginM', () => {
  for (const clearanceM of [0, 5]) {
    const target = linked('B072-shape', {
      kind: 'shape', sources: [],
      shape: { output: 'excavation', clearanceM },
    })
    expect(fixtureLinkError(target)).toBeUndefined()
    expect(readFixtureLink(target)).toEqual(target.link)
    expect(parseCountFixtures(serializeCountFixtures([target]))[0].link)
      .toEqual(target.link)
    expect(readFixtureLink(target)!.shape).not.toHaveProperty('marginM')
  }
  for (const clearanceM of [-0.1, 5.1, NaN, Infinity, '0.5', null]) {
    expect(error({
      kind: 'shape', sources: [], shape: { output: 'excavation', clearanceM },
    })).toBeDefined()
  }
})

const b072ExcavationCases: Array<{
  depthM: number
  settings?: Omit<NonNullable<FixtureLink['shape']>, 'output'>
  total: number
  note: string
}> = [
  { depthM: 1, total: 20, note: '余幅 0.5m（ゆとり 0.5、法 0）' },
  { depthM: 2, total: 51.52, note: '余幅 0.8m（ゆとり 0.5、法 0.3）' },
  { depthM: 6, total: 392.16, note: '余幅 2.3m（ゆとり 0.5、法 0.6）' },
  { depthM: 1.5, total: 36.37875, note: '余幅 0.725m（ゆとり 0.5、法 0.3）' },
  { depthM: 5, total: 280, note: '余幅 2m（ゆとり 0.5、法 0.6）' },
  {
    depthM: 2, settings: { clearanceM: 0.1 },
    total: 36.48, note: '余幅 0.4m（ゆとり 0.1、法 0.3）',
  },
  {
    depthM: 6, settings: { marginM: 0.25, clearanceM: 5 },
    total: 94.5, note: '余幅 0.25m（指定）',
  },
  {
    depthM: 2, settings: { marginM: 0, clearanceM: 5 },
    total: 24, note: '余幅 0m（指定）',
  },
  {
    depthM: 2, settings: { depthM: 6 },
    total: 51.52, note: '余幅 0.8m（ゆとり 0.5、法 0.3）',
  },
]

it.each(b072ExcavationCases)(
  'B07-2a: excavation at depth $depthM with $settings records $note',
  ({ depthM, settings, total, note }) => {
    const original = fixture('B072-base', 'volume')
    const target = linked('B072-dig', {
      kind: 'shape',
      sources: [{ itemId: original.id }],
      shape: { output: 'excavation', ...settings },
    })
    const metric = {
      annotationId: 'B072-floor',
      pageIndex: 0,
      method: 'polygonDepth',
      areaM2: 12,
      perimeterM: 14,
      lengthM: 0,
      depthM,
      count: 1,
    } as ReturnType<NonNullable<Parameters<typeof computeLinks>[2]>>[number]
    const result = computeLinks(
      [original, target], () => [], id => id === original.id ? [metric] : [],
    ).get(target.id)!
    expect(result.error).toBeUndefined()
    expect(result.warnings).toEqual([])
    expect(result.computed).toBeCloseTo(total, 8)
    expect(result.total).toBeCloseTo(total, 8)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].value).toBeCloseTo(total, 8)
    expect(result.sources[0].quantity).toBeCloseTo(total, 8)
    expect(result.sources[0].note).toBe(`B072-floor: ${note}`)
  },
)

it('B07-2a: excavation uses the configured depth when the metric has no depth', () => {
  const original = fixture('B072-base', 'area')
  const target = linked('B072-dig', {
    kind: 'shape', sources: [{ itemId: original.id }],
    shape: { output: 'excavation', depthM: 2 },
  })
  const metric = {
    annotationId: 'B072-floor', pageIndex: 0, method: 'polygon',
    areaM2: 12, perimeterM: 14, lengthM: 0, count: 1,
  } as ReturnType<NonNullable<Parameters<typeof computeLinks>[2]>>[number]
  const result = computeLinks(
    [original, target], () => [], id => id === original.id ? [metric] : [],
  ).get(target.id)!
  expect(result.warnings).toEqual([])
  expect(result.total).toBeCloseTo(51.52, 8)
  expect(result.sources[0].note).toContain('余幅 0.8m（ゆとり 0.5、法 0.3）')
})

it('nameExcludes は1〜20件・各40字を受け付け、読込時に複製する', () => {
  const words = Array.from({ length: 20 }, (_, index) =>
    `${index}`.padEnd(40, '除'))
  const target = linked('exclude-valid', {
    kind: 'factor',
    sources: [],
    auto: { nameIncludes: ['壁'], nameExcludes: words },
  })
  expect(fixtureLinkError(target)).toBeUndefined()

  const read = readFixtureLink(target)
  expect(read).toEqual(target.link)
  expect(read?.auto?.nameExcludes).not.toBe(words)
  words[0] = '変更'
  expect(read?.auto?.nameExcludes?.[0]).toBe('0'.padEnd(40, '除'))

  expect(error({
    kind: 'factor',
    sources: [],
    auto: { nameExcludes: ['撤去'] },
  })).toBeUndefined()
})

it.each([
  [],
  Array.from({ length: 21 }, (_, index) => `除外${index}`),
  [''],
  ['除'.repeat(41)],
  [' 撤去'],
  ['撤去 '],
  ['撤\r去'],
  ['撤\n去'],
  ['撤\t去'],
  ['撤\u2028去'],
  ['撤\u2029去'],
  ['撤去', 1],
  '撤去',
  null,
])('不正なnameExcludes %j を拒否する', nameExcludes => {
  expect(error({
    kind: 'factor',
    sources: [],
    auto: { nameExcludes },
  })).toContain('除外語')
})

it('nameExcludes のいずれかを名称に含む項目だけを自動の元から除く', () => {
  const wall = { ...fixture('wall', 'area'), name: '壁下地' }
  const removal = { ...fixture('removal', 'area'), name: '壁下地撤去' }
  const temporary = { ...fixture('temporary', 'area'), name: '仮設壁下地' }
  const other = { ...fixture('other', 'area'), name: '床下地' }
  const target = linked('exclude-target', {
    kind: 'factor',
    factor: 1,
    sources: [],
    auto: {
      nameIncludes: ['壁下地'],
      nameExcludes: ['撤去', '仮設'],
      kinds: ['area'],
    },
  }, 'area')
  const fixtures = [wall, removal, temporary, other, target]

  expect(selectB072Sources(fixtures, target).map(source => source.itemId))
    .toEqual([wall.id])

  const result = calculate(fixtures, [
    row(wall.id, 10),
    row(removal.id, 20),
    row(temporary.id, 30),
    row(other.id, 40),
  ]).get(target.id)
  expect(result?.total).toBeCloseTo(10, 9)
})

it('nameExcludes は手動指定した元を削除しない', () => {
  const original = { ...fixture('manual-removal'), name: '壁撤去' }
  const target = linked('manual-exclude-target', {
    kind: 'factor',
    sources: [{ itemId: original.id, factor: 2 }],
    auto: { nameIncludes: ['壁'], nameExcludes: ['撤去'] },
  })
  expect(selectB072Sources([original, target], target)).toEqual([
    { itemId: original.id, factor: 2 },
  ])
})

it('nameExcludes のない旧autoとoriginAnyをそのまま読込・照合できる', () => {
  const wall = { ...fixture('legacy-wall'), name: '壁下地', category: '分類A' }
  const removal = {
    ...fixture('legacy-removal'), name: '壁下地撤去', category: '分類A',
  }
  const other = { ...fixture('legacy-other'), name: '壁下地', category: '分類B' }
  const target = linked('legacy-target', {
    kind: 'factor',
    sources: [],
    auto: {
      originAny: [{ categories: ['分類A'], nameIncludes: ['壁下地'] }],
      kinds: ['count'],
    },
  })
  expect(fixtureLinkError(target)).toBeUndefined()
  const read = readFixtureLink(target)
  expect(read).toEqual(target.link)
  expect(read?.auto?.nameExcludes).toBeUndefined()
  expect(selectB072Sources([wall, removal, other, target], target)
    .map(source => source.itemId)).toEqual([wall.id, removal.id])
})

it('originAnyとnameExcludesを併用すると枝のAND・ORと除外を維持する', () => {
  const a = { ...fixture('branch-a'), name: '壁A', category: '分類A' }
  const b = { ...fixture('branch-b'), name: '壁B', category: '分類B' }
  const crossed = {
    ...fixture('branch-crossed'), name: '壁B', category: '分類A',
  }
  const removal = {
    ...fixture('branch-removal'), name: '壁A撤去', category: '分類A',
  }
  const target = linked('branch-target', {
    kind: 'factor',
    sources: [],
    auto: {
      originAny: [
        { categories: ['分類A'], nameIncludes: ['壁A'] },
        { categories: ['分類B'], nameIncludes: ['壁B'] },
      ],
      nameExcludes: ['撤去'],
    },
  })
  expect(selectB072Sources([a, b, crossed, removal, target], target)
    .map(source => source.itemId)).toEqual([a.id, b.id])
})
