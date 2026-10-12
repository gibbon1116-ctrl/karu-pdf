import { describe, expect, it } from 'vitest'
import {
  breakdownEntries,
  detailMasterEntries,
  kindForUnit,
  presetFromRow,
  presetsFromDetail,
  searchBreakdown,
  summaryChoices,
  summaryIsCondition,
  type BreakdownEntry,
} from '../src/core/breakdownMaster'
import { ELECTRICAL_GROUPS } from '../src/core/breakdown/electricalGroups'
import { ELECTRICAL_DETAILS, ELECTRICAL_CHOICES } from '../src/core/breakdown/electricalDetails'
import { MECHANICAL_GROUPS } from '../src/core/breakdown/mechanicalGroups'
import { ELEVATOR_GROUPS } from '../src/core/breakdown/elevatorGroups'
import { BUILDING_GROUPS } from '../src/core/breakdown/buildingGroups'
import {
  BUILDING_DETAILS,
  BUILDING_RENOVATION_DETAILS,
  BUILDING_CHOICES,
} from '../src/core/breakdown/buildingDetails'
import {
  MECHANICAL_DETAILS,
  MECHANICAL_CHOICES,
  PIPE_LOCATIONS,
} from '../src/core/breakdown/mechanicalDetails'
import type { DetailTemplate } from '../src/core/breakdown/types'
import {
  COUNT_UNITS,
  fixtureBreakdownError,
  type SummaryField,
} from '../src/core/countFixtures'
import { masterEntries, normalizeMasterText, QUANTITY_MASTER } from '../src/core/quantityMaster'

const entries = breakdownEntries('電気設備')
const panel = entries.find(entry =>
  entry.section === '庁舎'
  && entry.subject === '電灯設備'
  && entry.middle === '電灯分岐'
  && entry.row.name === '分電盤'
  && entry.row.unit === '面',
)!
const conduit = entries.find(entry =>
  entry.section === '庁舎'
  && entry.subject === '電灯設備'
  && entry.middle === '電灯幹線'
  && entry.row.name === '電線管'
  && entry.row.separate,
)!
const boxes = entries.find(entry =>
  entry.section === '庁舎'
  && entry.subject === '電灯設備'
  && entry.middle === '電灯幹線'
  && entry.row.name === 'ボックス類'
  && entry.row.separate,
)!
const carry = entries.find(entry => entry.row.name === '搬入費' && entry.row.separate)!
const conduitTemplate = conduit.details.find(template => template.name === '電線管')!
const pullBox = boxes.details.find(template => template.name === 'プルボックス')!
const carryTemplate = carry.details.find(template => template.name === '機器搬入')!

