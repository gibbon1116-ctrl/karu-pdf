import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { Point } from '../src/core/annotations'
import type { QuantityMark } from '../src/core/quantity'
import { QuantityIndex } from '../src/core/quantityIndex'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: 1, showCode: true,
}
const wall: CountFixture = {
  id: 'wall', name: '壁', code: 'W', category: '壁', order: 0,
  kind: 'area', method: 'lengthHeight', style,
}
const door: CountFixture = {
  id: 'door', name: '建具', code: 'D', category: '建具', order: 1,
  kind: 'count', style, opening: { widthM: 1, heightM: 2 },
}
const quantity: QuantityMark = {
  version: 1, id: 'pickup', itemId: 'wall', method: 'lengthHeight', heightM: 3,
  openings: [{ itemId: 'door', widthM: .8, heightM: 2, count: 2 }],
}
const annotations = [{
  id: 'annotation', pageIndex: 0, quantity,
  vertices: [[0, 0], [10, 0]] as Point[], measure: { mmPerPoint: 1000 },
}]

describe('SPEC-S16 quantity index', () => {
  it('uses current fixture dimensions when the existing index is rebuilt', () => {
    const first = QuantityIndex.build(annotations, [wall, door])
    const changed: CountFixture = { ...door, opening: { widthM: 2, heightM: 2 } }
    const second = QuantityIndex.build(annotations, [wall, changed])
    expect(first.total('wall')).toBe(26)
    expect(second.total('wall')).toBe(22)
    expect(second.byPage('wall').get(0)).toBe(22)
    expect(second.entries('wall')[0].value).toBe(22)
  })

  it('uses fallback dimensions when the fixture or its dimensions are absent', () => {
    expect(QuantityIndex.build(annotations, [wall]).total('wall')).toBeCloseTo(26.8)
    expect(QuantityIndex.build(annotations, [wall, { ...door, opening: undefined }]).total('wall')).toBeCloseTo(26.8)
  })

  it('does not add opening references to count totals', () => {
    const index = QuantityIndex.build(annotations, [wall, door])
    expect(index.total('wall')).toBe(26)
    expect(index.total('door')).toBe(0)
    expect(index.countEntriesOnPage(0)).toEqual([])
  })
})
