import { fixtureCode } from '../core/countFixtures'
import { quantityLabel, quantityDashes, quantityPoints, quantityDimensions, type QuantityMark } from '../core/quantity'
import { quantityMethod, quantityLine, type CountFixture, type QuantityLineStyle } from '../core/countFixtures'
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { QuantityDimensionsDialog } from './QuantityDimensionsDialog'
import type { Point } from '../core/annotations'
import { cloudPath, type CloudIntensity } from '../core/cloud'
import { constrainMeasurePoint, measureBounds, measureLabel, measureText, type MeasureKind } from '../core/measure'
import type { EditableAnnotation, AnnotationStore } from './AnnotationStore'
import type { EditorTool } from './AnnotationLayer'
import type { FormatDefaults } from './formatDefaults'
import { buildSnapIndex, findSnap, MAX_SNAP_VERTICES, type SnapIndex } from '../core/snap'

export const SnapContext = createContext(false)

export const ScaleInteractionContext = createContext<{
  request(pageIndex: number): void
  tracePage: number | null
  complete(points: Point[] | null): void
}>({ request: () => {}, tracePage: null, complete: () => {} })
export const isMeasureTool = (tool: string): tool is MeasureKind => tool === 'distance' || tool === 'perimeter' || tool === 'area'
const cssColor = (c: readonly number[]) => `rgb(${c.map(n => n * 255).join(' ')})`

export function MeasurementShape({ points, kind, text, fontSize, color, width, opacity, dash, showText = true, showFill = true, haloWidth, routeComposition }: {
  points: Point[]; kind: MeasureKind; text: string; fontSize: number; color: string; width: number; opacity: number; dash?: QuantityLineStyle['dash']; showText?: boolean; showFill?: boolean; haloWidth?: number; routeComposition?: { count: number; title: string }
}) {
  const label = measureLabel(points, kind, fontSize)
  const coords = points.map(p => p.join(',')).join(' ')
  let ticks = ''
  if (kind === 'distance' && points.length >= 2) {
    const a = Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]), dx = -Math.sin(a) * 5, dy = Math.cos(a) * 5
    ticks = points.map(p => `M${p[0] - dx},${p[1] - dy}L${p[0] + dx},${p[1] + dy}`).join(' ')
  }
  return <>
    {haloWidth !== undefined && <g className="annotation-selection-halo" fill="none" stroke="#fff" opacity={.85} strokeWidth={haloWidth} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
      {kind === 'area' ? <polygon points={coords} /> : <polyline points={coords} />}
      {ticks && <path d={ticks} />}
    </g>}
    <g opacity={opacity} className="measurement-shape">
    {kind === 'area' ? <>{showFill && <polygon points={coords} fill={color} fillOpacity=".15" />}<polygon points={coords} fill="none" stroke={color} strokeWidth={width} strokeDasharray={quantityDashes(dash, width).join(' ')} /></> : <polyline points={coords} fill="none" stroke={color} strokeWidth={width} strokeDasharray={quantityDashes(dash, width).join(' ')} />}
    {ticks && <path d={ticks} fill="none" stroke={color} strokeWidth={width} strokeDasharray={quantityDashes(dash, width).join(' ')} />}
    {showText && <text className="measurement-label" x={label.anchor[0]} y={label.anchor[1] + fontSize * .3} transform={`rotate(${label.angle * 180 / Math.PI} ${label.anchor.join(' ')})`} textAnchor="middle" fontSize={fontSize} fill={color} stroke="white" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{text}</text>}
    {routeComposition && points[0] && <g className="route-composition-badge" pointerEvents="none" transform={`translate(${points[0].join(' ')})`}>
      <title>{routeComposition.title}</title><rect x={-fontSize * .6} y={-fontSize * .6} width={fontSize * 1.2} height={fontSize * 1.2} rx={fontSize * .2} fill={color} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize * .85} fill="white">{routeComposition.count}</text>
    </g>}
  </g></>
}

