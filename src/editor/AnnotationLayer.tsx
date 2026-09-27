import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { Rect } from '../core/annotations'
import type { PageSize } from '../core/mupdfDoc'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'
import { beginDragFrameMeasurement, TextEditor } from './TextEditor'
import { AnnotationStore, type EditableAnnotation } from './AnnotationStore'

export type EditorTool = 'select' | 'text' | 'square'
export const EditorToolChangeContext = createContext<(tool: EditorTool) => void>(() => undefined)
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

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
}

interface Point { x: number; y: number }

interface DragOperation {
  pointerId: number
  mode: 'move' | 'text' | 'square' | 'resize'
  start: Point
  latest: Point
  id: string | null
  element: SVGGElement | null
  frame: number
  moved: boolean
  resizeHandle?: ResizeHandle
  originalRect?: Rect
  annotationKind?: EditableAnnotation['kind']
  stopMeasurement(publish?: boolean): void
}

function color(rgb: readonly number[]): string {
  return `rgb(${rgb.map((component) => Math.round(component * 255)).join(' ')})`
}

function pointInPage(svg: SVGSVGElement, event: React.PointerEvent): Point {
  const bounds = svg.getBoundingClientRect()
  const viewBox = svg.viewBox.baseVal
  return {
    x: (event.clientX - bounds.left) * viewBox.width / bounds.width,
    y: (event.clientY - bounds.top) * viewBox.height / bounds.height,
  }
}

function annotationIdFromTarget(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? null
}

function resizeHandleFromTarget(target: EventTarget | null): ResizeHandle | null {
  return (target as Element | null)?.closest('[data-resize-handle]')?.getAttribute('data-resize-handle') as ResizeHandle | null
}

function resizedRect(rect: Rect, handle: ResizeHandle, point: Point, kind: EditableAnnotation['kind']): Rect {
  let [x0, y0, x1, y1] = rect
  const minimumWidth = kind === 'freetext' ? 20 : 4
  if (handle.includes('w')) x0 = Math.min(point.x, x1 - minimumWidth)
  if (handle.includes('e')) x1 = Math.max(point.x, x0 + minimumWidth)
  if (kind === 'square') {
    if (handle.includes('n')) y0 = Math.min(point.y, y1 - 4)
    if (handle.includes('s')) y1 = Math.max(point.y, y0 + 4)
  }
  return [x0, y0, x1, y1]
}

