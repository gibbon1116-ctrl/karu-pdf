import { describe, expect, it } from 'vitest'
import { composeHeaderFooterText, DEFAULT_HEADER_FOOTER_SETTINGS, formatHeaderFooterDate, pageNumberMap, targetPages } from '../src/app/headerFooterText'

describe('headerFooterText', () => {
  it('4種類の記号を置き換える', () => {
    expect(composeHeaderFooterText('{ページ}/{総ページ} {日付} {ファイル名}', { page: 2, total: 5, date: '2026年10月1日', fileName: '設計図.pdf' }))
      .toBe('2/5 2026年10月1日 設計図')
  })

  it('対象ページをページ順に数え、開始番号から総ページ数を求める', () => {
    const settings = { ...DEFAULT_HEADER_FOOTER_SETTINGS, target: 'range' as const, range: '5-6,1,3', startNumber: 7 }
    const result = pageNumberMap(settings, 8)
    expect([...result.numbers]).toEqual([[0, 7], [2, 8], [4, 9], [5, 10]])
    expect(result.total).toBe(10)
  })

  it('範囲と開始番号の誤りを見つける', () => {
    expect(targetPages({ ...DEFAULT_HEADER_FOOTER_SETTINGS, target: 'range', range: '5-2' }, 8).error).toContain('小さい番号')
    expect(targetPages({ ...DEFAULT_HEADER_FOOTER_SETTINGS, startNumber: 0 }, 8).error).toContain('1以上')
  })

  it('日付を3種類の形にする', () => {
    const date = new Date(2026, 9, 1)
    expect(formatHeaderFooterDate(date, 'japanese')).toBe('2026年10月1日')
    expect(formatHeaderFooterDate(date, 'slash')).toBe('2026/10/01')
    expect(formatHeaderFooterDate(date, 'era')).toContain('令和8年10月1日')
  })
})
