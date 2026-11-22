import { describe, expect, it, vi } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import { nextCountStyle, type CountFixture, type CountFixtureSample } from '../src/core/countFixtures'
import { measureBounds, ratioScale, type ScaleRegion } from '../src/core/measure'
import type { RoomRegion, RoomSet } from '../src/core/rooms'
import { AnnotationStore, type CarryOverInput, type EditableAnnotation } from '../src/editor/AnnotationStore'

const sheets = Array.from({ length: 4 }, () => ({ width: 300, height: 400 }))
const scale = ratioScale(50, 'PDF', sheets[0])
const newerScale = ratioScale(25, 'PDF', sheets[0])
const all = { fixtures: true, pickups: true, rooms: true, scales: true }

const fixture = (id: string, overrides: Partial<CountFixture> = {}): CountFixture => ({
  id, name: id, code: '', category: '電気設備', style: nextCountStyle([]), order: 0, ...overrides,
})

function sample(): CountFixtureSample {
  // Only the PNG header fields are used here by the fixture serializer.
  const header = new Uint8Array(33)
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  header.set([0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0], 16)
  return { png: btoa(String.fromCharCode(...header)), width: 16, height: 16, pageIndex: 2, rect: [5, 7, 30, 45] }
}

async function makeStore(fixtures: CountFixture[] = []) {
  const store = new AnnotationStore(pageIndex => sheets[pageIndex])
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  return store
}

function rectangle(left: number, top: number, width: number): Point[] {
  return [[left, top], [left + width, top], [left + width, top + width], [left, top + width]]
}

function room(id: string, x = 60): RoomRegion {
  return { id, name: '事務室', floor: '1階', points: rectangle(x, 60, 80), holes: [rectangle(x + 10, 70, 10)] }
}

function count(store: AnnotationStore, itemId: string, pageIndex = 0, rect: Rect = [40, 60, 56, 76]) {
  return store.create({
    kind: 'symbol', symbol: 'circle', rect, pageIndex,
    count: { version: 2, id: `mark-${itemId}`, fixtureId: itemId, floor: '1階', room: '事務室', condition: '露出' },
  })
}

function area(store: AnnotationStore, pageIndex = 0) {
  return store.create({
    kind: 'area', pageIndex, rect: [60, 60, 180, 180], vertices: rectangle(60, 60, 120), text: '旧版の表示',
    measure: { kind: 'area', unit: 'm', mmPerPoint: 10, decimals: 2, holes: [rectangle(70, 70, 16)] },
    quantity: {
      version: 1, id: 'mark-area', itemId: 'area', method: 'polygon', floor: '1階', room: '会議室',
      condition: '新設', holes: [rectangle(100, 100, 10)], openings: [{ itemId: 'opening', count: 1 }],
    },
  })
}

const page = (oldPage: number, newPage = oldPage, overrides: Partial<CarryOverInput['pages'][number]> = {}): CarryOverInput['pages'][number] =>
  ({ oldPage, newPage, factor: 1, pickups: [], roomRegions: [], ...overrides })

function region(id: string, rect: Rect = [30, 40, 110, 120]): ScaleRegion {
  return { id, rect, scale, label: '詳細' }
}

