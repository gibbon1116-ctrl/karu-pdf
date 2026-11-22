import { describe, expect, it } from 'vitest'
import mupdf from 'mupdf'
import type { Point } from '../src/core/annotations'
import {
  parseRoomRegions, parseRoomSets, pointInRoomRegion, readRoomRegions, readRoomSets, roomAt,
  roomRegionHoleError, serializeRoomRegions, translateRoomRegion, writeRoomRegions, writeRoomSets,
  type RoomRegion,
} from '../src/core/rooms'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function rectangle(x: number, y: number, width: number, height = width): Point[] {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
}

const office: RoomRegion = { id: 'office', name: '事務室', floor: '1階', points: rectangle(0, 0, 100) }
const hole = rectangle(20, 20, 60)
const storage: RoomRegion = { id: 'storage', name: '倉庫', floor: '3階', points: rectangle(25, 25, 20) }

function roomSet(regions: RoomRegion[]) {
  return { id: 'set', name: '部屋の組', regions }
}

describe('部屋の抜く範囲の解析と判定', () => {
  it('両方のPDF辞書で保存し直したあとも穴を読み込める', () => {
    const region = { ...office, holes: [hole] }
    const set = roomSet([{ ...region, id: 'shared' }])
    expect(parseRoomRegions(serializeRoomRegions([region]))).toEqual([region])
    expect(parseRoomSets(JSON.stringify({ version: 1, sets: [set] }))).toEqual([set])

    const doc = new mupdf.PDFDocument()
    try {
      const ref = doc.addPage([0, 0, 200, 200], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      const page = doc.loadPage(0)
      try { writeRoomRegions(doc, page, [region]) } finally { page.destroy() }
      writeRoomSets(doc, [set])
      const buffer = doc.saveToBuffer('compress')
      try {
        const reopened = new mupdf.PDFDocument(buffer.asUint8Array())
        try {
          const reopenedPage = reopened.loadPage(0)
          try { expect(readRoomRegions(reopenedPage)).toEqual([region]) } finally { reopenedPage.destroy() }
          expect(readRoomSets(reopened)).toEqual([set])
        } finally { reopened.destroy() }
      } finally { buffer.destroy() }
    } finally { doc.destroy() }
  })

  it.each([
    { label: '2点', holes: [hole.slice(0, 2)] },
    { label: '501点', holes: [Array<Point>(501).fill([20, 20])] },
    { label: 'NaN', holes: [[[20, NaN], [30, 20], [30, 30]]] },
    { label: '51個', holes: Array<Point[]>(51).fill(hole) },
    { label: '配列以外', holes: null },
    { label: '3座標', holes: [[[20, 20, 20], [30, 20], [30, 30]]] },
  ])('$label の穴があれば部屋全体を読み飛ばす', ({ holes }) => {
    const regions = [{ ...office, holes }, storage]
    expect(parseRoomRegions(regions)).toEqual([storage])
    expect(parseRoomSets({ version: 1, sets: [{ ...roomSet([]), regions }] })).toEqual([roomSet([storage])])
  })

  it('空の穴配列は省き、50個・500点は読み込む', () => {
    const empty = { ...office, holes: [] }
    expect(parseRoomRegions([empty])).toEqual([office])
    expect(parseRoomSets({ version: 1, sets: [roomSet([empty])] })).toEqual([roomSet([office])])
    const limit = { ...office, holes: Array<Point[]>(50).fill(Array<Point>(500).fill([20, 20])) }
    expect(parseRoomRegions([limit])).toEqual([limit])
  })

  it('外形と穴の辺上の点を含め、穴の内側を除外する', () => {
    const region = { ...office, holes: [hole, rectangle(30, 30, 60)] }
    expect(pointInRoomRegion(region, [0, 0])).toBe(true)
    expect(pointInRoomRegion(region, [20, 40])).toBe(true)
    expect(pointInRoomRegion(region, [10, 50])).toBe(true)
    expect(pointInRoomRegion(region, [25, 25])).toBe(false)
    expect(pointInRoomRegion(region, [50, 50])).toBe(false)
    expect(pointInRoomRegion(region, [80, 50])).toBe(false)
    expect(pointInRoomRegion(region, [-1, 50])).toBe(false)
  })

  it('穴の絶対面積を差し引いて最小の部屋を選ぶ', () => {
    const region = { ...office, holes: [[...hole].reverse()] }
    const other = { ...storage, points: rectangle(0, 0, 90, 80) }
    expect(roomAt([office, other], [10, 10])).toBe(other)
    expect(roomAt([other, region], [10, 10])).toBe(region)
    expect(roomAt([other, region], [50, 50])).toBe(other)
    const zero = { ...office, holes: [hole, hole, hole] }
    const alsoZero = { ...storage, points: rectangle(0, 0, 10), holes: [rectangle(20, 20, 80)] }
    expect(roomAt([zero, alsoZero], [0, 0])).toBe(zero)
  })

  it('外形と穴を同じだけ平行移動する', () => {
    expect(translateRoomRegion({ ...office, holes: [hole] }, 35, -10)).toEqual({
      ...office, points: rectangle(35, -10, 100), holes: [rectangle(55, 10, 60)],
    })
  })

  it('囲む点と外形を検証し、50個まで追加できる', () => {
    expect(roomRegionHoleError(office, rectangle(0, 0, 30))).toBeUndefined()
    expect(roomRegionHoleError({ ...office, holes: [hole] }, hole)).toBeUndefined()
    expect(roomRegionHoleError(office, rectangle(90, 90, 20))).toBe('抜く範囲は部屋の範囲の内側を囲んでください')
    expect(roomRegionHoleError(office, hole.slice(0, 2))).toContain('3点以上500点以下')
    expect(roomRegionHoleError(office, [[Infinity, 20], ...hole])).toBe('抜く範囲の点が不正です')
    expect(roomRegionHoleError({ ...office, holes: Array<Point[]>(50).fill(hole) }, hole)).toBe('抜く範囲は1部屋50か所までです')
  })
})

describe('部屋の抜く範囲の変更と履歴', () => {
  it.each([false, true])('追加・削除ごとにUndo/Redoが1回で済む（組の部屋: %s）', shared => {
    const store = new AnnotationStore()
    if (shared) store.loadRoomSets([roomSet([office])], [[0, { id: 'set', dx: 120, dy: -15 }], [1, { id: 'set' }]])
    else store.loadRoomRegions([[0, [office]]])
    const pageHole = shared ? rectangle(140, 5, 60) : hole
    const effective = () => store.effectiveRoomRegions(0)[0].region
    const originalPoints = structuredClone(effective().points)
    const stored = () => shared ? store.getPageRoomSet(0)!.regions[0] : store.getRoomRegions(0)[0]
    expect(() => store.addRoomRegionHole(0, office.id, rectangle(500, 500, 20))).toThrow('内側を囲んでください')
    expect(store.canUndo()).toBe(false)

    store.addRoomRegionHole(0, office.id, pageHole)
    expect(stored().holes).toEqual([hole])
    expect(effective().holes).toEqual([pageHole])
    expect(effective().points).toEqual(originalPoints)
    if (shared) expect(store.effectiveRoomRegions(1)[0].region.holes).toEqual([hole])
    store.undo()
    expect(stored()).toEqual(office)
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(stored().holes).toEqual([hole])

    store.removeRoomRegionHole(0, office.id, 1)
    store.removeRoomRegionHole(0, office.id, -1)
    store.removeRoomRegionHole(0, office.id, 0)
    expect(stored()).toEqual(office)
    store.undo()
    expect(stored().holes).toEqual([hole])
    store.undo()
    expect(store.canUndo()).toBe(false)
    store.redo()
    store.redo()
    expect(stored()).toEqual(office)
    expect(effective().points).toEqual(originalPoints)
  })

  it('組の外形を縮めたり名前を変えたりしても格納済みの穴の座標を保つ', () => {
    const store = new AnnotationStore()
    const preciseHole = rectangle(20.12345, 20.6789, 60)
    store.loadRoomSets([roomSet([{ ...office, holes: [preciseHole] }])], [[0, { id: 'set', dx: 90000.5, dy: -90000.5 }]])
    const region = store.effectiveRoomRegions(0)[0].region
    const points = rectangle(90000.5, -90000.5, 10)
    store.startRoomEdit(0, office.id)
    store.updateRoomRegion(0, { ...region, points, name: '会議室' })
    store.endRoomEdit()
    expect(store.getPageRoomSet(0)?.regions[0]).toMatchObject({ name: '会議室', holes: [preciseHole] })
    expect(store.effectiveRoomRegions(0)[0].region.points).toEqual(points)
    store.undo()
    expect(store.getPageRoomSet(0)?.regions[0]).toEqual({ ...office, holes: [preciseHole] })
  })

  it('組の複製に穴を引き継ぎ、複製側の穴を戻しても元の組に影響しない', () => {
    const store = new AnnotationStore()
    store.loadRoomSets([roomSet([{ ...office, holes: [hole] }])], [[0, { id: 'set', dx: 120, dy: -15 }], [1, { id: 'set' }]])
    const copy = store.duplicateRoomSet(0, 'set', '複製')
    const id = copy.regions[0].id
    expect(store.effectiveRoomRegions(0)[0].region.holes).toEqual([rectangle(140, 5, 60)])
    store.removeRoomRegionHole(0, id, 0)
    expect(store.effectiveRoomRegions(0)[0].region.holes).toBeUndefined()
    expect(store.effectiveRoomRegions(1)[0].region.holes).toEqual([hole])
  })

  it('囲む対象が消えるかデータを読み込み直すと状態を解除する', async () => {
    const store = new AnnotationStore()
    store.loadRoomRegions([[0, [office]]])
    expect(store.startRoomHoleCapture(0, office.id)).toBe(false)
    await store.ensureCountFixtures(async () => [], async () => {})
    expect(store.startRoomHoleCapture(0, 'missing')).toBe(false)
    const start = () => expect(store.startRoomHoleCapture(0, office.id)).toBe(true)
    start()
    store.loadRoomSets([], [])
    expect(store.roomHoleTarget).toBeNull()
    start()
    store.loadRoomRegions([[0, [office]]])
    expect(store.roomHoleTarget).toBeNull()
    start()
    store.removeRoomRegion(0, office.id)
    expect(store.roomHoleTarget).toBeNull()
    store.undo()
    store.setRoomRegions(0, [office, storage])
    expect(store.startRoomHoleCapture(0, storage.id)).toBe(true)
    store.undo()
    expect(store.roomHoleTarget).toBeNull()
    start()
    store.reset()
    expect(store.roomHoleTarget).toBeNull()
  })

  it('ほかの囲み・編集・位置合わせと相互に排他になる', async () => {
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => [], async () => {})
    store.loadRoomRegions([[0, [office]]])
    store.loadRoomSets([roomSet([storage])], [[0, { id: 'set' }]])
    const area = store.create({
      pageIndex: 0, kind: 'area', rect: [0, 0, 100, 100], vertices: office.points,
      measure: { kind: 'area', mmPerPoint: 1, unit: 'm', decimals: 2 },
    })
    store.selectOnly(area.id)
    for (const [start, active] of [
      [() => store.startRoomCapture(0), () => store.roomCapturePage],
      [() => store.startRoomEdit(0, office.id), () => store.roomEditTarget],
      [() => store.startRoomSetAlign(0), () => store.roomSetAlignPage],
      [() => store.startAreaHoles(area.id), () => store.areaHoleTarget],
    ] as const) {
      expect(start()).toBe(true)
      expect(store.startRoomHoleCapture(0, office.id)).toBe(true)
      expect(active()).toBeNull()
      expect(store.roomHoleTarget).toEqual({ pageIndex: 0, id: office.id })
      expect(start()).toBe(true)
      expect(store.roomHoleTarget).toBeNull()
    }
  })
})

