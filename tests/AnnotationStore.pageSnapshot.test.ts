import { describe, expect, it, vi } from 'vitest'
import type { AnnotationInfo } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import { countFixtureId, type CountMark } from '../src/core/counts'
import { AnnotationStore, type EditableAnnotation } from '../src/editor/AnnotationStore'
import {
  getPerfCounters, isPerfEnabled, resetPerfCounters, setPerfEnabled,
} from '../src/perf/counters'

const fixture: CountFixture = {
  id: 'led', code: 'LED', name: '照明', category: '電気', order: 0,
  style: {
    shape: 'circle', fill: 'none', color: [1, 0, 0],
    size: 10, opacity: 0.8, showCode: true,
  },
}
const pages = [0, 1, 2, 9]

async function setup(): Promise<AnnotationStore> {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [
    fixture, { ...fixture, id: 'other', name: '別の項目', order: 1 },
  ], async () => {})
  return store
}

function loadedInfo(
  objNum: number,
  overrides: Partial<AnnotationInfo> = {},
): AnnotationInfo {
  return {
    objNum, editable: true, kind: 'square',
    rect: [10, 20, 30, 40], contents: '', symbol: null,
    madeByKaru: false, ...overrides,
  } as AnnotationInfo
}

function assertInvariant(store: AnnotationStore): void {
  for (const pageIndex of pages) {
    // The comparison scans always use current mutable public annotations.
    const annotations = store.getPageAnnotations(pageIndex)
    expect(store.getPageAnnotationsSnapshot(pageIndex)).toEqual(annotations)

    const countObjects = !store.fixturesReady ? [] : annotations
      .filter(a => (a.count && store.fixtureForCount(a.count)
        || a.quantity && store.getCountFixture(a.quantity.itemId))
        && a.objNum !== null)
      .map(a => a.objNum!)
    const issueObjects = annotations
      .filter(a => !a.legacyChange && a.issue
        && a.issue.recordKind !== 'change' && a.objNum !== null)
      .map(a => a.objNum!)

    expect(store.countOverlayObjNums(pageIndex)).toEqual(countObjects)
    expect(store.countOverlayObjNums(pageIndex)).toEqual(countObjects)
    expect(store.issueOverlayObjNums(pageIndex)).toEqual(issueObjects)
    expect(store.issueOverlayObjNums(pageIndex)).toEqual(issueObjects)
  }
}

function checkedChange<T>(store: AnnotationStore, change: () => T): T {
  const before = pages.map(pageIndex => store.getPageAnnotationsSnapshot(pageIndex))
  const revision = store.getContentRevision()
  const result = change()
  expect(store.getContentRevision()).toBeGreaterThan(revision)
  pages.forEach((pageIndex, index) => {
    expect(store.getPageAnnotationsSnapshot(pageIndex)).not.toBe(before[index])
  })
  assertInvariant(store)
  return result
}

function assertDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) assertDeepFrozen(child, seen)
}

