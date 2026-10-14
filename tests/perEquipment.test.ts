import { expect, it } from 'vitest'
import {
  fixtureIdentity,
  nextCountStyle,
  type CountFixture,
  type FixturePreset,
} from '../src/core/countFixtures'
import type { CountComponent } from '../src/core/counts'
import type { QuantityIndex } from '../src/core/quantityIndex'
import {
  isPerEquipmentComponent,
  perEquipmentComponentFixture,
  perEquipmentComponentIdentity,
} from '../src/core/perEquipment'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { resolveRelatedCountComponent } from '../src/app/relatedCountComponents'

const rememberedOf = (store: AnnotationStore) =>
  (store as unknown as { lastCountComponents: Map<string, CountComponent[]> }).lastCountComponents


function fixture(id: string, name: string, order: number): CountFixture {
  return {
    id, name, order, code: id, category: '機械',
    kind: 'count', method: 'click', unit: '台',
    style: nextCountStyle([]),
  }
}

function initialFixtures(): CountFixture[] {
  return [
    fixture('BOILER', 'ボイラー', 0),
    fixture('TOWER', '冷却塔', 1),
    {
      ...fixture('INSTALL', '機器据付', 2),
      summary: [{ label: '形式', value: '標準' }],
      conditions: ['屋内', '屋外'],
      defaultCondition: '屋内',
      breakdown: {
        book: '機械設備', section: '空気調和設備',
        subject: '熱源機器設備', item: '搬入・据付費',
      },
      attributes: { massKg: 100 },
      remark: '基の備考',
    },
    fixture('SLEEVE', 'スリーブ', 3),
    fixture('PIPE', '冷媒管', 4),
  ]
}

async function setup(fixtures = initialFixtures()) {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(
    async () => structuredClone(fixtures),
    async () => {},
  )
  return store
}

function mark(store: AnnotationStore, fixtureId: string) {
  return store.create({
    pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10], symbol: 'circle',
    count: { version: 2, id: crypto.randomUUID(), fixtureId },
  })
}

function components(store: AnnotationStore, id: string): CountComponent[] {
  const count = store.get(id)?.count
  return count?.version === 2 ? count.extra ?? [] : []
}

function named(store: AnnotationStore, name: string): CountFixture {
  const matches = store.getCountFixtures().filter(fixture => fixture.name === name)
  expect(matches).toHaveLength(1)
  return matches[0]!
}

it('adds separate boiler and cooling-tower components with separate quantities', async () => {
  const store = await setup()
  const boiler = mark(store, 'BOILER')
  const tower = mark(store, 'TOWER')

  expect(store.addComponentToFixture('BOILER', 'INSTALL')).toMatchObject({
    changed: 1, skipped: 0,
  })
  expect(store.addComponentToFixture('TOWER', 'INSTALL')).toMatchObject({
    changed: 1, skipped: 0,
  })

  const boilerInstall = named(store, '機器据付（ボイラー BOILER）')
  const towerInstall = named(store, '機器据付（冷却塔 TOWER）')
  expect(boilerInstall.id).not.toBe(towerInstall.id)
  expect(boilerInstall.summary).toEqual([
    { label: '名称', value: 'ボイラー BOILER' },
    { label: '形式', value: '標準' },
  ])
  expect(towerInstall.summary).toEqual([
    { label: '名称', value: '冷却塔 TOWER' },
    { label: '形式', value: '標準' },
  ])
  expect(components(store, boiler.id)).toEqual([
    { itemId: boilerInstall.id, count: 1 },
  ])
  expect(components(store, tower.id)).toEqual([
    { itemId: towerInstall.id, count: 1 },
  ])

  const index: QuantityIndex = store.quantityIndex()
  expect(index.total(boilerInstall.id)).toBe(1)
  expect(index.total(towerInstall.id)).toBe(1)
  expect(index.total('INSTALL')).toBe(0)
  expect(store.getCountFixture('INSTALL')?.name).toBe('機器据付')
})

