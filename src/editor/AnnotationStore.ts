import { QuantityIndex } from '../core/quantityIndex'
import { stableJson } from '../core/stableJson'
import { floorFromDrawingName, normalizeFloor } from '../core/location'
import { mergeAutomaticDrawingInfo, type DrawingInfo } from '../core/drawingInfo'
import { validRouteScope, type RouteScope, validRouteCount, validRouteConditions, routeConditionsKey, normalizeRouteConditions, conditionsFromScope, withRouteScope, routeMembers, routeRises, validRises, riseTotal, validCondition, quantityLabel, quantityDimensions, parseQuantityMark, serializeQuantityMark, type RouteConditions, type RoutePart, type PartCondition, type Rise, type QuantityMark } from '../core/quantity'
import { fixtureConditionRenames, fixtureCode, quantityKind, quantityMethod, quantityLine, type QuantityLineStyle } from '../core/countFixtures'
import { symbolRectFromDrag, nearestCalloutEdgePoint, type AnnotationColor, type AnnotationEdit, type AnnotationInfo, type LegacyChangeData, type Point, type Rect, type RGB, type SymbolName } from '../core/annotations'
import type { Quad } from 'mupdf'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import { measureBounds, measureText, resolveScale, pointInScaleRegion, validScaleRegion, MAX_SCALE_REGIONS, type ScaleRegion, type MeasureKind, type MeasureSettings, type PageScale } from '../core/measure'
import { History, type HistoryStep } from './history'
import { IssueNumbers, issueColor, issueOrder, parseIssue, type Issue } from '../core/issues'
import type { CloudIntensity } from '../core/cloud'
import { countFixtureId, type CountMark } from '../core/counts'
import { nextCountStyle, serializeCountFixtures, type CountFixture } from '../core/countFixtures'
import { DEFAULT_ANNOTATION_FILTER, filterShowsCountMarks, matchesAnnotationFilter, type AnnotationFilter } from './annotationFilter'

export type DrawingFilterReleaseReason = '数量拾いの印を数えるため' | '隠れている種類の書き込みを作ったため' | '次の未対応指摘を表示するため' | '数量拾いの印を表示するため'

export interface SymbolSearchCandidate {
  id: string; pageIndex: number; rect: Rect; center: Point; score: number
  state: 'pending' | 'chosen' | 'counted'
  confidence?: 'high' | 'check'; imageScore?: number; extra?: number
  label: string; gc: boolean; around?: number; aroundCheck?: boolean
}

export type Kind = MeasureKind | 'cloudSquare' | 'cloudPolygon' | 'issue' | 'freetext' | 'callout' | 'line' | 'arrow' | 'square' | 'circle' | 'highlight' | 'ink' | 'textHighlight' | 'underline' | 'strikeout' | 'symbol'

export interface EditableAnnotation {
  legacyChange?: boolean
  legacyChangeData?: LegacyChangeData
  quantity?: QuantityMark | null
  quantityDash?: QuantityLineStyle['dash']
  count?: CountMark | null
  arrowHeadSize?: number | null
  cloudIntensity?: CloudIntensity | null
  issue?: Issue | null
  measure?: MeasureSettings | null
  vertices?: Point[] | null
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

type ScaleChange = { pageIndex: number; scale: PageScale | null }
type DrawingChange = { pageIndex: number; info: DrawingInfo | null }
type RouteTemplate = { itemId: string; extra: NonNullable<QuantityMark['extra']>; count: number; cond?: RouteConditions; name: string }
type PickupMemory = Array<{ itemId: string; cond?: RouteConditions; condition?: string; conditionSet?: boolean; members?: RouteTemplate }>
type HistoryState = AnnotationState[] & { routeTemplate?: RouteTemplate | null; pickupMemory?: PickupMemory; drawings?: DrawingChange[]; scales?: ScaleChange[]; scaleRegions?: Array<{ pageIndex: number; regions: ScaleRegion[] }>; issueMaximum?: number; fixtures?: CountFixture[] }
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

function cloneQuantity(mark: QuantityMark): QuantityMark { return structuredClone(mark) }

function cloneState(annotation: AnnotationState): AnnotationState {
  return {
    ...annotation,
    quantity: annotation.quantity ? cloneQuantity(annotation.quantity) : null,
    count: annotation.count ? { ...annotation.count } : null,
    issue: annotation.issue ? { ...annotation.issue } : null,
    measure: annotation.measure ? { ...annotation.measure } : null,
    vertices: annotation.vertices?.map(p => [...p] as Point) ?? null,
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
    quantity: state.quantity ? JSON.parse(serializeQuantityMark(state.quantity)) : null, quantityDash: state.quantityDash, issue: state.issue, count: state.count, cloudIntensity: state.cloudIntensity,
    measure: state.measure, vertices: state.vertices,
    pageIndex: state.pageIndex,
    kind: state.kind,
    rect: state.rect,
    text: state.text,
    fontSize: state.fontSize,
    font: state.font,
    color: state.color,
    borderWidth: state.borderWidth,
    arrowHeadSize: state.arrowHeadSize ?? null,
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
  return stableJson(persistedState(left)) === stableJson(persistedState(right))
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

export interface DirtySummary {
  annotations: number
  fixtures: boolean
  scales: number[]
  drawings: number[]
}

export class AnnotationStore {
  private vertexHighlight: { annotationId: string; vertexIndex: number } | null = null
  get highlightedVertex(): Readonly<{ annotationId: string; vertexIndex: number }> | null { return this.vertexHighlight }
  setHighlightedVertex(value: { annotationId: string; vertexIndex: number } | null): void {
    if (this.vertexHighlight?.annotationId === value?.annotationId && this.vertexHighlight?.vertexIndex === value?.vertexIndex) return
    this.vertexHighlight = value ? { ...value } : null
    this.notify(false)
  }
  private riseHighlight: { annotationId: string; riseIndex: number } | null = null
  get highlightedRise(): Readonly<{ annotationId: string; riseIndex: number }> | null { return this.riseHighlight }
  /** Display-only state: no undo entry, quantity invalidation or saved edit. */
  setHighlightedRise(value: { annotationId: string; riseIndex: number } | null): void {
    if (this.riseHighlight?.annotationId === value?.annotationId && this.riseHighlight?.riseIndex === value?.riseIndex) return
    this.riseHighlight = value ? { ...value } : null
    this.notify(false)
  }
  private flashTarget: string | null = null
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  flashVersion = 0
  get flashId(): string | null { return this.flashTarget }
  /** Selection feedback only: never dirty, indexed, added to history or saved. */
  flashPickup(id: string): void {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer)
    this.flashTarget = id; this.flashVersion++; this.notify(false)
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null; this.flashTarget = null; this.notify(false)
    }, 1500)
  }
  private filter: Readonly<AnnotationFilter> = DEFAULT_ANNOTATION_FILTER
  private followsFilter = false
  private readonly drawingFilterReleaseListeners = new Set<(reason: DrawingFilterReleaseReason) => void>()
  get annotationFilter(): Readonly<AnnotationFilter> { return this.filter }
  get drawingFollowsFilter(): boolean { return this.followsFilter }
  private fixtures: CountFixture[] = []
  private fixtureBaseline = '[]'
  private fixtureLoading: Promise<void> | null = null
  fixturesReady = false
  get fixturesLoading(): boolean { return this.fixtureLoading !== null }
  selectedFixtureId: string | null = null
  // Allocated only by explicit visual search; excluded from persisted/history states.
  symbolCandidates: SymbolSearchCandidate[] | null = null
  symbolLabelFilter: string[] | null = null
  symbolGcFilter: 'all' | 'with' | 'without' = 'all'
  isSymbolCandidateVisible(c: SymbolSearchCandidate): boolean {
    return (this.symbolLabelFilter === null || this.symbolLabelFilter.includes(c.label))
      && (this.symbolGcFilter === 'all' || (this.symbolGcFilter === 'with' ? c.gc : !c.gc))
  }
  get visibleSymbolCandidates(): SymbolSearchCandidate[] | null { return this.symbolCandidates?.filter(c => this.isSymbolCandidateVisible(c)) ?? null }
  setSymbolCandidateFilters(labels: string[] | null, gc: 'all' | 'with' | 'without' = this.symbolGcFilter): void {
    this.symbolLabelFilter = labels === null ? null : [...labels]; this.symbolGcFilter = gc; this.notify(false)
  }
  private symbolCandidateFixture: string | null = null
  private symbolCandidateRadius = 0

  clearSymbolCandidates(): void {
    if (this.symbolCandidates === null) return
    this.symbolCandidates = null; this.symbolCandidateFixture = null; this.symbolCandidateRadius = 0
    this.symbolLabelFilter = null; this.symbolGcFilter = 'all'
    this.notify(false)
  }
  beginSymbolCandidates(fixtureId: string, sampleRect: Rect): void {
    this.symbolCandidateFixture = fixtureId
    this.symbolCandidateRadius = Math.min(sampleRect[2] - sampleRect[0], sampleRect[3] - sampleRect[1]) / 2
    this.symbolLabelFilter = null; this.symbolGcFilter = 'all'
    this.symbolCandidates = []; this.notify(false)
  }
  appendSymbolCandidates(candidates: Array<{ pageIndex: number; rect: Rect; center: Point; score: number; confidence?: 'high' | 'check'; imageScore?: number; extra?: number; label?: string; gc?: boolean; around?: number; aroundCheck?: boolean }>): void {
    if (!this.symbolCandidates || this.symbolCandidateFixture !== this.selectedFixtureId) return
    for (const c of candidates) this.symbolCandidates.push({ ...c, label: c.label ?? '', gc: c.gc ?? false, rect: [...c.rect], center: [...c.center], id: crypto.randomUUID(), state: 'pending' })
    this.refreshSymbolCandidates(); this.notify(false)
  }
  toggleSymbolCandidate(id: string): void {
    const c = this.symbolCandidates?.find(c => c.id === id)
    if (!c || c.state === 'counted' || !this.isSymbolCandidateVisible(c)) return
    c.state = c.state === 'chosen' ? 'pending' : 'chosen'; this.notify(false)
  }
  chooseSymbolCandidates(chosen: boolean): void {
    if (!this.symbolCandidates) return
    for (const c of this.visibleSymbolCandidates ?? []) if (c.state !== 'counted') c.state = chosen ? 'chosen' : 'pending'
    this.notify(false)
  }
  chooseHighConfidenceCandidates(): void {
    if (!this.symbolCandidates) return
    for (const c of this.visibleSymbolCandidates ?? []) if (c.state === 'pending' && c.confidence === 'high') c.state = 'chosen'
    this.notify(false)
  }
  private refreshSymbolCandidates(): void {
    if (!this.symbolCandidates) return
    const marks = new Map<number, Point[]>()
    for (const a of this.annotations.values()) {
      if (a.deleted || !a.count || countFixtureId(a.count) !== this.symbolCandidateFixture) continue
      const points = marks.get(a.pageIndex) ?? []; points.push([(a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2]); marks.set(a.pageIndex, points)
    }
    for (const c of this.symbolCandidates) {
      const counted = marks.get(c.pageIndex)?.some(p => Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) <= this.symbolCandidateRadius)
      if (counted) c.state = 'counted'
      else if (c.state === 'counted') c.state = 'pending'
    }
  }

