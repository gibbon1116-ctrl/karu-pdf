import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'
import type {
  ApplyAndSaveResponse,
  DeviceRect,
  ExportBytesResponse,
  LayoutTextResponse,
  ListAnnotationsResponse,
  OpenResponse,
  Priority,
  RenderResponse,
  StatsResponse,
  WorkerResponse,
} from '../worker/protocol'

export interface OpenResult {
  pageCount: number
  pageSizes: PageSize[]
  openMs: number
  sizesMs: number
}

export interface RenderResult {
  bitmap: ImageBitmap
  renderMs: number
  roundTripMs: number
}

export interface ApplyAndSaveResult {
  bytes: Uint8Array
  mode: SaveMode
  ms: number
  created: number[]
  replacedCharacters: number
  errors: ApplyError[]
}

export interface PoolStats {
  queueLength: number
  displayListCount: number
  displayListBytes: number
  processedCount: number
  workers: Array<{ index: number; queueLength: number; displayListCount: number; displayListBytes: number; processedCount: number }>
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
  jobId: number
  promise: Promise<RenderResult>
  isStarted(): boolean
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
}

type Pending = {
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
  private displayLru: string[] = []
  private readonly pageAssignments = new Map<string, number>()
  private readonly renderLogEntries: WorkerRenderLogEntry[] = []
  private readonly assignedCounts: number[] = []
  private activeDocId: string | null = null
  private nextId = 1

  constructor(count = 1) {
    this.workerCount = Math.max(1, Math.min(3, Math.trunc(count)))
    this.slots = Array.from({ length: this.workerCount }, (_, index) => {
      const worker = new Worker(new URL('../worker/pdf.worker.ts', import.meta.url), { type: 'module' })
      let markReady: () => void = () => {}
      const ready = new Promise<void>((resolve) => { markReady = resolve })
      const slot: WorkerSlot = { index, worker, documents: new Set(), queueLength: 0, ready, markReady }
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
      pageSizes: first.pageSizes,
      openMs: first.openMs,
      sizesMs: first.sizesMs,
    }
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
    for (const slot of this.slots) {
      if (!slot.documents.has(docId)) continue
      slot.worker.postMessage({ type: 'close', docId })
      slot.documents.delete(docId)
    }
    this.displayLru = this.displayLru.filter((id) => id !== docId)
    if (this.activeDocId === docId) this.activeDocId = null
    for (const key of this.pageAssignments.keys()) {
      if (key.startsWith(`${docId}:`)) this.pageAssignments.delete(key)
    }
  }

  // ページ番号の剰余で固定すると、図面が周期的に並ぶ文書で重いページが
  // 1本の Worker に集中する。最初の要求のときに最も空いている Worker を
  // 選び、以後はそのページを同じ Worker に任せる（DisplayList を1つで済ませる）。
  private slotForPage(docId: string, pageIndex: number): WorkerSlot {
    const key = `${docId}:${pageIndex}`
    const assigned = this.pageAssignments.get(key)
    if (assigned !== undefined) return this.slots[assigned]
    const chosen = this.slots.reduce((best, current) => {
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
      this.pendingRenders.set(jobId, { docId: options.docId, started: performance.now(), workerStarted: false, slot, log, resolve, reject })
      slot.worker.postMessage({ type: 'render', jobId, ...options })
    })
    return {
      jobId,
      promise,
      isStarted: () => this.pendingRenders.get(jobId)?.workerStarted ?? true,
    }
  }

  cancelJobs(docId: string, jobIds: readonly number[]): void {
    const byWorker = new Map<WorkerSlot, number[]>()
    for (const jobId of jobIds) {
      const pending = this.pendingRenders.get(jobId)
      if (!pending || pending.docId !== docId || pending.workerStarted) continue
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
      workers: workers.map(({ queueLength, displayListCount, displayListBytes, processedCount }, index) => ({ index, queueLength, displayListCount, displayListBytes, processedCount })),
      queueLength: workers.reduce((sum, worker) => sum + worker.queueLength, 0),
      displayListCount: workers.reduce((sum, worker) => sum + worker.displayListCount, 0),
      displayListBytes: workers.reduce((sum, worker) => sum + worker.displayListBytes, 0),
      processedCount: workers.reduce((sum, worker) => sum + worker.processedCount, 0),
    }
  }

  async listAnnotations(docId: string, pageIndex: number): Promise<AnnotationInfo[]> {
    const response = await this.request<ListAnnotationsResponse>(this.slots[0], (requestId) => ({
      type: 'listAnnotations', requestId, docId, pageIndex,
    }))
    return response.annotations
  }

  async layoutText(text: string, fontSize: number, boxWidth: number): Promise<LayoutResult> {
    const response = await this.request<LayoutTextResponse>(this.slots[0], (requestId) => ({
      type: 'layoutText', requestId, text, fontSize, boxWidth,
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
      errors: response.errors,
    }
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
    this.pendingRenders.clear()
    this.pendingRequests.clear()
  }

  private request<T extends WorkerResponse>(slot: WorkerSlot, message: (requestId: number) => object): Promise<T> {
    const requestId = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve: (value) => resolve(value as T), reject })
      slot.worker.postMessage(message(requestId))
    })
  }

  private async openOnSlot(slot: WorkerSlot, docId: string, buffer: ArrayBuffer): Promise<OpenResponse> {
    await slot.ready
    const requestId = this.nextId++
    return new Promise<OpenResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve: (value) => resolve(value as OpenResponse), reject })
      slot.worker.postMessage({ type: 'open', requestId, docId, bytes: buffer }, [buffer])
    }).then((response) => {
      slot.documents.add(docId)
      return response
    })
  }

  private async exportBuffer(docId: string): Promise<ArrayBuffer> {
    const response = await this.request<ExportBytesResponse>(this.slots[0], (requestId) => ({
      type: 'exportBytes', requestId, docId,
    }))
    return response.bytes
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
      })
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
        this.pendingRequests.delete(message.requestId)
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
    slot.queueLength = 0
  }
}
