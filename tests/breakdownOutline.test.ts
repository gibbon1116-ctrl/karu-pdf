import { expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { groupFixtures } from '../src/app/fixtureOrder'
import {
  breakdownHeadingPath,
  breakdownHeadingRows,
  createQuantityBreakdownOrder,
  fixtureOutlineDropError,
  fixtureOutlineMoveError,
  moveFixtureInOutline,
  moveFixturesToOutlinePosition,
  moveHeadingInOutline,
  orderByBreakdown,
  sortByBreakdownMaster,
  quantityBreakdownGroupKey,
  quantityBreakdownRowKey,
} from '../src/app/breakdownOutline'

const fixture = (id: string, order = 0): CountFixture => ({
  id, code: id.toUpperCase(), name: `${id}の名称`, order,
  category: '電気', kind: 'count', style: nextCountStyle([]),
})

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

function hierarchyFixtures(): CountFixture[] {
  return [
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
}

it('orders generic items exactly like the existing quantity-table hierarchy fixture', () => {
  const fixtures = hierarchyFixtures()
  const originalFixtures = structuredClone(fixtures)
  const items = groupFixtures(fixtures).flatMap(group =>
    group.items.map(fixture => ({ fixture, payload: fixture.id })),
  )
  const originalItems = [...items]
  const ordered = orderByBreakdown(items, item => item.fixture, createQuantityBreakdownOrder(entries))
  expect(ordered.map(item => item.payload)).toEqual([
    'machine',
    'research',
    'unknown-section',
    'unknown-subject',
    'trunk',
    'unknown-middle',
    'unknown-a-early', 'unknown-a-late', 'unknown-b',
    'board',
    'cable-early', 'cable-late',
    'missing-early', 'missing-late',
  ])
  expect(items).toEqual(originalItems)
  expect(fixtures).toEqual(originalFixtures)
  expect(ordered.every(item => originalItems.includes(item))).toBe(true)
})

it('emits the existing levels, separate-detail headings and missing-position heading last', () => {
  const order = createQuantityBreakdownOrder(entries)
  const ordered = orderByBreakdown(hierarchyFixtures(), fixture => fixture, order)
  const sequence: Array<string | [number, string]> = []
  const keys: string[] = []
  let previous: string[] | null | undefined
  for (const fixture of ordered) {
    const path = breakdownHeadingPath(fixture, order)
    for (const heading of breakdownHeadingRows(path, previous)) {
      sequence.push([heading.level, heading.category])
      keys.push(JSON.stringify([heading.level, heading.groupKey]))
    }
    sequence.push(fixture.id)
    previous = path
  }
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
    'unknown-a-early', 'unknown-a-late', 'unknown-b',
    'board',
    [4, 'ケーブル（別紙明細）'],
    'cable-early', 'cable-late',
    [0, '（内訳書の位置なし）'],
    'missing-early', 'missing-late',
  ])
  expect(new Set(keys).size).toBe(keys.length)
})

it('builds paths without headings for ordinary detail names or empty optional levels', () => {
  const order = createQuantityBreakdownOrder(entries)
  expect(breakdownHeadingPath(located('board', 0, entries[0]), order)).toEqual([
    '電気設備', '庁舎', '電灯設備', '電灯分岐', '',
  ])
  expect(breakdownHeadingPath(located('cable', 0, entries[1]), order)).toEqual([
    '電気設備', '庁舎', '電灯設備', '電灯分岐', 'ケーブル',
  ])
  const research = breakdownHeadingPath(located('research', 0, entries[3]), order)
  expect(research).toEqual(['電気設備', '研究棟', '照明設備', '', ''])
  expect(breakdownHeadingRows(research).map(row => [row.level, row.category])).toEqual([
    [0, '電気設備'], [1, '研究棟'], [2, '照明設備'],
  ])
  expect(breakdownHeadingRows(research, research)).toEqual([])
  expect(breakdownHeadingPath(fixture('missing'), order)).toBeNull()
  expect(breakdownHeadingRows(null)).toEqual([{
    category: '（内訳書の位置なし）', level: 0, groupKey: JSON.stringify([null]),
  }])
  expect(breakdownHeadingRows(null, null)).toEqual([])
})

