import type { Rect } from './annotations'

const CELL_LIMIT = 0x100000, CELL_STRIDE = 0x200000
export const cellKey = (x: number, y: number): number => (x + CELL_LIMIT) * CELL_STRIDE + (y + CELL_LIMIT)
export const cellX = (key: number): number => Math.floor(key / CELL_STRIDE) - CELL_LIMIT
export const cellY = (key: number): number => key % CELL_STRIDE - CELL_LIMIT

/** Numeric keys are exact within the supported square. Preserve all other cells separately. */
export class CellMap<T> extends Map<number, T> {
  readonly overflow = new Map<string, T>()
  getCell(x: number, y: number): T | undefined {
    return x > -CELL_LIMIT && x < CELL_LIMIT && y > -CELL_LIMIT && y < CELL_LIMIT
      ? super.get(cellKey(x, y)) : this.overflow.get(`${x},${y}`)
  }
  setCell(x: number, y: number, value: T): void {
    if (x > -CELL_LIMIT && x < CELL_LIMIT && y > -CELL_LIMIT && y < CELL_LIMIT) super.set(cellKey(x, y), value)
    else this.overflow.set(`${x},${y}`, value)
  }
}

/** Greedy strokes always measure against the seed, never an evolving tangent. */
export function mergeCollinearStrokes(segments: Float32Array, tolerance: number,
  options: { maxLength?: number; shouldStop?: () => boolean } = {}): { lines: Float32Array; count: number; stopped: boolean } {
  const eligible: number[] = [], lengths: number[] = []
  for (let i = 0; i < segments.length; i += 4) {
    const length = Math.hypot(segments[i + 2] - segments[i], segments[i + 3] - segments[i + 1])
    if (length > 0 && (options.maxLength === undefined || length <= options.maxLength)) {
      eligible.push(i); lengths.push(length)
    }
  }
  const lines = new Float32Array(eligible.length * 4)
  for (let j = 0; j < eligible.length; j++) {
    const i = eligible[j], at = j * 4
    lines[at] = segments[i]; lines[at + 1] = segments[i + 1]
    lines[at + 2] = segments[i + 2]; lines[at + 3] = segments[i + 3]
  }
  const order = eligible.map((_, j) => j).sort((a, b) => lengths[b] - lengths[a] || a - b)
  const size = Math.max(4, tolerance * 2), grid = spatialIndex(lines, size), assigned = new Uint8Array(order.length)
  const result: number[] = [], half = tolerance * .5, angle = Math.sin(2 * Math.PI / 180)
  const visited = new Uint32Array(order.length), nearby: number[] = []
  let seeds = 0, stamp = 0
  for (const seed of order) {
    if (assigned[seed]) continue
    if (seeds && seeds % 4096 === 0 && options.shouldStop?.()) return { lines: new Float32Array(result), count: result.length / 4, stopped: true }
    seeds++
    const i = seed * 4, length = lengths[seed], ux = (lines[i + 2] - lines[i]) / length, uy = (lines[i + 3] - lines[i + 1]) / length
    const nx = -uy, ny = ux, mx = (lines[i] + lines[i + 2]) / 2, my = (lines[i + 1] + lines[i + 3]) / 2
    let t0 = -length / 2, t1 = length / 2, weight = length, offset = 0, oversized = false, changed = true
    assigned[seed] = 1
    while (changed && !oversized) {
      changed = false
      nearby.length = 0
      if (++stamp === 0x100000000) { visited.fill(0); stamp = 1 }
      // Collect before merging: both endpoint windows must use the original t0/t1.
      for (let end = 0; end < 2; end++) {
        const t = end ? t1 : t0
        const x = mx + ux * t, y = my + uy * t
        const x0 = Math.floor((x - tolerance) / size), x1 = Math.floor((x + tolerance) / size)
        const y0 = Math.floor((y - tolerance) / size), y1 = Math.floor((y + tolerance) / size)
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
          const cell = grid.cells.getCell(gx, gy)
          if (cell === undefined) continue
          for (let k = grid.offsets[cell]; k < grid.offsets[cell + 1]; k++) {
            const j = grid.ids[k]
            const id = j / 4
            if (!assigned[id] && visited[id] !== stamp) { visited[id] = stamp; nearby.push(j) }
          }
        }
      }
      for (const j of nearby) {
        const id = j / 4
        if (assigned[id]) continue
        const dx = lines[j + 2] - lines[j], dy = lines[j + 3] - lines[j + 1]
        if (Math.abs(ux * dy - uy * dx) / lengths[id] >= angle) continue
        const ax = lines[j] - mx, ay = lines[j + 1] - my, bx = lines[j + 2] - mx, by = lines[j + 3] - my
        const na = ax * nx + ay * ny, nb = bx * nx + by * ny
        if (Math.max(Math.abs(na), Math.abs(nb)) > half) continue
        const a = ax * ux + ay * uy, b = bx * ux + by * uy, lo = Math.min(a, b), hi = Math.max(a, b)
        if (Math.max(lo - t1, t0 - hi) > half) continue
        assigned[id] = 1
        t0 = Math.min(t0, lo); t1 = Math.max(t1, hi)
        offset += (na + nb) * .5 * lengths[id]; weight += lengths[id]
        if (options.maxLength !== undefined && t1 - t0 > options.maxLength + tolerance) { oversized = true; break }
        changed = true
      }
    }
    if (!oversized && (options.maxLength === undefined || t1 - t0 <= options.maxLength)) {
      const shift = offset / weight
      result.push(mx + ux * t0 + nx * shift, my + uy * t0 + ny * shift, mx + ux * t1 + nx * shift, my + uy * t1 + ny * shift)
    }
  }
  return { lines: new Float32Array(result), count: result.length / 4, stopped: false }
}

