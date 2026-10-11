import { expect, it } from 'vitest'
import { nextCountStyle, quantityKind, QUANTITY_UNITS, type CountFixture, type QuantityKind } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import { columnName } from '../src/core/xlsxWriter'
import { buildQuantityTableData, projectQuantityTable, type QuantityTableMode } from '../src/app/QuantityTable'
import { createQuantityCsv, QUANTITY_DETAIL_HEADER, quantityDetailRows } from '../src/app/annotationCsv'
import { createQuantityWorkbook, quantityWorkbookSheets, type QuantityWorkbookOptions } from '../src/app/quantityXlsx'

const fixture = (id: string, order = 0, category = '電気', kind: QuantityKind = 'count'): CountFixture => ({
  id, code: id.toUpperCase(), name: `${id}の名称`, order, category, kind, style: nextCountStyle([]),
})
const count = (id: string, pageIndex: number, fixtureId = 'led', floor?: string, room?: string, condition?: string) => ({
  id, pageIndex, count: { version: 2 as const, id, fixtureId, floor, room, condition },
})
const info = (p: number) => p === 1 ? { number: 'E-101', name: '1階電灯設備平面図' } : null
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const sampleFixtures: CountFixture[] = [
  { ...fixture('led', 2), conditions: ['新設', '既設'], sample: { png: PNG_BASE64, width: 1, height: 1, pageIndex: 0 } },
  { ...fixture('cv', 0, '電気', 'length'), spec: '3C-5.5sq' },
  fixture('other', 1, '機械'),
]
const annotations = [
  count('a', 2, 'led', '2階', undefined, '新設'),
  count('b', 0, 'led', '1階', undefined, '既設'),
  count('c', 0, 'led', '1階'),
  count('d', 1, 'led', '1階', '事務室', '新設'),
  count('e', 1, 'other', '1階', '事務室'),
  {
    id: 'route', pageIndex: 1,
    vertices: [[0, 0], [12.34567, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
    quantity: { version: 1 as const, id: 'route', itemId: 'cv', method: 'polyline' as const, floor: '1階', room: '事務室' },
  },
]
const sampleIndex = QuantityIndex.build(annotations, sampleFixtures)
const sampleData = buildQuantityTableData(sampleIndex, sampleFixtures)

function options(overrides: Partial<QuantityWorkbookOptions> = {}): QuantityWorkbookOptions {
  return {
    data: sampleData, mode: 'page', filters: {}, display: { allConditions: true },
    drawingInfo: info, pdfName: '設備図.PDF', index: sampleIndex, fixtures: sampleFixtures,
    ...overrides,
  }
}

const decoder = new TextDecoder()

/** Minimal local-header reader; complete ZIP and CRC validation is in xlsxWriter.test.ts. */
function packageFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true)
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const start = offset + 30 + nameLength + extraLength
    files.set(name, bytes.slice(start, start + size))
    offset = start + size
  }
  return files
}

function unescapeXml(value: string): string {
  return value.replace(/&#13;/g, '\r').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

function workbookCells(files: Map<string, Uint8Array>, sheetNumber: number): Map<string, string | number | null> {
  const sharedXml = decoder.decode(files.get('xl/sharedStrings.xml')!)
  const strings = [...sharedXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => unescapeXml(match[1]))
  const sheet = decoder.decode(files.get(`xl/worksheets/sheet${sheetNumber}.xml`)!)
  const cells = new Map<string, string | number | null>()
  for (const match of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const reference = match[1].match(/\br="([^"]+)"/)![1]
    const value = match[2]?.match(/<v>([^<]*)<\/v>/)?.[1]
    cells.set(reference, value === undefined ? null
      : /\bt="s"/.test(match[1]) ? strings[Number(value)] : Number(value))
  }
  return cells
}

function parseCsv(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += character
    } else if (character === '"' && field === '') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += character
  }
  if (row.length || field) { row.push(field); rows.push(row) }
  expect(quoted).toBe(false)
  return rows
}

