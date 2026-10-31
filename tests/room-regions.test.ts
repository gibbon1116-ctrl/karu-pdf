import { describe, expect, it } from 'vitest'
import mupdf, { type PDFDocument } from 'mupdf'
import { applyEdits, type Point } from '../src/core/annotations'
import { floorFromDrawingName, normalizeFloor } from '../src/core/location'
import { nextCountStyle } from '../src/core/countFixtures'
import { applyPageLayout } from '../src/core/pageOps'
import { readDocumentRoomRegions, readRoomRegions, type RoomRegion } from '../src/core/rooms'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function room(overrides: Partial<RoomRegion> = {}): RoomRegion {
  return {
    id: 'office',
    name: '事務室',
    floor: '1階',
    points: [[10, 10], [110, 10], [110, 110], [10, 110]],
    ...overrides,
  }
}

function count(store: AnnotationStore, point: Point, pageIndex = 0) {
  return store.create({
    pageIndex,
    kind: 'symbol',
    rect: [point[0] - 5, point[1] - 5, point[0] + 5, point[1] + 5],
    count: { version: 2, id: crypto.randomUUID(), fixtureId: 'fixture', floor: '2階', room: '廊下' },
    symbol: 'circle',
  })
}

function pickup(store: AnnotationStore, method: 'polyline' | 'lengthHeight' | 'lengthWidthDepth' | 'polygon' | 'polygonDepth', vertices: Point[]) {
  const kind = method === 'polygon' || method === 'polygonDepth' ? 'area' : 'perimeter'
  return store.create({
    pageIndex: 0,
    kind,
    rect: [0, 0, 200, 200],
    vertices,
    measure: { kind, mmPerPoint: 1, unit: 'm', decimals: 2 },
    quantity: {
      version: 1,
      id: crypto.randomUUID(),
      itemId: 'fixture',
      method,
      floor: '2階',
      room: '廊下',
      ...(method === 'lengthHeight' ? { heightM: 1 } : {}),
      ...(method === 'lengthWidthDepth' ? { widthM: 1, depthM: 1 } : {}),
      ...(method === 'polygonDepth' ? { depthM: 1 } : {}),
    },
  })
}

