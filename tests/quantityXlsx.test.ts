import { expect, it } from 'vitest'
import { nextCountStyle, quantityKind, quantityUnit, QUANTITY_UNITS, summaryText, type CountFixture, type QuantityKind } from '../src/core/countFixtures'
import { breakdownEntries } from '../src/core/breakdownMaster'
import { QuantityIndex } from '../src/core/quantityIndex'
import { columnName } from '../src/core/xlsxWriter'
import { buildQuantityTableData, createQuantityBreakdownOrder, projectQuantityTable, quantityBreakdownGroupKey, type QuantityTableMode } from '../src/app/QuantityTable'
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
      '見本', '略号', '名称', '規格', '単位', '全図面', '摘要', ...projected.columns.map(column => column.heading),
    ])
    expect(sheet.cells[4].map(cell => cell.value)).toEqual([
      null, null, null, null, null, null, null, ...projected.columns.map(column => column.subheading),
    ])
    expect(sheet.cells).toHaveLength(projected.rows.length + 5)
    projected.rows.forEach((row, offset) => {
      const rowIndex = offset + 5, excelRow = rowIndex + 1
      if (!row.item) {
        expect(actual.get(`A${excelRow}`)).toBe(row.category)
        expect(sheet.cells[rowIndex].every(cell => cell.style === 'category')).toBe(true)
        expect(sheet.merges).toContainEqual({
          firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex,
          lastColumn: 5,
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
        isCondition ? '' : summaryText(f),
        ...projected.columns.map(column => numeric(aggregate.values[mode].get(column.key) ?? 0)),
      ]
      expect(sheet.cells[rowIndex].map(cell => cell.value)).toEqual(expected)
      expected.forEach((value, column) => expect(actual.get(`${columnName(column)}${excelRow}`)).toBe(value))
      expect(sheet.cells[rowIndex][5].style).toBe(quantityKind(f) === 'count' ? 'borderedInteger' : 'borderedDecimal')
    })
    expect(sheet.freeze).toEqual({ rows: 5, columns: 6 })
    expect(sheet.columnWidths).toEqual([6, 12, 28, 12, 6, 12, 24, ...projected.columns.map(() => 14)])
    for (let column = 0; column < 7; column++) {
      expect(sheet.merges).toContainEqual({ firstRow: 3, firstColumn: column, lastRow: 4, lastColumn: column })
    }
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
    expect(sheet.cells[3]).toHaveLength(107)
    expect(sheet.columnWidths).toHaveLength(107)
    expect(sheet.cells[6]).toHaveLength(107)
    expect(sheet.cells[6][106].value).toBe(1)
    const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 1)
    expect(actual.get(`${columnName(106)}7`)).toBe(1)
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
  expect(sheets[0].merges).toContainEqual({ firstRow: 5, firstColumn: 0, lastRow: 5, lastColumn: 6 })
  expect(sheets[1].cells.length).toBeGreaterThan(1)
})

it('appends breakdown sheets without changing the existing sheets or applying table filters to the breakdown', () => {
  const positioned = sampleFixtures.map(f => f.id === 'cv' ? {
    ...f,
    breakdown: {
      book: '電気設備' as const,
      section: '庁舎',
      subject: '電灯設備',
      middle: '電灯幹線',
      item: '電線',
    },
  } : f)
  const base = options({ filters: { category: '機械' } })
  const input = options({
    fixtures: positioned,
    data: buildQuantityTableData(sampleIndex, positioned),
    filters: base.filters,
  })
  const sheets = quantityWorkbookSheets(input)
  expect(sheets.map(sheet => sheet.name)).toEqual(['集計表', '明細', '細目別内訳', '別紙明細'])
  expect(sheets.slice(0, 2)).toEqual(quantityWorkbookSheets(base))
  const item = sheets[2].cells.find(row => row[0]?.value === '電線')!
  expect(item[3].value).toBe(1)
  expect(item[4].value).toBe('式')
  const totalOffset = sheets[3].cells.findIndex(row => row[0]?.value === '計')
  expect(item[6].formula).toBe(`'別紙明細'!F${totalOffset + 1}`)
  const detail = sheets[3].cells.find(row => row[0]?.value === 'cvの名称')!
  expect(detail[2].value).toBe(12.3)
  expect(detail[3].value).toBe('m')
  const files = packageFiles(createQuantityWorkbook(input))
  expect(decoder.decode(files.get('xl/workbook.xml')!)).toContain('<sheet name="細目別内訳"')
  expect(decoder.decode(files.get('xl/workbook.xml')!)).toContain('<sheet name="別紙明細"')
  expect(decoder.decode(files.get('xl/worksheets/sheet3.xml')!))
    .toContain(`<f>&apos;別紙明細&apos;!F${totalOffset + 1}</f>`)
})

