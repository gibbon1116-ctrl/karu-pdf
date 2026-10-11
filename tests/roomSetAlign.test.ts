import { describe, expect, it } from 'vitest'
import mupdf from 'mupdf'
import type { Point } from '../src/core/annotations'
import {
  parseRoomSetLink,
  parseRoomSets,
  readDocumentPageRoomSets,
  readPageRoomSet,
  readRoomRegions,
  readRoomSets,
  translateRoomRegion,
  writePageRoomSet,
  writeRoomSets,
  type RoomRegion,
  type RoomSet,
} from '../src/core/rooms'
import { applyPageLayout, extractPages, splitPages, type PageLayoutCard } from '../src/core/pageOps'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const region: RoomRegion = {
  id: 'r1', name: '事務室',
  points: [[0, 0], [100, 0], [100, 100], [0, 100]],
}
const set: RoomSet = { id: 's1', name: '1階', regions: [region] }

function documentWithPages(count = 2) {
  const doc = new mupdf.PDFDocument()
  for (let i = 0; i < count; i++) {
    const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
  }
  return doc
}

function storeWithOffsets() {
  const store = new AnnotationStore()
  store.loadRoomSets([set], [
    [0, { id: set.id }],
    [1, { id: set.id, dx: 30, dy: 20 }],
    [2, { id: set.id, dx: -10, dy: 5 }],
  ])
  return store
}

function card(pageIndex: number, docId = 'target'): PageLayoutCard {
  return { id: `${docId}-${pageIndex}`, source: { kind: 'page', docId, pageIndex }, rotation: 0 }
}

describe('部屋の組の支点とずらしのPDFデータ', () => {
  it('accepts legacy ids and JSON links and rejects invalid offsets', () => {
    expect(parseRoomSetLink('s1')).toEqual({ id: 's1' })
    expect(parseRoomSetLink('{"id":"s1","dx":30,"dy":20}'))
      .toEqual({ id: 's1', dx: 30, dy: 20 })
    expect(parseRoomSetLink('{"id":"s1","dx":0,"dy":0}')).toEqual({ id: 's1' })
    for (const invalid of [
      '', ' s1', '{', '[]', '{"id":""}', '{"id":"s1","dx":"30"}',
      '{"id":"s1","dy":null}', '{"id":"s1","dx":100001}',
      { id: 's1', dx: NaN }, { id: 's1', dy: Infinity },
      { id: 's1', dx: -100001 },
    ]) {
      expect(parseRoomSetLink(invalid)).toBeUndefined()
    }
    expect(parseRoomSetLink({ id: 's1', dx: -100000, dy: 100000 }))
      .toEqual({ id: 's1', dx: -100000, dy: 100000 })
  })

  it('persists anchor and offsets, writes zero as an id, and discards invalid PDF links', () => {
    const doc = documentWithPages()
    const first = doc.loadPage(0), second = doc.loadPage(1)
    try {
      writeRoomSets(doc, [{ ...set, anchor: [10, 15] }])
      writePageRoomSet(doc, first, set.id, 0, 0)
      writePageRoomSet(doc, second, set.id, 30, 20)
      const object = first.getObject()
      try {
        const value = object.get('KaruRoomSet')
        try { expect(value.asString()).toBe(set.id) } finally { value.destroy() }
      } finally { object.destroy() }
      expect(readPageRoomSet(first)).toEqual({ id: set.id })
      expect(readPageRoomSet(second)).toEqual({ id: set.id, dx: 30, dy: 20 })
      const buffer = doc.saveToBuffer('garbage=4,compress')
      try {
        const reopened = new mupdf.PDFDocument(new Uint8Array(buffer.asUint8Array()))
        try {
          expect(readRoomSets(reopened)[0].anchor).toEqual([10, 15])
          expect(readDocumentPageRoomSets(reopened)).toEqual([
            [0, { id: set.id }], [1, { id: set.id, dx: 30, dy: 20 }],
          ])
        } finally { reopened.destroy() }
      } finally { buffer.destroy() }
      expect(() => writePageRoomSet(doc, second, set.id, Infinity, 0)).toThrow()
      expect(readPageRoomSet(second)).toEqual({ id: set.id, dx: 30, dy: 20 })
      const secondObject = second.getObject()
      const invalid = doc.newString('{"id":"s1","dy":100001}')
      try { secondObject.put('KaruRoomSet', invalid) }
      finally { invalid.destroy(); secondObject.destroy() }
      expect(readPageRoomSet(second)).toBeUndefined()
      expect(readDocumentPageRoomSets(doc)).toEqual([[0, { id: set.id }]])
    } finally { first.destroy(); second.destroy(); doc.destroy() }
  })

  it('keeps valid sets while discarding malformed anchors', () => {
    expect(parseRoomSets({ version: 1, sets: [{ ...set, anchor: [10, 15] }] }))
      .toEqual([{ ...set, anchor: [10, 15] }])
    for (const anchor of [[1], [1, Infinity], ['1', 2], null]) {
      expect(parseRoomSets({ version: 1, sets: [{ ...set, anchor }] })).toEqual([set])
    }
  })

  it('flattens translated regions on import, extraction and splitting', () => {
    const source = documentWithPages(1), target = documentWithPages(1)
    try {
      writeRoomSets(source, [set])
      const page = source.loadPage(0)
      try { writePageRoomSet(source, page, set.id, 30, 20) } finally { page.destroy() }
      const expected = [translateRoomRegion(region, 30, 20)]
      applyPageLayout('target', target, [card(0), card(0, 'source')], new Map([['source', source]]))
      const imported = target.loadPage(1)
      try {
        expect(readRoomRegions(imported)).toEqual(expected)
        expect(readPageRoomSet(imported)).toBeUndefined()
      } finally { imported.destroy() }
      const outputs = [
        extractPages('source', source, [card(0, 'source')], new Map()),
        ...splitPages('source', source, [[card(0, 'source')]], new Map()),
      ]
      for (const output of outputs) {
        const extracted = new mupdf.PDFDocument(output), extractedPage = extracted.loadPage(0)
        try {
          expect(readRoomRegions(extractedPage)).toEqual(expected)
          expect(readRoomSets(extracted)).toEqual([])
          expect(readPageRoomSet(extractedPage)).toBeUndefined()
        } finally { extractedPage.destroy(); extracted.destroy() }
      }
    } finally { source.destroy(); target.destroy() }
  })
})

