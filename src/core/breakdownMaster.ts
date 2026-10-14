import {
  COUNT_UNITS,
  fixtureBreakdownError,
  type BreakdownBook,
  type BreakdownPosition,
  type FixturePreset,
  type QuantityKind,
  type QuantityMethod,
  type SummaryField,
} from './countFixtures'
import type { BreakdownGroupData, BreakdownRowData, DetailTemplate, DetailVariant } from './breakdown/types'
import { ELECTRICAL_GROUPS } from './breakdown/electricalGroups'
import { ELECTRICAL_DETAILS, ELECTRICAL_CHOICES } from './breakdown/electricalDetails'
import { MECHANICAL_GROUPS } from './breakdown/mechanicalGroups'
import { ELEVATOR_GROUPS } from './breakdown/elevatorGroups'
import { BUILDING_GROUPS } from './breakdown/buildingGroups'
import {
  BUILDING_DETAILS,
  BUILDING_RENOVATION_DETAILS,
  BUILDING_CHOICES,
} from './breakdown/buildingDetails'
import {
  MECHANICAL_DETAILS,
  MECHANICAL_CHOICES,
  MECHANICAL_CONDITION_SLOTS,
} from './breakdown/mechanicalDetails'
import { masterEntries, normalizeMasterText, type MasterEntry } from './quantityMaster'

/** 一覧の1行（細目）。 */
export interface BreakdownEntry {
  /** 編・種目・科目・中科目・群内の行番号による一意の鍵。 */
  key: string
  book: BreakdownBook
  section: string
  subject: string
  middle?: string
  row: BreakdownRowData
  /** separate の行に標準明細があるときだけ設定する。 */
  details: readonly DetailTemplate[]
  /** この細目自体を拾いの項目にできるか。 */
  pickable: boolean
  /** 検索用の正規化文字列。 */
  search: string
}

/** 単位から拾いの種類。拾えない単位は undefined。 */
export function kindForUnit(unit: string): { kind: QuantityKind; method: QuantityMethod } | undefined {
  if (COUNT_UNITS.some(candidate => candidate === unit)) return { kind: 'count', method: 'click' }
  switch (unit) {
    case 'm': return { kind: 'length', method: 'polyline' }
    case '㎡': return { kind: 'area', method: 'polygon' }
    case '㎥': return { kind: 'volume', method: 'polygonDepth' }
    default: return undefined
  }
}

let cachedEntries: readonly BreakdownEntry[] | undefined
const cachedBookEntries = new Map<BreakdownBook, readonly BreakdownEntry[]>()

const breakdownSources: readonly {
  book: BreakdownBook
  groups: readonly BreakdownGroupData[]
  details: Readonly<Record<string, readonly DetailTemplate[]>>
}[] = [
  { book: '電気設備', groups: ELECTRICAL_GROUPS, details: ELECTRICAL_DETAILS },
  { book: '機械設備', groups: MECHANICAL_GROUPS, details: MECHANICAL_DETAILS },
  { book: '昇降機設備', groups: ELEVATOR_GROUPS, details: {} },
  { book: '建築', groups: BUILDING_GROUPS, details: BUILDING_DETAILS },
]

/** 全行。全体と編ごとの結果を初回に作り、再利用する。 */
export function breakdownEntries(book?: BreakdownBook): readonly BreakdownEntry[] {
  const entries = cachedEntries ??= breakdownSources.flatMap<BreakdownEntry>(({ book, groups, details: templates }) =>
    groups.flatMap(group => group.rows.map((row, index) => {
      const rowTemplates = book === '建築' && group.section === '庁舎（改修）'
        ? BUILDING_RENOVATION_DETAILS
        : templates
      const details = row.separate && Object.hasOwn(rowTemplates, row.name)
        ? rowTemplates[row.name]
        : []
      return {
        key: JSON.stringify([book, group.section, group.subject, group.middle ?? '', index]),
        book,
        section: group.section,
        subject: group.subject,
        ...(group.middle !== undefined ? { middle: group.middle } : {}),
        row,
        details,
        pickable: !row.separate && kindForUnit(row.unit) !== undefined,
        search: normalizeMasterText([
          book,
          group.section,
          group.subject,
          group.middle ?? '',
          row.name,
          ...(row.summary ?? []),
          ...details.map(template => template.name),
        ].join(' ')),
      }
    })),
  )
  if (book === undefined) return entries

  let result = cachedBookEntries.get(book)
  if (result === undefined) {
    result = entries.filter(entry => entry.book === book)
    cachedBookEntries.set(book, result)
  }
  return result
}