describe('部屋の範囲のストア', () => {
  it('読込みは保存済みの基準になり、入力と取得結果を共有しない', () => {
    const store = new AnnotationStore(), region = room()
    store.loadRoomRegions([[0, [region]]])
    expect(store.isDirty()).toBe(false)
    region.points[0][0] = 999
    const result = store.getRoomRegions(0)
    expect(result[0].points[0]).toEqual([10, 10])
    result[0].name = '変更'
    expect(store.getRoomRegions(0)[0].name).toBe('事務室')
  })

  it('登録・名前変更・削除をそれぞれ1回のUndoとRedoで戻す', () => {
    const store = new AnnotationStore(), region = room()
    store.setRoomRegions(0, [region])
    expect(store.isDirty()).toBe(true)
    expect(store.dirtySummary().rooms).toEqual([0])
    store.undo()
    expect(store.getRoomRegions(0)).toEqual([])
    expect(store.isDirty()).toBe(false)
    store.redo()
    expect(store.getRoomRegions(0)).toEqual([region])

    store.setRoomRegions(0, [{ ...region, name: '会議室' }])
    store.undo()
    expect(store.getRoomRegions(0)[0].name).toBe('事務室')
    store.redo()
    expect(store.getRoomRegions(0)[0].name).toBe('会議室')

    store.setRoomRegions(0, [])
    store.undo()
    expect(store.getRoomRegions(0)[0].name).toBe('会議室')
    store.redo()
    expect(store.getRoomRegions(0)).toEqual([])
  })

  it('変更ページだけを保存し、最後の範囲の削除も編集に含める', () => {
    const store = new AnnotationStore()
    store.loadRoomRegions([[0, [room()]], [1, [room({ id: 'second' })]]])
    store.setRoomRegions(1, [])
    expect(store.toEdits()).toEqual([{ kind: 'setRoomRegions', pageIndex: 1, regions: [] }])
    store.markApplied({ created: [] })
    expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toEqual([])
  })

  it('失敗した保存を基準にせず、保存中の追加変更も残す', () => {
    const store = new AnnotationStore()
    store.setRoomRegions(0, [room()])
    store.toEdits()
    store.markApplied({ created: [], errors: [{ editIndex: 0 }] })
    expect(store.isDirty()).toBe(true)

    store.toEdits()
    store.setRoomRegions(0, [room({ name: '会議室' })])
    store.markApplied({ created: [] })
    expect(store.isDirty()).toBe(true)
    expect(store.toEdits()).toEqual([
      { kind: 'setRoomRegions', pageIndex: 0, regions: [room({ name: '会議室' })] },
    ])
  })

  it('範囲・現在の階・図面名の階の優先順を使い、外側や位置なしでは従来どおり', () => {
    const store = new AnnotationStore()
    store.loadDrawingInfos([{ number: 'A-1', name: '2階 平面図', scanned: true }])
    store.setCurrentLocation('room', '廊下')
    const inferred = floorFromDrawingName('2階 平面図')
    expect(inferred).not.toBe('')
    expect(store.pickupLocation(0, [20, 20])).toEqual({ floor: inferred, room: '廊下' })

    store.setCurrentLocation('floor', '3階')
    const currentFloor = normalizeFloor('3階')
    store.setRoomRegions(0, [room()])
    expect(store.pickupLocation(0, [20, 20])).toEqual({ floor: '1階', room: '事務室' })
    expect(store.pickupLocation(0, [200, 200])).toEqual({ floor: currentFloor, room: '廊下' })
    expect(store.pickupLocation(0)).toEqual({ floor: currentFloor, room: '廊下' })

    store.setRoomRegions(0, [room({ floor: undefined })])
    expect(store.pickupLocation(0, [20, 20])).toEqual({ floor: currentFloor, room: '事務室' })
    store.setCurrentLocation('floor', '')
    expect(store.pickupLocation(0, [20, 20])).toEqual({ floor: inferred, room: '事務室' })

    store.setRoomRegions(0, [
      room(),
      room({ id: 'inner', name: '収納', floor: '4階', points: [[15, 15], [30, 15], [30, 30], [15, 30]] }),
    ])
    expect(store.pickupLocation(0, [20, 20])).toEqual({ floor: '4階', room: '収納' })
  })

  it('個数・線・長さからの面積や体積・囲む拾いを中心・始点・重心で探す', () => {
    const store = new AnnotationStore(), region = room()
    const inside = count(store, [20, 20])
    count(store, [200, 200])
    count(store, [20, 20], 1)
    const line = pickup(store, 'polyline', [[20, 20], [200, 200]])
    pickup(store, 'polyline', [[200, 200], [20, 20]])
    const wall = pickup(store, 'lengthHeight', [[30, 30], [200, 200]])
    const trench = pickup(store, 'lengthWidthDepth', [[40, 40], [200, 200]])
    const area = pickup(store, 'polygon', [[0, 0], [120, 0], [120, 120], [0, 120]])
    const volume = pickup(store, 'polygonDepth', [[0, 0], [120, 0], [120, 120], [0, 120]])
    const deleted = count(store, [50, 50])
    store.remove(deleted.id)
    store.create({ pageIndex: 0, kind: 'square', rect: [20, 20, 30, 30] })
    store.create({
      pageIndex: 0, kind: 'area', rect: [10, 10, 100, 100],
      vertices: [[10, 10], [100, 10], [100, 100]],
      measure: { kind: 'area', mmPerPoint: 1, unit: 'm', decimals: 2 },
    })

    expect(new Set(store.pickupsInRoom(0, region))).toEqual(
      new Set([inside.id, line.id, wall.id, trench.id, area.id, volume.id]),
    )
  })

  it('既存の拾いへの部屋と階の反映をまとめて戻し、範囲登録は別のUndoにする', () => {
    const store = new AnnotationStore(), mark = count(store, [20, 20])
    const region = room()
    store.setRoomRegions(0, [region])
    store.updatePickupLocation(store.pickupsInRoom(0, region), 'room', region.name, { floor: region.floor! })
    expect(store.get(mark.id)?.count).toMatchObject({ room: '事務室', floor: normalizeFloor('1階') })

    store.undo()
    expect(store.get(mark.id)?.count).toMatchObject({ room: '廊下', floor: '2階' })
    expect(store.getRoomRegions(0)).toEqual([region])
    store.undo()
    expect(store.getRoomRegions(0)).toEqual([])
    expect(store.get(mark.id)?.count).toMatchObject({ room: '廊下', floor: '2階' })
  })

  it('階のない範囲の反映、名前変更、削除では拾いの階を変えない', () => {
    const store = new AnnotationStore(), mark = count(store, [20, 20])
    const region = room({ floor: undefined })
    store.setRoomRegions(0, [region])
    store.updatePickupLocation([mark.id], 'room', region.name)
    expect(store.get(mark.id)?.count).toMatchObject({ room: '事務室', floor: '2階' })
    store.setRoomRegions(0, [{ ...region, name: '会議室' }])
    store.setRoomRegions(0, [])
    expect(store.get(mark.id)?.count).toMatchObject({ room: '事務室', floor: '2階' })
  })

  it('同じ記号を探す追加では候補の中心の部屋を使う', () => {
    const store = new AnnotationStore()
    store.setCountFixtures([{
      id: 'fixture', name: 'コンセント', code: 'C', category: '試験',
      order: 0, style: nextCountStyle([]),
    }])
    store.setCurrentLocation('room', '廊下')
    store.setRoomRegions(0, [room()])
    const ids = store.createCountMarks('fixture', [
      { pageIndex: 0, center: [20, 20] },
      { pageIndex: 0, center: [200, 200] },
    ])
    expect(store.get(ids[0])?.count).toMatchObject({ room: '事務室', floor: '1階' })
    expect(store.get(ids[1])?.count).toMatchObject({ room: '廊下' })
  })

  it('注釈の保存によるID変更後も範囲の履歴を残す', () => {
    const store = new AnnotationStore()
    count(store, [20, 20])
    store.setRoomRegions(0, [room()])
    const edits = store.toEdits()
    expect(edits.map(edit => edit.kind)).toEqual(['createSymbol', 'setRoomRegions'])
    store.markApplied({ created: [37] })
    store.undo()
    expect(store.getRoomRegions(0)).toEqual([])
    store.undo()
    expect(store.get('obj-37')).toBeUndefined()
    store.redo()
    expect(store.get('obj-37')).toBeDefined()
    store.redo()
    expect(store.getRoomRegions(0)).toEqual([room()])
  })

  it('表示と囲む状態を保存・履歴に入れず、resetで範囲を消す', () => {
    const store = new AnnotationStore()
    expect(store.showRoomRegions).toBe(true)
    store.setShowRoomRegions(false)
    store.startRoomCapture(0)
    expect(store.roomCapturePage).toBe(0)
    expect(store.toEdits()).toEqual([])
    expect(store.canUndo()).toBe(false)
    store.endRoomCapture()
    expect(store.roomCapturePage).toBeNull()

    store.loadRoomRegions([[0, [room()]]])
    store.startRoomCapture(0)
    store.reset(true)
    expect(store.getRoomRegions(0)).toEqual([])
    expect(store.roomCapturePage).toBeNull()
    expect(store.showRoomRegions).toBe(false)
    expect(store.isDirty()).toBe(false)

    store.reset()
    expect(store.showRoomRegions).toBe(true)
  })

  it('不正な範囲や200個を超える登録を拒否する', () => {
    const store = new AnnotationStore()
    expect(() => store.setRoomRegions(0, [room({ name: '' })])).toThrow()
    expect(() => store.setRoomRegions(0, [room({ points: [[0, 0], [1, 1]] })])).toThrow()
    expect(() => store.setRoomRegions(0, Array.from({ length: 201 }, (_, i) => room({ id: String(i) })))).toThrow()
    expect(store.getRoomRegions(0)).toEqual([])
    expect(store.canUndo()).toBe(false)
  })
})