it('exports the two header rows and all projected rows in the same order and with unrounded values', () => {
  for (const mode of ['page', 'floor', 'room'] as const) {
    const input = options({ mode })
    const projected = projectQuantityTable(input.data, mode, input.filters, info, input.display, Infinity)
    const sheet = quantityWorkbookSheets(input)[0]
    const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 1)
    expect(sheet.name).toBe('集計表')
    expect(actual.get('A1')).toBe('設備図 数量集計表')
    expect(sheet.cells[3].map(cell => cell.value)).toEqual([
      '見本', '略号', '名称', '規格', '単位', '全図面', ...projected.columns.map(column => column.heading),
    ])
    expect(sheet.cells[4].map(cell => cell.value)).toEqual([
      null, null, null, null, null, null, ...projected.columns.map(column => column.subheading),
    ])
    expect(sheet.cells).toHaveLength(projected.rows.length + 5)
    projected.rows.forEach((row, offset) => {
      const rowIndex = offset + 5, excelRow = rowIndex + 1
      if (!row.item) {
        expect(actual.get(`A${excelRow}`)).toBe(row.category)
        expect(sheet.cells[rowIndex].every(cell => cell.style === 'category')).toBe(true)
        expect(sheet.merges).toContainEqual({
          firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex,
          lastColumn: projected.columns.length + 5,
        })
        return
      }
      const item = row.item, f = item.fixture
      const isCondition = row.conditionKey !== undefined
      const aggregate = isCondition ? item.byCondition.get(row.conditionKey!)! : item
      const numeric = (value: number) => value === 0 ? null : value
      const expected = [
        null, isCondition ? '' : f.code,
        isCondition ? `└ ${row.conditionKey || '未設定'}` : f.name,
        isCondition ? '' : f.spec ?? '',
        QUANTITY_UNITS[quantityKind(f)], numeric(aggregate.total),
        ...projected.columns.map(column => numeric(aggregate.values[mode].get(column.key) ?? 0)),
      ]
      expect(sheet.cells[rowIndex].map(cell => cell.value)).toEqual(expected)
      expected.forEach((value, column) => expect(actual.get(`${columnName(column)}${excelRow}`)).toBe(value))
      expect(sheet.cells[rowIndex][5].style).toBe(quantityKind(f) === 'count' ? 'borderedInteger' : 'borderedDecimal')
    })
    expect(sheet.freeze).toEqual({ rows: 5, columns: 6 })
    expect(sheet.columnWidths).toEqual([6, 12, 28, 12, 6, 12, ...projected.columns.map(() => 14)])
    expect(sheet.merges).toContainEqual({ firstRow: 3, firstColumn: 0, lastRow: 4, lastColumn: 0 })
    expect(sheet.merges).toContainEqual({ firstRow: 3, firstColumn: 5, lastRow: 4, lastColumn: 5 })
    const cv = projected.rows.findIndex(row => row.item?.fixture.id === 'cv')
    expect(sheet.cells[cv + 5][1].value).toBe('CV')
    expect(sheet.cells[cv + 5][3].value).toBe('3C-5.5sq')
    expect(sheet.cells[cv + 5][5].value).toBeCloseTo(12.34567, 10)
    expect(sheet.cells.flat().some(cell => typeof cell.value === 'string' && cell.value.startsWith('平面 '))).toBe(false)
  }
})

it('exports more than 80 columns in every mode while keeping the screen projection at 80', () => {
  const fixtures = [fixture('led')]
  const index = QuantityIndex.build(Array.from({ length: 100 }, (_, i) =>
    count(String(i), i, 'led', `${i + 1}階`, `部屋${i}`)), fixtures)
  const data = buildQuantityTableData(index, fixtures)
  for (const mode of ['page', 'floor', 'room'] as const) {
    const screen = projectQuantityTable(data, mode, {}, info)
    expect(screen.columns).toHaveLength(80)
    expect(screen.omittedColumns).toBe(20)
    const input = options({ data, mode, index, fixtures, display: {} })
    const sheet = quantityWorkbookSheets(input)[0]
    expect(sheet.cells[3]).toHaveLength(106)
    expect(sheet.columnWidths).toHaveLength(106)
    expect(sheet.cells[6]).toHaveLength(106)
    expect(sheet.cells[6][105].value).toBe(1)
    const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 1)
    expect(actual.get(`${columnName(105)}7`)).toBe(1)
  }
})

it('applies category/search/kind/unset filters only to the first sheet and describes active conditions', () => {
  const input = options({
    mode: 'room',
    filters: { category: '電気', search: ' LeD ', kind: 'count', unsetOnly: true },
    display: { allConditions: false, expanded: { led: true } },
  })
  const sheets = quantityWorkbookSheets(input)
  expect(sheets[0].cells[1][0].value).toBe(
    '階・部屋別・施工条件別・分類：電気・種別：個数・検索：LeD・未設定だけ（明細のシートは絞り込みなし）',
  )
  expect(sheets[0].cells.slice(5).map(row => row[2]?.value ?? row[0]?.value)).toEqual(['電気', 'ledの名称', '└ 未設定'])
  expect(sheets[1].cells.slice(1).map(row => row[2].value)).toContain('cvの名称')
  expect(sheets[1].cells.slice(1).map(row => row[2].value)).toContain('otherの名称')
  const simple = quantityWorkbookSheets(options({ display: {}, filters: {} }))[0]
  expect(simple.cells[1][0].value).toBe('図面別（明細のシートは絞り込みなし）')
})

it('honors individual expansion overrides and uses the screen mode labels', () => {
  for (const [mode, label] of [['page', '図面別'], ['floor', '階別'], ['room', '階・部屋別']] as const) {
    const collapsed = quantityWorkbookSheets(options({ mode, display: { allConditions: true, expanded: { led: false } } }))[0]
    expect(String(collapsed.cells[1][0].value).startsWith(label)).toBe(true)
    expect(collapsed.cells.flat().some(cell => String(cell.value).startsWith('└ '))).toBe(false)
    const expanded = quantityWorkbookSheets(options({ mode, display: { expanded: { led: true } } }))[0]
    expect(expanded.cells.flat().filter(cell => String(cell.value).startsWith('└ '))).toHaveLength(3)
  }
})

