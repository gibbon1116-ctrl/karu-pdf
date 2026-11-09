import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultVectorTolerance, scoreVectorPlacements, vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import { scoreVectorMessage, searchVectorMessage, type SymbolSearchMessage, type SymbolSearchResponse } from '../src/worker/symbolSearchMessages'
import { SymbolSearchClient } from '../src/client/SymbolSearchClient'
import type { CachedVectorPage, VectorCache } from '../src/client/VectorCache'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { Point, Rect } from '../src/core/annotations'

const sample = new Float32Array([0,0,20,0, 20,0,20,12, 20,12,0,12, 0,12,0,0, 3,3,8,6])
const widths = new Float32Array(sample.length / 4).fill(.5)
const rect: Rect = [-1,-1,21,13]
const manual = { segments: sample, widths }
const stamp = (angle: number, center: Point) => new Float32Array(Array.from(sample, (v, i) => {
  const x = sample[i - i % 2] - 10, y = sample[i - i % 2 + 1] - 6
  return i % 2 ? center[1] + Math.sin(angle)*x + Math.cos(angle)*y : center[0] + Math.cos(angle)*x - Math.sin(angle)*y
}))
const coverage = (data: Float32Array, center: Point, angle = 0) => scoreVectorPlacements(data, rect, [{ center, angle }], sample, widths,
  new Float32Array(data.length / 4).fill(.5), manual)

describe('既存位置のベクター被覆率', () => {
  it('正しい中心と角度でほぼ1になる', () => {
    expect(coverage(stamp(Math.PI / 2, [80,60]), [80,60], 90).scores[0]).toBeCloseTo(1)
  })
  it('tolerance 程度の中心ずれを5×5で補正する', () => {
    const tolerance = defaultVectorTolerance([0,0,20,12]), trueCenter: Point = [80,60]
    const result = coverage(stamp(0,trueCenter), [80 + tolerance*1.5,60])
    expect(result.scores[0]).toBeCloseTo(1)
    expect(Math.abs(result.centers[0] - trueCenter[0])).toBeLessThanOrEqual(tolerance + 1e-5)
    expect(result.centers[0]).toBeLessThan(80 + tolerance*1.5)
  })
  it('別の形では被覆率が低い', () => {
    expect(coverage(new Float32Array([70,60,90,60, 80,54,80,66]), [80,60]).scores[0]).toBeLessThan(.3)
  })
  it('501件を拒否し中断も有効', () => {
    const targets = Array.from({ length: 501 }, () => ({ center: [10,6] as Point, angle: 0 }))
    expect(() => scoreVectorPlacements(sample,rect,targets,sample,widths)).toThrow('500')
    expect(() => scoreVectorPlacements(sample,rect,targets.slice(0,1),sample,widths,undefined,manual,{shouldStop:()=>true})).toThrow('cancelled')
  })
  it('既存テストと同じ矩形データの得点と入力を補完評価前後で維持する', () => {
    const thin = [0,0,3,0, 3,0,3,19, 3,19,0,19, 0,19,0,0]
    const data = new Float32Array([...thin, ...thin.map((v,i) => i % 2 ? v : v+60)])
    const aligned = new Float32Array(8).fill(.5), before = data.slice(), beforeWidths = aligned.slice()
    const sampleRect: Rect = [0,0,3,19]
    const search = () => vectorSymbolSearch(data,sampleRect,{threshold:.9},data,aligned,aligned)
    const original = search()
    expect(original.matches.map(m=>m.score)).toEqual([.9999999999999999,.9999999999999999])
    scoreVectorPlacements(data,sampleRect,original.matches.map(m=>({center:m.center,angle:m.angle})),data,aligned,aligned)
    expect(search().matches).toEqual(original.matches)
    expect(data).toEqual(before); expect(aligned).toEqual(beforeWidths)
  })
  it('見本と対象の線幅制限を保つ', () => {
    const target = stamp(0,[80,60])
    const result = scoreVectorPlacements(target,rect,[{center:[80,60],angle:0}],sample,widths,
      new Float32Array(target.length/4).fill(.1),manual)
    expect(result.scores[0]).toBe(0)
  })
})

