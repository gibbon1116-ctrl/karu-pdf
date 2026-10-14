import { QuantityIndex } from '../core/quantityIndex'
import { isRouteSurfaceFixture, surfacePerimeterM } from '../core/routeSurface'
import { nextRoutePointAt } from '../core/routePointAdd'
import { perfCount, perfTime } from '../perf/counters'
import { stableJson } from '../core/stableJson'
import { parseQuantityCheckBasics, type QuantityCheckBasics } from '../core/quantityCheckBasics'
import { parseRelatedReviews, serializeRelatedReviews, type RelatedReviews, type RelatedReviewDecision } from '../core/related/reviews'
import type { ProjectMode, WorkType } from '../core/related/types'
import type { CheckBasisKey } from '../core/breakdown/checkSheets'
import { floorFromDrawingName, normalizeFloor } from '../core/location'
import { mergeAutomaticDrawingInfo, type DrawingInfo } from '../core/drawingInfo'
import { validRouteScope, type RouteScope, validRouteCount, validRouteConditions, routeConditionsKey, normalizeRouteConditions, conditionsFromScope, withRouteScope, routeMembers, routeRises, validRises, riseTotal, validCondition, quantityLabel, quantityDimensions, parseQuantityMark, serializeQuantityMark, type RouteConditions, type RoutePart, type PartCondition, type Rise, type QuantityMark } from '../core/quantity'
import { fixtureConditionRenames, fixtureCode, fixtureDrawingCode, fixtureLabelCode, quantityKind, quantityMethod, quantityLine, type QuantityLineStyle } from '../core/countFixtures'
import { symbolRectFromDrag, nearestCalloutEdgePoint, type AnnotationColor, type AnnotationEdit, type AnnotationInfo, type LegacyChangeData, type Point, type Rect, type RGB, type SymbolName } from '../core/annotations'
import type { Quad } from 'mupdf'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import { measureBounds, measureText, resolveScale, pointInScaleRegion, validScaleRegion, MAX_SCALE_REGIONS, type ScaleRegion, type MeasureKind, type MeasureSettings, type PageScale } from '../core/measure'
import { History, type HistoryStep } from './history'
import { IssueNumbers, issueColor, issueOrder, parseIssue, type Issue } from '../core/issues'
import type { CloudIntensity } from '../core/cloud'
import { countFixtureId, countMembers, parseCount, validCountComponents, type CountComponent, type CountMark } from '../core/counts'
import { fixtureIdentity, nextCountStyle, serializeCountFixtures, type CountFixture } from '../core/countFixtures'
import { isPerEquipmentComponent, perEquipmentComponentFixture } from '../core/perEquipment'
import { fixtureLinkError } from '../core/fixtureLink'
import { DEFAULT_ANNOTATION_FILTER, filterShowsCountMarks, matchesAnnotationFilter, type AnnotationFilter } from './annotationFilter'
import type { SymbolShapeDecision } from '../core/symbolShapeDecision'
import { parseRoomRegions, parseRoomSets, parseRoomSetLink, pickupPoint, pointInRoomRegion, roomAt, translateRoomRegion, type RoomRegion, type RoomSet, type RoomSetLink } from '../core/rooms'

import { validRoutePerM, validRoutePoints, type RouteExtra, type RoutePoint } from '../core/quantity'
import { fixtureDimensionUpdateEnabled } from '../core/countFixtures'
import { FIXTURE_DIMENSION_KEYS, planFixtureDimensions, type FixtureDimensionValues } from '../core/fixtureDimensions'
import { backfillSummary, calculateBackfillVolume } from '../core/backfill'
import { polylineLength } from '../core/measure'

const EMPTY_EFFECTIVE_ROOM_REGIONS: Array<{ region: RoomRegion; setId?: string }> = []

export type DrawingFilterReleaseReason = '数量拾いの印を数えるため' | '隠れている種類の書き込みを作ったため' | '次の未対応指摘を表示するため' | '数量拾いの印を表示するため'