it('includes ancestors in heading keys and includes the detail in position keys', () => {
  const order = createQuantityBreakdownOrder(entries)
  const a = located('a', 0, entries[0])
  const b = located('b', 1, entry('庁舎', '別の科目', '電灯分岐', '分電盤'))
  const aHeading = breakdownHeadingRows(breakdownHeadingPath(a, order)).find(row => row.level === 3)!
  const bHeading = breakdownHeadingRows(breakdownHeadingPath(b, order)).find(row => row.level === 3)!
  expect(aHeading.category).toBe(bHeading.category)
  expect(aHeading.groupKey).not.toBe(bHeading.groupKey)

  const withoutMiddle = { ...a.breakdown!, middle: undefined }
  const emptyMiddle = { ...a.breakdown!, middle: '' }
  expect(quantityBreakdownGroupKey(withoutMiddle)).toBe(quantityBreakdownGroupKey(emptyMiddle))
  expect(quantityBreakdownRowKey(withoutMiddle)).toBe(quantityBreakdownRowKey(emptyMiddle))
  expect(quantityBreakdownRowKey(a.breakdown!))
    .not.toBe(quantityBreakdownRowKey({ ...a.breakdown!, item: 'ケーブル' }))
})

it('uses the first master occurrence and minimum fixture order for unknown siblings', () => {
  const first = entries[0]
  const order = createQuantityBreakdownOrder([
    first,
    { ...first, row: { ...first.row, separate: true } },
  ])
  expect(order.groups.get(quantityBreakdownGroupKey(first))).toBe(0)
  expect(order.rows.get(quantityBreakdownRowKey({
    ...first, item: first.row.name,
  }))).toEqual({ index: 0, separate: false })
  const fixtures = [
    located('later-group', 2, entry('庁舎', '電灯設備', '独自中科目A', '独自細目')),
    located('earlier-group-late', 10, entry('庁舎', '電灯設備', '独自中科目B', '独自細目')),
    located('earlier-group-early', 1, entry('庁舎', '電灯設備', '独自中科目B', '独自細目')),
  ]
  expect(orderByBreakdown(fixtures, fixture => fixture, order).map(fixture => fixture.id)).toEqual([
    'earlier-group-early', 'earlier-group-late', 'later-group',
  ])
  expect(orderByBreakdown([], (fixture: CountFixture) => fixture, order)).toEqual([])
})

const switchEntry = entry('庁舎', '電灯設備', '電灯分岐', '配線器具', true)
const plateEntry = entry('庁舎', '電灯設備', '電灯分岐', '設備プレート', true)
const moveEntries = [...entries, switchEntry, plateEntry]
const moveOrder = createQuantityBreakdownOrder(moveEntries)
const headingKey = (masterEntry: typeof entries[number], level: 2 | 3 | 4): string =>
  JSON.stringify([
    masterEntry.book, masterEntry.section, masterEntry.subject, masterEntry.middle ?? '',
    masterEntry.row.name,
  ].slice(0, level + 1))
const ids = (fixtures: readonly CountFixture[]) => [...fixtures]
  .sort((a, b) => a.order - b.order).map(fixture => fixture.id)

function moveFixtures(): CountFixture[] {
  return [
    located('board', 0, entries[0]),
    {
      ...located('switch-a', 1, switchEntry),
      category: '配線器具',
      summary: [{ label: '形式', value: '片切' }],
      remark: '既存の摘要',
      conditions: ['露出'],
    },
    located('switch-b', 2, switchEntry),
    located('plate-a', 3, plateEntry),
    located('plate-b', 4, plateEntry),
    located('trunk', 5, entries[2]),
    fixture('missing', 6),
  ]
}

it('orders both ordinary rows and separate headings by minimum order without master rank', () => {
  const ordinary = entry('庁舎', '電灯設備', '電灯分岐', '普通細目')
  const fixtures = [
    located('board', 20, entries[0]),
    located('ordinary', 10, ordinary),
    located('switch', -10, switchEntry),
    located('plate-late', 30, plateEntry),
    located('plate-early', -20, plateEntry),
  ]
  expect(orderByBreakdown(fixtures, fixture => fixture, moveOrder).map(fixture => fixture.id))
    .toEqual(['ordinary', 'board', 'plate-early', 'plate-late', 'switch'])
})

