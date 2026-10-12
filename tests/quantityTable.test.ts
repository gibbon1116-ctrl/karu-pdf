import { expect, it, vi } from 'vitest'
import { nextCountStyle, type CountFixture, type QuantityKind } from '../src/core/countFixtures'
import { breakdownEntries } from '../src/core/breakdownMaster'
import { QuantityIndex } from '../src/core/quantityIndex'
import { buildQuantityTable, buildQuantityTableData, createQuantityBreakdownOrder, projectQuantityTable, QUANTITY_TABLE_FIXED_HEADERS, QUANTITY_TABLE_METADATA_HEADERS, quantityBreakdownGroupKey, quantityTableFixtureText } from '../src/app/QuantityTable'
import { revealPickup } from '../src/app/QuantityBreakdown'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import type { DocumentSession } from '../src/app/documentModel'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import { createQuantityWorkbook } from '../src/app/quantityXlsx'

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

it('provides six fixed headers and only the scrolling summary metadata', () => {
  expect(QUANTITY_TABLE_FIXED_HEADERS).toEqual([
    '見本', '略号', '名称', '規格', '単位', '全図面',
  ])
  expect(QUANTITY_TABLE_METADATA_HEADERS).toEqual(['摘要'])
  const positioned: CountFixture = {
    ...fixture('board'),
    summary: [{ label: '盤名称', value: 'L-1' }, { label: '形式', value: '壁掛形' }],
    breakdown: {
      book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item: '分電盤',
    },
  }
  expect(quantityTableFixtureText(positioned)).toEqual({ summary: 'L-1、壁掛形' })
  const withoutMiddle: CountFixture = {
    ...positioned,
    breakdown: { book: '電気設備', section: '庁舎', subject: '電灯設備', item: '分電盤' },
  }
  expect(quantityTableFixtureText(withoutMiddle)).toEqual({ summary: 'L-1、壁掛形' })
  expect(quantityTableFixtureText(fixture('missing'))).toEqual({ summary: '' })
})

it('groups known and unknown positions by minimum orders, with missing positions last', () => {
  const entries = breakdownEntries()
  const masterGroups = [...new Map(entries.map(entry => [quantityBreakdownGroupKey(entry), entry])).values()]
  expect(masterGroups.length).toBeGreaterThanOrEqual(2)
  const [first, second] = masterGroups
  const position = (entry: typeof first): NonNullable<CountFixture['breakdown']> => ({
    book: entry.book, section: entry.section, subject: entry.subject,
    middle: entry.middle, item: entry.row.name,
  })
  const fixtures: CountFixture[] = [
    { ...fixture('master-first', 90, '機械'), breakdown: position(first) },
    { ...fixture('master-second', -20), breakdown: position(second) },
    {
      ...fixture('master-first-early', 5), breakdown: position(first),
      conditions: ['新設', '既設'],
    },
    {
      ...fixture('unknown-later', 2),
      breakdown: { book: '電気設備', section: '独自種目', subject: '独自科目1', middle: '独自中科目', item: '分電盤' },
    },
    {
      ...fixture('unknown-earlier', 1),
      breakdown: { book: '電気設備', section: '独自種目', subject: '独自科目2', item: '分電盤' },
    },
    fixture('missing', -100),
  ]
  const index = QuantityIndex.build(['新設', '既設'].map((condition, i) => ({
    id: `condition${i}`, pageIndex: 0,
    count: { version: 2 as const, id: `condition${i}`, fixtureId: 'master-first-early', condition },
  })), fixtures)
  const data = buildQuantityTableData(index, fixtures)
  const dataOrder = data.map(item => item.fixture.id)
  const masterOrder = createQuantityBreakdownOrder(entries)
  const display = { groupByBreakdown: true, breakdownOrder: masterOrder }
  const result = projectQuantityTable(data, 'page', {}, info, display)
  const orderedIds = result.rows.flatMap(row => row.item ? [row.item.fixture.id] : [])
  expect(orderedIds.filter(id => id.startsWith('master-'))).toEqual([
    'master-second', 'master-first-early', 'master-first',
  ])
  expect(orderedIds.filter(id => id.startsWith('unknown-'))).toEqual([
    'unknown-earlier', 'unknown-later',
  ])
  expect(orderedIds.at(-1)).toBe('missing')
  expect([...orderedIds].sort()).toEqual(fixtures.map(fixture => fixture.id).sort())
  expect(result.rows.filter(row => !row.item).at(-1)).toMatchObject({
    category: '（内訳書の位置なし）', level: 0,
  })
  expect(masterOrder.groups.get(quantityBreakdownGroupKey(first))).toBe(
    entries.findIndex(entry => quantityBreakdownGroupKey(entry) === quantityBreakdownGroupKey(first)),
  )
  const firstRowKey = JSON.stringify([first.book, first.section, first.subject, first.middle ?? '', first.row.name])
  expect(masterOrder.rows.get(firstRowKey)).toEqual({
    index: entries.findIndex(entry => JSON.stringify([
      entry.book, entry.section, entry.subject, entry.middle ?? '', entry.row.name,
    ]) === firstRowKey),
    separate: first.row.separate === true,
  })
  expect(result.columns).toEqual(projectQuantityTable(data, 'page', {}, info).columns)
  for (const row of result.rows) if (row.item) expect(row.item.total).toBe(index.total(row.item.fixture.id))
  expect(data.map(item => item.fixture.id)).toEqual(dataOrder)

  const filtered = projectQuantityTable(data, 'page', { category: '機械' }, info, display)
  expect(filtered.rows.map(row => row.item?.fixture.id ?? row.category)).toEqual([
    first.book, first.section, first.subject,
    ...(first.middle ? [first.middle] : []),
    ...(first.row.separate ? [`${first.row.name}（別紙明細）`] : []),
    'master-first',
  ])
  const expanded = projectQuantityTable(data, 'page', {}, info, { ...display, allConditions: true })
  expect(expanded.rows.filter(row => row.item?.fixture.id === 'master-first-early').map(row => row.conditionKey))
    .toEqual([undefined, '新設', '既設'])
  const collapsed = projectQuantityTable(data, 'page', {}, info, {
    ...display, allConditions: true, expanded: { 'master-first-early': false },
  })
  expect(collapsed.rows.some(row => row.conditionKey !== undefined)).toBe(false)

  const original = projectQuantityTable(data, 'page', {}, info)
  expect(projectQuantityTable(data, 'page', {}, info, {
    groupByBreakdown: false, breakdownOrder: masterOrder,
  })).toEqual(original)
  expect(projectQuantityTable(data, 'page', {}, info, { groupByBreakdown: true })).toEqual(original)
})

