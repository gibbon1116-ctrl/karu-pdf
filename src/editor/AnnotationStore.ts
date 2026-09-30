import { nearestCalloutEdgePoint, type AnnotationColor, type AnnotationEdit, type AnnotationInfo, type Point, type Rect, type RGB, type SymbolName } from '../core/annotations'
import type { Quad } from 'mupdf'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import { History, type HistoryStep } from './history'

export type Kind = 'freetext' | 'callout' | 'line' | 'arrow' | 'square' | 'circle' | 'highlight' | 'ink' | 'textHighlight' | 'underline' | 'strikeout' | 'symbol'

export interface EditableAnnotation {
  id: string
  objNum: number | null
  pageIndex: number
  kind: Kind
  rect: Rect
  text: string
  fontSize: number
  font: FontName
  color: RGB
  borderWidth: number
  opacity: number
  textOpacity: number
  boxOpacity: number
  interiorColor: RGB | null
  borderColor: RGB | null
  line: [Point, Point] | null
  inkList: Point[][] | null
  quads: Quad[] | null
  calloutPoint: Point | null
  calloutLine: [Point, Point] | null
  symbol: SymbolName | null
  layout: LayoutResult | null
  dirty: boolean
  madeByKaru: boolean
}

interface AnnotationState extends Omit<EditableAnnotation, 'dirty'> {}
interface StoredAnnotation extends AnnotationState {
  deleted: boolean
  revision: number
}

interface SaveResult {
  created: number[]
  errors?: Array<{ editIndex: number }>
}

interface PendingEdit {
  id: string
  annotation: StoredAnnotation
  revision: number
  state: AnnotationState | null
  edit: AnnotationEdit
}

const DEFAULT_COLOR: RGB = [1, 0, 0]
const DEFAULT_FONT_SIZE = 10.5
const DEFAULT_BORDER_WIDTH = 1

function clonePoints(points: readonly Point[]): Point[] {
  return points.map((point) => [point[0], point[1]])
}

function cloneState(annotation: AnnotationState): AnnotationState {
  return {
    ...annotation,
    rect: [...annotation.rect],
    color: [...annotation.color],
    interiorColor: annotation.interiorColor ? [...annotation.interiorColor] : null,
    borderColor: annotation.borderColor ? [...annotation.borderColor] : null,
    line: annotation.line ? [
      [...annotation.line[0]],
      [...annotation.line[1]],
    ] : null,
    inkList: annotation.inkList?.map(clonePoints) ?? null,
    quads: annotation.quads?.map((quad) => [...quad] as Quad) ?? null,
    calloutPoint: annotation.calloutPoint ? [...annotation.calloutPoint] : null,
    calloutLine: annotation.calloutLine ? [
      [...annotation.calloutLine[0]],
      [...annotation.calloutLine[1]],
    ] : null,
    symbol: annotation.symbol,
    layout: annotation.layout ? {
      ...annotation.layout,
      lines: annotation.layout.lines.map((line) => ({ ...line })),
    } : null,
  }
}

function publicAnnotation(annotation: StoredAnnotation, dirty: boolean): EditableAnnotation {
  return { ...cloneState(annotation), dirty }
}

function persistedState(state: AnnotationState): unknown {
  return {
    pageIndex: state.pageIndex,
    kind: state.kind,
    rect: state.rect,
    text: state.text,
    fontSize: state.fontSize,
    font: state.font,
    color: state.color,
    borderWidth: state.borderWidth,
    opacity: state.opacity,
    textOpacity: state.textOpacity,
    boxOpacity: state.boxOpacity,
    interiorColor: state.interiorColor,
    borderColor: state.borderColor,
    line: state.line,
    inkList: state.inkList,
    quads: state.quads,
    calloutPoint: state.calloutPoint,
    calloutLine: state.calloutLine,
    symbol: state.symbol,
  }
}

function samePersisted(left: AnnotationState, right: AnnotationState): boolean {
  return JSON.stringify(persistedState(left)) === JSON.stringify(persistedState(right))
}

