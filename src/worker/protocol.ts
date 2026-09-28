import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'

export type DeviceRect = [number, number, number, number]
export type Priority = 0 | 1 | 2 | 3

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
}

export interface ApplyAndSaveRequest {
  type: 'applyAndSave'
  requestId: number
  docId: string
  edits: AnnotationEdit[]
  mode: SaveMode
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
  | CloseRequest
  | ExportBytesRequest

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
  errors: ApplyError[]
}

export interface ExportBytesResponse {
  type: 'bytesExported'
  requestId: number
  bytes: ArrayBuffer
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
  | ExportBytesResponse
  | ErrorResponse
