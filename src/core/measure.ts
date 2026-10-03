import { constrainLinePoint } from './lineGeometry'
import type { PDFDocument, PDFObject, PDFPage } from 'mupdf'
import type { Point, Rect } from './annotations'

export type MeasureKind = 'distance' | 'perimeter' | 'area'
export type Paper = 'PDF' | 'A0' | 'A1' | 'A2' | 'A3' | 'A4'
export interface MeasureSettings {
  kind: MeasureKind
  unit: 'mm' | 'm'
  mmPerPoint: number
  decimals: number | null
}
export interface PageScale extends Omit<MeasureSettings, 'kind'> {
  denominator: number
  paper: Paper
  source: 'ratio' | 'calibration' | 'standard'
  calibration?: { pointsLength: number; actualMm: number }
}
export const PT_MM = 25.4 / 72
export const PAPER_LONG_MM: Record<Exclude<Paper, 'PDF'>, number> = { A0: 1189, A1: 841, A2: 594, A3: 420, A4: 297 }
export const SCALE_PRESETS = [
  { label: '詳細図など', denominators: [1, 2, 5, 10, 20, 25, 30] },
  { label: '平面・立面・断面図など', denominators: [50, 100, 150, 200] },
  { label: '配置・敷地・広域図など', denominators: [250, 300, 500, 600, 1000, 1200, 2500, 5000] },
] as const
export const SCALE_CHOICES: readonly number[] = SCALE_PRESETS.flatMap(group => [...group.denominators])

function positive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('縮尺と長さには正の数を入力してください。')
  return value
}
const PAPER_INDEX: Record<Exclude<Paper, 'PDF'>, number> = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4 }

// PDF の用紙が A 判なら、A 判どうしの長い辺の比は、ちょうど √2 のべき乗にする。
// mm に丸めた長さの比（A1 → A3 で 841 / 420 = 2.0024）を掛けると、
// 3,600 mm の寸法が 3,609 mm と出てしまう。A 判でない用紙だけ、長い辺の比を使う。
function paperCorrection(paper: Paper, size: { width: number; height: number }): number {
  if (paper === 'PDF') return 1
  const longMm = positive(Math.max(size.width, size.height)) * PT_MM
  const pdfPaper = (Object.keys(PAPER_INDEX) as Array<Exclude<Paper, 'PDF'>>)
    .find((name) => Math.abs(longMm / PAPER_LONG_MM[name] - 1) <= 0.02)
  if (pdfPaper) return Math.SQRT2 ** (PAPER_INDEX[pdfPaper] - PAPER_INDEX[paper])
  return PAPER_LONG_MM[paper] / longMm
}

