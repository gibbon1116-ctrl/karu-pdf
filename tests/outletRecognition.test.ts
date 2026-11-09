import fs from 'node:fs'
import {describe,expect,it} from 'vitest'
import mupdf from 'mupdf'
import {extractVectorPage} from '../src/worker/vectorExtract'
import {searchVectorMessage} from '../src/worker/symbolSearchMessages'
import {outletRecognitionFixture,outletRecognitionAccuracy,type OutletTruth} from './outletRecognitionFixtures'

describe('original outlet PDF recognition',()=>{
  it('records every sample before checking recall, structure, labels and thin strokes',()=>{
    const fixture=outletRecognitionFixture(),pdf=new mupdf.PDFDocument(fixture.bytes)
    const rows:Array<{sample:string;page:number;tp:number;fp:number;fn:number;stats:NonNullable<ReturnType<typeof searchVectorMessage>>['stats'];unexpected:number[][];matches:NonNullable<ReturnType<typeof searchVectorMessage>>['matches']}> = []
    try {
      const pages=Array.from({length:pdf.countPages()},(_,i)=>extractVectorPage(pdf,i,undefined,true))
      const run=(sample:OutletTruth,pageIndex=sample.pageIndex)=>{
        const source=pages[sample.pageIndex],target=pages[pageIndex]
        expect(source.truncated).toBe(false);expect(target.truncated).toBe(false)
        const result=searchVectorMessage({type:'vector-search',id:1,segments:target.segments,segmentWidths:target.widths,
          sampleSegments:source.segments,sampleWidths:source.widths,sampleRect:sample.rect,paint:target.paint,samplePaint:source.paint,
          options:{rotations:true,threshold:.85}})!
        const accuracy=outletRecognitionAccuracy(fixture.truth,sample,result.matches.map(m=>m.center),pageIndex)
        rows.push({sample:sample.id,page:pageIndex,...accuracy,stats:result.stats,matches:result.matches})
        for(const rejected of result.rejected) {
          expect(rejected.rejectReason).toBe('structure')
          expect(result.matches.every(m=>Math.hypot(m.center[0]-rejected.center[0],m.center[1]-rejected.center[1])>=8.9)).toBe(true)
        }
        expect(result.stats.structureExcludedSites).toBeGreaterThanOrEqual(result.rejected.length)
        expect(result.stats.geometrySites).toBeGreaterThanOrEqual(result.matches.length)
      }
      for(const sample of fixture.truth.filter(t=>t.id.endsWith('-0'))) run(sample)
      const standard=fixture.truth.find(t=>t.pageIndex===0&&t.id.endsWith('-0'))!
      run(standard,4)
      // All rows are produced even if an acceptance assertion below fails.
      for(const row of rows) {
        if(row.page<=1) expect(row.fn,row.sample).toBe(0)
        if(row.page===2) for(const center of row.unexpected) {
          const match=row.matches.find(m=>Math.hypot(m.center[0]-center[0],m.center[1]-center[1])<.01)!
          expect(match.extra>.4||match.structureCheck===true,`${row.sample}: ${center}`).toBe(true)
        }
        if(row.page===3) expect(row.fn,row.sample).toBe(0)
        if(row.page===4&&row.sample===standard.id) expect(row.matches).toHaveLength(0)
      }
      expect(rows.some(row=>row.stats.structureExcluded>0)).toBe(true)
      for(const pageIndex of [0,1]) expect(rows.find(row=>row.page===pageIndex)!.tp).toBe(fixture.truth.filter(t=>t.pageIndex===pageIndex).length)
    } finally {
      pdf.destroy()
      const label=process.env.RECALL_REPORT
      if(label&&/^[a-z0-9-]+$/.test(label)) {
        fs.mkdirSync('work/vector-recall',{recursive:true})
        fs.writeFileSync(`work/vector-recall/${label}-outlet-accuracy.json`,JSON.stringify({rows},null,2)+'\n')
      }
    }
  },30_000)
})