/** 空白で区切ったすべての語に一致する行を、元の並び順で返す。 */
export function searchBreakdown(query: string, limit = 200): { entries: BreakdownEntry[]; total: number } {
  const terms = query.normalize('NFKC').split(/\s+/).map(normalizeMasterText).filter(Boolean)
  if (!terms.length) return { entries: [], total: 0 }

  const matches = breakdownEntries().filter(entry => terms.every(term => entry.search.includes(term)))
  return {
    entries: matches.slice(0, Math.max(0, Math.floor(limit))),
    total: matches.length,
  }
}

/** 数量で計上する細目の摘要の標準の選択肢。 */
export function summaryChoices(
  rowName: string,
  label: string,
  book: BreakdownBook = '電気設備',
): readonly string[] {
  const choices = book === '電気設備'
    ? ELECTRICAL_CHOICES
    : book === '機械設備'
      ? MECHANICAL_CHOICES
      : book === '建築'
        ? BUILDING_CHOICES
        : undefined
  const key = `${rowName}|${label}`
  return choices !== undefined && Object.hasOwn(choices, key) ? choices[key] : []
}

function summaryEntryForFixture(
  position: BreakdownPosition | undefined,
  name: string,
): BreakdownEntry | undefined {
  if (!position) return undefined
  const rowName = position.item || name
  return breakdownEntries(position.book).find(entry =>
    entry.section === position.section
    && entry.subject === position.subject
    && (entry.middle ?? '') === (position.middle ?? '')
    && entry.row.name === rowName,
  )
}

/** 項目の内訳書の位置と名称に対応する摘要の標準の選択肢。 */
export function summaryChoicesForFixture(
  position: BreakdownPosition | undefined,
  name: string,
  label: string,
): readonly string[] {
  const entry = summaryEntryForFixture(position, name)
  if (!entry) return []
  if (!entry.row.separate) {
    return summaryChoices(entry.row.name, label, entry.book)
  }
  return [...new Set(entry.details
    .filter(detail => detail.name === name)
    .flatMap(detail => detail.summary ?? [])
    .filter(slot => slot.label === label)
    .flatMap(slot => slot.choices ?? []))]
}

/** 項目の内訳書の位置と名称に対応する摘要の区分名。 */
export function summaryLabelsForFixture(
  position: BreakdownPosition | undefined,
  name: string,
): readonly string[] {
  const entry = summaryEntryForFixture(position, name)
  if (!entry) return []
  const labels = entry.row.separate
    ? entry.details
      .filter(detail => detail.name === name)
      .flatMap(detail => (detail.summary ?? []).map(slot => slot.label))
    : entry.row.summary ?? []
  return [...new Set(labels.map(label => label.trim()).filter(Boolean))]
}

/** 細目の摘要の区分を、項目を分けない施工条件として扱うか。 */
export function summaryIsCondition(
  rowName: string,
  label: string,
  book: BreakdownBook,
): boolean {
  return book === '機械設備' && MECHANICAL_CONDITION_SLOTS.has(`${rowName}|${label}`)
}

/** 数量で計上する細目を拾いの項目にする。 */
export function presetFromRow(entry: BreakdownEntry, values?: readonly SummaryField[]): FixturePreset {
  const quantity = kindForUnit(entry.row.unit)
  if (!entry.pickable || entry.row.separate || quantity === undefined) {
    throw new Error('この細目は拾いの項目にできません。')
  }

  const summary = (values ?? [])
    .filter(field => !summaryIsCondition(entry.row.name, field.label, entry.book))
    .map(field => ({ label: field.label, value: field.value.trim() }))
    .filter(field => field.value !== '')
  const conditions = [...new Set((entry.row.summary ?? []).flatMap(label =>
    summaryIsCondition(entry.row.name, label, entry.book)
      ? summaryChoices(entry.row.name, label, entry.book)
      : [],
  ))]
  const countUnit = COUNT_UNITS.find(unit => unit === entry.row.unit)
  const preset: FixturePreset = {
    category: entry.middle ?? entry.subject,
    code: '',
    name: entry.row.name,
    ...(quantity.kind !== 'count' ? { kind: quantity.kind, method: quantity.method } : {}),
    ...(quantity.kind === 'count' && countUnit !== undefined && countUnit !== '個'
      ? { unit: countUnit }
      : {}),
    breakdown: {
      book: entry.book,
      section: entry.section,
      subject: entry.subject,
      ...(entry.middle ? { middle: entry.middle } : {}),
      item: entry.row.name,
    },
    ...(summary.length ? { summary } : {}),
    ...(conditions.length ? { conditions } : {}),
    aggregation: quantity.kind === 'count' ? 'location' : 'document',
  }

  const error = fixtureBreakdownError(preset)
  if (error !== undefined) throw new Error(error)
  return preset
}

