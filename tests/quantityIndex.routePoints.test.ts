import { describe, expect, it, vi } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityMark, RoutePoint } from '../src/core/quantity'

vi.mock('../src/core/countFixtures', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/countFixtures')>()
  return {
    ...actual,
    quantityMethod: (fixture: { id: string }) =>
      fixture.id === 'cable' || fixture.id === 'length' ? 'polyline' : 'click',
    fixtureOpeningSize: () => () => undefined,
  }
})

// 既存の連動計算とは切り離し、手入力の点が連動項目へ混入しないことを検査する。
vi.mock('../src/core/fixtureLink', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/fixtureLink')>()
  return {
    ...actual,
    computeLinks: (fixtures: readonly CountFixture[]) => new Map(
      fixtures.filter(fixture => fixture.link !== undefined).map(fixture => [
        fixture.id, { entries: [], total: 0 },
      ]),
    ),
    fixtureLinkRoundsUp: () => false,
  }
})

import { QuantityIndex } from '../src/core/quantityIndex'

const fixtures = [
  { id: 'cable' },
  { id: 'fire' },
  { id: 'length' },
  { id: 'linked', link: { sources: [] } },
] as CountFixture[]

function annotation(
  id: string,
  pageIndex: number,
  points?: RoutePoint[],
  floor = '1階',
  room = '廊下',
) {
  const quantity: QuantityMark = {
    version: 1, id, itemId: 'cable', method: 'polyline', floor, room,
    ...(points !== undefined ? { points } : {}),
  }
  return {
    id, pageIndex, quantity,
    vertices: [[0, 0], [10, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
  }
}

describe('QuantityIndex の頂点の個数', () => {
  it('合計・ページ・階・室・施工条件へ入り、個数の印の一覧には入らない', () => {
    const index = QuantityIndex.build([
      annotation('a', 0, [
        { itemId: 'fire', at: 0, count: 2, condition: '壁' },
        { itemId: 'fire', at: 999, count: 3, condition: '床' },
      ]),
      annotation('b', 1, [
        { itemId: 'fire', at: 1, count: 4, condition: '壁' },
        { itemId: 'fire', at: 0, count: 1 },
      ], '2階', '機械室'),
    ], fixtures)

    expect(index.total('fire')).toBe(10)
    expect(index.rawTotal('fire')).toBe(10)
    expect([...index.byPage('fire')]).toEqual([[0, 5], [1, 5]])
    expect([...index.byFloor('fire')]).toEqual([['1階', 5], ['2階', 5]])
    expect([...index.byRoom('fire')]).toEqual([['廊下', 5], ['機械室', 5]])
    expect(index.byFloorRoom('fire').get('2階')?.get('機械室')).toBe(5)

    const conditions = index.byCondition('fire')
    expect(conditions.get('壁')).toMatchObject({
      plan: 0, rise: 0, slack: 0, other: 6, total: 6, raw: 6,
    })
    expect(conditions.get('壁')?.annotationIds).toEqual(new Set(['a', 'b']))
    expect(conditions.get('床')?.total).toBe(3)
    expect(conditions.get('')?.total).toBe(1)
    expect(index.entries('fire')).toContainEqual({
      itemId: 'fire', annotationId: 'a', pageIndex: 0,
      value: 3, floor: '1階', room: '廊下', condition: '床',
    })
    for (const entry of index.entries('fire')) {
      expect(entry).not.toHaveProperty('part')
      expect(entry).not.toHaveProperty('routeCount')
    }
    expect(index.countEntriesOnPage(0)).toEqual([])
    expect(index.countEntriesOnPage(1)).toEqual([])
    expect(index.total('cable')).toBe(20)
  })

  it('連動・長さ・存在しない項目の点を数えない', () => {
    const index = QuantityIndex.build([
      annotation('a', 0, [
        { itemId: 'linked', at: 0, count: 9 },
        { itemId: 'length', at: 0, count: 8 },
        { itemId: 'missing', at: 0, count: 7 },
        { itemId: 'fire', at: 0, count: 2 },
      ]),
    ], fixtures)

    expect(index.total('fire')).toBe(2)
    expect(index.entries('linked')).toEqual([])
    expect(index.entries('length')).toEqual([])
    expect(index.entries('missing')).toEqual([])
    expect(index.total('cable')).toBe(10)
  })

  it('削除した経路の点を数えない', () => {
    const index = QuantityIndex.build([
      {
        ...annotation('deleted', 0, [{ itemId: 'fire', at: 1, count: 2 }]),
        deleted: true,
      },
    ], fixtures)
    expect(index.total('fire')).toBe(0)
    expect(index.entries('fire')).toEqual([])
  })

  it('点がない経路では既存の長さ集計を保つ', () => {
    const index = QuantityIndex.build([annotation('a', 0)], fixtures)
    expect(index.total('cable')).toBe(10)
    expect(index.total('fire')).toBe(0)
    expect(index.entries('fire')).toEqual([])
    expect(index.countEntriesOnPage(0)).toEqual([])
  })

  it('経路以外の points は数えない', () => {
    const area = annotation('area', 0, [{ itemId: 'fire', at: 0, count: 2 }])
    area.quantity.method = 'polygon'
    const index = QuantityIndex.build([area], fixtures)
    expect(index.total('fire')).toBe(0)
    expect(index.entries('fire')).toEqual([])
  })
})
