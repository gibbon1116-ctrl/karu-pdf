import { describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '../src/app/documentModel'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { measureBounds, type PageScale } from '../src/core/measure'
import type { Point } from '../src/core/annotations'
import { stableJson } from '../src/core/stableJson'

const scale: PageScale = { denominator: 100, paper: 'PDF', source: 'ratio', mmPerPoint: 25.4 / 72 * 100, unit: 'm', decimals: 2 }
const fixture = (): CountFixture => ({ id: 'cv', code: 'CV', name: 'ケーブル', category: '電線', kind: 'length', method: 'polyline', order: 0, style: nextCountStyle([]) })
const emptySummary = { annotations: 0, fixtures: false, scales: [], drawings: [] }
function session() {
  return new DocumentSession({ docId: 'test', name: '保存状態.pdf', byteLength: 100, handle: null, pageSizes: Array.from({ length: 12 }, () => ({ width: 500, height: 500 })) })
}
function apply(store: AnnotationStore, created: number[] = []) {
  store.toEdits()
  store.markApplied({ created, errors: [] })
}
async function savedRoute() {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [fixture()], async () => {})
  store.loadScales([scale])
  const vertices: Point[] = [[100, 300], [172, 300]]
  const measure = { kind: 'perimeter' as const, mmPerPoint: scale.mmPerPoint, unit: scale.unit, decimals: scale.decimals }
  // slackM intentionally precedes count, so deleting and restoring it changes key order.
  const quantity = { version: 1 as const, id: 'route', itemId: 'cv', method: 'polyline' as const, slackM: 1, count: 2 }
  const text = store.quantityText({ vertices, measure, quantity, text: '' })
  store.create({ pageIndex: 0, kind: 'perimeter', vertices, measure, quantity, text, rect: measureBounds(vertices, 'perimeter', text, 10.5) })
  apply(store, [31])
  return store
}

describe('保存状態の安定した比較', () => {
  it('saved slack 1 → 0 → 1 is clean despite reordered quantity keys', async () => {
    const store = await savedRoute()
    const savedQuantity = store.get('obj-31')!.quantity
    store.updateQuantityValues('obj-31', { slackM: 0 })
    expect(store.isDirty()).toBe(true)
    store.updateQuantityValues('obj-31', { slackM: 1 })
    expect(Object.keys(store.get('obj-31')!.quantity!)).not.toEqual(Object.keys(savedQuantity!))
    expect(store.isDirty()).toBe(false)
    expect(store.dirtySummary()).toEqual(emptySummary)
    expect(store.toEdits()).toEqual([])
  })

  it('identical fixtures with reordered nested keys do not add history or dirty state', async () => {
    const store = new AnnotationStore(), original = fixture()
    await store.ensureCountFixtures(async () => [original], async () => {})
    const reordered = { style: { ...original.style }, order: original.order, method: original.method, kind: original.kind, category: original.category, name: original.name, code: original.code, id: original.id }
    reordered.style = Object.fromEntries(Object.entries(original.style).reverse()) as CountFixture['style']
    const version = store.getSnapshot()
    store.setCountFixtures([reordered])
    expect(store.getSnapshot()).toBe(version)
    expect(store.canUndo()).toBe(false)
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])
  })

  it('identical drawing and scale values do not add history, including unchanged recalculation', async () => {
    const store = await savedRoute()
    store.loadDrawingInfos([{ number: 'A-01', name: '平面図', scanned: true }])
    const version = store.getSnapshot()
    store.setDrawingInfo([0], { scanned: true, name: '平面図', number: 'A-01' })
    store.setScale([0], { decimals: scale.decimals, unit: scale.unit, mmPerPoint: scale.mmPerPoint, source: scale.source, paper: scale.paper, denominator: scale.denominator }, true)
    expect(store.getSnapshot()).toBe(version)
    expect(store.isDirty()).toBe(false)
    // Only the original create remains in history.
    store.undo()
    expect(store.get('obj-31')).toBeUndefined()
  })

  it('recalculation still records an annotation change when the page scale is identical', async () => {
    const store = await savedRoute()
    store.update('obj-31', { rect: [0, 0, 1, 1] })
    apply(store)
    store.setScale([0], scale, true)
    expect(store.dirtySummary()).toEqual({ ...emptySummary, annotations: 1 })
    store.undo()
    expect(store.isDirty()).toBe(false)
  })
})

describe('保存対象のスナップショット', () => {
  it.each(['create', 'update'] as const)('keeps an edit made between toEdits and markApplied (%s)', async mode => {
    const store = mode === 'update' ? await savedRoute() : new AnnotationStore()
    const id = mode === 'update' ? 'obj-31' : store.create({ pageIndex: 0, kind: 'square', rect: [0, 0, 10, 10] }).id
    if (mode === 'update') store.update(id, { borderWidth: 2 })
    store.toEdits()
    store.update(id, { borderWidth: 3 })
    store.markApplied({ created: mode === 'create' ? [41] : [], errors: [] })
    expect(store.isDirty()).toBe(true)
    expect(store.dirtySummary().annotations).toBe(1)
    expect(store.get(mode === 'create' ? 'obj-41' : id)?.borderWidth).toBe(3)
    expect(store.toEdits()).toHaveLength(1)
  })

  it('keeps each failed annotation, fixture, scale and drawing change dirty', async () => {
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => [], async () => {})
    store.create({ pageIndex: 0, kind: 'square', rect: [0, 0, 10, 10] })
    store.setCountFixtures([fixture()])
    store.setScale([2], scale, false)
    store.setDrawingInfo([1], { number: 'A-02', numberManual: true })
    const edits = store.toEdits()
    store.markApplied({ created: [], errors: edits.map((_, editIndex) => ({ editIndex })) })
    expect(store.dirtySummary()).toEqual({ annotations: 1, fixtures: true, scales: [2], drawings: [1] })
    expect(store.isDirty()).toBe(true)
    expect(store.toEdits()).toEqual(edits)
  })

  it('keeps metadata changed while saving dirty against the captured baseline', async () => {
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => [], async () => {})
    store.setCountFixtures([fixture()]); store.setScale([0], scale, false)
    store.setDrawingInfo([0], { number: 'A-01', numberManual: true })
    store.toEdits()
    store.setCountFixtures([{ ...fixture(), name: '保存中に変更' }])
    store.setScale([0], { ...scale, denominator: 50 }, false)
    store.setDrawingInfo([0], { number: 'A-02', numberManual: true })
    store.markApplied({ created: [], errors: [] })
    expect(store.dirtySummary()).toEqual({ annotations: 0, fixtures: true, scales: [0], drawings: [0] })
  })
})

