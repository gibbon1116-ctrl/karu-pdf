import { expect, it, vi } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { QuantityIndex, type QuantityEntry } from '../src/core/quantityIndex'
import { buildQuantityTableData, columnEntries, projectQuantityTable, type QuantityTableMode } from '../src/app/QuantityTable'
import { groupFixtures } from '../src/app/fixtureOrder'
import { nextReview, reviewOrder } from '../src/app/reviewCursor'

type Item = ReturnType<typeof buildQuantityTableData>[number]
type Aggregate = Omit<Item, 'fixture' | 'byCondition' | 'hasUnset'>
const modes = ['page', 'floor', 'room'] as const

// Frozen SPEC-07d implementation: an independent oracle for values, rows and
// eager review lists. Do not update this when changing the production builder.
function previousData(index: QuantityIndex, fixtures: readonly CountFixture[]): Item[] {
  const empty = (): Aggregate => ({ total: 0, plan: 0, rise: 0, slack: 0, entries: [],
    values: { page: new Map(), floor: new Map(), room: new Map() },
    reviewEntries: { page: new Map(), floor: new Map(), room: new Map() } })
  return groupFixtures(fixtures).flatMap(group => group.items.map(fixture => {
    const item: Item = { ...empty(), fixture, byCondition: new Map(), hasUnset: false }
    const entries = index.entries(fixture.id)
    item.entries = entries
    for (const entry of entries) {
      const conditionKey = entry.condition ?? '', condition = item.byCondition.get(conditionKey) ?? empty()
      item.byCondition.set(conditionKey, condition)
      ;(condition.entries as QuantityEntry[]).push(entry)
      if (entry.condition === undefined && fixture.conditions?.length) item.hasUnset = true
      const keys = { page: String(entry.pageIndex), floor: entry.floor ?? '', room: JSON.stringify([entry.floor ?? '', entry.room ?? '']) }
      for (const aggregate of [item, condition]) {
        aggregate.total += entry.value
        if (entry.part) aggregate[entry.part] += entry.value
        for (const mode of modes) {
          const key = keys[mode], list = aggregate.reviewEntries[mode].get(key)
          aggregate.values[mode].set(key, (aggregate.values[mode].get(key) ?? 0) + entry.value)
          if (list) list.push(entry); else aggregate.reviewEntries[mode].set(key, [entry])
        }
      }
    }
    item.values.page = new Map([...index.byPage(fixture.id)].map(([page, value]) => [String(page), value]))
    item.total = index.total(fixture.id)
    return item
  }))
}

const fixture = (id: string, order: number, conditions?: string[]): CountFixture => ({
  id, code: id, name: id, category: '電気', kind: 'length', order, conditions, style: nextCountStyle([]),
})

it.each(['single', 'two', 'mixed-unset', 'only-unset', 'legacy'] as const)(
  'preserves original values, rows and review targets for %s conditions', scenario => {
    const fixtures = [fixture('cv', 1, scenario === 'legacy' ? undefined : ['ラック', '管内']),
      fixture('extra', 0, ['露出']), fixture('unused', 2, ['ラック'])]
    const plan = scenario === 'only-unset' || scenario === 'legacy' ? undefined : 'ラック'
    const rise = scenario === 'two' || scenario === 'mixed-unset' ? '管内' : plan
    const slack = scenario === 'mixed-unset' ? undefined : plan
    const routes = [7.35, 12.1, 0.3].map((length, i) => ({
      id: 'r' + i, pageIndex: [2, 0, 2][i], rect: [i * 10, length, i * 10 + 5, length + 1],
      vertices: [[0, 0], [length, 0]] as [number, number][], measure: { mmPerPoint: 1000 },
      quantity: { version: 1 as const, id: 'r' + i, itemId: 'cv', method: 'polyline' as const,
        count: 2, rises: [{ m: 2.25 }, { m: 3.1 }], slackM: 0.15,
        floor: i === 1 ? undefined : '1階', room: i === 1 ? '' : '事務室',
        cond: { plan, rise, slack }, extra: [{ itemId: 'extra', count: 3, cond: { plan: '露出', rise: '露出', slack: '露出' } }] },
    }))
    const index = QuantityIndex.build(routes, fixtures)
    const before = previousData(index, fixtures), after = buildQuantityTableData(index, fixtures)
    const marks = new Map(routes.map(route => [route.id, route]))
    for (const [i, item] of after.entries()) {
      const old = before[i]
      expect(item.fixture).toBe(old.fixture)
      expect(item.hasUnset).toBe(old.hasUnset)
      expect([...item.byCondition.keys()]).toEqual([...old.byCondition.keys()])
      if (item.byCondition.size === 1) expect([...item.byCondition.values()][0]).toBe(item)
      for (const condition of [undefined, ...old.byCondition.keys()]) {
        const aggregate = condition === undefined ? item : item.byCondition.get(condition)!
        const previous = condition === undefined ? old : old.byCondition.get(condition)!
        expect([aggregate.total, aggregate.plan, aggregate.rise, aggregate.slack])
          .toEqual([previous.total, previous.plan, previous.rise, previous.slack])
        expect(aggregate.entries).toEqual(previous.entries)
        for (const mode of modes) {
          expect(aggregate.values[mode]).toEqual(previous.values[mode])
          for (const key of [null, ...previous.values[mode].keys(), 'missing']) {
            if (mode === 'room' && key === 'missing') continue
            const expected = key === null ? previous.entries : previous.reviewEntries[mode].get(key) ?? []
            const actual = columnEntries(item, mode, key, condition)
            expect(actual).toEqual(expected)
            actual.forEach((entry, position) => expect(entry).toBe(expected[position]))
            const order = reviewOrder(actual, id => marks.get(id))
            expect(order).toEqual(reviewOrder(expected, id => marks.get(id)))
            let cursor = null as ReturnType<typeof nextReview>
            for (const id of [...order, ...order.slice(0, 1)]) {
              cursor = nextReview(order, cursor)
              expect(cursor?.id).toBe(id)
            }
          }
          expect(columnEntries(item, mode, mode === 'room' ? '["missing","missing"]' : 'missing', 'absent')).toEqual([])
        }
      }
    }
    for (const mode of modes) for (const unsetOnly of [false, true]) for (const display of [
      {}, { allConditions: true }, { expanded: { cv: true, extra: false } },
    ]) {
      const view = (data: Item[]) => {
        const projected = projectQuantityTable(data, mode, { unsetOnly }, () => null, display)
        return { ...projected, rows: projected.rows.map(row => {
          const aggregate = row.conditionKey === undefined ? row.item : row.item?.byCondition.get(row.conditionKey)
          return [row.category, row.item?.fixture.id, row.conditionKey, aggregate?.total,
            aggregate && projected.columns.map(column => aggregate.values[mode].get(column.key) ?? 0)]
        }) }
      }
      expect(view(after)).toEqual(view(before))
    }
  },
)

