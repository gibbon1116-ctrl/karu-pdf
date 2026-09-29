import { describe, expect, it } from 'vitest'
import type { PageLayoutCard } from '../src/core/pageOps'
import { insertionIndex, parsePageRange, selectionForMode, splitCardGroups } from '../src/organize/organizeUtils'

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
})
