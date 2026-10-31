import { describe, expect, it } from 'vitest'
import type {
  BreakdownBook,
  CountFixture,
  SummaryField,
} from '../src/core/countFixtures'
import {
  computeLinks,
  fixtureLinkError,
  fixtureLinkSources,
  readFixtureLink,
  type FixtureLink,
  type LinkSourceEntry,
} from '../src/core/fixtureLink'
import { linkFromRule } from '../src/core/breakdown/linkFromRule'
import {
  carryAutoFor,
  linkRuleForDetail,
} from '../src/core/breakdown/linkRules'
import * as mechanicalDetails from '../src/core/breakdown/mechanicalDetails'

const style: CountFixture['style'] = {
  shape: 'circle',
  fill: 'none',
  color: [1, 0, 0],
  size: 10,
  opacity: .8,
  showCode: true,
}

function fixture(
  id: string,
  options: Partial<CountFixture> = {},
): CountFixture {
  return {
    id,
    name: id,
    code: id,
    category: '例',
    kind: 'count',
    style,
    order: 0,
    ...options,
  }
}

function position(book: BreakdownBook): NonNullable<CountFixture['breakdown']> {
  return {
    book,
    section: '例',
    subject: '例',
    item: '例',
  }
}

function carryRule(name = '機器搬入') {
  const rule = linkRuleForDetail(name)
  if (rule === undefined) throw new Error(`${name}の標準規則がありません。`)
  return rule
}

function carry(
  id: string,
  book?: BreakdownBook,
  summary: readonly SummaryField[] = [],
  alone = false,
  name = '機器搬入',
): CountFixture {
  const link = linkFromRule(carryRule(name), name, summary, book)
  if (alone) link.carry = { ...link.carry, alone: true }

  return fixture(id, {
    name,
    link,
    ...(book !== undefined ? { breakdown: position(book) } : {}),
  })
}

function row(
  itemId: string,
  value = 1,
  condition?: string,
): LinkSourceEntry {
  return {
    itemId,
    value,
    annotationId: `${itemId}-${condition ?? 'count'}`,
    pageIndex: 0,
    ...(condition !== undefined ? { condition } : {}),
  }
}

function calculate(
  fixtures: readonly CountFixture[],
  rows: readonly LinkSourceEntry[],
) {
  return computeLinks(
    fixtures,
    id => rows.filter(entry => entry.itemId === id),
  )
}

function panel(): CountFixture {
  return fixture('panel', {
    name: '高圧引込盤',
    category: '盤類',
    unit: '面',
    breakdown: position('電気設備'),
    attributes: {
      massKg: 500,
      widthMm: 1000,
      depthMm: 2350,
      heightMm: 1000,
    },
  })
}

function fan(): CountFixture {
  return fixture('fan', {
    name: '送風機',
    breakdown: position('機械設備'),
    attributes: {
      massKg: 800,
      widthMm: 1000,
      depthMm: 1000,
      heightMm: 1000,
    },
  })
}

