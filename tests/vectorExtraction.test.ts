import { vectorSearchSnapPdf } from './vectorSearchSnapFixtures'
import { symbolLabelsPdf } from './symbolLabelFixtures'
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

const mixedContents = '10 20 m 30 20 l S 40 30 10 10 re f '
  + 'BT /F0 10 Tf 10 50 Td (ABC) Tj ET BT 1 Tr /F0 10 Tf 10 70 Td (DE) Tj ET '
  + 'q 10 0 0 10 60 20 cm /Im0 Do Q q 10 0 0 10 80 20 cm /Mask0 Do Q'

function documentWithCallbackResources(contents = mixedContents) {
  const pdf = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica')
  const fontObject = pdf.addSimpleFont(font)
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 1, 1], false)
  pixmap.clear(128)
  const image = new mupdf.Image(pixmap), imageObject = pdf.addImage(image)
  const maskObject = pdf.addStream(Uint8Array.of(0x80), {
    Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ImageMask: true, BitsPerComponent: 1,
  })
  try {
    const page = pdf.addPage([0, 0, 200, 100], 0,
      { Font: { F0: fontObject }, XObject: { Im0: imageObject, Mask0: maskObject } }, contents)
    try { pdf.insertPage(-1, page) }
    finally { page.destroy() }
    return pdf
  } catch (error) {
    pdf.destroy()
    throw error
  } finally {
    maskObject.destroy(); imageObject.destroy(); image.destroy(); pixmap.destroy(); fontObject.destroy(); font.destroy()
  }
}

function trackCallbackDestruction() {
  type Wrapper = { pointer: number; destroy(): void }
  const prototypes: Record<string, Wrapper> = {
    Path: mupdf.Path.prototype, StrokeState: mupdf.StrokeState.prototype,
    ColorSpace: mupdf.ColorSpace.prototype, Text: mupdf.Text.prototype, Image: mupdf.Image.prototype,
  }
  const released: Record<string, Wrapper[]> = Object.fromEntries(Object.keys(prototypes).map(name => [name, []]))
  const spies = Object.entries(prototypes).map(([name, prototype]) => {
    const destroy = prototype.destroy
    return vi.spyOn(prototype, 'destroy').mockImplementation(function(this: Wrapper) {
      released[name].push(this)
      destroy.call(this)
    })
  })
  return {
    released,
    reset: () => { for (const values of Object.values(released)) values.length = 0 },
    restore: () => { for (const spy of spies) spy.mockRestore() },
  }
}

