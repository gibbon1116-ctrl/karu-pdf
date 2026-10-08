import { parseLocation } from './location'
import type { Point } from './annotations'
import { polygonArea, polylineLength } from './measure'
import { QUANTITY_METHODS, type QuantityMethod, type QuantityLineStyle } from './countFixtures'

export type RouteScope = 'all' | 'noSlack' | 'rise'
export const ROUTE_SCOPES: Record<RouteScope, string> = { all: '全長（平面＋立上り＋余長）', noSlack: '平面＋立上り', rise: '立上り・立下りのみ' }
export function validRouteScope(value: unknown): value is RouteScope { return value === 'all' || value === 'noSlack' || value === 'rise' }
export type RoutePart = 'plan' | 'rise' | 'slack'
/** undefined: counted, unset / string: counted with condition / null: excluded. */
export type PartCondition = string | null | undefined
export interface RouteConditions {
  plan?: string | null
  // Explicit undefined slots are needed when rises are added or one slot is cleared.
  rise?: string | null | PartCondition[]
  slack?: string | null
}
export interface Rise { m: number; at?: number }
export interface QuantityMark {
  version: 1; id: string; itemId: string; method: Exclude<QuantityMethod, 'click'>
  floor?: string; room?: string; count?: number; cond?: RouteConditions; extra?: Array<{ itemId: string; count: number; cond?: RouteConditions }>
  rises?: Rise[]; condition?: string
  addM?: number; slackM?: number; heightM?: number; widthM?: number; depthM?: number
}
export function validCondition(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 30 && v.trim() === v && !/[\r\n\u2028\u2029]/.test(v)
}
const validPartCondition = (v: unknown) => v === undefined || v === null || validCondition(v)
export function validRouteConditions(v: unknown): v is RouteConditions {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const c = v as RouteConditions
  return validPartCondition(c.plan) && validPartCondition(c.slack) && (Array.isArray(c.rise)
    ? c.rise.length <= 20 && Array.from(c.rise).every(validPartCondition) : validPartCondition(c.rise))
}
export function normalizeRouteConditions(c: RouteConditions = {}): RouteConditions {
  return { ...(c.plan !== undefined ? { plan: c.plan } : {}), ...(c.rise !== undefined ? { rise: Array.isArray(c.rise) ? Array.from(c.rise) : c.rise } : {}), ...(c.slack !== undefined ? { slack: c.slack } : {}) }
}
export function conditionsFromScope(scope?: RouteScope): RouteConditions {
  return scope === 'rise' ? { plan: null, slack: null } : scope === 'noSlack' ? { slack: null } : {}
}
/** The temporary scope selector describes counted parts, independently of condition names. */
export function conditionScope(c: RouteConditions = {}): RouteScope | 'custom' {
  if (c.rise === null || Array.isArray(c.rise) && c.rise.some(v => v === null)) return 'custom'
  if (c.plan === null) return c.slack === null ? 'rise' : 'custom'
  return c.slack === null ? 'noSlack' : 'all'
}
export function withRouteScope(c: RouteConditions, scope: RouteScope, remembered: RouteConditions = {}): RouteConditions {
  const counted = (v: PartCondition, previous: PartCondition) => v === null ? typeof previous === 'string' ? previous : undefined : v
  return normalizeRouteConditions({ plan: scope === 'rise' ? null : counted(c.plan, remembered.plan),
    rise: Array.isArray(c.rise) ? c.rise.map((v, i) => counted(v, riseCondition(remembered, i))) : counted(c.rise, Array.isArray(remembered.rise) ? undefined : remembered.rise),
    slack: scope === 'all' ? counted(c.slack, remembered.slack) : null })
}
export function validRises(v: unknown): v is Rise[] {
  return Array.isArray(v) && v.length <= 20 && Array.from(v).every(r => r && typeof r === 'object' && typeof r.m === 'number' && Number.isFinite(r.m) && r.m >= 0 && r.m <= 1000
    && Math.abs(r.m * 100 - Math.round(r.m * 100)) < 1e-8 && (r.at === undefined || Number.isInteger(r.at) && r.at >= 0))
}
export function routeRises(mark: Pick<QuantityMark, 'rises' | 'addM'>): Rise[] { return mark.rises ?? (mark.addM ? [{ m: mark.addM }] : []) }
export function riseTotal(rises: readonly Rise[]): number {
  // The old addM parser accepted arbitrary precision; preserve its singleton exactly.
  return rises.length === 1 ? rises[0].m : Number(rises.reduce((n, r) => n + r.m, 0).toFixed(10))
}
export function routeMembers(mark: QuantityMark): Array<{ itemId: string; count: number; cond: RouteConditions }> {
  return [{ itemId: mark.itemId, count: mark.count ?? 1, cond: mark.cond ?? {} }, ...(mark.extra ?? []).map(e => ({ ...e, cond: e.cond ?? {} }))]
}
export function riseCondition(cond: RouteConditions, i: number): PartCondition { return Array.isArray(cond.rise) ? cond.rise[i] : cond.rise }
export interface RoutePortion { part: RoutePart; riseIndex?: number; lengthM: number; condition?: string }
export function routePortions(planM: number, mark: Pick<QuantityMark, 'rises' | 'addM' | 'slackM'>, member: RouteConditions): RoutePortion[] {
  const result: RoutePortion[] = []
  const add = (part: RoutePart, lengthM: number, condition: PartCondition, riseIndex?: number) => {
    if (lengthM > 0 && condition !== null) result.push({ part, lengthM, ...(riseIndex !== undefined ? { riseIndex } : {}), ...(condition !== undefined ? { condition } : {}) })
  }
  add('plan', planM, member.plan)
  routeRises(mark).forEach((r, i) => add('rise', r.m, riseCondition(member, i), i))
  add('slack', mark.slackM ?? 0, member.slack)
  return result
}
export function routeMemberLength(planM: number, mark: Pick<QuantityMark, 'rises' | 'addM' | 'slackM'>, cond: RouteConditions = {}): number {
  return routePortions(planM, mark, cond).reduce((n, p) => n + p.lengthM, 0)
}
export const QUANTITY_DIMENSIONS = { heightM: '高さ', widthM: '幅', depthM: '深さ' } as const
export function quantityDimensions(method: QuantityMethod): readonly (keyof typeof QUANTITY_DIMENSIONS)[] {
  return method === 'lengthHeight' ? ['heightM'] : method === 'polygonDepth' ? ['depthM'] : method === 'lengthWidthDepth' ? ['widthM', 'depthM'] : []
}
export function parseQuantityMark(raw: string | null): QuantityMark | null {
  if (!raw || raw.length > 8000) return null
  try {
    const v = JSON.parse(raw)
    if (!v || v.version !== 1 || !['id', 'itemId'].every(k => typeof v[k] === 'string' && v[k].length >= 1 && v[k].length <= 80)
      || !Object.values(QUANTITY_METHODS).flat().filter(m => m !== 'click').includes(v.method)) return null
    const result: QuantityMark = { version: 1, id: v.id, itemId: v.itemId, method: v.method }
    for (const k of ['addM', 'heightM', 'widthM', 'depthM'] as const) {
      if (v[k] === undefined || k === 'addM' && v.method === 'polyline' && v.rises !== undefined) continue
      if (typeof v[k] !== 'number' || !Number.isFinite(v[k]) || v[k] < 0 || v[k] > 1000) return null
      result[k] = v[k]
    }
    const location = parseLocation(v)
    if (!location) return null
    Object.assign(result, location)
    if (v.method === 'polyline') {
      if (v.slackM !== undefined) {
        if (typeof v.slackM !== 'number' || !Number.isFinite(v.slackM) || v.slackM < 0 || v.slackM > 1000) return null
        if (v.slackM) result.slackM = v.slackM
      }
      if (v.rises !== undefined) {
        if (!validRises(v.rises)) return null
        result.rises = v.rises.map((r: Rise) => ({ m: r.m, ...(r.at !== undefined ? { at: r.at } : {}) }))
        result.addM = riseTotal(result.rises!)
      } else if (result.addM) result.rises = [{ m: result.addM }]
      const cond = readConditions(v)
      if (!cond) return null
      result.cond = cond
      if (v.count !== undefined) { if (!validRouteCount(v.count)) return null; if (v.count !== 1) result.count = v.count }
      if (v.extra !== undefined) {
        if (!Array.isArray(v.extra) || v.extra.length > 10) return null
        const ids = new Set([v.itemId])
        for (const e of v.extra) {
          if (!e || typeof e.itemId !== 'string' || !e.itemId || e.itemId.length > 80 || ids.has(e.itemId) || !validRouteCount(e.count) || !readConditions(e)) return null
          ids.add(e.itemId)
        }
        if (v.extra.length) result.extra = v.extra.map((e: { itemId: string; count: number; cond?: unknown; scope?: unknown }) => ({ itemId: e.itemId, count: e.count, cond: readConditions(e)! }))
      }
    }
    if (v.method !== 'polyline' && v.condition !== undefined) {
      if (!validCondition(v.condition)) return null
      result.condition = v.condition
    }
    return result
  } catch { return null }
}
function readConditions(v: { cond?: unknown; scope?: unknown }): RouteConditions | null {
  if (v.cond === undefined) return v.scope === undefined || validRouteScope(v.scope) ? conditionsFromScope(v.scope) : null
  if (!v.cond || typeof v.cond !== 'object' || Array.isArray(v.cond)) return null
  const wire = v.cond as RouteConditions & { riseUnset?: unknown }
  const c = { ...wire }
  if (wire.riseUnset !== undefined) {
    if (!Array.isArray(wire.rise) || !Array.isArray(wire.riseUnset) || wire.riseUnset.some(i => !Number.isInteger(i) || i < 0 || i >= (wire.rise as unknown[]).length || (wire.rise as unknown[])[i] !== null)) return null
    c.rise = [...wire.rise]
    for (const i of wire.riseUnset) c.rise[i] = undefined
  }
  return validRouteConditions(c) ? normalizeRouteConditions(c) : null
}
function wireConditions(c: RouteConditions = {}): object | undefined {
  const result: RouteConditions & { riseUnset?: number[] } = normalizeRouteConditions(c)
  if (Array.isArray(result.rise)) {
    const unset = Array.from(result.rise, (v, i) => v === undefined ? i : -1).filter(i => i >= 0)
    if (unset.length) { result.rise = result.rise.map(v => v === undefined ? null : v); result.riseUnset = unset }
  }
  return Object.keys(result).length ? result : undefined
}
export function routeConditionsKey(c: RouteConditions = {}): string { return JSON.stringify(wireConditions(c) ?? {}) }
export function serializeQuantityMark(mark: QuantityMark): string {
  const { cond: supplied, rises, extra, scope: legacyScope, ...base } = mark as QuantityMark & { scope?: RouteScope }
  if (mark.method !== 'polyline') return JSON.stringify(base)
  const cond = supplied === undefined ? conditionsFromScope(legacyScope) : supplied
  if (supplied !== undefined && !validRouteConditions(supplied) || supplied === undefined && legacyScope !== undefined && !validRouteScope(legacyScope)) throw new Error('経路の施工条件が不正です。')
  for (const e of extra ?? []) {
    const legacy = e as { scope?: RouteScope }
    if (e.cond !== undefined && !validRouteConditions(e.cond) || e.cond === undefined && legacy.scope !== undefined && !validRouteScope(legacy.scope)) throw new Error('経路の施工条件が不正です。')
  }
  const rs = routeRises(mark), total = riseTotal(rs)
  // Legacy scope approximates unsupported masks: old apps can count excluded rises/plan.
  // Old apps also reject addM > 1000 or JSON > 2000; the new reader supports all 20 rises.
  const scope = (c: RouteConditions = {}): Exclude<RouteScope, 'all'> | undefined => c.plan === null && c.slack === null ? 'rise' : c.slack === null ? 'noSlack' : undefined
  return JSON.stringify({ ...base, ...(rises !== undefined || mark.addM !== undefined ? { addM: total } : {}),
    // A zero singleton needs its array: addM=0 alone cannot preserve an explicit rise.
    ...(rises && (rises.length !== 1 || rises[0].at !== undefined || rises[0].m === 0) ? { rises } : {}),
    cond: wireConditions(cond), scope: scope(cond), extra: extra?.map(e => ({ itemId: e.itemId, count: e.count, cond: wireConditions(e.cond ?? conditionsFromScope((e as { scope?: RouteScope }).scope)), scope: scope(e.cond ?? conditionsFromScope((e as { scope?: RouteScope }).scope)) })) })
}
export function validRouteCount(n: unknown): n is number { return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99 }
export function quantityPoints(method: QuantityMark['method']): 'polyline' | 'polygon' {
  return method === 'polygon' || method === 'polygonDepth' ? 'polygon' : 'polyline'
}
export function quantityValue(points: readonly Point[], mmPerPoint: number, mark: QuantityMark): number {
  const length = polylineLength(points) * mmPerPoint / 1000
  const area = polygonArea(points) * mmPerPoint ** 2 / 1e6
  switch (mark.method) {
    case 'polyline': return routeMemberLength(length, mark)
    case 'polygon': return area
    case 'lengthHeight': return length * (mark.heightM ?? 0)
    case 'polygonDepth': return area * (mark.depthM ?? 0)
    case 'lengthWidthDepth': return length * (mark.widthM ?? 0) * (mark.depthM ?? 0)
  }
}
const number = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function quantityLabel(points: readonly Point[], mmPerPoint: number, mark: QuantityMark & { scope?: RouteScope }, code: string, showCode: boolean, extraCode: (id: string) => string = id => id): string {
  if (mark.cond === undefined && mark.scope !== undefined) mark = { ...mark, cond: conditionsFromScope(mark.scope) }
  const length = number(polylineLength(points) * mmPerPoint / 1000)
  const area = number(polygonArea(points) * mmPerPoint ** 2 / 1e6)
  const value = quantityDimensions(mark.method).some(key => mark[key] === undefined) ? '?' : number(quantityValue(points, mmPerPoint, mark))
  const dimension = (key: keyof typeof QUANTITY_DIMENSIONS) => mark[key] === undefined ? '?' : number(mark[key])
  const addM = riseTotal(routeRises(mark))
  let label: string
  switch (mark.method) {
    case 'polyline': label = `${addM || mark.slackM ? `${length}${addM ? '+' + number(addM) : ''}${mark.slackM ? '+余' + number(mark.slackM) : ''}=` : ''}${value} m`; break
    case 'polygon': label = `${value} m²`; break
    case 'lengthHeight': label = `${length}×H${dimension('heightM')}=${value} m²`; break
    case 'polygonDepth': label = `${area}×D${dimension('depthM')}=${value} m³`; break
    case 'lengthWidthDepth': label = `${length}×W${dimension('widthM')}×D${dimension('depthM')}=${value} m³`; break
  }
  if (mark.method === 'polyline' && ((mark.count ?? 1) !== 1 || mark.extra?.length)) {
    const codes = routeMembers(mark).map((e, i) => (i === 0 ? code : extraCode(e.itemId)) + conditionSuffix(e.cond) + (e.count === 1 ? '' : '×' + e.count)).join(', ')
    return showCode && codes ? codes + '  ' + label : label
  }
  return showCode && code ? `${code}${mark.method === 'polyline' ? conditionSuffix(mark.cond) : ''} ${label}` : label
}
export function conditionSuffix(cond: RouteConditions = {}): string {
  if (cond.plan === null) return '（立上り）'
  const names = [...new Set([cond.plan, ...(Array.isArray(cond.rise) ? cond.rise : [cond.rise])].filter((v): v is string => typeof v === 'string'))]
  return names.length ? '（' + names.join('／') + '）' : ''
}
export function quantityDashes(dash: QuantityLineStyle['dash'] = 'solid', width = 1.5): number[] {
  const w = Math.max(1, width)
  return (dash === 'dashed' ? [6, 3] : dash === 'dashDot' ? [8, 2, 1.5, 2] : dash === 'dotted' ? [1, 2] : []).map(n => n * w)
}
