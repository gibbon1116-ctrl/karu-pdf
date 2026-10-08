import { fixtureCode, nextCountStyle, nextQuantityLineStyle, quantityMethod, type CountFixture } from '../core/countFixtures'
import { validRouteCount, validRouteScope, validRouteConditions, normalizeRouteConditions, conditionSuffix, parseQuantityMark, serializeQuantityMark, type RouteScope, type RouteConditions } from '../core/quantity'

export interface RouteSetItem { code: string; spec?: string; name: string; category: string; count: number; cond?: RouteConditions }
export interface RouteSet { id: string; name: string; items: RouteSetItem[] }
const key = 'karu-pdf:route-sets'
const listeners = new Set<() => void>()
export const subscribeRouteSets = (listener: () => void) => {
  listeners.add(listener)
  const changed = (e: StorageEvent) => { if (e.key === key || e.key === null) listener() }
  if (typeof window !== 'undefined') window.addEventListener('storage', changed)
  return () => { listeners.delete(listener); if (typeof window !== 'undefined') window.removeEventListener('storage', changed) }
}
export const routeSetsSnapshot = () => { try { return localStorage.getItem(key) ?? '[]' } catch { return '[]' } }
const validItem = (v: RouteSetItem) => v && typeof v.code === 'string' && v.code.length <= 16 && (v.spec === undefined || typeof v.spec === 'string' && v.spec.length <= 40) && typeof v.name === 'string' && !!v.name.trim() && v.name.length <= 80 && typeof v.category === 'string' && !!v.category.trim() && v.category.length <= 40 && validRouteCount(v.count) && (v.cond === undefined || validRouteConditions(v.cond))
const identity = (v: Pick<RouteSetItem, 'code' | 'spec' | 'name'>) => JSON.stringify([v.code, v.spec ?? '', v.name])
function validSet(v: RouteSet): boolean {
  return !!v && typeof v.id === 'string' && !!v.id && typeof v.name === 'string' && !!v.name.trim() && v.name.length <= 40 && Array.isArray(v.items) && v.items.length >= 1 && v.items.length <= 11 && v.items.every(validItem) && new Set(v.items.map(identity)).size === v.items.length
}
function readSet(value: unknown): RouteSet | null {
  if (!value || typeof value !== 'object') return null
  const v = value as RouteSet & { items: Array<RouteSetItem & { scope?: RouteScope }> }
  if (!Array.isArray(v.items)) return null
  const items: RouteSetItem[] = []
  for (const e of v.items) {
    if (!e || e.cond === undefined && e.scope !== undefined && !validRouteScope(e.scope)) return null
    const q = parseQuantityMark(JSON.stringify({ version: 1, id: 'set', itemId: 'set', method: 'polyline', cond: e.cond, scope: e.scope }))
    if (!q) return null
    const { scope: _scope, ...item } = e
    items.push({ ...item, cond: q.cond })
  }
  const result = { ...v, items }
  return validSet(result) ? result : null
}
export function loadRouteSets(): RouteSet[] {
  try { const v: unknown = JSON.parse(routeSetsSnapshot()); return Array.isArray(v) ? v.map(readSet).filter((s): s is RouteSet => !!s).filter(validSet).filter((s, i, all) => all.findIndex(x => x.id === s.id) === i).slice(0, 50) : [] } catch { return [] }
}
export function saveRouteSets(sets: readonly RouteSet[]): void {
  try { localStorage.setItem(key, JSON.stringify(sets.filter(validSet).slice(0, 50).map(set => ({ ...set, items: set.items.map(e => {
      const wire = JSON.parse(serializeQuantityMark({ version: 1, id: 'set', itemId: 'set', method: 'polyline', cond: e.cond }))
      return { ...e, cond: wire.cond }
    }) })))); listeners.forEach(l => l()) } catch { /* Browser storage is optional. */ }
}
export const scopeShort = (scope?: RouteScope | 'custom') => scope === 'custom' ? '個別' : scope === 'rise' ? '立上りのみ' : scope === 'noSlack' ? '平面＋立上り' : '全長'
export const scopeSuffix = (scope?: RouteScope | 'custom') => scope === 'custom' ? '（個別）' : scope === 'rise' ? '（立上り）' : scope === 'noSlack' ? '（平面＋立上り）' : ''
export function routeConditionSummary(cond: RouteConditions = {}): string {
  return conditionSuffix(cond, true)
}
export const routeSetSummary = (set: Pick<RouteSet, 'items'>) => set.items.map(e => fixtureCode(e) + (e.count === 1 ? '' : '×' + e.count) + routeConditionSummary(e.cond)).join('＋')
export function resolveRouteSet(set: RouteSet, fixtures: readonly CountFixture[]): { items: Array<{ itemId: string; count: number; cond?: RouteConditions }>; newFixtures: CountFixture[] } {
  if (!validSet(set)) throw new Error('構成の内容が正しくありません。')
  const newFixtures: CountFixture[] = [], available = [...fixtures]
  const items = set.items.map(e => {
    let f = available.find(f => quantityMethod(f) === 'polyline' && identity(f) === identity(e))
    if (!f) {
      const appearance = nextQuantityLineStyle(available)
      f = { id: crypto.randomUUID(), code: e.code, spec: e.spec, name: e.name, category: e.category, kind: 'length', method: 'polyline', aggregation: 'document', order: available.reduce((n, f) => Math.max(n, f.order + 1), 0), style: { ...nextCountStyle([]), color: appearance.color }, line: appearance.line }
      available.push(f); newFixtures.push(f)
    }
    return { itemId: f.id, count: e.count, cond: normalizeRouteConditions(e.cond ?? f.routeDefaults) }
  })
  return { items, newFixtures }
}
