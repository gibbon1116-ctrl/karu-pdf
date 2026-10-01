import { describe, expect, it, vi } from 'vitest'
import type { RenderBackend, RenderResult, RenderTask } from '../src/client/PdfWorkerPool'
import { RenderScheduler } from '../src/client/RenderScheduler'
import { BitmapCache } from '../src/viewer/BitmapCache'
import type { Priority } from '../src/worker/protocol'

interface ControlledTask {
  task: RenderTask
  resolve(value: RenderResult): void
  reject(error: Error): void
  setStarted(): void
}

function bitmap(): ImageBitmap {
  return { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap
}

function backendHarness() {
  const tasks: ControlledTask[] = []
  let nextId = 1
  const backend: RenderBackend = {
    render: vi.fn(() => {
      let resolve!: (value: RenderResult) => void
      let reject!: (error: Error) => void
      let started = false
      const promise = new Promise<RenderResult>((yes, no) => { resolve = yes; reject = no })
      const task: RenderTask = { jobId: nextId++, promise, isStarted: () => started }
      tasks.push({ task, resolve, reject, setStarted: () => { started = true } })
      return task
    }),
    cancelJobs: vi.fn(),
    reprioritize: vi.fn(),
  }
  return { backend, tasks }
}

const params = { docId: 'doc-a', pageIndex: 2, renderScale: 1, deviceRect: null }
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('RenderScheduler', () => {
  it('重複するwantを1件の描画要求にまとめる', () => {
    const { backend } = backendHarness()
    const scheduler = new RenderScheduler(backend, new BitmapCache())
    scheduler.want('same', params, 1, () => undefined)
    scheduler.want('same', params, 1, () => undefined)
    expect(backend.render).toHaveBeenCalledOnce()
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('全waiterのrelease後、未処理要求を取り消す', async () => {
    const { backend, tasks } = backendHarness()
    const scheduler = new RenderScheduler(backend, new BitmapCache())
    const release = scheduler.want('cancel', params, 1, () => undefined)
    release()
    await flush()
    expect(backend.cancelJobs).toHaveBeenCalledWith('doc-a', [tasks[0].task.jobId])
    expect(scheduler.pendingCount()).toBe(0)
  })

  it('waiterがいなくても開始済み要求の結果をキャッシュする', async () => {
    const { backend, tasks } = backendHarness()
    const cache = new BitmapCache()
    const scheduler = new RenderScheduler(backend, cache)
    const release = scheduler.want('keep', params, 1, () => undefined)
    tasks[0].setStarted()
    release()
    const resultBitmap = bitmap()
    tasks[0].resolve({ bitmap: resultBitmap, renderMs: 10, roundTripMs: 12 })
    await flush()
    expect(cache.get('keep')).toBe(resultBitmap)
  })

  it('重複要求の優先度が上がったらWorkerへ通知する', () => {
    const { backend, tasks } = backendHarness()
    const scheduler = new RenderScheduler(backend, new BitmapCache())
    scheduler.want('priority', params, 2, () => undefined)
    scheduler.want('priority', params, 0, () => undefined)
    expect(backend.reprioritize).toHaveBeenCalledWith('doc-a', tasks[0].task.jobId, 0 satisfies Priority)
  })

  it('比較の開始済み要求も、不要になれば取り消す', async () => {
    const { backend, tasks } = backendHarness()
    const scheduler = new RenderScheduler(backend, new BitmapCache())
    const release = scheduler.want('compare', params, 1, () => undefined)
    tasks[0].task.cancellableWhileStarted = true
    tasks[0].setStarted()
    release(); await flush()
    expect(backend.cancelJobs).toHaveBeenCalledWith('doc-a', [tasks[0].task.jobId])
  })

  it('画面を閉じた後に届いた画像を解放し、キャッシュへ残さない', async () => {
    const { backend, tasks } = backendHarness()
    const cache = new BitmapCache(), scheduler = new RenderScheduler(backend, cache)
    const ready = vi.fn()
    scheduler.want('late', params, 0, ready)
    tasks[0].setStarted(); scheduler.destroy()
    const resultBitmap = bitmap()
    tasks[0].resolve({ bitmap: resultBitmap, renderMs: 1, roundTripMs: 2 })
    await flush()
    expect(resultBitmap.close).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0); expect(ready).not.toHaveBeenCalled()
  })
})
