import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { countFixtureId, countMembers, parseCount, validCountComponents, type CountComponent, type CountMark } from '../src/core/counts'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createCountCsv } from '../src/app/annotationCsv'

it('counts 5,000 marks across 100 fixtures and two pages, preserving undo and copy identities', async () => {
  const store = new AnnotationStore(), fixtures: CountFixture[] = []
  for (let i = 0; i < 100; i++) fixtures.push({ id: `f${i}`, name: `項目${i}`, code: `F${i}`, category: '電気', order: i, style: nextCountStyle(fixtures) })
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  for (let i = 0; i < 5000; i++) store.create({ kind: 'symbol', pageIndex: Math.floor(i / 100) % 2, rect: [0, 0, 10, 10], symbol: 'circle', count: { version: 2, id: String(i), fixtureId: `f${i % 100}` } })
  const all = [0,1].flatMap(p => store.getPageAnnotations(p))
  expect([...store.countTotals().values()].every(pages => pages.get(0) === 25 && pages.get(1) === 25)).toBe(true)
 expect(createCountCsv(all, fixtures, 1)).toContain('電気,F99,項目99,,,施工条件別,個数,個,場所別,,,,50,25,25,25\r\n')
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

it('round-trips count components with optional conditions and strips unrelated fields', () => {
  const mark: CountMark = {
    version: 2, id: 'switch', fixtureId: 'SW', floor: '1階', room: '事務室', condition: '露出',
    extra: [{ itemId: 'SB', count: 1, condition: '隠ぺい（埋込）' }, { itemId: 'PL', count: 2 }],
  }
  expect(parseCount(JSON.stringify(mark))).toEqual(mark)
  expect(parseCount(JSON.stringify({
    ...mark,
    extra: mark.extra!.map(e => ({ ...e, ignored: 'discard', nested: { value: 1 } })),
  }))).toEqual(mark)
  expect(parseCount(JSON.stringify({ version: 2, id: 'a', fixtureId: 'SW', extra: [] })))
    .toEqual({ version: 2, id: 'a', fixtureId: 'SW' })
  expect(validCountComponents('SW', [])).toBe(true)
})

it('discards invalid components without losing the main count', () => {
  const main = { version: 2 as const, id: 'a', fixtureId: 'SW' }
  const invalid: unknown[] = [
    Array.from({ length: 11 }, (_, i) => ({ itemId: 'f' + i, count: 1 })),
    [{ itemId: 'SB', count: 0 }],
    [{ itemId: 'SB', count: 100 }],
    [{ itemId: 'SB', count: 1.5 }],
    [{ itemId: 'SW', count: 1 }],
    [{ itemId: 'SB', count: 1 }, { itemId: 'SB', count: 2 }],
    [{ itemId: 'SB', count: 1, condition: ' padded ' }],
    [{ itemId: 'SB', count: 1, condition: '' }],
    [{ itemId: 'SB', count: 1, condition: 'a\nb' }],
    [{ itemId: 'SB', count: 1, condition: null }],
    [{ itemId: '', count: 1 }],
    [{ itemId: 'x'.repeat(81), count: 1 }],
    [null], null, {},
  ]
  for (const extra of invalid) expect(parseCount(JSON.stringify({ ...main, extra }))).toEqual(main)
  expect(validCountComponents('SW', [{ itemId: 'x'.repeat(80), count: 99 }])).toBe(true)
  expect(validCountComponents('SW', new Array<CountComponent>(1))).toBe(false)
})

it('accepts up to 2400 characters and returns main-first independent member copies', () => {
  const main = { version: 2 as const, id: 'a', fixtureId: 'SW' }
  const raw = JSON.stringify(main).padEnd(2400, ' ')
  expect(parseCount(raw)).toEqual(main)
  expect(parseCount(raw + ' ')).toBeNull()
  const mark: CountMark = {
    ...main, condition: '露出',
    extra: [{ itemId: 'SB', count: 1, condition: '隠ぺい（埋込）' }, { itemId: 'PL', count: 2 }],
  }
  const members = countMembers(mark)
  expect(members).toEqual([
    { itemId: 'SW', count: 1, condition: '露出' },
    { itemId: 'SB', count: 1, condition: '隠ぺい（埋込）' },
    { itemId: 'PL', count: 2 },
  ])
  members[1].count = 9
  expect(mark.extra![0].count).toBe(1)
  const legacy: CountMark = { version: 1, id: 'old', group: 'スイッチ' }
  expect(countMembers(legacy)).toEqual([{ itemId: countFixtureId(legacy), count: 1 }])
})
