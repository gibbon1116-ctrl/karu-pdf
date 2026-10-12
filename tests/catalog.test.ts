import { describe, expect, it } from 'vitest'
import {
  MAX_CATALOG_COMBINATIONS,
  catalogConditionsForFixture,
  conditionCandidatesFor,
  catalogItems,
  catalogItemsForBreakdownRow,
  catalogLinkRuleForPreset,
  catalogPresets,
  representativeBreakdownPosition,
  searchCatalog,
  type CatalogItem,
  type CatalogPosition,
} from '../src/core/catalog'
import {
  breakdownEntries,
  detailMasterEntries,
  kindForUnit,
  summaryChoices,
  summaryIsCondition,
  type BreakdownEntry,
} from '../src/core/breakdownMaster'
import { ELECTRICAL_DETAILS, ELECTRICAL_ROW_MASTERS } from '../src/core/breakdown/electricalDetails'
import { MECHANICAL_DETAILS, PIPE_LOCATIONS } from '../src/core/breakdown/mechanicalDetails'
import { BUILDING_GROUPS } from '../src/core/breakdown/buildingGroups'
import {
  BUILDING_DETAILS,
  BUILDING_RENOVATION_DETAILS,
  BUILDING_CHOICES,
} from '../src/core/breakdown/buildingDetails'
import { BUILDING_ROW_VARIANTS } from '../src/core/breakdown/buildingVariants'
import { CONDITION_RULES } from '../src/core/breakdown/conditionCandidates'
import { LINK_RULES, linkRuleForDetail } from '../src/core/breakdown/linkRules'
import { validCondition } from '../src/core/quantity'
import {
  CATEGORY_ALIASES,
  DETAIL_CATEGORY,
  LIGHTING_ROWS,
  MASTER_CATEGORY_ITEMS,
  MASTER_TYPE_ITEMS,
  MECHANICAL_ROW_CATEGORY,
  MECHANICAL_DETAIL_CATEGORY,
  BUILDING_SUBJECT_CATEGORY,
  BUILDING_ROW_CATEGORY,
} from '../src/core/breakdown/catalogMap'
import {
  QUANTITY_UNITS,
  fixtureBreakdownError,
  fixtureCode,
  fixtureIdentity,
  quantityOutputKind,
  quantityUnit,
  parseCountFixtures,
  serializeCountFixtures,
  type CountFixture,
} from '../src/core/countFixtures'
import {
  QUANTITY_MASTER,
  masterEntries,
  normalizeMasterText,
} from '../src/core/quantityMaster'

const items = catalogItems()
const entries = breakdownEntries()
const combinationError = '組合せが100件を超えます。選ぶ値を減らしてください。'
const detailSources = [
  { book: '電気設備', details: ELECTRICAL_DETAILS, categories: DETAIL_CATEGORY, section: undefined },
  { book: '機械設備', details: MECHANICAL_DETAILS, categories: MECHANICAL_DETAIL_CATEGORY, section: undefined },
  { book: '建築', details: BUILDING_DETAILS, categories: {}, section: '庁舎' },
  { book: '建築', details: BUILDING_RENOVATION_DETAILS, categories: {}, section: '庁舎（改修）' },
] as const

function requiredItem(predicate: (item: CatalogItem) => boolean): CatalogItem {
  const item = items.find(predicate)
  if (item === undefined) throw new Error('試験に必要な品目が見つかりません。')
  return item
}

function requiredEntry(predicate: (entry: BreakdownEntry) => boolean): BreakdownEntry {
  const entry = entries.find(predicate)
  if (entry === undefined) throw new Error('試験に必要な内訳書の行が見つかりません。')
  return entry
}

function expectedCategory(entry: BreakdownEntry): string {
  if (entry.book === '建築') {
    return entry.middle?.startsWith('撤去')
      ? '撤去'
      : BUILDING_ROW_CATEGORY[entry.row.name] ?? BUILDING_SUBJECT_CATEGORY[entry.subject] ?? entry.subject
  }
  if (entry.book === '機械設備') return MECHANICAL_ROW_CATEGORY[entry.row.name] ?? entry.subject
  if (entry.book !== '電気設備') return entry.subject
  if (LIGHTING_ROWS.includes(entry.row.name)) return '照明器具'
  if (entry.row.name.endsWith('盤') || entry.row.summary?.includes('盤名称')) return '盤類'
  return entry.subject
}

function expectedRowKey(entry: BreakdownEntry): string {
  const parts = [expectedCategory(entry), entry.row.name]
  const hasDifferentUnit = entries.some(other =>
    !other.row.separate
    && other.book === entry.book
    && other.row.name === entry.row.name
    && other.row.unit !== entry.row.unit,
  )
  if (entry.book === '建築' || hasDifferentUnit) parts.push(entry.row.unit)
  return `row:${JSON.stringify(entry.book === '電気設備' ? parts : [entry.book, ...parts])}`
}

function expectedDetailKey(book: BreakdownEntry['book'], rowName: string, name: string, section?: string): string {
  const parts = [rowName, name]
  if (book === '建築') return `detail:${JSON.stringify([book, section === '庁舎（改修）' ? '改修' : '新営', ...parts])}`
  return `detail:${JSON.stringify(book === '電気設備' ? parts : [book, ...parts])}`
}

const conduit = requiredItem(item => item.key.startsWith('master:') && item.type === 'E')
const panel = requiredItem(item => item.key.startsWith('row:') && item.name === '分電盤')
const outlet = requiredItem(item =>
  item.key === `detail:${JSON.stringify(['ボックス類', 'アウトレットボックス'])}`,
)
const pipePaint = requiredItem(item =>
  item.key === `detail:${JSON.stringify(['塗装工事', '配管塗装'])}`,
)
const position: CatalogPosition = {
  book: '電気設備',
  section: '庁舎',
  subject: '電灯設備',
  middle: '電灯幹線',
}

describe('catalogItems', () => {
  it('contains all three sources in source order, deduplicates rows and reuses the list', () => {
    const masterKeys = [...new Set(QUANTITY_MASTER.map(type =>
      `master:${JSON.stringify([type.field, type.category, type.type])}`,
    ))]
    // 別紙明細でない行は、すべて規格のある品目に対応する（SPEC-B16、例外なし）。
    const rowKeys = [...new Set(entries.filter(entry => !entry.row.separate).map(expectedRowKey))]
    const detailKeys = detailSources.flatMap(({ book, details, section }) =>
      Object.entries(details).flatMap(([rowName, templates]) =>
        templates
          .filter(template =>
            template.master === undefined
            && (template.variants !== undefined || kindForUnit(template.unit) !== undefined
              || template.linked === 'carry' || linkRuleForDetail(template.name) !== undefined),
          )
          .map(template => expectedDetailKey(book, rowName, template.name, section)),
      ),
    )

    expect(items.map(item => item.key)).toEqual([...masterKeys, ...rowKeys, ...detailKeys])
    expect(items.filter(item => item.key.startsWith('master:'))).toHaveLength(masterKeys.length)
    expect(items.filter(item => item.key.startsWith('row:'))).toHaveLength(rowKeys.length)
    expect(items.filter(item => item.key.startsWith('detail:'))).toHaveLength(detailKeys.length)
    expect(new Set(items.map(item => item.key)).size).toBe(items.length)
    expect(items.every(item => item.options.length > 0)).toBe(true)
    expect(items.filter(item => !item.options.length).map(item => item.key)).toEqual([])
    expect(catalogItems()).toBe(items)
  })

  it('retains every master type, specification and condition in source order', () => {
    for (const type of QUANTITY_MASTER) {
      const item = requiredItem(candidate =>
        candidate.key === `master:${JSON.stringify([type.field, type.category, type.type])}`,
      )
      const source = masterEntries().filter(entry =>
        entry.field === type.field && entry.category === type.category && entry.type === type.type,
      )
      expect(item.field).toBe(type.field)
      expect(item.category).toBe(CATEGORY_ALIASES[type.category] ?? type.category)
      expect(item.type).toBe(type.type)
      expect(item.name).toBe(type.name)
      expect(item.unit).toBe(QUANTITY_UNITS[type.kind])
      expect(item.slots).toEqual([])
      expect(item.breakdownItem).toBe(type.field === '電気設備'
        ? MASTER_TYPE_ITEMS[type.type] ?? MASTER_CATEGORY_ITEMS[type.category]
        : undefined)
      expect(item.options.map(option => option.key)).toEqual(source.map(entry => entry.key))
      expect(item.options.map(option => option.label)).toEqual(source.map(fixtureCode))
      for (const [index, option] of item.options.entries()) {
        const entry = source[index]
        for (const key of ['code', 'spec', 'name', 'kind', 'method', 'defaults', 'conditions'] as const) {
          expect(option[key]).toEqual(entry[key])
        }
      }
    }
  })

  it('unifies wiring accessory categories and assigns electrical breakdown items', () => {
    for (const category of ['コンセント', 'スイッチ']) {
      const types = QUANTITY_MASTER.filter(type => type.category === category)
      expect(types.length).toBeGreaterThan(0)
      for (const type of types) {
        const item = requiredItem(candidate =>
          candidate.key === `master:${JSON.stringify([type.field, type.category, type.type])}`,
        )
        expect(item.category).toBe('配線器具')
      }
    }
    expect(conduit.breakdownItem).toBe('電線管')
    expect(requiredItem(item => item.key.startsWith('master:') && item.type === 'MD').breakdownItem)
      .toBe('金属ダクト')
    expect(requiredItem(item => item.key.startsWith('master:') && item.type === 'DL').breakdownItem)
      .toBe('ＬＥＤ照明器具')
  })

  it('uses material categories and the first matching quantity row', () => {
    expect(panel.category).toBe('盤類')
    expect(requiredItem(item => item.key.startsWith('row:') && item.name === 'ＬＥＤ照明器具').category)
      .toBe('照明器具')
    expect(requiredItem(item => item.key.startsWith('row:') && item.name === '熱感知器').category)
      .toBe('火災報知設備')

    const seen = new Set<string>()
    for (const entry of entries.filter(entry => entry.pickable)) {
      const key = expectedRowKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      const item = requiredItem(candidate => candidate.key === key)
      expect(item.field).toBe(entry.book)
      expect(item.category).toBe(expectedCategory(entry))
      expect(item.unit).toBe(entry.row.unit)
      expect(item.breakdownItem).toBe(entry.row.name)
      expect(item.slots).toEqual((entry.row.summary ?? []).map(label => {
        const choices = summaryChoices(entry.row.name, label, entry.book)
        return {
          label,
          ...(choices.length ? { choices } : {}),
          ...(summaryIsCondition(entry.row.name, label, entry.book) ? { condition: true } : {}),
        }
      }))
    }
  })

  it('retains supported standard details, variants and normalized search text', () => {
    for (const [rowName, templates] of Object.entries(ELECTRICAL_DETAILS)) {
      for (const template of templates) {
        if (template.master !== undefined) continue
        const key = `detail:${JSON.stringify([rowName, template.name])}`
        if (template.variants === undefined && kindForUnit(template.unit) === undefined && template.linked !== 'carry') {
          expect(items.some(item => item.key === key)).toBe(false)
          continue
        }
        const item = requiredItem(candidate => candidate.key === key)
        expect(item.category).toBe(DETAIL_CATEGORY[rowName] ?? rowName)
        expect(item.unit).toBe(template.unit)
        expect(item.slots).toEqual(template.summary ?? [])
        expect(item.breakdownItem).toBe(rowName)
        if (template.variants !== undefined) {
          expect(item.options.map(option => option.key)).toEqual(template.variants.map(v => v.code))
          for (const [index, option] of item.options.entries()) {
            const variant = template.variants[index]
            expect(option.label).toBe(variant.code)
            expect(option.note).toBe(variant.convert.basis)
            expect(option.spec).toBe(variant.spec)
            expect(option.convert).toEqual(variant.convert)
            expect(option.kind).toBe(template.pick)
          }
        }
      }
    }

    for (const item of items) {
      expect(item.search).toBe(normalizeMasterText([
        item.field, item.category, item.type, item.name,
        ...item.options.flatMap(option => [option.label, option.spec ?? '']),
        ...item.slots.flatMap(slot => [slot.label, ...(slot.choices ?? [])]),
      ].join(' ')))
    }
  })
})

