import { expect, it } from 'vitest'
import {
  quantityDecimals, quantityOutputKind, quantityUnit, type CountFixture,
} from '../src/core/countFixtures'

function fixture(
  kind: CountFixture['kind'] = 'count',
  fields: Partial<CountFixture> = {},
): CountFixture {
  return {
    id: 'L', name: '連動', code: 'L', category: '例', order: 0, kind,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: .8, showCode: true,
    },
    ...fields,
  }
}

it.each(['count', 'length', 'area', 'volume'] as const)(
  '質量の連動は元の種別が%sでもt・2桁・massになる',
  kind => {
    const f = fixture(kind, {
      link: { kind: 'mass', sources: [{ itemId: 'S' }], rounding: 'none' },
    })
    expect(quantityUnit(f)).toBe('t')
    expect(quantityDecimals(f)).toBe(2)
    expect(quantityOutputKind(f)).toBe('mass')
  },
)

it.each(['count', 'length', 'area', 'volume'] as const)(
  '見かけ比重のある質量の連動は元の種別が%sでも㎥・2桁・volumeになる',
  kind => {
    const f = fixture(kind, {
      link: {
        kind: 'mass', sources: [{ itemId: 'S' }],
        rounding: 'none', densityTPerM3: .5,
      },
    })
    expect(quantityUnit(f)).toBe('㎥')
    expect(quantityDecimals(f)).toBe(2)
    expect(quantityOutputKind(f)).toBe('volume')
  },
)

it('係数の連動は個数の単位と0桁を保つ', () => {
  const f = fixture(undefined, {
    unit: '台',
    link: { kind: 'factor', sources: [{ itemId: 'S', factor: 2 }] },
  })
  expect(quantityUnit(f)).toBe('台')
  expect(quantityDecimals(f)).toBe(0)
  expect(quantityOutputKind(f)).toBe('count')
})

it.each([
  ['length', 'm', 'length'],
  ['area', 'm²', 'area'],
  ['volume', 'm³', 'volume'],
] as const)('係数の連動は%sの単位と出力種別を保つ', (kind, unit, outputKind) => {
  const f = fixture(kind, {
    link: { kind: 'factor', sources: [{ itemId: 'S' }] },
  })
  expect(quantityUnit(f)).toBe(unit)
  expect(quantityDecimals(f)).toBe(2)
  expect(quantityOutputKind(f)).toBe(outputKind)
})

it('連動のない個数と数量の換算の単位・桁・出力種別を保つ', () => {
  const ordinary = fixture()
  expect(quantityUnit(ordinary)).toBe('個')
  expect(quantityDecimals(ordinary)).toBe(0)
  expect(quantityOutputKind(ordinary)).toBe('count')

  const converted = fixture('count', {
    convert: { factor: .25, unit: '㎡', basis: '例' },
  })
  expect(quantityUnit(converted)).toBe('㎡')
  expect(quantityDecimals(converted)).toBe(2)
  expect(quantityOutputKind(converted)).toBe('area')
})

it('quantityUnitはlinkを含む最小の引数で呼べる', () => {
  expect(quantityUnit({
    link: { kind: 'mass', sources: [], densityTPerM3: .5 },
  })).toBe('㎥')
})

it('never rounds up a mass link, even when the linked item is a count item', async () => {
  const { computeLinks, fixtureLinkRoundsUp } = await import('../src/core/fixtureLink')
  const source = fixture('count', { id: 'DL', code: 'DL', attributes: { massKg: 2 } })
  const waste = fixture('count', { id: 'W', code: 'W', link: { kind: 'mass', sources: [{ itemId: 'DL' }] } })
  expect(fixtureLinkRoundsUp(waste)).toBe(false)
  const entries = [0, 1, 2].map(i => ({ itemId: 'DL', annotationId: 'a' + i, pageIndex: 0, value: 1 }))
  const result = computeLinks([source, waste], itemId => itemId === 'DL' ? entries : [])
  expect(result.get('W')!.total).toBeCloseTo(0.006, 9)
})