it('adds only the item sheet when all located fixtures are quantity items', () => {
  const positioned = sampleFixtures.map(f => f.id === 'led' ? {
    ...f,
    name: '分電盤',
    unit: '面' as const,
    breakdown: {
      book: '電気設備' as const,
      section: '庁舎',
      subject: '電灯設備',
      middle: '電灯分岐',
      item: '分電盤',
    },
  } : f)
  const sheets = quantityWorkbookSheets(options({
    fixtures: positioned, data: buildQuantityTableData(sampleIndex, positioned),
  }))
  expect(sheets.map(sheet => sheet.name)).toEqual(['集計表', '明細', '細目別内訳'])
  const rows = sheets[2].cells.filter(row => row[0]?.value === '分電盤')
  expect(rows).toHaveLength(3)
  // Unset, then the candidates in the item's order (新設, 既設).
  expect(rows.map(row => row[3].value)).toEqual([1, 2, 1])
  expect(rows.every(row => row[4].value === '面')).toBe(true)
})

it('writes summary to G and starts drawing quantities at H without a location column', () => {
  const positioned: CountFixture[] = sampleFixtures.map(f => f.id === 'led' ? {
    ...f,
    summary: [{ label: '盤名称', value: 'L-1' }],
    breakdown: {
      book: '電気設備' as const, section: '庁舎',
      subject: '電灯設備', middle: '電灯分岐', item: '分電盤',
    },
  } : f)
  const input = options({ fixtures: positioned, data: buildQuantityTableData(sampleIndex, positioned) })
  const sheets = quantityWorkbookSheets(input)
  const sheet = sheets[0]
  expect(sheet.cells[3].slice(0, 7).map(cell => cell.value)).toEqual([
    '見本', '略号', '名称', '規格', '単位', '全図面', '摘要',
  ])
  expect(sheet.cells[3].map(cell => cell.value)).not.toContain('内訳書の位置')
  expect(sheet.cells[3][7].value).toBe('p.1')
  const ledRow = sheet.cells.findIndex(row => row[1]?.value === 'LED')
  expect(ledRow).toBeGreaterThan(5)
  expect(sheet.cells[ledRow][4].value).toBe('個')
  expect(sheet.cells[ledRow][5].value).toBe(4)
  expect(sheet.cells[ledRow][6].value).toBe('L-1')
  expect(sheet.cells[ledRow][7].value).toBe(2)
  const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 1)
  expect(actual.get(`E${ledRow + 1}`)).toBe('個')
  expect(actual.get(`F${ledRow + 1}`)).toBe(4)
  expect(actual.get(`G${ledRow + 1}`)).toBe('L-1')
  expect(actual.get(`H${ledRow + 1}`)).toBe(2)
  const conditions = sheet.cells.filter(row => String(row[2]?.value).startsWith('└ '))
  expect(conditions).toHaveLength(3)
  for (const row of conditions) expect(row[6].value).toBe('')
  expect(conditions.map(row => row[7].value)).toEqual([null, 1, 1])
  const cv = sheet.cells.find(row => row[1]?.value === 'CV')!
  expect(cv[6].value).toBe('')
  expect(cv[7].value).toBeNull()

  const withoutMiddle: CountFixture[] = positioned.map(f => f.id === 'led' ? {
    ...f,
    breakdown: { book: '電気設備' as const, section: '庁舎', subject: '電灯設備', item: '分電盤' },
  } : f)
  const noMiddle = quantityWorkbookSheets(options({
    fixtures: withoutMiddle, data: buildQuantityTableData(sampleIndex, withoutMiddle),
  }))[0]
  expect(noMiddle.cells.find(row => row[1]?.value === 'LED')![6].value).toBe('L-1')
  expect(noMiddle.cells.find(row => row[1]?.value === 'LED')![7].value).toBe(2)
})

