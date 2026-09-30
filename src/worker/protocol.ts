import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'
import type { PageInfo, PageLayoutCard } from '../core/pageOps'
import type { RasterPagePlan, RasterizeOptions } from '../core/rasterize'

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
  bytes: ArrayBuffer
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
}

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
}

export interface ApplyPageLayoutRequest {
  type: 'applyPageLayout'
  requestId: number
  docId: string
  cards: PageLayoutCard[]
  sources: string[]
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
  | OpenRequest
  | RenderRequest
  | CancelJobsRequest
  | ReprioritizeRequest
  | StatsRequest
  | DisposeRequest
  | ListAnnotationsRequest
  | LayoutTextRequest
  | ApplyAndSaveRequest
  | ApplyEditsRequest
  | PrepareOutputRequest
  | ApplyPageLayoutRequest
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
}

export interface StartedResponse {
  type: 'started'
  jobId: number
}

export interface StatsResponse {
  type: 'stats'
  requestId: number
  queueLength: number
  displayListCount: number
  displayListBytes: number
  processedCount: number
}

export interface ListAnnotationsResponse {
  type: 'annotationsListed'
  requestId: number
  annotations: AnnotationInfo[]
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
  type: 'pageLayoutApplied' | 'pageLayoutUndone'
  requestId: number
  bytes: ArrayBuffer
  pageCount: number
  pageSizes: PageSize[]
  hasBackup: boolean
  timings: PageLayoutWorkerTimings
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
  type: 'error'
  requestId?: number
  jobId?: number
  message: string
}

export type WorkerResponse =
  | ReadyResponse
  | OpenResponse
  | StartedResponse
  | RenderResponse
  | StatsResponse
  | ListAnnotationsResponse
  | LayoutTextResponse
  | ApplyAndSaveResponse
  | AppliedEditsResponse
  | OutputPreparedResponse
  | PageLayoutResponse
  | PagesExtractedResponse
  | PagesSplitResponse
  | PageInfoResponse
  | ExportBytesResponse
  | RasterizeBegunResponse
  | RasterBandRenderedResponse
  | ErrorResponse
