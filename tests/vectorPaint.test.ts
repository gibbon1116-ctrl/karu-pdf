import {afterEach,describe,expect,it,vi} from 'vitest'
import mupdf from 'mupdf'
import {extractVectorPage} from '../src/worker/vectorExtract'
import {segmentEndpoints,type VectorPage} from '../src/core/vectorPaths'
import {copyPaint,paintBuffers,paintBytes,MAX_PAINT_PATHS,MAX_PAINT_POINTS,PAINT_STRIDE} from '../src/core/vectorPaint'
import {VectorCache,vectorWorkerTask,VECTOR_CACHE_BYTES} from '../src/client/VectorCache'

function documentWith(content:string){
  const doc=new mupdf.PDFDocument(),page=doc.addPage([0,0,200,100],0,{},content)
  doc.insertPage(-1,page);page.destroy();return doc
}
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}}
afterEach(()=>vi.unstubAllGlobals())

describe('search-only paint capture',()=>{
  it('leaves tiling-pattern paint unresolved while retaining legacy geometry',()=>{
    const doc=new mupdf.PDFDocument()
    const pattern=doc.addStream('0 0 m 10 10 l S',{Type:'Pattern',PatternType:1,PaintType:1,TilingType:1,BBox:[0,0,10,10],XStep:10,YStep:10,Resources:{}})
    const obj=doc.addPage([0,0,100,100],0,{Pattern:{P1:pattern}},'/Pattern cs /P1 scn 10 10 30 30 re f')
    doc.insertPage(-1,obj);obj.destroy();pattern.destroy()
    try{const a=extractVectorPage(doc,0),b=extractVectorPage(doc,0,undefined,true)
      expect(b.segments).toEqual(a.segments);expect(b.paint!.uncertain).toBe(true)
    }finally{doc.destroy()}
  })
  it('does not interpret Lab components as RGB or change legacy fill outlines',()=>{
    const doc=new mupdf.PDFDocument(),obj=doc.addPage([0,0,100,100],0,{ColorSpace:{CS:['Lab',{WhitePoint:[.9505,1,1.089]}]}},'/CS cs 50 0 0 sc 10 10 20 20 re f')
    doc.insertPage(-1,obj);obj.destroy()
    try{const a=extractVectorPage(doc,0),b=extractVectorPage(doc,0,undefined,true)
      expect(b.segments).toEqual(a.segments);expect(b.paint!.paths[2]).toBe(3)
    }finally{doc.destroy()}
  })
  it('records dashed strokes as local unresolved regions without changing snap geometry',()=>{
    const doc=documentWith('[2 3] 0 d 10 10 20 20 re S')
    try{const a=extractVectorPage(doc,0),b=extractVectorPage(doc,0,undefined,true)
      expect(b.segments).toEqual(a.segments);expect(b.paint!.uncertain).toBe(false)
      expect(b.paint!.paths[PAINT_STRIDE+2]).toBe(3)
    }finally{doc.destroy()}
  })
  it('keeps all legacy geometry, widths, stats and endpoints while recording white/black order and fill rules',()=>{
    const doc=documentWith('q .7 w 10 10 20 20 re S 40 10 20 20 re 44 14 12 12 re f* 1 g 44 14 12 12 re f Q')
    try{
      const before=extractVectorPage(doc,0),after=extractVectorPage(doc,0,undefined,true)
      expect(before.paint).toBeUndefined()
      expect(after.segments).toEqual(before.segments);expect(after.widths).toEqual(before.widths)
      expect(segmentEndpoints(after.segments)).toEqual(segmentEndpoints(before.segments))
      const {ms:_before,...oldStats}=before.stats,{ms:_after,...newStats}=after.stats
      expect(newStats).toEqual(oldStats)
      expect(after.paint?.paths.length).toBe(3*PAINT_STRIDE)
      expect([0,1,2].map(i=>Array.from(after.paint!.paths.slice(i*PAINT_STRIDE+2,i*PAINT_STRIDE+6)))).toEqual([[0,Math.fround(.7),0,1],[2,0,0,1],[1,0,1,1]])
      expect(after.paint).toMatchObject({truncated:false,uncertain:false})
      expect(paintBytes(after.paint)).toBeLessThanOrEqual(MAX_PAINT_POINTS*9+MAX_PAINT_PATHS*40)
    }finally{doc.destroy()}
  })
  it('caps paint independently without truncating or changing legacy extraction',()=>{
    const doc=documentWith('0 0 m 10 10 l S '.repeat(MAX_PAINT_PATHS+2))
    try{const page=extractVectorPage(doc,0,undefined,true);expect(page.segmentCount).toBe(MAX_PAINT_PATHS+2);expect(page.truncated).toBe(false);expect(page.paint!.truncated).toBe(true);expect(page.paint!.paths.length).toBe(MAX_PAINT_PATHS*PAINT_STRIDE)}finally{doc.destroy()}
  })
  it('marks clipping uncertain and isolates transferred copies',()=>{
    const doc=documentWith('q 0 0 20 20 re W n 0 0 30 30 re f Q')
    try{
      const page=extractVectorPage(doc,0,undefined,true),copy=copyPaint(page.paint)!
      expect(copy.uncertain).toBe(false);expect(copy.paths[2]).toBe(3)
      structuredClone(copy,{transfer:paintBuffers(copy)})
      expect(copy.points.byteLength).toBe(0);expect(page.paint!.points.byteLength).toBeGreaterThan(0)
    }finally{doc.destroy()}
  })
  it('upgrades a snap entry once without replacing snap arrays, accounts bytes and shares subscribers',async()=>{
    const doc=documentWith('0 0 10 10 re f')
    try{
      const plain=extractVectorPage(doc,0),painted=extractVectorPage(doc,0,undefined,true),pending=deferred<VectorPage>()
      const pool={extractVectors:vi.fn(({includePaint}:{includePaint?:boolean})=>({promise:includePaint?pending.promise:Promise.resolve(plain),cancel:vi.fn()}))}
      const cache=new VectorCache('doc'),page=await cache.get(0,pool)
      const a=cache.get(0,pool,undefined,true),b=cache.get(0,pool,undefined,true)
      await vi.waitFor(()=>expect(pool.extractVectors).toHaveBeenCalledTimes(2))
      expect(await cache.get(0,pool)).toBe(page) // Snap is not waiting for paint.
      pending.resolve(painted);expect(await a).toBe(page);expect(await b).toBe(page)
      expect(page.segments).toBe(plain.segments);expect(page.widths).toBe(plain.widths)
      expect(cache.bytes).toBe(page.segments.byteLength+page.widths.byteLength+paintBytes(page.paint))
      expect(cache.bytes).toBeLessThanOrEqual(VECTOR_CACHE_BYTES)
      expect(await cache.get(0,pool,undefined,true)).toBe(page);expect(pool.extractVectors).toHaveBeenCalledTimes(2)
      cache.clear();expect(cache.bytes).toBe(0)
    }finally{doc.destroy()}
  })
  it.each(['abort','clear'] as const)('cancels an appearance upgrade on %s and ignores its late result',async mode=>{
    const doc=documentWith('0 0 10 10 re f')
    try{
      const plain=extractVectorPage(doc,0),painted=extractVectorPage(doc,0,undefined,true),pending=deferred<VectorPage>(),cancel=vi.fn()
      const pool={extractVectors:vi.fn(({includePaint}:{includePaint?:boolean})=>({promise:includePaint?pending.promise:Promise.resolve(plain),cancel:includePaint?cancel:vi.fn()}))}
      const cache=new VectorCache('doc');await cache.get(0,pool)
      const controller=new AbortController(),task=cache.get(0,pool,controller.signal,true),rejected=expect(task).rejects.toThrow('cancelled')
      await vi.waitFor(()=>expect(pool.extractVectors).toHaveBeenCalledTimes(2))
      if(mode==='abort')controller.abort();else cache.clear()
      pending.resolve(painted);await rejected;expect(cancel).toHaveBeenCalledOnce();expect(plain.paint).toBeUndefined()
      cache.clear();expect(cache.bytes).toBe(0)
    }finally{doc.destroy()}
  })
  it('transfers one copy when target and sample share paint, then terminates the task Worker',async()=>{
    const doc=documentWith('0 0 10 10 re f'),page=extractVectorPage(doc,0,undefined,true)
    let received:unknown,transfers:Transferable[]=[];const terminate=vi.fn()
    vi.stubGlobal('Worker',class {
      onmessage:((e:unknown)=>void)|null=null;terminate=terminate
      postMessage(message:unknown,transfer:Transferable[]){transfers=transfer;received=structuredClone(message,{transfer});queueMicrotask(()=>this.onmessage?.({data:{type:'vector-result',id:1,result:null}}))}
    })
    try{
      await vectorWorkerTask({type:'vector-search',id:1,segments:page.segments,sampleSegments:page.segments,sampleWidths:page.widths,sampleRect:[0,0,10,10],options:{},paint:page.paint,samplePaint:page.paint})
      const message=received as {paint:unknown;samplePaint:unknown}
      expect(message.paint).toBe(message.samplePaint);expect(transfers).toHaveLength(6)
      expect(page.paint!.points.byteLength).toBeGreaterThan(0);expect(terminate).toHaveBeenCalledOnce()
    }finally{doc.destroy()}
  })
})