it('reuses one item for repeated additions to the same parent', async () => {
  const store = await setup()
  const first = mark(store, 'BOILER')
  const second = mark(store, 'BOILER')

  expect(store.addComponentToFixture('BOILER', 'INSTALL').changed).toBe(2)
  const install = named(store, '機器据付（ボイラー BOILER）')
  const fixturesBefore = structuredClone(store.getCountFixtures())
  expect(store.addComponentToFixture('BOILER', 'INSTALL')).toMatchObject({
    changed: 0, skipped: 0,
  })
  expect(store.getCountFixtures()).toEqual(fixturesBefore)
  expect(components(store, first.id)).toEqual([{ itemId: install.id, count: 1 }])
  expect(components(store, second.id)).toEqual([{ itemId: install.id, count: 1 }])
  expect(store.quantityIndex().total(install.id)).toBe(2)
})

it('keeps sleeve and refrigerant-pipe components shared between parents', async () => {
  const store = await setup()
  const boiler = mark(store, 'BOILER')
  const tower = mark(store, 'TOWER')
  for (const parent of ['BOILER', 'TOWER']) {
    for (const item of ['SLEEVE', 'PIPE']) {
      expect(store.addComponentToFixture(parent, item).error).toBeUndefined()
    }
  }
  for (const annotation of [boiler, tower]) {
    expect(components(store, annotation.id)).toEqual([
      { itemId: 'SLEEVE', count: 1 },
      { itemId: 'PIPE', count: 1 },
    ])
  }
  expect(store.getCountFixtures()).toHaveLength(initialFixtures().length)
  expect(store.quantityIndex().total('SLEEVE')).toBe(2)
  expect(store.quantityIndex().total('PIPE')).toBe(2)
})

it('preserves base fields, replaces the name summary slot, and does not mutate inputs', () => {
  const fixtures = initialFixtures()
  const parent = fixtures[0]!
  const base: CountFixture = {
    ...fixtures[2]!,
    summary: [
      { label: '形式', value: '標準' },
      { label: '名称', value: '旧名称' },
      { label: '質量', value: '100kg' },
    ],
    memo: '基のメモ',
  }
  const before = structuredClone(base)
  const resolved = perEquipmentComponentFixture(base, parent, fixtures)
  expect(base).toEqual(before)
  expect(resolved.newFixtures).toEqual([resolved.fixture])
  expect(resolved.fixture.id).not.toBe(base.id)
  expect(resolved.fixture.order).toBe(5)
  expect(resolved.fixture.style).toEqual(nextCountStyle(fixtures))
  expect(resolved.fixture.summary).toEqual([
    { label: '形式', value: '標準' },
    { label: '名称', value: 'ボイラー BOILER' },
    { label: '質量', value: '100kg' },
  ])
  expect(resolved.fixture).toMatchObject({
    category: base.category,
    unit: base.unit,
    conditions: base.conditions,
    defaultCondition: base.defaultCondition,
    breakdown: base.breakdown,
    attributes: base.attributes,
    remark: base.remark,
    memo: base.memo,
    kind: base.kind,
    method: base.method,
  })
  expect(resolved.fixture.conditions).not.toBe(base.conditions)
  expect(resolved.fixture.attributes).not.toBe(base.attributes)
})

it('normalizes target names and leaves already specialized or non-count items unchanged', () => {
  const fixtures = initialFixtures()
  const parent = fixtures[0]!
  for (const name of [
    '機器 据付', '機器用基礎', '機器取外し再取付け', '機器撤去',
  ]) {
    const base = { ...fixtures[2]!, name }
    expect(isPerEquipmentComponent(base)).toBe(true)
    expect(perEquipmentComponentFixture(base, parent, fixtures).fixture.name)
      .toBe(`${name}（ボイラー BOILER）`)
  }

  for (const base of [
    fixtures[3]!,
    fixture('DELIVERY', '機器搬入', 5),
    { ...fixtures[2]!, name: '機器据付（冷却塔）' },
    { ...fixtures[2]!, kind: 'length' as const, method: 'polyline' as const },
  ]) {
    expect(perEquipmentComponentFixture(base, parent, fixtures)).toEqual({
      fixture: base, newFixtures: [],
    })
  }
})

