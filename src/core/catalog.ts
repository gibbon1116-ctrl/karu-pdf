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
import { ELECTRICAL_DETAILS, ELECTRICAL_ROW_MASTERS } from './breakdown/electricalDetails'
import { MECHANICAL_DETAILS, MECHANICAL_ROW_VARIANTS } from './breakdown/mechanicalDetails'
import {
  BUILDING_DETAILS,
  BUILDING_RENOVATION_DETAILS,
} from './breakdown/buildingDetails'
import { BUILDING_ROW_VARIANTS } from './breakdown/buildingVariants'
import { CONDITION_RULES } from './breakdown/conditionCandidates'
import { REPRESENTATIVE_POSITION_ROWS } from './breakdown/representativePositions'
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
  /** 細目に重ね合わせた器具だけ、未入力の記号に選んだ規格の略号を使う。 */
  defaultSymbolFromCode?: boolean
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
}

let cachedCatalog: CatalogIndex | undefined
let cachedRepresentativePositions: ReadonlyMap<string, BreakdownPosition> | undefined

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

function rowKey(entry: BreakdownEntry, unitQualifiedRows: ReadonlySet<string>): string {
  const parts = [rowCategory(entry), entry.row.name]
  // 建築は従来どおり単位を含める。他編は同名の行に単位差がある場合だけ追加する。
  if (entry.book === '建築' || unitQualifiedRows.has(rowNameKey(entry))) {
    parts.push(entry.row.unit)
  }
  return `row:${JSON.stringify(entry.book === '電気設備' ? parts : [entry.book, ...parts])}`
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
  const unitsByName = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (entry.row.separate) continue
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

  for (const entry of entries) {
    if (entry.row.separate) continue
    const hasLinkRule = linkRuleForDetail(entry.row.name) !== undefined
    const key = rowKey(entry, unitQualifiedRows)
    if (byKey.has(key)) continue

    const quantity = kindForUnit(entry.row.unit)
      ?? (hasLinkRule ? { kind: 'count' as const, method: 'click' as const } : undefined)
    // 建築は連動の選択肢と規格を併設する。他編の連動の選び方は維持する。
    const rowVariants = entry.book === '建築'
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

  return cachedCatalog = { items, masters, byKey, unitQualifiedRows }
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
  f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'category'>,
): string[] {
  const items = catalogItems()
  const sameSpecification = (option: CatalogOption) =>
    option.code === f.code && (option.spec ?? '') === (f.spec ?? '')
  const sameOption = (option: CatalogOption) =>
    sameSpecification(option) && option.name === f.name
  const item = items.find(candidate =>
    candidate.category === f.category && candidate.options.some(sameOption),
  )
    ?? items.find(candidate => candidate.options.some(sameOption))
    ?? items.find(candidate => candidate.name === f.name && candidate.category === f.category)
    ?? items.find(candidate => candidate.name === f.name)
    ?? (f.code !== '' ? items.find(candidate => candidate.type === f.code) : undefined)
  if (item === undefined) return []

  const option = item.options.find(sameOption)
    ?? item.options.find(sameSpecification)
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
  if (!entry.row.separate) {
    // variants・連動の規則で拾う行も返す。同名でも単位が違う品目は返さない。
    const item = index.byKey.get(rowKey(entry, index.unitQualifiedRows))
    if (item === undefined || item.unit !== entry.row.unit || !item.options.length) return []

    const rowMaster = entry.book === '電気設備'
      && Object.hasOwn(ELECTRICAL_ROW_MASTERS, entry.row.name)
      ? ELECTRICAL_ROW_MASTERS[entry.row.name]
      : undefined
    if (rowMaster === undefined) return [item]

    const slots = (entry.row.summary ?? []).map(label => {
      const choices = summaryChoices(entry.row.name, label, entry.book)
      return {
        label,
        ...(choices.length ? { choices } : {}),
        ...(summaryIsCondition(entry.row.name, label, entry.book) ? { condition: true as const } : {}),
      }
    })
    const masters = index.masters
      .filter(master => master.field === '電気設備' && rowMaster.types.includes(master.type))
      .map(master => withSearch({
        ...master,
        key: `${master.key}#row:${item.key}`,
        unit: entry.row.unit,
        breakdownItem: entry.row.name,
        slots,
        defaultSymbolFromCode: true,
      }))
    return [...masters, item]
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
  return result
}

/** 重ね合わせた標準マスタの鍵を、元の品目の鍵に戻す。 */
function sourceCatalogKey(key: string): string {
  const overlay = key.indexOf('#')
  return key.startsWith('master:') && overlay !== -1 ? key.slice(0, overlay) : key
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
      if (positions.has(key)) continue

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
    !slot.condition && !slot.choices?.length && splitLabels.has(slot.label),
  )
  const dimensions: SummaryDimension[] = []

  for (const [index, slot] of item.slots.entries()) {
    if (slot.condition) continue

    const split = index === splitIndex
    const text = selection.text?.[slot.label] ?? ''
    const values = slot.choices?.length
      ? trimmedValues(selection.values?.[slot.label] ?? [])
      : trimmedValues(split ? text.split(/[、,，]/) : [text])
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
      if (item.defaultSymbolFromCode && option.code && item.slots.some(slot =>
        slot.label === '記号' && !slot.condition && !slot.choices?.length,
      ) && !summaryValues.has('記号')) {
        summaryValues.set('記号', option.code)
      }
      const summaryLabels = [...new Set([
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
        name: option.name,
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