describe('catalogItemsForBreakdownRow', () => {
  it('resolves every non-separate row and every supported separate detail', () => {
    for (const entry of entries) {
      const actual = catalogItemsForBreakdownRow(entry)
      if (!entry.row.separate) {
        // SPEC-B17: 対応する電気器具を先に並べ、従来の行の品目を最後に残す。
        const rowMaster = entry.book === '電気設備'
          && Object.hasOwn(ELECTRICAL_ROW_MASTERS, entry.row.name)
          ? ELECTRICAL_ROW_MASTERS[entry.row.name]
          : undefined
        const masterKeys = rowMaster === undefined ? [] : items
          .filter(item =>
            item.key.startsWith('master:')
            && item.field === '電気設備'
            && rowMaster.types.includes(item.type),
          )
          .map(item => `${item.key}#row:${expectedRowKey(entry)}`)
        expect(actual.map(item => item.key), entry.key)
          .toEqual([...masterKeys, expectedRowKey(entry)])
        expect(actual.every(item =>
          item.unit === entry.row.unit && item.options.length > 0,
        ), entry.key).toBe(true)
        continue
      }
      const expectedKeys = entry.details.flatMap(template => {
        if (template.master === undefined) {
          const key = expectedDetailKey(entry.book, entry.row.name, template.name, entry.section)
          return items.some(item => item.key === key) ? [key] : []
        }
        const keys = [...new Set(detailMasterEntries(template).map(choice =>
          `master:${JSON.stringify([choice.field, choice.category, choice.type])}`,
        ))]
        return keys.map(key => {
          if (template.summary === undefined) return key
          return entry.book === '電気設備'
            ? `${key}#${entry.row.name}${template.name}`
            : `${key}#${JSON.stringify([entry.book, entry.row.name, template.name])}`
        })
      })
      expect(actual.map(item => item.key), entry.key).toEqual(expectedKeys)
    }
  })

  it('overlays template slots on master items without changing the base catalog', () => {
    const entry = requiredEntry(entry => entry.row.name === '接地工事' && !!entry.row.separate)
    const template = entry.details.find(template => template.name === '接地線')!
    const wires = catalogItemsForBreakdownRow(entry).filter(item => item.key.startsWith('master:'))
    expect(wires.map(item => item.type)).toEqual(['IV', 'EM-IE'])
    for (const wire of wires) {
      const base = requiredItem(item =>
        item.key === `master:${JSON.stringify(['電気設備', '電線', wire.type])}`,
      )
      expect(wire).not.toBe(base)
      expect(wire.key).toBe(`${base.key}#接地工事接地線`)
      expect(wire.slots).toEqual(template.summary)
      expect(base.slots).toEqual([])
      expect(wire.options).toBe(base.options)
      expect(wire.search).toContain(normalizeMasterText('種別 A種'))
    }
  })

  it('returns no items for unsupported or empty separate rows', () => {
    expect(catalogItemsForBreakdownRow({
      ...entries[0],
      row: { name: '未対応', unit: '式', separate: true },
      details: [],
      pickable: false,
    })).toEqual([])
    // 機器搬入 (t) is offered as a linked carry item since SPEC-B06.
    const carry = requiredEntry(entry => entry.row.name === '搬入費' && !!entry.row.separate)
    expect(catalogItemsForBreakdownRow(carry).map(item => item.name)).toEqual(['機器搬入'])
  })
})

describe('SPEC-B28 representativeBreakdownPosition', () => {
  it('maps DL and its row overlays to the headquarters lighting branch', () => {
    const dl = requiredItem(item =>
      item.key.startsWith('master:') && item.field === '電気設備' && item.type === 'DL',
    )
    const expected = {
      book: '電気設備',
      section: '庁舎',
      subject: '電灯設備',
      middle: '電灯分岐',
      item: 'ＬＥＤ照明器具',
    }
    expect(representativeBreakdownPosition(dl)).toEqual(expected)

    const lightingRows = entries.filter(entry =>
      entry.book === '電気設備'
      && entry.row.name === 'ＬＥＤ照明器具'
      && !entry.row.separate,
    )
    expect(lightingRows.some(entry => entry.row.unit === '灯')).toBe(true)
    for (const entry of lightingRows) {
      const overlay = catalogItemsForBreakdownRow(entry).find(item => item.type === 'DL')
      expect(overlay, entry.key).toBeDefined()
      expect(representativeBreakdownPosition(overlay!), entry.key).toEqual(expected)
    }
  })

  it('maps building steel to the main steel-material row', () => {
    const steel = requiredItem(item =>
      item.field === '建築' && item.key.startsWith('row:')
      && item.name === '形鋼' && item.unit === 't',
    )
    expect(representativeBreakdownPosition(steel)).toEqual({
      book: '建築',
      section: '庁舎',
      subject: '鉄骨',
      middle: '本体鉄骨・鋼材',
      item: '形鋼',
    })
  })

  it('uses the first headquarters separate cable row for CV', () => {
    const cv = requiredItem(item =>
      item.key.startsWith('master:') && item.field === '電気設備' && item.type === 'CV',
    )
    const entry = requiredEntry(entry =>
      entry.book === '電気設備'
      && entry.section === '庁舎'
      && !!entry.row.separate
      && catalogItemsForBreakdownRow(entry).some(candidate =>
        candidate.key === cv.key || candidate.key.startsWith(`${cv.key}#`),
      ),
    )
    expect(representativeBreakdownPosition(cv)).toEqual({
      book: entry.book,
      section: entry.section,
      subject: entry.subject,
      ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
      item: entry.row.name,
    })
  })

  it('falls back to renovation for a renovation-only detail', () => {
    const scaffold = requiredItem(item =>
      item.key === expectedDetailKey('建築', '外部足場', '枠組本足場', '庁舎（改修）'),
    )
    const matches = entries.filter(entry =>
      catalogItemsForBreakdownRow(entry).some(candidate => candidate.key === scaffold.key),
    )
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every(entry => entry.section === '庁舎（改修）')).toBe(true)
    const entry = matches[0]
    expect(representativeBreakdownPosition(scaffold)).toEqual({
      book: entry.book,
      section: '庁舎（改修）',
      subject: entry.subject,
      ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
      item: entry.row.name,
    })
  })

  it('returns undefined for an unmatched key and protects cached positions from mutation', () => {
    expect(representativeBreakdownPosition({
      ...panel,
      key: 'row:SPEC-B28-unmatched-item',
    })).toBeUndefined()

    const first = representativeBreakdownPosition(panel)
    expect(first).toBeDefined()
    const expected = { ...first! }
    first!.item = '呼出側で変更'
    expect(representativeBreakdownPosition(panel)).toEqual(expected)
    expect(catalogItems()).toBe(items)
  })
})

