import {
  COUNT_UNITS,
  QUANTITY_UNITS,
  fixtureBreakdownError,
  fixtureCode,
  type BreakdownBook,
  type BreakdownPosition,
  type CountFixture,
  type FixtureConvert,
  type FixturePreset,
  type QuantityDefaults,
  type QuantityKind,
  type QuantityMethod,
  type SummaryField,
} from './countFixtures'
import {
  breakdownEntries,
  detailMasterEntries,
  kindForUnit,
  summaryChoices,
  summaryIsCondition,
  type BreakdownEntry,
} from './breakdownMaster'
import { ELECTRICAL_DETAILS } from './breakdown/electricalDetails'
import { MASTER_ABSORPTIONS } from './breakdown/masterAbsorption'
import { STANDARD_GROUPS } from './breakdown/standardMasterGroups'
import { MECHANICAL_DETAILS, MECHANICAL_ROW_VARIANTS } from './breakdown/mechanicalDetails'
import {
  BUILDING_DETAILS,
  BUILDING_RENOVATION_DETAILS,
} from './breakdown/buildingDetails'
import { BUILDING_ROW_VARIANTS } from './breakdown/buildingVariants'
import { CONDITION_RULES } from './breakdown/conditionCandidates'
import { REPRESENTATIVE_POSITION_ROWS } from './breakdown/representativePositions'
import { MERGED_ROW_CATEGORY } from './breakdown/mergedRows'
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
} from './breakdown/catalogMap'
import { linkRuleForDetail } from './breakdown/linkRules'
import type { DetailTemplate, SummarySlot } from './breakdown/types'
import {
  QUANTITY_MASTER,
  masterEntries,
  normalizeMasterText,
} from './quantityMaster'

export interface CatalogOption {
  key: string
  label: string
  note?: string
  code: string
  spec?: string
  name: string
  /** 吸収前の品目名 */
  formerName?: string
  kind?: QuantityKind
  method?: QuantityMethod
  defaults?: QuantityDefaults
  conditions?: readonly string[]
  convert?: FixtureConvert
  /** 規格から摘要に入れる値。入力値より優先する */
  summary?: Readonly<Record<string, string>>
}

export interface CatalogItem {
  key: string
  field: string
  category: string
  type: string
  name: string
  unit: string
  breakdownItem?: string
  options: readonly CatalogOption[]
  slots: readonly SummarySlot[]
  /** この品目に吸収した標準マスタの品目名 */
  formerNames?: readonly string[]
  search: string
}

export interface CatalogSelection {
  options: readonly string[]
  values?: Readonly<Record<string, readonly string[]>>
  text?: Readonly<Record<string, string>>
}

export type CatalogPosition = Omit<BreakdownPosition, 'item'> & { item?: string }

export const MAX_CATALOG_COMBINATIONS = 100

type CatalogSource = Omit<CatalogItem, 'search'>

interface CatalogIndex {
  items: readonly CatalogItem[]
  masters: readonly CatalogItem[]
  byKey: ReadonlyMap<string, CatalogItem>
  unitQualifiedRows: ReadonlySet<string>
  rowKeys: ReadonlyMap<string, string>
  rowAliases: ReadonlyMap<string, string>
}

let cachedCatalog: CatalogIndex | undefined
let cachedRepresentativePositions: ReadonlyMap<string, BreakdownPosition> | undefined
let cachedItemPositions: ReadonlyMap<string, readonly BreakdownPosition[]> | undefined

const detailSources: readonly {
  book: BreakdownBook
  details: Readonly<Record<string, readonly DetailTemplate[]>>
  categories: Readonly<Record<string, string>>
  section?: string
}[] = [
  { book: '電気設備', details: ELECTRICAL_DETAILS, categories: DETAIL_CATEGORY },
  { book: '機械設備', details: MECHANICAL_DETAILS, categories: MECHANICAL_DETAIL_CATEGORY },
  { book: '建築', details: BUILDING_DETAILS, categories: {}, section: '庁舎' },
  { book: '建築', details: BUILDING_RENOVATION_DETAILS, categories: {}, section: '庁舎（改修）' },
]

function masterKey(field: string, category: string, type: string): string {
  return `master:${JSON.stringify([field, category, type])}`
}

function rowCategory(entry: BreakdownEntry): string {
  if (entry.book === '建築') {
    return entry.middle?.startsWith('撤去')
      ? '撤去'
      : BUILDING_ROW_CATEGORY[entry.row.name] ?? BUILDING_SUBJECT_CATEGORY[entry.subject] ?? entry.subject
  }
  if (entry.book === '機械設備') return MECHANICAL_ROW_CATEGORY[entry.row.name] ?? entry.subject
  if (entry.book !== '電気設備') return entry.subject
  if (LIGHTING_ROWS.includes(entry.row.name)) return '照明器具'
  if (entry.row.name.endsWith('盤') || entry.row.summary?.includes('盤名称')) {
    return '盤類'
  }
  return entry.subject
}

