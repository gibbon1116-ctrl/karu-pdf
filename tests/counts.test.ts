import { expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { countSummary, parseCount } from '../src/core/counts'
import { createCountCsv } from '../src/app/annotationCsv'

it('groups 5000 marks by type and page, preserving undo, copy identities and numeric CSV', () => {
  const store = new AnnotationStore()
  for (let i = 0; i < 5000; i++) store.create({ kind: 'symbol', pageIndex: i % 2, rect: [0,0,8,8], symbol: 'circle', count: { version: 1, id: String(i), group: i < 3000 ? '照明器具' : '=コンセント' } })
  const all = [0,1].flatMap(p => store.getPageAnnotations(p))
  expect(countSummary(all).map(a => a.total).sort()).toEqual([1000,1000,1500,1500])
  expect(createCountCsv(all)).toContain("'=コンセント,1,1000")
  const last = all.find(a => a.count?.id === '4999')!
  store.update(last.id, { countGroup: '感知器' }); store.undo()
  expect(store.get(last.id)?.count?.group).toBe('=コンセント')
  store.remove(last.id); expect(countSummary([0,1].flatMap(p => store.getPageAnnotations(p))).reduce((n,a) => n+a.total, 0)).toBe(4999)
  store.undo(); store.selectOnly(last.id)
  const copy = store.pasteAnnotations(store.copySelected(), 0, { width: 600, height: 800 }, 20)[0]
  expect(store.get(copy)?.count?.id).not.toBe(last.count!.id)
  expect(parseCount('{"version":1,"id":"x","group":" "}')).toBeNull()
})