describe('breakdown data integrity', () => {
  it('contains 974 electrical rows with unique positional keys in source order', () => {
    expect(entries).toHaveLength(974)
    expect(entries[0].row).toBe(ELECTRICAL_GROUPS[0].rows[0])
    expect(entries[0].key).toBe(JSON.stringify([
      '電気設備',
      ELECTRICAL_GROUPS[0].section,
      ELECTRICAL_GROUPS[0].subject,
      ELECTRICAL_GROUPS[0].middle ?? '',
      0,
    ]))
    expect(entries.every(entry => entry.book === '電気設備')).toBe(true)
    expect(new Set(entries.map(entry => entry.key)).size).toBe(entries.length)

    expect(entries.map(entry => entry.key)).toEqual(
      ELECTRICAL_GROUPS.flatMap(group => group.rows.map((_, index) =>
        JSON.stringify(['電気設備', group.section, group.subject, group.middle ?? '', index]),
      )),
    )
    expect(entries.map(entry => entry.row)).toEqual(
      ELECTRICAL_GROUPS.flatMap(group => group.rows),
    )
  })

  it('reuses the whole list and each book result', () => {
    expect(breakdownEntries()).toBe(breakdownEntries())
    expect(breakdownEntries('電気設備')).toBe(entries)
    expect(breakdownEntries()).toEqual([
      ...entries,
      ...breakdownEntries('機械設備'),
      ...breakdownEntries('昇降機設備'),
      ...breakdownEntries('建築'),
    ])
    expect(breakdownEntries('建築')).toHaveLength(799)

    for (const book of ['建築', '機械設備', '昇降機設備'] as const) {
      expect(breakdownEntries(book)).toBe(breakdownEntries(book))
    }
  })

  it('uses every standard-detail key on a separate row', () => {
    const names = new Set(entries.filter(entry => entry.row.separate).map(entry => entry.row.name))
    for (const name of Object.keys(ELECTRICAL_DETAILS)) {
      expect(names.has(name), `未使用の明細キー: ${name}`).toBe(true)
    }
  })

  it('uses every summary-choice key on a non-separate row and its summary label', () => {
    for (const key of Object.keys(ELECTRICAL_CHOICES)) {
      const parts = key.split('|')
      expect(parts, `摘要キーの形式: ${key}`).toHaveLength(2)
      const [name, label] = parts
      expect(
        entries.some(entry =>
          !entry.row.separate
          && entry.row.name === name
          && entry.row.summary?.includes(label),
        ),
        `未使用の摘要キー: ${key}`,
      ).toBe(true)
    }
  })

  it('keeps template text within limits and resolves every master reference', () => {
    for (const [rowName, templates] of Object.entries(ELECTRICAL_DETAILS)) {
      for (const template of templates) {
        const context = `${rowName}/${template.name}`
        expect((template.code ?? '').length, context).toBeLessThanOrEqual(16)
        expect(template.name.length, context).toBeLessThanOrEqual(80)

        if (template.master !== undefined) {
          expect(detailMasterEntries(template).length, context).toBeGreaterThan(0)
          for (const category of template.master.categories ?? []) {
            expect(
              QUANTITY_MASTER.some(type => type.category === category),
              `${context}: 分類 ${category}`,
            ).toBe(true)
          }
          for (const type of template.master.types ?? []) {
            expect(
              QUANTITY_MASTER.some(candidate => candidate.type === type),
              `${context}: 種類 ${type}`,
            ).toBe(true)
          }
        } else {
          expect(
            kindForUnit(template.unit) !== undefined || template.linked !== undefined,
            `${context}: 単位 ${template.unit}`,
          ).toBe(true)
        }
      }
    }
  })

  it('retains the expected separate rows without standard details', () => {
    const names = [...new Set(
      entries
        .filter(entry => entry.row.separate && entry.details.length === 0)
        .map(entry => entry.row.name),
    )].sort()

    expect(names).toEqual([
      'チェーンブロック',
      '据付費',
      '排気ダクト工事',
      '排気配管工事',
      '換気ダクト工事',
      '機器間ケーブル工事',
      '機器間ｹｰﾌﾞﾙ工事',
      '燃料配管工事',
      '立会検査',
      '給気ダクト工事',
      '試験調整費',
      '諸経費',
      '運搬費',
    ].sort())
  })

  it('sets details, pickability and search text according to each row', () => {
    for (const entry of entries) {
      const expectedDetails = entry.row.separate
        && Object.hasOwn(ELECTRICAL_DETAILS, entry.row.name)
        ? ELECTRICAL_DETAILS[entry.row.name]
        : []

      expect(entry.details).toEqual(expectedDetails)
      expect(entry.pickable).toBe(
        !entry.row.separate && kindForUnit(entry.row.unit) !== undefined,
      )
      expect(entry.search).toBe(normalizeMasterText([
        entry.book,
        entry.section,
        entry.subject,
        entry.middle ?? '',
        entry.row.name,
        ...(entry.row.summary ?? []),
        ...expectedDetails.map(template => template.name),
      ].join(' ')))
    }
  })

  it('validates every pickable row and each supported standard detail', () => {
    for (const entry of entries) {
      if (entry.pickable) {
        expect(fixtureBreakdownError(presetFromRow(entry)), entry.key).toBeUndefined()
      }
      for (const template of entry.details) {
        if (template.master === undefined && kindForUnit(template.unit) === undefined) continue
        const choices = template.master === undefined ? undefined : detailMasterEntries(template)
        const presets = presetsFromDetail(entry, template, undefined, choices, template.variants)
        expect(presets.length, `${entry.key}/${template.name}`).toBeGreaterThan(0)
        for (const preset of presets) {
          expect(fixtureBreakdownError(preset), `${entry.key}/${template.name}`).toBeUndefined()
        }
      }
    }
  })
})

