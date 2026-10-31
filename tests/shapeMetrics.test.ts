import { expect, it, vi } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityMark } from '../src/core/quantity'
import {
  collectShapeMetrics, clipParallelBars, type ShapeAnnotation,
} from '../src/core/shapeMetrics'
import * as shapeMetrics from '../src/core/shapeMetrics'
import { QuantityIndex } from '../src/core/quantityIndex'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0],
  size: 10, opacity: .8, showCode: true,
}
function fixture(
  id: string,
  options: Partial<CountFixture> = {},
): CountFixture {
  return {
    id, name: id, code: id, category: '例', order: 0, style,
    kind: 'area', method: 'polygon', ...options,
  }
}
function annotation(
  id: string,
  itemId: string,
  vertices: Array<[number, number]>,
  mark: Partial<QuantityMark> = {},
): ShapeAnnotation {
  return {
    id, pageIndex: 2, vertices, measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1, id, itemId, method: 'polygon',
      floor: '2階', room: '居室', condition: '例', ...mark,
    },
  }
}
const rectangle: Array<[number, number]> = [[0, 0], [4, 0], [4, 3], [0, 3]]
const lShape: Array<[number, number]> =
  [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]]
const hole: Array<[number, number]> = [[1, 1], [2, 1], [2, 2], [1, 2]]

it('collects scaled rectangle, L shape and hole areas with exterior perimeters', () => {
  const fixtures = [fixture('A'), fixture('L'), fixture('H')]
  const scaled = annotation('a', 'A', [[0, 0], [400, 0], [400, 300], [0, 300]])
  scaled.measure = { mmPerPoint: 10 }
  const result = collectShapeMetrics([
    scaled,
    annotation('l', 'L', lShape),
    annotation('h', 'H', rectangle, { holes: [hole] }),
  ], fixtures, new Set(['A', 'L', 'H']))

  expect(result.get('A')![0]).toMatchObject({
    annotationId: 'a', pageIndex: 2, floor: '2階', room: '居室',
    condition: '例', count: 1, areaM2: 12, grossAreaM2: 12,
    perimeterM: 14, lengthM: 0, polygonM: { outer: rectangle, holes: [] },
  })
  expect(result.get('L')![0]).toMatchObject({ areaM2: 6, perimeterM: 14 })
  expect(result.get('H')![0]).toMatchObject({
    areaM2: 11, grossAreaM2: 12, perimeterM: 14,
    polygonM: { holes: [hole] },
  })
})

it('uses current opening deductions and retains area when polygon depth is zero', () => {
  const opening = fixture('O', {
    kind: 'count', method: 'click', opening: { widthM: 2, heightM: 1 },
  })
  const wall = annotation('w', 'W', [[0, 0], [5, 0]], {
    method: 'lengthHeight', heightM: 3,
    openings: [{ itemId: 'O', count: 2 }],
  })
  const result = collectShapeMetrics([
    wall,
    annotation('p', 'P', rectangle, {
      method: 'polygonDepth', depthM: 0, holes: [hole],
    }),
  ], [
    fixture('W', { method: 'lengthHeight' }),
    fixture('P', { kind: 'volume', method: 'polygonDepth' }),
    opening,
  ], new Set(['W', 'P']))
  expect(result.get('W')![0]).toMatchObject({
    lengthM: 5, perimeterM: 5, heightM: 3, grossAreaM2: 15, areaM2: 11,
  })
  expect(result.get('P')![0]).toMatchObject({
    areaM2: 11, grossAreaM2: 12, depthM: 0,
  })
})

it('ignores unrequested, deleted and linked pickups', () => {
  const deleted = annotation('deleted', 'A', rectangle)
  deleted.deleted = true
  const result = collectShapeMetrics([
    annotation('a', 'A', rectangle), deleted,
    annotation('b', 'B', rectangle),
    annotation('linked', 'C', rectangle),
  ], [
    fixture('A'), fixture('B'),
    fixture('C', { link: { kind: 'factor', sources: [] } }),
  ], new Set(['A', 'C']))
  expect([...result.keys()]).toEqual(['A'])
  expect(result.get('A')).toHaveLength(1)
})

