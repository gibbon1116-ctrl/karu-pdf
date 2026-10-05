import { quantityMethod } from '../core/countFixtures'
import { constrainLinePoint, arrowHeadSize } from '../core/lineGeometry'
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Quad } from 'mupdf'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { CountFixtureSample } from '../core/countFixtures'
import { nearestCalloutEdgePoint, resizeSymbolRect, SYMBOL_OPTIONS, symbolRectFromDrag, type Point, type Rect } from '../core/annotations'
import type { PageSize } from '../core/mupdfDoc'
import { CSS_PX_PER_PT } from '../viewer/pageLayout'
import { beginDragFrameMeasurement, TextEditor } from './TextEditor'
import { AnnotationStore, isTextMarkup, type EditableAnnotation, type Kind } from './AnnotationStore'
import type { FormatDefaults, FormatTool } from './formatDefaults'
import { inkStrokePoints, mergeInkAnnotationId, simplifyPoints, type PreviousInkStroke } from './ink'
import { TextSelectionQueue } from './textSelectionQueue'
import type { TextSelectionMode, TextSelectionResult } from '../core/textSelection'
import { hitTextLine } from './textHitTest'
import { MeasurementShape, useMeasurementInteraction } from './MeasurementOverlay'
import { cloudPath, rectVertices } from '../core/cloud'
import { issueColor, issueFontSize } from '../core/issues'
import { IssueEditor } from './IssueEditor'
import { CLEAR_EDITOR_SELECTION } from './interaction'
import { ToolIcon } from '../ui/ToolIcon'
import { CountMarker, countMarkerData, countSvgPath } from './countMarkers'
import { countFixtureId } from '../core/counts'

export type EditorTool = 'select' | 'textSelect' | FormatTool
const TEXT_SELECTION_START = 'karu-pdf:text-selection-start'
const MULTI_CLICK_MS = 500
const MULTI_CLICK_DISTANCE = 4
const TEXT_MARK_TOOLS = new Set<EditorTool>(['textSelect', 'textHighlight', 'underline', 'strikeout'])
export const EditorToolChangeContext = createContext<(tool: EditorTool) => void>(() => undefined)
export interface FixtureSampleInteraction {
  request(): Promise<CountFixtureSample | null>
  cancel(): void
  selection: { docId: string; complete(pageIndex: number, rect: Rect): void } | null
}
export const FixtureSampleContext = createContext<FixtureSampleInteraction | null>(null)
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type LineHandle = 'start' | 'end'

interface Props {
  docId: string
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
  onStatus(message: string): void
}

interface DragOperation {
  pointerId: number
  mode: 'move' | 'marquee' | 'text' | 'callout' | 'shape' | 'symbol' | 'line' | 'ink' | 'resize' | 'line-end' | 'callout-point' | 'text-selection'
  creationKind?: Kind
  start: Point
  latest: Point
  id: string | null
  element: SVGGElement | null
  ids?: string[]
  elements?: SVGGElement[]
  frame: number
  moved: boolean
  shift: boolean
  ctrl: boolean
  resizeHandle?: ResizeHandle
  lineHandle?: LineHandle
  originalRect?: Rect
  originalLine?: [Point, Point]
  annotationKind?: EditableAnnotation['kind']
  points?: Point[]
  mergeId?: string | null
  selectionMode?: TextSelectionMode
  stopMeasurement(publish?: boolean): void
}