it('exports master group order, unknown groups and missing locations without changing other sheets', () => {
  const entries = breakdownEntries()
  const masterGroups = [...new Map(entries.map(entry => [quantityBreakdownGroupKey(entry), entry])).values()]
  expect(masterGroups.length).toBeGreaterThanOrEqual(2)
  const [first, second] = masterGroups
  const position = (entry: typeof first): NonNullable<CountFixture['breakdown']> => ({
    book: entry.book, section: entry.section, subject: entry.subject,
    middle: entry.middle, item: entry.row.name,
  })
  const fixtures: CountFixture[] = [
    { ...fixture('first', 90), breakdown: position(first) },
    { ...fixture('second', -10), breakdown: position(second) },
    {
      ...fixture('unknown', -20),
      breakdown: { book: '電気設備', section: '独自種目', subject: '独自科目', item: '分電盤' },
    },
    fixture('missing', -100),
  ]
  const index = QuantityIndex.build(fixtures.map(f => count(`mark-${f.id}`, 0, f.id)), fixtures)
  const data = buildQuantityTableData(index, fixtures)
  const display = { groupByBreakdown: true, breakdownOrder: createQuantityBreakdownOrder(entries) }
  const input = options({ data, fixtures, index, display })
  const sheets = quantityWorkbookSheets(input)
  expect(sheets[0].cells.slice(5).filter(row => row[1]?.value)
    .map(row => row[2].value)).toEqual([
    // SPEC-B03i: headings follow the items' own order (the master order is used when adding and re-sorting).
    'unknownの名称', 'secondの名称', 'firstの名称', 'missingの名称',
  ])
  const projected = projectQuantityTable(data, 'page', {}, info, display, Infinity)
  expect(sheets[0].cells.slice(5).map(row => row[2]?.value ?? row[0]?.value)).toEqual(
    projected.rows.map(row => row.item
      ? row.item.fixture.name
      : `${'　'.repeat(Math.max(0, (row.level ?? 0) - 1))}${row.category}`),
  )
  expect(sheets[0].cells[1][0].value).toBe(
    '図面別・内訳書の位置でまとめる（明細のシートは絞り込みなし）',
  )
  const ungrouped = quantityWorkbookSheets(options({ data, fixtures, index, display: {} }))
  expect(sheets.slice(1)).toEqual(ungrouped.slice(1))
  const off = quantityWorkbookSheets(options({
    data, fixtures, index, display: { ...display, groupByBreakdown: false },
  }))
  expect(off).toEqual(ungrouped)

  const filtered = quantityWorkbookSheets(options({
    data, fixtures, index, display, filters: { category: '電気', search: 'second' },
  }))
  expect(filtered[0].cells.slice(5).map(row => row[2]?.value ?? row[0]?.value)).toEqual([
    second.book, second.section, `　${second.subject}`,
    ...(second.middle ? [`　　${second.middle}`] : []),
    ...(second.row.separate ? [`　　　${second.row.name}（別紙明細）`] : []),
    'secondの名称',
  ])
  expect(filtered.slice(1)).toEqual(sheets.slice(1))
})

it('rejects more than 16384 columns including six fixed columns and one metadata column', () => {
  const fixtures = [fixture('led')]
  const index = QuantityIndex.build(Array.from({ length: 16378 }, (_, i) =>
    count(String(i), i, 'led')), fixtures)
  expect(() => quantityWorkbookSheets(options({
    fixtures, index, data: buildQuantityTableData(index, fixtures), display: {},
  }))).toThrow('集計表の基本7列を含めてExcelの列数の上限16384列を超えています')
})

