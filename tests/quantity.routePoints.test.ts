import { describe, expect, it } from 'vitest'
import {
  parseQuantityMark, serializeQuantityMark, validRoutePoints,
  type QuantityMark, type RoutePoint,
} from '../src/core/quantity'

const route = (): QuantityMark => ({
  version: 1, id: 'route', itemId: 'cable', method: 'polyline', cond: {},
})
const point = (): RoutePoint => ({
  itemId: 'fire', at: 1, count: 2, condition: '壁',
})

describe('経路の頂点の個数の保存形式', () => {
  it('parse と serialize で往復し、余計なキーを捨てる', () => {
    const supplied = [{ ...point(), ignored: '捨てる' }]
    const mark = { ...route(), points: supplied }
    const raw = serializeQuantityMark(mark)
    expect(JSON.parse(raw).points).toEqual([point()])
    expect(parseQuantityMark(raw)).toEqual({ ...route(), points: [point()] })

    const parsed = parseQuantityMark(JSON.stringify(mark))
    expect(parsed?.points).toEqual([point()])
    expect(parsed?.points?.[0]).not.toHaveProperty('ignored')
  })

  it('点のない経路と空配列は points を保存しない', () => {
    expect(JSON.parse(serializeQuantityMark(route()))).not.toHaveProperty('points')
    expect(JSON.parse(serializeQuantityMark({ ...route(), points: [] })))
      .not.toHaveProperty('points')
    expect(parseQuantityMark(serializeQuantityMark(route()))).toEqual(route())
  })

  it.each([
    null,
    {},
    [null],
    [undefined],
    [{ ...point(), itemId: '' }],
    [{ ...point(), itemId: 'x'.repeat(81) }],
    [{ ...point(), at: -1 }],
    [{ ...point(), at: 1.5 }],
    [{ ...point(), at: '1' }],
    [{ ...point(), count: 0 }],
    [{ ...point(), count: 100 }],
    [{ ...point(), count: 1.5 }],
    [{ ...point(), condition: '' }],
    [{ ...point(), condition: ' 壁' }],
    [{ ...point(), condition: '壁\n床' }],
    [{ ...point(), condition: 'x'.repeat(31) }],
  ])('不正な points を捨てて印を残し、serialize は拒否する: %j', value => {
    const parsed = parseQuantityMark(JSON.stringify({ ...route(), points: value }))
    expect(parsed).toEqual(route())
    expect(validRoutePoints(value)).toBe(false)
    expect(() => serializeQuantityMark({
      ...route(), points: value as unknown as RoutePoint[],
    })).toThrow(Error)
  })

  it('疎な配列も拒否する', () => {
    const points = Array<RoutePoint>(1)
    expect(validRoutePoints(points)).toBe(false)
    expect(() => serializeQuantityMark({ ...route(), points })).toThrow(Error)
  })

  it('経路以外では不正な points も含めて無視する', () => {
    const mark: QuantityMark = {
      version: 1, id: 'area', itemId: 'wall', method: 'polygon',
      points: [point()],
    }
    expect(parseQuantityMark(JSON.stringify(mark))).not.toHaveProperty('points')
    expect(JSON.parse(serializeQuantityMark(mark))).not.toHaveProperty('points')
    expect(JSON.parse(serializeQuantityMark({
      ...mark, points: null as unknown as RoutePoint[],
    }))).not.toHaveProperty('points')
  })

  it('50件を許可し、51件は拒否する', () => {
    const points = Array.from({ length: 50 }, (_, at) => ({
      itemId: 'fire', at, count: 1,
    }))
    expect(validRoutePoints(points)).toBe(true)
    expect(parseQuantityMark(serializeQuantityMark({ ...route(), points }))?.points)
      .toEqual(points)

    const tooMany = [...points, { itemId: 'fire', at: 50, count: 1 }]
    expect(validRoutePoints(tooMany)).toBe(false)
    expect(parseQuantityMark(JSON.stringify({ ...route(), points: tooMany })))
      .toEqual(route())
    expect(() => serializeQuantityMark({ ...route(), points: tooMany })).toThrow(Error)
  })

  it('同じ項目と頂点の組は施工条件が違っても重複できない', () => {
    const points = [point(), { ...point(), condition: '床' }]
    expect(validRoutePoints(points)).toBe(false)
    expect(parseQuantityMark(JSON.stringify({ ...route(), points }))).toEqual(route())
    expect(() => serializeQuantityMark({ ...route(), points })).toThrow(Error)
  })

  it('同じ項目の別頂点と、同じ頂点の別項目は許可する', () => {
    const points = [
      point(),
      { ...point(), at: 2 },
      { ...point(), itemId: 'fitting' },
    ]
    expect(validRoutePoints(points)).toBe(true)
    expect(parseQuantityMark(serializeQuantityMark({ ...route(), points }))?.points)
      .toEqual(points)
  })

  it('項目ID・数・施工条件の境界値と範囲外の頂点番号を保持する', () => {
    const points = [{
      itemId: 'x'.repeat(80), at: 999, count: 99, condition: 'あ'.repeat(30),
    }]
    expect(validRoutePoints(points)).toBe(true)
    expect(parseQuantityMark(serializeQuantityMark({ ...route(), points }))?.points)
      .toEqual(points)
    expect(validRoutePoints([{ itemId: 'x', at: 0, count: 1 }])).toBe(true)
  })
})
