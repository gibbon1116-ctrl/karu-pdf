import { expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import { buildQuantityTableData } from '../src/app/QuantityTable'

it('measures buildQuantityTableData for 1000 fixtures / 100 pages / 10000 index entries', () => {
  // Match the existing quantityTable.test.ts benchmark, excluding projection.
  const fixtures: CountFixture[] = Array.from({ length: 1000 }, (_, i) => ({
    id: 'f' + i, code: ('f' + i).toUpperCase(), name: `f${i}の名称`, order: i,
    category: '電気', kind: 'count', style: nextCountStyle([]),
  }))
  const index = QuantityIndex.build(Array.from({ length: 10000 }, (_, i) => ({
    id: String(i), pageIndex: (i % 100 + Math.floor(i / 1000) * 7) % 100,
    count: { version: 2 as const, id: String(i), fixtureId: 'f' + (i % 1000),
      floor: `${i % 10 + 1}階`, room: `部屋${i % 30}` },
  })), fixtures)
  buildQuantityTableData(index, fixtures)
  const times: number[] = []
  for (let i = 0; i < 9; i++) {
    const start = performance.now(), data = buildQuantityTableData(index, fixtures)
    times.push(performance.now() - start)
    expect(data).toHaveLength(1000)
    expect(data.find(item => item.fixture.id === 'f0')!.total).toBe(10)
  }
  const median = [...times].sort((a, b) => a - b)[4]
  console.log('SPEC-07d-2 buildQuantityTableData 1000 fixtures / 100 pages / 10000 entries ms: '
    + JSON.stringify({ node: process.version, times, median }))
})
