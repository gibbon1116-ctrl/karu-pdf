import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchSymbol, toGray, type GrayImage, type SymbolSearchOptions } from '../src/core/symbolSearch'
import { SymbolSearchClient, type SymbolSearchRequest } from '../src/client/SymbolSearchClient'
import { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { SearchImage, WorkerRequest, WorkerResponse } from '../src/worker/protocol'
import type { ImageSearchMessage } from '../src/worker/symbolSearchMessages'
import type { Rect } from '../src/core/annotations'

const defaults: SymbolSearchOptions = { threshold: .8, rotations: true, maxResults: 500 }
const blank = (width: number, height: number): GrayImage => ({ width, height, data: new Uint8Array(width * height) })
function circle(size = 24): GrayImage {
  const image = blank(size, size), center = (size - 1) / 2, radius = size / 2 - 2
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    if (Math.abs(Math.hypot(x - center, y - center) - radius) < .8 || Math.abs(x - center) < 1 || Math.abs(y - center) < 1) image.data[y * size + x] = 255
  }
  return image
}
function stamp(page: GrayImage, template: GrayImage, x0: number, y0: number): void {
  for (let y = 0; y < template.height; y++) page.data.set(template.data.subarray(y * template.width, (y + 1) * template.width), (y + y0) * page.width + x0)
}
function clockwise(template: GrayImage): GrayImage {
  const output = blank(template.height, template.width)
  for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) output.data[x * output.width + template.height - y - 1] = template.data[y * template.width + x]
  return output
}
describe('NCC visual symbol search', () => {
  it('finds five circles with crosses, excluding three squares, within one pixel', () => {
    const page = blank(600, 400), template = circle()
    const locations = [[21, 31], [102, 111], [201, 231], [352, 102], [541, 341]]
    for (const [x, y] of locations) stamp(page, template, x, y)
    const square = blank(24, 24)
    for (let y = 1; y < 23; y++) for (let x = 1; x < 23; x++) if (x < 3 || x > 20 || y < 3 || y > 20) square.data[y * 24 + x] = 255
    for (const [x, y] of [[85, 280], [270, 60], [431, 270]]) stamp(page, square, x, y)
    const result = searchSymbol(page, template, defaults)
    expect(result.matches).toHaveLength(5)
    for (const [x, y] of locations) {
      const found = result.matches.find(m => Math.abs(m.x - x) <= 1 && Math.abs(m.y - y) <= 1)
      expect(found).toBeDefined(); expect(found!.score).toBeGreaterThanOrEqual(.95)
    }
    expect(result.stats.levels).toBe(1)
  })
  it('finds a clockwise asymmetric symbol only when rotations are enabled', () => {
    const template = blank(24, 24), page = blank(160, 100)
    for (let n = 1; n < 23; n++) { template.data[n * 24 + 1] = 255; template.data[22 * 24 + n] = 255 }
    for (let n = 4; n < 12; n++) template.data[n * 24 + 16] = 255
    stamp(page, clockwise(template), 57, 31)
    const found = searchSymbol(page, template, { ...defaults, threshold: .9 }).matches
    expect(found).toHaveLength(1); expect(found[0]).toMatchObject({ x: 57, y: 31, rotation: 90 })
    expect(searchSymbol(page, template, { ...defaults, threshold: .9, rotations: false }).matches).toHaveLength(0)
  })
  it('retains a symbol crossed by a thin drawing line at threshold 0.7', () => {
    const page = blank(160, 100), template = circle()
    stamp(page, template, 51, 33)
    for (let x = 0; x < page.width; x++) page.data[40 * page.width + x] = 255
    expect(searchSymbol(page, template, { ...defaults, threshold: .7 }).matches.some(m => Math.abs(m.x - 51) <= 1 && Math.abs(m.y - 33) <= 1)).toBe(true)
  })
  it('requires the whole matched rectangle to lie within the region', () => {
    const page = blank(200, 150), template = circle()
    stamp(page, template, 31, 31); stamp(page, template, 131, 81)
    const matches = searchSymbol(page, template, { ...defaults, region: { x: 30.5, y: 30.5, width: 49, height: 49 } }).matches
    expect(matches).toHaveLength(1); expect(matches[0]).toMatchObject({ x: 31, y: 31 })
    expect(searchSymbol(page, template, { ...defaults, region: { x: 33, y: 31, width: 15, height: 24 } }).matches).toHaveLength(0)
  })
  it('cancels before starting and during coarse-row processing without partial results', () => {
    const page = blank(600, 400), template = circle()
    expect(() => searchSymbol(page, template, { ...defaults, shouldStop: () => true })).toThrow('cancelled')
    let checks = 0
    expect(() => searchSymbol(page, template, { ...defaults, shouldStop: () => ++checks > 12 })).toThrow('cancelled')
  })
  it('cancels during refinement, discarding previously refined results', () => {
    const page = blank(600, 400), template = circle()
    stamp(page, template, 51, 71)
    let stop = false, coarseTotal = 0
    expect(() => searchSymbol(page, template, { ...defaults, shouldStop: () => stop,
      onProgress: (done, total) => {
        if (done === total && !coarseTotal) coarseTotal = total
        else if (coarseTotal && total > coarseTotal) stop = true
      } })).toThrow('cancelled')
  })
  it('trims outer white margins and reports the actual ink bounding rectangle plus one pixel', () => {
    const template = circle(), padded = blank(40, 38), page = blank(100, 100)
    stamp(padded, template, 7, 6); stamp(page, template, 31, 43)
    expect(searchSymbol(page, padded, defaults).matches[0]).toMatchObject({ x: 31, y: 43, width: 24, height: 24 })
  })
  it('handles odd rectangular templates, edge placement, result limits and oversized templates', () => {
    const template = blank(25, 19), page = blank(160, 120)
    for (let x = 1; x < 24; x++) template.data[17 * 25 + x] = 255
    for (let y = 1; y < 18; y++) template.data[y * 25 + 1] = 255
    stamp(page, template, 135, 101)
    expect(searchSymbol(page, template, { ...defaults, rotations: false }).matches[0]).toMatchObject({ x: 135, y: 101, width: 25, height: 19 })
    expect(searchSymbol(page, template, { ...defaults, maxResults: 0 }).matches).toEqual([])
    expect(searchSymbol(blank(5, 5), template, defaults).matches).toEqual([])
  })
  it('converts RGBA to ink density and composites transparent pixels onto white', () => {
    expect([...toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 1).data]).toEqual([0, 255, 0])
    expect(() => searchSymbol(blank(20, 20), blank(5, 5), defaults)).toThrow('blank template')
    expect(() => searchSymbol(blank(20, 20), circle(), { ...defaults, threshold: NaN })).toThrow('invalid options')
  })
  it.each([[24, 1], [25, 2], [48, 2], [49, 3], [97, 4]])('reduces a %ipx sample to a 6–12px coarse level (%i reductions)', (size, levels) => {
    const template = circle(size), page = blank(size + 30, size + 30)
    stamp(page, template, 13, 17)
    const result = searchSymbol(page, template)
    expect(result.stats.levels).toBe(levels)
    expect(Math.ceil(size / 2 ** levels)).toBeGreaterThanOrEqual(6)
    expect(Math.ceil(size / 2 ** levels)).toBeLessThanOrEqual(12)
    expect(result.matches.some(m => m.x === 13 && m.y === 17)).toBe(true)
  })
  it('defaults to threshold 0.7 without rotations', () => {
    const page = blank(160, 100), template = circle()
    stamp(page, template, 51, 33)
    for (let x = 0; x < page.width; x++) page.data[40 * page.width + x] = 255
    expect(searchSymbol(page, template).matches).toEqual(searchSymbol(page, template, { threshold: .7, rotations: false, maxResults: 500 }).matches)
  })
  it('measures 200 symbols on a 4000x3000 image (600ms is advisory)', () => {
    const page = blank(4000, 3000), template = circle(24)
    for (let n = 0; n < 200; n++) stamp(page, template, 31 + n % 20 * 190, 41 + Math.floor(n / 20) * 280)
    const result = searchSymbol(page, template)
    console.log('SYMBOL_SEARCH_SYNTHETIC_PERF', JSON.stringify({ ...result.stats, matches: result.matches.length, advisoryLimitMs: 600, overAdvisory: result.stats.ms.total >= 600 }))
    expect(result.matches).toHaveLength(200)
  }, 30_000)
})