export function AnnotationLayer(props: Props) {
  const changeTool = useContext(EditorToolChangeContext)
  useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const svgRef = useRef<SVGSVGElement>(null)
  const draftRef = useRef<SVGRectElement>(null)
  const resizePreviewRef = useRef<SVGRectElement>(null)
  const dragRef = useRef<DragOperation | null>(null)
  const loadingLayoutsRef = useRef(new Set<string>())
  const annotations = props.store.getPageAnnotations(props.pageIndex)
  const touched = useMemo(() => new Set(props.store.touchedObjNums(props.pageIndex)), [props.store.getSnapshot(), props.pageIndex])
  const editing = props.editingId ? annotations.find((annotation) => annotation.id === props.editingId) : undefined

  useEffect(() => {
    for (const annotation of annotations) {
      const isTouched = annotation.objNum === null || touched.has(annotation.objNum)
      if (!isTouched || annotation.kind !== 'freetext' || annotation.layout || loadingLayoutsRef.current.has(annotation.id)) continue
      loadingLayoutsRef.current.add(annotation.id)
      const width = annotation.rect[2] - annotation.rect[0]
      void props.pool.layoutText(annotation.text, annotation.fontSize, width).then((layout) => {
        props.store.setLayout(annotation.id, layout)
      }).finally(() => loadingLayoutsRef.current.delete(annotation.id))
    }
  }, [annotations, props.pool, props.store, touched])

  const updateDraft = (operation: DragOperation) => {
    const dx = operation.latest.x - operation.start.x
    const dy = operation.latest.y - operation.start.y
    if (operation.mode === 'move') {
      operation.element?.setAttribute('transform', `translate(${dx} ${dy})`)
      return
    }
    if (operation.mode === 'resize' && operation.originalRect && operation.resizeHandle && operation.annotationKind) {
      const preview = resizePreviewRef.current
      if (!preview) return
      const [x0, y0, x1, y1] = resizedRect(
        operation.originalRect,
        operation.resizeHandle,
        operation.latest,
        operation.annotationKind,
      )
      preview.setAttribute('x', String(x0))
      preview.setAttribute('y', String(y0))
      preview.setAttribute('width', String(x1 - x0))
      preview.setAttribute('height', String(y1 - y0))
      return
    }
    const draft = draftRef.current
    if (!draft) return
    if (operation.mode === 'square') {
      draft.setAttribute('x', String(Math.min(operation.start.x, operation.latest.x)))
      draft.setAttribute('y', String(Math.min(operation.start.y, operation.latest.y)))
      draft.setAttribute('width', String(Math.abs(dx)))
      draft.setAttribute('height', String(Math.abs(dy)))
    } else {
      draft.setAttribute('x', String(dx < 0 ? operation.latest.x : operation.start.x))
      draft.setAttribute('y', String(operation.start.y))
      draft.setAttribute('width', String(Math.abs(dx)))
      draft.setAttribute('height', '16.6')
    }
  }

  const scheduleDraft = (operation: DragOperation) => {
    if (operation.frame) return
    operation.frame = requestAnimationFrame(() => {
      operation.frame = 0
      updateDraft(operation)
    })
  }

  const finishDrag = (commit: boolean) => {
    const operation = dragRef.current
    if (!operation) return
    dragRef.current = null
    if (operation.frame) cancelAnimationFrame(operation.frame)
    updateDraft(operation)
    operation.stopMeasurement(operation.moved)
    operation.element?.removeAttribute('transform')
    const draft = draftRef.current
    if (draft) draft.style.display = 'none'
    const resizePreview = resizePreviewRef.current
    if (resizePreview) resizePreview.style.display = 'none'
    if (!commit) return

    const dx = operation.latest.x - operation.start.x
    const dy = operation.latest.y - operation.start.y
    if (operation.mode === 'move' && operation.id) {
      props.store.move(operation.id, dx, dy)
      return
    }
    if (operation.mode === 'resize' && operation.id && operation.originalRect && operation.resizeHandle && operation.annotationKind) {
      const rect = resizedRect(operation.originalRect, operation.resizeHandle, operation.latest, operation.annotationKind)
      if (operation.annotationKind === 'square') {
        props.store.resize(operation.id, rect)
      } else {
        const annotation = props.store.get(operation.id)
        if (!annotation) return
        const width = rect[2] - rect[0]
        void props.pool.layoutText(annotation.text, annotation.fontSize, width).then((layout) => {
          props.store.resize(operation.id!, [rect[0], rect[1], rect[2], rect[1] + layout.height])
          props.store.setLayout(operation.id!, layout)
        })
      }
      return
    }
    if (operation.mode === 'square') {
      if (Math.abs(dx) < 4 || Math.abs(dy) < 4) return
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: 'square',
        rect: [
          Math.min(operation.start.x, operation.latest.x),
          Math.min(operation.start.y, operation.latest.y),
          Math.max(operation.start.x, operation.latest.x),
          Math.max(operation.start.y, operation.latest.y),
        ],
      })
      props.onSelect(annotation.id)
      changeTool('select')
      return
    }
    const width = operation.moved ? Math.max(20, Math.abs(dx)) : 200
    const left = operation.moved && dx < 0 ? operation.start.x - width : operation.start.x
    const annotation = props.store.create({
      pageIndex: props.pageIndex,
      kind: 'freetext',
      rect: [left, operation.start.y, left + width, operation.start.y + 16.6],
    })
    props.onSelect(annotation.id)
    props.onEdit(annotation.id)
  }

  const renderAnnotation = (annotation: EditableAnnotation) => {
    const visible = annotation.objNum === null || touched.has(annotation.objNum)
    const [x0, y0, x1, y1] = annotation.rect
    const handleSize = 8 / Math.max(0.01, props.zoom * CSS_PX_PER_PT)
    const handlePositions: Array<{ handle: ResizeHandle; x: number; y: number }> = annotation.kind === 'square'
      ? [
          { handle: 'nw', x: x0, y: y0 },
          { handle: 'n', x: (x0 + x1) / 2, y: y0 },
          { handle: 'ne', x: x1, y: y0 },
          { handle: 'e', x: x1, y: (y0 + y1) / 2 },
          { handle: 'se', x: x1, y: y1 },
          { handle: 's', x: (x0 + x1) / 2, y: y1 },
          { handle: 'sw', x: x0, y: y1 },
          { handle: 'w', x: x0, y: (y0 + y1) / 2 },
        ]
      : [
          { handle: 'e', x: x1, y: (y0 + y1) / 2 },
          { handle: 'w', x: x0, y: (y0 + y1) / 2 },
        ]
    return (
      <g key={annotation.id} data-annotation-id={annotation.id} className="annotation-item">
        {visible && annotation.kind === 'square' && (
          <rect
            className="annotation-square"
            x={x0}
            y={y0}
            width={x1 - x0}
            height={y1 - y0}
            fill="none"
            stroke={color(annotation.color)}
            strokeWidth={annotation.borderWidth}
          />
        )}
        {visible && annotation.kind === 'freetext' && annotation.layout?.lines.map((line, index) => (
          <text
            key={`${annotation.id}-line-${index}`}
            className="annotation-text"
            x={x0 + line.x}
            y={y0 + line.baseline}
            fill={color(annotation.color)}
            fontFamily="KaruBIZUDGothic"
            fontSize={annotation.fontSize}
            style={{ fontKerning: 'none' }}
            xmlSpace="preserve"
          >{line.text}</text>
        ))}
        <rect
          className="annotation-hit"
          data-annotation-id={annotation.id}
          x={x0}
          y={y0}
          width={Math.max(1, x1 - x0)}
          height={Math.max(1, y1 - y0)}
        />
        {props.selectedId === annotation.id && (
          <>
            <rect
              className="annotation-selection"
              x={x0 - 1}
              y={y0 - 1}
              width={x1 - x0 + 2}
              height={y1 - y0 + 2}
            />
            {props.tool === 'select' && handlePositions.map(({ handle, x, y }) => (
              <rect
                key={`${annotation.id}-${handle}`}
                className="annotation-resize-handle"
                data-testid={`resize-handle-${handle}`}
                data-annotation-id={annotation.id}
                data-resize-handle={handle}
                x={x - handleSize / 2}
                y={y - handleSize / 2}
                width={handleSize}
                height={handleSize}
              />
            ))}
          </>
        )}
      </g>
    )
  }

  return (
    <>
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
            const resizeHandle = resizeHandleFromTarget(event.target)
            const annotation = id ? props.store.get(id) : undefined
            if (resizeHandle && annotation) {
              props.store.touch(id!)
              props.onSelect(id)
              const [x0, y0, x1, y1] = annotation.rect
              if (resizePreviewRef.current) {
                resizePreviewRef.current.style.display = 'block'
                resizePreviewRef.current.setAttribute('x', String(x0))
                resizePreviewRef.current.setAttribute('y', String(y0))
                resizePreviewRef.current.setAttribute('width', String(x1 - x0))
                resizePreviewRef.current.setAttribute('height', String(y1 - y0))
              }
              dragRef.current = {
                pointerId: event.pointerId,
                mode: 'resize',
                start,
                latest: start,
                id,
                element: null,
                frame: 0,
                moved: false,
                resizeHandle,
                originalRect: [...annotation.rect],
                annotationKind: annotation.kind,
                stopMeasurement: beginDragFrameMeasurement(),
              }
              svg.setPointerCapture(event.pointerId)
              return
            }
            if (!id) {
              props.onSelect(null)
              return
            }
            props.store.touch(id)
            props.onSelect(id)
            const element = svg.querySelector<SVGGElement>(`g[data-annotation-id="${id}"]`)
            dragRef.current = {
              pointerId: event.pointerId,
              mode: 'move',
              start,
              latest: start,
              id,
              element,
              frame: 0,
              moved: false,
              stopMeasurement: beginDragFrameMeasurement(),
            }
          } else {
            props.onSelect(null)
            if (draftRef.current) {
              draftRef.current.style.display = 'block'
              draftRef.current.setAttribute('x', String(start.x))
              draftRef.current.setAttribute('y', String(start.y))
              draftRef.current.setAttribute('width', '0')
              draftRef.current.setAttribute('height', '0')
            }
            dragRef.current = {
              pointerId: event.pointerId,
              mode: props.tool,
              start,
              latest: start,
              id: null,
              element: null,
              frame: 0,
              moved: false,
              stopMeasurement: beginDragFrameMeasurement(),
            }
          }
          svg.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const operation = dragRef.current
          if (!operation || operation.pointerId !== event.pointerId) return
          operation.latest = pointInPage(event.currentTarget, event)
          if (Math.abs(operation.latest.x - operation.start.x) >= 2 || Math.abs(operation.latest.y - operation.start.y) >= 2) {
            operation.moved = true
          }
          scheduleDraft(operation)
        }}
        onPointerUp={(event) => {
          const operation = dragRef.current
          if (!operation || operation.pointerId !== event.pointerId) return
          operation.latest = pointInPage(event.currentTarget, event)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          finishDrag(true)
        }}
        onPointerCancel={() => finishDrag(false)}
        onDoubleClick={(event) => {
          if (props.tool !== 'select') return
          // Pointer capture makes the synthesized dblclick target the SVG in Chromium,
          // so fall back to the annotation selected by the first click.
          const id = annotationIdFromTarget(event.target) ?? props.selectedId
          const annotation = id ? props.store.touch(id) : undefined
          if (annotation?.kind === 'freetext') {
            props.onSelect(annotation.id)
            props.onEdit(annotation.id)
          }
        }}
      >
        <rect className="annotation-surface" x="0" y="0" width={props.pageSize.width} height={props.pageSize.height} />
        {annotations.map(renderAnnotation)}
        <rect ref={draftRef} className="annotation-draft" x="0" y="0" width="0" height="0" />
        <rect ref={resizePreviewRef} className="annotation-resize-preview" x="0" y="0" width="0" height="0" />
      </svg>
      {editing && (
        <TextEditor
          annotation={editing}
          zoom={props.zoom}
          pool={props.pool}
          store={props.store}
          onClose={(removed) => {
            props.onEdit(null)
            if (props.tool === 'text') {
              props.onSelect(removed ? null : editing.id)
              changeTool('select')
            }
          }}
          registerCommit={props.registerCommit}
        />
      )}
    </>
  )
}
