import { describe, expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { measureBounds, measureText, ratioScale, type ScaleRegion } from '../src/core/measure'
import { quantityValue } from '../src/core/quantity'
import { nextCountStyle } from '../src/core/countFixtures'
import type { Point } from '../src/core/annotations'
const size = { width: 500, height: 500 }
const scale = (n: number) => ratioScale(n, 'PDF', size, 'm')
const region: ScaleRegion = { id: 'detail', label: 'A部詳細', rect: [250, 250, 450, 450], scale: scale(20) }
function measurement(store: AnnotationStore, start: Point, denominator: number, quantity = false) {
  const vertices: Point[] = [start, [start[0] + 72, start[1]]], measure = { ...scale(denominator), kind: 'perimeter' as const }
  const text = measureText(vertices, measure)
  return store.create({ kind: 'perimeter', pageIndex: 0, vertices, measure, text, rect: measureBounds(vertices, 'perimeter', text, 10), ...(quantity ? { quantity: { version: 1 as const, id: crypto.randomUUID(), itemId: 'cv', method: 'polyline' as const } } : {}) })
}
describe('AnnotationStore scale regions', () => {
  it('has undo/redo, sparse dirty pages, deletion edits and applied baseline', () => {
    const store = new AnnotationStore(); store.loadScales([scale(100)]); store.loadScaleRegions([])
    expect(store.getScaleRegions(0)).toEqual([]); expect(store.isDirty()).toBe(false)
    store.setScaleRegions(0, [region], false)
    expect(store.dirtySummary().scales).toEqual([0])
    expect(store.toEdits()).toEqual([{ kind: 'setScaleRegions', pageIndex: 0, regions: [region] }])
    store.undo(); expect(store.getScaleRegions(0)).toEqual([]); expect(store.isDirty()).toBe(false)
    store.redo(); expect(store.scaleAt(0, [300, 300])?.region?.id).toBe(region.id)
    store.toEdits(); store.markApplied({ created: [] }); expect(store.isDirty()).toBe(false)
    store.setScaleRegions(0, [], false); expect(store.toEdits()).toEqual([{ kind: 'setScaleRegions', pageIndex: 0, regions: [] }])
    store.undo(); expect(store.isDirty()).toBe(false)
  })
  it('handles failed saves and concurrent changes using a saved snapshot and stable JSON', () => {
    const store = new AnnotationStore(); store.loadScaleRegions([[0, [region]]])
    store.setScaleRegions(0, [{ ...region, label: '変更' }], false)
    store.toEdits(); store.markApplied({ created: [], errors: [{ editIndex: 0 }] }); expect(store.isDirty()).toBe(true)
    store.toEdits(); store.setScaleRegions(0, [{ ...region, label: '保存中に変更' }], false)
    store.markApplied({ created: [] }); expect(store.isDirty()).toBe(true)
    store.setScaleRegions(0, [{ label: '変更', scale: region.scale, rect: region.rect, id: region.id }], false)
    expect(store.isDirty()).toBe(false)
    const copy = store.getScaleRegions(0); copy[0].rect[0] = 0; copy[0].scale.mmPerPoint = 1
    expect(store.getScaleRegions(0)[0].rect).toEqual(region.rect)
    expect(store.scaleAt(0, [300, 300])?.scale.mmPerPoint).toBe(region.scale.mmPerPoint)
  })
  it('recalculates measurements and quantities by first vertex only and preserves values without consent', async () => {
    const store = new AnnotationStore(); store.loadScales([scale(100)]); store.loadScaleRegions([[0, [region]]])
    await store.ensureCountFixtures(async () => [{ id: 'cv', code: 'CV', name: 'ケーブル', category: '電線', kind: 'length', method: 'polyline', order: 0, style: nextCountStyle([]) }], async () => {})
    const outside = measurement(store, [100, 100], 100, true), inside = measurement(store, [300, 300], 20, true)
    const outsideToInside = measurement(store, [200, 300], 100)
    const simple = measurement(store, [300, 350], 20)
    const value = (id: string) => { const a = store.get(id)!; return quantityValue(a.vertices!, a.measure!.mmPerPoint, a.quantity!) }
    store.setScaleRegions(0, [{ ...region, scale: scale(10) }], false)
    expect(value(inside.id)).toBeCloseTo(.508)
    store.setScaleRegions(0, [{ ...region, scale: scale(10) }], true)
    expect(value(inside.id)).toBeCloseTo(.254); expect(store.get(simple.id)?.text).toBe('合計 0.25 m')
    expect(value(outside.id)).toBeCloseTo(2.54); expect(store.get(outsideToInside.id)?.measure?.mmPerPoint).toBe(scale(100).mmPerPoint)
    store.undo(); expect(value(inside.id)).toBeCloseTo(.508)
    store.redo(); expect(value(inside.id)).toBeCloseTo(.254)
    store.setScale([0], scale(200), true)
    expect(value(outside.id)).toBeCloseTo(5.08); expect(value(inside.id)).toBeCloseTo(.254)
    store.setScaleRegions(0, [], false); expect(value(inside.id)).toBeCloseTo(.254)
    store.undo(); store.setScaleRegions(0, [], true); expect(value(inside.id)).toBeCloseTo(5.08)
    store.undo(); expect(value(inside.id)).toBeCloseTo(.254)
    store.updateMeasureVertices(inside.id, [[100, 300], [172, 300]])
    expect(value(inside.id)).toBeCloseTo(.254)
  })
  it('recalculates starts in the old or new rectangle after moving a region', () => {
    const store = new AnnotationStore(); store.loadScales([scale(100)]); store.loadScaleRegions([[0, [region]]])
    const old = measurement(store, [300, 300], 20), next = measurement(store, [100, 100], 100), untouched = measurement(store, [100, 400], 100)
    store.setScaleRegions(0, [{ ...region, rect: [50, 50, 200, 200] }], true)
    expect(store.get(old.id)?.measure?.mmPerPoint).toBe(scale(100).mmPerPoint)
    expect(store.get(next.id)?.measure?.mmPerPoint).toBe(scale(20).mmPerPoint)
    expect(store.get(untouched.id)?.measure?.mmPerPoint).toBe(scale(100).mmPerPoint)
    store.undo(); expect(store.get(old.id)?.measure?.mmPerPoint).toBe(scale(20).mmPerPoint)
  })
  it('supports regions without page scale, preserves values when the last scale is removed, and limits count', () => {
    const store = new AnnotationStore(); store.loadScaleRegions([[0, [region]]])
    expect(store.scaleAt(0, [300, 300])?.scale).toEqual(region.scale); expect(store.scaleAt(0, [100, 100])).toBeNull()
    const a = measurement(store, [300, 300], 20)
    store.setScaleRegions(0, [], true); expect(store.get(a.id)?.measure?.mmPerPoint).toBe(region.scale.mmPerPoint)
    expect(() => store.setScaleRegions(0, Array.from({ length: 21 }, (_, i) => ({ ...region, id: String(i) })), false)).toThrow()
    expect(() => store.setScaleRegions(0, [region, region], false)).toThrow()
    store.reset(true); expect(store.getScaleRegions(0)).toEqual([])
  })
})