describe('PdfWorkerPool search image lifecycle', () => {
  class ManualWorker {
    static instances: ManualWorker[] = []
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null
    onerror: ((event: { message: string }) => void) | null = null
    terminate = vi.fn()
    postMessage = vi.fn((message: { type: string; requestId: number }) => {
      if (message.type === 'open') queueMicrotask(() => this.receive({ type: 'opened', requestId: message.requestId,
        pageCount: 1, pageSizes: [{ width: 200, height: 200 }], openMs: 0, sizesMs: 0 }))
    })
    constructor() { ManualWorker.instances.push(this); queueMicrotask(() => this.receive({ type: 'ready' })) }
    receive(data: WorkerResponse) { this.onmessage?.({ data }) }
  }
  const options = { docId: 'doc', pageIndex: 0, renderScale: 1, deviceRect: [0, 0, 200, 200] as Rect }
  const setup = async () => {
    ManualWorker.instances = []; vi.stubGlobal('Worker', ManualWorker)
    const pool = new PdfWorkerPool(3)
    await pool.open('doc', new ArrayBuffer(1))
    for (const worker of ManualWorker.instances) worker.postMessage.mockClear()
    return pool
  }
  afterEach(() => vi.unstubAllGlobals())
  it('queues below all display priorities on a free render Worker, returns only gray, and tracks idle state', async () => {
    const pool = await setup()
    try {
      const first = pool.renderSearchImage(options), second = pool.renderSearchImage(options)
      const worker1 = ManualWorker.instances[1], worker2 = ManualWorker.instances[2]
      const message1 = worker1.postMessage.mock.calls[0][0] as unknown as { jobId: number; priority: number }
      const message2 = worker2.postMessage.mock.calls[0][0] as unknown as { jobId: number; priority: number }
      expect(message1.priority).toBe(4); expect(message2.priority).toBe(4)
      expect(ManualWorker.instances[0].postMessage).not.toHaveBeenCalled()
      expect(pool.isIdle()).toBe(false)
      const image = { width: 200, height: 200, gray: new Uint8Array(40_000) }
      worker1.receive({ type: 'searchImageRendered', jobId: message1.jobId, image })
      worker2.receive({ type: 'searchImageRendered', jobId: message2.jobId, image })
      expect(await first.promise).toBe(image); expect(await second.promise).toBe(image)
      expect(pool.isIdle()).toBe(true)
    } finally { pool.destroy() }
  })
  it.each([false, true])('settles cancellation immediately and releases the queue after a %s started job responds', async started => {
    const pool = await setup()
    try {
      const task = pool.renderSearchImage(options), worker = ManualWorker.instances[1]
      const { jobId } = worker.postMessage.mock.calls[0][0] as unknown as { jobId: number }
      if (started) worker.receive({ type: 'started', jobId })
      const rejected = expect(task.promise).rejects.toThrow('取り消されました')
      task.cancel(); task.cancel(); await rejected
      expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'cancelJobs', docId: 'doc', jobIds: [jobId] })
      expect(worker.postMessage).toHaveBeenCalledTimes(2)
      expect(pool.isIdle()).toBe(false)
      worker.receive(started ? { type: 'searchImageRendered', jobId, image: { width: 1, height: 1, gray: new Uint8Array(1) } }
        : { type: 'searchImageRendered', jobId, cancelled: true })
      expect(pool.isIdle()).toBe(true)
    } finally { pool.destroy() }
  })
  it('prefers an idle Worker without display-page assignments, preserving existing page affinity', async () => {
    const pool = await setup()
    try {
      expect(pool.workerIndexForPage('doc', 0)).toBe(1)
      const task = pool.renderSearchImage(options), worker = ManualWorker.instances[2]
      const { jobId } = worker.postMessage.mock.calls[0][0] as unknown as { jobId: number }
      expect(ManualWorker.instances[1].postMessage).not.toHaveBeenCalled()
      expect(pool.workerIndexForPage('doc', 0)).toBe(1)
      worker.receive({ type: 'searchImageRendered', jobId, image: { width: 1, height: 1, gray: new Uint8Array(1) } })
      await task.promise
    } finally { pool.destroy() }
  })
  it('rejects Worker errors, document-close cancellation and pool disposal without leaving pending jobs', async () => {
    const pool = await setup(), worker = ManualWorker.instances[1]
    const first = pool.renderSearchImage(options)
    const { jobId } = worker.postMessage.mock.calls[0][0] as unknown as { jobId: number }
    const failed = expect(first.promise).rejects.toThrow('pixel limit')
    worker.receive({ type: 'error', jobId, message: 'pixel limit' }); await failed
    expect(pool.isIdle()).toBe(true)
    const second = pool.renderSearchImage(options)
    const secondId = (worker.postMessage.mock.calls.at(-1)![0] as unknown as { jobId: number }).jobId
    const closed = expect(second.promise).rejects.toThrow('取り消されました')
    pool.close('doc'); worker.receive({ type: 'searchImageRendered', jobId: secondId, cancelled: true }); await closed
    expect(pool.isIdle()).toBe(true)
    await pool.open('doc', new ArrayBuffer(1))
    const third = pool.renderSearchImage(options), disposed = expect(third.promise).rejects.toThrow('破棄されました')
    pool.destroy(); await disposed
  })
})