function rowNameKey(entry: BreakdownEntry): string {
  return JSON.stringify([entry.book, entry.row.name])
}

function rowKey(
  entry: BreakdownEntry,
  unitQualifiedRows: ReadonlySet<string>,
  summary?: readonly string[],
): string {
  const parts = [rowCategory(entry), entry.row.name]
  // 建築は従来どおり単位を含める。他編は同名の行に単位差がある場合だけ追加する。
  if (entry.book === '建築' || unitQualifiedRows.has(rowNameKey(entry))) {
    parts.push(entry.row.unit)
  }
  const scopedParts = entry.book === '電気設備' ? parts : [entry.book, ...parts]
  return `row:${JSON.stringify(summary === undefined ? scopedParts : [...scopedParts, summary])}`
}

function detailKey(
  rowName: string,
  template: DetailTemplate,
  book: BreakdownBook = '電気設備',
  section?: string,
): string {
  const parts = [rowName, template.name]
  if (book === '建築') {
    const scope = section === '庁舎（改修）' ? '改修' : '新営'
    return `detail:${JSON.stringify([book, scope, ...parts])}`
  }
  return `detail:${JSON.stringify(book === '電気設備' ? parts : [book, ...parts])}`
}

function sharedSearch(item: CatalogSource): string {
  return normalizeMasterText([
    item.field,
    item.category,
    item.type,
    item.name,
    ...(item.formerNames ?? []),
    ...item.slots.flatMap(slot => [slot.label, ...(slot.choices ?? [])]),
  ].join(' '))
}

function withSearch(item: CatalogSource): CatalogItem {
  return {
    ...item,
    search: normalizeMasterText([
      item.field,
      item.category,
      item.type,
      item.name,
      ...(item.formerNames ?? []),
      ...item.options.flatMap(option => [option.label, option.spec ?? '']),
      ...item.slots.flatMap(slot => [slot.label, ...(slot.choices ?? [])]),
    ].join(' ')),
  }
}

function detailOptions(template: DetailTemplate): CatalogOption[] {
  if (template.variants !== undefined) {
    if (template.pick !== 'length' && template.pick !== 'area' && template.pick !== 'count') {
      throw new Error('換算規格のある明細には、長さ・面積・個数のいずれかの拾い方が必要です。')
    }
    const kind = template.pick
    return template.variants.map(variant => ({
      key: variant.code,
      label: variant.summary === undefined ? variant.code : variant.spec,
      note: variant.convert.basis,
      code: variant.code,
      spec: variant.spec,
      ...(variant.summary !== undefined ? { summary: { ...variant.summary } } : {}),
      name: template.name,
      kind,
      method: kind === 'length' ? 'polyline' : kind === 'area' ? 'polygon' : 'click',
      // 保存形式の根拠は60文字まで。全文は上の note に保持する。
      convert: {
        ...variant.convert,
        basis: variant.convert.basis.length > 60
          ? `${variant.convert.basis.slice(0, 59)}…`
          : variant.convert.basis,
      },
    }))
  }

  // 拾えない単位でも連動の規則があれば、数量と単位を連動から得る項目として登録する。
  const quantity = kindForUnit(template.unit)
    ?? (template.linked === 'carry' || linkRuleForDetail(template.name) !== undefined
      ? { kind: 'count' as const, method: 'click' as const }
      : undefined)
  if (quantity === undefined) return []
  return [{
    key: 'item',
    label: '',
    code: template.code ?? '',
    name: template.name,
    ...quantity,
  }]
}

