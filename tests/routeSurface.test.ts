import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import { isRouteSurfaceFixture, surfacePerimeterM } from '../src/core/routeSurface'

function fixture(change: Partial<CountFixture> = {}): CountFixture {
  return {
    id: 'duct', name: 'ダクト', code: 'SD', category: 'ダクト', order: 0,
    kind: 'length', method: 'polyline',
    style: {
      shape: 'circle', fill: 'none', color: [0, 0, 1],
      size: 10, opacity: 1, showCode: true,
    },
    ...change,
  }
}

describe('surfacePerimeterM', () => {
  it('㎡への換算係数を寸法より優先し、小数3桁に丸める', () => {
    expect(surfacePerimeterM(fixture({
      spec: '500×300',
      convert: { factor: 2.3456, unit: '㎡', basis: '周長' },
    }))).toBe(2.346)
  })

  it.each(['500×300', '500x300', '500X300', '500＊300', '500*300'])(
    '規格 %s の長方形の周長を求める',
    spec => {
      expect(surfacePerimeterM(fixture({ spec }))).toBe(1.6)
    },
  )

  it('名前からも長方形の寸法を読む', () => {
    expect(surfacePerimeterM(fixture({
      spec: '寸法未設定', name: 'ダクト 500 × 300',
    }))).toBe(1.6)
  })

  it('小数を含む寸法をmmとして読む', () => {
    expect(surfacePerimeterM(fixture({ spec: '500.5 × 300.5' }))).toBe(1.602)
  })

  it.each(['φ200', 'Φ200'])('%s の円周を小数3桁に丸める', spec => {
    expect(surfacePerimeterM(fixture({ spec }))).toBe(0.628)
  })

  it('規格の円形寸法より、名前の長方形寸法を優先する', () => {
    expect(surfacePerimeterM(fixture({
      spec: 'φ200', name: 'ダクト 500×300',
    }))).toBe(1.6)
  })

  it('㎡以外の換算係数は周長に使わない', () => {
    expect(surfacePerimeterM(fixture({
      spec: '500×300',
      convert: { factor: 9, unit: 'kg', basis: '質量' },
    }))).toBe(1.6)
  })

  it('正の有限値でない換算係数は寸法へフォールバックする', () => {
    for (const factor of [0, -1, NaN, Infinity]) {
      expect(surfacePerimeterM(fixture({
        spec: '500×300',
        convert: { factor, unit: '㎡', basis: '周長' },
      }))).toBe(1.6)
    }
  })

  it('寸法が決まらない場合は値を入れない', () => {
    expect(surfacePerimeterM(fixture())).toBeUndefined()
  })

  it('保存可能な周長の範囲を守る', () => {
    expect(surfacePerimeterM(fixture({
      convert: { factor: 10000, unit: '㎡', basis: '周長' },
    }))).toBe(10000)
    expect(surfacePerimeterM(fixture({
      convert: { factor: 10000.001, unit: '㎡', basis: '周長' },
    }))).toBeUndefined()
    expect(surfacePerimeterM(fixture({ spec: 'φ0.01' }))).toBeUndefined()
  })
})

describe('isRouteSurfaceFixture', () => {
  it.each(['polygon', 'lengthHeight'] as const)(
    '連動でない面積の項目（%s）を許す',
    method => {
      expect(isRouteSurfaceFixture(fixture({ kind: 'area', method }))).toBe(true)
    },
  )

  it('換算後の単位だけでは面積の線要素にしない', () => {
    expect(isRouteSurfaceFixture(fixture({
      convert: { factor: 1.6, unit: '㎡', basis: '周長' },
    }))).toBe(false)
  })

  it('連動のある面積の項目を許さない', () => {
    const linked = fixture({ kind: 'area', method: 'polygon' })
    // ここでは連動の内容ではなく、link が存在することだけを検査する。
    linked.link = {} as NonNullable<CountFixture['link']>
    expect(isRouteSurfaceFixture(linked)).toBe(false)
  })
})
