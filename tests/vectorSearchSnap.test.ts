import { afterEach, describe, expect, it, vi } from 'vitest'
import { VectorCache, vectorWorkerTask, VECTOR_CACHE_BYTES, SYMBOL_SEARCH_STALL_MS } from '../src/client/VectorCache'
import { SymbolSearchClient } from '../src/client/SymbolSearchClient'
import { searchSymbol, verifyCandidates } from '../src/core/symbolSearch'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { VectorPage } from '../src/core/vectorPaths'
import { buildSnapIndex, findPreferredSnap } from '../src/core/snap'
import { buildEndpointIndex, searchVectorMessage, type SymbolSearchMessage, type SymbolSearchResponse } from '../src/worker/symbolSearchMessages'
import { DocumentSession, DocumentTabsModel } from '../src/app/documentModel'

const squareX = (x: number, y: number, diagonal = true) => [x,y,x+10,y, x+10,y,x+10,y+10, x+10,y+10,x,y+10, x,y+10,x,y, ...(diagonal ? [x,y,x+10,y+10, x+10,y,x,y+10] : [])]
const vector = (pageIndex = 0, segments = new Float32Array(squareX(20, 20)), imageAreaRatio = 0, truncated = false): VectorPage => ({
  pageIndex, segments, widths: new Float32Array(segments.length / 4), segmentCount: segments.length / 4, truncated,
  stats: { strokePaths: 1, fillPaths: 0, whiteFills: 0, curves: 0, images: imageAreaRatio ? 1 : 0, imageAreaRatio, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } },
})
const poolFor = (make = (index: number) => vector(index)) => ({ extractVectors: vi.fn(({ pageIndex }: { pageIndex: number }) => ({ promise: Promise.resolve(make(pageIndex)), cancel: vi.fn() })) })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

class FakeWorker {
  static instances: FakeWorker[] = []
  static hold = false
  static holdVerify = false
  onmessage: ((event: { data: SymbolSearchResponse }) => void) | null = null
  onerror: unknown = null
  onmessageerror: unknown = null
  terminate = vi.fn()
  postMessage = vi.fn((message: SymbolSearchMessage, transfer: Transferable[]) => {
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => {
      if (this.terminate.mock.calls.length || FakeWorker.hold) return
      if (owned.type === 'vector-search') this.onmessage?.({ data: { type: 'vector-result', id: owned.id, result: searchVectorMessage(owned) } })
      if (owned.type === 'endpoints') this.onmessage?.({ data: { type: 'endpoint-result', id: owned.id, index: buildEndpointIndex(owned) } })
      if (owned.type === 'verify' && !FakeWorker.holdVerify) this.onmessage?.({ data: { type: 'verify-result', id: owned.id,
        scores: verifyCandidates({ width: owned.page.width, height: owned.page.height, data: owned.page.gray },
          { width: owned.template.width, height: owned.template.height, data: owned.template.gray }, owned.targets, {}), verifyMs: 2 } })
      if (owned.type === 'search') {
        const result = searchSymbol({ width: owned.page.width, height: owned.page.height, data: owned.page.gray },
          { width: owned.template.width, height: owned.template.height, data: owned.template.gray }, owned.options)
        this.onmessage?.({ data: { type: 'result', id: owned.id, ...result, stats: { ...result.stats, workerMs: 1 },
          memory: { pagePixels: owned.page.gray.length, bytes: owned.page.gray.byteLength + owned.template.gray.byteLength, estimated: true } } })
      }
    })
  })
  constructor() { FakeWorker.instances.push(this) }
}
const workers = () => { FakeWorker.instances = []; FakeWorker.hold = false; FakeWorker.holdVerify = false; vi.stubGlobal('Worker', FakeWorker) }
const verificationPool = () => ({ ...poolFor(i => vector(i, new Float32Array([...squareX(20,20), ...squareX(120,20)]))),
  renderSearchImage: vi.fn(({ deviceRect: bounds, renderScale: scale }: { deviceRect: [number,number,number,number]; renderScale: number }) => {
    const width = bounds[2] - bounds[0], height = bounds[3] - bounds[1], gray = new Uint8Array(width * height)
    // Only the first vector symbol is present in the pixels: the second must remain a check candidate.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = (bounds[0] + x + .5) / scale, py = (bounds[1] + y + .5) / scale
      if (px >= 19.8 && px <= 30.2 && py >= 19.8 && py <= 30.2
        && (Math.min(Math.abs(px-20),Math.abs(px-30),Math.abs(py-20),Math.abs(py-30)) < .3
          || Math.abs(px-py) < .4 || Math.abs(px+py-50) < .4)) gray[y*width+x]=255
    }
    return { promise: Promise.resolve({width,height,gray}), cancel: vi.fn() }
  }) })