function blankDocument(pages = 2) {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < pages; i++) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    return doc
  } catch (reason) {
    doc.destroy()
    throw reason
  }
}

function reopen(doc: PDFDocument) {
  const buffer = doc.saveToBuffer('compress')
  try { return new mupdf.PDFDocument(new Uint8Array(buffer.asUint8Array())) }
  finally { buffer.destroy() }
}

describe('部屋の範囲のPDF保存', () => {
  it('setRoomRegionsで保存して開き直し、空で辞書を削除する', () => {
    const doc = blankDocument()
    try {
      // Metadata-only edits do not use font resources.
      const fonts = {} as Parameters<typeof applyEdits>[2]
      const result = applyEdits(doc, [{ kind: 'setRoomRegions', pageIndex: 1, regions: [room()] }], fonts)
      expect(result.errors).toEqual([])
      const saved = reopen(doc)
      try {
        expect(readDocumentRoomRegions(saved)).toEqual([[1, [room()]]])
        const page = saved.loadPage(1)
        try { expect(page.getAnnotations()).toHaveLength(0) } finally { page.destroy() }
        expect(applyEdits(saved, [{ kind: 'setRoomRegions', pageIndex: 1, regions: [] }], fonts).errors).toEqual([])
        const empty = reopen(saved)
        try {
          expect(readDocumentRoomRegions(empty)).toEqual([])
          const emptyPage = empty.loadPage(1)
          try {
            const object = emptyPage.getObject()
            try {
              const metadata = object.get('KaruRooms')
              try { expect(metadata.isNull()).toBe(true) } finally { metadata.destroy() }
            } finally { object.destroy() }
          } finally { emptyPage.destroy() }
        } finally { empty.destroy() }
      } finally { saved.destroy() }
    } finally { doc.destroy() }
  })

  it('ページを逆順に組み直すと部屋の辞書もページと一緒に動く', () => {
    const doc = blankDocument()
    try {
      const second = room({ id: 'second', name: '会議室' })
      const result = applyEdits(doc, [
        { kind: 'setRoomRegions', pageIndex: 0, regions: [room()] },
        { kind: 'setRoomRegions', pageIndex: 1, regions: [second] },
      ], {} as Parameters<typeof applyEdits>[2])
      expect(result.errors).toEqual([])
      applyPageLayout('target', doc, [1, 0].map((pageIndex, index) => ({ id: `page-${index}`, source: { kind: 'page', docId: 'target', pageIndex }, rotation: 0 })), new Map())
      const saved = reopen(doc)
      try {
        expect(readDocumentRoomRegions(saved)).toEqual([[0, [second]], [1, [room()]]])
        const page = saved.loadPage(0)
        try { expect(readRoomRegions(page)).toEqual([second]) } finally { page.destroy() }
      } finally { saved.destroy() }
    } finally { doc.destroy() }
  })

  it('他のPDFから足したページも部屋の範囲を持ってくる', () => {
    const doc = blankDocument(), other = blankDocument()
    try {
      const second = room({ id: 'second', name: '会議室' })
      expect(applyEdits(other, [{ kind: 'setRoomRegions', pageIndex: 1, regions: [second] }], {} as Parameters<typeof applyEdits>[2]).errors).toEqual([])
      applyPageLayout('target', doc, [
        { id: 'a', source: { kind: 'page', docId: 'target', pageIndex: 0 }, rotation: 0 },
        { id: 'b', source: { kind: 'page', docId: 'other', pageIndex: 1 }, rotation: 0 },
      ], new Map([['other', other]]))
      const saved = reopen(doc)
      try { expect(readDocumentRoomRegions(saved)).toEqual([[1, [second]]]) } finally { saved.destroy() }
    } finally { other.destroy(); doc.destroy() }
  })
})
