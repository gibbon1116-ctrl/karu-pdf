import { expect, it, vi } from 'vitest'
import { nextReview, refreshReview, reviewOrder, type ReviewCursor } from '../src/app/reviewCursor'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle } from '../src/core/countFixtures'

const order = ['a', 'b', 'c', 'd', 'e']
const cursor = (id: string, previous = order): ReviewCursor => ({ id, order: [...previous], position: previous.indexOf(id) + 1, count: previous.length })

it('starts at the first pickup, advances in order and wraps after the last', () => {
  let current: ReviewCursor | null = null
  for (const [i, id] of [...order, 'a'].entries()) {
    current = nextReview(order, current)
    expect(current).toEqual({ id, position: i % 5 + 1, count: 5, order })
  }
  expect(current!.order).not.toBe(order)
  expect(nextReview([], null)).toBeNull()
  expect(nextReview([], current)).toBeNull()
})

it.each([
  ['reviewed pickup deleted', ['a', 'c', 'd', 'e'], 'b', 'c', 2],
  ['last reviewed pickup deleted', ['a', 'b', 'c', 'd'], 'e', 'a', 1],
  ['another pickup before the cursor deleted', ['b', 'c', 'd', 'e'], 'c', 'd', 3],
  ['another pickup after the cursor deleted', ['a', 'b', 'c', 'e'], 'c', 'e', 4],
  ['reviewed pickup and two successors deleted', ['a', 'e'], 'b', 'e', 2],
  ['all successors deleted', ['a', 'b'], 'c', 'a', 1],
] as const)('continues correctly with %s', (_, remaining, id, nextId, position) => {
  const previous = cursor(id), refreshed = refreshReview(remaining, previous)
  const expected = { id: nextId, position, count: remaining.length, order: [...remaining] }
  expect(nextReview(remaining, previous)).toEqual(expected)
  expect(nextReview(remaining, refreshed)).toEqual(expected)
})

it.each([
  [order, 'c', 3],
  [['b', 'c', 'd', 'e'], 'c', 2],
  [['a', 'b', 'c', 'e'], 'c', 3],
  [['a', 'c', 'd', 'e'], 'b', 1],
  [['a', 'b', 'c', 'd'], 'e', 0],
  [['c', 'd', 'e'], 'b', 0],
  [[], 'b', 0],
] as const)('refreshes count/position for %j and %s', (remaining, id, position) => {
  const previous = cursor(id), original = structuredClone(previous)
  expect(refreshReview(remaining, previous)).toEqual({ ...previous, count: remaining.length, position })
  expect(previous).toEqual(original)
})

it('keeps the old successor order through successive deletions and unrelated refreshes', () => {
  let previous = refreshReview(['a', 'c', 'd', 'e'], cursor('b'))
  previous = refreshReview(['a', 'd', 'e'], previous)
  previous = refreshReview(['a', 'd', 'e'], previous)
  expect(nextReview(['a', 'd', 'e'], previous)?.id).toBe('d')
  previous = refreshReview(['a'], previous)
  expect(previous.position).toBe(0)
  expect(nextReview(['a'], previous)?.id).toBe('a')
})

it('skips an Undo-restored pickup before the cursor and visits one after it', () => {
  const previous = cursor('c', ['b', 'c', 'e'])
  expect(nextReview(['a', 'b', 'c', 'e'], refreshReview(['a', 'b', 'c', 'e'], previous))?.id).toBe('e')
  expect(nextReview(['b', 'c', 'd', 'e'], refreshReview(['b', 'c', 'd', 'e'], previous))?.id).toBe('d')
})

it('handles Undo and Redo of the reviewed pickup, including an empty page', () => {
  const deleted = refreshReview(['a', 'c', 'd', 'e'], cursor('b'))
  const undone = refreshReview(order, deleted)
  expect(undone).toEqual(cursor('b'))
  expect(nextReview(order, undone)?.id).toBe('c')
  const redone = refreshReview(['a', 'c', 'd', 'e'], undone)
  expect(nextReview(['a', 'c', 'd', 'e'], redone)?.id).toBe('c')
  const empty = refreshReview([], cursor('c'))
  expect(nextReview([], empty)).toBeNull()
  expect(nextReview(order, refreshReview(order, empty))?.id).toBe('d')
})

it('uses the surviving old successor even if the current order changes', () => {
  const remaining = ['e', 'a', 'd', 'c']
  const refreshed = refreshReview(remaining, cursor('b'))
  expect(refreshed.position).toBe(3)
  expect(nextReview(remaining, refreshed)).toEqual({ id: 'c', position: 4, count: 4, order: remaining })
})

it('reads only entry IDs, deduplicates, excludes deleted marks and sorts page/top/left/id', () => {
  const marks = new Map([
    ['later-page', { id: 'later-page', pageIndex: 1, rect: [0, 0, 10, 10] }],
    ['lower', { id: 'lower', pageIndex: 0, rect: [0, 30, 10, 40] }],
    ['right', { id: 'right', pageIndex: 0, rect: [20, 10, 30, 20] }],
    ['b', { id: 'b', pageIndex: 0, rect: [0, 10, 10, 20] }],
    ['a', { id: 'a', pageIndex: 0, rect: [0, 10, 10, 20] }],
    ['deleted', { id: 'deleted', pageIndex: 0, rect: [0, 0, 10, 10], deleted: true }],
  ])
  const get = vi.fn((id: string) => marks.get(id))
  expect(reviewOrder(['later-page', 'lower', 'right', 'b', 'a', 'a', 'deleted', 'missing'].map(annotationId => ({ annotationId })), get))
    .toEqual(['a', 'b', 'right', 'lower', 'later-page'])
  expect(get.mock.calls.map(([id]) => id)).toEqual(['later-page', 'lower', 'right', 'b', 'a', 'deleted', 'missing'])
})

it('continues across real store bulk deletion, Undo and Redo with correct quantities', async () => {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [{ id: 'led', code: 'LED', name: 'LED', category: '電気', order: 0, style: nextCountStyle([]) }], async () => {})
  await store.ensurePageLoaded(0, async () => [])
  const ids = order.map((id, i) => store.create({ kind: 'symbol', pageIndex: 0, rect: [10, i * 20, 20, i * 20 + 10],
    count: { version: 2, id, fixtureId: 'led' } }).id)
  const currentOrder = () => reviewOrder(store.quantityIndex().entries('led'), id => store.get(id))
  let previous = cursor(ids[1], ids)
  store.removeMany(ids.slice(1, 4))
  previous = refreshReview(currentOrder(), previous)
  expect(store.quantityIndex().total('led')).toBe(2)
  expect(nextReview(currentOrder(), previous)?.id).toBe(ids[4])
  store.undo()
  previous = refreshReview(currentOrder(), previous)
  expect(previous.count).toBe(5)
  expect(store.quantityIndex().total('led')).toBe(5)
  expect(nextReview(currentOrder(), previous)?.id).toBe(ids[2])
  store.redo()
  previous = refreshReview(currentOrder(), previous)
  expect(previous.count).toBe(2)
  expect(nextReview(currentOrder(), previous)?.id).toBe(ids[4])
})
