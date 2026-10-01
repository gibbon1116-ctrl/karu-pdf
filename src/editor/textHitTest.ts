import type { Point, Rect } from '../core/annotations'

const INDEX_THRESHOLD = 2_000
const BUCKET_HEIGHT = 20
const indexes = new WeakMap<readonly Rect[], Map<number, readonly Rect[]>>()

function buildIndex(lines: readonly Rect[]): Map<number, readonly Rect[]> {
  const mutable = new Map<number, Rect[]>()
  for (const line of lines) {
    const first = Math.floor(Math.min(line[1], line[3]) / BUCKET_HEIGHT)
    const last = Math.floor(Math.max(line[1], line[3]) / BUCKET_HEIGHT)
    for (let bucket = first; bucket <= last; bucket += 1) {
      const entries = mutable.get(bucket)
      if (entries) entries.push(line)
      else mutable.set(bucket, [line])
    }
  }
  return mutable
}

function candidates(lines: readonly Rect[], y: number, padding: number): readonly Rect[] {
  if (lines.length <= INDEX_THRESHOLD) return lines
  let index = indexes.get(lines)
  if (!index) {
    index = buildIndex(lines)
    indexes.set(lines, index)
  }
  const first = Math.floor((y - padding) / BUCKET_HEIGHT)
  const last = Math.floor((y + padding) / BUCKET_HEIGHT)
  if (first === last) return index.get(first) ?? []
  const result: Rect[] = []
  const seen = new Set<Rect>()
  for (let bucket = first; bucket <= last; bucket += 1) {
    for (const line of index.get(bucket) ?? []) {
      if (!seen.has(line)) {
        seen.add(line)
        result.push(line)
      }
    }
  }
  return result
}

export function hitTextLine(lines: readonly Rect[], point: Point, padding = 1): boolean {
  for (const line of candidates(lines, point[1], padding)) {
    const left = Math.min(line[0], line[2]) - padding
    const top = Math.min(line[1], line[3]) - padding
    const right = Math.max(line[0], line[2]) + padding
    const bottom = Math.max(line[1], line[3]) + padding
    if (point[0] >= left && point[0] <= right && point[1] >= top && point[1] <= bottom) return true
  }
  return false
}
