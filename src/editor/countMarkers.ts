import { quantityLine } from '../core/countFixtures'
import { quantityDashes } from '../core/quantity'
import { createElement } from 'react'
import type { Point } from '../core/annotations'
import { countHex, type CountStyle } from '../core/countFixtures'

type Polygon = Point[]
export interface CountMarkerData { outline: Polygon[]; fills: Polygon[]; strokes: Polygon[]; bright: boolean; color: string; opacity: number; code: { x: number; y: number; size: number } }
function regular(n: number, r: number, angle = -Math.PI / 2): Polygon { return Array.from({ length: n }, (_, i) => [Math.cos(angle + i * Math.PI * 2 / n) * r, Math.sin(angle + i * Math.PI * 2 / n) * r] as Point) }
function polygon(shape: CountStyle['shape'], r: number): Polygon {
  if (shape === 'circle' || shape === 'doubleCircle') return regular(48, r)
  if (shape === 'square') return [[-r, -r], [r, -r], [r, r], [-r, r]]
  if (shape === 'roundedSquare') return Array.from({ length: 32 }, (_, i) => { const corner = Math.floor(i / 8), angle = corner * Math.PI / 2 + i % 8 / 7 * Math.PI / 2; return [(corner === 0 || corner === 3 ? 1 : -1) * r * .65 + Math.cos(angle) * r * .35, (corner < 2 ? 1 : -1) * r * .65 + Math.sin(angle) * r * .35] as Point })
  if (shape === 'triangle' || shape === 'invertedTriangle') return regular(3, r, shape === 'triangle' ? -Math.PI / 2 : Math.PI / 2)
  if (shape === 'diamond') return regular(4, r)
  if (shape === 'pentagon') return regular(5, r)
  if (shape === 'hexagon') return regular(6, r)
  if (shape === 'octagon') return regular(8, r, Math.PI / 8)
  if (shape === 'star') return regular(10, r).map<Point>((p, i) => i % 2 ? [p[0] * .45, p[1] * .45] : p)
  if (shape === 'hourglass') return [[-r, -r], [r, -r], [r * .2, 0], [r, r], [-r, r], [-r * .2, 0]]
  const plus: Polygon = [[-.28, -1], [.28, -1], [.28, -.28], [1, -.28], [1, .28], [.28, .28], [.28, 1], [-.28, 1], [-.28, .28], [-1, .28], [-1, -.28], [-.28, -.28]]
  return plus.map<Point>(([x, y]) => shape === 'cross' ? [(x - y) * r / Math.SQRT2, (x + y) * r / Math.SQRT2] : [x * r, y * r])
}
function leftHalf(points: Polygon): Polygon {
  const result: Polygon = []
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]
    if (p[0] <= 0) result.push(p)
    if ((p[0] <= 0) !== (q[0] <= 0)) result.push([0, p[1] + (q[1] - p[1]) * -p[0] / (q[0] - p[0])])
  })
  return result
}
export function countMarkerData(style: CountStyle, x = 0, y = 0): CountMarkerData {
  const r = style.size / 2, outer = polygon(style.shape, r), outline = [outer], fills: Polygon[] = [], strokes: Polygon[] = []
  const inner = style.shape === 'doubleCircle' ? regular(48, r * .68) : undefined
  if (inner) outline.push(inner)
  if (style.fill === 'solid') {
    if (inner) fills.push(outer, [...inner].reverse())
    else fills.push(outer)
  }
  if (style.fill === 'half') {
    if (inner) fills.push(leftHalf(outer), leftHalf(inner).reverse())
    else fills.push(leftHalf(outer))
  }
  if (style.fill === 'dot') fills.push(regular(24, r * .22))
  if (style.fill === 'hatch') for (let offset = -r * 2; offset < r * 2; offset += Math.max(1.5, style.size / 5)) {
    const hits: Point[] = []
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % outer.length], a = p[0] + p[1] - offset, b = q[0] + q[1] - offset
      if ((a <= 0) !== (b <= 0)) { const t = a / (a - b); hits.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]) }
    })
    hits.sort((a, b) => a[0] - b[0])
    for (let i = 0; i + 1 < hits.length; i += 2) strokes.push([hits[i], hits[i + 1]])
  }
  const luminance = style.color.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  const move = (ps: Polygon[]) => ps.map(p => p.map(([a, b]) => [a + x, b + y] as Point))
  return { outline: move(outline), fills: move(fills), strokes: move(strokes), bright: luminance[0] * .2126 + luminance[1] * .7152 + luminance[2] * .0722 > .6, color: countHex(style.color), opacity: style.opacity, code: { x: x + r, y: y - r, size: style.size * .7 } }
}
export function countSvgPath(polygons: Polygon[], close = true): string { return polygons.map(p => p.length ? `M${p.map(([x, y]) => `${x},${y}`).join('L')}${close ? 'Z' : ''}` : '').join(' ') }
export function countPdfPath(polygons: Polygon[], close = true): string { return polygons.map(p => p.map(([x, y], i) => `${x.toFixed(4)} ${y.toFixed(4)} ${i ? 'l' : 'm'}`).join('\n') + (close ? '\nh' : '')).join('\n') }
export function CountMarker({ style, code = '', x = 0, y = 0, showCode = true }: { style: CountStyle; code?: string; x?: number; y?: number; showCode?: boolean }) {
  const d = countMarkerData(style, x, y), outline = countSvgPath(d.outline)
  return createElement('g', { opacity: d.opacity, pointerEvents: 'none', 'data-count-shape': style.shape, 'data-count-fill': style.fill },
    d.bright && createElement('path', { d: outline, fill: 'none', stroke: '#404040', strokeWidth: 1.8 }),
    createElement('path', { d: countSvgPath(d.fills), fill: d.color }),
    createElement('path', { d: outline + ' ' + countSvgPath(d.strokes, false), fill: 'none', stroke: d.color, strokeWidth: .8, strokeLinejoin: 'round' }),
    style.showCode && showCode && code && createElement('text', { x: d.code.x, y: d.code.y, fontSize: d.code.size, fill: d.bright ? '#404040' : d.color, fontFamily: 'KaruBIZUDGothic, sans-serif' }, code))
}

export function QuantitySwatch({ fixture }: { fixture: import('../core/countFixtures').CountFixture }) {
  const line = quantityLine(fixture)
  return createElement('svg', { className: 'fixture-swatch', width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': true }, createElement('path', { d: 'M1 12H23', fill: 'none', stroke: countHex(fixture.style.color), strokeWidth: line.width, strokeDasharray: quantityDashes(line.dash, line.width).join(' '), opacity: fixture.style.opacity }))
}
