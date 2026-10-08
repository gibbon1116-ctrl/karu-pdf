import { parseLocation } from './location'
import { validCondition } from './quantity'
export type CountMark = { version: 1; id: string; group: string } | { version: 2; id: string; fixtureId: string; floor?: string; room?: string; condition?: string }
export function legacyCountFixtureId(group: string): string {
  let a = 2166136261, b = 5381
  for (let i = 0; i < group.length; i++) { a = Math.imul(a ^ group.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ group.charCodeAt(i) }
  return `legacy:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
export function countFixtureId(mark: CountMark): string { return mark.version === 2 ? mark.fixtureId : legacyCountFixtureId(mark.group) }
export function parseCount(raw: string | null): CountMark | null {
  try {
    if (!raw || raw.length > 400) return null
    const v = JSON.parse(raw)
    if (typeof v.id !== 'string' || !v.id || v.id.length > 80) return null
    if (v.version === 2 && typeof v.fixtureId === 'string' && v.fixtureId && v.fixtureId.length <= 80) {
      const location = parseLocation(v)
      if (!location || v.condition !== undefined && !validCondition(v.condition)) return null
      return { version: 2, id: v.id, fixtureId: v.fixtureId, ...location, ...(v.condition !== undefined ? { condition: v.condition } : {}) }
    }
    return v.version === 1 && typeof v.group === 'string' && v.group.trim().length > 0 && v.group.length <= 80 ? { version: 1, id: v.id, group: v.group } : null
  } catch { return null }
}
export function countSummary(items: readonly { pageIndex: number; count?: CountMark | null }[]): { group: string; pageIndex: number; total: number }[] {
  const totals = new Map<string, { group: string; pageIndex: number; total: number }>()
  for (const a of items) if (a.count) {
    const group = a.count.version === 1 ? a.count.group : a.count.fixtureId
    const key = JSON.stringify([group, a.pageIndex]), previous = totals.get(key)
    if (previous) previous.total++
    else totals.set(key, { group, pageIndex: a.pageIndex, total: 1 })
  }
  return [...totals.values()].sort((a, b) => a.group.localeCompare(b.group, 'ja') || a.pageIndex - b.pageIndex)
}
