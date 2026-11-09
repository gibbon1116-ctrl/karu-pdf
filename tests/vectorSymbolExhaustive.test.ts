import { describe, expect, it } from 'vitest'
import { vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import type { Rect } from '../src/core/annotations'

const lines = new Float32Array([0,0,20,0, 20,0,20,12, 20,12,0,12, 0,12,0,0, 3,3,8,6])
const widths = new Float32Array(lines.length / 4).fill(.5)
const rect: Rect = [-1,-1,21,13]
const manual = { segments: lines, widths }
function search(target: Float32Array, exhaustiveWhenEmpty: boolean) {
  return vectorSymbolSearch(target, rect, { threshold: .99, exhaustiveWhenEmpty, scaleRange: 0 }, lines, widths,
    new Float32Array(target.length / 4).fill(.5), undefined, manual)
}

describe('0 件だけの追加起点探索', () => {
  it('通常起点で見つかる場合は結果と時間以外の統計が同じ', () => {
    const normal = search(lines, false), exhaustive = search(lines, true)
    expect(exhaustive.matches).toEqual(normal.matches)
    expect(exhaustive.rejected).toEqual(normal.rejected)
    const counters = (stats: typeof normal.stats) => {
      const { ms, mergeMs, candidateMs, verifyMs, ...rest } = stats
      return rest
    }
    expect(counters(exhaustive.stats)).toEqual(counters(normal.stats))
    expect(exhaustive.stats.exhaustiveRan).toBe(false)
  })
  it('最初の3起点が配線で延びた形を残る起点で検出する', () => {
    const target = new Float32Array([-50,0,70,0, 20,-50,20,70, 70,12,-50,12, 0,12,0,0, 3,3,8,6])
    expect(search(target, false).matches).toHaveLength(0)
    const result = search(target, true)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ source: 'exhaustive', score: 1, center: [10,6] })
    expect(result.stats.exhaustiveRan).toBe(true)
    expect(result.stats.exhaustivePlacements).toBeGreaterThan(0)
    expect(result.stats.exhaustiveFound).toBe(1)
  })
  it('記号のないページでは0件のまま', () => {
    const result = search(new Float32Array([100,100,101,100]), true)
    expect(result.matches).toHaveLength(0)
    expect(result.stats.exhaustiveRan).toBe(true)
    expect(result.stats.exhaustiveFound).toBe(0)
  })
  it('中断済みなら追加探索しない', () => {
    const result = vectorSymbolSearch(lines, rect, { exhaustiveWhenEmpty: true, shouldStop: () => true }, lines, widths)
    expect(result.stats.stopped).toBe(true)
    expect(result.stats.exhaustiveRan).toBe(false)
  })
})