export interface SymbolSearchCandidate {
  id: string; pageIndex: number; rect: Rect; center: Point; score: number
  state: 'pending' | 'chosen' | 'counted'
  confidence?: 'high' | 'check'; imageScore?: number; extra?: number
  label: string; gc: boolean; around?: number; aroundCheck?: boolean
  shape?: SymbolShapeDecision
  otherFixture?: string
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

export type RelatedAdditionKind = 'route' | 'point' | 'component' | 'factor' | 'perimeter'

export interface RelatedAdditionEffect {
  itemId: string
  name: string
  kind: RelatedAdditionKind | 'source' | 'unchanged' | 'guidance'
  changed?: number
  skipped?: number
  futureApplied?: boolean
  reason?: string
}

export interface RelatedAdditionResult {
  error?: string
  changed: number
  skipped: number
  pointRows: number
  pointSkipped: number
  componentMarks: number
  componentSkipped: number
  linked: number
  sourcesAdded: number
  guidance: number
  effects: RelatedAdditionEffect[]
}

type RelatedAdditionBatch = Array<{ before: HistoryState; after: HistoryState }>

/** 振り分けだけを行う。印の有無と連動の保存検査は実行時に確認する。 */
export function relatedAdditionKind(
  origin: CountFixture,
  target: CountFixture,
  routeId?: string,
): RelatedAdditionKind | undefined {
  if (origin.link !== undefined || origin.id === target.id) return undefined

  const originMethod = quantityMethod(origin)
  const targetMethod = quantityMethod(target)
  const targetKind = quantityKind(target)
  if (originMethod === 'polyline') {
    if (target.link !== undefined) return undefined
    if (targetMethod === 'polyline' || isRouteSurfaceFixture(target)) return 'route'
    if (routeId && targetMethod === 'click') return 'point'
    return undefined
  }

  if (originMethod === 'click') {
    if (targetMethod === 'click') {
      return target.link === undefined ? 'component' : undefined
    }
    if (targetKind === 'length' || targetKind === 'area' || targetKind === 'volume') {
      return 'factor'
    }
    return undefined
  }

  if (originMethod === 'polygon' || originMethod === 'lengthHeight') {
    if (targetKind === 'area') return 'factor'
    if (originMethod === 'polygon' && targetKind === 'length') return 'perimeter'
    return undefined
  }

  if ((originMethod === 'polygonDepth' || originMethod === 'lengthWidthDepth')
    && targetKind === 'volume') return 'factor'
  return undefined
}

type ScaleChange = { pageIndex: number; scale: PageScale | null }
type DrawingChange = { pageIndex: number; info: DrawingInfo | null }
type RouteTemplate = { itemId: string; extra: NonNullable<QuantityMark['extra']>; count: number; cond?: RouteConditions; name: string }
type PickupMemory = Array<{ itemId: string; cond?: RouteConditions; condition?: string; conditionSet?: boolean; members?: RouteTemplate; components?: CountComponent[] }>
type HistoryState = AnnotationState[] & {
  routeTemplate?: RouteTemplate | null
  pickupMemory?: PickupMemory
  drawings?: DrawingChange[]
  scales?: ScaleChange[]
  scaleRegions?: Array<{ pageIndex: number; regions: ScaleRegion[] }>
  roomRegions?: Array<{ pageIndex: number; regions: RoomRegion[] }>
  roomSets?: RoomSet[]
  quantityChecks?: QuantityCheckBasics
  relatedReviews?: RelatedReviews
  pageRoomSets?: Array<[number, RoomSetLink]>
  issueMaximum?: number
  fixtures?: CountFixture[]
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

function cloneQuantity(mark: QuantityMark): QuantityMark { return structuredClone(mark) }
function cloneCount(mark: CountMark): CountMark { return structuredClone(mark) }

function cloneState(annotation: AnnotationState): AnnotationState {
  return {
    ...annotation,
    quantity: annotation.quantity ? cloneQuantity(annotation.quantity) : null,
    count: annotation.count ? cloneCount(annotation.count) : null,
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

function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const freeze = (current: unknown): void => {
    if (current === null || typeof current !== 'object' || seen.has(current)) return
    // Typed arrays with elements cannot be frozen (legacyChangeData.pdf); they are copies already.
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) return
    seen.add(current)
    for (const child of Object.values(current)) freeze(child)
    Object.freeze(current)
  }
  freeze(value)
  return value
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
  rooms: number[]
  roomSets: boolean
  quantityChecks?: boolean
  relatedReviews?: boolean
}

export class AnnotationStore {
  private vertexHighlight: { annotationId: string; vertexIndex: number } | null = null
  get highlightedVertex(): Readonly<{ annotationId: string; vertexIndex: number }> | null { return this.vertexHighlight }
  setHighlightedVertex(value: { annotationId: string; vertexIndex: number } | null): void {
    if (this.vertexHighlight?.annotationId === value?.annotationId && this.vertexHighlight?.vertexIndex === value?.vertexIndex) return
    this.vertexHighlight = value ? { ...value } : null
    this.notifyUi()
  }
  private riseHighlight: { annotationId: string; riseIndex: number } | null = null
  get highlightedRise(): Readonly<{ annotationId: string; riseIndex: number }> | null { return this.riseHighlight }
  /** Display-only state: no undo entry, quantity invalidation or saved edit. */
  setHighlightedRise(value: { annotationId: string; riseIndex: number } | null): void {
    if (this.riseHighlight?.annotationId === value?.annotationId && this.riseHighlight?.riseIndex === value?.riseIndex) return
    this.riseHighlight = value ? { ...value } : null
    this.notifyUi()
  }
  private flashTarget: string | null = null
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  flashVersion = 0
  get flashId(): string | null { return this.flashTarget }
  /** Selection feedback only: never dirty, indexed, added to history or saved. */
  flashPickup(id: string): void {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer)
    this.flashTarget = id; this.flashVersion++; this.notifyUi()
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null; this.flashTarget = null; this.notifyUi()
    }, 1500)
  }
  private filter: Readonly<AnnotationFilter> = DEFAULT_ANNOTATION_FILTER
  private followsFilter = false
  private readonly drawingFilterReleaseListeners = new Set<(reason: DrawingFilterReleaseReason) => void>()
  get annotationFilter(): Readonly<AnnotationFilter> { return this.filter }
  get drawingFollowsFilter(): boolean { return this.followsFilter }
  private fixtures: CountFixture[] = []
  private fixturesRevision = 0
  private fixturesSnapshotCache: { revision: number; value: readonly CountFixture[] } | null = null
  private fixtureBaseline = '[]'
  private fixtureLoading: Promise<void> | null = null
  fixturesReady = false
  get fixturesLoading(): boolean { return this.fixtureLoading !== null }
  selectedFixtureId: string | null = null
  // Allocated only by explicit visual search; excluded from persisted/history states.
  symbolCandidates: SymbolSearchCandidate[] | null = null
  private symbolCandidateFocus: string | null = null
  get focusedSymbolCandidateId(): string | null { return this.symbolCandidateFocus }
  /** Display-only state: never saved, added to history or included in quantity. */
  setFocusedSymbolCandidate(id: string | null): void {
    if (this.symbolCandidateFocus === id) return
    this.symbolCandidateFocus = id
    this.notifyUi()
  }
  /** 「選んだ候補の確認」の窓が開いているか（表示だけ）。開いている間だけ、図面のクリックで候補を強調する。 */
  symbolReviewOpen = false
  setSymbolReviewOpen(open: boolean): void {
    if (this.symbolReviewOpen === open) return
    this.symbolReviewOpen = open
    if (!open) this.symbolCandidateFocus = null
    this.notifyUi()
  }
  symbolSearchArea: { pageIndex: number; rect: Rect } | null = null
  symbolLabelFilter: string[] | null = null
  symbolGcFilter: 'all' | 'with' | 'without' = 'all'
  symbolShapeFilter: 'same' | 'all' = 'same'
  symbolOtherFilter: 'hide' | 'show' = 'hide'
  setSymbolSearchArea(area: { pageIndex: number; rect: Rect } | null): void {
    const current = this.symbolSearchArea
    if (current === null && area === null) return
    if (current && area && current.pageIndex === area.pageIndex
      && current.rect.every((value, index) => value === area.rect[index])) return
    this.symbolSearchArea = area ? { pageIndex: area.pageIndex, rect: [...area.rect] } : null
    this.notifyUi()
  }
  isSymbolCandidateVisible(c: SymbolSearchCandidate): boolean {
    return (this.symbolLabelFilter === null || this.symbolLabelFilter.includes(c.label))
      && (this.symbolGcFilter === 'all' || (this.symbolGcFilter === 'with' ? c.gc : !c.gc))
      && (this.symbolShapeFilter === 'all' || c.shape?.decision !== 'different')
      && (this.symbolOtherFilter === 'show' || !c.otherFixture)
  }
  get visibleSymbolCandidates(): SymbolSearchCandidate[] | null { return this.symbolCandidates?.filter(c => this.isSymbolCandidateVisible(c)) ?? null }
  setSymbolCandidateFilters(labels: string[] | null, gc: 'all' | 'with' | 'without' = this.symbolGcFilter): void {
    this.symbolLabelFilter = labels === null ? null : [...labels]; this.symbolGcFilter = gc; this.notifyUi()
  }
  setSymbolShapeFilter(value: 'same' | 'all'): void {
    this.symbolShapeFilter = value; this.notifyUi()
  }
  setSymbolOtherFilter(value: 'hide' | 'show'): void {
    this.symbolOtherFilter = value
    if (value === 'hide') {
      for (const c of this.symbolCandidates ?? []) if (c.otherFixture && c.state === 'chosen') c.state = 'pending'
    }
    this.notifyUi()
  }
  symbolOtherFixtureLabel(fixtureId: string): string {
    const fixture = this.getCountFixture(fixtureId)
    return fixture ? fixtureCode(fixture) + ' ' + fixture.name : fixtureId
  }
  private symbolCandidateFixture: string | null = null
  private symbolCandidateRadius = 0

  clearSymbolCandidates(): void {
    if (this.symbolCandidates === null && this.symbolSearchArea === null && this.symbolShapeFilter === 'same' && this.symbolOtherFilter === 'hide'
      && this.symbolCandidateFocus === null) return
    this.symbolCandidates = null; this.symbolSearchArea = null; this.symbolCandidateFixture = null; this.symbolCandidateRadius = 0
    this.symbolCandidateFocus = null
    this.symbolLabelFilter = null; this.symbolGcFilter = 'all'; this.symbolShapeFilter = 'same'; this.symbolOtherFilter = 'hide'
    this.notifyUi()
  }
  beginSymbolCandidates(fixtureId: string, sampleRect: Rect): void {
    this.symbolCandidateFocus = null
    this.symbolCandidateFixture = fixtureId
    this.symbolCandidateRadius = Math.min(sampleRect[2] - sampleRect[0], sampleRect[3] - sampleRect[1]) / 2
    this.symbolLabelFilter = null; this.symbolGcFilter = 'all'; this.symbolShapeFilter = 'same'; this.symbolOtherFilter = 'hide'
    this.symbolCandidates = []; this.notifyUi()
  }
  appendSymbolCandidates(candidates: Array<{ pageIndex: number; rect: Rect; center: Point; score: number; confidence?: 'high' | 'check'; imageScore?: number; extra?: number; label?: string; gc?: boolean; around?: number; aroundCheck?: boolean; shape?: SymbolShapeDecision }>): void {
    if (!this.symbolCandidates || this.symbolCandidateFixture !== this.selectedFixtureId) return
    for (const c of candidates) this.symbolCandidates.push({ ...c, label: c.label ?? '', gc: c.gc ?? false, rect: [...c.rect], center: [...c.center],
      shape: c.shape ? { decision: c.shape.decision, differences: [...c.shape.differences], unknown: [...c.shape.unknown] } : undefined,
      id: crypto.randomUUID(), state: 'pending' })
    this.refreshSymbolCandidates(); this.notifyUi()
  }
  toggleSymbolCandidate(id: string): void {
    const c = this.symbolCandidates?.find(c => c.id === id)
    if (!c || c.state === 'counted' || !this.isSymbolCandidateVisible(c)) return
    c.state = c.state === 'chosen' ? 'pending' : 'chosen'; this.notifyUi()
  }
  chooseSymbolCandidates(chosen: boolean): void {
    if (!this.symbolCandidates) return
    for (const c of this.visibleSymbolCandidates ?? []) if (c.state !== 'counted') c.state = chosen ? 'chosen' : 'pending'
    this.notifyUi()
  }
  chooseHighConfidenceCandidates(): void {
    if (!this.symbolCandidates) return
    for (const c of this.visibleSymbolCandidates ?? []) if (c.state === 'pending' && c.confidence === 'high') c.state = 'chosen'
    this.notifyUi()
  }
  private refreshSymbolCandidates(): void {
    if (!this.symbolCandidates?.length) return
    perfTime('store.refreshSymbolCandidates', () => this.refreshSymbolCandidatesBody(this.symbolCandidates!))
  }
  private refreshSymbolCandidatesBody(candidates: SymbolSearchCandidate[]): void {
    const marks = new Map<number, Point[]>()
    const otherMarks = new Map<number, Array<{ center: Point; fixtureId: string }>>()
    for (const a of this.annotations.values()) {
      if (a.deleted || !a.count) continue
      const fixtureId = countFixtureId(a.count)
      if (!fixtureId) continue
      const center: Point = [(a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2]
      if (fixtureId === this.symbolCandidateFixture) {
        const points = marks.get(a.pageIndex) ?? []; points.push(center); marks.set(a.pageIndex, points)
      } else {
        const points = otherMarks.get(a.pageIndex) ?? []; points.push({ center, fixtureId }); otherMarks.set(a.pageIndex, points)
      }
    }
    for (const c of candidates) {
      delete c.otherFixture
      const counted = marks.get(c.pageIndex)?.some(p => Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) <= this.symbolCandidateRadius)
      if (counted) { c.state = 'counted'; continue }
      if (c.state === 'counted') c.state = 'pending'
      let nearestDistance = Infinity
      for (const mark of otherMarks.get(c.pageIndex) ?? []) {
        const distance = Math.hypot(mark.center[0] - c.center[0], mark.center[1] - c.center[1])
        if (distance <= this.symbolCandidateRadius && distance < nearestDistance) {
          nearestDistance = distance; c.otherFixture = mark.fixtureId
        }
      }
      if (this.symbolOtherFilter === 'hide' && c.otherFixture && c.state === 'chosen') c.state = 'pending'
    }
  }

  createCountMarks(fixtureId: string, points: Array<{ pageIndex: number; center: Point }>): string[] {
    const fixture = this.getCountFixture(fixtureId)
    if (fixture?.link !== undefined) throw new Error('連動の項目は図面に拾いません')
    if (!fixture || quantityKind(fixture) !== 'count') throw new Error('個数の項目を選んでください')
    if (points.some(p => !Number.isInteger(p.pageIndex) || p.pageIndex < 0 || !p.center.every(Number.isFinite))) throw new Error('印の位置が不正です')
    if (!points.length) return []
    const after: HistoryState = []
    for (const { pageIndex, center } of points) {
      const a = this.create({ pageIndex, kind: 'symbol', rect: symbolRectFromDrag(center, center, false, fixture.style.size),
        count: { version: 2, id: crypto.randomUUID(), fixtureId, ...this.pickupLocation(pageIndex, center) },
        text: `個数: ${fixtureCode(fixture)} ${fixture.name}`.trim(), color: fixture.style.color, symbol: 'circle', opacity: fixture.style.opacity,
        deferHistory: true, deferNotify: true })
      this.pendingCreations.delete(a.id); after.push(cloneState(this.annotations.get(a.id)!))
    }
    this.history.push({ before: [], after }); this.notify()
    return after.map(a => a.id)
  }
  routeTemplate: RouteTemplate | null = null
  setRouteTemplate(t: AnnotationStore['routeTemplate']): void { this.routeTemplate = t ? structuredClone(t) : null; this.notifyUi() }
  routeTemplateItems(itemId: string): Partial<Pick<QuantityMark, 'count' | 'cond' | 'extra'>> {
    const active = this.routeTemplate?.itemId === itemId
    const t = active ? this.routeTemplate : this.lastRouteMembers.get(itemId)
    const f = this.getCountFixture(itemId)
    if (!f || f.link !== undefined || quantityMethod(f) !== 'polyline') return {}
    if (!t) return { cond: this.newRouteConditions(itemId) }
    const extra = t.extra.flatMap(e => {
      const item = this.getCountFixture(e.itemId)
      if (!item || item.link !== undefined) return []
      const method = quantityMethod(item)
      // R6b: 面積の線要素（保温 等）もこれからの経路に引き継ぐ。
      if (method !== 'polyline' && method !== 'lengthWidthDepth' && !isRouteSurfaceFixture(item)) return []
      const cond = structuredClone(active
        ? e.cond ?? item.routeDefaults ?? {}
        : this.lastRouteConditions.get(e.itemId) ?? e.cond ?? item.routeDefaults ?? {})
      return [{
        ...e,
        cond: method === 'lengthWidthDepth'
          ? { ...cond, rise: null, slack: null } : cond,
      }]
    })
    return {
      count: t.count,
      cond: structuredClone(active
        ? t.cond ?? f.routeDefaults ?? {}
        : this.lastRouteConditions.get(itemId) ?? t.cond ?? f.routeDefaults ?? {}),
      extra,
    }
  }
  private readonly pickupMethods = new Map<string, import('../core/countFixtures').QuantityMethod>()
  pickupMethod(fixture: CountFixture): import('../core/countFixtures').QuantityMethod {
    const selected = this.pickupMethods.get(fixture.id)
    return selected && this.supportsPickupMethod(fixture, selected) ? selected : quantityMethod(fixture)
  }
  supportsPickupMethod(fixture: CountFixture, method: import('../core/countFixtures').QuantityMethod): boolean {
    if (fixture.link !== undefined) return false
    // Equivalent to membership in QUANTITY_METHODS[quantityKind(fixture)].
    // Keep count/length reassignment restricted to their existing methods.
    switch (quantityKind(fixture)) {
      case 'count': return method === 'click'
      case 'length': return method === 'polyline'
      case 'area': return method === 'polygon' || method === 'lengthHeight'
      case 'volume': return method === 'polygonDepth' || method === 'lengthWidthDepth'
    }
  }
  setPickupMethod(itemId: string, method: import('../core/countFixtures').QuantityMethod): void {
    const fixture = this.getCountFixture(itemId)
    if (!fixture || !this.supportsPickupMethod(fixture, method) || this.pickupMethods.get(itemId) === method) return
    this.pickupMethods.set(itemId, method)
    this.notifyUi()
  }

  private areaHoleId: string | null = null
  get areaHoleTarget(): string | null { return this.areaHoleId }
  startAreaHoles(id: string): boolean {
    const annotation = this.get(id), selected = this.selectedIds()
    if (!annotation || annotation.legacyChange || !annotation.vertices || !annotation.measure
      || selected.length !== 1 || selected[0] !== id
      || (annotation.quantity
        ? annotation.quantity.method !== 'polygon' && annotation.quantity.method !== 'polygonDepth'
        : !!annotation.count || annotation.measure.kind !== 'area')) return false
    if (this.areaHoleId === id) return true
    this.endRoomSetAlign(false)
    this.roomCaptureIndex = null
    this.roomEditState = null
    this.roomEditCompletion = null
    this.areaHoleId = id
    this.notifyUi()
    return true
  }
  endAreaHoles(): void {
    if (this.areaHoleId === null) return
    this.areaHoleId = null
    this.notifyUi()
  }

  private roomEditState: { pageIndex: number; id: string; points: Point[] } | null = null
  private roomEditCompletion: { pageIndex: number; region: RoomRegion } | null = null
  get roomEditTarget(): { pageIndex: number; id: string } | null {
    const active = this.roomEditState
    // History restoration can remove a region without calling setRoomRegions.
    if (active && !this.effectiveRoomRegions(active.pageIndex).some(({ region }) => region.id === active.id)) {
      this.roomEditState = null
      this.roomEditCompletion = null
    }
    return this.roomEditState
  }
  startRoomEdit(pageIndex: number, id: string): boolean {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return false
    const region = this.effectiveRoomRegions(pageIndex).find(({ region }) => region.id === id)?.region
    if (!region) return false
    const active = this.roomEditTarget
    if (active?.pageIndex === pageIndex && active.id === id) return true
    this.endRoomSetAlign(false)
    this.roomCaptureIndex = null
    this.areaHoleId = null
    this.roomEditCompletion = null
    this.roomEditState = { pageIndex, id, points: region.points.map(point => [...point] as Point) }
    this.notifyUi()
    return true
  }
  endRoomEdit(confirm = true): void {
    const active = this.roomEditTarget
    this.roomEditCompletion = null
    if (!active) return
    const initial = this.roomEditState!
    const region = this.effectiveRoomRegions(active.pageIndex).find(({ region }) => region.id === active.id)?.region
    this.roomEditState = null
    if (confirm && region && (region.points.length !== initial.points.length
      || region.points.some((point, index) => point[0] !== initial.points[index][0]
        || point[1] !== initial.points[index][1]))) {
      this.roomEditCompletion = { pageIndex: active.pageIndex, region: structuredClone(region) }
    }
    this.notifyUi()
  }
  takeRoomEditCompletion(pageIndex: number): { pageIndex: number; region: RoomRegion } | null {
    if (this.roomEditCompletion?.pageIndex !== pageIndex) return null
    const completion = this.roomEditCompletion
    this.roomEditCompletion = null
    return completion
  }

  private roomCaptureIndex: number | null = null
  get roomCapturePage(): number | null { return this.roomCaptureIndex }
  startRoomCapture(pageIndex: number): boolean {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return false
    if (this.roomCaptureIndex === pageIndex) return true
    this.endRoomSetAlign(false)
    this.areaHoleId = null
    this.roomEditState = null
    this.roomEditCompletion = null
    this.roomCaptureIndex = pageIndex
    this.notifyUi()
    return true
  }
  endRoomCapture(): void {
    if (this.roomCaptureIndex === null) return
    this.roomCaptureIndex = null
    this.notifyUi()
  }
  private roomSetAlignState: {
    pageIndex: number; setId: string; dx: number; dy: number
  } | null = null
  private roomSetAlignCompletion: {
    pageIndex: number; setId: string; dx: number; dy: number
  } | null = null

  get roomSetAlignPage(): number | null {
    const active = this.roomSetAlignState
    if (active && (this.pageRoomSets.get(active.pageIndex)?.id !== active.setId
      || !this.getPageRoomSet(active.pageIndex))) {
      this.roomSetAlignState = null
      this.roomSetAlignCompletion = null
    }
    return this.roomSetAlignState?.pageIndex ?? null
  }

  startRoomSetAlign(pageIndex: number): boolean {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return false
    const link = this.getPageRoomSetLink(pageIndex)
    if (!link || !this.getPageRoomSet(pageIndex)) return false
    if (this.roomSetAlignPage === pageIndex) return true
    this.roomCaptureIndex = null
    this.roomEditState = null
    this.roomEditCompletion = null
    this.areaHoleId = null
    this.roomSetAlignCompletion = null
    this.roomSetAlignState = {
      pageIndex, setId: link.id, dx: link.dx ?? 0, dy: link.dy ?? 0,
    }
    this.notifyUi()
    return true
  }

  endRoomSetAlign(confirm = true): void {
    const pageIndex = this.roomSetAlignPage
    const active = this.roomSetAlignState
    if (pageIndex === null || !active) return
    const link = this.getPageRoomSetLink(pageIndex)
    this.roomSetAlignState = null
    this.roomSetAlignCompletion = null
    if (confirm && link?.id === active.setId
      && ((link.dx ?? 0) !== active.dx || (link.dy ?? 0) !== active.dy)) {
      this.roomSetAlignCompletion = {
        pageIndex, setId: link.id, dx: link.dx ?? 0, dy: link.dy ?? 0,
      }
    }
    this.notifyUi()
  }

  takeRoomSetAlignCompletion(pageIndex: number): {
    pageIndex: number; setId: string; dx: number; dy: number
  } | null {
    if (this.roomSetAlignCompletion?.pageIndex !== pageIndex) return null
    const completion = this.roomSetAlignCompletion
    this.roomSetAlignCompletion = null
    return completion
  }

  showRoomRegions = true
  setShowRoomRegions(value: boolean): void {
    if (this.showRoomRegions === value) return
    this.showRoomRegions = value
    this.notifyUi()
  }

  private recentFixtures: readonly string[] = []
  get recentFixtureIds(): readonly string[] { return this.recentFixtures }
  rememberRouteFixture(id: string): void { this.rememberFixture(id); this.notifyUi() }
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
  readonly roomRegions = new Map<number, RoomRegion[]>()
  private readonly roomRegionBaselines = new Map<number, RoomRegion[]>()
  private pendingRoomRegions: Array<{ pageIndex: number; regions: RoomRegion[]; editIndex: number }> = []
  private roomSets: RoomSet[] = []
  private roomSetBaseline: RoomSet[] = []
  private pendingRoomSets: { sets: RoomSet[]; editIndex: number } | null = null
  private quantityChecks: QuantityCheckBasics = { values: {} }
  private quantityCheckBaseline: QuantityCheckBasics = { values: {} }
  private quantityCheckLoading: Promise<void> | null = null
  private pendingQuantityChecks: { basics: QuantityCheckBasics; editIndex: number } | null = null
  quantityChecksReady = false
  private relatedReviews: RelatedReviews = { version: 1, works: {}, decisions: {} }
  private relatedReviewsRevision = 0
  private relatedReviewsSnapshotCache: { revision: number; value: Readonly<RelatedReviews> } | null = null
  private relatedReviewBaseline: RelatedReviews = { version: 1, works: {}, decisions: {} }
  private relatedReviewLoading: Promise<void> | null = null
  private pendingRelatedReviews: { reviews: RelatedReviews; editIndex: number } | null = null
  relatedReviewsReady = false
  get relatedReviewsLoading(): boolean { return this.relatedReviewLoading !== null }
  readonly pageRoomSets = new Map<number, RoomSetLink>()
  private readonly pageRoomSetBaselines = new Map<number, RoomSetLink>()
  private pendingPageRoomSets: Array<{ pageIndex: number; setId: RoomSetLink | null; editIndex: number }> = []
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
  private contentRevision = 0
  private pageAnnotationsCache: {
    contentRevision: number
    ids: Map<number, string[]>
    pages: Map<number, readonly EditableAnnotation[]>
  } | null = null
  private countOverlayCache: {
    contentRevision: number
    fixturesReady: boolean
    pages: Map<number, readonly number[]>
  } | null = null
  private issueOverlayCache: {
    contentRevision: number
    pages: Map<number, readonly number[]>
  } | null = null
  private dirtyCache: { contentRevision: number; summary: DirtySummary } | null = null
  private generation = 0
  private lastNudge: { key: string; step: HistoryStep<HistoryState>; at: number } | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version
  getContentRevision(): number { return this.contentRevision }
  subscribeDrawingFilterRelease = (listener: (reason: DrawingFilterReleaseReason) => void): (() => void) => {
    this.drawingFilterReleaseListeners.add(listener)
    return () => this.drawingFilterReleaseListeners.delete(listener)
  }

  setAnnotationFilter(filter: AnnotationFilter): void {
    if (this.filter.kind === filter.kind && this.filter.discipline === filter.discipline && this.filter.status === filter.status) return
    this.filter = Object.freeze({ ...filter })
    this.pruneHiddenSelection(); this.visibilityVersion++; this.notifyUi()
  }
  setDrawingFollowsFilter(value: boolean): void {
    if (this.followsFilter === value) return
    this.followsFilter = value
    this.pruneHiddenSelection(); this.visibilityVersion++; this.notifyUi()
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
    if (this.selectedFixtureId && this.revealCountFixture(this.selectedFixtureId)) this.notifyUi()
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
    if (!preserveFixtureVisibility) { this.routeTemplate = null; this.lastRouteConditions.clear(); this.lastCondition.clear(); this.lastRouteMembers.clear(); this.lastCountComponents.clear() }
    if (!preserveFixtureVisibility) this.recentFixtures = []
    this.index = null; this.visibleCountCache = null
    this.pageAnnotationsCache = null
    this.countOverlayCache = null
    this.issueOverlayCache = null
    this.replaceFixtures([]); this.fixtureBaseline = '[]'; this.fixtureLoading = null; this.fixturesReady = false
    if (!preserveFixtureVisibility) { this.currentFloor = ''; this.currentRoom = ''; this.selectedFixtureId = null; this.hiddenFixtures.clear(); this.onlySelectedFixture = false; this.showQuantityValues = true }
    if (!preserveFixtureVisibility) { this.filter = DEFAULT_ANNOTATION_FILTER; this.followsFilter = false }
    this.legacyCountObjects.clear(); this.pendingFixtureSave = null
    this.drawings.clear(); this.drawingBaselines.clear(); this.drawingDirtyBaselines.clear(); this.automaticDrawings.clear(); this.pendingDrawings = []
    this.scales.clear(); this.scaleBaselines.clear(); this.pendingScales = []
    this.scaleRegions.clear(); this.scaleRegionBaselines.clear(); this.pendingScaleRegions = []
    this.roomRegions.clear(); this.roomRegionBaselines.clear(); this.pendingRoomRegions = []
    this.roomSets = []; this.roomSetBaseline = []; this.pendingRoomSets = null
    this.quantityChecks = { values: {} }; this.quantityCheckBaseline = { values: {} }
    this.quantityCheckLoading = null; this.pendingQuantityChecks = null; this.quantityChecksReady = false
    this.replaceRelatedReviews({ version: 1, works: {}, decisions: {} })
    this.relatedReviewBaseline = { version: 1, works: {}, decisions: {} }
    this.relatedReviewLoading = null; this.pendingRelatedReviews = null; this.relatedReviewsReady = false
    this.pageRoomSets.clear(); this.pageRoomSetBaselines.clear(); this.pendingPageRoomSets = []
    this.roomSetAlignState = null
    this.roomSetAlignCompletion = null
    this.roomCaptureIndex = null
    this.roomEditState = null
    this.roomEditCompletion = null
    if (!preserveFixtureVisibility) this.showRoomRegions = true
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
          count: info.count ? cloneCount(info.count) : null,
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

  loadRoomRegions(entries: readonly [number, RoomRegion[]][]): void {
    this.roomSetAlignState = null
    this.roomSetAlignCompletion = null
    this.roomEditState = null
    this.roomEditCompletion = null
    this.roomRegions.clear(); this.roomRegionBaselines.clear()
    for (const [pageIndex, regions] of entries) {
      if (!Number.isInteger(pageIndex) || pageIndex < 0) continue
      const valid = parseRoomRegions(regions)
      if (!valid.length) continue
      this.roomRegions.set(pageIndex, valid)
      this.roomRegionBaselines.set(pageIndex, structuredClone(valid))
    }
    this.notify(false)
  }
  getRoomRegions(pageIndex: number): RoomRegion[] {
    return structuredClone(this.roomRegions.get(pageIndex) ?? [])
  }
  setRoomRegions(pageIndex: number, regions: RoomRegion[]): void {
    const next = parseRoomRegions(regions)
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || next.length !== regions.length) throw new Error('部屋の範囲が不正です（1ページ200個まで、部屋名は1〜40文字、階は40文字まで、点は3〜500点）。')
    const old = this.getRoomRegions(pageIndex)
    if (stableJson(old) === stableJson(next)) return
    const pages = new Map(this.roomRegions)
    pages.set(pageIndex, next)
    this.validateRoomRegionIds(this.roomSets, pages)
    const before: HistoryState = [], after: HistoryState = []
    before.roomRegions = [{ pageIndex, regions: old }]
    after.roomRegions = [{ pageIndex, regions: structuredClone(next) }]
    this.roomRegions.set(pageIndex, next)
    if (this.roomEditState?.pageIndex === pageIndex
      && !this.effectiveRoomRegions(pageIndex).some(({ region }) => region.id === this.roomEditState!.id)) {
      this.roomEditState = null
      this.roomEditCompletion = null
    }
    this.history.push({ before, after })
    this.notify(false)
  }
  loadRoomSets(sets: readonly RoomSet[], links: readonly [number, RoomSetLink][]): void {
    this.roomSetAlignState = null
    this.roomSetAlignCompletion = null
    this.roomEditState = null
    this.roomEditCompletion = null
    this.roomSets = parseRoomSets({ version: 1, sets })
    this.roomSetBaseline = structuredClone(this.roomSets)
    this.pendingRoomSets = null
    this.pageRoomSets.clear()
    this.pageRoomSetBaselines.clear()
    this.pendingPageRoomSets = []
    const validIds = new Set(this.roomSets.map(set => set.id))
    for (const [pageIndex, rawLink] of links) {
      const link = parseRoomSetLink(rawLink)
      if (!Number.isInteger(pageIndex) || pageIndex < 0
        || !link || !validIds.has(link.id)) continue
      this.pageRoomSets.set(pageIndex, link)
      this.pageRoomSetBaselines.set(pageIndex, structuredClone(link))
    }
    this.notify(false)
  }

  getRoomSets(): RoomSet[] {
    return structuredClone(this.roomSets)
  }

  async ensureQuantityChecks(
    loader: () => Promise<QuantityCheckBasics>,
  ): Promise<void> {
    if (this.quantityChecksReady) return
    if (this.quantityCheckLoading) return this.quantityCheckLoading
    const generation = this.generation
    const request = Promise.resolve().then(loader).then(raw => {
      if (generation !== this.generation) return
      this.quantityChecks = parseQuantityCheckBasics(raw)
      this.quantityCheckBaseline = structuredClone(this.quantityChecks)
      this.quantityChecksReady = true
      this.notify(false)
    }).finally(() => {
      if (generation === this.generation) this.quantityCheckLoading = null
    })
    this.quantityCheckLoading = request
    return request
  }

  getQuantityChecks(): QuantityCheckBasics {
    return structuredClone(this.quantityChecks)
  }

  async ensureRelatedReviews(loader: () => Promise<RelatedReviews>): Promise<void> {
    if (this.relatedReviewsReady) return
    if (this.relatedReviewLoading) return this.relatedReviewLoading
    const generation = this.generation
    const request = Promise.resolve().then(loader).then(raw => {
      if (generation !== this.generation) return
      this.replaceRelatedReviews(parseRelatedReviews(raw))
      this.relatedReviewBaseline = structuredClone(this.relatedReviews)
      this.relatedReviewsReady = true
      this.notify(false)
    }).finally(() => {
      if (generation === this.generation) this.relatedReviewLoading = null
    })
    this.relatedReviewLoading = request
    return request
  }

  private replaceRelatedReviews(next: RelatedReviews): void {
    this.relatedReviews = next
    this.relatedReviewsRevision += 1
    this.relatedReviewsSnapshotCache = null
  }

  /** 判断データの版。読込・変更・履歴の復元・reset で単調増加する。 */
  getRelatedReviewsRevision(): number { return this.relatedReviewsRevision }

  /** 同じ版では同じオブジェクト。内部から切り離し、入れ子まで freeze する。 */
  getRelatedReviewsSnapshot(): Readonly<RelatedReviews> {
    if (this.relatedReviewsSnapshotCache?.revision !== this.relatedReviewsRevision) {
      const value = deepFreeze({
        ...this.relatedReviews,
        works: { ...this.relatedReviews.works },
        // 未使用の文書では判断の深い複製を行わない。
        decisions: Object.keys(this.relatedReviews.decisions).length
          ? structuredClone(this.relatedReviews.decisions) : {},
      })
      this.relatedReviewsSnapshotCache = {
        revision: this.relatedReviewsRevision, value,
      }
    }
    return this.relatedReviewsSnapshotCache.value
  }

  getRelatedReviews(): RelatedReviews {
    return structuredClone(this.relatedReviews)
  }

  private changeRelatedReviews(proposed: RelatedReviews): void {
    if (!this.relatedReviewsReady) return
    const next = parseRelatedReviews(serializeRelatedReviews(proposed))
    if (stableJson(next) === stableJson(this.relatedReviews)) return
    const before: HistoryState = [], after: HistoryState = []
    before.relatedReviews = this.getRelatedReviews()
    after.relatedReviews = structuredClone(next)
    this.replaceRelatedReviews(next)
    this.history.push({ before, after })
    this.notify(false)
  }

  setRelatedProjectMode(mode: ProjectMode | undefined): void {
    if (!this.relatedReviewsReady) return
    const next = this.getRelatedReviews()
    if (mode === undefined) delete next.projectMode
    else next.projectMode = mode
    this.changeRelatedReviews(next)
  }

  setRelatedWork(fixtureId: string, work: WorkType | undefined): void {
    if (!this.relatedReviewsReady) return
    const next = this.getRelatedReviews()
    if (work === undefined) delete next.works[fixtureId]
    else next.works = { ...next.works, [fixtureId]: work }
    this.changeRelatedReviews(next)
  }

  setRelatedDecision(key: string, decision: RelatedReviewDecision | undefined): void {
    if (!this.relatedReviewsReady) return
    const next = this.getRelatedReviews()
    if (decision === undefined) delete next.decisions[key]
    else next.decisions = { ...next.decisions, [key]: structuredClone(decision) }
    this.changeRelatedReviews(next)
  }

  setQuantityCheckBasic(key: CheckBasisKey, value: number | undefined): void {
    if (!this.quantityChecksReady) return
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) return
    const values = { ...this.quantityChecks.values }
    if (value === undefined) delete values[key]
    else values[key] = value
    const next = parseQuantityCheckBasics({ values })
    if (stableJson(next) === stableJson(this.quantityChecks)) return
    const before: HistoryState = [], after: HistoryState = []
    before.quantityChecks = this.getQuantityChecks()
    after.quantityChecks = structuredClone(next)
    this.quantityChecks = next
    this.history.push({ before, after })
    this.notify(false)
  }

  getPageRoomSet(pageIndex: number): RoomSet | undefined {
    const link = this.pageRoomSets.get(pageIndex)
    return link ? this.roomSets.find(set => set.id === link.id) : undefined
  }

  getPageRoomSetLink(pageIndex: number): RoomSetLink | undefined {
    const link = this.pageRoomSets.get(pageIndex)
    return link ? { ...link } : undefined
  }

  setRoomSetOffset(pageIndex: number, dx: number, dy: number): void {
    const current = this.getPageRoomSetLink(pageIndex)
    if (!current || !this.getPageRoomSet(pageIndex)) return
    const link = parseRoomSetLink({ id: current.id, dx, dy })
    if (!link) throw new Error('部屋の組の結び付けが不正です。')
    const links = new Map(this.pageRoomSets)
    links.set(pageIndex, link)
    this.changeRoomSets(this.roomSets, links)
  }

  setRoomSetAnchor(pageIndex: number, point: Point): void {
    const set = this.getPageRoomSet(pageIndex)
    const link = this.getPageRoomSetLink(pageIndex)
    if (!set || !link) return
    const anchor: Point = [point[0] - (link.dx ?? 0), point[1] - (link.dy ?? 0)]
    if (!anchor.every(Number.isFinite)) throw new Error('部屋の組の支点が不正です。')
    this.changeRoomSets(this.roomSets.map(current => current.id === set.id
      ? { ...current, anchor } : current))
  }

  effectiveRoomRegions(pageIndex: number): Array<{ region: RoomRegion; setId?: string }> {
    const local = this.roomRegions.get(pageIndex)
    const set = this.getPageRoomSet(pageIndex)
    if (!local?.length && !set?.regions.length) return EMPTY_EFFECTIVE_ROOM_REGIONS
    const link = this.pageRoomSets.get(pageIndex)
    return [
      ...(local ?? []).map(region => ({ region })),
      ...(set?.regions ?? []).map(region => ({
        region: translateRoomRegion(region, link?.dx, link?.dy), setId: set!.id,
      })),
    ]
  }

  suggestedRoomSets(pageIndex: number): RoomSet[] {
    if (this.getPageRoomSet(pageIndex)) return []
    const floor = normalizeFloor(floorFromDrawingName(this.getDrawingInfo(pageIndex)?.name ?? '') ?? '')
    return floor
      ? structuredClone(this.roomSets.filter(set => set.floor === floor))
      : []
  }

  private validateRoomRegionIds(
    sets: readonly RoomSet[],
    pages: ReadonlyMap<number, RoomRegion[]>,
  ): void {
    const ids = new Set<string>()
    const check = (region: RoomRegion) => {
      if (!region.id.length || ids.has(region.id)) {
        throw new Error('部屋の範囲の id が重なっています。')
      }
      ids.add(region.id)
    }
    for (const regions of pages.values()) for (const region of regions) check(region)
    for (const set of sets) for (const region of set.regions) check(region)
  }

  private changeRoomSets(
    proposed: readonly RoomSet[],
    links: ReadonlyMap<number, RoomSetLink> = this.pageRoomSets,
    pageChanges: Array<{ pageIndex: number; regions: RoomRegion[] }> = [],
  ): void {
    const sets = parseRoomSets({ version: 1, sets: proposed })
    if (stableJson(sets) !== stableJson(proposed)) {
      throw new Error('部屋の組が不正です（100組まで、名前は1〜40文字、階は40文字まで、範囲は1組200個まで）。')
    }
    const validIds = new Set(sets.map(set => set.id))
    const normalizedLinks = new Map<number, RoomSetLink>()
    for (const [pageIndex, rawLink] of links) {
      const link = parseRoomSetLink(rawLink)
      if (!Number.isInteger(pageIndex) || pageIndex < 0
        || !link || !validIds.has(link.id)) {
        throw new Error('部屋の組の結び付けが不正です。')
      }
      normalizedLinks.set(pageIndex, link)
    }
    const pages = new Map(this.roomRegions)
    for (const item of pageChanges) pages.set(item.pageIndex, item.regions)
    this.validateRoomRegionIds(sets, pages)

    const before: HistoryState = [], after: HistoryState = []
    if (stableJson(sets) !== stableJson(this.roomSets)) {
      before.roomSets = structuredClone(this.roomSets)
      after.roomSets = structuredClone(sets)
    }
    const oldLinks = [...this.pageRoomSets].sort(([a], [b]) => a - b)
    const newLinks = [...normalizedLinks].sort(([a], [b]) => a - b)
    if (stableJson(oldLinks) !== stableJson(newLinks)) {
      before.pageRoomSets = structuredClone(oldLinks)
      after.pageRoomSets = structuredClone(newLinks)
    }
    const changedPages = pageChanges.filter(item =>
      stableJson(item.regions) !== stableJson(this.roomRegions.get(item.pageIndex) ?? []))
    if (changedPages.length) {
      before.roomRegions = changedPages.map(item => ({
        pageIndex: item.pageIndex, regions: this.getRoomRegions(item.pageIndex),
      }))
      after.roomRegions = structuredClone(changedPages)
    }
    if (!before.roomSets && !before.pageRoomSets && !before.roomRegions) return

    this.roomSets = sets
    this.pageRoomSets.clear()
    for (const [pageIndex, link] of newLinks) this.pageRoomSets.set(pageIndex, { ...link })
    for (const item of changedPages) this.roomRegions.set(item.pageIndex, structuredClone(item.regions))
    // Also closes an edit whose shared region disappeared or was detached.
    void this.roomEditTarget
    void this.roomSetAlignPage
    this.history.push({ before, after })
    this.notify(false)
  }

  addRoomRegion(pageIndex: number, region: RoomRegion, toSet: boolean): void {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      throw new Error('ページ番号が不正です。')
    }
    const valid = parseRoomRegions([region])[0]
    if (!valid) throw new Error('部屋の範囲が不正です。')
    const usedIds = new Set<string>()
    for (const regions of this.roomRegions.values()) {
      for (const current of regions) usedIds.add(current.id)
    }
    for (const set of this.roomSets) {
      for (const current of set.regions) usedIds.add(current.id)
    }
    if (!valid.id.length || usedIds.has(valid.id)) {
      do { valid.id = crypto.randomUUID() } while (usedIds.has(valid.id))
    }
    if (!toSet) {
      this.setRoomRegions(pageIndex, [...this.getRoomRegions(pageIndex), valid])
      return
    }
    const set = this.getPageRoomSet(pageIndex)
    if (!set) throw new Error('この図面は部屋の組を使っていません。')
    const link = this.pageRoomSets.get(pageIndex)
    const shared = translateRoomRegion(valid, -(link?.dx ?? 0), -(link?.dy ?? 0))
    this.changeRoomSets(this.roomSets.map(current => current.id === set.id
      ? { ...current, regions: [...current.regions, shared] } : current))
  }

  updateRoomRegion(pageIndex: number, region: RoomRegion): void {
    const entry = this.effectiveRoomRegions(pageIndex).find(current => current.region.id === region.id)
    if (!entry) return
    const valid = parseRoomRegions([region])[0]
    if (!valid) throw new Error('部屋の範囲が不正です。')
    if (!entry.setId) {
      this.setRoomRegions(pageIndex, this.getRoomRegions(pageIndex).map(current =>
        current.id === valid.id ? valid : current))
      return
    }
    const link = this.pageRoomSets.get(pageIndex)
    const shared = translateRoomRegion(valid, -(link?.dx ?? 0), -(link?.dy ?? 0))
    this.changeRoomSets(this.roomSets.map(set => set.id === entry.setId
      ? { ...set, regions: set.regions.map(current => current.id === valid.id ? shared : current) }
      : set))
  }

  removeRoomRegion(pageIndex: number, id: string): void {
    const entry = this.effectiveRoomRegions(pageIndex).find(current => current.region.id === id)
    if (!entry) return
    if (!entry.setId) {
      this.setRoomRegions(pageIndex, this.getRoomRegions(pageIndex).filter(region => region.id !== id))
      return
    }
    this.changeRoomSets(this.roomSets.map(set => set.id === entry.setId
      ? { ...set, regions: set.regions.filter(region => region.id !== id) } : set))
  }

  createRoomSetFromPage(pageIndex: number, name: string, floor?: string): RoomSet {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('ページ番号が不正です。')
    if (this.getPageRoomSet(pageIndex)) throw new Error('この図面はすでに部屋の組を使っています。')
    const regions = this.getRoomRegions(pageIndex)
    if (!regions.length) throw new Error('この図面には部屋の範囲がありません。')
    const normalizedFloor = normalizeFloor(floor ?? '')
    let id: string
    do { id = crypto.randomUUID() } while (this.roomSets.some(set => set.id === id))
    const set: RoomSet = {
      id, name: name.trim(),
      ...(normalizedFloor ? { floor: normalizedFloor } : {}),
      regions,
    }
    const links = new Map(this.pageRoomSets)
    links.set(pageIndex, { id })
    this.changeRoomSets([...this.roomSets, set], links, [{ pageIndex, regions: [] }])
    return structuredClone(set)
  }

  useRoomSet(pageIndex: number, setId: string | null): void {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('ページ番号が不正です。')
    if (setId !== null && !this.roomSets.some(set => set.id === setId)) {
      throw new Error('部屋の組が見つかりません。')
    }
    const links = new Map(this.pageRoomSets)
    if (setId === null) links.delete(pageIndex)
    else if (links.get(pageIndex)?.id !== setId) links.set(pageIndex, { id: setId })
    this.changeRoomSets(this.roomSets, links)
  }

  renameRoomSet(setId: string, name: string, floor?: string): void {
    if (!this.roomSets.some(set => set.id === setId)) return
    const normalizedFloor = normalizeFloor(floor ?? '')
    this.changeRoomSets(this.roomSets.map(set => {
      if (set.id !== setId) return set
      return {
        id: set.id, name: name.trim(),
        ...(normalizedFloor ? { floor: normalizedFloor } : {}),
        ...(set.anchor ? { anchor: [...set.anchor] as Point } : {}),
        regions: set.regions,
      }
    }))
  }

  deleteRoomSet(setId: string): void {
    if (!this.roomSets.some(set => set.id === setId)) return
    const links = new Map([...this.pageRoomSets].filter(([, link]) => link.id !== setId))
    this.changeRoomSets(this.roomSets.filter(set => set.id !== setId), links)
  }

  roomSetPickupChanges(pageIndex: number): Array<{ id: string; region: RoomRegion }> {
    const set = this.getPageRoomSet(pageIndex)
    if (!set?.regions.length) return []
    const effective = this.effectiveRoomRegions(pageIndex)
    const regions = effective.map(entry => entry.region)
    const shared = effective.filter(entry => entry.setId === set.id).map(entry => entry.region)
    const changes: Array<{ id: string; region: RoomRegion }> = []
    for (const annotation of this.annotations.values()) {
      if (annotation.deleted || annotation.legacyChange || annotation.pageIndex !== pageIndex
        || !annotation.count && !annotation.quantity) continue
      const point = pickupPoint(annotation)
      if (!point || !shared.some(region => pointInRoomRegion(region, point))) continue
      const region = roomAt(regions, point)
      if (!region) continue
      const mark = (annotation.quantity ?? annotation.count) as { room?: string; floor?: string }
      if ((mark.room ?? '') !== region.name
        || !!region.floor && normalizeFloor(mark.floor ?? '') !== normalizeFloor(region.floor)) {
        changes.push({ id: annotation.id, region: structuredClone(region) })
      }
    }
    return changes
  }

  applyRoomSetPickupLocations(pageIndex: number, setId: string): void {
    if (this.getPageRoomSet(pageIndex)?.id !== setId) return
    const targets = new Map(this.roomSetPickupChanges(pageIndex).map(({ id, region }) => [id, region] as const))
    if (!targets.size) return
    // One mutation keeps every pickup's room in a single undo step, using the same rules as updatePickupLocation.
    this.mutateMany([...targets.keys()], a => {
      const region = targets.get(a.id)!
      if (a.count?.version === 1) a.count = { version: 2, id: a.count.id, fixtureId: countFixtureId(a.count) }
      const mark = a.quantity ?? (a.count?.version === 2 ? a.count : null)
      if (!mark) return
      mark.room = region.name
      if (region.floor) mark.floor = normalizeFloor(region.floor)
    })
  }

  getRoomNames(): string[] {
    const names = new Set(this.quantityIndex().locations().rooms)
    for (const pageIndex of new Set([...this.roomRegions.keys(), ...this.pageRoomSets.keys()])) {
      for (const { region } of this.effectiveRoomRegions(pageIndex)) names.add(region.name)
    }
    for (const set of this.roomSets) for (const region of set.regions) names.add(region.name)
    return [...names].sort((a, b) => a.localeCompare(b, 'ja'))
  }
  pickupsInRoom(pageIndex: number, region: RoomRegion): string[] {
    const effective = this.effectiveRoomRegions(pageIndex).find(entry => entry.region.id === region.id)?.region ?? region
    const ids: string[] = []
    for (const annotation of this.annotations.values()) {
      if (annotation.deleted || annotation.legacyChange || annotation.pageIndex !== pageIndex
        || !annotation.count && !annotation.quantity) continue
      const point = pickupPoint(annotation)
      if (point && pointInRoomRegion(effective, point)) ids.push(annotation.id)
    }
    return ids
  }

  getScale(pageIndex: number): PageScale | null { const s = this.scales.get(pageIndex); return s ? { ...s } : null }

  private replaceFixtures(next: CountFixture[]): void {
    this.fixtures = next
    this.contentRevision += 1
    this.fixturesRevision += 1
  }

  /** 項目定義の版。項目の配列を置き換えるたびに増える（単調増加）。 */
  getFixturesRevision(): number { return this.fixturesRevision }

  /** 画面用の項目一覧。版が同じあいだは同じ配列を返す。配列・要素・入れ子をすべて Object.freeze 済み。内部の配列とは別物。 */
  getCountFixturesSnapshot(): readonly CountFixture[] {
    if (this.fixturesSnapshotCache?.revision !== this.fixturesRevision) {
      const value = perfTime('store.fixturesSnapshot.build', () => {
        return deepFreeze(structuredClone(this.fixtures))
      })
      this.fixturesSnapshotCache = { revision: this.fixturesRevision, value }
    }
    return this.fixturesSnapshotCache.value
  }

  getCountFixtures(): CountFixture[] { return perfTime('store.getCountFixtures', () => structuredClone(this.fixtures)) }
  /** 数量の索引と同じ注釈（削除済みを含む。索引・形の計量の側で除く）。項目の編集の見本の計算に使う（SPEC-B07-2b）。 */
  quantityAnnotations(): Iterable<AnnotationState> { return this.annotations.values() }
  hasCountMarks(): boolean { for (const a of this.annotations.values()) if (!a.deleted && (a.count || a.quantity)) return true; return false }
  getCountFixture(id: string | null): CountFixture | undefined { return this.fixtures.find(f => f.id === id) }
  linkDependents(id: string): CountFixture[] {
    return structuredClone(this.fixtures.filter(f => f.link?.sources.some(source => source.itemId === id)))
  }
  private hasLinkedPickup(mark: { quantity?: QuantityMark | null; count?: CountMark | null }): boolean {
    return !!mark.quantity && routeMembers(mark.quantity).some(e => this.getCountFixture(e.itemId)?.link !== undefined)
      || !!mark.count && countMembers(mark.count).some(e => this.getCountFixture(e.itemId)?.link !== undefined)
  }
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
      this.replaceFixtures(nextFixtures)
      this.legacyCountObjects.clear(); for (const id of legacyIds) this.legacyCountObjects.add(id)
      this.fixtureBaseline = stableJson(this.fixtures)
      this.fixturesReady = true
      this.notify()
    })().finally(() => { if (generation === this.generation) this.fixtureLoading = null })
    return this.fixtureLoading
  }
  selectFixture(id: string | null): void { if (id !== this.selectedFixtureId) this.clearSymbolCandidates(); if (id !== this.routeTemplate?.itemId) this.routeTemplate = null; this.selectedFixtureId = id; if (id !== null) this.rememberFixture(id); this.pruneHiddenSelection(); this.visibilityVersion++; this.notifyUi() }
  isFixtureVisible(id: string): boolean { return !this.hiddenFixtures.has(id) && (!this.onlySelectedFixture || id === this.selectedFixtureId) }
  isCountVisible(mark: CountMark | null | undefined, quantity?: QuantityMark | null): boolean { return quantity ? [quantity.itemId, ...(quantity.extra ?? []).map(e => e.itemId)].some(id => this.isFixtureVisible(id)) : !mark || this.isFixtureVisible(countFixtureId(mark)) || mark.version === 2 && !!mark.extra?.some(e => this.isFixtureVisible(e.itemId)) }
  setFixtureVisible(ids: readonly string[], visible: boolean): void {
    if (visible && this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を表示するため')
    for (const id of ids) { if (visible) this.hiddenFixtures.delete(id); else this.hiddenFixtures.add(id) }
    this.pruneHiddenSelection(); this.visibilityVersion++; this.notifyUi()
  }
  setShowQuantityValues(value: boolean): void { this.showQuantityValues = value; this.notifyUi() }
  setOnlySelectedFixture(value: boolean): void { if (value && this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を表示するため'); this.onlySelectedFixture = value; this.pruneHiddenSelection(); this.visibilityVersion++; this.notifyUi() }
  showAllFixtures(): void { if (this.drawingHidesCounts()) this.releaseDrawingFilter('数量拾いの印を表示するため'); this.hiddenFixtures.clear(); this.onlySelectedFixture = false; this.visibilityVersion++; this.notifyUi() }
  private pruneHiddenSelection(): void { for (const id of this.selection) { const a = this.annotations.get(id); if (!a || a.deleted || !this.isShownOnDrawing(a)) this.selection.delete(id) } }
  quantityIndex(): QuantityIndex {
    if (!this.index || this.indexVersion !== this.quantityVersion) {
      this.index = perfTime('QuantityIndex.build', () => QuantityIndex.build(this.annotations.values(), this.fixtures))
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
    this.notifyUi()
  }
  pickupLocation(pageIndex: number, point?: Point): { floor?: string; room?: string } {
    const regions = point ? this.effectiveRoomRegions(pageIndex) : undefined
    const region = point && regions?.length ? roomAt(regions.map(entry => entry.region), point) : undefined
    const floor = region?.floor || normalizeFloor(this.currentFloor) || floorFromDrawingName(this.getDrawingInfo(pageIndex)?.name ?? '')
    const room = region?.name ?? this.currentRoom.trim()
    return { ...(floor ? { floor } : {}), ...(room ? { room } : {}) }
  }
  updatePickupLocation(ids: readonly string[], key: 'floor' | 'room', value: string, additional?: Partial<Record<'floor' | 'room', string>>): void {
    const values = { ...additional, [key]: value }
    const changes: Array<['floor' | 'room', string]> = []
    for (const locationKey of ['floor', 'room'] as const) {
      const raw = values[locationKey]
      if (raw === undefined) continue
      if (raw.length > 40) return
      changes.push([locationKey, locationKey === 'floor' ? normalizeFloor(raw) : raw.trim()])
    }
    const eligible = ids.filter(id => {
      const a = this.annotations.get(id), mark = a?.quantity ?? (a?.count?.version === 2 ? a.count : a?.count ? {} : null)
      return !!mark && changes.some(([locationKey, text]) => ((mark as { floor?: string; room?: string })[locationKey] ?? '') !== text)
    })
    this.mutateMany(eligible, a => {
      // Upgrade legacy count marks on their first location edit.
      if (a.count?.version === 1) a.count = { version: 2, id: a.count.id, fixtureId: countFixtureId(a.count) }
      const mark = a.quantity ?? (a.count?.version === 2 ? a.count : null)
      if (mark) for (const [locationKey, text] of changes) {
        if (text) mark[locationKey] = text; else delete mark[locationKey]
      }
    })
  }
  readonly lastRouteConditions = new Map<string, RouteConditions>()
  readonly lastCondition = new Map<string, string | undefined>()
  newRouteConditions(itemId: string): RouteConditions {
    const fixture = this.getCountFixture(itemId)
    const cond = structuredClone(this.lastRouteConditions.get(itemId) ?? fixture?.routeDefaults ?? {})
    return fixture && quantityMethod(fixture) === 'lengthWidthDepth'
      ? { ...cond, rise: null, slack: null } : cond
  }
  private newCondition(itemId: string): string | undefined { return this.lastCondition.has(itemId) ? this.lastCondition.get(itemId) : this.getCountFixture(itemId)?.defaultCondition }
  private readonly lastRouteMembers = new Map<string, NonNullable<AnnotationStore['routeTemplate']>>()
  private readonly lastCountComponents = new Map<string, CountComponent[]>()
  clearRouteInheritance(itemId: string): void {
    this.lastRouteConditions.delete(itemId)
    this.lastRouteMembers.delete(itemId)
    // Also remove this item's remembered conditions from other inherited compositions.
    for (const [id, t] of this.lastRouteMembers) {
      if (t.extra.some(e => e.itemId === itemId)) this.lastRouteMembers.set(id, { ...t, extra: t.extra.map(e => e.itemId === itemId ? { ...e, cond: undefined } : e) })
    }
    this.notifyUi()
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
      const routePoints = (q.points ?? [])
        .filter(point => moved ? point.at >= vertexIndex : point.at < vertexIndex)
        .map(point => ({ ...point, at: point.at - (moved ? vertexIndex : 0) }))
      const mark: QuantityMark = { ...cloneQuantity(q), ...(moved ? { id: crypto.randomUUID(), slackM: 0 } : {}), rises: selectedRises,
        addM: riseTotal(selectedRises), cond: condition(q.cond), extra: q.extra?.map(e => ({ ...e, cond: condition(e.cond) })) }
      if (routePoints.length) mark.points = routePoints
      else delete mark.points
      return mark
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
    return [...new Set(ids)].map(itemId => ({ itemId, cond: structuredClone(this.lastRouteConditions.get(itemId)), condition: this.lastCondition.get(itemId), conditionSet: this.lastCondition.has(itemId), members: structuredClone(this.lastRouteMembers.get(itemId)), components: structuredClone(this.lastCountComponents.get(itemId)) }))
  }
  private pickupMemoryIds(annotations: readonly AnnotationState[]): string[] {
    return annotations.flatMap(a => a.quantity ? routeMembers(a.quantity).map(e => e.itemId) : a.count ? countMembers(a.count).map(e => e.itemId) : [])
  }
  private restorePickupMemory(memory: PickupMemory): void {
    const templateMemory = memory.find(entry =>
      Object.hasOwn(entry, 'routeTemplateSnapshot')) as
      (PickupMemory[number] & {
        routeTemplateSnapshot: AnnotationStore['routeTemplate']
      }) | undefined
    if (templateMemory) {
      this.routeTemplate = structuredClone(templateMemory.routeTemplateSnapshot)
    }
    for (const m of memory) {
      if (m.cond === undefined) this.lastRouteConditions.delete(m.itemId); else this.lastRouteConditions.set(m.itemId, structuredClone(m.cond))
      if (!m.conditionSet) this.lastCondition.delete(m.itemId); else this.lastCondition.set(m.itemId, m.condition)
      if (m.members === undefined) this.lastRouteMembers.delete(m.itemId); else this.lastRouteMembers.set(m.itemId, structuredClone(m.members))
      if (m.components === undefined) this.lastCountComponents.delete(m.itemId); else this.lastCountComponents.set(m.itemId, structuredClone(m.components))
    }
  }
  private refreshQuantity(a: StoredAnnotation): void {
    a.text = this.quantityText(a)
    if (a.vertices && a.measure) a.rect = measureBounds(a.vertices, a.measure.kind, a.text, a.fontSize)
  }
  countMarkIdsOf(fixtureId: string): string[] {
    const ids: string[] = []
    for (const a of this.annotations.values()) {
      if (!a.deleted && !a.legacyChange && a.count && !a.quantity && countFixtureId(a.count) === fixtureId) ids.push(a.id)
    }
    return ids
  }
  setCountComponents(ids: readonly string[], extra: readonly CountComponent[], newFixtures: readonly CountFixture[] = []): string | undefined {
    if (!Array.isArray(extra) || [...extra].some(e => !e || typeof e !== 'object')) return '構成要素の値が不正です。'
    const targets = [...new Set(ids)].flatMap(id => {
      const a = this.annotations.get(id)
      return a && !a.deleted && !a.legacyChange && a.count && !a.quantity ? [a] : []
    })
    const fixtures = [...this.getCountFixtures(), ...newFixtures]
    if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) return '追加する項目のIDが重複しています。'
    try { serializeCountFixtures(fixtures) }
    catch (reason) { return reason instanceof Error ? reason.message : String(reason) }
    const byId = new Map(fixtures.map(f => [f.id, f]))
    if (targets.some(a => this.hasLinkedPickup(a))
      || extra.some(e => byId.get(e.itemId)?.link !== undefined)) return '連動の項目は図面に拾いません。'
    const validate = (mainId: string, components: readonly CountComponent[]): string | undefined => {
      if (components.length > 10) return '構成要素は10件までです。'
      if (!validCountComponents(mainId, components)) return '構成要素の値が不正です。'
      for (const e of components) {
        const f = byId.get(e.itemId)
        if (!f) return '構成要素の項目が見つかりません。'
        if (quantityMethod(f) !== 'click') return '構成要素には個数の項目を指定してください。'
      }
    }
    if (!targets.length) {
      const error = validate('', extra)
      if (error) return error
    }
    const proposals: Array<{ annotation: StoredAnnotation; count: Extract<CountMark, { version: 2 }> }> = []
    for (const a of targets) {
      const current = a.count!, mainId = countFixtureId(current)
      const components = extra.filter(e => e.itemId !== mainId)
      const error = validate(mainId, components)
      if (error) return error
      const normalized = components.map(e => ({ itemId: e.itemId, count: e.count, ...(e.condition !== undefined ? { condition: e.condition } : {}) }))
      const next: Extract<CountMark, { version: 2 }> = {
        ...(current.version === 2 ? current : {}),
        version: 2, id: current.id, fixtureId: mainId,
      }
      if (normalized.length) next.extra = normalized; else delete next.extra
      const parsed = parseCount(JSON.stringify(next))
      if (!parsed || parsed.version !== 2 || stableJson(parsed.extra ?? []) !== stableJson(normalized)) return '構成要素を保存できません。項目ID・条件名や印の値を確認してください。'
      proposals.push({ annotation: a, count: next })
    }

    const memoryIds = [
      ...this.pickupMemoryIds(targets),
      ...proposals.flatMap(p => countMembers(p.count).map(e => e.itemId)),
    ]
    const previousMemory = this.pickupMemory(memoryIds)
    const changes = proposals.filter(p => stableJson(p.annotation.count) !== stableJson(p.count))
    for (const p of proposals) this.lastCountComponents.set(p.count.fixtureId, structuredClone(p.count.extra ?? []))
    if (!changes.length && !newFixtures.length) return

    const before: HistoryState = [], after: HistoryState = []
    before.pickupMemory = previousMemory
    after.pickupMemory = this.pickupMemory(memoryIds)
    if (newFixtures.length) {
      before.fixtures = this.getCountFixtures()
      after.fixtures = structuredClone(fixtures)
      this.replaceFixtures(structuredClone(fixtures))
    }
    for (const { annotation, count } of changes) {
      before.push(cloneState(annotation))
      annotation.count = cloneCount(count)
      this.markTouched(annotation); annotation.revision++
      after.push(cloneState(annotation))
    }
    this.history.push({ before, after }); this.pruneHiddenSelection(); this.notify()
    return undefined
  }
  /**
   * 同じ親項目の印と、これからの印の記憶にある基項目を分け直す。
   * 印ごとの個数・施工条件・他の構成要素は変えない。
   */
  splitPerEquipmentComponent(fixtureId: string, itemId: string): string | undefined {
    const existing = this.getCountFixtures()
    const main = existing.find(fixture => fixture.id === fixtureId)
    const base = existing.find(fixture => fixture.id === itemId)
    if (!main || quantityMethod(main) !== 'click'
      || (main.kind ?? 'count') !== 'count') {
      return '親には個数の項目を指定してください。'
    }
    if (!base || !isPerEquipmentComponent(base)) {
      return '機器ごとに分ける基の項目が見つかりません。'
    }
    if (main.id === base.id) return '同じ項目を構成要素にはできません。'
    if (main.link !== undefined || base.link !== undefined) {
      return '連動の項目は図面に拾いません。'
    }

    const targets = this.countMarkIdsOf(fixtureId).flatMap(id => {
      const annotation = this.annotations.get(id)
      return annotation && !annotation.deleted && !annotation.legacyChange
        && annotation.count && !annotation.quantity ? [annotation] : []
    })
    if (targets.some(annotation => this.hasLinkedPickup(annotation))) {
      return '連動の項目は図面に拾いません。'
    }

    const remembered = this.lastCountComponents.get(fixtureId)
    const hasBase = (components: readonly CountComponent[]) =>
      components.some(component => component.itemId === itemId)
    if (!targets.some(annotation => annotation.count?.version === 2
      && hasBase(annotation.count.extra ?? []))
      && !hasBase(remembered ?? [])) return

    const resolved = perEquipmentComponentFixture(base, main, existing)
    const fixtures = [...existing, ...resolved.newFixtures]
    try { serializeCountFixtures(fixtures) }
    catch (reason) {
      return reason instanceof Error ? reason.message : String(reason)
    }
    const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]))
    const replace = (components: readonly CountComponent[]): CountComponent[] =>
      components.map(component => ({
        ...component,
        itemId: component.itemId === itemId
          ? resolved.fixture.id : component.itemId,
      }))
    const validate = (components: readonly CountComponent[]): string | undefined => {
      if (components.length > 10 || !validCountComponents(fixtureId, components)) {
        return '機器別の項目との重複、または構成要素の値が不正です。'
      }
      for (const component of components) {
        const fixture = byId.get(component.itemId)
        if (!fixture) return '構成要素の項目が見つかりません。'
        if (fixture.link !== undefined) return '連動の項目は図面に拾いません。'
        if (quantityMethod(fixture) !== 'click') {
          return '構成要素には個数の項目を指定してください。'
        }
      }
    }
    const proposals: Array<{
      annotation: StoredAnnotation
      count: Extract<CountMark, { version: 2 }>
    }> = []
    for (const annotation of targets) {
      const current = annotation.count!
      if (current.version !== 2 || !hasBase(current.extra ?? [])) continue
      const components = replace(current.extra ?? [])
      const error = validate(components)
      if (error) return error
      const count: Extract<CountMark, { version: 2 }> = {
        ...current,
        extra: components,
      }
      const parsed = parseCount(JSON.stringify(count))
      if (parsed?.version !== 2
        || stableJson(parsed.extra ?? []) !== stableJson(components)) {
        return '構成要素を保存できません。項目ID・条件名や印の値を確認してください。'
      }
      proposals.push({ annotation, count })
    }

    const nextRemembered = remembered === undefined ? undefined : replace(remembered)
    if (nextRemembered !== undefined) {
      const error = validate(nextRemembered)
      if (error) return error
      const parsed = parseCount(JSON.stringify({
        version: 2, id: crypto.randomUUID(), fixtureId, extra: nextRemembered,
      }))
      if (parsed?.version !== 2
        || stableJson(parsed.extra ?? []) !== stableJson(nextRemembered)) {
        return 'これからの印の構成要素を保存できません。'
      }
    }

    const memoryIds = [
      fixtureId, itemId, resolved.fixture.id,
      ...this.pickupMemoryIds(targets),
      ...proposals.flatMap(proposal => countMembers(proposal.count).map(e => e.itemId)),
    ]
    const before: HistoryState = [], after: HistoryState = []
    before.pickupMemory = this.pickupMemory(memoryIds)
    if (nextRemembered !== undefined) {
      this.lastCountComponents.set(fixtureId, structuredClone(nextRemembered))
    }
    after.pickupMemory = this.pickupMemory(memoryIds)
    if (resolved.newFixtures.length) {
      before.fixtures = existing
      after.fixtures = structuredClone(fixtures)
      this.replaceFixtures(structuredClone(fixtures))
    }
    for (const { annotation, count } of proposals) {
      before.push(cloneState(annotation))
      annotation.count = cloneCount(count)
      this.markTouched(annotation)
      annotation.revision++
      after.push(cloneState(annotation))
    }
    this.history.push({ before, after })
    this.pruneHiddenSelection()
    this.notify()
    return undefined
  }

  addComponentToFixture(
    fixtureId: string,
    itemId: string,
    newFixtures: readonly CountFixture[] = [],
  ): { error?: string; changed: number; skipped: number } {
    return this.applyRelatedComponentAddition(fixtureId, itemId, newFixtures)
  }

  private applyRelatedComponentAddition(
    fixtureId: string,
    itemId: string,
    newFixtures: readonly CountFixture[],
    batch?: RelatedAdditionBatch,
  ): { error?: string; changed: number; skipped: number } {
    const fail = (error: string) => ({ error, changed: 0, skipped: 0 })
    const existing = this.getCountFixtures()
    let fixtures = [...existing, ...newFixtures]
    if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) {
      return fail('追加する項目のIDが重複しています。')
    }

    const byId = new Map(fixtures.map(f => [f.id, f]))
    const main = existing.find(f => f.id === fixtureId)
    let component = byId.get(itemId)
    if (!main || quantityMethod(main) !== 'click') {
      return fail('起点には個数の項目を指定してください。')
    }
    if (!component || quantityMethod(component) !== 'click') {
      return fail('構成要素には個数の項目を指定してください。')
    }
    if (main.link !== undefined || component.link !== undefined) {
      return fail('連動の項目は図面に拾いません。')
    }
    if (fixtureId === itemId) return fail('同じ項目を構成要素にはできません。')

    const resolved = perEquipmentComponentFixture(component, main, fixtures)
    component = resolved.fixture
    itemId = component.id
    newFixtures = [...newFixtures, ...resolved.newFixtures]
    fixtures = [...existing, ...newFixtures]
    byId.set(component.id, component)
    if (component.link !== undefined) return fail('連動の項目は図面に拾いません。')
    if (fixtureId === itemId) return fail('同じ項目を構成要素にはできません。')

    try { serializeCountFixtures(fixtures) }
    catch (reason) {
      return fail(reason instanceof Error ? reason.message : String(reason))
    }

    const targets = this.countMarkIdsOf(fixtureId).flatMap(id => {
      const annotation = this.annotations.get(id)
      return annotation ? [annotation] : []
    })
    if (targets.some(a => this.hasLinkedPickup(a))) {
      return fail('連動の項目は図面に拾いません。')
    }

    const validate = (components: readonly CountComponent[]): string | undefined => {
      if (components.length > 10) return '構成要素は10件までです。'
      if (!validCountComponents(fixtureId, components)) return '構成要素の値が不正です。'
      for (const e of components) {
        const fixture = byId.get(e.itemId)
        if (!fixture) return '構成要素の項目が見つかりません。'
        if (fixture.link !== undefined) return '連動の項目は図面に拾いません。'
        if (quantityMethod(fixture) !== 'click') {
          return '構成要素には個数の項目を指定してください。'
        }
      }
    }
    const normalize = (components: readonly CountComponent[]): CountComponent[] =>
      components.map(e => ({
        itemId: e.itemId,
        count: e.count,
        ...(e.condition !== undefined ? { condition: e.condition } : {}),
      }))
    const roundTrip = (
      current: CountMark,
      components: CountComponent[],
    ): Extract<CountMark, { version: 2 }> | undefined => {
      const next: Extract<CountMark, { version: 2 }> = {
        ...(current.version === 2 ? current : {}),
        version: 2,
        id: current.id,
        fixtureId,
      }
      if (components.length) next.extra = components
      else delete next.extra
      const parsed = parseCount(JSON.stringify(next))
      return parsed?.version === 2
        && stableJson(parsed.extra ?? []) === stableJson(components)
        ? next : undefined
    }

    const proposals: Array<{
      annotation: StoredAnnotation
      count: Extract<CountMark, { version: 2 }>
    }> = []
    let skipped = 0
    for (const annotation of targets) {
      const current = annotation.count!
      const components = current.version === 2 ? current.extra ?? [] : []
      if (components.some(e => e.itemId === itemId)) continue
      if (components.length >= 10) { skipped++; continue }

      const nextComponents = normalize([...components, { itemId, count: 1 }])
      const error = validate(nextComponents)
      if (error) return fail(error)
      const count = roundTrip(current, nextComponents)
      if (!count) {
        return fail('構成要素を保存できません。項目ID・条件名や印の値を確認してください。')
      }
      proposals.push({ annotation, count })
    }

    const previousComponents = this.lastCountComponents.get(fixtureId)
    const remembered = previousComponents ?? []
    const memoryChanged = !remembered.some(e => e.itemId === itemId)
      && remembered.length < 10
    let nextRemembered: CountComponent[] | undefined
    if (memoryChanged) {
      nextRemembered = normalize([...remembered, { itemId, count: 1 }])
      const error = validate(nextRemembered)
      if (error) return fail(error)
      const memoryCount: CountMark = {
        version: 2,
        id: crypto.randomUUID(),
        fixtureId,
      }
      if (!roundTrip(memoryCount, nextRemembered)) {
        return fail('これからの印の構成要素を保存できません。')
      }
    }

    if (!proposals.length && !memoryChanged) {
      return { changed: 0, skipped }
    }

    const memoryIds = [
      fixtureId,
      itemId,
      ...this.pickupMemoryIds(targets),
      ...proposals.flatMap(p => countMembers(p.count).map(e => e.itemId)),
    ]
    const before: HistoryState = [], after: HistoryState = []
    before.pickupMemory = this.pickupMemory(memoryIds)
    if (nextRemembered) {
      this.lastCountComponents.set(fixtureId, structuredClone(nextRemembered))
    }
    after.pickupMemory = this.pickupMemory(memoryIds)

    if (newFixtures.length) {
      before.fixtures = existing
      after.fixtures = structuredClone(fixtures)
      this.replaceFixtures(structuredClone(fixtures))
    }
    for (const { annotation, count } of proposals) {
      before.push(cloneState(annotation))
      annotation.count = cloneCount(count)
      this.markTouched(annotation)
      annotation.revision++
      after.push(cloneState(annotation))
    }

    this.recordRelatedAdditionStep(before, after, batch)
    // 件数は実際の印だけを数える。これからの印の記憶は含めない。
    return { changed: proposals.length, skipped }
  }
  // Compatibility wrapper for the current scope selector. Conditions on counted parts survive.
  updateRoute(id: string, count: number, extra: NonNullable<QuantityMark['extra']>, scope?: RouteScope): void {
    const q = this.get(id)?.quantity
    if (!q || scope !== undefined && !validRouteScope(scope)) return
    this.setRouteMembers(id, [{ itemId: q.itemId, count, cond: scope ? withRouteScope(q.cond ?? {}, scope) : q.cond }, ...extra])
  }
  setRouteItems(id: string, members: ReadonlyArray<RouteExtra>): void {
    this.setRouteMembers(id, members)
  }
  addRouteMemberToFixture(
    originId: string,
    member: RouteExtra,
    newFixtures: readonly CountFixture[] = [],
  ): { error?: string; changed: number; skipped: number } {
    const result = this.applyRelatedRouteAdditions(originId, [member], newFixtures)
    return {
      ...(result.error ? { error: result.error } : {}),
      changed: result.changed,
      skipped: result.skipped,
    }
  }

  /** 関連候補の複数項目追加を、項目・経路・記憶まで一つの履歴にする。 */
  addRelatedFixturesToRoute(
    originId: string,
    fixtures: readonly CountFixture[],
    routeId?: string,
  ): {
    error?: string
    changed: number
    skipped: number
    pointRows: number
    pointSkipped: number
  } {
    return this.addRelatedRouteFixtures(originId, fixtures, routeId)
  }

  private addRelatedRouteFixtures(
    originId: string,
    fixtures: readonly CountFixture[],
    routeId?: string,
    batch?: RelatedAdditionBatch,
  ): ReturnType<AnnotationStore['addRelatedFixturesToRoute']> {
    const existingById = new Map(
      this.getCountFixtures().map(fixture => [fixture.id, fixture]),
    )
    const newFixtures = fixtures.filter(fixture => !existingById.has(fixture.id))
    // 既存IDでは、引数の内容ではなく文書に保存されている項目を使う。
    const resolvedFixtures = fixtures.map(fixture =>
      existingById.get(fixture.id) ?? fixture)
    const origin = existingById.get(originId)
    const members: RouteExtra[] = resolvedFixtures.flatMap(fixture => {
      if (fixture.link !== undefined
        || quantityMethod(fixture) !== 'polyline' && !isRouteSurfaceFixture(fixture)) {
        return []
      }
      const perM = origin && isRouteSurfaceFixture(fixture)
        ? surfacePerimeterM(origin) : undefined
      return [{
        itemId: fixture.id,
        count: 1,
        cond: {},
        ...(perM !== undefined ? { perM } : {}),
      }]
    })
    const pointItemIds = routeId ? resolvedFixtures
      .filter(fixture =>
        fixture.link === undefined && quantityMethod(fixture) === 'click')
      .map(fixture => fixture.id) : []
    return this.applyRelatedRouteAdditions(
      originId, members, newFixtures, routeId, pointItemIds, batch,
    )
  }

  private applyRelatedRouteAdditions(
    originId: string,
    additions: readonly RouteExtra[],
    newFixtures: readonly CountFixture[],
    routeId?: string,
    pointItemIds: readonly string[] = [],
    batch?: RelatedAdditionBatch,
  ): {
    error?: string
    changed: number
    skipped: number
    pointRows: number
    pointSkipped: number
  } {
    const fail = (error: string) => ({
      error, changed: 0, skipped: 0, pointRows: 0, pointSkipped: 0,
    })
    const existing = this.getCountFixtures()
    const fixtures = [...existing, ...newFixtures]
    if (new Set(fixtures.map(fixture => fixture.id)).size !== fixtures.length) {
      return fail('追加する項目のIDが重複しています。')
    }
    const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]))
    const origin = existing.find(fixture => fixture.id === originId)
    if (!origin || origin.link !== undefined || quantityMethod(origin) !== 'polyline') {
      return fail('起点には連動でない長さの項目を指定してください。')
    }

    const validate = (members: readonly RouteExtra[]): string | undefined => {
      if (!members.length || members.length > 11) return '追加の線要素は10件までです。'
      const ids = new Set<string>()
      for (const [index, member] of members.entries()) {
        const fixture = byId.get(member.itemId)
        if (!fixture) return '線要素の項目が見つかりません。'
        if (fixture.link !== undefined) return '連動の項目は図面に拾いません。'
        if (ids.has(member.itemId) || !validRouteCount(member.count)
          || member.cond !== undefined && !validRouteConditions(member.cond)
          || member.perM !== undefined && !validRoutePerM(member.perM)) {
          return '線要素の値が不正です。'
        }
        const method = quantityMethod(fixture)
        if (index === 0) {
          if (isRouteSurfaceFixture(fixture) || method !== 'polyline'
            || (member.perM ?? 1) !== 1) {
            return '主には長さの項目を指定してください。'
          }
        } else if (method !== 'polyline' && method !== 'lengthWidthDepth'
          && !isRouteSurfaceFixture(fixture)) {
          return '追加の線要素には長さ・面積・幅と深さで計算する項目を指定してください。'
        }
        ids.add(member.itemId)
      }
    }
    const normalize = (member: RouteExtra): RouteExtra => {
      const cond = normalizeRouteConditions(member.cond)
      return {
        itemId: member.itemId,
        count: member.count,
        cond: quantityMethod(byId.get(member.itemId)!) === 'lengthWidthDepth'
          ? { ...cond, rise: null, slack: null } : cond,
        ...(member.perM !== undefined ? { perM: member.perM } : {}),
      }
    }
    const withMembers = (
      quantity: QuantityMark,
      members: readonly RouteExtra[],
    ): QuantityMark => {
      const [main, ...extra] = members
      const next = {
        ...quantity,
        itemId: main.itemId,
        count: main.count === 1 ? undefined : main.count,
        cond: main.cond,
        extra: extra.length ? extra : undefined,
      }
      if (next.count === undefined) delete next.count
      if (next.extra === undefined) delete next.extra
      return next
    }

    try {
      serializeCountFixtures(fixtures)
      // 起点そのものは「すでに主にある」として扱う。
      for (const addition of additions) {
        const error = validate(addition.itemId === originId
          ? [addition] : [{ itemId: originId, count: 1, cond: {} }, addition])
        if (error) return fail(error)
      }
      for (const itemId of pointItemIds) {
        const fixture = byId.get(itemId)
        if (!fixture || fixture.link !== undefined || quantityMethod(fixture) !== 'click') {
          return fail('頂点には連動でない個数の項目を指定してください。')
        }
      }
    } catch (reason) {
      return fail(reason instanceof Error ? reason.message : String(reason))
    }

    const skippedRoutes = new Set<string>()
    const append = (
      quantity: QuantityMark,
      skipped: () => void,
    ): { quantity: QuantityMark; changed: boolean } => {
      let next = quantity
      let changed = false
      for (const addition of additions) {
        const current = routeMembers(next)
        if (current.some(member => member.itemId === addition.itemId)) continue
        if (current.length >= 11) { skipped(); continue }

        const members = [...current, addition].map(normalize)
        const error = validate(members)
        if (error) throw new Error(error)
        const proposed = withMembers(next, members)
        if (serializeQuantityMark(proposed).length > 8000) {
          skipped()
          continue
        }
        next = proposed
        changed = true
      }
      return { quantity: next, changed }
    }

    const targets = [...this.annotations.values()].filter(annotation =>
      !annotation.deleted && !annotation.legacyChange
      && annotation.quantity?.method === 'polyline'
      && annotation.quantity.itemId === originId)
    const proposals: Array<{
      annotation: StoredAnnotation
      quantity: QuantityMark
      membersChanged: boolean
    }> = []
    let pointRows = 0
    let pointSkipped = 0
    let nextRemembered: NonNullable<AnnotationStore['routeTemplate']> | undefined
    let nextTemplate: NonNullable<AnnotationStore['routeTemplate']> | undefined

    try {
      for (const annotation of targets) {
        const canAddPoints = annotation.id === routeId && pointItemIds.length > 0
        if (!additions.length && !canAddPoints) continue
        if (this.hasLinkedPickup(annotation)) {
          return fail('連動の項目は図面に拾いません。')
        }

        const result = append(annotation.quantity!, () =>
          skippedRoutes.add(annotation.id))
        let quantity = result.quantity
        let pointsChanged = false
        if (canAddPoints) {
          for (const itemId of pointItemIds) {
            const points = quantity.points ?? []
            const at = nextRoutePointAt(points, annotation.vertices?.length ?? 0, itemId)
            if (points.length >= 50 || at === undefined) {
              pointSkipped++
              continue
            }
            const nextPoints = [...points, { itemId, at, count: 1 }]
            if (!validRoutePoints(nextPoints)) {
              return fail('頂点の個数の値が不正です。')
            }
            const proposed = { ...quantity, points: nextPoints }
            if (serializeQuantityMark(proposed).length > 8000) {
              pointSkipped++
              continue
            }
            quantity = proposed
            pointsChanged = true
            pointRows++
          }
        }
        if (result.changed || pointsChanged) {
          proposals.push({
            annotation, quantity, membersChanged: result.changed,
          })
        }
      }

      const appendTemplate = (
        template: NonNullable<AnnotationStore['routeTemplate']>,
      ): NonNullable<AnnotationStore['routeTemplate']> | undefined => {
        const quantity: QuantityMark = {
          version: 1,
          id: crypto.randomUUID(),
          method: 'polyline',
          itemId: template.itemId,
          count: template.count,
          cond: template.cond,
          extra: template.extra,
        }
        const result = append(quantity, () => {})
        if (!result.changed) return undefined
        return {
          ...template,
          extra: structuredClone(result.quantity.extra ?? []),
        }
      }

      if (additions.length) {
        nextRemembered = appendTemplate(this.lastRouteMembers.get(originId) ?? {
          itemId: originId, count: 1, cond: {}, extra: [], name: '',
        })
        if (this.routeTemplate?.itemId === originId) {
          nextTemplate = appendTemplate(this.routeTemplate)
        }
      }
    } catch (reason) {
      return fail(reason instanceof Error ? reason.message : String(reason))
    }

    const changed = proposals.filter(proposal => proposal.membersChanged).length
    const skipped = skippedRoutes.size
    if (!proposals.length && !newFixtures.length && !nextRemembered && !nextTemplate) {
      return { changed: 0, skipped, pointRows: 0, pointSkipped }
    }

    const memoryIds = [
      originId,
      ...additions.map(member => member.itemId),
      ...this.pickupMemoryIds(targets),
    ]
    const before: HistoryState = [], after: HistoryState = []
    before.pickupMemory = this.pickupMemory(memoryIds)
    // 履歴だけの付加情報。PDF・経路・個数の保存形式には入れない。
    if (nextTemplate) {
      Object.assign(before.pickupMemory[0], {
        routeTemplateSnapshot: structuredClone(this.routeTemplate),
      })
    }
    if (nextRemembered) {
      this.lastRouteMembers.set(originId, structuredClone(nextRemembered))
    }
    if (nextTemplate) this.routeTemplate = structuredClone(nextTemplate)
    after.pickupMemory = this.pickupMemory(memoryIds)
    if (nextTemplate) {
      Object.assign(after.pickupMemory[0], {
        routeTemplateSnapshot: structuredClone(this.routeTemplate),
      })
    }

    if (newFixtures.length) {
      before.fixtures = existing
      after.fixtures = structuredClone(fixtures)
      this.replaceFixtures(structuredClone(fixtures))
    }
    for (const { annotation, quantity } of proposals) {
      before.push(cloneState(annotation))
      annotation.quantity = cloneQuantity(quantity)
      this.refreshQuantity(annotation)
      this.markTouched(annotation)
      annotation.revision++
      after.push(cloneState(annotation))
    }

    this.recordRelatedAdditionStep(before, after, batch)
    return { changed, skipped, pointRows, pointSkipped }
  }

  setRouteMembers(id: string, members: ReadonlyArray<RouteExtra>): void {
    this.addFixturesAndSetRouteItems([], id, members)
  }
  addFixturesAndSetRouteItems(newFixtures: readonly CountFixture[], id: string, members: ReadonlyArray<RouteExtra>): void {
    const a = this.annotations.get(id), q = a?.quantity
    if (!a || a.deleted || a.legacyChange || q?.method !== 'polyline' || !members.length || members.length > 11) return
    if (this.hasLinkedPickup(a)) return
    const fixtures = [...this.getCountFixtures(), ...newFixtures]
    if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) return
    const ids = new Set<string>()
    const byId = new Map(fixtures.map(f => [f.id, f]))
    for (const [i, e] of members.entries()) {
      const f = byId.get(e.itemId)
      if (!f || f.link !== undefined || ids.has(e.itemId)
        || !validRouteCount(e.count)
        || e.cond !== undefined && !validRouteConditions(e.cond)
        || e.perM !== undefined && !validRoutePerM(e.perM)) return
      const method = quantityMethod(f)
      if (i === 0) {
        if (isRouteSurfaceFixture(f) || method !== 'polyline' || (e.perM ?? 1) !== 1) return
      } else if (method !== 'polyline' && method !== 'lengthWidthDepth'
        && !isRouteSurfaceFixture(f)) return
      ids.add(e.itemId)
    }
    if (newFixtures.length) serializeCountFixtures(fixtures)
    const normalized = members.map((e, i) => {
      const cond = normalizeRouteConditions(e.cond)
      return {
        itemId: e.itemId,
        count: e.count,
        cond: quantityMethod(byId.get(e.itemId)!) === 'lengthWidthDepth'
          ? { ...cond, rise: null, slack: null } : cond,
        ...(i > 0 && e.perM !== undefined ? { perM: e.perM } : {}),
      }
    })
    const proposed = { ...q, itemId: normalized[0].itemId, count: normalized[0].count, cond: normalized[0].cond, extra: normalized.slice(1) }
    if (serializeQuantityMark(proposed).length > 8000) return
    const current = routeMembers(q)
    const memoryIds = [...current.map(e => e.itemId), ...normalized.map(e => e.itemId)], previousMemory = this.pickupMemory(memoryIds)
    this.rememberRoute({ ...q, itemId: normalized[0].itemId, count: normalized[0].count, cond: normalized[0].cond, extra: normalized.slice(1) })
    if (!newFixtures.length && stableJson(current.map(e => ({ ...e, cond: routeConditionsKey(e.cond) }))) === stableJson(normalized.map(e => ({ ...e, cond: routeConditionsKey(e.cond) })))) return
    const before: HistoryState = [cloneState(a)], after: HistoryState = []
    if (newFixtures.length) { before.fixtures = this.getCountFixtures(); after.fixtures = structuredClone(fixtures); this.replaceFixtures(structuredClone(fixtures)) }
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
  setRoutePoints(id: string, points: readonly RoutePoint[]): string | undefined {
    const current = this.annotations.get(id)
    if (!current || current.deleted || current.legacyChange || current.quantity?.method !== 'polyline') {
      return 'この拾いには頂点の個数を設定できません。'
    }
    if (!validRoutePoints(points)) {
      return '頂点の個数は50件までです。項目・頂点・施工条件を確認し、数は1〜99の整数で、同じ項目と頂点を重複させずに入力してください。'
    }
    for (const point of points) {
      const fixture = this.getCountFixture(point.itemId)
      if (!fixture) return '頂点の個数の項目が見つかりません。'
      if (quantityMethod(fixture) !== 'click') return '頂点には個数の項目を設定してください。'
      if (fixture.link !== undefined) return '連動の項目は頂点の個数に設定できません。'
    }
    const next = points.map(point => ({
      itemId: point.itemId, at: point.at, count: point.count,
      ...(point.condition !== undefined ? { condition: point.condition } : {}),
    }))
    const proposed = cloneQuantity(current.quantity)
    if (next.length) proposed.points = next
    else delete proposed.points
    try {
      if (serializeQuantityMark(proposed).length > 8000) {
        return '頂点の個数を追加すると経路の保存容量を超えます。項目数や施工条件の長さを減らしてください。'
      }
    } catch {
      return '頂点の個数を保存できません。項目・数・施工条件を確認してください。'
    }
    this.mutate(id, a => {
      a.quantity = proposed
      this.refreshQuantity(a)
    })
    return undefined
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
  addConditionAndSetCountComponent(itemId: string, condition: string, ids: readonly string[]): string | undefined {
    const targets = [...new Set(ids)].filter(id => {
      const a = this.annotations.get(id)
      return a && !a.deleted && !a.legacyChange && !a.quantity
        && a.count?.version === 2 && a.count.extra?.some(e => e.itemId === itemId)
    })
    if (!targets.length) return '条件を適用できる拾いがありません。'
    return this.addConditionAndApply(itemId, condition, targets, a => {
      const current = a.count
      if (a.quantity || current?.version !== 2 || !current.extra?.some(e => e.itemId === itemId)) return
      const extra = current.extra.map(e => e.itemId === itemId ? { ...e, condition } : { ...e })
      const next: Extract<CountMark, { version: 2 }> = { ...current, extra }
      // addConditionAndApply first runs this callback on detached annotations.
      // Reject a count that cannot round-trip before adding its candidate or changing memory.
      const parsed = parseCount(JSON.stringify(next))
      if (!parsed || parsed.version !== 2 || stableJson(parsed.extra ?? []) !== stableJson(extra)) {
        throw new Error('構成要素を保存できません。項目ID・条件名や印の値を確認してください。')
      }
      a.count = next
      this.lastCountComponents.set(next.fixtureId, structuredClone(extra))
      this.lastCondition.set(itemId, condition)
    })
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
      else if (a.quantity && (a.quantity.itemId === id || a.quantity.extra?.some(e => e.itemId === id))
        || a.count?.version === 2 && a.count.extra?.some(e => e.itemId === id)) detached++
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
    if (!this.countOverlayCache
      || this.countOverlayCache.contentRevision !== this.contentRevision
      || this.countOverlayCache.fixturesReady !== this.fixturesReady) {
      this.countOverlayCache = {
        contentRevision: this.contentRevision,
        fixturesReady: this.fixturesReady,
        pages: new Map(),
      }
    }
    const cache = this.countOverlayCache.pages
    let cached = cache.get(pageIndex)
    if (cached === undefined) {
      cached = perfTime('store.countOverlayObjNums', () => {
        const result: number[] = []
        for (const a of this.annotations.values()) if (!a.deleted && a.pageIndex === pageIndex && (a.count && this.fixtureForCount(a.count) || a.quantity && this.getCountFixture(a.quantity.itemId)) && a.objNum !== null) result.push(a.objNum)
        return result
      })
      cache.set(pageIndex, cached)
    }
    return [...cached]
  }
  issueOverlayObjNums(pageIndex: number): number[] {
    if (!this.issueOverlayCache
      || this.issueOverlayCache.contentRevision !== this.contentRevision) {
      this.issueOverlayCache = {
        contentRevision: this.contentRevision,
        pages: new Map(),
      }
    }
    const cache = this.issueOverlayCache.pages
    let cached = cache.get(pageIndex)
    if (cached === undefined) {
      cached = perfTime('store.issueOverlayObjNums', () => {
        const result: number[] = []
        for (const a of this.annotations.values()) if (!a.deleted && !a.legacyChange && a.pageIndex === pageIndex && a.issue && a.issue.recordKind !== 'change' && a.objNum !== null) result.push(a.objNum)
        return result
      })
      cache.set(pageIndex, cached)
    }
    return [...cached]
  }
  fixtureDimensionMarks(next: CountFixture): { matched: number; customized: number } {
    const previous = this.getCountFixture(next.id)
    let matched = 0, customized = 0
    if (!previous) return { matched, customized }
    for (const a of this.annotations.values()) {
      if (a.deleted || a.legacyChange || !a.quantity) continue
      const plan = planFixtureDimensions(a.quantity, previous, next)
      if (!plan) continue
      if (plan.customized) customized++
      else matched++
    }
    return { matched, customized }
  }

  private recordRelatedAdditionStep(
    before: HistoryState,
    after: HistoryState,
    batch?: RelatedAdditionBatch,
  ): void {
    if (batch) {
      batch.push({ before, after })
      return
    }
    this.history.push({ before, after })
    this.pruneHiddenSelection()
    this.notify()
  }

  private commitRelatedAdditionBatch(batch: RelatedAdditionBatch): void {
    if (!batch.length) return

    const before: HistoryState = [], after: HistoryState = []
    const beforeAnnotations = new Map<string, AnnotationState>()
    const afterAnnotations = new Map<string, AnnotationState>()
    const beforeMemory = new Map<string, PickupMemory[number]>()
    const afterMemory = new Map<string, PickupMemory[number]>()

    for (const step of batch) {
      for (const annotation of step.before) {
        if (!beforeAnnotations.has(annotation.id)) {
          beforeAnnotations.set(annotation.id, annotation)
        }
      }
      for (const annotation of step.after) {
        afterAnnotations.set(annotation.id, annotation)
      }
      for (const memory of step.before.pickupMemory ?? []) {
        if (!beforeMemory.has(memory.itemId)) {
          beforeMemory.set(memory.itemId, memory)
        }
      }
      for (const memory of step.after.pickupMemory ?? []) {
        afterMemory.set(memory.itemId, memory)
      }
      if (step.before.fixtures !== undefined && before.fixtures === undefined) {
        before.fixtures = step.before.fixtures
      }
      if (step.after.fixtures !== undefined) after.fixtures = step.after.fixtures
    }

    before.push(...beforeAnnotations.values())
    after.push(...afterAnnotations.values())
    if (beforeMemory.size) before.pickupMemory = [...beforeMemory.values()]
    if (afterMemory.size) after.pickupMemory = [...afterMemory.values()]
    this.recordRelatedAdditionStep(before, after)
  }

  applyRelatedAdditions(
    originId: string,
    fixtures: readonly CountFixture[],
    routeId?: string,
  ): RelatedAdditionResult {
    const result: RelatedAdditionResult = {
      changed: 0,
      skipped: 0,
      pointRows: 0,
      pointSkipped: 0,
      componentMarks: 0,
      componentSkipped: 0,
      linked: 0,
      sourcesAdded: 0,
      guidance: 0,
      effects: [],
    }
    const existing = this.getCountFixtures()
    const origin = existing.find(fixture => fixture.id === originId)
    if (!origin) return { ...result, error: '起点の項目が見つかりません。' }

    const byId = new Map(existing.map(fixture => [fixture.id, fixture]))
    const byIdentity = new Map(
      existing.map(fixture => [fixtureIdentity(fixture), fixture]),
    )
    const resolved: CountFixture[] = []
    const newFixtures: CountFixture[] = []
    const seen = new Set<string>()

    for (const input of fixtures) {
      // 既存IDの保存内容を優先し、標準マスタの同一項目も再利用する。
      let fixture = byId.get(input.id)
        ?? byIdentity.get(fixtureIdentity(input))
        ?? input
      if (relatedAdditionKind(origin, fixture, routeId) === 'component') {
        fixture = perEquipmentComponentFixture(
          fixture, origin, [...byId.values()],
        ).fixture
      }
      if (!byId.has(fixture.id)) {
        newFixtures.push(fixture)
        byId.set(fixture.id, fixture)
        byIdentity.set(fixtureIdentity(fixture), fixture)
      }
      if (!seen.has(fixture.id)) {
        resolved.push(fixture)
        seen.add(fixture.id)
      }
    }

    const combined = [...existing, ...newFixtures]
    try { serializeCountFixtures(combined) }
    catch (reason) {
      return {
        ...result,
        error: reason instanceof Error ? reason.message : String(reason),
      }
    }

    const batch: RelatedAdditionBatch = []
    const guide = (fixture: CountFixture, reason?: string): void => {
      result.guidance++
      result.effects.push({
        itemId: fixture.id, name: fixture.name, kind: 'guidance',
        ...(reason ? { reason } : {}),
      })
    }

    if (newFixtures.length) {
      const before: HistoryState = [], after: HistoryState = []
      before.fixtures = structuredClone(existing)
      after.fixtures = structuredClone(combined)
      this.replaceFixtures(structuredClone(combined))
      this.recordRelatedAdditionStep(before, after, batch)
    }

    if (origin.link === undefined && quantityMethod(origin) === 'polyline') {
      const eligible = resolved.filter(fixture =>
        relatedAdditionKind(origin, fixture, routeId) !== undefined)
      const routeResult = eligible.length
        ? this.addRelatedRouteFixtures(originId, eligible, routeId, batch)
        : { changed: 0, skipped: 0, pointRows: 0, pointSkipped: 0 }
      result.changed = routeResult.changed
      result.skipped = routeResult.skipped
      result.pointRows = routeResult.pointRows
      result.pointSkipped = routeResult.pointSkipped

      for (const fixture of resolved) {
        const kind = relatedAdditionKind(origin, fixture, routeId)
        if (!kind || routeResult.error) {
          guide(fixture, routeResult.error)
        } else {
          result.effects.push({ itemId: fixture.id, name: fixture.name, kind })
        }
      }
    } else {
      const initialLinkedFixtures = this.getCountFixtures()
      let linkedFixtures = initialLinkedFixtures

      for (const resolvedFixture of resolved) {
        const fixture = linkedFixtures.find(value => value.id === resolvedFixture.id)!
        const kind = relatedAdditionKind(origin, fixture, routeId)
        if (!kind) {
          guide(fixture, origin.link !== undefined
            ? '起点が連動の項目のため、自動では反映しません。'
            : undefined)
          continue
        }

        if (kind === 'component') {
          const componentResult = this.applyRelatedComponentAddition(
            originId, fixture.id, [], batch,
          )
          if (componentResult.error) {
            guide(fixture, componentResult.error)
          } else {
            result.componentMarks += componentResult.changed
            result.componentSkipped += componentResult.skipped
            result.effects.push({
              itemId: fixture.id,
              name: fixture.name,
              kind,
              changed: componentResult.changed,
              skipped: componentResult.skipped,
              futureApplied: this.lastCountComponents.get(originId)
                ?.some(component => component.itemId === fixture.id) ?? false,
            })
          }
          continue
        }

        if (kind !== 'factor' && kind !== 'perimeter') {
          guide(fixture)
          continue
        }
        if (this.fixtureMarkCount(fixture.id) !== 0) {
          guide(fixture, 'すでに印・拾いがあるため、連動には変更しません。')
          continue
        }

        let link: NonNullable<CountFixture['link']>
        let sourceAdded = false
        if (fixture.link?.kind === 'factor') {
          if (fixture.link.sources.some(source => source.itemId === originId)) {
            result.effects.push({
              itemId: fixture.id, name: fixture.name, kind: 'unchanged',
            })
            continue
          }
          if (fixture.link.sources.length >= 50) {
            guide(fixture, '連動の元は50件までです。')
            continue
          }
          link = {
            ...fixture.link,
            sources: [...fixture.link.sources, { itemId: originId, factor: 1 }],
          }
          sourceAdded = true
        } else if (fixture.link !== undefined) {
          guide(fixture, '既存の係数以外の連動は、自動では変更しません。')
          continue
        } else {
          link = kind === 'perimeter'
            ? {
              kind: 'shape',
              shape: { output: 'perimeter' },
              sources: [{ itemId: originId }],
            }
            : {
              kind: 'factor',
              sources: [{ itemId: originId, factor: 1 }],
            }
        }

        const proposed: CountFixture = { ...fixture, link }
        const error = fixtureLinkError(proposed)
        if (error) {
          guide(fixture, error)
          continue
        }
        const next = linkedFixtures.map(value =>
          value.id === fixture.id ? proposed : value)
        try { serializeCountFixtures(next) }
        catch (reason) {
          guide(fixture, reason instanceof Error ? reason.message : String(reason))
          continue
        }

        linkedFixtures = next
        if (sourceAdded) result.sourcesAdded++
        else result.linked++
        result.effects.push({
          itemId: fixture.id,
          name: fixture.name,
          kind: sourceAdded ? 'source' : kind,
        })
      }

      if (linkedFixtures !== initialLinkedFixtures) {
        const before: HistoryState = [], after: HistoryState = []
        before.fixtures = structuredClone(initialLinkedFixtures)
        after.fixtures = structuredClone(linkedFixtures)
        this.replaceFixtures(structuredClone(linkedFixtures))
        this.recordRelatedAdditionStep(before, after, batch)
      }
    }

    this.commitRelatedAdditionBatch(batch)
    return result
  }

  setCountFixtures(fixtures: CountFixture[], removeIds: readonly string[] = [], refreshIds: readonly string[] = []): void {
    // Preserve edit metadata before creating detached fixtures with changed sources.
    const renames = new Map(fixtures.map(f => [f.id, fixtureConditionRenames(f)] as const).filter(([, edits]) => edits.size))
    const dimensionFixtures = new Map(fixtures
      .filter(fixtureDimensionUpdateEnabled).map(f => [f.id, f] as const))
    const dimensionUpdates = new Map<string, FixtureDimensionValues>()
    if (dimensionFixtures.size) for (const a of this.annotations.values()) {
      if (a.deleted || a.legacyChange || !a.quantity || removeIds.includes(a.quantity.itemId)) continue
      const next = dimensionFixtures.get(a.quantity.itemId)
      const previous = this.getCountFixture(a.quantity.itemId)
      if (!next || !previous) continue
      const plan = planFixtureDimensions(a.quantity, previous, next)
      if (!plan || plan.customized) continue
      const proposed = cloneQuantity(a.quantity)
      for (const key of FIXTURE_DIMENSION_KEYS) if (Object.hasOwn(plan.values, key)) {
        const value = plan.values[key]
        if (value === undefined) delete proposed[key]
        else proposed[key] = value
      }
      if (!parseQuantityMark(serializeQuantityMark(proposed))) {
        throw new Error('寸法を反映した拾いを保存できません。寸法の値を確認してください。')
      }
      dimensionUpdates.set(a.id, plan.values)
    }
    if (removeIds.length) {
      const removed = new Set(removeIds)
      fixtures = fixtures.map(f => f.link?.sources.some(source => removed.has(source.itemId))
        ? { ...f, link: { ...f.link!, sources: f.link!.sources.filter(source => !removed.has(source.itemId)) } }
        : f)
    }
    const fixturesChanged = stableJson(fixtures) !== stableJson(this.fixtures)
    if (!removeIds.length && !refreshIds.length && !fixturesChanged) return
    const refresh = new Set(refreshIds)
    serializeCountFixtures(fixtures)
    if (removeIds.length) {
      const removed = new Set(removeIds)
      const available = new Map(fixtures.map(f => [f.id, f]))
      for (const a of this.annotations.values()) {
        const q = a.quantity
        if (a.deleted || q?.method !== 'polyline' || !removed.has(q.itemId)) continue
        const remaining = routeMembers(q).filter(e => !removed.has(e.itemId))
        if (remaining.length && !remaining.some(e => {
          const f = available.get(e.itemId)
          return f && f.link === undefined && quantityMethod(f) === 'polyline'
            && (e.perM ?? 1) === 1
        })) {
          throw new Error('主項目を削除すると、主にできる線項目が残りません。係数1の線項目を構成に追加するか、この経路の印を削除してください。')
        }
      }
    }
    const before: HistoryState = [], after: HistoryState = []
    before.fixtures = this.getCountFixtures(); after.fixtures = structuredClone(fixtures)
    const renamedIds = [...renames.keys()] as string[]
    const memoryIds = [...new Set([
      ...renamedIds, ...removeIds,
      ...[...this.lastRouteMembers].filter(([, t]) => [t.itemId, ...t.extra.map(e => e.itemId)].some(id => renames.has(id))).map(([id]) => id),
      ...[...this.lastCountComponents].filter(([id, components]) => removeIds.includes(id) || components.some(e => renames.has(e.itemId) || removeIds.includes(e.itemId))).map(([id]) => id),
    ])]
    if (memoryIds.length) before.pickupMemory = this.pickupMemory(memoryIds)
    if (renames.size) before.routeTemplate = structuredClone(this.routeTemplate)
    const renameCondition = (itemId: string, v: PartCondition) => typeof v === 'string' ? renames.get(itemId)?.get(v) ?? v : v
    const renameRoute = (itemId: string, c: RouteConditions = {}): RouteConditions => normalizeRouteConditions({ plan: renameCondition(itemId, c.plan), rise: Array.isArray(c.rise) ? c.rise.map(v => renameCondition(itemId, v)) : renameCondition(itemId, c.rise), slack: renameCondition(itemId, c.slack) })
    const renameTemplate = (t: RouteTemplate): RouteTemplate => ({ ...t, cond: renameRoute(t.itemId, t.cond), extra: t.extra.map(e => ({ ...e, cond: renameRoute(e.itemId, e.cond) })) })
    const renameComponents = (components: readonly CountComponent[]): CountComponent[] => components
      .filter(e => !removeIds.includes(e.itemId))
      .map(e => ({ itemId: e.itemId, count: e.count, ...(e.condition !== undefined ? { condition: renameCondition(e.itemId, e.condition) as string } : {}) }))
    const renamePoints = (points: readonly RoutePoint[]): RoutePoint[] => points
      .filter(point => !removeIds.includes(point.itemId))
      .map(point => ({
        itemId: point.itemId, at: point.at, count: point.count,
        ...(point.condition !== undefined
          ? { condition: renameCondition(point.itemId, point.condition) as string } : {}),
      }))
    // A longer name repeated across many members/rises can exceed the mark limit.
    // Reject the whole edit before changing fixtures, marks or inheritance memory.
    for (const edits of renames.values()) for (const name of edits.values()) if (!validCondition(name)) throw new Error('改名後の施工条件は1〜30文字で、前後の空白や改行を入れずに入力してください。')
    if (renames.size) for (const a of this.annotations.values()) {
      const q = a.quantity
      if (a.deleted || q?.method !== 'polyline'
        || !(routeMembers(q).some(e => renames.has(e.itemId))
          || q.points?.some(point => renames.has(point.itemId)))) continue
      const renamed = { ...q, cond: renameRoute(q.itemId, q.cond),
        extra: q.extra?.map(e => ({ ...e, cond: renameRoute(e.itemId, e.cond) })),
        points: q.points ? renamePoints(q.points) : undefined }
      if (!parseQuantityMark(serializeQuantityMark(renamed))) throw new Error('施工条件の改名で経路の保存容量を超えます。条件名を短くしてください。')
    }
    if (renames.size) for (const a of this.annotations.values()) {
      const c = a.count
      if (a.deleted || c?.version !== 2 || removeIds.includes(c.fixtureId) || !countMembers(c).some(e => renames.has(e.itemId))) continue
      const renamed = { ...c }, extra = renameComponents(c.extra ?? [])
      if (c.condition !== undefined) renamed.condition = renameCondition(c.fixtureId, c.condition) as string
      if (extra.length) renamed.extra = extra; else delete renamed.extra
      const parsed = parseCount(JSON.stringify(renamed))
      if (!parsed || parsed.version !== 2 || stableJson(parsed.extra ?? []) !== stableJson(extra)) throw new Error('施工条件の改名で個数の印を保存できません。条件名を短くしてください。')
    }
    for (const id of renamedIds) {
      if (this.lastRouteConditions.has(id)) this.lastRouteConditions.set(id, renameRoute(id, this.lastRouteConditions.get(id)))
      if (this.lastCondition.has(id)) this.lastCondition.set(id, renameCondition(id, this.lastCondition.get(id)) as string | undefined)
    }
    // Compositions can reference an edited item as an extra member of another item.
    for (const [id, t] of this.lastRouteMembers) {
      if ([t.itemId, ...t.extra.map(e => e.itemId)].some(itemId => renames.has(itemId))) this.lastRouteMembers.set(id, renameTemplate(t))
    }
    for (const [id, components] of this.lastCountComponents) {
      if (removeIds.includes(id)) this.lastCountComponents.delete(id)
      else if (components.some(e => renames.has(e.itemId) || removeIds.includes(e.itemId))) this.lastCountComponents.set(id, renameComponents(components))
    }
    if (this.routeTemplate && renames.size) this.routeTemplate = renameTemplate(this.routeTemplate)
    if (memoryIds.length) after.pickupMemory = this.pickupMemory(memoryIds)
    if (renames.size) after.routeTemplate = structuredClone(this.routeTemplate)
    const appearance = (f: CountFixture | undefined) => f ? stableJson([f.name, f.code, f.spec, f.style, f.line]) : ''
    const changed = new Set(fixtures.filter(f => appearance(f) !== appearance(this.getCountFixture(f.id))).map(f => f.id))
    // Walls that deduct a fitting keep its size in their saved label: refresh them when it changes.
    const openingKey = (f: CountFixture | undefined) => stableJson(f?.opening ?? null)
    const openingChanged = new Set(fixtures.filter(f => openingKey(f) !== openingKey(this.getCountFixture(f.id))).map(f => f.id))
    const calculationKey = (f: CountFixture | undefined) =>
      stableJson([f?.defaults, f?.backfill, f?.attributes])
    const calculationChanged = new Set(fixtures
      .filter(f => calculationKey(f) !== calculationKey(this.getCountFixture(f.id)))
      .map(f => f.id))
    this.replaceFixtures(structuredClone(fixtures))
    this.recentFixtures = this.recentFixtures.filter(id => fixtures.some(f => f.id === id))
    for (const a of this.annotations.values()) if (!a.deleted && (a.count || a.quantity)) {
      const id = a.quantity?.itemId ?? countFixtureId(a.count!)
      const routeIds = [id, ...(a.quantity?.extra ?? []).map(e => e.itemId),
        ...(a.quantity?.method === 'polyline' ? a.quantity.points ?? [] : []).map(point => point.itemId),
        ...(a.count?.version === 2 ? a.count.extra ?? [] : []).map(e => e.itemId)]
      const openingIds = (a.quantity?.openings ?? []).flatMap(o => o.itemId ? [o.itemId] : [])
      const affected = dimensionUpdates.has(a.id)
        || routeIds.some(id => removeIds.includes(id) || changed.has(id) || renames.has(id))
        || openingIds.some(id => openingChanged.has(id) || removeIds.includes(id))
      const refreshedText = a.quantity && routeIds.some(id =>
        refresh.has(id) || calculationChanged.has(id)) ? this.quantityText(a) : undefined
      const refreshQuantity = refreshedText !== undefined && refreshedText !== a.text
      const countFixture = a.count && !a.quantity ? this.getCountFixture(id) : undefined
      const refreshCount = refresh.has(id) && !!countFixture?.spec && !!countFixture.style.showCode
      if (!affected && !refreshQuantity && !refreshCount) continue
      before.push(cloneState(a))
      const dimensions = dimensionUpdates.get(a.id)
      if (dimensions && a.quantity) {
        for (const key of FIXTURE_DIMENSION_KEYS) if (Object.hasOwn(dimensions, key)) {
          const value = dimensions[key]
          if (value === undefined) delete a.quantity[key]
          else a.quantity[key] = value
        }
      }
      if (!affected && a.quantity) {
        // Refresh only the saved label and its bounds; keep the pickup's other settings.
        a.text = refreshedText!
        if (a.vertices && a.measure) a.rect = measureBounds(a.vertices, a.measure.kind, a.text, a.fontSize)
        after.push(cloneState(a))
      } else {
        if (a.quantity?.method !== 'polyline' && a.quantity?.condition !== undefined) a.quantity.condition = renameCondition(id, a.quantity.condition) as string
        if (a.count?.version === 2) {
          if (a.count.condition !== undefined) a.count.condition = renameCondition(countFixtureId(a.count), a.count.condition) as string
          const extra = renameComponents(a.count.extra ?? [])
          if (extra.length) a.count.extra = extra; else delete a.count.extra
        }
        if (a.quantity) {
          if (a.quantity.method === 'polyline') {
            a.quantity.cond = renameRoute(a.quantity.itemId, a.quantity.cond)
            a.quantity.extra = a.quantity.extra?.map(e => ({ ...e, cond: renameRoute(e.itemId, e.cond) }))
            const points = renamePoints(a.quantity.points ?? [])
            if (points.length) a.quantity.points = points
            else delete a.quantity.points
          }
          const remaining = routeMembers(a.quantity).filter(e => !removeIds.includes(e.itemId))
          if (!remaining.length) { a.deleted = true; this.selection.delete(a.id) }
          else {
            const mainIndex = a.quantity.method === 'polyline' && removeIds.includes(a.quantity.itemId)
              ? remaining.findIndex(e => {
                const f = this.getCountFixture(e.itemId)
                return f && f.link === undefined && quantityMethod(f) === 'polyline'
                  && (e.perM ?? 1) === 1
              })
              : 0
            const main = remaining[mainIndex]
            const extra = remaining.filter((_, i) => i !== mainIndex)
            a.quantity = { ...a.quantity, itemId: main.itemId, cond: main.cond, count: a.quantity.method === 'polyline' && main.count !== 1 ? main.count : undefined, extra: extra.length ? extra : undefined }
            this.applyFixtureToQuantity(a, this.getCountFixture(main.itemId)!); after.push(cloneState(a))
          }
        } else if (removeIds.includes(id)) { a.deleted = true; this.selection.delete(a.id) }
        else { this.applyFixtureToMark(a, this.getCountFixture(id)!); after.push(cloneState(a)) }
      }
      this.markTouched(a); a.revision++
    }
    if (!fixturesChanged && !removeIds.length && !before.length) return
    this.history.push({ before, after }); this.pruneHiddenSelection(); this.notify()
  }
  reassignCounts(ids: readonly string[], fixtureId: string): string | undefined {
    const fixture = this.getCountFixture(fixtureId)
    if (!fixture) return
    if (fixture.link !== undefined) return '連動の項目は図面に拾いません。'
    for (const id of ids) {
      const q = this.annotations.get(id)?.quantity, match = q?.extra?.find(e => e.itemId === fixtureId)
      if (q?.method === 'polyline' && match && (match.perM ?? 1) !== 1) return '1m あたりの係数が1以外の線要素は主項目にまとめられません。追加の線要素として使ってください。'
      if (q && match && routeConditionsKey(q.cond) !== routeConditionsKey(match.cond)) return '施工条件または数える部分が異なるため、項目を変更できません。先にそろえてください。'
      if (q && match && (q.count ?? 1) + match.count > 99) return '条数の合計が99を超えるため、項目を変更できません。'
    }
    const before: HistoryState = [], after: HistoryState = []
    for (const id of ids) {
      const a = this.annotations.get(id)
      if (!a || a.deleted || !(a.count && quantityKind(fixture) === 'count' || a.quantity && this.supportsPickupMethod(fixture, a.quantity.method))) continue
      before.push(cloneState(a)); if (a.quantity) {
        const match = a.quantity.extra?.find(e => e.itemId === fixtureId)
        if (match) {
          const count = (a.quantity.count ?? 1) + match.count
          a.quantity = { ...a.quantity, count, extra: a.quantity.extra!.filter(e => e.itemId !== fixtureId) }
          if (!a.quantity.extra!.length) delete a.quantity.extra
        }
        this.applyFixtureToQuantity(a, fixture)
      } else {
        this.applyFixtureToMark(a, fixture)
        if (a.count?.version === 2 && a.count.extra) {
          a.count.extra = a.count.extra.filter(e => e.itemId !== fixtureId)
          if (!a.count.extra.length) delete a.count.extra
        }
      }
      this.markTouched(a); a.revision++; after.push(cloneState(a))
    }
    if (before.length) this.history.push({ before, after })
    this.pruneHiddenSelection(); this.notify()
  }
  openingSize(itemId: string): { widthM: number; heightM: number } | undefined {
    const fixture = this.getCountFixture(itemId), opening = fixture?.opening
    if (!fixture || (fixture.kind ?? 'count') !== 'count' || !opening
      || !Number.isFinite(opening.widthM) || opening.widthM <= 0 || opening.widthM > 100
      || !Number.isFinite(opening.heightM) || opening.heightM <= 0 || opening.heightM > 100) return undefined
    return { widthM: opening.widthM, heightM: opening.heightM }
  }
  setAreaHoles(id: string, holes: readonly (readonly import('../core/annotations').Point[])[]): string | undefined {
    const current = this.get(id)
    if (!current || current.legacyChange || !current.vertices || !current.measure
      || (current.quantity
        ? current.quantity.method !== 'polygon' && current.quantity.method !== 'polygonDepth'
        : !!current.count || current.measure.kind !== 'area')) return 'この書き込みには除外範囲を設定できません。'
    if (holes.length > 50) return '除外範囲は50個までです。'
    if (holes.some(hole => hole.length < 3 || hole.length > 500)) return '除外範囲は3点以上500点以下で囲んでください。'
    if (holes.some(hole => hole.some(point => point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])))) return '除外範囲の点が不正です。'

    const outer = current.vertices
    const inside = (point: import('../core/annotations').Point): boolean => {
      let result = false
      for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
        const a = outer[j], b = outer[i]
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
        const epsilon = 1e-7
        if (length <= epsilon) {
          if (Math.hypot(point[0] - a[0], point[1] - a[1]) <= epsilon) return true
        } else {
          const cross = (point[0] - a[0]) * dy - (point[1] - a[1]) * dx
          const dot = (point[0] - a[0]) * dx + (point[1] - a[1]) * dy
          if (Math.abs(cross) <= epsilon * length && dot >= -epsilon * length && dot <= length * length + epsilon * length) return true
        }
        if ((a[1] > point[1]) !== (b[1] > point[1])
          && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result
      }
      return result
    }
    // Moving the outer vertices must not move or discard existing holes.
    // Validate containment only for newly supplied/changed hole geometry.
    const previous = new Set((current.quantity?.holes ?? current.measure.holes ?? []).map(hole => JSON.stringify(hole)))
    if (holes.some(hole => !previous.has(JSON.stringify(hole)) && hole.some(point => !inside(point)))) return '除外範囲は外形の内側を囲んでください'

    const next: import('../core/annotations').Point[][] = holes.map(hole => hole.map(point => [point[0], point[1]]))
    this.mutate(id, a => {
      if (a.quantity) {
        a.quantity = { ...a.quantity, holes: next.length ? next : undefined }
        if (!next.length) delete a.quantity.holes
      } else {
        a.measure = { ...a.measure!, holes: next.length ? next : undefined }
        if (!next.length) delete a.measure.holes
      }
      a.text = this.quantityText(a)
      a.rect = measureBounds(a.vertices!, a.measure!.kind, a.text, a.fontSize)
    })
    return undefined
  }
  setQuantityOpenings(id: string, openings: readonly import('../core/quantity').QuantityOpening[]): string | undefined {
    const current = this.get(id)
    if (!current || current.legacyChange || !current.vertices || !current.measure
      || !current.quantity || (current.quantity.method !== 'polygon' && current.quantity.method !== 'lengthHeight')) return 'この拾いには開口部を設定できません。'
    if (openings.length > 50) return '開口部は50件までです。'
    const validDimension = (value: number | undefined) => value === undefined || Number.isFinite(value) && value > 0 && value <= 100
    if (openings.some(opening => !Number.isInteger(opening.count) || opening.count < 1 || opening.count > 999
      || opening.itemId !== undefined && (typeof opening.itemId !== 'string' || !opening.itemId.trim())
      || !validDimension(opening.widthM) || !validDimension(opening.heightM)
      || !opening.itemId && (opening.widthM === undefined || opening.heightM === undefined))) return '開口部の幅・高さは0より大きく100以下、箇所数は1〜999の整数で入力してください。'
    const next = openings.map(opening => ({ ...opening }))
    this.mutate(id, a => {
      a.quantity = { ...a.quantity!, openings: next.length ? next : undefined }
      if (!next.length) delete a.quantity.openings
      a.text = this.quantityText(a)
      a.rect = measureBounds(a.vertices!, a.measure!.kind, a.text, a.fontSize)
    })
    return undefined
  }
  quantityText(a: Pick<EditableAnnotation, 'quantity' | 'vertices' | 'measure' | 'text'>, points = a.vertices): string {
    if (!points || !a.measure) return a.text
    if (!a.quantity) return measureText(points, a.measure)
    const f = this.getCountFixture(a.quantity.itemId)
    if (!f) return a.text
    const code = quantityKind(f) === 'count' ? fixtureDrawingCode(f) : fixtureLabelCode(f)
    const mark = a.quantity
    const planM = mark.method === 'polyline'
      ? polylineLength(points) * a.measure.mmPerPoint / 1000 : 0
    return quantityLabel(
      points, a.measure.mmPerPoint, mark, code, f.style.showCode,
      id => {
        const item = this.getCountFixture(id)
        return item ? fixtureLabelCode(item) : id
      },
      id => this.openingSize(id),
      id => {
        const member = mark.method === 'polyline'
          ? mark.extra?.find(e => e.itemId === id) : undefined
        const item = member ? this.getCountFixture(id) : undefined
        if (!member || !item || item.link !== undefined
          || quantityMethod(item) !== 'lengthWidthDepth' || !item.backfill?.deductPipes) {
          return ''
        }
        const result = calculateBackfillVolume(
          planM, mark, member, item, pipeId => this.getCountFixture(pipeId),
        )
        return `${fixtureLabelCode(item)} ${backfillSummary(result)}`
      },
    )
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
    return [...this.annotations.values()].filter(a => !a.deleted && (
      a.quantity?.itemId === id || a.quantity?.extra?.some(e => e.itemId === id)
      || a.quantity?.method === 'polyline' && a.quantity.points?.some(point => point.itemId === id)
      || a.count && (countFixtureId(a.count) === id
        || a.count.version === 2 && a.count.extra?.some(component => component.itemId === id))
    )).length
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
    return perfTime('store.getPageAnnotations', () => [...this.annotations.values()]
      .filter((annotation) => annotation.pageIndex === pageIndex && !annotation.deleted)
      .map((annotation) => publicAnnotation(annotation, this.isAnnotationDirty(annotation))))
  }

  /** 描画用のページの注釈。getPageAnnotations と同じ内容・同じ順。contentRevision が同じあいだは同じ配列を返す。配列と各注釈（入れ子を含む）は Object.freeze 済み。 */
  getPageAnnotationsSnapshot(pageIndex: number): readonly EditableAnnotation[] {
    if (this.pageAnnotationsCache?.contentRevision === this.contentRevision) {
      const cached = this.pageAnnotationsCache.pages.get(pageIndex)
      if (cached !== undefined) return cached
    }
    return perfTime('store.pageSnapshot.build', () => {
      if (!this.pageAnnotationsCache
        || this.pageAnnotationsCache.contentRevision !== this.contentRevision) {
        const ids = new Map<number, string[]>()
        for (const annotation of this.annotations.values()) {
          if (annotation.deleted) continue
          const page = ids.get(annotation.pageIndex)
          if (page) page.push(annotation.id)
          else ids.set(annotation.pageIndex, [annotation.id])
        }
        this.pageAnnotationsCache = {
          contentRevision: this.contentRevision,
          ids,
          pages: new Map(),
        }
      }
      const cache = this.pageAnnotationsCache
      const snapshot = deepFreeze((cache.ids.get(pageIndex) ?? []).map(id => {
        const annotation = this.annotations.get(id)!
        // cloneState has shared nested values, including measure.holes and legacyChangeData.
        // Detach them before freezing so the store and mutable getters remain unfrozen.
        return structuredClone(publicAnnotation(annotation, this.isAnnotationDirty(annotation)))
      }))
      cache.pages.set(pageIndex, snapshot)
      return snapshot
    })
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
    this.notifyUi()
  }

  toggleSelection(id: string): void {
    const a = this.annotations.get(id)
    if (!a || a.deleted || !this.isShownOnDrawing(a)) return
    if (this.selection.has(id)) this.selection.delete(id)
    else this.selection.add(id)
    this.notifyUi()
  }

  clearSelection(): void {
    if (this.selection.size === 0) return
    this.selection.clear()
    this.notifyUi()
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
    this.notifyUi()
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
    if (this.hasLinkedPickup(input)) throw new Error('数量拾いの値が不正です。')
    let quantity = input.quantity ? cloneQuantity(input.quantity) : null
    let count = input.count ? cloneCount(input.count) : null
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
    if (count?.version === 2) {
      if (count.condition === undefined) count.condition = this.newCondition(count.fixtureId)
      if (count.extra === undefined) {
        const extra = (this.lastCountComponents.get(count.fixtureId) ?? [])
          .filter(e => { const f = this.getCountFixture(e.itemId); return f && f.link === undefined && quantityMethod(f) === 'click' })
          .map(e => {
            const condition = e.condition ?? this.newCondition(e.itemId)
            return { itemId: e.itemId, count: e.count, ...(condition !== undefined ? { condition } : {}) }
          })
        if (extra.length) count.extra = extra
      } else if (!count.extra.length) delete count.extra
    }
    if (this.hasLinkedPickup({ quantity, count })) throw new Error('数量拾いの値が不正です。')
    const id = `new-${this.nextNewId++}`
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
    else this.contentRevision += 1
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
    source = source.filter(a => !a.legacyChange && a.issue?.recordKind !== 'change' && !this.hasLinkedPickup(a))
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
    this.notify(!!(step.before.length || step.after.length || step.before.fixtures || step.before.scales || step.before.scaleRegions || step.before.roomRegions || step.before.roomSets || step.before.pageRoomSets))
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
    this.notify(!!(step.before.length || step.after.length || step.after.fixtures || step.after.scales || step.after.scaleRegions || step.after.roomRegions || step.after.roomSets || step.after.pageRoomSets))
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
    if (normalized) {
      this.contentRevision += 1
      this.dirtyCache = null
    }
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
    this.pendingRoomRegions = [...this.roomRegions].filter(([i, regions]) => stableJson(regions) !== stableJson(this.roomRegionBaselines.get(i) ?? [])).map(([pageIndex, regions], i) => ({ pageIndex, regions: structuredClone(regions), editIndex: result.length + i }))
    result.push(...this.pendingRoomRegions.map(({ pageIndex, regions }) => ({ kind: 'setRoomRegions' as const, pageIndex, regions })))
    this.pendingQuantityChecks = null
    if (this.quantityChecksReady
      && stableJson(this.quantityChecks) !== stableJson(this.quantityCheckBaseline)) {
      const basics = this.getQuantityChecks()
      this.pendingQuantityChecks = { basics, editIndex: result.length }
      result.push({ kind: 'setQuantityChecks', pageIndex: 0, basics })
    }
    this.pendingRelatedReviews = null
    if (this.relatedReviewsReady
      && stableJson(this.relatedReviews) !== stableJson(this.relatedReviewBaseline)) {
      const reviews = this.getRelatedReviews()
      this.pendingRelatedReviews = { reviews, editIndex: result.length }
      result.push({ kind: 'setRelatedReviews', pageIndex: 0, reviews })
    }
    this.pendingRoomSets = null
    if (stableJson(this.roomSets) !== stableJson(this.roomSetBaseline)) {
      const sets = this.getRoomSets()
      this.pendingRoomSets = { sets, editIndex: result.length }
      result.push({ kind: 'setRoomSets', pageIndex: 0, sets })
    }
    this.pendingPageRoomSets = [...new Set([...this.pageRoomSets.keys(), ...this.pageRoomSetBaselines.keys()])]
      .sort((a, b) => a - b)
      .filter(pageIndex => stableJson(this.pageRoomSets.get(pageIndex) ?? null)
        !== stableJson(this.pageRoomSetBaselines.get(pageIndex) ?? null))
      .map((pageIndex, i) => ({
        pageIndex,
        setId: this.getPageRoomSetLink(pageIndex) ?? null,
        editIndex: result.length + i,
      }))
    result.push(...this.pendingPageRoomSets.map(({ pageIndex, setId }) => ({
      kind: 'setPageRoomSet' as const, pageIndex, setId: setId?.id ?? null,
      ...(setId?.dx !== undefined ? { dx: setId.dx } : {}),
      ...(setId?.dy !== undefined ? { dy: setId.dy } : {}),
    })))
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
    for (const item of this.pendingRoomRegions) if (!failed.has(item.editIndex)) this.roomRegionBaselines.set(item.pageIndex, structuredClone(item.regions))
    this.pendingRoomRegions = []
    if (this.pendingQuantityChecks && !failed.has(this.pendingQuantityChecks.editIndex)) {
      this.quantityCheckBaseline = structuredClone(this.pendingQuantityChecks.basics)
    }
    this.pendingQuantityChecks = null
    if (this.pendingRelatedReviews && !failed.has(this.pendingRelatedReviews.editIndex)) {
      this.relatedReviewBaseline = structuredClone(this.pendingRelatedReviews.reviews)
    }
    this.pendingRelatedReviews = null
    if (this.pendingRoomSets && !failed.has(this.pendingRoomSets.editIndex)) {
      this.roomSetBaseline = structuredClone(this.pendingRoomSets.sets)
    }
    this.pendingRoomSets = null
    for (const item of this.pendingPageRoomSets) {
      if (failed.has(item.editIndex)) continue
      if (item.setId === null) this.pageRoomSetBaselines.delete(item.pageIndex)
      else this.pageRoomSetBaselines.set(item.pageIndex, item.setId)
    }
    this.pendingPageRoomSets = []
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
    return summary.annotations > 0 || summary.fixtures || summary.scales.length > 0 || summary.drawings.length > 0 || summary.rooms.length > 0 || summary.roomSets || !!summary.quantityChecks || !!summary.relatedReviews
  }

  dirtySummary(): DirtySummary {
    if (this.dirtyCache?.contentRevision === this.contentRevision) return this.dirtyCache.summary
    const summary: DirtySummary = perfTime('store.dirtySummary.compute', () => ({
      annotations: this.editEntries().length,
      fixtures: stableJson(this.fixtures) !== this.fixtureBaseline,
      scales: [...new Set([...this.scales].filter(([i, scale]) => stableJson(scale) !== stableJson(this.scaleBaselines.get(i) ?? null)).map(([i]) => i).concat([...this.scaleRegions].filter(([i, regions]) => stableJson(regions) !== stableJson(this.scaleRegionBaselines.get(i) ?? [])).map(([i]) => i)))].sort((a, b) => a - b),
      drawings: [...this.drawings].filter(([i, info]) => stableJson(info) !== stableJson(this.drawingDirtyBaselines.get(i) ?? null)).map(([i]) => i).sort((a, b) => a - b),
      rooms: [...new Set([
        ...[...this.roomRegions].filter(([i, regions]) => stableJson(regions) !== stableJson(this.roomRegionBaselines.get(i) ?? [])).map(([i]) => i),
        ...[...new Set([...this.pageRoomSets.keys(), ...this.pageRoomSetBaselines.keys()])]
          .filter(i => stableJson(this.pageRoomSets.get(i) ?? null)
            !== stableJson(this.pageRoomSetBaselines.get(i) ?? null)),
      ])].sort((a, b) => a - b),
      roomSets: stableJson(this.roomSets) !== stableJson(this.roomSetBaseline),
      ...(this.quantityChecksReady
        && stableJson(this.quantityChecks) !== stableJson(this.quantityCheckBaseline)
        ? { quantityChecks: true } : {}),
      ...(this.relatedReviewsReady
        && stableJson(this.relatedReviews) !== stableJson(this.relatedReviewBaseline)
        ? { relatedReviews: true } : {}),
    }))
    this.dirtyCache = { contentRevision: this.contentRevision, summary }
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
    if (samePersisted(before, after)) {
      if (stableJson(before) !== stableJson(after)) this.contentRevision += 1
      return
    }
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
      if (samePersisted(previous, next)) {
        if (stableJson(previous) !== stableJson(next)) this.contentRevision += 1
        continue
      }
      this.markTouched(annotation)
      annotation.revision += 1
      before.push(previous)
      after.push(next)
    }
    if (before.length === 0 && !fixtures) return
    if (fixtures) { before.fixtures = this.getCountFixtures(); after.fixtures = structuredClone(fixtures); this.replaceFixtures(structuredClone(fixtures)) }
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
    if (target.fixtures) this.replaceFixtures(structuredClone(target.fixtures))
    if (target.issueMaximum !== undefined) this.issueNumbers.renumber(target.issueMaximum)
    for (const item of target.scales ?? []) this.scales.set(item.pageIndex, item.scale ? { ...item.scale } : null)
    for (const item of target.scaleRegions ?? []) this.scaleRegions.set(item.pageIndex, structuredClone(item.regions))
    for (const item of target.roomRegions ?? []) this.roomRegions.set(item.pageIndex, structuredClone(item.regions))
    if (target.roomSets) this.roomSets = structuredClone(target.roomSets)
    if (target.quantityChecks) this.quantityChecks = structuredClone(target.quantityChecks)
    if (target.relatedReviews) this.replaceRelatedReviews(structuredClone(target.relatedReviews))
    if (target.pageRoomSets) {
      this.pageRoomSets.clear()
      for (const [pageIndex, setId] of target.pageRoomSets) this.pageRoomSets.set(pageIndex, { ...setId })
    }
    void this.roomEditTarget
    void this.roomSetAlignPage
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
    const mapState = (state: HistoryState): HistoryState => Object.assign(state.map(mapper), {
      routeTemplate: state.routeTemplate,
      pickupMemory: state.pickupMemory,
      drawings: state.drawings,
      scales: state.scales,
      scaleRegions: state.scaleRegions,
      roomRegions: state.roomRegions,
      roomSets: state.roomSets,
      quantityChecks: state.quantityChecks,
      relatedReviews: state.relatedReviews,
      pageRoomSets: state.pageRoomSets,
      issueMaximum: state.issueMaximum,
      fixtures: state.fixtures,
    })
    return { before: mapState(step.before), after: mapState(step.after) }
  }

  private markTouched(annotation: AnnotationState): void {
    if (annotation.objNum === null) return
    const touched = this.touchedByPage.get(annotation.pageIndex) ?? new Set<number>()
    touched.add(annotation.objNum)
    this.touchedByPage.set(annotation.pageIndex, touched)
  }

  private notify(quantityChanged = true): void {
    this.contentRevision += 1
    perfCount(quantityChanged ? 'store.notify.quantity' : 'store.notify.ui')
    if (quantityChanged) { this.quantityVersion += 1; this.refreshSymbolCandidates() }
    this.version += 1
    perfCount('store.listenerCalls', this.listeners.size)
    for (const listener of this.listeners) listener()
  }

  private notifyUi(): void {
    perfCount('store.notify.uiOnly')
    this.version += 1
    perfCount('store.listenerCalls', this.listeners.size)
    for (const listener of this.listeners) listener()
  }
}
