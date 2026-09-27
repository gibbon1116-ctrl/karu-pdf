import { describe, expect, it } from 'vitest'
import { LINE_HEIGHT_RATIO, PADDING, layoutText } from '../src/core/textLayout'

const fixedAdvance = (character: string) => character.charCodeAt(0) < 128 ? 0.5 : 1

function layout(text: string, boxWidth = 34) {
  return layoutText({ text, fontSize: 10, boxWidth, advance: fixedAdvance, ascent: 0.8 })
}

describe('layoutText', () => {
  it('改行、CRLF、CR、タブを正規化する', () => {
    const result = layout('一\r\n二\r三\tA', 200)
    expect(result.lines.map((line) => line.text)).toEqual(['一', '二', '三 A'])
  })

  it('文字単位で幅を超える手前に折り返す', () => {
    expect(layout('日本語ABC').lines.map((line) => line.text)).toEqual(['日本語', 'ABC'])
  })

  it('行頭禁則文字の前で前行末の1文字を追い出す', () => {
    expect(layout('日本語、次').lines.map((line) => line.text)).toEqual(['日本', '語、次'])
  })

  it('行末禁則文字を次の行へ送る', () => {
    expect(layout('日本（語').lines.map((line) => line.text)).toEqual(['日本', '（語'])
  })

  it('前の行が1文字だけなら行頭禁則の追い出しをしない', () => {
    expect(layout('日、語', 14).lines.map((line) => line.text)).toEqual(['日', '、', '語'])
  })

  it('空文字も1行として高さとベースラインを返す', () => {
    const result = layout('')
    expect(result.lines).toEqual([{ text: '', x: PADDING, baseline: PADDING + 8 }])
    expect(result.height).toBe(2 * PADDING + 10 * LINE_HEIGHT_RATIO)
  })

  it('半角と全角の advance の違いを使う', () => {
    expect(layout('AB日本C', 24).lines.map((line) => line.text)).toEqual(['AB日', '本C'])
  })
})