describe('部屋の組の座標変換とUndo', () => {
  it('adds page offsets and converts edits and additions back to set coordinates', () => {
    const store = storeWithOffsets()
    expect(store.effectiveRoomRegions(1)[0].region)
      .toEqual(translateRoomRegion(region, 30, 20))
    expect(store.pickupLocation(1, [120, 50]).room).toBe('事務室')
    expect(store.pickupLocation(1, [10, 10]).room).not.toBe('事務室')
    const enlarged: RoomRegion = {
      ...region, name: '会議室',
      points: [[30, 20], [180, 20], [180, 170], [30, 170]],
    }
    store.updateRoomRegion(1, enlarged)
    const canonical = translateRoomRegion(enlarged, -30, -20)
    expect(store.getRoomSets()[0].regions[0]).toEqual(canonical)
    expect(store.effectiveRoomRegions(0)[0].region).toEqual(canonical)
    expect(store.effectiveRoomRegions(2)[0].region)
      .toEqual(translateRoomRegion(canonical, -10, 5))
    store.undo()
    expect(store.getRoomSets()[0].regions).toEqual([region])
    expect(store.canUndo()).toBe(false)
    const added = { ...enlarged, id: 'r2' }
    store.addRoomRegion(1, added, true)
    expect(store.getRoomSets()[0].regions[1]).toEqual(translateRoomRegion(added, -30, -20))
    expect(store.effectiveRoomRegions(1)[1].region).toEqual(added)
    store.undo()
    expect(store.getRoomSets()[0].regions).toEqual([region])
    expect(store.canUndo()).toBe(false)
    store.addRoomRegion(1, added, false)
    expect(store.getRoomRegions(1)).toEqual([added])
  })

  it('sets an anchor, changes offsets and resets position with one Undo each', () => {
    const store = storeWithOffsets()
    store.setRoomSetAnchor(1, [40, 35])
    expect(store.getRoomSets()[0].anchor).toEqual([10, 15])
    expect(store.getPageRoomSetLink(1)).toEqual({ id: set.id, dx: 30, dy: 20 })
    store.undo()
    expect(store.getRoomSets()[0].anchor).toBeUndefined()
    expect(store.canUndo()).toBe(false)
    store.setRoomSetOffset(1, 50, 60)
    expect(store.getPageRoomSetLink(1)).toEqual({ id: set.id, dx: 50, dy: 60 })
    store.undo()
    expect(store.getPageRoomSetLink(1)).toEqual({ id: set.id, dx: 30, dy: 20 })
    expect(store.isDirty()).toBe(false)
    expect(store.canUndo()).toBe(false)
    store.setRoomSetOffset(1, 0, 0)
    expect(store.getPageRoomSetLink(1)).toEqual({ id: set.id })
    expect(store.toEdits()).toContainEqual({
      kind: 'setPageRoomSet', pageIndex: 1, setId: set.id,
    })
    store.undo()
    expect(store.getPageRoomSetLink(1)).toEqual({ id: set.id, dx: 30, dy: 20 })
    expect(store.canUndo()).toBe(false)
    expect(() => store.setRoomSetOffset(1, 100001, 0)).toThrow()
    expect(store.canUndo()).toBe(false)
  })

  it('preserves anchor when renaming and emits offset save edits', () => {
    const store = storeWithOffsets()
    store.setRoomSetAnchor(1, [40, 35])
    store.renameRoomSet(set.id, '共通')
    expect(store.getRoomSets()[0].anchor).toEqual([10, 15])
    store.setRoomSetOffset(1, -12, 5)
    expect(store.toEdits()).toContainEqual({
      kind: 'setPageRoomSet', pageIndex: 1, setId: set.id, dx: -12, dy: 5,
    })
  })

  it('keeps alignment mode out of history and cancels it on detach, delete and Undo', () => {
    const store = storeWithOffsets()
    expect(store.startRoomSetAlign(1)).toBe(true)
    expect(store.roomSetAlignPage).toBe(1)
    expect(store.canUndo()).toBe(false)
    expect(store.isDirty()).toBe(false)
    store.setRoomSetOffset(1, 40, 20)
    store.endRoomSetAlign()
    expect(store.takeRoomSetAlignCompletion(1)).toEqual({
      pageIndex: 1, setId: set.id, dx: 40, dy: 20,
    })
    expect(store.takeRoomSetAlignCompletion(1)).toBeNull()
    store.undo()
    expect(store.canUndo()).toBe(false)
    store.startRoomSetAlign(1)
    store.startRoomEdit(1, region.id)
    expect(store.roomSetAlignPage).toBeNull()
    store.endRoomEdit(false)
    store.startRoomSetAlign(1)
    store.startRoomCapture(1)
    expect(store.roomSetAlignPage).toBeNull()
    store.endRoomCapture()
    store.startRoomSetAlign(1)
    store.useRoomSet(1, null)
    expect(store.roomSetAlignPage).toBeNull()
    expect(store.takeRoomSetAlignCompletion(1)).toBeNull()
    store.undo()
    expect(store.roomSetAlignPage).toBeNull()
    store.startRoomSetAlign(1)
    store.deleteRoomSet(set.id)
    expect(store.roomSetAlignPage).toBeNull()
    store.undo()
    store.useRoomSet(3, set.id)
    store.startRoomSetAlign(3)
    store.undo()
    expect(store.roomSetAlignPage).toBeNull()
  })

  it('only proposes pickup changes inside translated shared regions', () => {
    const store = storeWithOffsets()
    const create = (point: Point) => store.create({
      pageIndex: 1, kind: 'perimeter',
      rect: [point[0], point[1], point[0] + 10, point[1]],
      vertices: [point, [point[0] + 10, point[1]]],
      measure: { kind: 'perimeter', mmPerPoint: 100, unit: 'm', decimals: 2 },
      quantity: {
        version: 1, id: crypto.randomUUID(), itemId: 'cv',
        method: 'polyline', room: '廊下',
      },
      text: '',
    }).id
    const inside = create([120, 50]), outside = create([10, 10])
    expect(store.pickupsInRoom(1, region)).toEqual([inside])
    expect(store.roomSetPickupChanges(1).map(change => change.id)).toEqual([inside])
    store.applyRoomSetPickupLocations(1, set.id)
    expect(store.get(inside)?.quantity?.room).toBe('事務室')
    expect(store.get(outside)?.quantity?.room).toBe('廊下')
    store.undo()
    expect(store.get(inside)?.quantity?.room).toBe('廊下')
    store.startRoomSetAlign(1)
    store.setRoomSetOffset(1, 40, 30)
    store.endRoomSetAlign(false)
    expect(store.takeRoomSetAlignCompletion(1)).toBeNull()
  })
})
