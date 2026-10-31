import { describe, expect, it, vi } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function makeFixture(id: string, name: string, order: number): CountFixture {
  return {
    id,
    code: id === 'led' ? 'LED' : 'OTHER',
    name,
    category: '電気',
    order,
    conditions: ['標準', '天井'],
    style: {
      shape: 'circle',
      fill: 'none',
      color: [1, 0, 0],
      size: 10,
      opacity: .8,
      showCode: true,
    },
  }
}

function initialFixtures(): CountFixture[] {
  return [
    makeFixture('led', '照明', 0),
    makeFixture('other', '別の項目', 1),
  ]
}

async function setup(): Promise<AnnotationStore> {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => initialFixtures(), async () => {})
  store.selectFixture('led')
  return store
}

interface FixtureState {
  revision: number
  value: readonly CountFixture[]
}

function capture(store: AnnotationStore): FixtureState {
  return {
    revision: store.getFixturesRevision(),
    value: store.getCountFixturesSnapshot(),
  }
}

function expectStable(store: AnnotationStore, previous: FixtureState): void {
  expect(store.getFixturesRevision()).toBe(previous.revision)
  expect(store.getCountFixturesSnapshot()).toBe(previous.value)
}

function expectReplacement(
  store: AnnotationStore,
  previous: FixtureState,
  expected: readonly CountFixture[],
): FixtureState {
  const current = capture(store)
  expect(current.revision).toBeGreaterThan(previous.revision)
  expect(current.value).not.toBe(previous.value)
  expect(current.value).toEqual(expected)
  expect(current.value).toEqual(store.getCountFixtures())
  expect(store.getCountFixturesSnapshot()).toBe(current.value)
  return current
}

