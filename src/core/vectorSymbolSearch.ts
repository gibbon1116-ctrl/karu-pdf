import type { Point, Rect } from './annotations'

export interface VectorSymbolOptions {
  threshold: number
  rotations: boolean
  tolerance?: number
  maxResults: number
  region?: Rect
  shouldStop?: () => boolean
}
export interface VectorSymbolMatch { rect: Rect; center: Point; score: number; angle: number; extra: number }

export interface PreparedTemplate {
  segments: Float32Array; widths: Float32Array; bounds: Rect; tolerance: number
  removed: { wiring: number; other: number }; total: number; cleaned: boolean
}
export function defaultVectorTolerance(rect: Rect): number {
  return Math.min(1, Math.max(.3, Math.max(rect[2] - rect[0], rect[3] - rect[1]) * .03))
}
function pointDistance(x: number, y: number, a: ArrayLike<number>, i: number): number {
  const dx = a[i + 2] - a[i], dy = a[i + 3] - a[i + 1], d = dx * dx + dy * dy
  const t = d ? Math.max(0, Math.min(1, ((x - a[i]) * dx + (y - a[i + 1]) * dy) / d)) : 0
  return Math.hypot(x - a[i] - t * dx, y - a[i + 1] - t * dy)
}
function segmentDistance(a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): number {
  const dx = a[i + 2] - a[i], dy = a[i + 3] - a[i + 1]
  const ex = b[j + 2] - b[j], ey = b[j + 3] - b[j + 1]
  const ox = b[j] - a[i], oy = b[j + 1] - a[i + 1], cross = dx * ey - dy * ex
  if (cross) {
    const t = (ox * ey - oy * ex) / cross, u = (ox * dy - oy * dx) / cross
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
  }
  return Math.min(pointDistance(a[i], a[i + 1], b, j), pointDistance(a[i + 2], a[i + 3], b, j),
    pointDistance(b[j], b[j + 1], a, i), pointDistance(b[j + 2], b[j + 3], a, i))
}
const contains = (r: Rect, x: number, y: number, t: number) => x >= r[0] - t && x <= r[2] + t && y >= r[1] - t && y <= r[3] + t
function clippedLine(a: Float32Array, i: number, r: Rect): Rect | null {
  let lo = 0, hi = 1
  for (let axis = 0; axis < 2; axis++) {
    const start = a[i + axis], delta = a[i + axis + 2] - start
    if (!delta) { if (start < r[axis] || start > r[axis + 2]) return null }
    else {
      const t0 = (r[axis] - start) / delta, t1 = (r[axis + 2] - start) / delta
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1))
      if (lo > hi) return null
    }
  }
  return [a[i] + (a[i + 2] - a[i]) * lo, a[i + 1] + (a[i + 3] - a[i + 1]) * lo,
    a[i] + (a[i + 2] - a[i]) * hi, a[i + 1] + (a[i + 3] - a[i + 1]) * hi]
}
const lineBounds = (a: ArrayLike<number>, i: number, t: number): Rect =>
  [Math.min(a[i], a[i + 2]) - t, Math.min(a[i + 1], a[i + 3]) - t, Math.max(a[i], a[i + 2]) + t, Math.max(a[i + 1], a[i + 3]) + t]

/** Cleanup is demand-only in the matching Worker. Dense/oversize templates fall
 * back intact, with bounded grid visits and neighbor comparisons. */
