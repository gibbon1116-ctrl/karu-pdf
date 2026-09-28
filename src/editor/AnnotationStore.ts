import type { AnnotationColor, AnnotationEdit, AnnotationInfo, Point, Rect, RGB } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import { History, type HistoryStep } from './history'

export type Kind = 'freetext' | 'line' | 'arrow' | 'square' | 'circle' | 'highlight' | 'ink' | 'whiteout'

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
  interiorColor: RGB | null
  line: [Point, Point] | null
  inkList: Point[][] | null
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
    line: annotation.line ? [
      [...annotation.line[0]],
      [...annotation.line[1]],
    ] : null,
    inkList: annotation.inkList?.map(clonePoints) ?? null,
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
    interiorColor: state.interiorColor,
    line: state.line,
    inkList: state.inkList,
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
  private readonly history = new History<AnnotationState | null>(100)
  private readonly pendingCreations = new Set<string>()
  private pendingEdits: PendingEdit[] = []
  private nextNewId = 1
  private version = 0
  private generation = 0

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
          text: info.contents,
          fontSize: info.fontSize ?? DEFAULT_FONT_SIZE,
          font: info.fontName === 'BIZUDMincho' ? 'BIZUDMincho' : 'BIZUDGothic',
          color: [...((kind === 'freetext' ? info.textColor : info.strokeColor) ?? DEFAULT_COLOR)],
          borderWidth: info.borderWidth ?? DEFAULT_BORDER_WIDTH,
          opacity: info.opacity ?? 1,
          interiorColor: info.interiorColor ? [...info.interiorColor] : null,
          line: info.line ? [[...info.line[0]], [...info.line[1]]] : null,
          inkList: info.inkList?.map(clonePoints) ?? null,
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
    interiorColor?: RGB | null
    line?: [Point, Point] | null
    inkList?: Point[][] | null
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
      interiorColor: input.interiorColor ? [...input.interiorColor] : null,
      line: input.line ? [[...input.line[0]], [...input.line[1]]] : null,
      inkList: input.inkList?.map(clonePoints) ?? null,
      layout: input.layout ?? null,
      madeByKaru: input.kind === 'freetext',
      deleted: false,
      revision: 1,
    }
    this.annotations.set(id, annotation)
    if (input.deferHistory) this.pendingCreations.add(id)
    else this.history.push({ before: null, after: cloneState(annotation) })
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
    })
  }

  resize(id: string, rect: Rect): void {
    this.mutate(id, (annotation) => {
      const previous = annotation.rect
      if (annotation.line) annotation.line = annotation.line.map((point) => mapPoint(point, previous, rect)) as [Point, Point]
      if (annotation.inkList) annotation.inkList = annotation.inkList.map((stroke) => stroke.map((point) => mapPoint(point, previous, rect)))
      annotation.rect = [...rect]
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

  updateText(id: string, text: string, layout: LayoutResult, rect?: Rect): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || annotation.kind !== 'freetext') return
    const pendingCreation = this.pendingCreations.delete(id)
    const before = pendingCreation ? null : cloneState(annotation)
    this.markTouched(annotation)
    annotation.text = text
    annotation.layout = layout
    annotation.rect = rect ? [...rect] : [annotation.rect[0], annotation.rect[1], annotation.rect[2], annotation.rect[1] + layout.height]
    annotation.madeByKaru = true
    annotation.revision += 1
    this.history.push({ before, after: cloneState(annotation) })
    this.notify()
  }

  setLayout(id: string, layout: LayoutResult): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || annotation.kind !== 'freetext') return
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
  }): void {
    this.mutate(id, (annotation) => {
      if (values.color) annotation.color = [...values.color]
      if (values.borderWidth !== undefined) annotation.borderWidth = values.borderWidth
      if (values.fontSize !== undefined && annotation.kind === 'freetext') annotation.fontSize = values.fontSize
      if (values.font !== undefined && annotation.kind === 'freetext') annotation.font = values.font
      if (values.layout && annotation.kind === 'freetext') annotation.layout = values.layout
      if (values.rect) annotation.rect = [...values.rect]
    })
  }

  remove(id: string): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return
    if (this.pendingCreations.delete(id)) {
      this.annotations.delete(id)
      this.notify()
      return
    }
    const before = cloneState(annotation)
    this.markTouched(annotation)
    annotation.deleted = true
    annotation.revision += 1
    this.history.push({ before, after: null })
    this.notify()
  }

  undo(): void {
    const step = this.history.undo()
    if (!step) return
    this.restore(step.before, step.after)
    this.notify()
  }

  redo(): void {
    const step = this.history.redo()
    if (!step) return
    this.restore(step.after, step.before)
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
    this.history.push({ before, after })
    this.notify()
  }

  private restore(target: AnnotationState | null, counterpart: AnnotationState | null): void {
    const id = target?.id ?? counterpart?.id
    if (!id) return
    const existing = this.annotations.get(id)
    if (target === null) {
      if (!existing) return
      this.markTouched(existing)
      existing.deleted = true
      existing.revision += 1
      return
    }
    const restored: StoredAnnotation = {
      ...cloneState(target),
      deleted: false,
      revision: (existing?.revision ?? 0) + 1,
    }
    this.annotations.set(id, restored)
    this.markTouched(restored)
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
    if (annotation.kind === 'freetext') {
      const common = {
        pageIndex: annotation.pageIndex,
        rect: annotation.rect,
        text: annotation.text,
        fontSize: annotation.fontSize,
        color: annotation.color,
        font: annotation.font,
      }
      return create ? { kind: 'createFreeText', ...common } : { kind: 'updateFreeText', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'line' || annotation.kind === 'arrow') {
      const common = {
        pageIndex: annotation.pageIndex,
        line: annotation.line!,
        color: annotation.color,
        borderWidth: annotation.borderWidth,
        lineEnding: { start: 'None' as const, end: annotation.kind === 'arrow' ? 'OpenArrow' as const : 'None' as const },
      }
      return create ? { kind: 'createLine', ...common } : { kind: 'updateLine', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'circle') {
      const common = { pageIndex: annotation.pageIndex, rect: annotation.rect, color: annotation.color, borderWidth: annotation.borderWidth, interiorColor: annotation.interiorColor }
      return create ? { kind: 'createCircle', ...common } : { kind: 'updateCircle', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'highlight' || annotation.kind === 'ink') {
      const common = { pageIndex: annotation.pageIndex, inkList: annotation.inkList!, color: annotation.color, borderWidth: annotation.borderWidth, opacity: annotation.opacity }
      return create ? { kind: 'createInk', ...common } : { kind: 'updateInk', objNum: savedObjNum, ...common }
    }
    const color: AnnotationColor = annotation.kind === 'whiteout' ? [] : annotation.color
    const interiorColor = annotation.kind === 'whiteout' ? [1, 1, 1] as RGB : annotation.interiorColor
    const common = { pageIndex: annotation.pageIndex, rect: annotation.rect, color, borderWidth: annotation.borderWidth, interiorColor }
    return create ? { kind: 'createSquare', ...common } : { kind: 'updateSquare', objNum: savedObjNum, ...common }
  }

  private renameAnnotation(oldId: string, newId: string, objNum: number): void {
    const annotation = this.annotations.get(oldId)
    if (!annotation) return
    this.annotations.delete(oldId)
    annotation.id = newId
    annotation.objNum = objNum
    this.annotations.set(newId, annotation)
    this.pendingCreations.delete(oldId)
    this.history.map((step) => this.mapHistoryStep(step, (state) => state?.id === oldId ? { ...state, id: newId, objNum } : state))
    this.markTouched(annotation)
  }

  private clearSavedObjectFromHistory(id: string, objNum: number): void {
    this.history.map((step) => this.mapHistoryStep(step, (state) => state?.id === id && state.objNum === objNum ? { ...state, objNum: null } : state))
  }

  private mapHistoryStep(
    step: HistoryStep<AnnotationState | null>,
    mapper: (state: AnnotationState | null) => AnnotationState | null,
  ): HistoryStep<AnnotationState | null> {
    return { before: mapper(step.before), after: mapper(step.after) }
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
