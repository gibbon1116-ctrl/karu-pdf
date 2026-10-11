import { describe, expect, it, vi } from 'vitest'
import type { Point } from '../src/core/annotations'
import type { RoomRegion } from '../src/core/rooms'
import { AnnotationStore } from '../src/editor/AnnotationStore'

function region(id = 'room'): RoomRegion {
  return {
    id,
    name: '会議室',
    floor: '2F',
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
  }
}

function setup() {
  // Exercise the room-edit contract without document loading or workers.
  const store = Object.create(AnnotationStore.prototype) as AnnotationStore
  const notify = vi.fn()
  const push = vi.fn()
  Object.assign(store, {
    roomRegions: new Map<number, RoomRegion[]>([[0, [region(), region('other')]]]),
    roomEditState: null,
    roomEditCompletion: null,
    roomCaptureIndex: null,
    areaHoleId: null,
    roomSets: [],
    pageRoomSets: new Map<number, string>(),
  })
  Object.defineProperty(store, 'notify', { value: notify })
  Object.defineProperty(store, 'history', { value: { push } })
  Object.defineProperty(store, 'selectedIds', { value: () => ['area'] })
  Object.defineProperty(store, 'get', {
    value: () => ({
      id: 'area',
      pageIndex: 0,
      vertices: [[0, 0], [100, 0], [0, 100]],
      measure: { kind: 'area' },
      count: null,
      quantity: null,
      legacyChange: false,
    }) as ReturnType<AnnotationStore['get']>,
  })
  return { store, notify, push }
}

describe('room editing state', () => {
  it('starts and ends without creating history', () => {
    const { store, push } = setup()
    expect(store.startRoomEdit(0, 'room')).toBe(true)
    expect(store.roomEditTarget).toMatchObject({ pageIndex: 0, id: 'room' })
    store.endRoomEdit()
    expect(store.roomEditTarget).toBeNull()
    expect(store.takeRoomEditCompletion(0)).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('rejects missing regions and invalid pages', () => {
    const { store, push } = setup()
    expect(store.startRoomEdit(0, 'missing')).toBe(false)
    expect(store.startRoomEdit(-1, 'room')).toBe(false)
    expect(store.startRoomEdit(.5, 'room')).toBe(false)
    expect(store.roomEditTarget).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('keeps room editing, room capture and area exclusion mutually exclusive', () => {
    const { store, push } = setup()
    expect(store.startRoomCapture(0)).toBe(true)
    expect(store.startRoomEdit(0, 'room')).toBe(true)
    expect(store.roomCapturePage).toBeNull()
    expect(store.areaHoleTarget).toBeNull()

    expect(store.startAreaHoles('area')).toBe(true)
    expect(store.roomEditTarget).toBeNull()
    expect(store.roomCapturePage).toBeNull()
    expect(store.areaHoleTarget).toBe('area')

    expect(store.startRoomEdit(0, 'room')).toBe(true)
    expect(store.areaHoleTarget).toBeNull()

    expect(store.startRoomCapture(0)).toBe(true)
    expect(store.roomEditTarget).toBeNull()
    expect(store.areaHoleTarget).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('records one history entry per shape update and retains room identity', () => {
    const { store, push } = setup()
    store.startRoomEdit(0, 'room')
    const regions = store.getRoomRegions(0)
    const points: Point[] = [[0, 0], [120, 0], [100, 100], [0, 100]]
    store.setRoomRegions(0, regions.map(current => current.id === 'room' ? { ...current, points } : current))
    expect(push).toHaveBeenCalledTimes(1)
    expect(store.getRoomRegions(0)[0]).toEqual({ ...region(), points })

    store.endRoomEdit()
    expect(push).toHaveBeenCalledTimes(1)
    expect(store.takeRoomEditCompletion(0)).toEqual({
      pageIndex: 0,
      region: { ...region(), points },
    })
    expect(store.takeRoomEditCompletion(0)).toBeNull()
  })

  it('does not request confirmation when a shape was restored to its initial points', () => {
    const { store } = setup()
    store.startRoomEdit(0, 'room')
    store.setRoomRegions(0, [{
      ...region(),
      points: [[0, 0], [120, 0], [100, 100], [0, 100]],
    }, region('other')])
    store.setRoomRegions(0, [region(), region('other')])
    store.endRoomEdit()
    expect(store.takeRoomEditCompletion(0)).toBeNull()
  })

  it('does not request confirmation after cancellation or switching regions', () => {
    const { store } = setup()
    store.startRoomEdit(0, 'room')
    store.setRoomRegions(0, [{
      ...region(),
      points: [[0, 0], [120, 0], [100, 100], [0, 100]],
    }, region('other')])
    store.endRoomEdit(false)
    expect(store.takeRoomEditCompletion(0)).toBeNull()

    store.startRoomEdit(0, 'room')
    store.setRoomRegions(0, [{
      ...region(),
      points: [[0, 0], [140, 0], [100, 100], [0, 100]],
    }, region('other')])
    store.startRoomEdit(0, 'other')
    expect(store.roomEditTarget).toMatchObject({ pageIndex: 0, id: 'other' })
    expect(store.takeRoomEditCompletion(0)).toBeNull()
  })

  it('ends immediately when setRoomRegions deletes the target', () => {
    const { store, push } = setup()
    store.startRoomEdit(0, 'room')
    store.setRoomRegions(0, [region('other')])
    expect(store.roomEditTarget).toBeNull()
    expect(store.takeRoomEditCompletion(0)).toBeNull()
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('invalidates the target when history restoration removes it', () => {
    const { store, push } = setup()
    store.startRoomEdit(0, 'room')
    // History restores roomRegions directly rather than through setRoomRegions.
    store.roomRegions.set(0, [region('other')])
    expect(store.roomEditTarget).toBeNull()
    expect(store.takeRoomEditCompletion(0)).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('clears editing when room data is loaded', () => {
    const { store, push } = setup()
    Object.assign(store, { roomRegionBaselines: new Map<number, RoomRegion[]>() })
    store.startRoomEdit(0, 'room')
    store.loadRoomRegions([[0, [region()]]])
    expect(store.roomEditTarget).toBeNull()
    expect(store.takeRoomEditCompletion(0)).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })
})