export interface VectorRing { center: [number, number]; radius: number; turning: number }

export function detectTemplateRings(segments: Float32Array, tolerance: number): VectorRing[] {
  if (segments.length / 4 > 4096) return []
  const epsilon = Math.max(.02, tolerance * .1), cells = new CellMap<number[]>(), points: Array<[number, number]> = [], edges: number[][] = []
  const node = (x: number, y: number) => {
    const cx = Math.floor(x / epsilon), cy = Math.floor(y / epsilon)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const id of cells.getCell(cx + dx, cy + dy) ?? []) {
      if (Math.hypot(points[id][0] - x, points[id][1] - y) <= epsilon) return id
    }
    const id = points.length, group = cells.getCell(cx, cy) ?? []
    group.push(id); cells.setCell(cx, cy, group); points.push([x, y]); edges.push([])
    return id
  }
  const ends: Array<[number, number]> = []
  for (let i = 0; i < segments.length; i += 4) {
    const a = node(segments[i], segments[i + 1]), b = node(segments[i + 2], segments[i + 3])
    if (a === b) continue
    const id = ends.length; ends.push([a, b]); edges[a].push(id); edges[b].push(id)
  }
  const seen = new Uint8Array(ends.length), arcs: VectorRing[] = []
  const trace = (start: number, first: number) => {
    const chain = [start]
    let at = start, edge = first
    while (!seen[edge]) {
      seen[edge] = 1
      at = ends[edge][0] === at ? ends[edge][1] : ends[edge][0]; chain.push(at)
      if (edges[at].length !== 2) break
      edge = edges[at].find(e => e !== edge)!
    }
    if (chain.length < 7) return
    const closed = chain[0] === chain[chain.length - 1], vertices = closed ? chain.slice(0, -1) : chain
    let turning = 0
    for (let j = closed ? 0 : 1; j < (closed ? vertices.length : vertices.length - 1); j++) {
      const a = points[vertices[(j + vertices.length - 1) % vertices.length]], b = points[vertices[j]], c = points[vertices[(j + 1) % vertices.length]]
      const ax = b[0] - a[0], ay = b[1] - a[1], bx = c[0] - b[0], by = c[1] - b[1]
      const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
      if (Math.abs(angle) > Math.PI / 4 + 1e-6) return
      turning += angle
    }
    if (Math.abs(turning) < 2 * Math.PI / 3) return
    // Center coordinates first to keep Kasa's normal equations well conditioned.
    const mean = vertices.reduce((sum, v) => [sum[0] + points[v][0] / vertices.length, sum[1] + points[v][1] / vertices.length], [0, 0])
    let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0, zz = 0
    for (const v of vertices) {
      const x = points[v][0] - mean[0], y = points[v][1] - mean[1], z = x * x + y * y
      xx += x * x; xy += x * y; yy += y * y; xz += x * z; yz += y * z; zz += z
    }
    const det = xx * yy - xy * xy
    if (det <= 1e-12) return
    const x = (xz * yy - yz * xy) / (2 * det), y = (yz * xx - xz * xy) / (2 * det), radius = Math.sqrt(zz / vertices.length + x * x + y * y)
    const center: [number, number] = [mean[0] + x, mean[1] + y]
    const rms = Math.sqrt(vertices.reduce((sum, v) => sum + (Math.hypot(points[v][0] - center[0], points[v][1] - center[1]) - radius) ** 2, 0) / vertices.length)
    if (rms <= tolerance * .5 && radius >= tolerance * 1.5) arcs.push({ center, radius, turning: Math.abs(turning) })
  }
  edges.forEach((incident, start) => { if (incident.length !== 2) for (const edge of incident) if (!seen[edge]) trace(start, edge) })
  ends.forEach(([start], edge) => { if (!seen[edge]) trace(start, edge) })
  const rings: VectorRing[] = []
  for (const arc of arcs) {
    const ring = rings.find(r => Math.hypot(r.center[0] - arc.center[0], r.center[1] - arc.center[1]) <= tolerance && Math.abs(r.radius - arc.radius) <= tolerance)
    if (ring) {
      const weight = ring.turning + arc.turning
      ring.center = [(ring.center[0] * ring.turning + arc.center[0] * arc.turning) / weight, (ring.center[1] * ring.turning + arc.center[1] * arc.turning) / weight]
      ring.radius = (ring.radius * ring.turning + arc.radius * arc.turning) / weight; ring.turning = weight
    } else rings.push({ ...arc })
  }
  return rings.filter(r => r.turning >= Math.PI * 1.5 - 1e-6).sort((a, b) => b.radius - a.radius)
}