it('detaches a late second condition and preserves interleaved and explicit blank count entries', () => {
  const f = { ...fixture('led', 0, ['壁付', '天井']), kind: 'count' as const }
  const counts = ['壁付', '壁付', '壁付', '天井', '壁付', '', undefined, '天井'].map((condition, i) => ({
    id: String(i), pageIndex: i % 3,
    count: { version: 2 as const, id: String(i), fixtureId: f.id, condition,
      floor: i % 2 ? 'a,b' : 'a', room: i % 2 ? 'c' : 'b,c' },
  }))
  const index = QuantityIndex.build(counts, [f]), before = previousData(index, [f])[0], after = buildQuantityTableData(index, [f])[0]
  expect(after.total).toBe(8)
  expect(after.hasUnset).toBe(true)
  expect([...after.byCondition.keys()]).toEqual(['壁付', '天井', ''])
  expect(after.byCondition.get('壁付')).not.toBe(after)
  for (const condition of [undefined, ...before.byCondition.keys()]) for (const mode of modes) {
    const aggregate = condition === undefined ? before : before.byCondition.get(condition)!
    const current = condition === undefined ? after : after.byCondition.get(condition)!
    expect(current.values[mode]).toEqual(aggregate.values[mode])
    expect(current.total).toBe(aggregate.total)
    for (const key of aggregate.values[mode].keys()) expect(columnEntries(after, mode, key, condition)).toEqual(aggregate.reviewEntries[mode].get(key))
  }
})

it('retains occupied zero pages without adding excluded routes to condition review targets', () => {
  const f = fixture('cv', 0, ['ラック'])
  const route = (id: string, pageIndex: number, excluded: boolean) => ({ id, pageIndex,
    vertices: [[0, 0], [10, 0]] as [number, number][], measure: { mmPerPoint: 1000 },
    quantity: { version: 1 as const, id, itemId: f.id, method: 'polyline' as const,
      cond: { plan: excluded ? null : 'ラック', rise: null, slack: null } },
  })
  const index = QuantityIndex.build([route('occupied', 2, false), route('excluded', 1, true)], [f])
  const item = buildQuantityTableData(index, [f])[0]
  expect(item.byCondition.get('ラック')).toBe(item)
  expect([...item.values.page]).toEqual([['1', 0], ['2', 10]])
  expect(columnEntries(item, 'page', '1', 'ラック')).toEqual([])
  expect(columnEntries(item, 'page', null, 'ラック').map(entry => entry.annotationId)).toEqual(['occupied'])
  expect(item.hasUnset).toBe(false)
})

it('builds and projects without eager review maps and filters only the selected column on demand', () => {
  const f = { ...fixture('led', 0), kind: 'count' as const }
  const index = QuantityIndex.build([0, 1].map(pageIndex => ({ id: String(pageIndex), pageIndex,
    count: { version: 2 as const, id: String(pageIndex), fixtureId: f.id } })), [f])
  const item = buildQuantityTableData(index, [f])[0]
  const eager = vi.spyOn(item, 'reviewEntries', 'get').mockImplementation(() => { throw new Error('Eager review map read') })
  try {
    projectQuantityTable([item], 'page', {}, () => null)
    expect(columnEntries(item, 'page', '0')).toEqual([index.entries(f.id)[0]])
    expect(columnEntries(item, 'floor', '')).toEqual(index.entries(f.id))
    expect(columnEntries(item, 'room', '["",""]', '')).toEqual(index.entries(f.id))
    expect(columnEntries(item, 'page', null, '')).toBe(index.entries(f.id))
    expect(eager).not.toHaveBeenCalled()
  } finally { eager.mockRestore() }
})

it('serializes each distinct floor/room pair once per table, including across items', () => {
  const fixtures = [fixture('a', 0), fixture('b', 1)]
  const index = QuantityIndex.build(Array.from({ length: 20 }, (_, i) => ({ id: String(i), pageIndex: i,
    count: { version: 2 as const, id: String(i), fixtureId: i % 2 ? 'a' : 'b',
      floor: i % 3 ? '1階' : undefined, room: i % 3 ? '事務室' : undefined } })), fixtures)
  const stringify = vi.spyOn(JSON, 'stringify')
  try {
    buildQuantityTableData(index, fixtures)
    expect(stringify).toHaveBeenCalledTimes(2)
  } finally { stringify.mockRestore() }
})
