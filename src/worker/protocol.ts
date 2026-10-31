import type { DrawingInfo, DrawingDetection } from '../core/drawingInfo'
import type { TocPageText } from '../core/tocImport'
import type { PageScale } from '../core/measure'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'
import type { PageInfo, PageLayoutCard } from '../core/pageOps'
import type { RasterPagePlan, RasterizeOptions } from '../core/rasterize'
import type { SearchMatch, SearchOptions } from '../core/search'
import type { Point, Rect } from '../core/annotations'
import type { TextSelectionMode, TextSelectionResult } from '../core/textSelection'
import type { HeaderFooterSettings } from '../app/headerFooterText'
import type { CountFixture } from '../core/countFixtures'
export interface GetCountFixturesRequest { type: 'getCountFixtures'; requestId: number; docId: string }
export interface CountFixturesResponse { type: 'countFixtures'; requestId: number; fixtures: CountFixture[] }
export interface GetQuantityChecksRequest { type: 'getQuantityChecks'; requestId: number; docId: string }
export interface QuantityChecksResponse {
  type: 'quantityChecks'
  requestId: number
  basics: import('../core/quantityCheckBasics').QuantityCheckBasics
}
export interface GetRelatedReviewsRequest { type: 'getRelatedReviews'; requestId: number; docId: string }
export interface RelatedReviewsResponse {
  type: 'relatedReviews'
  requestId: number
  reviews: import('../core/related/reviews').RelatedReviews
}

export type DeviceRect = [number, number, number, number]
export type Priority = 0 | 1 | 2 | 3

export interface PageLayoutWorkerTimings {
  backupMs: number
  assembleMs: number
  exportMs: number
  primaryReloadMs: number
  pageMetadataMs: number
  workerTotalMs: number
}

export interface OpenRequest {
  type: 'open'
  requestId: number
  docId: string
  // Omit bytes when retrying authentication of a PDF retained by the worker.
  bytes?: ArrayBuffer
  password?: string
  // The document Worker supplies UI metadata; render Workers load pages lazily.
  includePageMetadata?: boolean
}

export interface RenderRequest {
  type: 'render'
  jobId: number
  docId: string
  priority: Priority
  pageIndex: number
  renderScale: number
  deviceRect: DeviceRect | null
  excludeAnnotObjNums?: number[]
  contentsOnly?: boolean
}

export interface SearchImage { width: number; height: number; gray: Uint8Array }
export interface ExtractLabelsRequest { type: 'extractLabels'; requestId: number; docId: string; pageIndex: number }
export interface LabelsExtractedResponse { type: 'labelsExtracted'; requestId: number; labels: import('../core/symbolLabels').SymbolLabel[] }
export interface ExtractVectorsRequest {
  type: 'extractVectors'
  jobId: number
  docId: string
  pageIndex: number
  includePaint?: boolean
  priority: 4
}
export interface VectorsExtractedResponse {
  type: 'vectorsExtracted'
  jobId: number
  page?: import('../core/vectorPaths').VectorPage
  cancelled?: true
}
export interface RenderSearchImageRequest {
  type: 'renderSearchImage'
  jobId: number
  docId: string
  pageIndex: number
  renderScale: number
  deviceRect: DeviceRect
  // Below every display-render priority; this request cannot be reprioritized.
  priority: 4
}

export interface CompareOptions {
  overlayMode?: 'changes' | 'blend'
  blend?: number
  alignment?: import('../core/registration').Alignment
  detection?: import('../core/compare').CompareDetection
  tolerance?: number
  docId: string
  newDocId: string
  pageIndex: number
  newPageIndex: number
  renderScale: number
  deviceRect: DeviceRect | null
  offset: [number, number]
  includeAnnotations: boolean
  output?: 'overlay' | 'old' | 'new'
  detect?: boolean
}
export interface RenderCompareRequest extends CompareOptions {
  type: 'renderCompare'
  jobId: number
  priority: Priority
}
export interface ClearCompareRequest { type: 'clearCompare' }

export interface CancelJobsRequest {
  type: 'cancelJobs'
  docId: string
  jobIds: number[]
}

export interface ReprioritizeRequest {
  type: 'reprioritize'
  docId: string
  jobId: number
  priority: Priority
}

export interface StatsRequest {
  type: 'stats'
  requestId: number
}

export interface DisposeRequest {
  type: 'dispose'
}

