import { breakdownEntries, type BreakdownEntry } from '../core/breakdownMaster'
import {
  fixtureCode,
  quantityKind,
  quantityOutputKind,
  quantityUnit,
  summaryText,
  type BreakdownPosition,
  type CountFixture,
  type QuantityKind,
} from '../core/countFixtures'
import type { QuantityIndex } from '../core/quantityIndex'
import { readFixtureLink, fixtureLinkSectionText } from '../core/fixtureLink'
import type { XlsxCell, XlsxMerge, XlsxSheet, XlsxStyle } from '../core/xlsxWriter'

export interface BreakdownSheetOptions {
  fixtures: readonly CountFixture[]
  index: QuantityIndex
  pdfName: string
}

interface ItemGroup {
  position: BreakdownPosition
  fixtures: CountFixture[]
  minimumOrder: number
  masterOrder: number
  master?: BreakdownEntry
}

interface SheetGroup {
  position: BreakdownPosition
  items: Map<string, ItemGroup>
  minimumOrder: number
  masterOrder: number
}

interface MutableSheet extends XlsxSheet {
  cells: XlsxCell[][]
  merges: XlsxMerge[]
  includeCode: boolean
}

function groupKey(position: BreakdownPosition): string {
  return JSON.stringify([
    position.book, position.section, position.subject, position.middle ?? '',
  ])
}

function itemKey(position: BreakdownPosition): string {
  return JSON.stringify([
    position.book, position.section, position.subject, position.middle ?? '', position.item,
  ])
}

function cell(value: XlsxCell['value'], style: XlsxStyle): XlsxCell {
  return { value, style }
}

function formula(value: string): XlsxCell {
  return { value: null, style: 'borderedMoney', formula: value }
}

function joined(...values: (string | undefined)[]): string {
  return values.filter(value => value !== undefined && value !== '').join('、')
}

/** Shift the decimal exponent without first multiplying a binary float. */
function shiftDecimal(value: number, places: number): number {
  const [coefficient, exponent = '0'] = String(value).split('e')
  return Number(`${coefficient}e${Number(exponent) + places}`)
}

/** Quantities use decimal half-up rounding; the source index is never changed. */
export function roundBreakdownQuantity(
  value: number,
  kind: QuantityKind | 'mass',
  level: 'item' | 'detail',
): number {
  if (!Number.isFinite(value)) throw new RangeError('内訳書の数量は有限の数値で指定してください')
  const places = level === 'item' || kind === 'count' ? 0 : kind === 'length' ? 1 : 2
  const shifted = shiftDecimal(Math.abs(value), places)
  // Large finite quantities already have no fractional precision at this scale.
  if (!Number.isFinite(shifted)) return value
  const rounded = shiftDecimal(Math.round(shifted), -places)
  return rounded === 0 ? 0 : value < 0 ? -rounded : rounded
}

function createSheet(name: string, pdfName: string, includeCode = false): MutableSheet {
  const headers = ['名称', ...(includeCode ? ['略号'] : []), '摘要', '数量', '単位', '単価', '金額', '備考']
  return {
    name,
    includeCode,
    cells: [
      Array.from({ length: headers.length }, (_, column) =>
        cell(column === 0 ? `${pdfName.replace(/\.pdf$/i, '')} ${name}` : null, 'title')),
      [],
      headers.map(value => cell(value, 'header')),
    ],
    merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: headers.length - 1 }],
    columnWidths: [28, ...(includeCode ? [18] : []), 36, 10, 6, 12, 14, 20],
    freeze: { rows: 3, columns: 0 },
  }
}

function addHeading(sheet: MutableSheet, text: string): void {
  const row = sheet.cells.length
  const lastColumn = sheet.includeCode ? 7 : 6
  sheet.cells.push(Array.from({ length: lastColumn + 1 }, (_, column) =>
    cell(column === 0 ? text : null, 'category')))
  sheet.merges.push({ firstRow: row, firstColumn: 0, lastRow: row, lastColumn })
}

function addQuantityRow(
  sheet: MutableSheet,
  name: string,
  summary: string,
  quantity: number,
  unit: string,
  remark: string,
  quantityStyle: XlsxStyle,
  amountFormula?: string,
  code = '',
): void {
  const row = sheet.cells.length + 1
  const quantityColumn = sheet.includeCode ? 'D' : 'C'
  const priceColumn = sheet.includeCode ? 'F' : 'E'
  sheet.cells.push([
    cell(name, 'borderedText'),
    ...(sheet.includeCode ? [cell(code, 'borderedText')] : []),
    cell(summary, 'borderedText'),
    cell(quantity, quantityStyle),
    cell(unit, 'borderedText'),
    cell(null, 'borderedMoney'),
    formula(amountFormula ?? `IF(${priceColumn}${row}="","",${quantityColumn}${row}*${priceColumn}${row})`),
    cell(remark, 'borderedText'),
  ])
}

