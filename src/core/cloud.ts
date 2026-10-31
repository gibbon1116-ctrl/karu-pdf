import type { Point, Rect } from './annotations'

export type CloudIntensity = 0 | 1 | 2
export interface CloudArc { start: Point; c1: Point; c2: Point; end: Point; edge: number }

// I=0 still draws small scallops. MuPDF's native I=0 is a plain border.
export function cloudDiameter(intensity: CloudIntensity, width: number): number {
  return [8, 12, 18][intensity] + Math.max(0, width) * 2
}
export function rectVertices(r: Rect): Point[] {
  return [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]
}
export function cloudArcs(points: readonly Point[], intensity: CloudIntensity, width: number): CloudArc[] {
  if (points.length < 3) return []
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]
    return sum + p[0] * q[1] - q[0] * p[1]
  }, 0)
  const winding = area >= 0 ? 1 : -1
  const arcs: CloudArc[] = []
  for (let edge = 0; edge < points.length; edge++) {
    const a = points[edge], b = points[(edge + 1) % points.length]
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    if (length < 1e-7) continue
    const count = Math.ceil(length / cloudDiameter(intensity, width))
    const height = length / count * .4
    const nx = winding * dy / length, ny = -winding * dx / length
    for (let i = 0; i < count; i++) {
      const start: Point = [a[0] + dx * i / count, a[1] + dy * i / count]
      const end: Point = i === count - 1 ? [...b] : [a[0] + dx * (i + 1) / count, a[1] + dy * (i + 1) / count]
      arcs.push({ start, end, edge,
        c1: [start[0] + (end[0] - start[0]) / 3 + nx * height * 4 / 3, start[1] + (end[1] - start[1]) / 3 + ny * height * 4 / 3],
        c2: [end[0] - (end[0] - start[0]) / 3 + nx * height * 4 / 3, end[1] - (end[1] - start[1]) / 3 + ny * height * 4 / 3] })
    }
  }
  return arcs
}
export function cloudPath(points: readonly Point[], intensity: CloudIntensity, width: number): string {
  const arcs = cloudArcs(points, intensity, width)
  if (!arcs.length) return ''
  return `M${arcs[0].start.join(' ')} ${arcs.map(a => `C${a.c1.join(' ')} ${a.c2.join(' ')} ${a.end.join(' ')}`).join(' ')} Z`
}
export function cloudBounds(points: readonly Point[], intensity: CloudIntensity, width: number): Rect {
  const margin = cloudDiameter(intensity, width) * .4 + width / 2
  return [Math.min(...points.map(p => p[0])) - margin, Math.min(...points.map(p => p[1])) - margin,
    Math.max(...points.map(p => p[0])) + margin, Math.max(...points.map(p => p[1])) + margin]
}
