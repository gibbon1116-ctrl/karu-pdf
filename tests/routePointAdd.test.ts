import { describe, expect, it } from 'vitest'
import { nextRoutePointAt } from '../src/core/routePointAdd'

describe('nextRoutePointAt', () => {
  it('使っていない最初の中間頂点を選ぶ', () => {
    expect(nextRoutePointAt([], 4, 'fire')).toBe(1)
    expect(nextRoutePointAt([
      { itemId: 'other', at: 1, count: 1 },
    ], 4, 'fire')).toBe(2)
  })

  it('中間頂点がなければ終点を選ぶ', () => {
    expect(nextRoutePointAt([], 2, 'fire')).toBe(1)
    expect(nextRoutePointAt([
      { itemId: 'fire', at: 1, count: 1 },
    ], 3, 'fire')).toBe(2)
  })

  it('終点の別項目とは共存できる', () => {
    expect(nextRoutePointAt([
      { itemId: 'other', at: 1, count: 1 },
    ], 2, 'fire')).toBe(1)
  })

  it('同じ項目・終点の重複を作らない', () => {
    expect(nextRoutePointAt([
      { itemId: 'fire', at: 1, count: 1 },
      { itemId: 'fire', at: 2, count: 1 },
    ], 3, 'fire')).toBeUndefined()
  })

  it('終点に同じ項目があっても、未使用の中間頂点には足せる', () => {
    expect(nextRoutePointAt([
      { itemId: 'fire', at: 3, count: 1 },
    ], 4, 'fire')).toBe(1)
  })

  it('経路でない頂点数を受け付けない', () => {
    for (const count of [0, 1, 1.5, Number.NaN]) {
      expect(nextRoutePointAt([], count, 'fire')).toBeUndefined()
    }
  })
})