/** firstRow is one-based; only quantity rows precede this subtotal. */
function addTotal(sheet: MutableSheet, firstRow: number): number {
  const row = sheet.cells.length + 1
  const amountColumn = sheet.includeCode ? 'G' : 'F'
  sheet.cells.push([
    cell('計', 'borderedText'),
    ...(sheet.includeCode ? [cell('', 'borderedText')] : []),
    cell('', 'borderedText'),
    cell(null, 'borderedInteger'),
    cell('', 'borderedText'),
    cell(null, 'borderedMoney'),
    formula(`SUM(${amountColumn}${firstRow}:${amountColumn}${row - 1})`),
    cell('', 'borderedText'),
  ])
  return row
}

function conditionRank(fixture: CountFixture, condition: string): number {
  if (condition === '') return -1
  const index = fixture.conditions?.indexOf(condition) ?? -1
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function fixtureRows(
  fixture: CountFixture,
  index: QuantityIndex,
): Array<{ condition: string; quantity: number; raw: number }> {
  const conditions = index.byCondition(fixture.id)
  if (conditions.size > 1 || (conditions.size === 1 && !conditions.has(''))) {
    return [...conditions]
      // Unset first, then the item's own candidate order, then any other names.
      .sort(([a], [b]) => conditionRank(fixture, a) - conditionRank(fixture, b) || (a < b ? -1 : a > b ? 1 : 0))
      .map(([condition, total]) => ({ condition, quantity: total.total, raw: total.raw }))
  }
  return [{ condition: '', quantity: index.total(fixture.id), raw: index.rawTotal(fixture.id) }]
}

function convertSummary(fixture: CountFixture, raw: number): string {
  if (!fixture.convert) return ''
  const kind = quantityKind(fixture)
  const source = kind === 'length'
    ? `延長 ${roundBreakdownQuantity(raw, 'length', 'detail').toFixed(1)}m`
    : kind === 'count' ? `${raw}か所`
      : `${raw.toFixed(2)}${kind === 'area' ? 'm²' : 'm³'}`
  return joined(source, fixture.convert.basis)
}

function linkSummary(
  fixture: CountFixture,
  index: QuantityIndex,
  byId: ReadonlyMap<string, CountFixture>,
): string {
  const link = readFixtureLink(fixture)
  if (!link) return ''
  const basis = new Map(index.linkResult(fixture.id)?.sources.map(source => [source.itemId, source]) ?? [])
  const sources = link.sources.map(source => {
    const original = byId.get(source.itemId)
    const code = original?.code || original?.name || source.itemId
    const operation = source.perM !== undefined
      ? `÷${source.perM}m` : `×${source.factor ?? 1}`
    if (link.kind !== 'mass') {
      const calculatedSource = basis.get(source.itemId)
      return `${code}${operation}`
        + (calculatedSource !== undefined ? fixtureLinkSectionText(calculatedSource) : '')
    }
    const prefix = source.perM !== undefined || (source.factor ?? 1) !== 1 ? operation : ''
    return `${code}${prefix}×${basis.get(source.itemId)?.unitMassKg ?? 0}kg÷1000`
      + (link.densityTPerM3 !== undefined ? `÷${link.densityTPerM3}t/㎥` : '')
  })
  const characters = Array.from(`連動: ${sources.join('、')}`)
  return characters.length <= 60 ? characters.join('') : `${characters.slice(0, 59).join('')}…`
}

/** No located, nonzero fixtures means no additional workbook sheets. */
export function breakdownSheets(options: BreakdownSheetOptions): XlsxSheet[] {
  const { fixtures, index, pdfName } = options
  const active = fixtures.filter(fixture => fixture.breakdown !== undefined && index.total(fixture.id) !== 0)
  if (!active.length) return []
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]))

  const masterGroups = new Map<string, number>()
  const masterItems = new Map<string, { order: number; entry: BreakdownEntry }>()
  breakdownEntries().forEach((entry, order) => {
    const position: BreakdownPosition = {
      book: entry.book,
      section: entry.section,
      subject: entry.subject,
      middle: entry.middle,
      item: entry.row.name,
    }
    const group = groupKey(position), item = itemKey(position)
    if (!masterGroups.has(group)) masterGroups.set(group, order)
    if (!masterItems.has(item)) masterItems.set(item, { order, entry })
  })

  // Fallback classification considers every fixture at a position, including
  // unused fixtures. Only active fixtures are projected into the workbook.
  const fallbackSeparate = new Set<string>()
  for (const fixture of fixtures) {
    const position = fixture.breakdown
    if (position && fixture.name !== position.item) fallbackSeparate.add(itemKey(position))
  }

  const groups = new Map<string, SheetGroup>()
  for (const fixture of active) {
    const position = fixture.breakdown!
    const groupId = groupKey(position), itemId = itemKey(position)
    let group = groups.get(groupId)
    if (!group) {
      group = {
        position,
        items: new Map(),
        minimumOrder: fixture.order,
        masterOrder: masterGroups.get(groupId) ?? Infinity,
      }
      groups.set(groupId, group)
    }
    group.minimumOrder = Math.min(group.minimumOrder, fixture.order)
    let item = group.items.get(itemId)
    if (!item) {
      const master = masterItems.get(itemId)
      item = {
        position,
        fixtures: [],
        minimumOrder: fixture.order,
        masterOrder: master?.order ?? Infinity,
        master: master?.entry,
      }
      group.items.set(itemId, item)
    }
    item.minimumOrder = Math.min(item.minimumOrder, fixture.order)
    item.fixtures.push(fixture)
  }

  const orderedGroups = [...groups.values()].sort((a, b) =>
    a.masterOrder - b.masterOrder || a.minimumOrder - b.minimumOrder)
  const itemsSheet = createSheet('細目別内訳', pdfName, true)
  const detailsSheet = createSheet('別紙明細', pdfName)
  let previous: BreakdownPosition | undefined
  let detailNumber = 0

  for (const group of orderedGroups) {
    const position = group.position
    const bookChanged = previous === undefined || previous.book !== position.book
    const sectionChanged = bookChanged || previous?.section !== position.section
    const subjectChanged = sectionChanged || previous?.subject !== position.subject
    const middleChanged = subjectChanged || previous?.middle !== position.middle
    if (bookChanged) addHeading(itemsSheet, position.book)
    if (sectionChanged) addHeading(itemsSheet, position.section)
    if (subjectChanged) addHeading(itemsSheet, `　${position.subject}`)
    if (middleChanged && position.middle) addHeading(itemsSheet, `　　${position.middle}`)

    const firstGroupRow = itemsSheet.cells.length + 1
    const orderedItems = [...group.items.values()].sort((a, b) =>
      a.masterOrder - b.masterOrder || a.minimumOrder - b.minimumOrder)

    for (const item of orderedItems) {
      const orderedFixtures = [...item.fixtures].sort((a, b) => a.order - b.order)
      const separate = item.master
        ? item.master.row.separate === true
        : fallbackSeparate.has(itemKey(item.position))
      const renovation = item.master?.row.renovation ? '※' : ''

      if (separate) {
        const number = ++detailNumber
        const detailPosition = item.position
        const location = [
          detailPosition.subject, detailPosition.middle, detailPosition.item,
        ].filter(value => value !== undefined && value !== '').join('／')
        addHeading(detailsSheet, `別紙明細-${number}　${location}`)
        const firstDetailRow = detailsSheet.cells.length + 1

        for (const fixture of orderedFixtures) {
          const kind = quantityOutputKind(fixture)
          const code = fixtureCode({
            code: fixture.code === fixture.name ? '' : fixture.code,
            spec: fixture.spec,
          })
          for (const row of fixtureRows(fixture, index)) {
            addQuantityRow(
              detailsSheet,
              fixture.name,
              joined(code, summaryText(fixture), row.condition, convertSummary(fixture, row.raw),
                fixture.link !== undefined ? linkSummary(fixture, index, fixtureById) : ''),
              roundBreakdownQuantity(row.quantity, kind, 'detail'),
              quantityUnit(fixture),
              fixture.remark ?? '',
              kind === 'count' ? 'borderedInteger' : 'borderedDecimal',
            )
          }
        }
        const totalRow = addTotal(detailsSheet, firstDetailRow)
        addQuantityRow(
          itemsSheet,
          item.position.item,
          '',
          1,
          '式',
          joined(`別紙明細-${number}`, renovation),
          'borderedInteger',
          `'別紙明細'!F${totalRow}`,
          [...new Set(orderedFixtures.map(fixture => fixture.code).filter(Boolean))].join('、'),
        )
      } else {
        for (const fixture of orderedFixtures) {
          for (const row of fixtureRows(fixture, index)) {
            addQuantityRow(
              itemsSheet,
              item.position.item,
              joined(summaryText(fixture), fixture.spec, row.condition),
              roundBreakdownQuantity(row.quantity, quantityOutputKind(fixture), fixture.convert ? 'detail' : 'item'),
              quantityUnit(fixture),
              joined(fixture.remark, renovation),
              fixture.convert && quantityOutputKind(fixture) !== 'count' ? 'borderedDecimal' : 'borderedInteger',
              undefined,
              fixture.code,
            )
          }
        }
      }
    }

    addTotal(itemsSheet, firstGroupRow)
    previous = position
  }

  return detailNumber ? [itemsSheet, detailsSheet] : [itemsSheet]
}