function catalogIndex(): CatalogIndex {
  if (cachedCatalog !== undefined) return cachedCatalog

  const optionsByType = new Map<string, CatalogOption[]>()
  for (const entry of masterEntries()) {
    const key = masterKey(entry.field, entry.category, entry.type)
    let options = optionsByType.get(key)
    if (options === undefined) {
      options = []
      optionsByType.set(key, options)
    }
    options.push({
      key: entry.key,
      label: fixtureCode(entry),
      code: entry.code,
      name: entry.name,
      ...(entry.spec !== undefined ? { spec: entry.spec } : {}),
      ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
      ...(entry.method !== undefined ? { method: entry.method } : {}),
      ...(entry.defaults !== undefined ? { defaults: { ...entry.defaults } } : {}),
      ...(entry.conditions !== undefined ? { conditions: [...entry.conditions] } : {}),
      ...(entry.convert !== undefined ? { convert: { ...entry.convert } } : {}),
    })
  }

  // QUANTITY_MASTER can list the same field/category/type twice (仮設 外部足場); one item holds all their specs.
  const masterTypes = QUANTITY_MASTER.filter((type, index) => QUANTITY_MASTER.findIndex(other =>
    masterKey(other.field, other.category, other.type) === masterKey(type.field, type.category, type.type)) === index)
  const masters = masterTypes.map(type => {
    const key = masterKey(type.field, type.category, type.type)
    const breakdownItem = type.field === '電気設備'
      ? MASTER_TYPE_ITEMS[type.type] ?? MASTER_CATEGORY_ITEMS[type.category]
      : undefined
    return withSearch({
      key,
      field: type.field,
      category: CATEGORY_ALIASES[type.category] ?? type.category,
      type: type.type,
      name: type.name,
      unit: QUANTITY_UNITS[type.kind],
      ...(breakdownItem !== undefined ? { breakdownItem } : {}),
      options: optionsByType.get(key) ?? [],
      slots: [],
    })
  })

  const items: CatalogItem[] = [...masters]
  const byKey = new Map(items.map(item => [item.key, item]))

  const entries = breakdownEntries()
  // 別紙明細から品目ができない設備の行だけ、行自体を1式の品目にする。
  // catalogIndex の構築中なので、公開の逆引き関数を呼んで再入しない。
  const detailHasItems = (template: DetailTemplate): boolean =>
    template.master === undefined
      ? detailOptions(template).length > 0
      : detailMasterEntries(template).some(choice =>
        byKey.has(masterKey(choice.field, choice.category, choice.type)))
  const rowEntries = entries.filter(entry =>
    !entry.row.separate
    || ((entry.book === '電気設備' || entry.book === '機械設備')
      && !entry.details.some(detailHasItems)),
  )
  const unitsByName = new Map<string, Set<string>>()
  for (const entry of rowEntries) {
    const nameKey = rowNameKey(entry)
    let units = unitsByName.get(nameKey)
    if (units === undefined) {
      units = new Set<string>()
      unitsByName.set(nameKey, units)
    }
    units.add(entry.row.unit)
  }
  const unitQualifiedRows = new Set(
    [...unitsByName].filter(([, units]) => units.size > 1).map(([key]) => key),
  )

  const rowKeys = new Map<string, string>()
  const rowAliases = new Map<string, string>()
  const rowKeysBySummary = new Map<string, Map<string, string>>()

  for (const entry of rowEntries) {
    const hasLinkRule = !entry.row.separate && linkRuleForDetail(entry.row.name) !== undefined
    const baseKey = rowKey(entry, unitQualifiedRows)
    let key = baseKey
    if (entry.book === '電気設備' || entry.book === '機械設備') {
      const summary = entry.row.summary ?? []
      const signature = JSON.stringify(summary)
      const keys = rowKeysBySummary.get(baseKey) ?? new Map<string, string>()
      key = keys.get(signature)
        ?? (keys.size === 0 ? baseKey : rowKey(entry, unitQualifiedRows, summary))
      keys.set(signature, key)
      rowKeysBySummary.set(baseKey, keys)
    }
    rowKeys.set(entry.key, key)
    if (byKey.has(key)) continue

    const quantity = entry.row.separate
      ? { kind: 'count' as const, method: 'click' as const }
      : kindForUnit(entry.row.unit)
        ?? (hasLinkRule ? { kind: 'count' as const, method: 'click' as const } : undefined)
    // 建築は連動の選択肢と規格を併設する。他編の連動の選び方は維持する。
    const rowVariants = entry.row.separate
      ? undefined
      : entry.book === '建築'
        ? BUILDING_ROW_VARIANTS[entry.row.name]
      : !hasLinkRule && entry.book === '機械設備'
        ? MECHANICAL_ROW_VARIANTS[entry.row.name]
        : undefined
    const options = rowVariants !== undefined
      ? detailOptions({
        name: entry.row.name,
        unit: entry.row.unit,
        ...rowVariants,
      })
      : quantity !== undefined
        ? [{
          key: 'item',
          label: '',
          code: '',
          name: entry.row.name,
          ...quantity,
        }]
        : []
    if (hasLinkRule && rowVariants !== undefined && quantity !== undefined) {
      options.unshift({
        key: 'item',
        label: '鉄骨の部材から（連動）',
        code: '',
        name: entry.row.name,
        ...quantity,
      })
    }
    if (!options.length) continue
    const item = withSearch({
      key,
      field: entry.book,
      category: rowCategory(entry),
      type: entry.row.name,
      name: entry.row.name,
      unit: entry.row.unit,
      breakdownItem: entry.row.name,
      options,
      slots: (entry.row.summary ?? []).map(label => {
        const choices = summaryChoices(entry.row.name, label, entry.book)
        return {
          label,
          ...(choices.length ? { choices } : {}),
          ...(summaryIsCondition(entry.row.name, label, entry.book) ? { condition: true as const } : {}),
        }
      }),
    })
    items.push(item)
    byKey.set(key, item)
  }

  for (const { book, details, categories, section } of detailSources) {
    for (const [rowName, templates] of Object.entries(details)) {
      for (const template of templates) {
        if (template.master !== undefined) continue
        const options = detailOptions(template)
        if (!options.length) continue

        const item = withSearch({
          key: detailKey(rowName, template, book, section),
          field: book,
          category: categories[rowName] ?? rowName,
          type: template.name,
          name: template.name,
          unit: template.unit,
          breakdownItem: rowName,
          options,
          slots: template.summary ?? [],
        })
        items.push(item)
        byKey.set(item.key, item)
      }
    }
  }

  for (const absorption of MASTER_ABSORPTIONS) {
    const key = masterKey(...absorption.master)
    const master = byKey.get(key)
    if (master === undefined) {
      throw new Error(`吸収元の標準マスタがありません: ${key}`)
    }

    const targets = items.filter(item =>
      item.field === absorption.master[0]
      && absorption.targets.some(target =>
        'row' in target
          ? item.key.startsWith('row:')
            && item.name === target.row
            && (target.unit === undefined || item.unit === target.unit)
          : item.key.startsWith('detail:')
            && item.breakdownItem === target.detailRow
            && item.name === target.detail),
    )
    if (!targets.length) {
      throw new Error(`標準マスタの吸収先がありません: ${key}`)
    }

    for (const target of targets) {
      const options = [...target.options]
      const optionKeys = new Set(options.map(option => option.key))
      if (absorption.mode !== 'drop') {
        for (const option of master.options) {
          if (optionKeys.has(option.key)) continue
          const summary: Record<string, string> = {}
          for (const [label, value] of Object.entries(absorption.summary ?? {})) {
            if (value.trim()) summary[label] = value
          }
          if (absorption.codeLabel && option.code.trim()) {
            summary[absorption.codeLabel] = option.code
          }
          if (absorption.specLabel && option.spec !== undefined) {
            const value = absorption.specValue === 'stripPhi'
              ? option.spec.replace(/^φ/, '')
              : option.spec
            if (value.trim()) summary[absorption.specLabel] = value
          }
          options.push({
            ...option,
            name: target.name,
            formerName: master.name,
            summary,
          })
          optionKeys.add(option.key)
        }
      }

      const absorbed = withSearch({
        ...target,
        options,
        formerNames: [...new Set([...(target.formerNames ?? []), master.name])],
      })
      items[items.findIndex(item => item.key === target.key)] = absorbed
      byKey.set(absorbed.key, absorbed)
    }

    items.splice(items.findIndex(item => item.key === key), 1)
    byKey.delete(key)
  }

  // U8: 標準単価積算基準の規格を、U1 の吸収後・U2 の行統合前に追加する。
  const standardCountUnits = new Set<string>(COUNT_UNITS)
  standardCountUnits.delete('式')

  for (const [i, group] of STANDARD_GROUPS.entries()) {
    const standardOptions: CatalogOption[] = group.specs.map(([spec, code], j) => {
      const summary: Record<string, string> = {}
      for (const [label, value] of Object.entries(group.summary ?? {})) {
        if (value.trim()) summary[label] = value
      }
      if (group.specLabel && spec !== '') {
        summary[group.specLabel] = spec
          + (group.specSuffix && /^\d+$/.test(spec) ? group.specSuffix : '')
      }

      return {
        key: `std:${i}:${j}`,
        label: [code, spec].filter(Boolean).join(' '),
        code,
        ...(spec !== '' ? { spec } : {}),
        name: group.name,
        kind: group.kind,
        method: group.method,
        ...(group.conditions.length ? { conditions: [...group.conditions] } : {}),
        ...(Object.keys(summary).length ? { summary } : {}),
      }
    })

    const appendOptions = (target: CatalogSource, absorbed: boolean): CatalogItem => {
      const options = [...target.options]
      const optionKeys = new Set(options.map(option => option.key))
      for (const option of standardOptions) {
        if (optionKeys.has(option.key)) continue
        // 吸収先には品目そのものの規格があるので、記号・規格・摘要の無い規格は足さない（同じ名前のチェックが2つ並ぶため）。
        if (absorbed && option.label === '' && option.summary === undefined) continue
        options.push({
          ...option,
          name: target.name,
          ...(absorbed ? { formerName: group.name } : {}),
        })
        optionKeys.add(option.key)
      }

      return withSearch({
        ...target,
        options,
        ...(absorbed ? {
          formerNames: [...new Set([...(target.formerNames ?? []), group.name])],
        } : {}),
      })
    }

    const targetDefinitions = group.targets ?? []
    const targets = targetDefinitions.length
      ? items.filter(item =>
        item.field === group.field
        && (item.unit === group.unit
          || (standardCountUnits.has(item.unit) && standardCountUnits.has(group.unit)))
        && targetDefinitions.some(target =>
          'row' in target
            ? item.key.startsWith('row:')
              && item.name === target.row
              && (target.unit === undefined || item.unit === target.unit)
            : item.key.startsWith('detail:')
              && item.breakdownItem === target.detailRow
              && item.name === target.detail),
      )
      : []

    if (targets.length) {
      for (const target of targets) {
        const absorbed = appendOptions(target, true)
        items[items.findIndex(item => item.key === target.key)] = absorbed
        byKey.set(absorbed.key, absorbed)
      }
      continue
    }

    const key = `std:${JSON.stringify([
      group.field, group.category, group.name, group.unit,
    ])}`
    const existing = byKey.get(key)
    const independent = appendOptions(existing ?? {
      key,
      field: group.field,
      category: group.category,
      type: group.name,
      name: group.name,
      unit: group.unit,
      options: [],
      slots: [],
    }, false)

    if (existing === undefined) {
      items.push(independent)
    } else {
      items[items.findIndex(item => item.key === key)] = independent
    }
    byKey.set(key, independent)
  }

  // 吸収後の規格も含めてまとめる。行の生成順なので最初の行の鍵が残る。
  const mergedRows = new Map<string, CatalogItem>()
  for (const item of [...items]) {
    if (!item.key.startsWith('row:')
      || (item.field !== '電気設備' && item.field !== '機械設備')) continue

    const signature = JSON.stringify([
      item.field,
      item.name,
      item.unit,
      item.slots.map(slot => slot.label),
    ])
    const first = mergedRows.get(signature)
    if (first === undefined) {
      const retained = withSearch({
        ...item,
        category: MERGED_ROW_CATEGORY[item.field][item.name] ?? item.category,
      })
      items[items.findIndex(candidate => candidate.key === item.key)] = retained
      byKey.set(retained.key, retained)
      mergedRows.set(signature, retained)
      continue
    }

    const options = [...first.options]
    const optionKeys = new Set(options.map(option => option.key))
    for (const option of item.options) {
      if (optionKeys.has(option.key)) continue
      options.push(option)
      optionKeys.add(option.key)
    }
    const formerNames = [...new Set([
      ...(first.formerNames ?? []),
      ...(item.formerNames ?? []),
    ])]
    const retained = withSearch({
      ...first,
      options,
      ...(formerNames.length ? { formerNames } : {}),
    })
    items[items.findIndex(candidate => candidate.key === first.key)] = retained
    items.splice(items.findIndex(candidate => candidate.key === item.key), 1)
    byKey.set(retained.key, retained)
    byKey.delete(item.key)
    rowAliases.set(item.key, retained.key)
    mergedRows.set(signature, retained)
  }

  return cachedCatalog = { items, masters, byKey, unitQualifiedRows, rowKeys, rowAliases }
}