it('exports explicit indented hierarchy headings and preserves other sheets and numeric columns', () => {
  const masterEntries = [
    {
      book: '電気設備' as const, section: '庁舎', subject: '電灯設備', middle: '電灯分岐',
      row: { name: '分電盤' },
    },
    {
      book: '電気設備' as const, section: '庁舎', subject: '電灯設備', middle: '電灯分岐',
      row: { name: 'ケーブル', separate: true as const },
    },
    {
      book: '電気設備' as const, section: '研究棟', subject: '照明設備',
      row: { name: '照明器具' },
    },
  ]
  const fixtures: CountFixture[] = [
    {
      ...fixture('board', 90),
      summary: [{ label: '盤名称', value: 'L-1' }],
      breakdown: {
        book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item: '分電盤',
      },
    },
    {
      ...fixture('cable', -20, '電気', 'length'),
      breakdown: {
        book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item: 'ケーブル',
      },
    },
    {
      ...fixture('research', -100),
      breakdown: { book: '電気設備', section: '研究棟', subject: '照明設備', item: '照明器具' },
    },
    {
      ...fixture('unknown', -200),
      breakdown: { book: '電気設備', section: '独自種目', subject: '独自科目', item: '独自細目' },
    },
    fixture('missing', -300),
  ]
  const index = QuantityIndex.build([count('board-mark', 0, 'board')], fixtures)
  const data = buildQuantityTableData(index, fixtures)
  const display = { groupByBreakdown: true, breakdownOrder: createQuantityBreakdownOrder(masterEntries) }
  const input = options({ data, fixtures, index, display })
  const sheets = quantityWorkbookSheets(input)
  const sheet = sheets[0]
  expect(sheet.cells.slice(5).map(row => row[2]?.value ?? row[0]?.value)).toEqual([
    // SPEC-B03i: headings follow the items' own order.
    '電気設備', '独自種目', '　独自科目', 'unknownの名称',
    '研究棟', '　照明設備', 'researchの名称',
    '庁舎', '　電灯設備', '　　電灯分岐', 'boardの名称',
    '　　　ケーブル（別紙明細）', 'cableの名称',
    '（内訳書の位置なし）', 'missingの名称',
  ])
  expect(sheet.cells[3].map(cell => cell.value)).toEqual([
    '見本', '略号', '名称', '規格', '単位', '全図面', '摘要', 'p.1',
  ])
  const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 1)
  sheet.cells.forEach((row, rowIndex) => {
    if (row[0]?.style !== 'category') return
    expect(actual.get(`A${rowIndex + 1}`)).toBe(row[0].value)
    expect(row.every(cell => cell.style === 'category')).toBe(true)
    expect(sheet.merges).toContainEqual({
      firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex, lastColumn: 5,
    })
  })
  const boardRow = sheet.cells.findIndex(row => row[1]?.value === 'BOARD')
  expect(actual.get(`G${boardRow + 1}`)).toBe('L-1')
  expect(actual.get(`H${boardRow + 1}`)).toBe(1)
  expect(sheet.freeze).toEqual({ rows: 5, columns: 6 })
  expect(sheets.slice(1)).toEqual(quantityWorkbookSheets(options({ data, fixtures, index, display: {} })).slice(1))

  const filtered = quantityWorkbookSheets(options({
    data, fixtures, index, display, filters: { search: 'research' },
  }))
  expect(filtered[0].cells.slice(5).map(row => row[2]?.value ?? row[0]?.value)).toEqual([
    '電気設備', '研究棟', '　照明設備', 'researchの名称',
  ])
  expect(filtered.slice(1)).toEqual(sheets.slice(1))
  expect(quantityWorkbookSheets(options({
    display: { groupByBreakdown: true, breakdownOrder: display.breakdownOrder },
  }))[0].cells.slice(5).filter(row => row[0]?.style === 'category')
    .map(row => row[0].value)).toEqual(['電気', '機械'])
})

