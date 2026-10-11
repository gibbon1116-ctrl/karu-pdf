import { describe, expect, it } from 'vitest'
import type { Point } from '../src/core/annotations'
import {
  parseRoomRegions,
  serializeRoomRegions,
  roomAt,
  pickupPoint,
  polygonCentroid,
  type RoomRegion,
} from '../src/core/rooms'

const square = (
  id = 'office',
  name = '事務室',
  low = 0,
  high = 10,
): RoomRegion => ({
  id,
  name,
  points: [[low, low], [high, low], [high, high], [low, high]],
})

describe('room region metadata', () => {
  it('reads JSON and serializes only valid regions', () => {
    const region = { ...square(), floor: '1階' }
    expect(parseRoomRegions(JSON.stringify([region]))).toEqual([region])
    expect(JSON.parse(serializeRoomRegions([region]))).toEqual([region])
    expect(parseRoomRegions('invalid JSON')).toEqual([])
    expect(parseRoomRegions({ rooms: [region] })).toEqual([])
  })

  it('discards invalid names, floors, ids and points', () => {
    const region = square()
    const invalid = [
      null,
      { ...region, id: 1 },
      { ...region, name: '' },
      { ...region, name: ' 事務室' },
      { ...region, name: '事務室 ' },
      { ...region, name: '事務\n室' },
      { ...region, name: '事務\r室' },
      { ...region, name: '事務\u2028室' },
      { ...region, name: 'あ'.repeat(41) },
      { ...region, floor: 'あ'.repeat(41) },
      { ...region, floor: null },
      { ...region, points: [[0, 0], [1, 1]] },
      { ...region, points: [[0, 0], [1, 1], [Infinity, 0]] },
      { ...region, points: [[0, 0], [1, 1], [0, NaN]] },
      { ...region, points: [[0, 0], [1, 1], ['0', 1]] },
      { ...region, points: [[0, 0], [1, 1], [0, 1, 2]] },
      { ...region, points: Array.from({ length: 501 }, () => [0, 0]) },
    ]
    expect(parseRoomRegions([...invalid, region])).toEqual([region])
    expect(JSON.parse(serializeRoomRegions(
      [...invalid, region] as unknown as RoomRegion[],
    ))).toEqual([region])
  })

  it('accepts limits and removes an empty floor', () => {
    const region = {
      ...square(),
      name: 'あ'.repeat(40),
      floor: 'あ'.repeat(40),
      points: Array.from({ length: 500 }, (_, i): Point => [i, i % 2]),
    }
    expect(parseRoomRegions([region])).toEqual([region])
    expect(parseRoomRegions([{ ...square(), floor: '' }])).toEqual([square()])
  })

  it('keeps at most 200 valid regions', () => {
    const regions = Array.from({ length: 201 }, (_, i) => square(String(i)))
    expect(parseRoomRegions([null, ...regions])).toEqual(regions.slice(0, 200))
    expect(JSON.parse(serializeRoomRegions(regions))).toEqual(regions.slice(0, 200))
  })

  it('copies points rather than retaining input references', () => {
    const input = square()
    const parsed = parseRoomRegions([input])
    input.points[0][0] = 99
    expect(parsed[0].points[0]).toEqual([0, 0])
  })
})

describe('room lookup', () => {
  it('includes interior, edges and vertices and excludes exterior', () => {
    const region = square()
    expect(roomAt([region], [5, 5])).toBe(region)
    expect(roomAt([region], [0, 5])).toBe(region)
    expect(roomAt([region], [10, 10])).toBe(region)
    expect(roomAt([region], [-1, 5])).toBeUndefined()
    expect(roomAt([], [5, 5])).toBeUndefined()
  })

  it('prefers the smaller containing polygon in either order', () => {
    const outer = square('outer', '事務室', 0, 20)
    const inner = square('inner', '倉庫', 5, 10)
    expect(roomAt([outer, inner], [7, 7])).toBe(inner)
    expect(roomAt([inner, outer], [7, 7])).toBe(inner)
    expect(roomAt([outer, inner], [5, 7])).toBe(inner)
    expect(roomAt([outer, inner], [15, 15])).toBe(outer)
  })

  it('handles concave polygons and reversed vertex order', () => {
    const region: RoomRegion = {
      id: 'concave',
      name: '廊下',
      points: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]],
    }
    expect(roomAt([region], [2, 8])).toBe(region)
    expect(roomAt([region], [8, 8])).toBeUndefined()
    expect(roomAt([{ ...region, points: [...region.points].reverse() }], [2, 8]))
      .toBeDefined()
  })
})

describe('pickup position', () => {
  const polygon: Point[] = [[0, 0], [8, 0], [8, 4], [0, 2]]

  it('uses the center of a count mark', () => {
    expect(pickupPoint({ count: {}, rect: [2, 4, 10, 16] })).toEqual([6, 10])
  })

  it('uses the first vertex for line pickups', () => {
    expect(pickupPoint({
      quantity: { method: 'polyline' },
      vertices: [[2, 3], [20, 30]],
    })).toEqual([2, 3])
    expect(pickupPoint({
      measure: { kind: 'distance' },
      vertices: [[2, 3], [20, 30]],
    })).toEqual([2, 3])
  })

  it('uses an area-weighted centroid for polygon and volume pickups', () => {
    for (const method of ['polygon', 'polygonDepth'] as const) {
      const point = pickupPoint({ quantity: { method }, vertices: polygon })!
      expect(point[0]).toBeCloseTo(40 / 9)
      expect(point[1]).toBeCloseTo(14 / 9)
    }
    const reverse = polygonCentroid([...polygon].reverse())!
    expect(reverse[0]).toBeCloseTo(40 / 9)
    expect(reverse[1]).toBeCloseTo(14 / 9)
  })

  it('uses the average of vertices for zero-area polygons', () => {
    expect(polygonCentroid([[0, 0], [3, 0], [9, 0]])).toEqual([4, 0])
    expect(pickupPoint({
      quantity: { method: 'polygon' },
      vertices: [[0, 0], [3, 0], [9, 0]],
    })).toEqual([4, 0])
  })

  it('returns no position without pickup geometry', () => {
    expect(pickupPoint({})).toBeUndefined()
    expect(pickupPoint({ quantity: { method: 'polygon' }, vertices: [] }))
      .toBeUndefined()
  })
})
