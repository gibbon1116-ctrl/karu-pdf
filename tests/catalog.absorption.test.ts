import { describe, expect, it } from 'vitest'
import {
  catalogConditionsForFixture,
  catalogItems as catalogItemsIncludingStandard,
  catalogItemsForBreakdownRow,
  catalogPresets,
  conditionCandidatesFor,
  representativeBreakdownPosition,
  searchCatalog,
  type CatalogItem,
  type CatalogOption,
} from '../src/core/catalog'
import { breakdownEntries } from '../src/core/breakdownMaster'
import {
  MASTER_ABSORPTIONS,
  type MasterAbsorption,
  type MasterAbsorptionTarget,
} from '../src/core/breakdown/masterAbsorption'
import { MECHANICAL_ROW_VARIANTS } from '../src/core/breakdown/mechanicalDetails'
import {
  fixtureCode,
  parseCountFixtures,
  quantityUnit,
  serializeCountFixtures,
} from '../src/core/countFixtures'
import {
  QUANTITY_MASTER,
  fixtureFromPreset,
  masterEntries,
} from '../src/core/quantityMaster'

// U1 の既存試験では、書式に行のない U8 の独立品目を比較対象から除く。
function catalogItems(): readonly CatalogItem[] {
  return catalogItemsIncludingStandard().filter(item => !item.key.startsWith('std:'))
}

function masterKey(master: readonly [string, string, string]): string {
  return `master:${JSON.stringify(master)}`
}

function requiredItem(predicate: (item: CatalogItem) => boolean): CatalogItem {
  const item = catalogItems().find(predicate)
  if (item === undefined) throw new Error('試験対象の品目がありません')
  return item
}

function requiredOption(item: CatalogItem, code: string, spec?: string): CatalogOption {
  const option = item.options.find(option =>
    option.code === code && (spec === undefined || option.spec === spec),
  )
  if (option === undefined) throw new Error(`試験対象の規格がありません: ${code} ${spec ?? ''}`)
  return option
}

function targetItems(
  absorption: MasterAbsorption,
  target: MasterAbsorptionTarget,
): readonly CatalogItem[] {
  return catalogItems().filter(item =>
    item.field === absorption.master[0]
    && ('row' in target
      ? item.key.startsWith('row:')
        && item.name === target.row
        && (target.unit === undefined || item.unit === target.unit)
      : item.key.startsWith('detail:')
        && item.breakdownItem === target.detailRow
        && item.name === target.detail),
  )
}

function rowItem(field: string, name: string, unit?: string): CatalogItem {
  return requiredItem(item =>
    item.field === field && item.key.startsWith('row:') && item.name === name
    && (unit === undefined || item.unit === unit),
  )
}

function selectedPreset(item: CatalogItem, code: string, spec?: string) {
  const option = requiredOption(item, code, spec)
  const presets = catalogPresets(item, { options: [option.key] })
  expect(presets).toHaveLength(1)
  return presets[0]
}

function summaryOf(preset: ReturnType<typeof catalogPresets>[number]) {
  return Object.fromEntries((preset.summary ?? []).map(field => [field.label, field.value]))
}