describe('mechanical and elevator breakdown data', () => {
  const mechanical = breakdownEntries('機械設備')
  const elevator = breakdownEntries('昇降機設備')

  it('adds 397 mechanical rows in 35 groups and elevator rows in 6 groups', () => {
    expect(MECHANICAL_GROUPS).toHaveLength(35)
    expect(mechanical).toHaveLength(397)
    expect(ELEVATOR_GROUPS).toHaveLength(6)
    expect(elevator).toHaveLength(ELEVATOR_GROUPS.reduce((total, group) => total + group.rows.length, 0))

    for (const [book, groups] of [
      ['機械設備', MECHANICAL_GROUPS],
      ['昇降機設備', ELEVATOR_GROUPS],
    ] as const) {
      const actual = breakdownEntries(book)
      expect(actual.every(entry => entry.book === book)).toBe(true)
      expect(actual.map(entry => entry.row)).toEqual(groups.flatMap(group => group.rows))
      expect(actual.map(entry => entry.key)).toEqual(groups.flatMap(group =>
        group.rows.map((_, index) =>
          JSON.stringify([book, group.section, group.subject, group.middle ?? '', index]),
        ),
      ))
      expect(new Set(actual.map(entry =>
        JSON.stringify([entry.section, entry.subject, entry.middle ?? '']),
      )).size).toBe(groups.length)
    }

    const all = breakdownEntries()
    expect(new Set(all.map(entry => entry.key)).size).toBe(all.length)
    expect(all.slice(0, 974)).toEqual(entries)
  })

  it('selects choices by book and treats pipe locations as construction conditions', () => {
    const choices = summaryChoices('給水管', '管種', '機械設備')
    expect(choices).toBe(MECHANICAL_CHOICES['給水管|管種'])
    expect(choices.some(choice => choice.includes('SGP-VB'))).toBe(true)
    expect(summaryChoices('給水管', '区分', '機械設備')).toBe(PIPE_LOCATIONS)
    expect(summaryIsCondition('給水管', '区分', '機械設備')).toBe(true)
    expect(summaryIsCondition('給水管', '管種', '機械設備')).toBe(false)
    expect(summaryIsCondition('存在しない細目', '区分', '機械設備')).toBe(false)

    for (const book of ['電気設備', '昇降機設備', '建築'] as const) {
      expect(summaryIsCondition('給水管', '区分', book)).toBe(false)
    }
    expect(summaryChoices('給水管', '管種', '昇降機設備')).toEqual([])
    expect(summaryChoices('熱感知器', '形式')).toBe(ELECTRICAL_CHOICES['熱感知器|形式'])
  })

  it('keeps pipe locations out of the row summary and supplies all candidates independently', () => {
    const entry = mechanical.find(candidate =>
      candidate.section === '庁舎'
      && candidate.subject === '給水設備'
      && candidate.row.name === '給水管'
      && candidate.pickable,
    )
    expect(entry).toBeDefined()
    const pipeKind = summaryChoices('給水管', '管種', '機械設備')
      .find(choice => choice.includes('SGP-VB'))!
    const values = [
      { label: '管種', value: pipeKind },
      { label: '呼び径', value: ' 25A ' },
      { label: '区分', value: '地中配管' },
    ]
    const first = presetFromRow(entry!, values)
    const second = presetFromRow(entry!)

    expect(first.summary).toEqual([
      { label: '管種', value: pipeKind },
      { label: '呼び径', value: '25A' },
    ])
    expect(first.conditions).toEqual(PIPE_LOCATIONS)
    expect(second.conditions).toEqual(PIPE_LOCATIONS)
    expect(first.conditions).not.toBe(second.conditions)
    expect(first.conditions).not.toBe(PIPE_LOCATIONS)
    expect(first.breakdown?.book).toBe('機械設備')
    expect(fixtureBreakdownError(first)).toBeUndefined()
    expect(values[1].value).toBe(' 25A ')
  })

  it('resolves insulation details and retains placement as candidates rather than summary', () => {
    const entry = mechanical.find(candidate => candidate.row.name === '保温' && candidate.row.separate)
    expect(entry).toBeDefined()
    expect(entry!.details).toBe(MECHANICAL_DETAILS['保温'])
    const template = entry!.details.find(candidate => candidate.name === '配管保温')
    expect(template).toBeDefined()
    const placement = template!.summary!.find(slot => slot.label === '施工箇所')!
    expect(placement.condition).toBe(true)
    expect(placement.choices!.length).toBeGreaterThan(0)

    const values = [
      { label: '呼び径', value: '25A' },
      { label: '施工箇所', value: placement.choices![0] },
    ]
    const [first] = presetsFromDetail(entry!, template!, values)
    const [second] = presetsFromDetail(entry!, template!, values)
    expect(first.summary).toEqual([{ label: '呼び径', value: '25A' }])
    expect(first.conditions).toEqual(placement.choices)
    expect(first.conditions).not.toBe(placement.choices)
    expect(first.conditions).not.toBe(second.conditions)
    expect(fixtureBreakdownError(first)).toBeUndefined()
    expect(elevator.every(candidate => candidate.details.length === 0)).toBe(true)
  })

  it('preserves search construction and validates supported new rows and details', () => {
    for (const entry of [...mechanical, ...elevator]) {
      const expectedDetails = entry.book === '機械設備'
        && entry.row.separate
        && Object.hasOwn(MECHANICAL_DETAILS, entry.row.name)
        ? MECHANICAL_DETAILS[entry.row.name]
        : []
      expect(entry.details).toEqual(expectedDetails)
      expect(entry.pickable).toBe(!entry.row.separate && kindForUnit(entry.row.unit) !== undefined)
      expect(entry.search).toBe(normalizeMasterText([
        entry.book, entry.section, entry.subject, entry.middle ?? '', entry.row.name,
        ...(entry.row.summary ?? []),
        ...expectedDetails.map(template => template.name),
      ].join(' ')))
      if (entry.pickable) {
        expect(fixtureBreakdownError(presetFromRow(entry)), entry.key).toBeUndefined()
      }
      for (const template of entry.details) {
        if (template.master === undefined
          && template.variants === undefined
          && kindForUnit(template.unit) === undefined) continue
        const presets = presetsFromDetail(
          entry,
          template,
          undefined,
          template.master === undefined ? undefined : detailMasterEntries(template),
          template.variants,
        )
        expect(presets.length, `${entry.key}/${template.name}`).toBeGreaterThan(0)
        for (const preset of presets) {
          expect(fixtureBreakdownError(preset), `${entry.key}/${template.name}`).toBeUndefined()
        }
      }
    }
    expect(searchBreakdown('機械設備', Infinity).entries).toEqual(mechanical)
    expect(searchBreakdown('昇降機設備', Infinity).entries).toEqual(elevator)
  })
})