export interface RingCenterVotes {
  centers: Array<{ center: [number, number]; support: number }>; limited: boolean; stopped: boolean
}
export function voteRingCenters(segments: Float32Array, radius: number, tolerance: number,
  options: { shouldStop?: () => boolean; maxVotes?: number } = {}): RingCenterVotes {
  type Cell = { x: number; y: number; weight: number; wx: number; wy: number }
  const size = Math.max(tolerance * .5, .15), grid = new CellMap<Cell>(), cells: Cell[] = []
  const maxVotes = options.maxVotes ?? 800_000
  let votes = 0, limited = false, stopped = false
  for (let i = 0; i < segments.length; i += 4) {
    if (i && i % (4096 * 4) === 0 && options.shouldStop?.()) { stopped = true; break }
    const dx = segments[i + 2] - segments[i], dy = segments[i + 3] - segments[i + 1], length = Math.hypot(dx, dy)
    if (length < .02 || length > radius) continue
    const mx = (segments[i] + segments[i + 2]) / 2, my = (segments[i + 1] + segments[i + 3]) / 2
    const d = Math.sqrt(radius * radius - length * length / 4)
    for (const sign of [1, -1]) {
      if (votes >= maxVotes) { limited = true; break }
      votes++
      const x = mx - sign * d * dy / length, y = my + sign * d * dx / length, cx = Math.floor(x / size), cy = Math.floor(y / size)
      let cell = grid.getCell(cx, cy)
      if (!cell) { cell = { x: cx, y: cy, weight: 0, wx: 0, wy: 0 }; grid.setCell(cx, cy, cell); cells.push(cell) }
      cell.weight += length; cell.wx += x * length; cell.wy += y * length
    }
    if (limited) break
  }
  const candidates: RingCenterVotes['centers'] = []
  for (const cell of cells) {
    let support = 0, wx = 0, wy = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = grid.getCell(cell.x + dx, cell.y + dy)
      if (neighbor) { support += neighbor.weight; wx += neighbor.wx; wy += neighbor.wy }
    }
    if (support >= .6 * 2 * Math.PI * radius) candidates.push({ center: [wx / support, wy / support], support })
  }
  candidates.sort((a, b) => b.support - a.support)
  const centers: RingCenterVotes['centers'] = [], suppression = new CellMap<Array<[number, number]>>(), distance = radius / 2
  for (const candidate of candidates) {
    const [x, y] = candidate.center, cx = Math.floor(x / distance), cy = Math.floor(y / distance)
    let overlap = false
    for (let dy = -1; dy <= 1 && !overlap; dy++) for (let dx = -1; dx <= 1 && !overlap; dx++) {
      overlap = (suppression.getCell(cx + dx, cy + dy) ?? []).some(p => Math.hypot(p[0] - x, p[1] - y) <= distance)
    }
    if (!overlap) {
      centers.push(candidate)
      const group = suppression.getCell(cx, cy) ?? []; group.push(candidate.center); suppression.setCell(cx, cy, group)
    }
  }
  return { centers, limited, stopped }
}

