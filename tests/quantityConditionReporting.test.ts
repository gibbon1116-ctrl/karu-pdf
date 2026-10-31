import { expect, it, vi } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { quantityValue, type QuantityMark } from '../src/core/quantity'
import { QuantityIndex, quantityPartSummary } from '../src/core/quantityIndex'
import { buildQuantityTableData, projectQuantityTable } from '../src/app/QuantityTable'
import { createQuantityCsv, QUANTITY_DETAIL_HEADER, QUANTITY_SUMMARY_HEADER } from '../src/app/annotationCsv'
import { nextReview, reviewOrder } from '../src/app/reviewCursor'

const fixture = (id: string, kind: CountFixture['kind'] = 'length', conditions?: string[]): CountFixture => ({
  id, code: id.toUpperCase(), name: id, spec: '規格' + id, category: '電気', order: 0, kind, conditions, style: nextCountStyle([]),
})
const route = (id: string, length: number, options: Partial<QuantityMark> = {}, pageIndex = 0) => ({
  id, pageIndex, rect: [0, length, 20, length + 1] as [number, number, number, number],
  vertices: [[0, 0], [length, 0]] as [number, number][], measure: { mmPerPoint: 1000 },
  quantity: { version: 1 as const, id, itemId: 'cv', method: 'polyline' as const, ...options },
})
const fixtures = [fixture('cv', 'length', ['ラック', '管内']), fixture('pf', 'length', ['露出']), fixture('rack')]
const routes = ['ラック', '管内'].map((plan, i) => route('r' + i, 10 + i * 10, {
  floor: '1階', room: '事務室', count: 2, rises: [{ m: 2 }, { m: 3 }], slackM: 1,
  cond: { plan, rise: ['管内', 'ラック'] }, extra: [
    { itemId: 'pf', count: 3, cond: { plan: null, rise: '露出', slack: null } },
    { itemId: 'rack', count: 1, cond: { plan: 'ラック', rise: null, slack: null } },
  ],
}))
const index = QuantityIndex.build(routes, fixtures)
// These cases deliberately have no commas/quotes in their fields.
const parse = (csv: string) => {
  const [header, ...rows] = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map(row => row.split(','))
  return { header, rows, records: rows.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]]))) }
}

it('builds all modes and condition/part totals in one entry pass per item', () => {
  const read = vi.spyOn(index, 'entries')
  const data = buildQuantityTableData(index, fixtures)
  expect(read).toHaveBeenCalledTimes(fixtures.length)
  for (const item of data) {
    expect([...item.byCondition.values()].reduce((n, condition) => n + condition.total, 0)).toBe(index.total(item.fixture.id))
    for (const mode of ['page', 'floor', 'room'] as const) for (const [key, value] of item.values[mode]) {
      expect([...item.byCondition.values()].reduce((n, condition) => n + (condition.values[mode].get(key) ?? 0), 0)).toBe(value)
    }
  }
  const cv = data.find(item => item.fixture.id === 'cv')!
  expect(cv.total).toBe(84)
  expect(cv.byCondition.get('ラック')).toMatchObject({ total: 32, plan: 20, rise: 12, slack: 0 })
  expect(cv.byCondition.get('管内')).toMatchObject({ total: 48, plan: 40, rise: 8, slack: 0 })
  expect(cv.byCondition.get('')).toMatchObject({ total: 4, plan: 0, rise: 0, slack: 4 })
  expect(quantityPartSummary(cv.byCondition.get('')!)).toBe('その他の加算 4.0')
  expect(quantityPartSummary(cv.byCondition.get('ラック')!)).toBe('平面 20.0 ／ 立上り・立下り 12.0')
  read.mockRestore()
})

