import { parseLocation } from './location'
import type { Point } from './annotations'
import { polygonArea, polylineLength, validAreaHoles } from './measure'
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
/** 経路の頂点に足す個数の項目。at は頂点の番号（0 = 始点）。 */
export interface RoutePoint { itemId: string; at: number; count: number; condition?: string }
export interface QuantityOpening { itemId?: string; widthM?: number; heightM?: number; count: number }
export type OpeningSize = (itemId: string) => { widthM: number; heightM: number } | undefined
export interface RouteExtra {
  itemId: string
  count: number
  cond?: RouteConditions
  perM?: number
}
export function validRoutePerM(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value <= 0 || value > 10000) return false
  const scaled = Math.round(value * 1000)
  return scaled >= 1
    && Math.abs(value - scaled / 1000)
      <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4
}
export function routePerMSuffix(perM?: number): string {
  return perM === undefined || perM === 1 ? '' : ` ×${perM.toFixed(3)}/m`
}
export interface QuantityMark {
  version: 1; id: string; itemId: string; method: Exclude<QuantityMethod, 'click'>
  floor?: string; room?: string; count?: number; cond?: RouteConditions; extra?: RouteExtra[]
  rises?: Rise[]; condition?: string
  points?: RoutePoint[]
  addM?: number; slackM?: number; heightM?: number; widthM?: number; depthM?: number
  holes?: Point[][]
  openings?: QuantityOpening[]
}
// Only area marks with drawn exclusions may grow beyond the long-standing 8,000-character
// route limit; that limit still guards route edits such as condition renames.
const MAX_QUANTITY_MARK_LENGTH = 64_000
const MAX_ROUTE_MARK_LENGTH = 8_000
const markLengthLimit = (method: unknown) => method === 'polygon' || method === 'polygonDepth' ? MAX_QUANTITY_MARK_LENGTH : MAX_ROUTE_MARK_LENGTH
export function validOpeningDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100
}
export function validQuantityOpenings(value: unknown): value is QuantityOpening[] {
  return Array.isArray(value) && value.length <= 50 && Array.from(value).every(o =>
    !!o && typeof o === 'object' && !Array.isArray(o)
    && typeof o.count === 'number' && Number.isInteger(o.count) && o.count >= 1 && o.count <= 999
    && (o.itemId === undefined || typeof o.itemId === 'string' && o.itemId.length >= 1 && o.itemId.length <= 80)
    && (o.widthM === undefined || validOpeningDimension(o.widthM))
    && (o.heightM === undefined || validOpeningDimension(o.heightM))
    && (o.itemId !== undefined || validOpeningDimension(o.widthM) && validOpeningDimension(o.heightM)))
}
function quantityJson(value: unknown): string {
  const raw = JSON.stringify(value)
  // 経路の 8,000 字の上限は呼び出し側（読込・店の検査）で扱う。ここは全体の上限だけ。
  if (raw.length > MAX_QUANTITY_MARK_LENGTH) throw new Error('数量拾いの保存データが文字数の上限を超えています。')
  return raw
}
function quantityDeductions(mark: QuantityMark, mmPerPoint: number, openingSize?: OpeningSize): {
  holes: number; openings: number; unknown: boolean; hasHoles: boolean; hasOpenings: boolean
} {
  const holes = mark.method === 'polygon' || mark.method === 'polygonDepth' ? mark.holes : undefined
  const openings = mark.method === 'polygon' || mark.method === 'lengthHeight' ? mark.openings : undefined
  let openingArea = 0, unknown = false
  for (const opening of openings ?? []) {
    const resolved = opening.itemId !== undefined ? openingSize?.(opening.itemId) : undefined
    const size = resolved && validOpeningDimension(resolved.widthM) && validOpeningDimension(resolved.heightM)
      ? resolved : opening
    if (validOpeningDimension(size.widthM) && validOpeningDimension(size.heightM)) {
      openingArea += size.widthM * size.heightM * opening.count
    } else unknown = true
  }
  return {
    holes: (holes ?? []).reduce((sum, points) => sum + polygonArea(points) * mmPerPoint ** 2 / 1e6, 0),
    openings: openingArea, unknown, hasHoles: !!holes?.length, hasOpenings: !!openings?.length,
  }
}
export function validCondition(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 30 && v.trim() === v && !/[\r\n\u2028\u2029]/.test(v)
}
export function validRoutePoints(value: unknown): value is RoutePoint[] {
  if (!Array.isArray(value) || value.length > 50) return false
  const used = new Map<string, Set<number>>()
  return Array.from(value).every(point => {
    if (!point || typeof point !== 'object' || Array.isArray(point)
      || typeof point.itemId !== 'string' || point.itemId.length < 1 || point.itemId.length > 80
      || typeof point.at !== 'number' || !Number.isInteger(point.at) || point.at < 0
      || !validRouteCount(point.count)
      || point.condition !== undefined && !validCondition(point.condition)) return false
    const vertices = used.get(point.itemId) ?? new Set<number>()
    if (vertices.has(point.at)) return false
    vertices.add(point.at)
    used.set(point.itemId, vertices)
    return true
  })
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
export function routeMembers(mark: QuantityMark): Array<RouteExtra & { cond: RouteConditions }> {
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
  if (!raw || raw.length > MAX_QUANTITY_MARK_LENGTH) return null
  try {
    const v = JSON.parse(raw)
    if (raw.length > markLengthLimit(v?.method)) return null
    if (!v || v.version !== 1 || !['id', 'itemId'].every(k => typeof v[k] === 'string' && v[k].length >= 1 && v[k].length <= 80)
      || !Object.values(QUANTITY_METHODS).flat().filter(m => m !== 'click').includes(v.method)) return null
    const result: QuantityMark = { version: 1, id: v.id, itemId: v.itemId, method: v.method }
    if ((v.method === 'polygon' || v.method === 'polygonDepth') && validAreaHoles(v.holes)) {
      result.holes = v.holes.map((points: Point[]) => points.map(p => [...p] as Point))
    }
    if ((v.method === 'polygon' || v.method === 'lengthHeight') && validQuantityOpenings(v.openings)) {
      result.openings = v.openings.map((o: QuantityOpening) => ({
        ...(o.itemId !== undefined ? { itemId: o.itemId } : {}),
        ...(o.widthM !== undefined ? { widthM: o.widthM } : {}),
        ...(o.heightM !== undefined ? { heightM: o.heightM } : {}),
        count: o.count,
      }))
    }
    for (const k of ['addM', 'heightM', 'widthM', 'depthM'] as const) {
      if (v[k] === undefined || k === 'addM' && v.method === 'polyline' && v.rises !== undefined) continue
      if (typeof v[k] !== 'number' || !Number.isFinite(v[k]) || v[k] < 0 || v[k] > 1000) return null
      result[k] = v[k]
    }
    const location = parseLocation(v)
    if (!location) return null
    Object.assign(result, location)
    if (v.method === 'polyline') {
      if (validRoutePoints(v.points)) {
        result.points = v.points.map((point: RoutePoint) => ({
          itemId: point.itemId, at: point.at, count: point.count,
          ...(point.condition !== undefined ? { condition: point.condition } : {}),
        }))
      }
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
        if (v.extra.length) result.extra = v.extra.map((e: {
          itemId: string; count: number; cond?: unknown; scope?: unknown; perM?: unknown
        }) => ({
          itemId: e.itemId,
          count: e.count,
          cond: readConditions(e)!,
          ...(validRoutePerM(e.perM) ? { perM: e.perM } : {}),
        }))
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
  const { cond: supplied, rises, extra, points, scope: legacyScope, ...base } = mark as QuantityMark & { scope?: RouteScope }
  if (!(mark.method === 'polygon' || mark.method === 'polygonDepth') || !validAreaHoles(base.holes)) delete base.holes
  if (!(mark.method === 'polygon' || mark.method === 'lengthHeight') || !validQuantityOpenings(base.openings)) delete base.openings
  if (mark.method !== 'polyline') return quantityJson(base)
  const cond = supplied === undefined ? conditionsFromScope(legacyScope) : supplied
  if (supplied !== undefined && !validRouteConditions(supplied) || supplied === undefined && legacyScope !== undefined && !validRouteScope(legacyScope)) throw new Error('経路の施工条件が不正です。')
  if (mark.count !== undefined && !validRouteCount(mark.count)) {
    throw new Error('経路の条数が不正です。')
  }
  if (extra !== undefined && (!Array.isArray(extra) || extra.length > 10)) {
    throw new Error('経路の追加項目は10件までです。')
  }
  const ids = new Set([mark.itemId])
  for (const e of extra ?? []) {
    if (!e || typeof e.itemId !== 'string' || !e.itemId
      || e.itemId.length > 80 || ids.has(e.itemId) || !validRouteCount(e.count)) {
      throw new Error('経路の追加項目・条数が不正です。')
    }
    ids.add(e.itemId)
    if (e.perM !== undefined && !validRoutePerM(e.perM)) {
      throw new Error('1m あたりは0より大きく10000以下、小数3桁までで入れてください。')
    }
    const legacy = e as { scope?: RouteScope }
    if (e.cond !== undefined && !validRouteConditions(e.cond) || e.cond === undefined && legacy.scope !== undefined && !validRouteScope(legacy.scope)) throw new Error('経路の施工条件が不正です。')
  }
  if (points !== undefined && !validRoutePoints(points)) {
    throw new Error('頂点の個数は50件まで、数は1〜99の整数で、同じ項目と頂点を重複させずに設定してください。')
  }
  const rs = routeRises(mark), total = riseTotal(rs)
  // Legacy scope approximates unsupported masks: old apps can count excluded rises/plan.
  // Old apps also reject addM > 1000 or JSON > 2000; the new reader supports all 20 rises and JSON up to 64,000 characters.
  const scope = (c: RouteConditions = {}): Exclude<RouteScope, 'all'> | undefined => c.plan === null && c.slack === null ? 'rise' : c.slack === null ? 'noSlack' : undefined
  return quantityJson({ ...base, ...(rises !== undefined || mark.addM !== undefined ? { addM: total } : {}),
    ...(points?.length ? { points: points.map(point => ({
      itemId: point.itemId, at: point.at, count: point.count,
      ...(point.condition !== undefined ? { condition: point.condition } : {}),
    })) } : {}),
    // A zero singleton needs its array: addM=0 alone cannot preserve an explicit rise.
    ...(rises && (rises.length !== 1 || rises[0].at !== undefined || rises[0].m === 0) ? { rises } : {}),
    cond: wireConditions(cond), scope: scope(cond), extra: extra?.map(e => ({
      itemId: e.itemId,
      count: e.count,
      ...(e.perM !== undefined ? { perM: e.perM } : {}),
      cond: wireConditions(e.cond ?? conditionsFromScope((e as { scope?: RouteScope }).scope)),
      scope: scope(e.cond ?? conditionsFromScope((e as { scope?: RouteScope }).scope)),
    })) })
}
export function validRouteCount(n: unknown): n is number { return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99 }
export function quantityPoints(method: QuantityMark['method']): 'polyline' | 'polygon' {
  return method === 'polygon' || method === 'polygonDepth' ? 'polygon' : 'polyline'
}
export function quantityValue(points: readonly Point[], mmPerPoint: number, mark: QuantityMark, openingSize?: OpeningSize): number {
  const length = polylineLength(points) * mmPerPoint / 1000
  const area = polygonArea(points) * mmPerPoint ** 2 / 1e6
  const deductions = quantityDeductions(mark, mmPerPoint, openingSize)
  switch (mark.method) {
    case 'polyline': return routeMemberLength(length, mark)
    case 'polygon': return deductions.hasHoles || deductions.hasOpenings ? Math.max(0, area - deductions.holes - deductions.openings) : area
    case 'lengthHeight': {
      const gross = length * (mark.heightM ?? 0)
      return deductions.hasOpenings ? Math.max(0, gross - deductions.openings) : gross
    }
    case 'polygonDepth': return deductions.hasHoles ? Math.max(0, area - deductions.holes) * (mark.depthM ?? 0) : area * (mark.depthM ?? 0)
    case 'lengthWidthDepth': return length * (mark.widthM ?? 0) * (mark.depthM ?? 0)
  }
}
const number = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function quantityLabel(points: readonly Point[], mmPerPoint: number, mark: QuantityMark & { scope?: RouteScope }, code: string, showCode: boolean, extraCode: (id: string) => string = id => id, openingSize?: OpeningSize, routeNote: (id: string) => string = () => ''): string {
  if (mark.cond === undefined && mark.scope !== undefined) mark = { ...mark, cond: conditionsFromScope(mark.scope) }
  const length = number(polylineLength(points) * mmPerPoint / 1000)
  const area = number(polygonArea(points) * mmPerPoint ** 2 / 1e6)
  const deductions = quantityDeductions(mark, mmPerPoint, openingSize)
  const holeTerm = deductions.hasHoles ? `−${number(deductions.holes)}` : ''
  const openingTerm = deductions.hasOpenings ? `−開口${number(deductions.openings)}${deductions.unknown ? '?' : ''}` : ''
  const value = quantityDimensions(mark.method).some(key => mark[key] === undefined) ? '?' : number(quantityValue(points, mmPerPoint, mark, openingSize))
  const dimension = (key: keyof typeof QUANTITY_DIMENSIONS) => mark[key] === undefined ? '?' : number(mark[key])
  const addM = riseTotal(routeRises(mark))
  let label: string
  switch (mark.method) {
    case 'polyline': label = `${addM || mark.slackM ? `${length}${addM ? '+' + number(addM) : ''}${mark.slackM ? '+余' + number(mark.slackM) : ''}=` : ''}${value} m`; break
    case 'polygon': label = `${deductions.hasHoles || deductions.hasOpenings ? `${area}${holeTerm}${openingTerm}=` : ''}${value} m²`; break
    case 'lengthHeight': label = `${length}×H${dimension('heightM')}${openingTerm}=${value} m²`; break
    case 'polygonDepth': label = `${deductions.hasHoles ? `(${area}${holeTerm})` : area}×D${dimension('depthM')}=${value} m³`; break
    case 'lengthWidthDepth': label = `${length}×W${dimension('widthM')}×D${dimension('depthM')}=${value} m³`; break
  }
  if (mark.method === 'polyline' && ((mark.count ?? 1) !== 1 || mark.extra?.length)) {
    const codes = routeMembers(mark).map((e, i) =>
      (i === 0 ? code : extraCode(e.itemId))
      + conditionSuffix(e.cond, true)
      + (e.count === 1 ? '' : '×' + e.count)
      + routePerMSuffix(e.perM)).join(', ')
    const notes = routeMembers(mark).map(e => routeNote(e.itemId)).filter(Boolean).join(' ／ ')
    return (showCode && codes ? codes + '  ' + label : label)
      + (notes ? '；' + notes : '')
  }
  return showCode && code ? `${code}${mark.method === 'polyline' ? conditionSuffix(mark.cond, true) : ''} ${label}` : label
}
const CONDITION_SHORT_NAMES: Record<string, string> = {
  '管内配線': '管内',
  '合成樹脂管内配線（PF・CD・FEP）': 'PF管内',
  'ケーブルラック配線': 'ラック',
  '二重天井内・二重床内・ピット内・トラフ内配線': '天井内等',
  'ダクト内配線': 'ダクト内',
  'サドル止め（コンクリート）': 'サドル',
  'サドル止め・ステープル止め（木造）': 'ステープル',
  '地中管路内': '地中',
  '架空（ちょう架）': '架空',
  '隠ぺい配管': '隠ぺい',
  '露出配管': '露出',
  'コンクリート埋込配管': '埋込',
  '地中埋設': '地中',
  '屋内一般配管': '屋内一般',
  '機械室・便所配管': '機械室',
  '屋外配管（架空・暗渠内・共同溝内）': '屋外',
  '屋外露出配管': '屋外露出',
  '地中配管': '地中',
  '屋内露出（一般居室・廊下）': '屋内露出',
  '屋内隠ぺい（天井内・パイプシャフト）': '隠ぺい',
  '機械室・書庫・倉庫': '機械室',
  '屋外露出・浴室・厨房': '屋外露出',
  '隠ぺい（埋込）': '埋込',
}
export function conditionShortName(name: string): string {
  if (Object.prototype.hasOwnProperty.call(CONDITION_SHORT_NAMES, name)) return CONDITION_SHORT_NAMES[name]
  const plain = name.replace(/（[^）]*）|\([^)]*\)/g, '').trim()
  return plain.length > 8 ? plain.slice(0, 7) + '…' : plain
}
export function conditionSuffix(cond: RouteConditions = {}, short = false): string {
  if (cond.plan === null) return '（立上り）'
  const values = [cond.plan, ...(Array.isArray(cond.rise) ? cond.rise : [cond.rise])].filter((v): v is string => typeof v === 'string')
  const names = [...new Set(short ? values.map(conditionShortName) : values)]
  return names.length ? '（' + names.join('／') + '）' : ''
}
export function quantityDashes(dash: QuantityLineStyle['dash'] = 'solid', width = 1.5): number[] {
  const w = Math.max(1, width)
  return (dash === 'dashed' ? [6, 3] : dash === 'dashDot' ? [8, 2, 1.5, 2] : dash === 'dotted' ? [1, 2] : []).map(n => n * w)
}
