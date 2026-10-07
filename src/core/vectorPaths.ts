import type { Point } from './annotations'

export interface VectorPage {
  pageIndex: number
  /** x1,y1,x2,y2 in displayed page points, including /Rotate. */
  segments: Float32Array
  segmentCount: number
  truncated: boolean
  stats: {
    strokePaths: number; fillPaths: number; curves: number; images: number
    imageAreaRatio: number; textGlyphs: number
    ms: { displayList: number; walk: number; total: number }
  }
}
export type PageKind = 'vector' | 'raster' | 'mixed' | 'empty'

export function classifyPage(page: Pick<VectorPage, 'segmentCount' | 'stats'>): PageKind {
  if (page.stats.imageAreaRatio >= .5 && page.segmentCount < 200) return 'raster'
  if (page.segmentCount >= 200) return page.stats.imageAreaRatio < .2 ? 'vector' : 'mixed'
  return 'empty'
}

/** Euclidean deduplication across neighboring .01pt cells; first endpoint wins. */
export function segmentEndpoints(segments: Float32Array, limit = 200_000): Point[] {
  const points: Point[] = [], cells = new Map<string, Point[]>()
  const cap = Math.max(0, Math.floor(limit))
  for (let i = 0; i + 1 < segments.length && points.length < cap; i += 2) {
    const x = segments[i], y = segments[i + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const cx = Math.floor(x / .01), cy = Math.floor(y / .01)
    let duplicate = false
    for (let dy = -1; dy <= 1 && !duplicate; dy++) for (let dx = -1; dx <= 1 && !duplicate; dx++) {
      for (const p of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        if ((p[0] - x) ** 2 + (p[1] - y) ** 2 <= .0001) { duplicate = true; break }
      }
    }
    if (duplicate) continue
    const p: Point = [x, y], key = `${cx},${cy}`, bucket = cells.get(key)
    if (bucket) bucket.push(p); else cells.set(key, [p])
    points.push(p)
  }
  return points
}
