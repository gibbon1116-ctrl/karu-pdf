import type { Point, Rect } from './annotations'
import { CellMap, spatialIndex, gridLines, mergeCollinearStrokes, detectTemplateRings, voteRingCenters } from './vectorStrokes'
import type { VectorPaint } from './vectorPaint'
import { createPaintMatcher, paintTemplateGeometry } from './vectorAppearance'

export interface VectorSymbolOptions {
  threshold: number
  rotations: boolean
  tolerance?: number
  maxResults: number
  region?: Rect
  shouldStop?: () => boolean
  scaleRange?: number
  exhaustiveAnchors?: boolean
  exhaustiveWhenEmpty?: boolean
}
/** Geometry scores in displayed pt coordinates. extra/around describe line length,
 * not a fill/hatch class; the client adds image/label confidence afterwards. */
export interface VectorSymbolMatch { rect: Rect; center: Point; score: number; angle: number; extra: number; around: number
  structureScore?: number; fillScore?: number; structureCheck?: boolean
  scale?: number; source?: 'primary' | 'secondary' | 'ring' | 'exhaustive'; rejectReason?: 'structure' }

export interface PreparedTemplate {
  segments: Float32Array; widths: Float32Array; bounds: Rect; tolerance: number
  strokeWidth: number; removed: { wiring: number; other: number; thin: number }; total: number; cleaned: boolean
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

/** Non-bridge line offsets in the existing endpoint graph. */
function cycleLineSet(nodes: number[], edges: number[][]): Set<number> {
  const count = nodes.length
  // Iterative bridge detection avoids recursion depth failures on large templates.
  const discovery = new Int32Array(count), low = new Int32Array(count), bridges = new Set<number>()
  let clock = 0
  for (let start = 0; start < count; start++) {
    if (!edges[start].length || discovery[start]) continue
    discovery[start] = low[start] = ++clock
    const stack = [{ node: start, via: -1, from: -1, next: 0 }]
    while (stack.length) {
      const frame = stack[stack.length - 1], node = frame.node
      if (frame.next === edges[node].length) {
        stack.pop()
        if (frame.from >= 0) {
          low[frame.from] = Math.min(low[frame.from], low[node])
          if (low[node] > discovery[frame.from]) bridges.add(frame.via)
        }
        continue
      }
      const line = edges[node][frame.next++]
      if (line === frame.via) continue
      const a = nodes[line / 2], b = nodes[line / 2 + 1], next = a === node ? b : a
      if (discovery[next]) low[node] = Math.min(low[node], discovery[next])
      else {
        discovery[next] = low[next] = ++clock
        stack.push({ node: next, via: line, from: node, next: 0 })
      }
    }
  }
  const protectedLines = new Set<number>()
  for (let i = 0; i < nodes.length * 2; i += 4) if (!bridges.has(i)) protectedLines.add(i)
  return protectedLines
}

/** Endpoint graph for bent wiring. Contacts in the middle of a line are stops, not graph edges.
 * Non-bridge edges belong to closed rings and are protected even at junctions. */
function boundaryWiring(lines: Float32Array, widths: Float32Array, rect: Rect, tol: number, seeds: Set<number>, neighbors: (r: Rect) => Set<number>) {
  const count = lines.length / 2, parent = Array.from({ length: count }, (_, i) => i)
  const middle = new Uint8Array(count)
  const root = (e: number): number => {
    while (parent[e] !== e) { parent[e] = parent[parent[e]]; e = parent[e] }
    return e
  }
  for (let e = 0; e < count; e++) {
    const x = lines[e * 2], y = lines[e * 2 + 1], own = Math.floor(e / 2) * 4
    if (Math.min(Math.abs(x - rect[0]), Math.abs(x - rect[2]), Math.abs(y - rect[1]), Math.abs(y - rect[3])) <= tol) seeds.add(e)
    for (const j of neighbors([x - tol, y - tol, x + tol, y + tol])) {
      if (j === own) continue
      let endpoint = false
      for (let end = 0; end < 2; end++) if (Math.hypot(x - lines[j + end * 2], y - lines[j + end * 2 + 1]) <= tol) {
        parent[root(e)] = root(j / 2 + end); endpoint = true
      }
      if (!endpoint && pointDistance(x, y, lines, j) <= tol) middle[e] = 1
    }
  }
  const nodes = parent.map((_, e) => root(e)), edges: number[][] = Array.from({ length: count }, () => [])
  const stops = new Uint8Array(count)
  for (let e = 0; e < count; e++) { edges[nodes[e]].push(Math.floor(e / 2) * 4); stops[nodes[e]] |= middle[e] }
  const protectedLines = cycleLineSet(nodes, edges), wiring = new Set<number>()
  const trace = (e: number, requireRing: boolean) => {
    let node = nodes[e], line = Math.floor(e / 2) * 4
    // Starting at an interior contact or junction must not eat a symbol stroke.
    if (stops[node] || edges[node].length >= 3 || wiring.has(line)) return
    const path = new Set<number>()
    let ring = false
    while (!protectedLines.has(line) && !path.has(line)) {
      path.add(line)
      const a = nodes[line / 2], b = nodes[line / 2 + 1]
      const end = a === node ? line + 2 : line
      node = a === node ? b : a
      if (stops[node] || edges[node].length !== 2) {
        const ringStroke = (i: number) => protectedLines.has(i) && (!requireRing ||
          (widths[i / 4] > 0 && widths[line / 4] > 0 && Math.abs(widths[i / 4] - widths[line / 4]) <= Math.max(widths[i / 4], widths[line / 4]) * .1))
        ring = edges[node].some(ringStroke)
        if (!ring && stops[node]) {
          const x = lines[end], y = lines[end + 1]
          ring = [...neighbors([x - tol, y - tol, x + tol, y + tol])]
            .some(i => ringStroke(i) && pointDistance(x, y, lines, i) <= tol)
        }
        break
      }
      line = edges[node].find(i => i !== line)!
    }
    if (!requireRing || (ring && [...path].every(i => widths[i / 4] > 0 && Math.abs(widths[i / 4] - widths[line / 4]) <= Math.max(widths[i / 4], widths[line / 4]) * .1))) {
      for (const i of path) wiring.add(i)
    }
  }
  for (const e of seeds) trace(e, false)
  // Real page 71 also has a wire ending freely inside the sample. Extend the
  // seed rule only for pendant paths that actually terminate at a closed ring.
  for (let e = 0; e < count; e++) {
    if (!seeds.has(e) && edges[nodes[e]].length === 1 && !stops[nodes[e]]) trace(e, true)
  }
  return { wiring, protectedLines }
}

function templateLineOffsets(pageSegments: Float32Array, pageWidths: Float32Array, sampleRect: Rect): number[] {
  if (pageSegments.length % 4 || pageWidths.length !== pageSegments.length / 4 || !pageSegments.every(Number.isFinite)
    || !pageWidths.every(v => Number.isFinite(v) && v >= 0)) throw Error('Invalid vector segments or widths')
  if (!sampleRect.every(Number.isFinite) || sampleRect[2] <= sampleRect[0] || sampleRect[3] <= sampleRect[1]) throw Error('Invalid template rectangle')
  const tol = defaultVectorTolerance(sampleRect)
  const ids: number[] = []
  for (let i = 0; i < pageSegments.length; i += 4) {
    if (contains(sampleRect, pageSegments[i], pageSegments[i + 1], tol) && contains(sampleRect, pageSegments[i + 2], pageSegments[i + 3], tol)
      && Math.hypot(pageSegments[i + 2] - pageSegments[i], pageSegments[i + 3] - pageSegments[i + 1]) > 0) ids.push(i)
  }
  return ids
}

/** Cleanup is demand-only in the matching Worker. Dense/oversize templates fall
 * back intact, with bounded grid visits and neighbor comparisons. */
export function prepareVectorTemplate(pageSegments: Float32Array, pageWidths: Float32Array, sampleRect: Rect): PreparedTemplate {
  return prepareTemplateWithCandidates(pageSegments, pageWidths, sampleRect)
}

function prepareTemplateWithCandidates(pageSegments: Float32Array, pageWidths: Float32Array, sampleRect: Rect,
  candidateLines?: { ids: number[]; kept: Set<number> }): PreparedTemplate {
  const tol = defaultVectorTolerance(sampleRect)
  let ids = templateLineOffsets(pageSegments, pageWidths, sampleRect)
  if (candidateLines) candidateLines.ids = ids.map(i => i / 4)
  const total = ids.length, buckets = new Map<number, number>()
  for (const i of ids) if (pageWidths[i / 4] > 0) {
    const w = Math.round(pageWidths[i / 4] * 100) / 100
    if (w > 0) buckets.set(w, (buckets.get(w) ?? 0) + Math.hypot(pageSegments[i + 2] - pageSegments[i], pageSegments[i + 3] - pageSegments[i + 1]))
  }
  let strokeWidth = [...buckets].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
  const filtered = ids.filter(i => acceptsWidth(pageWidths[i / 4], strokeWidth))
  const thin = strokeWidth > 0 && filtered.length >= 2 ? ids.length - filtered.length : 0
  if (strokeWidth > 0 && filtered.length >= 2) ids = filtered
  else strokeWidth = 0
  const original = new Float32Array(ids.flatMap(i => Array.from(pageSegments.subarray(i, i + 4))))
  const originalWidths = new Float32Array(ids.map(i => pageWidths[i / 4]))
  const lengths = ids.map(i => Math.hypot(pageSegments[i + 2] - pageSegments[i], pageSegments[i + 3] - pageSegments[i + 1]))
  const totalLength = lengths.reduce((a, b) => a + b, 0)
  const finish = (kept: number[], wiring = 0, other = 0): PreparedTemplate => {
    if (candidateLines) {
      candidateLines.kept.clear()
      for (const i of kept) candidateLines.kept.add(ids[i / 4] / 4)
    }
    const segments = new Float32Array(kept.flatMap(i => Array.from(original.subarray(i, i + 4))))
    const widths = new Float32Array(kept.map(i => originalWidths[i / 4]))
    const bounds: Rect = [Infinity, Infinity, -Infinity, -Infinity]
    for (let i = 0; i < segments.length; i += 2) {
      bounds[0] = Math.min(bounds[0], segments[i]); bounds[1] = Math.min(bounds[1], segments[i + 1])
      bounds[2] = Math.max(bounds[2], segments[i]); bounds[3] = Math.max(bounds[3], segments[i + 1])
    }
    if (!segments.length) bounds.splice(0, 4, ...sampleRect)
    const weighted = kept.filter(i => originalWidths[i / 4] > 0).map(i => ({ width: originalWidths[i / 4], length: lengths[i / 4] })).sort((a, b) => a.width - b.width)
    let sum = 0
    const half = weighted.reduce((n, v) => n + v.length, 0) / 2
    const median = weighted.find(v => (sum += v.length) >= half)?.width ?? 0
    return { segments, widths, bounds, strokeWidth: strokeWidth ? median : 0,
      tolerance: defaultVectorTolerance(bounds), removed: { wiring, other, thin }, total, cleaned: wiring + other + thin > 0 }
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
    const wiring = new Set<number>(), queue: number[] = [], seeds = new Set<number>()
    const expanded: Rect = [sampleRect[0] - tol, sampleRect[1] - tol, sampleRect[2] + tol, sampleRect[3] + tol]
    for (let i = 0; i < pageSegments.length; i += 4) {
      if (!acceptsWidth(pageWidths[i / 4], strokeWidth)) continue
      if (contains(sampleRect, pageSegments[i], pageSegments[i + 1], tol) && contains(sampleRect, pageSegments[i + 2], pageSegments[i + 3], tol)) continue
      const clipped = clippedLine(pageSegments, i, expanded)
      if (!clipped) continue
      for (const j of neighbors(lineBounds(clipped, 0, 2))) if (!wiring.has(j) && collinear(pageSegments, i, j)) { wiring.add(j); queue.push(j) }
      for (const j of neighbors(lineBounds(clipped, 0, tol))) for (let e = 0; e < 2; e++) {
        if (pointDistance(original[j + e * 2], original[j + e * 2 + 1], pageSegments, i) <= tol) seeds.add(j / 2 + e)
      }
    }
    const paths = boundaryWiring(original, originalWidths, sampleRect, tol, seeds, neighbors)
    const insideCycle = (x: number, y: number) => {
      let left = false, right = false
      // Query only cycle edges near this horizontal ray, including the distance
      // guard band. Avoid comparing every template line against every cycle edge.
      for (const i of neighbors([sampleRect[0] - tol, y - tol, sampleRect[2] + tol, y + tol])) {
        if (!paths.protectedLines.has(i)) continue
        if (pointDistance(x, y, original, i) <= tol) return false
        const ax = original[i], ay = original[i + 1], bx = original[i + 2], by = original[i + 3]
        if ((ay > y) !== (by > y)) {
          const crossing = ax + (bx - ax) * (y - ay) / (by - ay)
          if (crossing > x) right = !right
          if (crossing < x) left = !left
        }
      }
      return left && right
    }
    const interior = new Set<number>()
    for (const i of all) if (!paths.protectedLines.has(i)
      && insideCycle(original[i], original[i + 1]) && insideCycle(original[i + 2], original[i + 3])
      && insideCycle((original[i] + original[i + 2]) / 2, (original[i + 1] + original[i + 3]) / 2)) interior.add(i)
    for (const i of interior) { wiring.delete(i); paths.wiring.delete(i) }
    for (let at = 0; at < queue.length; at++) {
      const i = queue[at]
      if (interior.has(i)) continue
      for (const j of neighbors(lineBounds(original, i, 2))) if (!wiring.has(j) && !interior.has(j) && collinear(original, i, j)) { wiring.add(j); queue.push(j) }
    }
    for (const i of paths.protectedLines) wiring.delete(i)
    const combined = new Set([...wiring, ...paths.wiring]), remaining = all.filter(i => !combined.has(i))
    if (remaining.length >= 2 && remaining.reduce((sum, i) => sum + lengths[i / 4], 0) >= totalLength * .4) {
      for (const i of paths.wiring) wiring.add(i)
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
    // A short, disconnected mark inside a simple closed contour is symbol content.
    // Require a degree-two ring: a bounding box alone would also retain nearby text.
    const rings = groups.filter(group => {
      if(group.ids.length<3)return false
      const degree=new CellMap<number>(),cell=Math.max(.01,tol/4)
      for(const i of group.ids)for(const e of [0,2]){
        const x=Math.round(original[i+e]/cell),y=Math.round(original[i+e+1]/cell)
        degree.setCell(x,y,(degree.getCell(x,y)??0)+1)
      }
      return [...degree.values(),...degree.overflow.values()].every(count=>count===2)
    })
    const insideRing=(x:number,y:number,ring:typeof groups[number])=>{
      budget-=ring.ids.length
      if(budget<0)throw Error('cleanup budget')
      let inside=false
      for(const i of ring.ids){
        const ax=original[i],ay=original[i+1],bx=original[i+2],by=original[i+3]
        if(pointDistance(x,y,original,i)<=tol)return false
        if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside
      }
      return inside
    }
    const enclosed=(group:typeof groups[number])=>rings.some(ring=>ring!==group&&ring.length>group.length
      &&group.ids.every(i=>insideRing(original[i],original[i+1],ring)&&insideRing(original[i+2],original[i+3],ring)))
    const largest = Math.max(0, ...groups.map(g => g.length)), kept = groups.filter(g => g.length >= largest * .25 || enclosed(g)).flatMap(g => g.ids).sort((a, b) => a - b)
    if (kept.length < 2 || kept.reduce((sum, i) => sum + lengths[i / 4], 0) < totalLength * .4) return fallback()
    return finish(kept, wiring.size, ids.length - wiring.size - kept.length)
  } catch { return fallback() }
}

/** Page line IDs before width filtering, and the IDs retained by automatic cleanup. */
export function templateCandidateLines(pageSegments: Float32Array, pageWidths: Float32Array, sampleRect: Rect): {
  ids: number[]; kept: Set<number>
} {
  const result = { ids: [] as number[], kept: new Set<number>() }
  prepareTemplateWithCandidates(pageSegments, pageWidths, sampleRect, result)
  return result
}

/** Uses the selected page-coordinate lines without automatic cleanup. */
export function manualVectorTemplate(segments: Float32Array, widths: Float32Array, sampleRect: Rect, total: number): PreparedTemplate {
  const count = segments.length / 4
  if (segments.length % 4 || count < 2 || widths.length !== count
    || !segments.every(Number.isFinite) || !widths.every(v => Number.isFinite(v) && v >= 0)) {
    throw Error('Invalid manual vector segments or widths')
  }
  if (!sampleRect.every(Number.isFinite) || sampleRect[2] <= sampleRect[0] || sampleRect[3] <= sampleRect[1]) {
    throw Error('Invalid template rectangle')
  }
  if (!Number.isSafeInteger(total) || total < count) throw Error('Invalid manual vector total')
  const bounds: Rect = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < segments.length; i += 2) {
    bounds[0] = Math.min(bounds[0], segments[i]); bounds[1] = Math.min(bounds[1], segments[i + 1])
    bounds[2] = Math.max(bounds[2], segments[i]); bounds[3] = Math.max(bounds[3], segments[i + 1])
  }
  const weighted = Array.from(widths, (width, i) => ({
    width, length: Math.hypot(segments[i * 4 + 2] - segments[i * 4], segments[i * 4 + 3] - segments[i * 4 + 1]),
  })).filter(v => v.width > 0).sort((a, b) => a.width - b.width)
  const half = weighted.reduce((n, v) => n + v.length, 0) / 2
  let sum = 0
  const strokeWidth = weighted.find(v => (sum += v.length) >= half)?.width ?? 0
  return {
    segments, widths, bounds, strokeWidth, tolerance: defaultVectorTolerance(bounds),
    removed: { wiring: 0, other: total - count, thin: 0 }, total, cleaned: total > count,
  }
}

/** Sparse spatial grid, with compact CSR offsets/ids. Visit crossed cells rather
 * than every cell in a diagonal's bounding box (long CAD lines stay inexpensive). */
// Float32 storage must not exclude exact .5W/2W boundary widths by rounding.
const acceptsWidth = (width: number, w: number) => !w || !width || (width >= .5 * w - 1e-6 && width <= 2 * w + 1e-6)
function widthFiltered(segments: Float32Array, widths: Float32Array | undefined, w: number, strokeOnly = false): Float32Array {
  if (!w || !widths) return segments
  const kept: number[] = []
  for (let i = 0; i < segments.length; i += 4) if (acceptsWidth(widths[i / 4], w) && (!strokeOnly || widths[i / 4] > 0)) kept.push(i)
  const result = new Float32Array(kept.length * 4)
  kept.forEach((i, at) => result.set(segments.subarray(i, i + 4), at * 4))
  return result
}
/** Borrows target/sample geometry and aligned widths without modifying them.
 * Template cleanup and width filtering are search-local; snap keeps the extracted arrays. */
export function vectorSymbolSearch(segments: Float32Array, sampleRect: Rect, options: Partial<VectorSymbolOptions> = {},
  sampleSegments: Float32Array = segments, sampleWidths: Float32Array = new Float32Array(sampleSegments.length / 4), segmentWidths?: Float32Array,
  paint?: {sample:VectorPaint;target:VectorPaint}, manual?: { segments: Float32Array; widths: Float32Array }) {
  const started = performance.now(), width = sampleRect[2] - sampleRect[0], height = sampleRect[3] - sampleRect[1]
  const initialTolerance = options.tolerance ?? defaultVectorTolerance(sampleRect)
  const scaleRange = Math.min(.1, Math.max(0, options.scaleRange ?? .06))
  const threshold = options.threshold ?? .85, maxResults = options.maxResults ?? 2000
  if (!sampleRect.every(Number.isFinite) || Math.min(width, height) <= 0 || !Number.isFinite(initialTolerance) || initialTolerance <= 0
    || !Number.isFinite(options.scaleRange ?? 0)
    || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isInteger(maxResults) || maxResults < 0
    || (options.region && (!options.region.every(Number.isFinite) || options.region[2] < options.region[0] || options.region[3] < options.region[1]))) throw Error('Invalid vector search options')
  if (segments.length % 4 || sampleSegments.length % 4 || !segments.every(Number.isFinite) || !sampleSegments.every(Number.isFinite)) throw Error('Invalid vector segments')
  if (segmentWidths && (segmentWidths.length !== segments.length / 4 || !segmentWidths.every(w => Number.isFinite(w) && w >= 0))) throw Error('Invalid vector widths')
  const templateStarted = manual
    ? manualVectorTemplate(manual.segments, manual.widths, sampleRect, templateLineOffsets(sampleSegments, sampleWidths, sampleRect).length)
    : prepareVectorTemplate(sampleSegments, sampleWidths, sampleRect)
  const samplePageSegments = widthFiltered(sampleSegments, sampleWidths, templateStarted.strokeWidth)
  const targetSegments = segments
  segments = widthFiltered(segments, segmentWidths, templateStarted.strokeWidth)
  const templateGeometry = paintTemplateGeometry(templateStarted.segments,templateStarted.widths,templateStarted.bounds,paint?.sample)
  sampleSegments = templateGeometry.segments
  const restrictStrokes = !!segmentWidths && templateStarted.strokeWidth > 0 && templateGeometry.widths.some(w => w > 0)
  const bounds = templateStarted.bounds, tolerance = options.tolerance ?? templateStarted.tolerance
  const comparePaint=paint?createPaintMatcher(paint.sample,paint.target,bounds,tolerance):undefined
  // Sample paint still holds lines the user erased; compare only fills then. Line
  // structure is already the erased template itself.
  const fillOnly=!!manual&&templateStarted.removed.other>0
  const short = Math.max(.3, Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]))
  const templateIds: number[] = []
  let totalLength = 0
  for (let i = 0; i < sampleSegments.length; i += 4) {
    const length = Math.hypot(sampleSegments[i + 2] - sampleSegments[i], sampleSegments[i + 3] - sampleSegments[i + 1])
    if (length > 0) {
      templateIds.push(i); totalLength += length
    }
  }
  if (templateIds.length < 2) throw Error('見本の範囲に線がありません')
  const template = { segments: templateIds.length, length: totalLength, removed: templateStarted.removed,
    total: templateStarted.total, cleaned: templateStarted.cleaned, rect: bounds, strokeWidth: templateStarted.strokeWidth, sampleAround: 0 }
  const padding = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * .4
  const bandLength = (lines: Float32Array, ids: Iterable<number>, inverse: (x: number, y: number) => Point) => {
    let length = 0
    for (const i of ids) {
      const a = inverse(lines[i], lines[i + 1]), b = inverse(lines[i + 2], lines[i + 3])
      if ([a, b].every(p => contains(bounds, p[0], p[1], padding) && !contains(bounds, p[0], p[1], tolerance))) length += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
    return Math.min(1, length / totalLength)
  }
  template.sampleAround = bandLength(samplePageSegments, (function* () { for (let i = 0; i < samplePageSegments.length; i += 4) yield i })(), (x, y) => [x, y])
  const stats = {
    anchorsTried: 0, targetSegments: targetSegments.length / 4, widthFilteredSegments: segments.length / 4,
    targetStrokes: 0, templateStrokes: 0, anchors: 0, ringAnchor: false, placements: 0, skippedPlacements: 0,
    regionExcluded: 0, geometryPassed: 0, geometrySites: 0, structureExcluded: 0, structureExcludedSites: 0,
    rotationExcluded: 0, duplicates: 0, limited: 0, final: 0, stopped: false, ringLimited: false, scaled: 0,
    ms: 0, mergeMs: 0, candidateMs: 0, verifyMs: 0,
    exhaustiveRan: false, exhaustivePlacements: 0, exhaustiveFound: 0,
    keyStrokes: 0, keyStrokeRejected: 0,
  }
  const finish = (matches: VectorSymbolMatch[], rejected: VectorSymbolMatch[]) => {
    stats.final = matches.length; stats.scaled = matches.filter(m => m.scale !== undefined).length
    stats.ms = performance.now() - started
    return { matches, rejected, template, stats }
  }
  if (!maxResults) return finish([], [])
  if (options.shouldStop?.()) { stats.stopped = true; return finish([], []) }
  const mergeStarted = performance.now(), mergedTemplate = mergeCollinearStrokes(sampleSegments, tolerance)
  stats.templateStrokes = mergedTemplate.count
  const templateStrokes = mergedTemplate.lines, anchorIds: number[] = []
  const strokeLength = (lines: Float32Array, i: number) => Math.hypot(lines[i + 2] - lines[i], lines[i + 3] - lines[i + 1])
  const ordered = Array.from({ length: mergedTemplate.count }, (_, j) => j * 4).sort((a, b) => strokeLength(templateStrokes, b) - strokeLength(templateStrokes, a) || a - b)
  const longest = strokeLength(templateStrokes, ordered[0]), sin10 = Math.sin(10 * Math.PI / 180)
  for (const i of ordered) {
    const length = strokeLength(templateStrokes, i)
    if (anchorIds.length && length < (options.exhaustiveAnchors ? 2 * tolerance : Math.max(2 * tolerance, .2 * longest))) continue
    const ux = (templateStrokes[i + 2] - templateStrokes[i]) / length, uy = (templateStrokes[i + 3] - templateStrokes[i + 1]) / length
    if (anchorIds.every(j => {
      const other = strokeLength(templateStrokes, j), vx = (templateStrokes[j + 2] - templateStrokes[j]) / other, vy = (templateStrokes[j + 3] - templateStrokes[j + 1]) / other
      return Math.abs(ux * vy - uy * vx) >= sin10 || Math.abs(ux * (templateStrokes[j + 1] - templateStrokes[i + 1]) - uy * (templateStrokes[j] - templateStrokes[i])) >= tolerance
    })) anchorIds.push(i)
    if (anchorIds.length >= (options.exhaustiveAnchors ? 12 : 3)) break
  }
  stats.anchors = anchorIds.length
  const rings = detectTemplateRings(sampleSegments, tolerance)
  const sin5 = Math.sin(5 * Math.PI / 180), sin60 = Math.sin(Math.PI / 3)
  const jointTolerance = Math.max(.02, tolerance * .1), templateGridSize = Math.max(4, tolerance * 2)
  const templateStrokeGrid = spatialIndex(templateStrokes, templateGridSize)
  const keyIds = anchorIds.filter(i => {
    const length = strokeLength(templateStrokes, i)
    if (length < Math.max(2 * tolerance, .5 * longest)) return false
    const ux = (templateStrokes[i + 2] - templateStrokes[i]) / length, uy = (templateStrokes[i + 3] - templateStrokes[i + 1]) / length
    const curvedJoint = (end: number) => {
      const x = templateStrokes[i + end], y = templateStrokes[i + end + 1]
      for (const j of gridLines(templateStrokeGrid, templateGridSize, [x - jointTolerance, y - jointTolerance, x + jointTolerance, y + jointTolerance])) {
        if (j === i) continue
        if (Math.min(Math.hypot(templateStrokes[j] - x, templateStrokes[j + 1] - y),
          Math.hypot(templateStrokes[j + 2] - x, templateStrokes[j + 3] - y)) > jointTolerance) continue
        const other = strokeLength(templateStrokes, j)
        const sine = Math.abs(ux * (templateStrokes[j + 3] - templateStrokes[j + 1]) - uy * (templateStrokes[j + 2] - templateStrokes[j])) / other
        if (sine >= sin5 && sine <= sin60) return true
      }
      return false
    }
    if (curvedJoint(0) && curvedJoint(2)) return false
    // The whole stroke must follow the ring: crossing or touching a ring does
    // not turn an internal straight line into part of its contour.
    return !rings.some(ring => {
      const near = (x: number, y: number) => Math.abs(Math.hypot(x - ring.center[0], y - ring.center[1]) - ring.radius) <= tolerance
      if (!near(templateStrokes[i], templateStrokes[i + 1]) || !near(templateStrokes[i + 2], templateStrokes[i + 3])) return false
      const t = Math.max(0, Math.min(length, (ring.center[0] - templateStrokes[i]) * ux + (ring.center[1] - templateStrokes[i + 1]) * uy))
      return near(templateStrokes[i] + ux * t, templateStrokes[i + 1] + uy * t)
    })
  })
  stats.keyStrokes = keyIds.length
  const mergedTarget = mergeCollinearStrokes(segments, tolerance, { maxLength: longest * (1 + scaleRange) + tolerance, shouldStop: options.shouldStop })
  stats.targetStrokes = mergedTarget.count; stats.stopped = mergedTarget.stopped
  stats.mergeMs = performance.now() - mergeStarted
  if (stats.stopped) return finish([], [])
  const targetStrokes = mergedTarget.lines, lengths = new Map<number, number[]>()
  for (let i = 0; i < targetStrokes.length; i += 4) {
    const key = Math.floor(strokeLength(targetStrokes, i) / tolerance), bucket = lengths.get(key)
    if (bucket) bucket.push(i); else lengths.set(key, [i])
  }
  const candidateStarted = performance.now()
  const size = Math.min(16, Math.max(8, short)), grid = spatialIndex(segments, size), radius = Math.ceil(tolerance / size)
  const hasKeyStroke = (a: Point, b: Point, loose: boolean) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length
    if (loose) {
      const steps = Math.ceil(length / (tolerance * .5)), required = Math.ceil(.9 * (steps + 1))
      let found = 0
      for (let at = 0; at <= steps; at++) {
        const x = a[0] + (b[0] - a[0]) * at / steps, y = a[1] + (b[1] - a[1]) * at / steps
        let hit = false
        const x0 = Math.floor((x - tolerance) / size), x1 = Math.floor((x + tolerance) / size)
        const y0 = Math.floor((y - tolerance) / size), y1 = Math.floor((y + tolerance) / size)
        for (let gy = y0; gy <= y1 && !hit; gy++) for (let gx = x0; gx <= x1 && !hit; gx++) {
          const cell = grid.cells.getCell(gx, gy)
          if (cell === undefined) continue
          for (let k = grid.offsets[cell]; k < grid.offsets[cell + 1]; k++) {
            const i = grid.ids[k], dx = segments[i + 2] - segments[i], dy = segments[i + 3] - segments[i + 1], other = Math.hypot(dx, dy)
            if (other && Math.abs(ux * dy - uy * dx) <= sin5 * other && pointDistance(x, y, segments, i) <= tolerance) { hit = true; break }
          }
        }
        if (hit) found++
        if (found >= required) return true
        if (found + steps - at < required) return false
      }
      return false
    }
    const half = tolerance * .5, extension = .33 * length * (1 + scaleRange) + tolerance
    const startX = a[0] - ux * extension, startY = a[1] - uy * extension
    const endX = b[0] + ux * extension, endY = b[1] + uy * extension
    const x0 = Math.floor((Math.min(startX, endX) - tolerance) / size), x1 = Math.floor((Math.max(startX, endX) + tolerance) / size)
    const y0 = Math.floor((Math.min(startY, endY) - tolerance) / size), y1 = Math.floor((Math.max(startY, endY) + tolerance) / size)
    // [lo, hi, offset]: projection on K' and signed normal offset of each parallel target line.
    // T (a merged target stroke) may sit up to `tolerance` from K's midpoint;
    // its own pieces must stay within half a tolerance of each other, as mergeCollinearStrokes does.
    const intervals: Array<[number, number, number]> = [], seen = new Set<number>()
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const cell = grid.cells.getCell(gx, gy)
      if (cell === undefined) continue
      for (let k = grid.offsets[cell]; k < grid.offsets[cell + 1]; k++) {
        const i = grid.ids[k]
        // A line crossing several cells is listed once per cell; keep the pairwise grouping below small.
        if (seen.has(i)) continue
        seen.add(i)
        const dx = segments[i + 2] - segments[i], dy = segments[i + 3] - segments[i + 1], other = Math.hypot(dx, dy)
        if (!other || Math.abs(ux * dy - uy * dx) > sin5 * other) continue
        const ax = segments[i] - a[0], ay = segments[i + 1] - a[1], bx = segments[i + 2] - a[0], by = segments[i + 3] - a[1]
        const na = ux * ay - uy * ax, nb = ux * by - uy * bx
        if (Math.abs(na - nb) > half || Math.max(Math.abs(na), Math.abs(nb)) > tolerance + half) continue
        const p = ax * ux + ay * uy, q = bx * ux + by * uy, lo = Math.min(p, q), hi = Math.max(p, q)
        if (hi < -extension || lo > length + extension) continue
        intervals.push([lo, hi, (na + nb) / 2])
      }
    }
    // Each distinct offset serves as a seed line; duplicate cell visits cannot change a union.
    for (const seed of intervals) {
      const group = intervals.filter(v => Math.abs(v[2] - seed[2]) <= half).sort((p, q) => p[0] - q[0] || p[1] - q[1])
      for (let at = 0; at < group.length;) {
        const lo = group[at][0]
        let hi = group[at][1], weight = 0, offset = 0
        const take = (v: [number, number, number]) => { const w = v[1] - v[0]; weight += w; offset += v[2] * w }
        take(group[at++])
        while (at < group.length && group[at][0] - hi <= half) { hi = Math.max(hi, group[at][1]); take(group[at++]) }
        // A component touching the search boundary may continue outside it.
        if (lo <= -extension || hi >= length + extension) continue
        const other = hi - lo
        if (other < .75 * length || other > 1.33 * length) continue
        if (Math.abs(weight ? offset / weight : 0) > tolerance) continue
        if (Math.min(length, hi) - Math.max(0, lo) >= .75 * length) return true
      }
    }
    return false
  }
  // Only build the additional grid when aligned target widths and template strokes are available.
  const strokeSegments = restrictStrokes ? widthFiltered(targetSegments, segmentWidths, templateStarted.strokeWidth, true) : segments
  const strokeGrid = restrictStrokes ? spatialIndex(strokeSegments, size) : grid
  const hits = (px: number, py: number, stroke: boolean) => {
    const lines = stroke ? strokeSegments : segments, index = stroke ? strokeGrid : grid
    const cx = Math.floor(px / size), cy = Math.floor(py / size)
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      const c = index.cells.getCell(x, y)
      if (c === undefined) continue
      for (let k = index.offsets[c]; k < index.offsets[c + 1]; k++) {
        const i = index.ids[k], ax = lines[i], ay = lines[i + 1], dx = lines[i + 2] - ax, dy = lines[i + 3] - ay
        const d = dx * dx + dy * dy, t = d ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / d)) : 0
        if ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= tolerance * tolerance) return true
      }
    }
    return false
  }
  // Sampling weights sum to each line's length, independent of its subdivision.
  // Fill-contour samples retain the existing all-lines coverage.
  const samples: Array<[number, number, number, boolean]> = []
  for (const i of templateIds) {
    const dx = sampleSegments[i + 2] - sampleSegments[i], dy = sampleSegments[i + 3] - sampleSegments[i + 1], length = Math.hypot(dx, dy)
    const n = Math.max(3, Math.ceil(length / 2) + 1), stroke = restrictStrokes && templateGeometry.widths[i / 4] > 0
    for (let j = 0; j < n; j++) samples.push([sampleSegments[i] + dx * j / (n - 1), sampleSegments[i + 1] + dy * j / (n - 1), length / n, stroke])
  }
  const sampleOrder = samples.map((_, i) => i), primaryPoints = new Uint8Array(samples.length)
  for (const i of sampleOrder) if (pointDistance(samples[i][0], samples[i][1], templateStrokes, anchorIds[0]) <= tolerance) primaryPoints[i] = 1
  const prioritizePrimary = (order: number[]) => order.filter(i => primaryPoints[i]).concat(order.filter(i => !primaryPoints[i]))
  const secondaryOrder = prioritizePrimary(sampleOrder), sampleHits = new Uint8Array(samples.length)
  // Cover both accumulation orders conservatively. Near the threshold, replay the
  // original loop, including its early-exit arithmetic, using cached hit decisions.
  const sampleWeight = samples.reduce((sum, sample) => sum + sample[2], 0)
  const earlySlack = 8 * Number.EPSILON * (samples.length + 1) * (1 + sampleWeight / totalLength)

  const corners: Point[] = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
  const candidates: VectorSymbolMatch[] = [], structureRejected: VectorSymbolMatch[] = [], geometry: VectorSymbolMatch[] = []
  // o, cos, sin, sample origin, scale; every measurement uses the same pose.
  const transforms = new Map<VectorSymbolMatch, [number, number, number, number, number, number, number]>()
  const ranks = new Map<VectorSymbolMatch, number>(), generation = new Map<VectorSymbolMatch, number>()
  const distance = short / 2, geometryGrid = new CellMap<Array<{ center: Point; rank: number }>>()
  const nearGeometry = (center: Point, radius: number, rank: number) => {
    const cx = Math.floor(center[0] / distance), cy = Math.floor(center[1] / distance), reach = Math.ceil(radius / distance)
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      if ((geometryGrid.getCell(cx + dx, cy + dy) ?? []).some(m => m.rank < rank && Math.hypot(m.center[0] - center[0], m.center[1] - center[1]) < radius)) return true
    }
    return false
  }
  let additionalTried = 0
  const evaluate = (ox: number, oy: number, angle: number, ax: number, ay: number, scale: number,
    rank: number, source: NonNullable<VectorSymbolMatch['source']>, anchor = -1, orderedSamples = rank ? secondaryOrder : sampleOrder, scoreOrder = sampleOrder) => {
    if (rank > 0 && additionalTried++ % 500 === 0 && options.shouldStop?.()) { stats.stopped = true; return }
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const transform = (x: number, y: number): Point => [ox + scale * (cos * (x - ax) - sin * (y - ay)), oy + scale * (sin * (x - ax) + cos * (y - ay))]
    const rect: Rect = [Infinity, Infinity, -Infinity, -Infinity]
    for (const corner of corners) {
      const [x, y] = transform(corner[0], corner[1])
      rect[0] = Math.min(rect[0], x); rect[1] = Math.min(rect[1], y)
      rect[2] = Math.max(rect[2], x); rect[3] = Math.max(rect[3], y)
    }
    const center: Point = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2], region = options.region
    if (region && (rect[0] < region[0] - 1e-6 || rect[1] < region[1] - 1e-6 || rect[2] > region[2] + 1e-6 || rect[3] > region[3] + 1e-6)) { stats.regionExcluded++; return }
    if (rank > 0 && nearGeometry(center, distance, rank)) { stats.skippedPlacements++; return }
    // Cheap necessary condition of the strict gate, checked before coverage: a merged stroke that
    // covers at least 75% of K' always contains K's midpoint (or a gap of at most half a tolerance
    // next to it), and its pieces lie within 1.5 tolerances of K's line. So some parallel piece lies
    // within 2 tolerances of the midpoint. Rejecting here never removes a placement the gate accepts.
    if (source !== 'exhaustive') for (const i of keyIds) {
      if (i === anchor) continue
      const [sx, sy] = transform(templateStrokes[i], templateStrokes[i + 1]), [tx, ty] = transform(templateStrokes[i + 2], templateStrokes[i + 3])
      const length = Math.hypot(tx - sx, ty - sy), ux = (tx - sx) / length, uy = (ty - sy) / length
      const mx = (sx + tx) / 2, my = (sy + ty) / 2, reach = 2 * tolerance
      let near = false
      for (let gy = Math.floor((my - reach) / size); gy <= Math.floor((my + reach) / size) && !near; gy++) {
        for (let gx = Math.floor((mx - reach) / size); gx <= Math.floor((mx + reach) / size) && !near; gx++) {
          const cell = grid.cells.getCell(gx, gy)
          if (cell === undefined) continue
          for (let k = grid.offsets[cell]; k < grid.offsets[cell + 1]; k++) {
            const j = grid.ids[k], dx = segments[j + 2] - segments[j], dy = segments[j + 3] - segments[j + 1], other = Math.hypot(dx, dy)
            if (other && Math.abs(ux * dy - uy * dx) <= sin5 * other && pointDistance(mx, my, segments, j) <= reach) { near = true; break }
          }
        }
      }
      if (!near) { stats.keyStrokeRejected++; return }
    }
    // The loose gate (0-result recovery) stops after a few misses, so it is cheaper than coverage:
    // run it first. Gate and coverage are both required, so the order does not change results.
    if (source === 'exhaustive') for (const i of keyIds) {
      if (i === anchor) continue
      if (!hasKeyStroke(transform(templateStrokes[i], templateStrokes[i + 1]), transform(templateStrokes[i + 2], templateStrokes[i + 3]), true)) {
        stats.keyStrokeRejected++; return
      }
    }
    // Count every coverage evaluation, including poses that later fail the gate.
    stats.placements++
    let covered = 0, remaining = totalLength
    if (rank > 0) {
      for (const i of orderedSamples) {
        const [x, y, weight, stroke] = samples[i]
        const px = ox + scale * (cos * (x - ax) - sin * (y - ay)), py = oy + scale * (sin * (x - ax) + cos * (y - ay))
        remaining -= weight
        const hit = hits(px, py, stroke)
        sampleHits[i] = hit ? 1 : 0
        if (hit) covered += weight
        if ((covered + remaining) / totalLength < threshold - 1e-10 - earlySlack) return
      }
      covered = 0; remaining = totalLength
    }
    for (const i of scoreOrder) {
      const [x, y, weight, stroke] = samples[i]
      remaining -= weight
      const hit = rank > 0 ? sampleHits[i] : hits(ox + scale * (cos * (x - ax) - sin * (y - ay)), oy + scale * (sin * (x - ax) + cos * (y - ay)), stroke)
      if (hit) covered += weight
      if ((covered + remaining) / totalLength < threshold - 1e-10) break
    }
    const score = Math.min(1, covered / totalLength)
    if (score < threshold - 1e-10) return
    if (source !== 'exhaustive') for (const i of keyIds) {
      if (i === anchor) continue
      if (!hasKeyStroke(transform(templateStrokes[i], templateStrokes[i + 1]), transform(templateStrokes[i + 2], templateStrokes[i + 3]), false)) {
        stats.keyStrokeRejected++; return
      }
    }
    stats.geometryPassed++
    const match: VectorSymbolMatch = { rect, center, score, angle: ((angle * 180 / Math.PI % 360) + 360) % 360, extra: 0, around: 0, source }
    if (scale !== 1) match.scale = scale
    transforms.set(match, [ox, oy, cos, sin, ax, ay, scale]); ranks.set(match, rank); generation.set(match, geometry.length); geometry.push(match)
    const cx = Math.floor(center[0] / distance), cy = Math.floor(center[1] / distance), group = geometryGrid.getCell(cx, cy) ?? []
    group.push({ center, rank }); geometryGrid.setCell(cx, cy, group)
    if (comparePaint) {
      if (!options.rotations && Math.abs(Math.sin(angle / 2)) > Math.sin(Math.PI / 180)) { stats.rotationExcluded++; return }
      const comparison = comparePaint(match.center, match.angle), paintScore = fillOnly ? comparison.fillScore : comparison.score
      match.structureScore = comparison.known && !fillOnly ? comparison.lineScore : undefined
      match.fillScore = comparison.known ? comparison.fillScore : undefined
      match.structureCheck = !comparison.known || paintScore < .97
      if (comparison.known && paintScore < .9) {
        stats.structureExcluded++; match.rejectReason = 'structure'; structureRejected.push(match); return
      }
    }
    candidates.push(match)
  }
  const runAnchors = (ids: number[], firstRank = 0) => {
    for (let at = 0; at < ids.length && !stats.stopped; at++) {
      const rank = firstRank + at
      const anchor = ids[at], length = strokeLength(templateStrokes, anchor)
      const baseAngle = Math.atan2(templateStrokes[anchor + 3] - templateStrokes[anchor + 1], templateStrokes[anchor + 2] - templateStrokes[anchor])
      const delta = Math.max(tolerance, length * scaleRange)
      for (let bucket = Math.floor(Math.max(0, length - delta) / tolerance); bucket <= Math.floor((length + delta) / tolerance) && !stats.stopped; bucket++) {
        for (const i of lengths.get(bucket) ?? []) {
          const targetLength = strokeLength(targetStrokes, i), difference = Math.abs(targetLength - length)
          if (difference > tolerance && Math.abs(targetLength / length - 1) > scaleRange + 1e-10) continue
          const scale = difference <= tolerance ? 1 : targetLength / length
          const candidateAngle = Math.atan2(targetStrokes[i + 3] - targetStrokes[i + 1], targetStrokes[i + 2] - targetStrokes[i])
          if (!options.rotations && Math.abs(Math.sin(candidateAngle - baseAngle)) > Math.sin(2 * Math.PI / 180)) continue
          if (rank === 0) {
            if (stats.anchorsTried % 500 === 0 && options.shouldStop?.()) { stats.stopped = true; break }
            stats.anchorsTried++
          }
          for (let direction = 0; direction < 2 && !stats.stopped; direction++) {
            evaluate(targetStrokes[i + direction * 2], targetStrokes[i + direction * 2 + 1], candidateAngle - baseAngle + direction * Math.PI,
              templateStrokes[anchor], templateStrokes[anchor + 1], scale, rank, firstRank ? 'exhaustive' : rank ? 'secondary' : 'primary', anchor)
          }
        }
      }
    }
  }
  runAnchors(anchorIds)
  // Every placement must contain all key strokes, and key strokes are straight anchors themselves,
  // so a ring anchor only adds recall for curve-only templates. Skipping it elsewhere avoids
  // sweeping rotations around every same-radius circle on the page.
  const ring = keyIds.length ? undefined : rings[0]
  if (ring && !stats.stopped) {
    stats.ringAnchor = true
    const votes = voteRingCenters(segments, ring.radius, tolerance, { shouldStop: options.shouldStop })
    stats.ringLimited = votes.limited; stats.stopped = votes.stopped
    let rMax = 0
    for (let i = 0; i < sampleSegments.length; i += 2) rMax = Math.max(rMax, Math.hypot(sampleSegments[i] - ring.center[0], sampleSegments[i + 1] - ring.center[1]))
    const step = Math.max(Math.PI / 180, Math.min(5 * Math.PI / 180, .7 * tolerance / rMax))
    const angleCount = options.rotations ? Math.ceil(2 * Math.PI / step) : 1
    // Prioritize non-ring lines; keep every original sample and weight.
    const nonRing = (i: number) => [0, .5, 1].some(t => {
      const x = sampleSegments[i] + t * (sampleSegments[i + 2] - sampleSegments[i]), y = sampleSegments[i + 1] + t * (sampleSegments[i + 3] - sampleSegments[i + 1])
      return Math.abs(Math.hypot(x - ring.center[0], y - ring.center[1]) - ring.radius) > tolerance
    })
    const internal = new Set<number>()
    for (const i of templateIds) if (nonRing(i)) internal.add(i)
    const ringSamples: number[] = [], outsideSamples: number[] = []
    let at = 0
    for (const i of templateIds) {
      const n = Math.max(3, Math.ceil(strokeLength(sampleSegments, i) / 2) + 1)
      const group = internal.has(i) ? ringSamples : outsideSamples
      for (let j = 0; j < n; j++) group.push(at++)
    }
    ringSamples.push(...outsideSamples)
    const ringOrder = prioritizePrimary(ringSamples)
    const boundRadius = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2
    let ringPlacements = 0
    for (const vote of votes.centers) {
      if (stats.stopped) break
      if (nearGeometry(vote.center, boundRadius, anchorIds.length)) { stats.skippedPlacements++; continue }
      for (let j = 0; j < angleCount; j++) {
        if (ringPlacements >= 200_000) { stats.ringLimited = true; break }
        ringPlacements++
        evaluate(vote.center[0], vote.center[1], j * 2 * Math.PI / angleCount, ring.center[0], ring.center[1], 1, anchorIds.length, 'ring', -1, ringOrder, ringSamples)
        if (stats.stopped) break
      }
      if (stats.ringLimited && ringPlacements >= 200_000) break
    }
  }
  const exhaustiveRank = anchorIds.length + 1
  if (options.exhaustiveWhenEmpty && !stats.geometryPassed && !stats.stopped && options.shouldStop?.()) stats.stopped = true
  if (options.exhaustiveWhenEmpty && !stats.geometryPassed && !stats.stopped) {
    const exhaustiveIds: number[] = []
    for (const i of ordered) {
      const length = strokeLength(templateStrokes, i)
      if (exhaustiveIds.length && length < 2 * tolerance) continue
      const ux = (templateStrokes[i + 2] - templateStrokes[i]) / length, uy = (templateStrokes[i + 3] - templateStrokes[i + 1]) / length
      if (exhaustiveIds.every(j => {
        const other = strokeLength(templateStrokes, j), vx = (templateStrokes[j + 2] - templateStrokes[j]) / other, vy = (templateStrokes[j + 3] - templateStrokes[j + 1]) / other
        return Math.abs(ux * vy - uy * vx) >= sin10 || Math.abs(ux * (templateStrokes[j + 1] - templateStrokes[i + 1]) - uy * (templateStrokes[j] - templateStrokes[i])) >= tolerance
      })) exhaustiveIds.push(i)
      if (exhaustiveIds.length >= 12) break
    }
    const extra = exhaustiveIds.filter(i => !anchorIds.includes(i)).slice(0, 9)
    stats.exhaustiveRan = true
    const before = stats.placements
    runAnchors(extra, exhaustiveRank)
    stats.exhaustivePlacements = stats.placements - before
    stats.anchors += extra.length
  }
  const sort = (a: VectorSymbolMatch, b: VectorSymbolMatch) => Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : ranks.get(a)! - ranks.get(b)! || generation.get(a)! - generation.get(b)!
  type Suppression = CellMap<Point[]>
  const overlaps = (suppressed: Suppression, center: Point) => {
    const [x, y] = center, cx = Math.floor(x / distance), cy = Math.floor(y / distance)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((suppressed.getCell(cx + dx, cy + dy) ?? []).some(p => Math.hypot(p[0] - x, p[1] - y) < distance)) return true
    }
    return false
  }
  const suppress = (input: VectorSymbolMatch[], limit: number, excluded?: Suppression) => {
    const kept: VectorSymbolMatch[] = [], sites: Suppression = new CellMap()
    let duplicates = 0, limited = 0
    for (const match of input.sort(sort)) {
      if (excluded && overlaps(excluded, match.center)) continue
      if (overlaps(sites, match.center)) { duplicates++; continue }
      const cx = Math.floor(match.center[0] / distance), cy = Math.floor(match.center[1] / distance), group = sites.getCell(cx, cy) ?? []
      group.push(match.center); sites.setCell(cx, cy, group)
      if (kept.length < limit) kept.push(match); else limited++
    }
    return { kept, sites, duplicates, limited }
  }
  stats.geometrySites = suppress(geometry, Infinity).kept.length
  const accepted = suppress(candidates, maxResults), matches = accepted.kept
  if (stats.exhaustiveRan) stats.exhaustiveFound = matches.filter(m => ranks.get(m)! >= exhaustiveRank).length
  // Exclude only published matches, including when maxResults truncates the list.
  const published = new CellMap<Point[]>()
  for (const match of matches) {
    const cx = Math.floor(match.center[0] / distance), cy = Math.floor(match.center[1] / distance), group = published.getCell(cx, cy) ?? []
    group.push(match.center); published.setCell(cx, cy, group)
  }
  const rejectedResult = suppress(structureRejected, 500, published), rejected = rejectedResult.kept
  stats.structureExcludedSites = rejected.length + rejectedResult.limited
  stats.duplicates = accepted.duplicates; stats.limited = accepted.limited
  stats.candidateMs = performance.now() - candidateStarted
  const verifyStarted = performance.now()
  const reverseTolerance = Math.max(.2, tolerance * .45), reverseSize = Math.max(1, reverseTolerance * 2)
  const templateGrid = matches.length + rejected.length ? spatialIndex(sampleSegments, reverseSize) : null
  for (const match of [...matches, ...rejected]) {
    const [ox, oy, cos, sin, ax, ay, scale] = transforms.get(match)!
    const inverse = (x: number, y: number): Point => [ax + (cos * (x - ox) + sin * (y - oy)) / scale,
      ay + (-sin * (x - ox) + cos * (y - oy)) / scale]
    const r = match.rect, margin = tolerance * (Math.abs(cos) + Math.abs(sin))
    const expanded: Rect = [r[0] - margin, r[1] - margin, r[2] + margin, r[3] + margin]
    const aroundMargin = padding * (Math.abs(cos) + Math.abs(sin))
    match.around = bandLength(segments, gridLines(grid, size, [r[0] - aroundMargin, r[1] - aroundMargin, r[2] + aroundMargin, r[3] + aroundMargin]), inverse)
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
          const cell = templateGrid!.cells.getCell(gx, gy)
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
  stats.verifyMs = performance.now() - verifyStarted
  return finish(matches, rejected)
}

