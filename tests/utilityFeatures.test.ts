import { describe, expect, it } from 'vitest'
import { ViewHistory } from '../src/viewer/ViewHistory'
import { sheetSize } from '../src/app/SheetSizeDialog'
import { validSnippets } from '../src/editor/snippets'

describe('軽量な業務機能', () => {
  const view = (pageIndex: number, x = .5, widthRatio = 1) => ({ pageIndex, x, y: .2, widthRatio })
  it('表示位置・倍率を戻し、分岐後は進む履歴を破棄する', () => {
    const history = new ViewHistory()
    history.remember(view(0, .3, 2)); history.remember(view(2))
    expect(history.move('back', view(5))).toMatchObject(view(2))
    expect(history.move('back', view(2))).toMatchObject(view(0, .3, 2))
    expect(history.move('forward', view(0, .3, 2))).toMatchObject(view(2))
    history.remember(view(4)); expect(history.canForward).toBe(false)
    history.clear(); expect(history.canBack).toBe(false)
  })
  it('表示履歴を30件に制限する', () => {
    const history = new ViewHistory()
    for (let page = 0; page < 100; page++) history.remember(view(page))
    let count = 0
    while (history.move('back', view(100))) count++
    expect(count).toBe(30)
  })
  it('A1横・A4縦・規格外サイズをPDF表示寸法から識別する', () => {
    const points = (width: number, height: number) => ({ width: width * 72 / 25.4, height: height * 72 / 25.4 })
    expect(sheetSize(points(841, 594))).toMatchObject({ name: 'A1', orientation: '横' })
    expect(sheetSize(points(210.5, 297))).toMatchObject({ name: 'A4', orientation: '縦' })
    const custom = sheetSize(points(220, 300))
    expect(custom.name).toBe('その他'); expect(custom.width).toBeCloseTo(220); expect(custom.height).toBeCloseTo(300)
  })
  it('定型文の壊れた保存情報と過大な本文を拒否し、標準を含め20件までにする', () => {
    expect(validSnippets([null, { label: 'x', text: 'x'.repeat(501) }, { label: '', text: 'x' }])).toEqual([])
    expect(validSnippets(Array.from({ length: 100 }, () => ({ label: '確認', text: '現地確認' })))).toHaveLength(15)
  })
})
