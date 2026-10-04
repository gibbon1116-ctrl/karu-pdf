import { describe, expect, it, vi } from 'vitest'
import { cloudArcs, cloudDiameter, rectVertices } from '../src/core/cloud'
import { IssueNumbers, issueOrder, parseIssue } from '../src/core/issues'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { createIssueCsv, createAnnotationCsv, issueCsvFileName } from '../src/app/annotationCsv'
import type { Point } from '../src/core/annotations'

const rectangle = rectVertices([0, 0, 100, 60])
const concave: Point[] = [[0, 0], [100, 0], [100, 30], [40, 30], [40, 80], [0, 80]]
describe('cloud geometry', () => {
  it('100 by 60pt rectangle at 1pt uses 32 small, 26 medium and 16 large arcs', () => {
    expect([0,1,2].map(i => cloudArcs(rectangle, i as 0|1|2, 1).length)).toEqual([32,26,16])
  })
  for (const intensity of [0, 1, 2] as const) for (const width of [.5, 5]) {
    it(`size ${intensity}, width ${width}: outward arcs, expected count and closed joins for both windings`, () => {
      for (const polygon of [rectangle, concave, [...concave].reverse()]) {
        const arcs = cloudArcs(polygon, intensity, width)
        const expected = polygon.reduce((n, a, i) => {
          const b = polygon[(i + 1) % polygon.length]
          return n + Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cloudDiameter(intensity, width))
        }, 0)
        expect(arcs).toHaveLength(expected)
        const winding = Math.sign(polygon.reduce((s, p, i) => { const q = polygon[(i+1)%polygon.length]; return s+p[0]*q[1]-q[0]*p[1] },0))
        for (let i = 0; i < arcs.length; i++) {
          const a = arcs[i], b = arcs[(i+1)%arcs.length]
          expect(a.end).toEqual(b.start)
          const start = polygon[a.edge], end = polygon[(a.edge+1)%polygon.length]
          for (const control of [a.c1, a.c2]) {
            const cross = (end[0]-start[0])*(control[1]-start[1])-(end[1]-start[1])*(control[0]-start[0])
            expect(cross * winding).toBeLessThan(0)
          }
        }
      }
    })
  }
})
describe('document issue numbers and history', () => {
  it('scans only once, shares concurrent requests, preserves gaps and observes loaded numbers', async () => {
    const numbers = new IssueNumbers(), load = vi.fn(async () => 12)
    await Promise.all([numbers.initialize(load), numbers.initialize(load)])
    expect(load).toHaveBeenCalledTimes(1)
    expect(numbers.next()).toBe(13); expect(numbers.next()).toBe(14)
    numbers.observe(30); expect(numbers.next()).toBe(31)
    await numbers.initialize(load); expect(load).toHaveBeenCalledTimes(1)
  })
  it('delete/undo never recycles a number; paste gets fresh numbers and undoes as one step', () => {
    const store = new AnnotationStore()
    const a = store.create({ kind: 'issue', pageIndex: 0, rect: [0,0,16,16] })
    store.selectOnly(a.id); const clipboard = store.copySelected()
    store.remove(a.id)
    expect(store.create({ kind: 'issue', pageIndex: 0, rect: [20,20,36,36] }).issue?.number).toBe(2)
    const ids = store.pasteAnnotations([clipboard[0], clipboard[0]], 1, { width: 600, height: 800 }, 10)
    expect(ids.map(id => store.get(id)?.issue?.number)).toEqual([3,4])
    expect(store.toEdits().filter(e => e.kind === 'createIssue').map(e => e.issue.number)).toEqual([2,3,4])
    store.undo(); expect(store.getPageAnnotations(1)).toEqual([])
    store.redo(); expect(store.getPageAnnotations(1).map(a => a.issue?.number)).toEqual([3,4])
  })
  it('renumbers by page/top/left in a single undoable step including saved annotations', () => {
    const store = new AnnotationStore()
    const items = [[1,10,10], [0,100,10], [0,20,40], [0,20,10]].map(([pageIndex,y,x]) => store.create({ kind: 'issue', pageIndex, rect: [x,y,x+16,y+16] }))
    store.toEdits(); store.markApplied({ created: [100,101,102,103] })
    store.renumberIssues()
    expect([0,1].flatMap(i => store.getPageAnnotations(i)).map(a => a.issue?.number)).toEqual([3,2,1,4])
    expect(issueOrder(items).map(a => a.issue?.number)).toEqual([4,3,2,1])
    store.undo(); expect([0,1].flatMap(i => store.getPageAnnotations(i)).map(a => a.issue?.number)).toEqual([2,3,4,1])
    expect(store.toEdits()).toEqual([])
  })
  it('content/status/size/cloud vertices have independent undoable persisted results', () => {
    const store = new AnnotationStore(), a = store.create({ kind: 'issue', pageIndex: 0, rect: [100,100,116,116] })
    store.updateIssueText(a.id, '確認'); store.update(a.id, { issueStatus: 'done' })
    expect(store.get(a.id)?.issue?.status).toBe('done'); store.undo(); expect(store.get(a.id)?.issue?.status).toBe('open')
    expect(store.get(a.id)?.text).toBe('確認')
    const cloud = store.create({ kind: 'cloudPolygon', pageIndex: 0, rect: [0,0,100,60], vertices: rectangle })
    store.updateMeasureVertices(cloud.id, [[-10,0], ...rectangle.slice(1)])
    expect(store.get(cloud.id)?.rect).toEqual([-10,0,100,60]); store.undo(); expect(store.get(cloud.id)?.vertices).toEqual(rectangle)
    store.selectOnly(cloud.id); const copy = store.pasteAnnotations(store.copySelected(), 0, { width: 600, height: 800 }, 10)[0]
    expect(store.get(copy)?.vertices).toEqual(rectangle.map(p => [p[0]+10,p[1]+10]))
  })
  it('renumber updates the next number and undo restores the previous high-water mark', () => {
    const store = new AnnotationStore()
    store.create({ kind: 'issue', pageIndex: 0, rect: [0,0,16,16], issue: { number: 80, status: 'open' } })
    store.renumberIssues()
    expect(store.issueNumbers.current).toBe(1)
    const a = store.create({ kind: 'issue', pageIndex: 0, rect: [20,20,36,36] })
    expect(a.issue?.number).toBe(2)
    store.undo(); store.undo()
    expect(store.issueNumbers.current).toBe(80)
    expect(store.create({ kind: 'issue', pageIndex: 0, rect: [20,20,36,36] }).issue?.number).toBe(81)
  })
  it('invalid KaruIssue is ignored', () => {
    for (const value of ['{}','null','{"number":0,"status":"open"}','{"number":1,"status":"other"}']) expect(parseIssue(value)).toBeNull()
  })
})
it('issue CSV has exact columns, numeric order, escaped CRLF/commas/quotes, empty response and mm coordinates', () => {
  const store = new AnnotationStore()
  store.create({ kind: 'issue', pageIndex: 2, rect: [72,144,88,160], issue: { number: 12, status: 'done' }, text: '確認,"寸法"\n次の行' })
  store.create({ kind: 'issue', pageIndex: 0, rect: [0,0,16,16], issue: { number: 2, status: 'open' }, text: '先頭' })
  store.create({ kind: 'square', pageIndex: 0, rect: [0,0,10,10] })
  const all = [0,2].flatMap(i => store.getPageAnnotations(i))
  expect(createIssueCsv(all)).toBe('\uFEFF種類,番号,ページ,図面番号,内容,色,"位置（x, y mm）","大きさ（幅, 高さ mm）",状態,分野,回答,修正確認,引継ぎ元番号,引継ぎ元文書\r\n指摘,2,1,,先頭,#FF0000,"0.00, 0.00","5.64, 5.64",未回答,,,,,\r\n指摘,12,3,,"確認,""寸法""\r\n次の行",#808080,"25.40, 50.80","5.64, 5.64",対応済（旧版）,,,,,\r\n')
  expect(createAnnotationCsv(all)).toContain('指摘,12,3,,"確認,""寸法""\r\n次の行"')
  expect(issueCsvFileName('図面.PDF')).toBe('図面_指摘一覧.csv')
})

