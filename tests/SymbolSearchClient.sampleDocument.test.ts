import { afterEach, describe, expect, it, vi } from 'vitest'
import { SymbolSearchClient } from '../src/client/SymbolSearchClient'
import { vectorWorkerTask, type CachedVectorPage, type VectorCache } from '../src/client/VectorCache'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { Rect } from '../src/core/annotations'

vi.mock('../src/client/VectorCache', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/VectorCache')>(),
  vectorWorkerTask: vi.fn(),
}))

const rect: Rect = [10, 10, 30, 30]
const request = { docId: 'target', sampleDocId: 'source', pageIndex: 0, samplePageIndex: 0,
  sampleRect: rect, searchRect: [0, 0, 200, 200] as Rect, shapeCheck: true, verify: false }

function pageData(kind: 'vector' | 'raster', x: number): CachedVectorPage {
  return { kind, pageIndex: 0, segments: new Float32Array([x, 10, x + 10, 10, x + 10, 10, x + 10, 20]),
    widths: new Float32Array([.4, .4]), segmentCount: 2, truncated: false,
    stats: { strokePaths: 2, fillPaths: 0, whiteFills: 0, curves: 0, images: kind === 'raster' ? 1 : 0,
      imageAreaRatio: kind === 'raster' ? 1 : 0, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } } }
}

function setup(kind: 'vector' | 'raster' = 'vector') {
  const sourcePage = pageData(kind, 10), targetPage = pageData(kind, 80)
  const source = { get: vi.fn(async () => sourcePage) }
  const target = { get: vi.fn(async () => targetPage) }
  const pool = {
    ensureRenderDocument: vi.fn(async (_docId: string): Promise<void> => undefined),
    renderSearchImage: vi.fn((_options: { docId: string }) => ({ cancel: vi.fn(),
      promise: Promise.resolve({ width: 24, height: 24, gray: new Uint8Array(24 * 24) }) })),
    extractVectors: vi.fn(({ docId }: { docId: string }) => ({ cancel: vi.fn(),
      promise: Promise.resolve(docId === 'source' ? sourcePage : targetPage) })),
  }
  const cacheFor = vi.fn((docId: string) => (docId === 'source' ? source : target) as unknown as VectorCache)
  return { pool, source, target, sourcePage, targetPage, cacheFor }
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('SymbolSearchClient sample document routing', () => {
  it.each([true, false])('uses document-owned vectors and only reuses a same-document page (other PDF: %s)', async otherDocument => {
    const { pool, source, target, sourcePage, targetPage, cacheFor } = setup()
    vi.mocked(vectorWorkerTask).mockRejectedValue(new Error('stop after routing'))
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool, undefined, cacheFor)
    try {
      await expect(client.search({ ...request, sampleDocId: otherDocument ? 'source' : undefined }).promise).rejects.toThrow('stop after routing')
      const message = vi.mocked(vectorWorkerTask).mock.calls[0][0]
      expect(message).toMatchObject({ type: 'vector-search', features: { samePage: !otherDocument } })
      if (message.type !== 'vector-search') throw new Error('expected vector search')
      expect(message.segments).toBe(targetPage.segments)
      expect(message.sampleSegments).toBe(otherDocument ? sourcePage.segments : targetPage.segments)
      expect(target.get).toHaveBeenCalledTimes(1)
      expect(source.get).toHaveBeenCalledTimes(otherDocument ? 1 : 0)
      if (otherDocument) expect(pool.ensureRenderDocument).toHaveBeenCalledWith('source')
      else expect(pool.ensureRenderDocument).not.toHaveBeenCalled()
    } finally { client.dispose() }
  })

  it('creates separate client-owned caches when no document caches are supplied', async () => {
    const { pool } = setup()
    vi.mocked(vectorWorkerTask).mockRejectedValue(new Error('stop after routing'))
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
    try {
      await expect(client.search(request).promise).rejects.toThrow('stop after routing')
      expect(pool.extractVectors.mock.calls.map(([options]) => options.docId)).toEqual(['source', 'target'])
    } finally { client.dispose() }
  })

  it('renders the target crop and the image template from their respective documents on every search', async () => {
    vi.stubGlobal('Worker', class {
      postMessage = vi.fn()
      terminate = vi.fn()
    })
    const { pool, cacheFor } = setup('raster')
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool, undefined, cacheFor)
    try {
      for (let index = 0; index < 2; index++) {
        const task = client.search(request)
        const rejected = expect(task.promise).rejects.toThrow('cancelled')
        await vi.waitFor(() => expect(pool.renderSearchImage).toHaveBeenCalledTimes((index + 1) * 2))
        expect(pool.renderSearchImage.mock.calls.slice(index * 2).map(([options]) => options.docId)).toEqual(['target', 'source'])
        task.cancel()
        await rejected
      }
      expect(pool.ensureRenderDocument).toHaveBeenCalledTimes(2)
    } finally { client.dispose() }
  })

  it('discards a late document preparation after cancellation', async () => {
    const { pool, source, target, cacheFor } = setup()
    let finish!: () => void
    pool.ensureRenderDocument.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool, undefined, cacheFor)
    try {
      const task = client.search(request)
      const rejected = expect(task.promise).rejects.toThrow('cancelled')
      task.cancel()
      await rejected
      finish()
      await Promise.resolve()
      expect(source.get).not.toHaveBeenCalled()
      expect(target.get).not.toHaveBeenCalled()
      expect(pool.renderSearchImage).not.toHaveBeenCalled()
    } finally { client.dispose() }
  })
})