/** Measure existing placements without generating anchors or changing source geometry. */
export function scoreVectorPlacements(
  segments: Float32Array, sampleRect: Rect, targets: ReadonlyArray<{ center: Point; angle: number }>,
  sampleSegments: Float32Array, sampleWidths: Float32Array, segmentWidths?: Float32Array,
  manual?: { segments: Float32Array; widths: Float32Array }, options: { threshold?: number; shouldStop?: () => boolean } = {},
): { scores: Float32Array; centers: Float32Array; ms: number } {
  const started = performance.now()
  if (targets.length > 500) throw Error('Vector coverage supports at most 500 targets')
  if (options.shouldStop?.()) throw Error('cancelled')
  if (segments.length % 4 || !segments.every(Number.isFinite)
    || (segmentWidths && (segmentWidths.length !== segments.length / 4 || !segmentWidths.every(w => Number.isFinite(w) && w >= 0)))
    || targets.some(t => !t.center.every(Number.isFinite) || !Number.isFinite(t.angle))) throw Error('Invalid vector coverage input')
  const prepared = manual
    ? manualVectorTemplate(manual.segments, manual.widths, sampleRect, templateLineOffsets(sampleSegments, sampleWidths, sampleRect).length)
    : prepareVectorTemplate(sampleSegments, sampleWidths, sampleRect)
  const geometry = paintTemplateGeometry(prepared.segments, prepared.widths, prepared.bounds)
  const lines = widthFiltered(segments, segmentWidths, prepared.strokeWidth)
  const restrictStrokes = !!segmentWidths && prepared.strokeWidth > 0 && geometry.widths.some(w => w > 0)
  const strokes = restrictStrokes ? widthFiltered(segments, segmentWidths, prepared.strokeWidth, true) : lines
  const tolerance = prepared.tolerance, short = Math.max(.3, Math.min(prepared.bounds[2] - prepared.bounds[0], prepared.bounds[3] - prepared.bounds[1]))
  const size = Math.min(16, Math.max(8, short)), radius = Math.ceil(tolerance / size)
  const grid = spatialIndex(lines, size), strokeGrid = restrictStrokes ? spatialIndex(strokes, size) : grid
  const samples: Array<[number, number, number, boolean]> = []
  let totalLength = 0
  for (let i = 0; i < geometry.segments.length; i += 4) {
    const a = geometry.segments, dx = a[i + 2] - a[i], dy = a[i + 3] - a[i + 1], length = Math.hypot(dx, dy)
    if (!length) continue
    totalLength += length
    const n = Math.max(3, Math.ceil(length / 2) + 1)
    for (let j = 0; j < n; j++) samples.push([a[i] + dx * j / (n - 1), a[i + 1] + dy * j / (n - 1), length / n, restrictStrokes && geometry.widths[i / 4] > 0])
  }
  if (totalLength === 0) throw Error('見本の範囲に線がありません')
  const hits = (x: number, y: number, stroke: boolean) => {
    const data = stroke ? strokes : lines, index = stroke ? strokeGrid : grid
    const cx = Math.floor(x / size), cy = Math.floor(y / size)
    for (let gy = cy - radius; gy <= cy + radius; gy++) for (let gx = cx - radius; gx <= cx + radius; gx++) {
      const cell = index.cells.getCell(gx, gy)
      if (cell === undefined) continue
      for (let k = index.offsets[cell]; k < index.offsets[cell + 1]; k++) {
        if (pointDistance(x, y, data, index.ids[k]) <= tolerance) return true
      }
    }
    return false
  }
  const scores = new Float32Array(targets.length), centers = new Float32Array(targets.length * 2)
  const ax = (prepared.bounds[0] + prepared.bounds[2]) / 2, ay = (prepared.bounds[1] + prepared.bounds[3]) / 2
  for (let i = 0; i < targets.length; i++) {
    if (options.shouldStop?.()) throw Error('cancelled')
    const target = targets[i], angle = target.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    let best = -1
    // Test the original center first so equal scores preserve an already aligned pose.
    for (const dy of [0, -2, -1, 1, 2]) for (const dx of [0, -2, -1, 1, 2]) {
      if (options.shouldStop?.()) throw Error('cancelled')
      const cx = target.center[0] + dx * tolerance / 2, cy = target.center[1] + dy * tolerance / 2
      let covered = 0
      for (let j = 0; j < samples.length; j++) {
        if (j % 4096 === 0 && options.shouldStop?.()) throw Error('cancelled')
        const [x, y, weight, stroke] = samples[j]
        if (hits(cx + cos * (x - ax) - sin * (y - ay), cy + sin * (x - ax) + cos * (y - ay), stroke)) covered += weight
      }
      const score = Math.min(1, covered / totalLength)
      if (score > best) { best = score; centers[i * 2] = cx; centers[i * 2 + 1] = cy }
    }
    scores[i] = best
  }
  return { scores, centers, ms: performance.now() - started }
}
