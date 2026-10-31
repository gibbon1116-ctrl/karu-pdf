import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import { AnnotationStore, type DirtySummary } from '../src/editor/AnnotationStore'
import {
  getPerfCounters,
  isPerfEnabled,
  resetPerfCounters,
  setPerfEnabled,
} from '../src/perf/counters'

const fixture: CountFixture = {
  id: 'led', code: 'LED', name: '照明', category: '電気', order: 0,
  style: {
    shape: 'circle', fill: 'none', color: [1, 0, 0],
    size: 10, opacity: .8, showCode: true,
  },
}

const sampleRect: Rect = [0, 0, 12, 20]

function candidate(x: number, y: number) {
  return {
    pageIndex: 0,
    center: [x, y] as Point,
    rect: [x - 6, y - 10, x + 6, y + 10] as Rect,
    score: .87,
  }
}

async function setup(): Promise<AnnotationStore> {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [
    fixture,
    { ...fixture, id: 'other', name: '別の項目', order: 1 },
  ], async () => {})
  store.selectFixture('led')
  return store
}

function summary(overrides: Partial<DirtySummary> = {}): DirtySummary {
  return {
    annotations: 0,
    fixtures: false,
    scales: [],
    drawings: [],
    rooms: [],
    roomSets: false,
    ...overrides,
  }
}

function computeCount(): number {
  return getPerfCounters()['store.dirtySummary.compute']?.count ?? 0
}

/** Warm the cache before every change, then compare against explicit expectations. */
function expectRecomputed(
  store: AnnotationStore,
  change: () => void,
  expected: DirtySummary,
): void {
  store.dirtySummary()
  const beforeCount = computeCount()
  const beforeRevision = store.getContentRevision()

  change()

  expect(store.getContentRevision()).toBeGreaterThan(beforeRevision)
  expect(store.dirtySummary()).toEqual(expected)
  expect(computeCount()).toBe(beforeCount + 1)

  const expectedDirty = expected.annotations > 0 || expected.fixtures
    || expected.scales.length > 0 || expected.drawings.length > 0
    || expected.rooms.length > 0 || expected.roomSets
    || !!expected.quantityChecks || !!expected.relatedReviews
  expect(store.isDirty()).toBe(expectedDirty)
  expect(store.dirtySummary()).toEqual(expected)
  expect(computeCount()).toBe(beforeCount + 1)
}

