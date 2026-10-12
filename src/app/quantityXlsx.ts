import { quantityDecimals, quantityUnit, type CountFixture } from '../core/countFixtures'
import { fixtureLinkRoundsUp, readFixtureLink, fixtureLinkSourceUnit, fixtureLinkSourceShowsFactor, fixtureLinkSourceUsesOutputUnit, type FixtureLink, type LinkBasisSource } from '../core/fixtureLink'
import type { DrawingInfo } from '../core/drawingInfo'
import type { QuantityIndex } from '../core/quantityIndex'
import { writeXlsx, type XlsxCell, type XlsxImage, type XlsxMerge, type XlsxSheet, type XlsxStyle } from '../core/xlsxWriter'
import {
  projectQuantityTable,
  QUANTITY_TABLE_FIXED_HEADERS,
  QUANTITY_TABLE_METADATA_HEADERS,
  quantityTableFixtureText,
  type QuantityTableDisplay,
  type QuantityTableFilters,
  type QuantityTableMode,
} from './QuantityTable'
import { QUANTITY_DETAIL_HEADER, quantityDetailRows } from './annotationCsv'
import { breakdownSheets } from './breakdownXlsx'
import { CHECK_BASICS } from '../core/breakdown/checkSheets'
import {
  computeQuantityChecks,
  parseQuantityCheckBasics,
  QUANTITY_CHECK_VERDICT_TEXT,
  type QuantityCheckBasics,
} from '../core/quantityChecks'

export interface QuantityWorkbookOptions {
  data: Parameters<typeof projectQuantityTable>[0]
  mode: QuantityTableMode
  filters: QuantityTableFilters
  display: QuantityTableDisplay
  drawingInfo: (page: number) => DrawingInfo | null
  pdfName: string
  index: QuantityIndex
  fixtures: readonly CountFixture[]
  quantityChecks?: QuantityCheckBasics
}

const KIND_LABELS = { count: '個数', length: '長さ', area: '面積', volume: '体積' } as const
const MODE_LABELS = { page: '図面別', floor: '階別', room: '階・部屋別' } as const
const FIXED_COLUMN_COUNT = QUANTITY_TABLE_FIXED_HEADERS.length
const TABLE_HEADERS = [...QUANTITY_TABLE_FIXED_HEADERS, ...QUANTITY_TABLE_METADATA_HEADERS]
const BASE_COLUMN_COUNT = TABLE_HEADERS.length

function cell(value: XlsxCell['value'], style: XlsxStyle = 'text'): XlsxCell {
  return { value, style }
}

