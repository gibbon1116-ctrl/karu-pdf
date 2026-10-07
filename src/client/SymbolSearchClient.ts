import type { Point, Rect } from '../core/annotations'
import type { SymbolSearchOptions } from '../core/symbolSearch'
import type { SearchImage } from '../worker/protocol'
import type { PdfWorkerPool } from './PdfWorkerPool'
import type { SymbolSearchMessage, SymbolSearchResponse, WorkerSearchOptions } from '../worker/symbolSearch.worker'

export interface SymbolSearchRequest {
  docId: string; pageIndex: number; sampleRect: Rect; samplePageIndex: number
  searchRect?: Rect; options?: Partial<SymbolSearchOptions>
}
export interface SymbolCandidate { pageIndex: number; rect: Rect; center: Point; score: number; rotation: 0 | 90 | 180 | 270 }
export interface SymbolSearchMetrics {
  renderScale: number; pagePixels: number; renderMs: number; transferMs: number; searchMs: number
  coarseCandidates: number; refined: number; totalMs: number
  requestedRenderScale: number; scaleReduced: boolean; renderTiles: number
  /** Conservative Worker buffer estimate; browser/GPU overhead is excluded. */
  estimatedWorkerBytes: number; levels: number; coarseMs: number; refineMs: number
}
export interface SymbolSearchResult { candidates: SymbolCandidate[]; metrics: SymbolSearchMetrics }
export interface SymbolSearchTestHooks {
  symbolSearch(request: SymbolSearchRequest): Promise<SymbolSearchResult>
  symbolSearchCancelTest(request: SymbolSearchRequest, afterMs: number): Promise<{ cancelled: boolean; settledMs: number }>
}
interface Running {
  id: number; done: boolean; renders: Set<{ cancel(): void }>
  reject(error: Error): void
}
type PageSizeProvider = (docId: string, pageIndex: number) => { width: number; height: number } | undefined
const MAX_PIXELS = 16_000_000
function validRect(rect: Rect): void {
  if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) throw new Error('invalid rectangle')
}
function deviceRect(rect: Rect, scale: number): Rect {
  return [Math.floor(rect[0] * scale), Math.floor(rect[1] * scale), Math.ceil(rect[2] * scale), Math.ceil(rect[3] * scale)]
}
export class SymbolSearchClient {
  private worker: Worker | null = null
  private running: Running | null = null
  private disposed = false
  private nextId = 0

  /** Pass existing page dimensions to avoid getPageInfo's all-page text extraction. */
  constructor(private pool: PdfWorkerPool, private pageSize?: PageSizeProvider) {}

