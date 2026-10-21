import { describe, expect, it } from 'vitest'
import {
  CONVERT_UNITS,
  fixtureConvertError,
  fixtureDrawingCode,
  fixtureLabelCode,
  parseCountFixtures,
  quantityDecimals,
  quantityOutputKind,
  quantityUnit,
  serializeCountFixtures,
  type CountFixture,
  type FixtureConvert,
  type FixturePreset,
} from '../src/core/countFixtures'
import { breakdownEntries, presetsFromDetail } from '../src/core/breakdownMaster'
import { QuantityIndex } from '../src/core/quantityIndex'
import { breakdownSheets, roundBreakdownQuantity } from '../src/app/breakdownXlsx'
import { createQuantityCsv, quantityDetailRows } from '../src/app/annotationCsv'
import { buildQuantityTableData } from '../src/app/QuantityTable'
import { quantityWorkbookSheets } from '../src/app/quantityXlsx'
import type { XlsxSheet } from '../src/core/xlsxWriter'

const message = '数量の換算は、係数を0より大きい数で、単位を候補から入れてください。'
const pipeConvert: FixtureConvert = {
  factor: Math.PI * 25.4 / 1000,
  unit: '㎡',
  basis: '外径 25.4mm × π',
}

function fixture(id: string, fields: Partial<CountFixture> = {}): CountFixture {
  return {
    id, name: '配管塗装', code: 'E25塗装', category: '塗装', order: 0,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 0.8, showCode: true,
    },
    ...fields,
  }
}

function fromPreset(id: string, preset: FixturePreset): CountFixture {
  return fixture(id, preset)
}

