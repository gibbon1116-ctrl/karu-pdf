import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { Point, Rect } from '../core/annotations'
import type { PageSize } from '../core/mupdfDoc'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'
import { beginDragFrameMeasurement, TextEditor } from './TextEditor'
import { AnnotationStore, type EditableAnnotation, type Kind } from './AnnotationStore'
import type { FormatDefaults, FormatTool } from './formatDefaults'
import { mergeInkAnnotationId, simplifyPoints, type PreviousInkStroke } from './ink'

export type EditorTool = 'select' | FormatTool
export const EditorToolChangeContext = createContext<(tool: EditorTool) => void>(() => undefined)
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type LineHandle = 'start' | 'end'

interface Props {
  pageIndex: number
  pageSize: PageSize
  zoom: number
  pool: PdfWorkerPool
  store: AnnotationStore
  tool: EditorTool
  selectedId: string | null
  editingId: string | null
  onSelect(id: string | null): void
  onEdit(id: string | null): void
  registerCommit(commit: (() => Promise<void>) | null): void
  formatDefaults: FormatDefaults
}

interface DragOperation {
  pointerId: number
  mode: 'move' | 'text' | 'shape' | 'line' | 'ink' | 'resize' | 'line-end'
  creationKind?: Kind
  start: Point
  latest: Point
  id: string | null
  element: SVGGElement | null
  frame: number
  moved: boolean
  shift: boolean
  resizeHandle?: ResizeHandle
  lineHandle?: LineHandle
  originalRect?: Rect
  originalLine?: [Point, Point]
  annotationKind?: EditableAnnotation['kind']
  points?: Point[]
  mergeId?: string | null
  stopMeasurement(publish?: boolean): void
}

function color(rgb: readonly number[]): string {
  return `rgb(${rgb.map((component) => Math.round(component * 255)).join(' ')})`
}

function pointInPage(svg: SVGSVGElement, event: React.PointerEvent): Point {
  const bounds = svg.getBoundingClientRect()
  const viewBox = svg.viewBox.baseVal
  return [
    (event.clientX - bounds.left) * viewBox.width / bounds.width,
    (event.clientY - bounds.top) * viewBox.height / bounds.height,
  ]
}

function annotationIdFromTarget(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? null
}

function targetValue<T extends string>(target: EventTarget | null, name: string): T | null {
  return (target as Element | null)?.closest(`[data-${name}]`)?.getAttribute(`data-${name}`) as T | null
}

function constrainedEnd(start: Point, end: Point, shift: boolean): Point {
  if (!shift) return end
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return end
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4
  return [start[0] + Math.cos(angle) * distance, start[1] + Math.sin(angle) * distance]
}

function shapeRect(start: Point, end: Point, square: boolean): Rect {
  let dx = end[0] - start[0]
  let dy = end[1] - start[1]
  if (square) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * size
    dy = Math.sign(dy || 1) * size
  }
  return [Math.min(start[0], start[0] + dx), Math.min(start[1], start[1] + dy), Math.max(start[0], start[0] + dx), Math.max(start[1], start[1] + dy)]
}

function resizedRect(rect: Rect, handle: ResizeHandle, point: Point, kind: EditableAnnotation['kind']): Rect {
  let [x0, y0, x1, y1] = rect
  const minimumWidth = kind === 'freetext' ? 20 : 4
  if (handle.includes('w')) x0 = Math.min(point[0], x1 - minimumWidth)
  if (handle.includes('e')) x1 = Math.max(point[0], x0 + minimumWidth)
  if (kind !== 'freetext') {
    if (handle.includes('n')) y0 = Math.min(point[1], y1 - 4)
    if (handle.includes('s')) y1 = Math.max(point[1], y0 + 4)
  }
  return [x0, y0, x1, y1]
}

function arrowHead(line: [Point, Point], size: number): string {
  const [start, end] = line
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0])
  const left: Point = [end[0] - Math.cos(angle - Math.PI / 6) * size, end[1] - Math.sin(angle - Math.PI / 6) * size]
  const right: Point = [end[0] - Math.cos(angle + Math.PI / 6) * size, end[1] - Math.sin(angle + Math.PI / 6) * size]
  return `${left[0]},${left[1]} ${end[0]},${end[1]} ${right[0]},${right[1]}`
}

function allResizeHandles(kind: Kind): boolean {
  return kind === 'square' || kind === 'circle' || kind === 'whiteout' || kind === 'highlight' || kind === 'ink'
}