/** 初回に一覧を構築し、以後は同じ一覧を返す。画面側から遅延 import する。 */
export function catalogItems(): readonly CatalogItem[] {
  return catalogIndex().items
}

/** 上から順に、種類または分類が最初に一致した規則の候補を返す。 */
export function conditionCandidatesFor(item: CatalogItem): readonly string[] {
  return CONDITION_RULES.find(rule =>
    rule.types?.includes(item.type) || rule.categories?.includes(item.category),
  )?.conditions ?? []
}

function catalogOptionConditions(item: CatalogItem, option: CatalogOption): string[] {
  return [...new Set([
    ...(option.conditions ?? []),
    ...item.slots.flatMap(slot => slot.condition ? slot.choices ?? [] : []),
    ...conditionCandidatesFor(item),
  ])].slice(0, 30)
}

/** 既存の項目を品目へ照合し、新規追加と同じ順序で候補を返す。 */
export function catalogConditionsForFixture(
  f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'category'> & {
    summary?: CountFixture['summary']
  },
): string[] {
  const items = catalogItems()
  const sameSpecification = (option: CatalogOption) =>
    option.code === f.code && (option.spec ?? '') === (f.spec ?? '')
  const sameOption = (option: CatalogOption) =>
    sameSpecification(option) && (option.name === f.name || option.formerName === f.name)
  const fixtureSummary = f.summary
  const sameOptionWithSummary = (option: CatalogOption) => {
    const optionSummary = Object.entries(option.summary ?? {})
    return sameOption(option)
      && fixtureSummary !== undefined
      && optionSummary.length > 0
      && optionSummary.every(([label, value]) =>
        fixtureSummary.some(summary => summary.label === label && summary.value === value),
      )
  }
  const item = items.find(candidate =>
    candidate.category === f.category && candidate.options.some(sameOptionWithSummary),
  )
    ?? items.find(candidate =>
      candidate.category === f.category && candidate.options.some(sameOption),
    )
    ?? items.find(candidate => candidate.options.some(sameOptionWithSummary))
    ?? items.find(candidate => candidate.options.some(sameOption))
    ?? items.find(candidate => candidate.name === f.name && candidate.category === f.category)
    ?? items.find(candidate => candidate.name === f.name)
    ?? (f.code !== '' ? items.find(candidate => candidate.type === f.code) : undefined)
    // 吸収した既存の品目（U1）の項目: 規格の無い「ダウンライト」（記号 DL）等も、吸収先の品目の条件にする。
    ?? items.find(candidate => candidate.formerNames?.includes(f.name) && candidate.category === f.category)
    ?? items.find(candidate => candidate.formerNames?.includes(f.name))
    ?? (f.code !== '' ? items.find(candidate => candidate.options.some(option =>
      option.formerName !== undefined && option.code === f.code)) : undefined)
  if (item === undefined) return []

  // 摘要の一致する区分が最も多い規格を選ぶ（管種の違う配管が同じ呼び径の規格を持つため）。
  const summaryScore = (candidate: CatalogOption) => Object.keys(candidate.summary ?? {}).length
  const option = item.options.filter(sameOptionWithSummary)
    .sort((left, right) => summaryScore(right) - summaryScore(left))[0]
    ?? item.options.find(sameOption)
    ?? item.options.find(sameSpecification)
    ?? item.options.find(option => option.formerName === f.name)
    ?? (f.code !== '' ? item.options.find(option => option.formerName !== undefined && option.code === f.code) : undefined)
    ?? item.options[0]
  return option === undefined ? [] : catalogOptionConditions(item, option)
}

