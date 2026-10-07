import type { Point, Rect } from './annotations'

export interface VectorSymbolOptions {
  threshold: number
  rotations: boolean
  tolerance?: number
  maxResults: number
  region?: Rect
  shouldStop?: () => boolean
}
export interface VectorSymbolMatch { rect: Rect; center: Point; score: number; angle: number }

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

export function vectorSymbolSearch(segments: Float32Array, sampleRect: Rect, options: Partial<VectorSymbolOptions> = {}) {
  const started = performance.now(), width = sampleRect[2] - sampleRect[0], height = sampleRect[3] - sampleRect[1]
  const short = Math.min(width, height), tolerance = options.tolerance ?? Math.min(1, Math.max(.15, short * .04))
  const threshold = options.threshold ?? .85, maxResults = options.maxResults ?? 2000
  if (!sampleRect.every(Number.isFinite) || short <= 0 || !Number.isFinite(tolerance) || tolerance <= 0
    || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isInteger(maxResults) || maxResults < 0
    || (options.region && (!options.region.every(Number.isFinite) || options.region[2] < options.region[0] || options.region[3] < options.region[1]))) throw Error('Invalid vector search options')
  if (segments.length % 4 || !segments.every(Number.isFinite)) throw Error('Invalid vector segments')
  const inside = (x: number, y: number) => x >= sampleRect[0] - tolerance && x <= sampleRect[2] + tolerance && y >= sampleRect[1] - tolerance && y <= sampleRect[3] + tolerance
  const templateIds: number[] = [], lengths = new Map<number, number[]>()
  let anchor = -1, longest = 0, totalLength = 0
  for (let i = 0; i < segments.length; i += 4) {
    const length = Math.hypot(segments[i + 2] - segments[i], segments[i + 3] - segments[i + 1])
    const key = Math.floor(length / tolerance), bucket = lengths.get(key)
    if (bucket) bucket.push(i); else lengths.set(key, [i])
    if (length > 0 && inside(segments[i], segments[i + 1]) && inside(segments[i + 2], segments[i + 3])) {
      templateIds.push(i); totalLength += length
      if (length > longest) { longest = length; anchor = i }
    }
  }
  if (templateIds.length < 2) throw Error('見本の範囲に線がありません')
  const template = { segments: templateIds.length, length: totalLength }
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
  // Sampling weights sum to each segment's length, independent of its subdivision.
  const samples: Array<[number, number, number]> = []
  for (const i of templateIds) {
    const dx = segments[i + 2] - segments[i], dy = segments[i + 3] - segments[i + 1], length = Math.hypot(dx, dy)
    const n = Math.max(3, Math.ceil(length / 2) + 1)
    for (let j = 0; j < n; j++) samples.push([segments[i] + dx * j / (n - 1) - segments[anchor], segments[i + 1] + dy * j / (n - 1) - segments[anchor + 1], length / n])
  }
  const baseAngle = Math.atan2(segments[anchor + 3] - segments[anchor + 1], segments[anchor + 2] - segments[anchor])
  const corners: Point[] = [[sampleRect[0], sampleRect[1]], [sampleRect[2], sampleRect[1]], [sampleRect[2], sampleRect[3]], [sampleRect[0], sampleRect[3]]]
  const candidates: VectorSymbolMatch[] = []
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
        const transformed = corners.map(p => transform(p[0] - segments[anchor], p[1] - segments[anchor + 1]))
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
        if (score >= threshold - 1e-10) candidates.push({ rect, center: [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2], score, angle: ((angle * 180 / Math.PI % 360) + 360) % 360 })
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
  return { matches, template, stats: { anchorsTried, ms: performance.now() - started } }
}