it('emits hierarchy levels in minimum-order sequence without empty headings', () => {
  const entry = (
    section: string, subject: string, middle: string | undefined, name: string,
    separate = false, book: NonNullable<CountFixture['breakdown']>['book'] = '電気設備',
  ) => ({ book, section, subject, middle, row: { name, separate } })
  const entries = [
    entry('庁舎', '電灯設備', '電灯分岐', '分電盤'),
    entry('庁舎', '電灯設備', '電灯分岐', 'ケーブル', true),
    entry('庁舎', '電灯設備', '電灯幹線', '電線', true),
    entry('研究棟', '照明設備', undefined, '照明器具'),
    entry('庁舎', '空調設備', undefined, '空調機', false, '機械設備'),
  ]
  const located = (id: string, order: number, masterEntry: typeof entries[number]): CountFixture => ({
    ...fixture(id, order),
    breakdown: {
      book: masterEntry.book, section: masterEntry.section, subject: masterEntry.subject,
      middle: masterEntry.middle, item: masterEntry.row.name,
    },
  })
  const fixtures: CountFixture[] = [
    located('board', 90, entries[0]),
    { ...located('cable-late', 50, entries[1]), conditions: ['新設'] },
    located('cable-early', -40, entries[1]),
    located('unknown-a-early', -20, entry('庁舎', '電灯設備', '電灯分岐', '独自細目A')),
    located('unknown-a-late', 100, entry('庁舎', '電灯設備', '電灯分岐', '独自細目A')),
    located('unknown-b', -10, entry('庁舎', '電灯設備', '電灯分岐', '独自細目B')),
    located('trunk', -400, entries[2]),
    located('unknown-middle', -300, entry('庁舎', '電灯設備', '独自中科目', '独自細目')),
    located('unknown-subject', -500, entry('庁舎', '独自科目', undefined, '独自細目')),
    located('research', -1000, entries[3]),
    located('unknown-section', -600, entry('独自種目', '独自科目', undefined, '独自細目')),
    located('machine', -2000, entries[4]),
    fixture('missing-late', -2500),
    fixture('missing-early', -3000),
  ]
  const index = QuantityIndex.build([count('unset-cable', 0, 'cable-late')], fixtures)
  const data = buildQuantityTableData(index, fixtures)
  const originalOrder = data.map(item => item.fixture.id)
  const display = { groupByBreakdown: true, breakdownOrder: createQuantityBreakdownOrder(entries) }
  const result = projectQuantityTable(data, 'page', {}, info, display)
  const sequence = result.rows.map(row => row.item
    ? row.item.fixture.id
    : [row.level, row.category])
  expect(sequence).toEqual([
    [0, '機械設備'],
    [1, '庁舎'],
    [2, '空調設備'],
    'machine',
    [0, '電気設備'],
    [1, '研究棟'],
    [2, '照明設備'],
    'research',
    [1, '独自種目'],
    [2, '独自科目'],
    'unknown-section',
    [1, '庁舎'],
    [2, '独自科目'],
    'unknown-subject',
    [2, '電灯設備'],
    [3, '電灯幹線'],
    [4, '電線（別紙明細）'],
    'trunk',
    [3, '独自中科目'],
    'unknown-middle',
    [3, '電灯分岐'],
    // Ordinary rows retain their minimum-order sequence before separate-detail groups.
    'unknown-a-early', 'unknown-a-late', 'unknown-b',
    'board',
    [4, 'ケーブル（別紙明細）'],
    'cable-early', 'cable-late',
    [0, '（内訳書の位置なし）'],
    'missing-early', 'missing-late',
  ])
  const headingKeys = result.rows.filter(row => !row.item)
    .map(row => JSON.stringify([row.level, row.groupKey]))
  expect(new Set(headingKeys).size).toBe(headingKeys.length)
  expect(result.rows.filter(row => row.item).every(row => row.level === undefined)).toBe(true)
  expect(data.map(item => item.fixture.id)).toEqual(originalOrder)
  for (const row of result.rows) if (row.item) expect(row.item.total).toBe(index.total(row.item.fixture.id))

  const filtered = projectQuantityTable(data, 'page', { search: 'trunk' }, info, display)
  expect(filtered.rows.map(row => row.item ? row.item.fixture.id : [row.level, row.category])).toEqual([
    [0, '電気設備'], [1, '庁舎'], [2, '電灯設備'], [3, '電灯幹線'],
    [4, '電線（別紙明細）'], 'trunk',
  ])
  expect(projectQuantityTable(data, 'page', { search: '該当なし' }, info, display).rows).toEqual([])
  const unset = projectQuantityTable(data, 'page', { unsetOnly: true }, info, display)
  expect(unset.rows.filter(row => !row.item).map(row => [row.level, row.category])).toEqual([
    [0, '電気設備'], [1, '庁舎'], [2, '電灯設備'], [3, '電灯分岐'],
    [4, 'ケーブル（別紙明細）'],
  ])
  expect(unset.rows.filter(row => row.item).map(row => [row.item!.fixture.id, row.conditionKey]))
    .toEqual([['cable-late', undefined], ['cable-late', '']])
})

