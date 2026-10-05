import type { Point } from './annotations'
import { polygonArea, polylineLength } from './measure'
import { QUANTITY_METHODS, type QuantityMethod, type QuantityLineStyle } from './countFixtures'

export interface QuantityMark {
  version: 1; id: string; itemId: string; method: Exclude<QuantityMethod, 'click'>
  addM?: number; heightM?: number; widthM?: number; depthM?: number
}
export function parseQuantityMark(raw: string | null): QuantityMark | null {
  if (!raw || raw.length > 400) return null
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
    return result
  } catch { return null }
}
export function quantityPoints(method: QuantityMark['method']): 'polyline' | 'polygon' {
  return method === 'polygon' || method === 'polygonDepth' ? 'polygon' : 'polyline'
}
export function quantityValue(points: readonly Point[], mmPerPoint: number, mark: QuantityMark): number {
  const length = polylineLength(points) * mmPerPoint / 1000
  const area = polygonArea(points) * mmPerPoint ** 2 / 1e6
  switch (mark.method) {
    case 'polyline': return length + (mark.addM ?? 0)
    case 'polygon': return area
    case 'lengthHeight': return length * (mark.heightM ?? 0)
    case 'polygonDepth': return area * (mark.depthM ?? 0)
    case 'lengthWidthDepth': return length * (mark.widthM ?? 0) * (mark.depthM ?? 0)
  }
}
const number = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function quantityLabel(points: readonly Point[], mmPerPoint: number, mark: QuantityMark, code: string, showCode: boolean): string {
  const length = number(polylineLength(points) * mmPerPoint / 1000)
  const area = number(polygonArea(points) * mmPerPoint ** 2 / 1e6)
  const value = number(quantityValue(points, mmPerPoint, mark))
  let label: string
  switch (mark.method) {
    case 'polyline': label = `${mark.addM ? `${length}+${number(mark.addM)}=` : ''}${value} m`; break
    case 'polygon': label = `${value} m²`; break
    case 'lengthHeight': label = `${length}×H${number(mark.heightM ?? 0)}=${value} m²`; break
    case 'polygonDepth': label = `${area}×D${number(mark.depthM ?? 0)}=${value} m³`; break
    case 'lengthWidthDepth': label = `${length}×W${number(mark.widthM ?? 0)}×D${number(mark.depthM ?? 0)}=${value} m³`; break
  }
  return showCode && code ? `${code} ${label}` : label
}
export function quantityDashes(dash: QuantityLineStyle['dash'] = 'solid', width = 1.5): number[] {
  const w = Math.max(1, width)
  return (dash === 'dashed' ? [6, 3] : dash === 'dashDot' ? [8, 2, 1.5, 2] : dash === 'dotted' ? [1, 2] : []).map(n => n * w)
}
