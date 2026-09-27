import type { AnnotationEdit, AnnotationInfo, Rect, RGB } from '../core/annotations'
import type { LayoutResult } from '../core/textLayout'

export type Kind = 'freetext' | 'square'

export interface EditableAnnotation {
  id: string
  objNum: number | null
  pageIndex: number
  kind: Kind
  rect: Rect
  text: string
  fontSize: number
  color: RGB
  borderWidth: number
  layout: LayoutResult | null
  dirty: boolean
  madeByKaru: boolean
}

interface StoredAnnotation extends EditableAnnotation {
  deleted: boolean
  revision: number
}

interface SaveResult {
  created: number[]
  errors?: Array<{ editIndex: number }>
}

const DEFAULT_COLOR: RGB = [1, 0, 0]
const DEFAULT_FONT_SIZE = 10.5
const DEFAULT_BORDER_WIDTH = 1

export class AnnotationStore {
  private readonly annotations = new Map<string, StoredAnnotation>()
  private readonly touchedByPage = new Map<number, Set<number>>()
  private readonly loadedPages = new Set<number>()
  private readonly loadingPages = new Map<number, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private pendingEdits: Array<{ annotation: StoredAnnotation; revision: number; id: string; wasNew: boolean }> = []
  private nextNewId = 1
  private version = 0
  private generation = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version

  reset(): void {
    this.annotations.clear()
    this.touchedByPage.clear()
    this.loadedPages.clear()
    this.loadingPages.clear()
    this.pendingEdits = []
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
        if (!info.editable) continue
        const id = `obj-${info.objNum}`
        if (this.annotations.has(id)) continue
        this.annotations.set(id, {
          id,
          objNum: info.objNum,
          pageIndex,
          kind: info.type === 'Square' ? 'square' : 'freetext',
          rect: [...info.rect],
          text: info.contents,
          fontSize: info.fontSize ?? DEFAULT_FONT_SIZE,
          color: [...(info.type === 'Square' ? info.strokeColor : info.textColor) ?? DEFAULT_COLOR],
          borderWidth: info.borderWidth ?? DEFAULT_BORDER_WIDTH,
          layout: null,
          dirty: false,
          madeByKaru: info.madeByKaru,
          deleted: false,
          revision: 0,
        })
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
      .map(({ deleted: _deleted, ...annotation }) => annotation)
  }

  get(id: string): EditableAnnotation | undefined {
    const stored = this.annotations.get(id)
    if (!stored || stored.deleted) return undefined
    const { deleted: _deleted, ...annotation } = stored
    return annotation
  }

  create(input: {
    pageIndex: number
    kind: Kind
    rect: Rect
    text?: string
    fontSize?: number
    color?: RGB
    borderWidth?: number
    layout?: LayoutResult | null
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
      color: [...(input.color ?? DEFAULT_COLOR)],
      borderWidth: input.borderWidth ?? DEFAULT_BORDER_WIDTH,
      layout: input.layout ?? null,
      dirty: true,
      madeByKaru: input.kind === 'freetext',
      deleted: false,
      revision: 1,
    }
    this.annotations.set(id, annotation)
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
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || (dx === 0 && dy === 0)) return
    this.markTouched(annotation)
    annotation.rect = [
      annotation.rect[0] + dx,
      annotation.rect[1] + dy,
      annotation.rect[2] + dx,
      annotation.rect[3] + dy,
    ]
    annotation.dirty = true
    annotation.revision += 1
    this.notify()
  }

  resize(id: string, rect: Rect): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return
    if (annotation.rect.every((value, index) => value === rect[index])) return
    this.markTouched(annotation)
    annotation.rect = [...rect]
    annotation.dirty = true
    annotation.revision += 1
    this.notify()
  }

  updateText(id: string, text: string, layout: LayoutResult, rect?: Rect): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || annotation.kind !== 'freetext') return
    this.markTouched(annotation)
    annotation.text = text
    annotation.layout = layout
    annotation.rect = rect ? [...rect] : [
      annotation.rect[0],
      annotation.rect[1],
      annotation.rect[2],
      annotation.rect[1] + layout.height,
    ]
    annotation.madeByKaru = true
    annotation.dirty = true
    annotation.revision += 1
    this.notify()
  }

  setLayout(id: string, layout: LayoutResult): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || annotation.kind !== 'freetext') return
    annotation.layout = layout
    this.notify()
  }

  remove(id: string): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return
    if (annotation.objNum === null) {
      annotation.deleted = true
      annotation.revision += 1
      this.annotations.delete(id)
    } else {
      this.markTouched(annotation)
      annotation.deleted = true
      annotation.dirty = true
      annotation.revision += 1
    }
    this.notify()
  }

  touchedObjNums(pageIndex: number): number[] {
    return [...(this.touchedByPage.get(pageIndex) ?? [])].sort((a, b) => a - b)
  }

  toEdits(): AnnotationEdit[] {
    const dirty = this.dirtyAnnotations()
    this.pendingEdits = dirty.map((annotation) => ({
      annotation,
      revision: annotation.revision,
      id: annotation.id,
      wasNew: annotation.objNum === null,
    }))
    return dirty.map((annotation) => {
      if (annotation.deleted) {
        return { kind: 'delete', objNum: annotation.objNum!, pageIndex: annotation.pageIndex }
      }
      if (annotation.kind === 'freetext') {
        const common = {
          pageIndex: annotation.pageIndex,
          rect: annotation.rect,
          text: annotation.text,
          fontSize: annotation.fontSize,
          color: annotation.color,
          font: 'BIZUDGothic' as const,
        }
        return annotation.objNum === null
          ? { kind: 'createFreeText', ...common }
          : { kind: 'updateFreeText', objNum: annotation.objNum, ...common }
      }
      const common = {
        pageIndex: annotation.pageIndex,
        rect: annotation.rect,
        color: annotation.color,
        borderWidth: annotation.borderWidth,
      }
      return annotation.objNum === null
        ? { kind: 'createSquare', ...common }
        : { kind: 'updateSquare', objNum: annotation.objNum, ...common }
    })
  }

  markApplied(result: SaveResult): void {
    const applied = this.pendingEdits
    this.pendingEdits = []
    const failed = new Set(result.errors?.map((error) => error.editIndex) ?? [])
    let createdIndex = 0
    applied.forEach(({ annotation, revision, id, wasNew }, editIndex) => {
      if (failed.has(editIndex)) return
      if (wasNew) {
        const objNum = result.created[createdIndex++]
        if (objNum === undefined) return
        const removedAfterApplyStarted = this.annotations.get(id) !== annotation
        annotation.objNum = objNum
        annotation.id = `obj-${objNum}`
        this.annotations.delete(id)
        this.annotations.set(annotation.id, annotation)
        this.markTouched(annotation)
        if (removedAfterApplyStarted) {
          annotation.deleted = true
          annotation.dirty = true
          return
        }
      }
      if (annotation.revision === revision) annotation.dirty = false
    })
    this.notify()
  }

  isDirty(): boolean {
    return [...this.annotations.values()].some((annotation) => annotation.dirty)
  }

  private dirtyAnnotations(): StoredAnnotation[] {
    return [...this.annotations.values()].filter((annotation) => annotation.dirty && !(annotation.deleted && annotation.objNum === null))
  }

  private markTouched(annotation: StoredAnnotation): void {
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
