import {describe,expect,it} from 'vitest'
import mupdf from 'mupdf'
import {extractVectorPage} from '../src/worker/vectorExtract'
import {createPaintMatcher,paintTemplateGeometry} from '../src/core/vectorAppearance'
import {recognitionFixture} from './symbolRecognitionFixtures'
import {prepareVectorTemplate} from '../src/core/vectorSymbolSearch'

describe('candidate-local structure and paint comparison',()=>{
  it('does not confirm invisible legacy outlines hidden by an opaque white overlay',()=>{
    const doc=new mupdf.PDFDocument(),p=doc.addPage([0,0,100,100],0,{},'10 10 20 20 re f 1 g 9 9 22 22 re f')
    doc.insertPage(-1,p);p.destroy()
    try{const page=extractVectorPage(doc,0,undefined,true)
      expect(page.segmentCount).toBe(4)
      expect(createPaintMatcher(page.paint!,page.paint!,[10,70,30,90],.7)([20,80],0).known).toBe(false)
    }finally{doc.destroy()}
  })
  it('limits unknown clipping to affected paths, including their geometry outside the clip',()=>{
    const doc=new mupdf.PDFDocument(),p=doc.addPage([0,0,200,100],0,{},'q 10 10 5 5 re W n 10 10 20 20 re f Q 60 10 20 20 re f 110 10 20 20 re S')
    doc.insertPage(-1,p);p.destroy()
    try{const page=extractVectorPage(doc,0,undefined,true),matcher=createPaintMatcher(page.paint!,page.paint!,[60,70,80,90],.7)
      expect(matcher([70,80],0).known).toBe(true)
      expect(matcher([120,80],0)).toMatchObject({known:true,score:0})
      expect(matcher([20,80],0).known).toBe(false)
    }finally{doc.destroy()}
  })
  it('distinguishes independent line/fill/hole primitives without treating crossing wiring or text as internal lines',()=>{
    const fixture=recognitionFixture(),doc=new mupdf.PDFDocument(fixture.bytes)
    try{
      for(let pageIndex=0;pageIndex<5;pageIndex++){
        const page=extractVectorPage(doc,pageIndex,undefined,true)
        for(const sample of fixture.truth.filter(t=>t.pageIndex===pageIndex&&t.id.endsWith('-0'))){
          const template=prepareVectorTemplate(page.segments,page.widths,sample.rect)
          const match=createPaintMatcher(page.paint!,page.paint!,template.bounds,template.tolerance)
          for(const target of fixture.truth.filter(t=>t.pageIndex===pageIndex)){
            const result=match(target.center,0)
            if(sample.id.startsWith('text-overlap')||target.id.startsWith('text-overlap')){expect(result.known).toBe(false);continue}
            expect(result.known,`${sample.id}/${target.id}`).toBe(true)
            if(target.group===sample.group)expect(result.score,`${sample.id}/${target.id}`).toBeGreaterThanOrEqual(.9)
            else expect(result.score,`${sample.id}/${target.id}`).toBeLessThan(.9)
          }
        }
      }
    }finally{doc.destroy()}
  })
  it('uses exterior fill lines for coarse matching, preserving source arrays and stroke templates',()=>{
    const fixture=recognitionFixture(),doc=new mupdf.PDFDocument(fixture.bytes)
    try{
      const page=extractVectorPage(doc,3,undefined,true),sample=fixture.truth.find(t=>t.id==='evenodd-hole-0')!
      const prepared=prepareVectorTemplate(page.segments,page.widths,sample.rect),before=prepared.segments.slice()
      const outer=paintTemplateGeometry(prepared.segments,prepared.widths,prepared.bounds,page.paint)
      expect(outer.segments.length/4).toBe(4);expect(prepared.segments).toEqual(before)
      const unchanged=paintTemplateGeometry(prepared.segments,prepared.widths,prepared.bounds)
      expect(unchanged.segments).toBe(prepared.segments)
    }finally{doc.destroy()}
  })
  it('keeps uncertain and truncated paint unresolved instead of manufacturing a high score',()=>{
    const fixture=recognitionFixture(),doc=new mupdf.PDFDocument(fixture.bytes)
    try{
      const page=extractVectorPage(doc,0,undefined,true),rect=fixture.truth[0].rect
      for(const flag of ['uncertain','truncated'] as const){
        const paint={...page.paint!,[flag]:true},matcher=createPaintMatcher(paint,paint,rect,.7)
        expect(matcher(fixture.truth[0].center,0)).toMatchObject({known:false,score:0})
      }
    }finally{doc.destroy()}
  })
})
