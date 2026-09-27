import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'

export type DeviceRect = [number, number, number, number]
export type Priority = 0 | 1 | 2 | 3

export interface OpenRequest {
  type: 'open'
  requestId: number
  bytes: ArrayBuffer
}

export interface RenderRequest {
  type: 'render'
  jobId: number
  priority: Priority
  pageIndex: number
  renderScale: number
  deviceRect: DeviceRect | null
  excludeAnnotObjNums?: number[]
}

export interface CancelJobsRequest {
  type: 'cancelJobs'
  jobIds: number[]
}

export interface ReprioritizeRequest {
  type: 'reprioritize'
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
  edits: AnnotationEdit[]
  mode: SaveMode
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
  | ErrorResponse