interface NudgeOperation {
  ids: string[]
  elements: SVGGElement[]
  dx: number
  dy: number
  timer: number
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

const constrainedEnd = constrainLinePoint

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
  if (kind === 'symbol' && (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw')) {
    return resizeSymbolRect(rect, handle, point)
  }
  let [x0, y0, x1, y1] = rect
  const minimumWidth = kind === 'freetext' || kind === 'callout' ? 20 : 4
  if (handle.includes('w')) x0 = Math.min(point[0], x1 - minimumWidth)
  if (handle.includes('e')) x1 = Math.max(point[0], x0 + minimumWidth)
  if (kind !== 'freetext' && kind !== 'callout') {
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

function calloutArrowHead(line: [Point, Point], size: number): string {
  const [tip, end] = line
  const angle = Math.atan2(end[1] - tip[1], end[0] - tip[0])
  const left: Point = [tip[0] + Math.cos(angle - Math.PI / 6) * size, tip[1] + Math.sin(angle - Math.PI / 6) * size]
  const right: Point = [tip[0] + Math.cos(angle + Math.PI / 6) * size, tip[1] + Math.sin(angle + Math.PI / 6) * size]
  return `${left[0]},${left[1]} ${tip[0]},${tip[1]} ${right[0]},${right[1]}`
}

function allResizeHandles(kind: Kind): boolean {
  return kind === 'cloudSquare' || kind === 'square' || kind === 'circle' || kind === 'highlight' || kind === 'ink'
}

function quadPoints(quad: Quad): string {
  return `${quad[0]},${quad[1]} ${quad[2]},${quad[3]} ${quad[6]},${quad[7]} ${quad[4]},${quad[5]}`
}

function selectionBounds(quads: readonly Quad[]): Rect | null {
  if (quads.length === 0) return null
  const xs = quads.flatMap((quad) => [quad[0], quad[2], quad[4], quad[6]])
  const ys = quads.flatMap((quad) => [quad[1], quad[3], quad[5], quad[7]])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function AnnotationLayer(props: Props) {
  const sampleInteraction = useContext(FixtureSampleContext)
  const version = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const svgRef = useRef<SVGSVGElement>(null)
  const measurement = useMeasurementInteraction({ svg: svgRef, store: props.store, pageIndex: props.pageIndex, tool: props.tool, quantityItem: props.store.getCountFixture(props.store.selectedFixtureId), defaults: props.formatDefaults, select: props.onSelect })
  const draftCloudRef = useRef<SVGPathElement>(null)
  const draftRectRef = useRef<SVGRectElement>(null)
  const draftLineRef = useRef<SVGLineElement>(null)
  const draftInkRef = useRef<SVGPolylineElement>(null)
  const resizePreviewRef = useRef<SVGRectElement>(null)
  const linePreviewRef = useRef<SVGLineElement>(null)
  const calloutPreviewRef = useRef<SVGLineElement>(null)
  const textSelectionRef = useRef<SVGGElement>(null)
  const dragRef = useRef<DragOperation | null>(null)
  const nudgeRef = useRef<NudgeOperation | null>(null)
  const clickRef = useRef<{ at: number; x: number; y: number; count: number } | null>(null)
  const textLinesRef = useRef<Rect[] | null>(null)
  const textLinesRequestedRef = useRef(false)
  const pointerPointRef = useRef<Point | null>(null)
  const previousInkRef = useRef<PreviousInkStroke | null>(null)
  const loadingLayoutsRef = useRef(new Set<string>())
  const toolRef = useRef(props.tool)
  const selectionGenerationRef = useRef(0)
  toolRef.current = props.tool
  const [textSelection, setTextSelection] = useState<TextSelectionResult | null>(null)
  const textQueue = useMemo(() => new TextSelectionQueue(
    (input: { from: Point; to: Point; mode: TextSelectionMode }) => props.pool.selectText(
      props.docId, props.pageIndex, input.from, input.to, input.mode,
    ),
  ), [props.docId, props.pageIndex, props.pool])
  const annotations = props.store.getPageAnnotations(props.pageIndex).filter(a => props.store.isShownOnDrawing(a))
  const selectedIds = new Set(props.store.selectedIds())
  const singleSelection = selectedIds.size === 1
  const touched = useMemo(() => new Set(props.store.touchedObjNums(props.pageIndex)), [version, props.pageIndex, props.store])
  const visibleCount = annotations.filter(a => a.count).length
  const compactCounts = visibleCount > 500
  const countPaths = new Map<string, { outline: string[]; fills: string[]; strokes: string[]; stroke: string; opacity: number; bright: boolean; selected: boolean }>()
  if (compactCounts) for (const a of annotations) {
    const fixture = props.store.fixtureForCount(a.count)
    if (!fixture || !a.count || singleSelection && selectedIds.has(a.id)) continue
    const [x0, y0, x1, y1] = a.rect, data = countMarkerData(fixture.style, (x0 + x1) / 2, (y0 + y1) / 2)
    const selected = selectedIds.has(a.id), key = JSON.stringify([fixture.style.shape, fixture.style.fill, fixture.style.color, fixture.style.size, fixture.style.opacity, selected])
    const group = countPaths.get(key) ?? { outline: [], fills: [], strokes: [], stroke: data.color, opacity: data.opacity, bright: data.bright, selected }
    group.outline.push(countSvgPath(data.outline)); group.fills.push(countSvgPath(data.fills)); group.strokes.push(countSvgPath(data.strokes, false))
    countPaths.set(key, group)
  }
  const editing = props.editingId ? annotations.find((annotation) => annotation.id === props.editingId) : undefined

  useEffect(() => () => textQueue.dispose(), [textQueue])

  const setTextCursor = (cursor: 'text' | 'default' | '') => {
    const svg = svgRef.current
    if (svg && svg.style.cursor !== cursor) svg.style.cursor = cursor
  }

  const updateTextCursor = (point: Point) => {
    const operation = dragRef.current
    if (operation?.mode === 'text-selection') {
      setTextCursor('text')
      return
    }
    setTextCursor(hitTextLine(textLinesRef.current ?? [], point) ? 'text' : 'default')
  }

  const ensureTextLines = () => {
    if (!TEXT_MARK_TOOLS.has(props.tool) || textLinesRequestedRef.current) return
    textLinesRequestedRef.current = true
    setTextCursor('default')
    void props.pool.pageTextLines(props.docId, props.pageIndex).then((lines) => {
      textLinesRef.current = lines
      const point = pointerPointRef.current
      if (point && TEXT_MARK_TOOLS.has(toolRef.current)) updateTextCursor(point)
    }).catch(() => {
      textLinesRef.current = []
    })
  }

  useEffect(() => {
    if (!TEXT_MARK_TOOLS.has(props.tool)) setTextCursor('')
    else setTextCursor('default')
  }, [props.tool])

  const flushNudge = () => {
    const operation = nudgeRef.current
    if (!operation) return
    nudgeRef.current = null
    window.clearTimeout(operation.timer)
    for (const element of operation.elements) element.removeAttribute('transform')
    if (operation.dx !== 0 || operation.dy !== 0) {
      props.store.nudgeMany(operation.ids, operation.dx, operation.dy, operation.ids.slice().sort().join('|'))
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        flushNudge()
        return
      }
      if (props.tool !== 'select' || props.editingId || isInput || event.ctrlKey || event.metaKey || event.altKey) return
      const movement: Record<string, Point> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      }
      const direction = movement[event.key]
      if (!direction) return
      const primary = props.store.primarySelection()
      const primaryAnnotation = primary ? props.store.get(primary) : undefined
      if (!primaryAnnotation || primaryAnnotation.pageIndex !== props.pageIndex) return
      const ids = props.store.selectedIds().filter((id) => {
        const annotation = props.store.get(id)
        return annotation?.pageIndex === props.pageIndex && !isTextMarkup(annotation.kind)
      })
      if (ids.length === 0) return
      event.preventDefault()

      let operation = nudgeRef.current
      if (!operation || operation.ids.join('\0') !== ids.join('\0')) {
        flushNudge()
        const svg = svgRef.current
        if (!svg) return
        operation = {
          ids,
          elements: ids.flatMap((id) => {
            const element = svg.querySelector<SVGGElement>(`g[data-annotation-id="${id}"]`)
            return element ? [element] : []
          }),
          dx: 0,
          dy: 0,
          timer: 0,
        }
        nudgeRef.current = operation
      }

      const rects = operation.ids.flatMap((id) => {
        const annotation = props.store.get(id)
        return annotation ? [annotation.rect] : []
      })
      if (rects.length === 0) return
      const bounds: Rect = [
        Math.min(...rects.map((rect) => rect[0])), Math.min(...rects.map((rect) => rect[1])),
        Math.max(...rects.map((rect) => rect[2])), Math.max(...rects.map((rect) => rect[3])),
      ]
      const distance = event.shiftKey ? 10 : 1
      operation.dx = Math.max(-bounds[0], Math.min(props.pageSize.width - bounds[2], operation.dx + direction[0] * distance))
      operation.dy = Math.max(-bounds[1], Math.min(props.pageSize.height - bounds[3], operation.dy + direction[1] * distance))
      for (const element of operation.elements) element.setAttribute('transform', `translate(${operation.dx} ${operation.dy})`)
      window.clearTimeout(operation.timer)
      operation.timer = window.setTimeout(flushNudge, 150)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', flushNudge, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', flushNudge, true)
      flushNudge()
    }
  }, [props.editingId, props.pageIndex, props.pageSize.height, props.pageSize.width, props.store, props.tool])

  const drawTextSelection = (result: TextSelectionResult | null) => {
    const group = textSelectionRef.current
    if (!group) return
    group.replaceChildren(...(result?.quads ?? []).map((quad) => {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      polygon.setAttribute('points', quadPoints(quad))
      return polygon
    }))
  }

  useEffect(() => {
    if (props.tool !== 'textSelect') {
      setTextSelection(null)
      drawTextSelection(null)
    }
  }, [props.tool])

  // 文字の選択は、同時に1ページだけにする。他のページの選択が残ると、
  // Ctrl+C でどちらの文字がコピーされるか決まらなくなる。
  const layerKey = `${props.docId}:${props.pageIndex}`
  useEffect(() => {
    const onStart = (event: Event) => {
      if ((event as CustomEvent<string>).detail === layerKey) return
      setTextSelection(null)
      drawTextSelection(null)
    }
    window.addEventListener(TEXT_SELECTION_START, onStart)
    return () => window.removeEventListener(TEXT_SELECTION_START, onStart)
  }, [layerKey])