describe('kindForUnit', () => {
  it('maps every count unit to count/click', () => {
    expect(COUNT_UNITS.slice(-2)).toEqual(['式', '株'])
    for (const unit of COUNT_UNITS) {
      expect(kindForUnit(unit)).toEqual({ kind: 'count', method: 'click' })
    }
  })

  it('maps length, area and volume units', () => {
    expect(kindForUnit('m')).toEqual({ kind: 'length', method: 'polyline' })
    expect(kindForUnit('㎡')).toEqual({ kind: 'area', method: 'polygon' })
    expect(kindForUnit('㎥')).toEqual({ kind: 'volume', method: 'polygonDepth' })
  })

  it('rejects unsupported units without normalizing them', () => {
    for (const unit of ['t', 'kg', '台日', '', ' m ', 'm²', 'm³']) {
      expect(kindForUnit(unit)).toBeUndefined()
    }
  })
})

describe('presetFromRow', () => {
  it('creates the branch distribution panel with its unit, position and summary', () => {
    const values = [
      { label: '盤名称', value: ' L-1 ' },
      { label: '名称', value: '   ' },
    ]
    const preset = presetFromRow(panel, values)

    expect(preset).toEqual({
      category: '電灯分岐',
      code: '',
      name: '分電盤',
      unit: '面',
      breakdown: {
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯分岐',
        item: '分電盤',
      },
      summary: [{ label: '盤名称', value: 'L-1' }],
      aggregation: 'location',
    })
    expect(Object.hasOwn(preset, 'kind')).toBe(false)
    expect(Object.hasOwn(preset, 'method')).toBe(false)
    expect(fixtureBreakdownError(preset)).toBeUndefined()
    expect(values[0].value).toBe(' L-1 ')
    expect(preset.summary![0]).not.toBe(values[0])
  })

  it('omits summary when there are no nonempty values', () => {
    for (const values of [undefined, [], [{ label: '盤名称', value: ' \t ' }]]) {
      expect(presetFromRow(panel, values)).not.toHaveProperty('summary')
    }
  })

  it.each(['式', '株'] as const)('creates a count row with unit %s', unit => {
    const entry: BreakdownEntry = {
      ...panel,
      row: { name: '個数項目', unit },
      pickable: true,
    }
    const preset = presetFromRow(entry)
    expect(kindForUnit(unit)).toEqual({ kind: 'count', method: 'click' })
    expect(preset.unit).toBe(unit)
    expect(preset.kind ?? 'count').toBe('count')
    expect(preset.method ?? 'click').toBe('click')
    expect(preset.aggregation).toBe('location')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('makes every non-separate lump sum pickable in all four books', () => {
    for (const book of ['建築', '電気設備', '機械設備', '昇降機設備'] as const) {
      const rows = breakdownEntries(book).filter(entry =>
        !entry.row.separate && entry.row.unit === '式',
      )
      expect(rows.length, book).toBeGreaterThan(0)
      for (const entry of rows) {
        expect(entry.pickable, entry.key).toBe(true)
        const preset = presetFromRow(entry)
        expect(preset.unit, entry.key).toBe('式')
        expect(preset.kind ?? 'count', entry.key).toBe('count')
        expect(preset.method ?? 'click', entry.key).toBe('click')
        expect(preset.aggregation, entry.key).toBe('location')
        expect(fixtureBreakdownError(preset), entry.key).toBeUndefined()
      }
    }

    const planting = breakdownEntries('建築').filter(entry =>
      !entry.row.separate && entry.row.unit === '株',
    )
    expect(planting.length).toBeGreaterThan(0)
    for (const entry of planting) {
      expect(entry.pickable, entry.key).toBe(true)
      const preset = presetFromRow(entry)
      expect(preset.unit, entry.key).toBe('株')
      expect(preset.kind ?? 'count', entry.key).toBe('count')
      expect(preset.method ?? 'click', entry.key).toBe('click')
      expect(fixtureBreakdownError(preset), entry.key).toBeUndefined()
    }
  })

  it('omits the default count unit and uses the subject when middle is absent', () => {
    const entry: BreakdownEntry = {
      ...panel,
      middle: undefined,
      row: { name: '機器', unit: '個' },
    }
    const preset = presetFromRow(entry)
    expect(preset.category).toBe('電灯設備')
    expect(preset.breakdown).not.toHaveProperty('middle')
    expect(preset).not.toHaveProperty('unit')
    expect(preset).not.toHaveProperty('kind')
    expect(preset).not.toHaveProperty('method')
  })

  it.each([
    ['m', 'length', 'polyline'],
    ['㎡', 'area', 'polygon'],
    ['㎥', 'volume', 'polygonDepth'],
  ] as const)('creates a document quantity for %s', (unit, kind, method) => {
    const entry: BreakdownEntry = {
      ...panel,
      row: { name: '数量項目', unit },
    }
    const preset = presetFromRow(entry)
    expect(preset.kind).toBe(kind)
    expect(preset.method).toBe(method)
    expect(preset.aggregation).toBe('document')
    expect(preset).not.toHaveProperty('unit')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('rejects separate and unsupported rows', () => {
    expect(() => presetFromRow(conduit))
      .toThrow('この細目は拾いの項目にできません。')
    expect(() => presetFromRow({
      ...panel,
      row: { name: '重量', unit: 't' },
      pickable: false,
    })).toThrow('この細目は拾いの項目にできません。')
  })

  it('uses the existing validation message for invalid positions', () => {
    const entry = { ...panel, section: 'あ'.repeat(21) }
    const message = fixtureBreakdownError({
      breakdown: {
        book: entry.book,
        section: entry.section,
        subject: entry.subject,
        middle: entry.middle,
        item: entry.row.name,
      },
    })
    expect(message).toBeDefined()
    expect(() => presetFromRow(entry)).toThrow(message!)
  })
})

describe('detailMasterEntries', () => {
  it('returns matching entries in QUANTITY_MASTER and specification order', () => {
    const expected = masterEntries().filter(entry => entry.category === '電線管')
    expect(detailMasterEntries(conduitTemplate)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(1)
  })

  it('matches types and intersects category and type constraints when both are given', () => {
    const byTypes: DetailTemplate = {
      name: '保護管',
      unit: 'm',
      master: { types: ['G', 'FEP', 'VE'] },
    }
    expect(detailMasterEntries(byTypes)).toEqual(
      masterEntries().filter(entry => ['G', 'FEP', 'VE'].includes(entry.type)),
    )

    const byBoth: DetailTemplate = {
      name: '電線',
      unit: 'm',
      master: { categories: ['電線'], types: ['IV', 'G'] },
    }
    expect(detailMasterEntries(byBoth)).toEqual(
      masterEntries().filter(entry => entry.category === '電線' && entry.type === 'IV'),
    )
  })

  it('returns no entries without a master or for a missing reference', () => {
    expect(detailMasterEntries(pullBox)).toEqual([])
    expect(detailMasterEntries({
      name: '不存在',
      unit: 'm',
      master: { categories: ['存在しない分類'] },
    })).toEqual([])
  })
})

describe('presetsFromDetail', () => {
  it('creates two conduit presets and retains each selected master field', () => {
    const selected = detailMasterEntries(conduitTemplate).slice(0, 2)
    const presets = presetsFromDetail(conduit, conduitTemplate, [
      { label: '施工', value: ' 露出 ' },
      { label: '備考', value: '' },
    ], selected)

    expect(presets).toHaveLength(2)
    for (const [index, preset] of presets.entries()) {
      const source = selected[index]
      for (const key of [
        'category', 'code', 'spec', 'name', 'kind', 'method',
        'defaults', 'aggregation', 'conditions',
      ] as const) {
        expect(preset[key]).toEqual(source[key])
      }
      expect(preset.breakdown).toEqual({
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯幹線',
        item: '電線管',
      })
      expect(preset.summary).toEqual([{ label: '施工', value: '露出' }])
      expect(preset.conditions).not.toBe(source.conditions)
      expect(fixtureBreakdownError(preset)).toBeUndefined()
      expect(preset).not.toHaveProperty('key')
      expect(preset).not.toHaveProperty('search')
    }

    expect(presets[0].breakdown).not.toBe(presets[1].breakdown)
    expect(presets[0].summary).not.toBe(presets[1].summary)
    expect(presets[0].summary![0]).not.toBe(presets[1].summary![0])
    presets[0].summary![0].value = '隠ぺい'
    expect(presets[1].summary![0].value).toBe('露出')
  })

  it('retains actual wire specifications', () => {
    const entry = entries.find(candidate =>
      candidate.section === '庁舎'
      && candidate.subject === '電灯設備'
      && candidate.middle === '電灯幹線'
      && candidate.row.name === '電線',
    )!
    const template = entry.details.find(candidate => candidate.name === '電線')!
    const selected = detailMasterEntries(template).slice(0, 2)
    const presets = presetsFromDetail(entry, template, undefined, selected)

    expect(presets).toHaveLength(2)
    expect(selected.every(choice => Boolean(choice.spec))).toBe(true)
    expect(presets.map(preset => preset.spec)).toEqual(selected.map(choice => choice.spec))
    expect(presets.every(preset => !Object.hasOwn(preset, 'summary'))).toBe(true)
  })

  it('retains and clones master defaults', () => {
    const template: DetailTemplate = {
      name: '体積',
      unit: '㎥',
      master: { categories: ['コンクリート（体積）'] },
    }
    const entry: BreakdownEntry = { ...conduit, details: [template] }
    const selected = detailMasterEntries(template)
    expect(selected).toHaveLength(1)
    expect(selected[0].defaults).toBeDefined()

    const [preset] = presetsFromDetail(entry, template, undefined, selected)
    expect(preset.defaults).toEqual(selected[0].defaults)
    expect(preset.defaults).not.toBe(selected[0].defaults)
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('returns no presets when no master specification is selected', () => {
    expect(presetsFromDetail(conduit, conduitTemplate)).toEqual([])
    expect(presetsFromDetail(conduit, conduitTemplate, undefined, [])).toEqual([])
  })

  it('creates a pull box count and retains only nonempty summary values', () => {
    const values = [
      { label: '材質', value: ' 鋼板製 ' },
      { label: '寸法', value: ' 200×200×100 ' },
      { label: '設置場所', value: ' ' },
    ]
    const presets = presetsFromDetail(boxes, pullBox, values)

    expect(presets).toHaveLength(1)
    expect(presets[0]).toEqual({
      category: '電灯幹線',
      code: 'PB',
      name: 'プルボックス',
      aggregation: 'location',
      breakdown: {
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯幹線',
        item: 'ボックス類',
      },
      summary: [
        { label: '材質', value: '鋼板製' },
        { label: '寸法', value: '200×200×100' },
      ],
    })
    expect(presets[0].kind ?? 'count').toBe('count')
    expect(presets[0]).not.toHaveProperty('kind')
    expect(presets[0]).not.toHaveProperty('method')
    expect(presets[0]).not.toHaveProperty('unit')
    expect(fixtureBreakdownError(presets[0])).toBeUndefined()
    expect(values[0].value).toBe(' 鋼板製 ')
    expect(presetsFromDetail(boxes, pullBox)[0]).not.toHaveProperty('summary')
  })

  it('uses the count unit of a non-master detail', () => {
    const entry = entries.find(candidate => candidate.row.name === '施工費')!
    const template = entry.details.find(candidate => candidate.name === '盤取付')!
    const [preset] = presetsFromDetail(entry, template)

    expect(preset.unit).toBe('面')
    expect(preset.aggregation).toBe('location')
    expect(preset).not.toHaveProperty('kind')
    expect(preset).not.toHaveProperty('method')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it.each([
    ['m', 'length', 'polyline'],
    ['㎡', 'area', 'polygon'],
    ['㎥', 'volume', 'polygonDepth'],
  ] as const)('creates a non-master detail with unit %s', (unit, kind, method) => {
    const template: DetailTemplate = { name: '数量明細', unit }
    const entry: BreakdownEntry = { ...conduit, details: [template] }
    const [preset] = presetsFromDetail(entry, template)

    expect(preset.category).toBe(entry.middle)
    expect(preset.code).toBe('')
    expect(preset.name).toBe(template.name)
    expect(preset.kind).toBe(kind)
    expect(preset.method).toBe(method)
    expect(preset.aggregation).toBe('document')
    expect(preset.breakdown?.item).toBe(entry.row.name)
    expect(preset).not.toHaveProperty('unit')
    expect(fixtureBreakdownError(preset)).toBeUndefined()
  })

  it('rejects linked carry details with an unsupported unit', () => {
    expect(carryTemplate.unit).toBe('t')
    expect(carryTemplate.linked).toBe('carry')
    expect(() => presetsFromDetail(carry, carryTemplate))
      .toThrow('この明細は連動で計算する予定のため、まだ拾いの項目にできません。')
  })

  it('rejects a template outside the entry, including an object copy', () => {
    expect(() => presetsFromDetail(conduit, pullBox)).toThrow()
    expect(() => presetsFromDetail(conduit, { ...conduitTemplate })).toThrow()
  })

  it('rejects a master choice outside the template, including an object copy', () => {
    const foreign = masterEntries().find(entry => entry.category === '電線')!
    expect(() => presetsFromDetail(conduit, conduitTemplate, undefined, [foreign])).toThrow()

    const allowed = detailMasterEntries(conduitTemplate)[0]
    expect(() => presetsFromDetail(conduit, conduitTemplate, undefined, [{ ...allowed }]))
      .toThrow()
  })
})

describe('presetsFromDetail conversion variants', () => {
  const painting = entries.find(entry => entry.row.name === '塗装工事' && entry.row.separate)!
  const pipe = painting.details.find(template => template.name === '配管塗装')!
  const box = painting.details.find(template => template.name === 'ボックス塗装')!

  it('creates selected variants with their pickup kind and independent conversion objects', () => {
    const selected = ['E25', 'E19'].map(spec => pipe.variants!.find(variant => variant.spec === spec)!)
    const presets = presetsFromDetail(painting, pipe, [{ label: '塗料', value: ' SOP ' }], undefined, selected)

    expect(presets.map(preset => preset.code)).toEqual(['E25塗装', 'E19塗装'])
    expect(presets.map(preset => preset.spec)).toEqual(['E25', 'E19'])
    for (const [index, preset] of presets.entries()) {
      expect(preset.name).toBe('配管塗装')
      expect(preset.category).toBe(painting.middle ?? painting.subject)
      expect(preset.kind).toBe('length')
      expect(preset.method).toBe('polyline')
      expect(preset.aggregation).toBe('document')
      expect(preset).not.toHaveProperty('unit')
      expect(preset.convert).toEqual(selected[index].convert)
      expect(preset.convert).not.toBe(selected[index].convert)
      expect(preset.summary).toEqual([{ label: '塗料', value: 'SOP' }])
      expect(fixtureBreakdownError(preset)).toBeUndefined()
    }
    expect(presets[0].breakdown).not.toBe(presets[1].breakdown)
    expect(presets[0].summary![0]).not.toBe(presets[1].summary![0])
  })

  it('creates converted counts and keeps kindForUnit unchanged', () => {
    const [preset] = presetsFromDetail(painting, box, undefined, undefined, [box.variants![0]])
    expect(preset.kind).toBe('count')
    expect(preset.method).toBe('click')
    expect(preset.aggregation).toBe('document')
    expect(preset.convert?.unit).toBe('㎡')
    expect(preset).not.toHaveProperty('unit')
    expect(kindForUnit('㎡')).toEqual({ kind: 'area', method: 'polygon' })
  })

  it('returns no presets without selected variants and rejects foreign objects', () => {
    expect(presetsFromDetail(painting, pipe)).toEqual([])
    expect(presetsFromDetail(painting, pipe, undefined, undefined, [])).toEqual([])
    expect(() => presetsFromDetail(painting, pipe, undefined, undefined, [box.variants![0]])).toThrow()
    expect(() => presetsFromDetail(painting, pipe, undefined, undefined, [{ ...pipe.variants![0] }])).toThrow()
  })

  it('validates summaries in the variant path', () => {
    const summary = [{ label: '塗料', value: 'あ'.repeat(61) }]
    expect(() => presetsFromDetail(painting, pipe, summary, undefined, [pipe.variants![0]]))
      .toThrow(fixtureBreakdownError({ summary })!)
  })

  it('keeps every variant within fixture limits', () => {
    for (const entry of entries) for (const template of entry.details) {
      if (!template.variants) continue
      expect(['length', 'count']).toContain(template.pick)
      for (const variant of template.variants) {
        expect(variant.code.length).toBeLessThanOrEqual(16)
        expect(variant.spec.length).toBeLessThanOrEqual(40)
        expect(fixtureBreakdownError({ convert: variant.convert })).toBeUndefined()
      }
    }
  })
})

describe('summary validation during conversion', () => {
  const invalidSummaries: SummaryField[][] = [
    [{ label: '形式', value: 'あ'.repeat(61) }],
    [{ label: 'あ'.repeat(21), value: '値' }],
    [{ label: '形式', value: 'A' }, { label: '形式', value: 'B' }],
    [{ label: '形式', value: 'A\nB' }],
    Array.from({ length: 9 }, (_, index) => ({ label: `区分${index}`, value: '値' })),
    [
      { label: '形式', value: 'あ'.repeat(60) },
      { label: '施工', value: 'い'.repeat(60) },
    ],
  ]

  it('uses fixtureBreakdownError messages in all three conversion paths', () => {
    const selected = detailMasterEntries(conduitTemplate).slice(0, 1)
    for (const values of invalidSummaries) {
      const message = fixtureBreakdownError({ summary: values })
      expect(message).toBeDefined()
      expect(() => presetFromRow(panel, values)).toThrow(message!)
      expect(() => presetsFromDetail(boxes, pullBox, values)).toThrow(message!)
      expect(() => presetsFromDetail(conduit, conduitTemplate, values, selected))
        .toThrow(message!)
    }
  })

  it('validates summary after trimming values and dropping blank fields', () => {
    const values = [
      { label: '盤名称', value: ` ${'あ'.repeat(60)} ` },
      { label: '盤名称', value: '   ' },
    ]
    expect(presetFromRow(panel, values).summary).toEqual([
      { label: '盤名称', value: 'あ'.repeat(60) },
    ])
  })
})

describe('searchBreakdown', () => {
  it('finds the conduit under lighting mains using all terms', () => {
    expect(searchBreakdown('電灯幹線 電線管').entries).toContain(conduit)
    expect(searchBreakdown('電灯幹線 プルボックス').entries).toContain(boxes)
    expect(searchBreakdown('電灯分岐 盤名称').entries).toContain(panel)
  })

  it('finds smoke and heat detectors', () => {
    const result = searchBreakdown('感知器')
    expect(result.entries.some(entry => entry.row.name === '煙感知器')).toBe(true)
    expect(result.entries.some(entry => entry.row.name === '熱感知器')).toBe(true)
  })

  it('normalizes width, case and whitespace', () => {
    const result = searchBreakdown('  ｌｅｄ　照明器具\t')
    expect(result.total).toBeGreaterThan(0)
    expect(result.entries.some(entry => entry.row.name === 'ＬＥＤ照明器具')).toBe(true)
  })

  it('returns no results for an empty query', () => {
    expect(searchBreakdown('')).toEqual({ entries: [], total: 0 })
    expect(searchBreakdown(' \t\n　')).toEqual({ entries: [], total: 0 })
  })

  it('retains source order and total independently of the limit', () => {
    const result = searchBreakdown('電気設備')
    expect(result.total).toBe(974)
    expect(result.entries).toEqual(entries.slice(0, 200))
    expect(searchBreakdown('電気設備', 2.9)).toEqual({
      entries: entries.slice(0, 2),
      total: 974,
    })
    expect(searchBreakdown('電気設備', 0)).toEqual({ entries: [], total: 974 })
    expect(searchBreakdown('電気設備', -1)).toEqual({ entries: [], total: 974 })
  })
})

describe('summaryChoices', () => {
  it('returns detector choices and no standard panel-name choices', () => {
    expect(summaryChoices('熱感知器', '形式').length).toBeGreaterThan(0)
    expect(summaryChoices('熱感知器', '形式')).toBe(ELECTRICAL_CHOICES['熱感知器|形式'])
    expect(summaryChoices('分電盤', '盤名称')).toEqual([])
    expect(summaryChoices('存在しない細目', '形式')).toEqual([])
  })
})

describe('SPEC-B11-2 building breakdown', () => {
  it('appends 101 building groups and 799 rows with unique positional keys', () => {
    const building = breakdownEntries('建築')
    expect(BUILDING_GROUPS).toHaveLength(101)
    expect(building).toHaveLength(799)
    expect(new Set(building.map(entry => entry.key)).size).toBe(799)
    expect(new Set(building.map(entry =>
      JSON.stringify([entry.section, entry.subject, entry.middle ?? '']),
    )).size).toBe(101)
    expect(building.some(entry => entry.section === '庁舎（改修）')).toBe(true)

    const expected = BUILDING_GROUPS.flatMap(group =>
      group.rows.map((row, index) => ({
        key: JSON.stringify(['建築', group.section, group.subject, group.middle ?? '', index]),
        row,
      })),
    )
    expect(building.map(entry => entry.key)).toEqual(expected.map(entry => entry.key))
    building.forEach((entry, index) => {
      expect(entry.row).toBe(expected[index].row)
    })
    expect([...new Set(breakdownEntries().map(entry => entry.book))]).toEqual([
      '電気設備', '機械設備', '昇降機設備', '建築',
    ])
    expect(breakdownEntries('建築')).toBe(building)
  })

  it('selects every building detail table by section', () => {
    for (const entry of breakdownEntries('建築')) {
      const templates = entry.section === '庁舎（改修）'
        ? BUILDING_RENOVATION_DETAILS
        : BUILDING_DETAILS
      const expected = entry.row.separate && Object.hasOwn(templates, entry.row.name)
        ? templates[entry.row.name]
        : []
      expect(entry.details, entry.key).toEqual(expected)
      if (expected.length) expect(entry.details).toBe(expected)
    }
  })

  it('uses different curing details for new construction and renovation', () => {
    const building = breakdownEntries('建築')
    const fresh = building.find(entry =>
      entry.section === '庁舎' && entry.subject === '直接仮設' && entry.row.name === '養生',
    )!
    const renovation = building.find(entry =>
      entry.section === '庁舎（改修）' && entry.subject === '直接仮設' && entry.row.name === '養生',
    )!

    expect(fresh).toBeDefined()
    expect(renovation).toBeDefined()
    expect(fresh.details.map(template => template.name)).toEqual([
      '養生（延べ面積）', '養生（部位）',
    ])
    expect(renovation.details.map(template => template.name)).toEqual(['養生'])
    expect(renovation.details[0].summary).toEqual([{
      label: '改修の種類',
      choices: [
        '防水改修', '外壁改修', '建具改修', '内装改修',
        '耐震（躯体）改修', '搬出入路部分',
      ],
    }])
  })

  it('provides building choices without treating them as construction conditions', () => {
    expect(summaryChoices('異形鉄筋', '規格', '建築')).toBe(BUILDING_CHOICES['異形鉄筋|規格'])
    expect(summaryChoices('異形鉄筋', '規格', '建築')).toContain('SD345')

    for (const [key, choices] of Object.entries(BUILDING_CHOICES)) {
      const [name, label] = key.split('|')
      expect(summaryChoices(name, label, '建築'), key).toBe(choices)
      expect(summaryIsCondition(name, label, '建築'), key).toBe(false)
    }
    expect(summaryIsCondition('養生', '改修の種類', '建築')).toBe(false)
    expect(summaryChoices('存在しない細目', '規格', '建築')).toEqual([])
  })

  it('keeps rebar in tonnes unpickable', () => {
    const rebar = breakdownEntries('建築').find(entry =>
      entry.row.name === '異形鉄筋' && entry.row.unit === 't',
    )!
    expect(rebar).toBeDefined()
    expect(rebar.pickable).toBe(false)
    expect(kindForUnit(rebar.row.unit)).toBeUndefined()
    expect(() => presetFromRow(rebar)).toThrow('この細目は拾いの項目にできません。')
  })

  it('preserves the counts, positional keys, rows and details of all three existing books', () => {
    const sources = [
      { book: '電気設備', groups: ELECTRICAL_GROUPS, details: ELECTRICAL_DETAILS },
      { book: '機械設備', groups: MECHANICAL_GROUPS, details: MECHANICAL_DETAILS },
      { book: '昇降機設備', groups: ELEVATOR_GROUPS, details: {} },
    ] as const
    const legacyKeys: string[] = []

    for (const source of sources) {
      const templates: Readonly<Record<string, readonly DetailTemplate[]>> = source.details
      const expected = source.groups.flatMap(group =>
        group.rows.map((row, index) => ({
          key: JSON.stringify([
            source.book, group.section, group.subject, group.middle ?? '', index,
          ]),
          row,
          details: row.separate && Object.hasOwn(templates, row.name)
            ? templates[row.name]
            : [],
        })),
      )
      const actual = breakdownEntries(source.book)
      expect(actual, source.book).toHaveLength(expected.length)
      expect(actual.map(entry => entry.key), source.book).toEqual(expected.map(entry => entry.key))
      actual.forEach((entry, index) => {
        expect(entry.row, entry.key).toBe(expected[index].row)
        expect(entry.details, entry.key).toEqual(expected[index].details)
        expect(entry.pickable, entry.key).toBe(
          !entry.row.separate && kindForUnit(entry.row.unit) !== undefined,
        )
      })
      legacyKeys.push(...expected.map(entry => entry.key))
    }

    expect(breakdownEntries('電気設備')).toHaveLength(974)
    expect(breakdownEntries().slice(0, legacyKeys.length).map(entry => entry.key)).toEqual(legacyKeys)
    expect(breakdownEntries()).toHaveLength(legacyKeys.length + 799)
  })
})