export interface ListAnnotationsRequest {
  type: 'listAnnotations'
  requestId: number
  docId: string
  pageIndex: number
}

export interface ListAllAnnotationsRequest {
  type: 'listAllAnnotations'
  requestId: number
  docId: string
}

export interface CancelListAllAnnotationsRequest {
  type: 'cancelListAllAnnotations'
  requestId: number
  docId: string
}

export interface SearchDocumentRequest {
  type: 'searchDocument'
  requestId: number
  docId: string
  needle: string
  options: SearchOptions
}

export interface CancelSearchRequest {
  type: 'cancelSearch'
  requestId: number
  docId: string
}

export interface SelectTextRequest {
  type: 'selectText'
  requestId: number
  docId: string
  pageIndex: number
  from: Point
  to: Point
  mode: TextSelectionMode
}

export interface PageHasTextRequest {
  type: 'pageHasText'
  requestId: number
  docId: string
  pageIndex: number
}

export interface DrawingPageRequest { type: 'drawingPage'; requestId: number; docId: string; pageIndex: number }
export interface PageTextBlocksRequest { type: 'pageTextBlocks'; requestId: number; docId: string; pageIndices: number[] }
export interface PageTextBlocksResponse { type: 'pageTextBlocksResult'; requestId: number; pages: TocPageText[] }
export interface DrawingPageResponse { type: 'drawingPageResult'; requestId: number; detection: DrawingDetection; elapsedMs: number }
export interface PageTextLinesRequest {
  type: 'pageTextLines'
  requestId: number
  docId: string
  pageIndex: number
}

export interface LayoutTextRequest {
  type: 'layoutText'
  requestId: number
  text: string
  fontSize: number
  boxWidth: number
  font?: FontName
}

export interface ApplyAndSaveRequest {
  type: 'applyAndSave'
  requestId: number
  docId: string
  edits: AnnotationEdit[]
  mode: SaveMode
}

export interface ApplyEditsRequest {
  type: 'applyEdits'
  requestId: number
  docId: string
  edits: AnnotationEdit[]
}

export interface PrepareOutputRequest {
  type: 'prepareOutput'
  requestId: number
  docId: string
  edits: AnnotationEdit[]
  bake: boolean
  password?: string
}

export interface GetOutlineRequest { type: 'getOutline'; requestId: number; docId: string }
export interface ApplyOutlineRequest { type: 'applyOutline'; requestId: number; docId: string; plan: import('../core/outlineModel').OutlineApplyPlan }
export interface OutlineLayoutImpactRequest { type: 'outlineLayoutImpact'; requestId: number; docId: string; cards: PageLayoutCard[] }
export interface OutlinePagePointRequest { type: 'outlinePagePoint'; requestId: number; docId: string; pageIndex: number; x: number | null; y: number | null; toPdf: boolean }
export interface OutlineReadResponse { type: 'outlineRead'; requestId: number; snapshot: import('../core/outlineModel').OutlineSnapshot }
export interface OutlineAppliedResponse { type: 'outlineApplied'; requestId: number; result: import('../core/outlineModel').OutlineApplyResult; ms: number; canUndoOrganize: false }
export interface OutlineLayoutImpactResponse { type: 'outlineLayoutImpactResult'; requestId: number; impact: import('../core/outlineModel').OutlineLayoutImpact }
export interface OutlinePagePointResponse { type: 'outlinePagePointResult'; requestId: number; x: number | null; y: number | null }

export interface ApplyPageLayoutRequest {
  type: 'applyPageLayout'
  requestId: number
  docId: string
  cards: PageLayoutCard[]
  sources: string[]
  outlinePlan?: import('../core/outlineModel').OutlineLayoutPlan
}

export interface ApplyHeaderFooterRequest {
  type: 'applyHeaderFooter'
  requestId: number
  docId: string
  settings: HeaderFooterSettings
  fileName: string
  dateText: string
}

export interface RemoveHeaderFooterRequest {
  type: 'removeHeaderFooter'
  requestId: number
  docId: string
}

export interface GetHeaderFooterSettingsRequest {
  type: 'getHeaderFooterSettings'
  requestId: number
  docId: string
}

export interface UndoPageLayoutRequest {
  type: 'undoPageLayout'
  requestId: number
  docId: string
}

export interface ExtractPagesRequest {
  type: 'extractPages'
  requestId: number
  docId: string
  cards: PageLayoutCard[]
  sources: string[]
}