it('renders a >160px PDF crop in one contents pass, excludes annotations, transfers ink, caps pixels, and prioritizes display jobs', async () => {
  const { default: mupdf } = await import('mupdf')
  const scope = {
    onmessage: null as ((event: { data: WorkerRequest }) => void) | null,
    postMessage: vi.fn<(message: WorkerResponse, transfer?: Transferable[]) => void>(),
    addEventListener: vi.fn(), fetch: globalThis.fetch, location: new URL('http://localhost/'),
  }
  class SchedulerChannel {
    port1 = { onmessage: null as (() => void) | null }
    port2 = { postMessage: () => queueMicrotask(() => this.port1.onmessage?.()) }
  }
  vi.stubGlobal('self', scope); vi.stubGlobal('MessageChannel', SchedulerChannel)
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} })
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })))
  const send = (data: WorkerRequest) => scope.onmessage!({ data })
  const responses = () => scope.postMessage.mock.calls.map(([message]) => message)
  const finished = async (jobId: number) => {
    await vi.waitFor(() => expect(responses().some(message => 'jobId' in message && message.jobId === jobId && message.type !== 'started')).toBe(true))
    return responses().find(message => 'jobId' in message && message.jobId === jobId && message.type !== 'started')!
  }
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 240, 240], 0, {}, '0 g 20 200 20 20 re f 1 0 0 rg 80 150 20 20 re f')
  let contents: ReturnType<typeof vi.spyOn> | undefined
  try {
    doc.insertPage(-1, ref)
    const page = doc.loadPage(0), annotation = page.createAnnotation('Square')
    try { annotation.setRect([120, 20, 140, 40]); annotation.setInteriorColor([0, 0, 0]); annotation.update(); page.update() }
    finally { annotation.destroy(); page.destroy() }
    const buffer = doc.saveToBuffer('compress')
    let bytes: ArrayBuffer
    try { bytes = buffer.asUint8Array().slice().buffer as ArrayBuffer } finally { buffer.destroy() }
    await import('../src/worker/pdf.worker')
    send({ type: 'open', requestId: 100, docId: 'image-test', bytes, includePageMetadata: false })
    await vi.waitFor(() => expect(responses().some(message => message.type === 'opened')).toBe(true))
    contents = vi.spyOn(mupdf.Page.prototype, 'runPageContents')
    const annots = vi.spyOn(mupdf.Page.prototype, 'runPageAnnots'), widgets = vi.spyOn(mupdf.Page.prototype, 'runPageWidgets')
    const request = { type: 'renderSearchImage' as const, priority: 4 as const, docId: 'image-test', pageIndex: 0, renderScale: 1, deviceRect: [10, 10, 210, 210] as Rect }
    send({ ...request, jobId: 101 })
    const response = await finished(101)
    expect(response.type).toBe('searchImageRendered')
    if (response.type !== 'searchImageRendered' || !response.image) throw new Error('missing search pixels')
    const { image } = response
    expect(image.width).toBe(200); expect(image.height).toBe(200); expect(image.gray).toHaveLength(40_000)
    expect(image.gray[0]).toBe(0); expect(image.gray[15 * 200 + 15]).toBe(255)
    expect(image.gray[75 * 200 + 75]).toBe(201)
    expect(image.gray[15 * 200 + 115]).toBe(0) // The filled Square annotation is omitted.
    expect(contents).toHaveBeenCalledOnce(); expect(annots).not.toHaveBeenCalled(); expect(widgets).not.toHaveBeenCalled()
    expect(scope.postMessage.mock.calls.find(([message]) => message === response)![1]).toEqual([image.gray.buffer])
    send({ ...request, jobId: 102, deviceRect: [0, 0, 4001, 4000] })
    expect(await finished(102)).toMatchObject({ type: 'error', message: expect.stringContaining('1600万画素') })
    expect(contents).toHaveBeenCalledOnce() // Reject before page contents or pixel allocation.
    scope.postMessage.mockClear()
    send({ ...request, jobId: 103 })
    send({ type: 'render', priority: 3, jobId: 104, docId: 'image-test', pageIndex: 0, renderScale: 1, deviceRect: [0, 0, 32, 32], contentsOnly: true })
    await finished(103); await finished(104)
    expect(responses().filter(message => message.type === 'started').map(message => message.jobId)).toEqual([104, 103])
    const beforeCancel = contents.mock.calls.length
    send({ ...request, jobId: 105 }); send({ type: 'cancelJobs', docId: 'image-test', jobIds: [105] })
    expect(await finished(105)).toMatchObject({ type: 'searchImageRendered', cancelled: true })
    expect(contents).toHaveBeenCalledTimes(beforeCancel)
    send({ ...request, jobId: 106 }); send({ type: 'close', docId: 'image-test' })
    expect(await finished(106)).toMatchObject({ type: 'searchImageRendered', cancelled: true })
  } finally {
    scope.onmessage && send({ type: 'dispose' })
    vi.restoreAllMocks(); vi.unstubAllGlobals(); ref.destroy(); doc.destroy()
  }
})