export function prepareVectorTemplate(pageSegments: Float32Array, pageWidths: Float32Array, sampleRect: Rect): PreparedTemplate {
  if (pageSegments.length % 4 || pageWidths.length !== pageSegments.length / 4 || !pageSegments.every(Number.isFinite)
    || !pageWidths.every(v => Number.isFinite(v) && v >= 0)) throw Error('Invalid vector segments or widths')
  if (!sampleRect.every(Number.isFinite) || sampleRect[2] <= sampleRect[0] || sampleRect[3] <= sampleRect[1]) throw Error('Invalid template rectangle')
  const tol = defaultVectorTolerance(sampleRect), ids: number[] = []
  for (let i = 0; i < pageSegments.length; i += 4) {
    if (contains(sampleRect, pageSegments[i], pageSegments[i + 1], tol) && contains(sampleRect, pageSegments[i + 2], pageSegments[i + 3], tol)
      && Math.hypot(pageSegments[i + 2] - pageSegments[i], pageSegments[i + 3] - pageSegments[i + 1]) > 0) ids.push(i)
  }
  const original = new Float32Array(ids.flatMap(i => Array.from(pageSegments.subarray(i, i + 4))))
  const originalWidths = new Float32Array(ids.map(i => pageWidths[i / 4]))
  const lengths = ids.map(i => Math.hypot(pageSegments[i + 2] - pageSegments[i], pageSegments[i + 3] - pageSegments[i + 1]))
  const totalLength = lengths.reduce((a, b) => a + b, 0)
  const finish = (kept: number[], wiring = 0, other = 0): PreparedTemplate => {
    const segments = new Float32Array(kept.flatMap(i => Array.from(original.subarray(i, i + 4))))
    const widths = new Float32Array(kept.map(i => originalWidths[i / 4]))
    const bounds: Rect = [Infinity, Infinity, -Infinity, -Infinity]
    for (let i = 0; i < segments.length; i += 2) {
      bounds[0] = Math.min(bounds[0], segments[i]); bounds[1] = Math.min(bounds[1], segments[i + 1])
      bounds[2] = Math.max(bounds[2], segments[i]); bounds[3] = Math.max(bounds[3], segments[i + 1])
    }
    if (!segments.length) bounds.splice(0, 4, ...sampleRect)
    return { segments, widths, bounds, tolerance: defaultVectorTolerance(bounds), removed: { wiring, other }, total: ids.length, cleaned: wiring + other > 0 }
  }
  const all = ids.map((_, i) => i * 4), fallback = () => finish(all)
  if (ids.length < 2 || ids.length > 4096) return fallback()
  const size = Math.max(2, tol * 2), grid = spatialIndex(original, size)
  let budget = 250_000
  const neighbors = (r: Rect) => {
    const cells = (Math.floor(r[2] / size) - Math.floor(r[0] / size) + 1) * (Math.floor(r[3] / size) - Math.floor(r[1] / size) + 1)
    budget -= cells
    if (budget < 0) throw Error('cleanup budget')
    const result = gridLines(grid, size, r)
    budget -= result.size
    if (budget < 0) throw Error('cleanup budget')
    return result
  }
  const collinear = (a: Float32Array, i: number, j: number) => {
    const dx = a[i + 2] - a[i], dy = a[i + 3] - a[i + 1], length = Math.hypot(dx, dy)
    const ex = original[j + 2] - original[j], ey = original[j + 3] - original[j + 1], other = Math.hypot(ex, ey)
    return length > 0 && other > 0 && Math.abs(dx * ey - dy * ex) / (length * other) < .06
      && Math.abs(dx * (original[j + 1] - a[i + 1]) - dy * (original[j] - a[i])) / length < tol
      && Math.abs(dx * (original[j + 3] - a[i + 1]) - dy * (original[j + 2] - a[i])) / length < tol
      && segmentDistance(a, i, original, j) <= 2
  }
  try {
    const wiring = new Set<number>(), queue: number[] = []
    const expanded: Rect = [sampleRect[0] - tol, sampleRect[1] - tol, sampleRect[2] + tol, sampleRect[3] + tol]
    for (let i = 0; i < pageSegments.length; i += 4) {
      if (contains(sampleRect, pageSegments[i], pageSegments[i + 1], tol) && contains(sampleRect, pageSegments[i + 2], pageSegments[i + 3], tol)) continue
      const clipped = clippedLine(pageSegments, i, expanded)
      if (!clipped) continue
      for (const j of neighbors(lineBounds(clipped, 0, 2))) if (!wiring.has(j) && collinear(pageSegments, i, j)) { wiring.add(j); queue.push(j) }
    }
    for (let at = 0; at < queue.length; at++) {
      const i = queue[at]
      for (const j of neighbors(lineBounds(original, i, 2))) if (!wiring.has(j) && collinear(original, i, j)) { wiring.add(j); queue.push(j) }
    }
    const seen = new Set(wiring), groups: Array<{ ids: number[]; length: number }> = []
    for (const start of all) {
      if (seen.has(start)) continue
      const group = { ids: [start], length: 0 }; seen.add(start)
      for (let at = 0; at < group.ids.length; at++) {
        const i = group.ids[at]; group.length += lengths[i / 4]
        for (const j of neighbors(lineBounds(original, i, tol))) {
          if (seen.has(j)) continue
          const a = originalWidths[i / 4], b = originalWidths[j / 4]
          if ((!a || !b || Math.abs(a - b) <= Math.max(a, b) * .1) && segmentDistance(original, i, original, j) <= tol) {
            seen.add(j); group.ids.push(j)
          }
        }
      }
      groups.push(group)
    }
    const largest = Math.max(0, ...groups.map(g => g.length)), kept = groups.filter(g => g.length >= largest * .25).flatMap(g => g.ids).sort((a, b) => a - b)
    if (kept.length < 2 || kept.reduce((sum, i) => sum + lengths[i / 4], 0) < totalLength * .4) return fallback()
    return finish(kept, wiring.size, ids.length - wiring.size - kept.length)
  } catch { return fallback() }
}