export interface SplitPagesRequest {
  type: 'splitPages'
  requestId: number
  docId: string
  groups: PageLayoutCard[][]
  sources: string[]
}

export interface GetPageInfoRequest {
  type: 'getPageInfo'
  requestId: number
  docId: string
}

export interface CloseRequest {
  type: 'close'
  docId: string
}

export interface ExportBytesRequest {
  type: 'exportBytes'
  requestId: number
  docId: string
}

export interface BeginRasterizeRequest {
  type: 'beginRasterize'
  requestId: number
  docId: string
  renderDocId: string
  edits: AnnotationEdit[]
  options: RasterizeOptions
}

export interface RenderRasterBandRequest {
  type: 'renderRasterBand'
  requestId: number
  docId: string
  pagePlan: RasterPagePlan
  bandIndex: number
  color: RasterizeOptions['color']
  format: RasterizeOptions['format']
}

export type WorkerRequest =
  | GetOutlineRequest | ApplyOutlineRequest | OutlineLayoutImpactRequest | OutlinePagePointRequest
  | GetCountFixturesRequest
  | GetQuantityChecksRequest
  | GetRelatedReviewsRequest
  | RenderCompareRequest
  | ClearCompareRequest
  | MaxIssueNumberRequest
  | OpenRequest
  | RenderRequest
  | RenderSearchImageRequest
  | ExtractVectorsRequest
  | ExtractLabelsRequest
  | CancelJobsRequest
  | ReprioritizeRequest
  | StatsRequest
  | DisposeRequest
  | ListAnnotationsRequest
  | ListAllAnnotationsRequest
  | CancelListAllAnnotationsRequest
  | SearchDocumentRequest
  | CancelSearchRequest
  | SelectTextRequest
  | PageHasTextRequest
  | DrawingPageRequest
  | PageTextBlocksRequest
  | PageTextLinesRequest
  | LayoutTextRequest
  | ApplyAndSaveRequest
  | ApplyEditsRequest
  | PrepareOutputRequest
  | ApplyPageLayoutRequest
  | ApplyHeaderFooterRequest
  | RemoveHeaderFooterRequest
  | GetHeaderFooterSettingsRequest
  | UndoPageLayoutRequest
  | ExtractPagesRequest
  | SplitPagesRequest
  | GetPageInfoRequest
  | CloseRequest
  | ExportBytesRequest
  | BeginRasterizeRequest
  | RenderRasterBandRequest

export interface ReadyResponse {
  type: 'ready'
}

export interface OpenResponse {
  editRestriction?: string | null
  pageDrawingInfos?: (DrawingInfo | null)[]
  pageScales?: (PageScale | null)[]
  pageScaleRegions?: Array<[number, import('../core/measure').ScaleRegion[]]>
  pageRoomRegions?: Array<[number, import('../core/rooms').RoomRegion[]]>
  roomSets?: import('../core/rooms').RoomSet[]
  pageRoomSets?: Array<[number, import('../core/rooms').RoomSetLink]>
  type: 'opened'
  requestId: number
  pageCount: number
  pageSizes: PageSize[]
  openMs: number
  sizesMs: number
}

export interface RenderResponse {
  type: 'rendered'
  jobId: number
  bitmap?: ImageBitmap
  renderMs?: number
  cancelled?: true
  differences?: import('../core/compare').CompareRect[]
  detectionMs?: number
}

export interface StartedResponse {
  type: 'started'
  jobId: number
}

export interface SearchImageResponse {
  type: 'searchImageRendered'
  jobId: number
  image?: SearchImage
  cancelled?: true
}

export interface StatsResponse {
  type: 'stats'
  requestId: number
  queueLength: number
  displayListCount: number
  displayListBytes: number
  extractedTextCacheBytes: number
  processedCount: number
}

export interface ListAnnotationsResponse {
  type: 'annotationsListed'
  requestId: number
  annotations: AnnotationInfo[]
}
export interface MaxIssueNumberRequest { type: 'maxIssueNumber'; requestId: number; docId: string }
export interface MaxIssueNumberResponse { type: 'maxIssueNumberResult'; requestId: number; maximum: number }

export interface AllAnnotationsProgressResponse {
  type: 'allAnnotationsProgress'
  requestId: number
  pageIndex: number
  annotations: AnnotationInfo[]
  processedPages: number
  totalPages: number
  done: boolean
  cancelled: boolean
}

