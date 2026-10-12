import { createPortal } from 'react-dom'
import type { DocumentSession } from '../app/documentModel'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { fixtureCode, fixtureDrawingCode, fixtureLabelCode } from '../core/countFixtures'
import { quantityLabel, quantityDashes, quantityPoints, quantityDimensions, type QuantityMark } from '../core/quantity'
import { quantityLine, type CountFixture, type QuantityLineStyle } from '../core/countFixtures'
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { QuantityDimensionsDialog } from './QuantityDimensionsDialog'
import type { Point } from '../core/annotations'
import { cloudPath, type CloudIntensity } from '../core/cloud'
import { pointInScaleRegion, scaleLabel, type PageScale, type ScaleRegion, constrainMeasurePoint, measureBounds, measureLabel, measureText, type MeasureKind } from '../core/measure'
import type { EditableAnnotation, AnnotationStore } from './AnnotationStore'
import type { EditorTool } from './AnnotationLayer'
import type { FormatDefaults } from './formatDefaults'
import { buildSnapIndex, findPreferredSnap, MAX_SNAP_VERTICES, type SnapIndex } from '../core/snap'
import { parseRoomRegions, parseRoomSets, pickupPoint, pointInRoomRegion, type RoomRegion, type RoomSet } from '../core/rooms'
import { normalizeFloor } from '../core/location'
import { insertPolygonVertex, removePolygonVertex } from '../core/polygonVertices'

export const SnapContext = createContext(false)
export const DrawingSnapContext = createContext<{ enabled: boolean; session: DocumentSession; pool: PdfWorkerPool } | null>(null)

export const ScaleInteractionContext = createContext<{
  request(pageIndex: number): void
  tracePage: number | null
  complete(points: Point[] | null): void
}>({ request: () => {}, tracePage: null, complete: () => {} })
export const isMeasureTool = (tool: string): tool is MeasureKind => tool === 'distance' || tool === 'perimeter' || tool === 'area'
const cssColor = (c: readonly number[]) => `rgb(${c.map(n => n * 255).join(' ')})`

export function MeasurementShape({ points, kind, text, fontSize, color, width, opacity, dash, showText = true, showFill = true, haloWidth, routeComposition, holes, holesId }: {
  points: Point[]; kind: MeasureKind; text: string; fontSize: number; color: string; width: number; opacity: number; dash?: QuantityLineStyle['dash']; showText?: boolean; showFill?: boolean; haloWidth?: number; routeComposition?: { count: number; title: string }; holes?: Point[][]; holesId?: string
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
    {kind === 'area' && !!holes?.length && holesId && <>
      <defs><clipPath id={`${holesId}-outer`} clipPathUnits="userSpaceOnUse"><polygon points={coords} /></clipPath></defs>
      <g clipPath={`url(#${holesId}-outer)`} pointerEvents="none">
        {holes.map((hole, index) => {
          const holeCoords = hole.map(p => p.join(',')).join(' ')
          const xs = hole.map(p => p[0]), ys = hole.map(p => p[1])
          const span = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)
          const spacing = Number.isFinite(span) ? Math.max(6, span / 512) : 6
          const patternId = `${holesId}-hatch-${index}`
          return <g key={index} className="measurement-hole">
            <defs><pattern id={patternId} patternUnits="userSpaceOnUse" width={spacing / Math.SQRT2} height={spacing / Math.SQRT2} patternTransform="rotate(45)">
              <path d={`M0,0V${spacing / Math.SQRT2}`} fill="none" stroke={color} strokeWidth={Math.max(.25, width / 2)} strokeOpacity=".45" />
            </pattern></defs>
            <polygon points={holeCoords} fill={color} fillOpacity=".08" />
            <polygon points={holeCoords} fill={`url(#${patternId})`} />
            <polygon points={holeCoords} fill="none" stroke={color} strokeWidth={Math.max(.25, width / 2)} strokeDasharray="3 3" />
          </g>
        })}
      </g>
    </>}
    {ticks && <path d={ticks} fill="none" stroke={color} strokeWidth={width} strokeDasharray={quantityDashes(dash, width).join(' ')} />}
    {showText && <text className="measurement-label" x={label.anchor[0]} y={label.anchor[1] + fontSize * .3} transform={`rotate(${label.angle * 180 / Math.PI} ${label.anchor.join(' ')})`} textAnchor="middle" fontSize={fontSize} fill={color} stroke="white" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{text}</text>}
    {routeComposition && points[0] && <g className="route-composition-badge" pointerEvents="none" transform={`translate(${points[0].join(' ')})`}>
      <title>{routeComposition.title}</title><rect x={-fontSize * .6} y={-fontSize * .6} width={fontSize * 1.2} height={fontSize * 1.2} rx={fontSize * .2} fill={color} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize * .85} fill="white">{routeComposition.count}</text>
    </g>}
  </g></>
}

export function RoomRegionDialog({ store, initial, points, floor = '', roomSet, complete }: {
  store: AnnotationStore
  initial?: RoomRegion
  points?: Point[]
  floor?: string
  roomSet?: RoomSet
  complete(region: RoomRegion | null, toSet?: boolean): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [roomFloor, setRoomFloor] = useState(initial ? initial.floor ?? '' : floor)
  const [toSet, setToSet] = useState(!!roomSet)
  const [error, setError] = useState('')
  const names = store.getRoomNames()
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  return createPortal(<dialog ref={dialog} className="room-region-dialog" aria-label="部屋の範囲"
    onCancel={event => { event.preventDefault(); complete(null) }}
    onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => {
      event.preventDefault()
      const normalizedFloor = normalizeFloor(roomFloor)
      const proposed: RoomRegion = {
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        ...(normalizedFloor ? { floor: normalizedFloor } : {}),
        points: (initial?.points ?? points ?? []).map(point => [...point] as Point),
      }
      const region = parseRoomRegions([proposed])[0]
      if (!region) {
        setError('部屋名は1〜40文字で改行なし、階は40文字までで入力してください。範囲は3〜500点で囲んでください。')
        return
      }
      complete(region, !!roomSet && toSet)
    }}>
      <h2>部屋の範囲</h2>
      <label>部屋名<input autoFocus required maxLength={40} value={name}
        list="room-region-name-candidates" onChange={event => setName(event.currentTarget.value)} /></label>
      <datalist id="room-region-name-candidates">{names.map(value => <option key={value} value={value} />)}</datalist>
      <label>階<input maxLength={40} value={roomFloor} onChange={event => setRoomFloor(event.currentTarget.value)} /></label>
      {!initial && roomSet && <label className="room-set-add">
        <input type="checkbox" checked={toSet} onChange={event => setToSet(event.currentTarget.checked)} />
        部屋の組「{roomSet.name}」に足す（共通の図面すべてに反映）
      </label>}
      {error && <p role="alert">{error}</p>}
      <div className="room-region-dialog-actions">
        <button type="submit">登録する</button>
        <button type="button" onClick={() => complete(null)}>やめる</button>
      </div>
    </form>
  </dialog>, document.body)
}

