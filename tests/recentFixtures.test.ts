import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, serializeCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { adjacentPickupFixture } from '../src/app/fixtureQuickList'

const fixture = (id: string, order = 0, category = '電気'): CountFixture => ({ id, order, category, code: id, name: id, style: nextCountStyle([]) })

it('remembers selection newest first without duplicates, retaining at most eight', () => {
  const store = new AnnotationStore()
  for (let i = 0; i < 10; i++) store.selectFixture(String(i))
  expect(store.recentFixtureIds).toEqual(['9', '8', '7', '6', '5', '4', '3', '2'])
  store.selectFixture('5'); store.selectFixture(null)
  expect(store.recentFixtureIds).toEqual(['5', '9', '8', '7', '6', '4', '3', '2'])
})

it('removes deleted items, preserves recents during page reloading, and clears on ordinary reset', async () => {
  const store = new AnnotationStore(), fixtures = [fixture('a'), fixture('b', 1)]
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  store.selectFixture('a'); store.selectFixture('b')
  store.setCountFixtures([fixtures[0]], ['b'])
  expect(store.recentFixtureIds).toEqual(['a'])
  store.reset(true)
  expect(store.recentFixtureIds).toEqual(['a'])
  await store.ensureCountFixtures(async () => [fixtures[0]], async () => {})
  expect(store.recentFixtureIds).toEqual(['a'])
  expect(serializeCountFixtures(store.getCountFixtures())).not.toContain('recentFixture')
  store.reset()
  expect(store.recentFixtureIds).toEqual([])
})

it('creating count marks and quantity routes moves their item to the front', () => {
  const store = new AnnotationStore()
  store.selectFixture('a'); store.selectFixture('b')
  store.create({ kind: 'symbol', symbol: 'circle', pageIndex: 0, rect: [10, 10, 20, 20], count: { version: 2, id: 'mark', fixtureId: 'a' } })
  expect(store.recentFixtureIds).toEqual(['a', 'b'])
  store.create({ kind: 'perimeter', pageIndex: 0, rect: [30, 30, 60, 30], vertices: [[30, 30], [60, 30]], quantity: { version: 1, id: 'route', itemId: 'c', method: 'polyline' } })
  expect(store.recentFixtureIds).toEqual(['c', 'a', 'b'])
})

it('previous and next follow grouped order across categories, including selected pickups', () => {
  const store = new AnnotationStore()
  store.setCountFixtures([fixture('a', 0), fixture('b', 1, '配管'), fixture('c', 2)])
  store.selectFixture('a')
  expect(adjacentPickupFixture(store, -1)).toBeUndefined()
  expect(adjacentPickupFixture(store, 1)?.id).toBe('c')
  const mark = store.create({ kind: 'symbol', pageIndex: 0, rect: [10, 10, 20, 20], count: { version: 2, id: 'mark', fixtureId: 'b' } })
  store.selectOnly(mark.id)
  expect(adjacentPickupFixture(store, -1)?.id).toBe('c')
  expect(adjacentPickupFixture(store, 1)).toBeUndefined()
})
