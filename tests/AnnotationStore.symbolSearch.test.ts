import { describe, expect, it, vi } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import type { SymbolShapeDecision } from '../src/core/symbolShapeDecision'
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
  it('filters labels and G for toggling, bulk selection, high confidence and quantity addition without deleting candidates', async () => {
    const store=await setup()
    store.beginSymbolCandidates('led',sampleRect)
    store.appendSymbolCandidates([
      {...candidate(40,50),label:'ET',gc:false,confidence:'high'},
      {...candidate(80,50),label:'ET',gc:true,confidence:'high'},
      {...candidate(120,50),label:'4H',confidence:'high'},
      {...candidate(160,50),label:'',confidence:'check'},
    ])
    store.setSymbolCandidateFilters(['ET'],'with');store.chooseSymbolCandidates(true)
    expect(store.symbolCandidates?.map(c=>c.state)).toEqual(['pending','chosen','pending','pending'])
    store.toggleSymbolCandidate(store.symbolCandidates![2].id)
    expect(store.symbolCandidates![2].state).toBe('pending')
    store.setSymbolCandidateFilters(['ET'],'without');store.chooseHighConfidenceCandidates()
    expect(store.visibleSymbolCandidates).toHaveLength(1)
    // This is the same visible-only source used by the panel's quantity action.
    const selected=store.visibleSymbolCandidates!.filter(c=>c.state==='chosen')
    store.createCountMarks('led',selected.map(c=>({pageIndex:c.pageIndex,center:c.center})))
    expect(store.quantityIndex().total('led')).toBe(1)
    expect(store.symbolCandidates).toHaveLength(4)
    store.setSymbolCandidateFilters(['ET',''],'all')
    expect(store.visibleSymbolCandidates).toHaveLength(3)
    store.setSymbolCandidateFilters(null,'all');expect(store.visibleSymbolCandidates).toHaveLength(4)
  })
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
    expect(store.symbolCandidates?.map(c => c.otherFixture)).toEqual([undefined, undefined, undefined, 'other'])
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    expect(store.symbolCandidates![0].state).toBe('counted')
    const id = store.symbolCandidates![1].id
    store.toggleSymbolCandidate(id); expect(store.symbolCandidates![1].state).toBe('chosen')
    store.toggleSymbolCandidate(id); expect(store.symbolCandidates![1].state).toBe('pending')
    store.chooseSymbolCandidates(true)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'chosen', 'chosen', 'pending'])
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

