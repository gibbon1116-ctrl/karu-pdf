import { describe, expect, it } from 'vitest'
import { computePageLayout, currentPageIndex, CSS_PX_PER_PT, fitPageView, pagesInRange } from '../src/viewer/pageLayout'

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

describe('currentPageIndex', () => {
  const { pages } = computePageLayout(Array.from({ length: 3 }, () => ({ width: 100, height: 100 })), .75)

  it('先頭・途中・最後の表示中ページを返す', () => {
    expect(currentPageIndex(pages, 0, 60)).toBe(0)
    expect(currentPageIndex(pages, 93, 60)).toBe(1)
    expect(currentPageIndex(pages, 224, 60)).toBe(2)
    expect(currentPageIndex(pages, 1000, 60)).toBe(2)
  })

  it('ページ間の隙間でも表示領域の上から3分の1を基準にし、境界を含む', () => {
    expect(currentPageIndex(pages, 101, 24)).toBe(0)
    expect(currentPageIndex(pages, 104, 24)).toBe(1)
    expect(currentPageIndex(pages, 213, 24)).toBe(1)
    expect(currentPageIndex(pages, 216, 24)).toBe(2)
  })

  it('ページが無いときは既存の先頭ページ扱いを保つ', () => {
    expect(currentPageIndex([], 0, 600)).toBe(0)
  })
})

describe('fitPageView', () => {
  it('A3横は幅に、A4縦は高さに合わせる', () => {
    const sizes = [{ width: 1191, height: 842 }, { width: 595, height: 842 }]
    const landscape = fitPageView(sizes, 0, 1016, 916)!
    expect(landscape.zoom).toBeCloseTo(1000 / (1191 * CSS_PX_PER_PT))
    expect(landscape.left).toBe(0)
    expect(landscape.top).toBe(0)
    const portrait = fitPageView(sizes, 1, 1016, 916)!
    expect(portrait.zoom).toBeCloseTo(900 / (842 * CSS_PX_PER_PT))
    expect(595 * CSS_PX_PER_PT * portrait.zoom).toBeLessThan(1000)
    expect(portrait.left).toBeCloseTo((1191 * CSS_PX_PER_PT * portrait.zoom - 1016) / 2)
    // 最後のページでは、中央位置からはみ出す分を最大スクロール位置に収める。
    expect(portrait.top).toBeCloseTo(900 * 2 + 12 - 916)
  })

  it('最も広いページを含むレイアウトの中で、対象ページの中心を表示領域の中心にする', () => {
    const sizes = [{ width: 2400, height: 900 }, { width: 600, height: 900 }, { width: 600, height: 900 }]
    const view = fitPageView(sizes, 1, 816, 616)!
    expect(view.zoom).toBe(.5)
    expect(view.left).toBe(392)
    expect(view.top).toBe(604)
    expect(fitPageView(sizes, 0, 816, 616)!.top).toBe(0)
    expect(fitPageView(sizes, 2, 816, 616)!.top).toBe(1208)
  })

  it('倍率の下限・上限とスクロール可能範囲に収める', () => {
    const small = fitPageView([{ width: 1, height: 1 }], 0, 1016, 1016)!
    expect(small).toEqual({ zoom: 8, left: 0, top: 0 })
    const sizes = [{ width: 6000, height: 9000 }]
    expect(fitPageView(sizes, 0, 116, 116)).toEqual({ zoom: .25, left: 942, top: 1442 })
    expect(fitPageView(sizes, 0, 116, 116, .05)!.zoom).toBe(.05)
    expect(fitPageView([], 0, 800, 600)).toBeNull()
    expect(fitPageView(sizes, 1, 800, 600)).toBeNull()
  })
})