const verifyRequest = { docId:'doc', pageIndex:0, samplePageIndex:0, sampleRect:[19,19,31,31] as [number,number,number,number],
  searchRect:[10.25,10.25,150.25,50.25] as [number,number,number,number] }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('vector candidate image verification lifecycle', () => {
  it.each([false, true])('grades extra lines even with perfect image scores (verify: %s)', async verify => {
    workers(); FakeWorker.holdVerify = true
    const thin = (x: number) => [x,20,x+3,20, x+3,20,x+3,39, x+3,39,x,39, x,39,x,20]
    const lines = new Float32Array([...thin(20), ...thin(60), ...[0,1,2,3,4].flatMap(y => [60,20+y,63,39-y])])
    const pool = { ...verificationPool(), ...poolFor(i => vector(i, lines)) }
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
    const task = client.search({ ...verifyRequest, sampleRect: [19,19,24,40], verify })
    if (verify) {
      await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
      FakeWorker.instances[1].onmessage!({data:{type:'verify-result',id:1,scores:new Float32Array([1,1]),verifyMs:1}})
    }
    const result = await task.promise
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.find(c => c.center[0] < 30)?.confidence).toBe('high')
    const hatch = result.candidates.find(c => c.center[0] > 30)!
    expect(hatch.extra).toBeGreaterThan(.4); expect(hatch.confidence).toBe('check')
    expect(hatch.imageScore).toBe(verify ? 1 : undefined)
    client.dispose()
  })
  it('renders a cleaned template from its body bounds after removing detached text', async () => {
    workers()
    const pool = { ...verificationPool(), ...poolFor(i => vector(i, new Float32Array([...squareX(20,20), ...squareX(120,20), 35,23,37,23]))) }
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
    const result = await client.search({ ...verifyRequest, sampleRect: [19,19,38,31] }).promise
    expect(result.vectorDetails?.template).toMatchObject({cleaned:true,segments:6,removed:{wiring:0,other:1},rect:[20,20,30,30]})
    expect(pool.renderSearchImage.mock.calls[1][0].deviceRect).toEqual([48,48,72,72])
    expect(result.candidates.map(c=>c.confidence)).toEqual(['high','check'])
    client.dispose()
  })
  it('keeps raster whole-page searching, original sample crops and candidates without confidence', async () => {
    const results = []
    for (const verify of [false, true]) {
      workers()
      const pool = { ...verificationPool(), ...poolFor(i => vector(i, new Float32Array(), 1)) }
      const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
      const result = await client.search({ ...verifyRequest, verify }).promise
      expect(result.method).toBe('image'); expect(result.candidates.length).toBeGreaterThan(0)
      expect(result.candidates.every(c => c.confidence === undefined && c.extra === undefined && c.imageScore === undefined)).toBe(true)
      expect(pool.renderSearchImage.mock.calls.map(([r])=>r.deviceRect)).toEqual([[20,20,301,101],[38,38,62,62]])
      expect(FakeWorker.instances[0].postMessage.mock.calls[0][0].type).toBe('search')
      results.push(result.candidates); client.dispose()
    }
    expect(results[0]).toEqual(results[1])
  })
  it('renders one page crop and one sample, transfers pixels, maps targets and retains every vector candidate', async () => {
    workers(); const pool = verificationPool(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool), stages: string[] = []
    const result = await client.search(verifyRequest, stage => stages.push(stage)).promise
    expect(result.method).toBe('vector'); expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map(c => c.confidence)).toEqual(['high','check'])
    expect(result.candidates[0].imageScore).toBeGreaterThan(.99); expect(result.candidates[1].imageScore).toBe(0)
    expect(pool.renderSearchImage).toHaveBeenCalledTimes(2)
    expect(pool.renderSearchImage.mock.calls.map(([r])=>r.deviceRect)).toEqual([[24,24,361,121],[48,48,72,72]])
    const worker = FakeWorker.instances[1], message = worker.postMessage.mock.calls[0][0]
    expect(message.type).toBe('verify')
    if (message.type !== 'verify') throw Error('missing verify message')
    expect(message.targets[0]).toEqual({x:24,y:24,width:24,height:24,angle:0})
    expect(message.page.gray.byteLength).toBe(0); expect(message.template.gray.byteLength).toBe(0)
    expect(stages.indexOf('vector')).toBeLessThan(stages.indexOf('verify'))
    expect(result.metrics).toMatchObject({renderTiles:2,renderScale:2.4,verifyMs:2})
    expect(result.metrics.vectorMs).toBeGreaterThanOrEqual(0); expect(result.metrics.verifyRenderMs).toBeGreaterThanOrEqual(0)
    client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it.each(['off','empty'] as const)('skips rendering but retains line confidence when %s', async mode => {
    workers(); const pool = verificationPool(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool)
    const result = await client.search({...verifyRequest, verify:mode!=='off',
      ...(mode==='empty'?{searchRect:[200,200,300,300] as [number,number,number,number]}:{})}).promise
    expect(result.method).toBe('vector'); expect(pool.renderSearchImage).not.toHaveBeenCalled()
    expect(result.candidates.every(c => c.confidence==='high' && c.imageScore===undefined)).toBe(true)
    expect(result.candidates).toHaveLength(mode==='off'?2:0)
    expect(result.metrics).toMatchObject({verifyMs:0,verifyRenderMs:0,renderTiles:0}); client.dispose()
  })
  it('cancels unfinished verification rendering and discards late pixels', async () => {
    workers(); const pool = verificationPool(), pending = deferred<{width:number;height:number;gray:Uint8Array<ArrayBuffer>}>(), cancel=vi.fn()
    pool.renderSearchImage.mockImplementation(()=>({promise:pending.promise,cancel}))
    const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool), task = client.search(verifyRequest)
    const rejected = expect(task.promise).rejects.toThrow('cancelled')
    await vi.waitFor(()=>expect(pool.renderSearchImage).toHaveBeenCalledOnce())
    task.cancel(); await rejected; expect(cancel).toHaveBeenCalledOnce()
    pending.resolve({width:1,height:1,gray:new Uint8Array(1)}); await Promise.resolve(); await Promise.resolve()
    expect(FakeWorker.instances).toHaveLength(1); expect(pool.renderSearchImage).toHaveBeenCalledOnce(); client.dispose()
  })
  it.each(['cancel','stall'] as const)('terminates the verify Worker on %s and ignores its late result', async mode => {
    workers(); FakeWorker.holdVerify=true
    if(mode==='stall') vi.useFakeTimers()
    const pool = verificationPool(), client = new SymbolSearchClient(pool as unknown as PdfWorkerPool), task=client.search(verifyRequest)
    const rejected = expect(task.promise).rejects.toThrow(mode==='cancel'?'cancelled':'応答しなくなった')
    await vi.waitFor(()=>expect(FakeWorker.instances).toHaveLength(2))
    const worker=FakeWorker.instances[1], listener=worker.onmessage!
    if(mode==='cancel') task.cancel(); else await vi.advanceTimersByTimeAsync(SYMBOL_SEARCH_STALL_MS+1000)
    await rejected; expect(worker.terminate).toHaveBeenCalledOnce()
    listener({data:{type:'verify-result',id:1,scores:new Float32Array([1,1]),verifyMs:1}})
    client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce()
  })
})

