import { expect, it } from 'vitest'
import { breakdownSheets, roundBreakdownQuantity } from '../src/app/breakdownXlsx'
import { buildQuantityTableData } from '../src/app/QuantityTable'
import { quantityWorkbookSheets } from '../src/app/quantityXlsx'
import {
  nextCountStyle,
  type BreakdownPosition,
  type CountFixture,
} from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import type { XlsxCell, XlsxSheet } from '../src/core/xlsxWriter'

function fixture(id: string, overrides: Partial<CountFixture> = {}): CountFixture {
  return {
    id, name: id, code: id.toUpperCase(), category: '電気', order: 0,
    style: nextCountStyle([]),
    ...overrides,
  }
}

function position(item: string, middle = '電灯幹線'): BreakdownPosition {
  return { book: '電気設備', section: '庁舎', subject: '電灯設備', middle, item }
}

function count(id: string, fixtureId: string, condition?: string) {
  return {
    id, pageIndex: 0,
    count: { version: 2 as const, id, fixtureId, condition },
  }
}

function route(id: string, fixtureId: string, length: number, condition?: string) {
  return {
    id, pageIndex: 0,
    vertices: [[0, 0], [length, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1 as const, id, itemId: fixtureId, method: 'polyline' as const,
      ...(condition === undefined ? {} : { cond: { plan: condition } }),
    },
  }
}

function dataRows(sheet: XlsxSheet, name: string): Array<readonly XlsxCell[]> {
  return sheet.cells.filter(row => row[0]?.value === name && row[0]?.style === 'borderedText')
}

function totalReference(sheet: XlsxSheet, name: string): string {
  const heading = sheet.cells.findIndex(row =>
    row[0]?.style === 'category' && String(row[0].value).endsWith(`／${name}`))
  expect(heading).toBeGreaterThanOrEqual(0)
  const offset = sheet.cells.slice(heading + 1).findIndex(row => row[0]?.value === '計')
  expect(offset).toBeGreaterThanOrEqual(0)
  return `'別紙明細'!F${heading + offset + 2}`
}

function sample() {
  const fixtures = [
    fixture('l2', {
      name: '分電盤', code: 'L-2', order: 4, unit: '面',
      breakdown: position('分電盤', '電灯分岐'),
      summary: [{ label: '盤名称', value: 'L-2' }],
    }),
    fixture('conduit', {
      name: 'ねじなし電線管', code: 'E25', order: 0, kind: 'length',
      breakdown: position('電線管'),
      conditions: ['隠ぺい配管', '露出配管'],
      remark: '管の備考',
    }),
    fixture('l1', {
      name: '分電盤', code: 'L-1', order: 1, unit: '面',
      breakdown: position('分電盤', '電灯分岐'),
      summary: [{ label: '盤名称', value: 'L-1' }],
    }),
    fixture('wire', {
      name: '600Vビニル絶縁電線', code: 'IV', spec: '5.5sq',
      order: 9, kind: 'length', breakdown: position('電線'),
      summary: [{ label: '用途', value: '幹線用' }],
    }),
    fixture('unused', { name: '分電盤', unit: '面', breakdown: position('分電盤', '電灯分岐') }),
    fixture('unlocated'),
  ]
  const index = QuantityIndex.build([
    count('l1a', 'l1'), count('l1b', 'l1'), count('l1c', 'l1'), count('l2a', 'l2'),
    route('exposed', 'conduit', 5.06, '露出配管'),
    route('concealed', 'conduit', 12.34, '隠ぺい配管'),
    route('wire-route', 'wire', 30.55),
    count('outside', 'unlocated'),
  ], fixtures)
  return { fixtures, index, pdfName: '設備図.PDF' }
}

it('returns no sheets for fixtures without a breakdown position or with zero totals', () => {
  const plain = [fixture('plain')]
  expect(breakdownSheets({
    fixtures: plain, index: QuantityIndex.build([count('a', 'plain')], plain), pdfName: '図面.pdf',
  })).toEqual([])
  const located = [fixture('zero', { breakdown: position('分電盤', '電灯分岐') })]
  expect(breakdownSheets({
    fixtures: located, index: QuantityIndex.build([], located), pdfName: '図面.pdf',
  })).toEqual([])
})

it('projects master order, board summaries, separate items, conditions and subtotal references', () => {
  const input = sample()
  const [items, details] = breakdownSheets(input)
  expect([items.name, details.name]).toEqual(['細目別内訳', '別紙明細'])
  expect(items.cells[0][0].value).toBe('設備図 細目別内訳')
  expect(details.cells[0][0].value).toBe('設備図 別紙明細')

  for (const sheet of [items, details]) {
    const hasCode = sheet === items
    expect(sheet.cells[1]).toEqual([])
    expect(sheet.cells[2].map(cell => cell.value))
      .toEqual(['名称', ...(hasCode ? ['略号'] : []), '摘要', '数量', '単位', '単価', '金額', '備考'])
    expect(sheet.cells[2].every(cell => cell.style === 'header')).toBe(true)
    expect(sheet.columnWidths).toEqual([28, ...(hasCode ? [18] : []), 36, 10, 6, 12, 14, 20])
    expect(sheet.freeze).toEqual({ rows: 3, columns: 0 })
    expect(sheet.merges).toContainEqual({
      firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: hasCode ? 7 : 6,
    })
    sheet.cells.forEach((row, rowIndex) => {
      if (row[0]?.style === 'category') {
        expect(row.every(cell => cell.style === 'category')).toBe(true)
        expect(sheet.merges).toContainEqual({
          firstRow: rowIndex, firstColumn: 0, lastRow: rowIndex, lastColumn: hasCode ? 7 : 6,
        })
      }
    })
  }

  expect(items.cells.filter(row => row[0]?.style === 'category').map(row => row[0].value))
    .toEqual(['電気設備', '庁舎', '　電灯設備', '　　電灯幹線', '　　電灯分岐'])
  expect(items.cells.filter(row => row[0]?.style === 'borderedText').map(row => row[0].value))
    .toEqual(['電線', '電線管', '計', '分電盤', '分電盤', '計'])

  const boards = dataRows(items, '分電盤')
  expect(boards).toHaveLength(2)
  expect(boards.map(row => row.slice(1, 5).map(cell => cell.value)))
    .toEqual([['L-1', 'L-1', 3, '面'], ['L-2', 'L-2', 1, '面']])
  expect(boards.every(row => row[3].style === 'borderedInteger')).toBe(true)

  for (const [offset, name] of ['電線', '電線管'].entries()) {
    const rows = dataRows(items, name)
    expect(rows).toHaveLength(1)
    expect(rows[0][1].value).toBe(offset === 0 ? 'IV' : 'E25')
    expect(rows[0][2].value).toBe('')
    expect(rows[0][3].value).toBe(1)
    expect(rows[0][4].value).toBe('式')
    expect(rows[0][5].value).toBeNull()
    expect(rows[0][6].formula).toBe(totalReference(details, name))
    expect(rows[0][6].style).toBe('borderedMoney')
    expect(rows[0][7].value).toBe(`別紙明細-${offset + 1}`)
  }

  expect(details.cells.filter(row => row[0]?.style === 'category').map(row => row[0].value))
    .toEqual([
      '別紙明細-1　電灯設備／電灯幹線／電線',
      '別紙明細-2　電灯設備／電灯幹線／電線管',
    ])
  const wire = dataRows(details, '600Vビニル絶縁電線')
  expect(wire).toHaveLength(1)
  expect(wire[0][1].value).toBe('IV 5.5sq、幹線用')
  expect(wire[0][2].value).toBe(30.6)
  expect(wire[0][3].value).toBe('m')

  const conduits = dataRows(details, 'ねじなし電線管')
  expect(conduits.map(row => [row[1].value, row[2].value, row[6].value]))
    .toEqual([
      ['E25、隠ぺい配管', 12.3, '管の備考'],
      ['E25、露出配管', 5.1, '管の備考'],
    ])
  expect(conduits.every(row => row[2].style === 'borderedDecimal')).toBe(true)

  for (const sheet of [items, details]) {
    const columnOffset = sheet === items ? 1 : 0
    const amountColumn = sheet === items ? 'G' : 'F'
    let firstQuantityRow: number | undefined
    sheet.cells.forEach((row, offset) => {
      if (row[0]?.style !== 'borderedText') return
      const excelRow = offset + 1
      expect(row[4 + columnOffset]).toEqual({ value: null, style: 'borderedMoney' })
      expect(row[5 + columnOffset].style).toBe('borderedMoney')
      if (row[0].value === '計') {
        expect(firstQuantityRow).toBeDefined()
        expect(row[5 + columnOffset].formula).toBe(`SUM(${amountColumn}${firstQuantityRow}:${amountColumn}${excelRow - 1})`)
        if (sheet === items) expect(row[1].value).toBe('')
        firstQuantityRow = undefined
      } else {
        firstQuantityRow ??= excelRow
        if (!row[5 + columnOffset].formula?.startsWith("'別紙明細'!")) {
          expect(row[5 + columnOffset].formula).toBe(sheet === items
            ? `IF(F${excelRow}="","",D${excelRow}*F${excelRow})`
            : `IF(E${excelRow}="","",C${excelRow}*E${excelRow})`)
        }
      }
    })
  }
})

it('uses fixture names for manual positions and lets the master override that fallback', () => {
  const manual: BreakdownPosition = {
    book: '電気設備', section: '手入力', subject: '科目 A', item: '細目 B',
  }
  const same = [fixture('same', { name: '細目 B', breakdown: manual })]
  const sameSheets = breakdownSheets({
    fixtures: same,
    index: QuantityIndex.build([count('s1', 'same'), count('s2', 'same')], same),
    pdfName: '手入力.pdf',
  })
  expect(sameSheets).toHaveLength(1)
  expect(dataRows(sameSheets[0], '細目 B')[0][3].value).toBe(2)

  const different = [fixture('different', { name: '明細の名称', breakdown: manual })]
  const differentSheets = breakdownSheets({
    fixtures: different,
    index: QuantityIndex.build([count('d1', 'different')], different),
    pdfName: '手入力.pdf',
  })
  expect(differentSheets).toHaveLength(2)
  expect(dataRows(differentSheets[0], '細目 B')[0][4].value).toBe('式')
  expect(differentSheets[1].cells[3][0].value).toBe('別紙明細-1　科目 A／細目 B')
  expect(dataRows(differentSheets[1], '明細の名称')[0][2].style).toBe('borderedInteger')

  const masters = [
    fixture('board', {
      name: '名称を変更した盤', unit: '面', breakdown: position('分電盤', '電灯分岐'),
    }),
    fixture('wire', { name: '電線', kind: 'length', breakdown: position('電線') }),
  ]
  const masterSheets = breakdownSheets({
    fixtures: masters,
    index: QuantityIndex.build([count('b1', 'board'), route('w1', 'wire', 2)], masters),
    pdfName: '優先.pdf',
  })
  expect(masterSheets).toHaveLength(2)
  expect(dataRows(masterSheets[0], '分電盤')[0][4].value).toBe('面')
  expect(dataRows(masterSheets[0], '電線')[0][4].value).toBe('式')
})

it('classifies a manual position together while omitting its unused fixtures from detail rows', () => {
  const manual: BreakdownPosition = {
    book: '電気設備', section: '手入力', subject: '科目 A', item: '細目 B',
  }
  const fixtures = [
    fixture('active', { name: '細目 B', breakdown: manual }),
    fixture('unused', { name: '別の名称', breakdown: manual }),
  ]
  const sheets = breakdownSheets({
    fixtures, index: QuantityIndex.build([count('a', 'active')], fixtures), pdfName: '手入力.pdf',
  })
  expect(sheets).toHaveLength(2)
  expect(dataRows(sheets[0], '細目 B')).toHaveLength(1)
  expect(dataRows(sheets[1], '細目 B')).toHaveLength(1)
  expect(dataRows(sheets[1], '別の名称')).toHaveLength(0)
})

it('orders unknown groups and items after master entries by minimum fixture order', () => {
  const fixtures = [
    fixture('late', {
      order: 7,
      breakdown: { book: '建築', section: '後', subject: '科目', item: 'late' },
    }),
    fixture('early', {
      order: 2,
      breakdown: { book: '建築', section: '先', subject: '科目', item: 'early' },
    }),
    fixture('unknown-late', {
      order: 5, breakdown: position('unknown-late', '電灯分岐'),
    }),
    fixture('unknown-early', {
      order: 1, breakdown: position('unknown-early', '電灯分岐'),
    }),
    fixture('board', {
      name: '分電盤', order: 20, unit: '面',
      breakdown: position('分電盤', '電灯分岐'),
    }),
  ]
  const input = {
    fixtures,
    index: QuantityIndex.build(fixtures.map(f => count(`a-${f.id}`, f.id)), fixtures),
    pdfName: '順序.pdf',
  }
  const [sheet] = breakdownSheets(input)
  expect(sheet.cells.filter(row => row[0]?.style === 'category').map(row => row[0].value))
    .toEqual(['電気設備', '庁舎', '　電灯設備', '　　電灯分岐', '建築', '先', '　科目', '後', '　科目'])
  expect(sheet.cells.filter(row => row[0]?.style === 'borderedText').map(row => row[0].value))
    .toEqual(['分電盤', 'unknown-early', 'unknown-late', '計', 'early', '計', 'late', '計'])
})

it('sorts conditions with unset first and joins item summaries, specifications and remarks', () => {
  const fixtures = [
    fixture('board', {
      name: '分電盤', unit: '面', breakdown: position('分電盤', '電灯分岐'),
      summary: [{ label: '盤名称', value: 'L-1' }], spec: '壁掛形', remark: '盤の備考',
    }),
  ]
  const index = QuantityIndex.build([
    count('b', 'board', 'B'), count('unset', 'board'), count('a', 'board', 'A'),
  ], fixtures)
  const [sheet] = breakdownSheets({ fixtures, index, pdfName: '条件.pdf' })
  const rows = dataRows(sheet, '分電盤')
  expect(rows.map(row => row[2].value))
    .toEqual(['L-1、壁掛形', 'L-1、壁掛形、A', 'L-1、壁掛形、B'])
  expect(rows.map(row => row[3].value)).toEqual([1, 1, 1])
  expect(rows.map(row => row[1].value)).toEqual(['BOARD', 'BOARD', 'BOARD'])
  expect(rows.every(row => row[7].value === '盤の備考')).toBe(true)

  const [single] = breakdownSheets({
    fixtures, index: QuantityIndex.build([count('a', 'board', 'A')], fixtures), pdfName: '条件.pdf',
  })
  expect(dataRows(single, '分電盤')[0][2].value).toBe('L-1、壁掛形、A')
})

it('omits a code equal to the detail name while keeping the specification and summary', () => {
  const fixtures = [
    fixture('detail', {
      name: '同名', code: '同名', spec: '規格', kind: 'length',
      summary: [{ label: '形式', value: '摘要' }], breakdown: position('電線'),
    }),
  ]
  const [, details] = breakdownSheets({
    fixtures, index: QuantityIndex.build([route('r', 'detail', 2, '条件')], fixtures), pdfName: '略号.pdf',
  })
  expect(dataRows(details, '同名')[0][1].value).toBe('規格、摘要、条件')
})

it('distinguishes identical item names by code and preserves blank and same-name codes', () => {
  const fixtures = ['AC-1', 'AC-2', '', '分電盤'].map((code, order) => fixture(`board-${order}`, {
    name: '分電盤', code, order, unit: '面', spec: '壁掛形',
    breakdown: position('分電盤', '電灯分岐'),
  }))
  const [items] = breakdownSheets({
    fixtures, index: QuantityIndex.build(fixtures.map(f => count(`mark-${f.id}`, f.id)), fixtures),
    pdfName: '同名機器.pdf',
  })
  expect(dataRows(items, '分電盤').map(row => row.slice(0, 5).map(cell => cell.value)))
    .toEqual(fixtures.map(f => ['分電盤', f.code, '壁掛形', 1, '面']))
})

it('lists active separate-item codes in item order without duplicates or empty entries', () => {
  const fixtures = [
    fixture('late', { code: 'CV', order: 3, breakdown: position('電線') }),
    fixture('first', { code: 'IV', order: 0, breakdown: position('電線') }),
    fixture('duplicate', { code: 'IV', order: 1, breakdown: position('電線') }),
    fixture('blank', { code: '', order: 2, breakdown: position('電線') }),
    fixture('unused', { code: 'UNUSED', order: -1, breakdown: position('電線') }),
  ]
  const [items, details] = breakdownSheets({
    fixtures,
    index: QuantityIndex.build(fixtures.filter(f => f.id !== 'unused').map(f => count(`mark-${f.id}`, f.id)), fixtures),
    pdfName: '一式.pdf',
  })
  const row = dataRows(items, '電線')[0]
  expect(row[1].value).toBe('IV、CV')
  expect(row[3].value).toBe(1)
  expect(row[4].value).toBe('式')
  expect(row[6].formula).toBe(totalReference(details, '電線'))
})

it('rounds decimal half values correctly for each quantity kind and level', () => {
  expect(roundBreakdownQuantity(2.5, 'length', 'item')).toBe(3)
  expect(roundBreakdownQuantity(2.45, 'length', 'detail')).toBe(2.5)
  expect(roundBreakdownQuantity(2.675, 'area', 'detail')).toBe(2.68)
  expect(roundBreakdownQuantity(1.005, 'area', 'detail')).toBe(1.01)
  expect(roundBreakdownQuantity(2.675, 'volume', 'detail')).toBe(2.68)
  expect(roundBreakdownQuantity(2.5, 'count', 'detail')).toBe(3)
  expect(roundBreakdownQuantity(1.005, 'area', 'item')).toBe(1)
  expect(roundBreakdownQuantity(0.0000001, 'length', 'detail')).toBe(0)
  expect(roundBreakdownQuantity(1e308, 'area', 'detail')).toBe(1e308)
  expect(() => roundBreakdownQuantity(NaN, 'area', 'detail')).toThrow(RangeError)
})

it('marks renovation items on the item sheet and preserves detail remarks', () => {
  const fixtures = [
    fixture('remove', {
      name: '撤去する器具', breakdown: position('撤去'), remark: '既設を撤去',
    }),
  ]
  const [items, details] = breakdownSheets({
    fixtures, index: QuantityIndex.build([count('r', 'remove')], fixtures), pdfName: '改修.pdf',
  })
  expect(dataRows(items, '撤去')[0][7].value).toBe('別紙明細-1、※')
  expect(dataRows(details, '撤去する器具')[0][6].value).toBe('既設を撤去')
})

it('adds four workbook sheets for located detail fixtures and two for unlocated fixtures', () => {
  const input = sample()
  const workbook = (fixtures: readonly CountFixture[]) => quantityWorkbookSheets({
    ...input,
    fixtures,
    data: buildQuantityTableData(input.index, fixtures),
    mode: 'page',
    filters: {},
    display: {},
    drawingInfo: () => null,
  })
  expect(workbook(input.fixtures).map(sheet => sheet.name))
    .toEqual(['集計表', '明細', '細目別内訳', '別紙明細'])
  const unlocated = input.fixtures.map(f => {
    const copy = { ...f }
    delete copy.breakdown
    return copy
  })
  expect(workbook(unlocated).map(sheet => sheet.name)).toEqual(['集計表', '明細'])
})

it('writes factor, spacing and mass link bases in detail summaries and retains override totals', () => {
  const fixtures: CountFixture[] = [
    fixture('dl', { attributes: { massKg: 12 } }),
    fixture('sl'),
    fixture('cv', { kind: 'length' }),
    fixture('installation', {
      name: '器具取付', code: 'INST', breakdown: position('電線'),
      link: { kind: 'factor', sources: [{ itemId: 'dl', factor: 1 }, { itemId: 'sl', factor: 2 }] },
    }),
    fixture('spacing', {
      name: '支持材', code: 'SUP', breakdown: position('電線'),
      link: { kind: 'factor', sources: [{ itemId: 'cv', perM: 1.5 }] },
    }),
    fixture('mass', {
      name: '発生材', code: 'WASTE', breakdown: position('電線'),
      link: { kind: 'mass', sources: [{ itemId: 'dl' }], densityTPerM3: 0.5 },
    }),
    fixture('override', {
      name: '上書き取付', code: 'OVR', breakdown: position('電線'),
      link: {
        kind: 'factor', sources: [{ itemId: 'dl', factor: 1 }, { itemId: 'sl', factor: 2 }],
        override: { value: 10, note: '現場指示' },
      },
    }),
    fixture('board', {
      name: '分電盤', unit: '面', breakdown: position('分電盤', '電灯分岐'),
      link: { kind: 'factor', sources: [{ itemId: 'dl', factor: 2 }] },
    }),
  ]
  const index = QuantityIndex.build([
    count('dl1', 'dl'), count('dl2', 'dl'), count('dl3', 'dl'),
    count('sl1', 'sl'), route('cv1', 'cv', 3.2),
  ], fixtures)
  const [items, details] = breakdownSheets({ fixtures, index, pdfName: '連動.pdf' })
  const installation = dataRows(details, '器具取付')[0]
  expect(installation[1].value).toBe('INST、連動: DL×1、SL×2')
  expect(installation[2].value).toBe(5)
  const spacing = dataRows(details, '支持材')[0]
  expect(spacing[1].value).toBe('SUP、連動: CV÷1.5m')
  expect(spacing[2].value).toBe(3)
  const mass = dataRows(details, '発生材')[0]
  expect(mass[1].value).toBe('WASTE、連動: DL×12kg÷1000÷0.5t/㎥')
  expect(mass[2].value).toBe(0.07)
  expect(mass[2].style).toBe('borderedDecimal')
  const override = dataRows(details, '上書き取付')
  expect(override).toHaveLength(1)
  expect(override[0][1].value).toBe('OVR、連動: DL×1、SL×2')
  expect(override[0][2].value).toBe(10)
  expect(dataRows(items, '分電盤')[0][3].value).toBe(6)
})

it('limits a linked detail basis to 60 characters including the ellipsis without splitting Unicode characters', () => {
  const sources = Array.from({ length: 12 }, (_, i) => fixture(`source-${i}`, {
    code: `SRC${String(i).padStart(2, '0')}長い略号💡`,
  }))
  const linked = fixture('long', {
    name: '長い連動', code: 'LONG', breakdown: position('電線'),
    link: {
      kind: 'factor',
      sources: sources.map((source, i) => ({ itemId: source.id, factor: i + 1 })),
    },
  })
  const fixtures = [...sources, linked]
  const index = QuantityIndex.build(sources.map(f => count(`mark-${f.id}`, f.id)), fixtures)
  const [, details] = breakdownSheets({ fixtures, index, pdfName: '長い根拠.pdf' })
  const row = dataRows(details, '長い連動')[0]
  const full = `連動: ${sources.map((source, i) => `${source.code}×${i + 1}`).join('、')}`
  const expected = `${Array.from(full).slice(0, 59).join('')}…`
  expect(row[1].value).toBe(`LONG、${expected}`)
  expect(Array.from(expected)).toHaveLength(60)
  expect(row[2].value).toBe(78)
  expect(expected).not.toContain('\uFFFD')
})

it('keeps a linked detail basis of exactly 60 characters without adding an ellipsis', () => {
  const source = fixture('source', { code: 'A'.repeat(54) })
  const linked = fixture('linked', {
    name: '境界の連動', code: 'LINK', breakdown: position('電線'),
    link: { kind: 'factor', sources: [{ itemId: source.id, factor: 1 }] },
  })
  const fixtures = [source, linked]
  const index = QuantityIndex.build([count('mark', source.id)], fixtures)
  const [, details] = breakdownSheets({ fixtures, index, pdfName: '境界.pdf' })
  const basis = `連動: ${source.code}×1`
  expect(Array.from(basis)).toHaveLength(60)
  expect(dataRows(details, '境界の連動')[0][1].value).toBe(`LINK、${basis}`)
})

it('does not change fixtures or the quantity index when projecting the breakdown', () => {
  const input = sample()
  const before = JSON.stringify(input.fixtures)
  const totals = input.fixtures.map(f => input.index.total(f.id))
  const conditions = input.fixtures.map(f => [...input.index.byCondition(f.id)]
    .map(([key, total]) => [key, total.total, [...total.annotationIds]]))
  breakdownSheets(input)
  expect(JSON.stringify(input.fixtures)).toBe(before)
  expect(input.fixtures.map(f => input.index.total(f.id))).toEqual(totals)
  expect(input.fixtures.map(f => [...input.index.byCondition(f.id)]
    .map(([key, total]) => [key, total.total, [...total.annotationIds]]))).toEqual(conditions)
})
