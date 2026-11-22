import { describe, expect, it } from 'vitest'
import { DocumentSession, DocumentTabsModel } from '../src/app/documentModel'
import type { RoomRegion, RoomSet } from '../src/core/rooms'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function room(id: string, name = id, floor = '1階'): RoomRegion {
  return { id, name, floor, points: [[0, 0], [10, 0], [10, 10], [0, 10]] }
}

describe('部屋の一覧の並び替え', () => {
  const local = [room('p1'), room('p2'), room('p3')]
  const shared = [room('s1'), room('s2'), room('s3')]
  function setup() {
    const store = new AnnotationStore()
    store.loadRoomRegions([[0, local]])
    store.loadRoomSets([{ id: 'set', name: '1階', regions: shared }], [[0, { id: 'set' }], [1, { id: 'set' }]])
    return store
  }
  const ids = (store: AnnotationStore, pageIndex = 0) =>
    store.effectiveRoomRegions(pageIndex).map(({ region }) => region.id)
  const initial = ['p1', 'p2', 'p3', 's1', 's2', 's3']

  it('moves a local room only within its page group and clamps to either end', () => {
    const store = setup()
    store.moveRoomRegion(0, 'p3', -10)
    expect(ids(store)).toEqual(['p3', 'p1', 'p2', 's1', 's2', 's3'])
    store.undo()
    expect(ids(store)).toEqual(initial)
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(ids(store)).toEqual(['p3', 'p1', 'p2', 's1', 's2', 's3'])
    store.moveRoomRegion(0, 'p3', 999)
    expect(ids(store)).toEqual(initial)
    store.undo()
    expect(ids(store)).toEqual(['p3', 'p1', 'p2', 's1', 's2', 's3'])
  })

  it('moves a shared room on all linked pages and skips unchanged positions or missing rooms', () => {
    const store = setup()
    store.moveRoomRegion(1, 'p1', 2)
    store.moveRoomRegion(0, 's1', -1)
    expect(store.canUndo()).toBe(false)
    store.moveRoomRegion(0, 's1', 999)
    expect(ids(store)).toEqual(['p1', 'p2', 'p3', 's2', 's3', 's1'])
    expect(ids(store, 1)).toEqual(['s2', 's3', 's1'])
    store.undo()
    expect(ids(store)).toEqual(initial)
    expect(ids(store, 1)).toEqual(['s1', 's2', 's3'])
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(ids(store, 1)).toEqual(['s2', 's3', 's1'])
  })

  it.each(['page', 'set'] as const)('sorts the %s group by floor and numeric room name', group => {
    const store = new AnnotationStore()
    const unsorted = [room('a', '倉庫10'), room('b', '倉庫2'), room('c', '倉庫20', 'B1階'), room('d', '倉庫1', '10階')]
    if (group === 'page') store.loadRoomRegions([[0, unsorted]])
    else store.loadRoomSets([{ id: 'set', name: '部屋の組', regions: unsorted }], [[0, { id: 'set' }]])
    store.sortRoomRegions(0, group)
    expect(ids(store)).toEqual(['c', 'b', 'a', 'd'])
    store.sortRoomRegions(0, group)
    store.undo()
    expect(ids(store)).toEqual(['a', 'b', 'c', 'd'])
    expect(store.canUndo()).toBe(false)
  })

  it('deduplicates names in page number order with local rooms before shared rooms', () => {
    const store = new AnnotationStore()
    store.loadRoomRegions([[2, [room('p2', '玄関')]], [0, [room('p0', '会議室')]]])
    store.loadRoomSets([
      { id: 'used', name: '使用中', regions: [room('s1', '倉庫'), room('s2', '会議室'), room('s3', '廊下')] },
      { id: 'unused', name: '未使用', regions: [room('s4', '事務室')] },
    ], [[2, { id: 'used' }], [0, { id: 'used' }]])
    expect(store.roomNameOrder()).toEqual(['会議室', '倉庫', '廊下', '玄関'])
    store.moveRoomRegion(2, 's3', 0)
    expect(store.roomNameOrder()).toEqual(['会議室', '廊下', '倉庫', '玄関'])
    store.undo()
    expect(store.roomNameOrder()).toEqual(['会議室', '倉庫', '廊下', '玄関'])
  })
})