it('uses parent codes for labels and copies matching electrical and building summaries', () => {
  const noCodeParent = { ...fixture('TOWER', '冷却塔', 0), code: '' }
  const installation = {
    ...fixture('INSTALL', '機器据付', 1),
    summary: [{ label: '形式', value: '標準' }],
  }
  const noCodeResult = perEquipmentComponentFixture(
    installation, noCodeParent, [noCodeParent, installation],
  ).fixture
  expect(noCodeResult.name).toBe('機器据付（冷却塔）')
  expect(noCodeResult.summary).toEqual([
    { label: '名称', value: '冷却塔' },
    { label: '形式', value: '標準' },
  ])

  const light = { ...fixture('A1', 'ＬＥＤ照明器具', 0), category: '電気' }
  const lightInstallation = {
    ...fixture('INSTALL-LIGHT', '器具取付', 1),
    summary: [{ label: '記号', value: '' }],
  }
  const lightResult = perEquipmentComponentFixture(
    lightInstallation, light, [light, lightInstallation],
  ).fixture
  expect(lightResult.name).toBe('器具取付（ＬＥＤ照明器具 A1）')
  expect(lightResult.summary).toEqual([{ label: '記号', value: 'A1' }])

  const panel = { ...fixture('L-1', '分電盤', 0), category: '電気' }
  const panelRemoval = {
    ...fixture('PANEL-REMOVAL', '盤撤去', 1),
    summary: [
      { label: '盤名称', value: '' },
      { label: '処理', value: '撤去材処分' },
    ],
  }
  const panelResult = perEquipmentComponentFixture(
    panelRemoval, panel, [panel, panelRemoval],
  ).fixture
  expect(panelResult.summary).toEqual([
    { label: '盤名称', value: '分電盤 L-1' },
    { label: '処理', value: '撤去材処分' },
  ])

  const door = {
    ...fixture('AW-1', 'AW', 0),
    summary: [{ label: '寸法', value: 'W1800×H2000' }],
  }
  const doorRemoval = {
    ...fixture('DOOR-REMOVAL', 'アルミニウム製建具撤去', 1),
    summary: [{ label: '寸法', value: '' }],
  }
  const doorResult = perEquipmentComponentFixture(
    doorRemoval, door, [door, doorRemoval],
  ).fixture
  expect(doorResult.name)
    .toBe('アルミニウム製建具撤去（AW AW-1）')
  expect(doorResult.summary).toEqual([
    { label: '寸法', value: 'W1800×H2000' },
  ])

  const doorWithoutSize = { ...door, summary: undefined }
  expect(perEquipmentComponentFixture(
    doorRemoval, doorWithoutSize, [doorWithoutSize, doorRemoval],
  ).fixture.summary).toEqual([{ label: '寸法', value: '' }])

  const drain = {
    ...fixture('DRAIN-1', 'ルーフドレン', 0),
    summary: [
      { label: '種別', value: 'たて形' },
      { label: '径', value: '100' },
    ],
  }
  const drainRemoval = {
    ...fixture('DRAIN-REMOVAL', 'ルーフドレン撤去', 1),
    summary: [
      { label: '種別', value: '' },
      { label: '径', value: '' },
    ],
  }
  expect(perEquipmentComponentFixture(
    drainRemoval, drain, [drain, drainRemoval],
  ).fixture.summary).toEqual([
    { label: '種別', value: 'たて形' },
    { label: '径', value: '100' },
  ])
})

it('uses fixtureIdentity to reuse a specialized item', () => {
  const fixtures = initialFixtures()
  const parent = fixtures[0]!
  const base = fixtures[2]!
  const created = perEquipmentComponentFixture(base, parent, fixtures).fixture
  const existing = { ...created, id: 'EXISTING', order: 8 }
  const resolved = perEquipmentComponentFixture(base, parent, [...fixtures, existing])
  expect(resolved).toEqual({ fixture: existing, newFixtures: [] })
  expect(perEquipmentComponentIdentity(base, parent))
    .toBe(fixtureIdentity(created))
})

