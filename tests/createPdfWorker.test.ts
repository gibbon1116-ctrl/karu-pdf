import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const single = vi.hoisted(() => vi.fn())
vi.mock('../src/single/runtime', () => ({ createSingleWorker: single }))
const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
class MockWorker extends EventTarget {
  messages: Array<{ type: string; module: WebAssembly.Module }> = []
  postMessage(message: { type: string; module: WebAssembly.Module }) { this.messages.push(message) }
}
beforeEach(() => {
  vi.resetModules()
  single.mockReset().mockReturnValue(undefined)
  vi.stubGlobal('Worker', MockWorker)
  vi.stubGlobal('ErrorEvent', class extends Event {
    message: string
    constructor(type: string, init: ErrorEventInit) { super(type); this.message = init.message ?? '' }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('shared PDF engine startup', () => {
  it('initializes the main-thread instance asynchronously using the shared module', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(binary)))
    vi.stubGlobal('$libmupdf_wasm_Module', undefined)
    const instantiate = vi.spyOn(WebAssembly, 'instantiate')
    const { preparePdfEngine } = await import('../src/client/sharedPdfModule')
    await preparePdfEngine()
    const scope = globalThis as typeof globalThis & { $libmupdf_wasm_Module: { instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): unknown } }
    const done = vi.fn()
    scope.$libmupdf_wasm_Module.instantiateWasm({}, done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(instantiate).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0]).toBeInstanceOf(WebAssembly.Instance)
  })
  it('fetches and compiles once for four workers and shares the compiled module', async () => {
    const fetch = vi.fn(async () => new Response(binary, { headers: { 'Content-Type': 'application/wasm' } }))
    vi.stubGlobal('fetch', fetch)
    const compile = vi.spyOn(WebAssembly, 'compileStreaming')
    const { createPdfWorker } = await import('../src/client/createPdfWorker')
    const workers = Array.from({ length: 4 }, () => createPdfWorker() as unknown as MockWorker)
    await vi.waitFor(() => expect(workers.every(worker => worker.messages.length === 1)).toBe(true))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(compile).toHaveBeenCalledTimes(1)
    expect(workers.every(worker => worker.messages[0].type === 'pdf-init')).toBe(true)
    expect(workers.every(worker => worker.messages[0].module === workers[0].messages[0].module)).toBe(true)
    expect(workers[0].messages[0].module).toBeInstanceOf(WebAssembly.Module)
  })
  it('supports a local server with the wrong WASM MIME type without a second download', async () => {
    const fetch = vi.fn(async () => new Response(binary, { headers: { 'Content-Type': 'application/octet-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const compile = vi.spyOn(WebAssembly, 'compile')
    const { createPdfWorker } = await import('../src/client/createPdfWorker')
    const worker = createPdfWorker() as unknown as MockWorker
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(compile).toHaveBeenCalledTimes(1)
  })
  it('reports a failed engine download to every waiting worker', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const { createPdfWorker } = await import('../src/client/createPdfWorker')
    const errors: string[] = []
    for (let i = 0; i < 4; i++) {
      createPdfWorker().addEventListener('error', event => errors.push((event as ErrorEvent).message))
    }
    await vi.waitFor(() => expect(errors).toHaveLength(4))
    expect(errors.every(error => error.includes('503'))).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('compiles from bytes when streaming compilation is unavailable', async () => {
    const wasm = Object.create(WebAssembly) as typeof WebAssembly
    Object.defineProperty(wasm, 'compileStreaming', { value: undefined })
    vi.stubGlobal('WebAssembly', wasm)
    const fetch = vi.fn(async () => new Response(binary))
    vi.stubGlobal('fetch', fetch)
    const { createPdfWorker } = await import('../src/client/createPdfWorker')
    const worker = createPdfWorker() as unknown as MockWorker
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1))
    expect(worker.messages[0].module).toBeInstanceOf(WebAssembly.Module)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