describe('bounded document vector cache', () => {
  it('is idle until requested and shares the same in-flight promise', async () => {
    const cache = new VectorCache('doc'), pool = poolFor()
    expect(pool.extractVectors).not.toHaveBeenCalled()
    const a = cache.get(0, pool), b = cache.get(0, pool)
    expect(a).toBe(b); await a
    expect(pool.extractVectors).toHaveBeenCalledOnce()
    expect((await cache.get(0, pool)).kind).toBe('vector')
    expect(cache.extractionRequests).toBe(1)
  })
  it('evicts least recently used pages at three pages and sixteen MiB', async () => {
    const cache = new VectorCache('doc'), pool = poolFor()
    for (const index of [0,1,2,0,3,0]) await cache.get(index, pool)
    expect(cache.size).toBe(3); expect(pool.extractVectors).toHaveBeenCalledTimes(4)
    await cache.get(1, pool); expect(pool.extractVectors).toHaveBeenCalledTimes(5)
    const large = new VectorCache('large'), bigPool = poolFor(i => vector(i, new Float32Array(6 * 1024 * 1024 / 4)))
    for (let i=0; i<3; i++) await large.get(i, bigPool)
    expect(large.size).toBe(2); expect(large.bytes).toBe(15 * 1024 * 1024)
    const oversize = poolFor(i => vector(i, new Float32Array((VECTOR_CACHE_BYTES + 16) / 4)))
    await large.get(4, oversize)
    expect(large.size).toBe(0); expect(large.bytes).toBe(0)
  })
  it('clears on pageRevision and close, including late extraction results', async () => {
    const session = new DocumentSession({ docId:'doc', name:'test', byteLength:1, handle:null, pageSizes:[] }), pool=poolFor()
    await session.vectorCache.get(0, pool)
    session.pageRevision++; expect(session.vectorCache.size).toBe(0)
    const pending = deferred<VectorPage>(), cancel = vi.fn(), pendingPool = { extractVectors: () => ({ promise: pending.promise, cancel }) }
    const result = session.vectorCache.get(1, pendingPool), reject = expect(result).rejects.toThrow('cancelled')
    session.pageRevision++; pending.resolve(vector(1)); await reject
    expect(cancel).toHaveBeenCalledOnce(); expect(session.vectorCache.size).toBe(0)
    const tabs = new DocumentTabsModel(); tabs.add(session)
    await session.vectorCache.get(0, pool); tabs.close('doc'); expect(session.vectorCache.size).toBe(0)
  })
  it('cancels queued extraction only when all subscribers leave', async () => {
    const pending=deferred<VectorPage>(), cancel=vi.fn(), pool={ extractVectors:()=>({promise:pending.promise,cancel}) }, cache=new VectorCache('doc')
    const a=new AbortController(), b=new AbortController()
    const first=cache.get(0,pool,a.signal), second=cache.get(0,pool,b.signal)
    const rejected=expect(first).rejects.toThrow('cancelled'); a.abort(); await rejected
    expect(cancel).not.toHaveBeenCalled(); pending.resolve(vector()); await second
    const next=deferred<VectorPage>(), c=new AbortController()
    const task=cache.get(1,{extractVectors:()=>({promise:next.promise,cancel})},c.signal), stopped=expect(task).rejects.toThrow('cancelled')
    c.abort(); await stopped; expect(cancel).toHaveBeenCalledOnce(); next.resolve(vector(1))
    await Promise.resolve(); expect(cache.size).toBe(1)
  })
})

