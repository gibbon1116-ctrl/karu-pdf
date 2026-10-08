/* @single:start */import { createSingleWorker } from '../single/runtime'
/* @single:end */import { classifyPage, type PageKind, type VectorPage } from '../core/vectorPaths'
import type { Rect } from '../core/annotations'
import type { SymbolLabel } from '../core/symbolLabels'
import type { SnapIndex } from '../core/snap'
import type { PdfWorkerPool } from './PdfWorkerPool'
import type { EndpointMessage, VectorSearchMessage, SymbolSearchResponse } from '../worker/symbolSearchMessages'

export const SYMBOL_SEARCH_STALL_MS = 60_000
export const VECTOR_CACHE_PAGES = 3
export const VECTOR_CACHE_BYTES = 16 * 1024 * 1024
export interface CachedVectorPage extends VectorPage { kind: PageKind; endpointIndex?: SnapIndex; labels?: SymbolLabel[] }
export const cancelled = () => new Error('cancelled')

/** Every invocation owns a disposable Worker; no matching/indexing runs on the UI thread. */
export function vectorWorkerTask(message: VectorSearchMessage | EndpointMessage, signal?: AbortSignal,
  onProgress?: () => void): Promise<SymbolSearchResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return }
    const worker = /* @single:start */createSingleWorker('symbol-search') ?? /* @single:end */new Worker(new URL('../worker/symbolSearch.worker.ts', import.meta.url), { type: 'module' })
    let lastHeard = performance.now(), finished = false
    const finish = (error?: Error, response?: SymbolSearchResponse) => {
      if (finished) return
      finished = true; clearInterval(timer); signal?.removeEventListener('abort', abort); worker.terminate()
      if (error) reject(error); else resolve(response!)
    }
    const abort = () => finish(cancelled())
    const timer = setInterval(() => { if (performance.now() - lastHeard > SYMBOL_SEARCH_STALL_MS) finish(new Error('照合が応答しなくなったため中止しました。もう一度探してください。')) }, 1000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<SymbolSearchResponse>) => {
      if (event.data.id !== message.id) return
      lastHeard = performance.now()
      if (event.data.type === 'progress') { onProgress?.(); return }
      if (event.data.type === 'error') finish(new Error(event.data.message)); else finish(undefined, event.data)
    }
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'Worker failed')) }
    worker.onmessageerror = () => finish(new Error('Worker message failed'))
    // Cache arrays remain attached. Only copies belong to the Worker.
    try {
      const segments = message.segments.slice()
      if (message.type === 'vector-search') {
        const sampleSegments = message.sampleSegments.slice()
        const sampleWidths = message.sampleWidths.slice()
        const segmentWidths = message.segmentWidths?.slice()
        worker.postMessage({ ...message, segments, sampleSegments, sampleWidths, segmentWidths },
          [segments.buffer, sampleSegments.buffer, sampleWidths.buffer, ...(segmentWidths ? [segmentWidths.buffer] : [])])
      } else worker.postMessage({ ...message, segments }, [segments.buffer])
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
  })
}

