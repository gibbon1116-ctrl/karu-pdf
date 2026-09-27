import { recordMetric } from '../perf/metrics'
import { BitmapCache } from '../viewer/BitmapCache'
import type { DeviceRect, Priority } from '../worker/protocol'
import { CancelledRenderError, type RenderBackend, type RenderTask } from './PdfWorkerPool'

export interface RenderParams {
  pageIndex: number
  renderScale: number
  deviceRect: DeviceRect | null
}

interface RequestEntry {
  key: string
  params: RenderParams
  priority: Priority
  task: RenderTask
  waiters: Map<number, (bitmap: ImageBitmap) => void>
}

export class RenderScheduler {
  private readonly requests = new Map<string, RequestEntry>()
  private nextWaiterId = 1

  constructor(
    private readonly backend: RenderBackend,
    readonly cache: BitmapCache,
    readonly warmCache = new BitmapCache(64 * 1024 * 1024),
  ) {}

  want(
    key: string,
    params: RenderParams,
    priority: Priority,
    onReady: (bitmap: ImageBitmap) => void,
  ): () => void {
    const cache = this.cacheFor(key)
    const cached = cache.get(key)
    if (cached) {
      onReady(cached)
      return () => undefined
    }

    const waiterId = this.nextWaiterId++
    let entry = this.requests.get(key)
    if (entry) {
      entry.waiters.set(waiterId, onReady)
      if (priority < entry.priority) {
        entry.priority = priority
        this.backend.reprioritize(entry.task.jobId, priority)
      }
    } else {
      const task = this.backend.render({ ...params, priority })
      const created: RequestEntry = { key, params, priority, task, waiters: new Map([[waiterId, onReady]]) }
      entry = created
      this.requests.set(key, created)
      void task.promise.then((result) => {
        recordMetric('render-job-worker', result.renderMs)
        recordMetric('render-job-roundtrip', result.roundTripMs)
        cache.set(key, result.bitmap)
        const current = this.requests.get(key)
        if (current === created) this.requests.delete(key)
        for (const waiter of created.waiters.values()) waiter(result.bitmap)
        created.waiters.clear()
      }).catch((error) => {
        if (this.requests.get(key) === created) this.requests.delete(key)
        if (!(error instanceof CancelledRenderError)) console.error(error)
      })
    }

    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.requests.get(key)
      if (current !== entry) return
      current.waiters.delete(waiterId)
      if (current.waiters.size > 0) return
      queueMicrotask(() => {
        if (this.requests.get(key) !== current || current.waiters.size > 0 || current.task.isStarted()) return
        this.requests.delete(key)
        this.backend.cancelJobs([current.task.jobId])
      })
    }
  }

  has(key: string): boolean {
    return this.cacheFor(key).get(key) !== undefined
  }

  pendingCount(): number {
    return this.requests.size
  }

  destroy(): void {
    for (const entry of this.requests.values()) {
      entry.waiters.clear()
      if (!entry.task.isStarted()) this.backend.cancelJobs([entry.task.jobId])
    }
    this.requests.clear()
  }

  private cacheFor(key: string): BitmapCache {
    return key.startsWith('warm:') ? this.warmCache : this.cache
  }
}
