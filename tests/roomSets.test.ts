import { describe, expect, it } from 'vitest'
import mupdf, { type PDFDocument } from 'mupdf'
import type { Point } from '../src/core/annotations'
import { normalizeFloor } from '../src/core/location'
import { writeDrawingInfo } from '../src/core/drawingInfo'
import {
  parseRoomSets,
  readDocumentPageRoomSets,
  readDocumentRoomMetadata,
  readPageRoomSet,
  readRoomRegions,
  readRoomSets,
  writePageRoomSet,
  writeRoomRegions,
  writeRoomSets,
  type RoomRegion,
  type RoomSet,
} from '../src/core/rooms'
import { applyPageLayout, extractPages, splitPages, type PageLayoutCard } from '../src/core/pageOps'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'

function region(id = 'r1', name = '事務室', size = 100): RoomRegion {
  return {
    id, name, floor: normalizeFloor('1階'),
    points: [[0, 0], [size, 0], [size, size], [0, size]],
  }
}
function roomSet(id = 's1', name = '1階'): RoomSet {
  return { id, name, floor: normalizeFloor('1階'), regions: [region()] }
}
function documentWithPages(count = 3) {
  const doc = new mupdf.PDFDocument()
  for (let i = 0; i < count; i++) {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
  }
  return doc
}
function bytes(doc: PDFDocument): Uint8Array {
  const buffer = doc.saveToBuffer('garbage=4,compress')
  try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
}
function card(pageIndex: number, docId = 'target'): PageLayoutCard {
  return { id: `${docId}-${pageIndex}`, source: { kind: 'page', docId, pageIndex }, rotation: 0 }
}
function loadedStore(): AnnotationStore {
  const store = new AnnotationStore()
  store.loadRoomSets([roomSet()], [[0, { id: 's1' }], [1, { id: 's1' }]])
  return store
}