interface Props {
  zoom: number
  version: number
  onStatus(message: string): void
  svg: RefObject<SVGSVGElement | null>
  store: AnnotationStore
  pageIndex: number
  tool: EditorTool
  defaults: FormatDefaults
  quantityItem?: CountFixture
  select(id: string | null): void
}
export function useMeasurementInteraction(props: Props) {
  const snap = useContext(SnapContext)
  const snapMarker = useRef<SVGPathElement>(null)
  const rawCursor = useRef<Point | null>(null)
  const vertexIndex = useRef<SnapIndex | null>(null)
  const scaleInteraction = useContext(ScaleInteractionContext)
  const draftRef = useRef<SVGGElement>(null)
  const points = useRef<Point[]>([])
  const cursor = useRef<Point | null>(null)
  const down = useRef<{ id: number; start: Point; hadPoints: boolean } | null>(null)
  const vertex = useRef<{ id: string; index: number; original: EditableAnnotation; points: Point[]; element: SVGGElement | null } | null>(null)
  const frame = useRef(0)
  const tracing = scaleInteraction.tracePage === props.pageIndex
  const cloud = props.tool === 'cloudPolygon'
  const quantityItem = props.tool === 'count' && props.quantityItem && quantityMethod(props.quantityItem) !== 'click' ? props.quantityItem : undefined
  const quantityKind = quantityItem && quantityPoints(quantityMethod(quantityItem) as QuantityMark['method']) === 'polygon' ? 'area' : 'perimeter'
  const quantityMark = (id = 'draft'): QuantityMark => ({ version: 1, id, itemId: quantityItem!.id, method: quantityMethod(quantityItem!) as QuantityMark['method'], ...quantityItem?.defaults, ...(quantityMethod(quantityItem!) === 'polyline' ? { ...(quantityItem?.routeScope && quantityItem.routeScope !== 'all' ? { scope: quantityItem.routeScope } : {}), ...props.store.routeTemplateItems(quantityItem!.id) } : {}) })
  const extraCode = (id: string) => { const f = props.store.getCountFixture(id); return f ? fixtureCode(f) : id }
  const [pending, setPending] = useState<{ mark: QuantityMark; save(mark: QuantityMark): void } | null>(null)
  const constrain = (start: Point, end: Point, shift: boolean): Point => {
    if (!shift || !(quantityItem || vertex.current?.original.quantity)) return constrainMeasurePoint(start, end, shift)
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy), step = Math.PI / 4
    const angle = Math.round(Math.atan2(dy, dx) / step) * step
    return [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length]
  }
  const enabled = tracing || cloud || !!quantityItem || isMeasureTool(props.tool)
  const snapEnabled = snap && (tracing || !!quantityItem || isMeasureTool(props.tool))
  useEffect(() => {
    vertexIndex.current = null
    if (!snapEnabled) return
    const vertices: Point[] = []
    const add = (items: readonly Point[]) => { for (const p of items) { vertices.push(p); if (vertices.length > MAX_SNAP_VERTICES) return } }
    for (const a of props.store.getPageAnnotations(props.pageIndex)) {
      if (!props.store.isShownOnDrawing(a) || a.count) continue
      if (a.vertices) add(a.vertices)
      else if (a.line) vertices.push(...a.line)
      else if (a.inkList) { for (const stroke of a.inkList) if (stroke.length) vertices.push(stroke[0], stroke.at(-1)!) }
      else if (['square', 'cloudSquare', 'freetext', 'callout', 'symbol', 'issue'].includes(a.kind)) { const [x0, y0, x1, y1] = a.rect; vertices.push([x0, y0], [x1, y0], [x1, y1], [x0, y1]); if (a.calloutPoint) vertices.push(a.calloutPoint) }
      if (vertices.length > MAX_SNAP_VERTICES) break
    }
    if (!vertices.length) return
    const bounds = props.svg.current?.viewBox.baseVal
    if (!bounds) return
    try {
      vertexIndex.current = buildSnapIndex(vertices, [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height])
    } catch { props.onStatus(`頂点が多すぎるため、このページではスナップを使えません（上限 ${MAX_SNAP_VERTICES.toLocaleString()} 点）`) }
  }, [snapEnabled, props.version, props.pageIndex, props.store])
  useEffect(() => { snapMarker.current?.setAttribute('display', 'none') }, [snapEnabled])
  const resolvePoint = (p: Point, event: Pick<React.PointerEvent, 'altKey' | 'shiftKey'>, start?: Point): Point => {
    if (!snapEnabled) return start ? constrain(start, p, event.shiftKey) : p
    rawCursor.current = p
    const marker = snapMarker.current
    let point = p, axis: { start: Point; direction: Point } | undefined
    if (start && event.shiftKey) {
      const angle = Math.round(Math.atan2(p[1] - start[1], p[0] - start[0]) / (Math.PI / 4)) * Math.PI / 4
      const direction: Point = [Math.cos(angle), Math.sin(angle)], length = Math.hypot(p[0] - start[0], p[1] - start[1])
      point = [start[0] + direction[0] * length, start[1] + direction[1] * length]; axis = { start, direction }
    }
    const scale = props.zoom * (96 / 72), radius = 8 / scale
    const hit = event.altKey ? null : findSnap(point, radius, vertexIndex.current, axis)
    if (!hit) { marker?.setAttribute('display', 'none'); return point }
    const [x, y] = hit.point, r = 4 / scale
    const d = `M${x-r},${y-r}h${2*r}v${2*r}h${-2*r}Z`
    marker?.setAttribute('d', d); marker?.setAttribute('display', ''); marker?.setAttribute('data-kind', hit.kind)
    return hit.point
  }
  const clear = () => {
    snapMarker.current?.setAttribute('display', 'none'); rawCursor.current = null
    if (!frame.current && !points.current.length && !cursor.current && !down.current && !vertex.current && !draftRef.current?.firstChild) return
    if (frame.current) cancelAnimationFrame(frame.current)
    if (vertex.current?.element) vertex.current.element.style.visibility = ''
    vertex.current = null
    frame.current = 0; points.current = []; cursor.current = null; down.current = null
    draftRef.current?.replaceChildren()
  }
  const draw = (p: Point[], text: string, kind: MeasureKind, color: string, size: number, width: number, floating: boolean, intensity?: CloudIntensity, fill?: string, dash?: QuantityLineStyle['dash'], opacity?: number) => {
    const group = draftRef.current
    if (!group || !p.length) return
    // Fixed, tiny SVG draft. No React state, scene queries or Worker requests.
    const ns = 'http://www.w3.org/2000/svg'
    if (!group.firstChild) {
      group.appendChild(document.createElementNS(ns, intensity !== undefined ? 'path' : 'polyline'))
      group.appendChild(document.createElementNS(ns, 'text'))
    }
    const path = group.children[0], label = group.children[1]
    group.setAttribute('opacity', String(vertex.current?.original.opacity ?? props.defaults.cloudPolygon.opacity))
    if (intensity !== undefined) {
      path.setAttribute('d', cloudPath(p, intensity, width)); path.setAttribute('fill', fill ?? 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', String(width)); label.textContent = ''; return
    }
    if (opacity !== undefined) group.setAttribute('opacity', String(opacity)); else group.removeAttribute('opacity')
    path.setAttribute('stroke-dasharray', quantityDashes(dash, width).join(' '))
    path.setAttribute('points', [...p, ...(kind === 'area' ? [p[0]] : [])].map(p => p.join(',')).join(' '))
    path.setAttribute('fill', kind === 'area' ? color : 'none'); path.setAttribute('fill-opacity', '.15')
    path.setAttribute('stroke', color); path.setAttribute('stroke-width', String(width))
    const position = floating ? { anchor: [p.at(-1)![0] + 12, p.at(-1)![1] - 12] as Point, angle: 0 } : measureLabel(p, kind, size)
    label.setAttribute('x', String(position.anchor[0])); label.setAttribute('y', String(position.anchor[1]))
    label.setAttribute('font-size', String(size)); label.setAttribute('fill', color)
    label.setAttribute('stroke', 'white'); label.setAttribute('stroke-width', '3'); label.setAttribute('paint-order', 'stroke')
    label.setAttribute('text-anchor', floating ? 'start' : 'middle')
    label.setAttribute('transform', `rotate(${position.angle * 180 / Math.PI} ${position.anchor.join(' ')})`)
    label.textContent = text
  }
  const redraw = () => {
    frame.current = 0
    if (vertex.current) {
      const v = vertex.current, a = v.original
      if (a.kind === 'cloudPolygon') draw(v.points, '', 'area', cssColor(a.color), a.fontSize, a.borderWidth, false, a.cloudIntensity ?? 1, a.interiorColor ? cssColor(a.interiorColor) : undefined)
      else draw(v.points, props.store.quantityText(a, v.points), a.measure!.kind, cssColor(a.color), a.fontSize, a.borderWidth, false, undefined, undefined, a.quantityDash, a.opacity)
      return
    }
    if (!points.current.length) { draftRef.current?.replaceChildren(); return }
    const kind = tracing ? 'distance' : cloud ? 'area' : quantityItem ? quantityKind : isMeasureTool(props.tool) ? props.tool : 'distance'
    const p = cursor.current ? [...points.current, cursor.current] : points.current
    const scale = props.store.getScale(props.pageIndex)
    const f = props.defaults[cloud ? 'cloudPolygon' : kind]
    if (cloud) { draw(p, '', 'area', cssColor(f.color), f.fontSize, f.borderWidth, true, f.cloudIntensity, f.fillColor ? cssColor(f.fillColor) : undefined); return }
    if (quantityItem && scale && !tracing) {
      const line = quantityLine(quantityItem)
      draw(p, quantityLabel(p, scale.mmPerPoint, quantityMark(), fixtureCode(quantityItem), quantityItem.style.showCode, extraCode), kind, cssColor(quantityItem.style.color), quantityItem.style.size, line.width, true, undefined, undefined, line.dash, quantityItem.style.opacity); return
    }
    draw(p, tracing ? 'なぞって合わせる' : scale ? measureText(p, { ...scale, kind }) : '', kind, cssColor(f.color), f.fontSize, f.borderWidth, true)
  }
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(redraw) }
  useEffect(() => {
    if (!snapEnabled) return
    const modifiers = (event: KeyboardEvent) => {
      if (!['Alt', 'Shift'].includes(event.key) || !rawCursor.current || (event.target as Element)?.matches('input,select,textarea,[contenteditable="true"]')) return
      const p = resolvePoint(rawCursor.current, event, points.current.at(-1))
      if (points.current.length) { cursor.current = p; schedule() }
    }
    window.addEventListener('keydown', modifiers); window.addEventListener('keyup', modifiers)
    return () => { window.removeEventListener('keydown', modifiers); window.removeEventListener('keyup', modifiers) }
  })
  const commit = () => {
    const p = points.current
    if (tracing) { if (p.length >= 2) { const copy = p.map(p => [...p] as Point); clear(); scaleInteraction.complete(copy) }; return }
    if (cloud) {
      if (p.length < 3) return
      const f = props.defaults.cloudPolygon
      const rect: [number, number, number, number] = [Math.min(...p.map(p => p[0])), Math.min(...p.map(p => p[1])), Math.max(...p.map(p => p[0])), Math.max(...p.map(p => p[1]))]
      const a = props.store.create({ pageIndex: props.pageIndex, kind: 'cloudPolygon', rect, vertices: p, color: f.color, borderWidth: f.borderWidth, opacity: f.opacity, interiorColor: f.fillColor, cloudIntensity: f.cloudIntensity })
      clear(); props.store.selectOnly(a.id); props.select(a.id); return
    }
    const kind = quantityItem ? quantityKind : isMeasureTool(props.tool) ? props.tool : null
    if (!kind || p.length < (kind === 'area' ? 3 : 2)) return
    const scale = props.store.getScale(props.pageIndex)
    if (!scale) return
    const f = quantityItem ? { color: quantityItem.style.color, fontSize: quantityItem.style.size, borderWidth: quantityLine(quantityItem).width, opacity: quantityItem.style.opacity } : props.defaults[kind], measure = { ...scale, kind }
    const quantity = quantityItem ? quantityMark(crypto.randomUUID()) : null
    const vertices = p.map(point => [...point] as Point)
    const save = (mark: QuantityMark | null) => {
      const text = mark ? quantityLabel(vertices, scale.mmPerPoint, mark, fixtureCode(quantityItem!), quantityItem!.style.showCode, extraCode) : measureText(vertices, measure)
      const a = props.store.create({ pageIndex: props.pageIndex, kind, quantity: mark ? { ...mark, ...props.store.pickupLocation(props.pageIndex) } : null, quantityDash: quantityItem ? quantityLine(quantityItem).dash : undefined, vertices, measure, text,
        rect: measureBounds(vertices, kind, text, f.fontSize), color: f.color, fontSize: f.fontSize, borderWidth: f.borderWidth, opacity: f.opacity })
      props.store.selectOnly(a.id); props.select(a.id)
    }
    clear()
    if (quantity && quantityDimensions(quantity.method).some(key => !quantity[key])) setPending({ mark: quantity, save })
    else save(quantity)
  }
  useEffect(() => { clear(); setPending(null); return clear }, [props.tool, props.pageIndex, tracing, props.quantityItem?.id])
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (pending || (event.target as Element)?.matches('input,select,textarea,[contenteditable="true"]')) return
      if (!points.current.length && !tracing) return
      if (!['Backspace', 'Enter'].includes(event.key)) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === 'Backspace') { points.current.pop(); cursor.current = null; redraw() }
      else commit()
    }
    const otherPage = (event: Event) => { if ((event as CustomEvent<number>).detail !== props.pageIndex) clear() }
    window.addEventListener('keydown', onKey, true); window.addEventListener('karu-pdf:measurement-start', otherPage)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('karu-pdf:measurement-start', otherPage) }
  })
  const pointerDown = (event: React.PointerEvent, p: Point): boolean => {
    if (scaleInteraction.tracePage !== null && !tracing) return true
    const target = (event.target as Element).closest('[data-measure-vertex]')
    if (props.tool === 'select' && target) {
      const id = target.getAttribute('data-annotation-id')!, a = props.store.get(id)
      if (a?.vertices && (a.measure || a.kind === 'cloudPolygon')) {
        props.store.touch(id)
        vertex.current = { id, index: Number(target.getAttribute('data-measure-vertex')), original: a, points: a.vertices.map(p => [...p] as Point), element: target.closest<SVGGElement>('g.annotation-item') }
        if (vertex.current.element) vertex.current.element.style.visibility = 'hidden'
        event.currentTarget.setPointerCapture(event.pointerId)
        return true
      }
    }
    if (pending) return true
    if (!enabled) return false
    if (!tracing && !cloud && !props.store.getScale(props.pageIndex)) { scaleInteraction.request(props.pageIndex); return true }
    window.dispatchEvent(new CustomEvent('karu-pdf:measurement-start', { detail: props.pageIndex }))
    const hadPoints = points.current.length > 0
    const previous = points.current.at(-1)
    const next = resolvePoint(p, event, previous)
    if (tracing || props.tool === 'distance') {
      if (!hadPoints) points.current.push(next)
    } else if (!previous || Math.hypot(next[0] - previous[0], next[1] - previous[1]) > .01) points.current.push(next)
    cursor.current = null; down.current = { id: event.pointerId, start: p, hadPoints }
    event.currentTarget.setPointerCapture(event.pointerId); schedule()
    return true
  }
  const pointerMove = (event: React.PointerEvent, p: Point): boolean => {
    if (vertex.current) {
      const v = vertex.current
      const previous = v.points[v.index === 0 ? v.points.length - 1 : v.index - 1]
      v.points[v.index] = constrain(previous, p, event.shiftKey); schedule(); return true
    }
    if (!enabled) return false
    if (points.current.length) { cursor.current = resolvePoint(p, event, points.current.at(-1)!); schedule() }
    else if (snapEnabled) resolvePoint(p, event)
    return true
  }
  const pointerUp = (event: React.PointerEvent, p: Point): boolean => {
    if (vertex.current) {
      const v = vertex.current
      v.points[v.index] = constrain(v.points[v.index === 0 ? v.points.length - 1 : v.index - 1], p, event.shiftKey)
      clear(); props.store.updateMeasureVertices(v.id, v.points)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return true
    }
    const d = down.current
    if (!enabled || !d || d.id !== event.pointerId) return enabled
    down.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if ((tracing || props.tool === 'distance') && (d.hadPoints || Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 1)) {
      const end = resolvePoint(p, event, points.current[0])
      if (Math.hypot(end[0] - points.current[0][0], end[1] - points.current[0][1]) > .01) { points.current.push(end); commit() }
    }
    return true
  }
  return { pointerDown, pointerMove, pointerUp, doubleClick: () => { if (enabled) { commit(); return true }; return false },
    pointerLeave: () => { snapMarker.current?.setAttribute('display', 'none'); if (!down.current) rawCursor.current = null },
    cancel: () => { if (!points.current.length && !down.current && !vertex.current) return false; clear(); return true },
    draft: <><g ref={draftRef} className="measurement-draft" pointerEvents="none" /><path ref={snapMarker} data-testid={`snap-marker-${props.pageIndex}`} display="none" fill="white" stroke="#007cbb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" /></>,
    dialog: pending && <QuantityDimensionsDialog mark={pending.mark} complete={mark => { setPending(null); if (mark) pending.save(mark) }} /> }
}
