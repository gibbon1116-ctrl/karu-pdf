import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PickupFlash } from '../src/editor/AnnotationLayer'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { CSS_PX_PER_PT } from '../src/viewer/pageLayout'

describe('pickup flash', () => {
  it('notifies only when clearing an active flash and leaves edits clean', () => {
    const store = new AnnotationStore()
    const edits = store.toEdits(), index = store.quantityIndex()
    const revision = store.getContentRevision(), snapshot = store.getSnapshot()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.clearPickupFlash()
    expect(store.flashId).toBeNull()
    expect(store.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()

    store.flashPickup('pickup')
    const flashVersion = store.flashVersion
    store.flashPickup('pickup')
    expect(store.flashVersion).toBe(flashVersion + 1)
    expect(listener).toHaveBeenCalledTimes(2)
    store.clearPickupFlash()
    expect(store.flashId).toBeNull()
    expect(store.flashVersion).toBe(flashVersion + 1)
    expect(listener).toHaveBeenCalledTimes(3)
    store.clearPickupFlash()
    expect(listener).toHaveBeenCalledTimes(3)
    expect(store.isDirty()).toBe(false)
    expect(store.getContentRevision()).toBe(revision)
    expect(store.toEdits()).toEqual(edits)
    expect(store.quantityIndex()).toBe(index)
    unsubscribe()
  })

  it('renders a persistent circle and a separate double convergence ring for a symbol', () => {
    const flash = new AnnotationStore().create({ kind: 'symbol', pageIndex: 0, rect: [10, 20, 30, 40] })
    const markup = renderToStaticMarkup(createElement(PickupFlash, {
      flash, zoom: 2, pageSize: { width: 500, height: 600 }, flashVersion: 1,
    }))
    expect(markup).toMatch(/<circle[^>]*data-testid="quantity-pickup-flash"/)
    expect(markup).toContain(`data-flash-id="${flash.id}"`)
    expect(markup).toContain('quantity-pickup-marker-halo')
    expect(markup).toContain('stroke="#ffffff" stroke-width="8"')
    expect(markup).toContain('fill="rgba(120, 220, 180, 0.30)" stroke="#52c79b" stroke-width="5"')
    expect(markup).toContain('cx="20" cy="30"')
    expect(markup).toContain(`r="${Math.hypot(20, 20) / 2 + 8 / (2 * CSS_PX_PER_PT)}"`)
    expect(markup).toContain('data-testid="quantity-pickup-converge"')
    expect(markup).toContain('stroke="#ffffff" stroke-width="7"')
    expect(markup).toContain('stroke="#52c79b" stroke-width="4"')
    expect(markup.match(/<circle\b/g)).toHaveLength(4)
    expect(markup).not.toContain('<rect')
  })

  it('renders the measurement polyline and centers convergence on its vertex bounds', () => {
    const flash = new AnnotationStore().create({ kind: 'perimeter', pageIndex: 0, rect: [0, 0, 200, 200],
      vertices: [[10, 20], [80, 20], [80, 120]],
      measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 100 } })
    const markup = renderToStaticMarkup(createElement(PickupFlash, {
      flash, zoom: 1, pageSize: { width: 500, height: 600 }, flashVersion: 2,
    }))
    expect(markup).toMatch(/<polyline[^>]*data-testid="quantity-pickup-flash"/)
    expect(markup).toContain(`data-flash-id="${flash.id}"`)
    expect(markup).toContain('points="10,20 80,20 80,120"')
    expect(markup).toContain('cx="45" cy="70"')
    expect(markup).toContain('data-testid="quantity-pickup-converge"')
    expect(markup).not.toContain('quantity-pickup-marker')
  })

  it('omits convergence for reduced motion and tolerates missing matchMedia', () => {
    const flash = new AnnotationStore().create({ kind: 'symbol', pageIndex: 0, rect: [10, 20, 10, 20] })
    const render = () => renderToStaticMarkup(createElement(PickupFlash, {
      flash, zoom: 1, pageSize: { width: 500, height: 600 }, flashVersion: 1,
    }))
    try {
      vi.stubGlobal('window', { matchMedia: vi.fn(() => ({ matches: true })) })
      const markup = render()
      expect(markup).toContain('data-testid="quantity-pickup-flash"')
      expect(markup).toContain(`r="${14 / CSS_PX_PER_PT}"`)
      expect(markup).not.toContain('data-testid="quantity-pickup-converge"')
      vi.stubGlobal('window', {})
      expect(render()).toContain('data-testid="quantity-pickup-converge"')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