it('saves the picker-style specialized item and its component in one undo step', async () => {
  const store = await setup()
  const annotation = mark(store, 'BOILER')
  const fixtures = store.getCountFixtures()
  const parent = store.getCountFixture('BOILER')!
  const base = store.getCountFixture('INSTALL')!
  const resolved = perEquipmentComponentFixture(base, parent, fixtures)

  expect(store.setCountComponents([annotation.id], [
    { itemId: resolved.fixture.id, count: 1, condition: '屋外' },
  ], resolved.newFixtures)).toBeUndefined()
  expect(store.quantityIndex().total(resolved.fixture.id)).toBe(1)
  store.undo()
  expect(store.getCountFixture(resolved.fixture.id)).toBeUndefined()
  expect(components(store, annotation.id)).toEqual([])
  expect(rememberedOf(store).get(parent.id) ?? []).toEqual([])
  expect(store.getCountFixture(base.id)).toEqual(base)
  store.redo()
  expect(components(store, annotation.id)).toEqual([
    { itemId: resolved.fixture.id, count: 1, condition: '屋外' },
  ])
})

it('specializes a catalog preset without saving a temporary base item', async () => {
  const fixtures = initialFixtures().filter(fixture => fixture.id !== 'INSTALL')
  const store = await setup(fixtures)
  const annotation = mark(store, 'BOILER')
  const preset: FixturePreset = {
    code: 'INSTALL', name: '機器据付', category: '機械',
    kind: 'count', method: 'click', unit: '台',
    summary: [{ label: '形式', value: '標準' }],
  }
  const temporary: CountFixture = {
    ...preset, id: 'TEMPORARY', order: 5,
    style: nextCountStyle(store.getCountFixtures()),
  }
  const parent = store.getCountFixture('BOILER')!
  const resolved = perEquipmentComponentFixture(
    temporary, parent, store.getCountFixtures(),
  )
  expect(perEquipmentComponentIdentity(preset, parent))
    .toBe(fixtureIdentity(resolved.fixture))
  expect(store.setCountComponents(
    [annotation.id], [{ itemId: resolved.fixture.id, count: 1 }],
    resolved.newFixtures,
  )).toBeUndefined()
  expect(store.getCountFixture('TEMPORARY')).toBeUndefined()
  expect(named(store, '機器据付（ボイラー BOILER）').summary?.[0])
    .toEqual({ label: '名称', value: 'ボイラー BOILER' })
})

it('specializes a catalog choice passed through the related component resolver', async () => {
  const store = await setup(
    initialFixtures().filter(fixture => fixture.id !== 'INSTALL'),
  )
  const annotation = mark(store, 'BOILER')
  const resolved = resolveRelatedCountComponent({
    key: 'install', category: '機械', name: '機器据付',
    preset: {
      code: 'INSTALL', category: '機械', name: '機器据付',
      kind: 'count', method: 'click', unit: '台',
    },
  }, store.getCountFixtures())
  expect(store.addComponentToFixture(
    'BOILER', resolved.fixture.id, resolved.newFixtures,
  )).toMatchObject({ changed: 1, skipped: 0 })

  const install = named(store, '機器据付（ボイラー BOILER）')
  expect(components(store, annotation.id)).toEqual([
    { itemId: install.id, count: 1 },
  ])
  store.undo()
  expect(store.getCountFixture(install.id)).toBeUndefined()
  expect(store.getCountFixture(resolved.fixture.id)).toBeUndefined()
  expect(components(store, annotation.id)).toEqual([])
})

it('automatic related additions report the specialized item and undo in one step', async () => {
  const store = await setup()
  const annotation = mark(store, 'BOILER')
  const result = store.applyRelatedAdditions('BOILER', [
    store.getCountFixture('INSTALL')!,
  ])
  expect(result.error).toBeUndefined()
  const install = named(store, '機器据付（ボイラー BOILER）')
  expect(result.componentMarks).toBe(1)
  expect(result.effects).toContainEqual({
    itemId: install.id,
    name: install.name,
    kind: 'component',
    changed: 1,
    skipped: 0,
    futureApplied: true,
  })
  expect(rememberedOf(store).get('BOILER')).toEqual([
    { itemId: install.id, count: 1 },
  ])

  store.undo()
  expect(store.getCountFixture(install.id)).toBeUndefined()
  expect(components(store, annotation.id)).toEqual([])
  expect(rememberedOf(store).get('BOILER') ?? []).toEqual([])
  expect(store.getCountFixture('INSTALL')).toBeDefined()
  store.redo()
  expect(components(store, annotation.id)).toEqual([
    { itemId: install.id, count: 1 },
  ])
})