function linkedWorkbookInput(): QuantityWorkbookOptions {
  const sources = [{ itemId: 'dl', factor: 1, conditions: ['露出', ''] }, { itemId: 'sl', factor: 2 }]
  const fixtures: CountFixture[] = [
    { ...fixture('dl'), conditions: ['露出'], attributes: { massKg: 12 } },
    fixture('sl', 1),
    fixture('cv', 2, '電気', 'length'),
    { ...fixture('inst', 3), link: { kind: 'factor', sources } },
    { ...fixture('interval', 4), link: { kind: 'factor', sources: [{ itemId: 'cv', perM: 1.5 }] } },
    { ...fixture('each', 5), link: { kind: 'factor', sources: [{ itemId: 'cv', perM: 1.5 }], rounding: 'each' } },
    { ...fixture('mass', 6), link: { kind: 'mass', sources: [{ itemId: 'dl' }] } },
    { ...fixture('density', 7), link: { kind: 'mass', sources: [{ itemId: 'dl' }], densityTPerM3: 0.5 } },
    { ...fixture('mass-factor', 8), link: { kind: 'mass', sources: [{ itemId: 'dl', factor: 2 }] } },
    {
      ...fixture('override', 9), conditions: ['取付'],
      link: {
        kind: 'factor', sources, condition: { mode: 'fixed', value: '取付' },
        override: { value: 10, note: '現場の指示による' },
      },
    },
    {
      ...fixture('zero', 10),
      link: { kind: 'factor', sources, override: { value: 0 } },
    },
    {
      ...fixture('error', 11),
      link: { kind: 'factor', sources: [{ itemId: 'missing' }] },
    },
    {
      ...fixture('invalid', 12),
      link: { kind: 'factor', sources: [{ itemId: 'dl', factor: 0 }] },
    },
    {
      ...fixture('warning', 13),
      link: { kind: 'mass', sources: [{ itemId: 'sl' }] },
    },
    {
      ...fixture('decimal', 14, '電気', 'length'),
      link: { kind: 'factor', sources: [{ itemId: 'cv', factor: 0.5 }], rounding: 'none' },
    },
  ]
  const route = (id: string, pageIndex: number) => ({
    id, pageIndex,
    vertices: [[0, 0], [1.6, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1 as const, id, itemId: 'cv', method: 'polyline' as const,
      floor: '1階', room: '事務室',
    },
  })
  const index = QuantityIndex.build([
    count('dl1', 0, 'dl', '1階', '事務室', '露出'),
    count('dl2', 0, 'dl', '1階', '事務室'),
    count('dl3', 1, 'dl', '2階', '会議室'),
    count('sl1', 1, 'sl', '2階', '会議室'),
    route('cv1', 0), route('cv2', 1),
  ], fixtures)
  return options({
    fixtures, index, data: buildQuantityTableData(index, fixtures), display: {},
  })
}

function xlsxNumberFormat(files: Map<string, Uint8Array>, sheetNumber: number, reference: string): string {
  const xml = decoder.decode(files.get(`xl/worksheets/sheet${sheetNumber}.xml`)!)
  const attributes = [...xml.matchAll(/<c\b([^>]*?)(?:\/>|>)/g)]
    .find(match => match[1].match(/\br="([^"]+)"/)?.[1] === reference)![1]
  const styleId = Number(attributes.match(/\bs="(\d+)"/)?.[1] ?? 0)
  const styles = decoder.decode(files.get('xl/styles.xml')!)
  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1]
  const xf = [...cellXfs.matchAll(/<xf\b([^>]*)>/g)][styleId][1]
  const formatId = Number(xf.match(/\bnumFmtId="(\d+)"/)?.[1] ?? 0)
  const builtin: Record<number, string> = {
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  }
  if (builtin[formatId] !== undefined) return builtin[formatId]
  const custom = [...styles.matchAll(/<numFmt\b([^>]*)>/g)]
    .find(match => Number(match[1].match(/\bnumFmtId="(\d+)"/)?.[1]) === formatId)
  expect(custom).toBeDefined()
  return unescapeXml(custom![1].match(/\bformatCode="([^"]+)"/)![1])
}

