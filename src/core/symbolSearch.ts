export interface GrayImage { width: number; height: number; data: Uint8Array }
export interface SymbolMatch {
  x: number; y: number; width: number; height: number; score: number; rotation: 0 | 90 | 180 | 270
}
export interface SymbolSearchOptions {
  threshold: number
  rotations: boolean
  maxResults: number
  region?: { x: number; y: number; width: number; height: number }
  shouldStop?: () => boolean
  onProgress?: (done: number, total: number) => void
}
export interface SymbolSearchStats {
  coarseCandidates: number; refined: number; levels: number
  ms: { coarse: number; refine: number; total: number }
  /** Conservative typed-array working-set estimate, excluding input images and GC overhead. */
  estimatedWorkingBytes: number
}

function validate(image: GrayImage): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height) throw new Error('invalid image')
}
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || rgba.length !== width * height * 4) throw new Error('invalid image')
  const data = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    // Composite transparent pixels on white before converting to ink density.
    data[i] = Math.round((255 - (.2126 * rgba[j] + .7152 * rgba[j + 1] + .0722 * rgba[j + 2])) * rgba[j + 3] / 255)
  }
  return { width, height, data }
}
function trim(image: GrayImage): GrayImage {
  let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[y * image.width + x] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  if (x1 < 0) throw new Error('blank template')
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1)
  x1 = Math.min(image.width, x1 + 2); y1 = Math.min(image.height, y1 + 2)
  const width = x1 - x0, height = y1 - y0, data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) data.set(image.data.subarray((y0 + y) * image.width + x0, (y0 + y) * image.width + x1), y * width)
  return { width, height, data }
}
function half(image: GrayImage): GrayImage {
  const width = Math.ceil(image.width / 2), height = Math.ceil(image.height / 2), data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, n = 0
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      if (2 * x + dx < image.width && 2 * y + dy < image.height) { sum += image.data[(2 * y + dy) * image.width + 2 * x + dx]; n++ }
    }
    data[y * width + x] = Math.round(sum / n)
  }
  return { width, height, data }
}
function rotate(image: GrayImage): GrayImage {
  const data = new Uint8Array(image.data.length)
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) data[x * image.height + image.height - 1 - y] = image.data[y * image.width + x]
  return { width: image.height, height: image.width, data }
}
function shifted(image: GrayImage, x: number, y: number): GrayImage {
  if (x === 0 && y === 0) return image
  const width = image.width + x, height = image.height + y, data = new Uint8Array(width * height)
  for (let row = 0; row < image.height; row++) data.set(image.data.subarray(row * image.width, (row + 1) * image.width), (row + y) * width + x)
  return { width, height, data }
}
interface Integral { stride: number; sum: Float64Array; square: Float64Array; x: number; y: number }
function integral(image: GrayImage, x = 0, y = 0, width = image.width, height = image.height): Integral {
  const stride = width + 1, sum = new Float64Array(stride * (height + 1)), square = new Float64Array(sum.length)
  for (let row = 0; row < height; row++) {
    let s = 0, q = 0
    for (let col = 0; col < width; col++) {
      const v = image.data[(y + row) * image.width + x + col], at = (row + 1) * stride + col + 1
      s += v; q += v * v; sum[at] = sum[at - stride] + s; square[at] = square[at - stride] + q
    }
  }
  return { stride, sum, square, x, y }
}
interface Prepared { image: GrayImage; offsets: Int32Array; ink: Float32Array; mean: number; variance: number }
function prepare(image: GrayImage, pageWidth: number): Prepared {
  let sum = 0, square = 0, n = 0
  for (const v of image.data) { sum += v; square += v * v; if (v) n++ }
  const offsets = new Int32Array(n), ink = new Float32Array(n)
  for (let y = 0, at = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const v = image.data[y * image.width + x]
    if (v) { offsets[at] = y * pageWidth + x; ink[at++] = v }
  }
  const variance = square - sum * sum / image.data.length
  if (variance <= 1e-6) throw new Error('constant template')
  return { image, offsets, ink, mean: sum / image.data.length, variance }
}
function ncc(page: GrayImage, t: Prepared, table: Integral, x: number, y: number): number {
  const left = x - table.x, top = y - table.y, a = top * table.stride + left
  const b = a + t.image.width, c = a + t.image.height * table.stride, d = c + t.image.width
  const sum = table.sum[d] - table.sum[b] - table.sum[c] + table.sum[a]
  const square = table.square[d] - table.square[b] - table.square[c] + table.square[a]
  const variance = square - sum * sum / t.image.data.length
  if (variance <= 1e-6) return -1
  // Zero-valued template pixels contribute nothing to the uncentred dot product.
  let dot = 0
  const origin = y * page.width + x
  for (let i = 0; i < t.offsets.length; i++) dot += page.data[origin + t.offsets[i]] * t.ink[i]
  return Math.max(-1, Math.min(1, (dot - sum * t.mean) / Math.sqrt(variance * t.variance)))
}
interface Coarse { x: number; y: number; score: number; r: number }
// A bounded min-heap retains the globally best candidates across all rotations.
function retain(heap: Coarse[], value: Coarse): void {
  const cap = 20_000
  if (heap.length === cap && value.score <= heap[0].score) return
  let at: number
  if (heap.length < cap) { at = heap.length; heap.push(value) }
  else {
    at = 0
    while (2 * at + 1 < heap.length) {
      let child = 2 * at + 1
      if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++
      if (heap[child].score >= value.score) break
      heap[at] = heap[child]; at = child
    }
    heap[at] = value; return
  }
  while (at > 0) {
    const parent = (at - 1) >> 1
    if (heap[parent].score <= value.score) break
    heap[at] = heap[parent]; at = parent
  }
  heap[at] = value
}