describe('SPEC-T15 搬入・搬出', () => {
  it('電気と機械を分け、区分未選択は元ごとの補正率で計算する', () => {
    const electrical = carry('electrical', '電気設備')
    const mechanical = carry('mechanical', '機械設備')
    const control = fixture('control', {
      name: '照明制御盤',
      breakdown: position('電気設備'),
      attributes: {
        massKg: 150,
        widthMm: 1000,
        depthMm: 1000,
        heightMm: 1000,
      },
    })
    const fixtures = [panel(), fan(), control, electrical, mechanical]
    const results = calculate(fixtures, [
      row('panel'),
      row('fan'),
      row('control'),
    ])

    expect(electrical.link?.carry).toEqual({})
    expect(mechanical.link?.carry).toEqual({})
    expect(Object.hasOwn(electrical.link!.carry!, 'class')).toBe(false)

    expect(results.get('electrical')!.total).toBeCloseTo(.85, 12)
    expect(results.get('electrical')!.sources).toHaveLength(1)
    expect(results.get('electrical')!.sources[0]).toMatchObject({
      itemId: 'panel',
      quantity: 1,
      unitMassKg: 500,
      factor: 1.7,
      note: '容積品 213kg/㎥・補正率 1.70',
    })
    expect(results.get('electrical')!.warnings).toEqual([])

    expect(results.get('mechanical')!.total).toBeCloseTo(.88, 12)
    expect(results.get('mechanical')!.sources).toHaveLength(1)
    expect(results.get('mechanical')!.sources[0]).toMatchObject({
      itemId: 'fan',
      unitMassKg: 800,
      factor: 1.1,
      note: '重量品 800kg・補正率 1.10',
    })

    expect(fixtureLinkSources(fixtures, electrical).map(source => source.itemId))
      .toEqual(['panel'])
    expect(fixtureLinkSources(fixtures, mechanical).map(source => source.itemId))
      .toEqual(['fan'])
  })

  it('編不明なら重量品・容積品を同じ連動に合計する', () => {
    const target = carry('both')
    const result = calculate(
      [panel(), fan(), target],
      [row('panel'), row('fan')],
    ).get('both')!

    expect(result.total).toBeCloseTo(.85 + .88, 12)
    expect(result.sources.map(source => source.itemId)).toEqual(['panel', 'fan'])
    expect(result.warnings).toEqual([])
  })

  it('電気の重量品指定は容積品を除外して理由を警告する', () => {
    const target = carry('heavy', '電気設備', [
      { label: '区分', value: '重量品' },
    ])
    const result = calculate([panel(), target], [row('panel')]).get('heavy')!

    expect(result.total).toBe(0)
    expect(result.entries).toHaveLength(0)
    expect(result.sources[0]).toMatchObject({
      itemId: 'panel',
      quantity: 1,
      subtotal: 0,
      note: '容積品 213kg/㎥（区分違い: 重量品だけ）',
    })
    expect(result.sources[0].factor).toBeUndefined()
    expect(result.warnings).toEqual([
      '高圧引込盤は容積品（213kg/㎥）のため、'
      + '区分『重量品』のこの項目には入れていません。'
      + '区分を外すと重量品・容積品の両方を合計します。',
    ])
  })

  it('電気の容積品指定と単独搬入を計算する', () => {
    const bulky = carry('bulky', '電気設備', [
      { label: '区分', value: '容積品' },
    ])
    const alone = carry('alone', '電気設備', [], true)
    const results = calculate([panel(), bulky, alone], [row('panel')])

    expect(results.get('bulky')!.total).toBeCloseTo(.85, 12)
    expect(results.get('bulky')!.warnings).toEqual([])
    expect(results.get('alone')!.total).toBeCloseTo(.85 * 1.3, 12)
    expect(results.get('alone')!.sources[0].factor).toBeCloseTo(1.7 * 1.3, 12)
    expect(results.get('alone')!.sources[0].note)
      .toBe('容積品 213kg/㎥・補正率 2.21')
  })

  it.each([
    [[], undefined],
    [[{ label: '区分', value: '' }], undefined],
    [[{ label: ' 区分 ', value: ' 重量品 ' }], 'heavy'],
    [[{ label: '区分', value: '容積品' }], 'bulky'],
  ] satisfies Array<[
    SummaryField[],
    NonNullable<FixtureLink['carry']>['class'],
  ]>)('摘要の区分 %j を反映する', (summary, expectedClass) => {
    const link = linkFromRule(carryRule(), '機器搬入', summary, '電気設備')
    expect(link.carry?.class).toBe(expectedClass)
    expect(Object.hasOwn(link.carry!, 'class'))
      .toBe(expectedClass !== undefined)
  })

  it('booksは位置の無い項目を除外せず、位置のある他編の項目を除外する', () => {
    const withoutPosition = fixture('without-position', {
      name: '変圧器',
      attributes: {
        massKg: 500,
        widthMm: 1000,
        depthMm: 1000,
        heightMm: 1000,
      },
    })
    const otherBook = fixture('other-book', {
      ...withoutPosition,
      id: 'other-book',
      breakdown: position('建築'),
    })
    const target = carry('electrical', '電気設備')

    expect(fixtureLinkSources(
      [withoutPosition, otherBook, target],
      target,
    ).map(source => source.itemId)).toEqual(['without-position'])
  })

  it('booksと名称による自動選択の制限は手動の元を削除しない', () => {
    const target = carry('manual', '電気設備')
    target.link!.sources = [{ itemId: 'fan' }]

    const result = calculate([fan(), target], [row('fan')]).get('manual')!
    expect(result.total).toBeCloseTo(.88, 12)
    expect(result.sources.map(source => source.itemId)).toEqual(['fan'])
  })

  it('旧データのclass指定・books省略と既存の手動係数の扱いを維持する', () => {
    const legacy = fixture('legacy', {
      link: {
        kind: 'carry',
        sources: [{ itemId: 'fan', factor: 9 }],
        auto: { kinds: ['count'], minMassKg: 100 },
        carry: { class: 'heavy', alone: true },
      },
    })
    const result = calculate(
      [panel(), fan(), legacy],
      [row('panel'), row('fan', 2)],
    ).get('legacy')!

    expect(result.total).toBeCloseTo(2 * .8 * 1.1 * 1.3, 12)
    expect(result.sources.find(source => source.itemId === 'fan')!.factor)
      .toBeCloseTo(1.1 * 1.3, 12)
    expect(result.sources.find(source => source.itemId === 'panel')!.subtotal)
      .toBe(0)
    expect(legacy.link!.auto!.books).toBeUndefined()
  })

  it('質量・外形不足、100kg未満、個数以外は理由を記録する', () => {
    const originals = [
      fixture('missing-mass'),
      fixture('missing-size', { attributes: { massKg: 300 } }),
      fixture('small', { attributes: { massKg: 99 } }),
      fixture('length', { kind: 'length' }),
    ]
    const target = fixture('excluded', {
      link: {
        kind: 'carry',
        sources: originals.map(original => ({ itemId: original.id })),
        carry: {},
      },
    })
    const result = calculate(
      [...originals, target],
      originals.map(original => row(original.id)),
    ).get('excluded')!

    expect(result.total).toBe(0)
    expect(result.sources.map(source => source.note)).toEqual([
      '質量未設定',
      '外形未設定',
      '100kg未満',
      '対象外の機器（個数以外）',
    ])
    expect(result.sources.every(source => source.factor === undefined)).toBe(true)
  })

  it('重量品の根拠質量を桁区切り付きで示す', () => {
    const original = fixture('heavy-equipment', {
      attributes: {
        massKg: 1250,
        widthMm: 1000,
        depthMm: 1000,
        heightMm: 1000,
      },
    })
    const target = fixture('carry', {
      link: {
        kind: 'carry',
        sources: [{ itemId: original.id }],
        carry: {},
      },
    })
    const result = calculate([original, target], [row(original.id)]).get('carry')!

    expect(result.total).toBeCloseTo(1.25 * .85, 12)
    expect(result.sources[0].note).toBe('重量品 1,250kg・補正率 0.85')
  })

  it('搬出は対象編の撤去（廃棄）の数量だけを合計する', () => {
    const original = {
      ...fan(),
      conditions: ['新設', '撤去（廃棄）'],
    }
    const target = carry('out', '機械設備', [], false, '機器搬出')
    const result = calculate(
      [original, target],
      [row('fan', 5, '新設'), row('fan', 2, '撤去（廃棄）')],
    ).get('out')!

    expect(target.link?.auto).toMatchObject({
      books: ['機械設備'],
      condition: '撤去（廃棄）',
    })
    expect(result.total).toBeCloseTo(2 * .8 * 1.1, 12)
    expect(result.sources[0].quantity).toBe(2)
  })

  it('carryAutoForは元の規則を変更せず、最低質量・撤去条件を維持する', () => {
    const base = carryRule('機器搬出').auto
    const snapshot = structuredClone(base)
    const electrical = carryAutoFor('電気設備', base)
    const mechanical = carryAutoFor('機械設備', base)

    expect(base).toEqual(snapshot)
    expect(electrical).toMatchObject({
      books: ['電気設備'],
      kinds: ['count'],
      minMassKg: 100,
      condition: '撤去（廃棄）',
    })
    expect(electrical.nameIncludes).toEqual([
      '受配電盤', '受電盤', '配電盤', '引込盤', '高圧',
      'キュービクル', '変圧器', 'トランス', 'コンデンサ',
      'リアクトル', '直流電源', '蓄電池', '電力貯蔵', '無停電',
    ])
    expect(mechanical).toEqual({ ...snapshot, books: ['機械設備'] })
    expect(carryAutoFor(undefined, base)).toEqual(snapshot)
    expect(carryAutoFor('建築', base)).toEqual(snapshot)
    expect(carryAutoFor('昇降機設備', base)).toEqual(snapshot)
    expect(electrical.kinds).not.toBe(base.kinds)
  })
})

