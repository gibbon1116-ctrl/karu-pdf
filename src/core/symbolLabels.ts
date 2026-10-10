import type { Rect } from './annotations'

export interface SymbolLabel { text: string; rect: Rect }
export interface SymbolLabelValue { label: string; gc: boolean }
/** Transient search group only; cannot be returned by normalizeSymbolLabel. */
export const UNKNOWN_SYMBOL_LABEL = '?'
export const symbolLabelDisplay = (label:string) => label===UNKNOWN_SYMBOL_LABEL?'添字を判定できない':label||'添字なし'
export function normalizeSymbolLabel(text: string): string | null {
  const normalized = text.normalize('NFKC').toUpperCase()
  const length = Array.from(normalized).length
  return length >= 1 && length <= 12 && !/\s/u.test(normalized)
    && /[\p{L}\p{N}]/u.test(normalized) ? normalized : null
}
/** Collapse overprinted words before ownership is decided. Keep spatially distinct copies. */
export function deduplicateSymbolLabels(labels: readonly SymbolLabel[]): SymbolLabel[] {
  const result: SymbolLabel[] = [], cells = new Map<string, Array<{ x: number; y: number }>>()
  for (const word of labels) {
    const text = normalizeSymbolLabel(word.text)
    if (!text) continue
    const x = (word.rect[0] + word.rect[2]) / 2, y = (word.rect[1] + word.rect[3]) / 2
    const cx = Math.floor(x / .3), cy = Math.floor(y / .3)
    let duplicate = false
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (cells.get(`${text}:${cx + dx}:${cy + dy}`)?.some(p => Math.hypot(p.x - x, p.y - y) <= .3)) duplicate = true
    }
    if (duplicate) continue
    const key = `${text}:${cx}:${cy}`, bucket = cells.get(key)
    if (bucket) bucket.push({ x, y }); else cells.set(key, [{ x, y }])
    result.push({ text, rect: word.rect })
  }
  return result
}
export function rectDistance(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]))
}
/** Each word belongs to one nearest body. Intersection has distance zero and wins. */
export function assignSymbolLabels(labels: SymbolLabel[], bodies: readonly { rect: Rect }[], radius: number, splitG = true): SymbolLabelValue[] {
  const words: Array<Array<{ text: string; distance: number }>> = bodies.map(() => [])
  const values = bodies.map(() => ({ label: '', gc: false }))
  for (const word of deduplicateSymbolLabels(labels)) {
    let nearest = -1, distance = Infinity, overlapping = false
    for (let i = 0; i < bodies.length; i++) {
      const r = bodies[i].rect, d = rectDistance(word.rect, r)
      const overlap = word.rect[0] < r[2] && word.rect[2] > r[0] && word.rect[1] < r[3] && word.rect[3] > r[1]
      if (d <= radius && ((overlap && !overlapping) || (overlap === overlapping && d < distance))) {
        nearest = i; distance = d; overlapping = overlap
      }
    }
    if (nearest < 0) continue
    let text = word.text
    if (splitG && (text === 'G' || (text.length >= 3 && text.endsWith('G') && /^[0-9A-Z]+$/.test(text.slice(0, -1))))) {
      values[nearest].gc = true; text = text.slice(0, -1)
    }
    if (text) words[nearest].push({ text, distance })
  }
  values.forEach((v, i) => {
    const d0 = words[i].reduce((d, word) => word.text === 'G' ? d : Math.min(d, word.distance), Infinity)
    v.label = words[i].filter(word => word.text === 'G' || word.distance <= d0 + .5).map(word => word.text).sort().join('+')
  })
  return values
}