describe('other-fixture candidates', () => {
  it('hides other-fixture candidates by default and shows them without changing persisted state', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }])
    const index = store.quantityIndex(), dirty = store.dirtySummary(), edits = store.toEdits()
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(40, 50), candidate(80, 50)])
    expect(store.symbolOtherFilter).toBe('hide')
    expect(store.symbolCandidates).toHaveLength(2)
    expect(store.symbolCandidates![0]).toMatchObject({ state: 'pending', otherFixture: 'other' })
    expect(store.isSymbolCandidateVisible(store.symbolCandidates![0])).toBe(false)
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[80, 50]])
    expect(store.symbolOtherFixtureLabel('other')).toBe('LED 別の項目')

    store.setSymbolOtherFilter('show')
    expect(store.isSymbolCandidateVisible(store.symbolCandidates![0])).toBe(true)
    expect(store.visibleSymbolCandidates).toHaveLength(2)
    store.setSymbolOtherFilter('hide')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[80, 50]])
    expect(store.quantityIndex()).toBe(index)
    expect(store.dirtySummary()).toEqual(dirty)
    expect(store.toEdits()).toEqual(edits)
    store.undo()
    expect(store.canUndo()).toBe(false)
    expect(store.quantityIndex().total('other')).toBe(0)
  })
  it('blocks other-fixture candidates in all three selection actions even when shown and excludes them from quantity addition', async () => {
    const store = await setup()
    const ids = store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }])
    const originalMark = JSON.stringify(store.get(ids[0]))
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([
      { ...candidate(40, 50), confidence: 'high' },
      { ...candidate(80, 50), confidence: 'high' },
    ])
    store.setSymbolOtherFilter('show')
    expect(store.visibleSymbolCandidates).toHaveLength(2)
    const blockedId = store.symbolCandidates![0].id
    store.toggleSymbolCandidate(blockedId)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'pending'])

    store.chooseSymbolCandidates(true)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'chosen'])
    store.chooseSymbolCandidates(false)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'pending'])

    store.chooseHighConfidenceCandidates()
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'chosen'])
    const selected = store.visibleSymbolCandidates!.filter(c => c.state === 'chosen' && !c.otherFixture)
    expect(selected.map(c => c.center)).toEqual([[80, 50]])
    store.createCountMarks('led', selected.map(c => ({ pageIndex: c.pageIndex, center: c.center })))
    expect(store.quantityIndex().total('led')).toBe(1)
    expect(store.quantityIndex().total('other')).toBe(1)
    expect(JSON.stringify(store.get(ids[0]))).toBe(originalMark)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'counted'])
    expect(store.symbolCandidates![0].otherFixture).toBe('other')
  })
  it('uses the nearest other-fixture mark on the same page and includes the radius boundary', async () => {
    const store = await setup()
    store.setCountFixtures([...store.getCountFixtures(), { ...fixture, id: 'near', code: 'N', name: '近い項目', order: 2 }])
    store.createCountMarks('other', [{ pageIndex: 0, center: [54, 50] }])
    store.createCountMarks('near', [{ pageIndex: 0, center: [52, 50] }])
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(50, 50), candidate(60, 50), candidate(60.01, 50), candidate(50, 50, 1)])
    expect(store.symbolCandidates?.map(c => c.otherFixture)).toEqual(['near', 'other', undefined, undefined])
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(store.visibleSymbolCandidates?.map(c => [c.pageIndex, ...c.center])).toEqual([[0, 60.01, 50], [1, 50, 50]])
  })
  it('prioritizes counted marks of the same fixture and removes otherFixture while counted', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }])
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(40, 50)])
    expect(store.symbolCandidates![0].otherFixture).toBe('other')

    store.createCountMarks('led', [{ pageIndex: 0, center: [45, 50] }])
    expect(store.symbolCandidates![0].state).toBe('counted')
    expect(store.symbolCandidates![0]).not.toHaveProperty('otherFixture')
    expect(store.visibleSymbolCandidates).toHaveLength(1)
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    expect(store.symbolCandidates![0].state).toBe('counted')

    store.undo()
    expect(store.symbolCandidates![0]).toMatchObject({ state: 'pending', otherFixture: 'other' })
    expect(store.visibleSymbolCandidates).toHaveLength(0)
    store.redo()
    expect(store.symbolCandidates![0].state).toBe('counted')
    expect(store.symbolCandidates![0]).not.toHaveProperty('otherFixture')
    expect(store.visibleSymbolCandidates).toHaveLength(1)
  })
  it('removes otherFixture after undo and allows selection, then blocks it again after redo', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }])
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(40, 50)])
    const id = store.symbolCandidates![0].id
    expect(store.visibleSymbolCandidates).toHaveLength(0)
    expect(store.symbolCandidates![0].otherFixture).toBe('other')

    store.undo()
    expect(store.symbolCandidates![0]).not.toHaveProperty('otherFixture')
    expect(store.visibleSymbolCandidates).toHaveLength(1)
    expect(store.canUndo()).toBe(false)
    store.toggleSymbolCandidate(id)
    expect(store.symbolCandidates![0].state).toBe('chosen')

    store.redo()
    expect(store.symbolCandidates![0]).toMatchObject({ state: 'pending', otherFixture: 'other' })
    expect(store.visibleSymbolCandidates).toHaveLength(0)
    store.setSymbolOtherFilter('show')
    store.toggleSymbolCandidate(id)
    expect(store.symbolCandidates![0].state).toBe('pending')
    expect(store.quantityIndex().total('led')).toBe(0)
    expect(store.quantityIndex().total('other')).toBe(1)
  })
  it('ignores deleted other-fixture marks when quantities are refreshed and allows selection again', async () => {
    const store = await setup()
    const ids = store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }])
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(40, 50)])
    expect(store.symbolCandidates![0].otherFixture).toBe('other')
    expect(store.visibleSymbolCandidates).toHaveLength(0)

    // Delete the other fixture's mark through the store, as the user would.
    store.remove(ids[0])
    expect(store.symbolCandidates![0]).not.toHaveProperty('otherFixture')
    expect(store.visibleSymbolCandidates).toHaveLength(1)
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    expect(store.symbolCandidates![0].state).toBe('chosen')
    expect(store.quantityIndex().total('led')).toBe(0)
    expect(store.quantityIndex().total('other')).toBe(0)
  })
  it('returns chosen candidates to pending when another fixture gains a mark at their position', async () => {
    const store = await setup()
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(40, 50), candidate(80, 50)])
    store.chooseSymbolCandidates(true)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['chosen', 'chosen'])

    store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }])
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'chosen'])
    expect(store.symbolCandidates![0].otherFixture).toBe('other')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[80, 50]])

    store.undo()
    expect(store.symbolCandidates![0]).not.toHaveProperty('otherFixture')
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'chosen'])
    store.toggleSymbolCandidate(store.symbolCandidates![0].id)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['chosen', 'chosen'])
    expect(store.canUndo()).toBe(false)
  })
  it('combines the other-fixture filter with shape, label and G filters', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [40, 50] }, { pageIndex: 0, center: [80, 50] }])
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([
      { ...candidate(40, 50), label: 'ET', gc: true, shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(80, 50), label: 'ET', gc: true, shape: { decision: 'different', differences: ['topArc'], unknown: [] } },
      { ...candidate(120, 50), label: 'ET', gc: true, shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(160, 50), label: 'ET', gc: false, shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(200, 50), label: '4H', gc: true, shape: { decision: 'same', differences: [], unknown: [] } },
    ])
    store.setSymbolCandidateFilters(['ET'], 'with')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[120, 50]])
    store.setSymbolOtherFilter('show')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[40, 50], [120, 50]])
    store.setSymbolShapeFilter('all')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[40, 50], [80, 50], [120, 50]])
    store.setSymbolOtherFilter('hide')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[120, 50]])
    expect(store.symbolShapeFilter).toBe('all')
    expect(store.symbolLabelFilter).toEqual(['ET'])
    expect(store.symbolGcFilter).toBe('with')
    store.setSymbolCandidateFilters(['ET'], 'without')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[160, 50]])
    expect(store.symbolCandidates).toHaveLength(5)
  })
  it('resets the other-fixture filter on begin and clear, including clear without candidates, without changing persisted state', async () => {
    const store = await setup(), index = store.quantityIndex(), dirty = store.dirtySummary()
    expect(store.symbolCandidates).toBeNull()
    store.setSymbolOtherFilter('show')
    store.clearSymbolCandidates()
    expect(store.symbolCandidates).toBeNull()
    expect(store.symbolOtherFilter).toBe('hide')

    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([candidate(40, 50)])
    store.setSymbolOtherFilter('show')
    store.beginSymbolCandidates('led', sampleRect)
    expect(store.symbolCandidates).toEqual([])
    expect(store.symbolOtherFilter).toBe('hide')

    store.setSymbolOtherFilter('show')
    store.clearSymbolCandidates()
    expect(store.symbolCandidates).toBeNull()
    expect(store.symbolOtherFilter).toBe('hide')
    expect(store.quantityIndex()).toBe(index)
    expect(store.dirtySummary()).toEqual(dirty)
    expect(store.toEdits()).toEqual([])
    expect(store.canUndo()).toBe(false)
  })
})

