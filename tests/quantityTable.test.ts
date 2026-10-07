import { expect, it, vi } from 'vitest'
import { nextCountStyle, type CountFixture, type QuantityKind } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import { buildQuantityTable, buildQuantityTableData, projectQuantityTable } from '../src/app/QuantityTable'
import { revealPickup } from '../src/app/QuantityBreakdown'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import type { DocumentSession } from '../src/app/documentModel'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'

const fixture = (id: string, order = 0, category = '電気', kind: QuantityKind = 'count'): CountFixture => ({
  id, code: id.toUpperCase(), name: `${id}の名称`, order, category, kind, style: nextCountStyle([]),
})
const count = (id: string, pageIndex: number, fixtureId = 'led', floor?: string, room?: string) => ({
  id, pageIndex, count: { version: 2 as const, id, fixtureId, floor, room },
})
const info = (p: number) => p === 1 ? { number: 'E-101', name: '1階電灯設備平面図' } : null
const sampleFixtures = [fixture('led', 2), fixture('cv', 0, '電気', 'length'), fixture('other', 1, '機械')]
const annotations = [count('a', 2, 'led', '2階'), count('b', 0, 'led', '1階'), count('c', 0, 'led', '1階'),
  count('d', 1, 'led', '1階', '事務室'), count('e', 1, 'led', '1階', '事務室'), count('f', 1, 'led', '1階', '事務室')]
const sampleIndex = QuantityIndex.build(annotations, sampleFixtures)

it('uses only occupied pages, their numeric order and the drawing number/name', () => {
  const result = buildQuantityTable(sampleIndex, sampleFixtures, 'page', {}, info)
  expect(result.columns.map(c => [c.pageIndex, c.heading, c.subheading])).toEqual([
    [0, 'p.1', ''], [1, 'E-101', '1階電灯設備平面図'], [2, 'p.3', ''],
  ])
  // Same grouping/order as the quantity panel, including unused fixtures.
  expect(result.rows.map(r => r.item?.fixture.id ?? r.category)).toEqual(['電気', 'cv', 'led', '機械', 'other'])
  for (const row of result.rows) if (row.item) expect(row.item.total).toBe(sampleIndex.total(row.item.fixture.id))
  const led = result.rows.find(r => r.item?.fixture.id === 'led')!.item!
  expect([...led.values.page]).toEqual([['0', 2], ['1', 3], ['2', 1]])
  expect(led.total).toBe(6)
})

it('orders basement, ordinary, roof and missing floors and keeps rooms within each floor', () => {
  const floors = ['', 'RF', '2階', 'B1階', '1階']
  const index = QuantityIndex.build(floors.map((floor, p) => count(String(p), p, 'led', floor, '事務室')), [fixture('led')])
  const result = buildQuantityTable(index, [fixture('led')], 'floor', {}, info)
  expect(result.columns.map(c => c.heading)).toEqual(['B1階', '1階', '2階', 'RF', '（階なし）'])
  const rooms = buildQuantityTable(sampleIndex, sampleFixtures, 'room', {}, info)
  expect(rooms.columns.map(c => [c.heading, c.subheading])).toEqual([
    ['1階', '（部屋なし）'], ['1階', '事務室'], ['2階', '（部屋なし）'],
  ])
  expect(rooms.rows.find(r => r.item?.fixture.id === 'led')!.item!.values.room.get(JSON.stringify(['1階', '事務室']))).toBe(3)
  expect(buildQuantityTable(sampleIndex, sampleFixtures, 'floor', {}, info).rows.find(r => r.item?.fixture.id === 'led')!.item!.values.floor.get('1階')).toBe(5)
})

it('filters exact category/kind and case-insensitive name/code without re-reading entries', () => {
  const data = buildQuantityTableData(sampleIndex, sampleFixtures)
  const entries = vi.spyOn(sampleIndex, 'entries').mockImplementation(() => { throw new Error('Do not revisit index entries') })
  const ids = (filters: Parameters<typeof projectQuantityTable>[2]) => projectQuantityTable(data, 'page', filters, info).rows.flatMap(r => r.item ? [r.item.fixture.id] : [])
  expect(ids({ category: '機械' })).toEqual(['other'])
  expect(ids({ kind: 'length' })).toEqual(['cv'])
  expect(ids({ search: ' LeD ' })).toEqual(['led'])
  expect(ids({ search: 'otherの名称' })).toEqual(['other'])
  expect(ids({ category: '機械', search: 'led' })).toEqual([])
  expect(entries).not.toHaveBeenCalled(); entries.mockRestore()
})