it('exports linked names, calculations, rounding, overrides, errors and warnings with numeric formats', () => {
  const input = linkedWorkbookInput()
  const sheets = quantityWorkbookSheets(input)
  expect(sheets.map(sheet => sheet.name)).toEqual(['集計表', '明細', '計算根拠'])
  const table = sheets[0], basis = sheets[2]
  expect(basis.cells[0][0]).toEqual({ value: '設備図 連動の計算根拠', style: 'title' })
  expect(basis.cells[2].map(cell => cell.value)).toEqual([
    '連動項目', '種類', '元の略号', '元の名称', '元の数量', '元の単位', '計算', '小計', '備考',
  ])
  expect(basis.cells[2].every(cell => cell.style === 'header')).toBe(true)
  expect(basis.freeze).toEqual({ rows: 3, columns: 0 })
  expect(basis.columnWidths).toHaveLength(9)
  expect(basis.merges).toContainEqual({
    firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 8,
  })

  const block = (id: string) => {
    const f = input.fixtures.find(value => value.id === id)!
    const start = basis.cells.findIndex(row => row[0]?.value === `${f.code} ${f.name}（${quantityUnit(f)}）`)
    expect(start).toBeGreaterThanOrEqual(3)
    expect(basis.cells[start].every(cell => cell.style === 'category')).toBe(true)
    expect(basis.cells[start][1].value).toBe(f.link?.kind === 'mass' ? '質量の換算' : '係数')
    const end = basis.cells.findIndex((row, offset) => offset > start && row[0]?.style === 'category')
    return basis.cells.slice(start + 1, end < 0 ? basis.cells.length : end)
  }
  const total = (id: string) => block(id).find(row => row[0]?.value === '合計')!
  for (const f of input.fixtures) {
    const row = table.cells.find(value => value[1]?.value === f.code)!
    expect(row[2].value).toBe(f.name + (f.link
      ? input.index.linkResult(f.id)?.overridden ? '［上書き］' : '［連動］' : ''))
  }
  const installation = block('inst')
  expect(installation.filter(row => row[2]?.value).map(row => [
    row[2].value, row[3].value, row[4].value, row[5].value, row[6].value, row[7].value, row[8].value,
  ])).toEqual([
    ['DL', 'dlの名称', 3, '個', '× 1', 3, '施工条件: 露出・未設定'],
    ['SL', 'slの名称', 1, '個', '× 2', 2, ''],
  ])
  expect(total('inst')[7]).toEqual({ value: 5, style: 'borderedInteger' })
  expect(total('inst')[8].value).toBe('合計で切り上げ')
  const interval = block('interval').find(row => row[2]?.value === 'CV')!
  expect(interval[4]).toEqual({ value: 3.2, style: 'borderedDecimal' })
  expect(interval[6].value).toBe('÷ 1.5 m')
  expect(interval[7].value).toBeCloseTo(3.2 / 1.5, 10)
  expect(total('interval')[7].value).toBe(3)
  expect(total('each')[7].value).toBe(4)
  expect(total('each')[8].value).toBe('拾いごとに切り上げ')
  expect(block('mass').find(row => row[2]?.value === 'DL')![6].value).toBe('× 12 kg ÷ 1000')
  expect(total('mass')[7].value).toBeCloseTo(0.036, 10)
  expect(total('mass')[7].style).toBe('borderedDecimal')
  expect(total('mass')[8].value).toBe('')
  expect(block('density').find(row => row[2]?.value === 'DL')![6].value)
    .toBe('× 12 kg ÷ 1000 ÷ 0.5 t/㎥')
  expect(total('density')[7].value).toBeCloseTo(0.072, 10)
  expect(block('mass-factor').find(row => row[2]?.value === 'DL')![6].value)
    .toBe('× 2 × 12 kg ÷ 1000')
  expect(total('mass-factor')[7].value).toBeCloseTo(0.072, 10)
  expect(total('decimal')[7]).toEqual({ value: 1.6, style: 'borderedDecimal' })
  expect(total('decimal')[8].value).toBe('')

  expect(total('override')[7].value).toBe(5)
  const override = block('override').find(row => row[0]?.value === '上書き')!
  expect(override[7]).toEqual({ value: 10, style: 'borderedInteger' })
  expect(override[8].value).toBe('計算値 5、差 +5、現場の指示による')
  expect(block('zero').find(row => row[0]?.value === '上書き')![8].value).toBe('計算値 5、差 -5')
  expect(block('error').some(row => row[8]?.value === '連動の元の項目が見つかりません。')).toBe(true)
  expect(block('invalid').some(row => row[8]?.value === '連動の係数は0より大きく10000以下の数で入れてください。')).toBe(true)
  expect(block('warning').some(row => row[8]?.value === 'slの名称の質量が未設定です。')).toBe(true)
  expect(total('warning')[7].value).toBe(0)

  const files = packageFiles(createQuantityWorkbook(input))
  const actual = workbookCells(files, 3)
  basis.cells.forEach((row, offset) => row.forEach((cell, column) => {
    if (typeof cell.value === 'number') {
      expect(actual.get(`${columnName(column)}${offset + 1}`)).toBe(cell.value)
    }
    if (cell.style === 'borderedInteger' && typeof cell.value === 'number') {
      expect(['0', '#,##0']).toContain(xlsxNumberFormat(files, 3, `${columnName(column)}${offset + 1}`))
    }
    if (cell.style === 'borderedDecimal' && typeof cell.value === 'number') {
      expect(['0.00', '#,##0.00']).toContain(xlsxNumberFormat(files, 3, `${columnName(column)}${offset + 1}`))
    }
  }))
  expect(decoder.decode(files.get('xl/workbook.xml')!)).toContain('<sheet name="計算根拠"')
})