describe('旧版から写す', () => {
  it('項目、拾い、部屋と組、縮尺を一度に保存対象にし、undoとredoでまとめて復元する', async () => {
    const shared = fixture('shared', { name: '新版の項目', order: 7 })
    const oldFixtures = [
      fixture('shared', { name: '旧版の項目' }),
      fixture('area', { kind: 'area', method: 'polygon', sample: sample(), line: { width: 2, dash: 'dashed' } }),
      fixture('opening', { opening: { widthM: .2, heightM: .3 } }),
    ]
    const target = await makeStore([shared]), old = await makeStore(oldFixtures)
    const existingRoom = room('target-room'), existingSet = { id: 'new-set', name: '両方にある組', regions: [room('target-set-room')] }
    const existingScaleRegion = region('target-scale-region')
    target.loadRoomRegions([[0, [existingRoom]]])
    target.loadRoomSets([existingSet], [[1, { id: existingSet.id, dx: 5 }]])
    target.loadScales([null, newerScale])
    target.loadScaleRegions([[1, [existingScaleRegion]]])
    const targetPickup = area(target)
    target.toEdits()
    target.markApplied({ created: [10] })
    const priorMeasure = target.get('obj-10')
    expect(target.isDirty()).toBe(false)

    const sourceSet: RoomSet = { id: 'old-set', name: existingSet.name, floor: '1階', anchor: [80, 100], regions: [room('source-set-room')] }
    old.loadRoomSets([sourceSet], [[0, { id: sourceSet.id, dx: 14, dy: 10 }], [1, { id: sourceSet.id }], [2, { id: sourceSet.id, dx: 8, dy: -4 }]])
    old.loadRoomRegions([[0, [room('source-room')]], [1, [room('other-room')]]])
    old.loadScales([scale, scale])
    old.loadScaleRegions([[0, [region('source-region')]], [1, [region('ignored-region')]]])
    count(old, 'shared')
    area(old)
    count(old, 'missing')
    old.remove(count(old, 'removed').id)
    old.toEdits()
    old.markApplied({ created: [20, 21, 22] })
    expect(old.isDirty()).toBe(false)
    const sourcePickups = old.getPageAnnotations(0)
    const input: CarryOverInput = {
      fixtures: old.getCountFixtures(), roomSets: old.getRoomSets(), include: all,
      pages: [0, 1, 2].map((index) => page(index, index, {
        factor: index === 0 ? .5 : index === 2 ? .75 : 1,
        pickups: index === 0 ? sourcePickups : [],
        roomRegions: old.getRoomRegions(index), roomSetLink: old.getPageRoomSetLink(index),
        scale: old.getScale(index), scaleRegions: old.getScaleRegions(index),
      })),
    }
    const original = structuredClone(input)
    const listener = vi.fn()
    target.subscribe(listener)
    expect(target.applyCarryOver(input)).toEqual({
      fixturesAdded: 2, fixturesExisting: 1, pickupsAdded: 2, pickupsSkipped: 1,
      roomRegionsAdded: 2, roomSetsAdded: 1, roomLinksSkipped: 1, scalesCopied: 1, scalesSkipped: 1, pagesOutside: [0],
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(input).toEqual(original)
    expect(old.isDirty()).toBe(false)
    expect(old.getPageAnnotations(0)).toEqual(sourcePickups)

    expect(target.getCountFixture('shared')).toEqual(shared)
    expect(target.getCountFixture('area')).toEqual({ ...oldFixtures[1], order: 8 })
    const pickups = target.getPageAnnotations(0).filter(mark => mark.id !== 'obj-10')
    const copiedCount = pickups.find(mark => mark.count)!
    const copiedArea = pickups.find(mark => mark.quantity)!
    expect(copiedCount.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(copiedCount.id).not.toBe(sourcePickups[0].id)
    expect(copiedCount.count).toMatchObject({ fixtureId: 'shared', floor: '1階', room: '事務室', condition: '露出' })
    expect(copiedCount.count?.id).not.toBe(sourcePickups[0].count?.id)
    // The count mark keeps the fixture's symbol size; only its center is scaled.
    expect(copiedCount).toMatchObject({ rect: [16, 26, 32, 42], objNum: null, dirty: true })
    expect(copiedArea.quantity?.id).not.toBe(sourcePickups[1].quantity?.id)
    expect(copiedArea.vertices).toEqual(rectangle(30, 30, 60))
    expect(copiedArea.measure).toMatchObject({ mmPerPoint: 20, holes: [rectangle(35, 35, 8)] })
    expect(copiedArea.quantity).toMatchObject({
      room: '会議室', condition: '新設', holes: [rectangle(50, 50, 5)], openings: [{ itemId: 'opening', count: 1 }],
    })
    expect(copiedArea.text).toBe(target.quantityText(copiedArea))
    expect(copiedArea.text).not.toBe('旧版の表示')
    expect(copiedArea.rect).toEqual(measureBounds(copiedArea.vertices!, 'area', copiedArea.text, copiedArea.fontSize))
    expect(copiedArea.rect[0]).toBeLessThan(0)
    expect(target.get('obj-10')).toEqual(priorMeasure)

    const [first, copiedRoom] = target.getRoomRegions(0)
    expect(first).toEqual(existingRoom)
    expect(copiedRoom.id).not.toBe('source-room')
    expect(copiedRoom).toMatchObject({ points: rectangle(30, 30, 40), holes: [rectangle(35, 35, 5)] })
    const [oldTargetSet, copiedSet] = target.getRoomSets()
    expect(oldTargetSet).toEqual(existingSet)
    expect(copiedSet.id).not.toBe(sourceSet.id)
    expect(copiedSet.regions[0].id).not.toBe(sourceSet.regions[0].id)
    expect(copiedSet).toMatchObject({
      name: '両方にある組（旧版）', anchor: [40, 50],
      regions: [{ points: rectangle(30, 30, 40), holes: [rectangle(35, 35, 5)] }],
    })
    expect(target.getPageRoomSetLink(0)).toEqual({ id: copiedSet.id, dx: 7, dy: 5 })
    expect(target.getPageRoomSetLink(1)).toEqual({ id: existingSet.id, dx: 5 })
    expect(target.getRoomRegions(1)).toHaveLength(1)
    expect(target.getPageRoomSetLink(2)).toEqual({ id: copiedSet.id, dx: 6, dy: -3 })
    expect(target.getScale(0)?.mmPerPoint).toBe(scale.mmPerPoint * 2)
    expect(target.getScale(0)?.denominator).toBeCloseTo(100)
    expect(target.getScale(1)).toEqual(newerScale)
    expect(target.getScaleRegions(1)).toEqual([existingScaleRegion])
    const [copiedScaleRegion] = target.getScaleRegions(0)
    expect(copiedScaleRegion.id).not.toBe('source-region')
    expect(copiedScaleRegion).toMatchObject({ rect: [15, 20, 55, 60], scale: target.getScale(0) })

    const summary = target.dirtySummary()
    expect(summary).toMatchObject({ annotations: 2, fixtures: true, rooms: [0, 1, 2], roomSets: true, scales: [0] })
    const edits = target.toEdits()
    expect(edits.map(edit => edit.kind)).toEqual([
      'createSymbol', 'createMeasure', 'setPageScale', 'setScaleRegions', 'setRoomRegions', 'setRoomRegions',
      'setRoomSets', 'setPageRoomSet', 'setPageRoomSet', 'setCountFixtures',
    ])
    target.undo()
    expect(target.isDirty()).toBe(false)
    expect(target.toEdits()).toEqual([])
    expect(target.getCountFixtures()).toEqual([shared])
    expect(target.getPageAnnotations(0)).toEqual([priorMeasure])
    expect(target.getRoomRegions(0)).toEqual([existingRoom])
    expect(target.getRoomSets()).toEqual([existingSet])
    expect(target.getPageRoomSetLink(2)).toBeUndefined()
    expect(target.getScale(0)).toBeNull()
    expect(target.getScaleRegions(0)).toEqual([])
    target.redo()
    expect(target.dirtySummary()).toEqual(summary)
    expect(target.toEdits()).toEqual(edits)
  })

  it('経路の条件・区間・付属品を保ち、参照する項目が足りない拾いと連動の拾いを除く', async () => {
    const fixtures = [
      fixture('route', { kind: 'length', method: 'polyline', routeDefaults: { plan: '露出' }, conditions: ['露出', '埋設'] }),
      fixture('member', { kind: 'length', method: 'polyline' }), fixture('point'), fixture('main'), fixture('component'),
    ]
    const target = await makeStore(fixtures), source = await makeStore(fixtures)
    const route = source.create({
      kind: 'perimeter', rect: [40, 70, 110, 90], pageIndex: 0, vertices: [[40, 80], [100, 80], [110, 90]],
      measure: { kind: 'perimeter', mmPerPoint: 5, decimals: 3, unit: 'm' },
      quantity: {
        version: 1, id: 'route-mark', itemId: 'route', method: 'polyline', floor: '2階', room: '電気室',
        cond: { plan: '埋設', rise: [undefined, '露出'], slack: null },
        extra: [{ itemId: 'member', count: 2, cond: { plan: null, rise: [undefined, '露出'] } }],
        points: [{ itemId: 'point', at: 1, count: 1, condition: '新設' }], rises: [{ at: 1, m: 1.5 }, { at: 2, m: 2 }],
      },
    })
    const simple = count(source, 'main')
    const legacy = { ...simple, legacyChange: true }
    const deleted = { ...simple, deleted: true }
    const linked = fixture('linked', { kind: 'length', method: 'polyline', link: { kind: 'factor', sources: [{ itemId: 'route', factor: 1 }] } })
    const linkedMark = { ...route, quantity: { ...route.quantity!, itemId: 'linked' } }
    const missingExtra = { ...route, quantity: { ...route.quantity!, extra: [{ itemId: 'no-route-item', count: 1 }] } }
    const missingComponent: EditableAnnotation = {
      ...simple, count: { version: 2, id: 'with-extra', fixtureId: 'main', extra: [{ itemId: 'no-component', count: 2 }] },
    }
    const result = target.applyCarryOver({
      fixtures: [...fixtures, linked], roomSets: [], include: { ...all, fixtures: false },
      pages: [page(0, 0, { factor: .5, pickups: [route, simple, legacy, deleted, linkedMark, missingExtra, missingComponent] })],
    })
    expect(result).toMatchObject({ fixturesAdded: 0, pickupsAdded: 2, pickupsSkipped: 2 })
    const copied = target.getPageAnnotations(0).find(mark => mark.quantity)!
    expect(copied.quantity).toEqual({ ...route.quantity, id: copied.quantity!.id })
    expect(copied.quantity?.id).not.toBe(route.quantity?.id)
    expect(copied.measure?.mmPerPoint).toBe(10)
    expect(copied.vertices).toEqual([[20, 40], [50, 40], [55, 45]])
  })

  it('用紙の外に出た拾い、部屋、縮尺の範囲を写してページを報告する', async () => {
    const base = fixture('existing'), target = await makeStore([base])
    const source = await makeStore([base])
    const pickup = count(source, base.id, 0, [296, 390, 322, 404])
    const result = target.applyCarryOver({
      fixtures: [base], roomSets: [], include: all,
      pages: [page(0, 2, { pickups: [pickup] }), page(1, 1, { roomRegions: [room('off-sheet', -20)] }),
        page(2, 0, { scaleRegions: [region('off-sheet-scale', [270, 360, 320, 390])] })],
    })
    expect(result.pagesOutside).toEqual([0, 1, 2])
    expect(target.getPageAnnotations(2)[0].rect).toEqual(pickup.rect)
    expect(target.getRoomRegions(1)[0].points).toEqual(room('off-sheet', -20).points)
    expect(target.getScaleRegions(0)[0].rect).toEqual([270, 360, 320, 390])
  })

  it('項目だけを追加し、同じ表示名の別項目をIDで区別する', async () => {
    const prior = fixture('existing', { name: '共通名' })
    const target = await makeStore([prior])
    const separate = { ...prior, id: 'different-id', sample: sample() }
    expect(target.applyCarryOver({
      fixtures: [separate], pages: [], roomSets: [], include: { fixtures: true, pickups: false, rooms: false, scales: false },
    })).toMatchObject({ fixturesAdded: 1, fixturesExisting: 0 })
    expect(target.getCountFixtures()).toEqual([prior, { ...separate, order: 1 }])
    target.undo()
    expect(target.isDirty()).toBe(false)
  })

  it('ページ全体の縮尺と縮尺の範囲を個別に扱う', async () => {
    const target = await makeStore()
    target.loadScales([newerScale, null])
    target.loadScaleRegions([[1, [region('existing')]]])
    const options = { scale, scaleRegions: [region('source')] }
    expect(target.applyCarryOver({
      fixtures: [], roomSets: [], include: all,
      pages: [page(0, 0, options), page(1, 1, options)],
    })).toMatchObject({ scalesCopied: 2, scalesSkipped: 2 })
    expect(target.getScale(0)).toEqual(newerScale)
    expect(target.getScaleRegions(0)[0].rect).toEqual(options.scaleRegions[0].rect)
    expect(target.getScale(1)).toEqual(scale)
    expect(target.getScaleRegions(1)).toEqual([region('existing')])
    target.undo()
    expect(target.isDirty()).toBe(false)
  })

  it('同名の長い組に接尾辞を付け、使われた組だけをコピーする', async () => {
    const target = await makeStore()
    const name = '長'.repeat(40)
    const prior = { id: 'existing', name, regions: [] }
    const sameName = { id: 'source', name, regions: [] }
    target.loadRoomSets([prior], [])
    expect(target.applyCarryOver({
      fixtures: [], roomSets: [sameName, { ...sameName, id: 'unused' }], include: all,
      pages: [page(0, 0, { roomSetLink: { id: sameName.id } })],
    })).toMatchObject({ roomSetsAdded: 1 })
    expect(target.getRoomSets().map(set => set.name)).toEqual([name, `${name.slice(0, 36)}（旧版）`])
  })

  it('後のページの検証に失敗しても履歴、項目、拾い、部屋、縮尺を変えない', async () => {
    const base = fixture('base'), added = fixture('added')
    const target = await makeStore([base]), source = await makeStore([added])
    target.loadRoomRegions([[1, Array.from({ length: 200 }, (_, i) => room(`target-${i}`))]])
    const listener = vi.fn()
    target.subscribe(listener)
    expect(() => target.applyCarryOver({
      fixtures: [added], roomSets: [], include: all,
      pages: [page(0, 0, { pickups: [count(source, added.id)], roomRegions: [room('copy')], scale }),
        page(1, 1, { roomRegions: [room('too-many')] })],
    })).toThrow('部屋の範囲が1ページ200個を超えるため写せません（p.2）')
    expect(listener).not.toHaveBeenCalled()
    expect(target.getCountFixtures()).toEqual([base])
    expect(target.getPageAnnotations(0)).toEqual([])
    expect(target.getRoomRegions(0)).toEqual([])
    expect(target.getRoomRegions(1)).toHaveLength(200)
    expect(target.getScale(0)).toBeNull()
    expect(target.canUndo()).toBe(false)
    expect(target.isDirty()).toBe(false)
  })

  it('項目の上限と同じ新版ページへの複数対応を検証する', async () => {
    const target = await makeStore(Array.from({ length: 1000 }, (_, i) => fixture(`item-${i}`)))
    const input = { fixtures: [fixture('too-many')], roomSets: [], pages: [], include: all }
    expect(() => target.applyCarryOver(input)).toThrow('項目が1000件を超えるため写せません')
    expect(() => target.applyCarryOver({ ...input, fixtures: [], pages: [page(0), page(1, 0)] })).toThrow('ページの対応')
    expect(target.isDirty()).toBe(false)
    expect(target.canUndo()).toBe(false)
  })
})

describe('ページの拾いと部屋をずらす', () => {
  it('同じページの拾い、部屋の穴、組の結び付け、縮尺の範囲だけを1件の履歴で動かす', async () => {
    const store = await makeStore([fixture('main'), fixture('area', { kind: 'area', method: 'polygon' }), fixture('opening')])
    const marked = count(store, 'main'), measured = area(store)
    const otherPage = count(store, 'main', 1)
    const note = store.create({ kind: 'square', pageIndex: 0, rect: [20, 30, 70, 90] })
    const measure = store.create({
      kind: 'distance', pageIndex: 0, rect: [20, 30, 90, 90], vertices: [[20, 30], [90, 90]],
      measure: { kind: 'distance', mmPerPoint: 1, decimals: null, unit: 'mm' },
    })
    const set: RoomSet = { id: 'linked', name: '組', anchor: [30, 40], regions: [room('shared')] }
    const firstRoom = room('first'), otherRoom = room('unmoved')
    const scaleRegion = region('region')
    store.loadRoomRegions([[0, [firstRoom]], [1, [otherRoom]]])
    store.loadRoomSets([set], [[0, { id: set.id, dx: 4, dy: 3 }], [1, { id: set.id, dx: 10 }]])
    store.loadScales([scale])
    store.loadScaleRegions([[0, [scaleRegion]], [1, [region('other-scale')]]])
    store.remove(count(store, 'main').id)
    const initialPage = store.getPageAnnotations(0), initialOtherPage = store.getPageAnnotations(1)
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.pageShiftCounts(0)).toEqual({ pickups: 2, roomRegions: 1, roomSet: true, scaleRegions: 1 })
    store.shiftPageContents(0, 12, -7)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get(marked.id)?.rect).toEqual([52, 53, 68, 69])
    expect(store.get(measured.id)).toMatchObject({
      rect: [72, 53, 192, 173], vertices: rectangle(72, 53, 120),
      measure: { mmPerPoint: 10, holes: [rectangle(82, 63, 16)] },
      quantity: { holes: [rectangle(112, 93, 10)], room: '会議室' },
    })
    expect(store.get(note.id)?.rect).toEqual(note.rect)
    expect(store.get(measure.id)?.vertices).toEqual(measure.vertices)
    expect(store.get(otherPage.id)?.rect).toEqual(otherPage.rect)
    expect(store.getRoomRegions(0)[0]).toMatchObject({ points: rectangle(72, 53, 80), holes: [rectangle(82, 63, 10)] })
    expect(store.getRoomSets()).toEqual([set])
    expect(store.getPageRoomSetLink(0)).toEqual({ id: set.id, dx: 16, dy: -4 })
    expect(store.getPageRoomSetLink(1)).toEqual({ id: set.id, dx: 10 })
    expect(store.getRoomRegions(1)).toEqual([otherRoom])
    expect(store.getScale(0)).toEqual(scale)
    expect(store.getScaleRegions(0)).toEqual([{ ...scaleRegion, rect: [42, 33, 122, 113] }])
    expect(store.getScaleRegions(1)).toEqual([region('other-scale')])
    store.undo()
    expect(store.getPageAnnotations(0).map(mark => mark.rect)).toEqual(initialPage.map(mark => mark.rect))
    expect(store.getPageAnnotations(1)).toEqual(initialOtherPage)
    expect(store.getRoomRegions(0)).toEqual([firstRoom])
    expect(store.getPageRoomSetLink(0)).toEqual({ id: set.id, dx: 4, dy: 3 })
    expect(store.getScaleRegions(0)).toEqual([scaleRegion])
    store.redo()
    expect(store.get(measured.id)?.measure?.holes).toEqual([rectangle(82, 63, 16)])
  })

  it('縮尺の範囲が用紙の外に出ると何も変更せず、移動量0も履歴を作らない', async () => {
    const store = await makeStore()
    const firstRoom = room('first')
    const existing = region('region', [10, 20, 280, 380])
    store.loadRoomRegions([[0, [firstRoom]]])
    store.loadScaleRegions([[0, [existing]]])
    const listener = vi.fn()
    store.subscribe(listener)
    for (const [dx, dy] of [[21, 0], [-11, 0], [0, 21], [0, -21]]) {
      expect(() => store.shiftPageContents(0, dx, dy)).toThrow('縮尺の範囲が用紙の外に出るため動かせません')
    }
    store.shiftPageContents(0, 0, 0)
    expect(store.getRoomRegions(0)).toEqual([firstRoom])
    expect(store.getScaleRegions(0)).toEqual([existing])
    expect(store.canUndo()).toBe(false)
    expect(store.isDirty()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('編集モードの切替とresetで解除し、移動対象のないページでは開始しない', async () => {
    const store = await makeStore()
    store.loadRoomRegions([[0, [room('first')]]])
    store.loadRoomSets([{ id: 'set', name: '組', regions: [] }], [[0, { id: 'set' }]])
    store.loadScaleRegions([[2, [region('scale-only')]]])
    const measurement = area(store)
    store.selectOnly(measurement.id)
    expect(store.startPageShift(1)).toBe(false)
    expect(store.startPageShift(2)).toBe(true)
    expect(store.pageShiftTarget).toBe(2)
    expect(store.startRoomSetAlign(0)).toBe(true)
    expect(store.pageShiftTarget).toBeNull()
    expect(store.startPageShift(0)).toBe(true)
    expect(store.roomSetAlignPage).toBeNull()
    expect(store.startRoomCapture(0)).toBe(true)
    expect(store.pageShiftTarget).toBeNull()
    expect(store.startPageShift(0)).toBe(true)
    expect(store.roomCapturePage).toBeNull()
    expect(store.startRoomEdit(0, 'first')).toBe(true)
    expect(store.pageShiftTarget).toBeNull()
    expect(store.startPageShift(0)).toBe(true)
    expect(store.roomEditTarget).toBeNull()
    expect(store.startRoomHoleCapture(0, 'first')).toBe(true)
    expect(store.pageShiftTarget).toBeNull()
    expect(store.startPageShift(0)).toBe(true)
    expect(store.roomHoleTarget).toBeNull()
    expect(store.startAreaHoles(measurement.id)).toBe(true)
    expect(store.pageShiftTarget).toBeNull()
    expect(store.startPageShift(0)).toBe(true)
    expect(store.areaHoleTarget).toBeNull()
    store.endPageShift()
    expect(store.pageShiftTarget).toBeNull()
    store.startPageShift(0)
    store.reset()
    expect(store.pageShiftTarget).toBeNull()
  })
})