function pageData(segments: Float32Array, kind: 'vector' | 'mixed' | 'raster' = 'vector'): CachedVectorPage {
  return { kind, pageIndex: 0, segments, widths: new Float32Array(segments.length/4).fill(.5), segmentCount: segments.length/4,
    truncated: false, stats: {strokePaths: segments.length/4,fillPaths:0,whiteFills:0,curves:0,images:0,imageAreaRatio:0,textGlyphs:0,
      ms:{displayList:0,walk:0,total:0}} }
}
function setup({ found = false, imageCount = 1, kind = 'mixed', hold = '', rejected = 0, confirmed = false }: {
  found?: boolean; imageCount?: number; kind?: 'vector'|'mixed'|'raster'; hold?: string; rejected?: number; confirmed?: boolean
} = {}) {
  const messages: SymbolSearchMessage[] = [], held: Array<() => void> = []
  vi.stubGlobal('Worker', class {
    onmessage: ((event: {data:SymbolSearchResponse})=>void)|null = null
    onerror = null; onmessageerror = null
    terminate = vi.fn()
    postMessage(message: SymbolSearchMessage) {
      messages.push(message)
      const respond = () => queueMicrotask(() => {
        let response: SymbolSearchResponse
        if (message.type === 'vector-search') {
          const result = searchVectorMessage(message)!
          result.rejected = Array.from({length:rejected},(_,i)=>({rect:[60+i*30,60,80+i*30,72],center:[70+i*30,66],
            angle:0,score:1,extra:0,around:0,rejectReason:'structure',source:'secondary'}))
          result.stats.structureExcludedSites = rejected
          response = {type:'vector-result',id:message.id,result}
        } else if (message.type === 'vector-coverage') {
          const result = scoreVectorMessage(message)
          if (confirmed) {result.scores.fill(1);result.centers.forEach((v,i)=>{if(i%2===0)result.centers[i]=v+1})}
          response = {type:'vector-coverage-result',id:message.id,...result}
        }
        else if (message.type === 'search') response = {type:'result',id:message.id,
          matches:Array.from({length:imageCount},(_,i)=>({x:84+i*30,y:84,width:24,height:14.4,score:.95-i*.0001,rotation:0})),
          stats:{workerMs:1,coarseCandidates:imageCount,refined:imageCount,levels:1,ms:{coarse:0,refine:1}} as Extract<SymbolSearchResponse,{type:'result'}>['stats'],
          memory:{pagePixels:100,bytes:200,estimated:true}}
        else throw Error('Unexpected Worker message')
        this.onmessage?.({data:response})
      })
      if (message.type === hold) held.push(respond)
      else respond()
    }
  })
  const source = pageData(sample), target = pageData(found ? stamp(0,[80,60]) : new Float32Array([100,100,110,100,110,100,110,105]),kind)
  const sourceCache = {get:vi.fn(async()=>source),getLabels:vi.fn(async()=>[])}, targetCache = {get:vi.fn(async()=>target),getLabels:vi.fn(async()=>[])}
  const pool = {ensureRenderDocument:vi.fn(async()=>{}),renderSearchImage:vi.fn(()=>({cancel:vi.fn(),promise:Promise.resolve({width:240,height:240,gray:new Uint8Array(240*240)})}))}
  const client = new SymbolSearchClient(pool as unknown as PdfWorkerPool,undefined,docId=>(docId==='source'?sourceCache:targetCache) as unknown as VectorCache)
  const request = {docId:'target',sampleDocId:'source',pageIndex:0,samplePageIndex:0,sampleRect:rect,searchRect:[0,0,200,200] as Rect,
    sampleLines:manual,verify:false,options:{threshold:.99,rotations:false,maxResults:500}}
  return {client,request,pool,messages,held,source,target}
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})