  const copySelectedText = () => {
    if (!textSelection?.text) return
    void navigator.clipboard.writeText(textSelection.text).then(() => props.onStatus('選んだ文字をコピーしました'))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (props.tool !== 'textSelect' || !textSelection?.text || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return
      event.preventDefault()
      copySelectedText()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const createMarkup = (kind: 'textHighlight' | 'underline' | 'strikeout', result = textSelection) => {
    if (!result || result.quads.length === 0) return
    const format = props.formatDefaults[kind]
    const rect = selectionBounds(result.quads)
    if (!rect) return
    const annotation = props.store.create({
      pageIndex: props.pageIndex,
      kind,
      rect,
      text: result.text,
      quads: result.quads,
      color: format.color,
      opacity: kind === 'textHighlight' ? format.opacity : 1,
    })
    props.onSelect(annotation.id)
    // 印を付けたら、青い選択の表示は消す（ハイライトの色が青く濁って見えるため）。
    setTextSelection(null)
    drawTextSelection(null)
  }

  useEffect(() => {
    for (const annotation of annotations) {
      const visible = annotation.objNum === null || touched.has(annotation.objNum)
      if (!visible || (annotation.kind !== 'freetext' && annotation.kind !== 'callout') || annotation.layout || loadingLayoutsRef.current.has(annotation.id)) continue
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
    if (operation.mode === 'text-selection') {
      const input = { from: operation.start, to: operation.latest, mode: operation.selectionMode ?? 'chars' as TextSelectionMode }
      const generation = selectionGenerationRef.current
      textQueue.request(input, result => {
        if (generation === selectionGenerationRef.current) drawTextSelection(result)
      })
      return
    }
    if (operation.mode === 'move') {
      for (const element of operation.elements ?? (operation.element ? [operation.element] : [])) {
        element.setAttribute('transform', `translate(${dx} ${dy})`)
      }
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
      const index = operation.lineHandle === 'start' ? 0 : 1
      line[index] = constrainedEnd(line[1 - index], operation.latest, operation.shift)
      const preview = linePreviewRef.current
      preview?.setAttribute('x1', String(line[0][0]))
      preview?.setAttribute('y1', String(line[0][1]))
      preview?.setAttribute('x2', String(line[1][0]))
      preview?.setAttribute('y2', String(line[1][1]))
      return
    }
    if (operation.mode === 'callout-point' && operation.id) {
      const annotation = props.store.get(operation.id)
      const preview = calloutPreviewRef.current
      if (!annotation || !preview) return
      const end = nearestCalloutEdgePoint(annotation.rect, operation.latest)
      preview.setAttribute('x1', String(operation.latest[0]))
      preview.setAttribute('y1', String(operation.latest[1]))
      preview.setAttribute('x2', String(end[0]))
      preview.setAttribute('y2', String(end[1]))
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
      const points = inkStrokePoints(operation.points ?? [], operation.ctrl, operation.shift)
      draftInkRef.current?.setAttribute('points', points.map((point) => `${point[0]},${point[1]}`).join(' '))
      return
    }
    const draft = draftRectRef.current
    if (!draft) return
    const rect = operation.mode === 'shape' || operation.mode === 'marquee'
      ? shapeRect(operation.start, operation.latest, (operation.creationKind === 'circle' || operation.creationKind === 'square') && operation.shift)
      : operation.mode === 'symbol'
        ? symbolRectFromDrag(operation.start, operation.latest, operation.moved, props.formatDefaults[props.tool === 'count' ? 'count' : 'symbol'].symbolSize)
      : operation.mode === 'callout'
        ? [
            operation.moved ? operation.latest[0] : operation.start[0] + 40,
            operation.moved ? operation.latest[1] : operation.start[1] - 40,
            (operation.moved ? operation.latest[0] : operation.start[0] + 40) + 160,
            (operation.moved ? operation.latest[1] : operation.start[1] - 40) + 16.6,
          ] as Rect
      : [dx < 0 ? operation.latest[0] : operation.start[0], operation.start[1], dx < 0 ? operation.start[0] : operation.latest[0], operation.start[1] + 16.6] as Rect
    if (operation.creationKind === 'cloudSquare') {
      const f = props.formatDefaults.cloudSquare
      draftCloudRef.current?.setAttribute('d', cloudPath(rectVertices(rect), f.cloudIntensity, f.borderWidth))
      draftCloudRef.current?.setAttribute('stroke', color(f.color))
      draftCloudRef.current?.setAttribute('stroke-width', String(f.borderWidth))
      draftCloudRef.current?.setAttribute('fill', f.fillColor ? color(f.fillColor) : 'none')
      draftCloudRef.current?.setAttribute('opacity', String(f.opacity))
      return
    }
    draft.setAttribute('x', String(rect[0]))
    draft.setAttribute('y', String(rect[1]))
    draft.setAttribute('width', String(rect[2] - rect[0]))
    draft.setAttribute('height', String(rect[3] - rect[1]))
    if (operation.mode === 'callout') {
      const end = nearestCalloutEdgePoint(rect, operation.start)
      draftLineRef.current?.setAttribute('x1', String(operation.start[0]))
      draftLineRef.current?.setAttribute('y1', String(operation.start[1]))
      draftLineRef.current?.setAttribute('x2', String(end[0]))
      draftLineRef.current?.setAttribute('y2', String(end[1]))
    }
  }

  const scheduleDraft = (operation: DragOperation) => {
    if (operation.frame) return
    operation.frame = requestAnimationFrame(() => {
      operation.frame = 0
      updateDraft(operation)
    })
  }

  const hideDrafts = () => {
    for (const element of [draftCloudRef.current, draftRectRef.current, draftLineRef.current, draftInkRef.current, resizePreviewRef.current, linePreviewRef.current, calloutPreviewRef.current]) {
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
    for (const element of operation.elements ?? (operation.element ? [operation.element] : [])) element.removeAttribute('transform')
    hideDrafts()
    if (operation.mode === 'text-selection') {
      if (!commit) {
        selectionGenerationRef.current += 1
        drawTextSelection(null)
        return
      }
      const input = { from: operation.start, to: operation.latest, mode: operation.selectionMode ?? 'chars' as TextSelectionMode }
      const generation = selectionGenerationRef.current
      void textQueue.finish(input).then((result) => {
        if (generation !== selectionGenerationRef.current || toolRef.current !== props.tool) return
        drawTextSelection(result)
        if (result.quads.length === 0) return
        if (props.tool === 'textSelect') setTextSelection(result)
        else if (props.tool === 'textHighlight' || props.tool === 'underline' || props.tool === 'strikeout') createMarkup(props.tool, result)
      }).catch((reason) => props.onStatus(`文字を選択できませんでした: ${reason instanceof Error ? reason.message : String(reason)}`))
      return
    }
    if (!commit) return

    const dx = operation.latest[0] - operation.start[0]
    const dy = operation.latest[1] - operation.start[1]
    if (operation.mode === 'move' && operation.id) {
      props.store.moveMany(operation.ids ?? [operation.id], dx, dy)
      return
    }
    if (operation.mode === 'marquee') {
      props.store.selectInRect(props.pageIndex, shapeRect(operation.start, operation.latest, false))
      props.onSelect(props.store.primarySelection())
      return
    }
    if (operation.mode === 'line-end' && operation.id && operation.originalLine && operation.lineHandle) {
      const line = operation.originalLine.map((point) => [...point]) as [Point, Point]
      const index = operation.lineHandle === 'start' ? 0 : 1
      line[index] = constrainedEnd(line[1 - index], operation.latest, operation.shift)
      props.store.updateLine(operation.id, line)
      return
    }
    if (operation.mode === 'callout-point' && operation.id) {
      props.store.updateCalloutPoint(operation.id, operation.latest)
      return
    }
    if (operation.mode === 'resize' && operation.id && operation.originalRect && operation.resizeHandle && operation.annotationKind) {
      const rect = resizedRect(operation.originalRect, operation.resizeHandle, operation.latest, operation.annotationKind)
      if (operation.annotationKind !== 'freetext' && operation.annotationKind !== 'callout') props.store.resize(operation.id, rect)
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
      const modePoints = inkStrokePoints(operation.points, operation.ctrl, operation.shift)
      const points = operation.ctrl || operation.shift ? modePoints : simplifyPoints(modePoints, 0.5)
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
        arrowHeadSize: format.arrowHeadSize,
          opacity: format.opacity,
          inkList: [points],
        })
        id = annotation.id
      }
      props.store.selectOnly(id!)
      props.onSelect(id!)
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
        arrowHeadSize: format.arrowHeadSize,
        opacity: format.opacity,
      })
      props.onSelect(annotation.id)
      return
    }
    if (operation.mode === 'shape' && operation.creationKind) {
      const rect = shapeRect(operation.start, operation.latest, (operation.creationKind === 'circle' || operation.creationKind === 'square') && operation.shift)
      if (rect[2] - rect[0] < 4 || rect[3] - rect[1] < 4) return
      const format = props.formatDefaults[operation.creationKind as 'cloudSquare' | 'square' | 'circle']
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: operation.creationKind,
        rect,
        color: format.borderColor ?? format.color,
        borderColor: format.borderColor,
        borderWidth: format.borderColor ? format.borderWidth : 0,
        interiorColor: format.fillColor,
        cloudIntensity: format.cloudIntensity,
        opacity: format.opacity,
      })
      props.onSelect(annotation.id)
      return
    }
    if (operation.mode === 'symbol') {
      const fixture = props.tool === 'count' ? props.store.getCountFixture(props.store.selectedFixtureId) : undefined
      if (fixture && quantityMethod(fixture) !== 'click') { props.onStatus('この種別の拾いは、まだ使えません'); return }
      if (props.tool === 'count' && !fixture) { props.onStatus('数量拾いの一覧で項目を選んでください'); window.dispatchEvent(new CustomEvent('karu-pdf:open-fixtures')); return }
      const format = props.formatDefaults[props.tool === 'count' ? 'count' : 'symbol']
      const rect = props.tool === 'count' ? symbolRectFromDrag(operation.latest, operation.latest, false, fixture!.style.size) : symbolRectFromDrag(operation.start, operation.latest, operation.moved, format.symbolSize)
      if (rect[2] - rect[0] < 4) return
      if (fixture && props.store.getPageAnnotations(props.pageIndex).some(a => a.count && countFixtureId(a.count) === fixture.id && Math.hypot((a.rect[0] + a.rect[2]) / 2 - operation.latest[0], (a.rect[1] + a.rect[3]) / 2 - operation.latest[1]) <= 3 * 72 / 25.4)) props.onStatus('近くに同じ数量拾いの印があります（二重に数えていないか確認してください）')
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: 'symbol',
        count: fixture ? { version: 2, id: crypto.randomUUID(), fixtureId: fixture.id } : null,
        text: fixture ? `個数: ${fixture.code} ${fixture.name}`.trim() : '',
        rect,
        color: fixture?.style.color ?? format.color,
        symbol: fixture ? 'circle' : format.symbol,
        opacity: fixture?.style.opacity ?? format.opacity,
      })
      props.onSelect(annotation.id)
      return
    }
    if (operation.mode === 'text' || operation.mode === 'callout') {
      const callout = operation.mode === 'callout'
      const format = props.formatDefaults[callout ? 'callout' : 'text']
      const width = callout ? 160 : operation.moved ? Math.max(20, Math.abs(dx)) : 200
      const left = callout
        ? (operation.moved ? operation.latest[0] : operation.start[0] + 40)
        : operation.moved && dx < 0 ? operation.start[0] - width : operation.start[0]
      const top = callout ? (operation.moved ? operation.latest[1] : operation.start[1] - 40) : operation.start[1]
      const annotation = props.store.create({
        pageIndex: props.pageIndex,
        kind: callout ? 'callout' : 'freetext',
        color: format.color,
        fontSize: format.fontSize,
        font: format.font,
        rect: [left, top, left + width, top + 16.6],
        interiorColor: format.fillColor,
        borderColor: format.borderColor,
        borderWidth: format.borderWidth,
        arrowHeadSize: format.arrowHeadSize,
        textOpacity: format.textOpacity,
        boxOpacity: format.boxOpacity,
        calloutPoint: callout ? operation.start : null,
        deferHistory: true,
      })
      props.onSelect(annotation.id)
      props.onEdit(annotation.id)
    }
  }

  useEffect(() => {
    const viewer = svgRef.current?.closest('.viewer')
    const cancel = () => {
      const pointerId = dragRef.current?.pointerId
      finishDrag(false)
      if (pointerId !== undefined && svgRef.current?.hasPointerCapture(pointerId)) svgRef.current.releasePointerCapture(pointerId)
      measurement.cancel()
      selectionGenerationRef.current += 1
      setTextSelection(null)
      drawTextSelection(null)
      clickRef.current = null
      previousInkRef.current = null
    }
    viewer?.addEventListener(CLEAR_EDITOR_SELECTION, cancel)
    return () => {
      viewer?.removeEventListener(CLEAR_EDITOR_SELECTION, cancel)
      cancel()
    }
  }, [props.tool, textQueue])

  const renderAnnotation = (annotation: EditableAnnotation) => {
    if (annotation.legacyChange) {
      const [x, y, right, bottom] = annotation.rect
      return <g key={annotation.id} data-annotation-id={annotation.id} className="annotation-item">
        {(annotation.objNum === null || annotation.dirty) && annotation.legacyChangeData && <image href={annotation.legacyChangeData.preview}
          x={annotation.legacyChangeData.bounds[0]} y={annotation.legacyChangeData.bounds[1]}
          width={annotation.legacyChangeData.bounds[2]-annotation.legacyChangeData.bounds[0]} height={annotation.legacyChangeData.bounds[3]-annotation.legacyChangeData.bounds[1]} pointerEvents="none" />}
        <rect x={x} y={y} width={right-x} height={bottom-y} fill="transparent" pointerEvents="all" />
        {selectedIds.has(annotation.id) && <rect className="annotation-selection" x={x} y={y} width={right-x} height={bottom-y} fill="none" pointerEvents="none" />}
      </g>
    }
    const fixture = props.store.fixtureForCount(annotation.count)
    if (compactCounts && annotation.count && (fixture || annotation.symbol === 'circle') && !(singleSelection && selectedIds.has(annotation.id))) return null
    const visible = !!fixture && !!annotation.count || !!annotation.quantity && props.store.fixturesReady && !!props.store.getCountFixture(annotation.quantity.itemId) || !!annotation.issue && annotation.issue.recordKind !== 'change' || annotation.objNum === null || touched.has(annotation.objNum)
    const [x0, y0, x1, y1] = annotation.rect
    const handleSize = 8 / Math.max(0.01, props.zoom * CSS_PX_PER_PT)
    const positions: Array<{ handle: ResizeHandle; x: number; y: number }> = annotation.count ? [] : allResizeHandles(annotation.kind)
      ? [
          { handle: 'nw', x: x0, y: y0 }, { handle: 'n', x: (x0 + x1) / 2, y: y0 }, { handle: 'ne', x: x1, y: y0 },
          { handle: 'e', x: x1, y: (y0 + y1) / 2 }, { handle: 'se', x: x1, y: y1 }, { handle: 's', x: (x0 + x1) / 2, y: y1 },
          { handle: 'sw', x: x0, y: y1 }, { handle: 'w', x: x0, y: (y0 + y1) / 2 },
        ]
      : annotation.kind === 'symbol'
        ? [
            { handle: 'nw', x: x0, y: y0 }, { handle: 'ne', x: x1, y: y0 },
            { handle: 'se', x: x1, y: y1 }, { handle: 'sw', x: x0, y: y1 },
          ]
      : annotation.kind === 'freetext' || annotation.kind === 'callout'
        ? [{ handle: 'e', x: x1, y: (y0 + y1) / 2 }, { handle: 'w', x: x0, y: (y0 + y1) / 2 }]
        : []
    const line = annotation.line
    const calloutLine = annotation.kind === 'callout' && annotation.calloutPoint
      ? [[...annotation.calloutPoint], nearestCalloutEdgePoint(annotation.rect, annotation.calloutPoint)] as [Point, Point]
      : null
    const calloutColor = annotation.borderColor ?? annotation.color
    const symbolGlyph = annotation.symbol
      ? SYMBOL_OPTIONS.find((item) => item.name === annotation.symbol)?.glyph
      : undefined
    const selectionRect: Rect = calloutLine
      ? [Math.min(x0, calloutLine[0][0]), Math.min(y0, calloutLine[0][1]), Math.max(x1, calloutLine[0][0]), Math.max(y1, calloutLine[0][1])]
      : annotation.rect
    return (
      <g key={annotation.id} data-annotation-id={annotation.id} data-symbol={annotation.symbol ?? undefined} className="annotation-item" data-issue-number={annotation.issue?.number}>
        {annotation.issue && <title>{annotation.text}</title>}
        {visible && (annotation.kind === 'cloudSquare' || annotation.kind === 'cloudPolygon') && <path className="annotation-cloud" d={cloudPath(annotation.vertices ?? rectVertices(annotation.rect), annotation.cloudIntensity ?? 1, annotation.borderWidth)} fill={annotation.interiorColor ? color(annotation.interiorColor) : 'none'} stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} opacity={annotation.opacity} />}
        {visible && annotation.issue && <g className="annotation-issue" fill={color(issueColor(annotation.issue, annotation.color))}>
          <circle cx={(x0+x1)/2} cy={(y0+y1)/2} r={(x1-x0)*.45} fill="white" stroke={color(issueColor(annotation.issue, annotation.color))} strokeWidth={(x1-x0)*.06} />
          <text x={(x0+x1)/2} y={(y0+y1)/2 + issueFontSize(annotation.issue.number, x1-x0)*.3} textAnchor="middle" fontFamily="KaruBIZUDGothic" fontSize={issueFontSize(annotation.issue.number, x1-x0)}>{annotation.issue.number}</text>
        </g>}
        {visible && annotation.measure && annotation.vertices && <MeasurementShape points={annotation.vertices} kind={annotation.measure.kind} text={annotation.quantity ? props.store.quantityText(annotation) : annotation.text} fontSize={annotation.fontSize} color={color(annotation.color)} width={annotation.borderWidth} opacity={annotation.opacity} dash={annotation.quantityDash} />}
        {visible && annotation.kind === 'square' && <rect className="annotation-square" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={annotation.interiorColor ? color(annotation.interiorColor) : 'none'} stroke={annotation.borderColor ? color(annotation.borderColor) : 'none'} strokeWidth={annotation.borderColor ? annotation.borderWidth : 0} opacity={annotation.opacity} />}
        {visible && annotation.kind === 'circle' && <ellipse className="annotation-shape" cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} fill={annotation.interiorColor ? color(annotation.interiorColor) : 'none'} stroke={annotation.borderColor ? color(annotation.borderColor) : 'none'} strokeWidth={annotation.borderColor ? annotation.borderWidth : 0} opacity={annotation.opacity} />}
        {visible && line && <>
          <line className="annotation-line" x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} opacity={annotation.opacity} />
          {annotation.kind === 'arrow' && <polyline className="annotation-line" points={arrowHead(line, arrowHeadSize(annotation.arrowHeadSize, annotation.borderWidth))} fill="none" stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} opacity={annotation.opacity} />}
        </>}
        {visible && (annotation.kind === 'highlight' || annotation.kind === 'ink') && annotation.inkList?.map((stroke, index) => (
          <polyline key={`${annotation.id}-stroke-${index}`} className="annotation-ink" points={stroke.map((point) => `${point[0]},${point[1]}`).join(' ')} fill="none" stroke={color(annotation.color)} strokeWidth={annotation.borderWidth} opacity={annotation.opacity} />
        ))}
        {visible && annotation.quads?.map((quad, index) => annotation.kind === 'textHighlight' ? (
          <polygon key={`${annotation.id}-quad-${index}`} className="annotation-text-highlight" points={quadPoints(quad)} fill={color(annotation.color)} opacity={annotation.opacity} />
        ) : annotation.kind === 'underline' ? (
          <line key={`${annotation.id}-quad-${index}`} className="annotation-text-mark-line" x1={quad[4]} y1={quad[5]} x2={quad[6]} y2={quad[7]} stroke={color(annotation.color)} />
        ) : annotation.kind === 'strikeout' ? (
          <line key={`${annotation.id}-quad-${index}`} className="annotation-text-mark-line" x1={(quad[0] + quad[4]) / 2} y1={(quad[1] + quad[5]) / 2} x2={(quad[2] + quad[6]) / 2} y2={(quad[3] + quad[7]) / 2} stroke={color(annotation.color)} />
        ) : null)}
        {visible && fixture && annotation.count && <CountMarker style={fixture.style} code={fixture.code} showCode={visibleCount <= 1000} x={(x0 + x1) / 2} y={(y0 + y1) / 2} />}
        {visible && !fixture && annotation.kind === 'symbol' && symbolGlyph && <text
          className="annotation-symbol"
          x={(x0 + x1) / 2}
          y={(y0 + y1) / 2}
          fill={color(annotation.color)}
          opacity={annotation.opacity}
          fontSize={Math.min(x1 - x0, y1 - y0) * 0.92}
          textAnchor="middle"
          dominantBaseline="central"
        >{symbolGlyph}</text>}
        {visible && calloutLine && <>
          <line className="annotation-callout-line" x1={calloutLine[0][0]} y1={calloutLine[0][1]} x2={calloutLine[1][0]} y2={calloutLine[1][1]} stroke={color(calloutColor)} strokeWidth={Math.max(0.5, annotation.borderWidth)} opacity={annotation.boxOpacity} />
          <polyline className="annotation-callout-line" points={calloutArrowHead(calloutLine, arrowHeadSize(annotation.arrowHeadSize, annotation.borderWidth))} fill="none" stroke={color(calloutColor)} strokeWidth={Math.max(0.5, annotation.borderWidth)} opacity={annotation.boxOpacity} />
        </>}
        {visible && (annotation.kind === 'freetext' || annotation.kind === 'callout') && <g className="annotation-text-frame">
          <rect className="annotation-text-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={annotation.interiorColor ? color(annotation.interiorColor) : 'none'} stroke={annotation.borderColor ? color(annotation.borderColor) : 'none'} strokeWidth={annotation.borderColor ? annotation.borderWidth : 0} opacity={annotation.boxOpacity} />
          {annotation.layout?.lines.map((lineLayout, index) => (
            <text key={`${annotation.id}-line-${index}`} className="annotation-text" x={x0 + lineLayout.x} y={y0 + lineLayout.baseline} fill={color(annotation.color)} opacity={annotation.textOpacity} fontFamily={annotation.font === 'BIZUDMincho' ? 'KaruBIZUDMincho' : 'KaruBIZUDGothic'} fontSize={annotation.fontSize} style={{ fontKerning: 'none' }} xmlSpace="preserve">{lineLayout.text}</text>
          ))}
        </g>}
        {annotation.measure && annotation.vertices ? <polyline className="annotation-hit annotation-line-hit" points={[...annotation.vertices, ...(annotation.kind === 'area' ? [annotation.vertices[0]] : [])].map(p => p.join(',')).join(' ')} fill="none" /> : line ? <line className="annotation-hit annotation-line-hit" data-annotation-id={annotation.id} x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} /> : <rect className="annotation-hit" data-annotation-id={annotation.id} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} />}
        {calloutLine && <line className="annotation-hit annotation-line-hit" data-annotation-id={annotation.id} x1={calloutLine[0][0]} y1={calloutLine[0][1]} x2={calloutLine[1][0]} y2={calloutLine[1][1]} />}
        {selectedIds.has(annotation.id) && <>
          <rect className="annotation-selection" x={selectionRect[0] - 1} y={selectionRect[1] - 1} width={Math.max(2, selectionRect[2] - selectionRect[0] + 2)} height={Math.max(2, selectionRect[3] - selectionRect[1] + 2)} />
          {props.tool === 'select' && singleSelection && annotation.vertices?.map((p, i) => <rect key={i} className="annotation-resize-handle" data-testid={`measure-handle-${i}`} data-measure-vertex={i} data-annotation-id={annotation.id} x={p[0] - handleSize / 2} y={p[1] - handleSize / 2} width={handleSize} height={handleSize} />)}
          {props.tool === 'select' && singleSelection && positions.map(({ handle, x, y }) => <rect key={`${annotation.id}-${handle}`} className="annotation-resize-handle" data-testid={`resize-handle-${handle}`} data-annotation-id={annotation.id} data-resize-handle={handle} x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} />)}
          {props.tool === 'select' && singleSelection && line && line.map((point, index) => <rect key={`${annotation.id}-line-${index}`} className="annotation-resize-handle" data-testid={`line-handle-${index === 0 ? 'start' : 'end'}`} data-annotation-id={annotation.id} data-line-handle={index === 0 ? 'start' : 'end'} x={point[0] - handleSize / 2} y={point[1] - handleSize / 2} width={handleSize} height={handleSize} />)}
          {props.tool === 'select' && singleSelection && calloutLine && <rect className="annotation-resize-handle annotation-callout-handle" data-testid="callout-point-handle" data-annotation-id={annotation.id} data-callout-point="true" x={calloutLine[0][0] - handleSize / 2} y={calloutLine[0][1] - handleSize / 2} width={handleSize} height={handleSize} />}
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
      onPointerEnter={(event) => {
        if (!TEXT_MARK_TOOLS.has(props.tool)) return
        pointerPointRef.current = pointInPage(event.currentTarget, event)
        ensureTextLines()
        updateTextCursor(pointerPointRef.current)
      }}
      onPointerDown={(event) => {
        if (event.defaultPrevented || event.button !== 0 || props.editingId) return
        event.currentTarget.closest<HTMLElement>('.viewer')?.focus({ preventScroll: true })
        event.preventDefault()
        const svg = event.currentTarget
        const start = pointInPage(svg, event)
        const id = annotationIdFromTarget(event.target) ?? (compactCounts && props.tool === 'select'
          ? annotations.findLast(a => a.count && start[0] >= a.rect[0] && start[0] <= a.rect[2] && start[1] >= a.rect[1] && start[1] <= a.rect[3])?.id ?? null : null)
        if (props.tool === 'count') {
          props.store.prepareCountTool()
        }
        if (measurement.pointerDown(event, start)) return
        if (props.tool === 'text' || props.tool === 'callout') {
          const annotation = id ? props.store.get(id) : undefined
          if (annotation?.kind === 'freetext' || annotation?.kind === 'callout') {
            props.store.touch(annotation.id)
            props.store.selectOnly(annotation.id)
            props.onSelect(annotation.id)
            props.onEdit(annotation.id)
            return
          }
        }
        if (props.tool === 'issue') {
          const creationTool = props.tool
          void props.store.issueNumbers.initialize(() => props.pool.maxIssueNumber(props.docId)).then(() => {
            if (toolRef.current !== creationTool) return
            const f = props.formatDefaults[creationTool]
            const annotation = props.store.create({ pageIndex: props.pageIndex, kind: 'issue', rect: symbolRectFromDrag(start, start, false, f.symbolSize), color: f.color })
            props.store.selectOnly(annotation.id); props.onSelect(annotation.id); props.onEdit(annotation.id)
          }).catch(reason => props.onStatus(`指摘を作れませんでした: ${String(reason)}`))
          return
        }
        if (props.tool === 'select') {
          const annotation = id ? props.store.get(id) : undefined
          const lineHandle = targetValue<LineHandle>(event.target, 'line-handle')
          const resizeHandle = targetValue<ResizeHandle>(event.target, 'resize-handle')
          const calloutPoint = targetValue<string>(event.target, 'callout-point')
          if (id && event.shiftKey && !lineHandle && !resizeHandle && !calloutPoint) {
            props.store.toggleSelection(id)
            props.onSelect(props.store.primarySelection())
            return
          }
          if (calloutPoint && annotation?.kind === 'callout') {
            props.store.touch(id!)
            props.onSelect(id)
            if (calloutPreviewRef.current) calloutPreviewRef.current.style.display = 'block'
            dragRef.current = { pointerId: event.pointerId, mode: 'callout-point', start, latest: start, id, element: null, frame: 0, moved: false, shift: false, ctrl: false, stopMeasurement: beginDragFrameMeasurement() }
          } else if (lineHandle && annotation?.line) {
            props.store.touch(id!)
            props.onSelect(id)
            if (linePreviewRef.current) linePreviewRef.current.style.display = 'block'
            dragRef.current = { pointerId: event.pointerId, mode: 'line-end', start, latest: start, id, element: null, frame: 0, moved: false, shift: false, ctrl: false, lineHandle, originalLine: annotation.line, stopMeasurement: beginDragFrameMeasurement() }
          } else if (resizeHandle && annotation) {
            props.store.touch(id!)
            props.onSelect(id)
            if (resizePreviewRef.current) resizePreviewRef.current.style.display = 'block'
            dragRef.current = { pointerId: event.pointerId, mode: 'resize', start, latest: start, id, element: null, frame: 0, moved: false, shift: false, ctrl: false, resizeHandle, originalRect: annotation.rect, annotationKind: annotation.kind, stopMeasurement: beginDragFrameMeasurement() }
          } else if (id) {
            if (!props.store.isSelected(id)) props.store.selectOnly(id)
            const ids = props.store.selectedIds().filter(selectedId => !props.store.get(selectedId)?.legacyChange)
            for (const selectedId of ids) props.store.touch(selectedId)
            props.onSelect(id)
            if (annotation && (annotation.legacyChange || isTextMarkup(annotation.kind))) return
            const pageIds = new Set(annotations.map((item) => item.id))
            const elements = ids.filter((selectedId) => pageIds.has(selectedId)).flatMap((selectedId) => {
              const element = svg.querySelector<SVGGElement>(`g[data-annotation-id="${selectedId}"]`)
              return element ? [element] : []
            })
            dragRef.current = { pointerId: event.pointerId, mode: 'move', start, latest: start, id, ids, elements, element: null, frame: 0, moved: false, shift: false, ctrl: false, stopMeasurement: beginDragFrameMeasurement() }
          } else {
            if (draftRectRef.current) draftRectRef.current.style.display = 'block'
            dragRef.current = { pointerId: event.pointerId, mode: 'marquee', start, latest: start, id: null, element: null, frame: 0, moved: false, shift: false, ctrl: false, stopMeasurement: beginDragFrameMeasurement() }
          }
        } else {
          props.onSelect(null)
          if (props.tool === 'textSelect' || props.tool === 'textHighlight' || props.tool === 'underline' || props.tool === 'strikeout') {
            selectionGenerationRef.current += 1
            setTextSelection(null)
            drawTextSelection(null)
            window.dispatchEvent(new CustomEvent(TEXT_SELECTION_START, { detail: layerKey }))
            // Edge と Chrome では pointerdown の detail が常に 0 のため、クリックの回数は自分で数える。
            const now = performance.now()
            const previousClick = clickRef.current
            const clicks = previousClick
              && now - previousClick.at <= MULTI_CLICK_MS
              && Math.abs(event.clientX - previousClick.x) <= MULTI_CLICK_DISTANCE
              && Math.abs(event.clientY - previousClick.y) <= MULTI_CLICK_DISTANCE
              ? previousClick.count + 1 : 1
            clickRef.current = { at: now, x: event.clientX, y: event.clientY, count: clicks }
            const selectionMode: TextSelectionMode = clicks >= 3 ? 'lines' : clicks === 2 ? 'words' : 'chars'
            dragRef.current = { pointerId: event.pointerId, mode: 'text-selection', start, latest: start, id: null, element: null, frame: 0, moved: false, shift: false, ctrl: false, selectionMode, stopMeasurement: beginDragFrameMeasurement('drag') }
            setTextCursor('text')
            void props.pool.pageHasText(props.docId, props.pageIndex).then((hasText) => {
              if (!hasText) props.onStatus('このページには選択できる文字がありません（スキャン画像など）')
            })
            svg.setPointerCapture(event.pointerId)
            return
          }
          const kind = props.tool === 'text' ? 'freetext' : props.tool
          const mode = props.tool === 'text' ? 'text' : props.tool === 'callout' ? 'callout' : props.tool === 'symbol' || props.tool === 'count' ? 'symbol' : props.tool === 'line' || props.tool === 'arrow' ? 'line' : props.tool === 'highlight' || props.tool === 'ink' ? 'ink' : 'shape'
          const shown = kind === 'cloudSquare' ? draftCloudRef.current : mode === 'line' ? draftLineRef.current : mode === 'ink' ? draftInkRef.current : draftRectRef.current
          if (shown) shown.style.display = 'block'
          if (mode === 'callout' && draftLineRef.current) draftLineRef.current.style.display = 'block'
          const startedAt = performance.now()
          dragRef.current = {
            pointerId: event.pointerId,
            mode,
            creationKind: kind === 'count' ? 'symbol' : kind,
            start,
            latest: start,
            id: null,
            element: null,
            frame: 0,
            moved: false,
            shift: event.shiftKey,
            ctrl: event.ctrlKey,
            points: mode === 'ink' ? [start] : undefined,
            mergeId: mode === 'ink' ? mergeInkAnnotationId(previousInkRef.current, props.pageIndex, kind as 'highlight' | 'ink', startedAt) : null,
            stopMeasurement: beginDragFrameMeasurement(mode === 'ink' ? 'ink' : 'drag'),
          }
        }
        svg.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (measurement.pointerMove(event, pointInPage(event.currentTarget, event))) return
        if (TEXT_MARK_TOOLS.has(props.tool)) {
          const point = pointInPage(event.currentTarget, event)
          pointerPointRef.current = point
          ensureTextLines()
          updateTextCursor(point)
        }
        const operation = dragRef.current
        if (!operation || operation.pointerId !== event.pointerId) return
        operation.latest = pointInPage(event.currentTarget, event)
        operation.shift = event.shiftKey
        operation.ctrl = event.ctrlKey
        if (operation.mode === 'ink') operation.points?.push(operation.latest)
        if (Math.abs(operation.latest[0] - operation.start[0]) >= 2 || Math.abs(operation.latest[1] - operation.start[1]) >= 2) operation.moved = true
        scheduleDraft(operation)
      }}
      onPointerUp={(event) => {
        if (measurement.pointerUp(event, pointInPage(event.currentTarget, event))) return
        const operation = dragRef.current
        if (!operation || operation.pointerId !== event.pointerId) return
        operation.latest = pointInPage(event.currentTarget, event)
        operation.shift = event.shiftKey
        operation.ctrl = event.ctrlKey
        if (operation.mode === 'ink') operation.points?.push(operation.latest)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        finishDrag(true)
      }}
      onPointerCancel={() => { if (!measurement.cancel()) finishDrag(false) }}
      onDoubleClick={(event) => {
        if (measurement.doubleClick()) return
        if (props.tool !== 'select') return
        const id = annotationIdFromTarget(event.target) ?? props.selectedId
        const annotation = id ? props.store.touch(id) : undefined
        if (annotation && !annotation.legacyChange && (annotation.kind === 'issue' || annotation.kind === 'freetext' || annotation.kind === 'callout')) { props.onSelect(annotation.id); props.onEdit(annotation.id) }
      }}
    >
      <rect className="annotation-surface" x="0" y="0" width={props.pageSize.width} height={props.pageSize.height} />
      {annotations.map(renderAnnotation)}
      {[...countPaths].map(([key, group]) => <g key={key} data-testid="count-batch" opacity={group.opacity} pointerEvents="none">
        {group.bright && <path d={group.outline.join(' ')} fill="none" stroke="#404040" strokeWidth={1.8} />}
        <path d={group.fills.join(' ')} fill={group.stroke} />
        <path d={group.outline.join(' ') + ' ' + group.strokes.join(' ')} fill="none" stroke={group.stroke} strokeWidth={.8} strokeLinejoin="round" />
        {group.selected && <path d={group.outline.join(' ')} fill="none" stroke="#006cff" strokeWidth={1.2} />}
      </g>)}
      {compactCounts && visibleCount <= 1000 && <g pointerEvents="none">{annotations.filter(a => a.count && !(singleSelection && selectedIds.has(a.id))).map(a => {
        const f = props.store.fixtureForCount(a.count)
        if (!f?.style.showCode || !f.code) return null
        const data = countMarkerData(f.style, (a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2)
        return <text key={a.id} x={data.code.x} y={data.code.y} fontSize={data.code.size} fontFamily="KaruBIZUDGothic" fill={data.bright ? '#404040' : data.color} opacity={data.opacity}>{f.code}</text>
      })}</g>}
      {measurement.draft}
      <path ref={draftCloudRef} style={{ display: 'none' }} pointerEvents="none" />
      <g ref={textSelectionRef} className="text-selection-quads" aria-hidden="true" />
      <rect ref={draftRectRef} className="annotation-draft" x="0" y="0" width="0" height="0" />
      <line ref={draftLineRef} className="annotation-line-draft" x1="0" y1="0" x2="0" y2="0" />
      <polyline ref={draftInkRef} className="annotation-ink-draft" points="" />
      <rect ref={resizePreviewRef} className="annotation-resize-preview" x="0" y="0" width="0" height="0" />
      <line ref={linePreviewRef} className="annotation-line-preview" x1="0" y1="0" x2="0" y2="0" />
      <line ref={calloutPreviewRef} className="annotation-line-preview" x1="0" y1="0" x2="0" y2="0" />
    </svg>
    {measurement.dialog}
    {sampleInteraction?.selection?.docId === props.docId && <FixtureSampleSelection pageSize={props.pageSize} pageIndex={props.pageIndex} complete={sampleInteraction.selection.complete} />}
    {props.tool === 'textSelect' && textSelection && selectionBounds(textSelection.quads) && <div className="text-selection-toolbar" style={{
      left: `${Math.max(0, Math.min(100, (selectionBounds(textSelection.quads)![0] / props.pageSize.width) * 100))}%`,
      top: `${Math.max(0, Math.min(100, (selectionBounds(textSelection.quads)![1] / props.pageSize.height) * 100))}%`,
    }}>
      <button type="button" onClick={copySelectedText}>コピー</button>
      <button type="button" onClick={() => createMarkup('textHighlight')}><ToolIcon tool="textHighlight" />ハイライト</button>
      <button type="button" onClick={() => createMarkup('underline')}><ToolIcon tool="underline" />下線</button>
      <button type="button" onClick={() => createMarkup('strikeout')}><ToolIcon tool="strikeout" />取り消し線</button>
    </div>}
    {editing?.issue && <IssueEditor key={editing.id} annotation={editing} store={props.store} zoom={props.zoom} registerCommit={props.registerCommit} onClose={() => props.onEdit(null)} />}
    {editing && !editing.issue && !editing.legacyChange && <TextEditor annotation={editing} zoom={props.zoom} pool={props.pool} store={props.store} onClose={(removed) => {
      props.onEdit(null)
      props.onSelect(removed ? null : editing.id)
    }} registerCommit={props.registerCommit} />}
  </>
}

