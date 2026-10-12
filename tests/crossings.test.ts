import { expect, it, vi } from 'vitest'
import { countSegmentCrossings } from '../src/core/crossings'
import {
  parseCountFixtures, serializeCountFixtures,
  quantityUnit, quantityDecimals, quantityOutputKind, type CountFixture,
} from '../src/core/countFixtures'
import {
  computeLinks, fixtureLinkError, readFixtureLink, type FixtureLink,
} from '../src/core/fixtureLink'
import { QuantityIndex } from '../src/core/quantityIndex'
import * as shapeMetrics from '../src/core/shapeMetrics'
import type { ShapeAnnotation, ShapeMetrics } from '../src/core/shapeMetrics'
import type { QuantityMark } from '../src/core/quantity'

type Path = Array<[number, number]>
const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0],
  size: 10, opacity: .8, showCode: true,
}
function fixture(id: string, options: Partial<CountFixture> = {}): CountFixture {
  return { id, name: id, code: id, category: '例', style, order: 0, ...options }
}
function line(id: string, name = id): CountFixture {
  return fixture(id, { name, kind: 'length', method: 'polyline' })
}
function link(
  settings: NonNullable<FixtureLink['crossing']> = {},
  options: Partial<FixtureLink> = {},
): CountFixture {
  return fixture('L', {
    link: {
      kind: 'crossing', sources: [{ itemId: 'A' }],
      crossing: settings, ...options,
    },
  })
}
function annotation(
  id: string, itemId: string, vertices: Path, pageIndex = 0,
  options: Partial<QuantityMark> = {},
): ShapeAnnotation {
  return {
    id, pageIndex, vertices, measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1, id, itemId, method: 'polyline',
      floor: '2階', room: '居室', ...options,
    },
  }
}
const route: Path = [[-2, 0], [2, 0]]
const barrier: Path = [[0, -2], [0, 2]]

it('counts proper crossings and excludes parallel lines, endpoints and overlap', () => {
  expect(countSegmentCrossings(route, [barrier])).toBe(1)
  expect(countSegmentCrossings(route, [[[-2, 1], [2, 1]]])).toBe(0)
  expect(countSegmentCrossings(route, [[[0, 0], [0, 2]]])).toBe(0)
  expect(countSegmentCrossings([[0, 0], [2, 0]], [barrier])).toBe(0)
  expect(countSegmentCrossings(route, [[[-1, 0], [1, 0]]])).toBe(0)
  expect(countSegmentCrossings([[0, 0], [0, 0]], [barrier])).toBe(0)
})

it('counts two distinct intersections with one barrier and deduplicates revisits', () => {
  const twice: Path = [[-2, -1], [2, -1], [2, 1], [-2, 1]]
  expect(countSegmentCrossings(twice, [barrier])).toBe(2)
  const revisited: Path = [[-2, 0], [2, 0], [-2, 0]]
  expect(countSegmentCrossings(revisited, [barrier])).toBe(1)
  expect(countSegmentCrossings(route, [barrier, barrier])).toBe(2)
})

it('selects barriers by ID or name, excludes source items and other drawings', () => {
  const fixtures = [
    line('A', '防火区画を通る経路'),
    line('B', '防火区画'),
    line('C', '間仕切'),
    line('D', '防火区画'),
    link({ barrierItemIds: ['C'], barrierNameIncludes: ['防火区画'] }),
  ]
  const index = QuantityIndex.build([
    annotation('a', 'A', route),
    annotation('b', 'B', barrier),
    annotation('c', 'C', [[1, -2], [1, 2]]),
    annotation('d', 'D', barrier, 1),
  ], fixtures)
  expect(index.total('L')).toBe(2)

  const nameOnly = QuantityIndex.build([
    annotation('a', 'A', route),
    annotation('b', 'B', barrier),
    annotation('c', 'C', [[1, -2], [1, 2]]),
  ], [fixtures[0], fixtures[1], fixtures[2], link({
    barrierNameIncludes: ['防火区画'],
  })])
  expect(nameOnly.total('L')).toBe(1)
})

it('adds two rises to one crossing without multiplying route count', () => {
  const pickup = annotation('a', 'A', route, 2, {
    count: 4, rises: [{ m: 2 }, { m: 0 }],
    slackM: 1, cond: { plan: '露出', rise: '露出', slack: '余長' },
  })
  const index = QuantityIndex.build([
    pickup, annotation('b', 'B', barrier, 2),
  ], [
    line('A'), line('B'),
    link({ barrierItemIds: ['B'], includeRises: true }, {
      condition: { mode: 'fixed', value: '固定' },
    }),
  ])
  expect(index.total('L')).toBe(3)
  expect(index.entries('L')).toHaveLength(1)
  expect(index.entries('L')[0]).toMatchObject({
    annotationId: 'a', pageIndex: 2, floor: '2階', room: '居室',
    condition: '露出', value: 3,
  })
  expect(index.byCondition('L').get('露出')!.total).toBe(3)
  expect(index.linkResult('L')!.warnings).toEqual([])
})