describe('0件だけの画像補完', () => {
  it('既定はoffで通常候補があるauto検索でも画像検索を増やさない', async () => {
    for (const found of [false,true]) {
      const {client,request,messages,pool} = setup({found})
      try {
        const result = await client.search({...request,...(found?{supplement:'auto' as const}:{})}).promise
        expect(messages.filter(m=>m.type==='search')).toHaveLength(0)
        expect(pool.renderSearchImage).not.toHaveBeenCalled()
        expect(result.supplemented).toBe(false)
        expect(result.diagnostics.method).toBe('vector')
      } finally {client.dispose()}
    }
  })
  it('1枚の範囲画像で補完し線との整合が低くても要確認で返す', async () => {
    const {client,request,messages,pool,source,target} = setup()
    const original = target.segments.slice()
    try {
      const result = await client.search({...request,supplement:'auto'}).promise
      expect(result).toMatchObject({method:'vector',supplemented:true,diagnostics:{method:'vector+image',supplement:{image:{candidates:1,vectorConfirmed:0,added:1}}}})
      expect(result.candidates[0]).toMatchObject({confidence:'check',supplement:'image',vectorScore:0})
      expect(pool.renderSearchImage).toHaveBeenCalledTimes(2)
      const coverageMessage = messages.find(m=>m.type==='vector-coverage')!
      expect(coverageMessage).toMatchObject({sampleRect:rect})
      if(coverageMessage.type!=='vector-coverage') throw Error('expected coverage')
      expect(coverageMessage.segments).not.toBe(target.segments)
      expect(coverageMessage.sampleSegments).not.toBe(source.segments)
      expect(target.segments).toEqual(original)
    } finally {client.dispose()}
  })
  it('画像候補は得点上位500件までを整合確認する', async () => {
    const {client,request,messages} = setup({imageCount:501})
    try {
      const result = await client.search({...request,supplement:'always'}).promise
      expect(result.candidates).toHaveLength(500)
      expect(messages.find(m=>m.type==='vector-coverage')).toHaveProperty('targets.length',500)
    } finally {client.dispose()}
  })
  it('線との整合が取れた画像候補は中心と矩形を補正しても要確認のまま', async () => {
    const {client,request,messages} = setup({confirmed:true})
    try {
      const result = await client.search({...request,supplement:'auto'}).promise
      const coverage = messages.find(m=>m.type==='vector-coverage')!
      if(coverage.type!=='vector-coverage') throw Error('expected coverage')
      const before = coverage.targets[0].center, candidate = result.candidates[0]
      expect(candidate).toMatchObject({confidence:'check',vectorScore:1,center:[before[0]+1,before[1]]})
      expect((candidate.rect[0]+candidate.rect[2])/2).toBeCloseTo(candidate.center[0])
      expect(result.diagnostics.supplement?.image?.vectorConfirmed).toBe(1)
    } finally {client.dispose()}
  })
  it.each([false,true])('includeRejected=%s でも構造除外は最大500件を画像処理なしで返す', async includeRejected => {
    const {client,request,messages,pool} = setup({rejected:501})
    try {
      const result = await client.search({...request,includeRejected}).promise
      expect(result.candidates).toHaveLength(0); expect(result.rejectedCandidates).toHaveLength(500)
      expect(result.rejectedCandidates.every(c=>c.rejected==='structure'&&c.confidence==='check'&&c.source==='secondary')).toBe(true)
      expect(result.diagnostics).toMatchObject({structureExcluded:501,final:0})
      expect(messages.map(m=>m.type)).toEqual(['vector-search'])
      expect(pool.renderSearchImage).not.toHaveBeenCalled()
    } finally {client.dispose()}
  })
  it('画像だけのページも線の集計を推測せず診断を返す', async () => {
    const {client,request,messages} = setup({kind:'raster'})
    try {
      const result = await client.search({...request,supplement:'auto'}).promise
      expect(result).toMatchObject({method:'image',supplemented:false,diagnostics:{method:'image'}})
      expect(result.diagnostics.extractedSegments).toBeUndefined()
      expect(messages.map(m=>m.type)).toEqual(['search'])
    } finally {client.dispose()}
  })
  it.each(['search','vector-coverage'])('%s待機中も中止でき次の検索が正常に終わる', async hold => {
    const {client,request,messages,held} = setup({hold})
    try {
      const task = client.search({...request,supplement:'auto'})
      const rejected = expect(task.promise).rejects.toThrow('cancelled')
      await vi.waitFor(()=>expect(held).toHaveLength(1))
      task.cancel(); await rejected
      held.shift()!()
      const next = client.search({...request,supplement:'auto'})
      await vi.waitFor(()=>expect(held).toHaveLength(1))
      held.shift()!()
      expect((await next.promise).candidates[0].confidence).toBe('check')
      expect(messages.some(m=>m.type==='vector-coverage')).toBe(true)
    } finally {client.dispose()}
  })
})