it('moves within the same position using only its existing order slots', () => {
  const fixtures = moveFixtures()
  const original = structuredClone(fixtures)
  const next = moveFixtureInOutline(fixtures, 'switch-a', {
    kind: 'fixture', id: 'switch-b', side: 'after',
  }, moveOrder)!
  expect(ids(next)).toEqual(['board', 'switch-b', 'switch-a', 'plate-a', 'plate-b', 'trunk', 'missing'])
  expect(next.find(fixture => fixture.id === 'switch-a')!.order).toBe(2)
  expect(next.find(fixture => fixture.id === 'switch-b')!.order).toBe(1)
  for (const fixture of fixtures) {
    const updated = next.find(value => value.id === fixture.id)!
    expect({ ...updated, order: fixture.order }).toEqual(fixture)
    if (!fixture.id.startsWith('switch-')) expect(updated).toBe(fixture)
  }
  expect(fixtures).toEqual(original)
  expect(moveFixtureInOutline(fixtures, 'switch-a', {
    kind: 'fixture', id: 'switch-b', side: 'before',
  }, moveOrder)).toBeNull()
  expect(moveFixtureInOutline(fixtures, 'switch-a', {
    kind: 'fixture', id: 'switch-a', side: 'after',
  }, moveOrder)).toBeNull()
})

it.each([
  ['before', ['board', 'switch-b', 'switch-a', 'plate-a', 'plate-b', 'trunk', 'missing']],
  ['after', ['board', 'switch-b', 'plate-a', 'switch-a', 'plate-b', 'trunk', 'missing']],
] as const)('moves a fixture %s a fixture in another separate detail, changing only item and order', (side, expected) => {
  const fixtures = moveFixtures()
  const original = structuredClone(fixtures)
  const next = moveFixtureInOutline(fixtures, 'switch-a', {
    kind: 'fixture', id: 'plate-a', side,
  }, moveOrder)!
  expect(ids(next)).toEqual(expected)
  expect(next.map(fixture => fixture.order)).toEqual(next.map((_, index) => index))
  expect(next.find(fixture => fixture.id === 'switch-a')!.breakdown?.item).toBe('設備プレート')
  for (const fixture of fixtures) {
    const updated = next.find(value => value.id === fixture.id)!
    expect({ ...updated, order: fixture.order, breakdown: fixture.breakdown }).toEqual(fixture)
    if (fixture.id !== 'switch-a') expect(updated.breakdown).toEqual(fixture.breakdown)
  }
  expect(fixtures).toEqual(original)
})

it('drops on a separate heading at its end, including within the same separate detail', () => {
  const fixtures = moveFixtures()
  const next = moveFixtureInOutline(fixtures, 'switch-a', {
    kind: 'heading', key: headingKey(plateEntry, 4), side: 'inside',
  }, moveOrder)!
  expect(ids(next)).toEqual(['board', 'switch-b', 'plate-a', 'plate-b', 'switch-a', 'trunk', 'missing'])
  expect(next.find(fixture => fixture.id === 'switch-a')!.breakdown?.item).toBe('設備プレート')
  const same = moveFixtureInOutline(fixtures, 'switch-a', {
    kind: 'heading', key: headingKey(switchEntry, 4), side: 'inside',
  }, moveOrder)!
  expect(ids(same)).toEqual(['board', 'switch-b', 'switch-a', 'plate-a', 'plate-b', 'trunk', 'missing'])
  expect(same.find(fixture => fixture.id === 'switch-a')!.breakdown).toEqual(fixtures[1].breakdown)
})