describe('SPEC-T15 検証・複製・保存読込', () => {
  function error(link: unknown) {
    return fixtureLinkError({ id: 'L', link: link as FixtureLink })
  }

  it('classとbooksの省略を許す', () => {
    expect(error({
      kind: 'carry',
      sources: [],
      carry: {},
    })).toBeUndefined()
    expect(error({
      kind: 'carry',
      sources: [],
      carry: { alone: true },
      auto: { kinds: ['count'] },
    })).toBeUndefined()
    expect(error({
      kind: 'carry',
      sources: [],
      carry: {},
      auto: { books: ['建築', '電気設備', '機械設備', '昇降機設備'] },
    })).toBeUndefined()
  })

  it.each([
    [],
    ['電気設備', '電気設備', '電気設備', '電気設備', '電気設備'],
    ['不明'],
    [1],
    '電気設備',
    null,
  ])('不正なbooks %j を拒否する', books => {
    expect(error({
      kind: 'carry',
      sources: [],
      carry: {},
      auto: { books },
    })).toBeDefined()
  })

  it.each(['both', '', null, 0, false])(
    'classの省略以外の不正値 %j を拒否する',
    carryClass => {
      expect(error({
        kind: 'carry',
        sources: [],
        carry: { class: carryClass },
      })).toBeDefined()
    },
  )

  it('読込でbooksとcarryを複製し、classの省略を保つ', () => {
    const original = linkFromRule(
      carryRule(),
      '機器搬入',
      [],
      '電気設備',
    )
    const copied = readFixtureLink({ id: 'L', link: original })

    expect(copied).toEqual(original)
    expect(copied).not.toBe(original)
    expect(copied!.auto).not.toBe(original.auto)
    expect(copied!.auto!.books).not.toBe(original.auto!.books)
    expect(copied!.auto!.nameIncludes).not.toBe(original.auto!.nameIncludes)
    expect(copied!.carry).not.toBe(original.carry)
    expect(Object.hasOwn(copied!.carry!, 'class')).toBe(false)

    const saved = JSON.stringify(copied)
    const raw: unknown = JSON.parse(saved)
    const restored = readFixtureLink({ id: 'L', link: raw as FixtureLink })

    expect(restored).toEqual(original)
    expect(Object.hasOwn(restored!.carry!, 'class')).toBe(false)
    expect(fixtureLinkError({ id: 'L', link: restored! })).toBeUndefined()
  })

  it('旧形式のclassあり・booksなしも読込できる', () => {
    const legacy: FixtureLink = {
      kind: 'carry',
      sources: [],
      auto: { kinds: ['count'], minMassKg: 100 },
      carry: { class: 'heavy', alone: true },
    }
    const restored = readFixtureLink({ id: 'L', link: legacy })

    expect(restored).toEqual(legacy)
    expect(Object.hasOwn(restored!.auto!, 'books')).toBe(false)
    expect(fixtureLinkError({ id: 'L', link: restored! })).toBeUndefined()
  })
})