it('orders unknown groups by minimum fixture order and falls back to categories when no fixture is located', () => {
  const entries = [{
    book: '電気設備' as const, section: '庁舎', subject: '電灯設備', middle: '電灯分岐',
    row: { name: '分電盤' },
  }]
  const positioned = (id: string, order: number, middle: string): CountFixture => ({
    ...fixture(id, order),
    breakdown: { book: '電気設備', section: '庁舎', subject: '電灯設備', middle, item: '独自細目' },
  })
  const fixtures = [
    positioned('later-group', 2, '独自中科目A'),
    positioned('earlier-group-late', 10, '独自中科目B'),
    positioned('earlier-group-early', 1, '独自中科目B'),
  ]
  const data = buildQuantityTableData(QuantityIndex.build([], fixtures), fixtures)
  const display = { groupByBreakdown: true, breakdownOrder: createQuantityBreakdownOrder(entries) }
  expect(projectQuantityTable(data, 'page', {}, info, display).rows
    .map(row => row.item?.fixture.id ?? row.category)).toEqual([
    '電気設備', '庁舎', '電灯設備', '独自中科目B',
    'earlier-group-early', 'earlier-group-late',
    '独自中科目A', 'later-group',
  ])
  const unlocated = buildQuantityTableData(sampleIndex, sampleFixtures)
  const original = projectQuantityTable(unlocated, 'page', {}, info)
  expect(projectQuantityTable(unlocated, 'page', {}, info, display)).toEqual(original)
  expect(original.rows.filter(row => !row.item).every(row => row.level === undefined)).toBe(true)
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

function collapsibleTableSample() {
  const entries = [
    {
      book: '電気設備' as const, section: '庁舎', subject: '電灯設備', middle: '共通中科目',
      row: { name: '照明器具' },
    },
    {
      book: '電気設備' as const, section: '庁舎', subject: '電灯設備', middle: '共通中科目',
      row: { name: 'ケーブル', separate: true },
    },
    {
      book: '電気設備' as const, section: '庁舎', subject: '受変電設備', middle: '共通中科目',
      row: { name: '変圧器' },
    },
  ]
  const located = (id: string, order: number, entry: typeof entries[number]): CountFixture => ({
    ...fixture(id, order),
    breakdown: {
      book: entry.book, section: entry.section, subject: entry.subject,
      middle: entry.middle, item: entry.row.name,
    },
  })
  const fixtures: CountFixture[] = [
    { ...located('lamp', 0, entries[0]), conditions: ['新設', '既設'] },
    located('cable', 1, entries[1]),
    located('transformer', 2, entries[2]),
    fixture('missing', 3),
    fixture('machine', 4, '機械'),
  ]
  const index = QuantityIndex.build([
    ...['新設', '既設'].map((condition, i) => ({
      id: `lamp-${i}`, pageIndex: i,
      count: { version: 2 as const, id: `lamp-${i}`, fixtureId: 'lamp', condition },
    })),
    count('cable-mark', 0, 'cable'),
    count('transformer-mark', 2, 'transformer'),
  ], fixtures)
  const data = buildQuantityTableData(index, fixtures)
  const display = {
    groupByBreakdown: true,
    breakdownOrder: createQuantityBreakdownOrder(entries),
    allConditions: true,
  }
  return { fixtures, index, data, display }
}

it('collapses every heading level, removing descendants and condition rows but retaining the heading', () => {
  const { data, display } = collapsibleTableSample()
  const full = projectQuantityTable(data, 'page', {}, info, display)
  const headings = full.rows.filter(row => !row.item)
  expect([...new Set(headings.map(row => row.level))].sort()).toEqual([0, 1, 2, 3, 4])
  const labels = (rows: typeof full.rows) => rows.map(row => row.item
    ? `${row.item.fixture.id}:${row.conditionKey ?? 'total'}`
    : row.groupKey)

  for (const heading of headings) {
    const start = full.rows.indexOf(heading)
    const next = full.rows.findIndex((row, i) =>
      i > start && !row.item && (row.level ?? 0) <= (heading.level ?? 0),
    )
    const boundary = next < 0 ? full.rows.length : next
    const collapsed = projectQuantityTable(data, 'page', {}, info, {
      ...display, collapsed: new Set([heading.groupKey!]),
    })
    expect(labels(collapsed.rows)).toEqual(labels([
      ...full.rows.slice(0, start + 1), ...full.rows.slice(boundary),
    ]))
    expect(collapsed.rows.find(row => row.groupKey === heading.groupKey))
      .toMatchObject({ groupExpanded: false, itemCount: heading.itemCount })
    expect(collapsed.columns).toEqual(full.columns)
    expect(collapsed.omittedColumns).toBe(full.omittedColumns)
  }

  expect(headings.find(row => row.category === '電灯設備')?.itemCount).toBe(2)
  expect(headings.find(row => row.category === 'ケーブル（別紙明細）')?.itemCount).toBe(1)
  expect(headings.find(row => row.category === '（内訳書の位置なし）')?.itemCount).toBe(2)
})

it('opens only selected fixture ancestors without modifying saved keys or cached aggregates', () => {
  const { data, display } = collapsibleTableSample()
  const full = projectQuantityTable(data, 'page', {}, info, display)
  const collapsed = new Set(full.rows.filter(row => !row.item).map(row => row.groupKey!))
  const savedKeys = [...collapsed]
  const originalOrder = data.map(item => item.fixture.id)
  const originalTotals = data.map(item => item.total)

  const lamp = projectQuantityTable(data, 'page', {}, info, {
    ...display, collapsed, expandedFor: 'lamp',
  })
  expect(lamp.rows.filter(row => row.item).map(row => [row.item!.fixture.id, row.conditionKey]))
    .toEqual([['lamp', undefined], ['lamp', '新設'], ['lamp', '既設']])
  for (const key of [
    ['電気設備'], ['電気設備', '庁舎'], ['電気設備', '庁舎', '電灯設備'],
    ['電気設備', '庁舎', '電灯設備', '共通中科目'],
  ]) {
    expect(lamp.rows.find(row => row.groupKey === JSON.stringify(key))?.groupExpanded).toBe(true)
  }

  const cable = projectQuantityTable(data, 'page', {}, info, {
    ...display, collapsed, expandedFor: 'cable',
  })
  expect(cable.rows.some(row => row.item?.fixture.id === 'cable')).toBe(true)
  expect(cable.rows.find(row => row.level === 4)?.groupExpanded).toBe(true)
  expect(cable.rows.some(row => row.item?.fixture.id === 'transformer')).toBe(false)

  expect(projectQuantityTable(data, 'page', {}, info, {
    ...display, collapsed, expandedFor: 'absent',
  }).rows).toEqual(projectQuantityTable(data, 'page', {}, info, { ...display, collapsed }).rows)
  expect(projectQuantityTable(data, 'page', { search: 'transformer' }, info, {
    ...display, collapsed, expandedFor: 'lamp',
  }).rows.some(row => row.item)).toBe(false)
  expect([...collapsed]).toEqual(savedKeys)
  expect(data.map(item => item.fixture.id)).toEqual(originalOrder)
  expect(data.map(item => item.total)).toEqual(originalTotals)
})

it('keeps identically named middle headings independent and supports category and unlocated headings', () => {
  const { data, display } = collapsibleTableSample()
  const lightMiddle = JSON.stringify(['電気設備', '庁舎', '電灯設備', '共通中科目'])
  const powerMiddle = JSON.stringify(['電気設備', '庁舎', '受変電設備', '共通中科目'])
  const hierarchy = projectQuantityTable(data, 'page', {}, info, {
    ...display, collapsed: new Set([lightMiddle, JSON.stringify([null])]),
  })
  expect(hierarchy.rows.find(row => row.groupKey === lightMiddle)?.groupExpanded).toBe(false)
  expect(hierarchy.rows.find(row => row.groupKey === powerMiddle)?.groupExpanded).toBe(true)
  expect(hierarchy.rows.filter(row => row.item).map(row => row.item!.fixture.id))
    .toEqual(['transformer'])

  const collapsed = new Set(['電気'])
  const categories = projectQuantityTable(data, 'page', {}, info, {
    allConditions: true, collapsed,
  })
  expect(categories.rows.map(row => row.item?.fixture.id ?? row.category))
    .toEqual(['電気', '機械', 'machine'])
  expect(categories.rows[0]).toMatchObject({ itemCount: 4, groupExpanded: false })
  expect(categories.rows.some(row => row.conditionKey !== undefined)).toBe(false)
  const selected = projectQuantityTable(data, 'page', {}, info, {
    allConditions: true, collapsed, expandedFor: 'lamp',
  })
  expect(selected.rows[0].groupExpanded).toBe(true)
  expect(selected.rows.filter(row => row.item && row.conditionKey === undefined)).toHaveLength(5)
  expect(selected.rows.filter(row => row.conditionKey !== undefined)).toHaveLength(2)
  expect([...collapsed]).toEqual(['電気'])
})

it('writes all fixture and condition rows to Excel while the UI projection is collapsed', () => {
  const { data, display, index, fixtures } = collapsibleTableSample()
  const full = projectQuantityTable(data, 'page', {}, info, display)
  const collapsed = new Set(full.rows.filter(row => !row.item).map(row => row.groupKey!))
  expect(projectQuantityTable(data, 'page', {}, info, { ...display, collapsed })
    .rows.some(row => row.item)).toBe(false)

  // Match exportXlsx: pass display preferences without UI-only collapse state.
  const bytes = createQuantityWorkbook({
    data, mode: 'page', filters: {},
    display: {
      allConditions: display.allConditions,
      groupByBreakdown: display.groupByBreakdown,
      breakdownOrder: display.breakdownOrder,
    },
    drawingInfo: info, pdfName: '集計表試験.pdf', index, fixtures,
  })
  const text = new TextDecoder().decode(bytes)
  for (const item of fixtures) expect(text).toContain(item.name)
  expect(text).toContain('新設')
  expect(text).toContain('既設')
  expect(text).toContain('受変電設備')
  expect(text).toContain('ケーブル（別紙明細）')
})