describe('部屋の組の解析とPDF保存', () => {
  it('rejects malformed envelopes and invalid set fields', () => {
    expect(parseRoomSets('{')).toEqual([])
    expect(parseRoomSets([])).toEqual([])
    expect(parseRoomSets({ version: 2, sets: [roomSet()] })).toEqual([])
    const valid = roomSet()
    expect(parseRoomSets({
      version: 1,
      sets: [
        null,
        { ...valid, id: '' },
        { ...valid, id: 'name-empty', name: '' },
        { ...valid, id: 'name-long', name: 'a'.repeat(41) },
        { ...valid, id: 'name-newline', name: '1\n階' },
        { ...valid, id: 'name-space', name: ' 1階' },
        { ...valid, id: 'floor-long', floor: 'a'.repeat(41) },
        { ...valid, id: 'regions-invalid', regions: null },
        valid,
      ],
    })).toEqual([valid])
  })

  it('normalizes floors, skips invalid regions and duplicate ids, and enforces limits', () => {
    const regions = [
      { ...region('invalid'), points: [[0, 0], [1, 1]] },
      ...Array.from({ length: 205 }, (_, i) => region(`r-${i}`)),
    ]
    const parsed = parseRoomSets(JSON.stringify({
      version: 1,
      sets: [
        { id: 's0', name: '1階', floor: '１階', regions },
        { id: 's0', name: '重複した組', regions: [] },
        { id: 's1', name: '別の組', regions: [region('r-0'), region('unique')] },
        ...Array.from({ length: 105 }, (_, i) => ({ id: `empty-${i}`, name: '組', regions: [] })),
      ],
    }))
    expect(parsed).toHaveLength(100)
    expect(parsed[0].floor).toBe(normalizeFloor('１階'))
    expect(parsed[0].regions).toHaveLength(200)
    expect(parsed[1].regions.map(current => current.id)).toEqual(['unique'])
  })

  it('persists sets and valid links and deletes empty keys', () => {
    const doc = documentWithPages()
    try {
      writeRoomSets(doc, [roomSet()])
      const first = doc.loadPage(0), second = doc.loadPage(1), third = doc.loadPage(2)
      try {
        writePageRoomSet(doc, first, 's1')
        writePageRoomSet(doc, second, 'missing')
        const object = third.getObject()
        try { object.put('KaruRoomSet', 123) } finally { object.destroy() }
        expect(readPageRoomSet(third)).toBeUndefined()
        expect(readDocumentPageRoomSets(doc)).toEqual([[0, { id: 's1' }]])
        const reopened = new mupdf.PDFDocument(bytes(doc))
        try {
          expect(readRoomSets(reopened)).toEqual([roomSet()])
          expect(readDocumentPageRoomSets(reopened)).toEqual([[0, { id: 's1' }]])
          expect(readDocumentRoomMetadata(reopened)).toEqual({
            pageRoomRegions: [], roomSets: [roomSet()], pageRoomSets: [[0, { id: 's1' }]],
          })
        } finally { reopened.destroy() }
        writePageRoomSet(doc, first, null)
        const pageObject = first.getObject()
        try {
          const value = pageObject.get('KaruRoomSet')
          try { expect(value.isNull()).toBe(true) } finally { value.destroy() }
        } finally { pageObject.destroy() }
        writeRoomSets(doc, [])
        const trailer = doc.getTrailer(), root = trailer.get('Root')
        try {
          const value = root.get('KaruRoomSets')
          try { expect(value.isNull()).toBe(true) } finally { value.destroy() }
        } finally { root.destroy(); trailer.destroy() }
        expect(readDocumentPageRoomSets(doc)).toEqual([])
      } finally { first.destroy(); second.destroy(); third.destroy() }
    } finally { doc.destroy() }
  })

  it('keeps the catalog and moves links with reordered pages', () => {
    const doc = documentWithPages()
    try {
      writeRoomSets(doc, [roomSet()])
      const page = doc.loadPage(0)
      try {
        writePageRoomSet(doc, page, 's1')
        writeDrawingInfo(doc, page, { name: '1階電灯設備平面図', scanned: true })
      } finally { page.destroy() }
      applyPageLayout('target', doc, [card(2), card(0), card(1)], new Map())
      expect(readRoomSets(doc)).toEqual([roomSet()])
      expect(readDocumentPageRoomSets(doc)).toEqual([[1, { id: 's1' }]])
    } finally { doc.destroy() }
  })

  it('flattens shared regions on import, resolves ids and limits combined regions to 200', () => {
    const source = documentWithPages(1), target = documentWithPages(1)
    try {
      writeRoomSets(source, [{
        ...roomSet(),
        regions: Array.from({ length: 200 }, (_, i) => region(`shared-${i}`, `室${i}`)),
      }])
      const sourcePage = source.loadPage(0), targetPage = target.loadPage(0)
      try {
        writeRoomRegions(source, sourcePage, [region('shared-0', 'ページの部屋')])
        writePageRoomSet(source, sourcePage, 's1')
        writeRoomRegions(target, targetPage, [region('shared-0', '追加先の部屋')])
      } finally { sourcePage.destroy(); targetPage.destroy() }
      applyPageLayout('target', target, [card(0), card(0, 'source')], new Map([['source', source]]))
      const imported = target.loadPage(1)
      try {
        const regions = readRoomRegions(imported)
        expect(regions).toHaveLength(200)
        expect(regions[0].name).toBe('ページの部屋')
        expect(regions[1].name).toBe('室0')
        expect(new Set(regions.map(current => current.id)).size).toBe(200)
        expect(regions.some(current => current.id === 'shared-0')).toBe(false)
        expect(readPageRoomSet(imported)).toBeUndefined()
        expect(readRoomSets(target)).toEqual([])
      } finally { imported.destroy() }
    } finally { source.destroy(); target.destroy() }
  })

  it('flattens shared regions when extracting or splitting into another PDF', () => {
    const source = documentWithPages(1)
    try {
      writeRoomSets(source, [roomSet()])
      const page = source.loadPage(0)
      try { writePageRoomSet(source, page, 's1') } finally { page.destroy() }
      const outputs = [
        extractPages('target', source, [card(0)], new Map()),
        ...splitPages('target', source, [[card(0)]], new Map()),
      ]
      for (const output of outputs) {
        const extracted = new mupdf.PDFDocument(output), extractedPage = extracted.loadPage(0)
        try {
          expect(readRoomSets(extracted)).toEqual([])
          expect(readPageRoomSet(extractedPage)).toBeUndefined()
          expect(readRoomRegions(extractedPage)).toEqual(roomSet().regions)
        } finally { extractedPage.destroy(); extracted.destroy() }
      }
    } finally { source.destroy() }
  })
})

