import type { Point } from './annotations'

/** Shift draws a straight line at the nearest five degrees, preserving length. */
export function constrainLinePoint(start: Point, end: Point, shift: boolean): Point {
  if (!shift) return end
  const dx = end[0] - start[0], dy = end[1] - start[1], distance = Math.hypot(dx, dy)
  if (!distance) return end
  const step = Math.PI / 36
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return [start[0] + Math.cos(angle) * distance, start[1] + Math.sin(angle) * distance]
}

export function arrowHeadSize(value: number | null | undefined, borderWidth: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 2 && value <= 72
    ? value : Math.max(8, borderWidth * 5)
}