describe('real MuPDF vector device', () => {
  it('extracts labels only on the new explicit request, after display priority, and closes queued requests', async () => {
    send({type:'open',requestId:710,docId:'labels',bytes:new Uint8Array(symbolLabelsPdf()).buffer})
    await runNext()
    expect(messages.some(m=>m.message.type==='labelsExtracted')).toBe(false)
    send({type:'extractLabels',requestId:711,docId:'labels',pageIndex:0})
    send({type:'render',jobId:712,docId:'missing',pageIndex:0,priority:0,renderScale:1,deviceRect:null})
    await runNext()
    expect(messages.some(m=>m.message.type==='labelsExtracted'&&m.message.requestId===711)).toBe(false)
    await runNext()
    const response=messages.find(m=>m.message.type==='labelsExtracted'&&m.message.requestId===711)!.message
    expect(response.type).toBe('labelsExtracted')
    if(response.type==='labelsExtracted') expect(response.labels.map(l=>l.text).sort()).toEqual(['20A','20A','4H','ET','ET','ET','ETG','ETG'])
    send({type:'extractLabels',requestId:713,docId:'labels',pageIndex:0});send({type:'close',docId:'labels'})
    expect(messages.some(m=>m.message.type==='error'&&m.message.requestId===713)).toBe(true)
  })
  it.each([false, true])('destroys every callback wrapper before returning (annotated temporary list: %s)', annotated => {
    const pdf = documentWithCallbackResources(), cache = new DisplayListCache(pdf)
    if (annotated) {
      const page = pdf.loadPage(0), annotation = page.createAnnotation('Square')
      try { annotation.setRect([100, 40, 120, 60]); annotation.update() }
      finally { annotation.destroy(); page.destroy() }
    }
    // Prebuild the cache so only extraction callback wrappers are counted.
    const cachedList = cache.get(0), get = vi.spyOn(cache, 'get')
    const tracked = trackCallbackDestruction()
    const expectedCounts: Record<string, number> = { Path: 2, StrokeState: 2, ColorSpace: 5, Text: 2, Image: 2 }
    const assertReleased = () => {
      for (const [name, values] of Object.entries(tracked.released)) {
        expect(values).toHaveLength(expectedCounts[name])
        expect(new Set(values).size).toBe(values.length)
        for (const value of values) expect(value.pointer).toBe(0)
      }
    }
    const destroyList = mupdf.DisplayList.prototype.destroy
    const listSpy = vi.spyOn(mupdf.DisplayList.prototype, 'destroy').mockImplementation(function(this: import('mupdf').DisplayList) {
      // Packed paths must be released before a temporary list is destroyed.
      assertReleased()
      destroyList.call(this)
    })
    try {
      for (let run = 0; run < 2; run++) {
        tracked.reset()
        const result = extract(pdf, 0, cache)
        expect(result.segmentCount).toBe(5)
        expect(Array.from(result.segments)).toEqual([
          10, 80, 30, 80, 40, 70, 50, 70, 50, 70, 50, 60,
          50, 60, 40, 60, 40, 60, 40, 70,
        ])
        expect(result.stats.strokePaths).toBe(1)
        expect(result.stats.fillPaths).toBe(1)
        expect(result.stats.textGlyphs).toBe(5)
        expect(result.stats.images).toBe(2)
        expect(result.stats.imageAreaRatio).toBeCloseTo(.01)
        expect(tracked.released.Path).toHaveLength(result.stats.strokePaths + result.stats.fillPaths)
        expect(tracked.released.StrokeState).toHaveLength(result.stats.strokePaths + 1) // strokeText
        expect(tracked.released.ColorSpace).toHaveLength(result.stats.strokePaths + result.stats.fillPaths + 3) // both text callbacks + mask
        expect(tracked.released.Text).toHaveLength(2)
        expect(tracked.released.Image).toHaveLength(result.stats.images)
        assertReleased()
        expect(cache.count).toBe(1)
        expect(cachedList.pointer).not.toBe(0)
      }
      expect(get).toHaveBeenCalledTimes(annotated ? 0 : 2)
      expect(listSpy).toHaveBeenCalledTimes(annotated ? 2 : 0)
    } finally {
      listSpy.mockRestore(); tracked.restore(); get.mockRestore(); cache.destroy(); pdf.destroy()
    }
  })
  it.each([
    { name: 'strokePath', contents: '10 20 m 30 20 l S', path: true, stroke: true },
    { name: 'fillPath', contents: '40 30 10 10 re f', path: true, stroke: false },
    { name: 'fillText', contents: 'BT /F0 10 Tf 10 50 Td (ABC) Tj ET', path: false, stroke: false },
    { name: 'strokeText', contents: 'BT 1 Tr /F0 10 Tf 10 70 Td (DE) Tj ET', path: false, stroke: true },
  ])('destroys callback wrappers when $name walking throws', ({ contents, path, stroke }) => {
    const pdf = documentWithCallbackResources(contents), cache = new DisplayListCache(pdf)
    const cachedList = cache.get(0), tracked = trackCallbackDestruction()
    const failure = new Error('injected walk failure')
    const walk = vi.spyOn(path ? mupdf.Path.prototype : mupdf.Text.prototype, 'walk')
      .mockImplementation(() => { throw failure })
    try {
      expect(() => extract(pdf, 0, cache)).toThrow(failure)
      expect(tracked.released.Path).toHaveLength(path ? 1 : 0)
      expect(tracked.released.Text).toHaveLength(path ? 0 : 1)
      expect(tracked.released.StrokeState).toHaveLength(stroke ? 1 : 0)
      expect(tracked.released.ColorSpace).toHaveLength(1)
      for (const values of Object.values(tracked.released)) {
        for (const value of values) expect(value.pointer).toBe(0)
      }
      expect(cachedList.pointer).not.toBe(0)
      walk.mockRestore()
      expect(extract(pdf, 0, cache).stats[path ? (stroke ? 'strokePaths' : 'fillPaths') : 'textGlyphs']).toBeGreaterThan(0)
    } finally {
      walk.mockRestore(); tracked.restore(); cache.destroy(); pdf.destroy()
    }
  })
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
      expect(result.widths).toHaveLength(result.segmentCount)
      expect(Array.from(result.widths.slice(0, 4))).toEqual(Array(4).fill(Math.fround(Math.sqrt(6))))
      expect(Array.from(result.widths.slice(4))).toEqual([0, 0, 0])
    } finally { pdf.destroy() }
  })
  it.each(['1 g', '1 1 1 rg', '0 0 0 0 k', '.95 g', '.95 .95 .95 rg', '.05 .05 .05 .05 k'])('omits white fill %s and releases its callback wrappers', color => {
    const pdf = documentWith(`${color} 10 10 20 20 re f`), tracked = trackCallbackDestruction()
    try {
      const page = extract(pdf, 0)
      expect(page.segmentCount).toBe(0); expect(page.widths).toHaveLength(0)
      expect(page.stats).toMatchObject({ fillPaths: 1, whiteFills: 1 })
      expect(classifyPage(page)).toBe('empty')
      expect(tracked.released.Path).toHaveLength(1); expect(tracked.released.ColorSpace).toHaveLength(1)
      for (const values of Object.values(tracked.released)) for (const value of values) expect(value.pointer).toBe(0)
    } finally { tracked.restore(); pdf.destroy() }
  })
  it.each(['.94 g', '.94 1 1 rg', '0 0 .06 0 k'])('keeps nonwhite fill %s with zero widths', color => {
    const pdf = documentWith(`${color} 10 10 20 20 re f`)
    try {
      const page = extract(pdf, 0)
      expect(page.segmentCount).toBe(4); expect(page.stats.whiteFills).toBe(0)
      expect(Array.from(page.widths)).toEqual([0, 0, 0, 0])
    } finally { pdf.destroy() }
  })
  it('scales stroke widths by the absolute CTM determinant, including reflection', () => {
    const pdf = documentWith('q 2 0 1 -3 0 100 cm .7 w 1 2 4 5 re S Q .42 w 30 30 m 40 30 l S')
    try {
      const page = extract(pdf, 0)
      expect(page.widths).toHaveLength(page.segmentCount)
      expect(Array.from(page.widths.slice(0, 4))).toEqual(Array(4).fill(Math.fround(.7 * Math.sqrt(6))))
      expect(page.widths[4]).toBeCloseTo(.42)
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
      expect(result.widths).toHaveLength(400_000)
      expect(result.widths.byteLength).toBe(1_600_000)
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
        expect(response.transfer).toEqual([response.message.page!.segments.buffer, response.message.page!.widths.buffer])
        const delivered = structuredClone(response.message, { transfer: response.transfer })
        expect(response.message.page!.segments.byteLength).toBe(0)
        expect(delivered.page!.segments.byteLength).toBe(64)
        expect(response.message.page!.widths.byteLength).toBe(0)
        expect(delivered.page!.widths.byteLength).toBe(16)
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
      const result = searchVectorMessage({ type: 'vector-search', id: 1, segments: page.segments, sampleSegments: page.segments, sampleWidths: page.widths, sampleRect: [49,49,61,61], options: { threshold: .85 } })
      expect(result?.matches).toHaveLength(6)
      const index = buildEndpointIndex({ type: 'endpoints', id: 1, segments: page.segments, bounds: [0,0,500,500] })
      expect(findSnap([100.6,400.4], 2, index)?.point).toEqual([100,400])
    } finally { pdf.destroy() }
  }
})