describe('catalogPresets', () => {
  it('produces the same identity and category from the specification and breakdown paths', () => {
    const entry = requiredEntry(entry =>
      entry.section === '庁舎'
      && entry.subject === '電灯設備'
      && entry.middle === '電灯幹線'
      && entry.row.name === '電線管',
    )
    const fromRow = catalogItemsForBreakdownRow(entry).find(item => item.type === 'E')!
    const option = conduit.options.find(option => option.label === 'E25')!
    const [fromSpecPreset] = catalogPresets(conduit, { options: [option.key] }, position)
    const [fromRowPreset] = catalogPresets(fromRow, { options: [option.key] }, {
      ...position, item: '電線管',
    })
    expect(fixtureIdentity(fromSpecPreset)).toBe(fixtureIdentity(fromRowPreset))
    expect(fromSpecPreset.category).toBe(fromRowPreset.category)
    expect(fromSpecPreset.conditions).toEqual(option.conditions)
    expect(fromSpecPreset).toEqual(fromRowPreset)
  })

  it('splits panel names into count items with their panel unit', () => {
    const presets = catalogPresets(panel, {
      options: ['item'],
      text: { 盤名称: ' L-1、L-2 ' },
    })
    expect(presets.map(preset => preset.code)).toEqual(['L-1', 'L-2'])
    expect(presets.map(preset => preset.summary)).toEqual([
      [{ label: '盤名称', value: 'L-1' }],
      [{ label: '盤名称', value: 'L-2' }],
    ])
    for (const preset of presets) {
      expect(preset.unit).toBe('面')
      expect(preset.category).toBe('盤類')
      expect(preset.kind).toBe('count')
      expect(preset.method).toBe('click')
      expect(preset.aggregation).toBe('location')
      expect(preset).not.toHaveProperty('breakdown')
    }
  })

  it('expands checkbox dimensions while keeping placement as condition candidates', () => {
    const presets = catalogPresets(outlet, {
      options: ['item'],
      values: {
        寸法: [' 中浅形 ', '中深形', '', '中浅形'],
        施工: ['露出'],
      },
      text: { 施工: '隠ぺい' },
    }, position)
    expect(presets).toHaveLength(2)
    expect(presets.map(preset => preset.summary)).toEqual([
      [{ label: '寸法', value: '中浅形' }],
      [{ label: '寸法', value: '中深形' }],
    ])
    for (const preset of presets) {
      expect(preset.conditions).toEqual(['隠ぺい（埋込）', '露出', '二重床'])
      expect(preset.code).toBe('OB')
      expect(preset).not.toHaveProperty('unit')
      expect(preset.breakdown?.item).toBe('ボックス類')
    }
    presets[0].conditions!.push('追加')
    presets[0].summary![0].value = '変更'
    presets[0].breakdown!.item = '変更'
    expect(presets[1].conditions).toEqual(['隠ぺい（埋込）', '露出', '二重床'])
    expect(presets[1].summary![0].value).toBe('中深形')
    expect(presets[1].breakdown!.item).toBe('ボックス類')
    expect(outlet.slots[1].choices).toEqual(['隠ぺい（埋込）', '露出'])
  })

  it('creates selected pipe painting variants in selection order with independent conversions', () => {
    const selected = ['E25', 'E19'].map(spec =>
      pipePaint.options.find(option => option.spec === spec)!,
    )
    const presets = catalogPresets(pipePaint, {
      options: selected.map(option => option.key),
      values: { 塗料: ['SOP'] },
    }, position)
    expect(presets.map(preset => preset.code)).toEqual(['E25塗装', 'E19塗装'])
    expect(presets.map(preset => preset.spec)).toEqual(['E25', 'E19'])
    for (const [index, preset] of presets.entries()) {
      expect(preset.kind).toBe('length')
      expect(preset.method).toBe('polyline')
      expect(preset.convert?.unit).toBe('㎡')
      expect(preset.convert).toEqual(selected[index].convert)
      expect(preset.convert).not.toBe(selected[index].convert)
      expect(preset.aggregation).toBe('document')
      expect(preset.summary).toEqual([{ label: '塗料', value: 'SOP' }])
      expect(preset).not.toHaveProperty('unit')
    }
  })

  it('aggregates converted counts by document', () => {
    const item = requiredItem(item =>
      item.key === `detail:${JSON.stringify(['塗装工事', 'ボックス塗装'])}`,
    )
    const [preset] = catalogPresets(item, { options: [item.options[0].key] })
    expect(preset.kind).toBe('count')
    expect(preset.convert?.unit).toBe('㎡')
    expect(preset.aggregation).toBe('document')
    expect(preset).not.toHaveProperty('unit')
  })

  it('forms the Cartesian product in slot order and allows additional checkbox values', () => {
    const item: CatalogItem = {
      ...panel,
      slots: [
        { label: '形式', choices: ['標準'] },
        { label: '盤名称' },
        { label: '容量', choices: ['標準'] },
      ],
    }
    const presets = catalogPresets(item, {
      options: ['item'],
      values: { 容量: ['10', '20'], 形式: ['A', 'B', ' A ', ' '] },
      text: { 盤名称: 'L-1,L-2，L-1' },
    })
    expect(presets).toHaveLength(8)
    expect(presets[0].summary).toEqual([
      { label: '形式', value: 'A' },
      { label: '盤名称', value: 'L-1' },
      { label: '容量', value: '10' },
    ])
    expect(presets[7].summary).toEqual([
      { label: '形式', value: 'B' },
      { label: '盤名称', value: 'L-2' },
      { label: '容量', value: '20' },
    ])
  })

  it('splits only the first eligible free-text slot and preserves long values in summary', () => {
    const item: CatalogItem = {
      ...panel,
      slots: [{ label: '名称' }, { label: '盤名称' }, { label: '備考' }],
    }
    const presets = catalogPresets(item, {
      options: ['item'],
      text: { 名称: ' A、B ', 盤名称: 'L-1、L-2', 備考: ' X,Y ' },
    })
    expect(presets.map(preset => preset.code)).toEqual(['A', 'B'])
    expect(presets[0].summary).toEqual([
      { label: '名称', value: 'A' },
      { label: '盤名称', value: 'L-1、L-2' },
      { label: '備考', value: 'X,Y' },
    ])
    const long = 'あ'.repeat(17)
    const [preset] = catalogPresets(panel, { options: ['item'], text: { 盤名称: long } })
    expect(preset.code).toBe('')
    expect(preset.summary).toEqual([{ label: '盤名称', value: long }])
  })

  it('ignores unknown options, deduplicates selections and omits empty summary', () => {
    expect(catalogPresets(panel, { options: [] })).toEqual([])
    expect(catalogPresets(panel, { options: ['unknown'] })).toEqual([])
    const presets = catalogPresets(panel, {
      options: ['unknown', 'item', 'item'],
      text: { 盤名称: ' ，、 ' },
    })
    expect(presets).toHaveLength(1)
    expect(presets[0]).not.toHaveProperty('summary')
    expect(presets[0].conditions).toEqual(['壁掛', '自立', '埋込'])
  })

  it('appends condition choices without duplicating existing candidates', () => {
    const item: CatalogItem = {
      ...outlet,
      options: [{ ...outlet.options[0], conditions: ['既存', '露出'] }],
      slots: [
        { label: '施工', choices: ['隠ぺい', '露出'], condition: true },
        { label: '処理', choices: ['撤去', '隠ぺい'], condition: true },
      ],
    }
    const [preset] = catalogPresets(item, {
      options: ['item'],
      values: { 施工: ['露出'], 処理: ['撤去'] },
    })
    expect(preset.conditions).toEqual([
      '既存', '露出', '隠ぺい', '撤去', '隠ぺい（埋込）', '二重床',
    ])
    expect(preset).not.toHaveProperty('summary')
    expect(item.options[0].conditions).toEqual(['既存', '露出'])
  })

  it('accepts 100 combinations and rejects 101 or an oversized product including options', () => {
    expect(MAX_CATALOG_COMBINATIONS).toBe(100)
    const values = Array.from({ length: 101 }, (_, index) => `値${index}`)
    const item: CatalogItem = {
      ...panel,
      slots: [{ label: '形式', choices: ['標準'] }],
    }
    expect(catalogPresets(item, {
      options: ['item'], values: { 形式: values.slice(0, 100) },
    })).toHaveLength(100)
    expect(() => catalogPresets(item, {
      options: ['item'], values: { 形式: values },
    })).toThrow(combinationError)

    const multiple: CatalogItem = {
      ...item,
      options: [
        { ...panel.options[0], key: 'A' },
        { ...panel.options[0], key: 'B' },
      ],
    }
    expect(() => catalogPresets(multiple, {
      options: ['A', 'B'], values: { 形式: values.slice(0, 51) },
    })).toThrow(combinationError)
  })

  it('clones defaults and falls back to the item name when no breakdown item exists', () => {
    const base = requiredItem(item =>
      item.key.startsWith('master:') && item.type === '土間コンクリート',
    )
    const [preset] = catalogPresets(base, { options: [base.options[0].key] }, position)
    expect(preset.defaults).toEqual(base.options[0].defaults)
    expect(preset.defaults).not.toBe(base.options[0].defaults)
    expect(preset.breakdown?.item).toBe(base.name)
    expect(preset.aggregation).toBe('document')
    const [override] = catalogPresets(base, { options: [base.options[0].key] }, {
      ...position, item: '指定細目',
    })
    expect(override.breakdown?.item).toBe('指定細目')
  })

  it('uses existing validation messages for invalid summaries, positions and conversions', () => {
    const summary = [{ label: '盤名称', value: 'あ'.repeat(61) }]
    expect(() => catalogPresets(panel, {
      options: ['item'], text: { 盤名称: summary[0].value },
    })).toThrow(fixtureBreakdownError({ summary })!)

    const invalidPosition = { ...position, section: 'あ'.repeat(21), item: '分電盤' }
    expect(() => catalogPresets(panel, { options: ['item'] }, invalidPosition))
      .toThrow(fixtureBreakdownError({ breakdown: invalidPosition })!)

    const convert = { factor: 0, unit: '㎡' as const, basis: '不正な係数' }
    const item: CatalogItem = {
      ...pipePaint,
      options: [{ ...pipePaint.options[0], convert }],
    }
    expect(() => catalogPresets(item, { options: [item.options[0].key] }))
      .toThrow(fixtureBreakdownError({ convert })!)
  })

  it('validates every catalog option without changing source data', () => {
    for (const item of items) {
      for (const option of item.options) {
        const [preset] = catalogPresets(item, { options: [option.key] }, position)
        expect(preset, `${item.key}/${option.key}`).toBeDefined()
        expect(fixtureBreakdownError(preset), `${item.key}/${option.key}`).toBeUndefined()
      }
    }
  })
})

describe('mechanical and elevator catalog', () => {
  const waterEntry = requiredEntry(entry =>
    entry.book === '機械設備'
    && entry.section === '庁舎'
    && entry.subject === '給水設備'
    && entry.row.name === '給水管'
    && entry.pickable,
  )
  const water = catalogItemsForBreakdownRow(waterEntry)[0]

  it('assigns mechanical material categories and leaves pump categories at their subjects', () => {
    for (const [name, category] of [
      ['給水管', '配管（給水・給湯）'],
      ['長方形ダクト', 'ダクト'],
      ['仕切弁', '弁類'],
    ]) {
      const entry = requiredEntry(entry =>
        entry.book === '機械設備' && entry.pickable && entry.row.name === name,
      )
      const [item] = catalogItemsForBreakdownRow(entry)
      expect(item.field).toBe('機械設備')
      expect(item.category).toBe(category)
      expect(item.key).toBe(expectedRowKey(entry))
    }

    const pumps = entries.filter(entry =>
      entry.book === '機械設備' && entry.pickable && entry.row.name.includes('ポンプ'),
    )
    expect(pumps.some(entry => entry.row.name === 'ボイラー給水ポンプ')).toBe(true)
    for (const entry of pumps) {
      expect(catalogItemsForBreakdownRow(entry)[0].category).toBe(entry.subject)
    }

    const elevatorRows = entries.filter(entry => entry.book === '昇降機設備' && entry.pickable)
    expect(elevatorRows.length).toBeGreaterThan(0)
    for (const entry of elevatorRows) {
      const [item] = catalogItemsForBreakdownRow(entry)
      expect(item.field).toBe('昇降機設備')
      expect(item.category).toBe(entry.subject)
      expect(item.key).toBe(expectedRowKey(entry))
    }
  })

  it('expands only pipe kinds and diameters while retaining every location as a candidate', () => {
    expect(water).toBeDefined()
    const kind = water.slots.find(slot => slot.label === '管種')!.choices!
      .find(choice => choice.includes('SGP-VB'))!
    expect(kind).toBeDefined()
    expect(water.slots.find(slot => slot.label === '区分')).toEqual({
      label: '区分',
      choices: PIPE_LOCATIONS,
      condition: true,
    })
    expect(conditionCandidatesFor(water)).toEqual([])

    const selection = {
      options: ['item'],
      values: {
        管種: [kind],
        呼び径: ['25A', '32A'],
        区分: [...PIPE_LOCATIONS],
      },
      text: { 区分: '地中配管' },
    }
    const presets = catalogPresets(water, selection, {
      book: waterEntry.book,
      section: waterEntry.section,
      subject: waterEntry.subject,
      ...(waterEntry.middle !== undefined ? { middle: waterEntry.middle } : {}),
      item: waterEntry.row.name,
    })
    expect(presets).toHaveLength(2)
    expect(presets.map(preset => preset.summary)).toEqual([
      [{ label: '管種', value: kind }, { label: '呼び径', value: '25A' }],
      [{ label: '管種', value: kind }, { label: '呼び径', value: '32A' }],
    ])
    for (const preset of presets) {
      expect(preset.category).toBe('配管（給水・給湯）')
      expect(preset.kind).toBe('length')
      expect(preset.method).toBe('polyline')
      expect(preset.breakdown?.book).toBe('機械設備')
      expect(preset.conditions).toEqual(PIPE_LOCATIONS)
      expect(preset.conditions).not.toBe(PIPE_LOCATIONS)
      expect(fixtureBreakdownError(preset)).toBeUndefined()
    }
    expect(presets[0].conditions).not.toBe(presets[1].conditions)

    const withoutLocations = catalogPresets(water, {
      options: selection.options,
      values: { 管種: [kind], 呼び径: ['25A', '32A'] },
    }, {
      book: waterEntry.book,
      section: waterEntry.section,
      subject: waterEntry.subject,
      ...(waterEntry.middle !== undefined ? { middle: waterEntry.middle } : {}),
      item: waterEntry.row.name,
    })
    expect(withoutLocations.map(fixtureIdentity)).toEqual(presets.map(fixtureIdentity))
    expect(withoutLocations.map(preset => preset.conditions)).toEqual([
      PIPE_LOCATIONS, PIPE_LOCATIONS,
    ])
  })

  it('retains supported mechanical detail categories, slots and book-specific keys', () => {
    for (const [rowName, templates] of Object.entries(MECHANICAL_DETAILS)) {
      for (const template of templates) {
        if (template.master !== undefined) continue
        const key = expectedDetailKey('機械設備', rowName, template.name)
        if (template.variants === undefined && kindForUnit(template.unit) === undefined && template.linked !== 'carry') {
          expect(items.some(item => item.key === key)).toBe(false)
          continue
        }
        const item = requiredItem(candidate => candidate.key === key)
        expect(item.field).toBe('機械設備')
        expect(item.category).toBe(MECHANICAL_DETAIL_CATEGORY[rowName] ?? rowName)
        expect(item.breakdownItem).toBe(rowName)
        expect(item.unit).toBe(template.unit)
        expect(item.slots).toEqual(template.summary ?? [])
      }
    }

    const insulation = requiredItem(item =>
      item.key === expectedDetailKey('機械設備', '保温', '配管保温'),
    )
    const placement = insulation.slots.find(slot => slot.label === '施工箇所')!
    expect(placement.condition).toBe(true)
    const presets = catalogPresets(insulation, {
      options: ['item'],
      values: { 呼び径: ['25A'], 施工箇所: [...placement.choices!] },
    })
    expect(presets).toHaveLength(1)
    expect(presets[0].summary).toEqual([{ label: '呼び径', value: '25A' }])
    expect(presets[0].conditions).toEqual(placement.choices)
  })

  it('keeps same-name electrical and mechanical rows separate and restores candidates by category', () => {
    // No pickable row name is shared by both books; the removal detail 配管撤去 is.
    const electrical = requiredItem(item =>
      item.field === '電気設備' && item.key.startsWith('detail:') && item.name === '配管撤去',
    )
    const mechanical = requiredItem(item =>
      item.field === '機械設備' && item.key.startsWith('detail:') && item.name === '配管撤去',
    )
    expect(electrical.key).not.toBe(mechanical.key)
    expect(electrical).not.toBe(mechanical)
    expect(mechanical.category).toBe('撤去')

    for (const item of [electrical, mechanical, water]) {
      const option = item.options[0]
      const [preset] = catalogPresets(item, { options: [option.key] })
      expect(catalogConditionsForFixture({
        code: option.code,
        spec: option.spec,
        name: option.name,
        category: item.category,
      })).toEqual(preset.conditions ?? [])
    }
  })

  it('preserves the electrical catalog key sequence and mechanical master mappings', () => {
    const masterKeys = [...new Set(QUANTITY_MASTER
      .filter(type => type.field === '電気設備')
      .map(type => `master:${JSON.stringify([type.field, type.category, type.type])}`))]
    // 同じ名前で単位の違う行（ＬＥＤ照明器具 個／灯 など）だけ、単位を鍵に入れて別の品目にする（SPEC-B16）。
    const electricalUnits = new Map<string, Set<string>>()
    for (const entry of entries) {
      if (entry.book !== '電気設備' || entry.row.separate) continue
      const units = electricalUnits.get(entry.row.name) ?? new Set<string>()
      units.add(entry.row.unit)
      electricalUnits.set(entry.row.name, units)
    }
    const rowKeys = [...new Set(entries
      .filter(entry => entry.book === '電気設備' && entry.pickable)
      .map(entry => `row:${JSON.stringify(electricalUnits.get(entry.row.name)!.size > 1
        ? [expectedCategory(entry), entry.row.name, entry.row.unit]
        : [expectedCategory(entry), entry.row.name])}`))]
    const detailKeys = Object.entries(ELECTRICAL_DETAILS).flatMap(([rowName, templates]) =>
      templates
        .filter(template => template.master === undefined
          && (template.variants !== undefined || kindForUnit(template.unit) !== undefined || template.linked === 'carry'))
        .map(template => `detail:${JSON.stringify([rowName, template.name])}`),
    )
    expect(items.filter(item => item.field === '電気設備').map(item => item.key))
      .toEqual([...masterKeys, ...rowKeys, ...detailKeys])

    const mechanicalMasters = items.filter(item =>
      item.field === '機械設備' && item.key.startsWith('master:'),
    )
    expect(mechanicalMasters.length).toBeGreaterThan(0)
    expect(mechanicalMasters.every(item => item.breakdownItem === undefined)).toBe(true)
  })
})