it('review details survive renumber and history, copies receive another stable identity', () => {
  const store = new AnnotationStore(), a = store.create({ kind: 'issue', pageIndex: 0, rect: [0,0,16,16] })
  const identity = a.issue!.id
  store.updateIssueDetails(a.id, { status: 'answered', discipline: '電気', answer: '変更します', drawingNumber: 'E-01' })
  store.updateIssueDetails(a.id, { status: 'confirmed', verification: '新版で確認' })
  store.undo(); expect(store.get(a.id)?.issue?.status).toBe('answered')
  store.redo(); store.renumberIssues()
  expect(store.get(a.id)?.issue).toMatchObject({ id: identity, status: 'confirmed', answer: '変更します' })
  store.selectOnly(a.id)
  const copy = store.pasteAnnotations(store.copySelected(), 0, { width: 600, height: 800 }, 20)[0]
  expect(store.get(copy)?.issue?.id).not.toBe(identity)
  expect(() => store.updateIssueDetails(a.id, { answer: 'a'.repeat(8001) })).toThrow()
  expect(parseIssue('{"number":1,"status":"done"}')).toEqual({ number: 1, status: 'done' })
})

it('引継ぎは元番号を保ち、衝突だけ付け直して元番号を残す', () => {
  const previous = new AnnotationStore(), next = new AnnotationStore()
  const source = [12, 20].map(number => previous.create({ kind: 'issue', pageIndex: 0, rect: [20,20,36,36], issue: { number, status: 'open', id: `previous-${number}`, sourceId: `old-${number}`, sourceDocument: '旧.pdf' } }))
  next.create({ kind: 'issue', pageIndex: 1, rect: [10,10,26,26], issue: { number: 12, status: 'confirmed' } })
  next.create({ kind: 'issue', pageIndex: 1, rect: [50,50,66,66], issue: { number: 30, status: 'open' } })
  const ids = next.pasteAnnotations(source, 0, { width: 600, height: 800 }, 0, { keepIssueNumbers: true })
  expect(ids.map(id => next.get(id)?.issue)).toMatchObject([
    { number: 31, sourceNumber: 12, sourceId: 'old-12', sourceDocument: '旧.pdf' }, { number: 20, sourceNumber: 20 },
  ])
  expect(ids.map(id => next.get(id)?.issue?.id)).not.toEqual(source.map(a => a.issue?.id))
  next.undo(); expect(next.getPageAnnotations(0)).toEqual([])
  next.redo(); expect(ids.map(id => next.get(id)?.issue?.number)).toEqual([31,20])
  expect(next.create({ kind: 'issue', pageIndex: 0, rect: [70,70,86,86] }).issue?.number).toBe(32)
  const retained = new AnnotationStore()
  const [id] = retained.pasteAnnotations([source[0]], 0, { width: 600, height: 800 }, 0, { keepIssueNumbers: true })
  expect(retained.get(id)?.issue).toMatchObject({ number: 12, sourceNumber: 12 })
  expect(retained.create({ kind: 'issue', pageIndex: 0, rect: [50,50,66,66] }).issue?.number).toBe(13)
})

it('sourceNumber は正の安全な整数だけを読み込む', () => {
  expect(parseIssue('{"number":3,"status":"open","sourceNumber":12}')).toEqual({ number: 3, status: 'open', sourceNumber: 12 })
  for (const sourceNumber of [0, -1, 1.5, '12', null, Number.MAX_SAFE_INTEGER + 1]) {
    expect(parseIssue(JSON.stringify({ number: 3, status: 'open', sourceNumber }))).toBeNull()
  }
})
