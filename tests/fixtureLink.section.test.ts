import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import {
  computeLinks,
  fixtureLinkSectionText,
  type FixtureLinkSource,
  type LinkResult,
  type LinkSourceEntry,
} from '../src/core/fixtureLink'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0],
  size: 10, opacity: .8, showCode: true,
}

const pipe: CountFixture = {
  id: 'pipe',
  name: '波付硬質合成樹脂管',
  code: 'FEP30',
  category: '電線管',
  kind: 'length',
  method: 'polyline',
  style,
  order: 0,
}

const trench: CountFixture = {
  id: 'trench',
  name: '溝掘削',
  code: '溝',
  category: '土工',
  kind: 'volume',
  method: 'lengthWidthDepth',
  defaults: { widthM: 0.6, depthM: 0.8 },
  style,
  order: 1,
  link: {
    kind: 'factor',
    rounding: 'none',
    sources: [{ itemId: pipe.id, factor: 1 }],
  },
}

const lengthM = 4.365138
const pipeAreaM2 = Math.PI / 4 * 0.040 ** 2

const missingDiameterWarning =
  '未知管 の外径が分からないため引いていません（項目の質量・寸法に外径を入れてください）'
const excessiveDeductionWarning =
  '管の体積が埋戻しの総体積を超えた行があるため、0 にしています。'

function row(
  value: number,
  options: Partial<LinkSourceEntry> = {},
): LinkSourceEntry {
  return {
    itemId: pipe.id,
    annotationId: 'route',
    pageIndex: 0,
    value,
    ...options,
  }
}

function calculate(
  target: CountFixture = trench,
  rows: LinkSourceEntry[] = [row(lengthM)],
  original: CountFixture = pipe,
): LinkResult {
  const results = computeLinks(
    [original, target],
    id => rows.filter(entry => entry.itemId === id),
  )
  const result = results.get(target.id)!
  expect(result.error).toBeUndefined()
  return result
}

function withSource(
  target: CountFixture,
  source: FixtureLinkSource,
): CountFixture {
  return {
    ...target,
    link: {
      ...target.link!,
      sources: [source],
    },
  }
}

function backfill(): CountFixture {
  return {
    ...trench,
    name: '埋戻し',
    backfill: {
      deductPipes: true,
      conditionIncludes: ['埋設'],
    },
  }
}

