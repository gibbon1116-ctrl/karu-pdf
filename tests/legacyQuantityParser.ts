// Frozen pre-SPEC-07a parser: version 1.4.3 compatibility oracle.
import { parseLocation } from '../src/core/location'
import { QUANTITY_METHODS, type QuantityMethod } from '../src/core/countFixtures'
import { validRouteCount, validRouteScope, type RouteScope } from '../src/core/quantity'
interface QuantityMark { version: 1; id: string; itemId: string; method: Exclude<QuantityMethod, 'click'>; floor?: string; room?: string; count?: number; scope?: RouteScope; extra?: Array<{ itemId: string; count: number; scope?: RouteScope }>; addM?: number; slackM?: number; heightM?: number; widthM?: number; depthM?: number }
export function legacyParseQuantityMark(raw: string | null): QuantityMark | null {
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
