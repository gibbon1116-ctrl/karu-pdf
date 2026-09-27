import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit, AnnotationInfo, ApplyError } from '../core/annotations'
import type { LayoutResult } from '../core/textLayout'
import type { SaveMode } from '../core/save'
import type {
  ApplyAndSaveResponse,
  DeviceRect,
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

export interface RenderTask {
  jobId: number
  promise: Promise<RenderResult>
  isStarted(): boolean
}

export interface RenderBackend {
  render(options: {
    priority: Priority
    pageIndex: number
    renderScale: number
    deviceRect: DeviceRect | null
    excludeAnnotObjNums?: number[]
  }): RenderTask
  cancelJobs(jobIds: readonly number[]): void
  reprioritize(jobId: number, priority: Priority): void
}

interface WorkerSlot {
  readonly index: number
  readonly worker: Worker
  queueLength: number
  ready: Promise<void>
  markReady(): void
}

type Pending = {
  started: number
  workerStarted: boolean
  slot: WorkerSlot
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
  private nextId = 1

  constructor(count = 1) {
    this.workerCount = Math.max(1, Math.min(3, Math.trunc(count)))
    this.slots = Array.from({ length: this.workerCount }, (_, index) => {
      const worker = new Worker(new URL('../worker/pdf.worker.ts', import.meta.url), { type: 'module' })
      let markReady: () => void = () => {}
      const ready = new Promise<void>((resolve) => { markReady = resolve })
      const slot: WorkerSlot = { index, worker, queueLength: 0, ready, markReady }
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(slot, event.data)
      worker.onerror = (event) => this.failWorker(slot, new Error(event.message || 'Worker でエラーが発生しました。'))
      return slot
    })
  }

  async open(bytes: ArrayBuffer): Promise<OpenResult> {
    await Promise.all(this.slots.map((slot) => slot.ready))
    const copies = this.slots.map((_, index) => (index === 0 ? bytes : bytes.slice(0)))
    const requests = this.slots.map((slot, index) => {
      const requestId = this.nextId++
      return new Promise<OpenResponse>((resolve, reject) => {
        this.pendingRequests.set(requestId, {
          resolve: (value) => resolve(value as OpenResponse),
          reject,
        })
        const buffer = copies[index]
        slot.worker.postMessage({ type: 'open', requestId, bytes: buffer }, [buffer])
      })
    })
    const responses = await Promise.all(requests)
    const first = responses[0]
    return {
      pageCount: first.pageCount,
      pageSizes: first.pageSizes,
      openMs: first.openMs,
      sizesMs: first.sizesMs,
    }
  }

  render(options: {
    priority: Priority
    pageIndex: number
    renderScale: number
    deviceRect: DeviceRect | null
    excludeAnnotObjNums?: number[]
  }): RenderTask {
    const slot = this.slots[options.pageIndex % this.workerCount]
    const jobId = this.nextId++
    slot.queueLength += 1
    const promise = new Promise<RenderResult>((resolve, reject) => {
      this.pendingRenders.set(jobId, { started: performance.now(), workerStarted: false, slot, resolve, reject })
      slot.worker.postMessage({ type: 'render', jobId, ...options })
    })
    return {
      jobId,
      promise,
      isStarted: () => this.pendingRenders.get(jobId)?.workerStarted ?? true,
    }
  }

  cancelJobs(jobIds: readonly number[]): void {
    const byWorker = new Map<WorkerSlot, number[]>()
    for (const jobId of jobIds) {
      const pending = this.pendingRenders.get(jobId)
      if (!pending || pending.workerStarted) continue
      const ids = byWorker.get(pending.slot) ?? []
      ids.push(jobId)
      byWorker.set(pending.slot, ids)
    }
    for (const [slot, ids] of byWorker) slot.worker.postMessage({ type: 'cancelJobs', jobIds: ids })
  }

  reprioritize(jobId: number, priority: Priority): void {
    const pending = this.pendingRenders.get(jobId)
    if (!pending || pending.workerStarted) return
    pending.slot.worker.postMessage({ type: 'reprioritize', jobId, priority })
  }

  async stats(): Promise<PoolStats> {
    const workers = await Promise.all(this.slots.map((slot) => {
      const requestId = this.nextId++
      return new Promise<StatsResponse>((resolve, reject) => {
        this.pendingRequests.set(requestId, {
          resolve: (value) => resolve(value as StatsResponse),
          reject,
        })
        slot.worker.postMessage({ type: 'stats', requestId })
      })
    }))
    return {
      workers: workers.map(({ queueLength, displayListCount, displayListBytes, processedCount }, index) => ({ index, queueLength, displayListCount, displayListBytes, processedCount })),
      queueLength: workers.reduce((sum, worker) => sum + worker.queueLength, 0),
      displayListCount: workers.reduce((sum, worker) => sum + worker.displayListCount, 0),
      displayListBytes: workers.reduce((sum, worker) => sum + worker.displayListBytes, 0),
      processedCount: workers.reduce((sum, worker) => sum + worker.processedCount, 0),
    }
  }

  async listAnnotations(pageIndex: number): Promise<AnnotationInfo[]> {
    const slot = this.slots[this.primaryWorkerIndex]
    await slot.ready
    const requestId = this.nextId++
    return new Promise<ListAnnotationsResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as ListAnnotationsResponse),
        reject,
      })
      slot.worker.postMessage({ type: 'listAnnotations', requestId, pageIndex })
    }).then((response) => response.annotations)
  }

  async layoutText(text: string, fontSize: number, boxWidth: number): Promise<LayoutResult> {
    const slot = this.slots[this.primaryWorkerIndex]
    await slot.ready
    const requestId = this.nextId++
    return new Promise<LayoutTextResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as LayoutTextResponse),
        reject,
      })
      slot.worker.postMessage({ type: 'layoutText', requestId, text, fontSize, boxWidth })
    }).then((response) => response.result)
  }

  async applyAndSave(edits: AnnotationEdit[], mode: SaveMode): Promise<ApplyAndSaveResult> {
    const slot = this.slots[this.primaryWorkerIndex]
    await slot.ready
    const requestId = this.nextId++
    return new Promise<ApplyAndSaveResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as ApplyAndSaveResponse),
        reject,
      })
      slot.worker.postMessage({ type: 'applyAndSave', requestId, edits, mode })
    }).then((response) => ({
      bytes: new Uint8Array(response.bytes),
      mode: response.mode,
      ms: response.ms,
      created: response.created,
      replacedCharacters: response.replacedCharacters,
      errors: response.errors,
    }))
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

  private onMessage(slot: WorkerSlot, message: WorkerResponse): void {
    if (message.type === 'ready') {
      slot.markReady()
      return
    }
    if (message.type === 'started') {
      const pending = this.pendingRenders.get(message.jobId)
      if (pending) pending.workerStarted = true
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
