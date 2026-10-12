import { expect, it } from 'vitest'
import { nextCountStyle, quantityUnit, type CountFixture } from '../src/core/countFixtures'
import { LINK_RULES, linkRuleForDetail } from '../src/core/breakdown/linkRules'
import { QuantityIndex } from '../src/core/quantityIndex'
import type { XlsxCell } from '../src/core/xlsxWriter'
import { buildQuantityTableData } from '../src/app/QuantityTable'
import { quantityWorkbookSheets } from '../src/app/quantityXlsx'

const fixture = (id: string, changes: Partial<CountFixture> = {}): CountFixture => ({
  id,
  code: id.toUpperCase(),
  name: `${id}の名称`,
  order: 0,
  category: '電気',
  style: nextCountStyle([]),
  ...changes,
})

const count = (id: string, fixtureId: string, condition?: string) => ({
  id,
  pageIndex: 0,
  count: { version: 2 as const, id, fixtureId, condition },
})

function basisRows(fixtures: CountFixture[], index: QuantityIndex): XlsxCell[][] {
  const sheets = quantityWorkbookSheets({
    fixtures,
    index,
    data: buildQuantityTableData(index, fixtures),
    mode: 'page',
    filters: {},
    display: { allConditions: true },
    drawingInfo: () => null,
    pdfName: '連動の試験.pdf',
  })
  const sheet = sheets.find(value => value.name === '計算根拠')
  expect(sheet).toBeDefined()
  return sheet!.cells.map(row => [...row])
}

function section(rows: XlsxCell[][], item: CountFixture): XlsxCell[][] {
  const heading = `${item.code} ${item.name}（${quantityUnit(item)}）`
  const start = rows.findIndex(row => row[0]?.value === heading)
  expect(start).toBeGreaterThanOrEqual(0)
  let end = rows.length
  for (let i = start + 1; i < rows.length; i++) {
    if (rows[i][0]?.style === 'category') {
      end = i
      break
    }
  }
  return rows.slice(start, end)
}

it('係数の自動の元を備考に示し、手動の元と区別して後から増えた項目も反映する', () => {
  const rule = linkRuleForDetail('器具取付')!
  const dl = fixture('dl', { name: 'ダウンライト', category: '照明器具' })
  const sl = fixture('sl', { name: 'スポットライト', category: '照明器具' })
  const panel = fixture('panel', { category: '盤類' })
  const installation = fixture('installation', {
    name: '器具取付',
    link: {
      kind: rule.kind,
      sources: [{ itemId: dl.id, factor: 2 }],
      auto: rule.auto,
      factor: rule.factor,
    },
  })
  const fixtures = [dl, sl, panel, installation]
  const index = QuantityIndex.build([
    count('dl-1', dl.id),
    count('dl-2', dl.id),
    count('sl-1', sl.id),
    count('panel-1', panel.id),
  ], fixtures)
  const rows = section(basisRows(fixtures, index), installation)
  const manual = rows.find(row => row[2]?.value === dl.code)!
  const automatic = rows.find(row => row[2]?.value === sl.code)!
  expect(manual[6].value).toBe('× 2')
  expect(manual[7].value).toBe(4)
  expect(manual[8].value).not.toContain('自動')
  expect(automatic[6].value).toBe('× 1')
  expect(automatic[7].value).toBe(1)
  expect(automatic[8].value).toContain('（自動）')
  expect(rows.some(row => row[2]?.value === panel.code)).toBe(false)
  expect(rows.find(row => row[0]?.value === '合計')?.[7].value).toBe(5)

  const added = fixture('added', { category: '照明器具' })
  const nextFixtures = [...fixtures, added]
  const nextIndex = QuantityIndex.build([
    count('dl-1', dl.id),
    count('dl-2', dl.id),
    count('sl-1', sl.id),
    count('added-1', added.id),
  ], nextFixtures)
  const nextRows = section(basisRows(nextFixtures, nextIndex), installation)
  expect(nextRows.find(row => row[2]?.value === added.code)?.[8].value).toContain('（自動）')
  expect(nextRows.find(row => row[0]?.value === '合計')?.[7].value).toBe(6)
})

