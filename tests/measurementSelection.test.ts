import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MeasurementFeedbackPath, QuantityRiseMarks, measurementPathPoints } from '../src/editor/AnnotationLayer'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import type { Point } from '../src/core/annotations'
import { CSS_PX_PER_PT } from '../src/viewer/pageLayout'

describe('measurement selection geometry', () => {
  const vertices: Point[] = [[10, 20], [80, 20], [80, 120]]
  it('shares open and closed hit points without changing vertices', () => {
    expect(measurementPathPoints(vertices)).toBe('10,20 80,20 80,120')
    expect(measurementPathPoints(vertices, true)).toBe('10,20 80,20 80,120 10,20')
    expect(vertices).toEqual([[10, 20], [80, 20], [80, 120]])
    expect(measurementPathPoints([], true)).toBe('')
  })
  it.each(['perimeter', 'distance', 'area'])('uses the path for %s with constant added screen width', kind => {
    for (const zoom of [.5, 1, 3]) {
      const markup = renderToStaticMarkup(createElement(MeasurementFeedbackPath, { points: measurementPathPoints(vertices), kind: kind, width: 2, zoom: zoom }))
      expect(markup).toMatch(new RegExp(`^<${kind === 'area' ? 'polygon' : 'polyline'} `))
      expect(markup).toContain('class="annotation-selection-path"')
      expect(markup).toContain(`stroke-width="${2 + 6 / (zoom * CSS_PX_PER_PT)}"`)
      expect(markup).toContain('pointer-events="none"')
      expect(markup).not.toContain('<rect')
    }
  })
  it('flashes the same geometry with its wider stroke and no transform', () => {
    const markup = renderToStaticMarkup(createElement(MeasurementFeedbackPath, { points: measurementPathPoints(vertices), kind: "perimeter", width: 2, zoom: 1, flash: true, flashId: "a" }))
    expect(markup).toContain('<polyline')
    expect(markup).toContain('quantity-pickup-flash-path')
    expect(markup).toContain('data-flash-id="a"')
    expect(markup).toContain('stroke-width="9.5"')
    expect(markup).not.toContain('transform')
  })
  it('reuses a 1000-vertex string for feedback and tracks moved vertices', () => {
    const many: Point[] = Array.from({ length: 1000 }, (_, i) => [i / 10, i % 30])
    const points = measurementPathPoints(many)
    expect(points.split(' ')).toHaveLength(1000)
    expect(renderToStaticMarkup(createElement(MeasurementFeedbackPath, { points: points, kind: "perimeter", width: 1, zoom: 1 }))).toContain(`points="${points}"`)
    many[2] = [11, 22]
    expect(measurementPathPoints(many).split(' ')[2]).toBe('11,22')
  })
})

describe('rise feedback', () => {
  const annotation = { id: 'a', vertices: [[10, 20], [80, 20], [80, 120]] as Point[],
    quantity: { version: 1 as const, id: 'q', itemId: 'cv', method: 'polyline' as const, rises: [{ m: 3, at: 2 }] } }
  it('anchors the single mark to vertex 2 and scales only its screen-sized display', () => {
    const markup = renderToStaticMarkup(createElement(QuantityRiseMarks, { annotation: annotation, zoom: 1, highlightedRise: null }))
    expect(markup).toContain('data-rise-vertex="2" x="80" y="120"')
    expect(markup).toContain('font-size="9"')
    expect(markup).toContain('>↕</text>')
    expect(markup).not.toContain('annotation-rise-mark-highlighted')
    expect(renderToStaticMarkup(createElement(QuantityRiseMarks, { annotation: annotation, zoom: 2, highlightedRise: null }))).toContain('font-size="4.5"')
  })
  it('numbers all rises and highlights only the matching annotation and index', () => {
    const multiple = { ...annotation, quantity: { ...annotation.quantity, rises: [{ m: 3, at: 2 }, { m: 4, at: 0 }] } }
    const markup = renderToStaticMarkup(createElement(QuantityRiseMarks, { annotation: multiple, zoom: 1, highlightedRise: { annotationId: 'a', riseIndex: 1 } }))
    expect(markup).toContain('>↕1</text>')
    expect(markup).toContain('>↕2</text>')
    expect(markup).toContain('class="annotation-rise-mark annotation-rise-mark-highlighted" data-rise-index="1" data-rise-vertex="0" x="10" y="20"')
    expect(renderToStaticMarkup(createElement(QuantityRiseMarks, { annotation: multiple, zoom: 1, highlightedRise: { annotationId: 'other', riseIndex: 1 } }))).not.toContain('annotation-rise-mark-highlighted')
  })
  it('omits unlocated and invalid rise positions', () => {
    const invalid = { ...annotation, quantity: { ...annotation.quantity, rises: [{ m: 1 }, { m: 2, at: 99 }, { m: 3, at: -1 }, { m: 4, at: .5 }] } }
    expect(renderToStaticMarkup(createElement(QuantityRiseMarks, { annotation: invalid, zoom: 1, highlightedRise: null }))).not.toContain('<text')
  })
  it('notifies display subscribers without changing saved edits, index, dirty state or undo', () => {
    const store = new AnnotationStore()
    const mark = store.create({ ...annotation, kind: 'perimeter', pageIndex: 0, rect: [10, 20, 80, 120], measure: { kind: 'perimeter', mmPerPoint: 1, unit: 'mm', decimals: null } })
    const edits = store.toEdits(), index = store.quantityIndex(), dirty = store.dirtySummary()
    const listener = vi.fn(), unsubscribe = store.subscribe(listener)
    const supplied = { annotationId: mark.id, riseIndex: 0 }
    store.setHighlightedRise(supplied)
    supplied.riseIndex = 1
    expect(store.highlightedRise).toEqual({ annotationId: mark.id, riseIndex: 0 })
    store.setHighlightedRise({ annotationId: mark.id, riseIndex: 0 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.toEdits()).toEqual(edits)
    expect(store.quantityIndex()).toBe(index)
    expect(store.dirtySummary()).toEqual(dirty)
    store.undo()
    expect(store.get(mark.id)).toBeUndefined()
    expect(store.highlightedRise?.riseIndex).toBe(0)
    store.setHighlightedRise(null)
    expect(store.highlightedRise).toBeNull()
    store.setHighlightedRise({ annotationId: 'a', riseIndex: 0 })
    store.reset()
    expect(store.highlightedRise).toBeNull()
    unsubscribe()
  })
})
