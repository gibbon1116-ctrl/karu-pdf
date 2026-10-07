import { describe, expect, it } from 'vitest'
import { ratioScale, resolveScale, validScaleRegion, type ScaleRegion } from '../src/core/measure'
const size = { width: 500, height: 500 }
const page = ratioScale(100, 'PDF', size)
const region = (id: string, rect: ScaleRegion['rect'] = [250, 250, 450, 450], denominator = 20): ScaleRegion => ({ id, rect, scale: ratioScale(denominator, 'PDF', size) })
describe('scale region resolution', () => {
  it('uses inclusive region edges, page outside, and handles absent defaults', () => {
    const r = region('detail')
    expect(resolveScale(page, [r], [300, 300])).toEqual({ scale: r.scale, region: r })
    expect(resolveScale(page, [r], [250, 450])?.region).toBe(r)
    expect(resolveScale(page, [r], [100, 100])).toEqual({ scale: page })
    expect(resolveScale(null, [r], [300, 300])?.scale).toBe(r.scale)
    expect(resolveScale(null, [r], [100, 100])).toBeNull()
    expect(resolveScale(null, undefined, [0, 0])).toBeNull()
    expect(resolveScale(null, [], [0, 0])).toBeNull()
    expect(resolveScale(page, undefined, [0, 0])?.scale).toBe(page)
  })
  it('chooses smallest area, then last entry for equal area', () => {
    const outer = region('outer'), inner = region('inner', [280, 280, 400, 400], 10), newer = region('newer', [290, 290, 410, 410], 5)
    expect(resolveScale(page, [inner, outer], [300, 300])?.region).toBe(inner)
    expect(resolveScale(page, [inner, newer, outer], [300, 300])?.region).toBe(newer)
    expect(resolveScale(page, [newer, inner], [300, 300])?.region).toBe(inner)
  })
  it('validates rect, scale, id and 40 character optional label', () => {
    const r = region('r')
    expect(validScaleRegion({ ...r, rect: [0, 0, 10, 10], label: '名'.repeat(40) })).toBe(true)
    expect(validScaleRegion({ ...r, label: '😀'.repeat(40) })).toBe(true)
    for (const value of [null, {}, { ...r, id: '' }, { ...r, rect: [0, 0, 9, 20] }, { ...r, rect: [-1, 0, 20, 20] }, { ...r, rect: [0, 0, Infinity, 20] }, { ...r, rect: [0, 0, 20] }, { ...r, scale: {} }, { ...r, label: '名'.repeat(41) }, { ...r, label: 3 }]) expect(validScaleRegion(value)).toBe(false)
  })
})
