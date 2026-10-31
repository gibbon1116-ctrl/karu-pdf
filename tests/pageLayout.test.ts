import { describe, expect, it } from 'vitest'
import { computePageLayout, pagesInRange } from '../src/viewer/pageLayout'

describe('pageLayout', () => {
  it('異なるページサイズの位置と全体高を計算する', () => {
    const result = computePageLayout([
      { width: 600, height: 800 },
      { width: 800, height: 600 },
      { width: 300, height: 400 },
    ], 0.75)
    const expected = [
      { top: 0, width: 600, height: 800 },
      { top: 812, width: 800, height: 600 },
      { top: 1424, width: 300, height: 400 },
    ]
    result.pages.forEach((page, index) => {
      expect(page.top).toBeCloseTo(expected[index].top)
      expect(page.width).toBeCloseTo(expected[index].width)
      expect(page.height).toBeCloseTo(expected[index].height)
    })
    expect(result.totalHeight).toBeCloseTo(1824)
    expect(result.maxWidth).toBeCloseTo(800)
  })

  it('表示範囲と交差するページだけを返す', () => {
    const { pages } = computePageLayout([{ width: 100, height: 100 }, { width: 100, height: 100 }], 0.75)
    expect(pagesInRange(pages, 99, 112).map((page) => page.index)).toEqual([0, 1])
  })
})
