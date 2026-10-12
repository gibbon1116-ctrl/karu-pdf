import { parseLocation } from './location'
import { validCondition } from './quantity'
export interface CountComponent { itemId: string; count: number; condition?: string }
export type CountMark = { version: 1; id: string; group: string } | { version: 2; id: string; fixtureId: string; floor?: string; room?: string; condition?: string; extra?: CountComponent[] }
export function legacyCountFixtureId(group: string): string {
  let a = 2166136261, b = 5381
  for (let i = 0; i < group.length; i++) { a = Math.imul(a ^ group.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ group.charCodeAt(i) }
  return `legacy:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
export function countFixtureId(mark: CountMark): string { return mark.version === 2 ? mark.fixtureId : legacyCountFixtureId(mark.group) }
export function validCountComponents(mainId: string, extra: readonly CountComponent[]): boolean {
  if (!Array.isArray(extra) || extra.length > 10) return false
  const ids = new Set<string>()
  for (const e of extra) {
    if (!e || typeof e !== 'object' || typeof e.itemId !== 'string'
      || e.itemId.length < 1 || e.itemId.length > 80 || e.itemId === mainId || ids.has(e.itemId)
      || !Number.isInteger(e.count) || e.count < 1 || e.count > 99
      || e.condition !== undefined && !validCondition(e.condition)) return false
    ids.add(e.itemId)
  }
  return true
}
export function countMembers(mark: CountMark): CountComponent[] {
  return [
    { itemId: countFixtureId(mark), count: 1, ...(mark.version === 2 && mark.condition !== undefined ? { condition: mark.condition } : {}) },
    ...(mark.version === 2 ? mark.extra ?? [] : []).map(e => ({ ...e })),
  ]
}
export function parseCount(raw: string | null): CountMark | null {
  try {
    if (!raw || raw.length > 2400) return null
    const v = JSON.parse(raw)
    if (typeof v.id !== 'string' || !v.id || v.id.length > 80) return null
    if (v.version === 2 && typeof v.fixtureId === 'string' && v.fixtureId && v.fixtureId.length <= 80) {
      const location = parseLocation(v)
      if (!location || v.condition !== undefined && !validCondition(v.condition)) return null
      const extra = v.extra !== undefined && validCountComponents(v.fixtureId, v.extra) && v.extra.length
        ? v.extra.map((e: CountComponent) => ({ itemId: e.itemId, count: e.count, ...(e.condition !== undefined ? { condition: e.condition } : {}) }))
        : undefined
      return { version: 2, id: v.id, fixtureId: v.fixtureId, ...location, ...(v.condition !== undefined ? { condition: v.condition } : {}), ...(extra ? { extra } : {}) }
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