describe('conditionCandidatesFor', () => {
  it('keeps every rule type and category consistent with the catalog', () => {
    const types = new Set(items.map(item => item.type))
    const categories = new Set(items.map(item => item.category))
    const unmatchedTypes = [...new Set(CONDITION_RULES.flatMap(rule =>
      (rule.types ?? []).filter(type => !types.has(type)),
    ))]
    const unmatchedCategories = [...new Set(CONDITION_RULES.flatMap(rule =>
      (rule.categories ?? []).filter(category => !categories.has(category)),
    ))]
    expect(unmatchedTypes, 'Claude へ報告する未一致の types').toEqual([])
    expect(unmatchedCategories, 'Claude へ報告する未一致の categories').toEqual([])

    for (const [index, rule] of CONDITION_RULES.entries()) {
      expect(rule.conditions.length, `規則 ${index + 1} の候補数`).toBeLessThanOrEqual(30)
      for (const condition of rule.conditions) {
        expect(validCondition(condition), `規則 ${index + 1}: ${condition}`).toBe(true)
      }
    }
  })

  it('uses the first matching rule and returns no candidates for an unmatched item', () => {
    const item: CatalogItem = { ...panel, type: '熱感知器', category: '盤類' }
    const rule = CONDITION_RULES.find(rule => rule.types?.includes('熱感知器'))!
    expect(conditionCandidatesFor(item)).toBe(rule.conditions)
    expect(conditionCandidatesFor({
      ...panel, type: '未登録の種類', category: '未登録の分類',
    })).toEqual([])
  })
})

describe('catalog construction conditions', () => {
  const lighting = [
    '天井直付', '天井埋込', '壁付', '吊下げ', '床置・据置',
    '一般（天井・壁）', '金属線ぴ取付け', 'システム天井',
  ]
  const cable = [
    '管内配線',
    '合成樹脂管内配線（PF・CD・FEP）',
    'ケーブルラック配線',
    '二重天井内・二重床内・ピット内・トラフ内配線',
    'サドル止め（コンクリート）',
    'サドル止め・ステープル止め（木造）',
    '地中管路内',
    '架空（ちょう架）',
  ]

  it('adds the required candidates to duct, board, rack, lighting and detector presets', () => {
    const cases: Array<{ item: CatalogItem; conditions: string[] }> = [
      {
        item: requiredItem(item => item.name === 'ライティングダクト'),
        conditions: ['直付', 'つり下げ', '埋込み'],
      },
      { item: panel, conditions: ['壁掛', '自立', '埋込'] },
      {
        item: requiredItem(item => item.key.startsWith('master:') && item.type === 'CR'),
        conditions: ['屋内', '屋外', '1段積', '2段積の2段目'],
      },
      {
        item: requiredItem(item => item.key.startsWith('row:') && item.name === 'ＬＥＤ照明器具'),
        conditions: lighting,
      },
      {
        item: requiredItem(item => item.key.startsWith('row:') && item.name === '熱感知器'),
        conditions: ['天井付', '壁付', 'システム天井'],
      },
      {
        item: requiredItem(item => item.key.startsWith('master:') && item.type === 'DL'),
        conditions: lighting,
      },
    ]
    for (const { item, conditions } of cases) {
      const [preset] = catalogPresets(item, { options: [item.options[0].key] })
      expect(preset.conditions, item.key).toEqual(conditions)
    }
  })

  it('keeps CV candidates unchanged when no rule matches', () => {
    const cv = requiredItem(item => item.key.startsWith('master:') && item.type === 'CV')
    expect(conditionCandidatesFor(cv)).toEqual([])
    for (const option of cv.options) {
      const [preset] = catalogPresets(cv, { options: [option.key] })
      expect(preset.conditions).toEqual(cable)
      expect(preset.conditions).toEqual(option.conditions)
      expect(preset.conditions).not.toBe(option.conditions)
    }
  })

  it('deduplicates in option, condition-slot and rule order and keeps only the first 30', () => {
    const original = Array.from({ length: 29 }, (_, index) => `既存${index + 1}`)
    const item: CatalogItem = {
      ...panel,
      options: [{ ...panel.options[0], conditions: [...original, original[0]] }],
      slots: [
        { label: '施工', condition: true, choices: [original[0], '施工区分', '壁掛'] },
      ],
    }
    const [preset] = catalogPresets(item, { options: [item.options[0].key] })
    expect(preset.conditions).toEqual([...original, '施工区分'])
    expect(preset.conditions).toHaveLength(30)
    expect(item.options[0].conditions).toEqual([...original, original[0]])
    expect(item.slots[0].choices).toEqual([original[0], '施工区分', '壁掛'])
  })

  it('matches L-1 distribution boards, CV specifications and unmatched fixtures', () => {
    expect(catalogConditionsForFixture({
      code: 'L-1', name: '分電盤', category: '盤類',
    })).toEqual(['壁掛', '自立', '埋込'])

    const cv = requiredItem(item => item.key.startsWith('master:') && item.type === 'CV')
    const option = cv.options.find(option => option.code === 'CV' && option.spec === '38sq-3C')
    expect(option).toBeDefined()
    expect(catalogConditionsForFixture({
      code: 'CV', spec: '38sq-3C', name: option!.name, category: cv.category,
    })).toEqual(cable)

    expect(catalogConditionsForFixture({
      code: '未登録', spec: '未登録', name: '未登録の項目', category: 'その他',
    })).toEqual([])
    expect(catalogConditionsForFixture({
      code: '', name: '未登録の項目', category: 'その他',
    })).toEqual([])
  })

  it('prefers exact options and supports name and nonempty type-code fallbacks', () => {
    const cv = requiredItem(item => item.key.startsWith('master:') && item.type === 'CV')
    const option = cv.options.find(option => option.code === 'CV' && option.spec === '38sq-3C')!
    expect(option).toBeDefined()

    // 分類が変わっていても option の code・spec・name の一致を優先する。
    expect(catalogConditionsForFixture({
      code: option.code, spec: option.spec, name: option.name, category: '盤類',
    })).toEqual(cable)

    expect(catalogConditionsForFixture({
      code: 'L-1', spec: '', name: '分電盤', category: '旧分類',
    })).toEqual(['壁掛', '自立', '埋込'])

    expect(catalogConditionsForFixture({
      code: 'CR', name: '旧名称', category: '旧分類',
    })).toEqual(['屋内', '屋外', '1段積', '2段積の2段目'])
  })

  it('returns the same ordered candidates as creating each catalog option', () => {
    for (const item of items) {
      for (const option of item.options) {
        const [preset] = catalogPresets(item, { options: [option.key] })
        expect(catalogConditionsForFixture({
          code: option.code,
          spec: option.spec,
          name: option.name,
          category: item.category,
        }), `${item.key}/${option.key}`).toEqual(preset.conditions ?? [])
      }
    }
  })
})