describe('部屋の組のストアとUndo', () => {
  it('moves page regions into a set and restores everything with one Undo', () => {
    const store = new AnnotationStore()
    store.loadRoomRegions([[0, [region()]]])
    const created = store.createRoomSetFromPage(0, '1階', '１階')
    expect(created.floor).toBe(normalizeFloor('１階'))
    expect(store.getRoomRegions(0)).toEqual([])
    expect(store.getPageRoomSet(0)?.id).toBe(created.id)
    expect(store.effectiveRoomRegions(0)).toEqual([{ region: region(), setId: created.id }])
    store.undo()
    expect(store.getRoomSets()).toEqual([])
    expect(store.getPageRoomSet(0)).toBeUndefined()
    expect(store.getRoomRegions(0)).toEqual([region()])
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(store.getPageRoomSet(0)?.id).toBe(created.id)
  })

  it('uses and detaches a set with one Undo without copying shared regions', () => {
    const store = new AnnotationStore()
    store.loadRoomSets([roomSet()], [])
    store.loadRoomRegions([[2, [region('local', 'ページの部屋')]]])
    store.useRoomSet(2, 's1')
    expect(store.effectiveRoomRegions(2)).toHaveLength(2)
    store.undo()
    expect(store.getPageRoomSet(2)).toBeUndefined()
    expect(store.canUndo()).toBe(false)
    store.redo()
    store.useRoomSet(2, null)
    expect(store.getRoomRegions(2).map(current => current.id)).toEqual(['local'])
    expect(store.effectiveRoomRegions(2)).toHaveLength(1)
    store.undo()
    expect(store.getPageRoomSet(2)?.id).toBe('s1')
  })

  it('adds to a set and restores it in all linked pages with one Undo', () => {
    const store = loadedStore()
    store.addRoomRegion(1, region('r2', '会議室'), true)
    expect(store.getPageRoomSet(0)?.regions).toHaveLength(2)
    store.undo()
    expect(store.getPageRoomSet(1)?.regions).toEqual([region()])
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(store.getPageRoomSet(0)?.regions).toHaveLength(2)
  })

  it('updates shared name, floor and geometry with one Undo and supports room editing', () => {
    const store = loadedStore()
    expect(store.startRoomEdit(1, 'r1')).toBe(true)
    const updated = { ...region(), name: '会議室', floor: normalizeFloor('2階'), points: region('r1', '会議室', 150).points }
    store.updateRoomRegion(1, updated)
    expect(store.effectiveRoomRegions(0)[0].region).toEqual(updated)
    store.endRoomEdit()
    expect(store.takeRoomEditCompletion(1)?.region).toEqual(updated)
    store.undo()
    expect(store.getPageRoomSet(0)?.regions).toEqual([region()])
    expect(store.canUndo()).toBe(false)
  })

  it('removes a shared region with one Undo and closes its active edit', () => {
    const store = loadedStore()
    store.startRoomEdit(1, 'r1')
    store.removeRoomRegion(1, 'r1')
    expect(store.effectiveRoomRegions(0)).toEqual([])
    expect(store.roomEditTarget).toBeNull()
    store.undo()
    expect(store.getPageRoomSet(0)?.regions).toEqual([region()])
    expect(store.canUndo()).toBe(false)
  })

  it('keeps local region operations local and resolves ids when adding', () => {
    const store = loadedStore()
    store.addRoomRegion(0, region('local', 'この図面だけ'), false)
    expect(store.getRoomRegions(0)).toHaveLength(1)
    expect(store.getRoomRegions(1)).toEqual([])
    store.undo()
    expect(store.getRoomRegions(0)).toEqual([])
    expect(store.canUndo()).toBe(false)
    store.addRoomRegion(0, region('r1', '重複を避ける'), false)
    const local = store.getRoomRegions(0)[0]
    expect(local.id).not.toBe('r1')
    store.updateRoomRegion(0, { ...local, name: '変更後' })
    expect(store.getRoomRegions(0)[0].name).toBe('変更後')
    expect(store.getPageRoomSet(1)?.regions[0].name).toBe('事務室')
    store.undo()
    expect(store.getRoomRegions(0)[0].name).toBe('重複を避ける')
    store.removeRoomRegion(0, local.id)
    expect(store.getRoomRegions(0)).toEqual([])
    store.undo()
    expect(store.getRoomRegions(0)).toEqual([local])
  })

  it('renames and deletes a set with one Undo per operation', () => {
    const store = loadedStore()
    store.renameRoomSet('s1', '共通の部屋', '2階')
    expect(store.getPageRoomSet(1)?.name).toBe('共通の部屋')
    store.undo()
    expect(store.getPageRoomSet(0)?.name).toBe('1階')
    expect(store.canUndo()).toBe(false)
    store.deleteRoomSet('s1')
    expect(store.getRoomSets()).toEqual([])
    expect(store.pageRoomSets.size).toBe(0)
    store.undo()
    expect(store.getPageRoomSet(0)?.id).toBe('s1')
    expect(store.getPageRoomSet(1)?.id).toBe('s1')
    expect(store.canUndo()).toBe(false)
  })

  it('uses the smallest effective region and suggests matching floors only before linking', () => {
    const store = new AnnotationStore()
    store.loadRoomSets([roomSet(), { id: 's2', name: '2階', floor: normalizeFloor('2階'), regions: [] }], [])
    store.loadDrawingInfos([
      { name: '1階電灯設備平面図', scanned: true },
      { name: '1階コンセント設備平面図', scanned: true },
      { name: '2階電灯設備平面図', scanned: true },
      { name: '詳細図', scanned: true },
    ])
    expect(store.suggestedRoomSets(0).map(set => set.id)).toEqual(['s1'])
    expect(store.suggestedRoomSets(1).map(set => set.id)).toEqual(['s1'])
    expect(store.suggestedRoomSets(2).map(set => set.id)).toEqual(['s2'])
    expect(store.suggestedRoomSets(3)).toEqual([])
    store.useRoomSet(1, 's1')
    expect(store.suggestedRoomSets(1)).toEqual([])
    expect(store.pickupLocation(1, [50, 50])).toEqual({ room: '事務室', floor: normalizeFloor('1階') })
    store.addRoomRegion(1, region('small', '内側', 20), false)
    expect(store.pickupLocation(1, [10, 10]).room).toBe('内側')
    expect(store.getRoomNames()).toEqual(expect.arrayContaining(['事務室', '内側']))
  })

  it('rejects overflow without changing data or history and ignores dangling links on load', () => {
    const store = new AnnotationStore()
    store.loadRoomSets([{
      ...roomSet(), regions: Array.from({ length: 200 }, (_, i) => region(`r-${i}`)),
    }], [[0, { id: 's1' }], [1, { id: 'missing' }], [-1, { id: 's1' }]])
    expect(store.getPageRoomSet(1)).toBeUndefined()
    expect(store.pageRoomSets.size).toBe(1)
    expect(() => store.addRoomRegion(0, region('overflow'), true)).toThrow()
    expect(store.getPageRoomSet(0)?.regions).toHaveLength(200)
    expect(store.canUndo()).toBe(false)
    store.reset()
    expect(store.getRoomSets()).toEqual([])
    expect(store.pageRoomSets.size).toBe(0)
    expect(store.isDirty()).toBe(false)
  })

  it('assigns different rooms by position in one Undo and leaves other pages untouched', async () => {
    const store = new AnnotationStore()
    const fixture: CountFixture = {
      id: 'cv', code: 'CV', name: 'ケーブル', category: '電線',
      kind: 'length', method: 'polyline', order: 0, style: nextCountStyle([]),
    }
    await store.ensureCountFixtures(async () => [fixture], async () => {})
    const outer = region('outer', '事務室', 100), inner = region('inner', '会議室', 20)
    store.loadRoomSets([{ ...roomSet(), regions: [outer, inner] }], [[0, { id: 's1' }], [1, { id: 's1' }]])
    const createPickup = (pageIndex: number, point: Point) => store.create({
      pageIndex, kind: 'perimeter', rect: [point[0], point[1], point[0] + 10, point[1]],
      vertices: [point, [point[0] + 10, point[1]]],
      measure: { kind: 'perimeter', mmPerPoint: 100, unit: 'm', decimals: 2 },
      quantity: { version: 1, id: crypto.randomUUID(), itemId: 'cv', method: 'polyline', room: '廊下', floor: normalizeFloor('2階') },
      text: '',
    }).id
    const outerId = createPickup(1, [50, 50])
    const innerId = createPickup(1, [10, 10])
    const otherPageId = createPickup(0, [50, 50])
    expect(store.pickupsInRoom(1, outer)).toEqual(expect.arrayContaining([outerId, innerId]))
    expect(store.roomSetPickupChanges(1)).toHaveLength(2)
    store.applyRoomSetPickupLocations(1, 's1')
    expect(store.get(outerId)?.quantity?.room).toBe('事務室')
    expect(store.get(innerId)?.quantity?.room).toBe('会議室')
    expect(store.get(otherPageId)?.quantity?.room).toBe('廊下')
    store.undo()
    expect(store.get(outerId)?.quantity?.room).toBe('廊下')
    expect(store.get(innerId)?.quantity?.room).toBe('廊下')
    expect(store.getPageRoomSet(1)?.id).toBe('s1')
    store.redo()
    expect(store.get(innerId)?.quantity?.room).toBe('会議室')
  })
})