it('caps every mode at 80 columns, reports omissions and recomputes columns after filtering', () => {
  const fixtures = [fixture('led'), fixture('other', 1, '機械')]
  const index = QuantityIndex.build(Array.from({ length: 100 }, (_, i) => count(String(i), i,
    i < 90 ? 'led' : 'other', `${i + 1}階`, `部屋${i}`)), fixtures)
  for (const mode of ['page', 'floor', 'room'] as const) {
    const result = buildQuantityTable(index, fixtures, mode, {}, info)
    expect(result.columns).toHaveLength(80); expect(result.omittedColumns).toBe(20)
    const filtered = buildQuantityTable(index, fixtures, mode, { category: '機械' }, info)
    expect(filtered.columns).toHaveLength(10); expect(filtered.omittedColumns).toBe(0)
  }
  expect(buildQuantityTable(index, fixtures, 'page', {}, info).columns.map(c => c.pageIndex)).toEqual(Array.from({ length: 80 }, (_, i) => i))
})

it('keeps route extras, decimal values and totals supplied by the index', () => {
  const fixtures = [fixture('cv', 0, '電気', 'length'), fixture('em', 1, '電気', 'length')]
  const index = QuantityIndex.build([{ id: 'route', pageIndex: 1, vertices: [[0, 0], [12.35, 0]], measure: { mmPerPoint: 1000 },
    quantity: { version: 1, id: 'route', itemId: 'cv', method: 'polyline', count: 2, extra: [{ itemId: 'em', count: 1 }], floor: '1階', room: '事務室' } }], fixtures)
  for (const mode of ['page', 'floor', 'room'] as const) {
    const result = buildQuantityTable(index, fixtures, mode, {}, info)
    expect(result.rows.find(r => r.item?.fixture.id === 'cv')!.item!.total).toBeCloseTo(24.7)
    expect(result.rows.find(r => r.item?.fixture.id === 'em')!.item!.total).toBeCloseTo(12.35)
  }
})

it('builds a table from 1000 fixtures / 100 pages / 10000 index entries in under 50ms median', () => {
  const fixtures = Array.from({ length: 1000 }, (_, i) => fixture('f' + i, i))
  const index = QuantityIndex.build(Array.from({ length: 10000 }, (_, i) => count(String(i),
    (i % 100 + Math.floor(i / 1000) * 7) % 100, 'f' + (i % 1000), `${i % 10 + 1}階`, `部屋${i % 30}`)), fixtures)
  buildQuantityTable(index, fixtures, 'page', {}, info)
  const times: number[] = []
  for (let i = 0; i < 9; i++) {
    const start = performance.now(), result = buildQuantityTable(index, fixtures, 'page', {}, info)
    times.push(performance.now() - start)
    expect(result.columns).toHaveLength(80); expect(result.omittedColumns).toBe(20)
    expect(result.rows.find(r => r.item?.fixture.id === 'f0')!.item!.total).toBe(10)
  }
  const median = [...times].sort((a, b) => a - b)[4]
  console.log('QuantityTable 1000 items / 100 pages / 10000 entries ms: ' + JSON.stringify({ times, median }))
  expect(median).toBeLessThan(50)
})

it('reveals and flashes only the chosen pickup, clears in 1500ms and never changes edits/history/index', async () => {
  vi.useFakeTimers()
  try {
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => [fixture('led')], async () => {})
    await store.ensurePageLoaded(1, async () => [])
    const mark = store.create({ kind: 'symbol', pageIndex: 1, rect: [10, 20, 20, 30], count: { version: 2, id: 'a', fixtureId: 'led' } })
    const session = { annotationStore: store, docId: 'test', pageRevision: 0 } as DocumentSession
    const pool = { listAnnotations: vi.fn(async () => []) } as unknown as PdfWorkerPool
    store.setFixtureVisible(['led'], false)
    const index = store.quantityIndex(), edits = store.toEdits(), navigate = vi.fn()
    expect(await revealPickup(session, pool, 'led', mark.id, 1, navigate)).toBe(true)
    expect(store.selectedIds()).toEqual([mark.id]); expect(store.isFixtureVisible('led')).toBe(true)
    expect(navigate).toHaveBeenCalledWith(1, mark.rect); expect(store.flashId).toBe(mark.id)
    const flashVersion = store.flashVersion
    vi.advanceTimersByTime(1000); store.flashPickup(mark.id)
    expect(store.flashVersion).toBe(flashVersion + 1)
    vi.advanceTimersByTime(500); expect(store.flashId).toBe(mark.id)
    vi.advanceTimersByTime(1000); expect(store.flashId).toBeNull()
    expect(store.quantityIndex()).toBe(index); expect(store.toEdits()).toEqual(edits)
    // Flash did not add an undo step; the last data edit was creation.
    store.undo(); expect(store.get(mark.id)).toBeUndefined()
  } finally { vi.useRealTimers() }
})

it('does not navigate or select after its caller is unmounted', async () => {
  const store = new AnnotationStore(), session = { annotationStore: store, docId: 'test', pageRevision: 0 } as DocumentSession
  const pool = { listAnnotations: async () => [] } as unknown as PdfWorkerPool, navigate = vi.fn()
  expect(await revealPickup(session, pool, 'led', 'absent', 0, navigate, () => false)).toBe(false)
  expect(navigate).not.toHaveBeenCalled(); expect(store.flashId).toBeNull()
})
