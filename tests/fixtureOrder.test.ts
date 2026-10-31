import { describe, expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { groupFixtures, moveCategory, moveFixture, renumber, stepFixture } from '../src/app/fixtureOrder'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const fixture = (id: string, category: string, order: number): CountFixture => ({ id, category, order, name: id, code: id, style: nextCountStyle([]) })
const ids = (items: readonly CountFixture[]) => items.map(f => f.id)
const groups = (items: readonly CountFixture[]) => groupFixtures(items).map(g => [g.category, ids(g.items)])
const orders = (items: readonly CountFixture[]) => expect(items.map(f => f.order)).toEqual(items.map((_, i) => i))
const mixed = [fixture('l1', '照明器具', 0), fixture('c1', 'コンセント', 1), fixture('l2', '照明器具', 3), fixture('c2', 'コンセント', 4)]

describe('fixture display order', () => {
  it('groups by minimum order, sorts within each category, and keeps input unchanged', () => {
    const input = [mixed[3], mixed[2], mixed[1], mixed[0]], before = structuredClone(input)
    expect(groups(input)).toEqual([['照明器具', ['l1', 'l2']], ['コンセント', ['c1', 'c2']]])
    expect(input).toEqual(before)
    const next = renumber(groupFixtures(input))
    orders(next); expect(ids(next)).toEqual(['l1', 'l2', 'c1', 'c2'])
    expect(next[0]).not.toBe(input[3])
  })
  it('moves a newly added item above all ten preset items', () => {
    const input = [...Array.from({ length: 10 }, (_, i) => fixture(`l${i}`, '照明器具', i)), fixture('new', '照明器具', 50)]
    const before = structuredClone(input), next = moveFixture(input, 'new', { beforeId: 'l0' })
    expect(ids(next)).toEqual(['new', ...Array.from({ length: 10 }, (_, i) => `l${i}`)])
    orders(next); expect(input).toEqual(before)
  })
  it('moves before/after another category row and to a category end', () => {
    const before = moveFixture(mixed, 'l2', { beforeId: 'c1' })
    expect(groups(before)).toEqual([['照明器具', ['l1']], ['コンセント', ['l2', 'c1', 'c2']]])
    expect(before.find(f => f.id === 'l2')?.category).toBe('コンセント'); orders(before)
    expect(groups(moveFixture(mixed, 'l2', { afterId: 'c1' }))).toEqual([['照明器具', ['l1']], ['コンセント', ['c1', 'l2', 'c2']]])
    const end = moveFixture(mixed, 'l1', { endOfCategory: 'コンセント' })
    expect(groups(end)).toEqual([['照明器具', ['l2']], ['コンセント', ['c1', 'c2', 'l1']]]); orders(end)
    expect(groups(moveFixture([mixed[0], mixed[1]], 'l1', { endOfCategory: 'コンセント' }))).toEqual([['コンセント', ['c1', 'l1']]])
  })
  it('moves whole categories and preserves their item order', () => {
    const before = structuredClone(mixed)
    const first = moveCategory(mixed, 'コンセント', { beforeCategory: '照明器具' })
    expect(groups(first)).toEqual([['コンセント', ['c1', 'c2']], ['照明器具', ['l1', 'l2']]]); orders(first)
    const end = moveCategory(first, 'コンセント', { end: true })
    expect(groups(end)).toEqual(groups(mixed)); orders(end); expect(mixed).toEqual(before)
  })
  it('steps within a category despite interleaved orders, returning null at its ends', () => {
    const up = stepFixture(mixed, 'l2', -1)!
    expect(groups(up)).toEqual([['照明器具', ['l2', 'l1']], ['コンセント', ['c1', 'c2']]]); orders(up)
    expect(groups(stepFixture(mixed, 'c1', 1)!)).toEqual([['照明器具', ['l1', 'l2']], ['コンセント', ['c2', 'c1']]])
    expect(stepFixture(mixed, 'l1', -1)).toBeNull(); expect(stepFixture(mixed, 'l2', 1)).toBeNull()
    expect(stepFixture(mixed, 'missing', -1)).toBeNull()
  })
  it('handles self/invalid/empty moves without changing display order', () => {
    for (const next of [moveFixture(mixed, 'l1', { beforeId: 'l1' }), moveFixture(mixed, 'missing', { beforeId: 'c1' }), moveFixture(mixed, 'l1', { beforeId: 'missing' }), moveFixture(mixed, 'l1', { endOfCategory: 'missing' }), moveCategory(mixed, '照明器具', { beforeCategory: '照明器具' }), moveCategory(mixed, 'missing', { end: true }), moveCategory(mixed, '照明器具', { beforeCategory: 'missing' })]) {
      expect(groups(next)).toEqual(groups(mixed)); orders(next)
    }
    expect(moveFixture([], 'x', { beforeId: 'y' })).toEqual([])
    expect(moveCategory([], 'x', { end: true })).toEqual([])
  })
  it('undoes category/order changes in one step without changing marks', async () => {
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => mixed, async () => {})
    const mark = store.create({ pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10], count: { version: 2, id: 'mark', fixtureId: 'l2' } })
    const before = structuredClone(store.get(mark.id))
    store.setCountFixtures(moveFixture(mixed, 'l2', { beforeId: 'c1' }))
    expect(store.get(mark.id)).toEqual(before)
    store.undo(); expect(store.getCountFixtures()).toEqual(mixed); expect(store.get(mark.id)).toEqual(before)
    store.redo(); expect(store.getCountFixture('l2')?.category).toBe('コンセント')
  })
  it('keeps quantity visibility screen-only, preserves it on reset(true), defaults on reset()', () => {
    const store = new AnnotationStore(), snapshot = store.getSnapshot()
    expect(store.showQuantityValues).toBe(true)
    store.setShowQuantityValues(false)
    expect(store.getSnapshot()).not.toBe(snapshot); expect(store.isDirty()).toBe(false); expect(store.canUndo()).toBe(false)
    expect(store.toEdits()).toEqual([])
    store.reset(true); expect(store.showQuantityValues).toBe(false)
    store.reset(); expect(store.showQuantityValues).toBe(true)
  })
})