it('projects expansion, modes, search and unset targets without revisiting the index', () => {
  const all = [...fixtures, fixture('old'), fixture('empty', 'count', []), fixture('unused', 'length', ['露出'])]
  const source = QuantityIndex.build([...routes, { ...route('old', 4), quantity: { ...route('old', 4).quantity, itemId: 'old' } },
    { id: 'empty', pageIndex: 0, count: { version: 2, id: 'empty', fixtureId: 'empty' } }], all)
  const data = buildQuantityTableData(source, all)
  const read = vi.spyOn(source, 'entries').mockImplementation(() => { throw new Error('Index rescan') })
  const rows = (mode: 'page' | 'floor' | 'room', unsetOnly = false) => projectQuantityTable(data, mode, { unsetOnly }, () => null, { allConditions: true }).rows
  for (const mode of ['page', 'floor', 'room'] as const) {
    expect(rows(mode).filter(row => row.conditionKey !== undefined).map(row => row.conditionKey)).toEqual(['ラック', '管内', ''])
    expect(rows(mode, true).filter(row => row.item).map(row => [row.item!.fixture.id, row.conditionKey])).toEqual([['cv', undefined], ['cv', '']])
    expect(projectQuantityTable(data, mode, { search: 'cv' }, () => null, { expanded: { cv: true } }).rows).toHaveLength(5)
    expect(projectQuantityTable(data, mode, {}, () => null, { allConditions: true, expanded: { cv: false } }).rows.some(row => row.conditionKey !== undefined)).toBe(false)
  }
  expect(read).not.toHaveBeenCalled(); read.mockRestore()
  // Passing the same per-ID state to a rebuilt index preserves expansion.
  const rebuilt = buildQuantityTableData(QuantityIndex.build(routes.slice(0, 1), all), all)
  expect(projectQuantityTable(rebuilt, 'page', {}, () => null, { expanded: { cv: true } }).rows.filter(row => row.conditionKey !== undefined)).toHaveLength(3)
})

it('keeps condition review orders deduplicated and independent for every column', () => {
  const sourceRoutes = [route('a', 10, { cond: { plan: 'ラック', rise: 'ラック' }, addM: 2 }),
    route('b', 20, { cond: { plan: '管内' } }), route('c', 30, { cond: { plan: 'ラック' } })]
  const data = buildQuantityTableData(QuantityIndex.build(sourceRoutes, fixtures), fixtures)[0]
  const marks = new Map(sourceRoutes.map(a => [a.id, a]))
  const order = reviewOrder(data.byCondition.get('ラック')!.reviewEntries.page.get('0')!, id => marks.get(id))
  expect(order).toEqual(['a', 'c'])
  const first = nextReview(order, null)!
  expect(nextReview(order, first)?.id).toBe('c')
  expect(nextReview(['c'], first)?.id).toBe('c')
  expect(reviewOrder(data.byCondition.get('管内')!.entries, id => marks.get(id))).toEqual(['b'])
})

it('removes the last unset target after an index update without clearing per-item expansion', () => {
  const display = { expanded: { cv: true } }, filters = { unsetOnly: true }
  const before = buildQuantityTableData(index, fixtures)
  expect(projectQuantityTable(before, 'page', filters, () => null, display).rows.filter(row => row.item)).toHaveLength(2)
  const assigned = routes.map(a => ({ ...a, quantity: { ...a.quantity, cond: { ...a.quantity.cond, slack: 'ラック' } } }))
  const updated = buildQuantityTableData(QuantityIndex.build(assigned, fixtures), fixtures)
  expect(projectQuantityTable(updated, 'page', filters, () => null, display).rows).toEqual([])
  expect(projectQuantityTable(updated, 'page', {}, () => null, display).rows.filter(row => row.conditionKey !== undefined).map(row => row.conditionKey)).toEqual(['ラック', '管内'])
})

