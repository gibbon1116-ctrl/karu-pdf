import { afterEach, expect, it, vi } from 'vitest'
import * as fixtureCore from '../src/core/countFixtures'
import type { CountFixture } from '../src/core/countFixtures'
import { countFixtureId, legacyCountFixtureId, parseCount, type CountComponent, type CountMark } from '../src/core/counts'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const SW = 'SW', SB = 'SB', PL = 'PL', OTHER = 'OTHER', LINE = 'LINE'
const OLD_CONDITION = '隠ぺい（埋込）', NEW_CONDITION = '隠ぺい（壁内）'

function fixture(id: string, order: number): CountFixture {
  return {
    id, order, code: id, name: id, category: '電気',
    kind: 'count', method: 'click', style: fixtureCore.nextCountStyle([]),
  }
}

const fixtures: CountFixture[] = [
  fixture(SW, 0),
  { ...fixture(SB, 1), conditions: [OLD_CONDITION], defaultCondition: OLD_CONDITION },
  { ...fixture(PL, 2), conditions: ['露出'], defaultCondition: '露出' },
  fixture(OTHER, 3),
  ...Array.from({ length: 11 }, (_, i) => fixture('C' + i, 4 + i)),
  { ...fixture(LINE, 15), kind: 'length', method: 'polyline' },
]

function createMark(
  store: AnnotationStore,
  fixtureId = SW,
  options: Partial<Extract<CountMark, { version: 2 }>> = {},
) {
  return store.create({
    pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10], symbol: 'circle',
    count: { version: 2, id: crypto.randomUUID(), fixtureId, ...options },
  })
}

function components(store: AnnotationStore, id: string): CountComponent[] | undefined {
  const count = store.get(id)?.count
  return count?.version === 2 ? count.extra : undefined
}

async function setup() {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const a = createMark(store)
  return { store, id: a.id }
}

afterEach(() => vi.restoreAllMocks())

it('sets components and restores marks and inheritance with one undo/redo', async () => {
  const { store, id } = await setup(), before = store.get(id)?.count
  const extra: CountComponent[] = [
    { itemId: SB, count: 1, condition: OLD_CONDITION },
    { itemId: PL, count: 2 },
  ]
  const firstIndex = store.quantityIndex()
  expect(store.setCountComponents([id, id], extra)).toBeUndefined()
  expect(components(store, id)).toEqual(extra)
  expect(store.quantityIndex()).not.toBe(firstIndex)
  expect(store.quantityIndex().total(SB)).toBe(1)
  expect(store.quantityIndex().total(PL)).toBe(2)

  store.undo()
  expect(store.get(id)?.count).toEqual(before)
  expect(store.quantityIndex().total(SB)).toBe(0)
  store.redo()
  expect(components(store, id)).toEqual(extra)

  const inherited = createMark(store)
  expect(components(store, inherited.id)).toEqual([
    { itemId: SB, count: 1, condition: OLD_CONDITION },
    { itemId: PL, count: 2, condition: '露出' },
  ])
})

it('adds component fixtures in the same history step and restores their inheritance', async () => {
  const { store, id } = await setup()
  const added = fixture('NEW', 16)
  const extra = [{ itemId: added.id, count: 2 }]
  expect(store.setCountComponents([id], extra, [added])).toBeUndefined()
  expect(store.getCountFixture(added.id)).toEqual(added)
  expect(components(store, id)).toEqual(extra)

  store.undo()
  expect(store.getCountFixture(added.id)).toBeUndefined()
  expect(components(store, id)).toBeUndefined()
  store.redo()
  expect(store.getCountFixture(added.id)).toEqual(added)
  expect(components(store, id)).toEqual(extra)
  expect(components(store, createMark(store).id)).toEqual(extra)
})

it('inherits only for the same main fixture, including bulk symbol candidates, and remembers an empty composition', async () => {
  const { store, id } = await setup()
  store.lastCondition.set(SB, '露出')
  const extra: CountComponent[] = [
    { itemId: SB, count: 1, condition: OLD_CONDITION },
    { itemId: PL, count: 2 },
  ]
  expect(store.setCountComponents([id], extra)).toBeUndefined()
  const expected = [
    { itemId: SB, count: 1, condition: OLD_CONDITION },
    { itemId: PL, count: 2, condition: '露出' },
  ]
  expect(components(store, createMark(store).id)).toEqual(expected)
  expect(components(store, createMark(store, OTHER).id)).toBeUndefined()
  const bulk = store.createCountMarks(SW, [
    { pageIndex: 0, center: [20, 20] },
    { pageIndex: 1, center: [30, 30] },
  ])
  for (const markId of bulk) expect(components(store, markId)).toEqual(expected)

  expect(store.setCountComponents([id], [])).toBeUndefined()
  expect(components(store, id)).toBeUndefined()
  expect(components(store, createMark(store).id)).toBeUndefined()
})

