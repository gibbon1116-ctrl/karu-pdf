import { quantityKind, QUANTITY_UNITS, type CountFixture } from '../core/countFixtures'
import type { DrawingInfo } from '../core/drawingInfo'
import type { QuantityIndex } from '../core/quantityIndex'
import { writeXlsx, type XlsxCell, type XlsxImage, type XlsxMerge, type XlsxSheet, type XlsxStyle } from '../core/xlsxWriter'
import {
  projectQuantityTable,
  type QuantityTableDisplay,
  type QuantityTableFilters,
  type QuantityTableMode,
} from './QuantityTable'
import { QUANTITY_DETAIL_HEADER, quantityDetailRows } from './annotationCsv'

export interface QuantityWorkbookOptions {
  data: Parameters<typeof projectQuantityTable>[0]
  mode: QuantityTableMode
  filters: QuantityTableFilters
  display: QuantityTableDisplay
  drawingInfo: (page: number) => DrawingInfo | null
  pdfName: string
  index: QuantityIndex
  fixtures: readonly CountFixture[]
}

const KIND_LABELS = { count: '個数', length: '長さ', area: '面積', volume: '体積' } as const
const MODE_LABELS = { page: '図面別', floor: '階別', room: '階・部屋別' } as const

function cell(value: XlsxCell['value'], style: XlsxStyle = 'text'): XlsxCell {
  return { value, style }
}

function decodePng(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Pure sheet definitions, also available for focused projection tests. */
export function quantityWorkbookSheets(options: QuantityWorkbookOptions): XlsxSheet[] {
  const { data, mode, filters, display, drawingInfo, pdfName, index, fixtures } = options
  const table = projectQuantityTable(data, mode, filters, drawingInfo, display, Infinity)
  const columnCount = 6 + table.columns.length
  if (columnCount > 16384) throw new RangeError('固定の6列を含めてExcelの列数の上限16384列を超えています')
  const lastColumn = columnCount - 1
  const labels: string[] = [MODE_LABELS[mode]]
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
    ['見本', '略号', '名称', '規格', '単位', '全図面'].map(value => cell(value, 'header'))
      .concat(table.columns.map(column => cell(column.heading, 'header'))),
    Array.from({ length: 6 }, () => cell(null, 'header'))
      .concat(table.columns.map(column => cell(column.subheading, 'header'))),
  ]
  const merges: XlsxMerge[] = [
    { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn },
    { firstRow: 1, firstColumn: 0, lastRow: 1, lastColumn },
    ...Array.from({ length: 6 }, (_, column) => ({
      firstRow: 3, firstColumn: column, lastRow: 4, lastColumn: column,
    })),
  ]
  const rowHeights: Record<number, number> = { 0: 24, 1: 24, 2: 10, 3: 26, 4: 24 }
  const images: XlsxImage[] = []
  for (const row of table.rows) {
    const rowIndex = cells.length
    if (!row.item) {
      cells.push(Array.from({ length: columnCount }, (_, column) => cell(column === 0 ? row.category : null, 'category')))
      merges.push({ firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex, lastColumn })
      rowHeights[rowIndex] = 20
      continue
    }
    const item = row.item, fixture = item.fixture
    const isCondition = row.conditionKey !== undefined
    const aggregate = isCondition ? item.byCondition.get(row.conditionKey!)! : item
    const numericStyle: XlsxStyle = quantityKind(fixture) === 'count' ? 'borderedInteger' : 'borderedDecimal'
    const numeric = (value: number) => cell(value === 0 ? null : value, numericStyle)
    cells.push([
      cell(null, 'borderedText'),
      cell(isCondition ? '' : fixture.code, 'borderedText'),
      cell(isCondition ? `└ ${row.conditionKey || '未設定'}` : fixture.name, 'borderedText'),
      cell(isCondition ? '' : fixture.spec ?? '', 'borderedText'),
      cell(QUANTITY_UNITS[quantityKind(fixture)], 'borderedText'),
      numeric(aggregate.total),
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
  const detailCells: XlsxCell[][] = [
    QUANTITY_DETAIL_HEADER.map(value => cell(value, 'header')),
    ...detail.map(row => row.map((value, column) => cell(value,
      column === 12 - 1 || column === 15 ? 'integer'
        : column === 14 ? row[6] === '個数' ? 'integer' : 'decimal'
          : 'text'))),
  ]
  return [
    {
      name: '集計表', cells, merges, images, rowHeights,
      columnWidths: [6, 12, 28, 12, 6, 12, ...table.columns.map(() => 14)],
      freeze: { rows: 5, columns: 6 },
    },
    {
      name: '明細', cells: detailCells,
      columnWidths: [14, 14, 28, 20, 20, 20, 8, 8, 12, 12, 18, 12, 16, 28, 14, 14],
      rowHeights: { 0: 30 },
      freeze: { rows: 1, columns: 0 },
    },
  ]
}

export function createQuantityWorkbook(options: QuantityWorkbookOptions): Uint8Array {
  return writeXlsx(quantityWorkbookSheets(options))
}
