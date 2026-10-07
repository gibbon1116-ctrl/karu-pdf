import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol'
import type { VectorPage } from '../src/core/vectorPaths'

vi.mock('../src/single/runtime', () => ({ createSingleWorker: () => undefined }))
const workers: MockWorker[] = []
class MockWorker {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  requests: WorkerRequest[] = []
  constructor() { workers.push(this) }
  emit(data: WorkerResponse) { this.onmessage!({ data }) }
  postMessage(request: WorkerRequest) {
    this.requests.push(request)
    if (request.type === 'open') queueMicrotask(() => this.emit({ type: 'opened', requestId: request.requestId, pageCount: 1, pageSizes: [{ width: 200, height: 100 }], openMs: 0, sizesMs: 0 }))
  }
  terminate() {}
}
let pool: PdfWorkerPool
async function opened() {
  vi.stubGlobal('Worker', MockWorker)
  pool = new PdfWorkerPool(3)
  for (const worker of workers) worker.emit({ type: 'ready' })
  await pool.open('vectors', new ArrayBuffer(1))
  expect(workers.every(worker => worker.requests.every(r => r.type !== 'extractVectors'))).toBe(true)
  return pool
}
function extraction() {
  const worker = workers.find(w => w.requests.some(r => r.type === 'extractVectors'))!
  const request = worker.requests.find(r => r.type === 'extractVectors')!
  return { worker, request }
}
const result: VectorPage = { pageIndex: 0, segments: new Float32Array([0, 0, 10, 0]), segmentCount: 1, truncated: false,
  stats: { strokePaths: 1, fillPaths: 0, curves: 0, images: 0, imageAreaRatio: 0, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } } }
afterEach(() => { pool?.destroy(); workers.length = 0; vi.unstubAllGlobals() })
describe('vector request pool lifecycle', () => {
  it('requests only explicitly, uses a rendering worker and lower priority, then releases queue accounting', async () => {
    await opened()
    const task = pool.extractVectors({ docId: 'vectors', pageIndex: 0 }), { worker, request } = extraction()
    expect(worker).not.toBe(workers[0])
    expect(request.priority).toBe(4)
    expect(pool.isIdle()).toBe(false)
    worker.emit({ type: 'vectorsExtracted', jobId: request.jobId, page: result })
    expect(await task.promise).toBe(result)
    expect(pool.isIdle()).toBe(true)
  })
  it('cancels before start and discards a raced late response', async () => {
    await opened()
    const task = pool.extractVectors({ docId: 'vectors', pageIndex: 0 }), { worker, request } = extraction()
    const rejected = expect(task.promise).rejects.toThrow('取り消されました')
    task.cancel(); task.cancel()
    await rejected
    expect(worker.requests.filter(r => r.type === 'cancelJobs')).toHaveLength(1)
    worker.emit({ type: 'vectorsExtracted', jobId: request.jobId, page: result })
    expect(pool.isIdle()).toBe(true)
  })
  it('lets already-started synchronous extraction finish', async () => {
    await opened()
    const task = pool.extractVectors({ docId: 'vectors', pageIndex: 0 }), { worker, request } = extraction()
    worker.emit({ type: 'started', jobId: request.jobId }); task.cancel()
    expect(worker.requests.some(r => r.type === 'cancelJobs')).toBe(false)
    worker.emit({ type: 'vectorsExtracted', jobId: request.jobId, page: result })
    expect(await task.promise).toBe(result)
  })
  it('propagates worker errors and queued document closure', async () => {
    await opened()
    const task = pool.extractVectors({ docId: 'vectors', pageIndex: 0 }), { worker, request } = extraction()
    worker.emit({ type: 'error', jobId: request.jobId, message: 'vector failure' })
    await expect(task.promise).rejects.toThrow('vector failure')
    expect(pool.isIdle()).toBe(true)
    const next = pool.extractVectors({ docId: 'vectors', pageIndex: 0 })
    const nextRequest = worker.requests.filter(r => r.type === 'extractVectors').at(-1)!
    pool.close('vectors')
    worker.emit({ type: 'vectorsExtracted', jobId: nextRequest.jobId, cancelled: true })
    await expect(next.promise).rejects.toThrow('取り消されました')
    expect(pool.isIdle()).toBe(true)
  })
  it('rejects an unopened document and settles outstanding requests on destruction', async () => {
    await opened()
    await expect(pool.extractVectors({ docId: 'missing', pageIndex: 0 }).promise).rejects.toThrow('開かれていません')
    const task = pool.extractVectors({ docId: 'vectors', pageIndex: 0 })
    pool.destroy()
    await expect(task.promise).rejects.toThrow('破棄されました')
  })
})
