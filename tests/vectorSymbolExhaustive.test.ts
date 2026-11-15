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
  it('角で continued だけが通っても追加起点で配線付きの3記号を見つける', () => {
    const wired = [-250,0,270,0, 20,-250,20,270, 270,12,-250,12, 0,12,0,0, 3,3,8,6]
    // Every outer edge is extended, but is still short enough for corner anchors.
    // The other three copies have >8x wires, outside corner-anchor recovery.
    const cornerOnly = [-20,0,40,0, 20,-20,20,32, 40,12,-20,12, 0,32,0,-20, 3,3,8,6]
    const translate = (data: number[], x: number) => data.map((value, i) => value + (i % 2 ? 0 : x))
    const target = new Float32Array([
      ...[0, 1000, 2000].flatMap(x => translate(wired, x)), ...translate(cornerOnly, 3000),
    ])
    const normal = search(target, false)
    expect(normal.matches).toHaveLength(1)
    expect(normal.matches[0]).toMatchObject({ source: 'secondary', continued: true, center: [3010, 6] })
    expect(normal.stats.junctionPlacements).toBeGreaterThan(0)
    expect(normal.stats.geometryPassed).toBeGreaterThan(0)
    expect(normal.stats.exhaustiveRan).toBe(false)
    const result = search(target, true)
    expect(result.stats.exhaustiveRan).toBe(true)
    // The corner-only copy is also reached by an uncontinued exhaustive alignment, which now wins
    // over the continued one at the same site. Both are shown as check.
    expect(result.stats.exhaustiveFound).toBe(4)
    expect(result.matches).toHaveLength(4)
    for (const x of [10, 1010, 2010]) {
      expect(result.matches.some(match => match.source === 'exhaustive'
        && Math.hypot(match.center[0] - x, match.center[1] - 6) < .01)).toBe(true)
    }
  })

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
    // Wires longer than 8x the longest stroke stay outside corner recovery, so only the exhaustive anchors find this.
    const target = new Float32Array([-250,0,270,0, 20,-250,20,270, 270,12,-250,12, 0,12,0,0, 3,3,8,6])
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