describe('shape-filtered candidates', () => {
  it('hides different shapes by default while retaining same, unknown and untested candidates', async () => {
    const store = await setup()
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([
      { ...candidate(40, 50), shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(80, 50), shape: { decision: 'different', differences: ['topArc', 'interior'], unknown: [] } },
      { ...candidate(120, 50), shape: { decision: 'unknown', differences: [], unknown: ['topArc'] } },
      candidate(160, 50),
    ])
    expect(store.symbolShapeFilter).toBe('same')
    expect(store.symbolCandidates).toHaveLength(4)
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[40, 50], [120, 50], [160, 50]])
    expect(store.isSymbolCandidateVisible(store.symbolCandidates![1])).toBe(false)
    store.setSymbolShapeFilter('all')
    expect(store.visibleSymbolCandidates).toHaveLength(4)
    store.setSymbolShapeFilter('same')
    expect(store.visibleSymbolCandidates).toHaveLength(3)
  })
  it('blocks hidden shapes in all selection actions and excludes already chosen hidden shapes from quantity addition', async () => {
    const store = await setup()
    store.beginSymbolCandidates('led', sampleRect)
    // Use high confidence even for the different shape to test visibility independently of confidence.
    store.appendSymbolCandidates([
      { ...candidate(40, 50), confidence: 'high', shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(80, 50), confidence: 'high', shape: { decision: 'different', differences: ['topArc'], unknown: [] } },
    ])
    const hiddenId = store.symbolCandidates![1].id
    store.chooseSymbolCandidates(true)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['chosen', 'pending'])
    store.chooseSymbolCandidates(false)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'pending'])
    store.chooseHighConfidenceCandidates()
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['chosen', 'pending'])
    store.toggleSymbolCandidate(hiddenId)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['chosen', 'pending'])

    store.setSymbolShapeFilter('all')
    store.toggleSymbolCandidate(hiddenId)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['chosen', 'chosen'])
    store.setSymbolShapeFilter('same')
    store.chooseSymbolCandidates(false)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['pending', 'chosen'])
    store.chooseHighConfidenceCandidates()
    const selected = store.visibleSymbolCandidates!.filter(c => c.state === 'chosen')
    expect(selected).toHaveLength(1)
    store.createCountMarks('led', selected.map(c => ({ pageIndex: c.pageIndex, center: c.center })))
    expect(store.quantityIndex().total('led')).toBe(1)
    expect(store.symbolCandidates?.map(c => c.state)).toEqual(['counted', 'chosen'])
  })
  it('combines the shape filter with the existing label and G filters', async () => {
    const store = await setup()
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([
      { ...candidate(40, 50), label: 'ET', gc: true, shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(80, 50), label: 'ET', gc: true, shape: { decision: 'different', differences: ['topArc'], unknown: [] } },
      { ...candidate(120, 50), label: 'ET', gc: false, shape: { decision: 'same', differences: [], unknown: [] } },
      { ...candidate(160, 50), label: '4H', gc: true, shape: { decision: 'same', differences: [], unknown: [] } },
    ])
    store.setSymbolCandidateFilters(['ET'], 'with')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[40, 50]])
    store.setSymbolShapeFilter('all')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[40, 50], [80, 50]])
    expect(store.symbolLabelFilter).toEqual(['ET']); expect(store.symbolGcFilter).toBe('with')
    store.setSymbolCandidateFilters(['ET'], 'without')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[120, 50]])
    store.setSymbolShapeFilter('same')
    expect(store.visibleSymbolCandidates?.map(c => c.center)).toEqual([[120, 50]])
    expect(store.symbolCandidates).toHaveLength(4)
  })
  it('resets the shape filter on begin and clear, including clear without candidates, without changing persisted state', async () => {
    const store = await setup(), index = store.quantityIndex(), dirty = store.dirtySummary()
    expect(store.symbolCandidates).toBeNull()
    store.setSymbolShapeFilter('all')
    store.clearSymbolCandidates()
    expect(store.symbolCandidates).toBeNull(); expect(store.symbolShapeFilter).toBe('same')

    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([
      { ...candidate(40, 50), shape: { decision: 'different', differences: ['topArc'], unknown: [] } },
    ])
    store.setSymbolShapeFilter('all')
    store.beginSymbolCandidates('led', sampleRect)
    expect(store.symbolCandidates).toEqual([]); expect(store.symbolShapeFilter).toBe('same')
    store.setSymbolShapeFilter('all')
    store.clearSymbolCandidates()
    expect(store.symbolCandidates).toBeNull(); expect(store.symbolShapeFilter).toBe('same')
    expect(store.quantityIndex()).toBe(index); expect(store.dirtySummary()).toEqual(dirty)
    expect(store.toEdits()).toEqual([]); expect(store.canUndo()).toBe(false)
  })
  it('copies shape decisions and both arrays when appending candidates', async () => {
    const store = await setup()
    const shape: SymbolShapeDecision = { decision: 'different', differences: ['topArc'], unknown: ['interiorLines'] }
    store.beginSymbolCandidates('led', sampleRect)
    store.appendSymbolCandidates([{ ...candidate(40, 50), shape }])
    const stored = store.symbolCandidates![0].shape!
    expect(stored).not.toBe(shape)
    expect(stored.differences).not.toBe(shape.differences)
    expect(stored.unknown).not.toBe(shape.unknown)
    shape.decision = 'same'; shape.differences.push('interior'); shape.unknown.push('annexFrame')
    expect(stored).toEqual({ decision: 'different', differences: ['topArc'], unknown: ['interiorLines'] })
    expect(store.visibleSymbolCandidates).toHaveLength(0)
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