describe('vector Worker messages and drawing endpoint index', () => {
  it('finds all six X squares including crossed symbols, excludes plain squares', () => {
    const segments = new Float32Array([...[20,60,100,140,180,220].flatMap(x=>squareX(x,20)), ...[260,300,340].flatMap(x=>squareX(x,20,false)), 130,25,170,25, 210,25,250,25])
    const result=searchVectorMessage({type:'vector-search',id:1,segments,sampleSegments:segments,sampleWidths:new Float32Array(segments.length / 4),sampleRect:[19,19,31,31],options:{threshold:.85}})!
    expect(result.matches).toHaveLength(6)
    expect(result.matches.map(m=>m.center[0]).sort((a,b)=>a-b)).toEqual([25,65,105,145,185,225])
  })
  it('uses the sample page independently and never inserts its geometry into the target', () => {
    const sampleSegments=new Float32Array(squareX(20,20)), segments=new Float32Array(squareX(120,120))
    const message={type:'vector-search' as const,id:1,segments,sampleSegments,sampleWidths:new Float32Array(sampleSegments.length / 4),sampleRect:[19,19,31,31] as [number,number,number,number],options:{}}
    expect(searchVectorMessage(message)?.matches.map(m=>m.center)).toEqual([[125,125]])
    expect(searchVectorMessage({...message,sampleRect:[300,300,310,310]})).toBeNull()
  })
  it('transfers copies, retains cache buffers, maps results and performs no image rendering', async () => {
    workers(); const pool={...poolFor(),renderSearchImage:vi.fn()}, cache=new VectorCache('doc'), page=await cache.get(0,pool)
    const client=new SymbolSearchClient(pool as unknown as PdfWorkerPool,()=>({width:500,height:500}),()=>cache)
    const result=await client.search({docId:'doc',pageIndex:0,samplePageIndex:0,sampleRect:[19,19,31,31],verify:false,options:{threshold:.9,rotations:true}}).promise
    expect(result.method).toBe('vector'); expect(result.candidates[0].center).toEqual([25,25])
    expect(pool.renderSearchImage).not.toHaveBeenCalled(); expect(page.segments.byteLength).toBe(96)
    expect(page.widths.byteLength).toBe(24)
    const message=FakeWorker.instances[0].postMessage.mock.calls[0][0]
    expect(message.type).toBe('vector-search'); if (message.type !== 'vector-search') throw Error('missing vector message'); expect(message.segments.byteLength).toBe(0)
    expect(message.sampleSegments.byteLength).toBe(0); expect(message.sampleWidths.byteLength).toBe(0)
    expect(result.candidates[0]).toMatchObject({ confidence: 'high', extra: 0 })
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce(); client.dispose()
  })
  it('deduplicates/caps endpoints and prefers annotation vertices, respecting Shift axes', () => {
    const index=buildEndpointIndex({type:'endpoints',id:1,segments:new Float32Array([100,400,200,400,100,400,200,400]),bounds:[0,0,500,500]})
    expect(index.points).toHaveLength(4); expect(index.cellSize).toBe(16)
    const vertices=buildSnapIndex([[103,404]],[0,0,500,500])
    expect(findPreferredSnap([100.6,400.4],8,vertices,index)?.kind).toBe('vertex')
    expect(findPreferredSnap([100.6,400.4],8,null,index)).toEqual({point:[100,400],kind:'drawing-endpoint'})
    expect(findPreferredSnap([100.6,400.4],8,vertices,index,{start:[0,400],direction:[1,0]})?.point).toEqual([100,400])
    const many=new Float32Array(200_004*2);for(let i=0;i<200_004;i++){many[i*2]=i;many[i*2+1]=0}
    expect(buildEndpointIndex({type:'endpoints',id:1,segments:many,bounds:[0,0,500,500]}).ids).toHaveLength(200_000)
  })
  it('shares and caches transferred indices; skips raster, empty and truncated pages', async () => {
    workers();const cache=new VectorCache('doc'),pool=poolFor(),a=new AbortController(),b=new AbortController()
    const [first,second]=await Promise.all([cache.endpoints(0,pool,[0,0,500,500],a.signal),cache.endpoints(0,pool,[0,0,500,500],b.signal)])
    expect(first).toBe(second);expect(FakeWorker.instances).toHaveLength(1)
    expect(await cache.endpoints(0,pool,[0,0,500,500],a.signal)).toBe(first)
    for (const [i,page] of [vector(1,new Float32Array(),1),vector(2,new Float32Array()),vector(3,undefined,0,true)].entries()) {
      expect(await cache.endpoints(i+1,poolFor(()=>page),[0,0,500,500],a.signal)).toBeNull()
    }
    expect(FakeWorker.instances).toHaveLength(1);expect(cache.bytes).toBeLessThanOrEqual(VECTOR_CACHE_BYTES)
  })
  it('terminates silent vector matching after the shared stall limit', async () => {
    workers();vi.useFakeTimers();const controller=new AbortController()
    const promise=vectorWorkerTask({type:'vector-search',id:1,segments:new Float32Array(),sampleSegments:new Float32Array(),sampleWidths:new Float32Array(),sampleRect:[0,0,10,10],options:{}},controller.signal)
    const rejected=expect(promise).rejects.toThrow('応答しなくなった')
    FakeWorker.instances[0].onmessage=null
    await vi.advanceTimersByTimeAsync(SYMBOL_SEARCH_STALL_MS+1000);await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })
  it('terminates an index Worker when its last subscriber leaves', async () => {
    workers(); FakeWorker.hold = true; const cache=new VectorCache('doc'), pool=poolFor(), a=new AbortController(), b=new AbortController()
    const first=cache.endpoints(0,pool,[0,0,500,500],a.signal), second=cache.endpoints(0,pool,[0,0,500,500],b.signal)
    const rejectedA=expect(first).rejects.toThrow('cancelled'), rejectedB=expect(second).rejects.toThrow('cancelled')
    // Pause the fake Worker response, while allowing extraction subscribers to continue.
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    FakeWorker.instances[0].onmessage=null
    a.abort(); await rejectedA; expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled()
    b.abort(); await rejectedB; expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })
  it('enforces the stall limit during extraction and ignores late results', async () => {
    workers(); vi.useFakeTimers(); const pending=deferred<VectorPage>(),cancel=vi.fn()
    const client=new SymbolSearchClient({extractVectors:()=>({promise:pending.promise,cancel})} as unknown as PdfWorkerPool,()=>({width:500,height:500}))
    const task=client.search({docId:'doc',pageIndex:0,samplePageIndex:0,sampleRect:[19,19,31,31]}), rejected=expect(task.promise).rejects.toThrow('応答しなくなった')
    await vi.advanceTimersByTimeAsync(SYMBOL_SEARCH_STALL_MS+1000); await rejected
    expect(cancel).toHaveBeenCalledOnce(); pending.resolve(vector()); await Promise.resolve()
    expect(FakeWorker.instances).toHaveLength(0); client.dispose()
  })
  it('cancels a search during extraction without starting a matching Worker', async () => {
    workers();const pending=deferred<VectorPage>(),cancel=vi.fn(),pool={extractVectors:()=>({promise:pending.promise,cancel})}
    const client=new SymbolSearchClient(pool as unknown as PdfWorkerPool,()=>({width:500,height:500}))
    const task=client.search({docId:'doc',pageIndex:0,samplePageIndex:0,sampleRect:[19,19,31,31]}),rejected=expect(task.promise).rejects.toThrow('cancelled')
    task.cancel();await rejected;expect(cancel).toHaveBeenCalledOnce();expect(FakeWorker.instances).toHaveLength(0)
    pending.resolve(vector());client.dispose()
  })
})
