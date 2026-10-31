import type { Point, Rect } from './annotations'

/** Transferable CSR grid for annotation vertices or drawing endpoints. */
export interface SnapIndex {
  points: Float64Array
  bounds: Rect
  cellSize: number
  columns: number
  rows: number
  offsets: Uint32Array
  ids: Uint32Array
  bytes: number
}
export interface SnapHit { point: Point; kind: 'vertex' | 'drawing-endpoint' }
export interface SnapAxis { start: Point; direction: Point }
export const MAX_SNAP_VERTICES = 200_000

export function findPreferredSnap(point: Point, radius: number, vertices: SnapIndex | null, drawing: SnapIndex | null, axis?: SnapAxis): SnapHit | null {
  const vertex = findSnap(point, radius, vertices, axis)
  if (vertex) return vertex
  const endpoint = findSnap(point, radius, drawing, axis)
  return endpoint ? { ...endpoint, kind: 'drawing-endpoint' } : null
}

export function buildSnapIndex(points: readonly Point[], bounds: Rect, cellSize = 16): SnapIndex {
  if (!(cellSize > 0) || !Number.isFinite(cellSize) || !bounds.every(Number.isFinite) || bounds[2] < bounds[0] || bounds[3] < bounds[1]) throw Error('Invalid snap grid')
  if (points.length > MAX_SNAP_VERTICES) throw Error('Snap vertex limit')
  const columns = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / cellSize)), rows = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / cellSize))
  if (columns * rows > 1_000_000) throw Error('Snap grid limit')
  const counts = new Uint32Array(columns * rows), coords = new Float64Array(points.length * 2)
  const cell = (x: number, y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - bounds[1]) / cellSize))) * columns + Math.max(0, Math.min(columns - 1, Math.floor((x - bounds[0]) / cellSize)))
  points.forEach((p, i) => {
    if (!p.every(Number.isFinite)) throw Error('Invalid snap vertex')
    coords[i * 2] = p[0]; coords[i * 2 + 1] = p[1]; counts[cell(p[0], p[1])]++
  })
  const offsets = new Uint32Array(counts.length + 1), ids = new Uint32Array(points.length)
  for (let i = 0; i < counts.length; i++) offsets[i + 1] = offsets[i] + counts[i]
  counts.fill(0)
  points.forEach((p, i) => { const c = cell(p[0], p[1]); ids[offsets[c] + counts[c]++] = i })
  return { points: coords, bounds, cellSize, columns, rows, offsets, ids, bytes: coords.byteLength + offsets.byteLength + ids.byteLength }
}

export function findSnap(point: Point, radius: number, index: SnapIndex | null, axis?: SnapAxis): SnapHit | null {
  if (!index || radius < 0 || !Number.isFinite(radius) || !point.every(Number.isFinite)) return null
  const { points, bounds, columns, rows, cellSize, offsets, ids } = index
  // Vertices outside the page are assigned to edge cells; search those as well.
  const gridX = (x: number) => Math.max(0, Math.min(columns - 1, Math.floor((x - bounds[0]) / cellSize)))
  const gridY = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - bounds[1]) / cellSize)))
  const x0 = gridX(point[0] - radius), y0 = gridY(point[1] - radius), x1 = gridX(point[0] + radius), y1 = gridY(point[1] + radius)
  let candidates = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cell = y * columns + x
    candidates += offsets[cell + 1] - offsets[cell]
    if (candidates > 4096) return null
  }
  let best: Point | null = null, distance = radius * radius
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cell = y * columns + x
    for (let k = offsets[cell]; k < offsets[cell + 1]; k++) {
      const i = ids[k] * 2, vx = points[i], vy = points[i + 1]
      if (axis) {
        const length = Math.hypot(...axis.direction)
        if (!length || Math.abs((vx - axis.start[0]) * axis.direction[1] - (vy - axis.start[1]) * axis.direction[0]) / length > 1e-4) continue
      }
      const d = (vx - point[0]) ** 2 + (vy - point[1]) ** 2
      if (d <= distance) { best = [vx, vy]; distance = d }
    }
  }
  return best ? { point: best, kind: 'vertex' } : null
}