it('exports linked detail and one unlocated override row including zero, without changing summary CSV labels', () => {
  const input = linkedWorkbookInput()
  const rows = quantityDetailRows(input.index, input.fixtures, info)
  const csv = parseCsv(createQuantityCsv(input.index, input.fixtures, 0, 'detail', info))
  const sheets = quantityWorkbookSheets(input)
  const actual = workbookCells(packageFiles(createQuantityWorkbook(input)), 2)
  const linkedCodes = new Set(input.fixtures.filter(f => f.link !== undefined).map(f => f.code))
  for (const row of rows) {
    if (linkedCodes.has(row[1])) expect(row[6]).toBe('連動')
  }
  expect(rows.filter(row => row[1] === 'INST')).toHaveLength(3)
  for (const [code, condition, value] of [['OVERRIDE', '取付', 10], ['ZERO', '', 0]] as const) {
    const matches = rows.filter(row => row[1] === code)
    expect(matches).toHaveLength(1)
    const row = matches[0]
    expect(row[4]).toBe(condition)
    expect(row[5]).toBe('')
    expect(row[6]).toBe('連動')
    expect(row.slice(9, 14)).toEqual(['', '', '', '', ''])
    expect(row[14]).toBe(value)
    expect(row[15]).toBe(0)
    const offset = rows.indexOf(row)
    expect(sheets[1].cells[offset + 1].map(cell => cell.value)).toEqual(row)
    expect(actual.get(`L${offset + 2}`)).toBe('')
    expect(actual.get(`O${offset + 2}`)).toBe(value)
    expect(actual.get(`P${offset + 2}`)).toBe(0)
    expect(csv[offset + 1].slice(9, 14)).toEqual(['', '', '', '', ''])
    expect(csv[offset + 1][14]).toBe(String(value))
    expect(csv[offset + 1][15]).toBe('0')
    const tableRow = sheets[0].cells.find(cells => cells[1]?.value === code)!
    expect(tableRow[5].value).toBe(value)
    expect(tableRow.slice(7).every(cell => cell.value === null)).toBe(true)
    const item = input.data.find(item => item.fixture.code === code)!
    expect(item.values.page.size).toBe(0)
    expect(item.values.floor.size).toBe(0)
    expect(item.values.room.size).toBe(0)
    expect(item.entries).toHaveLength(0)
  }
  // Detail rows are split by the inherited condition: page 1 has one 露出 and one unset DL (0.012 t each).
  const massRows = csv.filter(row => row[1] === 'MASS')
  expect(massRows.map(row => [row[4], row[11], row[14]])).toEqual([['露出', '1', '0.01'], ['', '1', '0.01'], ['', '2', '0.01']])
  const mass = massRows[0]
  expect(mass[6]).toBe('連動')
  const summary = parseCsv(createQuantityCsv(input.index, input.fixtures, 0, 'summary', info))
  expect(summary.find(row => row[1] === 'OVERRIDE')![12]).toBe('10')
  expect(summary.find(row => row[1] === 'OVERRIDE')![6]).toBe('個数')
  expect(summary.find(row => row[1] === 'INST')![12]).toBe('1')
  expect(rows.filter(row => row[1] === 'DL').every(row => row[6] === '個数')).toBe(true)
})

it('adds calculation basis last and keeps it unfiltered, while ordinary documents have no basis sheet', () => {
  expect(quantityWorkbookSheets(options()).map(sheet => sheet.name)).toEqual(['集計表', '明細'])
  const plainFiles = packageFiles(createQuantityWorkbook(options()))
  expect(decoder.decode(plainFiles.get('xl/workbook.xml')!)).not.toContain('計算根拠')
  const input = linkedWorkbookInput()
  const fixtures = input.fixtures.map(f => f.id === 'inst' ? {
    ...f,
    breakdown: {
      book: '電気設備' as const, section: '庁舎', subject: '電灯設備',
      middle: '電灯幹線', item: '電線',
    },
  } : f)
  const positioned = {
    ...input, fixtures, data: buildQuantityTableData(input.index, fixtures),
  }
  const sheets = quantityWorkbookSheets(positioned)
  expect(sheets.map(sheet => sheet.name))
    .toEqual(['集計表', '明細', '細目別内訳', '別紙明細', '計算根拠'])
  const filtered = quantityWorkbookSheets({ ...positioned, filters: { search: '存在しない名称' } })
  expect(filtered[filtered.length - 1]).toEqual(sheets[sheets.length - 1])
  const before = JSON.stringify(fixtures)
  const results = JSON.stringify(fixtures.map(f => input.index.linkResult(f.id)))
  createQuantityWorkbook(positioned)
  expect(JSON.stringify(fixtures)).toBe(before)
  expect(JSON.stringify(fixtures.map(f => input.index.linkResult(f.id)))).toBe(results)
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