export interface SearchProgressResponse {
  type: 'searchProgress'
  requestId: number
  pageIndex: number
  matches: SearchMatch[]
  processedPages: number
  totalPages: number
  totalMatches: number
  textPages: number
  truncated: boolean
  done: boolean
  cancelled: boolean
}

export interface TextSelectedResponse {
  type: 'textSelected'
  requestId: number
  result: TextSelectionResult
}

export interface PageHasTextResponse {
  type: 'pageHasTextResult'
  requestId: number
  hasText: boolean
}

export interface PageTextLinesResponse {
  type: 'pageTextLinesResult'
  requestId: number
  lines: Rect[]
}

export interface LayoutTextResponse {
  type: 'textLaidOut'
  requestId: number
  result: LayoutResult
}

export interface ApplyAndSaveResponse {
  type: 'appliedAndSaved'
  requestId: number
  bytes: ArrayBuffer
  mode: SaveMode
  ms: number
  created: number[]
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface AppliedEditsResponse {
  type: 'editsApplied'
  requestId: number
  created: number[]
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface OutputPreparedResponse {
  type: 'outputPrepared'
  requestId: number
  bytes: ArrayBuffer
  ms: number
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface PageLayoutResponse {
  pageDrawingInfos?: (DrawingInfo | null)[]
  pageScales?: (PageScale | null)[]
  pageScaleRegions?: Array<[number, import('../core/measure').ScaleRegion[]]>
  pageRoomRegions?: Array<[number, import('../core/rooms').RoomRegion[]]>
  roomSets?: import('../core/rooms').RoomSet[]
  pageRoomSets?: Array<[number, import('../core/rooms').RoomSetLink]>
  type: 'pageLayoutApplied' | 'pageLayoutUndone' | 'headerFooterApplied' | 'headerFooterRemoved'
  requestId: number
  bytes: ArrayBuffer
  pageCount: number
  pageSizes: PageSize[]
  hasBackup: boolean
  timings: PageLayoutWorkerTimings
}

export interface HeaderFooterSettingsResponse {
  type: 'headerFooterSettings'
  requestId: number
  settings: HeaderFooterSettings | null
}

export interface PagesExtractedResponse {
  type: 'pagesExtracted'
  requestId: number
  bytes: ArrayBuffer
}

export interface PagesSplitResponse {
  type: 'pagesSplit'
  requestId: number
  bytes: ArrayBuffer[]
}

export interface PageInfoResponse {
  type: 'pageInfo'
  requestId: number
  pages: PageInfo[]
}

export interface ExportBytesResponse {
  type: 'bytesExported'
  requestId: number
  bytes: ArrayBuffer
}

export interface RasterizeBegunResponse {
  type: 'rasterizeBegun'
  requestId: number
  renderDocId: string
  preparedBytes?: ArrayBuffer
  plans: RasterPagePlan[]
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface RasterBandRenderedResponse {
  type: 'rasterBandRendered'
  requestId: number
  bytes: ArrayBuffer
  width: number
  height: number
  components: number
  pixelBytes: number
}

export interface ErrorResponse {
  code?: import('../core/passwordAccess').PasswordErrorCode
  type: 'error'
  requestId?: number
  jobId?: number
  message: string
}

export type WorkerResponse =
  | OutlineReadResponse | OutlineAppliedResponse | OutlineLayoutImpactResponse | OutlinePagePointResponse
  | CountFixturesResponse
  | QuantityChecksResponse
  | RelatedReviewsResponse
  | MaxIssueNumberResponse
  | ReadyResponse
  | OpenResponse
  | StartedResponse
  | RenderResponse
  | SearchImageResponse
  | VectorsExtractedResponse
  | LabelsExtractedResponse
  | StatsResponse
  | ListAnnotationsResponse
  | AllAnnotationsProgressResponse
  | SearchProgressResponse
  | TextSelectedResponse
  | PageHasTextResponse
  | DrawingPageResponse
  | PageTextBlocksResponse
  | PageTextLinesResponse
  | LayoutTextResponse
  | ApplyAndSaveResponse
  | AppliedEditsResponse
  | OutputPreparedResponse
  | PageLayoutResponse
  | HeaderFooterSettingsResponse
  | PagesExtractedResponse
  | PagesSplitResponse
  | PageInfoResponse
  | ExportBytesResponse
  | RasterizeBegunResponse
  | RasterBandRenderedResponse
  | ErrorResponse