function decodePng(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function linkCalculation(
  source: LinkBasisSource,
  link: FixtureLink | undefined,
  densityTPerM3?: number,
  showFactor = true,
): string {
  if (link?.kind === 'carry') {
    return `× 質量 ${source.unitMassKg ?? '未設定'}kg × 補正率 ${source.factor ?? '適用なし'} ÷ 1000`
  }
  const operation = source.perM !== undefined
    ? `÷ ${source.perM} m`
    : `× ${source.factor ?? 1}`
  if (link?.kind !== 'mass') return source.perM !== undefined || showFactor ? operation : ''
  const prefix = source.perM !== undefined || (source.factor ?? 1) !== 1
    ? `${operation} ` : ''
  return `${prefix}× ${source.unitMassKg ?? 0} kg ÷ 1000`
    + (densityTPerM3 !== undefined ? ` ÷ ${densityTPerM3} t/㎥` : '')
}

function linkDensityNote(fixture: CountFixture, densityTPerM3: number | undefined): string | undefined {
  if (fixture.link?.kind !== 'mass' || densityTPerM3 === undefined) return undefined
  const wasteType = fixture.link.densityTPerM3 === undefined ? fixture.attributes?.wasteType : undefined
  return `質量の合計 ÷ ${densityTPerM3} t/㎥${wasteType ? `（${wasteType}）` : ''}`
}

function linkBasisSheets(
  fixtures: readonly CountFixture[],
  index: QuantityIndex,
  pdfName: string,
): XlsxSheet[] {
  const linked = fixtures.filter(fixture => fixture.link !== undefined)
  if (!linked.length) return []
  const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]))
  const headers = ['連動項目', '種類', '元の略号', '元の名称', '元の数量', '元の単位', '計算', '小計', '備考']
  const cells: XlsxCell[][] = [
    [cell(`${pdfName.replace(/\.pdf$/i, '')} 連動の計算根拠`, 'title')],
    [],
    headers.map(value => cell(value, 'header')),
  ]
  const rowHeights: Record<number, number> = { 0: 24, 1: 10, 2: 30 }
  const textRow = () => Array.from({ length: headers.length }, () => cell('', 'borderedText'))
  for (const fixture of linked) {
    const result = index.linkResult(fixture.id)
    const link = readFixtureLink(fixture)
    rowHeights[cells.length] = 20
    cells.push(headers.map((_, column) => cell(
      column === 0 ? `${fixture.code} ${fixture.name}（${quantityUnit(fixture)}）`
        : column === 1 ? fixture.link?.kind === 'carry' ? '機器搬入・搬出'
          : fixture.link?.kind === 'mass' ? '質量の換算'
            : fixture.link?.kind === 'rc' ? 'RC 部材'
              : fixture.link?.kind === 'shape' ? '形'
                : fixture.link?.kind === 'crossing' ? '交差'
                  : fixture.link?.kind === 'steel' ? '鉄骨の部材' : '係数'
          : null,
      'category',
    )))
    if (!result) continue
    const numericStyle: XlsxStyle = quantityDecimals(fixture) === 0 ? 'borderedInteger' : 'borderedDecimal'
    for (const source of result.sources) {
      const original = byId.get(source.itemId)
      const conditions = source.auto && link?.auto?.condition !== undefined
        ? [link.auto.condition]
        : link?.sources.find(value => value.itemId === source.itemId)?.conditions
      const notes: string[] = []
      if (source.auto) notes.push('（自動）')
      if (conditions?.length) {
        notes.push(`施工条件: ${conditions.map(condition => condition || '未設定').join('・')}`)
      }
      if (source.note) notes.push(`（${source.note}）`)
      if (link?.kind === 'carry') {
        const carryClass = source.note === '重量品' || source.note === '容積品'
          ? source.note
          : source.factor !== undefined
            ? link.carry?.class === 'bulky' ? '容積品' : '重量品'
            : '区分未判定'
        notes.push(`区分: ${carryClass}、補正率 ${source.factor ?? '適用なし'}${link.carry?.alone ? '（単独搬入・30％増し）' : ''}`)
      }
      const densityNote = linkDensityNote(fixture, result.densityTPerM3)
      if (densityNote) notes.push(densityNote)
      const row = textRow()
      row[2] = cell(original?.code ?? source.itemId, 'borderedText')
      row[3] = cell(original?.name ?? '', 'borderedText')
      const sourceFixture = fixtureLinkSourceUsesOutputUnit(fixture) ? fixture : original
      row[4] = cell(source.quantity, sourceFixture && quantityDecimals(sourceFixture) === 0 ? 'borderedInteger' : 'borderedDecimal')
      row[5] = cell(fixtureLinkSourceUnit(fixture, original), 'borderedText')
      row[6] = cell(linkCalculation(
        source, link, result.densityTPerM3, fixtureLinkSourceShowsFactor(fixture, source),
      ), 'borderedText')
      row[7] = cell(source.subtotal, numericStyle)
      row[8] = cell(notes.join('、'), 'borderedText')
      cells.push(row)
    }
    const total = textRow()
    total[0] = cell('合計', 'borderedText')
    total[7] = cell(result.computed, numericStyle)
    const totalNotes: string[] = []
    if (link && fixtureLinkRoundsUp(fixture)) {
      const rounding = link.rounding ?? 'total'
      if (rounding === 'total') totalNotes.push('合計で切り上げ')
      else if (rounding === 'each') totalNotes.push('拾いごとに切り上げ')
    }
    const densityNote = linkDensityNote(fixture, result.densityTPerM3)
    if (densityNote) totalNotes.push(densityNote)
    total[8] = cell(totalNotes.join('、'), 'borderedText')
    cells.push(total)
    if (result.overridden) {
      const difference = result.total - result.computed
      const override = textRow()
      override[0] = cell('上書き', 'borderedText')
      override[7] = cell(result.total, numericStyle)
      override[8] = cell(
        `計算値 ${result.computed}、差 ${difference > 0 ? '+' : ''}${difference}`
          + (link?.override?.note ? `、${link.override.note}` : ''),
        'borderedText',
      )
      cells.push(override)
    }
    for (const message of [...(result.error ? [result.error] : []), ...result.warnings]) {
      const row = textRow()
      row[8] = cell(message, 'borderedText')
      cells.push(row)
    }
  }
  return [{
    name: '計算根拠',
    cells,
    merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 8 }],
    columnWidths: [28, 16, 12, 28, 14, 10, 36, 14, 48],
    rowHeights,
    freeze: { rows: 3, columns: 0 },
  }]
}

