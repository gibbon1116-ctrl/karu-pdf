import { expect, it } from 'vitest'
import {
  nextCountStyle,
  parseCountFixtures,
  serializeCountFixtures,
  type CountFixture,
} from '../src/core/countFixtures'
import {
  parseQuantityMark,
  routeMembers,
  serializeQuantityMark,
  type QuantityMark,
  type RouteExtra,
} from '../src/core/quantity'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function lineFixture(id: string): CountFixture {
  return {
    id,
    name: id,
    code: id,
    category: '試験',
    order: 0,
    kind: 'length',
    method: 'polyline',
    style: nextCountStyle([]),
  }
}

function spiralFixture(): CountFixture {
  return {
    ...lineFixture('spiral'),
    code: 'SP',
    spec: 'D10',
    name: 'スパイラル筋',
    order: 1,
    convert: {
      factor: 0.00056,
      unit: 't',
      basis: 'D10 0.56kg/m ÷ 1000',
    },
  }
}

function trenchFixture(): CountFixture {
  return {
    ...lineFixture('trench'),
    name: 'ケーブル・配管の溝掘削',
    order: 2,
    kind: 'volume',
    method: 'lengthWidthDepth',
    defaults: { widthM: 0.6, depthM: 0.8 },
  }
}

function routeInput(
  id: string,
  lengthM = 10,
  values: Partial<QuantityMark> = {},
) {
  const quantity: QuantityMark = {
    version: 1,
    id,
    itemId: 'main',
    method: 'polyline',
    rises: [{ m: 3, at: 1 }],
    slackM: 1,
    ...values,
  }
  return {
    pageIndex: 0,
    kind: 'perimeter' as const,
    rect: [0, 0, lengthM, 1] as [number, number, number, number],
    vertices: [
      [0, 0],
      [lengthM / 2, 0],
      [lengthM, 0],
    ] as [number, number][],
    measure: {
      kind: 'perimeter' as const,
      mmPerPoint: 1000,
      unit: 'mm' as const,
      decimals: null,
    },
    quantity,
  }
}

async function setup() {
  const store = new AnnotationStore()
  const fixtures = [
    lineFixture('main'),
    spiralFixture(),
    trenchFixture(),
    { ...lineFixture('other'), order: 3 },
  ]
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const annotation = store.create(routeInput('route', 10, { cond: {} }))
  return { store, id: annotation.id }
}

it('copies perM, recalculates converted quantities and restores composition memory with Undo/Redo', async () => {
  const { store, id } = await setup()
  const members: RouteExtra[] = [
    { itemId: 'main', count: 1 },
    {
      itemId: 'spiral',
      count: 2,
      perM: 18.85,
      cond: { slack: null },
    },
  ]

  store.setRouteItems(id, members)
  const updated = store.get(id)!
  expect(updated.quantity?.extra).toEqual([members[1]])
  expect(updated.text).toContain('SP D10×2 ×18.850/m')
  expect(store.quantityIndex().total('spiral'))
    .toBeCloseTo(13 * 2 * 18.85 * 0.00056, 12)
  expect(parseQuantityMark(serializeQuantityMark(updated.quantity!))?.extra)
    .toEqual(updated.quantity?.extra)

  members[1].perM = 2
  members[1].cond!.slack = '変更'
  expect(store.get(id)?.quantity?.extra?.[0]).toEqual({
    itemId: 'spiral',
    count: 2,
    perM: 18.85,
    cond: { slack: null },
  })

  store.undo()
  expect(store.get(id)?.quantity?.extra).toBeUndefined()
  expect(store.routeTemplateItems('main').extra ?? []).toEqual([])

  store.redo()
  expect(store.get(id)?.quantity?.extra?.[0].perM).toBe(18.85)
  expect(store.routeTemplateItems('main').extra?.[0].perM).toBe(18.85)

  const beforeNoOp = store.get(id)?.quantity
  store.setRouteMembers(id, routeMembers(beforeNoOp!))
  expect(store.get(id)?.quantity).toEqual(beforeNoOp)
  store.undo()
  expect(store.get(id)?.quantity?.extra).toBeUndefined()
})