function findMechanicalCarryOut(
  value: unknown,
  visited = new Set<object>(),
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return undefined
  }
  visited.add(value)

  const record = value as Record<string, unknown>
  const group = record['搬入・据付費']
  if (Array.isArray(group)) {
    for (const item of group as unknown[]) {
      if (item !== null && typeof item === 'object') {
        const candidate = item as Record<string, unknown>
        if (candidate.name === '機器搬出') return candidate
      }
    }
  }

  for (const child of Object.values(record)) {
    const found = findMechanicalCarryOut(child, visited)
    if (found !== undefined) return found
  }
  return undefined
}

it('機械の標準マスタに搬出があり、区分未選択ではcarry-outのclassを省略する', () => {
  // 公開定数名に依存せず、公開されている機械明細データから対象を探す。
  const preset = findMechanicalCarryOut(mechanicalDetails)
  expect(preset).toMatchObject({
    name: '機器搬出',
    unit: 't',
    linked: 'carry',
    note: '改修の撤去機器（単価積算基準 第4編第2章第1節2）',
  })
  if (preset === undefined || typeof preset.name !== 'string') {
    throw new Error('機械の標準マスタに機器搬出がありません。')
  }

  const rule = carryRule(preset.name)
  expect(rule.id).toBe('carry-out')

  const link = linkFromRule(rule, preset.name, [], '機械設備')
  expect(link.kind).toBe('carry')
  expect(link.carry).toEqual({})
  expect(Object.hasOwn(link.carry!, 'class')).toBe(false)
  expect(link.auto).toMatchObject({
    books: ['機械設備'],
    kinds: ['count'],
    minMassKg: 100,
    condition: '撤去（廃棄）',
  })
})