it('exports detail in CSV order with numeric page/count/quantity cells and retains raw decimal quantities', () => {
  const input = options({ filters: { category: '機械' } })
  const sheets = quantityWorkbookSheets(input)
  const raw = quantityDetailRows(sampleIndex, sampleFixtures, info)
  const csv = parseCsv(createQuantityCsv(sampleIndex, sampleFixtures, 0, 'detail', info))
  expect(sheets[1].name).toBe('明細')
  expect(sheets[1].cells[0].map(cell => cell.value)).toEqual(QUANTITY_DETAIL_HEADER)
  expect(sheets[1].cells[0].every(cell => cell.style === 'header')).toBe(true)
  expect(sheets[1].freeze).toEqual({ rows: 1, columns: 0 })
  expect(csv[0]).toEqual(QUANTITY_DETAIL_HEADER)
  expect(csv).toHaveLength(raw.length + 1)
  const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 2)
  raw.forEach((row, index) => {
    expect(sheets[1].cells[index + 1].map(cell => cell.value)).toEqual(row)
    row.forEach((value, column) => {
      expect(actual.get(`${columnName(column)}${index + 2}`)).toBe(value)
      if (column === 11 || column === 15) {
        expect(typeof value).toBe('number')
        expect(Number(csv[index + 1][column])).toBe(value)
        expect(sheets[1].cells[index + 1][column].style).toBe('integer')
      } else if (column === 14) {
        expect(typeof value).toBe('number')
        const expectedCsvValue = row[6] === '個数' ? value : Number((value as number).toFixed(2))
        expect(Number(csv[index + 1][column])).toBe(expectedCsvValue)
        expect(sheets[1].cells[index + 1][column].style).toBe(row[6] === '個数' ? 'integer' : 'decimal')
      } else expect(csv[index + 1][column]).toBe(value)
    })
  })
  expect(raw.find(row => row[1] === 'CV')![14]).toBeCloseTo(12.34567, 10)
  expect(csv.find(row => row[1] === 'CV')![14]).toBe('12.35')
})

it('embeds samples only on fixture rows, preserves PNG bytes and fits images inside 24px', () => {
  const sheets = quantityWorkbookSheets(options())
  expect(sheets[0].images).toHaveLength(1)
  const image = sheets[0].images![0]
  expect(sheets[0].cells[image.row][2].value).toBe('ledの名称')
  expect(image.column).toBe(0)
  expect(image.width).toBe(24)
  expect(image.height).toBe(24)
  expect(sheets[0].rowHeights![image.row]).toBe(24)
  expect(sheets[1].images).toBeUndefined()
  const files = packageFiles(createQuantityWorkbook(options()))
  const expected = Uint8Array.from(atob(PNG_BASE64), character => character.charCodeAt(0))
  expect(files.get('xl/media/image1.png')).toEqual(expected)
  expect([...files.keys()].filter(name => name.startsWith('xl/media/'))).toEqual(['xl/media/image1.png'])
  const wideFixtures = sampleFixtures.map(f => f.id === 'led' ? {
    ...f, sample: { ...f.sample!, width: 48, height: 24 },
  } : f)
  const wideData = buildQuantityTableData(sampleIndex, wideFixtures)
  const wide = quantityWorkbookSheets(options({ data: wideData, fixtures: wideFixtures }))[0].images![0]
  expect([wide.width, wide.height]).toEqual([24, 12])
  const filtered = packageFiles(createQuantityWorkbook(options({ filters: { category: '機械' } })))
  expect([...filtered.keys()].some(name => name.startsWith('xl/media/'))).toBe(false)
})

it('writes an empty-table message below the headers while keeping the unfiltered detail', () => {
  const sheets = quantityWorkbookSheets(options({ filters: { search: '存在しない名称' } }))
  expect(sheets[0].cells).toHaveLength(6)
  expect(sheets[0].cells[5][0].value).toBe('該当する項目はありません')
  expect(sheets[0].merges).toContainEqual({ firstRow: 5, firstColumn: 0, lastRow: 5, lastColumn: 5 })
  expect(sheets[1].cells.length).toBeGreaterThan(1)
})

it('does not alter the cached index, fixtures or display state while exporting', () => {
  const input = options()
  const totals = input.fixtures.map(f => input.index.total(f.id))
  const fixturesBefore = JSON.stringify(input.fixtures)
  const displayBefore = JSON.stringify(input.display)
  const rowsBefore = projectQuantityTable(input.data, input.mode, input.filters, info, input.display)
  createQuantityWorkbook(input)
  expect(input.fixtures.map(f => input.index.total(f.id))).toEqual(totals)
  expect(JSON.stringify(input.fixtures)).toBe(fixturesBefore)
  expect(JSON.stringify(input.display)).toBe(displayBefore)
  expect(projectQuantityTable(input.data, input.mode, input.filters, info, input.display)).toEqual(rowsBefore)
})