  createCountMarks(fixtureId: string, points: Array<{ pageIndex: number; center: Point }>): string[] {
    const fixture = this.getCountFixture(fixtureId)
    if (!fixture || quantityKind(fixture) !== 'count') throw new Error('個数の項目を選んでください')
    if (points.some(p => !Number.isInteger(p.pageIndex) || p.pageIndex < 0 || !p.center.every(Number.isFinite))) throw new Error('印の位置が不正です')
    if (!points.length) return []
    const after: HistoryState = []
    for (const { pageIndex, center } of points) {
      const a = this.create({ pageIndex, kind: 'symbol', rect: symbolRectFromDrag(center, center, false, fixture.style.size),
        count: { version: 2, id: crypto.randomUUID(), fixtureId, ...this.pickupLocation(pageIndex) },
        text: `個数: ${fixtureCode(fixture)} ${fixture.name}`.trim(), color: fixture.style.color, symbol: 'circle', opacity: fixture.style.opacity,
        deferHistory: true, deferNotify: true })
      this.pendingCreations.delete(a.id); after.push(cloneState(this.annotations.get(a.id)!))
    }
    this.history.push({ before: [], after }); this.notify()
    return after.map(a => a.id)
  }
  routeTemplate: RouteTemplate | null = null
  setRouteTemplate(t: AnnotationStore['routeTemplate']): void { this.routeTemplate = t ? structuredClone(t) : null; this.notify(false) }
  routeTemplateItems(itemId: string): Partial<Pick<QuantityMark, 'count' | 'cond' | 'extra'>> {
    const t = this.routeTemplate?.itemId === itemId ? this.routeTemplate : this.lastRouteMembers.get(itemId), f = this.getCountFixture(itemId)
    if (!f || quantityMethod(f) !== 'polyline') return {}
    if (!t) return { cond: this.newRouteConditions(itemId) }
    return { count: t.count, cond: structuredClone(this.routeTemplate?.itemId === itemId ? t.cond ?? f.routeDefaults ?? {} : this.lastRouteConditions.get(itemId) ?? t.cond ?? f.routeDefaults ?? {}), extra: t.extra.filter(e => { const f = this.getCountFixture(e.itemId); return f && quantityMethod(f) === 'polyline' }).map(e => ({ ...e, cond: structuredClone(this.routeTemplate?.itemId === itemId ? e.cond ?? this.getCountFixture(e.itemId)?.routeDefaults ?? {} : this.lastRouteConditions.get(e.itemId) ?? e.cond ?? this.getCountFixture(e.itemId)?.routeDefaults ?? {}) })) }
  }
  private recentFixtures: readonly string[] = []
  get recentFixtureIds(): readonly string[] { return this.recentFixtures }
  rememberRouteFixture(id: string): void { this.rememberFixture(id); this.notify(false) }
  private rememberFixture(id: string): void {
    this.recentFixtures = [id, ...this.recentFixtures.filter(previous => previous !== id)].slice(0, 8)
  }
  private readonly hiddenFixtures = new Set<string>()
  onlySelectedFixture = false
  showQuantityValues = true
  private readonly legacyCountObjects = new Set<string>()
  private pendingFixtureSave: { editIndex: number; json: string } | null = null
  readonly issueNumbers = new IssueNumbers()
  private readonly annotations = new Map<string, StoredAnnotation>()
  private readonly baselines = new Map<string, AnnotationState>()
  private readonly touchedByPage = new Map<number, Set<number>>()
  private readonly loadedPages = new Set<number>()
  private readonly loadingPages = new Map<number, Promise<void>>()
  private readonly listeners = new Set<() => void>()
  private readonly history = new History<HistoryState>(100)
  private readonly pendingCreations = new Set<string>()
  private readonly selection = new Set<string>()
  private pendingEdits: PendingEdit[] = []
  private readonly drawings = new Map<number, DrawingInfo | null>()
  private readonly drawingBaselines = new Map<number, DrawingInfo | null>()
  private readonly drawingDirtyBaselines = new Map<number, DrawingInfo | null>()
  private readonly automaticDrawings = new Map<number, DrawingInfo>()
  private pendingDrawings: Array<DrawingChange & { editIndex: number }> = []
  readonly scaleRegions = new Map<number, ScaleRegion[]>()
  private readonly scaleRegionBaselines = new Map<number, ScaleRegion[]>()
  private pendingScaleRegions: Array<{ pageIndex: number; regions: ScaleRegion[]; editIndex: number }> = []
  private readonly scales = new Map<number, PageScale | null>()
  private readonly scaleBaselines = new Map<number, PageScale | null>()
  private pendingScales: Array<ScaleChange & { editIndex: number }> = []
  private nextNewId = 1
  private quantityVersion = 0
  private indexVersion = -1
  private index: QuantityIndex | null = null
  private visibilityVersion = 0
  private visibleCountCache: { index: QuantityIndex; visibilityVersion: number; pages: Map<number, number> } | null = null
  currentFloor = ''
  currentRoom = ''
  private version = 0
  private dirtyCache: { version: number; summary: DirtySummary } | null = null
  private generation = 0
  private lastNudge: { key: string; step: HistoryStep<HistoryState>; at: number } | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version
  subscribeDrawingFilterRelease = (listener: (reason: DrawingFilterReleaseReason) => void): (() => void) => {
    this.drawingFilterReleaseListeners.add(listener)
    return () => this.drawingFilterReleaseListeners.delete(listener)
  }