it.each([
  0,
  -1,
  '18.85',
  Number.NaN,
  Number.POSITIVE_INFINITY,
  10000.001,
  0.0001,
  1.2345,
])('rejects perM %s before adding fixtures, changing memory or consuming history', async perM => {
  const { store, id } = await setup()
  const before = store.get(id)?.quantity
  const memory = store.routeTemplateItems('main')
  const added = { ...lineFixture('added'), order: 4 }

  store.addFixturesAndSetRouteItems([added], id, [
    { itemId: 'main', count: 1 },
    { itemId: 'added', count: 1, perM: perM as number },
  ])

  expect(store.getCountFixture('added')).toBeUndefined()
  expect(store.get(id)?.quantity).toEqual(before)
  expect(store.routeTemplateItems('main')).toEqual(memory)
  store.undo()
  expect(store.get(id)).toBeUndefined()
})

it('accepts the coefficient boundaries and keeps explicit main perM 1 implicit', async () => {
  const { store, id } = await setup()
  store.setRouteMembers(id, [
    { itemId: 'main', count: 1, perM: 1 },
    { itemId: 'spiral', count: 1, perM: 0.001 },
    { itemId: 'other', count: 1, perM: 10000 },
  ])

  const mark = store.get(id)!.quantity!
  expect(mark).not.toHaveProperty('perM')
  expect(mark.extra?.map(e => e.perM)).toEqual([0.001, 10000])
  expect(routeMembers(mark)[0].perM).toBeUndefined()
})

it('keeps trench extras on plan length through inherited and explicit templates', async () => {
  const { store, id } = await setup()
  store.setRouteMembers(id, [
    { itemId: 'main', count: 1 },
    { itemId: 'spiral', count: 1, perM: 18.85 },
    { itemId: 'trench', count: 1, perM: 2 },
  ])

  expect(store.get(id)?.quantity?.extra?.[1]).toEqual({
    itemId: 'trench',
    count: 1,
    perM: 2,
    cond: { rise: null, slack: null },
  })
  expect(store.quantityIndex().total('trench'))
    .toBeCloseTo(10 * 2 * 0.6 * 0.8, 12)

  const inherited = store.routeTemplateItems('main')
  expect(inherited.extra?.map(e => [e.itemId, e.perM]))
    .toEqual([['spiral', 18.85], ['trench', 2]])

  const next = store.create(routeInput('inherited'))
  expect(next.quantity?.extra).toEqual(inherited.extra)

  store.setRouteTemplate({
    itemId: 'main',
    count: 2,
    name: '構成',
    extra: [
      { itemId: 'spiral', count: 1, perM: 18.85 },
      { itemId: 'trench', count: 1, perM: 2 },
      { itemId: 'missing', count: 1 },
    ],
  })
  const explicit = store.routeTemplateItems('main')
  expect(explicit.extra?.map(e => [e.itemId, e.perM]))
    .toEqual([['spiral', 18.85], ['trench', 2]])
  expect(explicit.extra?.[1].cond).toEqual({ rise: null, slack: null })

  explicit.extra![0].perM = 3
  explicit.extra![1].cond!.plan = null
  expect(store.routeTemplate?.extra[0].perM).toBe(18.85)
  expect(store.routeTemplate?.extra[1].cond).toBeUndefined()

  const fromTemplate = store.create(routeInput('template'))
  expect(fromTemplate.quantity).toMatchObject({
    count: 2,
    extra: [
      { itemId: 'spiral', perM: 18.85 },
      { itemId: 'trench', perM: 2, cond: { rise: null, slack: null } },
    ],
  })
})