/** 品目の並びを保ち、各検索語に一致する品目と規格を返す。 */
export function searchCatalog(
  query: string,
  limit = 200,
): { results: Array<{ item: CatalogItem; options: readonly CatalogOption[] }>; total: number } {
  const terms = query.normalize('NFKC').split(/\s+/).map(normalizeMasterText).filter(Boolean)
  if (!terms.length) return { results: [], total: 0 }

  const sizeTerm = (term: string) => /^[0-9.φ□]/.test(term)
  const results: Array<{ item: CatalogItem; options: readonly CatalogOption[] }> = []

  for (const item of catalogItems()) {
    if (!terms.every(term => item.search.includes(term))) continue
    const shared = sharedSearch(item)
    // 試験9に合わせ、E25 のように option だけにある語も規格を絞る。
    const optionTerms = terms.filter(term => sizeTerm(term) || !shared.includes(term))
    const options = optionTerms.length
      ? item.options.filter(option => {
        const text = normalizeMasterText(`${option.label} ${option.spec ?? ''}`)
        return optionTerms.every(term => text.includes(term))
      })
      : item.options
    if (options.length) results.push({ item, options })
  }

  return {
    results: results.slice(0, Math.max(0, Math.floor(limit))),
    total: results.length,
  }
}

/** 内訳書の細目に対応する品目。位置は catalogPresets の呼出時に渡す。 */
export function catalogItemsForBreakdownRow(entry: BreakdownEntry): readonly CatalogItem[] {
  const index = catalogIndex()
  const rowItems = (): readonly CatalogItem[] => {
    const key = index.rowKeys.get(entry.key)
    if (key === undefined) return []
    const item = index.byKey.get(index.rowAliases.get(key) ?? key)
    if (item === undefined || item.unit !== entry.row.unit || !item.options.length) return []
    return [item]
  }
  if (!entry.row.separate) {
    // variants・連動の規則で拾う行も返す。同名でも単位・摘要区分が違う品目は返さない。
    return rowItems()
  }

  const result: CatalogItem[] = []
  for (const template of entry.details) {
    if (template.master === undefined) {
      const item = index.byKey.get(detailKey(entry.row.name, template, entry.book, entry.section))
      if (item !== undefined) result.push(item)
      continue
    }

    const keys = new Set(detailMasterEntries(template).map(choice =>
      masterKey(choice.field, choice.category, choice.type),
    ))
    for (const item of index.masters) {
      if (!keys.has(item.key)) continue
      result.push(template.summary === undefined ? item : withSearch({
        ...item,
        key: entry.book === '電気設備'
          ? `${item.key}#${entry.row.name}${template.name}`
          : `${item.key}#${JSON.stringify([entry.book, entry.row.name, template.name])}`,
        slots: template.summary,
      }))
    }
  }
  return result.length ? result : rowItems()
}