describe('page annotation snapshots', () => {
  it('matches current annotations and overlay scans after editing, history, saving and reset', async () => {
    const store = await setup()
    assertInvariant(store)

    const square = checkedChange(store, () => store.create({
      pageIndex: 0, kind: 'square', rect: [1, 2, 20, 30],
    }))
    checkedChange(store, () => store.create({
      pageIndex: 2, kind: 'square', rect: [5, 6, 25, 36],
    }))
    checkedChange(store, () => store.create({
      pageIndex: 1, kind: 'issue', rect: [10, 20, 30, 40],
    }))
    const marks = checkedChange(store, () => store.createCountMarks('led', [
      { pageIndex: 0, center: [40, 50] },
      { pageIndex: 1, center: [60, 70] },
      { pageIndex: 2, center: [80, 90] },
    ]))
    checkedChange(store, () => store.createCountMarks('other', [
      { pageIndex: 0, center: [100, 110] },
      { pageIndex: 2, center: [120, 130] },
    ]))

    checkedChange(store, () => store.move(square.id, 3, 4))
    expect(store.getPageAnnotationsSnapshot(0).find(a => a.id === square.id)?.rect)
      .toEqual([4, 6, 23, 34])
    checkedChange(store, () => store.resize(square.id, [7, 8, 27, 38]))
    expect(store.getPageAnnotationsSnapshot(0).find(a => a.id === square.id)?.rect)
      .toEqual([7, 8, 27, 38])

    checkedChange(store, () => store.remove(marks[1]))
    expect(store.getPageAnnotationsSnapshot(1).some(a => a.id === marks[1])).toBe(false)
    checkedChange(store, () => store.undo())
    expect(store.getPageAnnotationsSnapshot(1).some(a => a.id === marks[1])).toBe(true)
    checkedChange(store, () => store.redo())
    expect(store.getPageAnnotationsSnapshot(1).some(a => a.id === marks[1])).toBe(false)

    checkedChange(store, () => store.setCountFixtures(
      store.getCountFixtures().filter(f => f.id !== 'led'), ['led'],
    ))
    expect(pages.flatMap(p => [...store.getPageAnnotationsSnapshot(p)])
      .some(a => a.count && countFixtureId(a.count) === 'led')).toBe(false)
    checkedChange(store, () => store.undo())
    expect(store.getCountFixture('led')).toBeDefined()
    checkedChange(store, () => store.redo())
    expect(store.getCountFixture('led')).toBeUndefined()

    const edits = store.toEdits()
    assertInvariant(store)
    const created = edits.filter(edit => edit.kind.startsWith('create'))
      .map((_, index) => 100 + index)
    expect(created.length).toBeGreaterThan(0)
    checkedChange(store, () => store.markApplied({ created, errors: [] }))
    for (const pageIndex of pages) {
      for (const annotation of store.getPageAnnotationsSnapshot(pageIndex)) {
        expect(annotation.objNum).not.toBeNull()
        expect(annotation.dirty).toBe(false)
      }
    }
    expect(store.countOverlayObjNums(0)).toHaveLength(1)
    expect(store.countOverlayObjNums(2)).toHaveLength(1)
    expect(store.issueOverlayObjNums(1)).toHaveLength(1)

    checkedChange(store, () => store.reset())
    for (const pageIndex of pages) {
      expect(store.getPageAnnotationsSnapshot(pageIndex)).toEqual([])
      expect(store.countOverlayObjNums(pageIndex)).toEqual([])
      expect(store.issueOverlayObjNums(pageIndex)).toEqual([])
    }
  })

  it('reuses all page arrays across display-only operations', async () => {
    const store = await setup()
    const annotation = store.create({
      pageIndex: 0, kind: 'cloudPolygon', rect: [0, 0, 20, 20],
      vertices: [[0, 0], [20, 0], [20, 20]],
    })
    store.createCountMarks('led', [{ pageIndex: 1, center: [40, 50] }])
    const before = pages.map(pageIndex => store.getPageAnnotationsSnapshot(pageIndex))
    const revision = store.getContentRevision()
    const operations = [
      () => store.selectFixture('led'),
      () => store.selectOnly(annotation.id),
      () => store.clearSelection(),
      () => store.setHighlightedVertex({ annotationId: annotation.id, vertexIndex: 1 }),
      () => store.setAnnotationFilter({ ...store.annotationFilter, discipline: '電気' }),
    ]

    for (const operation of operations) {
      operation()
      expect(store.getContentRevision()).toBe(revision)
      pages.forEach((pageIndex, index) => {
        expect(store.getPageAnnotationsSnapshot(pageIndex)).toBe(before[index])
      })
      assertInvariant(store)
    }
  })

  it('deeply freezes detached snapshots while keeping mutable getters writable', async () => {
    const store = await setup()
    const measure: NonNullable<EditableAnnotation['measure']> = {
      kind: 'area', mmPerPoint: 1, unit: 'm', decimals: 2,
      holes: [[[2, 2], [4, 2], [4, 4]]],
    }
    const layout = {
      lines: [{ text: '日本語', x: 2, baseline: 11 }], height: 18,
    }
    store.create({
      pageIndex: 0, kind: 'area', rect: [0, 0, 20, 20],
      vertices: [[0, 0], [20, 0], [20, 20]], measure,
    })
    store.create({
      pageIndex: 0, kind: 'freetext', rect: [30, 40, 230, 60],
      text: '日本語', layout,
    })
    store.create({
      pageIndex: 0, kind: 'symbol', rect: [50, 60, 60, 70],
      count: {
        version: 2, id: 'nested-count', fixtureId: 'led',
        extra: [{ itemId: 'other', count: 2 }],
      },
    })

    const snapshot = store.getPageAnnotationsSnapshot(0)
    const expected = structuredClone(snapshot)
    assertDeepFrozen(snapshot)
    expect(Object.isFrozen(measure)).toBe(false)
    expect(Object.isFrozen(measure.holes)).toBe(false)
    expect(Object.isFrozen(measure.holes![0][0])).toBe(false)
    expect(Object.isFrozen(layout)).toBe(false)
    expect(Object.isFrozen(layout.lines[0])).toBe(false)

    const mutable = store.getPageAnnotations(0)
    expect(Object.isFrozen(mutable)).toBe(false)
    expect(Object.isFrozen(mutable[0])).toBe(false)
    expect(Object.isFrozen(mutable[0].rect)).toBe(false)
    expect(Object.isFrozen(mutable[0].measure!.holes)).toBe(false)
    expect(Object.isFrozen(mutable[1].layout!.lines[0])).toBe(false)
    expect(Object.isFrozen(mutable[2].count)).toBe(false)
    expect(store.getPageAnnotations(0)).not.toBe(mutable)

    mutable[0].rect[0] = 9999
    mutable[0].measure!.mmPerPoint = 9999
    mutable[1].layout!.lines[0].text = '変更'
    const count = mutable[2].count!
    if (count.version === 2) count.extra![0].count = 999
    mutable.splice(0, 1)

    expect(store.getPageAnnotationsSnapshot(0)).toBe(snapshot)
    expect(snapshot).toEqual(expected)
    assertInvariant(store)
    checkedChange(store, () => store.move(snapshot[0].id, 1, 2))
  })

  it('invalidates layout-only updates without adding notifications', () => {
    const store = new AnnotationStore()
    const annotation = store.create({
      pageIndex: 0, kind: 'freetext', rect: [10, 20, 210, 40],
      text: '日本語',
    })
    store.toEdits()
    store.markApplied({ created: [31], errors: [] })
    const notified = vi.fn()
    const unsubscribe = store.subscribe(notified)
    try {
      const layout = {
        lines: [{ text: '日本語', x: 2, baseline: 11 }], height: 18,
      }
      checkedChange(store, () => store.update('obj-31', { layout }))
      expect(notified).not.toHaveBeenCalled()
      expect(store.getPageAnnotationsSnapshot(0)[0].layout).toEqual(layout)
      expect(store.getPageAnnotationsSnapshot(0)[0].dirty).toBe(false)

      const nextLayout = {
        lines: [{ text: annotation.text, x: 3, baseline: 12 }], height: 20,
      }
      checkedChange(store, () => store.setLayout('obj-31', nextLayout))
      expect(notified).toHaveBeenCalledTimes(1)
      expect(store.getPageAnnotationsSnapshot(0)[0].layout).toEqual(nextLayout)
    } finally {
      unsubscribe()
    }
  })

  it('preserves Map order after partial saving, deletion and history restoration', async () => {
    const store = new AnnotationStore()
    await store.ensurePageLoaded(0, async () => [loadedInfo(200)])
    const first = store.create({
      pageIndex: 0, kind: 'square', rect: [1, 2, 20, 30],
    })
    const second = store.create({
      pageIndex: 0, kind: 'square', rect: [40, 50, 60, 70],
    })
    const ids = () => store.getPageAnnotationsSnapshot(0).map(a => a.id)
    expect(ids()).toEqual(['obj-200', first.id, second.id])
    assertInvariant(store)

    expect(store.toEdits()).toHaveLength(2)
    checkedChange(store, () => store.markApplied({
      created: [201], errors: [{ editIndex: 1 }],
    }))
    // Renaming deletes and reinserts the saved annotation at the end of the Map.
    expect(ids()).toEqual(['obj-200', second.id, 'obj-201'])
    expect(store.get('obj-201')?.dirty).toBe(false)
    expect(store.get(second.id)?.dirty).toBe(true)

    checkedChange(store, () => store.remove('obj-200'))
    expect(ids()).toEqual([second.id, 'obj-201'])
    checkedChange(store, () => store.undo())
    expect(ids()).toEqual(['obj-200', second.id, 'obj-201'])
    checkedChange(store, () => store.redo())
    expect(ids()).toEqual([second.id, 'obj-201'])
  })

  it('invalidates on loading and fixture readiness and preserves overlay array ownership', async () => {
    const store = new AnnotationStore()
    const empty = store.getPageAnnotationsSnapshot(0)
    const issue = { version: 1 as const, id: 'loaded-issue', number: 1, status: 'open' as const }
    await store.ensurePageLoaded(0, async () => [
      loadedInfo(11, {
        kind: 'symbol', symbol: 'circle',
        count: { version: 2, id: 'valid-count', fixtureId: 'led' },
      }),
      loadedInfo(12, {
        kind: 'symbol', symbol: 'circle',
        count: { version: 2, id: 'missing-count', fixtureId: 'missing' },
      }),
      loadedInfo(13, { kind: 'issue', issue }),
      loadedInfo(14, { kind: 'issue', issue: { ...issue, id: 'change', recordKind: 'change' } }),
      loadedInfo(15, {
        kind: 'issue', legacyChange: true,
        issue: { ...issue, id: 'legacy-issue' },
        // Typed arrays with elements cannot be frozen; the snapshot must still build.
        legacyChangeData: { pdf: new Uint8Array([1, 2, 3]), preview: 'data:image/png;base64,', bounds: [0, 0, 1, 1] },
      }),
    ])
    expect(store.getPageAnnotationsSnapshot(0)).not.toBe(empty)
    expect(store.countOverlayObjNums(0)).toEqual([])
    expect(store.issueOverlayObjNums(0)).toEqual([13])
    assertInvariant(store)

    const beforeFixtures = store.getPageAnnotationsSnapshot(0)
    await store.ensureCountFixtures(async () => [fixture], async () => {})
    expect(store.getPageAnnotationsSnapshot(0)).not.toBe(beforeFixtures)
    expect(store.countOverlayObjNums(0)).toEqual([11])
    assertInvariant(store)

    const counts = store.countOverlayObjNums(0)
    const issues = store.issueOverlayObjNums(0)
    expect(Object.isFrozen(counts)).toBe(false)
    expect(Object.isFrozen(issues)).toBe(false)
    counts[0] = 999
    counts.push(1000)
    issues.splice(0, 1)
    expect(store.countOverlayObjNums(0)).toEqual([11])
    expect(store.issueOverlayObjNums(0)).toEqual([13])
    expect(store.countOverlayObjNums(0)).not.toBe(counts)
    expect(store.issueOverlayObjNums(0)).not.toBe(issues)
    assertInvariant(store)
  })

  it('invalidates touch and legacy count normalization performed during saving', async () => {
    const store = new AnnotationStore()
    const legacy: CountMark = { version: 1, id: 'legacy-mark', group: '旧項目' }
    await store.ensurePageLoaded(0, async () => [
      loadedInfo(301, { kind: 'symbol', symbol: 'circle', count: legacy }),
    ])
    await store.ensureCountFixtures(async () => [
      { ...fixture, id: countFixtureId(legacy) },
    ], async () => {})
    assertInvariant(store)

    checkedChange(store, () => store.touch('obj-301'))
    const touched = store.getPageAnnotationsSnapshot(0)
    const touchedRevision = store.getContentRevision()
    store.touch('obj-301')
    expect(store.getContentRevision()).toBe(touchedRevision)
    expect(store.getPageAnnotationsSnapshot(0)).toBe(touched)

    checkedChange(store, () => store.create({
      pageIndex: 1, kind: 'square', rect: [1, 2, 20, 30],
    }))
    const beforeSave = store.getPageAnnotationsSnapshot(0)
    const revision = store.getContentRevision()
    expect(beforeSave[0].count?.version).toBe(1)
    const edits = store.toEdits()
    expect(store.getContentRevision()).toBeGreaterThan(revision)
    expect(store.getPageAnnotationsSnapshot(0)).not.toBe(beforeSave)
    expect(store.getPageAnnotationsSnapshot(0)[0].count?.version).toBe(2)
    assertInvariant(store)

    checkedChange(store, () => store.markApplied({
      created: edits.filter(edit => edit.kind.startsWith('create'))
        .map((_, index) => 302 + index),
      errors: [],
    }))
    expect(store.get('obj-301')?.dirty).toBe(false)
  })

  it('indexes annotations once per revision and times overlay scans only on cache misses', async () => {
    const store = await setup()
    store.createCountMarks('led', [
      { pageIndex: 0, center: [40, 50] },
      { pageIndex: 1, center: [60, 70] },
    ])
    store.create({ pageIndex: 0, kind: 'issue', rect: [10, 20, 30, 40] })
    store.toEdits()
    store.markApplied({ created: [501, 502, 503], errors: [] })

    const wasEnabled = isPerfEnabled()
    const internal = store as unknown as { annotations: Map<string, unknown> }
    const values = vi.spyOn(internal.annotations, 'values')
    setPerfEnabled(true)
    resetPerfCounters()
    try {
      for (const pageIndex of pages) {
        const snapshot = store.getPageAnnotationsSnapshot(pageIndex)
        expect(store.getPageAnnotationsSnapshot(pageIndex)).toBe(snapshot)
      }
      expect(values).toHaveBeenCalledTimes(1)
      expect(getPerfCounters()['store.pageSnapshot.build'].count).toBe(4)

      for (const pageIndex of [0, 1]) {
        store.countOverlayObjNums(pageIndex)
        store.countOverlayObjNums(pageIndex)
        store.issueOverlayObjNums(pageIndex)
        store.issueOverlayObjNums(pageIndex)
      }
      expect(values).toHaveBeenCalledTimes(5)
      expect(getPerfCounters()['store.countOverlayObjNums'].count).toBe(2)
      expect(getPerfCounters()['store.issueOverlayObjNums'].count).toBe(2)

      store.selectFixture('other')
      store.selectOnly('obj-501')
      store.clearSelection()
      for (const pageIndex of pages) store.getPageAnnotationsSnapshot(pageIndex)
      store.countOverlayObjNums(0)
      store.issueOverlayObjNums(0)
      expect(values).toHaveBeenCalledTimes(5)
      expect(getPerfCounters()['store.pageSnapshot.build'].count).toBe(4)
      expect(getPerfCounters()['store.countOverlayObjNums'].count).toBe(2)
      expect(getPerfCounters()['store.issueOverlayObjNums'].count).toBe(2)

      store.move('obj-501', 1, 2)
      store.getPageAnnotationsSnapshot(0)
      store.getPageAnnotationsSnapshot(1)
      expect(values).toHaveBeenCalledTimes(6)
      store.countOverlayObjNums(0)
      store.countOverlayObjNums(0)
      store.issueOverlayObjNums(0)
      store.issueOverlayObjNums(0)
      expect(values).toHaveBeenCalledTimes(8)
      expect(getPerfCounters()['store.pageSnapshot.build'].count).toBe(6)
      expect(getPerfCounters()['store.countOverlayObjNums'].count).toBe(3)
      expect(getPerfCounters()['store.issueOverlayObjNums'].count).toBe(3)

      store.fixturesReady = false
      expect(store.countOverlayObjNums(0)).toEqual([])
      expect(getPerfCounters()['store.countOverlayObjNums'].count).toBe(3)
      store.fixturesReady = true
      expect(store.countOverlayObjNums(0)).toEqual([501])
    } finally {
      values.mockRestore()
      setPerfEnabled(wasEnabled)
      resetPerfCounters()
    }
  })
})
