import { expect, it } from 'vitest'
import mupdf from 'mupdf'
import { symbolLabelsPdf } from './symbolLabelFixtures'
import { extractVectorPage } from '../src/worker/vectorExtract'
import { extractLabelPage } from '../src/worker/labelExtract'
import { vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import { assignSymbolLabels } from '../src/core/symbolLabels'

it('validates the e2e PDF body counts, labels, GC, sample and double-circle grading without running a browser', () => {
  const doc=mupdf.Document.openDocument(new Uint8Array(symbolLabelsPdf()),'application/pdf')
  try {
    const page=extractVectorPage(doc,0),labels=extractLabelPage(doc,0)
    const result=vectorSymbolSearch(page.segments,[34,53,64,67],{rotations:true},page.segments,page.widths,page.widths)
    expect(result.matches).toHaveLength(10)
    const values=assignSymbolLabels(labels,result.matches,10)
    const counts=new Map<string,number>()
    for(const value of values) counts.set(value.label,(counts.get(value.label)??0)+1)
    expect(Object.fromEntries(counts)).toEqual({ET:5,'4H':1,'20A':2,'':2})
    expect(values.filter(v=>v.gc)).toHaveLength(2)
    const sample=assignSymbolLabels(labels,[{rect:result.template.rect},...result.matches.filter(m=>Math.hypot(m.center[0]-40,m.center[1]-60)>.01)],10)[0]
    expect(sample).toEqual({label:'ET',gc:false})
    result.matches.forEach((match,i)=>expect(match.around-result.template.sampleAround>.3).toBe(values[i].label==='20A'))
  }finally{doc.destroy()}
})
