/* @single:start */import { createSingleWorker } from '../single/runtime'
/* @single:end */import type { PageScale } from '../core/measure'
import type { MaxIssueNumberResponse } from '../worker/protocol'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'
import type { PageInfo, PageLayoutCard } from '../core/pageOps'
import type { RasterizeOptions } from '../core/rasterize'
import type { SearchOptions } from '../core/search'
import type { Point, Rect } from '../core/annotations'
import type { TextSelectionMode, TextSelectionResult } from '../core/textSelection'
import type { HeaderFooterSettings } from '../app/headerFooterText'
import { MemoryPdfWriteTarget, PdfStreamWriter, type PdfImageBand, type PdfWriteTarget } from '../core/pdfStreamWriter'
import type {
  AppliedEditsResponse,
  AllAnnotationsProgressResponse,
  ApplyAndSaveResponse,
  DeviceRect,
  CompareOptions,
  ExportBytesResponse,
  LayoutTextResponse,
  ListAnnotationsResponse,
  PageHasTextResponse,
  PageTextLinesResponse,
  OpenResponse,
  PageInfoResponse,
  PageLayoutResponse,
  HeaderFooterSettingsResponse,
  PagesExtractedResponse,
  PagesSplitResponse,
  Priority,
  RenderResponse,
  StatsResponse,
  WorkerResponse,
  PageLayoutWorkerTimings,
  OutputPreparedResponse,
  RasterBandRenderedResponse,
  RasterizeBegunResponse,
  SearchProgressResponse,
  TextSelectedResponse,
} from '../worker/protocol'

export interface OpenResult {
  editRestriction?: string | null
  pageScales?: (PageScale | null)[]
  pageCount: number
  pageSizes: PageSize[]
  openMs: number
  sizesMs: number
}

export interface RenderResult {
  bitmap: ImageBitmap
  renderMs: number
  roundTripMs: number
  differences?: import('../core/compare').CompareRect[]
  detectionMs?: number
}