it('uses remembered/default component conditions when the composition has no condition', async () => {
  const { store, id } = await setup()
  store.lastCondition.set(SB, '露出')
  expect(store.setCountComponents([id], [{ itemId: SB, count: 1 }, { itemId: PL, count: 2 }])).toBeUndefined()
  expect(components(store, createMark(store).id)).toEqual([
    { itemId: SB, count: 1, condition: '露出' },
    { itemId: PL, count: 2, condition: '露出' },
  ])
  store.lastCondition.set(SB, undefined)
  expect(components(store, createMark(store).id)).toEqual([
    { itemId: SB, count: 1 },
    { itemId: PL, count: 2, condition: '露出' },
  ])
})

it('updates inheritance without adding history when the target count is unchanged', async () => {
  const { store, id } = await setup()
  expect(store.setCountComponents([id], [{ itemId: SB, count: 1 }])).toBeUndefined()
  const empty = createMark(store, SW, { extra: [] })
  expect(components(store, empty.id)).toBeUndefined()

  expect(store.setCountComponents([empty.id], [])).toBeUndefined()
  store.undo()
  expect(store.get(empty.id)).toBeUndefined()
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1 }])
  expect(components(store, createMark(store).id)).toBeUndefined()
})

it('restores a previous composition template when a later component edit is undone', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 1, condition: OLD_CONDITION }])
  store.setCountComponents([id], [{ itemId: PL, count: 2 }])
  store.undo()
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])
  expect(components(store, createMark(store).id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])
})

it('detaches removed component fixtures while retaining the main mark and restores memory on undo/redo', async () => {
  const { store, id } = await setup()
  const extra = [{ itemId: SB, count: 1, condition: OLD_CONDITION }]
  store.setCountComponents([id], extra)
  expect(store.fixtureRemovalCounts(SB)).toEqual({ deleted: 0, detached: 1 })
  expect(store.fixtureRemovalCounts(SW)).toEqual({ deleted: 1, detached: 0 })

  store.setCountFixtures(store.getCountFixtures().filter(f => f.id !== SB), [SB])
  expect(store.get(id)).toBeDefined()
  expect(countFixtureId(store.get(id)!.count!)).toBe(SW)
  expect(components(store, id)).toBeUndefined()
  expect(store.quantityIndex().total(SW)).toBe(1)
  expect(store.quantityIndex().total(SB)).toBe(0)

  store.undo()
  expect(store.getCountFixture(SB)).toBeDefined()
  expect(components(store, id)).toEqual(extra)
  store.redo()
  expect(store.getCountFixture(SB)).toBeUndefined()
  expect(components(store, id)).toBeUndefined()
  expect(components(store, createMark(store).id)).toBeUndefined()
})

it('deletes a mark when its main fixture is removed and restores its composition on undo', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 1 }])
  store.setCountFixtures(store.getCountFixtures().filter(f => f.id !== SW), [SW])
  expect(store.get(id)).toBeUndefined()
  expect(store.getCountFixture(SB)).toBeDefined()
  store.undo()
  expect(countFixtureId(store.get(id)!.count!)).toBe(SW)
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1 }])
  expect(components(store, createMark(store).id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])
})

it('renames component conditions and composition memory atomically', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 1, condition: OLD_CONDITION }])

  // The fixture rename metadata format is outside the supplied files.
  // Supply its existing Map contract and exercise the store's real rename/history path.
  vi.spyOn(fixtureCore, 'fixtureConditionRenames').mockImplementation(f =>
    f.id === SB && f.conditions?.includes(NEW_CONDITION)
      ? new Map([[OLD_CONDITION, NEW_CONDITION]])
      : new Map(),
  )
  store.setCountFixtures(store.getCountFixtures().map(f =>
    f.id === SB ? { ...f, conditions: [NEW_CONDITION], defaultCondition: NEW_CONDITION } : f,
  ))
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1, condition: NEW_CONDITION }])

  store.undo()
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])
  store.redo()
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1, condition: NEW_CONDITION }])
  expect(components(store, createMark(store).id)).toEqual([{ itemId: SB, count: 1, condition: NEW_CONDITION }])
})

it('removes a component matching the new main fixture without changing the main count', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 3 }, { itemId: PL, count: 2 }])
  expect(store.reassignCounts([id], SB)).toBeUndefined()
  expect(countFixtureId(store.get(id)!.count!)).toBe(SB)
  expect(components(store, id)).toEqual([{ itemId: PL, count: 2 }])
  expect(store.quantityIndex().total(SB)).toBe(1)
  expect(store.quantityIndex().total(PL)).toBe(2)
  store.undo()
  expect(countFixtureId(store.get(id)!.count!)).toBe(SW)
  expect(components(store, id)).toEqual([{ itemId: SB, count: 3 }, { itemId: PL, count: 2 }])
})