it('retains route multiplicity and groups counted portions by condition', () => {
  const route = annotation('r', 'R', [[0, 0], [4, 0]], {
    method: 'polyline', count: 3, condition: undefined,
    rises: [{ m: 2 }], slackM: 1,
    cond: { plan: '露出', rise: '露出', slack: null },
    extra: [{ itemId: 'E', count: 2, cond: { plan: null, slack: null } }],
  })
  const result = collectShapeMetrics([route], [
    fixture('R', { kind: 'length', method: 'polyline' }),
    fixture('E', { kind: 'length', method: 'polyline' }),
  ], new Set(['R', 'E']))
  expect(result.get('R')![0]).toMatchObject({
    count: 3, lengthM: 6, perimeterM: 6, condition: '露出',
  })
  expect(result.get('E')![0]).toMatchObject({ count: 2, lengthM: 2 })
})

it('clips rectangle bars at both boundaries without floating-point extra bars', () => {
  const polygon = { outer: rectangle, holes: [] }
  expect(clipParallelBars(polygon, 'x', .2)).toEqual(Array(16).fill(4))
  expect(clipParallelBars(polygon, 'y', .2)).toEqual(Array(21).fill(3))
  expect(clipParallelBars(polygon, 'x', .8)).toEqual(Array(5).fill(4))
  expect(clipParallelBars({
    outer: [[0, 0], [.6, 0], [.6, .6], [0, .6]], holes: [],
  }, 'x', .2)).toHaveLength(4)
})

it('clips concave exterior shapes and splits bars crossing holes', () => {
  expect(clipParallelBars({ outer: lShape, holes: [] }, 'x', 1))
    .toEqual([4, 4, 1, 1])
  expect(clipParallelBars({ outer: rectangle, holes: [hole] }, 'x', 1.5))
    .toEqual([4, 1, 2, 4])
  expect(clipParallelBars({
    outer: [...rectangle].reverse(), holes: [[...hole].reverse()],
  }, 'x', 1.5)).toEqual([4, 1, 2, 4])
})

it('handles translated polygons and repeated closing vertices', () => {
  const outer: Array<[number, number]> =
    [[10, 20], [14, 20], [14, 23], [10, 23], [10, 20]]
  expect(clipParallelBars({ outer, holes: [] }, 'x', .2)).toEqual(Array(16).fill(4))
  expect(() => clipParallelBars({ outer, holes: [] }, 'x', 0)).toThrow()
  expect(clipParallelBars({ outer: [], holes: [] }, 'x', .2)).toEqual([])
})

it('never collects metrics for ordinary documents, RC-only items or legacy links', () => {
  const spy = vi.spyOn(shapeMetrics, 'collectShapeMetrics')
  try {
    const area = annotation('a', 'A', rectangle)
    const ordinary = fixture('A')
    expect(QuantityIndex.build([area], [ordinary]).total('A')).toBe(12)
    expect(QuantityIndex.build([area], [{
      ...ordinary, rc: { kind: 'slab', thicknessMm: 150, bars: [] },
    }]).total('A')).toBe(12)
    const index = QuantityIndex.build([area], [
      ordinary,
      fixture('F', { link: { kind: 'factor', sources: [{ itemId: 'A', factor: 2 }] } }),
    ])
    expect(index.total('F')).toBe(24)
    expect(spy).not.toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
})

it('collects once for geometry links and supports a one-shot annotation iterator', () => {
  const spy = vi.spyOn(shapeMetrics, 'collectShapeMetrics')
  try {
    const fixtures = [
      fixture('A'),
      fixture('Unused'),
      fixture('P', {
        kind: 'length', method: 'polyline',
        link: { kind: 'shape', sources: [{ itemId: 'A' }], shape: { output: 'perimeter' } },
      }),
      fixture('Auto', {
        link: {
          kind: 'shape', sources: [], auto: { nameIncludes: ['A'] },
          shape: { output: 'area' },
        },
      }),
    ]
    function* annotations(): Generator<ShapeAnnotation> {
      yield annotation('a', 'A', rectangle)
      yield annotation('u', 'Unused', rectangle)
    }
    const index = QuantityIndex.build(annotations(), fixtures)
    expect(index.total('A')).toBe(12)
    expect(index.total('Unused')).toBe(12)
    expect(index.total('P')).toBe(14)
    expect(index.total('Auto')).toBe(12)
    expect(index.byFloor('P').get('2階')).toBe(14)
    expect(spy).toHaveBeenCalledTimes(1)
    const requested = spy.mock.calls[0][2]
    expect([...requested]).toEqual(['A'])
  } finally {
    spy.mockRestore()
  }
})