describe('AnnotationStore content revision', () => {
  let previousPerfEnabled = false

  beforeEach(() => {
    previousPerfEnabled = isPerfEnabled()
    setPerfEnabled(true)
    resetPerfCounters()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetPerfCounters()
    setPerfEnabled(previousPerfEnabled)
  })

  it('reuses the dirty cache across repeated UI operations and timer completion while notifying listeners', async () => {
    const store = await setup()
    const ids = store.createCountMarks('led', [
      { pageIndex: 0, center: [10, 10] },
      { pageIndex: 0, center: [30, 10] },
      { pageIndex: 1, center: [10, 10] },
    ])
    const index = store.quantityIndex()

    vi.useFakeTimers()
    resetPerfCounters()
    const warmed = store.dirtySummary()
    expect(warmed).toEqual(summary({ annotations: 3 }))
    expect(computeCount()).toBe(1)

    const contentRevision = store.getContentRevision()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const initialSnapshot = store.getSnapshot()

    const ui = (change: () => void): void => {
      const beforeSnapshot = store.getSnapshot()
      const beforeCalls = listener.mock.calls.length

      change()

      const notifications = store.getSnapshot() - beforeSnapshot
      expect(notifications).toBeGreaterThan(0)
      expect(listener.mock.calls.length - beforeCalls).toBe(notifications)
      expect(store.getContentRevision()).toBe(contentRevision)
      expect(store.isDirty()).toBe(true)
      expect(store.dirtySummary()).toBe(warmed)
      expect(computeCount()).toBe(1)
      expect(store.quantityIndex()).toBe(index)
    }

    try {
      for (let i = 0; i < 10; i++) {
        ui(() => store.selectFixture('led'))
        ui(() => store.selectOnly(ids[i % 2]))
        ui(() => store.clearSelection())
        ui(() => store.setHighlightedVertex({
          annotationId: ids[0], vertexIndex: i,
        }))
        ui(() => store.setHighlightedRise({
          annotationId: ids[0], riseIndex: i,
        }))
        ui(() => store.flashPickup(ids[0]))
        expect(store.flashId).toBe(ids[0])
        ui(() => vi.advanceTimersByTime(1500))
        expect(store.flashId).toBeNull()
        ui(() => store.setAnnotationFilter({
          ...store.annotationFilter, discipline: `試験-${i}`,
        }))
        ui(() => store.setFixtureVisible(['led'], false))
        ui(() => store.setFixtureVisible(['led'], true))
        ui(() => store.beginSymbolCandidates('led', sampleRect))
        ui(() => store.appendSymbolCandidates([candidate(100 + i * 20, 100)]))
        ui(() => store.clearSymbolCandidates())
        ui(() => store.setCurrentLocation('room', `会議室${i}`))
      }

      expect(store.getSnapshot()).toBeGreaterThan(initialSnapshot)
      expect(listener).toHaveBeenCalled()
      expect(getPerfCounters()['store.notify.uiOnly']?.count)
        .toBe(store.getSnapshot() - initialSnapshot)
      expect(getPerfCounters()['store.listenerCalls']?.count)
        .toBe(listener.mock.calls.length)
      expect(getPerfCounters()['store.notify.quantity']).toBeUndefined()
      expect(getPerfCounters()['store.notify.ui']).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })

  it('recomputes the complete summary for pickups, undo/redo, fixtures, drawings and rooms', async () => {
    const store = await setup()

    expectRecomputed(store, () => {
      store.createCountMarks('led', [{ pageIndex: 0, center: [10, 10] }])
    }, summary({ annotations: 1 }))

    expectRecomputed(store, () => store.undo(), summary())
    expectRecomputed(store, () => store.redo(), summary({ annotations: 1 }))

    expectRecomputed(store, () => {
      store.setCountFixtures(store.getCountFixtures().map(f =>
        f.id === 'led' ? { ...f, name: '照明変更' } : f))
    }, summary({ annotations: 1, fixtures: true }))

    expectRecomputed(store, () => store.undo(), summary({ annotations: 1 }))

    expectRecomputed(store, () => {
      store.setDrawingInfo([1], { number: 'E-2', name: '2階 電灯設備平面図' })
    }, summary({ annotations: 1, drawings: [1] }))

    expectRecomputed(store, () => {
      store.setRoomRegions(0, [{
        id: 'room-1',
        name: '会議室',
        points: [[0, 0], [100, 0], [100, 100], [0, 100]],
      }])
    }, summary({ annotations: 1, drawings: [1], rooms: [0] }))

    expectRecomputed(store, () => store.undo(),
      summary({ annotations: 1, drawings: [1] }))
    expectRecomputed(store, () => store.redo(),
      summary({ annotations: 1, drawings: [1], rooms: [0] }))
  })

  it('becomes clean after applying saved edits, stays clean during selection and becomes dirty after another pickup', async () => {
    const store = await setup()
    store.createCountMarks('led', [
      { pageIndex: 0, center: [10, 10] },
      { pageIndex: 0, center: [30, 10] },
    ])

    const edits = store.toEdits()
    expect(edits.filter(edit => edit.kind.startsWith('create'))).toHaveLength(2)

    expectRecomputed(store, () => {
      store.markApplied({ created: [31, 32], errors: [] })
    }, summary())

    expect(store.get('obj-31')?.dirty).toBe(false)
    expect(store.get('obj-32')?.dirty).toBe(false)

    const revision = store.getContentRevision()
    const count = computeCount()
    const snapshot = store.getSnapshot()

    for (let i = 0; i < 10; i++) {
      store.selectOnly('obj-31')
      expect(store.isDirty()).toBe(false)
      expect(store.dirtySummary()).toEqual(summary())
      store.clearSelection()
      expect(store.isDirty()).toBe(false)
      expect(store.dirtySummary()).toEqual(summary())
      store.selectFixture(i % 2 === 0 ? 'other' : 'led')
      expect(store.isDirty()).toBe(false)
      expect(store.dirtySummary()).toEqual(summary())
    }

    expect(store.getContentRevision()).toBe(revision)
    expect(computeCount()).toBe(count)
    expect(store.getSnapshot()).toBeGreaterThan(snapshot)

    expectRecomputed(store, () => {
      store.createCountMarks('led', [{ pageIndex: 0, center: [50, 10] }])
    }, summary({ annotations: 1 }))
  })

  it('keeps failed saved edits dirty after applying successful results and subsequent UI notifications', async () => {
    const store = await setup()
    store.createCountMarks('led', [
      { pageIndex: 0, center: [10, 10] },
      { pageIndex: 0, center: [30, 10] },
    ])
    store.toEdits()

    expectRecomputed(store, () => {
      store.markApplied({ created: [51], errors: [{ editIndex: 1 }] })
    }, summary({ annotations: 1 }))

    const revision = store.getContentRevision()
    const count = computeCount()
    store.selectOnly('obj-51')
    expect(store.isDirty()).toBe(true)
    expect(store.dirtySummary()).toEqual(summary({ annotations: 1 }))
    expect(store.getContentRevision()).toBe(revision)
    expect(computeCount()).toBe(count)
  })

  it('keeps edits made after toEdits dirty when the earlier save is applied', async () => {
    const store = await setup()
    const [id] = store.createCountMarks('led', [
      { pageIndex: 0, center: [10, 10] },
    ])
    store.toEdits()
    store.move(id, 5, 0)

    expectRecomputed(store, () => {
      store.markApplied({ created: [61], errors: [] })
    }, summary({ annotations: 1 }))

    expect(store.get('obj-61')?.dirty).toBe(true)
    store.selectOnly('obj-61')
    expect(store.isDirty()).toBe(true)
  })

  it('invalidates deferred creation without adding a notification', () => {
    const store = new AnnotationStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const snapshot = store.getSnapshot()

    try {
      expectRecomputed(store, () => {
        store.create({
          pageIndex: 0,
          kind: 'square',
          rect: [0, 0, 10, 10],
          deferHistory: true,
          deferNotify: true,
        })
      }, summary({ annotations: 1 }))

      expect(store.getSnapshot()).toBe(snapshot)
      expect(listener).not.toHaveBeenCalled()

      const revision = store.getContentRevision()
      const count = computeCount()
      store.selectOnly(store.getPageAnnotations(0)[0].id)
      expect(store.isDirty()).toBe(true)
      expect(store.getContentRevision()).toBe(revision)
      expect(computeCount()).toBe(count)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('invalidates fixture replacement even when setCountFixtures returns without notifying', async () => {
    const store = await setup()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const snapshot = store.getSnapshot()

    try {
      expectRecomputed(store, () => {
        store.setCountFixtures(store.getCountFixtures(), [], ['missing'])
      }, summary())

      expect(store.getSnapshot()).toBe(snapshot)
      expect(listener).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('advances content revision for setLayout and resets dirty state without resetting the revision', () => {
    const store = new AnnotationStore()
    const text = store.create({
      pageIndex: 0,
      kind: 'freetext',
      rect: [10, 20, 210, 40],
      text: '日本語',
      layout: {
        lines: [{ text: '日本語', x: 2, baseline: 11 }],
        height: 18,
      },
    })

    expectRecomputed(store, () => {
      store.setLayout(text.id, {
        lines: [{ text: '日本語', x: 3, baseline: 12 }],
        height: 19,
      })
    }, summary({ annotations: 1 }))

    expectRecomputed(store, () => store.reset(), summary())

    const revision = store.getContentRevision()
    const count = computeCount()
    store.selectFixture(null)
    expect(store.isDirty()).toBe(false)
    expect(store.getContentRevision()).toBe(revision)
    expect(computeCount()).toBe(count)
  })

  it('invalidates on page loading and quantity-check initialization through existing notifications', async () => {
    const store = new AnnotationStore()
    store.dirtySummary()
    let revision = store.getContentRevision()
    let count = computeCount()

    await store.ensurePageLoaded(0, async () => [])
    expect(store.getContentRevision()).toBeGreaterThan(revision)
    expect(store.dirtySummary()).toEqual(summary())
    expect(computeCount()).toBe(count + 1)

    revision = store.getContentRevision()
    count = computeCount()
    await store.ensureQuantityChecks(async () => ({ values: {} }))
    expect(store.quantityChecksReady).toBe(true)
    expect(store.getContentRevision()).toBeGreaterThan(revision)
    expect(store.dirtySummary()).toEqual(summary())
    expect(computeCount()).toBe(count + 1)
  })
})