describe('SPEC-U10: 係数の連動の断面と管の控除', () => {
  it('溝掘削は元の長さに幅と深さを掛け、根拠にも断面を残す', () => {
    const result = calculate()

    expect(result.total).toBeCloseTo(lengthM * 0.48, 12)
    expect(result.computed).toBeCloseTo(lengthM * 0.48, 12)
    expect(result.entries[0].value).toBeCloseTo(lengthM * 0.48, 12)
    expect(result.sources[0]).toMatchObject({
      quantity: lengthM,
      section: { widthM: 0.6, depthM: 0.8 },
    })
    expect(result.sources[0].subtotal).toBeCloseTo(lengthM * 0.48, 12)
    expect(result.sources[0].pipeDeductionM3).toBeUndefined()
    expect(fixtureLinkSectionText(result.sources[0]))
      .toBe(' × 幅 0.6 × 深さ 0.8')
    expect(result.warnings).toEqual([])
  })

  it('埋戻しはFEP30の外径40mmで管の体積を引く', () => {
    const result = calculate(backfill())
    const deductionM3 = pipeAreaM2 * lengthM

    expect(result.total).toBeCloseTo(lengthM * 0.48 - deductionM3, 12)
    expect(result.sources[0].pipeOuterDiameterMm).toBe(40)
    expect(result.sources[0].pipeDeductionM3).toBeCloseTo(deductionM3, 12)
    expect(fixtureLinkSectionText(result.sources[0]))
      .toBe(' × 幅 0.6 × 深さ 0.8 − 管 φ40mm 0.0055')
    expect(result.warnings).toEqual([])
  })

  it('外径不明では控除せず、同じ警告を複数行で繰り返さない', () => {
    const unknown: CountFixture = {
      ...pipe,
      code: '未知管',
    }
    const result = calculate(backfill(), [row(2), row(3)], unknown)

    expect(result.total).toBeCloseTo(5 * 0.48, 12)
    expect(result.sources[0].pipeDeductionM3).toBeUndefined()
    expect(result.sources[0].pipeOuterDiameterMm).toBeUndefined()
    expect(result.warnings).toEqual([missingDiameterWarning])
  })

  it('外径不明の警告は記号＋規格、どちらもなければ名称を使う', () => {
    for (const [code, spec, label] of [
      ['未知', '規格', '未知規格'],
      ['', undefined, pipe.name],
    ] as const) {
      const original: CountFixture = { ...pipe, code, spec }
      const result = calculate(backfill(), [row(1)], original)

      expect(result.warnings).toEqual([
        `${label} の外径が分からないため引いていません（項目の質量・寸法に外径を入れてください）`,
      ])
    }
  })

  it('planとpartなしだけを数え、riseとslackは数量と控除の両方から除く', () => {
    const result = calculate(backfill(), [
      row(2, { part: 'plan' }),
      row(3),
      row(7, { part: 'rise' }),
      row(11, { part: 'slack' }),
    ])

    expect(result.total).toBeCloseTo(5 * 0.48 - pipeAreaM2 * 5, 12)
    expect(result.sources[0].quantity).toBe(5)
    expect(result.sources[0].pipeDeductionM3).toBeCloseTo(pipeAreaM2 * 5, 12)
    expect(result.entries.filter(entry =>
      entry.part === 'rise' || entry.part === 'slack').map(entry => entry.value))
      .toEqual([0, 0])
  })

  it('施工条件を先に絞り、連動ではbackfill.conditionIncludesを使わない', () => {
    const target = withSource({
      ...backfill(),
      backfill: {
        deductPipes: true,
        conditionIncludes: ['一致しない語'],
      },
    }, {
      itemId: pipe.id,
      factor: 1,
      conditions: ['地中埋設'],
    })
    const result = calculate(target, [
      row(4, { part: 'plan', condition: '地中埋設' }),
      row(20, { part: 'plan', condition: '露出' }),
      row(30, { part: 'rise', condition: '地中埋設' }),
    ])

    expect(result.sources[0].quantity).toBe(4)
    expect(result.total).toBeCloseTo(4 * 0.48 - pipeAreaM2 * 4, 12)
    expect(result.warnings).toEqual([])
  })

  it('条件で除外した行や立上りだけでは外径不明の警告を出さない', () => {
    const target = withSource(backfill(), {
      itemId: pipe.id,
      factor: 1,
      conditions: ['地中埋設'],
    })
    const unknown: CountFixture = { ...pipe, code: '未知管' }
    const result = calculate(target, [
      row(5, { part: 'plan', condition: '露出' }),
      row(7, { part: 'rise', condition: '地中埋設' }),
    ], unknown)

    expect(result.total).toBe(0)
    expect(result.sources[0].quantity).toBe(0)
    expect(result.sources[0].pipeDeductionM3).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  it('幅・深さが未設定・0・負・非有限なら従来の係数計算に戻す', () => {
    const defaultsCases: CountFixture['defaults'][] = [
      undefined,
      { depthM: 0.8 },
      { widthM: 0.6 },
      { widthM: 0, depthM: 0.8 },
      { widthM: 0.6, depthM: 0 },
      { widthM: -0.6, depthM: 0.8 },
      { widthM: 0.6, depthM: -0.8 },
      { widthM: Number.NaN, depthM: 0.8 },
      { widthM: 0.6, depthM: Number.NaN },
      { widthM: Number.POSITIVE_INFINITY, depthM: 0.8 },
      { widthM: 0.6, depthM: Number.POSITIVE_INFINITY },
    ]
    for (const defaults of defaultsCases) {
      const target = withSource({ ...backfill(), defaults }, {
        itemId: pipe.id,
        factor: 2,
      })
      const result = calculate(target, [
        row(2, { part: 'plan' }),
        row(3, { part: 'rise' }),
      ])

      expect(result.total).toBe(10)
      expect(result.sources[0].quantity).toBe(5)
      expect(result.sources[0].section).toBeUndefined()
      expect(result.sources[0].pipeDeductionM3).toBeUndefined()
      expect(fixtureLinkSectionText(result.sources[0])).toBe('')
      expect(result.warnings).toEqual([
        '埋戻しの幅・深さが未設定のため、元の長さ × 係数のままです。',
      ])
    }
  })

  it('元が体積なら従来の係数計算を維持する', () => {
    const original: CountFixture = {
      ...pipe,
      name: '根切り',
      code: '根切り',
      kind: 'volume',
      method: 'lengthWidthDepth',
      defaults: { widthM: 1, depthM: 1 },
    }
    const target = withSource(backfill(), {
      itemId: original.id,
      factor: 2,
    })
    const result = calculate(target, [row(3)], original)

    expect(result.total).toBe(6)
    expect(result.sources[0].section).toBeUndefined()
    expect(result.sources[0].pipeDeductionM3).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  it('連動先がlengthWidthDepth以外なら従来の係数計算を維持する', () => {
    const target = withSource({
      ...trench,
      method: 'polygonDepth',
    }, {
      itemId: pipe.id,
      factor: 2,
    })
    const result = calculate(target, [row(3)])

    expect(result.total).toBe(6)
    expect(result.sources[0].section).toBeUndefined()
    expect(fixtureLinkSectionText(result.sources[0])).toBe('')
    expect(result.warnings).toEqual([])
  })

  it('係数2を総体積に掛け、管の控除には掛けない', () => {
    const target = withSource(backfill(), {
      itemId: pipe.id,
      factor: 2,
    })
    const result = calculate(target)

    expect(result.total).toBeCloseTo(lengthM * 2 * 0.48 - pipeAreaM2 * lengthM, 12)
    expect(result.sources[0].pipeDeductionM3)
      .toBeCloseTo(pipeAreaM2 * lengthM, 12)
  })

  it('perMで割った値に断面を掛け、管の控除にはperMを使わない', () => {
    const target = withSource(backfill(), {
      itemId: pipe.id,
      perM: 2,
    })
    const result = calculate(target)

    expect(result.total).toBeCloseTo(lengthM / 2 * 0.48 - pipeAreaM2 * lengthM, 12)
    expect(result.sources[0].pipeDeductionM3)
      .toBeCloseTo(pipeAreaM2 * lengthM, 12)
  })

  it('控除で負になる行は0にし、警告は1回だけ出す', () => {
    const target: CountFixture = {
      ...backfill(),
      defaults: { widthM: 0.01, depthM: 0.01 },
    }
    const result = calculate(target, [row(1), row(2)])

    expect(result.total).toBe(0)
    expect(result.entries.map(entry => entry.value)).toEqual([0, 0])
    expect(result.sources[0].quantity).toBe(3)
    expect(result.sources[0].pipeDeductionM3).toBeCloseTo(pipeAreaM2 * 3, 12)
    expect(result.warnings).toEqual([excessiveDeductionWarning])
  })

  it('signは断面と控除を計算した後に掛ける', () => {
    const target = withSource(backfill(), {
      itemId: pipe.id,
      factor: 2,
      sign: -1,
    })
    const result = calculate(target)
    const volumeM3 = lengthM * 2 * 0.48 - pipeAreaM2 * lengthM

    expect(result.sources[0].subtotal).toBeCloseTo(-volumeM3, 12)
    expect(result.sources[0].pipeDeductionM3)
      .toBeCloseTo(pipeAreaM2 * lengthM, 12)
    // 既存の最終集計処理は負の合計と出力行を0にする。
    expect(result.total).toBe(0)
    expect(result.entries[0].value).toBe(0)
  })

  it('massの連動には断面や管の控除を適用しない', () => {
    const original: CountFixture = {
      ...pipe,
      attributes: { unitMassKg: 2 },
    }
    const target: CountFixture = {
      ...backfill(),
      kind: 'length',
      method: 'polyline',
      link: {
        kind: 'mass',
        rounding: 'none',
        sources: [{ itemId: pipe.id, factor: 2 }],
      },
    }
    const result = calculate(target, [row(3)], original)

    expect(result.total).toBeCloseTo(3 * 2 * 2 / 1000, 12)
    expect(result.sources[0].section).toBeUndefined()
    expect(result.sources[0].pipeDeductionM3).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  it('表示は幅・深さを小数3桁で丸め、控除を小数4桁で表示する', () => {
    expect(fixtureLinkSectionText({
      itemId: pipe.id,
      quantity: 1,
      subtotal: 0,
      section: { widthM: 0.6004, depthM: 0.8126 },
      pipeDeductionM3: 0.005485,
      pipeOuterDiameterMm: 40,
    })).toBe(' × 幅 0.6 × 深さ 0.813 − 管 φ40mm 0.0055')

    expect(fixtureLinkSectionText({
      itemId: pipe.id,
      quantity: 1,
      subtotal: 1,
    })).toBe('')
  })
})
