import { describe, expect, it } from 'vitest'
import { nextCountStyle, type CountFixture, type QuantityKind } from '../src/core/countFixtures'
import { commonOpacity, withOpacity } from '../src/app/fixtureOpacity'

const fixture = (id: string, opacity: number, kind: QuantityKind = 'count'): CountFixture => ({
  id, name: '試験項目', code: '', category: '試験', order: 0, kind,
  style: { ...nextCountStyle([]), opacity },
})

describe('項目の透明度', () => {
  it('全項目が同じときは共通の値を返す', () => {
    expect(commonOpacity([fixture('a', .75), fixture('b', .75)])).toBe(.75)
    expect(commonOpacity([fixture('a', 1)])).toBe(1)
  })

  it('混在と0件は共通の値なしにする', () => {
    expect(commonOpacity([fixture('a', 1), fixture('b', .5)])).toBeNull()
    expect(commonOpacity([])).toBeNull()
    expect(withOpacity([], .5)).toEqual({ next: [], changedIds: [] })
  })

  it('全種別に適用し、同じ値の項目を更新対象に含めず元データを変えない', () => {
    const fixtures = [fixture('a', 1), fixture('b', .5, 'length'), fixture('c', .8, 'area'), fixture('d', .25, 'volume')]
    const before = structuredClone(fixtures)
    const { next, changedIds } = withOpacity(fixtures, .5)
    expect(next.map(item => item.style.opacity)).toEqual([.5, .5, .5, .5])
    expect(changedIds).toEqual(['a', 'c', 'd'])
    expect(next[1]).toBe(fixtures[1])
    expect(next[0]).not.toBe(fixtures[0])
    expect(next[0].style).not.toBe(fixtures[0].style)
    expect(next[0]).toEqual({ ...fixtures[0], style: { ...fixtures[0].style, opacity: .5 } })
    expect(fixtures).toEqual(before)
    expect(commonOpacity(next)).toBe(.5)
  })

  it('すでに全項目が同じ値なら更新対象を作らない', () => {
    const fixtures = [fixture('a', .5), fixture('b', .5)]
    const { next, changedIds } = withOpacity(fixtures, .5)
    expect(changedIds).toEqual([])
    expect(next[0]).toBe(fixtures[0])
    expect(next[1]).toBe(fixtures[1])
  })
})