describe('SPEC-U6 catalog preset split values', () => {
  it('uses a selected LED symbol choice as the item code and summary', () => {
    const item = rowItem('電気設備', 'ＬＥＤ照明器具', '個')
    const option = item.options.find(candidate =>
      candidate.key === 'item' && candidate.convert === undefined,
    )
    if (option === undefined) throw new Error('ＬＥＤ照明器具の item 規格がありません')

    const presets = catalogPresets(item, {
      options: [option.key],
      values: { 記号: ['LSS1-2'] },
    })

    expect(presets).toHaveLength(1)
    expect(presets[0].code).toBe('LSS1-2')
    expect(summaryOf(presets[0]).記号).toBe('LSS1-2')
  })

  it('splits multiple other LED symbol values into separate items', () => {
    const item = rowItem('電気設備', 'ＬＥＤ照明器具', '個')
    const option = item.options.find(candidate =>
      candidate.key === 'item' && candidate.convert === undefined,
    )
    if (option === undefined) throw new Error('ＬＥＤ照明器具の item 規格がありません')

    const presets = catalogPresets(item, {
      options: [option.key],
      values: { 記号: ['L1', 'L2'] },
    })

    expect(presets).toHaveLength(2)
    expect(presets.map(preset => preset.code)).toEqual(['L1', 'L2'])
    expect(presets.map(preset => summaryOf(preset).記号)).toEqual(['L1', 'L2'])
  })

  it('keeps the DL specification code and symbol', () => {
    const item = rowItem('電気設備', 'ＬＥＤ照明器具', '個')
    const option = item.options.find(candidate => candidate.code === 'DL')
    if (option === undefined) throw new Error('DL 規格がありません')

    const presets = catalogPresets(item, { options: [option.key] })

    expect(presets).toHaveLength(1)
    expect(presets[0].code).toBe('DL')
    expect(summaryOf(presets[0]).記号).toBe('DL')
  })

  it('continues splitting symbol text when the slot has no choices', () => {
    const item = requiredItem(candidate =>
      candidate.field === '機械設備'
      && candidate.key.startsWith('row:')
      && candidate.name === 'パッケージ形空気調和機'
      && candidate.slots.some(slot =>
        !slot.condition && slot.label === '記号' && !slot.choices?.length,
      ),
    )
    const option = item.options.find(candidate =>
      candidate.key === 'item' && candidate.convert === undefined,
    )
    if (option === undefined) throw new Error('パッケージ形空気調和機の item 規格がありません')

    const presets = catalogPresets(item, {
      options: [option.key],
      text: { 記号: 'PAC-1、PAC-2' },
    })

    expect(presets).toHaveLength(2)
    expect(presets.map(preset => preset.code)).toEqual(['PAC-1', 'PAC-2'])
    expect(presets.map(preset => summaryOf(preset).記号)).toEqual(['PAC-1', 'PAC-2'])
  })
})

