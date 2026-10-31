import fs from 'node:fs'
import {describe,expect,it} from 'vitest'
import mupdf from 'mupdf'
import {extractVectorPage} from '../src/worker/vectorExtract'
import {vectorSymbolSearch} from '../src/core/vectorSymbolSearch'
import {recognitionAccuracy,recognitionFixture} from './symbolRecognitionFixtures'
import {searchVectorMessage} from '../src/worker/symbolSearchMessages'

describe('independently drawn recognition truth',()=>{
  it('has two instances of each primitive and records geometry baseline separately from truth',()=>{
    const fixture=recognitionFixture(),pdf=new mupdf.PDFDocument(fixture.bytes),rows:unknown[]=[]
    try{
      expect(pdf.countPages()).toBe(5)
      for(let pageIndex=0;pageIndex<5;pageIndex++){
        const page=extractVectorPage(pdf,pageIndex)
        expect(page.truncated).toBe(false)
        for(const sample of fixture.truth.filter(t=>t.pageIndex===pageIndex&&t.id.endsWith('-0'))){
          const result=vectorSymbolSearch(page.segments,sample.rect,{threshold:.85,rotations:false},page.segments,page.widths,page.widths)
          rows.push({id:sample.id,pageIndex,...recognitionAccuracy(fixture.truth,sample,result.matches.map(m=>m.center)),matches:result.matches})
        }
      }
      // The oracle is checked now; improvement acceptance is added in Phase 5.
      expect(fixture.truth).toHaveLength(54)
      if(process.env.RECOGNITION_REPORT==='baseline'){
        if(!/^[a-z-]+$/.test(process.env.RECOGNITION_REPORT))throw Error('Invalid report label')
        fs.mkdirSync('work/vector-recognition',{recursive:true})
        fs.writeFileSync(`work/vector-recognition/${process.env.RECOGNITION_REPORT}-accuracy.json`,JSON.stringify({rows},null,2)+'\n')
      }
    }finally{pdf.destroy()}
  })
  it('finds visible-equivalent symbols, rejects known differences and leaves text overlap unresolved',()=>{
    const fixture=recognitionFixture(),pdf=new mupdf.PDFDocument(fixture.bytes),rows:unknown[]=[]
    try{
      for(let pageIndex=0;pageIndex<5;pageIndex++){
        const page=extractVectorPage(pdf,pageIndex,undefined,true)
        for(const sample of fixture.truth.filter(t=>t.pageIndex===pageIndex&&t.id.endsWith('-0'))){
          const result=searchVectorMessage({type:'vector-search',id:1,segments:page.segments,segmentWidths:page.widths,
            sampleSegments:page.segments,sampleWidths:page.widths,paint:page.paint,samplePaint:page.paint,sampleRect:sample.rect,options:{threshold:.85,rotations:false}})!
          const accuracy=recognitionAccuracy(fixture.truth,sample,result.matches.map(m=>m.center))
          rows.push({id:sample.id,pageIndex,...accuracy,matches:result.matches,stats:result.stats})
          expect(accuracy.fn,sample.id).toBe(0)
          // Unmodeled glyph overlap may retain candidates, but never as confirmed structure.
          for(const center of accuracy.unexpected){
            const m=result.matches.find(m=>Math.hypot(m.center[0]-center[0],m.center[1]-center[1])<.01)!
            expect(m.structureCheck,sample.id).toBe(true)
          }
          expect(accuracy.fp,sample.id).toBe(sample.id==='connected-wrong-0'?2:0)
        }
      }
    }finally{
      pdf.destroy()
      if(process.env.RECOGNITION_REPORT&&/^[a-z-]+$/.test(process.env.RECOGNITION_REPORT))
        fs.writeFileSync(`work/vector-recognition/${process.env.RECOGNITION_REPORT}-accuracy.json`,JSON.stringify({rows},null,2)+'\n')
    }
  })
  it('obeys rotation selection for asymmetric fill, using separate sample and target paint',()=>{
    const fixture=recognitionFixture(),pdf=new mupdf.PDFDocument(fixture.bytes)
    try{
      const page=extractVectorPage(pdf,1,undefined,true),other=extractVectorPage(pdf,1,undefined,true)
      const sample=fixture.truth.find(t=>t.id==='lamp-left-0')!,right=fixture.truth.find(t=>t.id==='lamp-right-0')!
      const run=(rotations:boolean)=>searchVectorMessage({type:'vector-search',id:1,segments:other.segments,segmentWidths:other.widths,
        sampleSegments:page.segments,sampleWidths:page.widths,paint:other.paint,samplePaint:page.paint,sampleRect:sample.rect,options:{threshold:.85,rotations}})!
      expect(run(false).matches.some(m=>Math.hypot(m.center[0]-right.center[0],m.center[1]-right.center[1])<1)).toBe(false)
      expect(run(true).matches.some(m=>Math.hypot(m.center[0]-right.center[0],m.center[1]-right.center[1])<1)).toBe(true)
    }finally{pdf.destroy()}
  })
  it('retains curved and compound stroke matches with modest line-width differences',()=>{
    const doc=new mupdf.PDFDocument()
    try{
      // Two independently positioned compound paths with a curved exterior and isolated interior.
      const body='20 0 m 20 11 0 11 0 0 c 0 -11 20 -11 20 0 c h 7 -3 m 13 3 l S'
      const obj=doc.addPage([0,0,200,100],0,{},`q .6 w 1 0 0 1 30 50 cm ${body} Q q .85 w 1 0 0 1 120 50 cm ${body} Q`)
      doc.insertPage(-1,obj);obj.destroy()
      const p=extractVectorPage(doc,0,undefined,true)
      const result=searchVectorMessage({type:'vector-search',id:1,segments:p.segments,segmentWidths:p.widths,sampleSegments:p.segments,
        sampleWidths:p.widths,paint:p.paint,samplePaint:p.paint,sampleRect:[29,41,51,59],options:{threshold:.85}})!
      expect(result.matches.map(m=>Math.round(m.center[0]))).toEqual([40,130])
      expect(result.matches.every(m=>!m.structureCheck)).toBe(true)
    }finally{doc.destroy()}
  })
})