export interface ApplyAndSaveResult {
  bytes: Uint8Array
  mode: SaveMode
  ms: number
  created: number[]
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface ApplyEditsResult {
  created: number[]
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface PreparedOutputResult {
  bytes: Uint8Array
  ms: number
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface RasterizeMetrics {
  totalMs: number
  saveMs: number
  pageCount: number
  bandCount: number
  maxEncodedBandBytes: number
  maxWorkerPixelBytes: number
  concurrentWorkerPixelBytes: number
}

export interface RasterizeResult {
  bytes: Uint8Array | null
  outputBytes: number
  metrics: RasterizeMetrics
  replacedCharacters: number
  unsupportedCharacters: string[]
  errors: ApplyError[]
}

export interface RasterizeCallbacks {
  signal?: AbortSignal
  onProgress?(completedPages: number, totalPages: number): void
  target?: PdfWriteTarget
}

export interface PageLayoutResult {
  pageScales?: (PageScale | null)[]
  pageCount: number
  pageSizes: PageSize[]
  hasBackup: boolean
  timings: PageLayoutTimings
}

export interface PageLayoutTimings extends PageLayoutWorkerTimings {
  workerRoundTripMs: number
  transferToMainMs: number
  displayReloadMs: number
  poolTotalMs: number
}

export interface PoolStats {
  queueLength: number
  displayListCount: number
  displayListBytes: number
  extractedTextCacheBytes: number
  processedCount: number
  workers: Array<{ index: number; queueLength: number; displayListCount: number; displayListBytes: number; extractedTextCacheBytes: number; processedCount: number }>
}

export interface WorkerRenderLogEntry {
  jobId: number
  docId: string
  pageIndex: number
  worker: number
  priority: Priority
  deviceRect: DeviceRect | null
  queuedMs: number
  startedMs: number | null
  endedMs: number | null
  cancelled: boolean
}

export interface RenderTask {
  cancellableWhileStarted?: boolean
  jobId: number
  promise: Promise<RenderResult>
  isStarted(): boolean
}

export interface SearchSummary {
  processedPages: number
  totalPages: number
  totalMatches: number
  textPages: number
  truncated: boolean
  cancelled: boolean
}

export interface AnnotationListSummary {
  processedPages: number
  totalPages: number
  cancelled: boolean
}

export interface StreamingTask<T> {
  requestId: number
  promise: Promise<T>
  cancel(): void
}

export interface RenderBackend {
  render(options: {
    docId: string
    priority: Priority
    pageIndex: number
    renderScale: number
    deviceRect: DeviceRect | null
    excludeAnnotObjNums?: number[]
  }): RenderTask
  cancelJobs(docId: string, jobIds: readonly number[]): void
  reprioritize(docId: string, jobId: number, priority: Priority): void
}

interface WorkerSlot {
  readonly index: number
  readonly worker: Worker
  readonly documents: Set<string>
  queueLength: number
  ready: Promise<void>
  markReady(): void
  markFailed(error: Error): void
}

type Pending = {
  comparison?: boolean
  docId: string
  started: number
  workerStarted: boolean
  slot: WorkerSlot
  log: WorkerRenderLogEntry
  resolve(value: RenderResult): void
  reject(error: Error): void
}

export class CancelledRenderError extends Error {
  constructor() {
    super('描画要求は取り消されました。')
  }
}

export class PdfWorkerPool {
  readonly workerCount: number
  readonly primaryWorkerIndex = 0
  private readonly slots: WorkerSlot[]
  private readonly pendingRenders = new Map<number, Pending>()
  private readonly pendingRequests = new Map<number, { resolve(value: WorkerResponse): void; reject(error: Error): void }>()
  private readonly pendingSearches = new Map<number, {
    docId: string
    onProgress(response: SearchProgressResponse): void
    resolve(value: SearchSummary): void
    reject(error: Error): void
  }>()
  private readonly pendingAnnotationLists = new Map<number, {
    docId: string
    onProgress(response: AllAnnotationsProgressResponse): void
    resolve(value: AnnotationListSummary): void
    reject(error: Error): void
  }>()
  private displayLru: string[] = []
  private readonly pageAssignments = new Map<string, number>()
  private readonly compareAssignments = new Map<string, number>()
  private readonly renderLogEntries: WorkerRenderLogEntry[] = []
  private readonly assignedCounts: number[] = []
  private readonly documentVersions = new Map<string, number>()
  private activeDocId: string | null = null
  private nextId = 1

  constructor(count = 1) {
    this.workerCount = Math.max(1, Math.min(4, Math.trunc(count)))
    this.slots = Array.from({ length: this.workerCount }, (_, index) => {
      const worker = /* @single:start */createSingleWorker('pdf') ?? /* @single:end */new Worker(new URL('../worker/pdf.worker.ts', import.meta.url), { type: 'module' })
      let markReady: () => void = () => {}
      let markFailed: (error: Error) => void = () => {}
      const ready = new Promise<void>((resolve, reject) => { markReady = resolve; markFailed = reject })
      // The worker may fail before the user opens a file. Preserve the rejected
      // readiness promise for open(), while avoiding an unhandled rejection.
      void ready.catch(() => undefined)
      const slot: WorkerSlot = { index, worker, documents: new Set(), queueLength: 0, ready, markReady, markFailed }
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(slot, event.data)
      worker.onerror = (event) => this.failWorker(slot, new Error(event.message || 'Worker でエラーが発生しました。'))
      return slot
    })
  }

  async open(docId: string, bytes: ArrayBuffer): Promise<OpenResult> {
    await Promise.all(this.slots.map((slot) => slot.ready))
    const copies = this.slots.map((_, index) => (index === 0 ? bytes : bytes.slice(0)))
    const responses = await Promise.all(this.slots.map((slot, index) => this.openOnSlot(slot, docId, copies[index])))
    this.activeDocId = docId
    this.touchDisplayDocument(docId)
    this.evictDisplayDocuments()
    const first = responses[0]
    return {
      pageCount: first.pageCount,
      editRestriction: first.editRestriction,
      pageSizes: first.pageSizes,
      pageScales: first.pageScales,
      openMs: first.openMs,
      sizesMs: first.sizesMs,
    }
  }

  async openSource(docId: string, bytes: ArrayBuffer): Promise<OpenResult> {
    const response = await this.openOnSlot(this.slots[this.primaryWorkerIndex], docId, bytes)
    return { editRestriction: response.editRestriction, pageCount: response.pageCount, pageSizes: response.pageSizes, pageScales: response.pageScales, openMs: response.openMs, sizesMs: response.sizesMs }
  }

  async openSourceDisplays(docId: string, file: Blob): Promise<void> {
    const displaySlots = this.slots.slice(1)
    if (displaySlots.length === 0) return
    const bytes = await file.arrayBuffer()
    const copies = displaySlots.map((_, index) => index === displaySlots.length - 1 ? bytes : bytes.slice(0))
    await Promise.all(displaySlots.map((slot, index) => this.openOnSlot(slot, docId, copies[index])))
  }

  async activate(docId: string): Promise<void> {
    const primary = this.slots[this.primaryWorkerIndex]
    if (!primary.documents.has(docId)) throw new Error('切り替える PDF が開かれていません。')
    const displaySlots = this.slots.slice(1)
    await Promise.all(displaySlots.map(async (slot) => {
      if (slot.documents.has(docId)) return
      const buffer = await this.exportBuffer(docId)
      await this.openOnSlot(slot, docId, buffer)
    }))
    this.activeDocId = docId
    this.touchDisplayDocument(docId)
    this.evictDisplayDocuments()
  }

  close(docId: string): void {
    this.documentVersions.set(docId, (this.documentVersions.get(docId) ?? 0) + 1)
    for (const slot of this.slots) {
      slot.worker.postMessage({ type: 'close', docId })
      slot.documents.delete(docId)
    }
    this.displayLru = this.displayLru.filter((id) => id !== docId)
    if (this.activeDocId === docId) this.activeDocId = null
    for (const key of this.pageAssignments.keys()) {
      if (key.startsWith(`${docId}:`)) this.pageAssignments.delete(key)
    }
  }

  hasDocument(docId: string): boolean {
    return this.slots[this.primaryWorkerIndex].documents.has(docId)
  }

  // ページ番号の剰余で固定すると、図面が周期的に並ぶ文書で重いページが
  // 1本の Worker に集中する。最初の要求のときに最も空いている Worker を
  // 選び、以後はそのページを同じ Worker に任せる（DisplayList を1つで済ませる）。
  private slotForPage(docId: string, pageIndex: number): WorkerSlot {
    const key = `${docId}:${pageIndex}`
    const assigned = this.pageAssignments.get(key)
    if (assigned !== undefined) return this.slots[assigned]
    // 複数WorkerのときはWorker 0を文書操作専用にする。重いページの描画中でも、
    // 材料PDFのページ数確認や保存などを表示Workerの待ち行列から切り離せる。
    const renderSlots = this.slots.length > 1 ? this.slots.slice(1) : this.slots
    const chosen = renderSlots.reduce((best, current) => {
      if (current.queueLength !== best.queueLength) return current.queueLength < best.queueLength ? current : best
      return (this.assignedCounts[current.index] ?? 0) < (this.assignedCounts[best.index] ?? 0) ? current : best
    })
    this.pageAssignments.set(key, chosen.index)
    this.assignedCounts[chosen.index] = (this.assignedCounts[chosen.index] ?? 0) + 1
    return chosen
  }

  workerIndexForPage(docId: string, pageIndex: number): number {
    return this.slotForPage(docId, pageIndex).index
  }

  renderLog(): readonly WorkerRenderLogEntry[] {
    return this.renderLogEntries
  }

  render(options: {
    docId: string
    priority: Priority
    pageIndex: number
    renderScale: number
    deviceRect: DeviceRect | null
    excludeAnnotObjNums?: number[]
  }): RenderTask {
    const slot = this.slotForPage(options.docId, options.pageIndex)
    return this.startRender(slot, 'render', options)
  }

  renderCompare(options: CompareOptions & { priority: Priority }): RenderTask {
    const renderSlots = this.slots.length > 1 ? this.slots.slice(1) : this.slots
    const available = renderSlots.filter(slot => slot.documents.has(options.docId) && slot.documents.has(options.newDocId))
    if (!available.length) throw new Error('比較する PDF の表示を準備してください。')
    // Keep a pair on one rendering Worker, so its expensive DisplayLists are
    // built once and reused by preview, detail, detection and both panes.
    const key = JSON.stringify([options.docId, options.pageIndex, options.newDocId, options.newPageIndex])
    const previous = this.compareAssignments.get(key)
    const slot = available.find(slot => slot.index === previous) ?? available.reduce((a, b) => a.queueLength <= b.queueLength ? a : b)
    this.compareAssignments.set(key, slot.index)
    return this.startRender(slot, 'renderCompare', options)
  }

  clearCompare(): void {
    this.compareAssignments.clear()
    for (const slot of this.slots) slot.worker.postMessage({ type: 'clearCompare' })
  }

  private startRender(slot: WorkerSlot, type: 'render' | 'renderCompare', options: {
    docId: string; priority: Priority; pageIndex: number; renderScale: number; deviceRect: DeviceRect | null
  }): RenderTask {
    const jobId = this.nextId++
    const log: WorkerRenderLogEntry = {
      jobId,
      docId: options.docId,
      pageIndex: options.pageIndex,
      worker: slot.index,
      priority: options.priority,
      deviceRect: options.deviceRect ? [...options.deviceRect] as DeviceRect : null,
      queuedMs: performance.now(),
      startedMs: null,
      endedMs: null,
      cancelled: false,
    }
    this.renderLogEntries.push(log)
    if (this.renderLogEntries.length > 5_000) this.renderLogEntries.splice(0, 1_000)
    slot.queueLength += 1
    const promise = new Promise<RenderResult>((resolve, reject) => {
      this.pendingRenders.set(jobId, { comparison: type === 'renderCompare', docId: options.docId, started: performance.now(), workerStarted: false, slot, log, resolve, reject })
      slot.worker.postMessage({ type, jobId, ...options })
    })
    return {
      jobId,
      cancellableWhileStarted: type === 'renderCompare',
      promise,
      isStarted: () => this.pendingRenders.get(jobId)?.workerStarted ?? true,
    }
  }

  cancelJobs(docId: string, jobIds: readonly number[]): void {
    const byWorker = new Map<WorkerSlot, number[]>()
    for (const jobId of jobIds) {
      const pending = this.pendingRenders.get(jobId)
      if (!pending || pending.docId !== docId || (pending.workerStarted && !pending.comparison)) continue
      const ids = byWorker.get(pending.slot) ?? []
      ids.push(jobId)
      byWorker.set(pending.slot, ids)
    }
    for (const [slot, ids] of byWorker) slot.worker.postMessage({ type: 'cancelJobs', docId, jobIds: ids })
  }

  reprioritize(docId: string, jobId: number, priority: Priority): void {
    const pending = this.pendingRenders.get(jobId)
    if (!pending || pending.docId !== docId || pending.workerStarted) return
    pending.slot.worker.postMessage({ type: 'reprioritize', docId, jobId, priority })
  }

  async stats(): Promise<PoolStats> {
    const workers = await Promise.all(this.slots.map((slot) => this.request<StatsResponse>(slot, (requestId) => ({
      type: 'stats', requestId,
    }))))
    return {
      workers: workers.map(({ queueLength, displayListCount, displayListBytes, extractedTextCacheBytes, processedCount }, index) => ({ index, queueLength, displayListCount, displayListBytes, extractedTextCacheBytes, processedCount })),
      queueLength: workers.reduce((sum, worker) => sum + worker.queueLength, 0),
      displayListCount: workers.reduce((sum, worker) => sum + worker.displayListCount, 0),
      displayListBytes: workers.reduce((sum, worker) => sum + worker.displayListBytes, 0),
      extractedTextCacheBytes: workers.reduce((sum, worker) => sum + worker.extractedTextCacheBytes, 0),
      processedCount: workers.reduce((sum, worker) => sum + worker.processedCount, 0),
    }
  }

  async listAnnotations(docId: string, pageIndex: number): Promise<AnnotationInfo[]> {
    const response = await this.request<ListAnnotationsResponse>(this.slots[0], (requestId) => ({
      type: 'listAnnotations', requestId, docId, pageIndex,
    }))
    return response.annotations
  }
  async maxIssueNumber(docId: string): Promise<number> {
    const response = await this.request<MaxIssueNumberResponse>(this.slots[0], requestId => ({ type: 'maxIssueNumber', requestId, docId }))
    return response.maximum
  }

  async pageHasText(docId: string, pageIndex: number): Promise<boolean> {
    const response = await this.request<PageHasTextResponse>(this.slots[0], (requestId) => ({
      type: 'pageHasText', requestId, docId, pageIndex,
    }))
    return response.hasText
  }

  async pageTextLines(docId: string, pageIndex: number): Promise<Rect[]> {
    const response = await this.request<PageTextLinesResponse>(this.slots[0], (requestId) => ({
      type: 'pageTextLines', requestId, docId, pageIndex,
    }))
    return response.lines
  }

  async selectText(
    docId: string,
    pageIndex: number,
    from: Point,
    to: Point,
    mode: TextSelectionMode,
  ): Promise<TextSelectionResult> {
    const response = await this.request<TextSelectedResponse>(this.slots[0], (requestId) => ({
      type: 'selectText', requestId, docId, pageIndex, from, to, mode,
    }))
    return response.result
  }

  searchDocument(
    docId: string,
    needle: string,
    options: SearchOptions,
    onProgress: (response: SearchProgressResponse) => void,
  ): StreamingTask<SearchSummary> {
    const requestId = this.nextId++
    let cancel: () => void = () => {}
    const promise = new Promise<SearchSummary>((resolve, reject) => {
      this.pendingSearches.set(requestId, { docId, onProgress, resolve, reject })
      this.slots[0].worker.postMessage({ type: 'searchDocument', requestId, docId, needle, options })
      cancel = () => this.slots[0].worker.postMessage({ type: 'cancelSearch', requestId, docId })
    })
    return { requestId, promise, cancel: () => cancel() }
  }

  listAllAnnotations(
    docId: string,
    onProgress: (response: AllAnnotationsProgressResponse) => void,
  ): StreamingTask<AnnotationListSummary> {
    const requestId = this.nextId++
    let cancel: () => void = () => {}
    const promise = new Promise<AnnotationListSummary>((resolve, reject) => {
      this.pendingAnnotationLists.set(requestId, { docId, onProgress, resolve, reject })
      this.slots[0].worker.postMessage({ type: 'listAllAnnotations', requestId, docId })
      cancel = () => this.slots[0].worker.postMessage({ type: 'cancelListAllAnnotations', requestId, docId })
    })
    return { requestId, promise, cancel: () => cancel() }
  }

  async layoutText(text: string, fontSize: number, boxWidth: number, font: FontName = 'BIZUDGothic'): Promise<LayoutResult> {
    const response = await this.request<LayoutTextResponse>(this.slots[0], (requestId) => ({
      type: 'layoutText', requestId, text, fontSize, boxWidth, font,
    }))
    return response.result
  }

  async applyAndSave(docId: string, edits: AnnotationEdit[], mode: SaveMode): Promise<ApplyAndSaveResult> {
    const response = await this.request<ApplyAndSaveResponse>(this.slots[0], (requestId) => ({
      type: 'applyAndSave', requestId, docId, edits, mode,
    }))
    return {
      bytes: new Uint8Array(response.bytes),
      mode: response.mode,
      ms: response.ms,
      created: response.created,
      replacedCharacters: response.replacedCharacters,
      unsupportedCharacters: response.unsupportedCharacters,
      errors: response.errors,
    }
  }

  async applyEdits(docId: string, edits: AnnotationEdit[]): Promise<ApplyEditsResult> {
    const response = await this.request<AppliedEditsResponse>(this.slots[0], (requestId) => ({
      type: 'applyEdits', requestId, docId, edits,
    }))
    return {
      created: response.created,
      replacedCharacters: response.replacedCharacters,
      unsupportedCharacters: response.unsupportedCharacters,
      errors: response.errors,
    }
  }

  async prepareOutput(docId: string, edits: AnnotationEdit[], bake: boolean, correction?: import('../core/textCorrection').TextCorrection): Promise<PreparedOutputResult> {
    const response = await this.request<OutputPreparedResponse>(this.slots[0], (requestId) => ({
      type: 'prepareOutput', requestId, docId, edits, bake, correction,
    }))
    return {
      bytes: new Uint8Array(response.bytes),
      ms: response.ms,
      replacedCharacters: response.replacedCharacters,
      unsupportedCharacters: response.unsupportedCharacters,
      errors: response.errors,
    }
  }

  async rasterize(
    docId: string,
    edits: AnnotationEdit[],
    options: RasterizeOptions,
    callbacks: RasterizeCallbacks = {},
  ): Promise<RasterizeResult> {
    const started = performance.now()
    const rasterId = `raster-${docId}-${this.nextId++}`
    const renderDocId = `${rasterId}-source`
    const primary = this.slots[this.primaryWorkerIndex]
    const renderSlots = this.slots.length > 1 ? this.slots.slice(1) : this.slots
    const memoryTarget = callbacks.target ? null : new MemoryPdfWriteTarget()
    const writer = new PdfStreamWriter(callbacks.target ?? memoryTarget!)
    let begin: RasterizeBegunResponse | undefined
    let temporaryOpened = false
    let writeMs = 0
    try {
      if (callbacks.signal?.aborted) throw new DOMException('画像として保存を中止しました。', 'AbortError')
      begin = await this.request<RasterizeBegunResponse>(primary, (requestId) => ({
        type: 'beginRasterize', requestId, docId, renderDocId, edits, options,
      }))
      const begun = begin
      if (begun.errors.length > 0) throw new Error(begun.errors.map((item) => item.message).join(' / '))
      if (callbacks.signal?.aborted) throw new DOMException('画像として保存を中止しました。', 'AbortError')
      if (begun.preparedBytes) {
        const copies = renderSlots.map((_, index) => (
          index === renderSlots.length - 1 ? begun.preparedBytes! : begun.preparedBytes!.slice(0)
        ))
        await Promise.all(renderSlots.map((slot, index) => this.openOnSlot(slot, begun.renderDocId, copies[index])))
        temporaryOpened = true
      }

      const workerPixelPeaks = new Map<number, number>()
      let completedPages = 0
      let maxEncodedBandBytes = 0
      const bandCount = begun.plans.reduce((sum, plan) => sum + plan.bands.length, 0)
      callbacks.onProgress?.(0, begun.plans.length)
      let writeStarted = performance.now()
      await writer.start()
      writeMs += performance.now() - writeStarted

      const renderPage = async (slot: WorkerSlot, pagePlan: RasterizeBegunResponse['plans'][number]): Promise<PdfImageBand[]> => {
        const bands: PdfImageBand[] = []
        for (const band of pagePlan.bands) {
          if (callbacks.signal?.aborted) throw new DOMException('画像として保存を中止しました。', 'AbortError')
          const rendered = await this.request<RasterBandRenderedResponse>(slot, (requestId) => ({
            type: 'renderRasterBand', requestId, docId: begun.renderDocId,
            pagePlan, bandIndex: band.index, color: options.color, format: options.format,
          }))
          if (callbacks.signal?.aborted) throw new DOMException('画像として保存を中止しました。', 'AbortError')
          maxEncodedBandBytes = Math.max(maxEncodedBandBytes, rendered.bytes.byteLength)
          workerPixelPeaks.set(slot.index, Math.max(workerPixelPeaks.get(slot.index) ?? 0, rendered.pixelBytes))
          bands.push({
            bytes: new Uint8Array(rendered.bytes), width: rendered.width, height: rendered.height,
            components: rendered.components, format: options.format,
          })
        }
        return bands
      }

      for (let start = 0; start < begun.plans.length; start += renderSlots.length) {
        const batch = begun.plans.slice(start, start + renderSlots.length)
        const renderedPages = await Promise.all(batch.map((plan, index) => renderPage(renderSlots[index], plan)))
        if (callbacks.signal?.aborted) throw new DOMException('画像として保存を中止しました。', 'AbortError')
        for (let index = 0; index < batch.length; index += 1) {
          writeStarted = performance.now()
          await writer.writePage(batch[index], renderedPages[index])
          writeMs += performance.now() - writeStarted
          completedPages += 1
          callbacks.onProgress?.(completedPages, begun.plans.length)
        }
      }
      writeStarted = performance.now()
      await writer.close()
      writeMs += performance.now() - writeStarted
      const bytes = memoryTarget?.toBytes() ?? null
      return {
        bytes,
        outputBytes: writer.bytesWritten,
        replacedCharacters: begun.replacedCharacters,
        unsupportedCharacters: begun.unsupportedCharacters,
        errors: begun.errors,
        metrics: {
          totalMs: performance.now() - started,
          saveMs: writeMs,
          pageCount: begun.plans.length,
          bandCount,
          maxEncodedBandBytes,
          maxWorkerPixelBytes: Math.max(0, ...workerPixelPeaks.values()),
          concurrentWorkerPixelBytes: [...workerPixelPeaks.values()].reduce((sum, value) => sum + value, 0),
        },
      }
    } catch (error) {
      try { await writer.abort(error) } catch { /* 元の失敗を隠さない。 */ }
      throw error
    } finally {
      if (temporaryOpened && begin) {
        for (const slot of renderSlots) {
          if (!slot.documents.has(begin.renderDocId)) continue
          slot.worker.postMessage({ type: 'close', docId: begin.renderDocId })
          slot.documents.delete(begin.renderDocId)
        }
      }
    }
  }

  async applyPageLayout(docId: string, cards: readonly PageLayoutCard[], sources: readonly string[]): Promise<PageLayoutResult> {
    const poolStarted = performance.now()
    const workerStarted = performance.now()
    const response = await this.request<PageLayoutResponse>(this.slots[0], (requestId) => ({
      type: 'applyPageLayout', requestId, docId, cards, sources,
    }))
    const workerRoundTripMs = performance.now() - workerStarted
    const reloadStarted = performance.now()
    await this.reloadDisplayWorkers(docId, response.bytes)
    const displayReloadMs = performance.now() - reloadStarted
    this.clearPageAssignments(docId)
    return {
      pageCount: response.pageCount,
      pageSizes: response.pageSizes, pageScales: response.pageScales,
      hasBackup: response.hasBackup,
      timings: {
        ...response.timings,
        workerRoundTripMs,
        transferToMainMs: Math.max(0, workerRoundTripMs - response.timings.workerTotalMs),
        displayReloadMs,
        poolTotalMs: performance.now() - poolStarted,
      },
    }
  }

  async undoPageLayout(docId: string): Promise<PageLayoutResult> {
    const poolStarted = performance.now()
    const workerStarted = performance.now()
    const response = await this.request<PageLayoutResponse>(this.slots[0], (requestId) => ({
      type: 'undoPageLayout', requestId, docId,
    }))
    const workerRoundTripMs = performance.now() - workerStarted
    const reloadStarted = performance.now()
    await this.reloadDisplayWorkers(docId, response.bytes)
    const displayReloadMs = performance.now() - reloadStarted
    this.clearPageAssignments(docId)
    return {
      pageCount: response.pageCount,
      pageSizes: response.pageSizes, pageScales: response.pageScales,
      hasBackup: response.hasBackup,
      timings: {
        ...response.timings,
        workerRoundTripMs,
        transferToMainMs: Math.max(0, workerRoundTripMs - response.timings.workerTotalMs),
        displayReloadMs,
        poolTotalMs: performance.now() - poolStarted,
      },
    }
  }

  async getHeaderFooterSettings(docId: string): Promise<HeaderFooterSettings | null> {
    const response = await this.request<HeaderFooterSettingsResponse>(this.slots[0], (requestId) => ({ type: 'getHeaderFooterSettings', requestId, docId }))
    return response.settings
  }

  async applyHeaderFooter(docId: string, settings: HeaderFooterSettings, fileName: string, dateText: string): Promise<PageLayoutResult> {
    return this.runHeaderFooterOperation(docId, (requestId) => ({ type: 'applyHeaderFooter', requestId, docId, settings, fileName, dateText }))
  }

  async removeHeaderFooter(docId: string): Promise<PageLayoutResult> {
    return this.runHeaderFooterOperation(docId, (requestId) => ({ type: 'removeHeaderFooter', requestId, docId }))
  }

  async exportDocumentBytes(docId: string): Promise<Uint8Array> {
    return new Uint8Array(await this.exportBuffer(docId))
  }

  async extractPages(docId: string, cards: readonly PageLayoutCard[], sources: readonly string[]): Promise<Uint8Array> {
    const response = await this.request<PagesExtractedResponse>(this.slots[0], (requestId) => ({
      type: 'extractPages', requestId, docId, cards, sources,
    }))
    return new Uint8Array(response.bytes)
  }

  async splitPages(docId: string, groups: readonly (readonly PageLayoutCard[])[], sources: readonly string[]): Promise<Uint8Array[]> {
    const response = await this.request<PagesSplitResponse>(this.slots[0], (requestId) => ({
      type: 'splitPages', requestId, docId, groups, sources,
    }))
    return response.bytes.map((bytes) => new Uint8Array(bytes))
  }

  async getPageInfo(docId: string): Promise<PageInfo[]> {
    const response = await this.request<PageInfoResponse>(this.slots[0], (requestId) => ({
      type: 'getPageInfo', requestId, docId,
    }))
    return response.pages
  }

  isIdle(): boolean {
    return this.pendingRenders.size === 0 && this.slots.every((slot) => slot.queueLength === 0)
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.worker.postMessage({ type: 'dispose' })
      slot.worker.terminate()
    }
    const error = new Error('Worker pool は破棄されました。')
    for (const pending of this.pendingRenders.values()) pending.reject(error)
    for (const pending of this.pendingRequests.values()) pending.reject(error)
    for (const pending of this.pendingSearches.values()) pending.reject(error)
    for (const pending of this.pendingAnnotationLists.values()) pending.reject(error)
    this.pendingRenders.clear()
    this.pendingRequests.clear()
    this.pendingSearches.clear()
    this.pendingAnnotationLists.clear()
  }

  private request<T extends WorkerResponse>(
    slot: WorkerSlot,
    message: (requestId: number) => object,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const requestId = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve: (value) => resolve(value as T), reject })
      slot.worker.postMessage(message(requestId), transfer)
    })
  }

  private async openOnSlot(slot: WorkerSlot, docId: string, buffer: ArrayBuffer): Promise<OpenResponse> {
    const version = this.documentVersions.get(docId) ?? 0
    await slot.ready
    if ((this.documentVersions.get(docId) ?? 0) !== version) throw new Error('PDF は閉じられました。')
    const requestId = this.nextId++
    const response = await new Promise<OpenResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve: (value) => resolve(value as OpenResponse), reject })
      slot.worker.postMessage({ type: 'open', requestId, docId, bytes: buffer, includePageMetadata: slot.index === this.primaryWorkerIndex }, [buffer])
    })
    if ((this.documentVersions.get(docId) ?? 0) !== version) {
      slot.worker.postMessage({ type: 'close', docId })
      throw new Error('PDF は閉じられました。')
    }
    slot.documents.add(docId)
    return response
  }

  private async exportBuffer(docId: string): Promise<ArrayBuffer> {
    const response = await this.request<ExportBytesResponse>(this.slots[0], (requestId) => ({
      type: 'exportBytes', requestId, docId,
    }))
    return response.bytes
  }

  private async runHeaderFooterOperation(
    docId: string,
    makeRequest: (requestId: number) => import('../worker/protocol').ApplyHeaderFooterRequest | import('../worker/protocol').RemoveHeaderFooterRequest,
  ): Promise<PageLayoutResult> {
    const poolStarted = performance.now()
    const workerStarted = performance.now()
    const response = await this.request<PageLayoutResponse>(this.slots[0], makeRequest)
    const workerRoundTripMs = performance.now() - workerStarted
    const reloadStarted = performance.now()
    await this.reloadDisplayWorkers(docId, response.bytes)
    const displayReloadMs = performance.now() - reloadStarted
    this.clearPageAssignments(docId)
    return { pageCount: response.pageCount, pageSizes: response.pageSizes, pageScales: response.pageScales, hasBackup: response.hasBackup, timings: {
      ...response.timings, workerRoundTripMs, transferToMainMs: Math.max(0, workerRoundTripMs - response.timings.workerTotalMs), displayReloadMs, poolTotalMs: performance.now() - poolStarted,
    } }
  }

  private async reloadDisplayWorkers(docId: string, buffer: ArrayBuffer): Promise<void> {
    const displaySlots = this.slots.slice(1).filter((slot) => slot.documents.has(docId))
    await Promise.all(displaySlots.map((slot, index) => {
      const copy = index === displaySlots.length - 1 ? buffer : buffer.slice(0)
      return this.openOnSlot(slot, docId, copy)
    }))
  }

  private clearPageAssignments(docId: string): void {
    for (const key of [...this.pageAssignments.keys()]) {
      if (key.startsWith(`${docId}:`)) this.pageAssignments.delete(key)
    }
  }

  private touchDisplayDocument(docId: string): void {
    this.displayLru = this.displayLru.filter((id) => id !== docId)
    this.displayLru.push(docId)
  }

  private evictDisplayDocuments(): void {
    if (this.slots.length <= 1) return
    while (this.displayLru.length > 2) {
      const evicted = this.displayLru.shift()!
      for (const slot of this.slots.slice(1)) {
        if (!slot.documents.has(evicted)) continue
        slot.worker.postMessage({ type: 'close', docId: evicted })
        slot.documents.delete(evicted)
      }
    }
  }

  private onMessage(slot: WorkerSlot, message: WorkerResponse): void {
    if (message.type === 'ready') {
      slot.markReady()
      return
    }
    if (message.type === 'started') {
      const pending = this.pendingRenders.get(message.jobId)
      if (pending) {
        pending.workerStarted = true
        pending.log.startedMs = performance.now()
      }
      return
    }
    if (message.type === 'rendered') {
      const pending = this.pendingRenders.get(message.jobId)
      if (!pending) {
        message.bitmap?.close()
        return
      }
      this.pendingRenders.delete(message.jobId)
      pending.slot.queueLength = Math.max(0, pending.slot.queueLength - 1)
      pending.log.endedMs = performance.now()
      pending.log.cancelled = Boolean(message.cancelled)
      if (message.cancelled) pending.reject(new CancelledRenderError())
      else if (message.bitmap) pending.resolve({
        bitmap: message.bitmap,
        renderMs: message.renderMs ?? 0,
        roundTripMs: performance.now() - pending.started,
        differences: message.differences,
        detectionMs: message.detectionMs,
      })
      return
    }
    if (message.type === 'searchProgress') {
      const pending = this.pendingSearches.get(message.requestId)
      if (!pending) return
      pending.onProgress(message)
      if (message.done) {
        this.pendingSearches.delete(message.requestId)
        pending.resolve({
          processedPages: message.processedPages,
          totalPages: message.totalPages,
          totalMatches: message.totalMatches,
          textPages: message.textPages,
          truncated: message.truncated,
          cancelled: message.cancelled,
        })
      }
      return
    }
    if (message.type === 'allAnnotationsProgress') {
      const pending = this.pendingAnnotationLists.get(message.requestId)
      if (!pending) return
      pending.onProgress(message)
      if (message.done) {
        this.pendingAnnotationLists.delete(message.requestId)
        pending.resolve({
          processedPages: message.processedPages,
          totalPages: message.totalPages,
          cancelled: message.cancelled,
        })
      }
      return
    }
    if (message.type === 'error') {
      const error = new Error(message.message)
      if (message.jobId !== undefined) {
        const pending = this.pendingRenders.get(message.jobId)
        if (pending) {
          this.pendingRenders.delete(message.jobId)
          pending.slot.queueLength = Math.max(0, pending.slot.queueLength - 1)
          pending.log.endedMs = performance.now()
          pending.reject(error)
        }
      } else if (message.requestId !== undefined) {
        this.pendingRequests.get(message.requestId)?.reject(error)
        this.pendingSearches.get(message.requestId)?.reject(error)
        this.pendingAnnotationLists.get(message.requestId)?.reject(error)
        this.pendingRequests.delete(message.requestId)
        this.pendingSearches.delete(message.requestId)
        this.pendingAnnotationLists.delete(message.requestId)
      }
      return
    }
    const pending = this.pendingRequests.get(message.requestId)
    if (pending) {
      this.pendingRequests.delete(message.requestId)
      pending.resolve(message)
    }
  }

  private failWorker(slot: WorkerSlot, error: Error): void {
    slot.markFailed(error)
    console.error(`PDF Worker ${slot.index} failed`, error)
    for (const [jobId, pending] of this.pendingRenders) {
      if (pending.slot === slot) {
        pending.reject(error)
        this.pendingRenders.delete(jobId)
      }
    }
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(error)
      this.pendingRequests.delete(requestId)
    }
    for (const [requestId, pending] of this.pendingSearches) {
      pending.reject(error)
      this.pendingSearches.delete(requestId)
    }
    for (const [requestId, pending] of this.pendingAnnotationLists) {
      pending.reject(error)
      this.pendingAnnotationLists.delete(requestId)
    }
    slot.queueLength = 0
  }
}