function quantityCheckSheets(options: QuantityWorkbookOptions): XlsxSheet[] {
  const { fixtures, index, pdfName } = options
  if (!fixtures.some(fixture => fixture.breakdown?.book === '建築')) return []
  const basics = parseQuantityCheckBasics(options.quantityChecks ?? { values: {} })
  const results = computeQuantityChecks(fixtures, id => index.total(id), basics)
  const cells: XlsxCell[][] = [
    [cell(`${pdfName.replace(/\.pdf$/i, '')} チェックシート`, 'title')],
    [],
    [cell('基本の値', 'category')],
    ['名前', '値', '単位'].map(value => cell(value, 'header')),
    ...CHECK_BASICS.map(basis => [
      cell(basis.label, 'borderedText'),
      cell(basics.values[basis.key] ?? null, 'borderedDecimal'),
      cell(basis.unit, 'borderedText'),
    ]),
    [],
  ]
  const headerRow = cells.length
  cells.push([
    'シート', '名称', '内訳数量', '単位', '演算子',
    'チェック項目', '下限', '上限', '判定', '確認事項',
  ].map(value => cell(value, 'header')))
  for (const result of results) {
    cells.push([
      cell(result.row.sheet, 'borderedText'),
      cell(result.group.label, 'borderedText'),
      cell(result.quantity ?? null, 'borderedDecimal'),
      cell(result.group.unit, 'borderedText'),
      cell(result.row.operator, 'borderedText'),
      cell(result.row.basisText, 'borderedText'),
      cell(result.expected?.min ?? null, 'borderedDecimal'),
      cell(result.expected?.max ?? null, 'borderedDecimal'),
      cell(QUANTITY_CHECK_VERDICT_TEXT[result.verdict], 'borderedText'),
      cell(result.row.note ?? '', 'borderedText'),
    ])
  }
  return [{
    name: 'チェックシート',
    cells,
    merges: [
      { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 9 },
      { firstRow: 2, firstColumn: 0, lastRow: 2, lastColumn: 2 },
    ],
    columnWidths: [14, 38, 14, 8, 10, 58, 14, 14, 18, 66],
    rowHeights: { 0: 24, 1: 10, 2: 22, 3: 26, [headerRow]: 30 },
    freeze: { rows: headerRow + 1, columns: 2 },
  }]
}