export function searchSymbol(page: GrayImage, template: GrayImage, options: Partial<SymbolSearchOptions> = {}): { matches: SymbolMatch[]; stats: SymbolSearchStats } {
  const started = performance.now(), check = () => { if (options.shouldStop?.()) throw new Error('cancelled') }
  check(); validate(page); validate(template)
  const threshold = options.threshold ?? .7, maxResults = options.maxResults ?? 500
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isSafeInteger(maxResults) || maxResults < 0) throw new Error('invalid options')
  const region = options.region ?? { x: 0, y: 0, width: page.width, height: page.height }
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width < 0 || region.height < 0) throw new Error('invalid region')
  const bounds = { x0: Math.max(0, Math.ceil(region.x)), y0: Math.max(0, Math.ceil(region.y)),
    x1: Math.min(page.width, Math.floor(region.x + region.width)), y1: Math.min(page.height, Math.floor(region.y + region.height)) }
  const full = [trim(template)]
  const rotations: SymbolMatch['rotation'][] = options.rotations === true ? [0, 90, 180, 270] : [0]
  for (let i = 1; i < rotations.length; i++) full.push(rotate(full[i - 1]))
  let coarsePage = page, coarseTemplate = full[0], levels = 0, pyramidBytes = 0
  // levels counts reductions: the original image is level 0, at most four halvings.
  while (Math.max(coarseTemplate.width, coarseTemplate.height) > 12 && levels < 4) {
    check(); coarsePage = half(coarsePage); coarseTemplate = half(coarseTemplate)
    pyramidBytes += coarsePage.data.byteLength + coarseTemplate.data.byteLength; levels++
  }
  const factor = 2 ** levels, coarseTemplates: GrayImage[] = [], phases: Prepared[][] = []
  let phaseBytes = 0
  // A one-pixel translation changes the averaging phase of thin strokes. Retain
  // all sub-cell phases so an identical symbol is not rejected before refinement.
  for (const image of full) {
    const variants: Prepared[] = []
    for (let y = 0; y < factor; y++) for (let x = 0; x < factor; x++) {
      let t = shifted(image, x, y)
      for (let l = 0; l < levels; l++) t = half(t)
      const p = prepare(t, coarsePage.width)
      variants.push(p); phaseBytes += t.data.byteLength + p.offsets.byteLength + p.ink.byteLength
    }
    phases.push(variants); coarseTemplates.push(variants[0].image)
  }
  const table = integral(coarsePage), heap: Coarse[] = [], lower = Math.max(.35, threshold - .25)
  const rows = coarseTemplates.map(t => Math.max(0, Math.min(coarsePage.height - t.height, Math.ceil(bounds.y1 / factor) - t.height) - Math.max(0, Math.floor(bounds.y0 / factor)) + 1))
  const totalRows = rows.reduce((a, b) => a + b, 0)
  let done = 0, gridPeakBytes = 0
  for (let r = 0; r < rotations.length; r++) {
    const t = phases[r][0]
    const x0 = Math.max(0, Math.floor(bounds.x0 / factor)), y0 = Math.max(0, Math.floor(bounds.y0 / factor))
    const x1 = Math.min(coarsePage.width - t.image.width, Math.ceil(bounds.x1 / factor) - t.image.width)
    const y1 = Math.min(coarsePage.height - t.image.height, Math.ceil(bounds.y1 / factor) - t.image.height)
    const width = x1 - x0 + 1, height = y1 - y0 + 1
    if (width <= 0 || height <= 0) continue
    const scores = new Float32Array(width * height)
    gridPeakBytes = Math.max(gridPeakBytes, scores.byteLength)
    for (let y = 0; y < height; y++) {
      check()
      for (let x = 0; x < width; x++) {
        const px = x + x0, py = y + y0
        let score = ncc(coarsePage, t, table, px, py)
        // White/constant windows cannot contain a matching symbol. Avoid phase
        // dot products there; sparse architectural sheets spend most time here.
        if (score > -1) for (let phase = 1; phase < phases[r].length; phase++) {
          const variant = phases[r][phase]
          if (px + variant.image.width <= coarsePage.width && py + variant.image.height <= coarsePage.height) score = Math.max(score, ncc(coarsePage, variant, table, px, py))
        }
        scores[y * width + x] = score
      }
      // Throttle messages; cancellation is still checked on every row.
      done++; if (done % 32 === 0 || done === totalRows) options.onProgress?.(done, totalRows)
    }
    for (let y = 0; y < height; y++) {
      check()
      for (let x = 0; x < width; x++) {
        const score = scores[y * width + x]
        if (score < lower) continue
        let peak = true
        for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && scores[ny * width + nx] > score) { peak = false; break }
        }
        if (peak) retain(heap, { x: (x + x0) * factor, y: (y + y0) * factor, score, r })
      }
    }
  }
  const coarseEnd = performance.now(), prepared = full.map(t => prepare(t, page.width)), matches: SymbolMatch[] = []
  heap.sort((a, b) => b.score - a.score)
  let patchPeakBytes = 0, refined = 0
  for (let i = 0; i < heap.length; i++) {
    if (i % 200 === 0) { check(); options.onProgress?.(totalRows + i, totalRows + heap.length) }
    const candidate = heap[i], t = prepared[candidate.r]
    const x0 = Math.max(bounds.x0, candidate.x - factor), y0 = Math.max(bounds.y0, candidate.y - factor)
    const x1 = Math.min(bounds.x1 - t.image.width, candidate.x + factor), y1 = Math.min(bounds.y1 - t.image.height, candidate.y + factor)
    if (x1 < x0 || y1 < y0) continue
    refined++
    const local = integral(page, x0, y0, x1 - x0 + t.image.width, y1 - y0 + t.image.height)
    patchPeakBytes = Math.max(patchPeakBytes, local.sum.byteLength + local.square.byteLength)
    let score = -1, bestX = x0, bestY = y0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const value = ncc(page, t, local, x, y)
      if (value > score) { score = value; bestX = x; bestY = y }
    }
    if (score >= threshold) matches.push({ x: bestX, y: bestY, width: t.image.width, height: t.image.height, score, rotation: rotations[candidate.r] })
  }
  check(); options.onProgress?.(totalRows + heap.length, totalRows + heap.length)
  matches.sort((a, b) => b.score - a.score)
  const kept: SymbolMatch[] = [], radius = Math.min(full[0].width, full[0].height) / 2
  // Spatial buckets avoid quadratic suppression when many coarse peaks refine to the same symbol.
  const buckets = new Map<string, SymbolMatch[]>()
  for (const match of matches) {
    if (kept.length >= maxResults) break
    const cx = match.x + match.width / 2, cy = match.y + match.height / 2, bx = Math.floor(cx / radius), by = Math.floor(cy / radius)
    let duplicate = false
    for (let y = by - 1; y <= by + 1 && !duplicate; y++) for (let x = bx - 1; x <= bx + 1; x++) {
      if (buckets.get(`${x},${y}`)?.some(m => (m.x + m.width / 2 - cx) ** 2 + (m.y + m.height / 2 - cy) ** 2 < radius ** 2)) { duplicate = true; break }
    }
    if (!duplicate) { kept.push(match); const key = `${bx},${by}`, bucket = buckets.get(key) ?? []; bucket.push(match); buckets.set(key, bucket) }
  }
  check()
  const ended = performance.now()
  return { matches: kept, stats: { coarseCandidates: heap.length, refined, levels,
    estimatedWorkingBytes: pyramidBytes + table.sum.byteLength + table.square.byteLength + gridPeakBytes + patchPeakBytes
      + full.reduce((n, t) => n + t.data.byteLength * 9, 0) + phaseBytes,
    ms: { coarse: coarseEnd - started, refine: ended - coarseEnd, total: ended - started } } }
}