/** 重ね合わせと統合前の鍵を、一覧に残した品目の鍵に戻す。 */
function sourceCatalogKey(key: string): string {
  const index = catalogIndex()
  if (index.byKey.has(key) || index.rowAliases.has(key)) {
    return index.rowAliases.get(key) ?? key
  }

  // JSON 内の名称に # があっても、実在する元の鍵まで確認する。
  for (let overlay = key.indexOf('#'); overlay !== -1; overlay = key.indexOf('#', overlay + 1)) {
    const source = key.slice(0, overlay)
    if (index.byKey.has(source) || index.rowAliases.has(source)) {
      return index.rowAliases.get(source) ?? source
    }
  }

  const overlay = key.indexOf('#')
  return key.startsWith('master:') && overlay !== -1 ? key.slice(0, overlay) : key
}

/** 品目が出る内訳書の行の位置の一覧（breakdownEntries() の順、庁舎を先）。重ね合わせの鍵は元の鍵で比べる。 */
export function catalogItemPositions(item: CatalogItem): BreakdownPosition[] {
  if (cachedItemPositions === undefined) {
    const positions = new Map<string, BreakdownPosition[]>()
    const entries = breakdownEntries()
    for (const headquarters of [true, false]) {
      for (const entry of entries) {
        if ((entry.section === '庁舎') !== headquarters) continue
        const seen = new Set<string>()
        for (const candidate of catalogItemsForBreakdownRow(entry)) {
          const key = sourceCatalogKey(candidate.key)
          if (seen.has(key)) continue
          seen.add(key)
          const rows = positions.get(key) ?? []
          rows.push({
            book: entry.book,
            section: entry.section,
            subject: entry.subject,
            ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
            item: entry.row.name,
          })
          positions.set(key, rows)
        }
      }
    }
    cachedItemPositions = positions
  }

  // 呼出側による変更をキャッシュへ戻さない。
  return (cachedItemPositions.get(sourceCatalogKey(item.key)) ?? [])
    .map(position => ({ ...position }))
}