// Characterization of d1ddc1c, not the desired fill/hole recognition contract.
// See docs/spec/SPEC-S04-線の見本は塗りの輪郭と照合しない.md before changing these expectations.
it('records outline, solid fill, white overlay and even-odd hole through search and snap', () => {
  const pdf = documentWith('q 1 0 0 -1 0 100 cm 0 G 0 g .8 w '
    + '20 20 10 10 re S 60 20 10 10 re f '
    + '100 20 10 10 re f 1 g 103 23 4 4 re f 0 g '
    + '140 20 10 10 re 143 23 4 4 re f* Q')
  try {
    const page = extract(pdf, 0), original = page.segments.slice(), originalWidths = page.widths.slice()
    expect(classifyPage(page)).toBe('vector')
    expect(page.stats).toMatchObject({ strokePaths: 1, fillPaths: 4, whiteFills: 1 })
    expect(page.segmentCount).toBe(20)
    expect(page.widths.length).toBe(page.segmentCount)
    expect(Array.from(page.widths)).toEqual([...Array(4).fill(Math.fround(.8)), ...Array(16).fill(0)])
    const result = searchVectorMessage({ type: 'vector-search', id: 1, segments: page.segments,
      segmentWidths: page.widths, sampleSegments: page.segments, sampleWidths: page.widths,
      sampleRect: [19,19,31,31], options: { threshold: .9 } })!
    // SPEC-S04: a stroked sample matches stroked lines only, not fill outlines.
    expect(result.matches.map(m => m.center)).toEqual([[25,25]])
    expect(result.matches[0].score).toBeGreaterThan(.999)
    // A fill-outline sample still matches every drawn square. The hole adds extra geometry.
    const filled = searchVectorMessage({ type: 'vector-search', id: 2, segments: page.segments,
      segmentWidths: page.widths, sampleSegments: page.segments, sampleWidths: page.widths,
      sampleRect: [59,19,71,31], options: { threshold: .9 } })!
    expect(filled.matches.map(m => m.center).sort((a,b) => a[0]-b[0])).toEqual([[25,25],[65,25],[105,25],[145,25]])
    expect(filled.matches.every(m => m.score > .999 && m.angle === 0)).toBe(true)
    expect(filled.matches.filter(m => m.center[0] < 140).every(m => m.extra === 0)).toBe(true)
    expect(filled.matches.find(m => m.center[0] === 145)!.extra).toBeCloseTo(16 / 56)
    const index = buildEndpointIndex({ type: 'endpoints', id: 1, segments: page.segments, bounds: [0,0,200,100] })
    expect(index.ids).toHaveLength(20) // 16 outer corners + 4 even-odd hole corners.
    expect(findSnap([143.1,23.1], .5, index)?.point).toEqual([143,23])
    expect(findSnap([103.1,23.1], .5, index)).toBeNull() // White overlay supplies no endpoints.
    expect(page.segments).toEqual(original); expect(page.widths).toEqual(originalWidths)
  } finally { pdf.destroy() }
})
