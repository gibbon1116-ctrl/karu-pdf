import { deflateSync } from 'node:zlib'
import mupdf, { type PDFDocument, type PDFObject, type Rect } from 'mupdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareSlimPages, downsampleImages, slimDocument } from '../src/core/slim'
import { openDocument } from '../src/core/mupdfDoc'
import { prepareDocumentOutput } from '../src/core/output'
import { protectPdf } from '../src/core/protectedPdf'
import { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { SlimOutputRequest, WorkerRequest, WorkerResponse } from '../src/worker/protocol'

vi.mock('../src/client/createPdfWorker', () => ({ createPdfWorker: () => new Worker('test-worker') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function saved(doc: PDFDocument, options = 'compress'): Uint8Array {
  const buffer = doc.saveToBuffer(options)
  try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
}
function addPage(doc: PDFDocument, bounds: Rect, resources: object = {}, contents = ''): void {
  const page = doc.addPage(bounds, 0, resources, contents)
  try { doc.insertPage(-1, page) } finally { page.destroy() }
}
function gradient(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels[y * width + x] = Math.round(50 + 150 * x / width + 15 * Math.sin(y / 40))
  }
  return pixels
}
function image(doc: PDFDocument, width = 800, height = 600, extra: object = {}, data = gradient(width, height)): PDFObject {
  return doc.addRawStream(data, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
    BitsPerComponent: 8, ColorSpace: 'DeviceGray', ...extra })
}
function imagePage(doc: PDFDocument, ref: PDFObject, bounds: Rect = [0, 0, 144, 108]): void {
  addPage(doc, bounds, { XObject: { Scan: ref } }, `q ${bounds[2]} 0 0 ${bounds[3]} 0 0 cm /Scan Do Q`)
}
function pageImage(doc: PDFDocument, index = 0): PDFObject {
  const page = doc.findPage(index)
  try { return page.get('Resources', 'XObject', 'Scan') } finally { page.destroy() }
}
function dimensions(ref: PDFObject): number[] {
  return ['Width', 'Height'].map(key => {
    const value = ref.get(key)
    try { return value.asNumber() } finally { value.destroy() }
  })
}
function vectors(contents: string[] = ['0 0 20 20 re f', '']): PDFDocument {
  const doc = new mupdf.PDFDocument()
  for (const content of contents) addPage(doc, [0, 0, 144, 108], {}, content)
  return doc
}

describe('slim output images', () => {
  it('halves a 400 dpi A3 landscape scan at 200 dpi, keeping page count and size', () => {
    const doc = new mupdf.PDFDocument(), bounds: Rect = [0, 0, 1190.55, 841.89]
    const width = Math.round(bounds[2] / 72 * 400), height = Math.round(bounds[3] / 72 * 400)
    const ref = image(doc, width, height)
    try {
      imagePage(doc, ref, bounds)
      const result = slimDocument(doc, { imageDpi: 200, deepClean: false })
      expect(result.stats).toMatchObject({ imagesChecked: 1, imagesReduced: 1, imagesSkipped: 0, deepClean: 'off' })
      const output = new mupdf.PDFDocument(result.bytes)
      try {
        expect(output.countPages()).toBe(1)
        const reduced = pageImage(output), filter = reduced.get('Filter'), page = output.loadPage(0)
        try {
          const size = dimensions(reduced)
          expect(Math.abs(size[0] - width / 2)).toBeLessThanOrEqual(1)
          expect(Math.abs(size[1] - height / 2)).toBeLessThanOrEqual(1)
          expect(filter.asName()).toBe('DCTDecode')
          page.getBounds().forEach((value, index) => expect(value).toBeCloseTo(bounds[index], 2))
        } finally { page.destroy(); filter.destroy(); reduced.destroy() }
      } finally { output.destroy() }
    } finally { ref.destroy(); doc.destroy() }
  }, 30_000)

  it('replaces a shared image once and keeps both pages pointing to that object', () => {
    const doc = new mupdf.PDFDocument(), ref = image(doc)
    try {
      imagePage(doc, ref); imagePage(doc, ref)
      expect(downsampleImages(doc, 200)).toEqual({ imagesChecked: 1, imagesReduced: 1, imagesSkipped: 0 })
      const a = pageImage(doc), b = pageImage(doc)
      try {
        expect(a.asIndirect()).toBe(b.asIndirect())
        expect(dimensions(a)).toEqual([400, 300])
        expect(dimensions(b)).toEqual([400, 300])
      } finally { a.destroy(); b.destroy() }
    } finally { ref.destroy(); doc.destroy() }
  })

  it('finds nested shared Forms with cycles and uses the largest page, even when visited last', () => {
    const doc = new mupdf.PDFDocument(), ref = image(doc)
    const inner = doc.addStream('/Scan Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Scan: ref } } })
    const outer = doc.addStream('/Inner Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Inner: inner } } })
    try {
      const xobjects = inner.get('Resources', 'XObject')
      try { xobjects.put('Cycle', outer) } finally { xobjects.destroy() }
      addPage(doc, [0, 0, 72, 54], { XObject: { Outer: outer } })
      addPage(doc, [0, 0, 288, 216], { XObject: { Outer: outer } })
      expect(downsampleImages(doc, 200)).toMatchObject({ imagesChecked: 1, imagesReduced: 0 })
      expect(dimensions(ref)).toEqual([800, 600])
    } finally { outer.destroy(); inner.destroy(); ref.destroy(); doc.destroy() }
  })

  it.each([
    { BitsPerComponent: 1 }, { SMask: {} }, { Mask: [0, 0] }, { ImageMask: true },
    { Decode: [0, 1] }, { Filter: 'JBIG2Decode' }, { Filter: ['FlateDecode', 'CCITTFaxDecode'] },
    { Width: 100_001, Height: 1000 },
  ])('does not touch an excluded image: %j', extra => {
    const doc = new mupdf.PDFDocument(), ref = image(doc, 800, 600, extra)
    try {
      imagePage(doc, ref)
      const raw = ref.readRawStream()
      let before: Uint8Array
      try { before = raw.asUint8Array().slice() } finally { raw.destroy() }
      expect(downsampleImages(doc, 200)).toEqual({ imagesChecked: 1, imagesReduced: 0, imagesSkipped: 1 })
      const after = ref.readRawStream()
      // Compare bytes directly: toEqual on a 1.4 MB array is slow enough to time out under load.
      try { expect(Buffer.from(after.asUint8Array()).equals(Buffer.from(before))).toBe(true) } finally { after.destroy() }
    } finally { ref.destroy(); doc.destroy() }
  })

  it.each([
    { ColorSpace: ['Indexed', 'DeviceRGB', 1, '(\x00\x00\x00\xff\xff\xff)'] },
    { ColorSpace: 'DeviceCMYK' },
  ])('skips indexed and unsupported component counts: %j', extra => {
    const doc = new mupdf.PDFDocument(), ref = image(doc, 800, 600, extra, new Uint8Array(800 * 600 * 4))
    try {
      imagePage(doc, ref)
      expect(downsampleImages(doc, 200)).toMatchObject({ imagesReduced: 0, imagesSkipped: 1 })
    } finally { ref.destroy(); doc.destroy() }
  })

  it('keeps a thin-line image when JPEG would exceed 90% of its compressed stream', () => {
    const doc = new mupdf.PDFDocument(), pixels = new Uint8Array(800 * 600).fill(255)
    for (let y = 0; y < 600; y++) pixels[y * 800 + 400] = 0
    const compressed = deflateSync(pixels), ref = image(doc, 800, 600, { Filter: 'FlateDecode' }, compressed)
    try {
      imagePage(doc, ref)
      expect(downsampleImages(doc, 200)).toEqual({ imagesChecked: 1, imagesReduced: 0, imagesSkipped: 0 })
      expect(dimensions(ref)).toEqual([800, 600])
      const filter = ref.get('Filter')
      try { expect(filter.asName()).toBe('FlateDecode') } finally { filter.destroy() }
    } finally { ref.destroy(); doc.destroy() }
  })

  it.each([200, 230])('does not reduce a scan at %i dpi (at or below the 1.15 threshold)', dpi => {
    const doc = new mupdf.PDFDocument(), ref = image(doc, dpi, 150)
    try {
      imagePage(doc, ref, [0, 0, 72, 54])
      expect(downsampleImages(doc, 200)).toMatchObject({ imagesReduced: 0, imagesSkipped: 0 })
      expect(dimensions(ref)).toEqual([dpi, 150])
    } finally { ref.destroy(); doc.destroy() }
  })
})

describe('slim metadata, comparison and protection', () => {
  it('keeps FreeText and Karu data editable after reopening and saving again', () => {
    const doc = vectors(), page = doc.loadPage(0), note = page.createAnnotation('FreeText')
    const trailer = doc.getTrailer(), root = trailer.get('Root'), object = note.getObject()
    try {
      note.setRect([10, 10, 130, 45]); note.setContents('Karu note')
      note.setDefaultAppearance('Helv', 12, [0, 0, 0]); note.update()
      object.put('KaruIssue', { Number: 7, State: 'open' })
      root.put('KaruQuantity', { Value: 42 }); root.put('KaruReview', '(keep me)')
      const result = slimDocument(doc, { imageDpi: 'keep', deepClean: false })
      const output = new mupdf.PDFDocument(result.bytes)
      try {
        const t = output.getTrailer(), r = t.get('Root'), data = r.get('KaruQuantity', 'Value'), review = r.get('KaruReview')
        try { expect(data.asNumber()).toBe(42); expect(review.asString()).toBe('keep me') }
        finally { review.destroy(); data.destroy(); r.destroy(); t.destroy() }
        const p = output.loadPage(0), annotations = p.getAnnotations()
        try {
          const annotation = annotations.find(item => item.getType() === 'FreeText')!
          expect(annotation.getContents()).toBe('Karu note')
          const o = annotation.getObject(), issue = o.get('KaruIssue', 'Number')
          try { expect(issue.asNumber()).toBe(7) } finally { issue.destroy(); o.destroy() }
          annotation.setContents('Still editable'); annotation.update()
          const again = new mupdf.PDFDocument(saved(output)), againPage = again.loadPage(0), notes = againPage.getAnnotations()
          try { expect(notes.find(item => item.getType() === 'FreeText')?.getContents()).toBe('Still editable') }
          finally { notes.forEach(item => item.destroy()); againPage.destroy(); again.destroy() }
        } finally { annotations.forEach(item => item.destroy()); p.destroy() }
      } finally { output.destroy() }
    } finally { object.destroy(); root.destroy(); trailer.destroy(); note.destroy(); page.destroy(); doc.destroy() }
  })

  it('returns differing 1-based page numbers and reports every page', () => {
    const a = vectors(['', '', '']), b = vectors(['0 0 40 40 re f', '', '0 0 40 40 re f']), progress = vi.fn()
    try {
      expect(compareSlimPages(a, b, progress)).toEqual([1, 3])
      expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
      expect(compareSlimPages(a, a)).toEqual([])
    } finally { a.destroy(); b.destroy() }
  })

  it('applies the strict 32-level and 20-pixel minimum comparison thresholds', () => {
    const a = vectors(['']), b = vectors([''])
    const before = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 100, 100], false)
    const after = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 100, 100], false)
    before.clear(255); after.clear(255)
    const fakePage = (pixmap: typeof before) => ({ toPixmap: () => ({ ...pixmap,
      getPixels: () => pixmap.getPixels(), getWidth: () => 100, getHeight: () => 100,
      getX: () => 0, getY: () => 0, destroy: () => undefined }), destroy: () => undefined })
    vi.spyOn(a, 'loadPage').mockReturnValue(fakePage(before) as unknown as ReturnType<PDFDocument['loadPage']>)
    vi.spyOn(b, 'loadPage').mockReturnValue(fakePage(after) as unknown as ReturnType<PDFDocument['loadPage']>)
    try {
      after.getPixels().fill(223)
      expect(compareSlimPages(a, b)).toEqual([])
      after.clear(255); after.getPixels().fill(222, 0, 20)
      expect(compareSlimPages(a, b)).toEqual([])
      after.getPixels()[20] = 222
      expect(compareSlimPages(a, b)).toEqual([1])
    } finally { before.destroy(); after.destroy(); a.destroy(); b.destroy() }
  })

  it.each(['identical', 'changed', 'larger'] as const)('selects a cleaned candidate only when safe and no larger: %s', mode => {
    const doc = vectors(), different = vectors(['0 0 100 100 re f', ''])
    const altered = saved(different), nativeSave = mupdf.PDFDocument.prototype.saveToBuffer
    let standard: Uint8Array | undefined
    vi.spyOn(mupdf.PDFDocument.prototype, 'saveToBuffer').mockImplementation(function (this: PDFDocument, options: unknown) {
      if (typeof options === 'string' && options.includes(',clean,sanitize')) {
        const candidate = mode === 'changed' ? altered : standard!
        return new mupdf.Buffer(mode === 'larger' ? new Uint8Array([...candidate, ...new Uint8Array(4096).fill(32)]) : candidate)
      }
      const result = nativeSave.call(this, options)
      standard = result.asUint8Array().slice()
      return result
    })
    try {
      const result = slimDocument(doc, { imageDpi: 'keep', deepClean: true })
      expect(result.stats.deepClean).toBe(mode === 'identical' ? 'used' : 'rejected')
      expect(result.stats.rejectedPages).toEqual(mode === 'changed' ? [1] : [])
      expect(result.bytes).toEqual(standard)
    } finally { doc.destroy(); different.destroy() }
  })

  it('continues standard compression if font subsetting fails', () => {
    const doc = vectors()
    vi.spyOn(doc, 'subsetFonts').mockImplementation(() => { throw new Error('subset failed') })
    try { expect(slimDocument(doc, { imageDpi: 'keep', deepClean: false }).stats.fontsSubset).toBe(false) }
    finally { doc.destroy() }
  })

  it.each([false, true])('requires the original password after preparing edits and slimming (deep=%s)', deepClean => {
    const source = vectors(), password = 'Slim-test-7'
    try {
      const protectedBytes = protectPdf(saved(source), password)
      const prepared = prepareDocumentOutput(protectedBytes, [
        { kind: 'createRedact', pageIndex: 0, rect: [10, 10, 40, 40], quads: null },
      ], {}, false, password)
      const opened = openDocument(prepared.bytes, false, password)
      try {
        const result = slimDocument(opened.document.asPDF()!, { imageDpi: 'keep', deepClean })
        const locked = new mupdf.PDFDocument(result.bytes)
        try {
          expect(locked.needsPassword()).toBe(true)
          expect(locked.authenticatePassword('wrong')).toBe(0)
          expect(locked.authenticatePassword(password)).not.toBe(0)
          expect(locked.countPages()).toBe(2)
          const page = locked.loadPage(0), annotations = page.getAnnotations()
          try { expect(annotations.some(annotation => annotation.getType() === 'Redact')).toBe(true) }
          finally { annotations.forEach(annotation => annotation.destroy()); page.destroy() }
        } finally { locked.destroy() }
      } finally { opened.document.destroy() }
    } finally { source.destroy() }
  })
})

