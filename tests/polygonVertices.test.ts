import { describe, expect, it } from 'vitest'
import type { Point } from '../src/core/annotations'
import { insertPolygonVertex, removePolygonVertex } from '../src/core/polygonVertices'

const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]]

describe('insertPolygonVertex', () => {
  it('inserts a midpoint after the specified edge start without changing the input', () => {
    const next = insertPolygonVertex(square, 1)
    expect(next).toEqual([[0, 0], [10, 0], [10, 5], [10, 10], [0, 10]])
    expect(square).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
    expect(next?.[0]).not.toBe(square[0])
  })

  it('includes the closing edge from the last vertex to the first', () => {
    expect(insertPolygonVertex(square, 3)).toEqual([
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 5],
    ])
  })

  it('rejects invalid edge indexes', () => {
    for (const index of [-1, 4, .5, NaN]) {
      expect(insertPolygonVertex(square, index)).toBeNull()
    }
  })

  it('allows the 500th point and rejects the 501st', () => {
    const points: Point[] = Array.from({ length: 499 }, (_, index) => [index, index % 2])
    const next = insertPolygonVertex(points, 498)
    expect(next).toHaveLength(500)
    expect(insertPolygonVertex(next!, 499)).toBeNull()
    expect(points).toHaveLength(499)
  })

  it('rejects a polygon with fewer than three points', () => {
    expect(insertPolygonVertex([[0, 0], [10, 0]], 0)).toBeNull()
  })
})

describe('removePolygonVertex', () => {
  it('removes the specified point and copies the remaining coordinates', () => {
    const next = removePolygonVertex(square, 1)
    expect(next).toEqual([[0, 0], [10, 10], [0, 10]])
    expect(next?.[0]).not.toBe(square[0])
    expect(square).toHaveLength(4)
  })

  it('can remove the last point', () => {
    expect(removePolygonVertex(square, 3)).toEqual([[0, 0], [10, 0], [10, 10]])
  })

  it('keeps at least three points', () => {
    const triangle: Point[] = [[0, 0], [10, 0], [0, 10]]
    expect(removePolygonVertex(triangle, 0)).toBeNull()
    expect(triangle).toHaveLength(3)
  })

  it('rejects invalid vertex indexes', () => {
    for (const index of [-1, 4, .5, NaN]) {
      expect(removePolygonVertex(square, index)).toBeNull()
    }
  })
})