interface Entry {
  promise: Promise<CachedVectorPage>; value?: CachedVectorPage; cancel(): void; users: number
  endpoint?: Promise<SnapIndex | null>; endpointAbort?: AbortController; endpointUsers?: number
  labels?: Promise<SymbolLabel[]>
}
/** Document-owned, demand-only LRU. Pending requests are shared; invalidated late results never return to the cache. */
export class VectorCache {
  private entries = new Map<number, Entry>()
  extractionRequests = 0
  private unavailable = new Set<number>()
  reportUnavailable(pageIndex: number): boolean { if (this.unavailable.has(pageIndex)) return false; this.unavailable.add(pageIndex); return true }
  peekEndpoint(pageIndex: number): SnapIndex | null { return this.entries.get(pageIndex)?.value?.endpointIndex ?? null }
  get size(): number { return [...this.entries.values()].filter(e => e.value).length }
  get bytes(): number { return [...this.entries.values()].reduce((sum, e) => sum + (e.value?.segments.byteLength ?? 0) + (e.value?.widths.byteLength ?? 0) + (e.value?.endpointIndex?.bytes ?? 0)
    + (e.value?.labels?.reduce((n, label) => n + label.text.length * 2 + 32, 0) ?? 0), 0) }
  constructor(private docId: string) {}
  clear(): void {
    for (const e of this.entries.values()) { e.cancel(); e.endpointAbort?.abort() }
    this.entries.clear(); this.unavailable.clear()
  }
  private trim(): void {
    while (this.size > VECTOR_CACHE_PAGES || this.bytes > VECTOR_CACHE_BYTES) {
      const oldest = [...this.entries].find(([, e]) => e.value)
      if (!oldest) break
      oldest[1].endpointAbort?.abort(); this.entries.delete(oldest[0])
    }
  }
  get(pageIndex: number, pool: Pick<PdfWorkerPool, 'extractVectors'>, signal?: AbortSignal): Promise<CachedVectorPage> {
    if (signal?.aborted) return Promise.reject(cancelled())
    let entry = this.entries.get(pageIndex)
    if (!entry) {
      this.extractionRequests++
      const task = pool.extractVectors({ docId: this.docId, pageIndex })
      entry = { promise: null!, cancel: task.cancel, users: 0 }
      const own = entry
      entry.promise = task.promise.then(page => {
        const value = { ...page, kind: classifyPage(page) }
        if (this.entries.get(pageIndex) !== own) throw cancelled()
        own.value = value; this.trim(); return value
      }, error => { if (this.entries.get(pageIndex) === own) this.entries.delete(pageIndex); throw error })
      this.entries.set(pageIndex, entry)
    } else { this.entries.delete(pageIndex); this.entries.set(pageIndex, entry) }
    const own = entry
    own.users++
    if (!signal) { void own.promise.then(() => own.users--, () => own.users--); return own.promise }
    return new Promise((resolve, reject) => {
      let done = false
      const finish = () => { done = true; own.users--; signal.removeEventListener('abort', abort) }
      const abort = () => {
        if (done) return
        finish(); reject(cancelled())
        if (!own.users && !own.value && this.entries.get(pageIndex) === own) { own.cancel(); this.entries.delete(pageIndex) }
      }
      signal.addEventListener('abort', abort, { once: true })
      own.promise.then(value => { if (!done) { finish(); resolve(value) } }, error => { if (!done) { finish(); reject(error) } })
    })
  }
  async endpoints(pageIndex: number, pool: Pick<PdfWorkerPool, 'extractVectors'>, bounds: Rect, signal: AbortSignal): Promise<SnapIndex | null> {
    const page = await this.get(pageIndex, pool, signal)
    if (signal.aborted) throw cancelled()
    if (page.truncated || page.kind === 'raster' || page.kind === 'empty') return null
    if (page.endpointIndex) return page.endpointIndex
    const entry = this.entries.get(pageIndex)
    if (!entry) return null // Oversize pages are not retained for snapping.
    if (!entry.endpoint) {
      const controller = new AbortController(); entry.endpointAbort = controller
      entry.endpoint = vectorWorkerTask({ type: 'endpoints', id: pageIndex, segments: page.segments, bounds }, controller.signal).then(response => {
        if (response.type !== 'endpoint-result') throw Error('Invalid endpoint response')
        if (this.entries.get(pageIndex) !== entry) throw cancelled()
        page.endpointIndex = response.index; this.trim(); return response.index
      }).finally(() => { entry.endpoint = undefined; entry.endpointAbort = undefined })
    }
    // Subscribers can leave independently. Index building is bounded and shared;
    // eviction/document invalidation terminates its Worker.
    entry.endpointUsers = (entry.endpointUsers ?? 0) + 1
    return new Promise((resolve, reject) => {
      let done = false
      const finish = () => { done = true; entry.endpointUsers!--; signal.removeEventListener('abort', abort) }
      const abort = () => { if (done) return; finish(); reject(cancelled()); if (!entry.endpointUsers) entry.endpointAbort?.abort() }
      signal.addEventListener('abort', abort, { once: true })
      entry.endpoint!.then(value => { if (!done) { finish(); resolve(value) } }, error => { if (!done) { finish(); reject(error) } })
    })
  }
  /** Called only after a successful vector search, never by get() or endpoints(). */
  async getLabels(pageIndex: number, pool: Pick<PdfWorkerPool, 'extractLabels'>, signal: AbortSignal): Promise<SymbolLabel[]> {
    if (signal.aborted) throw cancelled()
    const entry = this.entries.get(pageIndex)
    if (entry?.value?.labels) return entry.value.labels
    const load = () => pool.extractLabels({ docId: this.docId, pageIndex })
    const pending = entry ? (entry.labels ??= load().then(labels => {
      if (this.entries.get(pageIndex) !== entry) throw cancelled()
      if (entry.value) entry.value.labels = labels
      this.trim(); return labels
    }).finally(() => { entry.labels = undefined })) : load()
    return new Promise((resolve, reject) => {
      const abort = () => reject(cancelled())
      signal.addEventListener('abort', abort, { once: true })
      pending.then(labels => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(labels) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    })
  }
}
