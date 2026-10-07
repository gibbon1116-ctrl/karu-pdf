import { afterEach, describe, expect, it, vi } from 'vitest'
import { VectorCache, vectorWorkerTask, VECTOR_CACHE_BYTES, SYMBOL_SEARCH_STALL_MS } from '../src/client/VectorCache'
import { SymbolSearchClient } from '../src/client/SymbolSearchClient'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { VectorPage } from '../src/core/vectorPaths'
import { buildSnapIndex, findPreferredSnap } from '../src/core/snap'
import { buildEndpointIndex, searchVectorMessage, type SymbolSearchMessage, type SymbolSearchResponse } from '../src/worker/symbolSearchMessages'
import { DocumentSession, DocumentTabsModel } from '../src/app/documentModel'

const squareX = (x: number, y: number, diagonal = true) => [x,y,x+10,y, x+10,y,x+10,y+10, x+10,y+10,x,y+10, x,y+10,x,y, ...(diagonal ? [x,y,x+10,y+10, x+10,y,x,y+10] : [])]
const vector = (pageIndex = 0, segments = new Float32Array(squareX(20, 20)), imageAreaRatio = 0, truncated = false): VectorPage => ({
  pageIndex, segments, segmentCount: segments.length / 4, truncated,
  stats: { strokePaths: 1, fillPaths: 0, curves: 0, images: imageAreaRatio ? 1 : 0, imageAreaRatio, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } },
})
const poolFor = (make = (index: number) => vector(index)) => ({ extractVectors: vi.fn(({ pageIndex }: { pageIndex: number }) => ({ promise: Promise.resolve(make(pageIndex)), cancel: vi.fn() })) })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

class FakeWorker {
  static instances: FakeWorker[] = []
  static hold = false
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
    })
  })
  constructor() { FakeWorker.instances.push(this) }
}
const workers = () => { FakeWorker.instances = []; FakeWorker.hold = false; vi.stubGlobal('Worker', FakeWorker) }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

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
    expect(large.size).toBe(2); expect(large.bytes).toBe(12 * 1024 * 1024)
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
    const result=searchVectorMessage({type:'vector-search',id:1,segments,sampleSegments:segments,sampleRect:[19,19,31,31],options:{threshold:.85}})!
    expect(result.matches).toHaveLength(6)
    expect(result.matches.map(m=>m.center[0]).sort((a,b)=>a-b)).toEqual([25,65,105,145,185,225])
  })
  it('uses the sample page independently and never inserts its geometry into the target', () => {
    const sampleSegments=new Float32Array(squareX(20,20)), segments=new Float32Array(squareX(120,120))
    const message={type:'vector-search' as const,id:1,segments,sampleSegments,sampleRect:[19,19,31,31] as [number,number,number,number],options:{}}
    expect(searchVectorMessage(message)?.matches.map(m=>m.center)).toEqual([[125,125]])
    expect(searchVectorMessage({...message,sampleRect:[300,300,310,310]})).toBeNull()
  })
  it('transfers copies, retains cache buffers, maps results and performs no image rendering', async () => {
    workers(); const pool={...poolFor(),renderSearchImage:vi.fn()}, cache=new VectorCache('doc'), page=await cache.get(0,pool)
    const client=new SymbolSearchClient(pool as unknown as PdfWorkerPool,()=>({width:500,height:500}),()=>cache)
    const result=await client.search({docId:'doc',pageIndex:0,samplePageIndex:0,sampleRect:[19,19,31,31],options:{threshold:.9,rotations:true}}).promise
    expect(result.method).toBe('vector'); expect(result.candidates[0].center).toEqual([25,25])
    expect(pool.renderSearchImage).not.toHaveBeenCalled(); expect(page.segments.byteLength).toBe(96)
    const message=FakeWorker.instances[0].postMessage.mock.calls[0][0]
    expect(message.type).toBe('vector-search'); if (message.type !== 'vector-search') throw Error('missing vector message'); expect(message.segments.byteLength).toBe(0)
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
    const promise=vectorWorkerTask({type:'vector-search',id:1,segments:new Float32Array(),sampleSegments:new Float32Array(),sampleRect:[0,0,10,10],options:{}},controller.signal)
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