function bounds(points: readonly Point[]): Rect {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function annotationBounds(annotation: Pick<AnnotationState, 'rect' | 'line' | 'inkList' | 'calloutPoint'>): Rect {
  const points: Point[] = [
    [annotation.rect[0], annotation.rect[1]],
    [annotation.rect[2], annotation.rect[3]],
    ...(annotation.line?.flatMap((point) => [[point[0], point[1]] as Point]) ?? []),
    ...(annotation.inkList?.flatMap((stroke) => stroke.map((point) => [point[0], point[1]] as Point)) ?? []),
    ...(annotation.calloutPoint ? [[annotation.calloutPoint[0], annotation.calloutPoint[1]] as Point] : []),
  ]
  return bounds(points)
}

export function annotationInsideSelection(annotation: EditableAnnotation, selection: Rect): boolean {
  const area = annotationBounds(annotation)
  return area[0] >= selection[0] && area[1] >= selection[1]
    && area[2] <= selection[2] && area[3] <= selection[3]
}

export function isTextMarkup(kind: Kind): boolean {
  return kind === 'textHighlight' || kind === 'underline' || kind === 'strikeout'
}

export function translationToFit(rect: Rect, pageSize: { width: number; height: number }, offset: number): Point {
  let dx = offset
  let dy = offset
  const width = rect[2] - rect[0]
  const height = rect[3] - rect[1]
  if (width >= pageSize.width) dx = -rect[0]
  else if (rect[0] + dx < 0) dx = -rect[0]
  else if (rect[2] + dx > pageSize.width) dx = pageSize.width - rect[2]
  if (height >= pageSize.height) dy = -rect[1]
  else if (rect[1] + dy < 0) dy = -rect[1]
  else if (rect[3] + dy > pageSize.height) dy = pageSize.height - rect[3]
  return [dx, dy]
}

function mapPoint(point: Point, from: Rect, to: Rect): Point {
  const width = from[2] - from[0]
  const height = from[3] - from[1]
  return [
    width === 0 ? to[0] : to[0] + (point[0] - from[0]) * (to[2] - to[0]) / width,
    height === 0 ? to[1] : to[1] + (point[1] - from[1]) * (to[3] - to[1]) / height,
  ]
}

export class AnnotationStore {
  private readonly annotations = new Map<string, StoredAnnotation>()
  private readonly baselines = new Map<string, AnnotationState>()
  private readonly touchedByPage = new Map<number, Set<number>>()
  private readonly loadedPages = new Set<number>()
  private readonly loadingPages = new Map<number, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private readonly history = new History<AnnotationState[]>(100)
  private readonly pendingCreations = new Set<string>()
  private readonly selection = new Set<string>()
  private pendingEdits: PendingEdit[] = []
  private nextNewId = 1
  private version = 0
  private generation = 0
  private lastNudge: { key: string; step: HistoryStep<AnnotationState[]>; at: number } | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version
  canUndo = (): boolean => this.history.canUndo
  canRedo = (): boolean => this.history.canRedo

  reset(): void {
    this.annotations.clear()
    this.baselines.clear()
    this.touchedByPage.clear()
    this.loadedPages.clear()
    this.loadingPages.clear()
    this.pendingCreations.clear()
    this.selection.clear()
    this.pendingEdits = []
    this.history.clear()
    this.nextNewId = 1
    this.generation += 1
    this.notify()
  }

  async ensurePageLoaded(pageIndex: number, load: () => Promise<AnnotationInfo[]>): Promise<void> {
    if (this.loadedPages.has(pageIndex)) return
    const pending = this.loadingPages.get(pageIndex)
    if (pending) return pending
    const generation = this.generation
    const request = load().then((annotations) => {
      if (generation !== this.generation) return
      for (const info of annotations) {
        if (!info.editable || info.kind === 'other') continue
        const id = `obj-${info.objNum}`
        if (this.annotations.has(id)) continue
        const kind = info.kind as Kind
        const annotation: StoredAnnotation = {
          id,
          objNum: info.objNum,
          pageIndex,
          kind,
          rect: [...info.rect],
          text: isTextMarkup(kind) ? info.markedText ?? '' : info.contents,
          fontSize: info.fontSize ?? DEFAULT_FONT_SIZE,
          font: info.fontName === 'BIZUDMincho' ? 'BIZUDMincho' : 'BIZUDGothic',
          color: [...((kind === 'freetext' || kind === 'callout' ? info.textColor : info.strokeColor) ?? DEFAULT_COLOR)],
          borderWidth: info.borderWidth ?? DEFAULT_BORDER_WIDTH,
          opacity: info.opacity ?? 1,
          textOpacity: info.textOpacity ?? 1,
          boxOpacity: info.boxOpacity ?? 1,
          interiorColor: info.interiorColor ? [...info.interiorColor] : null,
          borderColor: info.strokeColor ? [...info.strokeColor] : null,
          line: info.line ? [[...info.line[0]], [...info.line[1]]] : null,
          inkList: info.inkList?.map(clonePoints) ?? null,
          quads: info.quads?.map((quad) => [...quad] as Quad) ?? null,
          calloutPoint: info.calloutPoint ? [...info.calloutPoint] : null,
          calloutLine: info.calloutLine ? [[...info.calloutLine[0]], [...info.calloutLine[1]]] : null,
          symbol: info.symbol,
          layout: null,
          madeByKaru: info.madeByKaru,
          deleted: false,
          revision: 0,
        }
        this.annotations.set(id, annotation)
        this.baselines.set(id, cloneState(annotation))
      }
      this.loadedPages.add(pageIndex)
      this.notify()
    }).finally(() => {
      if (generation === this.generation) this.loadingPages.delete(pageIndex)
    })
    this.loadingPages.set(pageIndex, request)
    return request
  }

  getPageAnnotations(pageIndex: number): EditableAnnotation[] {
    return [...this.annotations.values()]
      .filter((annotation) => annotation.pageIndex === pageIndex && !annotation.deleted)
      .map((annotation) => publicAnnotation(annotation, this.isAnnotationDirty(annotation)))
  }

  get(id: string): EditableAnnotation | undefined {
    const annotation = this.annotations.get(id)
    return annotation && !annotation.deleted
      ? publicAnnotation(annotation, this.isAnnotationDirty(annotation))
      : undefined
  }

  selectedIds(): string[] {
    return [...this.selection].filter((id) => this.annotations.get(id)?.deleted === false)
  }

  primarySelection(): string | null {
    return this.selectedIds().at(-1) ?? null
  }

  isSelected(id: string): boolean {
    return this.selection.has(id) && this.annotations.get(id)?.deleted === false
  }

  selectOnly(id: string | null): void {
    const next = id && this.annotations.get(id)?.deleted === false ? [id] : []
    if (this.selectedIds().length === next.length && next.every((value) => this.selection.has(value))) return
    this.selection.clear()
    for (const value of next) this.selection.add(value)
    this.notify()
  }

  toggleSelection(id: string): void {
    if (this.annotations.get(id)?.deleted !== false) return
    if (this.selection.has(id)) this.selection.delete(id)
    else this.selection.add(id)
    this.notify()
  }

  clearSelection(): void {
    if (this.selection.size === 0) return
    this.selection.clear()
    this.notify()
  }

  selectInRect(pageIndex: number, rect: Rect): string[] {
    const normalized: Rect = [
      Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]),
      Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3]),
    ]
    this.selection.clear()
    for (const annotation of this.getPageAnnotations(pageIndex)) {
      if (annotationInsideSelection(annotation, normalized)) this.selection.add(annotation.id)
    }
    this.notify()
    return this.selectedIds()
  }

  copySelected(): EditableAnnotation[] {
    return this.selectedIds().flatMap((id) => {
      const annotation = this.annotations.get(id)
      return annotation && !annotation.deleted && !isTextMarkup(annotation.kind) ? [publicAnnotation(annotation, this.isAnnotationDirty(annotation))] : []
    })
  }

  create(input: {
    pageIndex: number
    kind: Kind
    rect: Rect
    text?: string
    fontSize?: number
    font?: FontName
    color?: RGB
    borderWidth?: number
    opacity?: number
    textOpacity?: number
    boxOpacity?: number
    interiorColor?: RGB | null
    borderColor?: RGB | null
    line?: [Point, Point] | null
    inkList?: Point[][] | null
    quads?: Quad[] | null
    calloutPoint?: Point | null
    symbol?: SymbolName | null
    layout?: LayoutResult | null
    deferHistory?: boolean
  }): EditableAnnotation {
    const id = `new-${this.nextNewId++}`
    const annotation: StoredAnnotation = {
      id,
      objNum: null,
      pageIndex: input.pageIndex,
      kind: input.kind,
      rect: [...input.rect],
      text: input.text ?? '',
      fontSize: input.fontSize ?? DEFAULT_FONT_SIZE,
      font: input.font ?? 'BIZUDGothic',
      color: [...(input.color ?? DEFAULT_COLOR)],
      borderWidth: input.borderWidth ?? DEFAULT_BORDER_WIDTH,
      opacity: input.opacity ?? 1,
      textOpacity: input.textOpacity ?? 1,
      boxOpacity: input.boxOpacity ?? 1,
      interiorColor: input.interiorColor ? [...input.interiorColor] : null,
      borderColor: input.borderColor === undefined
        ? (input.kind === 'square' || input.kind === 'circle' ? [...(input.color ?? DEFAULT_COLOR)] : null)
        : input.borderColor ? [...input.borderColor] : null,
      line: input.line ? [[...input.line[0]], [...input.line[1]]] : null,
      inkList: input.inkList?.map(clonePoints) ?? null,
      quads: input.quads?.map((quad) => [...quad] as Quad) ?? null,
      calloutPoint: input.calloutPoint ? [...input.calloutPoint] : null,
      calloutLine: input.calloutPoint ? [[...input.calloutPoint], nearestCalloutEdgePoint(input.rect, input.calloutPoint)] : null,
      symbol: input.symbol ?? null,
      layout: input.layout ?? null,
      madeByKaru: input.kind === 'freetext' || input.kind === 'callout' || input.kind === 'symbol',
      deleted: false,
      revision: 1,
    }
    this.annotations.set(id, annotation)
    if (input.deferHistory) this.pendingCreations.add(id)
    else this.history.push({ before: [], after: [cloneState(annotation)] })
    this.notify()
    return this.get(id)!
  }

  touch(id: string): EditableAnnotation | undefined {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return undefined
    if (annotation.objNum !== null) {
      const touched = this.touchedByPage.get(annotation.pageIndex) ?? new Set<number>()
      if (!touched.has(annotation.objNum)) {
        touched.add(annotation.objNum)
        this.touchedByPage.set(annotation.pageIndex, touched)
        this.notify()
      }
    }
    return this.get(id)
  }

  move(id: string, dx: number, dy: number): void {
    this.mutate(id, (annotation) => {
      if (dx === 0 && dy === 0) return
      annotation.rect = [annotation.rect[0] + dx, annotation.rect[1] + dy, annotation.rect[2] + dx, annotation.rect[3] + dy]
      if (annotation.line) annotation.line = annotation.line.map((point) => [point[0] + dx, point[1] + dy]) as [Point, Point]
      if (annotation.inkList) annotation.inkList = annotation.inkList.map((stroke) => stroke.map((point) => [point[0] + dx, point[1] + dy]))
      if (annotation.kind === 'callout' && annotation.calloutPoint) {
        annotation.calloutPoint = [annotation.calloutPoint[0] + dx, annotation.calloutPoint[1] + dy]
        annotation.calloutLine = [[...annotation.calloutPoint], nearestCalloutEdgePoint(annotation.rect, annotation.calloutPoint)]
      }
    })
  }

  moveMany(ids: readonly string[], dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return
    this.mutateMany(ids, (annotation) => {
      annotation.rect = [annotation.rect[0] + dx, annotation.rect[1] + dy, annotation.rect[2] + dx, annotation.rect[3] + dy]
      if (annotation.line) annotation.line = annotation.line.map((point) => [point[0] + dx, point[1] + dy]) as [Point, Point]
      if (annotation.inkList) annotation.inkList = annotation.inkList.map((stroke) => stroke.map((point) => [point[0] + dx, point[1] + dy]))
      if (annotation.kind === 'callout' && annotation.calloutPoint) {
        annotation.calloutPoint = [annotation.calloutPoint[0] + dx, annotation.calloutPoint[1] + dy]
        annotation.calloutLine = [[...annotation.calloutPoint], nearestCalloutEdgePoint(annotation.rect, annotation.calloutPoint)]
      }
    })
  }

  nudgeMany(ids: readonly string[], dx: number, dy: number, groupKey: string, now = performance.now()): void {
    if (dx === 0 && dy === 0) return
    const movableIds = [...new Set(ids)].filter((id) => {
      const annotation = this.annotations.get(id)
      return annotation && !annotation.deleted && !isTextMarkup(annotation.kind)
    })
    const before = movableIds.flatMap((id) => {
      const annotation = this.annotations.get(id)
      return annotation ? [cloneState(annotation)] : []
    })
    if (before.length === 0) return
    for (const id of movableIds) {
      const annotation = this.annotations.get(id)!
      annotation.rect = [annotation.rect[0] + dx, annotation.rect[1] + dy, annotation.rect[2] + dx, annotation.rect[3] + dy]
      if (annotation.line) annotation.line = annotation.line.map((point) => [point[0] + dx, point[1] + dy]) as [Point, Point]
      if (annotation.inkList) annotation.inkList = annotation.inkList.map((stroke) => stroke.map((point) => [point[0] + dx, point[1] + dy]))
      if (annotation.kind === 'callout' && annotation.calloutPoint) {
        annotation.calloutPoint = [annotation.calloutPoint[0] + dx, annotation.calloutPoint[1] + dy]
        annotation.calloutLine = [[...annotation.calloutPoint], nearestCalloutEdgePoint(annotation.rect, annotation.calloutPoint)]
      }
      this.markTouched(annotation)
      annotation.revision += 1
    }
    const after = movableIds.map((id) => cloneState(this.annotations.get(id)!))
    const previous = this.lastNudge
    if (previous && previous.key === groupKey && now - previous.at <= 700) {
      const replacement = { before: previous.step.before, after }
      if (this.history.replaceLast(previous.step, replacement)) {
        this.lastNudge = { key: groupKey, step: replacement, at: now }
      } else {
        const step = { before, after }
        this.history.push(step)
        this.lastNudge = { key: groupKey, step, at: now }
      }
    } else {
      const step = { before, after }
      this.history.push(step)
      this.lastNudge = { key: groupKey, step, at: now }
    }
    this.notify()
  }

  resize(id: string, rect: Rect): void {
    this.mutate(id, (annotation) => {
      const previous = annotation.rect
      if (annotation.line) annotation.line = annotation.line.map((point) => mapPoint(point, previous, rect)) as [Point, Point]
      if (annotation.inkList) annotation.inkList = annotation.inkList.map((stroke) => stroke.map((point) => mapPoint(point, previous, rect)))
      annotation.rect = [...rect]
      if (annotation.kind === 'callout' && annotation.calloutPoint) {
        annotation.calloutLine = [[...annotation.calloutPoint], nearestCalloutEdgePoint(rect, annotation.calloutPoint)]
      }
    })
  }

  updateLine(id: string, line: [Point, Point]): void {
    this.mutate(id, (annotation) => {
      annotation.line = [[...line[0]], [...line[1]]]
      annotation.rect = bounds(line)
    })
  }

  appendInkStroke(id: string, stroke: Point[]): void {
    this.mutate(id, (annotation) => {
      annotation.inkList = [...(annotation.inkList ?? []), clonePoints(stroke)]
      annotation.rect = bounds(annotation.inkList.flat())
    })
  }

  updateCalloutPoint(id: string, point: Point): void {
    this.mutate(id, (annotation) => {
      if (annotation.kind !== 'callout') return
      annotation.calloutPoint = [...point]
      annotation.calloutLine = [[...point], nearestCalloutEdgePoint(annotation.rect, point)]
    })
  }

  updateText(id: string, text: string, layout: LayoutResult, rect?: Rect): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || (annotation.kind !== 'freetext' && annotation.kind !== 'callout')) return
    const pendingCreation = this.pendingCreations.delete(id)
    const before = pendingCreation ? [] : [cloneState(annotation)]
    this.markTouched(annotation)
    annotation.text = text
    annotation.layout = layout
    annotation.rect = rect ? [...rect] : [annotation.rect[0], annotation.rect[1], annotation.rect[2], annotation.rect[1] + layout.height]
    annotation.madeByKaru = true
    annotation.revision += 1
    this.history.push({ before, after: [cloneState(annotation)] })
    this.notify()
  }

  setLayout(id: string, layout: LayoutResult): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || (annotation.kind !== 'freetext' && annotation.kind !== 'callout')) return
    annotation.layout = layout
    this.notify()
  }

  update(id: string, values: {
    color?: RGB
    borderWidth?: number
    fontSize?: number
    font?: FontName
    layout?: LayoutResult
    rect?: Rect
    interiorColor?: RGB | null
    borderColor?: RGB | null
    opacity?: number
    textOpacity?: number
    boxOpacity?: number
    symbol?: SymbolName
  }): void {
    this.mutate(id, (annotation) => {
      if (values.color) annotation.color = [...values.color]
      if (values.borderWidth !== undefined) annotation.borderWidth = values.borderWidth
      if (values.interiorColor !== undefined) annotation.interiorColor = values.interiorColor ? [...values.interiorColor] : null
      if (values.borderColor !== undefined) annotation.borderColor = values.borderColor ? [...values.borderColor] : null
      if (values.opacity !== undefined) annotation.opacity = values.opacity
      if (values.textOpacity !== undefined) annotation.textOpacity = values.textOpacity
      if (values.boxOpacity !== undefined) annotation.boxOpacity = values.boxOpacity
      if (values.symbol !== undefined && annotation.kind === 'symbol') annotation.symbol = values.symbol
      if (values.fontSize !== undefined && (annotation.kind === 'freetext' || annotation.kind === 'callout')) annotation.fontSize = values.fontSize
      if (values.font !== undefined && (annotation.kind === 'freetext' || annotation.kind === 'callout')) annotation.font = values.font
      if (values.layout && (annotation.kind === 'freetext' || annotation.kind === 'callout')) annotation.layout = values.layout
      if (values.rect) annotation.rect = [...values.rect]
      if (annotation.kind === 'callout' && annotation.calloutPoint) {
        annotation.calloutLine = [[...annotation.calloutPoint], nearestCalloutEdgePoint(annotation.rect, annotation.calloutPoint)]
      }
    })
  }

  remove(id: string): void {
    const selected = this.selectedIds()
    if (selected.length > 1 && this.selection.has(id)) {
      this.removeMany(selected)
      return
    }
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return
    if (this.pendingCreations.delete(id)) {
      this.annotations.delete(id)
      this.selection.delete(id)
      this.notify()
      return
    }
    const before = cloneState(annotation)
    this.markTouched(annotation)
    annotation.deleted = true
    annotation.revision += 1
    this.selection.delete(id)
    this.history.push({ before: [before], after: [] })
    this.notify()
  }

  removeMany(ids: readonly string[]): void {
    const before: AnnotationState[] = []
    for (const id of [...new Set(ids)]) {
      const annotation = this.annotations.get(id)
      if (!annotation || annotation.deleted) continue
      before.push(cloneState(annotation))
      this.pendingCreations.delete(id)
      this.markTouched(annotation)
      annotation.deleted = true
      annotation.revision += 1
      this.selection.delete(id)
    }
    if (before.length === 0) return
    this.history.push({ before, after: [] })
    this.notify()
  }

  pasteAnnotations(
    source: readonly EditableAnnotation[],
    pageIndex: number,
    pageSize: { width: number; height: number },
    offset: number,
  ): string[] {
    if (source.length === 0) return []
    const sourceBounds = source.map(annotationBounds)
    const groupBounds: Rect = [
      Math.min(...sourceBounds.map((rect) => rect[0])),
      Math.min(...sourceBounds.map((rect) => rect[1])),
      Math.max(...sourceBounds.map((rect) => rect[2])),
      Math.max(...sourceBounds.map((rect) => rect[3])),
    ]
    const [dx, dy] = translationToFit(groupBounds, pageSize, offset)
    const created: AnnotationState[] = []
    for (const item of source) {
      const annotation = this.create({
        pageIndex,
        kind: item.kind,
        rect: [item.rect[0] + dx, item.rect[1] + dy, item.rect[2] + dx, item.rect[3] + dy],
        text: item.text,
        fontSize: item.fontSize,
        font: item.font,
        color: item.color,
        borderWidth: item.borderWidth,
        opacity: item.opacity,
        textOpacity: item.textOpacity,
        boxOpacity: item.boxOpacity,
        interiorColor: item.interiorColor,
        borderColor: item.borderColor,
        line: item.line ? item.line.map((point) => [point[0] + dx, point[1] + dy]) as [Point, Point] : null,
        inkList: item.inkList?.map((stroke) => stroke.map((point) => [point[0] + dx, point[1] + dy])) ?? null,
        quads: null,
        calloutPoint: item.calloutPoint ? [item.calloutPoint[0] + dx, item.calloutPoint[1] + dy] : null,
        symbol: item.symbol,
        layout: item.layout,
        deferHistory: true,
      })
      this.pendingCreations.delete(annotation.id)
      const stored = this.annotations.get(annotation.id)
      if (stored) created.push(cloneState(stored))
    }
    if (created.length === 0) return []
    this.history.push({ before: [], after: created })
    this.selection.clear()
    for (const annotation of created) this.selection.add(annotation.id)
    this.notify()
    return created.map((annotation) => annotation.id)
  }

  undo(): void {
    const step = this.history.undo()
    if (!step) return
    this.restoreMany(step.before, step.after)
    this.notify()
  }

  redo(): void {
    const step = this.history.redo()
    if (!step) return
    this.restoreMany(step.after, step.before)
    this.notify()
  }

  touchedObjNums(pageIndex: number): number[] {
    return [...(this.touchedByPage.get(pageIndex) ?? [])].sort((a, b) => a - b)
  }

  toEdits(): AnnotationEdit[] {
    const entries = this.editEntries()
    this.pendingEdits = entries.map(({ annotation, edit }) => ({
      id: annotation.id,
      annotation,
      revision: annotation.revision,
      state: annotation.deleted ? null : cloneState(annotation),
      edit,
    }))
    return entries.map(({ edit }) => edit)
  }

  markApplied(result: SaveResult): void {
    const pending = this.pendingEdits
    this.pendingEdits = []
    const failed = new Set(result.errors?.map((error) => error.editIndex) ?? [])
    let createdIndex = 0
    pending.forEach((item, editIndex) => {
      if (failed.has(editIndex)) return
      if (item.edit.kind.startsWith('create')) {
        const objNum = result.created[createdIndex++]
        if (objNum === undefined || !item.state) return
        const oldId = item.id
        const newId = `obj-${objNum}`
        const saved = { ...cloneState(item.state), id: newId, objNum }
        this.renameAnnotation(oldId, newId, objNum)
        this.baselines.set(newId, saved)
        return
      }
      if (item.edit.kind === 'delete') {
        const objNum = item.edit.objNum
        this.baselines.delete(item.id)
        item.annotation.objNum = null
        this.clearSavedObjectFromHistory(item.id, objNum)
        return
      }
      if (item.state) this.baselines.set(item.id, cloneState(item.state))
    })
    this.notify()
  }

  isDirty(): boolean {
    return this.editEntries().length > 0
  }

  private mutate(id: string, change: (annotation: StoredAnnotation) => void): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return
    const before = cloneState(annotation)
    change(annotation)
    const after = cloneState(annotation)
    if (samePersisted(before, after)) return
    this.markTouched(annotation)
    annotation.revision += 1
    this.history.push({ before: [before], after: [after] })
    this.notify()
  }

  private mutateMany(ids: readonly string[], change: (annotation: StoredAnnotation) => void): void {
    const before: AnnotationState[] = []
    const after: AnnotationState[] = []
    for (const id of [...new Set(ids)]) {
      const annotation = this.annotations.get(id)
      if (!annotation || annotation.deleted) continue
      const previous = cloneState(annotation)
      change(annotation)
      const next = cloneState(annotation)
      if (samePersisted(previous, next)) continue
      this.markTouched(annotation)
      annotation.revision += 1
      before.push(previous)
      after.push(next)
    }
    if (before.length === 0) return
    this.history.push({ before, after })
    this.notify()
  }

  private restoreMany(target: AnnotationState[], counterpart: AnnotationState[]): void {
    const targetById = new Map(target.map((state) => [state.id, state]))
    const ids = new Set([...target.map((state) => state.id), ...counterpart.map((state) => state.id)])
    for (const id of ids) {
      const state = targetById.get(id)
      const existing = this.annotations.get(id)
      if (!state) {
        if (!existing) continue
        this.markTouched(existing)
        existing.deleted = true
        existing.revision += 1
        this.selection.delete(id)
        continue
      }
      const restored: StoredAnnotation = {
        ...cloneState(state),
        deleted: false,
        revision: (existing?.revision ?? 0) + 1,
      }
      this.annotations.set(id, restored)
      this.markTouched(restored)
    }
  }

  private isAnnotationDirty(annotation: StoredAnnotation): boolean {
    const baseline = this.baselines.get(annotation.id)
    if (annotation.deleted) return baseline !== undefined
    return !baseline || !samePersisted(annotation, baseline)
  }

  private editEntries(): Array<{ annotation: StoredAnnotation; edit: AnnotationEdit }> {
    const entries: Array<{ annotation: StoredAnnotation; edit: AnnotationEdit }> = []
    for (const annotation of this.annotations.values()) {
      const baseline = this.baselines.get(annotation.id)
      if (annotation.deleted) {
        if (baseline?.objNum !== null && baseline?.objNum !== undefined) {
          entries.push({ annotation, edit: { kind: 'delete', objNum: baseline.objNum, pageIndex: baseline.pageIndex } })
        }
        continue
      }
      if (baseline && samePersisted(annotation, baseline)) continue
      entries.push({ annotation, edit: this.toEdit(annotation, baseline?.objNum ?? null) })
    }
    return entries
  }

  private toEdit(annotation: StoredAnnotation, savedObjNum: number | null): AnnotationEdit {
    const create = savedObjNum === null
    if (annotation.kind === 'freetext' || annotation.kind === 'callout') {
      const common = {
        pageIndex: annotation.pageIndex,
        rect: annotation.rect,
        text: annotation.text,
        fontSize: annotation.fontSize,
        color: annotation.color,
        font: annotation.font,
        backgroundColor: annotation.interiorColor,
        borderColor: annotation.borderColor,
        borderWidth: annotation.borderWidth,
        textOpacity: annotation.textOpacity,
        boxOpacity: annotation.boxOpacity,
      }
      if (annotation.kind === 'callout') {
        const callout = { ...common, point: annotation.calloutPoint ?? [annotation.rect[0] - 40, annotation.rect[1] + 40] as Point }
        return create ? { kind: 'createCallout', ...callout } : { kind: 'updateCallout', objNum: savedObjNum, ...callout }
      }
      return create ? { kind: 'createFreeText', ...common } : { kind: 'updateFreeText', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'line' || annotation.kind === 'arrow') {
      const common = {
        pageIndex: annotation.pageIndex,
        line: annotation.line!,
        color: annotation.color,
        borderWidth: annotation.borderWidth,
        opacity: annotation.opacity,
        lineEnding: { start: 'None' as const, end: annotation.kind === 'arrow' ? 'OpenArrow' as const : 'None' as const },
      }
      return create ? { kind: 'createLine', ...common } : { kind: 'updateLine', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'circle') {
      const color: AnnotationColor = annotation.borderColor ?? []
      const common = { pageIndex: annotation.pageIndex, rect: annotation.rect, color, borderWidth: annotation.borderColor ? annotation.borderWidth : 0, interiorColor: annotation.interiorColor, opacity: annotation.opacity }
      return create ? { kind: 'createCircle', ...common } : { kind: 'updateCircle', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'highlight' || annotation.kind === 'ink') {
      const common = { pageIndex: annotation.pageIndex, inkList: annotation.inkList!, color: annotation.color, borderWidth: annotation.borderWidth, opacity: annotation.opacity, inkKind: annotation.kind }
      return create ? { kind: 'createInk', ...common } : { kind: 'updateInk', objNum: savedObjNum, ...common }
    }
    if (isTextMarkup(annotation.kind)) {
      const markup = annotation.kind === 'textHighlight' ? 'Highlight' as const
        : annotation.kind === 'underline' ? 'Underline' as const : 'StrikeOut' as const
      const common = {
        pageIndex: annotation.pageIndex,
        markup,
        quads: annotation.quads ?? [],
        color: annotation.color,
        opacity: annotation.opacity,
        markedText: annotation.text,
      }
      return create ? { kind: 'createTextMarkup', ...common } : { kind: 'updateTextMarkup', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'symbol') {
      const common = {
        pageIndex: annotation.pageIndex,
        rect: annotation.rect,
        color: annotation.color,
        symbol: annotation.symbol ?? 'check' as const,
        opacity: annotation.opacity,
      }
      return create ? { kind: 'createSymbol', ...common } : { kind: 'updateSymbol', objNum: savedObjNum, ...common }
    }
    const color: AnnotationColor = annotation.borderColor ?? []
    const common = { pageIndex: annotation.pageIndex, rect: annotation.rect, color, borderWidth: annotation.borderColor ? annotation.borderWidth : 0, interiorColor: annotation.interiorColor, opacity: annotation.opacity }
    return create ? { kind: 'createSquare', ...common } : { kind: 'updateSquare', objNum: savedObjNum, ...common }
  }

  private renameAnnotation(oldId: string, newId: string, objNum: number): void {
    const annotation = this.annotations.get(oldId)
    if (!annotation) return
    this.annotations.delete(oldId)
    annotation.id = newId
    annotation.objNum = objNum
    this.annotations.set(newId, annotation)
    if (this.selection.delete(oldId)) this.selection.add(newId)
    this.pendingCreations.delete(oldId)
    this.history.map((step) => this.mapHistoryStep(step, (state) => state.id === oldId ? { ...state, id: newId, objNum } : state))
    this.markTouched(annotation)
  }

  private clearSavedObjectFromHistory(id: string, objNum: number): void {
    this.history.map((step) => this.mapHistoryStep(step, (state) => state.id === id && state.objNum === objNum ? { ...state, objNum: null } : state))
  }

  private mapHistoryStep(
    step: HistoryStep<AnnotationState[]>,
    mapper: (state: AnnotationState) => AnnotationState,
  ): HistoryStep<AnnotationState[]> {
    return { before: step.before.map(mapper), after: step.after.map(mapper) }
  }

  private markTouched(annotation: AnnotationState): void {
    if (annotation.objNum === null) return
    const touched = this.touchedByPage.get(annotation.pageIndex) ?? new Set<number>()
    touched.add(annotation.objNum)
    this.touchedByPage.set(annotation.pageIndex, touched)
  }

  private notify(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}
