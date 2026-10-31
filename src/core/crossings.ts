type Point = [number, number]
type Path = ReadonlyArray<Point>

export interface PageCrossingBarrier {
  pageIndex: number
  path: Path
}

interface Segment {
  a: Point
  b: Point
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface BarrierSegment extends Segment {
  barrier: number
}

function segmentsOf(path: Path): Segment[] {
  const segments: Segment[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    if (![a[0], a[1], b[0], b[1]].every(Number.isFinite)
      || (a[0] === b[0] && a[1] === b[1])) continue
    segments.push({
      a, b,
      minX: Math.min(a[0], b[0]),
      maxX: Math.max(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxY: Math.max(a[1], b[1]),
    })
  }
  return segments
}

/** Strict segment interiors only: endpoints and collinear overlap are excluded. */
function intersection(a: Segment, b: Segment): Point | undefined {
  const rx = a.b[0] - a.a[0], ry = a.b[1] - a.a[1]
  const sx = b.b[0] - b.a[0], sy = b.b[1] - b.a[1]
  const first = rx * sy, second = ry * sx
  const denominator = first - second
  if (!Number.isFinite(denominator)
    || Math.abs(denominator)
      <= Number.EPSILON * 16 * (Math.abs(first) + Math.abs(second))) {
    return undefined
  }
  const dx = b.a[0] - a.a[0], dy = b.a[1] - a.a[1]
  const t = (dx * sy - dy * sx) / denominator
  const u = (dx * ry - dy * rx) / denominator
  if (!(t > 0 && t < 1 && u > 0 && u < 1)) return undefined
  return [a.a[0] + t * rx, a.a[1] + t * ry]
}

function samePoint(a: Point, b: Point): boolean {
  // PDF-point tolerance, independent of page scale.
  return Math.abs(a[0] - b[0]) <= 1e-8
    && Math.abs(a[1] - b[1]) <= 1e-8
}

function countPrepared(path: Path, barriers: readonly BarrierSegment[]): number {
  if (!barriers.length) return 0
  const hits = new Map<number, Point[]>()
  let count = 0
  for (const segment of segmentsOf(path)) {
    for (const barrier of barriers) {
      // Segments are sorted by minX. Test all bounding-box axes before geometry.
      if (barrier.minX > segment.maxX) break
      if (barrier.maxX < segment.minX
        || barrier.minY > segment.maxY || barrier.maxY < segment.minY) continue
      const point = intersection(segment, barrier)
      if (!point) continue
      const previous = hits.get(barrier.barrier)
      if (previous?.some(hit => samePoint(hit, point))) continue
      if (previous) previous.push(point)
      else hits.set(barrier.barrier, [point])
      count++
    }
  }
  return count
}

/**
 * Each barrier path owns its intersections. Two barriers sharing an
 * intersection each contribute one; repeated hits on one barrier contribute one.
 */
export function countSegmentCrossings(
  path: ReadonlyArray<[number, number]>,
  barriers: ReadonlyArray<ReadonlyArray<[number, number]>>,
): number {
  const segments = barriers.flatMap((barrier, index) =>
    segmentsOf(barrier).map(segment => ({ ...segment, barrier: index })))
  segments.sort((a, b) => a.minX - b.minX)
  return countPrepared(path, segments)
}

/** Build once per selected barrier set, then reuse for every source pickup. */
export function createPageCrossingCounter(
  barriers: readonly PageCrossingBarrier[],
): (path: Path, pageIndex: number) => number {
  const pages = new Map<number, BarrierSegment[]>()
  barriers.forEach((barrier, index) => {
    const segments = segmentsOf(barrier.path)
      .map(segment => ({ ...segment, barrier: index }))
    if (!segments.length) return
    const page = pages.get(barrier.pageIndex)
    if (page) page.push(...segments)
    else pages.set(barrier.pageIndex, segments)
  })
  for (const page of pages.values()) page.sort((a, b) => a.minX - b.minX)
  return (path, pageIndex) => {
    const page = pages.get(pageIndex)
    return page === undefined ? 0 : countPrepared(path, page)
  }
}