describe('SPEC-U1 master absorption', () => {
  it('removes every source item and preserves every merged specification at every target', () => {
    const entries = masterEntries()
    for (const absorption of MASTER_ABSORPTIONS) {
      const [field, category, type] = absorption.master
      const source = QUANTITY_MASTER.find(candidate =>
        candidate.field === field && candidate.category === category && candidate.type === type,
      )
      if (source === undefined) throw new Error(`吸収元がありません: ${masterKey(absorption.master)}`)

      expect(catalogItems().some(item => item.key === masterKey(absorption.master))).toBe(false)
      const sourceOptions = entries.filter(entry =>
        entry.field === field && entry.category === category && entry.type === type,
      )
      expect(sourceOptions.length).toBeGreaterThan(0)

      for (const target of absorption.targets) {
        const targets = targetItems(absorption, target)
        expect(targets.length, JSON.stringify({ master: absorption.master, target }))
          .toBeGreaterThan(0)

        for (const item of targets) {
          expect(item.formerNames).toContain(source.name)
          expect(new Set(item.options.map(option => option.key)).size).toBe(item.options.length)
          if (absorption.mode === 'drop') continue

          for (const original of sourceOptions) {
            const option = item.options.find(option => option.key === original.key)
            expect(option, `${item.key}: ${original.key}`).toBeDefined()
            expect(option!.formerName).toBe(source.name)
            expect(option!.name).toBe(item.name)
            expect(option!.label).toBe(fixtureCode(original))
            for (const property of [
              'code', 'spec', 'kind', 'method', 'defaults', 'conditions', 'convert',
            ] as const) {
              expect(option![property], `${item.key}: ${original.key}: ${property}`)
                .toEqual(original[property])
            }
          }
        }
      }
    }
  })

  it('creates an LED fixture with DL φ100 and its fixed symbol', () => {
    const item = rowItem('電気設備', 'ＬＥＤ照明器具', '個')
    const option = requiredOption(item, 'DL', 'φ100')
    expect(option.formerName).toBe('ダウンライト')

    const preset = selectedPreset(item, 'DL', 'φ100')
    expect(preset).toMatchObject({
      name: 'ＬＥＤ照明器具',
      code: 'DL',
      spec: 'φ100',
    })
    expect(summaryOf(preset).記号).toBe('DL')
    expect(quantityUnit(preset)).toBe('個')
    expect(representativeBreakdownPosition(item)).toMatchObject({
      book: '電気設備',
      section: '庁舎',
      subject: '電灯設備',
      middle: '電灯分岐',
      item: 'ＬＥＤ照明器具',
    })
  })

  it('keeps fixed summaries from increasing combinations or being overwritten', () => {
    const item = rowItem('電気設備', 'ＬＥＤ照明器具', '個')
    const option = requiredOption(item, 'DL', 'φ100')
    const presets = catalogPresets(item, {
      options: [option.key],
      text: { 記号: 'L-1、L-2' },
    })
    expect(presets).toHaveLength(1)
    expect(summaryOf(presets[0]).記号).toBe('DL')

    const free = catalogPresets(item, {
      options: ['item'],
      text: { 記号: 'L-1、L-2' },
    })
    expect(free.map(preset => preset.code)).toEqual(['L-1', 'L-2'])
    expect(free.map(preset => summaryOf(preset).記号)).toEqual(['L-1', 'L-2'])
  })

  it('creates a water pipe with VA 20A and its pipe material and nominal diameter', () => {
    const item = rowItem('機械設備', '給水管')
    const preset = selectedPreset(item, 'SGP-VA', '20A')
    expect(preset).toMatchObject({ name: '給水管', code: 'SGP-VA', spec: '20A' })
    expect(summaryOf(preset)).toMatchObject({
      管種: '水道用硬質塩化ビニルライニング鋼管（SGP-VA）',
      呼び径: '20A',
    })
  })

  it('strips only the leading phi from the duct summary diameter', () => {
    const item = rowItem('機械設備', 'スパイラルダクト')
    const preset = selectedPreset(item, 'RD', 'φ200')
    expect(preset).toMatchObject({
      name: 'スパイラルダクト',
      code: 'RD',
      spec: 'φ200',
    })
    expect(summaryOf(preset).口径).toBe('200')
  })

  it('uses the format unit and symbol summary for WC', () => {
    const item = rowItem('機械設備', '大便器', '組')
    const preset = selectedPreset(item, 'WC')
    expect(preset.name).toBe('大便器')
    expect(preset.unit).toBe('組')
    expect(quantityUnit(preset)).toBe('組')
    expect(summaryOf(preset).記号等).toBe('WC')
  })

  it('creates the C2E detail with its fixed outlet type', () => {
    const item = requiredItem(item =>
      item.field === '電気設備' && item.key.startsWith('detail:')
      && item.breakdownItem === '配線器具' && item.name === 'コンセント',
    )
    const preset = selectedPreset(item, 'C2E')
    expect(preset.name).toBe('コンセント')
    expect(summaryOf(preset).種類).toBe('2P15A×2 接地極付')
  })

  it('keeps the rectangular duct variants unchanged while making the former name searchable', () => {
    const item = rowItem('機械設備', '長方形ダクト')
    const variants = MECHANICAL_ROW_VARIANTS['長方形ダクト'].variants
    expect(variants).toBeDefined()
    const nonStandardOptions = item.options.filter(option => !option.key.startsWith('std:'))
    expect(nonStandardOptions).toHaveLength(variants!.length)
    expect(nonStandardOptions.every(option => option.formerName === undefined)).toBe(true)
    expect(catalogItems().some(item => item.name === '角ダクト')).toBe(false)
    expect(searchCatalog('角ダクト').results.some(result => result.item.key === item.key))
      .toBe(true)
  })

  it('finds absorbed items by their former names and specifications', () => {
    expect(searchCatalog('ダウンライト').results.some(result =>
      result.item.field === '電気設備' && result.item.name === 'ＬＥＤ照明器具',
    )).toBe(true)
    const result = searchCatalog('ダウンライト φ100').results.find(result =>
      result.item.field === '電気設備'
      && result.item.name === 'ＬＥＤ照明器具' && result.item.unit === '個',
    )
    expect(result).toBeDefined()
    expect(result!.options.some(option => option.code === 'DL' && option.spec === 'φ100'))
      .toBe(true)
    expect(searchCatalog('VA 20A').results.some(result =>
      result.item.field === '機械設備' && result.item.name === '給水管'
      && result.options.some(option => option.code === 'SGP-VA' && option.spec === '20A'),
    )).toBe(true)
  })

  it('offers supplement rows through both catalog paths', () => {
    const supplements = [
      { name: 'フレキシブルダクト' },
      { name: '天井換気扇' },
      { name: '壁付換気扇' },
      { name: '排気ガラリ' },
      { name: '流し', unit: '組' },
      { name: '給湯器' },
      { name: '消火器' },
      { name: 'スプリンクラーヘッド' },
    ]
    for (const supplement of supplements) {
      const entries = breakdownEntries('機械設備').filter(entry =>
        !entry.row.separate && entry.row.name === supplement.name
        && (supplement.unit === undefined || entry.row.unit === supplement.unit),
      )
      expect(entries.length, supplement.name).toBeGreaterThan(0)
      for (const entry of entries) {
        const item = rowItem('機械設備', entry.row.name, entry.row.unit)
        expect(catalogItemsForBreakdownRow(entry)).toEqual([item])
      }
    }
  })

  it('preserves the pre-absorption condition candidates for an existing DL fixture', () => {
    const original = masterEntries().find(entry =>
      entry.field === '電気設備' && entry.category === '照明器具'
      && entry.type === 'DL' && entry.code === 'DL' && entry.spec === 'φ100',
    )
    if (original === undefined) throw new Error('旧 DL φ100 がありません')
    const legacyItem: CatalogItem = {
      key: masterKey(['電気設備', '照明器具', 'DL']),
      field: '電気設備',
      category: '照明器具',
      type: 'DL',
      name: 'ダウンライト',
      unit: '個',
      options: [],
      slots: [],
      search: '',
    }
    const expected = [...new Set([
      ...(original.conditions ?? []),
      ...conditionCandidatesFor(legacyItem),
    ])].slice(0, 30)
    expect(expected.length).toBeGreaterThan(0)
    expect(catalogConditionsForFixture({
      name: 'ダウンライト',
      code: 'DL',
      spec: 'φ100',
      category: '照明器具',
    })).toEqual(expected)

    const fixture = fixtureFromPreset(original, [])
    const saved = serializeCountFixtures([fixture])
    expect(parseCountFixtures(saved)).toEqual([fixture])
    expect(fixture).toMatchObject({
      name: 'ダウンライト',
      code: 'DL',
      spec: 'φ100',
    })
  })

  it('offers lighting position conditions for a legacy DL fixture without a spec', () => {
    const conditions = catalogConditionsForFixture({
      name: 'ダウンライト',
      code: 'DL',
      category: '照明器具',
    })
    expect(conditions).toEqual(expect.arrayContaining(['天井直付', 'システム天井']))
  })

  it.each(['電気設備', '機械設備'] as const)(
    'shares the same item keys across both paths for %s',
    book => {
      const sourceKey = (key: string) => key.split('#')[0]
      const specificationKeys = new Set(catalogItems()
        .filter(item => item.field === book)
        .map(item => sourceKey(item.key)))
      const breakdownKeys = new Set(breakdownEntries(book)
        .flatMap(entry => catalogItemsForBreakdownRow(entry))
        .map(item => sourceKey(item.key)))
      expect([...breakdownKeys].sort()).toEqual([...specificationKeys].sort())
    },
  )

  it('preserves all non-absorbed master items and their specification attributes', () => {
    const absorbedKeys = new Set(MASTER_ABSORPTIONS.map(absorption => masterKey(absorption.master)))
    for (const original of masterEntries()) {
      const key = masterKey([original.field, original.category, original.type])
      if (absorbedKeys.has(key)) continue
      const item = requiredItem(item => item.key === key)
      const option = item.options.find(option => option.key === original.key)
      expect(option, original.key).toBeDefined()
      expect(option!.formerName).toBeUndefined()
      expect(option!.name).toBe(original.name)
      expect(option!.label).toBe(fixtureCode(original))
      for (const property of [
        'code', 'spec', 'kind', 'method', 'defaults', 'conditions', 'convert',
      ] as const) {
        expect(option![property], `${original.key}: ${property}`).toEqual(original[property])
      }
    }
  })
})