describe('searchCatalog', () => {
  it('narrows E25 to the conduit and painting options and finds distribution panels', () => {
    const result = searchCatalog('E25')
    expect(result.results.find(result => result.item === conduit)?.options.map(option => option.label))
      .toEqual(['E25'])
    expect(result.results.find(result => result.item === pipePaint)?.options.map(option => option.label))
      .toEqual(['E25塗装'])
    expect(searchCatalog('分電盤').results.some(result =>
      result.item.name === '分電盤' && result.item.category === '盤類',
    )).toBe(true)
  })

  it('matches size terms only against option labels and specs', () => {
    const result = searchCatalog('60', Infinity)
    expect(result.total).toBeGreaterThan(0)
    for (const match of result.results) {
      expect(match.options.every(option =>
        normalizeMasterText(`${option.label} ${option.spec ?? ''}`).includes('60'),
      )).toBe(true)
    }
    const iv = requiredItem(item => item.key.startsWith('master:') && item.type === 'IV')
    const matched = result.results.find(result => result.item === iv)!
    expect(matched.options.map(option => option.spec)).toEqual(['60sq'])
    expect(searchCatalog('ＤＬ　φ１５０').results.find(result => result.item.type === 'DL')
      ?.options.map(option => option.spec)).toEqual(['φ150'])
  })

  it('requires option-specific terms to match the same option', () => {
    expect(searchCatalog('E19 E25').results.some(result => result.item === conduit)).toBe(false)
    expect(searchCatalog('E25 存在しない語').results).toEqual([])
  })

  it('normalizes text and retains all options for shared item words', () => {
    const result = searchCatalog('　電線管　Ｅ　')
    expect(result.results.find(result => result.item === conduit)?.options).toBe(conduit.options)
    expect(searchCatalog('ｌｅｄ 照明器具').results.some(result =>
      result.item.name === 'ＬＥＤ照明器具',
    )).toBe(true)
    expect(searchCatalog('中浅形').results.some(result => result.item === outlet)).toBe(true)
  })

  it('returns no results for empty queries and preserves source order and total under limits', () => {
    expect(searchCatalog('')).toEqual({ results: [], total: 0 })
    expect(searchCatalog(' \t\n　')).toEqual({ results: [], total: 0 })
    const all = searchCatalog('電気設備', Infinity)
    const expected = items.filter(item => item.field === '電気設備')
    expect(all.results.map(result => result.item)).toEqual(expected)
    expect(all.total).toBe(expected.length)
    expect(searchCatalog('電気設備').results).toEqual(all.results.slice(0, 200))
    expect(searchCatalog('電気設備', 2.9)).toEqual({
      results: all.results.slice(0, 2), total: all.total,
    })
    for (const limit of [0, -1]) {
      expect(searchCatalog('電気設備', limit)).toEqual({ results: [], total: all.total })
    }
  })
})

describe('SPEC-B10-3 mechanical row conversions and link categories', () => {
  it('provides twenty rectangular duct length specifications with area conversion', () => {
    const entry = entries.find(candidate =>
      candidate.book === '機械設備'
      && candidate.row.name === '長方形ダクト'
      && candidate.pickable
      && !candidate.row.separate,
    )
    expect(entry).toBeDefined()
    const rowItems = catalogItemsForBreakdownRow(entry!)
    expect(rowItems).toHaveLength(1)
    const item = rowItems[0]

    expect(item.unit).toBe('㎡')
    expect(item.category).toBe('ダクト')
    expect(item.options).toHaveLength(20)
    expect(new Set(item.options.map(option => option.key)).size).toBe(20)
    for (const option of item.options) {
      expect(option.kind).toBe('length')
      expect(option.method).toBe('polyline')
      expect(option.convert?.unit).toBe('㎡')
      expect(option.key).toBe(option.code)
      expect(option.label).toBe(option.code)
      expect(option.name).toBe('長方形ダクト')
      expect(option.note).toBe(option.convert?.basis)
    }

    const option = item.options.find(candidate => candidate.code === 'SD300×200')
    expect(option).toMatchObject({
      key: 'SD300×200',
      label: 'SD300×200',
      code: 'SD300×200',
      spec: '300×200',
      name: '長方形ダクト',
      kind: 'length',
      method: 'polyline',
      note: '周長 2×(300＋200)mm',
      convert: { factor: 1, unit: '㎡', basis: '周長 2×(300＋200)mm' },
    })

    expect(item.slots).toEqual((entry!.row.summary ?? []).map(label => {
      const choices = summaryChoices(entry!.row.name, label, entry!.book)
      return {
        label,
        ...(choices.length ? { choices } : {}),
        ...(summaryIsCondition(entry!.row.name, label, entry!.book)
          ? { condition: true }
          : {}),
      }
    }))

    const presets = catalogPresets(item, { options: [option!.key] })
    expect(presets).toHaveLength(1)
    const preset = presets[0]
    expect(preset.kind).toBe('length')
    expect(preset.method).toBe('polyline')
    expect(preset.convert).toEqual(option!.convert)
    expect(preset.convert).not.toBe(option!.convert)

    const created: CountFixture = {
      ...preset,
      id: 'rectangular-duct',
      order: 0,
      style: {
        shape: 'circle', fill: 'none', color: [1, 0, 0],
        size: 10, opacity: .8, showCode: true,
      },
    }
    expect(fixtureBreakdownError(created)).toBeUndefined()
    expect(quantityOutputKind(created)).toBe('area')
    expect(created.convert?.unit).toBe('㎡')
  })

  it('keeps spiral duct rows without conversion on their existing specifications', () => {
    const entry = entries.find(candidate =>
      candidate.book === '機械設備'
      && candidate.row.name === 'スパイラルダクト'
      && candidate.pickable
      && !candidate.row.separate,
    )
    expect(entry).toBeDefined()
    const rowItems = catalogItemsForBreakdownRow(entry!)
    expect(rowItems).toHaveLength(1)
    expect(rowItems[0].options).toEqual([{
      key: 'item',
      label: '',
      code: '',
      name: entry!.row.name,
      ...kindForUnit(entry!.row.unit),
    }])
  })

  it('contains every automatic source category used by mechanical insulation and paint rules', () => {
    const categories = new Set(items
      .filter(item => item.field === '機械設備')
      .map(item => item.category))

    for (const id of ['pipe-insulation', 'pipe-paint', 'duct-insulation', 'duct-paint']) {
      const rule = LINK_RULES.find(candidate => candidate.id === id)
      expect(rule).toBeDefined()
      expect(rule!.auto.categories).toBeDefined()
      expect(rule!.auto.categories!.length).toBeGreaterThan(0)
      for (const category of rule!.auto.categories!) {
        expect(categories.has(category), `${id}: ${category}`).toBe(true)
      }
    }
  })
})