it('preserves coefficients and total quantities when splitting and undoing a route', async () => {
  const { store, id } = await setup()
  store.setRouteMembers(id, [
    { itemId: 'main', count: 1 },
    { itemId: 'spiral', count: 1, perM: 18.85 },
    { itemId: 'trench', count: 1, perM: 2 },
  ])
  const before = store.get(id)!
  const spiralTotal = store.quantityIndex().total('spiral')
  const trenchTotal = store.quantityIndex().total('trench')

  const splitId = store.splitRoute(id, 1)
  expect(splitId).toBeDefined()
  for (const routeId of [id, splitId!]) {
    expect(store.get(routeId)?.quantity?.extra?.map(e => e.perM))
      .toEqual([18.85, 2])
  }
  expect(store.get(splitId!)?.quantity?.rises).toEqual([{ m: 3, at: 0 }])
  expect(store.quantityIndex().total('spiral')).toBeCloseTo(spiralTotal, 12)
  expect(store.quantityIndex().total('trench')).toBeCloseTo(trenchTotal, 12)

  store.undo()
  expect(store.get(splitId!)).toBeUndefined()
  expect(store.get(id)?.quantity).toEqual(before.quantity)
  expect(store.get(id)?.vertices).toEqual(before.vertices)

  store.redo()
  expect(store.get(splitId!)?.quantity?.extra?.map(e => e.perM))
    .toEqual([18.85, 2])
  expect(store.quantityIndex().total('spiral')).toBeCloseTo(spiralTotal, 12)
  expect(store.quantityIndex().total('trench')).toBeCloseTo(trenchTotal, 12)
})

it('copies a composition onto another mark while keeping its geometry and independent coefficients', async () => {
  const { store, id } = await setup()
  store.setRouteMembers(id, [
    { itemId: 'main', count: 1 },
    { itemId: 'spiral', count: 1, perM: 18.85 },
    { itemId: 'trench', count: 1, perM: 2 },
  ])
  const target = store.create(routeInput('target', 20, {
    cond: {},
    extra: [],
    rises: [{ m: 7, at: 2 }],
    slackM: 2,
  }))
  const composition = routeMembers(store.get(id)!.quantity!)

  store.setRouteItems(target.id, composition)
  expect(store.get(target.id)?.quantity?.extra)
    .toEqual(store.get(id)?.quantity?.extra)
  expect(store.get(target.id)?.vertices).toEqual(target.vertices)
  expect(store.get(target.id)?.quantity).toMatchObject({
    rises: [{ m: 7, at: 2 }],
    slackM: 2,
  })
  expect(store.quantityIndex().total('spiral'))
    .toBeCloseTo((14 + 29) * 18.85 * 0.00056, 12)
  expect(store.quantityIndex().total('trench'))
    .toBeCloseTo((10 + 20) * 2 * 0.6 * 0.8, 12)

  store.setRouteMembers(id, composition.map(e =>
    e.itemId === 'spiral' ? { ...e, perM: 2 } : e))
  expect(store.get(target.id)?.quantity?.extra?.[0].perM).toBe(18.85)
})

it('rejects scaled main items and refuses to merge a scaled extra into the main item', async () => {
  const { store, id } = await setup()
  const before = store.get(id)?.quantity

  store.setRouteMembers(id, [
    { itemId: 'spiral', count: 1, perM: 18.85 },
    { itemId: 'main', count: 1 },
  ])
  expect(store.get(id)?.quantity).toEqual(before)

  store.setRouteMembers(id, [
    { itemId: 'trench', count: 1 },
    { itemId: 'main', count: 1 },
  ])
  expect(store.get(id)?.quantity).toEqual(before)

  store.setRouteMembers(id, [
    { itemId: 'main', count: 1 },
    { itemId: 'spiral', count: 1, perM: 18.85 },
  ])
  const scaled = store.get(id)?.quantity
  expect(store.reassignCounts([id], 'spiral')).toContain('係数')
  expect(store.get(id)?.quantity).toEqual(scaled)
})

