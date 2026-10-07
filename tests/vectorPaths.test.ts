import { describe, expect, it } from 'vitest'
import { classifyPage, segmentEndpoints, type VectorPage } from '../src/core/vectorPaths'
import { buildSnapIndex, findSnap } from '../src/core/snap'

const page = (segmentCount: number, imageAreaRatio: number): Pick<VectorPage, 'segmentCount' | 'stats'> => ({ segmentCount,
  stats: { strokePaths: 0, fillPaths: 0, curves: 0, images: 0, imageAreaRatio, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } } })
describe('vector page classification', () => {
  it.each([[200, .1999, 'vector'], [200, .2, 'mixed'], [199, .5, 'raster'], [199, .4999, 'empty'], [0, 0, 'empty'], [200, .5, 'mixed']] as const)('%i lines, image ratio %f → %s', (count, ratio, kind) => {
    expect(classifyPage(page(count, ratio))).toBe(kind)
  })
})
describe('segment endpoints', () => {
  it('deduplicates by distance across cell boundaries and preserves distant diagonal points', () => {
    const points = segmentEndpoints(new Float32Array([.009, .009, .011, .011, .009, .009, .018, .018, -1, -1, -1.004, -1.004]))
    expect(points).toHaveLength(3)
    expect(findSnap([.02, .02], .01, buildSnapIndex(points, [-2, -2, 2, 2]))?.point).toEqual(points[1])
  })
  it('caps unique points, including zero, and handles empty input', () => {
    expect(segmentEndpoints(new Float32Array([0, 0, 1, 0, 0, 0, 2, 0]), 2)).toEqual([[0, 0], [1, 0]])
    expect(segmentEndpoints(new Float32Array([0, 0, 1, 0]), 0)).toEqual([])
    expect(segmentEndpoints(new Float32Array())).toEqual([])
    const many = new Float32Array(200_004 * 2)
    for (let i = 0; i < 200_004; i++) { many[i * 2] = i; many[i * 2 + 1] = i % 2 }
    expect(segmentEndpoints(many)).toHaveLength(200_000)
  })
})