it('preserves different plan/rise conditions and applies source condition filters', () => {
  const annotations = [
    annotation('a', 'A', route, 0, {
      rises: [{ m: 2 }, { m: 3 }],
      cond: { plan: '平面条件', rise: ['縦条件', '縦条件'] },
    }),
    annotation('b', 'B', barrier),
  ]
  const fixtures = [line('A'), line('B')]
  const index = QuantityIndex.build(annotations, [
    ...fixtures, link({ barrierItemIds: ['B'], includeRises: true }),
  ])
  expect(index.total('L')).toBe(3)
  expect(index.byCondition('L').get('平面条件')!.total).toBe(1)
  expect(index.byCondition('L').get('縦条件')!.total).toBe(2)

  const filtered = QuantityIndex.build(annotations, [
    ...fixtures, link({ barrierItemIds: ['B'], includeRises: true }, {
      sources: [{ itemId: 'A', conditions: ['縦条件'] }],
    }),
  ])
  expect(filtered.total('L')).toBe(2)
})

it('can count only rises and does not read barrier metrics in that mode', () => {
  const routeMetric: ShapeMetrics = {
    itemId: 'A', annotationId: 'a', pageIndex: 0, method: 'polyline',
    count: 9, areaM2: 0, grossAreaM2: 0, perimeterM: 4, lengthM: 4,
    pathPoints: route, riseCount: 2,
  }
  const metricsOf = vi.fn((id: string) => id === 'A' ? [routeMetric] : [])
  const result = computeLinks([
    line('A'), line('B'),
    link({ barrierItemIds: ['B'], includeRises: true, planCrossings: false }),
  ], () => [], metricsOf).get('L')!
  expect(result.total).toBe(2)
  expect(metricsOf.mock.calls.map(call => call[0])).toEqual(['A'])
})

it('closes polygon barriers in PDF coordinates and needs no drawing scale', () => {
  const pickup = annotation('a', 'A', [[-1, 1], [1, 1]])
  const boundary = annotation('b', 'B', [[0, 0], [2, 0], [2, 2], [0, 2]], 0, {
    method: 'polygon',
  })
  pickup.measure = null
  boundary.measure = null
  const fixtures = [
    line('A'), fixture('B', { kind: 'area', method: 'polygon' }),
    link({ barrierItemIds: ['B'] }),
  ]
  const index = QuantityIndex.build([pickup, boundary], fixtures)
  expect(index.total('L')).toBe(1)

  const metrics = shapeMetrics.collectShapeMetrics(
    [pickup, boundary], fixtures, new Set(['A', 'B']), new Set(['A', 'B']),
  )
  expect(metrics.get('B')![0].pathPoints)
    .toEqual([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])
})

it('counts physical rises and paths even when ordinary length portions are excluded', () => {
  const index = QuantityIndex.build([
    annotation('a', 'A', route, 0, {
      count: 5, rises: [{ m: 0 }, { m: 2 }],
      cond: { plan: null, rise: null, slack: null },
    }),
    annotation('b', 'B', barrier),
  ], [
    line('A'), line('B'),
    link({ barrierItemIds: ['B'], includeRises: true }),
  ])
  expect(index.total('A')).toBe(0)
  expect(index.total('L')).toBe(3)
})

it('round-trips crossing settings, copies arrays and validates configuration', () => {
  const original = link({
    barrierItemIds: ['B'], barrierNameIncludes: ['防火区画'],
    includeRises: true, planCrossings: false,
  })
  const copied = readFixtureLink(original)!
  expect(copied).toEqual(original.link)
  expect(copied.crossing!.barrierItemIds).not.toBe(original.link!.crossing!.barrierItemIds)
  expect(copied.crossing!.barrierNameIncludes)
    .not.toBe(original.link!.crossing!.barrierNameIncludes)
  expect(parseCountFixtures(serializeCountFixtures([original]))[0].link)
    .toEqual(original.link)
  expect(quantityUnit(original)).toBe('か所')
  expect(quantityDecimals(original)).toBe(0)
  expect(quantityOutputKind(original)).toBe('count')

  for (const invalid of [
    { kind: 'crossing', sources: [] },
    { kind: 'crossing', sources: [], crossing: { includeRises: 1 } },
    { kind: 'crossing', sources: [], crossing: { planCrossings: null } },
    { kind: 'crossing', sources: [], crossing: { barrierItemIds: ['B', 'B'] } },
    { kind: 'crossing', sources: [], crossing: { barrierNameIncludes: [''] } },
    { kind: 'factor', sources: [], crossing: {} },
  ]) {
    expect(fixtureLinkError({ id: 'L', link: invalid as FixtureLink })).toBeDefined()
  }
})

it('does not collect geometry for barrier-only documents or ordinary factor links', () => {
  const spy = vi.spyOn(shapeMetrics, 'collectShapeMetrics')
  try {
    const pickup = annotation('a', 'A', route)
    const fixtures = [line('A'), line('B', '防火区画')]
    QuantityIndex.build([pickup], fixtures)
    QuantityIndex.build([pickup], [
      ...fixtures, fixture('F', {
        kind: 'length',
        link: { kind: 'factor', sources: [{ itemId: 'A' }] },
      }),
    ])
    expect(spy).not.toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
})

it('preserves existing shape-link results when supplemental crossing geometry is collected', () => {
  const fixtures = [
    line('A'), line('B'),
    fixture('S', {
      kind: 'length',
      link: {
        kind: 'shape', shape: { output: 'perimeter' },
        sources: [{ itemId: 'A' }],
      },
    }),
  ]
  const annotations = [
    annotation('a', 'A', route, 0, { cond: { plan: null } }),
    annotation('b', 'B', barrier),
  ]
  const before = QuantityIndex.build(annotations, fixtures)
  const after = QuantityIndex.build(annotations, [
    ...fixtures, link({ barrierItemIds: ['B'] }),
  ])
  expect(after.linkResult('S')).toEqual(before.linkResult('S'))
  expect(after.total('L')).toBe(1)
})