function lengthAnnotation(itemId: string, metres: number, condition = '露出', id = itemId) {
  return {
    id, pageIndex: 0,
    vertices: [[0, 0], [metres, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1 as const, id, itemId, method: 'polyline' as const,
      floor: '1階', room: '室A', cond: { plan: condition },
    },
  }
}

function countAnnotations(itemId: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${itemId}-${index}`, pageIndex: index === 2 ? 1 : 0,
    count: {
      version: 2 as const, id: `${itemId}-${index}`, fixtureId: itemId,
      floor: '1階', room: '室A', condition: '露出',
    },
  }))
}

const painting = breakdownEntries().find(entry => entry.row.name === '塗装工事' && entry.row.separate)!
const pipeTemplate = painting.details.find(template => template.name === '配管塗装')!
const boxTemplate = painting.details.find(template => template.name === 'ボックス塗装')!

function pipePreset() {
  const variant = pipeTemplate.variants!.find(candidate => candidate.spec === 'E25')!
  return presetsFromDetail(painting, pipeTemplate, [{ label: '塗料', value: 'SOP' }], undefined, [variant])[0]
}

function quantityRows(sheet: XlsxSheet, name: string) {
  const quantityColumn = sheet.cells[2].findIndex(cell => cell.value === '数量')
  return sheet.cells.filter(row => row[0]?.value === name && typeof row[quantityColumn]?.value === 'number')
}

describe('fixture conversion persistence', () => {
  it('round-trips a copied conversion without changing the other fields', () => {
    const source = fixture('pipe', {
      kind: 'length', method: 'polyline', convert: pipeConvert,
      summary: [{ label: '塗料', value: 'SOP' }],
    })
    const [parsed] = parseCountFixtures(serializeCountFixtures([source]))
    expect(parsed).toEqual(source)
    expect(parsed.convert).not.toBe(source.convert)
    parsed.convert!.basis = '変更'
    expect(source.convert!.basis).toBe('外径 25.4mm × π')
  })

  it.each([
    null,
    [],
    {},
    { factor: 0, unit: '㎡', basis: '' },
    { factor: -1, unit: '㎡', basis: '' },
    { factor: 1000001, unit: '㎡', basis: '' },
    { factor: '1', unit: '㎡', basis: '' },
    { factor: 1, unit: '個', basis: '' },
    { factor: 1, unit: '㎡', basis: 1 },
    { factor: 1, unit: '㎡', basis: 'あ'.repeat(61) },
    { factor: 1, unit: '㎡', basis: 'A\nB' },
    { factor: 1, unit: '㎡', basis: 'A\rB' },
    { factor: 1, unit: '㎡', basis: 'A\tB' },
    { factor: 1, unit: '㎡', basis: 'A\u2028B' },
    { factor: 1, unit: '㎡', basis: 'A\u2029B' },
  ])('drops only an invalid conversion on read and rejects it on save: %j', convert => {
    const original = fixture('pipe', {
      kind: 'length', method: 'polyline',
      breakdown: { book: '電気設備', section: '庁舎', subject: '電灯設備', item: '塗装工事' },
      summary: [{ label: '塗料', value: 'SOP' }],
    })
    const raw = JSON.stringify({ version: 1, fixtures: [{ ...original, convert }] })
    expect(parseCountFixtures(raw)).toEqual([original])
    const invalid = { ...original, convert } as unknown as CountFixture
    expect(fixtureConvertError(invalid)).toBe(message)
    expect(() => serializeCountFixtures([invalid])).toThrow(message)
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite factors: %s', factor => {
    expect(() => serializeCountFixtures([fixture('pipe', {
      convert: { ...pipeConvert, factor },
    })])).toThrow(message)
  })

  it('accepts the coefficient boundary, empty basis, and every output unit', () => {
    for (const unit of CONVERT_UNITS) {
      const original = fixture(unit, { convert: { factor: 1000000, unit, basis: '' } })
      expect(parseCountFixtures(serializeCountFixtures([original]))[0].convert).toEqual(original.convert)
    }
    const original = fixture('small', { convert: { factor: 0.000001, unit: '㎡', basis: 'あ'.repeat(60) } })
    expect(parseCountFixtures(serializeCountFixtures([original]))[0].convert).toEqual(original.convert)
  })
})

describe('QuantityIndex conversion', () => {
  it('converts lengths in totals, entries, pages, conditions and locations', () => {
    const f = fixture('pipe', { kind: 'length', method: 'polyline', convert: pipeConvert })
    const index = QuantityIndex.build([lengthAnnotation(f.id, 2)], [f])
    expect(index.total(f.id)).toBeCloseTo(0.1595929068, 9)
    expect(index.rawTotal(f.id)).toBe(2)
    expect(index.entries(f.id)[0].raw).toBe(2)
    expect(index.entries(f.id)[0].value).toBeCloseTo(2 * pipeConvert.factor, 12)
    expect(index.byPage(f.id).get(0)).toBeCloseTo(2 * pipeConvert.factor, 12)
    expect(index.byFloor(f.id).get('1階')).toBeCloseTo(2 * pipeConvert.factor, 12)
    expect(index.byRoom(f.id).get('室A')).toBeCloseTo(2 * pipeConvert.factor, 12)
    expect(index.byFloorRoom(f.id).get('1階')!.get('室A')).toBeCloseTo(2 * pipeConvert.factor, 12)
    const total = index.byCondition(f.id).get('露出')!
    expect(total.total).toBeCloseTo(2 * pipeConvert.factor, 12)
    expect(total.plan).toBeCloseTo(2 * pipeConvert.factor, 12)
    expect(total.raw).toBe(2)
    expect(total.annotationIds.size).toBe(1)
  })

  it('converts counts without changing mark counts or pickup counts', () => {
    const f = fixture('box', { convert: { factor: 0.12, unit: '㎡', basis: '箱の面積' } })
    const index = QuantityIndex.build(countAnnotations(f.id, 3), [f])
    expect(index.total(f.id)).toBeCloseTo(0.36, 12)
    expect(index.rawTotal(f.id)).toBe(3)
    expect(index.byCondition(f.id).get('露出')!.raw).toBe(3)
    expect(index.byCondition(f.id).get('露出')!.annotationIds.size).toBe(3)
    expect(index.countEntriesOnPage(0)).toHaveLength(2)
    expect(index.countEntriesOnPage(1)).toHaveLength(1)
    expect(index.entries(f.id).every(entry => entry.raw === 1 && entry.value === 0.12)).toBe(true)
    expect(quantityDetailRows(index, [f]).map(row => row[15])).toEqual([2, 1])
  })

  it('converts only the added member, using its excluded plan and route count', () => {
    const cable = fixture('cable', { name: 'ケーブル', code: 'EM-CE', kind: 'length', method: 'polyline' })
    const paint = fixture('paint', { kind: 'length', method: 'polyline', convert: pipeConvert })
    const annotation = lengthAnnotation(cable.id, 10)
    const index = QuantityIndex.build([{
      ...annotation,
      quantity: {
        ...annotation.quantity,
        rises: [{ m: 2 }],
        extra: [{ itemId: paint.id, count: 2, cond: { plan: null, rise: '立上り', slack: null } }],
      },
    }], [cable, paint])
    expect(index.total(cable.id)).toBe(12)
    expect(index.rawTotal(paint.id)).toBe(4)
    expect(index.total(paint.id)).toBeCloseTo(4 * pipeConvert.factor, 12)
    expect(index.byCondition(paint.id).get('立上り')!.raw).toBe(4)
    expect(index.byCondition(paint.id).get('立上り')!.rise).toBeCloseTo(4 * pipeConvert.factor, 12)
  })

  it('preserves fully excluded routes as zero-quantity occupied pages', () => {
    const f = fixture('pipe', { kind: 'length', method: 'polyline', convert: pipeConvert })
    const annotation = lengthAnnotation(f.id, 2)
    const index = QuantityIndex.build([{
      ...annotation,
      quantity: { ...annotation.quantity, cond: { plan: null, rise: null, slack: null } },
    }], [f])
    expect(index.total(f.id)).toBe(0)
    expect(index.rawTotal(f.id)).toBe(0)
    expect(index.pagesOf(f.id)).toEqual([0])
    expect(index.byFloorRoom(f.id).get('1階')!.get('室A')).toBe(0)
    expect(index.entries(f.id)).toEqual([])
  })

  it('keeps unconverted quantities and omits raw on their entries', () => {
    const line = fixture('line', { kind: 'length', method: 'polyline' })
    const count = fixture('count')
    const index = QuantityIndex.build([
      lengthAnnotation(line.id, 2),
      ...countAnnotations(count.id, 3),
    ], [line, count])
    expect(index.total(line.id)).toBe(2)
    expect(index.rawTotal(line.id)).toBe(2)
    expect(index.total(count.id)).toBe(3)
    expect(index.rawTotal(count.id)).toBe(3)
    expect(index.byCondition(line.id).get('露出')!.raw).toBe(2)
    expect(index.byCondition(count.id).get('露出')!.raw).toBe(3)
    for (const f of [line, count]) {
      expect(index.entries(f.id).every(entry => !Object.hasOwn(entry, 'raw'))).toBe(true)
    }
  })
})

describe('conversion output metadata and drawing labels', () => {
  it('uses conversion units, decimals and output kinds', () => {
    const expected = { m: 'length', '㎡': 'area', '㎥': 'volume', kg: 'mass', t: 'mass' } as const
    for (const unit of CONVERT_UNITS) {
      const f = fixture(unit, { convert: { factor: 1, unit, basis: '' } })
      expect(quantityUnit(f)).toBe(unit)
      expect(quantityDecimals(f)).toBe(2)
      expect(quantityOutputKind(f)).toBe(expected[unit])
    }
    expect(quantityDecimals(fixture('count'))).toBe(0)
    expect(quantityUnit(fixture('count', { unit: '台' }))).toBe('台')
    for (const kind of ['length', 'area', 'volume'] as const) {
      const f = fixture(kind, { kind })
      expect(quantityDecimals(f)).toBe(2)
      expect(quantityOutputKind(f)).toBe(kind)
      expect(quantityUnit(f)).toBe({ length: 'm', area: 'm²', volume: 'm³' }[kind])
    }
  })

  it('falls back to the name only in the new label helper', () => {
    const f = fixture('no-code', { code: '', kind: 'length' })
    expect(fixtureDrawingCode(f)).toBe('')
    expect(fixtureLabelCode(f)).toBe('配管塗装')
    expect(fixtureLabelCode({ ...f, code: 'E25塗装', spec: 'E25' })).toBe('E25塗装 E25')
    expect(fixtureDrawingCode({ ...f, kind: undefined })).toBe('')
  })

  it('creates E25 and E19 length variants and a converted box count', () => {
    const selected = ['E25', 'E19'].map(spec => pipeTemplate.variants!.find(candidate => candidate.spec === spec)!)
    const presets = presetsFromDetail(painting, pipeTemplate, undefined, undefined, selected)
    expect(presets).toHaveLength(2)
    expect(presets[0]).toMatchObject({
      code: 'E25塗装', spec: 'E25', kind: 'length', method: 'polyline',
      convert: { unit: '㎡' },
    })
    const [box] = presetsFromDetail(painting, boxTemplate, undefined, undefined, [boxTemplate.variants![0]])
    expect(box).toMatchObject({ kind: 'count', method: 'click', convert: { unit: '㎡' } })
  })
})

describe('conversion CSV and workbook output', () => {
  it('exports 4.0m of pipe paint as square metres with the source length and basis', () => {
    const f = fromPreset('pipe', pipePreset())
    const index = QuantityIndex.build([lengthAnnotation(f.id, 4)], [f])
    const sheets = breakdownSheets({ fixtures: [f], index, pdfName: '塗装.pdf' })
    const details = sheets.find(sheet => sheet.name === '別紙明細')!
    const [row] = quantityRows(details, '配管塗装')
    expect(row[1].value).toContain('延長 4.0m、外径 25.4mm × π')
    expect(row[1].value).toContain('SOP')
    expect(row[2]).toEqual({ value: 0.32, style: 'borderedDecimal' })
    expect(row[3].value).toBe('㎡')
    expect(index.total(f.id)).toBeCloseTo(4 * pipeConvert.factor, 12)
  })

  it('uses each condition source length rather than repeating the overall length', () => {
    const f = fromPreset('pipe', pipePreset())
    const index = QuantityIndex.build([
      lengthAnnotation(f.id, 2, '露出', 'a'),
      lengthAnnotation(f.id, 3, '隠ぺい', 'b'),
    ], [f])
    const details = breakdownSheets({ fixtures: [f], index, pdfName: '塗装.pdf' })
      .find(sheet => sheet.name === '別紙明細')!
    const rows = quantityRows(details, '配管塗装')
    expect(rows).toHaveLength(2)
    expect(rows.find(row => String(row[1].value).includes('露出'))![1].value).toContain('延長 2.0m、')
    expect(rows.find(row => String(row[1].value).includes('隠ぺい'))![1].value).toContain('延長 3.0m、')
  })

  it('adds original count and basis for box painting', () => {
    const [preset] = presetsFromDetail(painting, boxTemplate, undefined, undefined, [boxTemplate.variants![0]])
    const f = fromPreset('box', preset)
    const index = QuantityIndex.build(countAnnotations(f.id, 3), [f])
    const details = breakdownSheets({ fixtures: [f], index, pdfName: '塗装.pdf' })
      .find(sheet => sheet.name === '別紙明細')!
    const [row] = quantityRows(details, 'ボックス塗装')
    expect(row[1].value).toContain(`3か所、${f.convert!.basis}`)
    expect(row[2].style).toBe('borderedDecimal')
    expect(row[3].value).toBe('㎡')
  })

  it('keeps converted counts decimal in CSV, summary Excel and detail Excel', () => {
    const f = fixture('box', { convert: { factor: 0.12, unit: '㎡', basis: '箱の面積' } })
    const index = QuantityIndex.build(countAnnotations(f.id, 3), [f])
    const detailCsv = createQuantityCsv(index, [f], 0, 'detail')
    expect(detailCsv).toContain(',㎡,')
    expect(detailCsv).toContain(',0.24,2')
    expect(detailCsv).toContain(',0.12,1')
    expect(createQuantityCsv(index, [f], 0, 'summary')).toContain(',0.36,0.24,0.24,0.12')

    const sheets = quantityWorkbookSheets({
      data: buildQuantityTableData(index, [f]), mode: 'page',
      filters: {}, display: {}, drawingInfo: () => null,
      pdfName: '塗装.pdf', index, fixtures: [f],
    })
    const summaryRow = sheets[0].cells.find(row => row[1]?.value === f.code)!
    expect(summaryRow[4].value).toBe('㎡')
    expect(summaryRow[5].style).toBe('borderedDecimal')
    expect(summaryRow[5].value).toBeCloseTo(0.36, 12)
    const detailRows = sheets[1].cells.slice(1)
    expect(detailRows.every(row => row[14].style === 'decimal')).toBe(true)
    expect(detailRows.every(row => row[15].style === 'integer')).toBe(true)
  })

  it('uses output rounding on a converted non-separate item and preserves ordinary item rounding', () => {
    const position = { book: '電気設備' as const, section: '試験', subject: '試験', item: '独自数量' }
    const converted = fixture('converted', {
      name: '独自数量', kind: 'length', method: 'polyline',
      convert: pipeConvert, breakdown: position,
    })
    const normal = fixture('normal', {
      name: '独自数量', kind: 'length', method: 'polyline',
      breakdown: position, order: 1,
    })
    const index = QuantityIndex.build([
      lengthAnnotation(converted.id, 4),
      lengthAnnotation(normal.id, 4.4),
    ], [converted, normal])
    const [sheet] = breakdownSheets({ fixtures: [converted, normal], index, pdfName: '試験.pdf' })
    const rows = quantityRows(sheet, '独自数量')
    expect(rows[0][3]).toEqual({ value: 0.32, style: 'borderedDecimal' })
    expect(rows[0][4].value).toBe('㎡')
    expect(rows[1][3]).toEqual({ value: 4, style: 'borderedInteger' })
    expect(rows[1][4].value).toBe('m')
    expect(roundBreakdownQuantity(1.235, 'mass', 'detail')).toBe(1.24)
  })
})
