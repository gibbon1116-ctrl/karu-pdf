import { describe, expect, it } from 'vitest'
import { fixtureChoiceLabel } from '../src/core/countFixtures'

type ChoiceFixture = Parameters<typeof fixtureChoiceLabel>[0]

function fixture(overrides: Partial<ChoiceFixture> = {}): ChoiceFixture {
  return {
    code: '',
    name: '機器用基礎（冷却塔）',
    kind: 'count',
    ...overrides,
  }
}

describe('fixtureChoiceLabel', () => {
  it('記号が空なら名称を1回だけ出す', () => {
    const result = fixtureChoiceLabel(fixture({
      summary: [
        { label: '寸法', value: '900×900×150' },
        { label: '種類', value: '防振基礎' },
      ],
    }))

    expect(result).toEqual({
      code: '',
      name: '機器用基礎（冷却塔）',
      detail: '寸法 900×900×150・種類 防振基礎',
      text: '機器用基礎（冷却塔） （寸法 900×900×150・種類 防振基礎）',
    })
    expect(result.text.split(result.name).length - 1).toBe(1)
  })

  it('空白だけの記号を出さない', () => {
    expect(fixtureChoiceLabel(fixture({ code: '   ' }))).toEqual({
      code: '',
      name: '機器用基礎（冷却塔）',
      detail: '',
      text: '機器用基礎（冷却塔）',
    })
  })

  it('記号が名称と同じなら記号を出さない', () => {
    const result = fixtureChoiceLabel(fixture({
      code: '冷却塔',
      name: '冷却塔',
      summary: [{ label: '仕様等', value: '冷却能力 104kW以下' }],
    }))

    expect(result.code).toBe('')
    expect(result.text).toBe('冷却塔 （仕様等 冷却能力 104kW以下）')
    expect(result.text.split('冷却塔').length - 1).toBe(1)
  })

  it('NFKCと空白除去で同じになる記号と名称も重複させない', () => {
    const result = fixtureChoiceLabel(fixture({
      code: ' Ｆ Ｄ ',
      name: 'FD',
    }))

    expect(result.code).toBe('')
    expect(result.text).toBe('FD')
  })

  it('FDの記号・名称・摘要を出す', () => {
    expect(fixtureChoiceLabel(fixture({
      code: ' FD ',
      name: '防火ダンパー',
      summary: [{ label: '寸法', value: '面積 0.5㎡以下' }],
    }))).toEqual({
      code: 'FD',
      name: '防火ダンパー',
      detail: '寸法 面積 0.5㎡以下',
      text: 'FD 防火ダンパー （寸法 面積 0.5㎡以下）',
    })
  })

  it('記号に含まれない規格を摘要の前に出す', () => {
    const result = fixtureChoiceLabel(fixture({
      code: 'VP',
      name: '硬質塩化ビニル管',
      kind: 'length',
      spec: 'φ150',
      summary: [{ label: '種類', value: '一般用' }],
    }))

    expect(result.code).toBe('VP')
    expect(result.detail).toBe('規格 φ150・種類 一般用')
    expect(result.text).toBe('VP 硬質塩化ビニル管 （規格 φ150・種類 一般用）')
  })

  it('記号に既に含まれる規格をdetailに重複させない', () => {
    const result = fixtureChoiceLabel(fixture({
      code: 'VP φ150',
      name: '硬質塩化ビニル管',
      kind: 'length',
      spec: 'φ150',
      summary: [{ label: '種類', value: '一般用' }],
    }))

    expect(result.code).toBe('VP φ150')
    expect(result.detail).toBe('種類 一般用')
    expect(result.text).toBe('VP φ150 硬質塩化ビニル管 （種類 一般用）')
  })

  it('摘要の空の値を省き、残った区分だけをつなぐ', () => {
    const result = fixtureChoiceLabel(fixture({
      spec: ' ',
      summary: [
        { label: '形式', value: '' },
        { label: '寸法', value: ' 600×600×150 ' },
        { label: '種類', value: '   ' },
      ],
    }))

    expect(result.detail).toBe('寸法 600×600×150')
    expect(result.text).toBe('機器用基礎（冷却塔） （寸法 600×600×150）')
  })

  it('規格・摘要がなければ括弧を出さない', () => {
    const result = fixtureChoiceLabel(fixture({
      code: 'FD',
      name: '防火ダンパー',
    }))

    expect(result.detail).toBe('')
    expect(result.text).toBe('FD 防火ダンパー')
  })
})