it('exports exact headers, condition and material rows and three distinct sections', () => {
  const summary = parse(createQuantityCsv(index, fixtures, 0, 'summary'))
  const detail = parse(createQuantityCsv(index, fixtures, 0, 'detail'))
  expect(summary.header).toEqual([...QUANTITY_SUMMARY_HEADER, '表示中の図面（p.1）', 'p.1'])
  expect(detail.header).toEqual(QUANTITY_DETAIL_HEADER)
  const cv = summary.records.filter(row => row['略号'] === 'CV')
  expect(cv.map(row => [row['施工条件'], row['集計区分'], row['全図面の合計']])).toEqual([
    ['ラック', '施工条件別', '32.00'], ['管内', '施工条件別', '48.00'], ['', '施工条件別', '4.00'], ['', '材料計', '84.00'],
  ])
  expect(summary.records.filter(row => row['略号'] === 'PF')).toHaveLength(1)
  const parts = detail.records.filter(row => row['略号'] === 'CV')
  expect(new Set(parts.map(row => row['区間']))).toEqual(new Set(['平面', '立上り・立下り', 'その他の加算']))
  expect(parts.find(row => row['施工条件'] === '管内' && row['区間'] === '立上り・立下り')).toMatchObject({ 数量: '8.00', 拾いの件数: '2' })
  expect(detail.records.find(row => row['略号'] === 'PF')).toMatchObject({ 施工条件: '露出', 区間: '立上り・立下り', 数量: '30.00', 拾いの件数: '2' })
  for (const fixture of fixtures) {
    const conditionRows = summary.records.filter(row => row['略号'] === fixture.code && row['集計区分'] === '施工条件別')
    const sum = conditionRows.reduce((n, row) => n + Number(row['全図面の合計']), 0)
    expect(sum).toBe(index.total(fixture.id))
    expect(detail.records.filter(row => row['略号'] === fixture.code).reduce((n, row) => n + Number(row['数量']), 0)).toBe(sum)
    for (const condition of conditionRows) {
      expect(detail.records.filter(row => row['略号'] === fixture.code && row['施工条件'] === condition['施工条件']).reduce((n, row) => n + Number(row['数量']), 0)).toBe(Number(condition['全図面の合計']))
    }
    const material = summary.records.find(row => row['略号'] === fixture.code && row['集計区分'] === '材料計')
    if (material) expect(Number(material['全図面の合計'])).toBe(sum)
  }
})

it('counts one route with two rises once in the same detail row and leaves non-lines sections blank', () => {
  const f = [fixture('cv'), fixture('led', 'count', ['露出']), fixture('area', 'area', ['室内']), fixture('volume', 'volume')]
  const annotations = [route('one', 10, { rises: [{ m: 2 }, { m: 3 }], count: 2, cond: { plan: '露出', rise: '露出' } }),
    { id: 'led', pageIndex: 0, count: { version: 2 as const, id: 'led', fixtureId: 'led', condition: '露出' } },
    { ...route('area', 3), quantity: { version: 1 as const, id: 'area', itemId: 'area', method: 'lengthHeight' as const, heightM: 2, condition: '室内' } },
    { ...route('volume', 3), quantity: { version: 1 as const, id: 'volume', itemId: 'volume', method: 'lengthWidthDepth' as const, widthM: 2, depthM: 2 } }]
  const source = QuantityIndex.build(annotations, f)
  const detail = parse(createQuantityCsv(source, f, 0, 'detail')).records
  expect(detail.filter(row => row['略号'] === 'CV').map(row => [row['区間'], row['数量'], row['拾いの件数']])).toEqual([['平面', '20.00', '1'], ['立上り・立下り', '10.00', '1']])
  expect(detail.filter(row => row['略号'] !== 'CV').every(row => row['区間'] === '')).toBe(true)
  const summary = parse(createQuantityCsv(source, f, 0, 'summary')).records
  expect(summary.filter(row => row['略号'] !== 'CV').every(row => ['平面', '立上り・立下り', 'その他の加算'].every(key => row[key] === ''))).toBe(true)
  expect(summary.some(row => row['集計区分'] === '材料計')).toBe(false)
})

it('keeps legacy quantities, a single blank condition row, BOM and CRLF', () => {
  const old = [route('old0', 9.35, { count: 2, addM: 3, slackM: 1 }), route('old1', 20, {}, 1)]
  const source = QuantityIndex.build(old, [fixtures[0]])
  const csv = createQuantityCsv(source, [fixtures[0]], 0, 'summary')
  const { records } = parse(csv)
  expect(records).toHaveLength(1)
  expect(records[0]['施工条件']).toBe('')
  const previousTotal = old.reduce((n, a) => n + quantityValue(a.vertices, a.measure.mmPerPoint, a.quantity) * (a.quantity.count ?? 1), 0)
  expect(Number(records[0]['全図面の合計'])).toBeCloseTo(previousTotal)
  expect(records[0]['表示中の図面（p.1）']).toBe('26.70')
  expect(records[0]['p.2']).toBe('20.00')
  const detail = parse(createQuantityCsv(source, [fixtures[0]], 0, 'detail')).records
  expect(detail.every(row => row['施工条件'] === '')).toBe(true)
  expect(detail.reduce((n, row) => n + Number(row['数量']), 0)).toBeCloseTo(previousTotal)
  expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv.endsWith('\r\n')).toBe(true)
  expect(csv.replaceAll('\r\n', '').includes('\n')).toBe(false)
})