describe('未保存内容とキャッシュ', () => {
  it('describes annotations, fixtures and ascending one-based pages, with the file flag last', async () => {
    const doc = session(), store = doc.annotationStore
    expect(doc.dirtyDescription()).toBe('')
    await store.ensureCountFixtures(async () => [], async () => {})
    store.create({ pageIndex: 0, kind: 'square', rect: [0, 0, 10, 10] })
    store.setCountFixtures([fixture()])
    store.setScale([2, 0], scale, false)
    store.setDrawingInfo([1], { name: '平面図', nameManual: true })
    expect(store.dirtySummary()).toEqual({ annotations: 1, fixtures: true, scales: [0, 2], drawings: [1] })
    expect(doc.dirtyDescription()).toBe('書き込み・数量の拾い 1件、数量拾いの項目、縮尺（1・3ページ）、図面番号・図面名称（2ページ）')
    doc.fileOutdated = true
    expect(doc.dirtyDescription()).toBe('書き込み・数量の拾い 1件、数量拾いの項目、縮尺（1・3ページ）、図面番号・図面名称（2ページ）、ページの編集・まだ保存していない文書')
    apply(store, [81])
    expect(doc.dirtyDescription()).toBe('ページの編集・まだ保存していない文書')
    doc.fileOutdated = false
    expect(doc.dirtyDescription()).toBe('')
    expect(doc.dirty).toBe(false)
  })

  it('limits both page lists to five and includes the remaining count', () => {
    const doc = session(), store = doc.annotationStore
    store.setScale([10, 8, 6, 3, 2, 0], scale, false)
    store.setDrawingInfo([11, 9, 7, 4, 3, 1, 0], { number: 'A', numberManual: true })
    expect(doc.dirtyDescription()).toBe('縮尺（1・3・4・7・9ページ ほか 1 ページ）、図面番号・図面名称（1・2・4・5・8ページ ほか 2 ページ）')
  })

  it('reuses the summary without scanning annotations and invalidates after notify and baseline changes', async () => {
    const store = new AnnotationStore()
    const scan = vi.spyOn(store as unknown as { editEntries(): unknown[] }, 'editEntries')
    const first = store.dirtySummary()
    expect(store.isDirty()).toBe(false)
    expect(store.dirtySummary()).toBe(first)
    expect(scan).toHaveBeenCalledTimes(1)
    store.create({ pageIndex: 0, kind: 'square', rect: [0, 0, 10, 10] })
    expect(store.isDirty()).toBe(true)
    expect(store.dirtySummary().annotations).toBe(1)
    expect(scan).toHaveBeenCalledTimes(2)
    apply(store, [91])
    expect(store.isDirty()).toBe(false)
    store.setScale([0], scale, false); expect(store.isDirty()).toBe(true)
    store.loadScales([scale]); expect(store.isDirty()).toBe(false)
    store.setDrawingInfo([0], { number: 'A' }); expect(store.isDirty()).toBe(true)
    store.loadDrawingInfos([{ number: 'A' }]); expect(store.isDirty()).toBe(false)
    await store.ensureCountFixtures(async () => [fixture()], async () => {})
    expect(store.isDirty()).toBe(false)
    store.setCountFixtures([]); expect(store.isDirty()).toBe(true)
    store.reset(); expect(store.dirtySummary()).toEqual(emptySummary)
  })

  it('invalidates a cached summary when toEdits corrects issue colors without notify', () => {
    const store = new AnnotationStore()
    store.create({ pageIndex: 0, kind: 'issue', rect: [0, 0, 10, 10], color: [0, 1, 0] })
    apply(store, [101])
    store.update('obj-101', { color: [0, 1, 0] })
    expect(store.dirtySummary().annotations).toBe(1)
    store.toEdits()
    expect(store.dirtySummary().annotations).toBe(0)
    expect(store.isDirty()).toBe(false)
  })

  it('keeps the fixture PDF payload in its original property order', async () => {
    const store = new AnnotationStore(), original = fixture()
    await store.ensureCountFixtures(async () => [], async () => {})
    store.setCountFixtures([original])
    const edit = store.toEdits().find(edit => edit.kind === 'setCountFixtures')
    expect(edit?.kind).toBe('setCountFixtures')
    if (edit?.kind !== 'setCountFixtures') throw new Error('fixture edit missing')
    expect(JSON.stringify(edit.fixtures)).toBe(JSON.stringify([original]))
    expect(stableJson(edit.fixtures)).not.toBe(JSON.stringify(edit.fixtures))
  })
})
