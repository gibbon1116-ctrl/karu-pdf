import { describe, expect, it } from 'vitest'
import { computeRcMember, rcMemberError, type RcMember } from '../src/core/rcMember'

type Metrics = Parameters<typeof computeRcMember>[1]

function metrics(
  method: Metrics['method'],
  lengthM: number,
  count = 1,
  heightM?: number,
): Metrics {
  return {
    method,
    count,
    lengthM,
    areaM2: method === 'lengthHeight' ? lengthM * (heightM ?? 0) : 0,
    perimeterM: 0,
    ...(heightM !== undefined ? { heightM } : {}),
  } as Metrics
}

function barsWithoutDimensionText(result: ReturnType<typeof computeRcMember>) {
  return result.bars.map(({ shapeDimensionText: _text, ...bar }) => bar)
}

describe('SPEC-B27: 線で拾うRC部材', () => {
  const column: RcMember = {
    kind: 'column',
    widthMm: 600,
    depthMm: 600,
    bars: [
      { role: 'main', size: 'D22', count: 12 },
      { role: 'hoop', size: 'D10', spacingMm: 100 },
    ],
  }

  it('柱の線3.5mを高さにし、断面と周長で計算する', () => {
    const result = computeRcMember(column, metrics('polyline', 3.5))
    expect(result.concreteM3).toBeCloseTo(1.26, 12)
    expect(result.formworkM2).toBeCloseTo(8.4, 12)
    expect(result.shapeDimensionText).toBe(
      '柱 0.60×0.60m 断面の周長 2.40m × 長さ 3.50m',
    )
    expect(result.bars.find(bar => bar.role === 'hoop')).toMatchObject({
      count: 36,
      spanM: 3.5,
      perLayerCount: 36,
      spacingMm: 100,
    })
    expect(result.bars.find(bar => bar.role === 'hoop')!.lengthM)
      .toBeCloseTo(36 * 2.4, 12)
  })

  it('主筋・継手は同じ高さの既存の個数拾いと一致する', () => {
    for (const joint of ['lap', 'gas'] as const) {
      const member = { ...column, joint }
      const line = computeRcMember(member, metrics('polyline', 3.5, 2))
      const click = computeRcMember(
        { ...member, heightMm: 3500 },
        metrics('click', 0, 2),
      )
      expect(line.concreteM3).toBeCloseTo(click.concreteM3, 12)
      expect(line.formworkM2).toBeCloseTo(click.formworkM2, 12)
      expect(barsWithoutDimensionText(line)).toEqual(barsWithoutDimensionText(click))
      expect(line.lapJoints).toBe(click.lapJoints)
      expect(line.gasJoints).toEqual(click.gasJoints)
    }
  })

  it('線の柱のheightMmは計算に使わず、線の重なりを乗じる', () => {
    const result = computeRcMember(
      { ...column, heightMm: 9000 },
      metrics('polyline', 3.5, 3),
    )
    expect(result.concreteM3).toBeCloseTo(3.78, 12)
    expect(result.formworkM2).toBeCloseTo(25.2, 12)
    expect(result.bars.find(bar => bar.role === 'hoop')!.count).toBe(108)
  })

  const wall: RcMember = {
    kind: 'wall',
    thicknessMm: 200,
    heightMm: 3000,
    bars: [
      { role: 'vertical', size: 'D13', spacingMm: 200, layers: 2 },
      { role: 'horizontal', size: 'D13', spacingMm: 200, layers: 2 },
    ],
  }

  it('壁の線5m、厚さ0.2m、高さ3mから3㎥・30㎡を計算する', () => {
    const result = computeRcMember(wall, metrics('polyline', 5))
    expect(result.concreteM3).toBeCloseTo(3, 12)
    expect(result.formworkM2).toBeCloseTo(30, 12)
    expect(result.shapeDimensionText).toBe(
      '壁 長さ 5.00m × 高さ 3.00m × 厚さ 0.20m',
    )
  })

  it('壁の縦筋・横筋は既存の長さ×高さ拾いと一致する', () => {
    const line = computeRcMember(wall, metrics('polyline', 5, 2))
    const area = computeRcMember(wall, metrics('lengthHeight', 5, 2, 3))
    expect(line.concreteM3).toBe(area.concreteM3)
    expect(line.formworkM2).toBe(area.formworkM2)
    expect(barsWithoutDimensionText(line)).toEqual(barsWithoutDimensionText(area))
    expect(line.lapJoints).toBe(area.lapJoints)
    expect(line.gasJoints).toEqual(area.gasJoints)
  })

  it('線の柱は幅・せい、線の壁は厚さ・高さを必須とする', () => {
    expect(rcMemberError(column, { fromLine: true })).toBeUndefined()
    expect(rcMemberError(column)).toBe('RC部材の高さを入れてください。')
    expect(rcMemberError({ ...column, widthMm: undefined }, { fromLine: true }))
      .toBe('RC部材の幅とせい・長さを入れてください。')
    expect(rcMemberError({ ...column, depthMm: undefined }, { fromLine: true }))
      .toBe('RC部材の幅とせい・長さを入れてください。')
    expect(rcMemberError({ ...wall, heightMm: undefined }, { fromLine: true }))
      .toBe('RC部材の高さを入れてください。')
    expect(rcMemberError({ ...wall, thicknessMm: undefined }, { fromLine: true }))
      .toBe('RC部材の厚さを入れてください。')
  })

  it('独立基礎を線で拾うことは許可しない', () => {
    expect(() => computeRcMember({
      kind: 'footing', widthMm: 1000, depthMm: 1000, heightMm: 500, bars: [],
    }, metrics('polyline', 5))).toThrow(
      'RC部材の種類と拾い方・必要な寸法が一致していません。',
    )
  })

  it('既存の梁・基礎梁の計算を維持する', () => {
    const beam: RcMember = {
      kind: 'beam', widthMm: 300, depthMm: 600, slabDeductMm: 100, bars: [],
    }
    const result = computeRcMember(beam, metrics('polyline', 5, 2))
    expect(result.concreteM3).toBeCloseTo(1.5, 12)
    expect(result.formworkM2).toBeCloseTo(13, 12)
    expect(result.shapeDimensionText).toBeUndefined()
    const foundation = computeRcMember(
      { ...beam, kind: 'foundationBeam' },
      metrics('polyline', 5, 2),
    )
    expect(foundation.concreteM3).toBeCloseTo(1.5, 12)
    expect(foundation.formworkM2).toBeCloseTo(10, 12)
  })
})