describe('SPEC-B11-2 building catalog', () => {
  function categoryFor(entry: BreakdownEntry): string {
    return expectedCategory(entry)
  }

  function buildingRowItem(entry: BreakdownEntry): CatalogItem {
    const key = expectedRowKey(entry)
    return requiredItem(item => item.key === key)
  }

  it('registers every non-separate building row with its material category', () => {
    for (const entry of breakdownEntries('建築')) {
      if (entry.row.separate) continue
      const item = buildingRowItem(entry)
      expect(item.field, entry.key).toBe('建築')
      expect(item.category, entry.key).toBe(categoryFor(entry))
      expect(item.type, entry.key).toBe(entry.row.name)
      expect(item.breakdownItem, entry.key).toBe(entry.row.name)
      expect(item.unit, entry.key).toBe(entry.row.unit)
      expect(item.options.length, entry.key).toBeGreaterThan(0)
      expect(catalogItemsForBreakdownRow(entry), entry.key).toEqual([item])
      if (linkRuleForDetail(entry.row.name) !== undefined) {
        const variants = BUILDING_ROW_VARIANTS[entry.row.name]?.variants ?? []
        expect(item.options, entry.key).toHaveLength(1 + variants.length)
        expect(item.options[0].key, entry.key).toBe('item')
      }
    }
  })

  it('classifies rebar, waterproofing renovation, removal and fencing', () => {
    const building = breakdownEntries('建築')
    const rebar = building.find(entry =>
      entry.row.name === '異形鉄筋' && entry.row.unit === 't' && !entry.row.separate,
    )!
    const waterproofing = building.find(entry =>
      entry.section === '庁舎（改修）'
      && entry.subject === '防水改修'
      && !entry.middle?.startsWith('撤去')
      && !entry.row.separate,
    )!
    const removal = building.find(entry =>
      entry.middle?.startsWith('撤去') && !entry.row.separate,
    )!
    const fence = building.find(entry =>
      entry.subject === '囲障' && !entry.row.separate,
    )!

    for (const entry of [rebar, waterproofing, removal, fence]) {
      expect(entry).toBeDefined()
    }
    expect(buildingRowItem(rebar).category).toBe('鉄筋')
    expect(buildingRowItem(waterproofing).category).toBe('防水')
    expect(buildingRowItem(removal).category).toBe('撤去')
    expect(buildingRowItem(fence).category).toBe('外構')
    expect(buildingRowItem(rebar).options).toHaveLength(1)
  })

  it('keeps all building detail keys separate between new construction and renovation', () => {
    const sources = [
      { scope: '新営', details: BUILDING_DETAILS },
      { scope: '改修', details: BUILDING_RENOVATION_DETAILS },
    ] as const
    const expectedKeys: string[] = []

    for (const source of sources) {
      for (const [rowName, templates] of Object.entries(source.details)) {
        for (const template of templates) {
          const key = `detail:${JSON.stringify(['建築', source.scope, rowName, template.name])}`
          expectedKeys.push(key)
          const item = requiredItem(candidate => candidate.key === key)
          expect(item.field, key).toBe('建築')
          expect(item.category, key).toBe(rowName)
          expect(item.type, key).toBe(template.name)
          expect(item.unit, key).toBe(template.unit)
          expect(item.slots, key).toEqual(template.summary ?? [])
        }
      }
    }

    const actual = items.filter(item => item.field === '建築' && item.key.startsWith('detail:'))
    expect(actual.map(item => item.key)).toEqual(expectedKeys)
    expect(new Set(actual.map(item => item.key)).size).toBe(actual.length)

    for (const entry of breakdownEntries('建築').filter(entry => entry.row.separate)) {
      const scope = entry.section === '庁舎（改修）' ? '改修' : '新営'
      const expected = entry.details.map(template =>
        `detail:${JSON.stringify(['建築', scope, entry.row.name, template.name])}`,
      )
      expect(catalogItemsForBreakdownRow(entry).map(item => item.key), entry.key).toEqual(expected)
    }
  })

  it('returns distinct curing items and preserves their different summary slots', () => {
    const building = breakdownEntries('建築')
    const fresh = building.find(entry =>
      entry.section === '庁舎' && entry.subject === '直接仮設' && entry.row.name === '養生',
    )!
    const renovation = building.find(entry =>
      entry.section === '庁舎（改修）' && entry.subject === '直接仮設' && entry.row.name === '養生',
    )!
    const freshItems = catalogItemsForBreakdownRow(fresh)
    const renovationItems = catalogItemsForBreakdownRow(renovation)

    expect(freshItems.map(item => item.name)).toEqual(['養生（延べ面積）', '養生（部位）'])
    expect(renovationItems.map(item => item.name)).toEqual(['養生'])
    expect(renovationItems[0].slots.map(slot => slot.label)).toEqual(['改修の種類'])
    expect(freshItems.every(item => !renovationItems.some(other => other.key === item.key))).toBe(true)

    // 新営・改修で名称まで同じ明細も、別の品目になる。
    const freshScaffold = requiredItem(item =>
      item.key === `detail:${JSON.stringify(['建築', '新営', '外部足場', '枠組本足場'])}`,
    )
    const renovationScaffold = requiredItem(item =>
      item.key === `detail:${JSON.stringify(['建築', '改修', '外部足場', '枠組本足場'])}`,
    )
    expect(freshScaffold).not.toBe(renovationScaffold)
    expect(freshScaffold.key).not.toBe(renovationScaffold.key)
  })

  it('reports every choice key whose exact row spelling is missing from the building groups', () => {
    const names = new Set(BUILDING_GROUPS.flatMap(group => group.rows.map(row => row.name)))
    const missing = Object.keys(BUILDING_CHOICES).filter(key => !names.has(key.split('|')[0]))
    expect(
      missing,
      `Claudeへの報告対象: BUILDING_GROUPS に細目名がない BUILDING_CHOICES の鍵: ${missing.join('、')}`,
    ).toEqual([])
  })

  it('creates a volume preset with concrete strength and slump as summary values', () => {
    const entry = breakdownEntries('建築').find(candidate =>
      candidate.section === '庁舎'
      && candidate.subject === 'コンクリート'
      && candidate.middle === '躯体'
      && candidate.row.name === '普通コンクリート（軸部）',
    )!
    expect(entry).toBeDefined()
    const [item] = catalogItemsForBreakdownRow(entry)
    expect(item).toBeDefined()
    expect(item.slots.find(slot => slot.label === '強度')?.choices).toContain('24')
    expect(item.slots.find(slot => slot.label === 'スランプ')?.choices).toContain('18')
    expect(item.slots.every(slot => !slot.condition)).toBe(true)

    const presets = catalogPresets(item, {
      options: [item.options[0].key],
      values: { 強度: ['24'], スランプ: ['18'] },
    }, {
      book: entry.book,
      section: entry.section,
      subject: entry.subject,
      middle: entry.middle,
      item: entry.row.name,
    })

    expect(presets).toHaveLength(1)
    expect(presets[0]).toMatchObject({
      category: 'コンクリート',
      name: '普通コンクリート（軸部）',
      kind: 'volume',
      method: 'polygonDepth',
      aggregation: 'document',
      breakdown: {
        book: '建築',
        section: '庁舎',
        subject: 'コンクリート',
        middle: '躯体',
        item: '普通コンクリート（軸部）',
      },
    })
    expect(presets[0].summary).toEqual([
      { label: '強度', value: '24' },
      { label: 'スランプ', value: '18' },
    ])
    expect(fixtureBreakdownError(presets[0])).toBeUndefined()
  })

  it('leaves building quantity-master types without a breakdown-item mapping', () => {
    for (const type of QUANTITY_MASTER.filter(candidate => candidate.field === '建築')) {
      const key = `master:${JSON.stringify([type.field, type.category, type.type])}`
      const item = requiredItem(candidate => candidate.key === key)
      expect(item.breakdownItem, key).toBeUndefined()
      expect(item.category, key).toBe(CATEGORY_ALIASES[type.category] ?? type.category)
      expect(item.options.map(option => option.key), key).toEqual(
        masterEntries()
          .filter(entry =>
            entry.field === type.field && entry.category === type.category && entry.type === type.type,
          )
          .map(entry => entry.key),
      )
    }
  })

  it('retains master order and includes all three-book rows with unit-aware keys', () => {
    const masterKeys = [...new Set(QUANTITY_MASTER.map(type =>
      `master:${JSON.stringify([type.field, type.category, type.type])}`,
    ))]
    const rowKeys: string[] = []
    const seenRows = new Set<string>()

    for (const entry of entries.filter(candidate =>
      candidate.book !== '建築' && !candidate.row.separate,
    )) {
      const key = expectedRowKey(entry)
      if (!seenRows.has(key)) {
        seenRows.add(key)
        rowKeys.push(key)
      }
    }

    const detailKeys: string[] = []
    for (const source of detailSources.filter(candidate => candidate.book !== '建築')) {
      for (const [rowName, templates] of Object.entries(source.details)) {
        for (const template of templates) {
          if (template.master !== undefined) continue
          const hasOptions = template.variants !== undefined
            ? template.variants.length > 0
            : kindForUnit(template.unit) !== undefined || template.linked === 'carry'
          if (!hasOptions) continue
          const parts = [rowName, template.name]
          detailKeys.push(
            `detail:${JSON.stringify(source.book === '電気設備' ? parts : [source.book, ...parts])}`,
          )
        }
      }
    }

    const expected = [...masterKeys, ...rowKeys, ...detailKeys]
    const actual = items.filter(item => item.key.startsWith('master:') || item.field !== '建築')
    expect(actual).toHaveLength(expected.length)
    expect(actual.map(item => item.key)).toEqual(expected)
  })

  it('keeps every B03e condition-rule type and category present in the catalog', () => {
    const types = new Set(items.map(item => item.type))
    const categories = new Set(items.map(item => item.category))

    for (const rule of CONDITION_RULES) {
      for (const type of rule.types ?? []) {
        expect(types.has(type), `CONDITION_RULES の種類が品目一覧にありません: ${type}`).toBe(true)
      }
      for (const category of rule.categories ?? []) {
        expect(
          categories.has(category),
          `CONDITION_RULES の分類が品目一覧にありません: ${category}`,
        ).toBe(true)
      }
    }
  })
})

it('B07-2a: building rebar in tonnes has one count/click option and is available from breakdown', () => {
  const rebarEntries = entries.filter(entry =>
    entry.book === '建築' && entry.row.name === '異形鉄筋'
    && entry.row.unit === 't' && !entry.row.separate,
  )
  expect(rebarEntries.length).toBeGreaterThan(0)
  expect(kindForUnit('t')).toBeUndefined()

  for (const entry of rebarEntries) {
    const choices = catalogItemsForBreakdownRow(entry)
    expect(choices).toHaveLength(1)
    const item = choices[0]
    expect(item.options).toHaveLength(1)
    expect(item.options[0]).toMatchObject({
      name: '異形鉄筋', kind: 'count', method: 'click',
    })
    const presets = catalogPresets(item, {
      options: [item.options[0].key],
    }, {
      book: entry.book,
      section: entry.section,
      subject: entry.subject,
      ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
    })
    expect(presets).toHaveLength(1)
    expect(presets[0]).toMatchObject({
      name: '異形鉄筋', kind: 'count', method: 'click',
      breakdown: { book: '建築', item: '異形鉄筋' },
    })
  }
  expect(searchCatalog('異形鉄筋').results.some(result =>
    result.item.field === '建築' && result.item.unit === 't'
    && result.options.length === 1,
  )).toBe(true)
})