it('preserves scaled extras when deleting the main fixture and rejects deletion without an eligible replacement', async () => {
  const { store, id } = await setup()
  store.setRouteMembers(id, [
    { itemId: 'main', count: 1 },
    { itemId: 'spiral', count: 1, perM: 18.85 },
    { itemId: 'trench', count: 1, perM: 2 },
  ])
  const beforeRejectedRemoval = store.get(id)?.quantity
  const fixtures = store.getCountFixtures()

  expect(() => store.setCountFixtures(
    fixtures.filter(f => f.id !== 'main'),
    ['main'],
  )).toThrow('主にできる線項目')
  expect(store.getCountFixtures()).toEqual(fixtures)
  expect(store.get(id)?.quantity).toEqual(beforeRejectedRemoval)
  store.undo()
  expect(store.get(id)?.quantity?.extra).toBeUndefined()
  store.redo()

  store.setRouteMembers(id, [
    { itemId: 'main', count: 1 },
    { itemId: 'spiral', count: 1, perM: 18.85 },
    { itemId: 'other', count: 1 },
    { itemId: 'trench', count: 1, perM: 2 },
  ])
  const beforeRemoval = store.get(id)?.quantity
  const spiralTotal = store.quantityIndex().total('spiral')
  const trenchTotal = store.quantityIndex().total('trench')

  store.setCountFixtures(
    store.getCountFixtures().filter(f => f.id !== 'main'),
    ['main'],
  )
  expect(store.get(id)?.quantity).toMatchObject({
    method: 'polyline',
    itemId: 'other',
    extra: [
      { itemId: 'spiral', perM: 18.85 },
      { itemId: 'trench', perM: 2 },
    ],
  })
  expect(store.quantityIndex().total('spiral')).toBeCloseTo(spiralTotal, 12)
  expect(store.quantityIndex().total('trench')).toBeCloseTo(trenchTotal, 12)

  store.undo()
  expect(store.getCountFixture('main')).toBeDefined()
  expect(store.get(id)?.quantity).toEqual(beforeRemoval)
})

it('validates saved line columns and walls using their pickup method', () => {
  const column: CountFixture = {
    ...lineFixture('column'),
    rc: {
      kind: 'column',
      widthMm: 600,
      depthMm: 600,
      bars: [
        { role: 'main', size: 'D22', count: 12 },
        { role: 'hoop', size: 'D10', spacingMm: 100 },
      ],
    },
  }
  const wall: CountFixture = {
    ...lineFixture('wall'),
    rc: {
      kind: 'wall',
      thicknessMm: 200,
      heightMm: 3000,
      bars: [],
    },
  }

  expect(parseCountFixtures(serializeCountFixtures([column, wall])))
    .toEqual([column, wall])

  expect(() => serializeCountFixtures([{
    ...column,
    rc: { ...column.rc!, widthMm: undefined },
  }])).toThrow('幅')
  expect(() => serializeCountFixtures([{
    ...wall,
    rc: { ...wall.rc!, heightMm: undefined },
  }])).toThrow('高さ')
  expect(() => serializeCountFixtures([{
    ...wall,
    rc: { ...wall.rc!, thicknessMm: undefined },
  }])).toThrow('厚さ')

  const countedColumn: CountFixture = {
    ...column,
    kind: 'count',
    method: 'click',
  }
  expect(() => serializeCountFixtures([countedColumn])).toThrow('高さ')
  expect(() => serializeCountFixtures([{
    ...countedColumn,
    rc: { ...countedColumn.rc!, heightMm: 3500 },
  }])).not.toThrow()

  const shapeColumn: CountFixture = {
    ...column,
    kind: 'volume',
    method: 'polygonDepth',
    rc: { kind: 'column', bars: [] },
  }
  expect(() => serializeCountFixtures([shapeColumn])).not.toThrow()
})
