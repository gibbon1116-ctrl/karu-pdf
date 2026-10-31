import type { Point } from './annotations'

export function insertPolygonVertex(points: readonly Point[], edgeIndex: number): Point[] | null {
  if (points.length < 3 || points.length >= 500
    || !Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= points.length) return null
  const a = points[edgeIndex], b = points[(edgeIndex + 1) % points.length]
  const next = points.map(point => [...point] as Point)
  next.splice(edgeIndex + 1, 0, [a[0] / 2 + b[0] / 2, a[1] / 2 + b[1] / 2])
  return next
}

export function removePolygonVertex(points: readonly Point[], vertexIndex: number): Point[] | null {
  if (points.length <= 3
    || !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= points.length) return null
  return points.filter((_, index) => index !== vertexIndex).map(point => [...point] as Point)
}
