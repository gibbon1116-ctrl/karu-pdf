/** Normalize only recognized floor notation; preserve free-form location names. */
export function normalizeFloor(text: string): string {
  const original = text.trim(), t = original.normalize('NFKC').toUpperCase()
  let m: RegExpMatchArray | null
  if ((m = t.match(/^(?:B|地下)(\d+)(?:F|階)?$/))) return 'B' + Number(m[1]) + '階'
  if ((m = t.match(/^(\d+)(?:F|階)$/))) return Number(m[1]) + '階'
  if (/^(RF|R階|屋上(?:階)?|屋階)$/.test(t)) return 'RF'
  if ((m = t.match(/^PH(\d+)(?:F|階)?$/))) return 'PH' + Number(m[1]) + '階'
  if ((m = t.match(/^(?:M|中)(\d+)(?:F|階)?$/))) return 'M' + Number(m[1]) + '階'
  return original
}
export function floorFromDrawingName(name: string): string | undefined {
  const t = name.normalize('NFKC').toUpperCase()
  // A shared suffix in a range/list does not describe a single floor.
  if (/(?:\d|RF|階|F)\s*(?:[・、,~〜～\-–—]|から|及び|および|と|\/)\s*(?:\d|B\d|地下\d|PH\d|M\d|RF)/.test(t)) return undefined
  const matches = [...t.matchAll(/(?<![A-Z0-9])(?:PH\d+(?:階|F)?|(?:B|地下)\d+(?:階|F)|(?:M|中)\d+(?:階|F)|\d+(?:階|F)|RF|R階|屋上階?|屋階)(?![A-Z0-9])/g)]
  return matches.length === 1 ? normalizeFloor(matches[0][0]) : undefined
}
/** Invalid optional location values reject the mark, as with its other fields. */
export function parseLocation(v: Record<string, unknown>): { floor?: string; room?: string } | null {
  const result: { floor?: string; room?: string } = {}
  for (const key of ['floor', 'room'] as const) {
    if (v[key] === undefined) continue
    if (typeof v[key] !== 'string' || v[key].length > 40) return null
    const text = v[key].trim()
    if (text) result[key] = text
  }
  return result
}
