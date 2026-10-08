import { describe, expect, it, vi } from 'vitest'
import mupdf from 'mupdf'
import { assignSymbolLabels, normalizeSymbolLabel } from '../src/core/symbolLabels'
import { extractLabelPage, labelsFromStructuredText } from '../src/worker/labelExtract'
import type { Rect } from '../src/core/annotations'

const bodies = [{ rect: [10,10,20,20] as Rect }, { rect: [30,10,40,20] as Rect }]
describe('symbol labels', () => {
  it('normalizes fullwidth letters and digits, rejects circuit numbers and long/nonalphanumeric words', () => {
    expect(normalizeSymbolLabel('２ｅｔ')).toBe('2ET')
    expect(normalizeSymbolLabel('３０１')).toBeNull()
    for (const word of ['ABCDEF7', '日本', 'ET-G', '']) expect(normalizeSymbolLabel(word)).toBeNull()
  })
  it('assigns each word once to the nearest body, with overlap first and inclusive R', () => {
    const result = assignSymbolLabels([
      { text:'ET', rect:[22,11,24,15] }, { text:'4H', rect:[19,11,31,15] },
      { text:'S', rect:[40,11,43,15] }, { text:'W', rect:[-1,11,-.1,15] }, { text:'AD', rect:[0,11,0,15] },
    ], bodies, 10)
    expect(result).toEqual([{label:'4H+AD+ET',gc:false},{label:'S',gc:false}])
    // Intersection wins even when the other body's center is closer.
    expect(assignSymbolLabels([{text:'ET',rect:[19,11,29,15]}], bodies, 10)[0].label).toBe('ET')
    // A touching edge must not win a zero-distance tie against actual overlap.
    expect(assignSymbolLabels([{text:'ET',rect:[20,11,31,15]}], bodies, 10)[1].label).toBe('ET')
  })
  it.each([['ETG','ET'],['2CG','2C'],['ADG','AD'],['G','']])('splits %s into %s and GC', (text,label) => {
    expect(assignSymbolLabels([{text,rect:[12,12,15,15]}],bodies,10)[0]).toEqual({label,gc:true})
    expect(assignSymbolLabels([{text,rect:[12,12,15,15]}],bodies,10,false)[0]).toEqual({label:text,gc:false})
  })
  it('does not split two-character words ending in G', () => {
    expect(assignSymbolLabels([{text:'AG',rect:[12,12,15,15]}],bodies,10)[0]).toEqual({label:'AG',gc:false})
  })
  it('splits whitespace with word-specific quads, normalizes and releases every Font wrapper', () => {
    const destroy=vi.fn()
    const structured={walk(w: Parameters<import('mupdf').StructuredText['walk']>[0]) {
      w.beginLine?.([0,0,60,10],0,[1,0])
      Array.from('ｅｔ ３０１\t２ＣＧ').forEach((c,i)=>w.onChar?.(c,[i*5,0],{destroy} as unknown as import('mupdf').Font,10,[i*5,0,i*5+5,0,i*5,10,i*5+5,10],[0],0))
      w.endLine?.()
    }} as import('mupdf').StructuredText
    expect(labelsFromStructuredText(structured,[0,0,60,10])).toEqual([{text:'ET',rect:[0,0,10,10]},{text:'2CG',rect:[35,0,50,10]}])
    expect(destroy).toHaveBeenCalledTimes(10)
  })
  it('extracts rotated real PDF labels in the displayed vector coordinate frame', () => {
    const doc=new mupdf.PDFDocument(), font=new mupdf.Font('Helvetica'), fontRef=doc.addSimpleFont(font), resources=doc.newDictionary(), fonts=doc.newDictionary()
    let ref: import('mupdf').PDFObject | undefined, upright: import('mupdf').PDFObject | undefined
    try {
      fonts.put('F1',fontRef);resources.put('Font',fonts)
      ref=doc.addPage([0,0,200,100],90,resources,'BT /F1 10 Tf 20 30 Td (et 301 2CG) Tj ET');doc.insertPage(-1,ref)
      upright=doc.addPage([0,0,200,100],0,resources,'BT /F1 10 Tf 20 30 Td (et 301 2CG) Tj ET');doc.insertPage(-1,upright)
      const labels=extractLabelPage(doc,0)
      expect(labels.map(l=>l.text)).toEqual(['ET','2CG'])
      const r=extractLabelPage(doc,1)[0].rect
      const expected=[100-r[3],r[0],100-r[1],r[2]]
      labels[0].rect.forEach((value,i)=>expect(value).toBeCloseTo(expected[i],4))
    } finally {upright?.destroy();ref?.destroy();fonts.destroy();resources.destroy();fontRef.destroy();font.destroy();doc.destroy()}
  })
})
