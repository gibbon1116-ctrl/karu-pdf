import { describe, expect, it } from 'vitest'
import type { PageLayoutCard } from '../src/core/pageOps'
import {
  describePaperSize,
  insertionIndex,
  keyboardSelection,
  moveFocusIndex,
  parsePageRange,
  selectionForMode,
  splitCardGroups,
} from '../src/organize/organizeUtils'

const cards: PageLayoutCard[] = Array.from({ length: 7 }, (_, pageIndex) => ({
  id: `p${pageIndex + 1}`,
  source: { kind: 'page', docId: 'main', pageIndex },
  rotation: 0,
}))

describe('ページ整理の入力と区切り', () => {
  it('全角を含むページ番号を読み取り、重複を除いて入力順を保つ', () => {
    expect(parsePageRange('１－３， 5、３', 7)).toEqual({ pages: [0, 1, 2, 4], error: null })
  })

  it('読めない部分、逆順、範囲外を理由付きで拒否する', () => {
    expect(parsePageRange('1-x', 7).error).toContain('読み取れません')
    expect(parsePageRange('5-3', 7).error).toContain('小さい番号')
    expect(parsePageRange('8', 7).error).toContain('1〜7')
  })

  it('挿入位置と、奇数・偶数・反転の選択を求める', () => {
    expect(insertionIndex('before', cards, ['p3', 'p5'], 0)).toBe(2)
    expect(insertionIndex('after', cards, ['p3', 'p5'], 0)).toBe(5)
    expect(insertionIndex('afterPage', cards, [], 3)).toBe(3)
    expect(selectionForMode(cards, [], 'odd')).toEqual(['p1', 'p3', 'p5', 'p7'])
    expect(selectionForMode(cards, [], 'even')).toEqual(['p2', 'p4', 'p6'])
    expect(selectionForMode(cards, ['p2', 'p5'], 'invert')).toEqual(['p1', 'p3', 'p4', 'p6', 'p7'])
  })

  it('1ページずつと指定ファイル数へ均等に分ける', () => {
    expect(splitCardGroups(cards, { kind: 'single' }).map((group) => group.length)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(splitCardGroups(cards, { kind: 'equal', files: 3 }).map((group) => group.length)).toEqual([3, 2, 2])
    expect(splitCardGroups(cards, { kind: 'every', count: 3 }).map((group) => group.length)).toEqual([3, 3, 1])
  })

  it('列数と画面の行数から方向キーの移動先を求め、端で止まる', () => {
    expect(moveFocusIndex(5, 'ArrowUp', 10, 4)).toBe(1)
    expect(moveFocusIndex(5, 'ArrowDown', 10, 4)).toBe(9)
    expect(moveFocusIndex(8, 'ArrowDown', 10, 4)).toBe(9)
    expect(moveFocusIndex(0, 'ArrowLeft', 10, 4)).toBe(0)
    expect(moveFocusIndex(9, 'ArrowRight', 10, 4)).toBe(9)
    expect(moveFocusIndex(6, 'Home', 10, 4)).toBe(0)
    expect(moveFocusIndex(2, 'End', 10, 4)).toBe(9)
    expect(moveFocusIndex(9, 'PageUp', 20, 4, 2)).toBe(1)
    expect(moveFocusIndex(9, 'PageDown', 20, 4, 2)).toBe(17)
  })

  it('Shiftは起点から範囲を広げ、Ctrlは選択を変えずフォーカスだけ動かす', () => {
    expect(keyboardSelection([4], 4, 2, true, false)).toEqual({ selection: [2, 3, 4], anchor: 4 })
    expect(keyboardSelection([1, 4], 1, 5, false, true)).toEqual({ selection: [1, 4], anchor: 1 })
    expect(keyboardSelection([1, 4], 1, 5, false, false)).toEqual({ selection: [5], anchor: 5 })
  })

  it('A4・A3・B4を縦横と1mmの誤差を含めて判定する', () => {
    const pt = (millimetres: number) => millimetres * 72 / 25.4
    expect(describePaperSize(pt(210.8), pt(296.2))).toBe('A4 縦、211×296 mm')
    expect(describePaperSize(pt(297), pt(420), 90)).toBe('A3 横、420×297 mm')
    expect(describePaperSize(pt(257), pt(364))).toBe('B4 縦、257×364 mm')
    expect(describePaperSize(pt(220), pt(300))).toBe('220×300 mm')
  })
})
