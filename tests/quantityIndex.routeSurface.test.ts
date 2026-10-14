import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityMark, RouteExtra } from '../src/core/quantity'
import { QuantityIndex } from '../src/core/quantityIndex'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [0, 0, 1],
  size: 10, opacity: 1, showCode: true,
}
const duct: CountFixture = {
  id: 'duct', name: '長方形ダクト', code: 'SD', category: 'ダクト', order: 0,
  kind: 'length', method: 'polyline', spec: '500×300', style,
  convert: { factor: 1.6, unit: '㎡', basis: '周長' },
}
const insulation: CountFixture = {
  id: 'insulation', name: 'ダクト保温', code: 'GW', category: '保温', order: 1,
  kind: 'area', method: 'lengthHeight', defaults: { heightM: 99 }, style,
}

function route(
  extra: RouteExtra[] = [{ itemId: 'insulation', count: 1, perM: 1.6 }],
  change: Partial<QuantityMark> = {},
) {
  return {
    id: 'route', pageIndex: 0,
    quantity: {
      version: 1, id: 'route', itemId: 'duct', method: 'polyline',
      floor: '1階', room: '機械室', extra, ...change,
    } as QuantityMark,
    vertices: [[0, 0], [10, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
  }
}

describe('QuantityIndex の面積の線要素', () => {
  it('10m × 周長1.6mを16㎡として集計し、条数と周長を保持する', () => {
    const index = QuantityIndex.build([route()], [duct, insulation])
    expect(index.total('insulation')).toBe(16)
    expect(index.rawTotal('insulation')).toBe(16)
    expect(index.entries('insulation')).toContainEqual(expect.objectContaining({
      annotationId: 'route', pageIndex: 0, itemId: 'insulation',
      part: 'plan', value: 16, routeCount: 1, routePerM: 1.6,
    }))
    expect([...index.byPage('insulation')]).toEqual([[0, 16]])
    expect([...index.byFloor('insulation')]).toEqual([['1階', 16]])
    expect([...index.byRoom('insulation')]).toEqual([['機械室', 16]])
    expect(index.byFloorRoom('insulation').get('1階')?.get('機械室')).toBe(16)
    expect(index.total('duct')).toBe(16)
    expect(index.rawTotal('duct')).toBe(10)
  })

  it('立上り2mを含めると19.2㎡になる', () => {
    const index = QuantityIndex.build([
      route(undefined, { rises: [{ m: 2 }] }),
    ], [duct, insulation])
    expect(index.total('insulation')).toBeCloseTo(19.2)
    expect(index.byCondition('insulation').get('')).toMatchObject({
      plan: 16, rise: 3.2, slack: 0,
    })
  })

  it('施工条件で立上りを除外すると16㎡になる', () => {
    const index = QuantityIndex.build([
      route([{
        itemId: 'insulation', count: 1, perM: 1.6,
        cond: { plan: '屋内', rise: null },
      }], { rises: [{ m: 2 }] }),
    ], [duct, insulation])
    expect(index.total('insulation')).toBe(16)
    expect(index.byCondition('insulation').get('屋内')?.total).toBe(16)
    expect(index.entries('insulation').every(entry => entry.part === 'plan')).toBe(true)
  })

  it('条数2なら32㎡になる', () => {
    const index = QuantityIndex.build([
      route([{ itemId: 'insulation', count: 2, perM: 1.6 }]),
    ], [duct, insulation])
    expect(index.total('insulation')).toBe(32)
    expect(index.entries('insulation')[0].routeCount).toBe(2)
  })

  it('周長がなければ0で、ページ・階・室との関係を保つ', () => {
    const index = QuantityIndex.build([
      route([{ itemId: 'insulation', count: 1 }]),
    ], [duct, insulation])
    expect(index.total('insulation')).toBe(0)
    expect(index.rawTotal('insulation')).toBe(0)
    expect([...index.byPage('insulation')]).toEqual([[0, 0]])
    expect([...index.byFloor('insulation')]).toEqual([['1階', 0]])
    expect([...index.byRoom('insulation')]).toEqual([['機械室', 0]])
    expect(index.entries('insulation').every(entry => entry.value === 0)).toBe(true)
    expect(index.entries('insulation')[0]).not.toHaveProperty('routePerM')
  })

  it('すべて除外された経路でも0の所在地を保つ', () => {
    const index = QuantityIndex.build([
      route([{
        itemId: 'insulation', count: 1,
        cond: { plan: null, rise: null, slack: null },
      }]),
    ], [duct, insulation])
    expect(index.entries('insulation')).toEqual([])
    expect([...index.byPage('insulation')]).toEqual([[0, 0]])
    expect([...index.byFloor('insulation')]).toEqual([['1階', 0]])
    expect([...index.byRoom('insulation')]).toEqual([['機械室', 0]])
  })

  it('その他の加算と立上りごとの施工条件も同じ規則で数える', () => {
    const index = QuantityIndex.build([
      route([{
        itemId: 'insulation', count: 1, perM: 1.6,
        cond: { plan: '屋内', rise: [null, '屋外'], slack: '屋内' },
      }], { rises: [{ m: 2 }, { m: 3 }], slackM: 1 }),
    ], [duct, insulation])
    expect(index.total('insulation')).toBeCloseTo(22.4)
    expect(index.byCondition('insulation').get('屋内')).toMatchObject({
      plan: 16, rise: 0, slack: 1.6,
    })
    expect(index.byCondition('insulation').get('屋外')?.total).toBeCloseTo(4.8)
  })

  it('面積の項目自身の換算を既存のadd処理で掛ける', () => {
    const converted: CountFixture = {
      ...insulation,
      convert: { factor: 2, unit: '㎡', basis: '換算' },
    }
    const index = QuantityIndex.build([route()], [duct, converted])
    expect(index.rawTotal('insulation')).toBe(16)
    expect(index.total('insulation')).toBe(32)
    expect(index.entries('insulation')[0]).toMatchObject({ raw: 16, value: 32 })
  })

  it('polygonの面積項目も経路の長さから数える', () => {
    const index = QuantityIndex.build([route()], [
      duct, { ...insulation, method: 'polygon' },
    ])
    expect(index.total('insulation')).toBe(16)
  })

  it('面積の項目を主としては数えない', () => {
    const index = QuantityIndex.build([
      route([], { itemId: 'insulation' }),
    ], [duct, insulation])
    expect(index.entries('insulation')).toEqual([])
    expect(index.total('insulation')).toBe(0)
  })

  it('削除された経路を数えない', () => {
    const index = QuantityIndex.build([
      { ...route(), deleted: true },
    ], [duct, insulation])
    expect(index.total('insulation')).toBe(0)
    expect(index.entries('insulation')).toEqual([])
  })

  it('面積の線要素がない経路の長さ・溝の計算を保つ', () => {
    const cable: CountFixture = {
      ...duct, id: 'cable', name: 'ケーブル', convert: undefined,
    }
    const trench: CountFixture = {
      ...duct, id: 'trench', name: '溝', kind: 'volume',
      method: 'lengthWidthDepth', convert: undefined,
      defaults: { widthM: 0.5, depthM: 0.2 },
    }
    const index = QuantityIndex.build([
      route([
        { itemId: 'cable', count: 2, perM: 2 },
        { itemId: 'trench', count: 1 },
      ], { rises: [{ m: 2 }], slackM: 1 }),
    ], [duct, cable, trench, insulation])
    expect(index.rawTotal('duct')).toBe(13)
    expect(index.total('duct')).toBeCloseTo(20.8)
    expect(index.total('cable')).toBe(52)
    expect(index.total('trench')).toBe(1)
    expect(index.entries('insulation')).toEqual([])
  })

  it('経路以外の面積拾いは従来の計算を保つ', () => {
    const area = route([], {
      itemId: 'insulation', method: 'lengthHeight', heightM: 2,
    })
    const index = QuantityIndex.build([area], [duct, insulation])
    expect(index.total('insulation')).toBe(20)
    expect(index.entries('insulation')[0]).not.toHaveProperty('routeCount')
  })
})