describe('穴の中にある拾いの部屋', () => {
  function setupPickups(shared = false) {
    const store = new AnnotationStore()
    if (shared) {
      store.loadRoomRegions([[0, [storage]]])
      store.loadRoomSets([roomSet([{ ...office, floor: undefined }])], [[0, { id: 'set' }]])
    } else store.loadRoomRegions([[0, [office, storage]]])
    const count = ([x, y]: Point, room = office.name, pageIndex = 0) => store.create({
      pageIndex, kind: 'symbol', rect: [x - 1, y - 1, x + 1, y + 1], symbol: 'circle',
      count: { version: 2, id: crypto.randomUUID(), fixtureId: 'fixture', room, floor: '2階' },
    })
    const insideStorage = count([35, 35])
    const insideHole = store.create({
      pageIndex: 0, kind: 'perimeter', rect: [10, 60, 60, 60], vertices: [[60, 60], [10, 60]],
      measure: { kind: 'perimeter', mmPerPoint: 1, unit: 'm', decimals: 2 },
      quantity: { version: 1, id: crypto.randomUUID(), itemId: 'line', method: 'polyline', room: office.name, floor: '4階' },
    })
    const edge = count([20, 60])
    const outsideHole = count([10, 10])
    const otherRoom = count([40, 40], storage.name)
    const otherPage = count([35, 35], office.name, 1)
    store.removeMany([count([35, 35]).id])
    store.addRoomRegionHole(0, office.id, hole)
    return { store, insideStorage, insideHole, edge, outsideHole, otherRoom, otherPage }
  }

  it('同じ部屋名の個数・数量だけを拾い、階を保ったまま一括で部屋を直す', () => {
    const { store, insideStorage, insideHole, edge, outsideHole, otherRoom, otherPage } = setupPickups()
    const targets = store.pickupsInRoomHole(0, office.id, 0)
    expect(targets).toEqual([insideStorage.id, insideHole.id])
    expect(store.pickupsInRoom(0, office)).toEqual([edge.id, outsideHole.id])
    store.reassignPickupRooms(0, [...targets, otherPage.id])
    expect(store.get(insideStorage.id)?.count).toMatchObject({ room: storage.name, floor: '2階' })
    expect(store.get(insideHole.id)?.quantity).toMatchObject({ floor: '4階' })
    expect(store.get(insideHole.id)?.quantity?.room).toBeUndefined()
    expect(store.get(otherRoom.id)?.count).toMatchObject({ room: storage.name })
    expect(store.get(otherPage.id)?.count).toMatchObject({ room: office.name })
    store.undo()
    expect(store.pickupsInRoomHole(0, office.id, 0)).toEqual(targets)
    expect(store.get(insideStorage.id)?.count).toMatchObject({ room: office.name, floor: '2階' })
    expect(store.get(insideHole.id)?.quantity).toMatchObject({ room: office.name, floor: '4階' })
    store.redo()
    expect(store.pickupsInRoomHole(0, office.id, 0)).toEqual([])
  })

  it('新しい拾いと、組を結び付けた図面の部屋候補でも穴を考慮する', () => {
    const { store, insideStorage, insideHole, outsideHole } = setupPickups(true)
    store.setCurrentLocation('room', office.name)
    expect(store.pickupLocation(0, [35, 35]).room).toBe(storage.name)
    expect(store.pickupLocation(0, [60, 60]).room).toBeUndefined()
    expect(store.pickupLocation(0, [20, 60]).room).toBe(office.name)
    expect(store.pickupLocation(0, [110, 110]).room).toBe(office.name)
    store.setCurrentLocation('room', '廊下')
    expect(store.pickupLocation(0, [60, 60]).room).toBe('廊下')

    store.updatePickupLocation([outsideHole.id], 'room', '廊下')
    const changes = store.roomSetPickupChanges(0)
    expect(changes.map(({ id }) => id)).toEqual([outsideHole.id])
    expect(changes.map(({ id }) => id)).not.toContain(insideStorage.id)
    expect(changes.map(({ id }) => id)).not.toContain(insideHole.id)
  })
})
