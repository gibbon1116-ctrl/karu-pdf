import { VectorCache, vectorWorkerTask, SYMBOL_SEARCH_STALL_MS } from './VectorCache'
import { paintBytes } from '../core/vectorPaint'
import type { VectorSearchResult, LocalDescribedBody, LocalShape } from '../worker/symbolSearchMessages'
import { assignSymbolLabels, normalizeSymbolLabel, UNKNOWN_SYMBOL_LABEL, type SymbolLabelValue } from '../core/symbolLabels'
import { compareLocalLabel } from '../core/symbolGlyphs'
import { planLocalImageTiles, compareLocalBody, type LocalBody } from '../core/symbolLocalImage'
import { decideSymbolShape, type SymbolShapeDecision } from '../core/symbolShapeDecision'
import type { SymbolVectorFeatureProbe } from '../core/symbolFeatureProfile'
/* @single:start */import { createSingleWorker } from '../single/runtime'
/* @single:end */import type { Point, Rect } from '../core/annotations'
export { SYMBOL_SEARCH_STALL_MS } from './VectorCache'
import type { SymbolSearchOptions } from '../core/symbolSearch'
import type { SearchImage } from '../worker/protocol'
import type { PdfWorkerPool } from './PdfWorkerPool'
import type { SymbolSearchMessage, SymbolSearchResponse, WorkerSearchOptions } from '../worker/symbolSearchMessages'

export interface SymbolSearchRequest {
  docId: string; pageIndex: number; sampleRect: Rect; samplePageIndex: number
  searchRect?: Rect; options?: Partial<SymbolSearchOptions>; verify?: boolean; splitG?: boolean; shapeCheck?: boolean
}
export interface SymbolCandidate { pageIndex: number; rect: Rect; center: Point; score: number; rotation: number
  confidence?: 'high' | 'check'; imageScore?: number; extra?: number; around?: number; aroundCheck?: boolean; label?: string; gc?: boolean
  structureScore?:number;fillScore?:number;structureCheck?:boolean;shape?:SymbolShapeDecision }
// Image similarity only grades line matches; it never removes them. On real drawings the
// correct line matches scored 0.17-1.00 (median 0.70; text and lines crossing the symbol pull
// it down) while the wrong ones scored 0.16-0.30, so the bar sits well below whole-page image
// matching's: 0.35 at the default 0.85 (七ヶ浜町 p.1 desks, docs/調査/数量拾いUI改修_計画.md).
export const imageConfidenceThreshold = (threshold: number) => Math.max(.20, Math.min(.60, threshold - .50))
export function imageConfidence(score: number, threshold: number): 'high' | 'check' {
  return score >= imageConfidenceThreshold(threshold) ? 'high' : 'check'
}
export interface SymbolSearchMetrics {
  renderScale: number; pagePixels: number; renderMs: number; transferMs: number; searchMs: number
  coarseCandidates: number; refined: number; totalMs: number
  requestedRenderScale: number; scaleReduced: boolean; renderTiles: number
  /** Conservative Worker buffer estimate; browser/GPU overhead is excluded. */
  estimatedWorkerBytes: number; levels: number; coarseMs: number; refineMs: number
  vectorMs: number; verifyRenderMs: number; verifyMs: number
  localMs?: number; localPeakBytes?: number
  shapeMs?: number; shapeDifferent?: number; shapeUnknown?: number
}
export interface SymbolSearchResult { candidates: SymbolCandidate[]; metrics: SymbolSearchMetrics; method: 'vector' | 'image'; vectorDetails?: VectorSearchResult; sampleLabel: string; sampleGc: boolean }
export interface SymbolSearchTestHooks {
  symbolSearch(request: SymbolSearchRequest): Promise<SymbolSearchResult>
  symbolSearchCancelTest(request: SymbolSearchRequest, afterMs: number): Promise<{ cancelled: boolean; settledMs: number }>
}
interface Running {
  id: number; done: boolean; renders: Set<{ cancel(): void }>
  reject(error: Error): void; cancel?: () => void; abort: AbortController
}
type PageSizeProvider = (docId: string, pageIndex: number) => { width: number; height: number } | undefined
const MAX_PIXELS = 16_000_000
function validRect(rect: Rect): void {
  if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) throw new Error('invalid rectangle')
}
function deviceRect(rect: Rect, scale: number): Rect {
  return [Math.floor(rect[0] * scale), Math.floor(rect[1] * scale), Math.ceil(rect[2] * scale), Math.ceil(rect[3] * scale)]
}
export class SymbolSearchClient {
  private worker: Worker | null = null
  private running: Running | null = null
  private disposed = false
  private nextId = 0
  private caches = new Map<string, VectorCache>()