it('rejects mixing ordinary and separate details, unlocated items and non-separate headings', () => {
  const fixtures = moveFixtures()
  const otherMiddle = { ...plateEntry, middle: '電灯幹線' }
  const all = [...fixtures, located('other-middle', 7, otherMiddle)]
  const order = createQuantityBreakdownOrder([...moveEntries, otherMiddle])
  const original = structuredClone(all)
  for (const targetId of ['board', 'missing', 'absent']) {
    expect(moveFixtureInOutline(all, 'switch-a', {
      kind: 'fixture', id: targetId, side: 'before',
    }, order)).toBeNull()
  }
  for (const sourceId of ['board', 'missing', 'absent']) {
    expect(moveFixtureInOutline(all, sourceId, {
      kind: 'fixture', id: 'plate-a', side: 'after',
    }, order)).toBeNull()
  }
  for (const key of [headingKey(entries[0], 4), headingKey(plateEntry, 3), 'invalid']) {
    expect(moveFixtureInOutline(all, 'switch-a', {
      kind: 'heading', key, side: 'inside',
    }, order)).toBeNull()
  }
  expect(all).toEqual(original)
})

const trunkCable = entry('庁舎', '電灯設備', '電灯幹線', 'ケーブル', true)
const outdoorCable = entry('屋外', '構内配電線路', '電力引込み', 'ケーブル', true)
const powerCable = entry('庁舎', '動力設備', '動力幹線', 'ケーブル', true)
const trunkBoard = entry('庁舎', '電灯設備', '電灯幹線', '分電盤')
const outdoorBoard = entry('屋外', '構内配電線路', '電力引込み', '分電盤')
const powerOrdinary = entry('庁舎', '動力設備', '動力幹線', '動力制御盤')
const machineCable = entry('庁舎', '空調設備', '空調幹線', 'ケーブル', true, '機械設備')
const crossOrder = createQuantityBreakdownOrder([
  trunkCable, outdoorCable, powerCable, trunkBoard, outdoorBoard, powerOrdinary, machineCable,
])

it.each(['before', 'after'] as const)(
  'moves a cable %s another cable across sections and subjects, preserving other fields',
  side => {
    const source = {
      ...located('source', 0, trunkCable),
      conditions: ['露出'],
      summary: [{ label: '形式', value: 'CV' }],
      remark: '移動後も保持',
    }
    const fixtures = [
      source,
      located('source-peer', 1, trunkCable),
      located('destination', 2, outdoorCable),
      located('destination-last', 3, outdoorCable),
      fixture('missing', 4),
    ]
    const original = structuredClone(fixtures)
    const next = moveFixtureInOutline(fixtures, 'source', {
      kind: 'fixture', id: 'destination', side,
    }, crossOrder)!
    const expected = side === 'before'
      ? ['source-peer', 'source', 'destination', 'destination-last', 'missing']
      : ['source-peer', 'destination', 'source', 'destination-last', 'missing']
    expect(ids(next)).toEqual(expected)
    expect(orderByBreakdown(next, fixture => fixture, crossOrder).map(fixture => fixture.id))
      .toEqual(expected)
    const moved = next.find(fixture => fixture.id === 'source')!
    expect(moved.breakdown).toEqual(located('expected', 0, outdoorCable).breakdown)
    expect({ ...moved, breakdown: source.breakdown, order: source.order }).toEqual(source)
    expect(fixtures).toEqual(original)
  },
)

it('moves a cable to a separate heading across sections and subjects', () => {
  const fixtures = [
    located('source', 0, trunkCable),
    located('source-peer', 1, trunkCable),
    located('destination', 2, outdoorCable),
    located('destination-last', 3, outdoorCable),
  ]
  const next = moveFixtureInOutline(fixtures, 'source', {
    kind: 'heading', key: headingKey(outdoorCable, 4), side: 'inside',
  }, crossOrder)!
  expect(ids(next)).toEqual(['source-peer', 'destination', 'destination-last', 'source'])
  expect(next.find(fixture => fixture.id === 'source')!.breakdown)
    .toEqual(located('expected', 0, outdoorCable).breakdown)
})