function expectDeeplyFrozen(
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

const definitionEdits: Array<{
  name: string
  edit(fixtures: CountFixture[]): CountFixture[]
  removeIds?: string[]
}> = [
  {
    name: '追加',
    edit: fixtures => [...fixtures, makeFixture('added', '追加項目', 2)],
  },
  {
    name: '削除',
    edit: fixtures => fixtures.filter(fixture => fixture.id !== 'other'),
    removeIds: ['other'],
  },
  {
    name: '名称変更',
    edit: fixtures => fixtures.map(fixture =>
      fixture.id === 'led' ? { ...fixture, name: '照明（変更後）' } : fixture),
  },
  {
    name: '並べ替え',
    edit: fixtures => [...fixtures].reverse().map((fixture, order) => ({
      ...fixture,
      order,
    })),
  },
]

describe('AnnotationStore fixture snapshots', () => {
  it('keeps the snapshot and revision stable across selection and display-only operations', async () => {
    const store = await setup()
    const [pickupId] = store.createCountMarks('led', [
      { pageIndex: 0, center: [40, 50] },
    ])
    const previous = capture(store)

    store.selectFixture('other')
    expectStable(store, previous)
    store.selectFixture('led')
    expectStable(store, previous)
    store.selectFixture(null)
    expectStable(store, previous)
    store.selectFixture('led')
    expectStable(store, previous)

    vi.useFakeTimers()
    try {
      store.flashPickup(pickupId)
      expect(store.flashId).toBe(pickupId)
      expectStable(store, previous)

      vi.advanceTimersByTime(1499)
      expect(store.flashId).toBe(pickupId)
      expectStable(store, previous)

      vi.advanceTimersByTime(1)
      expect(store.flashId).toBeNull()
      expectStable(store, previous)
    } finally {
      vi.useRealTimers()
    }

    store.setHighlightedVertex({ annotationId: pickupId, vertexIndex: 0 })
    expectStable(store, previous)
    store.setHighlightedVertex(null)
    expectStable(store, previous)

    store.setCurrentLocation('floor', '2階')
    expect(store.currentFloor).toBe('2階')
    expectStable(store, previous)

    store.setShowQuantityValues(false)
    expect(store.showQuantityValues).toBe(false)
    expectStable(store, previous)

    store.beginSymbolCandidates('led', [0, 0, 12, 20])
    expect(store.symbolCandidates).toEqual([])
    expectStable(store, previous)

    store.clearSymbolCandidates()
    expect(store.symbolCandidates).toBeNull()
    expectStable(store, previous)
  })

  it('keeps the snapshot and revision stable when adding pickups and undoing or redoing them', async () => {
    const store = await setup()
    const previous = capture(store)

    const ids = store.createCountMarks('led', [
      { pageIndex: 0, center: [40, 50] },
      { pageIndex: 1, center: [60, 70] },
    ])
    expect(ids).toHaveLength(2)
    expect(store.quantityIndex().total('led')).toBe(2)
    expectStable(store, previous)

    store.undo()
    expect(store.quantityIndex().total('led')).toBe(0)
    expect(ids.every(id => store.get(id) === undefined)).toBe(true)
    expectStable(store, previous)

    store.redo()
    expect(store.quantityIndex().total('led')).toBe(2)
    expect(ids.every(id => store.get(id) !== undefined)).toBe(true)
    expectStable(store, previous)
  })

  it.each(definitionEdits)(
    'replaces the snapshot and increases the revision for $name, undo and redo',
    async ({ edit, removeIds }) => {
      const store = await setup()
      const before = capture(store)
      const original = structuredClone(before.value)
      const next = edit(store.getCountFixtures())

      store.setCountFixtures(next, removeIds ?? [])
      const changed = expectReplacement(store, before, next)
      expect(before.value).toEqual(original)

      store.undo()
      const undone = expectReplacement(store, changed, original)
      expect(before.value).toEqual(original)
      expect(changed.value).toEqual(next)

      store.redo()
      expectReplacement(store, undone, next)
      expect(before.value).toEqual(original)
      expect(changed.value).toEqual(next)
      expect(undone.value).toEqual(original)
    },
  )

  it('increases the revision on initial loading, reset and reloading without resetting it to zero', async () => {
    const store = new AnnotationStore()
    const empty = capture(store)
    expect(empty.revision).toBe(0)
    expect(empty.value).toEqual([])
    expectDeeplyFrozen(empty.value)

    const initial = initialFixtures()
    await store.ensureCountFixtures(async () => initial, async () => {})
    const loaded = expectReplacement(store, empty, initial)
    expect(empty.value).toEqual([])

    await store.ensureCountFixtures(
      async () => [makeFixture('ignored', '読込済みなので使わない項目', 0)],
      async () => {},
    )
    expectStable(store, loaded)

    store.reset()
    const reset = expectReplacement(store, loaded, [])
    expect(store.fixturesReady).toBe(false)
    expect(loaded.value).toEqual(initial)

    const reloadedFixtures = [makeFixture('reloaded', '再読込した項目', 0)]
    await store.ensureCountFixtures(
      async () => reloadedFixtures,
      async () => {},
    )
    expectReplacement(store, reset, reloadedFixtures)
    expect(store.fixturesReady).toBe(true)
    expect(reset.value).toEqual([])
    expect(loaded.value).toEqual(initial)
  })

  it('deeply freezes a detached snapshot and preserves it across mutable-copy edits and later replacement', async () => {
    const store = await setup()
    const before = capture(store)
    const original = structuredClone(before.value)
    const internalFixture = store.getCountFixture('led')!

    expectDeeplyFrozen(before.value)
    for (const fixture of before.value) {
      expect(Object.isFrozen(fixture)).toBe(true)
      expect(Object.isFrozen(fixture.style)).toBe(true)
      expect(Object.isFrozen(fixture.style.color)).toBe(true)
      expect(Object.isFrozen(fixture.conditions)).toBe(true)
    }
    expect(before.value[0]).not.toBe(internalFixture)
    expect(before.value[0].style).not.toBe(internalFixture.style)
    expect(before.value[0].style.color).not.toBe(internalFixture.style.color)
    expect(before.value[0].conditions).not.toBe(internalFixture.conditions)
    expect(Object.isFrozen(internalFixture)).toBe(false)
    expect(Object.isFrozen(internalFixture.style)).toBe(false)

    const mutable = store.getCountFixtures()
    mutable[0].name = '複製だけの変更'
    mutable[0].style.color[0] = 0
    mutable[0].conditions!.push('複製だけの条件')
    mutable.push(makeFixture('copy-only', '複製だけの項目', 2))

    expectStable(store, before)
    expect(before.value).toEqual(original)
    expect(store.getCountFixtures()).toEqual(original)

    const next = store.getCountFixtures()
    next[0].name = '保存した名称'
    const expected = structuredClone(next)
    store.setCountFixtures(next)
    const changed = expectReplacement(store, before, expected)
    expectDeeplyFrozen(changed.value)
    expect(before.value).toEqual(original)

    next[0].name = '入力配列だけの変更'
    next[0].style.color[1] = 1
    next[0].conditions!.push('入力配列だけの条件')

    expectStable(store, changed)
    expect(changed.value).toEqual(expected)
    expect(store.getCountFixtures()).toEqual(expected)
    expect(before.value).toEqual(original)
  })

  it('continues returning a fresh, mutable deep copy from every getCountFixtures call', async () => {
    const store = await setup()
    const snapshot = capture(store)
    const first = store.getCountFixtures()
    const second = store.getCountFixtures()
    const expected = structuredClone(second)

    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first[0].style).not.toBe(second[0].style)
    expect(first[0].style.color).not.toBe(second[0].style.color)
    expect(first[0].conditions).not.toBe(second[0].conditions)
    expect(Object.isFrozen(first)).toBe(false)
    expect(Object.isFrozen(first[0])).toBe(false)
    expect(Object.isFrozen(first[0].style)).toBe(false)
    expect(Object.isFrozen(first[0].style.color)).toBe(false)
    expect(Object.isFrozen(first[0].conditions)).toBe(false)

    expect(() => {
      first[0].name = '自由に変更できる名称'
      first[0].style.color[2] = 1
      first[0].conditions!.push('自由に追加できる条件')
      first.splice(1, 1)
      first.push(makeFixture('local', 'ローカルの項目', 2))
    }).not.toThrow()

    expect(second).toEqual(expected)
    expect(store.getCountFixtures()).toEqual(expected)
    expect(snapshot.value).toEqual(expected)
    expectStable(store, snapshot)
  })
})