it('automatic additions reuse specialized items and keep other components shared', async () => {
  const store = await setup()
  mark(store, 'BOILER')
  mark(store, 'TOWER')
  const inputs = [
    store.getCountFixture('INSTALL')!,
    store.getCountFixture('SLEEVE')!,
  ]
  expect(store.applyRelatedAdditions('BOILER', inputs).error).toBeUndefined()
  expect(store.applyRelatedAdditions('TOWER', inputs).error).toBeUndefined()
  const before = structuredClone(store.getCountFixtures())
  const repeated = store.applyRelatedAdditions('BOILER', inputs)
  expect(repeated.error).toBeUndefined()
  expect(repeated.componentMarks).toBe(0)
  expect(store.getCountFixtures()).toEqual(before)
  expect(store.quantityIndex().total(named(store, '機器据付（ボイラー BOILER）').id)).toBe(1)
  expect(store.quantityIndex().total(named(store, '機器据付（冷却塔 TOWER）').id)).toBe(1)
  expect(store.quantityIndex().total('SLEEVE')).toBe(2)
})

it('splits every mark of the parent while retaining individual counts, conditions and memory', async () => {
  const store = await setup()
  const first = mark(store, 'BOILER')
  const second = mark(store, 'BOILER')
  const tower = mark(store, 'TOWER')
  const firstExtra = [
    { itemId: 'INSTALL', count: 2, condition: '屋内' },
    { itemId: 'SLEEVE', count: 3 },
  ]
  const secondExtra = [{ itemId: 'INSTALL', count: 4, condition: '屋外' }]
  const towerExtra = [{ itemId: 'INSTALL', count: 5, condition: '屋外' }]
  expect(store.setCountComponents([first.id], firstExtra)).toBeUndefined()
  expect(store.setCountComponents([second.id], secondExtra)).toBeUndefined()
  expect(store.setCountComponents([tower.id], towerExtra)).toBeUndefined()
  const remembered = [
    { itemId: 'INSTALL', count: 7, condition: '屋外' },
    { itemId: 'SLEEVE', count: 2 },
  ]
  rememberedOf(store).set('BOILER', structuredClone(remembered))
  const fixturesBefore = structuredClone(store.getCountFixtures())

  expect(store.splitPerEquipmentComponent('BOILER', 'INSTALL')).toBeUndefined()
  const install = named(store, '機器据付（ボイラー BOILER）')
  expect(components(store, first.id)).toEqual([
    { itemId: install.id, count: 2, condition: '屋内' },
    { itemId: 'SLEEVE', count: 3 },
  ])
  expect(components(store, second.id)).toEqual([
    { itemId: install.id, count: 4, condition: '屋外' },
  ])
  expect(components(store, tower.id)).toEqual(towerExtra)
  expect(rememberedOf(store).get('BOILER')).toEqual([
    { itemId: install.id, count: 7, condition: '屋外' },
    { itemId: 'SLEEVE', count: 2 },
  ])
  expect(store.quantityIndex().total(install.id)).toBe(6)
  expect(store.quantityIndex().total('INSTALL')).toBe(5)

  store.undo()
  expect(store.getCountFixtures()).toEqual(fixturesBefore)
  expect(components(store, first.id)).toEqual(firstExtra)
  expect(components(store, second.id)).toEqual(secondExtra)
  expect(components(store, tower.id)).toEqual(towerExtra)
  expect(rememberedOf(store).get('BOILER')).toEqual(remembered)

  store.redo()
  expect(store.getCountFixture(install.id)).toBeDefined()
  expect(store.quantityIndex().total(install.id)).toBe(6)
  const inherited = mark(store, 'BOILER')
  expect(components(store, inherited.id)).toEqual([
    { itemId: install.id, count: 7, condition: '屋外' },
    { itemId: 'SLEEVE', count: 2 },
  ])
})