it('moves an ordinary row across middles only when the same ordinary master row exists', () => {
  const fixtures = [
    located('source', 0, trunkBoard),
    located('destination', 1, outdoorBoard),
    located('destination-last', 2, outdoorBoard),
    located('no-board', 3, powerOrdinary),
  ]
  const original = structuredClone(fixtures)
  const target = { kind: 'fixture' as const, id: 'destination', side: 'after' as const }
  const next = moveFixtureInOutline(fixtures, 'source', target, crossOrder)!
  // 庁舎の見出しは残る項目（no-board）の順で先に並び、屋外の中に移った項目が入る。
  expect(ids(next)).toEqual(['no-board', 'destination', 'source', 'destination-last'])
  expect(next.find(fixture => fixture.id === 'source')!.breakdown)
    .toEqual(located('expected', 0, outdoorBoard).breakdown)

  const heading = moveFixtureInOutline(fixtures, 'source', {
    kind: 'heading', key: headingKey(outdoorBoard, 3), side: 'inside',
  }, crossOrder)!
  expect(ids(heading)).toEqual(['no-board', 'destination', 'destination-last', 'source'])
  expect(heading.find(fixture => fixture.id === 'source')!.breakdown?.item).toBe('分電盤')

  const rejected = { kind: 'fixture' as const, id: 'no-board', side: 'after' as const }
  expect(moveFixtureInOutline(fixtures, 'source', rejected, crossOrder)).toBeNull()
  expect(fixtureOutlineDropError(fixtures, 'source', rejected, crossOrder))
    .toBe('移す先の中科目に「分電盤」の細目がありません')
  expect(moveFixtureInOutline(fixtures, 'source', {
    kind: 'heading', key: headingKey(powerOrdinary, 3), side: 'inside',
  }, crossOrder)).toBeNull()
  expect(fixtures).toEqual(original)
})

it('puts an ordinary row before separate details when the target middle has no ordinary fixtures', () => {
  const fixtures = [
    located('source', 0, trunkBoard),
    located('destination-cable', 1, outdoorCable),
  ]
  const next = moveFixtureInOutline(fixtures, 'source', {
    kind: 'heading', key: headingKey(outdoorBoard, 3), side: 'inside',
  }, crossOrder)!
  expect(ids(next)).toEqual(['source', 'destination-cable'])
  expect(next.find(fixture => fixture.id === 'source')!.breakdown)
    .toEqual(located('expected', 0, outdoorBoard).breakdown)
})

it('rejects another book and mixing ordinary rows with separate details', () => {
  const fixtures = [
    located('source', 0, trunkCable),
    located('board', 1, outdoorBoard),
    located('machine', 2, machineCable),
  ]
  for (const target of [
    { kind: 'fixture' as const, id: 'machine', side: 'after' as const },
    { kind: 'heading' as const, key: headingKey(machineCable, 4), side: 'inside' as const },
    { kind: 'fixture' as const, id: 'board', side: 'after' as const },
    { kind: 'heading' as const, key: headingKey(outdoorBoard, 3), side: 'inside' as const },
  ]) {
    expect(moveFixtureInOutline(fixtures, 'source', target, crossOrder)).toBeNull()
  }
  expect(moveFixtureInOutline(fixtures, 'board', {
    kind: 'fixture', id: 'source', side: 'after',
  }, crossOrder)).toBeNull()
  expect(moveFixtureInOutline(fixtures, 'board', {
    kind: 'heading', key: headingKey(trunkCable, 4), side: 'inside',
  }, crossOrder)).toBeNull()
})

it('moves one fixture or its whole detail to an empty master position as one immutable result', () => {
  const fixtures = [
    located('source', 0, trunkCable),
    located('source-peer', 1, trunkCable),
    located('destination-middle', 2, powerOrdinary),
    fixture('missing', 3),
  ]
  const original = structuredClone(fixtures)
  const position = located('expected', 0, powerCable).breakdown!
  const single = moveFixturesToOutlinePosition(fixtures, 'source', position, crossOrder)!
  expect(ids(single)).toEqual(['source-peer', 'destination-middle', 'source', 'missing'])
  expect(single.find(fixture => fixture.id === 'source')!.breakdown).toEqual(position)
  expect(single.find(fixture => fixture.id === 'source-peer')!.breakdown)
    .toEqual(fixtures[1].breakdown)

  const all = moveFixturesToOutlinePosition(fixtures, 'source', position, crossOrder, true)!
  expect(ids(all)).toEqual(['destination-middle', 'source', 'source-peer', 'missing'])
  for (const id of ['source', 'source-peer']) {
    expect(all.find(fixture => fixture.id === id)!.breakdown).toEqual(position)
  }
  expect(all.find(fixture => fixture.id === 'source')!.breakdown)
    .not.toBe(all.find(fixture => fixture.id === 'source-peer')!.breakdown)
  expect(all.map(fixture => fixture.order)).toEqual([0, 1, 2, 3])
  expect(fixtures).toEqual(original)
})

