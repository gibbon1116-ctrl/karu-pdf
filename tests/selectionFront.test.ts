import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { canOverlaySelectedAnnotation, frontOrder } from '../src/editor/AnnotationLayer'
import { MeasurementShape } from '../src/editor/MeasurementOverlay'
import type { Kind } from '../src/editor/AnnotationStore'

describe('selection front display order', () => {
  const items = Object.freeze(['a', 'b', 'c', 'd'].map(id => Object.freeze({ id })))
  it('returns the same array reference without selection', () => {
    expect(frontOrder(items, new Set())).toBe(items)
  })
  it('moves one selected item to the end without changing the input', () => {
    const ordered = frontOrder(items, new Set(['b']))
    expect(ordered.map(a => a.id)).toEqual(['a', 'c', 'd', 'b'])
    expect(items.map(a => a.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(ordered[3]).toBe(items[1])
  })
  it('preserves creation order in both partitions, regardless of selection order', () => {
    expect(frontOrder(items, new Set(['d', 'b'])).map(a => a.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(frontOrder(items, new Set(['d', 'c', 'b', 'a']))).toEqual(items)
    expect(frontOrder(items, new Set(['other-page']))).toEqual(items)
    expect(frontOrder(items, new Set())).toBe(items)
  })
})

describe('saved selected SVG overlays', () => {
  it.each<Kind>(['line', 'arrow', 'square', 'circle', 'ink', 'cloudSquare', 'cloudPolygon', 'distance', 'perimeter', 'area', 'symbol'])('allows opaque %s without loading a text layout', kind => {
    expect(canOverlaySelectedAnnotation({ kind, opacity: 1 })).toBe(true)
    expect(canOverlaySelectedAnnotation({ kind, opacity: .99 })).toBe(true)
    expect(canOverlaySelectedAnnotation({ kind, opacity: .989 })).toBe(false)
    expect(canOverlaySelectedAnnotation({ kind, opacity: .5 })).toBe(false)
  })
  it.each<Kind>(['highlight', 'textHighlight', 'underline', 'strikeout', 'freetext', 'callout', 'issue'])('does not duplicate %s from the PDF image', kind => {
    expect(canOverlaySelectedAnnotation({ kind, opacity: 1 })).toBe(false)
  })
})

describe('measurement selection halo', () => {
  const shape = { points: [[0, 0], [30, 0], [30, 30]] as [number, number][], kind: 'area' as const, text: 'CV', fontSize: 10, color: 'rgb(255 0 0)', width: 1.5, opacity: 1, dash: 'dashed' as const }
  it('adds a white underlay while retaining the original color, width and dash', () => {
    const normal = renderToStaticMarkup(createElement(MeasurementShape, shape))
    const selected = renderToStaticMarkup(createElement(MeasurementShape, { ...shape, haloWidth: 4.5 }))
    expect(normal).not.toContain('annotation-selection-halo')
    expect(selected.indexOf('annotation-selection-halo')).toBeLessThan(selected.indexOf('measurement-shape'))
    expect(selected).toContain('stroke="#fff" opacity="0.85" stroke-width="4.5"')
    // The original measurement subtree is unchanged by the extra halo.
    expect(selected.slice(selected.indexOf('<g opacity="1"'))).toBe(normal)
  })
  it('does not duplicate the translucent fill already baked into a saved area', () => {
    const overlay = renderToStaticMarkup(createElement(MeasurementShape, { ...shape, showFill: false, haloWidth: 4.5 }))
    expect(overlay).not.toContain('fill-opacity=".15"')
    expect(overlay).toContain('stroke="rgb(255 0 0)" stroke-width="1.5"')
  })
})
