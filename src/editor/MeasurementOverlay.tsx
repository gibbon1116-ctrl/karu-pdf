import { createContext, useContext, useEffect, useRef, type RefObject } from 'react'
import type { Point } from '../core/annotations'
import { cloudPath, type CloudIntensity } from '../core/cloud'
import { constrainMeasurePoint, measureBounds, measureLabel, measureText, type MeasureKind } from '../core/measure'
import type { EditableAnnotation, AnnotationStore } from './AnnotationStore'
import type { EditorTool } from './AnnotationLayer'
import type { FormatDefaults } from './formatDefaults'

export const ScaleInteractionContext = createContext<{
  request(pageIndex: number): void
  tracePage: number | null
  complete(points: Point[] | null): void
}>({ request: () => {}, tracePage: null, complete: () => {} })
export const isMeasureTool = (tool: string): tool is MeasureKind => tool === 'distance' || tool === 'perimeter' || tool === 'area'
const cssColor = (c: readonly number[]) => `rgb(${c.map(n => n * 255).join(' ')})`

export function MeasurementShape({ points, kind, text, fontSize, color, width, opacity }: {
  points: Point[]; kind: MeasureKind; text: string; fontSize: number; color: string; width: number; opacity: number
}) {
  const label = measureLabel(points, kind, fontSize)
  const coords = points.map(p => p.join(',')).join(' ')
  let ticks = ''
  if (kind === 'distance' && points.length >= 2) {
    const a = Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]), dx = -Math.sin(a) * 5, dy = Math.cos(a) * 5
    ticks = points.map(p => `M${p[0] - dx},${p[1] - dy}L${p[0] + dx},${p[1] + dy}`).join(' ')
  }
  return <g opacity={opacity} className="measurement-shape">
    {kind === 'area' ? <><polygon points={coords} fill={color} fillOpacity=".15" /><polygon points={coords} fill="none" stroke={color} strokeWidth={width} /></> : <polyline points={coords} fill="none" stroke={color} strokeWidth={width} />}
    {ticks && <path d={ticks} fill="none" stroke={color} strokeWidth={width} />}
    <text className="measurement-label" x={label.anchor[0]} y={label.anchor[1] + fontSize * .3} transform={`rotate(${label.angle * 180 / Math.PI} ${label.anchor.join(' ')})`} textAnchor="middle" fontSize={fontSize} fill={color} stroke="white" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{text}</text>
  </g>
}

