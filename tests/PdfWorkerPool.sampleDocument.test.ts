import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol'

vi.mock('../src/client/createPdfWorker', () => ({ createPdfWorker: () => new Worker('test-worker') }))

class ManualWorker {
  static instances: ManualWorker[] = []
  documents = new Set<string>()
  holdExports = false
  exports: Array<() => void> = []
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn((message: WorkerRequest) => {
    if (message.type === 'open') {
      this.documents.add(message.docId)
      queueMicrotask(() => this.receive({ type: 'opened', requestId: message.requestId,
        pageCount: 1, pageSizes: [{ width: 200, height: 200 }], openMs: 0, sizesMs: 0 }))
    } else if (message.type === 'close') {
      this.documents.delete(message.docId)
    } else if (message.type === 'exportBytes') {
      const respond = () => this.receive({ type: 'bytesExported', requestId: message.requestId, bytes: new ArrayBuffer(1) })
      if (this.holdExports) this.exports.push(respond)
      else queueMicrotask(respond)
    }
  })
  constructor() {
    ManualWorker.instances.push(this)
    queueMicrotask(() => this.receive({ type: 'ready' }))
  }
  receive(data: WorkerResponse) { this.onmessage?.({ data }) }
}

async function setup(workers = 3) {
  ManualWorker.instances = []
  vi.stubGlobal('Worker', ManualWorker)
  const pool = new PdfWorkerPool(workers)
  await pool.open('source', new ArrayBuffer(1))
  await pool.open('unrelated', new ArrayBuffer(1))
  await pool.open('target', new ArrayBuffer(1))
  return pool
}

afterEach(() => vi.unstubAllGlobals())

describe('PdfWorkerPool explicit sample document preparation', () => {
  it('loads every render slot, including an assigned sample slot, while retaining the active document', async () => {
    const pool = await setup()
    try {
      const assigned = pool.workerIndexForPage('source', 0)
      expect(ManualWorker.instances[assigned].documents.has('source')).toBe(false)
      await pool.ensureRenderDocument('source')
      for (const worker of ManualWorker.instances.slice(1)) {
        expect([...worker.documents].sort()).toEqual(['source', 'target'])
      }
      expect(ManualWorker.instances[assigned].documents.has('source')).toBe(true)
      const primary = ManualWorker.instances[0]
      const exports = primary.postMessage.mock.calls.filter(([message]) => message.type === 'exportBytes').length
      await pool.ensureRenderDocument('source')
      expect(primary.postMessage.mock.calls.filter(([message]) => message.type === 'exportBytes')).toHaveLength(exports)

      // If preparation changed activeDocId, this would evict target instead of source.
      await pool.ensureRenderDocument('unrelated')
      for (const worker of ManualWorker.instances.slice(1)) {
        expect([...worker.documents].sort()).toEqual(['target', 'unrelated'])
      }
    } finally { pool.destroy() }
  })

  it('does not reopen a sample closed while its bytes were being exported', async () => {
    const pool = await setup()
    try {
      const primary = ManualWorker.instances[0]
      primary.holdExports = true
      const preparing = pool.ensureRenderDocument('source')
      const rejected = expect(preparing).rejects.toThrow('閉じられました')
      await vi.waitFor(() => expect(primary.exports).toHaveLength(2))
      pool.close('source')
      primary.exports.splice(0).forEach(respond => respond())
      await rejected
      for (const worker of ManualWorker.instances) expect(worker.documents.has('source')).toBe(false)
    } finally { pool.destroy() }
  })

  it('rejects a closed sample before requesting any export', async () => {
    const pool = await setup()
    try {
      pool.close('source')
      const primary = ManualWorker.instances[0]
      primary.postMessage.mockClear()
      await expect(pool.ensureRenderDocument('source')).rejects.toThrow('開かれていません')
      expect(primary.postMessage).not.toHaveBeenCalled()
    } finally { pool.destroy() }
  })

  it('uses the already open primary document with a single Worker', async () => {
    const pool = await setup(1)
    try {
      const primary = ManualWorker.instances[0]
      primary.postMessage.mockClear()
      await pool.ensureRenderDocument('source')
      expect(primary.postMessage).not.toHaveBeenCalled()
      expect(primary.documents.has('source')).toBe(true)
    } finally { pool.destroy() }
  })
})