export function ratioScale(denominator: number, paper: Paper, size: { width: number; height: number }, unit: 'mm' | 'm' = 'mm', decimals: number | null = null): PageScale {
  const correction = paperCorrection(paper, size)
  return { denominator: positive(denominator), paper, source: 'ratio', mmPerPoint: PT_MM * denominator * correction, unit, decimals }
}
export function calibratedScale(points: readonly Point[], actualMm: number, unit: 'mm' | 'm' = 'mm', decimals: number | null = null): PageScale {
  const mmPerPoint = positive(actualMm) / positive(polylineLength(points))
  return { denominator: mmPerPoint / PT_MM, paper: 'PDF', source: 'calibration', mmPerPoint, unit, decimals, calibration: { pointsLength: polylineLength(points), actualMm } }
}
export function scaleLabel(scale: PageScale): string {
  const ratio = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(scale.denominator)
  return `${scale.source === 'ratio' ? '縮尺' : '約'} 1/${ratio}${scale.paper === 'PDF' ? '' : `（${scale.paper}）`}`
}
export function polylineLength(points: readonly Point[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return length
}
export function polygonArea(points: readonly Point[]): number {
  let sum = 0
  points.forEach((p, i) => { const q = points[(i + 1) % points.length]; sum += p[0] * q[1] - q[0] * p[1] })
  return Math.abs(sum) / 2
}
export function measureText(points: readonly Point[], settings: MeasureSettings): string {
  const area = settings.kind === 'area'
  const value = area ? polygonArea(points) * settings.mmPerPoint ** 2 / 1e6
    : polylineLength(points) * settings.mmPerPoint / (settings.unit === 'm' ? 1000 : 1)
  const digits = settings.decimals ?? (area || settings.unit === 'm' ? 2 : 0)
  const number = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  return `${settings.kind === 'perimeter' ? '合計 ' : ''}${number} ${area ? 'm²' : settings.unit}`
}
export const constrainMeasurePoint = constrainLinePoint
export function pointInsidePolygon(p: Point, points: readonly Point[]): boolean {
  let inside = false
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  })
  return inside
}
export function polygonLabelPoint(points: readonly Point[]): Point {
  let twiceArea = 0, x = 0, y = 0
  points.forEach((a, i) => { const b = points[(i + 1) % points.length]; const c = a[0] * b[1] - b[0] * a[1]; twiceArea += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c })
  if (Math.abs(twiceArea) > 1e-9) {
    const centroid: Point = [x / (3 * twiceArea), y / (3 * twiceArea)]
    if (pointInsidePolygon(centroid, points)) return centroid
  }
  // Intersect a scanline between vertex heights with the polygon. The widest
  // interior interval supplies a guaranteed interior anchor even for concave shapes.
  const ys = [...new Set(points.map(p => p[1]))].sort((a, b) => a - b)
  let best: Point = points[0] ?? [0, 0], widest = -1
  for (let i = 1; i < ys.length; i++) {
    const scanY = (ys[i - 1] + ys[i]) / 2
    const xs: number[] = []
    points.forEach((a, j) => { const b = points[(j + 1) % points.length]; if ((a[1] > scanY) !== (b[1] > scanY)) xs.push(a[0] + (scanY - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) })
    xs.sort((a, b) => a - b)
    for (let j = 1; j < xs.length; j += 2) if (xs[j] - xs[j - 1] > widest) { widest = xs[j] - xs[j - 1]; best = [(xs[j] + xs[j - 1]) / 2, scanY] }
  }
  return best
}
export function measureLabel(points: readonly Point[], kind: MeasureKind, fontSize: number): { anchor: Point; angle: number } {
  if (kind === 'area') return { anchor: polygonLabelPoint(points), angle: 0 }
  if (kind === 'perimeter') { const p = points.at(-1) ?? [0, 0]; return { anchor: [p[0], p[1] - fontSize], angle: 0 } }
  const a = points[0] ?? [0, 0], b = points[1] ?? a
  let angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle <= -Math.PI / 2) angle += Math.PI
  return { anchor: [(a[0] + b[0]) / 2 + Math.sin(angle) * (fontSize * .75 + 3), (a[1] + b[1]) / 2 - Math.cos(angle) * (fontSize * .75 + 3)], angle }
}
export function measureBounds(points: readonly Point[], kind: MeasureKind, text: string, fontSize: number): Rect {
  const { anchor } = measureLabel(points, kind, fontSize)
  const margin = fontSize + 8, halfText = [...text].length * fontSize / 2
  return [Math.min(...points.map(p => p[0]), anchor[0] - halfText) - margin, Math.min(...points.map(p => p[1]), anchor[1] - halfText) - margin,
    Math.max(...points.map(p => p[0]), anchor[0] + halfText) + margin, Math.max(...points.map(p => p[1]), anchor[1] + halfText) + margin]
}