it('splits future memory even when the parent has no marks', async () => {
  const store = await setup()
  const remembered = [{ itemId: 'INSTALL', count: 3, condition: '屋外' }]
  rememberedOf(store).set('BOILER', structuredClone(remembered))
  expect(store.splitPerEquipmentComponent('BOILER', 'INSTALL')).toBeUndefined()
  const install = named(store, '機器据付（ボイラー BOILER）')
  expect(rememberedOf(store).get('BOILER')).toEqual([
    { itemId: install.id, count: 3, condition: '屋外' },
  ])
  store.undo()
  expect(store.getCountFixture(install.id)).toBeUndefined()
  expect(rememberedOf(store).get('BOILER')).toEqual(remembered)
})

it('reuses an existing specialized item when splitting', async () => {
  const fixtures = initialFixtures()
  const install = perEquipmentComponentFixture(
    fixtures[2]!, fixtures[0]!, fixtures,
  ).fixture
  const store = await setup([...fixtures, install])
  const annotation = mark(store, 'BOILER')
  expect(store.setCountComponents([annotation.id], [
    { itemId: 'INSTALL', count: 2, condition: '屋外' },
  ])).toBeUndefined()
  const before = structuredClone(store.getCountFixtures())

  expect(store.splitPerEquipmentComponent('BOILER', 'INSTALL')).toBeUndefined()
  expect(store.getCountFixtures()).toEqual(before)
  expect(components(store, annotation.id)).toEqual([
    { itemId: install.id, count: 2, condition: '屋外' },
  ])
  store.undo()
  expect(components(store, annotation.id)).toEqual([
    { itemId: 'INSTALL', count: 2, condition: '屋外' },
  ])
  expect(store.getCountFixture(install.id)).toBeDefined()
})

it('rejects a split collision atomically instead of dropping counts or conditions', async () => {
  const fixtures = initialFixtures()
  const install = perEquipmentComponentFixture(
    fixtures[2]!, fixtures[0]!, fixtures,
  ).fixture
  const store = await setup([...fixtures, install])
  const first = mark(store, 'BOILER')
  const second = mark(store, 'BOILER')
  const firstExtra = [{ itemId: 'INSTALL', count: 2, condition: '屋内' }]
  const secondExtra = [
    { itemId: 'INSTALL', count: 3, condition: '屋内' },
    { itemId: install.id, count: 4, condition: '屋外' },
  ]
  expect(store.setCountComponents([first.id], firstExtra)).toBeUndefined()
  expect(store.setCountComponents([second.id], secondExtra)).toBeUndefined()
  const memoryBefore = structuredClone(rememberedOf(store).get('BOILER'))
  const fixturesBefore = structuredClone(store.getCountFixtures())

  expect(store.splitPerEquipmentComponent('BOILER', 'INSTALL')).toMatch(/重複/)
  expect(components(store, first.id)).toEqual(firstExtra)
  expect(components(store, second.id)).toEqual(secondExtra)
  expect(rememberedOf(store).get('BOILER')).toEqual(memoryBefore)
  expect(store.getCountFixtures()).toEqual(fixturesBefore)
})

it('keeps full marks unchanged without saving an unused specialized item', async () => {
  const fixtures = initialFixtures()
  const fillers = Array.from({ length: 10 }, (_, index) =>
    fixture(`F${index}`, `対象外${index}`, 5 + index))
  const store = await setup([...fixtures, ...fillers])
  const annotation = mark(store, 'BOILER')
  const full = fillers.map(fixture => ({ itemId: fixture.id, count: 1 }))
  expect(store.setCountComponents([annotation.id], full)).toBeUndefined()
  expect(store.addComponentToFixture('BOILER', 'INSTALL')).toMatchObject({
    changed: 0, skipped: 1,
  })
  expect(components(store, annotation.id)).toEqual(full)
  expect(store.getCountFixtures().some(
    fixture => fixture.name === '機器据付（ボイラー BOILER）',
  )).toBe(false)
})
