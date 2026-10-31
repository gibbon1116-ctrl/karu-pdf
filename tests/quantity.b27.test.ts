import { describe, expect, it } from 'vitest'
import {
  parseQuantityMark,
  quantityLabel,
  routeMembers,
  serializeQuantityMark,
  validRoutePerM,
  type QuantityMark,
} from '../src/core/quantity'

const mark: QuantityMark = {
  version: 1,
  id: 'route',
  itemId: 'column',
  method: 'polyline',
  extra: [{ itemId: 'spiral', count: 1, perM: 18.85 }],
}

describe('SPEC-B27: 線要素のperM保存', () => {
  it('小数3桁、下限・上限を検査する', () => {
    for (const value of [0.001, 1, 18.85, 10000]) {
      expect(validRoutePerM(value)).toBe(true)
    }
    for (const value of [
      0, -1, 0.0001, 18.8501, 10000.001, Infinity, NaN, '18.85', null,
    ]) {
      expect(validRoutePerM(value)).toBe(false)
    }
  })

  it('保存・再読込とrouteMembersでperMを保持する', () => {
    const wire = serializeQuantityMark(mark)
    expect(JSON.parse(wire).extra[0].perM).toBe(18.85)
    const restored = parseQuantityMark(wire)!
    expect(restored.extra).toEqual([
      { itemId: 'spiral', count: 1, cond: {}, perM: 18.85 },
    ])
    expect(routeMembers(restored)[1]).toEqual({
      itemId: 'spiral', count: 1, cond: {}, perM: 18.85,
    })
  })

  it('不正なperMだけを捨て、追加項目は残す', () => {
    for (const value of [0, -1, '18.85', null, 18.8501, 10001]) {
      const parsed = parseQuantityMark(JSON.stringify({
        ...mark,
        extra: [{
          itemId: 'spiral', count: 2, perM: value,
          cond: { plan: '地中埋設', rise: null, slack: null },
        }],
      }))!
      expect(parsed.extra).toEqual([{
        itemId: 'spiral',
        count: 2,
        cond: { plan: '地中埋設', rise: null, slack: null },
      }])
    }
  })

  it('保存時の不正なperMは拒否する', () => {
    for (const value of [0, -1, '18.85', NaN, Infinity, 18.8501, 10001]) {
      const invalid = {
        ...mark, extra: [{ itemId: 'spiral', count: 1, perM: value }],
      } as unknown as QuantityMark
      expect(() => serializeQuantityMark(invalid)).toThrow(
        '1m あたりは0より大きく10000以下、小数3桁までで入れてください。',
      )
    }
  })

  it('追加数・重複・条数を保存時にも拒否する', () => {
    expect(() => serializeQuantityMark({
      ...mark,
      extra: Array.from({ length: 11 }, (_, i) => ({ itemId: `extra${i}`, count: 1 })),
    })).toThrow()
    expect(() => serializeQuantityMark({
      ...mark,
      extra: [{ itemId: 'column', count: 1 }],
    })).toThrow()
    expect(() => serializeQuantityMark({
      ...mark,
      extra: [{ itemId: 'spiral', count: 0 }],
    })).toThrow()
  })

  it('経路の8000文字上限を超えた拾いは読込で捨てる（保存の検査は呼び出し側）', () => {
    const large: QuantityMark = {
      ...mark,
      extra: Array.from({ length: 10 }, (_, i) => ({
        itemId: `extra${i}`,
        count: 1,
        perM: 18.85,
        cond: {
          plan: 'あ'.repeat(30),
          rise: Array.from({ length: 20 }, () => 'い'.repeat(30)),
          slack: 'う'.repeat(30),
        },
      })),
    }
    expect(parseQuantityMark(serializeQuantityMark(large))).toBeNull()
  })

  it('係数を図面の札に小数3桁で表示する', () => {
    const label = quantityLabel(
      [[0, 0], [10, 0]], 1000, mark, '柱', true,
      id => id === 'spiral' ? 'SP D10' : id,
    )
    expect(label).toContain('SP D10 ×18.850/m')
    expect(label).toContain('10.00 m')
  })

  it('perMがない場合と1の場合の札は従来どおり', () => {
    const points: [number, number][] = [[0, 0], [10, 0]]
    const without: QuantityMark = {
      ...mark, extra: [{ itemId: 'spiral', count: 2 }],
    }
    const one: QuantityMark = {
      ...mark, extra: [{ itemId: 'spiral', count: 2, perM: 1 }],
    }
    expect(quantityLabel(points, 1000, one, '柱', true, () => 'SP D10'))
      .toBe(quantityLabel(points, 1000, without, '柱', true, () => 'SP D10'))
    expect(JSON.parse(serializeQuantityMark(without)).extra[0])
      .not.toHaveProperty('perM')
  })
})
