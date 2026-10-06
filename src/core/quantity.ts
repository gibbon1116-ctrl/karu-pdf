import { parseLocation } from './location'
import type { Point } from './annotations'
import { polygonArea, polylineLength } from './measure'
import { QUANTITY_METHODS, type QuantityMethod, type QuantityLineStyle } from './countFixtures'

export type RouteScope = 'all' | 'noSlack' | 'rise'
export const ROUTE_SCOPES: Record<RouteScope, string> = { all: '全長（平面＋立上り＋余長）', noSlack: '平面＋立上り', rise: '立上り・立下りのみ' }
export function validRouteScope(value: unknown): value is RouteScope { return value === 'all' || value === 'noSlack' || value === 'rise' }
export interface QuantityMark {
  version: 1; id: string; itemId: string; method: Exclude<QuantityMethod, 'click'>
  floor?: string; room?: string; count?: number; scope?: RouteScope; extra?: Array<{ itemId: string; count: number; scope?: RouteScope }>
  addM?: number; slackM?: number; heightM?: number; widthM?: number; depthM?: number
}
export const QUANTITY_DIMENSIONS = { heightM: '高さ', widthM: '幅', depthM: '深さ' } as const
export function quantityDimensions(method: QuantityMethod): readonly (keyof typeof QUANTITY_DIMENSIONS)[] {
  return method === 'lengthHeight' ? ['heightM'] : method === 'polygonDepth' ? ['depthM'] : method === 'lengthWidthDepth' ? ['widthM', 'depthM'] : []
}
export function parseQuantityMark(raw: string | null): QuantityMark | null {
  if (!raw || raw.length > 2000) return null
  try {
    const v = JSON.parse(raw)
    if (!v || v.version !== 1 || !['id', 'itemId'].every(k => typeof v[k] === 'string' && v[k].length >= 1 && v[k].length <= 80)
      || !Object.values(QUANTITY_METHODS).flat().filter(m => m !== 'click').includes(v.method)) return null
    const result: QuantityMark = { version: 1, id: v.id, itemId: v.itemId, method: v.method }
    for (const k of ['addM', 'heightM', 'widthM', 'depthM'] as const) {
      if (v[k] === undefined) continue
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
      if (v.scope !== undefined) { if (!validRouteScope(v.scope)) return null; if (v.scope !== 'all') result.scope = v.scope }
      if (v.count !== undefined) { if (!validRouteCount(v.count)) return null; if (v.count !== 1) result.count = v.count }
      if (v.extra !== undefined) {
        if (!Array.isArray(v.extra) || v.extra.length > 10) return null
        const ids = new Set([v.itemId])
        for (const e of v.extra) {
          if (!e || typeof e.itemId !== 'string' || !e.itemId || e.itemId.length > 80 || ids.has(e.itemId) || !validRouteCount(e.count) || (e.scope !== undefined && !validRouteScope(e.scope))) return null
          ids.add(e.itemId)
        }
        if (v.extra.length) result.extra = v.extra.map((e: { itemId: string; count: number; scope?: RouteScope }) => ({ itemId: e.itemId, count: e.count, ...(e.scope && e.scope !== 'all' ? { scope: e.scope } : {}) }))
      }
    }
    return result
  } catch { return null }
}
export function validRouteCount(n: unknown): n is number { return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99 }
export function quantityPoints(method: QuantityMark['method']): 'polyline' | 'polygon' {
  return method === 'polygon' || method === 'polygonDepth' ? 'polygon' : 'polyline'
}
export function quantityValue(points: readonly Point[], mmPerPoint: number, mark: QuantityMark): number {
  const length = polylineLength(points) * mmPerPoint / 1000
  const area = polygonArea(points) * mmPerPoint ** 2 / 1e6
  switch (mark.method) {
    case 'polyline': return routeLength(length, mark)
    case 'polygon': return area
    case 'lengthHeight': return length * (mark.heightM ?? 0)
    case 'polygonDepth': return area * (mark.depthM ?? 0)
    case 'lengthWidthDepth': return length * (mark.widthM ?? 0) * (mark.depthM ?? 0)
  }
}
const number = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function quantityLabel(points: readonly Point[], mmPerPoint: number, mark: QuantityMark, code: string, showCode: boolean, extraCode: (id: string) => string = id => id): string {
  const length = number(polylineLength(points) * mmPerPoint / 1000)
  const area = number(polygonArea(points) * mmPerPoint ** 2 / 1e6)
  const value = quantityDimensions(mark.method).some(key => mark[key] === undefined) ? '?' : number(quantityValue(points, mmPerPoint, mark))
  const dimension = (key: keyof typeof QUANTITY_DIMENSIONS) => mark[key] === undefined ? '?' : number(mark[key])
  let label: string
  switch (mark.method) {
    case 'polyline': label = `${mark.addM || mark.slackM ? `${length}${mark.addM ? '+' + number(mark.addM) : ''}${mark.slackM ? '+余' + number(mark.slackM) : ''}=` : ''}${value} m`; break
    case 'polygon': label = `${value} m²`; break
    case 'lengthHeight': label = `${length}×H${dimension('heightM')}=${value} m²`; break
    case 'polygonDepth': label = `${area}×D${dimension('depthM')}=${value} m³`; break
    case 'lengthWidthDepth': label = `${length}×W${dimension('widthM')}×D${dimension('depthM')}=${value} m³`; break
  }
  if (mark.method === 'polyline' && ((mark.count ?? 1) !== 1 || mark.extra?.length)) {
    const codes = [{ itemId: mark.itemId, count: mark.count ?? 1, scope: mark.scope }, ...(mark.extra ?? [])].map((e, i) => (i === 0 ? code : extraCode(e.itemId)) + scopeSuffix(e.scope) + (e.count === 1 ? '' : '×' + e.count)).join(', ')
    return showCode && codes ? codes + '  ' + label : label
  }
  return showCode && code ? `${code}${mark.method === 'polyline' ? scopeSuffix(mark.scope) : ''} ${label}` : label
}
function scopeSuffix(scope?: RouteScope): string { return scope === 'noSlack' ? '（平面＋立上り）' : scope === 'rise' ? '（立上り）' : '' }
export function routeLength(planM: number, mark: Pick<QuantityMark, 'addM' | 'slackM'>, scope: RouteScope = 'all'): number {
  const rise = mark.addM ?? 0
  return scope === 'rise' ? rise : planM + rise + (scope === 'all' ? mark.slackM ?? 0 : 0)
}
export function quantityDashes(dash: QuantityLineStyle['dash'] = 'solid', width = 1.5): number[] {
  const w = Math.max(1, width)
  return (dash === 'dashed' ? [6, 3] : dash === 'dashDot' ? [8, 2, 1.5, 2] : dash === 'dotted' ? [1, 2] : []).map(n => n * w)
}