class SlimWorker {
  static instance: SlimWorker
  request?: SlimOutputRequest
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null
  terminate() {}
  constructor() { SlimWorker.instance = this; queueMicrotask(() => this.receive({ type: 'ready' })) }
  postMessage(message: WorkerRequest) { if (message.type === 'slimOutput') this.request = message }
  receive(data: WorkerResponse) { this.onmessage?.({ data }) }
}

it('forwards comparison progress, rejects cancellation immediately, and drops late output', async () => {
  vi.stubGlobal('Worker', SlimWorker)
  const pool = new PdfWorkerPool(1), signal = new AbortController(), progress = vi.fn()
  try {
    const pending = pool.slimOutput('source', [], { imageDpi: 'keep', deepClean: true }, { signal: signal.signal, onProgress: progress })
    const worker = SlimWorker.instance, requestId = worker.request!.requestId
    worker.receive({ type: 'slimProgress', requestId, completed: 1, total: 2 })
    expect(progress).toHaveBeenCalledWith(1, 2)
    signal.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    worker.receive({ type: 'slimProgress', requestId, completed: 2, total: 2 })
    worker.receive({ type: 'slimOutputPrepared', requestId, bytes: new ArrayBuffer(10), sourceBytes: 100, ms: 0,
      stats: { imagesChecked: 0, imagesReduced: 0, imagesSkipped: 0, fontsSubset: true, deepClean: 'used', rejectedPages: [] },
      unsupportedCharacters: [], errors: [] })
    expect(progress).toHaveBeenCalledTimes(1)
  } finally { pool.destroy() }
})
