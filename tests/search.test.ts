import { describe, expect, it } from 'vitest'
import { searchContext } from '../src/core/search'

describe('検索結果の文脈', () => {
  it('前後15文字程度を切り出し、空白をまとめる', () => {
    const text = '0123456789abcdefghij  検索語\n  かきくけこさしすせそたちつてとなにぬねの'
    const start = text.indexOf('検索語')
    const context = searchContext(text, start, start + 3)
    expect(context.match).toBe('検索語')
    expect(Array.from(context.before).length).toBeLessThanOrEqual(15)
    expect(Array.from(context.after).length).toBeLessThanOrEqual(15)
    expect(context.after).not.toContain('\n')
  })
})