export function spatialIndex(segments: Float32Array, size: number) {
  const cells = new CellMap<number>(), counts: number[] = []
  const lineEnds = new Uint32Array(Math.floor(segments.length / 4) + 1), visits: number[] = []
  const visit = (i: number, fn: (x: number, y: number) => void) => {
    const x0 = segments[i] / size, y0 = segments[i + 1] / size
    const x1 = segments[i + 2] / size, y1 = segments[i + 3] / size
    let x = Math.floor(x0), y = Math.floor(y0)
    const ex = Math.floor(x1), ey = Math.floor(y1), dx = x1 - x0, dy = y1 - y0
    const sx = Math.sign(dx), sy = Math.sign(dy)
    let tx = dx ? (x + (sx > 0 ? 1 : 0) - x0) / dx : Infinity
    let ty = dy ? (y + (sy > 0 ? 1 : 0) - y0) / dy : Infinity
    fn(x, y)
    while (x !== ex || y !== ey) {
      // Do not step beyond an endpoint cell when the endpoint lies exactly on
      // a grid edge; negative directions otherwise overshoot at t=1.
      if (y === ey || (x !== ex && tx < ty)) { x += sx; tx += 1 / Math.abs(dx) }
      else if (x === ex || ty < tx) { y += sy; ty += 1 / Math.abs(dy) }
      else { x += sx; y += sy; tx += 1 / Math.abs(dx); ty += 1 / Math.abs(dy) }
      fn(x, y)
    }
  }
  const countCell = (x: number, y: number) => {
    let c = cells.getCell(x, y)
    if (c === undefined) { c = counts.length; cells.setCell(x, y, c); counts.push(0) }
    counts[c]++
    visits.push(c)
  }
  for (let i = 0; i + 3 < segments.length; i += 4) {
    visit(i, countCell)
    lineEnds[i / 4 + 1] = visits.length
  }
  const offsets = new Uint32Array(counts.length + 1)
  for (let i = 0; i < counts.length; i++) offsets[i + 1] = offsets[i] + counts[i]
  const ids = new Uint32Array(offsets[counts.length]), cursors = offsets.slice(0, -1)
  // Replay the recorded cell ids without retracing or hashing each line twice.
  for (let line = 0; line + 1 < lineEnds.length; line++) for (let k = lineEnds[line]; k < lineEnds[line + 1]; k++) {
    const c = visits[k]
    ids[cursors[c]++] = line * 4
  }
  return { cells, offsets, ids }
}

export function gridLines(grid: ReturnType<typeof spatialIndex>, size: number, r: Rect): Set<number> {
  const result = new Set<number>()
  const x0 = Math.floor(r[0] / size), x1 = Math.floor(r[2] / size), y0 = Math.floor(r[1] / size), y1 = Math.floor(r[3] / size)
  const add = (c: number) => { for (let k = grid.offsets[c]; k < grid.offsets[c + 1]; k++) result.add(grid.ids[k]) }
  // Very large bounds should cost occupied cells rather than empty page area.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > grid.cells.size + grid.cells.overflow.size) {
    const occupied: number[] | undefined = grid.cells.overflow.size ? [] : undefined
    for (const [key, c] of grid.cells) {
      const x = cellX(key), y = cellY(key)
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { if (occupied) occupied.push(c); else add(c) }
    }
    for (const [key, c] of grid.cells.overflow) {
      const comma = key.indexOf(','), x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1))
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) occupied!.push(c)
    }
    // Cell ids retain the original interleaved insertion order across both maps.
    if (occupied) for (const c of occupied.sort((a, b) => a - b)) add(c)
  } else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = grid.cells.getCell(x, y)
    if (c !== undefined) add(c)
  }
  return result
}

