import { vectorSearchSnapPdf } from './vectorSearchSnapFixtures'
import { classifyPage } from '../src/core/vectorPaths'
import { searchVectorMessage, buildEndpointIndex } from '../src/worker/symbolSearchMessages'
import { findSnap } from '../src/core/snap'
import mupdf from 'mupdf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol'
import { DisplayListCache } from '../src/core/displayListCache'

vi.mock('../src/security/externalSend', () => ({ installWorkerExternalSendGuard: vi.fn() }))
const messages: Array<{ message: WorkerResponse; transfer: Transferable[] }> = []
const workerScope = { onmessage: null as ((event: { data: WorkerRequest }) => void) | null,
  postMessage: (message: WorkerResponse, transfer: Transferable[] = []) => messages.push({ message, transfer }) }
let scheduler: { port1: { onmessage: (() => void) | null } }
let extract: typeof import('../src/worker/vectorExtract').extractVectorPage
beforeAll(async () => {
  vi.stubGlobal('self', workerScope)
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as (() => void) | null }
    port2 = { postMessage() {} }
    constructor() { scheduler = this }
  })
  // Importing the Worker entry installs its message handler on the stubbed scope.
  await import('../src/worker/pdf.worker')
  extract = (await import('../src/worker/vectorExtract')).extractVectorPage
})
afterAll(() => vi.unstubAllGlobals())