it('appends a whole detail after existing destination peers and rejects invalid dialog destinations', () => {
  const fixtures = [
    located('source', 0, trunkCable),
    located('source-peer', 1, trunkCable),
    located('destination', 2, outdoorCable),
    located('destination-last', 3, outdoorCable),
  ]
  const destination = located('expected', 0, outdoorCable).breakdown!
  const next = moveFixturesToOutlinePosition(fixtures, 'source', destination, crossOrder, true)!
  expect(ids(next)).toEqual(['destination', 'destination-last', 'source', 'source-peer'])
  expect(moveFixturesToOutlinePosition(fixtures, 'source', fixtures[0].breakdown!, crossOrder))
    .toBeNull()
  expect(moveFixturesToOutlinePosition(fixtures, 'source', {
    ...destination, book: '機械設備',
  }, crossOrder)).toBeNull()
  expect(moveFixturesToOutlinePosition(fixtures, 'source', {
    ...destination, item: '存在しない別紙',
  }, crossOrder)).toBeNull()
  const board = located('board', 0, trunkBoard)
  expect(fixtureOutlineMoveError(board, {
    ...destination, item: '分電盤',
  }, crossOrder)).toBeNull()
  expect(fixtureOutlineMoveError(board, {
    ...located('expected', 0, powerOrdinary).breakdown!, item: '分電盤',
  }, crossOrder)).toBe('移す先の中科目に「分電盤」の細目がありません')
})

it('creates a previously empty middle below its nearest existing ancestor', () => {
  const fixtures = [
    located('source', 0, trunkCable),
    located('source-peer', 1, trunkCable),
    located('outdoor', 2, outdoorCable),
    fixture('missing', 3),
  ]
  const position = located('expected', 0, powerCable).breakdown!
  const next = moveFixturesToOutlinePosition(fixtures, 'source', position, crossOrder)!
  expect(ids(next)).toEqual(['source-peer', 'source', 'outdoor', 'missing'])
  expect(orderByBreakdown(next, fixture => fixture, crossOrder).map(fixture => fixture.id))
    .toEqual(['source-peer', 'source', 'outdoor', 'missing'])
})

function headingFixtures() {
  const a = entry('庁舎', '科目A', '中科目1', '別紙A', true)
  const b = entry('庁舎', '科目A', '中科目2', '別紙B', true)
  const c = entry('庁舎', '科目B', '中科目1', '別紙A', true)
  const d = entry('庁舎', '科目A', '中科目1', '別紙C', true)
  const otherParent = entry('別棟', '科目C', '中科目1', '別紙A', true)
  return {
    a, b, c, d, otherParent,
    order: createQuantityBreakdownOrder([a, b, c, d, otherParent]),
    fixtures: [
      located('a', 0, a),
      located('d', 1, d),
      located('b-early', 2, b),
      located('c', 3, c),
      located('b-late', 4, b),
      located('other-parent', 5, otherParent),
      fixture('missing', -1),
    ],
  }
}