/** 編の順、庁舎優先、マスタの行順で選び、未対応の品目は想定の細目で補う。 */
export function representativeBreakdownPosition(item: CatalogItem): BreakdownPosition | undefined {
  if (cachedRepresentativePositions === undefined) {
    const positions = new Map<string, BreakdownPosition>()
    const books: readonly BreakdownBook[] = ['電気設備', '機械設備', '昇降機設備', '建築']

    for (const book of books) {
      const entries = breakdownEntries(book)
      for (const headquarters of [true, false]) {
        for (const entry of entries) {
          if ((entry.section === '庁舎') !== headquarters) continue
          for (const candidate of catalogItemsForBreakdownRow(entry)) {
            const key = sourceCatalogKey(candidate.key)
            if (positions.has(key)) continue
            positions.set(key, {
              book: entry.book,
              section: entry.section,
              subject: entry.subject,
              ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
              item: entry.row.name,
            })
          }
        }
      }
    }

    // 自動対応を優先し、位置がまだ決まっていない標準マスタだけ補う。
    for (const row of REPRESENTATIVE_POSITION_ROWS) {
      const key = masterKey(...row.master)
      if (!catalogIndex().byKey.has(key) || positions.has(key)) continue

      const entry = breakdownEntries(row.book).find(entry =>
        entry.section === row.section
        && entry.subject === row.subject
        && entry.middle === row.middle
        && entry.row.name === row.item,
      )
      if (entry === undefined) continue

      positions.set(key, {
        book: entry.book,
        section: entry.section,
        subject: entry.subject,
        ...(entry.middle !== undefined ? { middle: entry.middle } : {}),
        item: entry.row.name,
      })
    }

    cachedRepresentativePositions = positions
  }

  const position = cachedRepresentativePositions.get(sourceCatalogKey(item.key))
  // 呼出側で変更しても、逆引きの表や別の品目へ影響させない。
  return position === undefined ? undefined : { ...position }
}