describe('SymbolSearchClient resource lifecycle', () => {
  class FakeWorker {
    static instances: FakeWorker[] = []
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: unknown = null
    onmessageerror: unknown = null
    terminate = vi.fn()
    postMessage = vi.fn()
    constructor() { FakeWorker.instances.push(this) }
  }
  const request: SymbolSearchRequest = { docId: 'doc', pageIndex: 0, samplePageIndex: 1, sampleRect: [1, 2, 17, 18], searchRect: [10.25, 20.25, 26.25, 36.25] }
  const install = () => {
    FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('OffscreenCanvas', vi.fn(() => { throw new Error('canvas conversion must not run') }))
    const pool = { extractVectors: vi.fn(() => ({ cancel: vi.fn(), promise: Promise.resolve({ pageIndex: 1, segments: new Float32Array(), widths: new Float32Array(), segmentCount: 0, truncated: false,
      stats: { strokePaths: 0, fillPaths: 0, whiteFills: 0, curves: 0, images: 1, imageAreaRatio: 1, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } } }) })), getPageInfo: vi.fn(), renderSearchImage: vi.fn((options: { deviceRect: Rect }): { cancel(): void; promise: Promise<SearchImage> } => {
      const width = options.deviceRect[2] - options.deviceRect[0], height = options.deviceRect[3] - options.deviceRect[1]
      return { cancel: vi.fn(), promise: Promise.resolve({ width, height, gray: new Uint8Array(width * height) }) }
    }) }
    return pool
  }
  afterEach(() => vi.unstubAllGlobals())
  it('creates no Worker before search, renders the page once, transfers gray buffers and maps cropped pixels to page points', async () => {
    const pool = install(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
    expect(FakeWorker.instances).toHaveLength(0); expect(pool.renderSearchImage).not.toHaveBeenCalled()
    const task = client.search(request)
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const worker = FakeWorker.instances[0], message = worker.postMessage.mock.calls[0][0] as ImageSearchMessage
    expect(message.options).toMatchObject({ threshold: .7, rotations: false })
    expect(worker.postMessage.mock.calls[0][1]).toEqual([message.page.gray.buffer, message.template.gray.buffer])
    expect(OffscreenCanvas).not.toHaveBeenCalled()
    worker.onmessage!({ data: { type: 'result', id: message.id, matches: [{ x: 4, y: 6, width: 10, height: 12, score: 1, rotation: 90 }],
      stats: { coarseCandidates: 1, refined: 1, levels: 1, workerMs: 0, ms: { coarse: 0, refine: 0 } }, memory: { pagePixels: 1089, bytes: 100 } } })
    const result = await task.promise
    expect(result.candidates[0]).toEqual({ pageIndex: 0, rect: [38 / 3, 24, 58 / 3, 32], center: [16, 28], score: 1, rotation: 90, label: '', gc: false })
    expect(result.metrics).toMatchObject({ renderScale: 1.5, renderTiles: 2 })
    expect(pool.extractVectors).toHaveBeenCalledOnce() // Raster sample forces image matching for every target page.
    expect(pool.renderSearchImage).toHaveBeenCalledTimes(2)
    expect(pool.renderSearchImage.mock.calls.map(([options]) => options.deviceRect)).toEqual([[15, 30, 40, 55], [1, 3, 26, 27]])
    expect(pool.getPageInfo).not.toHaveBeenCalled()
    client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('terminates the active Worker, settles cancellation immediately, and creates another on the next search', async () => {
    const pool = install(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool), first = client.search(request)
    const rejected = expect(first.promise).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    first.cancel(); await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
    const second = client.search(request), secondRejected = expect(second.promise).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    client.dispose(); await secondRejected
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce()
  })
  it('cancels unfinished PDF jobs and discards late gray arrays without starting a Worker', async () => {
    const pool = install()
    let finish!: (result: SearchImage) => void
    const cancel = vi.fn()
    pool.renderSearchImage.mockImplementation(() => ({ cancel, promise: new Promise<SearchImage>(resolve => { finish = resolve }) }))
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool), task = client.search(request)
    const rejected = expect(task.promise).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(pool.renderSearchImage).toHaveBeenCalledOnce())
    task.cancel(); await rejected
    expect(cancel).toHaveBeenCalledOnce()
    finish({ width: 1, height: 1, gray: new Uint8Array(1) })
    await Promise.resolve(); await Promise.resolve()
    expect(pool.renderSearchImage).toHaveBeenCalledOnce()
    expect(FakeWorker.instances).toHaveLength(0); client.dispose()
  })
  it('caps rounded pixel area without tiling, rejects concurrent requests, and uses known page sizes', async () => {
    const pool = install(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool, () => ({ width: 10_000, height: 10_000 }))
    const task = client.search({ ...request, searchRect: undefined })
    const rejected = expect(task.promise).rejects.toThrow('cancelled')
    await expect(client.search(request).promise).rejects.toThrow('search already running')
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const worker = FakeWorker.instances[0], message = worker.postMessage.mock.calls[0][0] as ImageSearchMessage
    expect(message.page.width * message.page.height).toBeLessThanOrEqual(16_000_000)
    expect(message.renderScale).toBeLessThan(2)
    expect(pool.getPageInfo).not.toHaveBeenCalled()
    expect(pool.renderSearchImage).toHaveBeenCalledTimes(2)
    expect(message.page.width).toBeGreaterThan(160)
    task.cancel(); await rejected; client.dispose()
  })
  it('maps UI threshold and passes rotation options through to the matching Worker', async () => {
    const pool = install(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
    const task = client.search({ ...request, options: { rotations: true, threshold: .85 } })
    const rejected = expect(task.promise).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    expect((FakeWorker.instances[0].postMessage.mock.calls[0][0] as ImageSearchMessage).options).toMatchObject({ rotations: true, threshold: .7 })
    task.cancel(); await rejected; client.dispose()
  })
})
