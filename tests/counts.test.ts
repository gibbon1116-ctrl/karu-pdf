import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { countFixtureId, parseCount } from '../src/core/counts'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createCountCsv } from '../src/app/annotationCsv'

it('counts 5,000 marks across 100 fixtures and two pages, preserving undo and copy identities', async () => {
  const store = new AnnotationStore(), fixtures: CountFixture[] = []
  for (let i = 0; i < 100; i++) fixtures.push({ id: `f${i}`, name: `項目${i}`, code: `F${i}`, category: '電気', order: i, style: nextCountStyle(fixtures) })
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  for (let i = 0; i < 5000; i++) store.create({ kind: 'symbol', pageIndex: Math.floor(i / 100) % 2, rect: [0, 0, 10, 10], symbol: 'circle', count: { version: 2, id: String(i), fixtureId: `f${i % 100}` } })
  const all = [0,1].flatMap(p => store.getPageAnnotations(p))
  expect([...store.countTotals().values()].every(pages => pages.get(0) === 25 && pages.get(1) === 25)).toBe(true)
  expect(createCountCsv(all, fixtures, 1)).toContain('電気,F99,項目99,,個数,個,場所別,50,25,25,25\r\n')
  const last = all.find(a => a.count?.id === '4999')!
  store.reassignCounts([last.id], 'f0'); expect(store.countTotals().get('f0')?.get(1)).toBe(26); store.undo()
  expect(countFixtureId(store.get(last.id)!.count!)).toBe('f99')
  store.remove(last.id); expect(store.countTotals().get('f99')?.get(1)).toBe(24)
  store.undo(); store.selectOnly(last.id)
  const copy = store.pasteAnnotations(store.copySelected(), 0, { width: 600, height: 800 }, 20)[0]
  expect(store.get(copy)?.count?.id).not.toBe(last.count!.id)
  expect(parseCount('{"version":1,"id":"x","group":" "}')).toBeNull()
  expect(parseCount('{"version":2,"id":"x","fixtureId":"f0"}')).toEqual({ version: 2, id: 'x', fixtureId: 'f0' })
})

it('undoes fixture additions, style edits and bulk deletion without persisting visibility', async () => {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [], async () => {})
  const first: CountFixture = { id: 'a', name: '照明', code: 'DL', category: '照明器具', order: 0, style: nextCountStyle([]) }
  const second: CountFixture = { ...first, id: 'b', name: 'コンセント', code: 'C', order: 1, style: nextCountStyle([first]) }
  store.setCountFixtures([first, second]); expect(store.isDirty()).toBe(true)
  store.undo(); expect(store.getCountFixtures()).toEqual([]); expect(store.isDirty()).toBe(false)
  store.redo()
  const a = store.create({ pageIndex: 0, kind: 'symbol', rect: [0, 0, 10, 10], count: { version: 2, id: 'mark', fixtureId: 'a' } })
  store.setCountFixtures([{ ...first, style: { ...first.style, size: 24 } }, second])
  expect(store.get(a.id)?.rect).toEqual([-7, -7, 17, 17]); store.undo(); expect(store.get(a.id)?.rect).toEqual([0, 0, 10, 10])
  store.selectOnly(a.id); store.setFixtureVisible(['a'], false)
  expect(store.selectedIds()).toEqual([]); expect(store.countTotals().get('a')?.get(0)).toBe(1)
  expect(store.selectInRect(0, [-10, -10, 20, 20])).toEqual([])
  store.selectOnly(a.id); expect(store.selectedIds()).toEqual([])
  store.showAllFixtures(); expect(store.selectInRect(0, [-10, -10, 20, 20])).toEqual([a.id])
  store.setCountFixtures([second], ['a']); expect(store.get(a.id)).toBeUndefined()
  store.undo(); expect(store.get(a.id)?.count).toEqual({ version: 2, id: 'mark', fixtureId: 'a' })
})

it('parses optional count locations, rejects invalid fields and omits empty locations', () => {
 const mark = { version: 2, id: 'a', fixtureId: 'f', floor: '1階', room: '事務室' }
 expect(parseCount(JSON.stringify(mark))).toEqual(mark)
 for (const key of ['floor', 'room']) for (const value of ['x'.repeat(41), 1, null]) expect(parseCount(JSON.stringify({ ...mark, [key]: value }))).toBeNull()
 expect(parseCount(JSON.stringify({ ...mark, floor: '', room: ' ' }))).toEqual({ version: 2, id: 'a', fixtureId: 'f' })
 expect(parseCount(JSON.stringify({ version: 1, id: 'a', group: '器具' }))).toEqual({ version: 1, id: 'a', group: '器具' })
})
