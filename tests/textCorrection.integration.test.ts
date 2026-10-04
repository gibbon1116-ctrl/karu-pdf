import fs from 'node:fs/promises'
import mupdf, { type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { prepareDocumentOutput } from '../src/core/output'
import { extractTextLines } from '../src/core/textExtract'
import { listAnnotations } from '../src/core/annotations'

let font: FontResource
beforeAll(async () => { font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf'))) })
afterAll(() => font.font.destroy())
function fixture(rotation = 0, clipping = false) {
  const doc = new mupdf.PDFDocument(), ref = doc.addFont(font.font)
  const glyphs = (t:string) => [...t].map(c=>font.font.encodeCharacter(c).toString(16).padStart(4,'0')).join('')
  try {
    const content = `${clipping ? 'q 0 0 300 300 re W n ' : ''}BT /F1 14 Tf 40 240 Td <${glyphs('照明器具Ａ')}> Tj 0 -100 Td <${glyphs('電灯盤Ｂ')}> Tj ET 1 0 0 RG 2 w 40 220 m 150 220 l S${clipping ? ' Q' : ''}`
    for (let i=0;i<2;i++) { const p=doc.addPage([0,0,400,300],rotation as 0|90|180|270,{Font:{F1:ref}},content); try {doc.insertPage(-1,p)} finally {p.destroy()} }
    const page=doc.loadPage(0), redact=page.createAnnotation('Redact')
    try {redact.setRect([40,155,120,180]);redact.setContents('前からあるRedact');redact.update()} finally {redact.destroy();page.destroy()}
    const b=doc.saveToBuffer('compress');try{return b.asUint8Array().slice()}finally{b.destroy()}
  } finally {ref.destroy();doc.destroy()}
}
function text(doc: PDFDocument, pageIndex=0) {
  const page=doc.loadPage(pageIndex), list=page.toDisplayList(false), structured=list.toStructuredText('preserve-whitespace')
  try {return extractTextLines(structured,page.getBounds(),0)}finally{structured.destroy();list.destroy();page.destroy()}
}
function pixels(doc:PDFDocument,index:number) {
  const p=doc.loadPage(index), pix=p.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,false)
  try{return Buffer.from(pix.getPixels())}finally{pix.destroy();p.destroy()}
}
it('replaces Japanese native text in a separate PDF, preserves another page and existing redaction, and reopens successfully', () => {
  const source=fixture(), original=new mupdf.PDFDocument(source)
  try {
    const line=text(original).lines[0], beforePage=pixels(original,1)
    const output=prepareDocumentOutput(source,[],{BIZUDGothic:font},false,{pageIndex:0,rect:line.rect,originalText:line.text,text:'照明器具Ｃ',fontSize:10.5})
    const corrected=new mupdf.PDFDocument(output.bytes)
    try {
      const lines=text(corrected).lines.map(l=>l.text)
      expect(lines).toContain('照明器具Ｃ');expect(lines).not.toContain('照明器具Ａ');expect(lines).toContain('電灯盤Ｂ')
      expect(text(original).lines.map(l=>l.text)).toContain('照明器具Ａ')
      expect(pixels(corrected,1).equals(beforePage)).toBe(true)
      const page=corrected.loadPage(0), annotations=page.getAnnotations()
      try{expect(annotations.map(a=>a.getContents())).toEqual(['前からあるRedact'])}finally{annotations.forEach(a=>a.destroy());page.destroy()}
      expect(listAnnotations(corrected,0).filter(a=>a.kind==='freetext')).toEqual([])
    }finally{corrected.destroy()}
  }finally{original.destroy()}
})
it('rejects partial lines, rotation, clipping and oversized replacement without changing original bytes', () => {
  for (const [rotation,clipping] of [[0,false],[90,false],[0,true]] as const) {
    const source=fixture(rotation,clipping), doc=new mupdf.PDFDocument(source)
    try {
      const l=text(doc).lines[0]
      const correction={pageIndex:0,rect:l.rect,originalText:l.text,text:'照明器具Ｃ',fontSize:10.5}
      if(rotation||clipping)expect(()=>prepareDocumentOutput(source,[],{BIZUDGothic:font},false,correction)).toThrow()
      else {
        expect(()=>prepareDocumentOutput(source,[],{BIZUDGothic:font},false,{...correction,originalText:'照明'})).toThrow()
        expect(()=>prepareDocumentOutput(source,[],{BIZUDGothic:font},false,{...correction,text:'照'.repeat(200)})).toThrow()
      }
      expect(text(doc).lines).toHaveLength(2)
    }finally{doc.destroy()}
  }
})