it('rejects invalid components without changing annotations, fixtures, inheritance or history', async () => {
  const invalid: CountComponent[][] = [
    Array.from({ length: 11 }, (_, i) => ({ itemId: 'C' + i, count: 1 })),
    [{ itemId: LINE, count: 1 }],
    [{ itemId: 'missing', count: 1 }],
    [{ itemId: SB, count: 0 }],
    [{ itemId: SB, count: 100 }],
    [{ itemId: SB, count: 1.5 }],
    [{ itemId: SB, count: 1 }, { itemId: SB, count: 2 }],
    [{ itemId: SB, count: 1, condition: ' padded ' }],
  ]
  for (const extra of invalid) {
    const { store, id } = await setup()
    const before = store.get(id), beforeFixtures = store.getCountFixtures()
    expect(store.setCountComponents([id], extra, [fixture('NEW', 16)])).toBeTypeOf('string')
    expect(store.get(id)).toEqual(before)
    expect(store.getCountFixtures()).toEqual(beforeFixtures)
    expect(store.getCountFixture('NEW')).toBeUndefined()
    store.undo()
    expect(store.get(id)).toBeUndefined()
    expect(components(store, createMark(store).id)).toBeUndefined()
  }
})

it('rejects duplicate fixture IDs and invalid fixture serialization atomically', async () => {
  const additions: CountFixture[][] = [
    [fixture(SB, 16)],
    [fixture('NEW', 16), fixture('NEW', 17)],
    [{ ...fixture('NEW', 16), name: '' }],
  ]
  for (const newFixtures of additions) {
    const { store, id } = await setup(), before = store.get(id), beforeFixtures = store.getCountFixtures()
    expect(store.setCountComponents([id], [{ itemId: SB, count: 1 }], newFixtures)).toBeTypeOf('string')
    expect(store.get(id)).toEqual(before)
    expect(store.getCountFixtures()).toEqual(beforeFixtures)
    store.undo()
    expect(store.get(id)).toBeUndefined()
  }
})

it('rejects an unsavable mark before changing fixtures or composition memory', async () => {
  const { store } = await setup()
  const a = createMark(store, SW, { id: 'x'.repeat(81) }), before = store.get(a.id)
  expect(store.setCountComponents([a.id], [{ itemId: 'NEW', count: 1 }], [fixture('NEW', 16)])).toBeTypeOf('string')
  expect(store.get(a.id)).toEqual(before)
  expect(store.getCountFixture('NEW')).toBeUndefined()
  store.undo()
  expect(store.get(a.id)).toBeUndefined()
  expect(components(store, createMark(store).id)).toBeUndefined()
})

it('validates every target before mutating any of them', async () => {
  const { store, id } = await setup()
  const invalid = createMark(store, SW, { id: 'x'.repeat(81) })
  const before = [store.get(id), store.get(invalid.id)]
  expect(store.setCountComponents([id, invalid.id], [{ itemId: SB, count: 1 }])).toBeTypeOf('string')
  expect([store.get(id), store.get(invalid.id)]).toEqual(before)
  expect(components(store, createMark(store).id)).toBeUndefined()
})

it('filters each target main fixture and upgrades legacy counts in one history step', async () => {
  const { store, id } = await setup()
  const sb = createMark(store, SB)
  const before = [store.get(id)?.count, store.get(sb.id)?.count]
  expect(store.setCountComponents([id, sb.id], [{ itemId: SB, count: 1 }, { itemId: PL, count: 2 }])).toBeUndefined()
  expect(components(store, id)).toEqual([{ itemId: SB, count: 1 }, { itemId: PL, count: 2 }])
  expect(components(store, sb.id)).toEqual([{ itemId: PL, count: 2 }])
  store.undo()
  expect([store.get(id)?.count, store.get(sb.id)?.count]).toEqual(before)

  const group = '旧スイッチ', legacyId = legacyCountFixtureId(group)
  store.setCountFixtures([...store.getCountFixtures(), { ...fixture(legacyId, 16), code: 'OLD', name: group }])
  const legacy = store.create({
    pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10],
    count: { version: 1, id: 'legacy', group },
  })
  expect(store.setCountComponents([legacy.id], [{ itemId: legacyId, count: 1 }, { itemId: SB, count: 1 }])).toBeUndefined()
  expect(store.get(legacy.id)?.count).toEqual({
    version: 2, id: 'legacy', fixtureId: legacyId, extra: [{ itemId: SB, count: 1 }],
  })
  store.undo()
  expect(store.get(legacy.id)?.count).toEqual({ version: 1, id: 'legacy', group })
  store.redo()
  expect(components(store, legacy.id)).toEqual([{ itemId: SB, count: 1 }])
})