function stringAt(object: PDFObject, ...keys: (string | number)[]): string | null {
  const value = object.get(...keys); try { return value.isString() ? value.asString() : null } finally { value.destroy() }
}
export function validScale(value: unknown): value is PageScale {
  const v = value as PageScale | null
  return !!v && Number.isFinite(v.mmPerPoint) && v.mmPerPoint > 0 && Number.isFinite(v.denominator) && v.denominator > 0
    && ['PDF', 'A0', 'A1', 'A2', 'A3', 'A4'].includes(v.paper) && ['ratio', 'calibration', 'standard'].includes(v.source)
    && (v.unit === 'mm' || v.unit === 'm') && (v.decimals === null || (Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 6))
}
export function readMeasureSettings(object: PDFObject, kind: MeasureKind, pageUnits = 1): MeasureSettings | null {
  const custom = stringAt(object, 'KaruMeasure')
  if (custom) try { const v = JSON.parse(custom); if (validScale({ ...v, denominator: 1, paper: 'PDF', source: 'standard' }) && v.kind === kind) return { ...v } } catch { /* Standard fallback. */ }
  const subtype = object.get('Measure', 'Subtype')
  try { if (!subtype.isName() || subtype.asName() !== 'RL') return null } finally { subtype.destroy() }
  const raw = object.get('Measure', 'X', 0)
  try {
    const u = stringAt(raw, 'U')?.toLowerCase()
    const unitMm: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, pt: PT_MM }
    const c = raw.get('C'); try {
      if (!u || !unitMm[u] || !c.isNumber() || c.asNumber() <= 0) return null
      const mmPerPoint = c.asNumber() * unitMm[u] / pageUnits
      if (!Number.isFinite(mmPerPoint)) return null
      // Our editor supports isotropic drawing scales. Do not silently reinterpret
      // a chart with unequal X/Y scales as an architectural measurement.
      const y = object.get('Measure', 'Y'); try {
        if (!y.isNull()) {
          const cy = object.get('Measure', 'Y', 0, 'C'), cyx = object.get('Measure', 'CYX')
          try { if (!cy.isNumber() || !cyx.isNumber() || Math.abs(cy.asNumber() * cyx.asNumber() - c.asNumber()) > 1e-6 * c.asNumber()) return null } finally { cy.destroy(); cyx.destroy() }
        }
      } finally { y.destroy() }
      return { kind, unit: u === 'm' ? 'm' : 'mm', mmPerPoint, decimals: null }
    } finally { c.destroy() }
  } finally { raw.destroy() }
}
export function createMeasureDictionary(doc: PDFDocument, settings: MeasureSettings, pageUnits = 1): PDFObject {
  const m = doc.newDictionary()
  m.put('Type', 'Measure'); m.put('Subtype', 'RL')
  const r = doc.newString(`1 mm = ${settings.mmPerPoint / PT_MM} mm`); try { m.put('R', r) } finally { r.destroy() }
  const lengthFactor = settings.mmPerPoint * pageUnits / (settings.unit === 'm' ? 1000 : 1)
  const numberFormat = (unit: string, factor: number, digits: number) => {
    const array = doc.newArray(), format = doc.newDictionary(), label = doc.newString(unit)
    try { format.put('Type', 'NumberFormat'); format.put('U', label); format.put('C', factor); format.put('F', 'D'); format.put('D', 10 ** digits); array.push(format); return array } finally { format.destroy(); label.destroy() }
  }
  const digits = settings.decimals ?? (settings.unit === 'mm' ? 0 : 2)
  // X converts user-space units. D and A operate AFTER X conversion (ISO 32000-1, table 262).
  for (const [key, u, c, d] of [['X', settings.unit, lengthFactor, digits], ['D', settings.unit, 1, digits], ['A', 'm²', settings.unit === 'mm' ? 1e-6 : 1, settings.decimals ?? 2]] as const) {
    const array = numberFormat(u, c, d); try { m.put(key, array) } finally { array.destroy() }
  }
  return m
}
export function pageUnitFactor(page: PDFPage): number { const m = page.getTransform(); return Math.hypot(m[0], m[1]) }
export function readPageScale(page: PDFPage): PageScale | null {
  const obj = page.getObject(), viewports = obj.get('VP')
  try {
    for (let i = viewports.length - 1; i >= 0; i--) {
      const vp = viewports.get(i)
      try {
        const custom = stringAt(vp, 'KaruScale')
        if (custom) try { const value = JSON.parse(custom); if (validScale(value)) return value } catch { /* Fall back. */ }
        const settings = readMeasureSettings(vp, 'distance', pageUnitFactor(page))
        if (settings) return { ...settings, denominator: settings.mmPerPoint / PT_MM, paper: 'PDF', source: 'standard' }
      } finally { vp.destroy() }
    }
    return null
  } finally { viewports.destroy(); obj.destroy() }
}
export function writePageScale(doc: PDFDocument, page: PDFPage, scale: PageScale | null): void {
  const obj = page.getObject(), existing = obj.get('VP'), array = doc.newArray()
  try {
    // Preserve other applications' viewports; replace only our own full-page viewport.
    for (let i = 0; i < existing.length; i++) { const vp = existing.get(i); try { if (!stringAt(vp, 'KaruScale')) array.push(vp) } finally { vp.destroy() } }
    if (scale) {
      if (!validScale(scale)) throw new Error('縮尺の設定が不正です。')
      const vp = doc.newDictionary(), measure = createMeasureDictionary(doc, { ...scale, kind: 'distance' }, pageUnitFactor(page)), json = doc.newString(JSON.stringify(scale))
      const box = doc.newArray()
      try {
        const inv = invertMatrix(page.getTransform()), b = page.getBounds()
        const corners = [[b[0], b[1]], [b[2], b[3]]].map(p => transformMeasurePoint(p as Point, inv))
        for (const n of [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])]) box.push(n)
        vp.put('Type', 'Viewport'); vp.put('BBox', box); vp.put('Measure', measure); vp.put('KaruScale', json); array.push(vp)
      } finally { box.destroy(); json.destroy(); measure.destroy(); vp.destroy() }
    }
    if (array.length) obj.put('VP', array); else obj.delete('VP')
  } finally { array.destroy(); existing.destroy(); obj.destroy() }
}
export function transformMeasurePoint(p: Point, m: readonly number[]): Point { return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]] }
export function invertMatrix(m: readonly number[]): [number, number, number, number, number, number] {
  const d = m[0] * m[3] - m[1] * m[2]
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}

export function readDocumentScales(doc: PDFDocument): (PageScale | null)[] {
  return Array.from({ length: doc.countPages() }, (_, i) => { const page = doc.loadPage(i); try { return readPageScale(page) } finally { page.destroy() } })
}
