import { describe, expect, it } from 'vitest'
import { createDefaultAppearance, parseDefaultAppearance } from '../src/core/defaultAppearance'

describe('default appearance', () => {
  it('サイズは2桁、色は3桁までで末尾の0を省く', () => {
    expect(createDefaultAppearance('BIZUDGothic', 10.506, [1, 0.1254, 0]))
      .toBe('/BIZUDGothic 10.51 Tf 1 0.125 0 rg')
  })

  it('Tf と RGB 色を読む', () => {
    expect(parseDefaultAppearance('/BIZUDGothic 10.5 Tf 1 0 0 rg')).toEqual({
      fontName: 'BIZUDGothic',
      fontSize: 10.5,
      color: [1, 0, 0],
    })
  })

  it('グレーを RGB にする', () => {
    expect(parseDefaultAppearance('/Helv 12 Tf 0.25 g').color).toEqual([0.25, 0.25, 0.25])
  })

  it('CMYK を RGB にする', () => {
    const color = parseDefaultAppearance('/Helv 9 Tf 0.1 0.2 0.3 0.4 k').color
    expect(color?.[0]).toBeCloseTo(0.5)
    expect(color?.[1]).toBeCloseTo(0.4)
    expect(color?.[2]).toBeCloseTo(0.3)
  })

  it('読めない要素を null にする', () => {
    expect(parseDefaultAppearance('not a DA')).toEqual({ fontName: null, fontSize: null, color: null })
    expect(parseDefaultAppearance('/Helv nope Tf 1 0 nope rg')).toEqual({
      fontName: 'Helv',
      fontSize: null,
      color: null,
    })
  })
})