it('returns only live main count IDs and ignores quantity pickups as component-edit targets', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 1 }])
  const sb = createMark(store, SB)
  const other = createMark(store, OTHER)
  store.setCountComponents([other.id], [{ itemId: SW, count: 1 }])
  const mixed = store.create({
    pageIndex: 0, kind: 'perimeter', rect: [0, 0, 72, 20], vertices: [[0, 0], [72, 0]],
    measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 1000 },
    quantity: { version: 1, id: 'route', itemId: LINE, method: 'polyline' },
    count: { version: 2, id: 'mixed', fixtureId: SW },
  })
  const mixedBefore = store.get(mixed.id)
  expect(store.setCountComponents([mixed.id, 'missing'], [{ itemId: SB, count: 1 }])).toBeUndefined()
  expect(store.get(mixed.id)).toEqual(mixedBefore)
  expect(store.countMarkIdsOf(SW)).toEqual([id])
  expect(store.countMarkIdsOf(SB)).toEqual([sb.id])
  expect(store.countMarkIdsOf('missing')).toEqual([])
  store.remove(id)
  expect(store.countMarkIdsOf(SW)).toEqual([])
})

it('shows a main mark when either its main fixture or a component is visible', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 1 }])
  const index = store.quantityIndex()
  store.setFixtureVisible([SW], false)
  expect(store.isCountVisible(store.get(id)?.count)).toBe(true)
  expect(store.visibleCountTotal(0)).toBe(1)
  store.setFixtureVisible([SB], false)
  expect(store.isCountVisible(store.get(id)?.count)).toBe(false)
  expect(store.visibleCountTotal(0)).toBe(0)
  store.setFixtureVisible([SB], true)
  store.selectFixture(SB); store.setOnlySelectedFixture(true)
  expect(store.isCountVisible(store.get(id)?.count)).toBe(true)
  expect(store.visibleCountTotal(0)).toBe(1)
  expect(store.quantityIndex()).toBe(index)
})

it('deep-copies create inputs, public states, pasted marks and history snapshots', async () => {
  const { store } = await setup()
  const extra: CountComponent[] = [{ itemId: SB, count: 1, condition: OLD_CONDITION }]
  const a = createMark(store, SW, { extra })
  extra[0].count = 9
  extra.push({ itemId: PL, count: 2 })
  expect(components(store, a.id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])

  if (a.count?.version === 2) a.count.extra![0].count = 8
  const publicCount = store.get(a.id)!.count!
  if (publicCount.version === 2) publicCount.extra![0].condition = '露出'
  expect(components(store, a.id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])

  store.selectOnly(a.id)
  const pasted = store.pasteAnnotations(store.copySelected(), 0, { width: 600, height: 800 }, 20)[0]
  store.setCountComponents([a.id], [{ itemId: PL, count: 2 }])
  expect(components(store, pasted)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])
  store.undo()
  expect(components(store, a.id)).toEqual([{ itemId: SB, count: 1, condition: OLD_CONDITION }])
})

it('preserves components in saved edits and history after saved annotation IDs are assigned', async () => {
  const { store, id } = await setup()
  const extra = [{ itemId: SB, count: 1, condition: OLD_CONDITION }]
  store.setCountComponents([id], extra)
  const edit = store.toEdits().find(e => e.kind === 'createSymbol')
  expect(edit && 'count' in edit ? parseCount(JSON.stringify(edit.count)) : null).toMatchObject({ extra })

  store.markApplied({ created: [101] })
  expect(store.get(id)).toBeUndefined()
  expect(components(store, 'obj-101')).toEqual(extra)
  expect(store.isDirty()).toBe(false)
  store.undo()
  expect(components(store, 'obj-101')).toBeUndefined()
  store.redo()
  expect(components(store, 'obj-101')).toEqual(extra)
  expect(components(store, createMark(store).id)).toEqual(extra)
})

it('filters non-click inherited components and clears composition memory on document reset', async () => {
  const { store, id } = await setup()
  store.setCountComponents([id], [{ itemId: SB, count: 1 }])
  store.setCountFixtures(store.getCountFixtures().map(f =>
    f.id === SB ? { ...f, kind: 'length', method: 'polyline', defaultCondition: undefined } : f,
  ))
  expect(components(store, createMark(store).id)).toBeUndefined()
  store.reset()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  expect(components(store, createMark(store).id)).toBeUndefined()
})