  setAnnotationFilter(filter: AnnotationFilter): void {
    if (this.filter.kind === filter.kind && this.filter.discipline === filter.discipline && this.filter.status === filter.status) return
    this.filter = Object.freeze({ ...filter })
    this.pruneHiddenSelection(); this.visibilityVersion++; this.notify(false)
  }
  setDrawingFollowsFilter(value: boolean): void {
    if (this.followsFilter === value) return
    this.followsFilter = value
    this.pruneHiddenSelection(); this.visibilityVersion++; this.notify(false)
  }
  releaseDrawingFilter(reason: DrawingFilterReleaseReason): void {
    if (!this.followsFilter) return
    this.setDrawingFollowsFilter(false)
    for (const listener of this.drawingFilterReleaseListeners) listener(reason)
  }
  isShownOnDrawing(annotation: Pick<EditableAnnotation, 'legacyChange' | 'kind' | 'count' | 'quantity' | 'issue' | 'measure'>): boolean {
    return (!this.followsFilter || matchesAnnotationFilter(annotation, this.filter)) && this.isCountVisible(annotation.count, annotation.quantity)
  }
  drawingFilterActive(): boolean {
    return this.followsFilter && (this.filter.kind !== 'all' || this.filter.discipline !== '' || this.filter.status !== '')
  }
  drawingHidesCounts(): boolean {
    return this.drawingFilterActive() && !filterShowsCountMarks(this.filter)
  }
  drawingHiddenObjNums(pageIndex: number): number[] {
    if (!this.drawingFilterActive()) return []
    const result: number[] = []
    for (const a of this.annotations.values()) if (!a.deleted && a.pageIndex === pageIndex && a.objNum !== null && !matchesAnnotationFilter(a, this.filter)) result.push(a.objNum)
    return result
  }
  prepareCountTool(): void {
    if (this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を数えるため')
    if (this.selectedFixtureId && this.revealCountFixture(this.selectedFixtureId)) this.notify(false)
  }
  private revealCountFixture(id: string): boolean {
    const changed = this.hiddenFixtures.delete(id)
    if (changed) this.visibilityVersion++
    if (this.onlySelectedFixture && id !== this.selectedFixtureId) { this.onlySelectedFixture = false; this.visibilityVersion++; return true }
    return changed
  }
  canUndo = (): boolean => this.history.canUndo
  canRedo = (): boolean => this.history.canRedo

  reset(preserveFixtureVisibility = false): void {
    this.riseHighlight = null
    this.clearSymbolCandidates()
    if (!preserveFixtureVisibility) { this.routeTemplate = null; this.lastRouteConditions.clear(); this.lastCondition.clear(); this.lastRouteMembers.clear() }
    if (!preserveFixtureVisibility) this.recentFixtures = []
    this.index = null; this.visibleCountCache = null
    this.fixtures = []; this.fixtureBaseline = '[]'; this.fixtureLoading = null; this.fixturesReady = false
    if (!preserveFixtureVisibility) { this.currentFloor = ''; this.currentRoom = ''; this.selectedFixtureId = null; this.hiddenFixtures.clear(); this.onlySelectedFixture = false; this.showQuantityValues = true }
    if (!preserveFixtureVisibility) { this.filter = DEFAULT_ANNOTATION_FILTER; this.followsFilter = false }
    this.legacyCountObjects.clear(); this.pendingFixtureSave = null
    this.drawings.clear(); this.drawingBaselines.clear(); this.drawingDirtyBaselines.clear(); this.automaticDrawings.clear(); this.pendingDrawings = []
    this.scales.clear(); this.scaleBaselines.clear(); this.pendingScales = []
    this.scaleRegions.clear(); this.scaleRegionBaselines.clear(); this.pendingScaleRegions = []
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
        if ((!info.editable && !info.legacyChange) || info.kind === 'other') continue
        const id = `obj-${info.objNum}`
        if (this.annotations.has(id)) continue
        const kind = info.kind as Kind
        const annotation: StoredAnnotation = {
          legacyChange: info.legacyChange,
          legacyChangeData: info.legacyChangeData,
          issue: info.issue ? { ...info.issue } : null,
          quantity: info.quantity ? cloneQuantity(info.quantity) : null, quantityDash: info.quantityDash,
          count: info.count ? { ...info.count } : null,
          cloudIntensity: info.cloudIntensity ?? null,
          id,
          objNum: info.objNum,
          pageIndex,
          kind,
          measure: info.measure ? { ...info.measure } : null,
          vertices: info.vertices?.map(p => [...p] as Point) ?? null,
          rect: [...info.rect],
          text: isTextMarkup(kind) ? info.markedText ?? '' : info.contents,
          fontSize: info.fontSize ?? DEFAULT_FONT_SIZE,
          font: info.fontName === 'BIZUDMincho' ? 'BIZUDMincho' : 'BIZUDGothic',
          color: [...((kind === 'freetext' || kind === 'callout' ? info.textColor : info.strokeColor) ?? DEFAULT_COLOR)],
          arrowHeadSize: info.arrowHeadSize ?? null,
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
        if (annotation.issue) this.issueNumbers.observe(annotation.issue.number)
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

  loadDrawingInfos(infos: readonly (DrawingInfo | null)[]): void {
    infos.forEach((info, i) => { this.drawings.set(i, info); this.drawingBaselines.set(i, info); this.drawingDirtyBaselines.set(i, info) })
    this.notify(false)
  }
  getDrawingInfo(pageIndex: number): DrawingInfo | null { const info = this.drawings.get(pageIndex); return info ? { ...info } : null }
  getAutomaticDrawingInfo(pageIndex: number): DrawingInfo | null { return this.automaticDrawings.get(pageIndex) ?? null }
  setDrawingInfo(pageIndices: readonly number[], info: DrawingInfo): void {
    if (pageIndices.every(pageIndex => stableJson(this.getDrawingInfo(pageIndex)) === stableJson(info))) return
    const before: HistoryState = [], after: HistoryState = []
    before.drawings = pageIndices.map(pageIndex => ({ pageIndex, info: this.getDrawingInfo(pageIndex) }))
    after.drawings = pageIndices.map(pageIndex => ({ pageIndex, info: { ...info } }))
    after.drawings.forEach(({ pageIndex, info }) => this.drawings.set(pageIndex, info))
    this.history.push({ before, after }); this.notify(false)
  }
  applyAutomaticDrawingInfo(pageIndex: number, result: DrawingInfo): void {
    this.automaticDrawings.set(pageIndex, { number: result.number, name: result.name, scanned: true })
    const old = this.getDrawingInfo(pageIndex), next = mergeAutomaticDrawingInfo(old, result)
    this.drawings.set(pageIndex, next)
    const baseline = this.drawingDirtyBaselines.get(pageIndex) ?? null
    this.drawingDirtyBaselines.set(pageIndex, mergeAutomaticDrawingInfo(baseline, result))
    this.notify(false)
  }
  loadScales(scales: readonly (PageScale | null)[]): void {
    scales.forEach((scale, pageIndex) => { this.scales.set(pageIndex, scale); this.scaleBaselines.set(pageIndex, scale) })
    this.notify()
  }

  loadScaleRegions(entries: readonly [number, ScaleRegion[]][]): void {
    this.scaleRegions.clear(); this.scaleRegionBaselines.clear()
    for (const [i, regions] of entries) { this.scaleRegions.set(i, structuredClone(regions)); this.scaleRegionBaselines.set(i, structuredClone(regions)) }
    this.notify(false)
  }
  getScaleRegions(pageIndex: number): ScaleRegion[] { return structuredClone(this.scaleRegions.get(pageIndex) ?? []) }
  scaleAt(pageIndex: number, point: Point): ReturnType<typeof resolveScale> {
    return resolveScale(this.getScale(pageIndex), this.scaleRegions.get(pageIndex), point)
  }
  setScaleRegions(pageIndex: number, regions: ScaleRegion[], recalculate: boolean): void {
    if (regions.length > MAX_SCALE_REGIONS || regions.some(r => !validScaleRegion(r)) || new Set(regions.map(r => r.id)).size !== regions.length) throw new Error('縮尺の範囲が不正です。')
    const old = this.getScaleRegions(pageIndex), next = structuredClone(regions)
    if (stableJson(old) === stableJson(next) && !recalculate) return
    const before: HistoryState = [], after: HistoryState = []
    before.scaleRegions = [{ pageIndex, regions: old }]; after.scaleRegions = [{ pageIndex, regions: next }]
    this.scaleRegions.set(pageIndex, next)
    if (recalculate) for (const a of this.annotations.values()) {
      const start = a.vertices?.[0]
      if (a.deleted || a.pageIndex !== pageIndex || !a.measure || !a.vertices || !start || ![...old, ...next].some(r => pointInScaleRegion(r, start))) continue
      const scale = this.scaleAt(pageIndex, start)?.scale
      // Removing the last available scale leaves historical values intact.
      if (!scale) continue
      const previous = cloneState(a)
      a.measure = { ...a.measure, mmPerPoint: scale.mmPerPoint, unit: scale.unit, decimals: scale.decimals }
      a.text = this.quantityText(a); a.rect = measureBounds(a.vertices, a.measure.kind, a.text, a.fontSize)
      if (samePersisted(previous, a)) continue
      before.push(previous); this.markTouched(a); a.revision++; after.push(cloneState(a))
    }
    this.history.push({ before, after }); this.notify()
  }

  getScale(pageIndex: number): PageScale | null { const s = this.scales.get(pageIndex); return s ? { ...s } : null }

  getCountFixtures(): CountFixture[] { return structuredClone(this.fixtures) }
  hasCountMarks(): boolean { for (const a of this.annotations.values()) if (!a.deleted && (a.count || a.quantity)) return true; return false }
  getCountFixture(id: string | null): CountFixture | undefined { return this.fixtures.find(f => f.id === id) }
  fixtureForCount(mark: CountMark | null | undefined): CountFixture | undefined { return mark ? this.getCountFixture(countFixtureId(mark)) : undefined }
  async ensureCountFixtures(loader: () => Promise<CountFixture[]>, loadPages: () => Promise<void>): Promise<void> {
    if (this.fixturesReady) return
    if (this.fixtureLoading) return this.fixtureLoading
    const generation = this.generation
    this.fixtureLoading = (async () => {
      const fixtures = await loader()
      await loadPages()
      if (generation !== this.generation) return
      const nextFixtures = structuredClone(fixtures), legacyIds: string[] = []
      for (const a of this.annotations.values()) if (a.count?.version === 1 && !a.deleted) {
        const id = countFixtureId(a.count)
        if (!nextFixtures.some(f => f.id === id)) {
          if (nextFixtures.length >= 1000) throw new Error('旧形式の項目を含めると1,000件を超えます。')
          nextFixtures.push({ id, name: a.count.group, code: '', category: 'その他', style: nextCountStyle(nextFixtures), order: nextFixtures.reduce((n, f) => Math.max(n, f.order + 1), 0) })
        }
        legacyIds.push(a.id)
      }
      serializeCountFixtures(nextFixtures)
      this.fixtures = nextFixtures
      this.legacyCountObjects.clear(); for (const id of legacyIds) this.legacyCountObjects.add(id)
      this.fixtureBaseline = stableJson(this.fixtures)
      this.fixturesReady = true
      this.notify()
    })().finally(() => { if (generation === this.generation) this.fixtureLoading = null })
    return this.fixtureLoading
  }
  selectFixture(id: string | null): void { if (id !== this.selectedFixtureId) this.clearSymbolCandidates(); if (id !== this.routeTemplate?.itemId) this.routeTemplate = null; this.selectedFixtureId = id; if (id !== null) this.rememberFixture(id); this.pruneHiddenSelection(); this.visibilityVersion++; this.notify(false) }
  isFixtureVisible(id: string): boolean { return !this.hiddenFixtures.has(id) && (!this.onlySelectedFixture || id === this.selectedFixtureId) }
  isCountVisible(mark: CountMark | null | undefined, quantity?: QuantityMark | null): boolean { return quantity ? [quantity.itemId, ...(quantity.extra ?? []).map(e => e.itemId)].some(id => this.isFixtureVisible(id)) : !mark || this.isFixtureVisible(countFixtureId(mark)) }
  setFixtureVisible(ids: readonly string[], visible: boolean): void {
    if (visible && this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を表示するため')
    for (const id of ids) { if (visible) this.hiddenFixtures.delete(id); else this.hiddenFixtures.add(id) }
    this.pruneHiddenSelection(); this.visibilityVersion++; this.notify(false)
  }
  setShowQuantityValues(value: boolean): void { this.showQuantityValues = value; this.notify(false) }
  setOnlySelectedFixture(value: boolean): void { if (value && this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を表示するため'); this.onlySelectedFixture = value; this.pruneHiddenSelection(); this.visibilityVersion++; this.notify(false) }
  showAllFixtures(): void { if (this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を表示するため'); this.hiddenFixtures.clear(); this.onlySelectedFixture = false; this.visibilityVersion++; this.notify(false) }
  private pruneHiddenSelection(): void { for (const id of this.selection) { const a = this.annotations.get(id); if (!a || a.deleted || !this.isShownOnDrawing(a)) this.selection.delete(id) } }
  quantityIndex(): QuantityIndex {
    if (!this.index || this.indexVersion !== this.quantityVersion) {
      this.index = QuantityIndex.build(this.annotations.values(), this.fixtures)
      this.indexVersion = this.quantityVersion
    }
    return this.index
  }
  countTotals(): Map<string, Map<number, number>> {
    const index = this.quantityIndex()
    return new Map([...index.itemIds()].map(id => [id, index.byPage(id)]))
  }
  setCurrentLocation(key: 'floor' | 'room', value: string): void {
    if (value.length > 40) return
    if (key === 'floor') this.currentFloor = normalizeFloor(value); else this.currentRoom = value.trim()
    this.notify(false)
  }
  pickupLocation(pageIndex: number): { floor?: string; room?: string } {
    const floor = normalizeFloor(this.currentFloor) || floorFromDrawingName(this.getDrawingInfo(pageIndex)?.name ?? '')
    return { ...(floor ? { floor } : {}), ...(this.currentRoom.trim() ? { room: this.currentRoom.trim() } : {}) }
  }
  updatePickupLocation(ids: readonly string[], key: 'floor' | 'room', value: string): void {
    if (value.length > 40) return
    const text = key === 'floor' ? normalizeFloor(value) : value.trim()
    const eligible = ids.filter(id => {
      const a = this.annotations.get(id), mark = a?.quantity ?? (a?.count?.version === 2 ? a.count : a?.count ? {} : null)
      return !!mark && ((mark as { floor?: string; room?: string })[key] ?? '') !== text
    })
    this.mutateMany(eligible, a => {
      // Upgrade legacy count marks on their first location edit.
      if (a.count?.version === 1) a.count = { version: 2, id: a.count.id, fixtureId: countFixtureId(a.count) }
      const mark = a.quantity ?? (a.count?.version === 2 ? a.count : null)
      if (mark) { if (text) mark[key] = text; else delete mark[key] }
    })
  }
  readonly lastRouteConditions = new Map<string, RouteConditions>()
  readonly lastCondition = new Map<string, string | undefined>()
  newRouteConditions(itemId: string): RouteConditions { return structuredClone(this.lastRouteConditions.get(itemId) ?? this.getCountFixture(itemId)?.routeDefaults ?? {}) }
  private newCondition(itemId: string): string | undefined { return this.lastCondition.has(itemId) ? this.lastCondition.get(itemId) : this.getCountFixture(itemId)?.defaultCondition }
  private readonly lastRouteMembers = new Map<string, NonNullable<AnnotationStore['routeTemplate']>>()
  clearRouteInheritance(itemId: string): void {
    this.lastRouteConditions.delete(itemId)
    this.lastRouteMembers.delete(itemId)
    // Also remove this item's remembered conditions from other inherited compositions.
    for (const [id, t] of this.lastRouteMembers) {
      if (t.extra.some(e => e.itemId === itemId)) this.lastRouteMembers.set(id, { ...t, extra: t.extra.map(e => e.itemId === itemId ? { ...e, cond: undefined } : e) })
    }
    this.notify(false)
  }
  splitRoute(id: string, vertexIndex: number): string | undefined {
    const a = this.annotations.get(id), q = a?.quantity, points = a?.vertices
    if (!a || a.deleted || a.legacyChange || q?.method !== 'polyline' || !a.measure || !points
      || !Number.isInteger(vertexIndex) || vertexIndex < 1 || vertexIndex >= points.length - 1) return
    const before: HistoryState = [cloneState(a)]
    const rises = routeRises(q), left: number[] = [], right: number[] = []
    rises.forEach((r, i) => (r.at !== undefined && r.at >= vertexIndex ? right : left).push(i))
    const portion = (indices: number[], moved: boolean): QuantityMark => {
      const condition = (c: RouteConditions = {}): RouteConditions => {
        const rise = c.rise
        return normalizeRouteConditions({ ...c, ...(Array.isArray(rise) ? { rise: indices.map(i => rise[i]) } : {}) })
      }
      const selectedRises = indices.map(i => ({ ...rises[i], ...(moved && rises[i].at !== undefined ? { at: rises[i].at! - vertexIndex } : {}) }))
      return { ...cloneQuantity(q), ...(moved ? { id: crypto.randomUUID(), slackM: 0 } : {}), rises: selectedRises,
        addM: riseTotal(selectedRises), cond: condition(q.cond), extra: q.extra?.map(e => ({ ...e, cond: condition(e.cond) })) }
    }
    const newId = crypto.randomUUID()
    const next: StoredAnnotation = { ...cloneState(a), id: newId, objNum: null, madeByKaru: true, deleted: false, revision: 0,
      vertices: clonePoints(points.slice(vertexIndex)), quantity: portion(right, true) }
    a.vertices = clonePoints(points.slice(0, vertexIndex + 1)); a.quantity = portion(left, false)
    this.refreshQuantity(a); this.refreshQuantity(next)
    this.markTouched(a); a.revision++
    this.annotations.set(newId, next)
    this.history.push({ before, after: [cloneState(a), cloneState(next)] })
    this.selection.clear(); this.selection.add(newId)
    this.vertexHighlight = null; this.riseHighlight = null
    this.notify()
    return newId
  }
  private rememberRoute(q: QuantityMark): void {
    for (const e of routeMembers(q)) this.lastRouteConditions.set(e.itemId, structuredClone(e.cond))
    this.lastRouteMembers.set(q.itemId, { itemId: q.itemId, count: q.count ?? 1, cond: structuredClone(q.cond ?? {}), extra: structuredClone(q.extra ?? []), name: '' })
  }
  private pickupMemory(ids: Iterable<string>): PickupMemory {
    return [...new Set(ids)].map(itemId => ({ itemId, cond: structuredClone(this.lastRouteConditions.get(itemId)), condition: this.lastCondition.get(itemId), conditionSet: this.lastCondition.has(itemId), members: structuredClone(this.lastRouteMembers.get(itemId)) }))
  }
  private pickupMemoryIds(annotations: readonly AnnotationState[]): string[] {
    return annotations.flatMap(a => a.quantity ? routeMembers(a.quantity).map(e => e.itemId) : a.count ? [countFixtureId(a.count)] : [])
  }
  private restorePickupMemory(memory: PickupMemory): void {
    for (const m of memory) {
      if (m.cond === undefined) this.lastRouteConditions.delete(m.itemId); else this.lastRouteConditions.set(m.itemId, structuredClone(m.cond))
      if (!m.conditionSet) this.lastCondition.delete(m.itemId); else this.lastCondition.set(m.itemId, m.condition)
      if (m.members === undefined) this.lastRouteMembers.delete(m.itemId); else this.lastRouteMembers.set(m.itemId, structuredClone(m.members))
    }
  }
  private refreshQuantity(a: StoredAnnotation): void {
    a.text = this.quantityText(a)
    if (a.vertices && a.measure) a.rect = measureBounds(a.vertices, a.measure.kind, a.text, a.fontSize)
  }
  // Compatibility wrapper for the current scope selector. Conditions on counted parts survive.
  updateRoute(id: string, count: number, extra: NonNullable<QuantityMark['extra']>, scope?: RouteScope): void {
    const q = this.get(id)?.quantity
    if (!q || scope !== undefined && !validRouteScope(scope)) return
    this.setRouteMembers(id, [{ itemId: q.itemId, count, cond: scope ? withRouteScope(q.cond ?? {}, scope) : q.cond }, ...extra])
  }
  setRouteItems(id: string, members: ReadonlyArray<{ itemId: string; count: number; cond?: RouteConditions }>): void {
    this.setRouteMembers(id, members)
  }
  setRouteMembers(id: string, members: ReadonlyArray<{ itemId: string; count: number; cond?: RouteConditions }>): void {
    this.addFixturesAndSetRouteItems([], id, members)
  }
  addFixturesAndSetRouteItems(newFixtures: readonly CountFixture[], id: string, members: ReadonlyArray<{ itemId: string; count: number; cond?: RouteConditions }>): void {
    const a = this.annotations.get(id), q = a?.quantity
    if (!a || a.deleted || a.legacyChange || q?.method !== 'polyline' || !members.length || members.length > 11) return
    const fixtures = [...this.getCountFixtures(), ...newFixtures]
    if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) return
    const ids = new Set<string>()
    for (const e of members) {
      const f = fixtures.find(f => f.id === e.itemId)
      if (!f || quantityMethod(f) !== 'polyline' || ids.has(e.itemId) || !validRouteCount(e.count) || e.cond !== undefined && !validRouteConditions(e.cond)) return
      ids.add(e.itemId)
    }
    if (newFixtures.length) serializeCountFixtures(fixtures)
    const normalized = members.map(e => ({ itemId: e.itemId, count: e.count, cond: normalizeRouteConditions(e.cond) }))
    const proposed = { ...q, itemId: normalized[0].itemId, count: normalized[0].count, cond: normalized[0].cond, extra: normalized.slice(1) }
    if (serializeQuantityMark(proposed).length > 8000) return
    const current = routeMembers(q)
    const memoryIds = [...current.map(e => e.itemId), ...normalized.map(e => e.itemId)], previousMemory = this.pickupMemory(memoryIds)
    this.rememberRoute({ ...q, itemId: normalized[0].itemId, count: normalized[0].count, cond: normalized[0].cond, extra: normalized.slice(1) })
    if (!newFixtures.length && stableJson(current.map(e => ({ ...e, cond: routeConditionsKey(e.cond) }))) === stableJson(normalized.map(e => ({ ...e, cond: routeConditionsKey(e.cond) })))) return
    const before: HistoryState = [cloneState(a)], after: HistoryState = []
    if (newFixtures.length) { before.fixtures = this.getCountFixtures(); after.fixtures = structuredClone(fixtures); this.fixtures = structuredClone(fixtures) }
    before.pickupMemory = previousMemory; after.pickupMemory = this.pickupMemory(memoryIds)
    const [main, ...extra] = normalized
    a.quantity = { ...q, itemId: main.itemId, count: main.count === 1 ? undefined : main.count, cond: main.cond, extra: extra.length ? extra : undefined }
    if (a.quantity.count === undefined) delete a.quantity.count
    if (a.quantity.extra === undefined) delete a.quantity.extra
    if (main.itemId !== q.itemId) this.applyFixtureToQuantity(a, this.getCountFixture(main.itemId)!)
    else this.refreshQuantity(a)
    this.markTouched(a); a.revision++; after.push(cloneState(a))
    this.history.push({ before, after }); this.pruneHiddenSelection(); this.notify()
  }
  setRouteRises(id: string, rises: readonly Rise[]): void {
    if (!validRises(rises)) return
    const q = this.get(id)?.quantity
    if (q?.method !== 'polyline') return
    const resize = (cond: RouteConditions = {}): RouteConditions => normalizeRouteConditions({ ...cond,
      ...(Array.isArray(cond.rise) ? { rise: Array.from({ length: rises.length }, (_, i) => (cond.rise as PartCondition[])[i]) } : {}) })
    this.mutate(id, a => {
      const changedCount = routeRises(a.quantity!).length !== rises.length
      a.quantity = { ...a.quantity!, rises: rises.map(r => ({ m: r.m, ...(r.at !== undefined ? { at: r.at } : {}) })), addM: riseTotal(rises) }
      if (changedCount) {
        a.quantity.cond = resize(a.quantity.cond)
        if (a.quantity.extra) a.quantity.extra = a.quantity.extra.map(e => ({ ...e, cond: resize(e.cond) }))
      }
      this.rememberRoute(a.quantity); this.refreshQuantity(a)
    }, true)
  }
  removeRouteRise(id: string, riseIndex: number): void {
    const q = this.get(id)?.quantity
    if (q?.method !== 'polyline' || !Number.isInteger(riseIndex) || riseIndex < 0 || riseIndex >= routeRises(q).length) return
    this.mutate(id, a => {
      const mark = a.quantity!, rises = routeRises(mark).filter((_, i) => i !== riseIndex)
      const remove = (cond: RouteConditions = {}): RouteConditions => normalizeRouteConditions({ ...cond,
        ...(Array.isArray(cond.rise) ? { rise: cond.rise.filter((_, i) => i !== riseIndex) } : {}) })
      a.quantity = { ...mark, rises, addM: riseTotal(rises), cond: remove(mark.cond),
        extra: mark.extra?.map(e => ({ ...e, cond: remove(e.cond) })) }
      this.rememberRoute(a.quantity); this.refreshQuantity(a)
    }, true)
  }
  setRouteCondition(ids: readonly string[], itemId: string, part: RoutePart, condition: PartCondition, riseIndex?: number): void {
    if (!['plan', 'rise', 'slack'].includes(part) || condition !== undefined && condition !== null && !validCondition(condition)
      || riseIndex !== undefined && (part !== 'rise' || !Number.isInteger(riseIndex) || riseIndex < 0 || riseIndex >= 20)) return
    this.mutateMany(ids, a => this.changeRouteCondition(a, itemId, part, condition, riseIndex), true)
  }
  private changeRouteCondition(a: StoredAnnotation, itemId: string, part: RoutePart, condition: PartCondition, riseIndex?: number): void {
    const q = a.quantity
    if (q?.method !== 'polyline' || riseIndex !== undefined && riseIndex >= routeRises(q).length) return
    const member = q.itemId === itemId ? q : q.extra?.find(e => e.itemId === itemId)
    if (!member) return
    const cond = normalizeRouteConditions(member.cond)
    if (part === 'rise' && riseIndex !== undefined) {
      const old = cond.rise
      cond.rise = Array.from({ length: routeRises(q).length }, (_, i) => i === riseIndex ? condition : Array.isArray(old) ? old[i] : old)
    } else if (condition === undefined) delete cond[part]
    else cond[part] = condition
    member.cond = cond; this.rememberRoute(q); this.refreshQuantity(a)
  }
  /** Candidate edits use the same fixtures snapshot as item editing, in the pickup's history step. */
  private addConditionAndApply(fixtureId: string, condition: string, ids: readonly string[], change: (a: StoredAnnotation) => void): string | undefined {
    if (!validCondition(condition)) return '条件は1〜30文字で、前後の空白・改行を入れずに入力してください。'
    const fixture = this.getCountFixture(fixtureId)
    if (!fixture) return '項目が見つかりません。'
    const candidates = fixture.conditions ?? [], exists = candidates.includes(condition)
    if (!exists && candidates.length >= 30) return '施工条件の候補は30件までです。'
    if (!ids.length) return '条件を適用できる拾いがありません。'
    const fixtures = exists ? undefined : this.getCountFixtures().map(f => f.id === fixtureId ? { ...f, conditions: [...candidates, condition] } : f)
    const memory = this.pickupMemory(this.pickupMemoryIds(ids.map(id => this.annotations.get(id)!)))
    // Validate detached edits first: a rejected pickup must not leave a new candidate behind.
    try {
      if (fixtures) serializeCountFixtures(fixtures)
      for (const id of new Set(ids)) {
        const a = this.annotations.get(id)!, proposed = { ...a, ...cloneState(a) }
        change(proposed)
        if (proposed.quantity && serializeQuantityMark(proposed.quantity).length > 8000) return '条件を適用すると経路の保存容量を超えます。条件名を短くしてください。'
      }
    } catch (reason) { return reason instanceof Error ? reason.message : String(reason) }
    finally { this.restorePickupMemory(memory) }
    this.mutateMany(ids, change, true, fixtures)
  }
  addConditionAndSetRoute(fixtureId: string, condition: string, ids: readonly string[], itemId: string, part: RoutePart, riseIndex?: number): string | undefined {
    if (fixtureId !== itemId || !['plan', 'rise', 'slack'].includes(part)
      || riseIndex !== undefined && (part !== 'rise' || !Number.isInteger(riseIndex) || riseIndex < 0 || riseIndex >= 20)) return '条件を適用する部分が不正です。'
    const targets = ids.filter(id => {
      const a = this.annotations.get(id), q = a?.quantity
      return a && !a.deleted && !a.legacyChange && q?.method === 'polyline'
        && (riseIndex === undefined || riseIndex < routeRises(q).length) && routeMembers(q).some(e => e.itemId === itemId)
    })
    return this.addConditionAndApply(fixtureId, condition, targets, a => this.changeRouteCondition(a, itemId, part, condition, riseIndex))
  }
  addConditionAndSetQuantity(fixtureId: string, condition: string, ids: readonly string[]): string | undefined {
    const targets = ids.filter(id => {
      const a = this.annotations.get(id)
      return a && !a.deleted && !a.legacyChange && (a.quantity ? a.quantity.method !== 'polyline' && a.quantity.itemId === fixtureId : a.count && countFixtureId(a.count) === fixtureId)
    })
    return this.addConditionAndApply(fixtureId, condition, targets, a => this.changeQuantityCondition(a, condition))
  }
  setQuantityCondition(ids: readonly string[], condition: string | undefined): void {
    if (condition !== undefined && !validCondition(condition)) return
    this.mutateMany(ids, a => this.changeQuantityCondition(a, condition), true)
  }
  private changeQuantityCondition(a: StoredAnnotation, condition: string | undefined): void {
    if (a.quantity?.method === 'polyline' || !a.quantity && !a.count) return
    if (a.count?.version === 1 && !a.quantity) a.count = { version: 2, id: a.count.id, fixtureId: countFixtureId(a.count) }
    const mark = a.quantity ?? (a.count?.version === 2 ? a.count : null)
    if (!mark) return
    if (condition === undefined) delete mark.condition; else mark.condition = condition
    const itemId = a.quantity?.itemId ?? countFixtureId(a.count!)
    this.lastCondition.set(itemId, condition)
  }
  fixtureRemovalCounts(id: string): { deleted: number; detached: number } {
    let deleted = 0, detached = 0
    for (const a of this.annotations.values()) if (!a.deleted) {
      if (a.count && countFixtureId(a.count) === id || a.quantity?.itemId === id && !a.quantity.extra?.length) deleted++
      else if (a.quantity && (a.quantity.itemId === id || a.quantity.extra?.some(e => e.itemId === id))) detached++
    }
    return { deleted, detached }
  }
  visibleCountTotal(pageIndex: number): number {
    const index = this.quantityIndex()
    if (!this.visibleCountCache || this.visibleCountCache.index !== index || this.visibleCountCache.visibilityVersion !== this.visibilityVersion) {
      this.visibleCountCache = { index, visibilityVersion: this.visibilityVersion, pages: new Map() }
    }
    const cache = this.visibleCountCache.pages, previous = cache.get(pageIndex)
    if (previous !== undefined) return previous
    let n = 0
    for (const entry of index.countEntriesOnPage(pageIndex)) {
      const a = this.annotations.get(entry.annotationId)
      if (a && this.isShownOnDrawing(a)) n++
    }
    cache.set(pageIndex, n)
    return n
  }
  countOverlayObjNums(pageIndex: number): number[] {
    if (!this.fixturesReady) return []
    const result: number[] = []
    for (const a of this.annotations.values()) if (!a.deleted && a.pageIndex === pageIndex && (a.count && this.fixtureForCount(a.count) || a.quantity && this.getCountFixture(a.quantity.itemId)) && a.objNum !== null) result.push(a.objNum)
    return result
  }
  issueOverlayObjNums(pageIndex: number): number[] {
    const result: number[] = []
    for (const a of this.annotations.values()) if (!a.deleted && !a.legacyChange && a.pageIndex === pageIndex && a.issue && a.issue.recordKind !== 'change' && a.objNum !== null) result.push(a.objNum)
    return result
  }
  setCountFixtures(fixtures: CountFixture[], removeIds: readonly string[] = []): void {
    if (!removeIds.length && stableJson(fixtures) === stableJson(this.fixtures)) return
    serializeCountFixtures(fixtures)
    const before: HistoryState = [], after: HistoryState = []
    before.fixtures = this.getCountFixtures(); after.fixtures = structuredClone(fixtures)
    const renames = new Map(fixtures.map(f => [f.id, fixtureConditionRenames(f)] as const).filter(([, edits]) => edits.size))
    const renamedIds = [...renames.keys()] as string[]
    if (renames.size) { before.pickupMemory = this.pickupMemory(renamedIds); before.routeTemplate = structuredClone(this.routeTemplate) }
    const renameCondition = (itemId: string, v: PartCondition) => typeof v === 'string' ? renames.get(itemId)?.get(v) ?? v : v
    const renameRoute = (itemId: string, c: RouteConditions = {}): RouteConditions => normalizeRouteConditions({ plan: renameCondition(itemId, c.plan), rise: Array.isArray(c.rise) ? c.rise.map(v => renameCondition(itemId, v)) : renameCondition(itemId, c.rise), slack: renameCondition(itemId, c.slack) })
    const renameTemplate = (t: RouteTemplate): RouteTemplate => ({ ...t, cond: renameRoute(t.itemId, t.cond), extra: t.extra.map(e => ({ ...e, cond: renameRoute(e.itemId, e.cond) })) })
    // A longer name repeated across many members/rises can exceed the mark limit.
    // Reject the whole edit before changing fixtures, marks or inheritance memory.
    for (const edits of renames.values()) for (const name of edits.values()) if (!validCondition(name)) throw new Error('改名後の施工条件は1〜30文字で、前後の空白や改行を入れずに入力してください。')
    if (renames.size) for (const a of this.annotations.values()) {
      const q = a.quantity
      if (a.deleted || q?.method !== 'polyline' || !routeMembers(q).some(e => renames.has(e.itemId))) continue
      const renamed = { ...q, cond: renameRoute(q.itemId, q.cond), extra: q.extra?.map(e => ({ ...e, cond: renameRoute(e.itemId, e.cond) })) }
      if (!parseQuantityMark(serializeQuantityMark(renamed))) throw new Error('施工条件の改名で経路の保存容量を超えます。条件名を短くしてください。')
    }
    for (const id of renamedIds) {
      if (this.lastRouteConditions.has(id)) this.lastRouteConditions.set(id, renameRoute(id, this.lastRouteConditions.get(id)))
      if (this.lastCondition.has(id)) this.lastCondition.set(id, renameCondition(id, this.lastCondition.get(id)) as string | undefined)
    }
    // Compositions can reference an edited item as an extra member of another item.
    const memoryIds = [...new Set([...renamedIds, ...[...this.lastRouteMembers].filter(([, t]) => [t.itemId, ...t.extra.map(e => e.itemId)].some(id => renames.has(id))).map(([id]) => id)])]
    if (renames.size) before.pickupMemory = [...before.pickupMemory!, ...this.pickupMemory(memoryIds.filter(id => !renames.has(id)))]
    for (const [id, t] of this.lastRouteMembers) if (memoryIds.includes(id)) this.lastRouteMembers.set(id, renameTemplate(t))
    if (this.routeTemplate && renames.size) this.routeTemplate = renameTemplate(this.routeTemplate)
    if (renames.size) { after.pickupMemory = this.pickupMemory(memoryIds); after.routeTemplate = structuredClone(this.routeTemplate) }
    const appearance = (f: CountFixture | undefined) => f ? stableJson([f.name, f.code, f.spec, f.style, f.line]) : ''
    const changed = new Set(fixtures.filter(f => appearance(f) !== appearance(this.getCountFixture(f.id))).map(f => f.id))
    this.fixtures = structuredClone(fixtures)
    this.recentFixtures = this.recentFixtures.filter(id => fixtures.some(f => f.id === id))
    for (const a of this.annotations.values()) if (!a.deleted && (a.count || a.quantity)) {
      const id = a.quantity?.itemId ?? countFixtureId(a.count!)
      const routeIds = [id, ...(a.quantity?.extra ?? []).map(e => e.itemId)]
      if (!routeIds.some(id => removeIds.includes(id) || changed.has(id) || renames.has(id))) continue
      before.push(cloneState(a))
      if (a.quantity?.method !== 'polyline' && a.quantity?.condition !== undefined) a.quantity.condition = renameCondition(id, a.quantity.condition) as string
      if (a.count?.version === 2 && a.count.condition !== undefined) a.count.condition = renameCondition(id, a.count.condition) as string
      if (a.quantity) {
        if (a.quantity.method === 'polyline') {
          a.quantity.cond = renameRoute(a.quantity.itemId, a.quantity.cond)
          a.quantity.extra = a.quantity.extra?.map(e => ({ ...e, cond: renameRoute(e.itemId, e.cond) }))
        }
        const remaining = routeMembers(a.quantity).filter(e => !removeIds.includes(e.itemId))
        if (!remaining.length) { a.deleted = true; this.selection.delete(a.id) }
        else {
          const [main, ...extra] = remaining
          a.quantity = { ...a.quantity, itemId: main.itemId, cond: main.cond, count: a.quantity.method === 'polyline' && main.count !== 1 ? main.count : undefined, extra: extra.length ? extra : undefined }
          this.applyFixtureToQuantity(a, this.getCountFixture(main.itemId)!); after.push(cloneState(a))
        }
      } else if (removeIds.includes(id)) { a.deleted = true; this.selection.delete(a.id) }
      else { this.applyFixtureToMark(a, this.getCountFixture(id)!); after.push(cloneState(a)) }
      this.markTouched(a); a.revision++
    }
    this.history.push({ before, after }); this.pruneHiddenSelection(); this.notify()
  }
  reassignCounts(ids: readonly string[], fixtureId: string): string | undefined {
    const fixture = this.getCountFixture(fixtureId)
    if (!fixture) return
    for (const id of ids) {
      const q = this.annotations.get(id)?.quantity, match = q?.extra?.find(e => e.itemId === fixtureId)
      if (q && match && routeConditionsKey(q.cond) !== routeConditionsKey(match.cond)) return '施工条件または数える部分が異なるため、項目を変更できません。先にそろえてください。'
      if (q && match && (q.count ?? 1) + match.count > 99) return '条数の合計が99を超えるため、項目を変更できません。'
    }
    const before: HistoryState = [], after: HistoryState = []
    for (const id of ids) {
      const a = this.annotations.get(id)
      if (!a || a.deleted || !(a.count && quantityKind(fixture) === 'count' || a.quantity && quantityMethod(fixture) === a.quantity.method)) continue
      before.push(cloneState(a)); if (a.quantity) {
        const match = a.quantity.extra?.find(e => e.itemId === fixtureId)
        if (match) {
          const count = (a.quantity.count ?? 1) + match.count
          a.quantity = { ...a.quantity, count, extra: a.quantity.extra!.filter(e => e.itemId !== fixtureId) }
          if (!a.quantity.extra!.length) delete a.quantity.extra
        }
        this.applyFixtureToQuantity(a, fixture)
      } else this.applyFixtureToMark(a, fixture); this.markTouched(a); a.revision++; after.push(cloneState(a))
    }
    if (before.length) this.history.push({ before, after })
    this.pruneHiddenSelection(); this.notify()
  }
  quantityText(a: Pick<EditableAnnotation, 'quantity' | 'vertices' | 'measure' | 'text'>, points = a.vertices): string {
    if (!points || !a.measure) return a.text
    if (!a.quantity) return measureText(points, a.measure)
    const f = this.getCountFixture(a.quantity.itemId)
    if (!f) return a.text
    return quantityLabel(points, a.measure.mmPerPoint, a.quantity, fixtureCode(f), f.style.showCode, id => { const item = this.getCountFixture(id); return item ? fixtureCode(item) : id })
  }
  private applyFixtureToQuantity(a: StoredAnnotation, fixture: CountFixture): void {
    a.quantity = { ...a.quantity!, itemId: fixture.id }
    a.color = [...fixture.style.color]; a.opacity = fixture.style.opacity; a.fontSize = fixture.style.size
    a.borderWidth = quantityLine(fixture).width; a.quantityDash = quantityLine(fixture).dash
    a.text = this.quantityText(a); if (a.vertices && a.measure) a.rect = measureBounds(a.vertices, a.measure.kind, a.text, a.fontSize)
  }
  updateQuantityAdd(id: string, addM: number): void {
    const q = this.get(id)?.quantity
    if (q?.method !== 'polyline' || routeRises(q).length > 1) return
    this.setRouteRises(id, [{ ...routeRises(q)[0], m: addM }])
  }
  updateQuantityValues(id: string, values: Partial<Pick<QuantityMark, 'addM' | 'slackM' | 'heightM' | 'widthM' | 'depthM'>>): void {
    const current = this.get(id)
    if (!current?.quantity) return
    const allowed: readonly string[] = current.quantity.method === 'polyline' ? ['addM', 'slackM'] : quantityDimensions(current.quantity.method)
    if (values.addM !== undefined && routeRises(current.quantity).length > 1) return
    const entries = Object.entries(values)
    if (!entries.length || entries.some(([key, n]) => !allowed.includes(key) || typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-8)) return
    if (entries.every(([key, n]) => (current.quantity![key as keyof typeof values] ?? 0) === n)) return
    this.mutate(id, a => {
      a.quantity = { ...a.quantity!, ...values }
      if (values.addM !== undefined) {
        const oldRises = routeRises(current.quantity!)
        a.quantity.rises = [{ ...oldRises[0], m: values.addM }]
        if (!oldRises.length) {
          const resize = (c: RouteConditions = {}) => normalizeRouteConditions({ ...c, ...(Array.isArray(c.rise) ? { rise: [c.rise[0]] } : {}) })
          a.quantity.cond = resize(a.quantity.cond)
          if (a.quantity.extra) a.quantity.extra = a.quantity.extra.map(e => ({ ...e, cond: resize(e.cond) }))
        }
      }
      if (!a.quantity.addM && a.quantity.rises === undefined) delete a.quantity.addM
      if (!a.quantity.slackM) delete a.quantity.slackM
      a.text = this.quantityText(a); a.rect = measureBounds(a.vertices!, a.measure!.kind, a.text, a.fontSize)
    })
  }
  fixtureMarkCount(id: string): number {
    return [...this.annotations.values()].filter(a => !a.deleted && (a.quantity?.itemId === id || a.quantity?.extra?.some(e => e.itemId === id) || a.count && countFixtureId(a.count) === id)).length
  }
  selectedQuantitiesOnly(): boolean {
    const annotations = this.selectedIds().map(id => this.annotations.get(id)!)
    return annotations.length > 0 && annotations.every(a => !!a.quantity)
  }
  private applyFixtureToMark(a: StoredAnnotation, fixture: CountFixture): void {
    const x = (a.rect[0] + a.rect[2]) / 2, y = (a.rect[1] + a.rect[3]) / 2, r = fixture.style.size / 2
    a.count = { ...(a.count?.version === 2 ? a.count : {}), version: 2, id: a.count!.id, fixtureId: fixture.id }; a.rect = [x - r, y - r, x + r, y + r]
    a.color = [...fixture.style.color]; a.opacity = fixture.style.opacity; a.text = `個数: ${fixtureCode(fixture)} ${fixture.name}`.trim()
  }

  setScale(pageIndices: readonly number[], scale: PageScale, recalculate: boolean): void {
    const before: HistoryState = [], after: HistoryState = []
    const changedPages = pageIndices.filter(pageIndex => stableJson(this.getScale(pageIndex)) !== stableJson(scale))
    before.scales = changedPages.map(pageIndex => ({ pageIndex, scale: this.getScale(pageIndex) }))
    after.scales = changedPages.map(pageIndex => ({ pageIndex, scale: { ...scale } }))
    for (const pageIndex of pageIndices) {
      if (changedPages.includes(pageIndex)) this.scales.set(pageIndex, { ...scale })
      if (!recalculate) continue
      for (const a of this.annotations.values()) {
        if (a.deleted || a.pageIndex !== pageIndex || !a.measure || !a.vertices) continue
        if (a.vertices[0] && resolveScale(null, this.scaleRegions.get(pageIndex), a.vertices[0])) continue
        const previous = cloneState(a)
        a.measure = { ...a.measure, mmPerPoint: scale.mmPerPoint, unit: scale.unit, decimals: scale.decimals }
        a.text = this.quantityText(a); a.rect = measureBounds(a.vertices, a.measure.kind, a.text, a.fontSize)
        if (samePersisted(previous, a)) continue
        before.push(previous)
        this.markTouched(a); a.revision++; after.push(cloneState(a))
      }
    }
    if (!changedPages.length && !before.length) return
    this.history.push({ before, after }); this.notify()
  }

  updateMeasureVertices(id: string, points: Point[]): void {
    this.mutate(id, a => {
      if (a.kind === 'cloudPolygon') {
        a.vertices = clonePoints(points); a.rect = bounds(points); return
      }
      if (!a.measure) return
      a.vertices = points.map(p => [...p] as Point); a.text = this.quantityText(a, points)
      a.rect = measureBounds(points, a.measure.kind, a.text, a.fontSize)
    })
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
    return [...this.selection].filter((id) => { const a = this.annotations.get(id); return !!a && !a.deleted && this.isShownOnDrawing(a) })
  }

  primarySelection(): string | null {
    return this.selectedIds().at(-1) ?? null
  }
  selectedPickupsOnly(): boolean {
    const ids = this.selectedIds()
    return ids.length > 0 && ids.every(id => { const a = this.annotations.get(id); return !!(a?.count || a?.quantity) })
  }
  selectedCountsOnly(): boolean {
    const ids = this.selectedIds()
    return ids.length > 0 && ids.every(id => !!this.annotations.get(id)?.count)
  }

  isSelected(id: string): boolean {
    return this.selection.has(id) && this.annotations.get(id)?.deleted === false
  }

  selectOnly(id: string | null): void {
    const a = id ? this.annotations.get(id) : undefined
    const next = id && a && !a.deleted && this.isShownOnDrawing(a) ? [id] : []
    if (this.selectedIds().length === next.length && next.every((value) => this.selection.has(value))) return
    this.selection.clear()
    for (const value of next) this.selection.add(value)
    this.notify(false)
  }

  toggleSelection(id: string): void {
    const a = this.annotations.get(id)
    if (!a || a.deleted || !this.isShownOnDrawing(a)) return
    if (this.selection.has(id)) this.selection.delete(id)
    else this.selection.add(id)
    this.notify(false)
  }

  clearSelection(): void {
    if (this.selection.size === 0) return
    this.selection.clear()
    this.notify(false)
  }

  selectInRect(pageIndex: number, rect: Rect): string[] {
    const normalized: Rect = [
      Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]),
      Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3]),
    ]
    this.selection.clear()
    for (const annotation of this.getPageAnnotations(pageIndex)) {
      if (this.isShownOnDrawing(annotation) && annotationInsideSelection(annotation, normalized)) this.selection.add(annotation.id)
    }
    this.notify(false)
    return this.selectedIds()
  }

  copySelected(): EditableAnnotation[] {
    return this.selectedIds().flatMap((id) => {
      const annotation = this.annotations.get(id)
      return annotation && !annotation.deleted && !annotation.legacyChange && !isTextMarkup(annotation.kind) ? [publicAnnotation(annotation, this.isAnnotationDirty(annotation))] : []
    })
  }

  create(input: {
    quantity?: QuantityMark | null
    quantityDash?: QuantityLineStyle['dash']
    count?: CountMark | null
    issue?: Issue | null
    cloudIntensity?: CloudIntensity | null
    measure?: MeasureSettings | null
    vertices?: Point[] | null
    pageIndex: number
    kind: Kind
    rect: Rect
    text?: string
    fontSize?: number
    font?: FontName
    color?: RGB
    arrowHeadSize?: number | null
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
    deferNotify?: boolean
  }): EditableAnnotation {
    const id = `new-${this.nextNewId++}`
    let quantity = input.quantity ? cloneQuantity(input.quantity) : null
    let count = input.count ? { ...input.count } : null
    if (quantity?.method === 'polyline') {
      if (quantity.cond === undefined) {
        const template = this.routeTemplateItems(quantity.itemId)
        if (quantity.count === undefined && quantity.extra === undefined) quantity = { ...quantity, ...template }
        else quantity.cond = this.newRouteConditions(quantity.itemId)
      }
      if (quantity.extra) quantity.extra = quantity.extra.map(e => ({ ...e, ...(e.cond === undefined ? { cond: this.newRouteConditions(e.itemId) } : {}) }))
      quantity = parseQuantityMark(serializeQuantityMark(quantity))
      if (!quantity) throw new Error('数量拾いの値が不正です。')
    } else if (quantity && quantity.condition === undefined) quantity.condition = this.newCondition(quantity.itemId)
    if (count?.version === 2 && count.condition === undefined) count.condition = this.newCondition(count.fixtureId)
    const annotation: StoredAnnotation = {
      quantity, quantityDash: input.quantityDash,
      count,
      issue: input.kind === 'issue' ? input.issue ? { ...input.issue } : { number: this.issueNumbers.next(), status: 'open', version: 1, id: crypto.randomUUID() } : null,
      cloudIntensity: input.cloudIntensity ?? (input.kind === 'cloudSquare' || input.kind === 'cloudPolygon' ? 1 : null),
      id,
      objNum: null,
      pageIndex: input.pageIndex,
      kind: input.kind,
      measure: input.measure ? { ...input.measure } : null,
      vertices: input.vertices?.map(p => [...p] as Point) ?? null,
      rect: [...input.rect],
      text: input.text ?? '',
      fontSize: input.fontSize ?? DEFAULT_FONT_SIZE,
      font: input.font ?? 'BIZUDGothic',
      color: [...(input.color ?? DEFAULT_COLOR)],
      arrowHeadSize: input.arrowHeadSize ?? null,
      borderWidth: input.borderWidth ?? DEFAULT_BORDER_WIDTH,
      opacity: input.opacity ?? 1,
      textOpacity: input.textOpacity ?? 1,
      boxOpacity: input.boxOpacity ?? 1,
      interiorColor: input.interiorColor ? [...input.interiorColor] : null,
      borderColor: input.borderColor === undefined
        ? (input.kind === 'square' || input.kind === 'circle' || input.kind === 'cloudSquare' || input.kind === 'cloudPolygon' ? [...(input.color ?? DEFAULT_COLOR)] : null)
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
    if (this.followsFilter && !matchesAnnotationFilter(annotation, this.filter)) this.releaseDrawingFilter('隠れている種類の書き込みを作ったため')
    if (annotation.quantity) this.revealCountFixture(annotation.quantity.itemId)
    if (annotation.count) this.revealCountFixture(countFixtureId(annotation.count))
    if (quantity?.method === 'polyline') this.rememberRoute(quantity)
    else if (quantity?.condition !== undefined) this.lastCondition.set(quantity.itemId, quantity.condition)
    if (count?.version === 2 && count.condition !== undefined) this.lastCondition.set(count.fixtureId, count.condition)
    this.annotations.set(id, annotation)
    if (input.quantity) this.rememberFixture(input.quantity.itemId)
    else if (input.count) this.rememberFixture(countFixtureId(input.count))
    if (annotation.issue) this.issueNumbers.observe(annotation.issue.number)
    if (input.deferHistory) this.pendingCreations.add(id)
    else this.history.push({ before: [], after: [cloneState(annotation)] })
    if (!input.deferNotify) this.notify()
    return this.get(id)!
  }

  touch(id: string): EditableAnnotation | undefined {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted) return undefined
    if (annotation.legacyChange) return this.get(id)
    if (annotation.objNum !== null) {
      const touched = this.touchedByPage.get(annotation.pageIndex) ?? new Set<number>()
      if (!touched.has(annotation.objNum)) {
        touched.add(annotation.objNum)
        this.touchedByPage.set(annotation.pageIndex, touched)
        this.notify(false)
      }
    }
    return this.get(id)
  }

  move(id: string, dx: number, dy: number): void {
    this.mutate(id, (annotation) => {
      if (dx === 0 && dy === 0) return
      annotation.rect = [annotation.rect[0] + dx, annotation.rect[1] + dy, annotation.rect[2] + dx, annotation.rect[3] + dy]
      if (annotation.vertices) annotation.vertices = annotation.vertices.map(p => [p[0] + dx, p[1] + dy])
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
      if (annotation.vertices) annotation.vertices = annotation.vertices.map(p => [p[0] + dx, p[1] + dy])
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
      if (annotation.vertices) annotation.vertices = annotation.vertices.map(p => [p[0] + dx, p[1] + dy])
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
      if (annotation.vertices && annotation.measure) {
        annotation.vertices = annotation.vertices.map(p => mapPoint(p, previous, rect))
        annotation.text = this.quantityText(annotation)
      }
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
    countGroup?: string
    issueStatus?: Issue['status']
    cloudIntensity?: CloudIntensity
    color?: RGB
    arrowHeadSize?: number | null
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
      if (values.countGroup !== undefined && annotation.count?.version === 1 && values.countGroup.trim() && values.countGroup.length <= 80) annotation.count.group = values.countGroup.trim()
      if (values.issueStatus && annotation.issue) annotation.issue.status = values.issueStatus
      if (values.cloudIntensity !== undefined) annotation.cloudIntensity = values.cloudIntensity
      if (values.color) annotation.color = [...values.color]
      if (values.arrowHeadSize !== undefined) annotation.arrowHeadSize = values.arrowHeadSize
      if (values.borderWidth !== undefined) annotation.borderWidth = values.borderWidth
      if (values.interiorColor !== undefined) annotation.interiorColor = values.interiorColor ? [...values.interiorColor] : null
      if (values.borderColor !== undefined) annotation.borderColor = values.borderColor ? [...values.borderColor] : null
      if (values.opacity !== undefined) annotation.opacity = values.opacity
      if (values.textOpacity !== undefined) annotation.textOpacity = values.textOpacity
      if (values.boxOpacity !== undefined) annotation.boxOpacity = values.boxOpacity
      if (values.symbol !== undefined && annotation.kind === 'symbol') annotation.symbol = values.symbol
      if (values.fontSize !== undefined && (annotation.measure || annotation.kind === 'freetext' || annotation.kind === 'callout')) annotation.fontSize = values.fontSize
      if (values.font !== undefined && (annotation.kind === 'freetext' || annotation.kind === 'callout')) annotation.font = values.font
      if (values.layout && (annotation.kind === 'freetext' || annotation.kind === 'callout')) annotation.layout = values.layout
      if (values.rect) annotation.rect = [...values.rect]
      if (annotation.measure && annotation.vertices && values.fontSize !== undefined) annotation.rect = measureBounds(annotation.vertices, annotation.measure.kind, annotation.text, annotation.fontSize)
      if (annotation.kind === 'callout' && annotation.calloutPoint) {
        annotation.calloutLine = [[...annotation.calloutPoint], nearestCalloutEdgePoint(annotation.rect, annotation.calloutPoint)]
      }
    })
  }

  updateIssueDetails(id: string, values: Partial<Omit<Issue, 'number' | 'id' | 'version'>>): void {
    this.mutate(id, annotation => {
      if (!annotation.issue) return
      const next = parseIssue(JSON.stringify({ ...annotation.issue, ...values, version: 1, id: annotation.issue.id ?? crypto.randomUUID() }))
      if (!next) throw new Error('指摘の情報が不正、または長すぎます。')
      annotation.issue = next
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
    options: { keepIssueNumbers?: boolean } = {},
  ): string[] {
    source = source.filter(a => !a.legacyChange && a.issue?.recordKind !== 'change')
    if (source.length === 0) return []
    const usedNumbers = options.keepIssueNumbers
      ? new Set([...this.annotations.values()].filter(a => !a.deleted && a.issue && a.issue.recordKind !== 'change').map(a => a.issue!.number)) : new Set<number>()
    // Reserve all retained numbers before allocating replacements for collisions.
    if (options.keepIssueNumbers) for (const item of source) if (item.issue) this.issueNumbers.observe(item.issue.number)
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
      let issue: Issue | null = null
      if (item.issue) {
        const number = options.keepIssueNumbers && !usedNumbers.has(item.issue.number) ? item.issue.number : this.issueNumbers.next()
        if (options.keepIssueNumbers) { usedNumbers.add(number); this.issueNumbers.observe(number) }
        issue = { ...item.issue, number, version: 1, id: crypto.randomUUID(),
          ...(options.keepIssueNumbers ? { sourceNumber: item.issue.number } : {}) }
      }
      const annotation = this.create({
        quantity: item.quantity ? { ...item.quantity, id: crypto.randomUUID() } : null,
        count: item.count ? { ...item.count, id: crypto.randomUUID() } : null,
        issue,
        cloudIntensity: item.cloudIntensity,
        pageIndex,
        kind: item.kind,
        rect: [item.rect[0] + dx, item.rect[1] + dy, item.rect[2] + dx, item.rect[3] + dy],
        quantityDash: item.quantityDash,
        measure: item.measure,
        vertices: item.vertices?.map(p => [p[0] + dx, p[1] + dy]) ?? null,
        text: item.text,
        fontSize: item.fontSize,
        font: item.font,
        color: item.color,
        borderWidth: item.borderWidth,
        arrowHeadSize: item.arrowHeadSize ?? null,
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
    this.notify(!!(step.before.length || step.after.length || step.before.fixtures || step.before.scales || step.before.scaleRegions))
  }

  updateIssueText(id: string, text: string): void {
    this.mutate(id, a => { if (a.issue) a.text = text })
  }

  renumberIssues(): void {
    const sorted = issueOrder([...this.annotations.values()].filter(a => !a.deleted && !a.legacyChange && a.issue && a.issue.recordKind !== 'change'))
    if (!sorted.length) return
    const before: HistoryState = sorted.map(cloneState)
    before.issueMaximum = this.issueNumbers.current
    sorted.forEach((a, i) => { a.issue = { ...a.issue!, number: i + 1 }; this.markTouched(a); a.revision++ })
    const after: HistoryState = sorted.map(cloneState)
    after.issueMaximum = sorted.length
    this.issueNumbers.renumber(sorted.length)
    this.history.push({ before, after }); this.notify()
  }

  redo(): void {
    const step = this.history.redo()
    if (!step) return
    this.restoreMany(step.after, step.before)
    this.notify(!!(step.before.length || step.after.length || step.after.fixtures || step.after.scales || step.after.scaleRegions))
  }

  touchedObjNums(pageIndex: number): number[] {
    return [...(this.touchedByPage.get(pageIndex) ?? [])].filter(objNum => {
      const annotation = this.annotations.get(`obj-${objNum}`)
      return !annotation?.legacyChange || annotation.deleted
    }).sort((a, b) => a - b)
  }

  toEdits(): AnnotationEdit[] {
    // Migration is a save operation, never a side effect of opening the PDF.
    const dirty = this.isDirty()
    let normalized = false
    if (dirty) for (const a of this.annotations.values()) {
      if (a.deleted || a.legacyChange || !a.issue || a.issue.recordKind === 'change') continue
      const color = issueColor(a.issue, a.color)
      if (a.color.some((component, i) => component !== color[i])) { a.color = color; normalized = true }
    }
    if (this.fixturesReady && dirty) for (const id of this.legacyCountObjects) {
      const a = this.annotations.get(id), f = this.fixtureForCount(a?.count)
      if (a && !a.deleted && a.count?.version === 1 && f) { this.applyFixtureToMark(a, f); normalized = true }
    }
    // These save-time corrections do not go through notify().
    if (normalized) this.dirtyCache = null
    const entries = this.editEntries()
    this.pendingEdits = entries.map(({ annotation, edit }) => ({
      id: annotation.id,
      annotation,
      revision: annotation.revision,
      state: annotation.deleted ? null : cloneState(annotation),
      edit,
    }))
    const edits = entries.map(({ edit }) => edit)
    this.pendingScales = [...this.scales].filter(([i, scale]) => stableJson(scale) !== stableJson(this.scaleBaselines.get(i) ?? null)).map(([pageIndex, scale], i) => ({ pageIndex, scale: scale ? { ...scale } : null, editIndex: edits.length + i }))
    const result: AnnotationEdit[] = [...edits, ...this.pendingScales.map(({ pageIndex, scale }) => ({ kind: 'setPageScale' as const, pageIndex, scale }))]
    this.pendingScaleRegions = [...this.scaleRegions].filter(([i, regions]) => stableJson(regions) !== stableJson(this.scaleRegionBaselines.get(i) ?? [])).map(([pageIndex, regions], i) => ({ pageIndex, regions: structuredClone(regions), editIndex: result.length + i }))
    result.push(...this.pendingScaleRegions.map(({ pageIndex, regions }) => ({ kind: 'setScaleRegions' as const, pageIndex, regions })))
    this.pendingDrawings = [...this.drawings].filter(([i, info]) => stableJson(info) !== stableJson(this.drawingBaselines.get(i) ?? null)).map(([pageIndex, info], i) => ({ pageIndex, info: info ? { ...info } : null, editIndex: result.length + i }))
    result.push(...this.pendingDrawings.map(({ pageIndex, info }) => ({ kind: 'setDrawingInfo' as const, pageIndex, info })))
    this.pendingFixtureSave = null
    if (this.fixturesReady && (stableJson(this.fixtures) !== this.fixtureBaseline || entries.some(e => e.annotation.count))) {
      this.pendingFixtureSave = { editIndex: result.length, json: stableJson(this.fixtures) }
      result.push({ kind: 'setCountFixtures', pageIndex: 0, fixtures: this.getCountFixtures() })
    }
    return result
  }

  markApplied(result: SaveResult): void {
    const pending = this.pendingEdits
    this.pendingEdits = []
    const failed = new Set(result.errors?.map((error) => error.editIndex) ?? [])
    if (this.pendingFixtureSave && !failed.has(this.pendingFixtureSave.editIndex)) this.fixtureBaseline = this.pendingFixtureSave.json
    this.pendingFixtureSave = null
    for (const item of this.pendingScales) if (!failed.has(item.editIndex)) this.scaleBaselines.set(item.pageIndex, item.scale)
    this.pendingScales = []
    for (const item of this.pendingScaleRegions) if (!failed.has(item.editIndex)) this.scaleRegionBaselines.set(item.pageIndex, structuredClone(item.regions))
    this.pendingScaleRegions = []
    for (const item of this.pendingDrawings) if (!failed.has(item.editIndex)) { this.drawingBaselines.set(item.pageIndex, item.info); this.drawingDirtyBaselines.set(item.pageIndex, this.automaticDrawings.has(item.pageIndex) ? mergeAutomaticDrawingInfo(item.info, this.automaticDrawings.get(item.pageIndex)!) : item.info) }
    this.pendingDrawings = []
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
    const summary = this.dirtySummary()
    return summary.annotations > 0 || summary.fixtures || summary.scales.length > 0 || summary.drawings.length > 0
  }

  dirtySummary(): DirtySummary {
    if (this.dirtyCache?.version === this.version) return this.dirtyCache.summary
    const summary: DirtySummary = {
      annotations: this.editEntries().length,
      fixtures: stableJson(this.fixtures) !== this.fixtureBaseline,
      scales: [...new Set([...this.scales].filter(([i, scale]) => stableJson(scale) !== stableJson(this.scaleBaselines.get(i) ?? null)).map(([i]) => i).concat([...this.scaleRegions].filter(([i, regions]) => stableJson(regions) !== stableJson(this.scaleRegionBaselines.get(i) ?? [])).map(([i]) => i)))].sort((a, b) => a - b),
      drawings: [...this.drawings].filter(([i, info]) => stableJson(info) !== stableJson(this.drawingDirtyBaselines.get(i) ?? null)).map(([i]) => i).sort((a, b) => a - b),
    }
    this.dirtyCache = { version: this.version, summary }
    return summary
  }

  private mutate(id: string, change: (annotation: StoredAnnotation) => void, rememberPickup = false): void {
    const annotation = this.annotations.get(id)
    if (!annotation || annotation.deleted || annotation.legacyChange) return
    const before = cloneState(annotation)
    const memoryIds = rememberPickup ? this.pickupMemoryIds([before]) : [], previousMemory = rememberPickup ? this.pickupMemory(memoryIds) : undefined
    change(annotation)
    if (rememberPickup && annotation.quantity && serializeQuantityMark(annotation.quantity).length > 8000) {
      Object.assign(annotation, before); if (previousMemory) this.restorePickupMemory(previousMemory); return
    }
    const after = cloneState(annotation)
    if (samePersisted(before, after)) return
    this.markTouched(annotation)
    annotation.revision += 1
    this.history.push({ before: Object.assign([before], { pickupMemory: previousMemory }), after: Object.assign([after], { pickupMemory: rememberPickup ? this.pickupMemory(memoryIds) : undefined }) })
    if (this.drawingFilterActive()) this.pruneHiddenSelection()
    this.notify()
  }

  private mutateMany(ids: readonly string[], change: (annotation: StoredAnnotation) => void, rememberPickup = false, fixtures?: CountFixture[]): void {
    const before: HistoryState = []
    const after: HistoryState = []
    const memoryIds = rememberPickup ? this.pickupMemoryIds(ids.flatMap(id => { const a = this.annotations.get(id); return a && !a.deleted && !a.legacyChange ? [a] : [] })) : []
    if (rememberPickup) before.pickupMemory = this.pickupMemory(memoryIds)
    for (const id of [...new Set(ids)]) {
      const annotation = this.annotations.get(id)
      if (!annotation || annotation.deleted || annotation.legacyChange) continue
      const previous = cloneState(annotation)
      const itemMemory = rememberPickup ? this.pickupMemory(this.pickupMemoryIds([previous])) : undefined
      change(annotation)
      if (rememberPickup && annotation.quantity && serializeQuantityMark(annotation.quantity).length > 8000) {
        Object.assign(annotation, previous)
        if (itemMemory) this.restorePickupMemory(itemMemory)
        continue
      }
      const next = cloneState(annotation)
      if (samePersisted(previous, next)) continue
      this.markTouched(annotation)
      annotation.revision += 1
      before.push(previous)
      after.push(next)
    }
    if (before.length === 0 && !fixtures) return
    if (fixtures) { before.fixtures = this.getCountFixtures(); after.fixtures = structuredClone(fixtures); this.fixtures = structuredClone(fixtures) }
    if (rememberPickup) after.pickupMemory = this.pickupMemory(memoryIds)
    this.history.push({ before, after })
    if (this.drawingFilterActive()) this.pruneHiddenSelection()
    this.notify()
  }

  private restoreMany(target: HistoryState, counterpart: HistoryState): void {
    if (target.pickupMemory) this.restorePickupMemory(target.pickupMemory)
    if (target.routeTemplate !== undefined) this.routeTemplate = structuredClone(target.routeTemplate)
    for (const item of target.drawings ?? []) {
      const auto = this.automaticDrawings.get(item.pageIndex)
      this.drawings.set(item.pageIndex, auto ? mergeAutomaticDrawingInfo(item.info, auto) : item.info)
    }
    if (target.fixtures) this.fixtures = structuredClone(target.fixtures)
    if (target.issueMaximum !== undefined) this.issueNumbers.renumber(target.issueMaximum)
    for (const item of target.scales ?? []) this.scales.set(item.pageIndex, item.scale ? { ...item.scale } : null)
    for (const item of target.scaleRegions ?? []) this.scaleRegions.set(item.pageIndex, structuredClone(item.regions))
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
    this.pruneHiddenSelection()
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
    if (annotation.legacyChange) {
      if (!annotation.legacyChangeData) throw new Error('旧版変更記録の復元データがありません。')
      return { kind: 'createLegacyChange', pageIndex: annotation.pageIndex, data: annotation.legacyChangeData }
    }
    if (annotation.issue) {
      const common = { pageIndex: annotation.pageIndex, rect: annotation.rect, issue: annotation.issue, text: annotation.text, color: annotation.color }
      return create ? { kind: 'createIssue', ...common } : { kind: 'updateIssue', objNum: savedObjNum, ...common }
    }
    if (annotation.kind === 'cloudSquare' || annotation.kind === 'cloudPolygon') {
      const common = { pageIndex: annotation.pageIndex, rect: annotation.rect, vertices: annotation.vertices ?? null, shape: annotation.kind === 'cloudSquare' ? 'square' as const : 'polygon' as const,
        color: annotation.color, borderWidth: annotation.borderWidth, interiorColor: annotation.interiorColor, opacity: annotation.opacity, cloudIntensity: annotation.cloudIntensity ?? 1 as CloudIntensity }
      return create ? { kind: 'createCloud', ...common } : { kind: 'updateCloud', objNum: savedObjNum, ...common }
    }
    if (annotation.measure && annotation.vertices) {
      const common = { quantity: annotation.quantity, quantityDash: annotation.quantityDash, pageIndex: annotation.pageIndex, vertices: annotation.vertices, measure: annotation.measure, text: annotation.text, color: annotation.color, borderWidth: annotation.borderWidth, fontSize: annotation.fontSize, opacity: annotation.opacity }
      return create ? { kind: 'createMeasure', ...common } : { kind: 'updateMeasure', objNum: savedObjNum, ...common }
    }
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
        arrowHeadSize: annotation.arrowHeadSize ?? null,
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
        arrowHeadSize: annotation.arrowHeadSize ?? null,
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
      const fixture = this.fixtureForCount(annotation.count)
      const common = {
        pageIndex: annotation.pageIndex,
        rect: annotation.rect,
        color: annotation.color,
        symbol: annotation.symbol ?? 'check' as const,
        count: annotation.count && fixture ? { ...(annotation.count.version === 2 ? annotation.count : {}), version: 2 as const, id: annotation.count.id, fixtureId: fixture.id } : annotation.count,
        countFixture: fixture,
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
    step: HistoryStep<HistoryState>,
    mapper: (state: AnnotationState) => AnnotationState,
  ): HistoryStep<HistoryState> {
    return { before: Object.assign(step.before.map(mapper), { routeTemplate: step.before.routeTemplate, pickupMemory: step.before.pickupMemory, drawings: step.before.drawings, scales: step.before.scales, scaleRegions: step.before.scaleRegions, issueMaximum: step.before.issueMaximum, fixtures: step.before.fixtures }), after: Object.assign(step.after.map(mapper), { routeTemplate: step.after.routeTemplate, pickupMemory: step.after.pickupMemory, drawings: step.after.drawings, scales: step.after.scales, scaleRegions: step.after.scaleRegions, issueMaximum: step.after.issueMaximum, fixtures: step.after.fixtures }) }
  }

  private markTouched(annotation: AnnotationState): void {
    if (annotation.objNum === null) return
    const touched = this.touchedByPage.get(annotation.pageIndex) ?? new Set<number>()
    touched.add(annotation.objNum)
    this.touchedByPage.set(annotation.pageIndex, touched)
  }

  private notify(quantityChanged = true): void {
    if (quantityChanged) { this.quantityVersion += 1; this.refreshSymbolCandidates() }
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}
