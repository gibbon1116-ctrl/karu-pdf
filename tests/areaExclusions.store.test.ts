import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'

// SPEC-S17 store guards, moved from the browser test (they need no page).
it('pickupMethod defaults, kind guards and exclusion/opening limits', () => {
  const result = (() => {

    // Only the methods under test are exercised here; no PDF/store constructor is bypassed
    // for the integration tests below, which use the real document session.
    const store = Object.create(AnnotationStore.prototype)
    store.pickupMethods = new Map()
    let notifications = 0, mutations = 0
    const fixtures = new Map([
      ['area', { id: 'area', kind: 'area', method: 'lengthHeight' }],
      ['volume', { id: 'volume', kind: 'volume', method: 'polygonDepth' }],
      ['count', { id: 'count' }],
      ['length', { id: 'length', kind: 'length' }],
    ])
    store.getCountFixture = (id: string) => fixtures.get(id)
    store.notify = (dirty: boolean) => {
      if (dirty !== false) throw new Error('Pickup preferences must not dirty the document')
      notifications++
    }
    store.mutate = () => { mutations++ }

    const fallback = store.pickupMethod(fixtures.get('area'))
    store.setPickupMethod('area', 'polygon')
    const chosen = store.pickupMethod(fixtures.get('area'))
    store.setPickupMethod('area', 'polygon')
    store.setPickupMethod('area', 'polygonDepth')
    store.setPickupMethod('missing', 'polygon')
    const afterInvalid = store.pickupMethod(fixtures.get('area'))
    const compatible = store.supportsPickupMethod(fixtures.get('area'), 'polygon')
    const incompatible = store.supportsPickupMethod(fixtures.get('volume'), 'polygon')

    const outer = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const hole = [[10, 10], [20, 10], [20, 20], [10, 20]]
    const annotation = {
      id: 'mark', vertices: outer, measure: { kind: 'area', mmPerPoint: 1000 },
      quantity: { version: 1, id: 'quantity', itemId: 'area', method: 'polygon' },
    }
    store.get = () => annotation
    const tooManyHoles = store.setAreaHoles('mark', Array.from({ length: 51 }, () => hole))
    const tooManyPoints = store.setAreaHoles('mark', [Array.from({ length: 501 }, () => [10, 10])])
    const outside = store.setAreaHoles('mark', [[[90, 90], [110, 90], [90, 95]]])
    const tooManyOpenings = store.setQuantityOpenings('mark', Array.from({ length: 51 }, () => ({ widthM: 1, heightM: 1, count: 1 })))
    const invalidCount = store.setQuantityOpenings('mark', [{ widthM: 1, heightM: 1, count: 1000 }])
    const unfinishedManual = store.setQuantityOpenings('mark', [{ count: 1 }])
    return {
      fallback, chosen, afterInvalid, notifications, compatible, incompatible,
      tooManyHoles, tooManyPoints, outside, tooManyOpenings, invalidCount, unfinishedManual, mutations,
    }
  })() as Record<string, unknown>
  expect(result.fallback).toBe('lengthHeight')
  expect(result.chosen).toBe('polygon')
  expect(result.afterInvalid).toBe('polygon')
  expect(result.notifications).toBe(1)
  expect(result.compatible).toBe(true)
  expect(result.incompatible).toBe(false)
  expect(result.tooManyHoles).toContain('50')
  expect(result.tooManyPoints).toContain('500')
  expect(result.outside).toBe('除外範囲は外形の内側を囲んでください')
  expect(result.tooManyOpenings).toContain('50')
  expect(result.invalidCount).toContain('999')
  expect(result.unfinishedManual).toBeTruthy()
  expect(result.mutations).toBe(0)
})
