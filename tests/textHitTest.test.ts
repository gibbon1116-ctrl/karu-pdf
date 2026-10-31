import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/core/annotations'
import { hitTextLine } from '../src/editor/textHitTest'

describe('hitTextLine', () => {
  it('行枠の内外と 1pt の余白境界を判定する', () => {
    const lines: Rect[] = [[10, 20, 30, 40]]
    expect(hitTextLine(lines, [20, 30])).toBe(true)
    expect(hitTextLine(lines, [9, 19])).toBe(true)
    expect(hitTextLine(lines, [31, 41])).toBe(true)
    expect(hitTextLine(lines, [8.999, 30])).toBe(false)
    expect(hitTextLine(lines, [20, 41.001])).toBe(false)
  })

  it('2,000 行を超える区分けでも線形判定と同じ結果になる', () => {
    const lines: Rect[] = Array.from({ length: 2_001 }, (_, index) => [10, index * 3, 30, index * 3 + 2])
    const points: Array<[number, number]> = [[20, 0], [9, 3_001], [31, 6_002], [8.9, 3_001], [40, -20]]
    const linear = (point: [number, number]) => lines.some((line) => (
      point[0] >= line[0] - 1 && point[0] <= line[2] + 1
      && point[1] >= line[1] - 1 && point[1] <= line[3] + 1
    ))
    for (const point of points) {
      expect(hitTextLine(lines, point)).toBe(linear(point))
    }
  })
})