interface Props {
  svg: RefObject<SVGSVGElement | null>
  store: AnnotationStore
  pageIndex: number
  tool: EditorTool
  defaults: FormatDefaults
  select(id: string | null): void
}
export function useMeasurementInteraction(props: Props) {
  const scaleInteraction = useContext(ScaleInteractionContext)
  const draftRef = useRef<SVGGElement>(null)
  const points = useRef<Point[]>([])
  const cursor = useRef<Point | null>(null)
  const down = useRef<{ id: number; start: Point; hadPoints: boolean } | null>(null)
  const vertex = useRef<{ id: string; index: number; original: EditableAnnotation; points: Point[]; element: SVGGElement | null } | null>(null)
  const frame = useRef(0)
  const tracing = scaleInteraction.tracePage === props.pageIndex
  const cloud = props.tool === 'cloudPolygon'
  const enabled = tracing || cloud || isMeasureTool(props.tool)
  const clear = () => {
    if (frame.current) cancelAnimationFrame(frame.current)
    if (vertex.current?.element) vertex.current.element.style.visibility = ''
    vertex.current = null
    frame.current = 0; points.current = []; cursor.current = null; down.current = null
    draftRef.current?.replaceChildren()
  }
  const draw = (p: Point[], text: string, kind: MeasureKind, color: string, size: number, width: number, floating: boolean, intensity?: CloudIntensity, fill?: string) => {
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
    group.removeAttribute('opacity')
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
      else draw(v.points, measureText(v.points, a.measure!), a.measure!.kind, cssColor(a.color), a.fontSize, a.borderWidth, false)
      return
    }
    if (!points.current.length) { draftRef.current?.replaceChildren(); return }
    const kind = tracing ? 'distance' : cloud ? 'area' : isMeasureTool(props.tool) ? props.tool : 'distance'
    const p = cursor.current ? [...points.current, cursor.current] : points.current
    const scale = props.store.getScale(props.pageIndex)
    const f = props.defaults[cloud ? 'cloudPolygon' : kind]
    if (cloud) { draw(p, '', 'area', cssColor(f.color), f.fontSize, f.borderWidth, true, f.cloudIntensity, f.fillColor ? cssColor(f.fillColor) : undefined); return }
    draw(p, tracing ? 'なぞって合わせる' : scale ? measureText(p, { ...scale, kind }) : '', kind, cssColor(f.color), f.fontSize, f.borderWidth, true)
  }
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(redraw) }
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
    if (!isMeasureTool(props.tool) || p.length < (props.tool === 'area' ? 3 : 2)) return
    const scale = props.store.getScale(props.pageIndex)
    if (!scale) return
    const f = props.defaults[props.tool], measure = { ...scale, kind: props.tool }
    const text = measureText(p, measure)
    const a = props.store.create({ pageIndex: props.pageIndex, kind: props.tool, vertices: p, measure, text,
      rect: measureBounds(p, props.tool, text, f.fontSize), color: f.color, fontSize: f.fontSize, borderWidth: f.borderWidth, opacity: f.opacity })
    clear(); props.store.selectOnly(a.id); props.select(a.id)
  }
  useEffect(() => { clear(); return clear }, [props.tool, props.pageIndex, tracing])
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element)?.matches('input,select,textarea,[contenteditable="true"]')) return
      if (!points.current.length && !tracing) return
      if (!['Backspace', 'Escape', 'Enter'].includes(event.key)) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === 'Escape') { clear(); if (tracing) scaleInteraction.complete(null) }
      else if (event.key === 'Backspace') { points.current.pop(); cursor.current = null; redraw() }
      else commit()
    }
    const otherPage = (event: Event) => { if ((event as CustomEvent<number>).detail !== props.pageIndex) clear() }
    window.addEventListener('keydown', onKey, true); window.addEventListener('karu-pdf:measurement-start', otherPage)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('karu-pdf:measurement-start', otherPage) }
  })
  const pointerDown = (event: React.PointerEvent, p: Point): boolean => {
    if (scaleInteraction.tracePage !== null && !tracing) return true
    const target = (event.target as Element).closest('[data-measure-vertex]')
    if (target) {
      const id = target.getAttribute('data-annotation-id')!, a = props.store.get(id)
      if (a?.vertices && (a.measure || a.kind === 'cloudPolygon')) {
        props.store.touch(id)
        vertex.current = { id, index: Number(target.getAttribute('data-measure-vertex')), original: a, points: a.vertices.map(p => [...p] as Point), element: target.closest<SVGGElement>('g.annotation-item') }
        if (vertex.current.element) vertex.current.element.style.visibility = 'hidden'
        event.currentTarget.setPointerCapture(event.pointerId)
        return true
      }
    }
    if (!enabled) return false
    if (!tracing && !cloud && !props.store.getScale(props.pageIndex)) { scaleInteraction.request(props.pageIndex); return true }
    window.dispatchEvent(new CustomEvent('karu-pdf:measurement-start', { detail: props.pageIndex }))
    const hadPoints = points.current.length > 0
    const previous = points.current.at(-1)
    const next = previous ? constrainMeasurePoint(previous, p, event.shiftKey) : p
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
      v.points[v.index] = constrainMeasurePoint(previous, p, event.shiftKey); schedule(); return true
    }
    if (!enabled) return false
    if (points.current.length) { cursor.current = constrainMeasurePoint(points.current.at(-1)!, p, event.shiftKey); schedule() }
    return true
  }
  const pointerUp = (event: React.PointerEvent, p: Point): boolean => {
    if (vertex.current) {
      const v = vertex.current
      v.points[v.index] = constrainMeasurePoint(v.points[v.index === 0 ? v.points.length - 1 : v.index - 1], p, event.shiftKey)
      clear(); props.store.updateMeasureVertices(v.id, v.points)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return true
    }
    const d = down.current
    if (!enabled || !d || d.id !== event.pointerId) return enabled
    down.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if ((tracing || props.tool === 'distance') && (d.hadPoints || Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 1)) {
      const end = constrainMeasurePoint(points.current[0], p, event.shiftKey)
      if (Math.hypot(end[0] - points.current[0][0], end[1] - points.current[0][1]) > .01) { points.current.push(end); commit() }
    }
    return true
  }
  return { pointerDown, pointerMove, pointerUp, doubleClick: () => { if (enabled) { commit(); return true }; return false },
    cancel: () => { if (!enabled && !vertex.current) return false; clear(); return true },
    draft: <g ref={draftRef} className="measurement-draft" pointerEvents="none" /> }
}