function FixtureSampleSelection({ pageSize, pageIndex, complete }: { pageSize: PageSize; pageIndex: number; complete(pageIndex: number, rect: Rect): void }) {
  const drag = useRef<{ pointerId: number; start: Point } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const point = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const p = pointInPage(event.currentTarget, event)
    return [Math.max(0, Math.min(pageSize.width, p[0])), Math.max(0, Math.min(pageSize.height, p[1]))]
  }
  return <svg className="annotation-layer fixture-sample-selection" data-testid={`fixture-sample-selection-${pageIndex}`} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
    onPointerDown={event => {
      event.stopPropagation(); event.preventDefault()
      if (event.button !== 0) return
      const start = point(event)
      drag.current = { pointerId: event.pointerId, start }; setRect(null)
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      event.stopPropagation()
      if (drag.current?.pointerId === event.pointerId) setRect(shapeRect(drag.current.start, point(event), false))
    }}
    onPointerUp={event => {
      event.stopPropagation(); event.preventDefault()
      if (drag.current?.pointerId !== event.pointerId) return
      const selected = shapeRect(drag.current.start, point(event), false)
      drag.current = null; setRect(null)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      complete(pageIndex, selected)
    }}
    onPointerCancel={() => { drag.current = null; setRect(null) }}
    onDoubleClick={event => { event.stopPropagation(); event.preventDefault() }}>
    <rect width={pageSize.width} height={pageSize.height} fill="transparent" />
    {rect && <rect className="fixture-sample-rect" x={rect[0]} y={rect[1]} width={rect[2] - rect[0]} height={rect[3] - rect[1]} />}
  </svg>
}
