import { describe, expect, it, vi } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { parseSymbolSearchPages } from '../src/app/SymbolSearchPanel'

const fixture: CountFixture = { id: 'led', code: 'LED', name: '照明', category: '電気', order: 0,
  style: { shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: .8, showCode: true } }
const sampleRect: Rect = [0, 0, 12, 20]
const candidate = (x: number, y: number, pageIndex = 0) => ({ pageIndex, center: [x, y] as Point, rect: [x - 6, y - 10, x + 6, y + 10] as Rect, score: .87 })
async function setup() {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [fixture, { ...fixture, id: 'other', name: '別の項目', order: 1 }], async () => {})
  store.selectFixture('led')
  return store
}

describe('visual search count marks', () => {
  it('selects only pending high candidates and keeps confidence transient', async () => {
    const store = await setup(), dirty = store.dirtySummary()
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([
      {...candidate(40,50),confidence:'high',imageScore:.9,extra:.05}, {...candidate(80,50),confidence:'check',imageScore:.2,extra:.6},
      {...candidate(120,50),confidence:'high',imageScore:.95}, candidate(160,50), {...candidate(200,50),confidence:'high',imageScore:.8},
    ])
    store.toggleSymbolCandidate(store.symbolCandidates![1].id)
    store.toggleSymbolCandidate(store.symbolCandidates![4].id)
    store.createCountMarks('led',[{pageIndex:0,center:[120,50]}])
    store.chooseHighConfidenceCandidates()
    expect(store.symbolCandidates?.map(c=>c.state)).toEqual(['chosen','chosen','counted','pending','chosen'])
    expect(store.symbolCandidates?.[0]).toMatchObject({confidence:'high',imageScore:.9,extra:.05})
    store.undo(); expect(store.dirtySummary()).toEqual(dirty)
    expect(store.toEdits()).toEqual([]); expect(store.canUndo()).toBe(false)
  })
  it('creates marks at the centers with locations and uses one undo/redo step and one notification', async () => {
    const store = await setup()
    store.currentFloor = '2F'; store.currentRoom = ' 会議室 '
    const notified = vi.fn(), unsubscribe = store.subscribe(notified)
    const points = [{ pageIndex: 0, center: [40, 50] as Point }, { pageIndex: 1, center: [60, 70] as Point }, { pageIndex: 1, center: [80, 90] as Point }]
    const ids = store.createCountMarks('led', points)
    expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(3); expect(notified).toHaveBeenCalledTimes(1)
    expect(store.quantityIndex().total('led')).toBe(3)
    ids.forEach((id, i) => {
      const mark = store.get(id)!
      expect(mark.pageIndex).toBe(points[i].pageIndex)
      expect(mark.rect).toEqual([points[i].center[0] - 5, points[i].center[1] - 5, points[i].center[0] + 5, points[i].center[1] + 5])
      expect(mark.count).toMatchObject({ version: 2, fixtureId: 'led', floor: '2階', room: '会議室' })
    })
    store.undo()
    expect(store.quantityIndex().total('led')).toBe(0); expect(store.canUndo()).toBe(false)
    store.redo()
    expect(store.quantityIndex().total('led')).toBe(3)
    expect(ids.every(id => !!store.get(id))).toBe(true)
    unsubscribe()
  })
  it('derives page-specific locations and rejects non-count items and invalid points before creating any mark', async () => {
    const store = await setup()
    store.setDrawingInfo([0], { number: 'E-1', name: '1階 電灯設備平面図' })
    store.setDrawingInfo([1], { number: 'E-2', name: '2階 電灯設備平面図' })
    const ids = store.createCountMarks('led', [{ pageIndex: 0, center: [10, 10] }, { pageIndex: 1, center: [10, 10] }])
    expect(store.get(ids[0])?.count).toMatchObject({ floor: '1階' })
    expect(store.get(ids[1])?.count).toMatchObject({ floor: '2階' })
    store.setCountFixtures([...store.getCountFixtures(), { ...fixture, id: 'length', kind: 'length', method: 'polyline', order: 2 }])
    expect(() => store.createCountMarks('length', [{ pageIndex: 0, center: [20, 20] }])).toThrow()
    expect(() => store.createCountMarks('led', [{ pageIndex: 0, center: [20, 20] }, { pageIndex: -1, center: [30, 30] }])).toThrow()
    expect(store.quantityIndex().total('led')).toBe(2)
  })
})

describe('memory-only candidates', () => {
  it('classifies only marks of the same fixture and page, using half of the shorter sample side', async () => {
    const store = await setup()
    store.createCountMarks('led', [{ pageIndex: 0, center: [50, 50] }])
    store.createCountMarks('other', [{ pageIndex: 0, center: [100, 100] }])
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(56, 50), candidate(56.01, 50), candidate(50, 50, 1), candidate(100, 100)])
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'pending', 'pending', 'pending'])
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    expect(store.symbolCandidates![0].state).toBe('counted')
    const id = store.symbolCandidates![1].id
    store.toggleSymbolCandidate(id); expect(store.symbolCandidates![1].state).toBe('chosen')
    store.toggleSymbolCandidate(id); expect(store.symbolCandidates![1].state).toBe('pending')
    store.chooseSymbolCandidates(true)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'chosen', 'chosen', 'chosen'])
    store.chooseSymbolCandidates(false)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'pending', 'pending', 'pending'])
  })
  it('keeps candidates out of dirty state/history and drops them when closing, changing item or resetting', async () => {
    const store = await setup(), index = store.quantityIndex(), dirty = store.dirtySummary()
    expect(store.symbolCandidates).toBeNull()
    store.beginSymbolCandidates('led', sampleRect); store.appendSymbolCandidates([candidate(40, 50)])
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    expect(store.quantityIndex()).toBe(index); expect(store.dirtySummary()).toEqual(dirty); expect(store.canUndo()).toBe(false)
    expect(store.toEdits()).toEqual([])
    store.clearSymbolCandidates(); expect(store.symbolCandidates).toBeNull()
    store.beginSymbolCandidates('led', sampleRect); store.appendSymbolCandidates([candidate(40, 50)])
    store.selectFixture('other'); expect(store.symbolCandidates).toBeNull()
    store.selectFixture('led'); store.beginSymbolCandidates('led', sampleRect)
    store.reset(); expect(store.symbolCandidates).toBeNull()
  })
  it('updates counted after batch addition, undo and redo without adding candidate history', async () => {
    const store = await setup()
    store.beginSymbolCandidates('led', sampleRect); store.appendSymbolCandidates([candidate(40, 50), candidate(80, 90)])
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    store.createCountMarks('led', [{ pageIndex: 0, center: [40, 50] }])
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'pending'])
    store.undo(); expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'pending']); expect(store.canUndo()).toBe(false)
    store.redo(); expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'pending'])
  })
})

describe('page selection', () => {
  it('parses, deduplicates and sorts one-based ranges', () => {
    expect(parseSymbolSearchPages('1-3, 5', 5)).toEqual([0, 1, 2, 4])
    expect(parseSymbolSearchPages(' 5, 2 - 3, 2, 1 ', 5)).toEqual([0, 1, 2, 4])
  })
  it.each(['', '0', '6', '1-6', '3-1', '1,', ',1', '1--3', '1.5', 'abc', '1 2', '-1', '9007199254740992'])('rejects invalid pages %s', text => {
    expect(() => parseSymbolSearchPages(text, 5)).toThrow(Error)
  })
})