/** 別紙明細を拾いの項目にする。標準マスタを使う明細は選んだ規格ごとに作る。 */
export function presetsFromDetail(
  entry: BreakdownEntry,
  template: DetailTemplate,
  values?: readonly SummaryField[],
  masterChoices?: readonly MasterEntry[],
  variants?: readonly DetailVariant[],
): FixturePreset[] {
  if (!entry.details.includes(template)) {
    throw new Error('この明細は指定した細目の標準明細ではありません。')
  }

  const summary = (values ?? [])
    .filter(field => entry.book !== '機械設備'
      || !template.summary?.some(slot => slot.label === field.label && slot.condition))
    .map(field => ({ label: field.label, value: field.value.trim() }))
    .filter(field => field.value !== '')
  const conditions = entry.book === '機械設備'
    ? (template.summary ?? []).flatMap(slot => slot.condition ? slot.choices ?? [] : [])
    : []
  const breakdown = {
    book: entry.book,
    section: entry.section,
    subject: entry.subject,
    ...(entry.middle ? { middle: entry.middle } : {}),
    item: entry.row.name,
  }
  let presets: FixturePreset[]

  if (template.variants !== undefined) {
    const choices = variants ?? []
    const allowed = new Set(template.variants)
    if (choices.some(choice => !allowed.has(choice))) {
      throw new Error('選択した規格は、この明細の換算規格に含まれていません。')
    }
    if (template.pick !== 'length' && template.pick !== 'count') {
      throw new Error('換算規格のある明細には、長さまたは個数の拾い方が必要です。')
    }
    const kind = template.pick
    presets = choices.map(choice => ({
      category: entry.middle ?? entry.subject,
      code: choice.code,
      spec: choice.spec,
      name: template.name,
      kind,
      method: kind === 'length' ? 'polyline' : 'click',
      convert: { ...choice.convert },
      breakdown: { ...breakdown },
      ...(summary.length ? { summary: summary.map(field => ({ ...field })) } : {}),
      aggregation: 'document',
    }))
  } else if (template.master !== undefined) {
    const choices = masterChoices ?? []
    const allowed = new Set(detailMasterEntries(template))
    if (choices.some(choice => !allowed.has(choice))) {
      throw new Error('選択した規格は、この明細の標準マスタに含まれていません。')
    }

    presets = choices.map(choice => ({
      category: choice.category,
      code: choice.code,
      name: choice.name,
      ...(choice.spec !== undefined ? { spec: choice.spec } : {}),
      ...(choice.kind !== undefined ? { kind: choice.kind } : {}),
      ...(choice.method !== undefined ? { method: choice.method } : {}),
      ...(choice.defaults !== undefined ? { defaults: { ...choice.defaults } } : {}),
      ...(choice.aggregation !== undefined ? { aggregation: choice.aggregation } : {}),
      ...(choice.conditions !== undefined ? { conditions: [...choice.conditions] } : {}),
      breakdown: { ...breakdown },
      ...(summary.length ? { summary: summary.map(field => ({ ...field })) } : {}),
    }))
  } else {
    const quantity = kindForUnit(template.unit)
    if (quantity === undefined) {
      throw new Error('この明細は連動で計算する予定のため、まだ拾いの項目にできません。')
    }

    const countUnit = COUNT_UNITS.find(unit => unit === template.unit)
    presets = [{
      category: entry.middle ?? entry.subject,
      code: template.code ?? '',
      name: template.name,
      ...(quantity.kind !== 'count' ? { kind: quantity.kind, method: quantity.method } : {}),
      ...(quantity.kind === 'count' && countUnit !== undefined && countUnit !== '個'
        ? { unit: countUnit }
        : {}),
      aggregation: quantity.kind === 'count' ? 'location' : 'document',
      breakdown,
      ...(summary.length ? { summary } : {}),
    }]
  }

  for (const preset of presets) {
    if (conditions.length) {
      preset.conditions = [...new Set([...(preset.conditions ?? []), ...conditions])].slice(0, 30)
    }
    const error = fixtureBreakdownError(preset)
    if (error !== undefined) throw new Error(error)
  }
  return presets
}

/** 指定された分類・種類の規格を、QUANTITY_MASTER の並び順で返す。 */
export function detailMasterEntries(template: DetailTemplate): readonly MasterEntry[] {
  const master = template.master
  if (master === undefined) return []

  // masterEntries() は QUANTITY_MASTER と各 specs の並び順を保持する。
  // 分類・種類の両方を指定したときは、両方に一致する規格を選ぶ。
  return masterEntries().filter(entry =>
    (master.categories === undefined || master.categories.includes(entry.category))
    && (master.types === undefined || master.types.includes(entry.type)),
  )
}