  /** Pass existing page dimensions to avoid getPageInfo's all-page text extraction. */
  constructor(private pool: PdfWorkerPool, private pageSize?: PageSizeProvider, private cacheFor?: (docId: string) => VectorCache | undefined) {}

  search(request: SymbolSearchRequest, onProgress?: (stage: 'render' | 'search' | 'vector' | 'verify', done: number, total: number) => void): { promise: Promise<SymbolSearchResult>; cancel(): void } {
    if (this.disposed || this.running) return { promise: Promise.reject(new Error(this.disposed ? 'disposed' : 'search already running')), cancel() {} }
    const started = performance.now()
    let resolve!: (result: SymbolSearchResult) => void, reject!: (error: Error) => void
    const promise = new Promise<SymbolSearchResult>((yes, no) => { resolve = yes; reject = no })
    const run: Running = { id: ++this.nextId, done: false, renders: new Set(), reject, abort: new AbortController() }
    this.running = run
    const check = () => { if (run.done || this.disposed) throw new Error('cancelled') }
    let lastHeard = performance.now()
    const watchdog = setInterval(() => {
      if (performance.now() - lastHeard > SYMBOL_SEARCH_STALL_MS) fail(new Error('照合が応答しなくなったため中止しました。もう一度探してください。'))
    }, 1000)
    const fail = (error: Error) => {
      if (run.done) return
      run.done = true; clearInterval(watchdog); run.abort.abort()
      for (const task of run.renders) task.cancel()
      run.renders.clear()
      this.worker?.terminate(); this.worker = null
      if (this.running === run) this.running = null
      reject(error)
    }
    run.cancel = () => fail(new Error('cancelled'))
    void (async () => {
      if (!Number.isInteger(request.pageIndex) || request.pageIndex < 0 || !Number.isInteger(request.samplePageIndex) || request.samplePageIndex < 0) throw new Error('invalid page')
      validRect(request.sampleRect)
      let rect = request.searchRect
      if (!rect) {
        // This fallback is explicit-search-only. The App hook always supplies known sizes.
        const size = this.pageSize ? this.pageSize(request.docId, request.pageIndex) : (await this.pool.getPageInfo(request.docId))[request.pageIndex]
        check()
        if (!size) throw new Error('page unavailable')
        rect = [0, 0, size.width, size.height]
      }
      validRect(rect)
      let vector: VectorSearchResult | undefined
      let sampleValue: SymbolLabelValue = { label: '', gc: false }, labelValues: SymbolLabelValue[] = []
      let vectorBytes = 0, vectorFinished = 0
      let localTiles=0,localPeakBytes=0,localMs=0
      let shapeDecisions:SymbolShapeDecision[]|undefined,shapeMs=0,localDifferent:boolean[]|undefined
      const localWorker = () => this.worker ??= /* @single:start */createSingleWorker('symbol-search') ?? /* @single:end */new Worker(new URL('../worker/symbolSearch.worker.ts', import.meta.url), { type: 'module' })
      const describeLocal=async(pageIndex:number,bodies:Rect[],scale:number,probes?:Array<SymbolVectorFeatureProbe|undefined>):Promise<Array<LocalDescribedBody|undefined>>=>{
        const descriptions:Array<LocalDescribedBody|undefined>=new Array(bodies.length),began=performance.now()
        let described=0
        // Shape probes confirm attachments up to 0.6 x the long side around a body, which is the
        // tile margin itself. Plan from padded bodies so a lone sample keeps those corners in the crop.
        const planned=probes?bodies.map(b=>{const pad=Math.max(b[2]-b[0],b[3]-b[1])*.08+.25;return [b[0]-pad,b[1]-pad,b[2]+pad,b[3]+pad] as Rect}):bodies
        for(const tile of planLocalImageTiles(planned,scale)){
          check()
          const task=this.pool.renderSearchImage({docId:request.docId,pageIndex,renderScale:scale,deviceRect:tile.rect})
          run.renders.add(task)
          let image:SearchImage
          try{image=await task.promise;check();lastHeard=performance.now()}finally{run.renders.delete(task)}
          localTiles++;localPeakBytes=Math.max(localPeakBytes,image.gray.byteLength*4)
          const response=await vectorWorkerTask({type:'local-describe',id:run.id,image,bodies:tile.indices.map(i=>[
            bodies[i][0]*scale-tile.rect[0],bodies[i][1]*scale-tile.rect[1],bodies[i][2]*scale-tile.rect[0],bodies[i][3]*scale-tile.rect[1]]),
            ...(probes?{shape:{origin:[tile.rect[0]/scale,tile.rect[1]/scale] as Point,scale,probes:tile.indices.map(i=>probes[i])}}:{})},run.abort.signal,
            ()=>{lastHeard=performance.now()},localWorker())
          check();lastHeard=performance.now()
          if(response.type!=='local-described'||response.bodies.length!==tile.indices.length)throw Error('Invalid local image response')
          tile.indices.forEach((i,j)=>{
            const d=response.bodies[j]
            for(const glyph of d.label?.glyphs??[])glyph.rect=[(glyph.rect[0]+tile.rect[0])/scale,(glyph.rect[1]+tile.rect[1])/scale,(glyph.rect[2]+tile.rect[0])/scale,(glyph.rect[3]+tile.rect[1])/scale]
            descriptions[i]=d
          })
          described+=tile.indices.length;onProgress?.('verify',described,bodies.length)
        }
        localMs+=performance.now()-began;return descriptions
      }
      const finishVector = (candidates: SymbolCandidate[], verification?: { renderScale: number; requestedRenderScale: number; pagePixels: number; renderMs: number; verifyMs: number; bytes: number }) => {
        const result = vector!, searchMs = result.stats.ms
        run.done = true; clearInterval(watchdog); this.running = null
        if (this.worker) {
          this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null
          // Search-scoped font models and glyph buffers do not survive a search.
          if(localTiles){this.worker.terminate();this.worker=null}
        }
        resolve({ method: 'vector', vectorDetails: result, ...{ sampleLabel: sampleValue.label, sampleGc: sampleValue.gc },
          candidates: candidates.map((c, i) => {
            const aroundCheck = (c.around ?? 0) - result.template.sampleAround > .3
            const shape=shapeDecisions?.[i]
            return { ...c, ...labelValues[i], ...(shape?{shape}:{}), aroundCheck, confidence: aroundCheck || c.structureCheck || (shape&&shape.decision!=='same') || sampleValue.label===UNKNOWN_SYMBOL_LABEL || labelValues[i]?.label===UNKNOWN_SYMBOL_LABEL ? 'check' : c.confidence }
          }),
          metrics: { renderScale: verification?.renderScale ?? 0, requestedRenderScale: verification?.requestedRenderScale ?? 0,
            scaleReduced: !!verification && verification.renderScale < verification.requestedRenderScale, renderTiles: localTiles+(verification ? 2 : 0),
            pagePixels: verification?.pagePixels ?? 0, renderMs: Math.max(0, vectorFinished-started-searchMs) + (verification?.renderMs ?? 0),
            transferMs: verification ? Math.max(0, performance.now()-vectorFinished-verification.renderMs-verification.verifyMs) : 0,
            searchMs, totalMs: performance.now()-started, coarseCandidates: result.stats.anchorsTried, refined: result.matches.length,
            estimatedWorkerBytes: vectorBytes + localPeakBytes + (verification?.bytes ?? 0), levels: 0, coarseMs: 0, refineMs: searchMs,
            vectorMs: searchMs, verifyRenderMs: verification?.renderMs ?? 0, verifyMs: verification?.verifyMs ?? 0,
            localMs,localPeakBytes,
            ...(shapeDecisions?{shapeMs,shapeDifferent:shapeDecisions.filter(s=>s.decision==='different').length,shapeUnknown:shapeDecisions.filter(s=>s.decision==='unknown').length}:{}) } })
      }
      let cache = this.cacheFor?.(request.docId) ?? this.caches.get(request.docId)
      if (!cache) { cache = new VectorCache(request.docId); this.caches.set(request.docId, cache) }
      onProgress?.('render', 0, 1)
      const samplePage = await cache.get(request.samplePageIndex, this.pool, run.abort.signal, true)
      check(); lastHeard = performance.now()
      if (samplePage.kind === 'vector' || samplePage.kind === 'mixed') {
        const target = request.pageIndex === request.samplePageIndex ? samplePage : await cache.get(request.pageIndex, this.pool, run.abort.signal, true)
        check(); lastHeard = performance.now()
        if (target.kind === 'vector' || target.kind === 'mixed') {
          onProgress?.('vector', 0, 1)
          const response = await vectorWorkerTask({ type: 'vector-search', id: run.id, segments: target.segments,
            segmentWidths: target.widths,
            sampleSegments: samplePage.segments, sampleWidths: samplePage.widths, sampleRect: request.sampleRect,
            paint:target.paint,samplePaint:samplePage.paint,
            ...(request.shapeCheck?{features:{complete:!target.truncated&&target.kind==='vector',sampleComplete:!samplePage.truncated&&samplePage.kind==='vector',samePage:request.pageIndex===request.samplePageIndex}}:{}),
            options: { threshold: request.options?.threshold ?? .85, rotations: request.options?.rotations ?? false,
              maxResults: request.options?.maxResults ?? 500, region: rect } }, run.abort.signal,
            () => { lastHeard = performance.now(); onProgress?.('vector', 0, 1) })
          check(); lastHeard = performance.now()
          if (response.type !== 'vector-result') throw Error('Invalid vector response')
          if (response.result) {
            vector = response.result; vectorFinished = performance.now()
            const probes=request.shapeCheck?response.probes:undefined
            let sampleShape:LocalShape|undefined,matchShapes:Array<LocalShape|undefined>|undefined
            const targetLabels = await cache.getLabels(request.pageIndex, this.pool, run.abort.signal)
            check(); lastHeard = performance.now()
            const sampleLabels = request.pageIndex === request.samplePageIndex ? targetLabels : await cache.getLabels(request.samplePageIndex, this.pool, run.abort.signal)
            check(); lastHeard = performance.now()
            const body = vector.template.rect, radius = Math.max(body[2] - body[0], body[3] - body[1])
            labelValues = assignSymbolLabels(targetLabels, vector.matches, radius, request.splitG ?? true)
            // Use all bodies on the sample page as competitors, so a neighboring
            // body's overlapping label cannot be stolen by the selected sample.
            const sampleBodies = request.pageIndex === request.samplePageIndex ? vector.matches.filter(m => Math.hypot(m.center[0] - (body[0] + body[2]) / 2, m.center[1] - (body[1] + body[3]) / 2) > .01) : []
            sampleValue = assignSymbolLabels(sampleLabels, [{ rect: body }, ...sampleBodies], radius, request.splitG ?? true)[0]
            if(samplePage.paint&&(samplePage.paint.truncated||target.paint?.truncated||!sampleValue.label)){
              const scale=Math.min(8,128/Math.max(body[2]-body[0],body[3]-body[1]))
              const [sample]=await describeLocal(request.samplePageIndex,[body],scale,probes?[probes.sample]:undefined)
              if(sample){
                const descriptions=await describeLocal(request.pageIndex,vector.matches.map(m=>m.rect),scale,probes?.matches)
                if(request.shapeCheck){sampleShape=sample.shape;matchShapes=descriptions.map(d=>d?.shape)}
                const labels=[sample.label!,...descriptions.map(d=>d?.label??{text:'',status:'unknown' as const,glyphs:[]})]
                const resolveStarted=performance.now()
                const resolved=await vectorWorkerTask({type:'local-labels',id:run.id,labels},run.abort.signal,()=>{lastHeard=performance.now()},localWorker())
                check();lastHeard=performance.now()
                localMs+=performance.now()-resolveStarted
                if(resolved.type!=='local-labels-resolved'||resolved.labels.length!==labels.length)throw Error('Invalid local labels response')
                sample.label=resolved.labels[0];descriptions.forEach((d,i)=>{if(d)d.label=resolved.labels[i+1]})
                const keep:boolean[]=[],values:SymbolLabelValue[]=[]
                if(request.shapeCheck)localDifferent=[]
                const wordRect=(d:LocalBody):Rect=>{
                  const glyphs=d.label!.glyphs
                  return [Math.min(...glyphs.map(g=>g.rect[0])),Math.min(...glyphs.map(g=>g.rect[1])),Math.max(...glyphs.map(g=>g.rect[2])),Math.max(...glyphs.map(g=>g.rect[3]))]
                }
                const owned=(d:LocalBody|undefined,competitors:readonly {rect:Rect}[],index:number)=>!d?.label?.glyphs.length||assignSymbolLabels([{text:'X',rect:wordRect(d)}],competitors,radius,false)[index].label==='X'
                const valueFromImage=(d:LocalBody|undefined,competitors:readonly {rect:Rect}[],index:number):SymbolLabelValue=>{
                  const l=d?.label
                  if(!owned(d,competitors,index))return {label:UNKNOWN_SYMBOL_LABEL,gc:false}
                  if(l?.status==='read'&&normalizeSymbolLabel(l.text))return assignSymbolLabels([{text:l.text,rect:wordRect(d!)}],competitors,radius,request.splitG??true)[index]
                  return {label:l?.status==='none'?'':UNKNOWN_SYMBOL_LABEL,gc:false}
                }
                const nativeSample=sampleValue.label!==''||sampleValue.gc
                if(!nativeSample)sampleValue=valueFromImage(sample,[{rect:body},...sampleBodies],0)
                vector.matches.forEach((m,i)=>{
                  const d=descriptions[i],comparison=d&&(samplePage.paint?.truncated||target.paint?.truncated)?compareLocalBody(sample,d):'unknown'
                  if(comparison==='same'&&(samplePage.paint?.truncated||target.paint?.truncated))m.structureCheck=false
                  keep.push(request.shapeCheck===true||comparison!=='different')
                  if(localDifferent)localDifferent.push(comparison==='different')
                  let value=labelValues[i]
                  if(!value.label&&!value.gc){
                    value=valueFromImage(d,vector!.matches,i)
                    if(!nativeSample&&owned(d,vector!.matches,i)&&sample.label&&d?.label&&compareLocalLabel(sample.label,d.label)==='same'
                      &&sampleValue.label!==UNKNOWN_SYMBOL_LABEL)value={...sampleValue}
                    // A symmetric body may match at 180 degrees while its label
                    // stays upright. Keep a confident upright reading; uncertain
                    // shape-only inference cannot name rotated path lettering.
                    if(Math.abs(Math.sin(m.angle*Math.PI/360))>.01&&value.label&&d?.label?.status!=='read')value={label:UNKNOWN_SYMBOL_LABEL,gc:false}
                  }
                  values.push(value)
                })
                vector.matches=vector.matches.filter((_,i)=>keep[i]);labelValues=values.filter((_,i)=>keep[i])
                if(localDifferent)localDifferent=localDifferent.filter((_,i)=>keep[i])
                if(matchShapes)matchShapes=matchShapes.filter((_,i)=>keep[i])
              }else{
                if(!sampleValue.label)sampleValue={label:UNKNOWN_SYMBOL_LABEL,gc:sampleValue.gc}
                labelValues=labelValues.map(v=>v.label||v.gc?v:{label:UNKNOWN_SYMBOL_LABEL,gc:false})
              }
              vectorFinished=performance.now()
            }else if(request.shapeCheck){
              const scale=Math.min(8,128/Math.max(body[2]-body[0],body[3]-body[1]))
              const [sample]=await describeLocal(request.samplePageIndex,[body],scale,probes?[probes.sample]:undefined)
              const descriptions=await describeLocal(request.pageIndex,vector.matches.map(m=>m.rect),scale,probes?.matches)
              sampleShape=sample?.shape;matchShapes=descriptions.map(d=>d?.shape)
              vectorFinished=performance.now()
            }
            if(request.shapeCheck){
              check()
              const began=performance.now()
              shapeDecisions=vector.matches.map((_,i)=>{
                const decision=decideSymbolShape(sampleShape,matchShapes?.[i])
                if(!localDifferent?.[i])return decision
                const forced:SymbolShapeDecision={
                  ...decision,
                  decision:'different',
                  differences:[...decision.differences.filter(d=>d!=='interior'),'interior'],
                  unknown:decision.unknown.filter(d=>d!=='interior')
                }
                return forced
              })
              shapeMs=(probes?.ms??0)+performance.now()-began
            }
            vectorBytes = target.segments.byteLength + target.widths.byteLength + samplePage.segments.byteLength + samplePage.widths.byteLength
              +paintBytes(target.paint)+(samplePage.paint===target.paint?0:paintBytes(samplePage.paint))
            if (request.verify === false || vector.matches.length === 0) {
              finishVector(vector.matches.map(m => ({ ...m, pageIndex: request.pageIndex, rotation: m.angle,
                confidence: m.extra <= .4 ? 'high' : 'check' })))
              return
            }
          }
        }
      }
      const sampleRect = vector?.template.rect ?? request.sampleRect
      const requestedRenderScale = 24 / Math.max(sampleRect[2] - sampleRect[0], sampleRect[3] - sampleRect[1])
      let renderScale = requestedRenderScale
      const count = (scale: number) => Math.max(...[rect!, sampleRect].map(bounds => { const d = deviceRect(bounds, scale); return (d[2] - d[0]) * (d[3] - d[1]) }))
      if (count(renderScale) > MAX_PIXELS) {
        let lo = 0, hi = renderScale
        for (let i = 0; i < 52; i++) { const mid = (lo + hi) / 2; if (count(mid) <= MAX_PIXELS) lo = mid; else hi = mid }
        renderScale = lo
      }
      if (!Number.isFinite(renderScale) || renderScale <= 0) throw new Error('invalid render scale')
      const searchDevice = deviceRect(rect, renderScale), sampleDevice = deviceRect(sampleRect, renderScale)
      const renderTiles = 2 // Kept in the metrics schema: one page crop and one sample.
      let rendered = 0
      const renderStarted = performance.now()
      onProgress?.(vector ? 'verify' : 'render', 0, vector ? 4 : renderTiles)
      const render = async (pageIndex: number, bounds: Rect): Promise<SearchImage> => {
        check()
        const task = this.pool.renderSearchImage({ docId: request.docId, pageIndex, renderScale, deviceRect: bounds })
        run.renders.add(task)
        try {
          const result = await task.promise
          check(); lastHeard = performance.now() // Discard late arrays after cancellation; never start a search.
          onProgress?.(vector ? 'verify' : 'render', ++rendered, vector ? 4 : renderTiles)
          return result
        } finally { run.renders.delete(task) }
      }
      const page = await render(request.pageIndex, searchDevice)
      const template = await render(request.samplePageIndex, sampleDevice)
      check()
      if (vector) {
        const result = vector, verifyRenderMs = performance.now() - renderStarted
        // Bound rotated/prepared buffers and local integral tables; excludes JS/GC/GPU overhead.
        const side = Math.ceil(Math.hypot(template.width, template.height))
        const verifyBytes = page.gray.byteLength + template.gray.byteLength + result.matches.length * 4
          + 18 * side * side + 16 * (side + 7) * (side + 7)
        const worker = this.worker ??= /* @single:start */createSingleWorker('symbol-search') ?? /* @single:end */new Worker(new URL('../worker/symbolSearch.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<SymbolSearchResponse>) => {
          if (run.done || event.data.id !== run.id) return
          lastHeard = performance.now()
          const response = event.data
          if (response.type === 'progress') { onProgress?.('verify', 2 + 2 * response.done / Math.max(1, response.total), 4); return }
          if (response.type === 'error') { fail(new Error(response.message)); return }
          if (response.type !== 'verify-result' || response.scores.length !== result.matches.length) { fail(new Error('Invalid verify response')); return }
          finishVector(result.matches.map((m, i) => ({ ...m, pageIndex: request.pageIndex, rotation: m.angle,
            imageScore: response.scores[i], confidence: m.extra <= .4 ? imageConfidence(response.scores[i], request.options?.threshold ?? .85) : 'check' })),
            { renderScale, requestedRenderScale, pagePixels: page.width * page.height, renderMs: verifyRenderMs, verifyMs: response.verifyMs, bytes: verifyBytes })
        }
        worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'symbol verification Worker failed')) }
        worker.onmessageerror = () => fail(new Error('symbol verification message failed'))
        onProgress?.('verify', 2, 4)
        worker.postMessage({ type: 'verify', id: run.id, page, template, targets: result.matches.map(m => ({
          x: m.rect[0] * renderScale - searchDevice[0], y: m.rect[1] * renderScale - searchDevice[1],
          width: (m.rect[2] - m.rect[0]) * renderScale, height: (m.rect[3] - m.rect[1]) * renderScale, angle: m.angle })) } satisfies SymbolSearchMessage,
          [page.gray.buffer as ArrayBuffer, template.gray.buffer as ArrayBuffer])
        return
      }
      const renderMs = performance.now() - started
      // Callbacks are never structured-cloned. Pixel-space region is relative to the rendered crop.
      const input = request.options ?? {}, options: WorkerSearchOptions = { threshold: Math.max(.40, Math.min(.83, (input.threshold ?? .85) - .15)), rotations: input.rotations ?? false,
        maxResults: input.maxResults ?? 500, region: input.region ?? { x: rect[0] * renderScale - searchDevice[0], y: rect[1] * renderScale - searchDevice[1],
          width: (rect[2] - rect[0]) * renderScale, height: (rect[3] - rect[1]) * renderScale } }
      const worker = this.worker ??= /* @single:start */createSingleWorker('symbol-search') ?? /* @single:end */new Worker(new URL('../worker/symbolSearch.worker.ts', import.meta.url), { type: 'module' })
      const transferred = performance.now()
      worker.onmessage = (event: MessageEvent<SymbolSearchResponse>) => {
        lastHeard = performance.now()
        if (run.done || event.data.id !== run.id) return
        const response = event.data
        if (response.type === 'progress') { onProgress?.('search', response.done, response.total); return }
        if (response.type === 'error') { fail(new Error(response.message)); return }
        if (response.type !== 'result') { fail(new Error('Invalid image response')); return }
        const candidates: SymbolCandidate[] = response.matches.map(match => {
          const x = (match.x + searchDevice[0]) / renderScale, y = (match.y + searchDevice[1]) / renderScale
          const w = match.width / renderScale, h = match.height / renderScale
          return { pageIndex: request.pageIndex, rect: [x, y, x + w, y + h], center: [x + w / 2, y + h / 2], score: match.score, rotation: match.rotation, label: '', gc: false }
        })
        run.done = true; clearInterval(watchdog); this.running = null
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
        resolve({ method: 'image', candidates, sampleLabel: '', sampleGc: false, metrics: { renderScale, requestedRenderScale, scaleReduced: renderScale < requestedRenderScale, renderTiles,
          pagePixels: response.memory.pagePixels, renderMs, transferMs: Math.max(0, performance.now() - transferred - response.stats.workerMs),
          searchMs: response.stats.workerMs, coarseCandidates: response.stats.coarseCandidates, refined: response.stats.refined, totalMs: performance.now() - started,
          estimatedWorkerBytes: response.memory.bytes, levels: response.stats.levels, coarseMs: response.stats.ms.coarse, refineMs: response.stats.ms.refine,
          vectorMs: 0, verifyRenderMs: 0, verifyMs: 0 } })
      }
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'symbol search Worker failed')) }
      worker.onmessageerror = () => fail(new Error('symbol search message failed'))
      onProgress?.('search', 0, 1)
      worker.postMessage({ type: 'search', id: run.id, page, template, renderScale, options } satisfies SymbolSearchMessage, [page.gray.buffer as ArrayBuffer, template.gray.buffer as ArrayBuffer])
      // Ownership of both gray buffers belongs to the Worker after transfer.
    })().catch(error => fail(error instanceof Error ? error : new Error(String(error))))
    return { promise, cancel: () => fail(new Error('cancelled')) }
  }

  /** End the active search and release client-owned caches/Workers. A cache supplied
   * by cacheFor remains document-owned and is invalidated by its DocumentSession. */
  dispose(): void {
    this.disposed = true
    this.running?.cancel?.()
    for (const cache of this.caches.values()) cache.clear()
    this.caches.clear()
    this.worker?.terminate(); this.worker = null
  }
}
