import { describe, expect, it } from 'vitest'
import { anchorPageIndex, pageScrollRange, wheelTarget, type WheelTargetInput } from '../src/viewer/wheelPaging'

const pages = [{ top: 0, height: 1200 }, { top: 1212, height: 1400 }, { top: 2624, height: 1200 }]
const input = (changes: Partial<WheelTargetInput> = {}): WheelTargetInput => ({
  pages, clientHeight: 600, maxScrollTop: 3224, scrollTop: 0, target: 0, delta: 300,
  gestureStart: true, anchorIndex: 0, ...changes,
})

describe('ホイールのページ端停止', () => {
  it('表示中央のページを選び、隙間では近い方を選ぶ', () => {
    expect(anchorPageIndex(pages, 200, 600)).toBe(0)
    expect(anchorPageIndex(pages, 904, 600)).toBe(0)
    expect(anchorPageIndex(pages, 908, 600)).toBe(1)
    expect(anchorPageIndex([], 0, 600)).toBe(-1)
  })

  it('高い図面の途中から大きく回してもその図面の下端で止まる', () => {
    expect(pageScrollRange(pages[0], 600, 3224)).toEqual({ lo: 0, hi: 600 })
    expect(wheelTarget(input({ scrollTop: 200, delta: 2000 }))).toEqual({ target: 600, anchorIndex: 0 })
    expect(wheelTarget(input({ gestureStart: false, scrollTop: 599, target: 600, delta: 2000 }))).toEqual({ target: 600, anchorIndex: 0 })
  })

  it('下端で新しい操作を始めたときだけ次の図面の上端へ移る', () => {
    const next = wheelTarget(input({ scrollTop: 599, delta: 300 }))
    expect(next).toEqual({ target: 1212, anchorIndex: 1 })
    expect(wheelTarget(input({ gestureStart: false, scrollTop: 1212, target: next.target, anchorIndex: next.anchorIndex, delta: 9000 })))
      .toEqual({ target: 2012, anchorIndex: 1 })
    expect(wheelTarget(input({ gestureStart: false, scrollTop: 2012, target: 2012, anchorIndex: 1, delta: 9000 })))
      .toEqual({ target: 2012, anchorIndex: 1 })
  })

  it('上端で上向きの操作を始めると前の図面の下端を画面下に合わせる', () => {
    expect(wheelTarget(input({ scrollTop: 1212, delta: -300 }))).toEqual({ target: 600, anchorIndex: 0 })
    expect(wheelTarget(input({ scrollTop: 1500, delta: -5000 }))).toEqual({ target: 1212, anchorIndex: 1 })
  })

  it('画面より低い図面は全体が見える範囲内で動き、端から隣へ移る', () => {
    const short = [{ top: 0, height: 1200 }, { top: 1212, height: 300 }, { top: 1524, height: 1200 }]
    expect(pageScrollRange(short[1], 600, 2124)).toEqual({ lo: 912, hi: 1212 })
    expect(wheelTarget(input({ pages: short, maxScrollTop: 2124, scrollTop: 1050, delta: 500 })))
      .toEqual({ target: 1212, anchorIndex: 1 })
    expect(wheelTarget(input({ pages: short, maxScrollTop: 2124, scrollTop: 1050, delta: -500 })))
      .toEqual({ target: 912, anchorIndex: 1 })
    expect(wheelTarget(input({ pages: short, maxScrollTop: 2124, scrollTop: 1212 })))
      .toEqual({ target: 1524, anchorIndex: 2 })
    expect(wheelTarget(input({ pages: short, maxScrollTop: 2124, scrollTop: 912, delta: -300 })))
      .toEqual({ target: 600, anchorIndex: 0 })
  })

  it('最初・最後・1枚だけの図面でスクロール範囲を超えない', () => {
    expect(wheelTarget(input({ delta: -9000 }))).toEqual({ target: 0, anchorIndex: 0 })
    expect(wheelTarget(input({ scrollTop: 3224, delta: 9000 }))).toEqual({ target: 3224, anchorIndex: 2 })
    expect(pageScrollRange({ top: 0, height: 300 }, 600, -300)).toEqual({ lo: 0, hi: 0 })
    expect(wheelTarget(input({ pages: [{ top: 0, height: 300 }], maxScrollTop: 0 })))
      .toEqual({ target: 0, anchorIndex: 0 })
    expect(wheelTarget(input({ pages: [] }))).toEqual({ target: 0, anchorIndex: -1 })
  })

  it('同じ操作中は実際の位置ではなく直前の目標に移動量を足す', () => {
    expect(wheelTarget(input({ gestureStart: false, scrollTop: 100, target: 300, delta: 100 })))
      .toEqual({ target: 400, anchorIndex: 0 })
    expect(wheelTarget(input({ gestureStart: false, scrollTop: 100, target: 300, delta: -100 })))
      .toEqual({ target: 200, anchorIndex: 0 })
  })
})