describe('部屋の組の複製', () => {
  const source: RoomSet = {
    id: 'original', name: '改修前', floor: '1階', anchor: [3, 7],
    regions: [room('meeting', '会議室'), room('storage', '倉庫', '2階')],
  }
  const originalLink = { id: source.id, dx: 20, dy: -10 }
  function setup() {
    const store = new AnnotationStore()
    store.loadRoomSets([source], [[0, originalLink], [1, { id: source.id, dx: 15 }]])
    return store
  }

  it('copies geometry, order and anchor under fresh IDs and switches only the requested page in one history step', () => {
    const store = setup()
    const before = store.effectiveRoomRegions(0).map(({ region: { id, ...region } }) => region)
    const copy = store.duplicateRoomSet(0, source.id, source.name)
    const { id: copyId, regions, ...metadata } = copy
    expect(metadata).toEqual({ name: '改修前', floor: '1階', anchor: [3, 7] })
    expect(regions.map(({ id, ...region }) => region)).toEqual(source.regions.map(({ id, ...region }) => region))
    const allIds = [source.id, ...source.regions.map(r => r.id), copyId, ...regions.map(r => r.id)]
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(store.getPageRoomSetLink(0)).toEqual({ ...originalLink, id: copyId })
    expect(store.getPageRoomSetLink(1)).toEqual({ id: source.id, dx: 15 })
    expect(store.effectiveRoomRegions(0).map(({ region: { id, ...region } }) => region)).toEqual(before)
    store.undo()
    expect(store.getPageRoomSetLink(0)).toEqual(originalLink)
    expect(store.getRoomSets()).toEqual([source])
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(store.getPageRoomSet(0)).toEqual(copy)
    const effective = store.effectiveRoomRegions(0)[0].region
    store.updateRoomRegion(0, { ...effective, name: '新会議室' })
    expect(store.getPageRoomSet(0)?.regions[0].name).toBe('新会議室')
    expect(store.getPageRoomSet(1)).toEqual(source)
  })

  it('uses the existing limit validation without changing links or history', () => {
    const store = setup()
    const additional = Array.from({ length: 99 }, (_, i) => ({ id: `set-${i}`, name: '組', regions: [] }))
    store.loadRoomSets([source, ...additional], [[0, originalLink]])
    expect(() => store.duplicateRoomSet(0, source.id, '改修後')).toThrow('部屋の組が不正です（100組まで')
    expect(store.getRoomSets()).toHaveLength(100)
    expect(store.getPageRoomSetLink(0)).toEqual(originalLink)
    expect(store.canUndo()).toBe(false)
    expect(store.isDirty()).toBe(false)
  })
})

describe('部屋の強調表示', () => {
  it('only updates the UI, clears on removal, and stays cleared after undo', () => {
    const store = new AnnotationStore()
    store.loadRoomRegions([[0, [room('r')]]])
    const revision = store.getContentRevision(), version = store.getSnapshot()
    store.setHighlightedRoom({ pageIndex: 0, id: 'r' })
    expect(store.highlightedRoom).toEqual({ pageIndex: 0, id: 'r' })
    expect(store.getSnapshot()).toBe(version + 1)
    expect(store.getContentRevision()).toBe(revision)
    expect(store.isDirty()).toBe(false)
    expect(store.canUndo()).toBe(false)
    store.removeRoomRegion(0, 'r')
    expect(store.highlightedRoom).toBeNull()
    store.undo()
    expect(store.highlightedRoom).toBeNull()
    expect(store.isDirty()).toBe(false)
  })

  it('clears when undo removes a room, a shared set is detached, or the store resets', () => {
    const store = new AnnotationStore()
    store.addRoomRegion(0, room('p'), false)
    store.setHighlightedRoom({ pageIndex: 0, id: 'p' })
    store.undo()
    expect(store.highlightedRoom).toBeNull()
    store.loadRoomSets([{ id: 'set', name: '組', regions: [room('s')] }], [[0, { id: 'set' }], [1, { id: 'set' }]])
    store.setHighlightedRoom({ pageIndex: 0, id: 's' })
    store.useRoomSet(1, null)
    expect(store.highlightedRoom).toEqual({ pageIndex: 0, id: 's' })
    store.useRoomSet(0, null)
    expect(store.highlightedRoom).toBeNull()
    store.undo()
    store.setHighlightedRoom({ pageIndex: 0, id: 's' })
    store.reset()
    expect(store.highlightedRoom).toBeNull()
  })

  it('clears when switching between open documents', () => {
    const tabs = new DocumentTabsModel()
    const session = (docId: string) => new DocumentSession({
      docId, name: `${docId}.pdf`, byteLength: 0, handle: null, pageSizes: [{ width: 100, height: 100 }],
    })
    const first = session('first'), second = session('second')
    tabs.add(first)
    first.annotationStore.loadRoomRegions([[0, [room('r')]]])
    first.annotationStore.setHighlightedRoom({ pageIndex: 0, id: 'r' })
    tabs.add(second)
    expect(first.annotationStore.highlightedRoom).toBeNull()
    tabs.activate(first.docId)
    first.annotationStore.setHighlightedRoom({ pageIndex: 0, id: 'r' })
    tabs.activate(second.docId)
    expect(first.annotationStore.highlightedRoom).toBeNull()
  })
})
