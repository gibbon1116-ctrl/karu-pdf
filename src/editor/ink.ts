import type { Point } from '../core/annotations'

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const amount = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point[0] - (start[0] + amount * dx), point[1] - (start[1] + amount * dy))
}

export function simplifyPoints(points: readonly Point[], tolerance = 0.5): Point[] {
  if (points.length <= 2) return points.map((point) => [...point])
  let furthestIndex = 0
  let furthestDistance = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index], points[0], points[points.length - 1])
    if (distance > furthestDistance) {
      furthestDistance = distance
      furthestIndex = index
    }
  }
  if (furthestDistance <= tolerance) return [[...points[0]], [...points[points.length - 1]]]
  const left = simplifyPoints(points.slice(0, furthestIndex + 1), tolerance)
  const right = simplifyPoints(points.slice(furthestIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

export interface PreviousInkStroke {
  id: string
  pageIndex: number
  kind: 'highlight' | 'ink'
  endedAt: number
}

export function mergeInkAnnotationId(
  previous: PreviousInkStroke | null,
  pageIndex: number,
  kind: PreviousInkStroke['kind'],
  startedAt: number,
): string | null {
  return previous
    && previous.pageIndex === pageIndex
    && previous.kind === kind
    && startedAt - previous.endedAt <= 1_500
    ? previous.id
    : null
}