/** Pure sheet definitions, also available for focused projection tests. */
export function quantityWorkbookSheets(options: QuantityWorkbookOptions): XlsxSheet[] {
  const { data, mode, filters, display, drawingInfo, pdfName, index, fixtures } = options
  const table = projectQuantityTable(data, mode, filters, drawingInfo, display, Infinity)
  const columnCount = BASE_COLUMN_COUNT + table.columns.length
  if (columnCount > 16384) throw new RangeError(`集計表の基本${BASE_COLUMN_COUNT}列を含めてExcelの列数の上限16384列を超えています`)
  const lastColumn = columnCount - 1
  const labels: string[] = [MODE_LABELS[mode]]
  if (display.groupByBreakdown && display.breakdownOrder !== undefined) labels.push('内訳書の位置でまとめる')
  if (display.allConditions || table.rows.some(row => row.conditionKey !== undefined)) labels.push('施工条件別')
  if (filters.category) labels.push(`分類：${filters.category}`)
  if (filters.kind) labels.push(`種別：${KIND_LABELS[filters.kind]}`)
  const search = (filters.search ?? '').trim()
  if (search) labels.push(`検索：${search}`)
  if (filters.unsetOnly) labels.push('未設定だけ')
  const cells: XlsxCell[][] = [
    [cell(`${pdfName.replace(/\.pdf$/i, '')} 数量集計表`, 'title')],
    [cell(`${labels.join('・')}（明細のシートは絞り込みなし）`)],
    [],
    TABLE_HEADERS.map(value => cell(value, 'header'))
      .concat(table.columns.map(column => cell(column.heading, 'header'))),
    Array.from({ length: BASE_COLUMN_COUNT }, () => cell(null, 'header'))
      .concat(table.columns.map(column => cell(column.subheading, 'header'))),
  ]
  const merges: XlsxMerge[] = [
    { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn },
    { firstRow: 1, firstColumn: 0, lastRow: 1, lastColumn },
    ...Array.from({ length: BASE_COLUMN_COUNT }, (_, column) => ({
      firstRow: 3, firstColumn: column, lastRow: 4, lastColumn: column,
    })),
  ]
  const rowHeights: Record<number, number> = { 0: 24, 1: 24, 2: 10, 3: 26, 4: 24 }
  const images: XlsxImage[] = []
  for (const row of table.rows) {
    const rowIndex = cells.length
    if (!row.item) {
      const heading = `${'　'.repeat(Math.max(0, (row.level ?? 0) - 1))}${row.category}`
      cells.push(Array.from({ length: columnCount }, (_, column) => cell(column === 0 ? heading : null, 'category')))
      merges.push({ firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex, lastColumn: FIXED_COLUMN_COUNT - 1 })
      rowHeights[rowIndex] = 20
      continue
    }
    const item = row.item, fixture = item.fixture
    const texts = quantityTableFixtureText(fixture)
    const isCondition = row.conditionKey !== undefined
    const aggregate = isCondition ? item.byCondition.get(row.conditionKey!)! : item
    const linkResult = fixture.link !== undefined ? index.linkResult(fixture.id) : undefined
    const linkedName = fixture.name + (fixture.link !== undefined
      ? linkResult?.overridden ? '［上書き］' : '［連動］' : '')
    const numericStyle: XlsxStyle = quantityDecimals(fixture) === 0 ? 'borderedInteger' : 'borderedDecimal'
    const numeric = (value: number, retainZero = false) => cell(value === 0 && !retainZero ? null : value, numericStyle)
    cells.push([
      cell(null, 'borderedText'),
      cell(isCondition ? '' : fixture.code, 'borderedText'),
      cell(isCondition ? `└ ${row.conditionKey || '未設定'}` : linkedName, 'borderedText'),
      cell(isCondition ? '' : fixture.spec ?? '', 'borderedText'),
      cell(quantityUnit(fixture), 'borderedText'),
      numeric(aggregate.total, !isCondition && !!linkResult?.overridden),
      cell(isCondition ? '' : texts.summary, 'borderedText'),
      ...table.columns.map(column => numeric(aggregate.values[mode].get(column.key) ?? 0)),
    ])
    // 24pt = 32px; a 24px image with a 2px inset fits without clipping.
    rowHeights[rowIndex] = 24
    if (!isCondition && fixture.sample) {
      const { width, height, png } = fixture.sample
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`${fixture.name}の見本のサイズが不正です`)
      }
      const scale = Math.min(24 / width, 24 / height)
      images.push({
        png: decodePng(png), row: rowIndex, column: 0,
        width: width * scale, height: height * scale,
      })
    }
  }
  if (!table.rows.length) {
    const rowIndex = cells.length
    cells.push(Array.from({ length: columnCount }, (_, column) => cell(column === 0 ? '該当する項目はありません' : null, 'borderedText')))
    merges.push({ firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex, lastColumn })
    rowHeights[rowIndex] = 24
  }
  const detail = quantityDetailRows(index, fixtures, drawingInfo)
  const detailDecimals = new Map(fixtures.map(f => [
    JSON.stringify([f.category, f.code, f.name, f.spec ?? '', quantityUnit(f)]),
    quantityDecimals(f),
  ]))
  const detailCells: XlsxCell[][] = [
    QUANTITY_DETAIL_HEADER.map(value => cell(value, 'header')),
    ...detail.map(row => row.map((value, column) => cell(value,
      column === 12 - 1 || column === 15 ? 'integer'
        : column === 14 ? detailDecimals.get(JSON.stringify([row[0], row[1], row[2], row[3], row[7]])) === 0 ? 'integer' : 'decimal'
          : 'text'))),
  ]
  return [
    {
      name: '集計表', cells, merges, images, rowHeights,
      columnWidths: [6, 12, 28, 12, 6, 12, 24, ...table.columns.map(() => 14)],
      freeze: { rows: 5, columns: FIXED_COLUMN_COUNT },
    },
    {
      name: '明細', cells: detailCells,
      columnWidths: [14, 14, 28, 20, 20, 20, 8, 8, 12, 12, 18, 12, 16, 28, 14, 14],
      rowHeights: { 0: 30 },
      freeze: { rows: 1, columns: 0 },
    },
    ...breakdownSheets({ fixtures, index, pdfName }),
    ...linkBasisSheets(fixtures, index, pdfName),
    ...quantityCheckSheets(options),
  ]
}

export function createQuantityWorkbook(options: QuantityWorkbookOptions): Uint8Array {
  return writeXlsx(quantityWorkbookSheets(options))
}