function RoomPickupDialog({ region, count, complete }: {
  region: RoomRegion
  count: number
  complete(apply: boolean): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  return createPortal(<dialog ref={dialog} className="room-region-dialog" aria-label="既存の拾いに部屋を入れる"
    onCancel={event => { event.preventDefault(); complete(false) }}
    onKeyDown={event => event.stopPropagation()}>
    <p>この範囲の {count} 件の拾いの部屋を「{region.name}」にしますか（Ctrl+Z で戻せます）</p>
    <div className="room-region-dialog-actions">
      <button type="button" onClick={() => complete(true)}>部屋を入れる</button>
      <button type="button" onClick={() => complete(false)}>入れない</button>
    </div>
  </dialog>, document.body)
}

export function RoomSetDialog({ initial, name: initialName, floor: initialFloor = '', complete }: {
  initial?: RoomSet
  name: string
  floor?: string
  complete(value: { name: string; floor?: string } | null): string | void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initial?.name ?? initialName)
  const [floor, setFloor] = useState(initial?.floor ?? initialFloor)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  return createPortal(<dialog ref={dialog} className="room-region-dialog" aria-label="部屋の組"
    onCancel={event => { event.preventDefault(); complete(null) }}
    onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => {
      event.preventDefault()
      const normalizedFloor = normalizeFloor(floor)
      const value = {
        name: name.trim(),
        ...(normalizedFloor ? { floor: normalizedFloor } : {}),
      }
      if (!parseRoomSets({ version: 1, sets: [{ id: 'validation', ...value, regions: [] }] }).length) {
        setError('組の名前は1〜40文字で改行なし、階は40文字までで入力してください。')
        return
      }
      const reason = complete(value)
      if (reason) setError(reason)
    }}>
      <h2>部屋の組</h2>
      <label>組の名前<input autoFocus required maxLength={40} value={name}
        onChange={event => setName(event.currentTarget.value)} /></label>
      <label>階<input maxLength={40} value={floor}
        onChange={event => setFloor(event.currentTarget.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="room-region-dialog-actions">
        <button type="submit">{initial ? '変更する' : '作る'}</button>
        <button type="button" onClick={() => complete(null)}>やめる</button>
      </div>
    </form>
  </dialog>, document.body)
}

export function RoomSetPickupDialog({ count, complete }: {
  count: number
  complete(apply: boolean): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  return createPortal(<dialog ref={dialog} className="room-region-dialog" aria-label="既存の拾いに部屋を入れる"
    onCancel={event => { event.preventDefault(); complete(false) }}
    onKeyDown={event => event.stopPropagation()}>
    <p>この図面の {count} 件の拾いに部屋を入れますか（Ctrl+Z で戻せます）</p>
    <div className="room-region-dialog-actions">
      <button type="button" onClick={() => complete(true)}>部屋を入れる</button>
      <button type="button" onClick={() => complete(false)}>入れない</button>
    </div>
  </dialog>, document.body)
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
  const drawing = useContext(DrawingSnapContext)
  const drawingIndex = useRef<SnapIndex | null>(null)
  const requestDrawing = useRef<(() => void) | null>(null)
  const snapMarker = useRef<SVGPathElement>(null)
  const rawCursor = useRef<Point | null>(null)
  const vertexIndex = useRef<SnapIndex | null>(null)
  const scaleInteraction = useContext(ScaleInteractionContext)
  const draftRef = useRef<SVGGElement>(null)
  const pickedScale = useRef<{ scale: PageScale; region?: ScaleRegion } | null>(null)
  const points = useRef<Point[]>([])
  const cursor = useRef<Point | null>(null)
  const down = useRef<{ id: number; start: Point; hadPoints: boolean } | null>(null)
  const vertex = useRef<{ id: string; index: number; original: EditableAnnotation; points: Point[]; element: SVGGElement | null; pointerId: number; start: Point } | null>(null)
  const roomVertex = useRef<{ id: string; index: number; original: RoomRegion; points: Point[]; element: SVGGElement | null; pointerId: number; start: Point } | null>(null)
  const roomEditSession = useRef<{ id: string; tool: EditorTool; pageIndex: number; viewPage?: number } | null>(null)
  const roomSetAlignSession = useRef<{ id: string; tool: EditorTool; pageIndex: number; viewPage?: number } | null>(null)
  const roomSetDrag = useRef<{
    id: string; pointerId: number; start: Point; offset: Point; delta: Point;
    inside: boolean; moved: boolean; element: SVGGElement | null
  } | null>(null)
  const [resetRoomSetAnchor, setResetRoomSetAnchor] = useState(false)
  const isEditableArea = (annotation: EditableAnnotation) => !annotation.legacyChange
    && !annotation.count && annotation.measure?.kind === 'area' && !!annotation.vertices
    && (!annotation.quantity || annotation.quantity.method === 'polygon' || annotation.quantity.method === 'polygonDepth')
  const samePoints = (a: readonly Point[], b: readonly Point[]) => a.length === b.length
    && a.every((point, index) => point[0] === b[index][0] && point[1] === b[index][1])
  const movedVertex = (start: Point, end: Point) => Math.hypot(end[0] - start[0], end[1] - start[1]) * props.zoom * (96 / 72) >= 3
  const frame = useRef(0)
  const tracing = scaleInteraction.tracePage === props.pageIndex
  const cloud = props.tool === 'cloudPolygon'
  const pickupMethod = props.quantityItem ? props.store.pickupMethod(props.quantityItem) : undefined
  const quantityItem = props.tool === 'count' && props.quantityItem && pickupMethod !== 'click' ? props.quantityItem : undefined
  const quantityKind = quantityItem && quantityPoints(pickupMethod as QuantityMark['method']) === 'polygon' ? 'area' : 'perimeter'
  const quantityMark = (id = 'draft'): QuantityMark => {
    const method = pickupMethod as QuantityMark['method']
    const mark: QuantityMark = { version: 1, id, itemId: quantityItem!.id, method }
    if (method === 'polyline') {
      if (quantityItem?.defaults?.addM !== undefined) mark.addM = quantityItem.defaults.addM
      if (quantityItem?.defaults?.slackM !== undefined) mark.slackM = quantityItem.defaults.slackM
      Object.assign(mark, props.store.routeTemplateItems(quantityItem!.id))
    } else {
      for (const key of quantityDimensions(method)) {
        const value = quantityItem?.defaults?.[key]
        if (value !== undefined) mark[key] = value
      }
    }
    return mark
  }
  const roomSetAlignPage = props.store.roomSetAlignPage
  const aligningRoomSet = roomSetAlignPage === props.pageIndex && !tracing
  const alignedRoomSet = aligningRoomSet ? props.store.getPageRoomSet(props.pageIndex) : undefined
  const roomCapturePage = props.store.roomCapturePage
  const capturingRoom = roomCapturePage === props.pageIndex && !tracing
  const roomEditTarget = props.store.roomEditTarget
  const editedRoom = roomEditTarget?.pageIndex === props.pageIndex
    ? props.store.effectiveRoomRegions(props.pageIndex).find(({ region }) => region.id === roomEditTarget.id)?.region
    : undefined
  const editingRoom = !!editedRoom && !tracing && !capturingRoom
  const roomSession = useRef<{ tool: EditorTool; pageIndex: number; viewPage?: number } | null>(null)
  const [pendingRoom, setPendingRoom] = useState<{ points: Point[]; floor: string } | null>(null)
  const [roomConfirmation, setRoomConfirmation] = useState<{ region: RoomRegion; ids: string[] } | null>(null)
  const [roomError, setRoomError] = useState('')
  const holeTarget = props.store.areaHoleTarget
  const holeAnnotation = holeTarget ? props.store.get(holeTarget) : undefined
  const excluding = !!holeAnnotation && holeAnnotation.pageIndex === props.pageIndex && !tracing && !capturingRoom && !editingRoom
  const holeSession = useRef<{ id: string; tool: EditorTool; pageIndex: number; viewPage?: number } | null>(null)
  const [exclusionError, setExclusionError] = useState('')
  const extraCode = (id: string) => { const f = props.store.getCountFixture(id); return f ? fixtureLabelCode(f) : id }
  const [pending, setPending] = useState<{ mark: QuantityMark; save(mark: QuantityMark): void } | null>(null)
  const constrain = (start: Point, end: Point, shift: boolean): Point => {
    if (!shift || !(quantityItem || vertex.current?.original.quantity)) return constrainMeasurePoint(start, end, shift)
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy), step = Math.PI / 4
    const angle = Math.round(Math.atan2(dy, dx) / step) * step
    return [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length]
  }
  const areaSelection = props.tool === 'select' ? props.store.selectedIds() : []
  const selectedArea = areaSelection.length === 1 ? props.store.get(areaSelection[0]) : undefined
  const editingArea = !!selectedArea && isEditableArea(selectedArea)
  const enabled = aligningRoomSet || editingRoom || capturingRoom || excluding || tracing || cloud || !!quantityItem || isMeasureTool(props.tool)
  const snapEnabled = snap && (aligningRoomSet || editingRoom || editingArea || capturingRoom || excluding || tracing || !!quantityItem || isMeasureTool(props.tool))
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
  useEffect(() => {
    snapMarker.current?.setAttribute('data-drawing-ready', 'false')
    if (!snapEnabled || !drawing?.enabled || !props.svg.current) return
    const svg = props.svg.current, session = drawing.session, pool = drawing.pool
    let controller: AbortController | null = null, visible = false, alive = true, loading = false, unavailable = false
    const load = () => {
      if (!alive || !visible || loading || unavailable) return
      loading = true; controller = new AbortController()
      const own = controller, size = session.pageSizes[props.pageIndex]
      if (!size) { loading = false; return }
      void session.vectorCache.endpoints(props.pageIndex, pool, [0, 0, size.width, size.height], own.signal).then(index => {
        if (!alive || own.signal.aborted) return
        unavailable = !index
        snapMarker.current?.setAttribute('data-drawing-ready', String(!!index))
        if (!index && session.vectorCache.reportUnavailable(props.pageIndex)) props.onStatus('このページは線の情報が無いか上限で打ち切られたため、図面の端点には合わせません')
      }).catch(error => {
        if (alive && !own.signal.aborted) {
          unavailable = true
          if (session.vectorCache.reportUnavailable(props.pageIndex)) props.onStatus('図面の端点を取得できませんでした: ' + String(error))
        }
      }).finally(() => { if (controller === own) loading = false })
    }
    requestDrawing.current = load
    const observe = new IntersectionObserver(entries => {
      const next = entries.some(e => e.isIntersecting)
      if (next === visible) return
      visible = next; controller?.abort(); loading = false
      snapMarker.current?.setAttribute('data-drawing-ready', 'false')
      if (next) load()
    })
    observe.observe(svg)
    return () => { alive = false; requestDrawing.current = null; observe.disconnect(); controller?.abort() }
  }, [snapEnabled, drawing?.enabled, drawing?.session, drawing?.pool, drawing?.session.pageRevision, drawing?.session.savedRevision, props.pageIndex])
  useEffect(() => { snapMarker.current?.setAttribute('display', 'none') }, [snapEnabled, drawing?.enabled])
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
    const endpointIndex = drawing?.enabled ? drawing.session.vectorCache.peekEndpoint(props.pageIndex) : null
    // A page evicted by another search is prepared again on demand, without retaining a second index.
    if (drawing?.enabled && !endpointIndex && !event.altKey) requestDrawing.current?.()
    const hit = event.altKey ? null : findPreferredSnap(point, radius, vertexIndex.current, endpointIndex, axis)
    if (!hit) { marker?.setAttribute('display', 'none'); return point }
    const [x, y] = hit.point, r = 4 / scale
    const d = hit.kind === 'drawing-endpoint' ? `M${x-r},${y}a${r},${r} 0 1,0 ${2*r},0a${r},${r} 0 1,0 ${-2*r},0` : `M${x-r},${y-r}h${2*r}v${2*r}h${-2*r}Z`
    marker?.setAttribute('d', d); marker?.setAttribute('display', ''); marker?.setAttribute('data-kind', hit.kind)
    return hit.point
  }
  const clear = () => {
    pickedScale.current = null
    snapMarker.current?.setAttribute('display', 'none'); rawCursor.current = null
    if (!frame.current && !points.current.length && !cursor.current && !down.current && !vertex.current && !roomVertex.current && !roomSetDrag.current && !draftRef.current?.firstChild) return
    if (frame.current) cancelAnimationFrame(frame.current)
    const alignmentDrag = roomSetDrag.current
    alignmentDrag?.element?.removeAttribute('transform')
    if (alignmentDrag && props.svg.current?.hasPointerCapture(alignmentDrag.pointerId)) {
      props.svg.current.releasePointerCapture(alignmentDrag.pointerId)
    }
    roomSetDrag.current = null
    for (const drag of [vertex.current, roomVertex.current]) {
      if (drag?.element) drag.element.style.visibility = ''
      if (drag && props.svg.current?.hasPointerCapture(drag.pointerId)) props.svg.current.releasePointerCapture(drag.pointerId)
    }
    vertex.current = null
    roomVertex.current = null
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
    if (roomSetDrag.current) {
      const drag = roomSetDrag.current
      if (drag.inside) {
        drag.element?.setAttribute('transform', `translate(${drag.delta[0]} ${drag.delta[1]})`)
      }
      return
    }
    if (roomVertex.current) {
      const drag = roomVertex.current
      draw(drag.points, drag.original.name, 'area', '#007cbb', 11 / Math.max(.01, props.zoom * (96 / 72)), 1.5 / Math.max(.01, props.zoom * (96 / 72)), false, undefined, undefined, 'dashed', 1)
      draftRef.current?.children[0]?.setAttribute('fill-opacity', '.12')
      return
    }
    if (vertex.current) {
      const v = vertex.current, a = v.original
      if (a.kind === 'cloudPolygon') draw(v.points, '', 'area', cssColor(a.color), a.fontSize, a.borderWidth, false, a.cloudIntensity ?? 1, a.interiorColor ? cssColor(a.interiorColor) : undefined)
      else draw(v.points, props.store.quantityText(a, v.points), a.measure!.kind, cssColor(a.color), a.fontSize, a.borderWidth, false, undefined, undefined, a.quantityDash, a.opacity)
      return
    }
    if (!points.current.length) { draftRef.current?.replaceChildren(); return }
    if (capturingRoom) {
      const p = cursor.current ? [...points.current, cursor.current] : points.current
      draw(p, '部屋の範囲', 'area', '#007cbb', 10, .75, true, undefined, undefined, 'dashed', 1)
      draftRef.current?.children[0]?.setAttribute('fill-opacity', '.08')
      return
    }
    if (excluding && holeAnnotation?.measure) {
      const p = cursor.current ? [...points.current, cursor.current] : points.current
      draw(p, '除外範囲', 'area', cssColor(holeAnnotation.color), holeAnnotation.fontSize, Math.max(.5, holeAnnotation.borderWidth), true, undefined, undefined, 'dashed', holeAnnotation.opacity)
      draftRef.current?.children[0]?.setAttribute('fill-opacity', '.08')
      return
    }
    const kind = tracing ? 'distance' : cloud ? 'area' : quantityItem ? quantityKind : isMeasureTool(props.tool) ? props.tool : 'distance'
    const p = cursor.current ? [...points.current, cursor.current] : points.current
    const scale = pickedScale.current?.scale
    const f = props.defaults[cloud ? 'cloudPolygon' : kind]
    if (cloud) { draw(p, '', 'area', cssColor(f.color), f.fontSize, f.borderWidth, true, f.cloudIntensity, f.fillColor ? cssColor(f.fillColor) : undefined); return }
    if (quantityItem && scale && !tracing) {
      const line = quantityLine(quantityItem)
      const code = quantityItem.kind === undefined || quantityItem.kind === 'count' ? fixtureDrawingCode(quantityItem) : fixtureLabelCode(quantityItem)
      draw(p, quantityLabel(p, scale.mmPerPoint, quantityMark(), code, quantityItem.style.showCode, extraCode, id => props.store.openingSize(id)), kind, cssColor(quantityItem.style.color), quantityItem.style.size, line.width, true, undefined, undefined, line.dash, quantityItem.style.opacity); return
    }
    draw(p, tracing ? 'なぞって合わせる' : scale ? measureText(p, { ...scale, kind }) : '', kind, cssColor(f.color), f.fontSize, f.borderWidth, true)
  }
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(redraw) }
  useEffect(() => {
    if (!snapEnabled) return
    const modifiers = (event: KeyboardEvent) => {
      if (!['Alt', 'Shift'].includes(event.key) || !rawCursor.current || (event.target as Element)?.matches('input,select,textarea,[contenteditable="true"]')) return
      const drag = roomVertex.current ?? (vertex.current && isEditableArea(vertex.current.original) ? vertex.current : null)
      if (drag) {
        const previous = drag.points[drag.index === 0 ? drag.points.length - 1 : drag.index - 1]
        drag.points[drag.index] = resolvePoint(rawCursor.current, event, previous)
        schedule()
        return
      }
      const p = resolvePoint(rawCursor.current, event, points.current.at(-1))
      if (points.current.length) { cursor.current = p; schedule() }
    }
    window.addEventListener('keydown', modifiers); window.addEventListener('keyup', modifiers)
    return () => { window.removeEventListener('keydown', modifiers); window.removeEventListener('keyup', modifiers) }
  })
  const saveRoomPoints = (id: string, nextPoints: Point[]) => {
    const region = props.store.effectiveRoomRegions(props.pageIndex).find(current => current.region.id === id)?.region
    if (!region) { props.store.endRoomEdit(false); return }
    if (samePoints(region.points, nextPoints)) return
    try {
      props.store.updateRoomRegion(props.pageIndex, {
        ...region, points: nextPoints.map(point => [...point] as Point),
      })
      setRoomError('')
      props.onStatus('')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setRoomError(message)
      props.onStatus(message)
    }
  }
  const finishRoomEdit = () => {
    clear()
    props.store.endRoomEdit()
  }
  const commit = () => {
    if (pending || pendingRoom || roomConfirmation) return
    if (aligningRoomSet || editingRoom) return
    const p = points.current
    if (capturingRoom) {
      if (p.length < 3) return
      const draft = p.map(point => [...point] as Point)
      const floor = props.store.pickupLocation(props.pageIndex).floor ?? ''
      clear()
      setRoomError('')
      setPendingRoom({ points: draft, floor })
      return
    }
    if (excluding && holeAnnotation) {
      if (p.length < 3) return
      const holes = holeAnnotation.quantity?.holes ?? holeAnnotation.measure?.holes ?? []
      const reason = props.store.setAreaHoles(holeAnnotation.id, [...holes, p.map(point => [...point] as Point)])
      if (reason) { setExclusionError(reason); props.onStatus(reason); return }
      clear()
      setExclusionError('')
      props.onStatus('')
      return
    }
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
    const scale = pickedScale.current?.scale
    if (!scale) return
    const f = quantityItem ? { color: quantityItem.style.color, fontSize: quantityItem.style.size, borderWidth: quantityLine(quantityItem).width, opacity: quantityItem.style.opacity } : props.defaults[kind], measure = { ...scale, kind }
    const quantity = quantityItem ? quantityMark(crypto.randomUUID()) : null
    const vertices = p.map(point => [...point] as Point)
    const startRegion = pickedScale.current?.region
    const regions = props.store.scaleRegions.get(props.pageIndex)
    const crosses = startRegion ? vertices.some(point => !pointInScaleRegion(startRegion, point))
      : !!regions?.length && vertices.some(point => regions.some(region => pointInScaleRegion(region, point)))
    const save = (mark: QuantityMark | null) => {
      const code = quantityItem ? quantityItem.kind === undefined || quantityItem.kind === 'count' ? fixtureDrawingCode(quantityItem) : fixtureLabelCode(quantityItem) : ''
      const text = mark ? quantityLabel(vertices, scale.mmPerPoint, mark, code, quantityItem!.style.showCode, extraCode, id => props.store.openingSize(id)) : measureText(vertices, measure)
      const a = props.store.create({ pageIndex: props.pageIndex, kind, quantity: mark ? { ...mark, ...props.store.pickupLocation(props.pageIndex, pickupPoint({ quantity: mark, vertices })) } : null, quantityDash: quantityItem ? quantityLine(quantityItem).dash : undefined, vertices, measure, text,
        rect: measureBounds(vertices, kind, text, f.fontSize), color: f.color, fontSize: f.fontSize, borderWidth: f.borderWidth, opacity: f.opacity })
      props.store.selectOnly(a.id); props.select(a.id)
      if (crosses) props.onStatus(`縮尺の範囲をまたいでいます。始点の縮尺（${scaleLabel(scale).replace(/^(縮尺|約) /, '')}）で計算しました`)
    }
    clear()
    if (quantity && quantityDimensions(quantity.method).some(key => !quantity[key])) setPending({ mark: quantity, save })
    else save(quantity)
  }
  useEffect(() => {
    clear()
    setPending(null)
    setPendingRoom(null)
    setExclusionError('')
    setRoomError('')
    return clear
  }, [props.tool, props.pageIndex, tracing, props.quantityItem?.id, pickupMethod, holeTarget, roomCapturePage, roomEditTarget?.pageIndex, roomEditTarget?.id, roomSetAlignPage])
  useEffect(() => {
    setRoomConfirmation(null)
  }, [props.tool, props.pageIndex, props.store])
  useEffect(() => {
    if (roomCapturePage !== null || holeTarget !== null || roomEditTarget !== null || roomSetAlignPage !== null) setRoomConfirmation(null)
  }, [roomCapturePage, holeTarget, roomEditTarget?.pageIndex, roomEditTarget?.id, roomSetAlignPage])
  useEffect(() => {
    const active = roomSetAlignSession.current
    if (active && (active.id !== alignedRoomSet?.id
      || roomSetAlignPage !== active.pageIndex
      || active.tool !== props.tool || active.pageIndex !== props.pageIndex
      || active.viewPage !== undefined && active.viewPage !== drawing?.session.view.page
      || tracing)) {
      roomSetAlignSession.current = null
      clear()
      setResetRoomSetAnchor(false)
      if (props.store.roomSetAlignPage === active.pageIndex) props.store.endRoomSetAlign(false)
      return
    }
    if (!active && aligningRoomSet && alignedRoomSet) {
      setResetRoomSetAnchor(false)
      roomSetAlignSession.current = {
        id: alignedRoomSet.id, tool: props.tool, pageIndex: props.pageIndex,
        viewPage: drawing?.session.view.page,
      }
    }
  }, [roomSetAlignPage, alignedRoomSet?.id, props.tool, props.pageIndex, props.version, tracing, drawing?.session.view.page])
  useEffect(() => () => {
    const active = roomSetAlignSession.current
    roomSetAlignSession.current = null
    if (active && props.store.roomSetAlignPage === active.pageIndex) props.store.endRoomSetAlign(false)
  }, [props.store])
  useEffect(() => {
    const completion = props.store.takeRoomEditCompletion(props.pageIndex)
    if (!completion) return
    const active = roomEditSession.current
    if (tracing || roomCapturePage !== null || holeTarget !== null || roomEditTarget !== null || roomSetAlignPage !== null
      || active && (active.tool !== props.tool || active.pageIndex !== props.pageIndex
        || active.viewPage !== undefined && active.viewPage !== drawing?.session.view.page)) return
    const region = props.store.effectiveRoomRegions(props.pageIndex).find(current => current.region.id === completion.region.id)?.region
    if (!region || !samePoints(region.points, completion.region.points)) return
    const ids = props.store.pickupsInRoom(props.pageIndex, region).filter(id => {
      const annotation = props.store.get(id)
      // Legacy count marks carry no location; treat them as having none.
      const mark = (annotation?.quantity ?? annotation?.count) as { room?: string; floor?: string } | undefined
      return !!mark && ((mark.room ?? '') !== region.name
        || !!region.floor && normalizeFloor(mark.floor ?? '') !== normalizeFloor(region.floor))
    })
    if (ids.length) setRoomConfirmation({ region: structuredClone(region), ids })
  }, [props.version, props.tool, props.pageIndex, props.store, tracing, roomCapturePage, holeTarget, roomEditTarget?.pageIndex, roomEditTarget?.id, roomSetAlignPage, drawing?.session.view.page])
  useEffect(() => {
    const active = roomEditSession.current
    if (active && (active.id !== roomEditTarget?.id || active.pageIndex !== roomEditTarget?.pageIndex
      || active.tool !== props.tool || active.pageIndex !== props.pageIndex
      || active.viewPage !== undefined && active.viewPage !== drawing?.session.view.page
      || tracing)) {
      roomEditSession.current = null
      clear()
      setRoomError('')
      if (props.store.roomEditTarget?.id === active.id
        && props.store.roomEditTarget.pageIndex === active.pageIndex) props.store.endRoomEdit(false)
      return
    }
    if (!active && editingRoom) {
      roomEditSession.current = { id: editedRoom!.id, tool: props.tool, pageIndex: props.pageIndex, viewPage: drawing?.session.view.page }
    }
  }, [roomEditTarget?.pageIndex, roomEditTarget?.id, props.tool, props.pageIndex, props.version, tracing, editingRoom, drawing?.session.view.page])
  useEffect(() => () => {
    const active = roomEditSession.current
    roomEditSession.current = null
    if (active && props.store.roomEditTarget?.id === active.id
      && props.store.roomEditTarget.pageIndex === active.pageIndex) props.store.endRoomEdit(false)
  }, [props.store])
  useEffect(() => {
    const active = roomSession.current
    if (active && (roomCapturePage !== active.pageIndex || active.tool !== props.tool
      || active.pageIndex !== props.pageIndex
      || active.viewPage !== undefined && active.viewPage !== drawing?.session.view.page
      || tracing)) {
      roomSession.current = null
      clear()
      setPendingRoom(null)
      setRoomError('')
      if (props.store.roomCapturePage === active.pageIndex) props.store.endRoomCapture()
      return
    }
    if (!active && capturingRoom) {
      roomSession.current = { tool: props.tool, pageIndex: props.pageIndex, viewPage: drawing?.session.view.page }
    }
  }, [roomCapturePage, props.tool, props.pageIndex, props.version, tracing, capturingRoom, drawing?.session.view.page])
  useEffect(() => () => {
    const active = roomSession.current
    roomSession.current = null
    if (active && props.store.roomCapturePage === active.pageIndex) props.store.endRoomCapture()
  }, [props.store])
  useEffect(() => {
    const active = holeSession.current
    const selected = props.store.selectedIds()
    const validSelection = !!holeAnnotation && !holeAnnotation.legacyChange
      && selected.length === 1 && selected[0] === holeTarget
      && !!holeAnnotation.vertices && !!holeAnnotation.measure
      && (holeAnnotation.quantity
        ? holeAnnotation.quantity.method === 'polygon' || holeAnnotation.quantity.method === 'polygonDepth'
        : !holeAnnotation.count && holeAnnotation.measure.kind === 'area')
    if (active && (active.id !== holeTarget || active.tool !== props.tool || active.pageIndex !== props.pageIndex
      || active.viewPage !== undefined && active.viewPage !== drawing?.session.view.page
      || tracing || !validSelection)) {
      holeSession.current = null
      clear()
      setExclusionError('')
      if (props.store.areaHoleTarget === active.id) props.store.endAreaHoles()
      return
    }
    if (!active && excluding) {
      if (!validSelection) { props.store.endAreaHoles(); return }
      holeSession.current = { id: holeTarget!, tool: props.tool, pageIndex: props.pageIndex, viewPage: drawing?.session.view.page }
    }
  }, [holeTarget, props.tool, props.pageIndex, props.version, tracing, excluding, drawing?.session.view.page])
  useEffect(() => () => {
    const active = holeSession.current
    holeSession.current = null
    if (active && props.store.areaHoleTarget === active.id) props.store.endAreaHoles()
  }, [props.store])
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (pending || pendingRoom || roomConfirmation || (event.target as Element)?.matches('input,select,textarea,[contenteditable="true"]')) return
      if (aligningRoomSet) {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault(); event.stopImmediatePropagation()
          clear(); props.store.endRoomSetAlign(); return
        }
        if (event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopImmediatePropagation()
        if (roomSetDrag.current) return
        const link = props.store.getPageRoomSetLink(props.pageIndex)
        if (!link) return
        const amount = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0
        const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0
        try {
          props.store.setRoomSetOffset(props.pageIndex, (link.dx ?? 0) + dx, (link.dy ?? 0) + dy)
          setRoomError(''); props.onStatus('')
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          setRoomError(message); props.onStatus(message)
        }
        return
      }
      if (editingRoom && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault(); event.stopImmediatePropagation()
        finishRoomEdit(); return
      }
      if (capturingRoom && event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation()
        clear(); props.store.endRoomCapture(); return
      }
      if (excluding && event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation()
        clear(); props.store.endAreaHoles(); return
      }
      if (!points.current.length && !tracing) return
      if (!['Backspace', 'Enter'].includes(event.key)) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === 'Backspace') { points.current.pop(); cursor.current = null; redraw() }
      else commit()
    }
    const otherPage = (event: Event) => {
      if ((event as CustomEvent<number>).detail === props.pageIndex) return
      clear()
      if (capturingRoom) {
        setPendingRoom(null)
        props.store.endRoomCapture()
      }
      if (excluding) props.store.endAreaHoles()
      if (editingRoom) props.store.endRoomEdit(false)
      if (aligningRoomSet) props.store.endRoomSetAlign(false)
    }
    window.addEventListener('keydown', onKey, true); window.addEventListener('karu-pdf:measurement-start', otherPage)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('karu-pdf:measurement-start', otherPage) }
  })
  const pointerDown = (event: React.PointerEvent, p: Point): boolean => {
    if (scaleInteraction.tracePage !== null && !tracing) return true
    if (roomCapturePage !== null && !capturingRoom) return true
    if (roomEditTarget !== null && !editingRoom) return true
    if (roomSetAlignPage !== null && !aligningRoomSet) return true
    if (pending || pendingRoom || roomConfirmation) return true
    if (aligningRoomSet) {
      if (event.button !== 0 || roomSetDrag.current) return true
      const link = props.store.getPageRoomSetLink(props.pageIndex)
      if (!link || !alignedRoomSet) return true
      window.dispatchEvent(new CustomEvent('karu-pdf:measurement-start', { detail: props.pageIndex }))
      const inside = !resetRoomSetAnchor && props.store.effectiveRoomRegions(props.pageIndex)
        .some(entry => entry.setId === link.id && pointInRoomRegion(entry.region, p))
      roomSetDrag.current = {
        id: link.id, pointerId: event.pointerId, start: [...p] as Point,
        offset: [link.dx ?? 0, link.dy ?? 0], delta: [0, 0], inside, moved: false,
        element: props.svg.current?.querySelector<SVGGElement>('.room-set-align-ranges') ?? null,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return true
    }
    if (editingRoom) {
      const target = (event.target as Element).closest('[data-room-vertex], [data-room-midpoint]')
      if (!target || target.closest('[data-room-id]')?.getAttribute('data-room-id') !== editedRoom!.id) return true
      const midpoint = target.getAttribute('data-room-midpoint')
      const index = Number(midpoint ?? target.getAttribute('data-room-vertex'))
      const next = midpoint !== null
        ? insertPolygonVertex(editedRoom!.points, index)
        : editedRoom!.points.map(point => [...point] as Point)
      if (!next) {
        const message = '点は500までです'
        setRoomError(message); props.onStatus(message); return true
      }
      const vertexIndex = midpoint !== null ? index + 1 : index
      if (!next[vertexIndex]) return true
      roomVertex.current = {
        id: editedRoom!.id, index: vertexIndex, original: structuredClone(editedRoom!), points: next,
        element: target.closest<SVGGElement>('g.room-region'), pointerId: event.pointerId, start: [...p] as Point,
      }
      // Keep an unchanged vertex visible through the two clicks of a double click.
      if (midpoint !== null) {
        if (roomVertex.current.element) roomVertex.current.element.style.visibility = 'hidden'
        schedule()
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return true
    }
    const target = (event.target as Element).closest('[data-measure-vertex], [data-measure-midpoint]')
    if (!capturingRoom && !excluding && props.tool === 'select' && target) {
      const id = target.getAttribute('data-annotation-id')!, a = props.store.get(id)
      if (a?.vertices && (a.measure || a.kind === 'cloudPolygon')) {
        const midpoint = target.getAttribute('data-measure-midpoint')
        const index = Number(midpoint ?? target.getAttribute('data-measure-vertex'))
        if (midpoint !== null && (!isEditableArea(a) || areaSelection.length !== 1 || areaSelection[0] !== id)) return true
        const next = midpoint !== null ? insertPolygonVertex(a.vertices, index) : a.vertices.map(point => [...point] as Point)
        if (!next) { props.onStatus('点は500までです'); return true }
        const vertexIndex = midpoint !== null ? index + 1 : index
        if (!next[vertexIndex]) return true
        props.store.touch(id)
        vertex.current = { id, index: vertexIndex, original: a, points: next, element: target.closest<SVGGElement>('g.annotation-item'), pointerId: event.pointerId, start: [...p] as Point }
        if (midpoint !== null || !isEditableArea(a)) {
          if (vertex.current.element) vertex.current.element.style.visibility = 'hidden'
          if (midpoint !== null) schedule()
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        return true
      }
    }
    if (!enabled) return false
    window.dispatchEvent(new CustomEvent('karu-pdf:measurement-start', { detail: props.pageIndex }))
    const hadPoints = points.current.length > 0
    const previous = points.current.at(-1)
    const next = resolvePoint(p, event, previous)
    if (!hadPoints && !tracing && !cloud && !excluding && !capturingRoom) {
      // No region lookup during redraw: retain the first resolved scale until completion.
      pickedScale.current = props.store.scaleRegions.get(props.pageIndex)?.length
        ? props.store.scaleAt(props.pageIndex, next)
        : (() => { const scale = props.store.getScale(props.pageIndex); return scale ? { scale } : null })()
      if (!pickedScale.current) { scaleInteraction.request(props.pageIndex); return true }
    }
    if (tracing || !excluding && !capturingRoom && props.tool === 'distance') {
      if (!hadPoints) points.current.push(next)
    } else if (!previous || Math.hypot(next[0] - previous[0], next[1] - previous[1]) > .01) {
      if (capturingRoom && points.current.length >= 500) {
        const message = '部屋の範囲の点は500点までです'
        setRoomError(message); props.onStatus(message); return true
      }
      if (excluding && points.current.length >= 500) {
        const message = '除外範囲の点は500点までです'
        setExclusionError(message); props.onStatus(message); return true
      }
      points.current.push(next)
    }
    cursor.current = null; down.current = { id: event.pointerId, start: p, hadPoints }
    event.currentTarget.setPointerCapture(event.pointerId); schedule()
    return true
  }
  const pointerMove = (event: React.PointerEvent, p: Point): boolean => {
    if (roomSetDrag.current) {
      const drag = roomSetDrag.current
      if (drag.pointerId !== event.pointerId) return true
      if (!aligningRoomSet || props.store.getPageRoomSet(props.pageIndex)?.id !== drag.id) {
        clear(); return true
      }
      drag.moved ||= movedVertex(drag.start, p)
      if (drag.moved && drag.inside) {
        drag.delta = [p[0] - drag.start[0], p[1] - drag.start[1]]
        schedule()
      }
      return true
    }
    if (roomSetAlignPage !== null) {
      if (aligningRoomSet && snapEnabled) resolvePoint(p, event)
      return true
    }
    if (roomVertex.current) {
      const drag = roomVertex.current
      if (drag.pointerId !== event.pointerId || !movedVertex(drag.start, p)) return true
      if (drag.element) drag.element.style.visibility = 'hidden'
      const previous = drag.points[drag.index === 0 ? drag.points.length - 1 : drag.index - 1]
      drag.points[drag.index] = resolvePoint(p, event, previous)
      schedule(); return true
    }
    if (vertex.current) {
      const v = vertex.current
      if (v.pointerId !== event.pointerId) return true
      const previous = v.points[v.index === 0 ? v.points.length - 1 : v.index - 1]
      if (isEditableArea(v.original)) {
        if (!movedVertex(v.start, p)) return true
        if (v.element) v.element.style.visibility = 'hidden'
        v.points[v.index] = resolvePoint(p, event, previous)
      } else v.points[v.index] = constrain(previous, p, event.shiftKey)
      schedule(); return true
    }
    if (roomEditTarget !== null && !editingRoom) return true
    if (pending || pendingRoom || roomConfirmation) return true
    if (editingRoom) {
      if (snapEnabled) resolvePoint(p, event)
      return true
    }
    if (!enabled) return false
    if (points.current.length) { cursor.current = resolvePoint(p, event, points.current.at(-1)!); schedule() }
    else if (snapEnabled) resolvePoint(p, event)
    return true
  }
  const pointerUp = (event: React.PointerEvent, p: Point): boolean => {
    if (roomSetDrag.current) {
      const drag = roomSetDrag.current
      if (drag.pointerId !== event.pointerId) return true
      const moved = drag.moved || movedVertex(drag.start, p)
      const link = props.store.getPageRoomSetLink(props.pageIndex)
      const valid = aligningRoomSet && props.store.roomSetAlignPage === props.pageIndex
        && link?.id === drag.id
        && (link.dx ?? 0) === drag.offset[0] && (link.dy ?? 0) === drag.offset[1]
      clear()
      if (!valid) return true
      try {
        if (moved) {
          if (drag.inside) {
            props.store.setRoomSetOffset(props.pageIndex,
              drag.offset[0] + p[0] - drag.start[0],
              drag.offset[1] + p[1] - drag.start[1])
          }
        } else {
          const point = resolvePoint(p, event)
          const set = props.store.getPageRoomSet(props.pageIndex)
          if (!set) return true
          if (resetRoomSetAnchor || !set.anchor) {
            props.store.setRoomSetAnchor(props.pageIndex, point)
            setResetRoomSetAnchor(false)
          } else {
            props.store.setRoomSetOffset(props.pageIndex,
              point[0] - set.anchor[0], point[1] - set.anchor[1])
          }
        }
        setRoomError(''); props.onStatus('')
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        setRoomError(message); props.onStatus(message)
      }
      return true
    }
    if (roomSetAlignPage !== null) return true
    if (roomVertex.current) {
      const drag = roomVertex.current
      if (drag.pointerId !== event.pointerId) return true
      if (movedVertex(drag.start, p)) {
        drag.points[drag.index] = resolvePoint(p, event, drag.points[drag.index === 0 ? drag.points.length - 1 : drag.index - 1])
      } else if (drag.points.length === drag.original.points.length) {
        drag.points = drag.original.points.map(point => [...point] as Point)
      } else {
        const inserted = insertPolygonVertex(drag.original.points, drag.index - 1)
        if (inserted) drag.points = inserted
      }
      clear()
      if (props.store.roomEditTarget?.pageIndex === props.pageIndex
        && props.store.roomEditTarget.id === drag.id) saveRoomPoints(drag.id, drag.points)
      return true
    }
    if (vertex.current) {
      const v = vertex.current
      if (v.pointerId !== event.pointerId) return true
      const area = isEditableArea(v.original)
      const previous = v.points[v.index === 0 ? v.points.length - 1 : v.index - 1]
      if (!area) v.points[v.index] = constrain(previous, p, event.shiftKey)
      else if (movedVertex(v.start, p)) v.points[v.index] = resolvePoint(p, event, previous)
      else if (v.points.length === v.original.vertices!.length) v.points = v.original.vertices!.map(point => [...point] as Point)
      else {
        const inserted = insertPolygonVertex(v.original.vertices!, v.index - 1)
        if (inserted) v.points = inserted
      }
      clear()
      if (!area || !samePoints(v.original.vertices!, v.points)) props.store.updateMeasureVertices(v.id, v.points)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return true
    }
    if (roomEditTarget !== null) return true
    const d = down.current
    if (!enabled || !d || d.id !== event.pointerId) return enabled
    down.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if ((tracing || !excluding && !capturingRoom && props.tool === 'distance') && (d.hadPoints || Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 1)) {
      const end = resolvePoint(p, event, points.current[0])
      if (Math.hypot(end[0] - points.current[0][0], end[1] - points.current[0][1]) > .01) { points.current.push(end); commit() }
    }
    return true
  }
  // Pointer capture from the first click retargets the double click to the layer, so find the handle under the pointer.
  const handleAt = (event: React.MouseEvent, selector: string) => {
    const below = document.elementFromPoint(event.clientX, event.clientY)?.closest(selector)
    return below ?? (event.target as Element).closest(selector)
  }
  const doubleClick = (event: React.MouseEvent): boolean => {
    if (pending || pendingRoom || roomConfirmation) return true
    if (roomSetAlignPage !== null) return true
    if (roomEditTarget !== null) {
      if (!editingRoom) return true
      const target = handleAt(event, '[data-room-vertex]')
      if (!target || target.closest('[data-room-id]')?.getAttribute('data-room-id') !== editedRoom!.id) return true
      event.preventDefault(); event.stopPropagation()
      clear()
      const current = props.store.effectiveRoomRegions(props.pageIndex).find(({ region }) => region.id === editedRoom!.id)?.region
      if (!current) { props.store.endRoomEdit(false); return true }
      const next = removePolygonVertex(current.points, Number(target.getAttribute('data-room-vertex')))
      if (!next) {
        const message = '部屋の範囲の点は3つより少なくできません'
        setRoomError(message); props.onStatus(message); return true
      }
      saveRoomPoints(current.id, next)
      return true
    }
    const target = handleAt(event, '[data-measure-vertex]')
    if (!capturingRoom && !excluding && !tracing && props.tool === 'select' && target) {
      const id = target.getAttribute('data-annotation-id')
      const annotation = id ? props.store.get(id) : undefined
      const selected = props.store.selectedIds()
      if (annotation?.vertices && isEditableArea(annotation)
        && selected.length === 1 && selected[0] === annotation.id) {
        event.preventDefault(); event.stopPropagation()
        clear()
        const next = removePolygonVertex(annotation.vertices, Number(target.getAttribute('data-measure-vertex')))
        if (!next) { props.onStatus('面積の点は3つより少なくできません'); return true }
        props.store.updateMeasureVertices(annotation.id, next)
        props.onStatus('')
        return true
      }
    }
    if (enabled) { commit(); return true }
    return false
  }
  return { pointerDown, pointerMove, pointerUp, doubleClick,
    pointerLeave: () => { snapMarker.current?.setAttribute('display', 'none'); if (!down.current) rawCursor.current = null },
    cancel: () => {
      if (pendingRoom || roomConfirmation) return true
      if (aligningRoomSet || roomSetDrag.current) { clear(); props.store.endRoomSetAlign(false); return true }
      if (editingRoom) { clear(); props.store.endRoomEdit(false); return true }
      if (capturingRoom) { clear(); props.store.endRoomCapture(); return true }
      if (excluding) { clear(); props.store.endAreaHoles(); return true }
      if (!points.current.length && !down.current && !vertex.current && !roomVertex.current) return false
      clear(); return true
    },
    draft: <><g ref={draftRef} className="measurement-draft" pointerEvents="none" /><path ref={snapMarker} data-testid={`snap-marker-${props.pageIndex}`} display="none" fill="white" stroke="#007cbb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {aligningRoomSet && createPortal(<div className="room-region-guide room-set-align-guide" role="status"
        // React bubbles portal events to the drawing layer, whose pointer capture would swallow the button click.
        onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
        onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <div>{alignedRoomSet?.anchor && !resetRoomSetAnchor
          ? 'この図面で支点に当たる点をクリックすると、部屋の組を合わせます。範囲をドラッグしても動かせます（矢印キーで1pt、Shift で10pt。Enter・Esc で終える）'
          : '部屋の組の支点にする点（通り芯の交点など）をクリックしてください。範囲をドラッグしても動かせます（Enter・Esc で終える）'}</div>
        <button type="button" onClick={() => { clear(); setResetRoomSetAnchor(true) }}>支点を決め直す</button>
        {roomError && <div role="alert">{roomError}</div>}
      </div>, document.body)}
      {editingRoom && createPortal(<div className="room-region-guide" role="status">
        <div>部屋の範囲の点をドラッグで動かし、辺の中の○をドラッグで点を足します。点のダブルクリックで消します（Enter・Esc で終える）</div>
        {roomError && <div role="alert">{roomError}</div>}
      </div>, document.body)}
      {capturingRoom && !pendingRoom && createPortal(<div className="room-region-guide" role="status">
        <div>部屋の範囲を囲んでください（Enter・ダブルクリックで決定、Esc で中止）</div>
        {roomError && <div role="alert">{roomError}</div>}
      </div>, document.body)}
      {excluding && createPortal(<div className="area-hole-guide" role="status" style={{
        position: 'fixed', top: 88, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
        maxWidth: 'calc(100vw - 24px)', padding: '8px 12px', border: '1px solid #007cbb',
        borderRadius: 6, background: '#fff', color: '#111', boxShadow: '0 2px 8px #0003', pointerEvents: 'none',
      }}>
        <div>除外する範囲を囲んでください（Enter・ダブルクリックで決定、Esc で中止）</div>
        {exclusionError && <div role="alert">{exclusionError}</div>}
      </div>, document.body)}
    </>,
    dialog: <>
      {pending && <QuantityDimensionsDialog mark={pending.mark} complete={mark => { setPending(null); if (mark) pending.save(mark) }} />}
      {pendingRoom && <RoomRegionDialog store={props.store} points={pendingRoom.points} floor={pendingRoom.floor}
        roomSet={props.store.getPageRoomSet(props.pageIndex)}
        complete={(region, toSet) => {
          if (!region) {
            setPendingRoom(null)
            props.store.endRoomCapture()
            return
          }
          if (props.store.roomCapturePage !== props.pageIndex) {
            setPendingRoom(null)
            return
          }
          try {
            const ids = props.store.pickupsInRoom(props.pageIndex, region)
            props.store.addRoomRegion(props.pageIndex, region, !!toSet)
            setPendingRoom(null)
            props.store.endRoomCapture()
            props.onStatus('')
            if (ids.length) setRoomConfirmation({ region, ids })
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : String(reason)
            setRoomError(message)
            props.onStatus(message)
          }
        }} />}
      {roomConfirmation && <RoomPickupDialog region={roomConfirmation.region} count={roomConfirmation.ids.length}
        complete={apply => {
          if (apply) {
            const { region, ids } = roomConfirmation
            props.store.updatePickupLocation(ids, 'room', region.name, region.floor ? { floor: region.floor } : undefined)
          }
          setRoomConfirmation(null)
        }} />}
    </> }
}
