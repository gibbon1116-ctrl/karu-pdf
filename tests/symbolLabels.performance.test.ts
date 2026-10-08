import { expect, it } from 'vitest'
import mupdf from 'mupdf'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { extractLabelPage } from '../src/worker/labelExtract'
import { vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import { outletLines } from './symbolLabelFixtures'

const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
/** Reconstruct the pre-08a code paths from this file: disable new thickness,
 * median and around work. Unchanged coverage, reverse scoring and cleanup stay
 * identical. This avoids using Git or timing two different implementations. */
function pre08aSearch(): typeof vectorSymbolSearch {
  let source=readFileSync(new URL('../src/core/vectorSymbolSearch.ts',import.meta.url),'utf8')
  source=source.replace(/  const total = ids.length, buckets[\s\S]*?(?=  const original =)/,'  const total = ids.length, strokeWidth = 0, thin = 0\n')
    .replace(/    const weighted =[\s\S]*?(?=    return \{ segments, widths, bounds)/,'')
    .replace('strokeWidth: strokeWidth ? median : 0','strokeWidth: 0')
    .replace(/  const samplePageSegments =[^\n]*\n/,'').replace(/  segments = widthFiltered[^\n]*\n/,'')
    .replace(/  const padding =[\s\S]*?(?=  if \(!maxResults)/,'')
    .replace(/    const aroundMargin =[^\n]*\n    match.around =[^\n]*\n/,'')
    .replace(/      if \(!acceptsWidth\(pageWidths\[i \/ 4\], strokeWidth\)\) continue\n/,'')
  expect(source).not.toContain('bandLength(');expect(source).not.toContain('const weighted =')
  const js=stripTypeScriptTypes(source).replace(/^import[^\n]*\n/gm,'').replace(/\bexport /g,'')
  return new Function(`${js}\nreturn vectorSymbolSearch`)() as typeof vectorSymbolSearch
}
it.runIf(process.env.KARU_SYMBOL_BENCH==='1')('measures demand-only labels (~2,000 chars) and matching against pre-08a paths', () => {
  const doc=new mupdf.PDFDocument(),font=new mupdf.Font('Helvetica'),fontRef=doc.addSimpleFont(font),fonts=doc.newDictionary(),resources=doc.newDictionary()
  let ref: import('mupdf').PDFObject|undefined
  try {
    fonts.put('F1',fontRef);resources.put('Font',fonts)
    const text=Array.from({length:180},(_,i)=>`BT /F1 6 Tf ${20+(i%6)*90} ${20+Math.floor(i/6)*12} Td (ET 301 4H S) Tj ET`).join('\n')
    ref=doc.addPage([0,0,600,500],0,resources,text);doc.insertPage(-1,ref)
    const labelMs:number[]=[]
    const cold=performance.now();const coldLabels=extractLabelPage(doc,0);const coldMs=performance.now()-cold;expect(coldLabels).toHaveLength(540)
    for(let i=0;i<9;i++){const start=performance.now();const labels=extractLabelPage(doc,0);labelMs.push(performance.now()-start);expect(labels).toHaveLength(540)}
    const lines:number[]=[], widths:number[]=[]
    for(let i=0;i<320;i++){
      const x=20+(i%20)*25,y=20+Math.floor(i/20)*25,body=outletLines(x,y)
      lines.push(...body);widths.push(...Array(body.length/4).fill(.42))
      // Dense short furniture outlines can seed many anchors in old matching.
      if(i>0) for(let j=0;j<8;j++) {lines.push(x-6+j*1.5,y-4.9,x-6+j*1.5,y+4.9);widths.push(.06)}
    }
    const segments=new Float32Array(lines), strokeWidths=new Float32Array(widths), baseline=pre08aSearch()
    const options={rotations:true,maxResults:2000},rect:[number,number,number,number]=[14,14,26,26]
    baseline(segments,rect,options,segments,strokeWidths)
    vectorSymbolSearch(segments,rect,options,segments,strokeWidths,strokeWidths)
    const beforeMs:number[]=[],afterMs:number[]=[]
    let beforeCount=0,afterCount=0
    for(let i=0;i<7;i++){
      const measure=(before:boolean)=>{const start=performance.now();const result=before?baseline(segments,rect,options,segments,strokeWidths):vectorSymbolSearch(segments,rect,options,segments,strokeWidths,strokeWidths)
        ;(before?beforeMs:afterMs).push(performance.now()-start);if(before)beforeCount=result.matches.length;else afterCount=result.matches.length}
      // Alternate order; no parallel heavy test runs.
      measure(i%2===0);measure(i%2!==0)
    }
    expect(afterCount).toBe(320)
    console.log(JSON.stringify({characters:1980,labelCount:540,coldLabelsMs:coldMs,labelsMedianMs:median(labelMs),labelsRangeMs:[Math.min(...labelMs),Math.max(...labelMs)],
      segments:segments.length/4,beforeCount,afterCount,beforeMedianMs:median(beforeMs),afterMedianMs:median(afterMs),deltaMs:median(afterMs)-median(beforeMs),deltaPercent:(median(afterMs)/median(beforeMs)-1)*100}))
  }finally{ref?.destroy();resources.destroy();fonts.destroy();fontRef.destroy();font.destroy();doc.destroy()}
},60_000)
