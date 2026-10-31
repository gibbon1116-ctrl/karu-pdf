import { expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import { buildQuantityTableData } from '../src/app/QuantityTable'

it('reports build time for 2000 pickups including 1000 routes, three members and two rises (no time assertion)', () => {
  const style = nextCountStyle([])
  const fixtures: CountFixture[] = ['cv', 'pf', 'rack', 'led'].map((id, order) => ({
    id, order, code: id, name: id, category: '電気', kind: id === 'led' ? 'count' : 'length', style, conditions: ['ラック', '管内'],
  }))
  const routes = Array.from({ length: 1000 }, (_, i) => ({
    id: 'r' + i, pageIndex: i % 100, vertices: [[0, 0], [10, 0]] as [number, number][], measure: { mmPerPoint: 1000 },
    quantity: { version: 1 as const, id: 'r' + i, itemId: 'cv', method: 'polyline' as const, rises: [{ m: 2 }, { m: 3 }],
      floor: `${i % 10 + 1}階`, room: `部屋${i % 30}`, cond: { plan: 'ラック', rise: '管内' },
      extra: [{ itemId: 'pf', count: 1, cond: { plan: '管内', rise: '管内' } }, { itemId: 'rack', count: 1, cond: { plan: 'ラック', rise: 'ラック' } }] },
  }))
  const counts = Array.from({ length: 1000 }, (_, i) => ({ id: 'c' + i, pageIndex: i % 100,
    count: { version: 2 as const, id: 'c' + i, fixtureId: 'led', condition: i % 2 ? '管内' : undefined } }))
  const index = QuantityIndex.build([...routes, ...counts], fixtures)
  expect(fixtures.reduce((n, f) => n + index.entries(f.id).length, 0)).toBe(10000)
  buildQuantityTableData(index, fixtures) // Warm-up excludes index construction and assertions.
  const times: number[] = []
  for (let i = 0; i < 9; i++) {
    const start = performance.now(), data = buildQuantityTableData(index, fixtures)
    times.push(performance.now() - start)
    expect(data.map(item => item.total)).toEqual([15000, 15000, 15000, 1000])
  }
  const median = [...times].sort((a, b) => a - b)[4]
  console.log('SPEC-07d buildQuantityTableData ms: ' + JSON.stringify({ node: process.version, pickups: 2000, entries: 10000, times, median, max: Math.max(...times), within50ms: median <= 50 }))
})
