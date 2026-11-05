import { describe, expect, it } from 'vitest'
import { anchorPageIndex, clampPan, pageScrollRange, panRange } from '../src/viewer/wheelPaging'

const pages = [
  { top: 0, height: 1200, width: 1200 },
  { top: 1212, height: 1400, width: 1600 },
  { top: 2624, height: 1200, width: 1200 },
]
const input = (changes: Partial<Parameters<typeof panRange>[0]> = {}): Parameters<typeof panRange>[0] => ({
  pages, scrollLeft: 300, scrollTop: 200, clientWidth: 600, clientHeight: 600,
  contentWidth: 1600, maxScrollLeft: 1000, maxScrollTop: 3224, ...changes,
})

describe('中ボタン移動のページ端停止', () => {
  it('表示中央のページを選び、隙間では近い方を選ぶ', () => {
    expect(anchorPageIndex(pages, 200, 600)).toBe(0)
    expect(anchorPageIndex(pages, 904, 600)).toBe(0)
    expect(anchorPageIndex(pages, 908, 600)).toBe(1)
    expect(anchorPageIndex([], 0, 600)).toBe(-1)
  })

  it('高い図面の途中から始めると上端・下端で止まる', () => {
    expect(pageScrollRange(pages[0], 600, 3224)).toEqual({ lo: 0, hi: 600 })
    const range = panRange(input()).top
    expect(range).toEqual({ lo: 0, hi: 600 })
    expect(clampPan(-5000, range)).toBe(0)
    expect(clampPan(5000, range)).toBe(600)
    expect(clampPan(300, range)).toBe(300)
    expect(panRange(input({ scrollTop: 1500 })).top).toEqual({ lo: 1212, hi: 2012 })
  })

  it('下端で始めると次の図面の下端まで動けて、隣の図面の横幅も含む', () => {
    const range = panRange(input({ scrollTop: 599 }))
    expect(range.top).toEqual({ lo: 0, hi: 2012 })
    expect(clampPan(9000, range.top)).toBe(2012)
    expect(range.left).toEqual({ lo: 0, hi: 1000 })
    expect(panRange(input({ scrollTop: 598 })).top.hi).toBe(600)
  })

  it('上端で始めると前の図面の上端まで動ける', () => {
    const range = panRange(input({ scrollTop: 1213 }))
    expect(range.top).toEqual({ lo: 0, hi: 2012 })
    expect(clampPan(-9000, range.top)).toBe(0)
    expect(panRange(input({ scrollTop: 1214 })).top.lo).toBe(1212)
    expect(panRange(input({ scrollTop: 2624 })).left).toEqual({ lo: 0, hi: 1000 })
  })

  it('画面より低い図面は全体が見える範囲内で動く', () => {
    const short = [pages[0], { top: 1212, height: 300, width: 1200 }, { top: 1524, height: 1200, width: 1200 }]
    expect(pageScrollRange(short[1], 600, 2124)).toEqual({ lo: 912, hi: 1212 })
    expect(panRange(input({ pages: short, maxScrollTop: 2124, scrollTop: 1050 })).top)
      .toEqual({ lo: 912, hi: 1212 })
  })

  it('最初・最後・1枚だけの図面でスクロール範囲を超えない', () => {
    expect(panRange(input({ scrollTop: 0 })).top).toEqual({ lo: 0, hi: 600 })
    expect(panRange(input({ scrollTop: 3224 })).top).toEqual({ lo: 2624, hi: 3224 })
    expect(pageScrollRange({ top: 0, height: 300 }, 600, -300)).toEqual({ lo: 0, hi: 0 })
    expect(panRange(input({
      pages: [{ top: 0, height: 300, width: 300 }], scrollTop: 0, scrollLeft: 0,
      contentWidth: 600, maxScrollLeft: 0, maxScrollTop: 0,
    }))).toEqual({ left: { lo: 0, hi: 0 }, top: { lo: 0, hi: 0 } })
    expect(panRange(input({ pages: [] })))
      .toEqual({ left: { lo: 0, hi: 1000 }, top: { lo: 0, hi: 3224 } })
  })

  it('幅の広い図面は左右の端、狭い図面は全体が見える範囲で止まる', () => {
    const wide = panRange(input()).left
    expect(wide).toEqual({ lo: 200, hi: 800 })
    expect(clampPan(-9000, wide)).toBe(200)
    expect(clampPan(9000, wide)).toBe(800)
    const narrow = panRange(input({
      pages: [{ top: 0, height: 1200, width: 300 }], scrollLeft: 500,
    })).left
    expect(narrow).toEqual({ lo: 350, hi: 650 })
    expect(clampPan(-9000, narrow)).toBe(350)
    expect(clampPan(9000, narrow)).toBe(650)
  })

  it('開始位置が範囲外でも開始位置を含め、押した瞬間に跳ばない', () => {
    const changes = { pages: [{ top: 500, height: 1200, width: 1200 }], maxScrollTop: 2000 }
    const before = input({ ...changes, scrollLeft: 50, scrollTop: 100 })
    const range = panRange(before)
    expect(range).toEqual({ left: { lo: 50, hi: 800 }, top: { lo: 100, hi: 1100 } })
    expect(clampPan(before.scrollLeft, range.left)).toBe(before.scrollLeft)
    expect(clampPan(before.scrollTop, range.top)).toBe(before.scrollTop)
    const after = panRange(input({ ...changes, scrollLeft: 950, scrollTop: 1700 }))
    expect(after).toEqual({ left: { lo: 200, hi: 950 }, top: { lo: 500, hi: 1700 } })
  })
})