it('10mの配管撤去の自動・JISのnote・種類の見かけ比重を備考に示す', () => {
  const rule = linkRuleForDetail('発生材処分')!
  const conduit = fixture('conduit', {
    code: 'E25',
    name: '配管撤去',
    kind: 'length',
    conditions: ['撤去（廃棄）', '新設'],
  })
  const waste = fixture('waste', {
    name: '発生材処分',
    attributes: { wasteType: '金属くず' },
    link: { kind: rule.kind, sources: [], auto: rule.auto },
  })
  const fixtures = [conduit, waste]
  const annotations = [
    {
      id: 'removed',
      pageIndex: 0,
      vertices: [[0, 0], [10, 0]] as [number, number][],
      measure: { mmPerPoint: 1000 },
      quantity: {
        version: 1 as const,
        id: 'removed',
        itemId: conduit.id,
        method: 'polyline' as const,
        cond: { plan: '撤去（廃棄）' },
      },
    },
    {
      id: 'new',
      pageIndex: 0,
      vertices: [[0, 0], [20, 0]] as [number, number][],
      measure: { mmPerPoint: 1000 },
      quantity: {
        version: 1 as const,
        id: 'new',
        itemId: conduit.id,
        method: 'polyline' as const,
        cond: { plan: '新設' },
      },
    },
  ]
  const index = QuantityIndex.build(annotations, fixtures)
  expect(quantityUnit(waste)).toBe('㎥')
  expect(index.linkResult(waste.id)?.densityTPerM3).toBe(1.13)
  const rows = section(basisRows(fixtures, index), waste)
  const source = rows.find(row => row[2]?.value === 'E25')!
  expect(source[4].value).toBe(10)
  expect(source[5].value).toBe('m')
  expect(source[6].value).toBe('× 0.716 kg ÷ 1000 ÷ 1.13 t/㎥')
  expect(source[7].value).toBeCloseTo(10 * 0.716 / 1000 / 1.13, 12)
  expect(source[8].value).toContain('（自動）')
  expect(source[8].value).toContain('施工条件: 撤去（廃棄）')
  expect(source[8].value).toContain('（JIS C 8305 の質量）')
  expect(source[8].value).toContain('÷ 1.13 t/㎥（金属くず）')
  const total = rows.find(row => row[0]?.value === '合計')!
  expect(total[7].value).toBeCloseTo(10 * 0.716 / 1000 / 1.13, 12)
  expect(total[8].value).toContain('÷ 1.13 t/㎥（金属くず）')

  const overriddenDensity: CountFixture = {
    ...waste,
    link: { ...waste.link!, densityTPerM3: 0.5 },
  }
  const overriddenFixtures = [conduit, overriddenDensity]
  const overriddenIndex = QuantityIndex.build(annotations, overriddenFixtures)
  const overriddenRows = section(
    basisRows(overriddenFixtures, overriddenIndex), overriddenDensity,
  )
  const overriddenSource = overriddenRows.find(row => row[2]?.value === 'E25')!
  expect(overriddenSource[6].value).toContain('÷ 0.5 t/㎥')
  expect(overriddenSource[7].value).toBeCloseTo(10 * 0.716 / 1000 / 0.5, 12)
  expect(overriddenSource[8].value).toContain('÷ 0.5 t/㎥')
  expect(overriddenSource[8].value).not.toContain('（金属くず）')
})

it('搬入の種類・重量品の補正率・単独搬入を計算と備考に示す', () => {
  const rule = linkRuleForDetail('機器搬入')!
  const panel = fixture('panel', {
    code: 'P-1',
    name: '盤 P-1',
    category: '盤類',
    attributes: { massKg: 1200, widthMm: 800, depthMm: 400, heightMm: 1800 },
  })
  const carry = fixture('carry', {
    name: '機器搬入',
    link: { kind: rule.kind, sources: [], auto: rule.auto, carry: { class: 'heavy' } },
  })
  const alone = fixture('alone', {
    name: '機器搬入（単独）',
    link: {
      kind: rule.kind, sources: [], auto: rule.auto,
      carry: { class: 'heavy', alone: true },
    },
  })
  const fixtures = [panel, carry, alone]
  const index = QuantityIndex.build([count('panel-1', panel.id)], fixtures)
  const allRows = basisRows(fixtures, index)

  const rows = section(allRows, carry)
  expect(rows[0][1].value).toBe('機器搬入・搬出')
  const source = rows.find(row => row[2]?.value === 'P-1')!
  expect(source[6].value).toBe('× 質量 1200kg × 補正率 0.85 ÷ 1000')
  expect(source[7].value).toBeCloseTo(1.02, 12)
  expect(source[8].value).toContain('（自動）')
  expect(source[8].value).toContain('区分: 重量品')
  expect(source[8].value).toContain('補正率 0.85')
  expect(rows.find(row => row[0]?.value === '合計')?.[7].value).toBeCloseTo(1.02, 12)

  const aloneRows = section(allRows, alone)
  const aloneSource = aloneRows.find(row => row[2]?.value === 'P-1')!
  expect(aloneSource[7].value).toBeCloseTo(1.326, 12)
  expect(aloneSource[8].value).toContain('補正率 1.105')
  expect(aloneSource[8].value).toContain('単独搬入・30％増し')
  expect(aloneRows.find(row => row[0]?.value === '合計')?.[7].value)
    .toBeCloseTo(1.326, 12)
})

it('容積品と区分違いで除外した元のnoteを備考に示す', () => {
  const rule = LINK_RULES.find(item => item.id === 'carry-in')!
  const bulky = fixture('bulky', {
    attributes: { massKg: 150, widthMm: 1000, depthMm: 1000, heightMm: 2000 },
  })
  const heavy = fixture('heavy', {
    attributes: { massKg: 1200, widthMm: 800, depthMm: 400, heightMm: 1800 },
  })
  const carry = fixture('carry', {
    name: '機器搬入',
    link: { kind: rule.kind, sources: [], auto: rule.auto, carry: { class: 'bulky' } },
  })
  const fixtures = [bulky, heavy, carry]
  const index = QuantityIndex.build([
    count('bulky-1', bulky.id),
    count('heavy-1', heavy.id),
  ], fixtures)
  const rows = section(basisRows(fixtures, index), carry)
  const included = rows.find(row => row[2]?.value === bulky.code)!
  expect(included[7].value).toBeCloseTo(0.375, 12)
  expect(included[8].value).toContain('区分: 容積品')
  expect(included[8].value).toContain('補正率 2.5')
  const excluded = rows.find(row => row[2]?.value === heavy.code)!
  expect(excluded[7].value).toBe(0)
  expect(excluded[8].value).toContain('（重量品）')
  expect(excluded[8].value).toContain('区分: 重量品')
  expect(excluded[8].value).toContain('補正率 適用なし')
})