/** Sparse spatial grid, with compact CSR offsets/ids. Visit crossed cells rather
 * than every cell in a diagonal's bounding box (long CAD lines stay inexpensive). */
function spatialIndex(segments: Float32Array, size: number) {
  const cells = new Map<string, number>(), counts: number[] = []
  const visit = (i: number, fn: (key: string) => void) => {
    const x0 = segments[i] / size, y0 = segments[i + 1] / size
    const x1 = segments[i + 2] / size, y1 = segments[i + 3] / size
    let x = Math.floor(x0), y = Math.floor(y0)
    const ex = Math.floor(x1), ey = Math.floor(y1), dx = x1 - x0, dy = y1 - y0
    const sx = Math.sign(dx), sy = Math.sign(dy)
    let tx = dx ? (x + (sx > 0 ? 1 : 0) - x0) / dx : Infinity
    let ty = dy ? (y + (sy > 0 ? 1 : 0) - y0) / dy : Infinity
    fn(`${x},${y}`)
    while (x !== ex || y !== ey) {
      // Do not step beyond an endpoint cell when the endpoint lies exactly on
      // a grid edge; negative directions otherwise overshoot at t=1.
      if (y === ey || (x !== ex && tx < ty)) { x += sx; tx += 1 / Math.abs(dx) }
      else if (x === ex || ty < tx) { y += sy; ty += 1 / Math.abs(dy) }
      else { x += sx; y += sy; tx += 1 / Math.abs(dx); ty += 1 / Math.abs(dy) }
      fn(`${x},${y}`)
    }
  }
  for (let i = 0; i + 3 < segments.length; i += 4) visit(i, key => {
    let c = cells.get(key)
    if (c === undefined) { c = counts.length; cells.set(key, c); counts.push(0) }
    counts[c]++
  })
  const offsets = new Uint32Array(counts.length + 1)
  for (let i = 0; i < counts.length; i++) offsets[i + 1] = offsets[i] + counts[i]
  const ids = new Uint32Array(offsets[counts.length]), cursors = offsets.slice(0, -1)
  for (let i = 0; i + 3 < segments.length; i += 4) visit(i, key => { const c = cells.get(key)!; ids[cursors[c]++] = i })
  return { cells, offsets, ids }
}

function gridLines(grid: ReturnType<typeof spatialIndex>, size: number, r: Rect): Set<number> {
  const result = new Set<number>()
  const x0 = Math.floor(r[0] / size), x1 = Math.floor(r[2] / size), y0 = Math.floor(r[1] / size), y1 = Math.floor(r[3] / size)
  const add = (c: number) => { for (let k = grid.offsets[c]; k < grid.offsets[c + 1]; k++) result.add(grid.ids[k]) }
  // Very large bounds should cost occupied cells rather than empty page area.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > grid.cells.size) {
    for (const [key, c] of grid.cells) {
      const [x, y] = key.split(',').map(Number)
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) add(c)
    }
  } else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = grid.cells.get(`${x},${y}`)
    if (c !== undefined) add(c)
  }
  return result
}