describe('SPEC-B16 catalog coverage, conversions and compatibility', () => {
  function buildingSelection(name: string, spec?: string) {
    const entry = requiredEntry(candidate =>
      candidate.book === '建築'
      && candidate.row.name === name
      && !candidate.row.separate,
    )
    const choices = catalogItemsForBreakdownRow(entry)
    expect(choices, entry.key).toHaveLength(1)
    const item = choices[0]
    const option = spec === undefined
      ? item.options[0]
      : item.options.find(candidate => candidate.spec === spec)
    if (option === undefined) throw new Error(`規格が見つかりません: ${name}/${spec}`)
    const presets = catalogPresets(item, { options: [option.key] }, {
      book: entry.book,
      section: entry.section,
      subject: entry.subject,
      ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
    })
    expect(presets).toHaveLength(1)
    return { entry, item, option, preset: presets[0] }
  }

  it('converts one square metre of 9 mm plate into tonnes with the prescribed allowance', () => {
    expect(linkRuleForDetail('鋼板')).toBeUndefined()
    const { item, option, preset } = buildingSelection('鋼板', 't=9')
    expect(item.unit).toBe('t')
    expect(preset).toMatchObject({
      name: '鋼板',
      spec: 't=9',
      kind: 'area',
      method: 'polygon',
      aggregation: 'document',
      convert: { unit: 't' },
      breakdown: { book: '建築', item: '鋼板' },
    })
    // 元データの係数は小数点以下6桁に丸められている。
    const tonnesPerSquareMetre = 0.009 * 7.85 * 1.03
    expect(preset.convert?.factor).toBe(Number(tonnesPerSquareMetre.toFixed(6)))
    expect(preset.convert).toEqual(option.convert)
    expect(preset.convert).not.toBe(option.convert)
    expect(quantityOutputKind(preset as CountFixture)).toBe('mass')
    expect(quantityUnit(preset as CountFixture)).toBe('t')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('converts one metre of square tube into tonnes with the prescribed allowance', () => {
    const { item, preset } = buildingSelection('角形鋼管', '□-100×100×3.2')
    expect(item.unit).toBe('t')
    expect(item.category).toBe('鉄骨')
    expect(preset).toMatchObject({
      name: '角形鋼管',
      spec: '□-100×100×3.2',
      kind: 'length',
      method: 'polyline',
      aggregation: 'document',
      convert: { unit: 't' },
    })
    const tonnesPerMetre = 0.0157 * 3.2 * (200 - 10.5184) / 1000 * 1.05
    expect(preset.convert?.factor).toBe(Number(tonnesPerMetre.toFixed(6)))
    expect(quantityOutputKind(preset as CountFixture)).toBe('mass')
    expect(quantityUnit(preset as CountFixture)).toBe('t')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
    expect(searchCatalog('建築 角形鋼管').results.some(result =>
      result.item === item && result.options.length > 0,
    )).toBe(true)
  })

  it('picks high-strength bolt sets by count and converts their mass into tonnes', () => {
    const { preset } = buildingSelection('高力ボルト類')
    expect(preset).toMatchObject({
      name: '高力ボルト類',
      kind: 'count',
      method: 'click',
      aggregation: 'document',
      convert: { unit: 't' },
    })
    expect(preset.convert!.factor).toBeGreaterThan(0)
    expect(preset).not.toHaveProperty('unit')
    expect(quantityOutputKind(preset as CountFixture)).toBe('mass')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it.each([
    ['低木', '株'],
    ['木材加工', '式'],
  ] as const)('picks %s by count with unit %s', (name, unit) => {
    const { item, preset } = buildingSelection(name)
    expect(item.unit).toBe(unit)
    expect(preset).toMatchObject({
      name,
      kind: 'count',
      method: 'click',
      unit,
      aggregation: 'location',
    })
    expect(preset).not.toHaveProperty('convert')
    expect(quantityUnit(preset as CountFixture)).toBe(unit)
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('retains every building variant, factor and full note without mutating source data', () => {
    const before = JSON.stringify(BUILDING_ROW_VARIANTS)
    for (const [name, source] of Object.entries(BUILDING_ROW_VARIANTS)) {
      const rows = entries.filter(entry =>
        entry.book === '建築' && entry.row.name === name && !entry.row.separate,
      )
      expect(rows.length, name).toBeGreaterThan(0)
      for (const entry of rows) {
        const [item] = catalogItemsForBreakdownRow(entry)
        expect(item, entry.key).toBeDefined()
        const hasLinkRule = linkRuleForDetail(name) !== undefined
        expect(item.options).toHaveLength(source.variants.length + (hasLinkRule ? 1 : 0))
        if (hasLinkRule) {
          expect(item.options[0].key).toBe('item')
          expect(item.options[0].convert).toBeUndefined()
        }
        const variantOptions = item.options.filter(option => option.convert !== undefined)
        expect(variantOptions.map(option => option.key)).toEqual(source.variants.map(v => v.code))
        for (const [index, option] of variantOptions.entries()) {
          const variant = source.variants[index]
          expect(option.summary).toEqual(variant.summary)
          if (variant.summary !== undefined) expect(option.summary).not.toBe(variant.summary)
          expect(option).toMatchObject({
            key: variant.code,
            label: variant.summary === undefined ? variant.code : variant.spec,
            code: variant.code,
            spec: variant.spec,
            name,
            kind: source.pick,
            method: source.pick === 'length'
              ? 'polyline'
              : source.pick === 'area' ? 'polygon' : 'click',
            note: variant.convert.basis,
            convert: { factor: variant.convert.factor, unit: 't' },
          })
          expect(option.convert).not.toBe(variant.convert)
          expect(option.convert!.basis.length).toBeLessThanOrEqual(60)
          if (variant.convert.basis.length <= 60) {
            expect(option.convert!.basis).toBe(variant.convert.basis)
          } else {
            expect(option.convert!.basis).toHaveLength(60)
            expect(option.convert!.basis.endsWith('…')).toBe(true)
            expect(variant.convert.basis.startsWith(option.convert!.basis.slice(0, -1)))
              .toBe(true)
          }
          const [preset] = catalogPresets(item, { options: [option.key] })
          expect(preset.convert).toEqual(option.convert)
          expect(preset.convert).not.toBe(option.convert)
          expect(fixtureBreakdownError(preset)).toBeUndefined()
        }
      }
    }
    expect(JSON.stringify(BUILDING_ROW_VARIANTS)).toBe(before)
  })

  it('separates panel air filters measured in units and lump sums', () => {
    const resolved = (['台', '式'] as const).map(unit => {
      const entry = requiredEntry(candidate =>
        candidate.book === '機械設備'
        && candidate.row.name === 'パネル形エアフィルター'
        && candidate.row.unit === unit
        && !candidate.row.separate,
      )
      const choices = catalogItemsForBreakdownRow(entry)
      expect(choices).toHaveLength(1)
      const item = choices[0]
      expect(item.unit).toBe(unit)
      expect(item.key).toBe(`row:${JSON.stringify([
        '機械設備', expectedCategory(entry), 'パネル形エアフィルター', unit,
      ])}`)
      const [preset] = catalogPresets(item, { options: [item.options[0].key] })
      expect(preset).toMatchObject({
        name: 'パネル形エアフィルター',
        kind: 'count',
        method: 'click',
        unit,
        aggregation: 'location',
      })
      return item
    })
    expect(resolved[0]).not.toBe(resolved[1])
    expect(resolved[0].key).not.toBe(resolved[1].key)
  })

  it('preserves legacy row keys when a non-building name has no unit conflict', () => {
    for (const entry of entries) {
      if (entry.book === '建築' || entry.row.separate) continue
      const conflicting = entries.some(other =>
        !other.row.separate
        && other.book === entry.book
        && other.row.name === entry.row.name
        && other.row.unit !== entry.row.unit,
      )
      if (conflicting) continue
      const parts = [expectedCategory(entry), entry.row.name]
      const legacyKey = `row:${JSON.stringify(
        entry.book === '電気設備' ? parts : [entry.book, ...parts],
      )}`
      expect(catalogItemsForBreakdownRow(entry)
        .filter(item => item.key.startsWith('row:'))
        .map(item => item.key), entry.key).toEqual([legacyKey])
    }
  })

  it('rejects a same-name item whose unit differs from the requested row', () => {
    const entry = requiredEntry(candidate =>
      candidate.book === '建築'
      && candidate.row.name === '角形鋼管'
      && candidate.row.unit === 't'
      && !candidate.row.separate,
    )
    expect(catalogItemsForBreakdownRow({
      ...entry,
      row: { ...entry.row, unit: '式' },
      pickable: true,
    })).toEqual([])

    const ordinary = requiredEntry(candidate =>
      candidate.book === '機械設備'
      && candidate.row.name === '給水管'
      && candidate.row.unit === 'm'
      && !candidate.row.separate,
    )
    expect(catalogItemsForBreakdownRow({
      ...ordinary,
      row: { ...ordinary.row, unit: '未対応単位' },
      pickable: false,
    })).toEqual([])
  })

  it.each(['台', '式', '株'] as const)('reads and saves count unit %s in version 1 data', unit => {
    const fixture: CountFixture = {
      id: `count-${unit}`,
      name: '個数項目',
      code: '',
      category: '試験',
      unit,
      order: 0,
      style: {
        shape: 'circle', fill: 'none', color: [1, 0, 0],
        size: 10, opacity: .8, showCode: true,
      },
    }
    expect(kindForUnit(unit)).toEqual({ kind: 'count', method: 'click' })
    expect(fixtureBreakdownError(fixture)).toBeUndefined()

    const existing = parseCountFixtures(JSON.stringify({ version: 1, fixtures: [fixture] }))
    expect(existing).toHaveLength(1)
    expect(existing[0]).toMatchObject(fixture)

    const raw = serializeCountFixtures(existing)
    expect(JSON.parse(raw).version).toBe(1)
    const restored = parseCountFixtures(raw)
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject(fixture)
    expect(quantityUnit(restored[0])).toBe(unit)
  })
})

describe('SPEC-B24 steel variants and automatic summaries', () => {
  const steelEntry = requiredEntry(entry =>
    entry.book === '建築'
    && entry.section === '庁舎'
    && entry.subject === '鉄骨'
    && entry.middle === '本体鉄骨・鋼材'
    && entry.row.name === '形鋼'
    && !entry.row.separate,
  )
  const steel = catalogItemsForBreakdownRow(steelEntry)[0]
  const steelPosition: CatalogPosition = {
    book: steelEntry.book,
    section: steelEntry.section,
    subject: steelEntry.subject,
    middle: steelEntry.middle,
    item: steelEntry.row.name,
  }

  it('offers the original linked choice followed by all 48 length variants', () => {
    expect(LINK_RULES.find(rule => rule.details.includes('形鋼'))?.kind).toBe('steel')
    const steelItems = items.filter(item =>
      item.field === '建築' && item.key.startsWith('row:')
      && item.name === '形鋼' && item.unit === 't',
    )
    expect(steelItems.length).toBeGreaterThan(0)
    for (const item of steelItems) {
      expect(item.options).toHaveLength(49)
      expect(item.options[0]).toMatchObject({
        key: 'item',
        label: '鉄骨の部材から（連動）',
        code: '',
        name: '形鋼',
        kind: 'count',
        method: 'click',
      })
      expect(item.options[0]).not.toHaveProperty('convert')
      expect(item.options.slice(1).map(option => option.spec))
        .toEqual(BUILDING_ROW_VARIANTS.形鋼.variants.map(variant => variant.spec))
      expect(item.options.slice(1).every(option =>
        option.kind === 'length' && option.method === 'polyline',
      )).toBe(true)
      for (const [shape, count] of [
        ['H形鋼', 21], ['山形鋼', 14], ['溝形鋼', 7], ['I形鋼', 6],
      ] as const) {
        expect(item.options.filter(option => option.summary?.形状 === shape)).toHaveLength(count)
      }
      const [linked] = catalogPresets(item, { options: ['item'] })
      expect(linked).toMatchObject({ name: '形鋼', kind: 'count', method: 'click' })
      expect(linked).not.toHaveProperty('convert')
      const rule = catalogLinkRuleForPreset(linked)
      expect(rule).toBe(linkRuleForDetail('形鋼'))
      expect(rule).toMatchObject({
        kind: 'steel',
        steel: { output: 'mass', basis: 'required' },
      })
    }
  })

  it('creates H-400×200×8×13 as an ordinary length item with its summary and conversion', () => {
    const option = steel.options.find(option => option.spec === 'H-400×200×8×13')!
    expect(option).toBeDefined()
    expect(option.label).toBe('H-400×200×8×13')
    const [preset] = catalogPresets(steel, {
      options: [option.key],
      values: { 規格: ['SS400'], 形状: ['山形鋼', '溝形鋼'] },
      text: { 寸法: '入力した別の寸法' },
    }, steelPosition)
    expect(preset).toMatchObject({
      name: '形鋼',
      spec: 'H-400×200×8×13',
      kind: 'length',
      method: 'polyline',
      aggregation: 'document',
      convert: { unit: 't' },
      breakdown: steelPosition,
    })
    expect(preset.convert?.factor).toBeCloseTo(65.4 * 1.05 / 1000, 6)
    expect(preset.summary).toHaveLength(3)
    expect(preset.summary).toEqual(expect.arrayContaining([
      { label: '規格', value: 'SS400' },
      { label: '形状', value: 'H形鋼' },
      { label: '寸法', value: 'H-400×200×8×13' },
    ]))
    expect(preset).not.toHaveProperty('link')
    expect(catalogLinkRuleForPreset(preset)).toBeUndefined()
    expect(quantityUnit(preset as CountFixture)).toBe('t')
    expect(quantityOutputKind(preset as CountFixture)).toBe('mass')
    expect(fixtureBreakdownError(preset)).toBeUndefined()

    const fromSpec = requiredItem(item => item.key === steel.key)
    expect(catalogPresets(fromSpec, {
      options: [option.key], values: { 規格: ['SS400'] },
    }, steelPosition)).toEqual([preset])
  })

  it('fills square-tube shape and dimensions and overrides conflicting selections', () => {
    const entry = requiredEntry(entry =>
      entry.book === '建築' && entry.row.name === '角形鋼管' && !entry.row.separate,
    )
    const [item] = catalogItemsForBreakdownRow(entry)
    const option = item.options.find(option => option.spec === '□-100×100×3.2')!
    const presets = catalogPresets(item, {
      options: [option.key],
      values: { 形状: ['長方形', 'ほかの形状'] },
      text: { 寸法: '別の寸法' },
    })
    expect(presets).toHaveLength(1)
    expect(presets[0].summary).toEqual([
      { label: '形状', value: '正方形' },
      { label: '寸法', value: '□-100×100×3.2' },
    ])
    expect(option.summary).toEqual({
      形状: '正方形', 寸法: '□-100×100×3.2',
    })
  })

  it('makes four items from two variants and two grades without multiplying fixed dimensions', () => {
    const options = steel.options.filter(option => option.summary?.形状 === 'H形鋼').slice(0, 2)
    const presets = catalogPresets(steel, {
      options: options.map(option => option.key),
      values: {
        規格: ['SS400', 'SN400B'],
        形状: Array.from({ length: 101 }, (_, index) => `入力形状${index}`),
      },
      text: { 寸法: '入力した寸法' },
    })
    expect(presets).toHaveLength(4)
    for (const option of options) {
      const matching = presets.filter(preset => preset.spec === option.spec)
      expect(matching).toHaveLength(2)
      expect(matching.map(preset =>
        preset.summary?.find(field => field.label === '規格')?.value,
      )).toEqual(['SS400', 'SN400B'])
      for (const preset of matching) {
        expect(preset.summary).toEqual(expect.arrayContaining([
          { label: '形状', value: option.summary!.形状 },
          { label: '寸法', value: option.summary!.寸法 },
        ]))
        expect(catalogLinkRuleForPreset(preset)).toBeUndefined()
      }
    }
    presets[0].summary!.find(field => field.label === '形状')!.value = '変更'
    expect(options[0].summary!.形状).toBe('H形鋼')
    expect(presets[1].summary!.find(field => field.label === '形状')!.value).toBe('H形鋼')
  })

  it('keeps entered dimensions for the linked choice when it is selected with a variant', () => {
    const option = steel.options.find(option => option.spec === 'H-400×200×8×13')!
    const presets = catalogPresets(steel, {
      options: ['item', option.key],
      values: { 規格: ['SS400', 'SN400B'], 形状: ['山形鋼', '溝形鋼'] },
      text: { 寸法: '連動用の寸法' },
    })
    expect(presets).toHaveLength(6)
    const linked = presets.filter(preset => preset.convert === undefined)
    const variants = presets.filter(preset => preset.convert !== undefined)
    expect(linked).toHaveLength(4)
    expect(variants).toHaveLength(2)
    for (const preset of linked) {
      expect(preset.summary).toContainEqual({ label: '寸法', value: '連動用の寸法' })
      expect(catalogLinkRuleForPreset(preset)?.kind).toBe('steel')
    }
    for (const preset of variants) {
      expect(preset.summary).toContainEqual({ label: '寸法', value: option.spec! })
      expect(catalogLinkRuleForPreset(preset)).toBeUndefined()
    }
  })

  it('applies the 100-item limit to the sum of each option’s actual combinations', () => {
    const item: CatalogItem = {
      ...panel,
      slots: [{ label: '形式', choices: ['標準'] }],
      options: [
        { ...panel.options[0], key: 'fixed', summary: { 形式: '固定' } },
        { ...panel.options[0], key: 'free' },
      ],
    }
    const values = Array.from({ length: 100 }, (_, index) => `値${index}`)
    expect(catalogPresets(item, {
      options: ['fixed', 'free'], values: { 形式: values.slice(0, 99) },
    })).toHaveLength(100)
    expect(() => catalogPresets(item, {
      options: ['fixed', 'free'], values: { 形式: values },
    })).toThrow(combinationError)
  })

  it('retains link-rule eligibility for electrical, mechanical and unconverted items', () => {
    for (const item of items) {
      for (const option of item.options) {
        const [preset] = catalogPresets(item, { options: [option.key] })
        if (item.field === '建築' && option.convert !== undefined
          && item.options.some(candidate => candidate.key === 'item')) continue
        expect(catalogLinkRuleForPreset(preset), `${item.key}/${option.key}`)
          .toBe(linkRuleForDetail(preset.name))
      }
    }
  })
})

describe('SPEC-B17 electrical row master overlays', () => {
  const lightingEntry = requiredEntry(entry =>
    entry.book === '電気設備'
    && entry.section === '庁舎'
    && entry.subject === '電灯設備'
    && entry.middle === '電灯分岐'
    && entry.row.name === 'ＬＥＤ照明器具'
    && entry.row.unit === '個'
    && !entry.row.separate,
  )
  const lightingPosition: CatalogPosition = {
    book: lightingEntry.book,
    section: lightingEntry.section,
    subject: lightingEntry.subject,
    middle: lightingEntry.middle,
  }

  function rowMaster(entry: BreakdownEntry, type: string): CatalogItem {
    const item = catalogItemsForBreakdownRow(entry).find(item =>
      item.key.startsWith('master:') && item.type === type,
    )
    if (item === undefined) throw new Error(`器具の種類が見つかりません: ${type}`)
    return item
  }

  it('offers seven lighting types followed by the unchanged symbol-only item', () => {
    const choices = catalogItemsForBreakdownRow(lightingEntry)
    expect(choices).toHaveLength(8)
    expect(choices.slice(0, -1).map(item => item.type))
      .toEqual(['DL', 'BL', 'BE', 'BR', 'PD', 'SP', 'OL'])
    expect(choices[7]).toBe(requiredItem(item =>
      item.key === expectedRowKey(lightingEntry),
    ))
    expect(choices[7].options).toEqual([{
      key: 'item',
      label: '',
      code: '',
      name: 'ＬＥＤ照明器具',
      kind: 'count',
      method: 'click',
    }])

    for (const item of choices.slice(0, -1)) {
      const base = requiredItem(candidate =>
        candidate.key.startsWith('master:')
        && candidate.field === '電気設備'
        && candidate.type === item.type,
      )
      expect(item.key).toBe(`${base.key}#row:${expectedRowKey(lightingEntry)}`)
      expect(item).not.toBe(base)
      expect(item.options).toBe(base.options)
      expect(item.name).toBe(base.name)
      expect(item.category).toBe(base.category)
      expect(item.unit).toBe('個')
      expect(item.breakdownItem).toBe('ＬＥＤ照明器具')
      expect(item.slots).toEqual([{ label: '記号' }])
      expect(item.defaultSymbolFromCode).toBe(true)
      expect(items.some(candidate => candidate.key === item.key)).toBe(false)
    }
    expect(rowMaster(lightingEntry, 'DL').options.map(option => option.spec))
      .toEqual(['φ100', 'φ125', 'φ150', 'φ200'])
  })

  it('adds DL φ150 with its master attributes, row position and default symbol', () => {
    const item = rowMaster(lightingEntry, 'DL')
    const option = item.options.find(option => option.spec === 'φ150')!
    expect(option).toBeDefined()
    const [preset] = catalogPresets(item, { options: [option.key] }, lightingPosition)
    expect(preset).toMatchObject({
      category: '照明器具',
      code: 'DL',
      name: 'ダウンライト',
      spec: 'φ150',
      kind: 'count',
      method: 'click',
      aggregation: 'location',
      breakdown: {
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯分岐',
        item: 'ＬＥＤ照明器具',
      },
      summary: [{ label: '記号', value: 'DL' }],
    })
    expect(quantityUnit(preset as CountFixture)).toBe('個')
    const base = requiredItem(candidate =>
      candidate.key === `master:${JSON.stringify(['電気設備', '照明器具', 'DL'])}`,
    )
    const [basePreset] = catalogPresets(base, { options: [option.key] })
    expect(preset.conditions).toEqual(basePreset.conditions)
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('uses entered symbols, splits multiple symbols and defaults blank symbols', () => {
    const item = rowMaster(lightingEntry, 'DL')
    const option = item.options.find(option => option.spec === 'φ150')!
    const presets = catalogPresets(item, {
      options: [option.key],
      text: { 記号: ' L-1、L-2 ' },
    }, lightingPosition)
    expect(presets.map(preset => preset.code)).toEqual(['DL', 'DL'])
    expect(presets.map(preset => preset.summary)).toEqual([
      [{ label: '記号', value: 'L-1' }],
      [{ label: '記号', value: 'L-2' }],
    ])
    const [blank] = catalogPresets(item, {
      options: [option.key],
      text: { 記号: ' ，、 ' },
    }, lightingPosition)
    expect(blank.summary).toEqual([{ label: '記号', value: 'DL' }])

    const fallback = catalogItemsForBreakdownRow(lightingEntry).at(-1)!
    const [freeSymbol] = catalogPresets(fallback, {
      options: ['item'],
      text: { 記号: 'L-1' },
    }, lightingPosition)
    expect(freeSymbol.code).toBe('L-1')
    expect(freeSymbol.name).toBe('ＬＥＤ照明器具')
    const [empty] = catalogPresets(fallback, { options: ['item'] })
    expect(empty.code).toBe('')
    expect(empty).not.toHaveProperty('summary')
  })

  it('uses the outdoor lighting row unit without changing the indoor item', () => {
    const outdoor = requiredEntry(entry =>
      entry.book === '電気設備'
      && entry.row.name === 'ＬＥＤ照明器具'
      && entry.row.unit === '灯'
      && !entry.row.separate,
    )
    const indoorItem = rowMaster(lightingEntry, 'DL')
    const outdoorItem = rowMaster(outdoor, 'DL')
    expect(catalogItemsForBreakdownRow(outdoor)).toHaveLength(8)
    expect(outdoorItem.unit).toBe('灯')
    expect(outdoorItem.key).not.toBe(indoorItem.key)
    expect(indoorItem.unit).toBe('個')
    const [preset] = catalogPresets(outdoorItem, {
      options: [outdoorItem.options[0].key],
    }, {
      book: outdoor.book,
      section: outdoor.section,
      subject: outdoor.subject,
      ...(outdoor.middle !== undefined ? { middle: outdoor.middle } : {}),
    })
    expect(preset.unit).toBe('灯')
    expect(quantityUnit(preset as CountFixture)).toBe('灯')
    expect(preset.breakdown?.item).toBe('ＬＥＤ照明器具')
    expect(preset.summary).toEqual([{ label: '記号', value: 'DL' }])
  })

  it('offers both guidance-light types and defaults to their codes rather than type names', () => {
    const entry = requiredEntry(entry =>
      entry.book === '電気設備'
      && entry.row.name === '誘導灯'
      && !entry.row.separate,
    )
    const choices = catalogItemsForBreakdownRow(entry)
    expect(choices).toHaveLength(3)
    expect(choices.map(item => item.type))
      .toEqual(['誘導灯（避難口）', '誘導灯（通路）', '誘導灯'])
    expect(choices.map(item => item.unit)).toEqual([
      entry.row.unit, entry.row.unit, entry.row.unit,
    ])
    for (const [index, code] of ['GA', 'GB'].entries()) {
      const item = choices[index]
      const [preset] = catalogPresets(item, { options: [item.options[0].key] })
      expect(preset.code).toBe(code)
      expect(preset.summary).toEqual([{ label: '記号', value: code }])
    }
  })

  it('requires every mapped type to exist in the electrical quantity master', () => {
    for (const [name, master] of Object.entries(ELECTRICAL_ROW_MASTERS)) {
      for (const type of master.types) {
        expect(QUANTITY_MASTER.some(candidate =>
          candidate.field === '電気設備' && candidate.type === type,
        ), `${name}: 電気設備の標準マスタに ${type} がありません`).toBe(true)
      }
    }
  })

  it('preserves the specification-path DL key, options, unit and position behavior', () => {
    const base = requiredItem(item =>
      item.key === `master:${JSON.stringify(['電気設備', '照明器具', 'DL'])}`,
    )
    const before = JSON.stringify(base)
    catalogItemsForBreakdownRow(lightingEntry)
    expect(JSON.stringify(base)).toBe(before)
    expect(base.unit).toBe('個')
    expect(base.slots).toEqual([])
    expect(base).not.toHaveProperty('defaultSymbolFromCode')
    expect(base.options.map(option => option.spec))
      .toEqual(['φ100', 'φ125', 'φ150', 'φ200'])

    const option = base.options.find(option => option.spec === 'φ150')!
    const [withoutPosition] = catalogPresets(base, { options: [option.key] })
    expect(withoutPosition).not.toHaveProperty('breakdown')
    expect(withoutPosition).not.toHaveProperty('summary')
    expect(withoutPosition).not.toHaveProperty('unit')
    expect(quantityUnit(withoutPosition as CountFixture)).toBe('個')

    const [withPosition] = catalogPresets(base, { options: [option.key] }, lightingPosition)
    expect(withPosition.breakdown).toEqual({
      ...lightingPosition,
      item: 'ＬＥＤ照明器具',
    })
    expect(withPosition).not.toHaveProperty('summary')
    expect(catalogItems()).toBe(items)
  })
})
