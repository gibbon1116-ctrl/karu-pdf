import { describe, expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import type { QuantityMark } from '../src/core/quantity'

const line: CountFixture = {
  id: 'line',
  order: 0,
  code: 'FEP',
  name: '埋設管',
  category: '電線管',
  kind: 'length',
  method: 'polyline',
  style: nextCountStyle([]),
}

const spiral: CountFixture = {
  ...line,
  id: 'spiral',
  order: 1,
  code: 'SP',
  spec: 'D10',
  name: 'スパイラル筋',
  category: '鉄筋',
  convert: { factor: 0.00056, unit: 't', basis: 'D10 0.56kg/m ÷ 1000' },
}

const trench: CountFixture = {
  ...line,
  id: 'trench',
  order: 2,
  code: '溝',
  name: 'ケーブル・配管の溝掘削',
  category: '土工',
  kind: 'volume',
  method: 'lengthWidthDepth',
  defaults: { widthM: 0.6, depthM: 0.8 },
}

function build(lengthM: number, quantity: Partial<QuantityMark>, fixtures: CountFixture[]) {
  return QuantityIndex.build([{
    id: 'annotation',
    pageIndex: 0,
    vertices: [[0, 0], [lengthM, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1,
      id: 'route',
      itemId: 'line',
      method: 'polyline',
      ...quantity,
    },
  }], fixtures)
}

describe('SPEC-B27: 線要素の数量索引', () => {
  it('10m×18.85を188.5mにし、後からD10のt換算を適用する', () => {
    const index = build(10, {
      extra: [{ itemId: 'spiral', count: 1, perM: 18.85 }],
    }, [line, spiral])
    expect(index.total('line')).toBe(10)
    expect(index.rawTotal('spiral')).toBeCloseTo(188.5, 12)
    expect(index.total('spiral')).toBeCloseTo(0.10556, 12)
    expect(index.entries('spiral')[0]).toMatchObject({
      raw: 188.5, routeCount: 1, routePerM: 18.85, part: 'plan',
    })
  })

  it('平面・立上り・余長の条件ごとに条数とperMを掛ける', () => {
    const unconverted = { ...spiral, convert: undefined }
    const index = build(10, {
      rises: [{ m: 3 }, { m: 2 }],
      slackM: 1,
      extra: [{
        itemId: 'spiral',
        count: 2,
        perM: 18.85,
        cond: { plan: '平面条件', rise: ['立上り条件', null], slack: '余長条件' },
      }],
    }, [line, unconverted])
    const conditions = index.byCondition('spiral')
    expect(conditions.get('平面条件')!.total).toBeCloseTo(377, 12)
    expect(conditions.get('立上り条件')!.total).toBeCloseTo(113.1, 12)
    expect(conditions.get('余長条件')!.total).toBeCloseTo(37.7, 12)
    expect(index.total('spiral')).toBeCloseTo(527.8, 12)
  })

  it('perMなしとperM=1の既存数量を維持する', () => {
    const unconverted = { ...spiral, convert: undefined }
    const base = {
      addM: 3,
      slackM: 1,
      extra: [{ itemId: 'spiral', count: 2, cond: { slack: null } }],
    }
    const without = build(10, base, [line, unconverted])
    const one = build(10, {
      ...base, extra: base.extra.map(member => ({ ...member, perM: 1 })),
    }, [line, unconverted])
    expect(without.total('line')).toBe(14)
    expect(without.total('spiral')).toBe(26)
    expect(one.total('spiral')).toBe(without.total('spiral'))
    expect(one.byPage('spiral')).toEqual(without.byPage('spiral'))
    expect(one.byCondition('spiral')).toEqual(without.byCondition('spiral'))
  })

  it('溝掘削25m×0.6m×0.8mは12㎥で立上り・余長を使わない', () => {
    const index = build(25, {
      widthM: 9,
      depthM: 9,
      rises: [{ m: 3 }, { m: 2 }],
      slackM: 4,
      extra: [{
        itemId: 'trench',
        count: 1,
        cond: { plan: '地中埋設', rise: '立上り条件', slack: '余長条件' },
      }],
    }, [line, trench])
    expect(index.total('line')).toBe(34)
    expect(index.total('trench')).toBeCloseTo(12, 12)
    expect(index.byCondition('trench').get('地中埋設')).toMatchObject({
      plan: 12, rise: 0, slack: 0,
    })
    expect(index.entries('trench')).toHaveLength(1)
    expect(index.entries('trench')[0]).toMatchObject({
      part: 'plan', routeWidthM: 0.6, routeDepthM: 0.8,
    })
  })

  it('溝掘削にも条数とperMを掛ける', () => {
    const index = build(25, {
      extra: [{ itemId: 'trench', count: 3, perM: 2 }],
    }, [line, trench])
    expect(index.total('trench')).toBeCloseTo(72, 12)
  })

  it('溝掘削の幅・深さが未設定なら0にする', () => {
    for (const defaults of [
      undefined, { widthM: 0.6 }, { depthM: 0.8 }, { widthM: 0, depthM: 0.8 },
    ]) {
      const index = build(25, {
        extra: [{ itemId: 'trench', count: 1 }],
      }, [line, { ...trench, defaults }])
      expect(index.total('trench')).toBe(0)
      expect(index.byPage('trench').get(0)).toBe(0)
    }
  })

  it('平面を除外した溝掘削は0でページ・場所を保持する', () => {
    const index = build(25, {
      floor: '1階',
      room: '屋外',
      rises: [{ m: 3 }],
      slackM: 4,
      extra: [{ itemId: 'trench', count: 1, cond: { plan: null } }],
    }, [line, trench])
    expect(index.total('trench')).toBe(0)
    expect(index.pagesOf('trench')).toEqual([0])
    expect(index.byFloor('trench').get('1階')).toBe(0)
    expect(index.byRoom('trench').get('屋外')).toBe(0)
  })

  it('連動の項目を追加要素として計上しない', () => {
    const linked: CountFixture = {
      ...trench,
      link: { kind: 'factor', sources: [{ itemId: 'line', factor: 1 }] },
    }
    const index = build(25, {
      extra: [{ itemId: 'trench', count: 5, perM: 2 }],
    }, [line, linked])
    expect(index.total('trench')).toBe(25)
  })
})