export function vectorSymbolSearch(segments: Float32Array, sampleRect: Rect, options: Partial<VectorSymbolOptions> = {},
  sampleSegments: Float32Array = segments, sampleWidths: Float32Array = new Float32Array(sampleSegments.length / 4)) {
  const started = performance.now(), width = sampleRect[2] - sampleRect[0], height = sampleRect[3] - sampleRect[1]
  const initialTolerance = options.tolerance ?? defaultVectorTolerance(sampleRect)
  const threshold = options.threshold ?? .85, maxResults = options.maxResults ?? 2000
  if (!sampleRect.every(Number.isFinite) || Math.min(width, height) <= 0 || !Number.isFinite(initialTolerance) || initialTolerance <= 0
    || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isInteger(maxResults) || maxResults < 0
    || (options.region && (!options.region.every(Number.isFinite) || options.region[2] < options.region[0] || options.region[3] < options.region[1]))) throw Error('Invalid vector search options')
  if (segments.length % 4 || sampleSegments.length % 4 || !segments.every(Number.isFinite) || !sampleSegments.every(Number.isFinite)) throw Error('Invalid vector segments')
  const templateStarted = prepareVectorTemplate(sampleSegments, sampleWidths, sampleRect)
  sampleSegments = templateStarted.segments
  const bounds = templateStarted.bounds, tolerance = options.tolerance ?? templateStarted.tolerance
  const short = Math.max(.3, Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]))
  const templateIds: number[] = [], lengths = new Map<number, number[]>()
  let anchor = -1, longest = 0, totalLength = 0
  for (let i = 0; i < segments.length; i += 4) {
    const length = Math.hypot(segments[i + 2] - segments[i], segments[i + 3] - segments[i + 1])
    const key = Math.floor(length / tolerance), bucket = lengths.get(key)
    if (bucket) bucket.push(i); else lengths.set(key, [i])
  }
  for (let i = 0; i < sampleSegments.length; i += 4) {
    const length = Math.hypot(sampleSegments[i + 2] - sampleSegments[i], sampleSegments[i + 3] - sampleSegments[i + 1])
    if (length > 0) {
      templateIds.push(i); totalLength += length
      if (length > longest) { longest = length; anchor = i }
    }
  }
  if (templateIds.length < 2) throw Error('見本の範囲に線がありません')
  const template = { segments: templateIds.length, length: totalLength, removed: templateStarted.removed,
    total: templateStarted.total, cleaned: templateStarted.cleaned, rect: bounds }
  if (!maxResults || options.shouldStop?.()) return { matches: [] as VectorSymbolMatch[], template, stats: { anchorsTried: 0, ms: performance.now() - started } }
  const size = Math.min(16, Math.max(8, short)), grid = spatialIndex(segments, size), radius = Math.ceil(tolerance / size)
  const hits = (px: number, py: number) => {
    const cx = Math.floor(px / size), cy = Math.floor(py / size)
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      const c = grid.cells.get(`${x},${y}`)
      if (c === undefined) continue
      for (let k = grid.offsets[c]; k < grid.offsets[c + 1]; k++) {
        const i = grid.ids[k], ax = segments[i], ay = segments[i + 1], dx = segments[i + 2] - ax, dy = segments[i + 3] - ay
        const d = dx * dx + dy * dy, t = d ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / d)) : 0
        if ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= tolerance * tolerance) return true
      }
    }
    return false
  }
  // Sampling weights sum to each line's length, independent of its subdivision.
  const samples: Array<[number, number, number]> = []
  for (const i of templateIds) {
    const dx = sampleSegments[i + 2] - sampleSegments[i], dy = sampleSegments[i + 3] - sampleSegments[i + 1], length = Math.hypot(dx, dy)
    const n = Math.max(3, Math.ceil(length / 2) + 1)
    for (let j = 0; j < n; j++) samples.push([sampleSegments[i] + dx * j / (n - 1) - sampleSegments[anchor], sampleSegments[i + 1] + dy * j / (n - 1) - sampleSegments[anchor + 1], length / n])
  }
  const baseAngle = Math.atan2(sampleSegments[anchor + 3] - sampleSegments[anchor + 1], sampleSegments[anchor + 2] - sampleSegments[anchor])
  const corners: Point[] = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
  const candidates: VectorSymbolMatch[] = []
  const transforms = new Map<VectorSymbolMatch, [number, number, number, number]>()
  let anchorsTried = 0, stopped = false
  for (let bucket = Math.floor(Math.max(0, longest - tolerance) / tolerance); bucket <= Math.floor((longest + tolerance) / tolerance) && !stopped; bucket++) {
    for (const i of lengths.get(bucket) ?? []) {
      const dx = segments[i + 2] - segments[i], dy = segments[i + 3] - segments[i + 1]
      if (Math.abs(Math.hypot(dx, dy) - longest) > tolerance) continue
      const candidateAngle = Math.atan2(dy, dx)
      if (!options.rotations && Math.abs(Math.sin(candidateAngle - baseAngle)) > Math.sin(2 * Math.PI / 180)) continue
      if (anchorsTried % 500 === 0 && options.shouldStop?.()) { stopped = true; break }
      anchorsTried++
      for (let direction = 0; direction < 2; direction++) {
        const angle = candidateAngle - baseAngle + direction * Math.PI, cos = Math.cos(angle), sin = Math.sin(angle)
        const ox = segments[i + direction * 2], oy = segments[i + direction * 2 + 1]
        const transform = (x: number, y: number): Point => [ox + cos * x - sin * y, oy + sin * x + cos * y]
        const transformed = corners.map(p => transform(p[0] - sampleSegments[anchor], p[1] - sampleSegments[anchor + 1]))
        const rect: Rect = [Math.min(...transformed.map(p => p[0])), Math.min(...transformed.map(p => p[1])), Math.max(...transformed.map(p => p[0])), Math.max(...transformed.map(p => p[1]))]
        const region = options.region
        if (region && (rect[0] < region[0] - 1e-6 || rect[1] < region[1] - 1e-6 || rect[2] > region[2] + 1e-6 || rect[3] > region[3] + 1e-6)) continue
        let covered = 0, remaining = totalLength
        for (const [x, y, weight] of samples) {
          const [px, py] = transform(x, y)
          remaining -= weight
          if (hits(px, py)) covered += weight
          if ((covered + remaining) / totalLength < threshold - 1e-10) break
        }
        const score = Math.min(1, covered / totalLength)
        if (score >= threshold - 1e-10) {
          const match = { rect, center: [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2] as Point,
            score, angle: ((angle * 180 / Math.PI % 360) + 360) % 360, extra: 0 }
          candidates.push(match); transforms.set(match, [ox, oy, cos, sin])
        }
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const matches: VectorSymbolMatch[] = [], suppressed = new Map<string, Point[]>()
  const distance = short / 2
  for (const match of candidates) {
    const [x, y] = match.center, cx = Math.floor(x / distance), cy = Math.floor(y / distance)
    let overlap = false
    for (let dy = -1; dy <= 1 && !overlap; dy++) for (let dx = -1; dx <= 1 && !overlap; dx++) {
      overlap = (suppressed.get(`${cx + dx},${cy + dy}`) ?? []).some(p => Math.hypot(p[0] - x, p[1] - y) < distance)
    }
    if (overlap) continue
    matches.push(match)
    const key = `${cx},${cy}`, group = suppressed.get(key)
    if (group) group.push(match.center); else suppressed.set(key, [match.center])
    if (matches.length >= maxResults) break
  }
  const reverseTolerance = Math.max(.2, tolerance * .45), reverseSize = Math.max(1, reverseTolerance * 2)
  const templateGrid = matches.length ? spatialIndex(sampleSegments, reverseSize) : null
  for (const match of matches) {
    const [ox, oy, cos, sin] = transforms.get(match)!
    const inverse = (x: number, y: number): Point => [sampleSegments[anchor] + cos * (x - ox) + sin * (y - oy),
      sampleSegments[anchor + 1] - sin * (x - ox) + cos * (y - oy)]
    const r = match.rect, margin = tolerance * (Math.abs(cos) + Math.abs(sin))
    const expanded: Rect = [r[0] - margin, r[1] - margin, r[2] + margin, r[3] + margin]
    let total = 0, uncovered = 0
    for (const i of gridLines(grid, size, expanded)) {
      const a = inverse(segments[i], segments[i + 1]), b = inverse(segments[i + 2], segments[i + 3])
      if (!contains(bounds, a[0], a[1], tolerance) || !contains(bounds, b[0], b[1], tolerance)) continue
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(length / .5))
      if (!length) continue
      total += length
      for (let j = 0; j < n; j++) {
        const x = a[0] + dx * (j + .5) / n, y = a[1] + dy * (j + .5) / n
        const cx = Math.floor(x / reverseSize), cy = Math.floor(y / reverseSize)
        let hit = false
        for (let gy = cy - 1; gy <= cy + 1 && !hit; gy++) for (let gx = cx - 1; gx <= cx + 1 && !hit; gx++) {
          const cell = templateGrid!.cells.get(`${gx},${gy}`)
          if (cell === undefined) continue
          for (let k = templateGrid!.offsets[cell]; k < templateGrid!.offsets[cell + 1]; k++) {
            if (pointDistance(x, y, sampleSegments, templateGrid!.ids[k]) <= reverseTolerance) { hit = true; break }
          }
        }
        if (!hit) uncovered += length / n
      }
    }
    match.extra = total ? Math.min(1, uncovered / total) : 0
  }
  return { matches, template, stats: { anchorsTried, ms: performance.now() - started } }
}
