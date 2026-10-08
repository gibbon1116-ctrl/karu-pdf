import type { Rect } from './annotations'

export interface SymbolLabel { text: string; rect: Rect }
export interface SymbolLabelValue { label: string; gc: boolean }
export function normalizeSymbolLabel(text: string): string | null {
  const normalized = text.normalize('NFKC').toUpperCase()
  return /^[0-9A-Z]{1,6}$/.test(normalized) && !/^\d+$/.test(normalized) ? normalized : null
}
export function rectDistance(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]))
}
/** Each word belongs to one nearest body. Intersection has distance zero and wins. */
export function assignSymbolLabels(labels: SymbolLabel[], bodies: readonly { rect: Rect }[], radius: number, splitG = true): SymbolLabelValue[] {
  const words: string[][] = bodies.map(() => []), values = bodies.map(() => ({ label: '', gc: false }))
  for (const word of labels) {
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
    if (splitG && (text === 'G' || (text.length >= 3 && text.endsWith('G')))) {
      values[nearest].gc = true; text = text.slice(0, -1)
    }
    if (text) words[nearest].push(text)
  }
  values.forEach((v, i) => { v.label = words[i].sort().join('+') })
  return values
}