  search(request: SymbolSearchRequest, onProgress?: (stage: 'render' | 'search', done: number, total: number) => void): { promise: Promise<SymbolSearchResult>; cancel(): void } {
    if (this.disposed || this.running) return { promise: Promise.reject(new Error(this.disposed ? 'disposed' : 'search already running')), cancel() {} }
    const started = performance.now()
    let resolve!: (result: SymbolSearchResult) => void, reject!: (error: Error) => void
    const promise = new Promise<SymbolSearchResult>((yes, no) => { resolve = yes; reject = no })
    const run: Running = { id: ++this.nextId, done: false, renders: new Set(), reject }
    this.running = run
    const check = () => { if (run.done || this.disposed) throw new Error('cancelled') }
    const fail = (error: Error) => {
      if (run.done) return
      run.done = true
      for (const task of run.renders) task.cancel()
      run.renders.clear()
      this.worker?.terminate(); this.worker = null
      if (this.running === run) this.running = null
      reject(error)
    }
    void (async () => {
      if (!Number.isInteger(request.pageIndex) || request.pageIndex < 0 || !Number.isInteger(request.samplePageIndex) || request.samplePageIndex < 0) throw new Error('invalid page')
      validRect(request.sampleRect)
      let rect = request.searchRect
      if (!rect) {
        // This fallback is explicit-search-only. The App hook always supplies known sizes.
        const size = this.pageSize ? this.pageSize(request.docId, request.pageIndex) : (await this.pool.getPageInfo(request.docId))[request.pageIndex]
        check()
        if (!size) throw new Error('page unavailable')
        rect = [0, 0, size.width, size.height]
      }
      validRect(rect)
      const requestedRenderScale = 24 / Math.max(request.sampleRect[2] - request.sampleRect[0], request.sampleRect[3] - request.sampleRect[1])
      let renderScale = requestedRenderScale
      const count = (scale: number) => Math.max(...[rect!, request.sampleRect].map(bounds => { const d = deviceRect(bounds, scale); return (d[2] - d[0]) * (d[3] - d[1]) }))
      if (count(renderScale) > MAX_PIXELS) {
        let lo = 0, hi = renderScale
        for (let i = 0; i < 52; i++) { const mid = (lo + hi) / 2; if (count(mid) <= MAX_PIXELS) lo = mid; else hi = mid }
        renderScale = lo
      }
      if (!Number.isFinite(renderScale) || renderScale <= 0) throw new Error('invalid render scale')
      const searchDevice = deviceRect(rect, renderScale), sampleDevice = deviceRect(request.sampleRect, renderScale)
      const renderTiles = 2 // Kept in the metrics schema: one page crop and one sample.
      let rendered = 0
      onProgress?.('render', 0, renderTiles)
      const render = async (pageIndex: number, bounds: Rect): Promise<SearchImage> => {
        check()
        const task = this.pool.renderSearchImage({ docId: request.docId, pageIndex, renderScale, deviceRect: bounds })
        run.renders.add(task)
        try {
          const result = await task.promise
          check() // Discard late arrays after cancellation; never start a search.
          onProgress?.('render', ++rendered, renderTiles)
          return result
        } finally { run.renders.delete(task) }
      }
      const page = await render(request.pageIndex, searchDevice)
      const template = await render(request.samplePageIndex, sampleDevice)
      check()
      const renderMs = performance.now() - started
      // Callbacks are never structured-cloned. Pixel-space region is relative to the rendered crop.
      const input = request.options ?? {}, options: WorkerSearchOptions = { threshold: input.threshold ?? .7, rotations: input.rotations ?? false,
        maxResults: input.maxResults ?? 500, region: input.region ?? { x: rect[0] * renderScale - searchDevice[0], y: rect[1] * renderScale - searchDevice[1],
          width: (rect[2] - rect[0]) * renderScale, height: (rect[3] - rect[1]) * renderScale } }
      const worker = this.worker ??= new Worker(new URL('../worker/symbolSearch.worker.ts', import.meta.url), { type: 'module' })
      const transferred = performance.now()
      worker.onmessage = (event: MessageEvent<SymbolSearchResponse>) => {
        if (run.done || event.data.id !== run.id) return
        const response = event.data
        if (response.type === 'progress') { onProgress?.('search', response.done, response.total); return }
        if (response.type === 'error') { fail(new Error(response.message)); return }
        const candidates: SymbolCandidate[] = response.matches.map(match => {
          const x = (match.x + searchDevice[0]) / renderScale, y = (match.y + searchDevice[1]) / renderScale
          const w = match.width / renderScale, h = match.height / renderScale
          return { pageIndex: request.pageIndex, rect: [x, y, x + w, y + h], center: [x + w / 2, y + h / 2], score: match.score, rotation: match.rotation }
        })
        run.done = true; this.running = null
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
        resolve({ candidates, metrics: { renderScale, requestedRenderScale, scaleReduced: renderScale < requestedRenderScale, renderTiles,
          pagePixels: response.memory.pagePixels, renderMs, transferMs: Math.max(0, performance.now() - transferred - response.stats.workerMs),
          searchMs: response.stats.workerMs, coarseCandidates: response.stats.coarseCandidates, refined: response.stats.refined, totalMs: performance.now() - started,
          estimatedWorkerBytes: response.memory.bytes, levels: response.stats.levels, coarseMs: response.stats.ms.coarse, refineMs: response.stats.ms.refine } })
      }
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'symbol search Worker failed')) }
      worker.onmessageerror = () => fail(new Error('symbol search message failed'))
      onProgress?.('search', 0, 1)
      worker.postMessage({ type: 'search', id: run.id, page, template, renderScale, options } satisfies SymbolSearchMessage, [page.gray.buffer as ArrayBuffer, template.gray.buffer as ArrayBuffer])
      // Ownership of both gray buffers belongs to the Worker after transfer.
    })().catch(error => fail(error instanceof Error ? error : new Error(String(error))))
    return { promise, cancel: () => fail(new Error('cancelled')) }
  }

  dispose(): void {
    this.disposed = true
    const run = this.running
    if (run && !run.done) {
      run.done = true; for (const task of run.renders) task.cancel()
      run.renders.clear(); run.reject(new Error('cancelled')); this.running = null
    }
    this.worker?.terminate(); this.worker = null
  }
}