function documentWith(contents: string, rotate: 0 | 90 | 180 | 270 = 0) {
  const pdf = new mupdf.PDFDocument(), resources = pdf.newDictionary()
  const page = pdf.addPage([0, 0, 200, 100], rotate, resources, contents)
  pdf.insertPage(-1, page); page.destroy(); resources.destroy()
  return pdf
}
function send(data: WorkerRequest) { workerScope.onmessage!({ data }) }
async function runNext() {
  scheduler.port1.onmessage!()
  // execute() settles through promise finally, with no physical worker/thread.
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('real MuPDF vector device', () => {
  it('extracts transformed re/closed lines, drops tiny segments, and closes fill subpaths', () => {
    const pdf = documentWith('q 2 0 0 3 5 7 cm 1 2 4 5 re S Q 20 20 m 20.01 20 l 20 20 l S 30 30 m 40 30 l 35 40 l f')
    try {
      const result = extract(pdf, 0)
      expect(result.segmentCount).toBe(7)
      expect(Array.from(result.segments.slice(0, 4))).toEqual([7, 87, 15, 87])
      expect(result.stats.strokePaths).toBe(2)
      expect(result.stats.fillPaths).toBe(1)
      expect(result.truncated).toBe(false)
      expect(result.segments.byteLength).toBe(result.segmentCount * 16)
    } finally { pdf.destroy() }
  })
  it.each([0, 90, 180, 270] as const)('uses displayed page coordinates for /Rotate %i, excluding annotations', rotate => {
    const pdf = documentWith('10 20 m 30 20 l S', rotate)
    const page = pdf.loadPage(0)
    try {
      const annotation = page.createAnnotation('Square')
      annotation.setRect([40, 40, 80, 80]); annotation.setColor([1, 0, 0]); annotation.update(); annotation.destroy()
      const matrix = page.getTransform()
      const expected = [10, 20, 30, 20].flatMap((_v, i, values) => i % 2 ? [] : [matrix[0] * values[i] + matrix[2] * values[i + 1] + matrix[4], matrix[1] * values[i] + matrix[3] * values[i + 1] + matrix[5]])
      const result = extract(pdf, 0)
      expect(result.segmentCount).toBe(1)
      expect(Array.from(result.segments)).toEqual(expected)
    } finally { page.destroy(); pdf.destroy() }
  })
  it('flattens cubic curves in displayed coordinates to at most twelve pieces', () => {
    const pdf = documentWith('q 2 0 0 2 10 10 cm 0 0 m 0 50 50 50 50 0 c S Q')
    try {
      const result = extract(pdf, 0)
      expect(result.stats.curves).toBe(1)
      expect(result.segmentCount).toBeGreaterThan(1)
      expect(result.segmentCount).toBeLessThanOrEqual(12)
      expect(Array.from(result.segments.slice(0, 2))).toEqual([10, 90])
      expect(Array.from(result.segments.slice(-2))).toEqual([110, 90])
    } finally { pdf.destroy() }
  })
  it('reuses eligible display-cache lists without destroying them, and bypasses annotated lists', () => {
    const pdf = documentWith('0 0 10 10 re S'), cache = new DisplayListCache(pdf)
    try {
      expect(extract(pdf, 0, cache).segmentCount).toBe(4)
      expect(cache.count).toBe(1)
      expect(extract(pdf, 0, cache).segmentCount).toBe(4)
      const page = pdf.loadPage(0), annotation = page.createAnnotation('Square')
      annotation.setRect([40, 40, 80, 80]); annotation.update(); annotation.destroy(); page.destroy()
      cache.clear()
      cache.get(0) // Deliberately populate an annotated list; extraction must ignore it.
      expect(extract(pdf, 0, cache).segmentCount).toBe(4)
      expect(cache.count).toBe(1)
    } finally { cache.destroy(); pdf.destroy() }
  })
  it('counts image bounding area and fill/stroke glyphs without their geometry or clip geometry', () => {
    const pdf = new mupdf.PDFDocument(), resources = pdf.newDictionary(), fonts = pdf.newDictionary(), images = pdf.newDictionary()
    const font = new mupdf.Font('Helvetica'), fontObject = pdf.addSimpleFont(font)
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 1, 1], false)
    pixmap.clear(128)
    const image = new mupdf.Image(pixmap), imageObject = pdf.addImage(image)
    fonts.put('F0', fontObject); images.put('Im0', imageObject)
    resources.put('Font', fonts); resources.put('XObject', images)
    const page = pdf.addPage([0, 0, 200, 100], 0, resources,
      'q 0 0 200 100 re W n q 200 0 0 100 0 0 cm /Im0 Do Q BT /F0 10 Tf 10 20 Td (ABC) Tj ET BT 1 Tr /F0 10 Tf 10 40 Td (DE) Tj ET Q')
    pdf.insertPage(-1, page)
    try {
      const result = extract(pdf, 0)
      expect(result.segmentCount).toBe(0)
      expect(result.stats.images).toBe(1)
      expect(result.stats.imageAreaRatio).toBeCloseTo(1)
      expect(result.stats.textGlyphs).toBe(5)
    } finally {
      page.destroy(); resources.destroy(); fonts.destroy(); images.destroy(); fontObject.destroy(); imageObject.destroy(); font.destroy(); image.destroy(); pixmap.destroy(); pdf.destroy()
    }
  })
  it('bounds segment storage at 400,000 and reports truncation', () => {
    const pdf = documentWith(`0 0 m ${'1 0 l 0 0 l '.repeat(200_001)} S`)
    try {
      const result = extract(pdf, 0)
      expect(result.segmentCount).toBe(400_000)
      expect(result.truncated).toBe(true)
      expect(result.segments.byteLength).toBe(6_400_000)
    } finally { pdf.destroy() }
  }, 30_000)
  it('prioritizes display rendering, cancels queued extraction, and transfers the array', async () => {
    const pdf = documentWith('0 0 10 10 re S'), buffer = pdf.saveToBuffer('')
    try {
      send({ type: 'open', requestId: 700, docId: 'vectors', bytes: buffer.asUint8Array().slice().buffer as ArrayBuffer })
      await runNext()
      send({ type: 'extractVectors', jobId: 701, docId: 'vectors', pageIndex: 0, priority: 4 })
      // An invalid render reaches the error response without requiring ImageBitmap.
      send({ type: 'render', jobId: 702, docId: 'missing', pageIndex: 0, priority: 0, renderScale: 1, deviceRect: null })
      await runNext()
      expect(messages.some(m => m.message.type === 'error' && m.message.jobId === 702)).toBe(true)
      expect(messages.some(m => m.message.type === 'vectorsExtracted' && m.message.jobId === 701)).toBe(false)
      send({ type: 'cancelJobs', docId: 'vectors', jobIds: [701] })
      expect(messages.at(-1)!.message).toEqual({ type: 'vectorsExtracted', jobId: 701, cancelled: true })
      send({ type: 'extractVectors', jobId: 703, docId: 'vectors', pageIndex: 0, priority: 4 })
      await runNext()
      const response = messages.find(m => m.message.type === 'vectorsExtracted' && m.message.jobId === 703)!
      expect(response.message.type).toBe('vectorsExtracted')
      if (response.message.type === 'vectorsExtracted') {
        expect(response.message.page!.segmentCount).toBe(4)
        expect(response.transfer).toEqual([response.message.page!.segments.buffer])
        const delivered = structuredClone(response.message, { transfer: response.transfer })
        expect(response.message.page!.segments.byteLength).toBe(0)
        expect(delivered.page!.segments.byteLength).toBe(64)
      }
      send({ type: 'close', docId: 'vectors' })
    } finally { buffer.destroy(); pdf.destroy() }
  })
})


it('uses the exact screen fixture: six crossed squares, drawing endpoints and raster fallback', () => {
  for (const raster of [false, true]) {
    const pdf = new mupdf.PDFDocument(Uint8Array.from(vectorSearchSnapPdf(raster)))
    try {
      const page = extract(pdf, 0)
      expect(classifyPage(page)).toBe(raster ? 'raster' : 'vector')
      if (raster) { expect(page.segmentCount).toBe(0); continue }
      const result = searchVectorMessage({ type: 'vector-search', id: 1, segments: page.segments, sampleSegments: page.segments, sampleRect: [49,49,61,61], options: { threshold: .85 } })
      expect(result?.matches).toHaveLength(6)
      const index = buildEndpointIndex({ type: 'endpoints', id: 1, segments: page.segments, bounds: [0,0,500,500] })
      expect(findSnap([100.6,400.4], 2, index)?.point).toEqual([100,400])
    } finally { pdf.destroy() }
  }
})