export function AnnotationLayer(props: Props) {
  const changeTool = useContext(EditorToolChangeContext)
  const version = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const svgRef = useRef<SVGSVGElement>(null)
  const draftRectRef = useRef<SVGRectElement>(null)
  const draftLineRef = useRef<SVGLineElement>(null)
  const draftInkRef = useRef<SVGPolylineElement>(null)
  const resizePreviewRef = useRef<SVGRectElement>(null)
  const linePreviewRef = useRef<SVGLineElement>(null)
  const dragRef = useRef<DragOperation | null>(null)
  const previousInkRef = useRef<PreviousInkStroke | null>(null)
  const loadingLayoutsRef = useRef(new Set<string>())
  const annotations = props.store.getPageAnnotations(props.pageIndex)
  const touched = useMemo(() => new Set(props.store.touchedObjNums(props.pageIndex)), [version, props.pageIndex, props.store])
  const editing = props.editingId ? annotations.find((annotation) => annotation.id === props.editingId) : undefined

  useEffect(() => {
    for (const annotation of annotations) {
      const visible = annotation.objNum === null || touched.has(annotation.objNum)
      if (!visible || annotation.kind !== 'freetext' || annotation.layout || loadingLayoutsRef.current.has(annotation.id)) continue
      loadingLayoutsRef.current.add(annotation.id)
      const width = annotation.rect[2] - annotation.rect[0]
      void props.pool.layoutText(annotation.text, annotation.fontSize, width, annotation.font).then((layout) => {
        props.store.setLayout(annotation.id, layout)
      }).finally(() => loadingLayoutsRef.current.delete(annotation.id))
    }
  }, [annotations, props.pool, props.store, touched])

  const updateDraft = (operation: DragOperation) => {
    const dx = operation.latest[0] - operation.start[0]
    const dy = operation.latest[1] - operation.start[1]
    if (operation.mode === 'move') {
      operation.element?.setAttribute('transform', `translate(${dx} ${dy})`)
      return
    }
    if (operation.mode === 'resize' && operation.originalRect && operation.resizeHandle && operation.annotationKind) {
      const rect = resizedRect(operation.originalRect, operation.resizeHandle, operation.latest, operation.annotationKind)
      const preview = resizePreviewRef.current
      if (!preview) return
      preview.setAttribute('x', String(rect[0]))
      preview.setAttribute('y', String(rect[1]))
      preview.setAttribute('width', String(rect[2] - rect[0]))
      preview.setAttribute('height', String(rect[3] - rect[1]))
      return
    }
    if (operation.mode === 'line-end' && operation.originalLine && operation.lineHandle) {
      const line = operation.originalLine.map((point) => [...point]) as [Point, Point]
      line[operation.lineHandle === 'start' ? 0 : 1] = operation.latest
      const preview = linePreviewRef.current
      preview?.setAttribute('x1', String(line[0][0]))
      preview?.setAttribute('y1', String(line[0][1]))
      preview?.setAttribute('x2', String(line[1][0]))
      preview?.setAttribute('y2', String(line[1][1]))
      return
    }
    if (operation.mode === 'line') {
      const end = constrainedEnd(operation.start, operation.latest, operation.shift)
      draftLineRef.current?.setAttribute('x1', String(operation.start[0]))
      draftLineRef.current?.setAttribute('y1', String(operation.start[1]))
      draftLineRef.current?.setAttribute('x2', String(end[0]))
      draftLineRef.current?.setAttribute('y2', String(end[1]))
      return
    }
    if (operation.mode === 'ink') {
      draftInkRef.current?.setAttribute('points', (operation.points ?? []).map((point) => `${point[0]},${point[1]}`).join(' '))
      return
    }
    const draft = draftRectRef.current
    if (!draft) return
    const rect = operation.mode === 'shape'
      ? shapeRect(operation.start, operation.latest, operation.creationKind === 'circle' && operation.shift)
      : [dx < 0 ? operation.latest[0] : operation.start[0], operation.start[1], dx < 0 ? operation.start[0] : operation.latest[0], operation.start[1] + 16.6] as Rect
    draft.setAttribute('x', String(rect[0]))
    draft.setAttribute('y', String(rect[1]))
    draft.setAttribute('width', String(rect[2] - rect[0]))
    draft.setAttribute('height', String(rect[3] - rect[1]))
  }

  const scheduleDraft = (operation: DragOperation) => {
    if (operation.frame) return
    operation.frame = requestAnimationFrame(() => {
      operation.frame = 0
      updateDraft(operation)
    })
  }

  const hideDrafts = () => {
    for (const element of [draftRectRef.current, draftLineRef.current, draftInkRef.current, resizePreviewRef.current, linePreviewRef.current]) {
      if (element) element.style.display = 'none'
    }
  }

  const finishDrag = (commit: boolean) => {
    const operation = dragRef.current
    if (!operation) return
    dragRef.current = null
    if (operation.frame) cancelAnimationFrame(operation.frame)
    updateDraft(operation)
    operation.stopMeasurement(operation.moved)
    operation.element?.removeAttribute('transform')
    hideDrafts()
    if (!commit) return

    const dx = operation.latest[0] - operation.start[0]
    const dy = operation.latest[1] - operation.start[1]
    if (operation.mode === 'move' && operation.id) {
      props.store.move(operation.id, dx, dy)
      return
    }
    if (operation.mode === 'line-end' && operation.id && operation.originalLine && operation.lineHandle) {
      const line = operation.originalLine.map((point) => [...point]) as [Point, Point]
      line[operation.lineHandle === 'start' ? 0 : 1] = operation.latest
      props.store.updateLine(operation.id, line)
      return
    }
    if (operation.mode === 'resize' && operation.id && operation.originalRect && operation.resizeHandle && operation.annotationKind) {
      const rect = resizedRect(operation.originalRect, operation.resizeHandle, operation.latest, operation.annotationKind)
      if (operation.annotationKind !== 'freetext') props.store.resize(operation.id, rect)
      else {
        const annotation = props.store.get(operation.id)
        if (!annotation) return
        const width = rect[2] - rect[0]
        void props.pool.layoutText(annotation.text, annotation.fontSize, width, annotation.font).then((layout) => {
          props.store.update(operation.id!, { rect: [rect[0], rect[1], rect[2], rect[1] + layout.height], layout })
        })
      }
      return
    }
    if (operation.mode === 'ink' && operation.creationKind && operation.points) {
      const points = simplifyPoints(operation.points, 0.5)
      if (points.length < 2) return
      let id = operation.mergeId
      if (id && props.store.get(id)) props.store.appendInkStroke(id, points)
      else {
        const format = props.formatDefaults[operation.creationKind as 'highlight' | 'ink']
        const xs = points.map((point) => point[0])
        const ys = points.map((point) => point[1])
        const rect: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
        const annotation = props.store.create({
          pageIndex: props.pageIndex,
          kind: operation.creationKind,
          rect,
          color: format.color,
          borderWidth: format.borderWidth,
          opacity: operation.creationKind === 'highlight' ? 0.35 : 1,
          inkList: [points],
        })
        id = annotation.id
      }
      previousInkRef.current = { id: id!, pageIndex: props.pageIndex, kind: operation.creationKind as 'highlight' | 'ink', endedAt: performance.now() }
      return
    }
    if (operation.mode === 'line' && operation.creationKind) {
      const end = constrainedEnd(operation.start, operation.latest, operation.shift)
      if (Math.hypot(end[0] - operation.start[0], end[1] - operation.start[1]) < 4) return
      const format = props.formatDefaults[operation.creationKind as 'line' | 'arrow']
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: operation.creationKind,
        rect: shapeRect(operation.start, end, false),
        line: [[...operation.start], end],
        color: format.color,
        borderWidth: format.borderWidth,
      })
      props.onSelect(annotation.id)
      changeTool('select')
      return
    }
    if (operation.mode === 'shape' && operation.creationKind) {
      const rect = shapeRect(operation.start, operation.latest, operation.creationKind === 'circle' && operation.shift)
      if (rect[2] - rect[0] < 4 || rect[3] - rect[1] < 4) return
      const format = props.formatDefaults[operation.creationKind as 'square' | 'circle' | 'whiteout']
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: operation.creationKind,
        rect,
        color: format.color,
        borderWidth: operation.creationKind === 'whiteout' ? 0 : format.borderWidth,
        interiorColor: operation.creationKind === 'whiteout' ? [1, 1, 1] : null,
      })
      props.onSelect(annotation.id)
      changeTool('select')
      return
    }
    if (operation.mode === 'text') {
      const format = props.formatDefaults.text
      const width = operation.moved ? Math.max(20, Math.abs(dx)) : 200
      const left = operation.moved && dx < 0 ? operation.start[0] - width : operation.start[0]
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: 'freetext',
        color: format.color,
        fontSize: format.fontSize,
        font: format.font,
        rect: [left, operation.start[1], left + width, operation.start[1] + 16.6],
        deferHistory: true,
      })
      props.onSelect(annotation.id)
      props.onEdit(annotation.id)
    }
  }

  const renderAnnotation = (annotation: EditableAnnotation) => {
    const visible = annotation.objNum === null || touched.has(annotation.objNum)
    const [x0, y0, x1, y1] = annotation.rect
    const handleSize = 8 / Math.max(0.01, props.zoom * CSS_PX_PER_PT)
    const positions: Array<{ handle: ResizeHandle; x: number; y: number }> = allResizeHandles(annotation.kind)
      ? [
          { handle: 'nw', x: x0, y: y0 }, { handle: 'n', x: (x0 + x1) / 2, y: y0 }, { handle: 'ne', x: x1, y: y0 },
          { handle: 'e', x: x1, y: (y0 + y1) / 2 }, { handle: 'se', x: x1, y: y1 }, { handle: 's', x: (x0 + x1) / 2, y: y1 },
          { handle: 'sw', x: x0, y: y1 }, { handle: 'w', x: x0, y: (y0 + y1) / 2 },
        ]
      : annotation.kind === 'freetext'
        ? [{ handle: 'e', x: x1, y: (y0 + y1) / 2 }, { handle: 'w', x: x0, y: (y0 + y1) / 2 }]
        : []
    const line = annotation.line
    return (
      <g key={annotation.id} data-annotation-id={annotation.id} className="annotation-item">
        {visible && annotation.kind === 'square' && <rect className="annotation-square" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} />}
        {visible && annotation.kind === 'circle' && <ellipse className="annotation-shape" cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} fill="none" stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} />}
        {visible && annotation.kind === 'whiteout' && <rect className="annotation-whiteout" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="#fff" />}
        {visible && line && <>
          <line className="annotation-line" x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} />
          {annotation.kind === 'arrow' && <polyline className="annotation-line" points={arrowHead(line, Math.max(8, annotation.borderWidth * 5))} fill="none" stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} />}
        </>}
        {visible && (annotation.kind === 'highlight' || annotation.kind === 'ink') && annotation.inkList?.map((stroke, index) => (
          <polyline key={`${annotation.id}-stroke-${index}`} className="annotation-ink" points={stroke.map((point) => `${point[0]},${point[1]}`).join(' ')} fill="none" stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} opacity={annotation.opacity} />
        ))}
        {visible && annotation.kind === 'freetext' && annotation.layout?.lines.map((lineLayout, index) => (
          <text key={`${annotation.id}-line-${index}`} className="annotation-text" x={x0 + lineLayout.x} y={y0 + lineLayout.baseline} fill={color(annotation.color)} fontFamily={annotation.font === 'BIZUDMincho' ? 'KaruBIZUDMincho' : 'KaruBIZUDGothic'} fontSize={annotation.fontSize} style={{ fontKerning: 'none' }} xmlSpace="preserve">{lineLayout.text}</text>
        ))}
        {line ? <line className="annotation-hit annotation-line-hit" data-annotation-id={annotation.id} x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} /> : <rect className="annotation-hit" data-annotation-id={annotation.id} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} />}
        {props.selectedId === annotation.id && <>
          <rect className="annotation-selection" x={x0 - 1} y={y0 - 1} width={Math.max(2, x1 - x0 + 2)} height={Math.max(2, y1 - y0 + 2)} />
          {props.tool === 'select' && positions.map(({ handle, x, y }) => <rect key={`${annotation.id}-${handle}`} className="annotation-resize-handle" data-testid={`resize-handle-${handle}`} data-annotation-id={annotation.id} data-resize-handle={handle} x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} />)}
          {props.tool === 'select' && line && line.map((point, index) => <rect key={`${annotation.id}-line-${index}`} className="annotation-resize-handle" data-testid={`line-handle-${index === 0 ? 'start' : 'end'}`} data-annotation-id={annotation.id} data-line-handle={index === 0 ? 'start' : 'end'} x={point[0] - handleSize / 2} y={point[1] - handleSize / 2} width={handleSize} height={handleSize} />)}
        </>}
      </g>
    )
  }

  return <>
    <svg
      ref={svgRef}
      className={`annotation-layer tool-${props.tool}`}
      data-testid={`annotation-layer-${props.pageIndex}`}
      viewBox={`0 0 ${props.pageSize.width} ${props.pageSize.height}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || props.editingId) return
        event.preventDefault()
        const svg = event.currentTarget
        const start = pointInPage(svg, event)
        const id = annotationIdFromTarget(event.target)
        if (props.tool === 'select') {
          const annotation = id ? props.store.get(id) : undefined
          const lineHandle = targetValue<LineHandle>(event.target, 'line-handle')
          const resizeHandle = targetValue<ResizeHandle>(event.target, 'resize-handle')
          if (lineHandle && annotation?.line) {
            props.store.touch(id!)
            props.onSelect(id)
            if (linePreviewRef.current) linePreviewRef.current.style.display = 'block'
            dragRef.current = { pointerId: event.pointerId, mode: 'line-end', start, latest: start, id, element: null, frame: 0, moved: false, shift: false, lineHandle, originalLine: annotation.line, stopMeasurement: beginDragFrameMeasurement() }
          } else if (resizeHandle && annotation) {
            props.store.touch(id!)
            props.onSelect(id)
            if (resizePreviewRef.current) resizePreviewRef.current.style.display = 'block'
            dragRef.current = { pointerId: event.pointerId, mode: 'resize', start, latest: start, id, element: null, frame: 0, moved: false, shift: false, resizeHandle, originalRect: annotation.rect, annotationKind: annotation.kind, stopMeasurement: beginDragFrameMeasurement() }
          } else if (id) {
            props.store.touch(id)
            props.onSelect(id)
            dragRef.current = { pointerId: event.pointerId, mode: 'move', start, latest: start, id, element: svg.querySelector(`g[data-annotation-id="${id}"]`), frame: 0, moved: false, shift: false, stopMeasurement: beginDragFrameMeasurement() }
          } else {
            props.onSelect(null)
            return
          }
        } else {
          props.onSelect(null)
          const kind = props.tool === 'text' ? 'freetext' : props.tool
          const mode = props.tool === 'text' ? 'text' : props.tool === 'line' || props.tool === 'arrow' ? 'line' : props.tool === 'highlight' || props.tool === 'ink' ? 'ink' : 'shape'
          const shown = mode === 'line' ? draftLineRef.current : mode === 'ink' ? draftInkRef.current : draftRectRef.current
          if (shown) shown.style.display = 'block'
          const startedAt = performance.now()
          dragRef.current = {
            pointerId: event.pointerId,
            mode,
            creationKind: kind,
            start,
            latest: start,
            id: null,
            element: null,
            frame: 0,
            moved: false,
            shift: event.shiftKey,
            points: mode === 'ink' ? [start] : undefined,
            mergeId: mode === 'ink' ? mergeInkAnnotationId(previousInkRef.current, props.pageIndex, kind as 'highlight' | 'ink', startedAt) : null,
            stopMeasurement: beginDragFrameMeasurement(mode === 'ink' ? 'ink' : 'drag'),
          }
        }
        svg.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const operation = dragRef.current
        if (!operation || operation.pointerId !== event.pointerId) return
        operation.latest = pointInPage(event.currentTarget, event)
        operation.shift = event.shiftKey
        if (operation.mode === 'ink') operation.points?.push(operation.latest)
        if (Math.abs(operation.latest[0] - operation.start[0]) >= 2 || Math.abs(operation.latest[1] - operation.start[1]) >= 2) operation.moved = true
        scheduleDraft(operation)
      }}
      onPointerUp={(event) => {
        const operation = dragRef.current
        if (!operation || operation.pointerId !== event.pointerId) return
        operation.latest = pointInPage(event.currentTarget, event)
        operation.shift = event.shiftKey
        if (operation.mode === 'ink') operation.points?.push(operation.latest)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        finishDrag(true)
      }}
      onPointerCancel={() => finishDrag(false)}
      onDoubleClick={(event) => {
        if (props.tool !== 'select') return
        const id = annotationIdFromTarget(event.target) ?? props.selectedId
        const annotation = id ? props.store.touch(id) : undefined
        if (annotation?.kind === 'freetext') { props.onSelect(annotation.id); props.onEdit(annotation.id) }
      }}
    >
      <rect className="annotation-surface" x="0" y="0" width={props.pageSize.width} height={props.pageSize.height} />
      {annotations.map(renderAnnotation)}
      <rect ref={draftRectRef} className="annotation-draft" x="0" y="0" width="0" height="0" />
      <line ref={draftLineRef} className="annotation-line-draft" x1="0" y1="0" x2="0" y2="0" />
      <polyline ref={draftInkRef} className="annotation-ink-draft" points="" />
      <rect ref={resizePreviewRef} className="annotation-resize-preview" x="0" y="0" width="0" height="0" />
      <line ref={linePreviewRef} className="annotation-line-preview" x1="0" y1="0" x2="0" y2="0" />
    </svg>
    {editing && <TextEditor annotation={editing} zoom={props.zoom} pool={props.pool} store={props.store} onClose={(removed) => {
      props.onEdit(null)
      if (props.tool === 'text') { props.onSelect(removed ? null : editing.id); changeTool('select') }
    }} registerCommit={props.registerCommit} />}
  </>
}