function trimmedValues(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

const splitLabels = new Set(['記号', '盤名称', '名称', '建具番号'])

interface SummaryDimension {
  label: string
  values: readonly string[]
  split: boolean
}

interface SummaryCombination {
  summary: SummaryField[]
  splitValue?: string
}

/** 標準マスタから追加するときの規則。建築の併設された換算規格には連動を付けない。 */
export function catalogLinkRuleForPreset(preset: FixturePreset) {
  const rule = linkRuleForDetail(preset.name)
  if (rule === undefined || preset.convert === undefined) return rule

  const selectedBuildingVariant = catalogItems().some(item =>
    item.field === '建築'
    && item.key.startsWith('row:')
    && item.options.some(option => option.key === 'item' && option.convert === undefined)
    && item.options.some(option =>
      option.convert !== undefined
      && option.name === preset.name
      && option.code === preset.code
      && (option.spec ?? '') === (preset.spec ?? '')
      && (option.kind ?? 'count') === (preset.kind ?? 'count')
      && (option.method ?? 'click') === (preset.method ?? 'click')),
  )
  return selectedBuildingVariant ? undefined : rule
}

/** 規格ごとに、規格で固定されていない摘要の直積から項目を作る。 */
export function catalogPresets(
  item: CatalogItem,
  selection: CatalogSelection,
  position?: CatalogPosition,
): FixturePreset[] {
  const byKey = new Map(item.options.map(option => [option.key, option]))
  const options: CatalogOption[] = []
  for (const key of new Set(selection.options)) {
    const option = byKey.get(key)
    if (option !== undefined) options.push(option)
  }
  if (!options.length) return []

  const splitIndex = item.slots.findIndex(slot =>
    !slot.condition && splitLabels.has(slot.label),
  )
  const dimensions: SummaryDimension[] = []

  for (const [index, slot] of item.slots.entries()) {
    if (slot.condition) continue

    const split = index === splitIndex
    const text = selection.text?.[slot.label] ?? ''
    // 選択肢のある区分も、入力された文字（「、」で分ける区分は分けて）を値に含める（U6: 記号等に選択肢を足した）。
    const typed = split ? text.split(/[、,，]/) : [text]
    const values = slot.choices?.length
      ? trimmedValues([...(selection.values?.[slot.label] ?? []), ...typed])
      : trimmedValues(typed)
    if (values.length) dimensions.push({ label: slot.label, values, split })
  }

  const combinationsByOption = new Map<string, SummaryCombination[]>()
  let total = 0
  for (const option of options) {
    const optionDimensions = dimensions.filter(dimension =>
      !option.summary?.[dimension.label]?.trim(),
    )
    let optionTotal = 1
    for (const dimension of optionDimensions) {
      optionTotal *= dimension.values.length
      if (optionTotal > MAX_CATALOG_COMBINATIONS) break
    }
    total += optionTotal
    if (total > MAX_CATALOG_COMBINATIONS) {
      throw new Error('組合せが100件を超えます。選ぶ値を減らしてください。')
    }

    let combinations: SummaryCombination[] = [{ summary: [] }]
    for (const dimension of optionDimensions) {
      combinations = combinations.flatMap(combination =>
        dimension.values.map(value => ({
          summary: [...combination.summary, { label: dimension.label, value }],
          ...(dimension.split
            ? { splitValue: value }
            : combination.splitValue !== undefined
              ? { splitValue: combination.splitValue }
              : {}),
        })),
      )
    }
    combinationsByOption.set(option.key, combinations)
  }

  const lumpSumPosition = (
    (item.field === '電気設備' || item.field === '機械設備')
    && item.key.startsWith('row:')
    && item.unit === '式'
    && position !== undefined
  ) ? position : undefined

  const presets: FixturePreset[] = []
  for (const option of options) {
    const conditions = catalogOptionConditions(item, option)

    const kind = option.kind ?? 'count'
    const countUnit = kind === 'count' && option.convert === undefined
      ? COUNT_UNITS.find(unit => unit === item.unit && unit !== '個')
      : undefined

    for (const combination of combinationsByOption.get(option.key)!) {
      const code = option.code || (
        combination.splitValue !== undefined && combination.splitValue.length <= 16
          ? combination.splitValue
          : ''
      )
      const summaryValues = new Map(combination.summary.map(field => [field.label, field.value]))
      for (const [label, value] of Object.entries(option.summary ?? {})) {
        if (value.trim()) summaryValues.set(label, value.trim())
      }

      if (lumpSumPosition !== undefined) {
        summaryValues.set('対象', [
          lumpSumPosition.subject,
          lumpSumPosition.middle,
        ].filter(Boolean).join(' '))
      }

      const summaryLabels = [...new Set([
        ...(lumpSumPosition !== undefined ? ['対象'] : []),
        ...item.slots.filter(slot => !slot.condition).map(slot => slot.label),
        ...summaryValues.keys(),
      ])]
      const summary = summaryLabels.flatMap(label => {
        const value = summaryValues.get(label)
        return value !== undefined ? [{ label, value }] : []
      })
      const preset: FixturePreset = {
        category: item.category,
        code,
        name: lumpSumPosition !== undefined
          ? `${option.name}（${lumpSumPosition.middle || lumpSumPosition.subject}）`
          : option.name,
        ...(option.spec !== undefined ? { spec: option.spec } : {}),
        ...(option.kind !== undefined ? { kind: option.kind } : {}),
        ...(option.method !== undefined ? { method: option.method } : {}),
        ...(option.defaults !== undefined ? { defaults: { ...option.defaults } } : {}),
        ...(option.convert !== undefined ? { convert: { ...option.convert } } : {}),
        ...(countUnit !== undefined ? { unit: countUnit } : {}),
        aggregation: kind === 'count' && option.convert === undefined ? 'location' : 'document',
        ...(conditions.length || option.conditions !== undefined
          ? { conditions: [...conditions] }
          : {}),
        ...(summary.length ? { summary } : {}),
        ...(position !== undefined ? {
          breakdown: {
            book: position.book,
            section: position.section,
            subject: position.subject,
            ...(position.middle !== undefined ? { middle: position.middle } : {}),
            item: position.item ?? item.breakdownItem ?? item.name,
          },
        } : {}),
      }

      // fixtureBreakdownError は換算の検査も行う。
      const error = fixtureBreakdownError(preset)
      if (error !== undefined) throw new Error(error)
      presets.push(preset)
    }
  }
  return presets
}