it('moves a subject, middle or separate heading as one block and preserves other relative orders', () => {
  const data = headingFixtures()
  const original = structuredClone(data.fixtures)
  const cases = [
    {
      source: headingKey(data.c, 2), target: headingKey(data.a, 2), side: 'before' as const,
      expected: ['c', 'a', 'd', 'b-early', 'b-late', 'other-parent', 'missing'],
    },
    {
      source: headingKey(data.a, 2), target: headingKey(data.c, 2), side: 'after' as const,
      expected: ['c', 'a', 'd', 'b-early', 'b-late', 'other-parent', 'missing'],
    },
    {
      source: headingKey(data.b, 3), target: headingKey(data.a, 3), side: 'before' as const,
      expected: ['b-early', 'b-late', 'a', 'd', 'c', 'other-parent', 'missing'],
    },
    {
      source: headingKey(data.a, 3), target: headingKey(data.b, 3), side: 'after' as const,
      expected: ['b-early', 'b-late', 'a', 'd', 'c', 'other-parent', 'missing'],
    },
    {
      source: headingKey(data.d, 4), target: headingKey(data.a, 4), side: 'before' as const,
      expected: ['d', 'a', 'b-early', 'b-late', 'c', 'other-parent', 'missing'],
    },
    {
      source: headingKey(data.a, 4), target: headingKey(data.d, 4), side: 'after' as const,
      expected: ['d', 'a', 'b-early', 'b-late', 'c', 'other-parent', 'missing'],
    },
  ]
  for (const { source, target, side, expected } of cases) {
    const next = moveHeadingInOutline(data.fixtures, source, {
      kind: 'heading', key: target, side,
    }, data.order)!
    expect(ids(next)).toEqual(expected)
    expect(orderByBreakdown(next, fixture => fixture, data.order).map(fixture => fixture.id)).toEqual(expected)
    for (const fixture of data.fixtures) {
      const updated = next.find(value => value.id === fixture.id)!
      expect({ ...updated, order: fixture.order }).toEqual(fixture)
    }
  }
  expect(data.fixtures).toEqual(original)
})

it('rejects heading moves across parents or levels, roots, fixture targets and unchanged moves', () => {
  const data = headingFixtures()
  const source = headingKey(data.a, 3)
  for (const key of [
    headingKey(data.c, 3),
    headingKey(data.a, 2),
    headingKey(data.d, 4),
    JSON.stringify(['電気設備']),
    JSON.stringify(['電気設備', '庁舎']),
    JSON.stringify([null]),
    'invalid',
  ]) {
    expect(moveHeadingInOutline(data.fixtures, source, {
      kind: 'heading', key, side: 'before',
    }, data.order)).toBeNull()
  }
  expect(moveHeadingInOutline(data.fixtures, headingKey(data.a, 2), {
    kind: 'heading', key: headingKey(data.otherParent, 2), side: 'after',
  }, data.order)).toBeNull()
  expect(moveHeadingInOutline(data.fixtures, source, {
    kind: 'fixture', id: 'c', side: 'before',
  }, data.order)).toBeNull()
  expect(moveHeadingInOutline(data.fixtures, source, {
    kind: 'heading', key: source, side: 'before',
  }, data.order)).toBeNull()
  expect(moveHeadingInOutline(data.fixtures, source, {
    kind: 'heading', key: headingKey(data.b, 3), side: 'before',
  }, data.order)).toBeNull()
  expect(moveHeadingInOutline(data.fixtures, JSON.stringify(['電気設備']), {
    kind: 'heading', key: JSON.stringify(['機械設備']), side: 'after',
  }, data.order)).toBeNull()
})

it('restores master row order, preserving order within a position and putting unknown and missing positions last', () => {
  const unknown = entry('庁舎', '電灯設備', '電灯分岐', '独自細目')
  const fixtures = [
    located('switch-late', 9, switchEntry),
    located('switch-early', 1, switchEntry),
    located('board', 20, entries[0]),
    located('unknown-late', -2, unknown),
    located('unknown-early', -5, unknown),
    fixture('missing-late', -8),
    fixture('missing-early', -10),
  ]
  const original = structuredClone(fixtures)
  const next = sortByBreakdownMaster(fixtures, moveOrder)
  expect(ids(next)).toEqual([
    'board', 'switch-early', 'switch-late',
    'unknown-early', 'unknown-late', 'missing-early', 'missing-late',
  ])
  expect(next.map(fixture => fixture.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
  for (const fixture of fixtures) {
    expect({ ...next.find(value => value.id === fixture.id)!, order: fixture.order }).toEqual(fixture)
  }
  expect(fixtures).toEqual(original)
  expect(sortByBreakdownMaster([], moveOrder)).toEqual([])
})
