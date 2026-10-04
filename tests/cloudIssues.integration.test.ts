import fs from 'node:fs/promises'
import mupdf, { type PDFDocument, type PDFPage } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { applyEdits, listAnnotations, type AnnotationEdit, type Point, type Rect } from '../src/core/annotations'
import { cloudArcs, rectVertices } from '../src/core/cloud'
import { maxIssueNumber, issueFontSize } from '../src/core/issues'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { createAnnotationCsv, createIssueCsv } from '../src/app/annotationCsv'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { ensureSamplePdf } from './fixtures'

let source: Uint8Array, font: FontResource, pdfium: WrappedPdfiumModule
beforeAll(async () => {
  source = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  pdfium = await init({ wasmBinary: new Uint8Array(await fs.readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')), thisProgram: 'pdfium' })
  pdfium.FPDF_InitLibrary(); pdfium.PDFiumExt_Init()
})
afterAll(() => { font.font.destroy(); pdfium.FPDF_DestroyLibrary() })
const resources = () => ({ BIZUDGothic: font })
const squareRect: Rect = [100,220,240,304]
const polygonPoints: Point[] = [[300,220],[440,220],[420,304],[300,304]]
function cloud(shape: 'square' | 'polygon', intensity: 0 | 1 | 2 = 1): AnnotationEdit {
  return { kind: 'createCloud', pageIndex: 0, shape, rect: shape === 'square' ? squareRect : [300,220,440,304], vertices: shape === 'polygon' ? polygonPoints : null,
    color: [1,0,0], borderWidth: 1, interiorColor: null, opacity: 1, cloudIntensity: intensity }
}
function issue(number = 123, status: 'open' | 'done' = 'open', pageIndex = 0, rect: Rect = [120,370,144,394]): AnnotationEdit {
  return { kind: 'createIssue', pageIndex, rect, issue: { number, status }, text: '寸法を確認,"修正"\n次の行', color: [1,0,0] }
}
function bytes(doc: PDFDocument): Uint8Array {
  const buffer = doc.saveToBuffer('compress,garbage=4')
  try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
}
function lines(page: PDFPage) {
  const result: Array<{ text: string; bbox: Rect; dir: Point; sizes: number[] }> = []
  const display = page.toDisplayList(true), text = display.toStructuredText('preserve-whitespace')
  let line: typeof result[number]
  try {
    text.walk({ beginLine: (bbox, _mode, dir) => { line = { text: '', bbox, dir, sizes: [] }; result.push(line) }, onChar: (c, _origin, _font, size) => { line.text += c; line.sizes.push(size) } })
    return result
  } finally { text.destroy(); display.destroy() }
}
function red(page: PDFPage, rect: Rect): number {
  const pix = page.toPixmap(mupdf.Matrix.scale(3,3), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    const pixels = pix.getPixels(), width = pix.getWidth(), n = pix.getNumberOfComponents()
    let count = 0
    for (let y=Math.max(0,Math.floor(rect[1]*3));y<Math.min(pix.getHeight(),Math.ceil(rect[3]*3));y++) for(let x=Math.max(0,Math.floor(rect[0]*3));x<Math.min(width,Math.ceil(rect[2]*3));x++) {
      const i=(y*width+x)*n; if(pixels[i]>160 && pixels[i+1]<140 && pixels[i+2]<140) count++
    }
    return count
  } finally { pix.destroy() }
}
function pdfiumCount(data: Uint8Array, rect: Rect, color: 'red' | 'gray'): number {
  const runtime = pdfium.pdfium, pointer = runtime.wasmExports.malloc(data.length)
  let doc=0, page=0, bitmap=0
  try {
    // Heap can grow during allocation/rendering; read the current view each time.
    ;(runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(data,pointer)
    doc=pdfium.FPDF_LoadMemDocument64(pointer,data.length,''); expect(doc).not.toBe(0)
    page=pdfium.FPDF_LoadPage(doc,0)
    const width=Math.ceil(pdfium.FPDF_GetPageWidthF(page)*3), height=Math.ceil(pdfium.FPDF_GetPageHeightF(page)*3)
    bitmap=pdfium.FPDFBitmap_Create(width,height,1)
    pdfium.FPDFBitmap_FillRect(bitmap,0,0,width,height,0xffffffff)
    pdfium.FPDF_RenderPageBitmap(bitmap,page,0,0,width,height,0,1)
    const heap=(runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8, buffer=pdfium.FPDFBitmap_GetBuffer(bitmap), stride=pdfium.FPDFBitmap_GetStride(bitmap)
    let count=0
    for(let y=Math.floor(rect[1]*3);y<Math.min(height,Math.ceil(rect[3]*3));y++)for(let x=Math.floor(rect[0]*3);x<Math.min(width,Math.ceil(rect[2]*3));x++){
      const i=buffer+y*stride+x*4, b=heap[i],g=heap[i+1],r=heap[i+2]
      if(color==='red' ? r>160&&g<140&&b<140 : Math.abs(r-g)<3&&Math.abs(r-b)<3&&r<180&&r>75) count++
    }
    return count
  } finally {
    if(bitmap)pdfium.FPDFBitmap_Destroy(bitmap);if(page)pdfium.FPDF_ClosePage(page);if(doc)pdfium.FPDF_CloseDocument(doc);runtime.wasmExports.free(pointer)
  }
}
describe('cloud and issue PDF results', () => {
  it('count metadata survives save, reopen, move and change of type', () => {
    const doc = new mupdf.PDFDocument(source)
    const count = { version: 1 as const, id: 'count-1', group: '照明器具' }
    try {
      expect(applyEdits(doc, [{ kind: 'createSymbol', pageIndex: 0, rect: [100,100,108,108], count, color: [0,0,1], symbol: 'circle' }], resources()).errors).toEqual([])
      const a = listAnnotations(doc, 0).find(a => a.count)!
      expect(applyEdits(doc, [{ kind: 'updateSymbol', objNum: a.objNum, pageIndex: 0, rect: [200,100,208,108], count: { ...count, group: '感知器' }, color: [0,0,1], symbol: 'circle' }], resources()).errors).toEqual([])
      const reopened = new mupdf.PDFDocument(bytes(doc))
      try { expect(listAnnotations(reopened, 0).find(a => a.count)).toMatchObject({ rect: [200,100,208,108], count: { ...count, group: '感知器' } }) }
      finally { reopened.destroy() }
    } finally { doc.destroy() }
  })
  it('review metadata and stable identity survive PDF save and reopen', () => {
    const doc = new mupdf.PDFDocument(source)
    const details = { version: 1 as const, id: 'review-1', number: 1, status: 'confirmed' as const, discipline: '電気', answer: '配線修正', verification: '新版確認', drawingNumber: 'E-01' }
    try {
      expect(applyEdits(doc, [{ kind: 'createIssue', pageIndex: 0, rect: [100,100,116,116], issue: details, text: '回路確認', color: [1,0,0] }], resources()).errors).toEqual([])
      const reopened = new mupdf.PDFDocument(bytes(doc))
      try { expect(listAnnotations(reopened, 0).find(a => a.issue)?.issue).toEqual(details) }
      finally { reopened.destroy() }
    } finally { doc.destroy() }
  })
  it('MuPDF native clouds generate curves for medium/large, but I=0 is a plain border', () => {
    const doc=new mupdf.PDFDocument(source), page=doc.loadPage(0)
    try {
      for(const type of ['Square','Polygon'] as const) for(const intensity of [0,1,2]) {
        const a=page.createAnnotation(type), o=a.getObject()
        try {
          if(type==='Square')a.setRect(squareRect);else a.setVertices(polygonPoints)
          a.setColor([1,0,0]);a.setBorderWidth(1);o.put('BE',{S:'C',I:intensity});a.update()
          const ap=o.get('AP','N'), stream=ap.readStream()
          try { const count=(stream.asString().match(/ c\n/g)??[]).length; expect(count).toBe(intensity===0?0:count); if(intensity>0)expect(count).toBeGreaterThan(10) }
          finally { stream.destroy();ap.destroy() }
        } finally { o.destroy();a.destroy() }
      }
    } finally { page.destroy();doc.destroy() }
  })
  it.each([0,1,2] as const)('saves and reopens both cloud shapes with BE, IT, vertices, colors, opacity and shared cubic AP at intensity %s', intensity => {
    const doc=new mupdf.PDFDocument(source)
    try {
      expect(applyEdits(doc,[cloud('square',intensity),cloud('polygon',intensity)],resources()).errors).toEqual([])
      const saved=new mupdf.PDFDocument(bytes(doc)), info=listAnnotations(saved,0).filter(a=>a.cloudIntensity!==null&&a.cloudIntensity!==undefined)
      try {
        expect(info.map(a=>a.kind)).toEqual(['cloudSquare','cloudPolygon'])
        info[0].rect.forEach((n,i)=>expect(n).toBeCloseTo(squareRect[i],3));expect(info[1].vertices).toEqual(polygonPoints)
        const page=saved.loadPage(0), annotations=page.getAnnotations()
        try {
          for(let i=0;i<2;i++) {
            const a=annotations.find(a=>{const o=a.getObject();try{return o.asIndirect()===info[i].objNum}finally{o.destroy()}})!,o=a.getObject()
            const be=o.get('BE'),it=o.get('IT'),ap=o.get('AP','N'),stream=ap.readStream()
            try {
              expect(be.asJS()).toEqual({S:'C',I:intensity});if(i===1)expect(it.asName()).toBe('PolygonCloud')
              expect(info[i].strokeColor).toEqual([1,0,0]);expect(info[i].opacity).toBe(1);expect(info[i].interiorColor).toBeNull()
              const expected=cloudArcs(i===0?rectVertices(squareRect):polygonPoints,intensity,1).length
              expect((stream.asString().match(/ c\n/g)??[]).length).toBe(expected)
              const arc=cloudArcs(rectVertices(squareRect),intensity,1)[1], midX=(arc.start[0]+arc.end[0])/2
              const midY=(arc.start[1]+3*arc.c1[1]+3*arc.c2[1]+arc.end[1])/8
              expect(red(page,[midX-.6,midY-.6,midX+.6,midY+.6])).toBeGreaterThan(3)
              expect(red(page,[arc.end[0]-.3,midY-.3,arc.end[0]+.3,midY+.3])).toBe(0)
            } finally { stream.destroy();ap.destroy();it.destroy();be.destroy();o.destroy() }
          }
        } finally { annotations.forEach(a=>a.destroy());page.destroy() }
      } finally { saved.destroy() }
    } finally { doc.destroy() }
  })
  it.each([0,90,180,270])('rotation %s: exact issue values, upright digits inside circle, scallop pixels, original content and existing annotation survive', async rotation => {
    const doc=new mupdf.PDFDocument(source)
    try {
      const object=doc.findPage(0);try{object.put('Rotate',rotation)}finally{object.destroy()}
      expect(applyEdits(doc,[{kind:'createSquare',pageIndex:0,rect:[50,450,80,480],color:[0,0,1],borderWidth:2}],resources()).errors).toEqual([])
      const beforePage=doc.loadPage(0), beforeObject=beforePage.getObject(), beforeContents=beforeObject.get('Contents')
      const contentReference=beforeContents.toString()
      const beforePixmap=beforePage.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true)
      const originalPixels=new Uint8Array(beforePixmap.getPixels()), originalWidth=beforePixmap.getWidth()
      beforePixmap.destroy();beforeContents.destroy();beforeObject.destroy();beforePage.destroy()
      const edits=[cloud('square'),cloud('polygon'),issue(),issue(987654321012345,'done',0,[170,370,194,394])]
      expect(applyEdits(doc,edits,resources()).errors).toEqual([])
      const afterObject=doc.findPage(0), afterContents=afterObject.get('Contents')
      try{expect(afterContents.toString()).toBe(contentReference)}finally{afterContents.destroy();afterObject.destroy()}
      const saved=new mupdf.PDFDocument(bytes(doc)),page=saved.loadPage(0)
      try {
        const info=listAnnotations(saved,0), allLines=lines(page)
        expect(allLines.some(l=>l.text==='Sample page 1')).toBe(true)
        const outputPixmap=page.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true)
        try {
          const actual=outputPixmap.getPixels(); expect(actual.length).toBe(originalPixels.length)
          let changed=0
          for(let i=0;i<actual.length;i+=3) {
            const x=(i/3)%originalWidth,y=Math.floor(i/3/originalWidth)
            if((x>=90&&x<=451&&y>=210&&y<=314)||(x>=118&&x<=196&&y>=368&&y<=396))continue
            if(actual[i]!==originalPixels[i]||actual[i+1]!==originalPixels[i+1]||actual[i+2]!==originalPixels[i+2])changed++
          }
          expect(changed).toBe(0)
        } finally { outputPixmap.destroy() }
        expect(info.find(a=>a.kind==='square' && a.rect[0]===50)?.strokeColor).toEqual([0,0,1])
        expect(info.find(a=>a.kind==='square' && a.rect[0]===50)?.rect).toEqual([50,450,80,480])
        for(const expected of [123,987654321012345]) {
          const a=info.find(a=>a.issue?.number===expected)!,line=allLines.find(l=>l.text===String(expected))!
          expect(a.issue).toEqual({number:expected,status:expected===123?'open':'done'})
          expect(a.contents).toBe('寸法を確認,"修正"\n次の行')
          expect(line,JSON.stringify(allLines)).toBeDefined();expect(line.dir[0]).toBeCloseTo(1,5);expect(line.dir[1]).toBeCloseTo(0,5)
          const fs=issueFontSize(expected,24)
          expect(line.sizes.every(s=>Math.abs(s-fs)<.01)).toBe(true)
          expect(line.bbox[0]).toBeGreaterThan(a.rect[0]);expect(line.bbox[2]).toBeLessThan(a.rect[2])
          expect(line.bbox[1]).toBeGreaterThan(a.rect[1]);expect(line.bbox[3]).toBeLessThan(a.rect[3])
          const cx=(a.rect[0]+a.rect[2])/2,cy=(a.rect[1]+a.rect[3])/2
          for(const x of [line.bbox[0],line.bbox[2]])for(const y of [line.bbox[1],line.bbox[3]])expect(Math.hypot(x-cx,y-cy)).toBeLessThan(24*.45)
        }
        expect(red(page,[104,214,106,216])).toBeGreaterThan(0)
        expect(red(page,[119,374,145,391])).toBeGreaterThan(20)
        if(process.env.KARU_CLOUD_VISUAL==='1') {
          await fs.mkdir('tests/.cloud-issue-preview',{recursive:true})
          const pix=page.toPixmap(mupdf.Matrix.scale(1.5,1.5),mupdf.ColorSpace.DeviceRGB,false,true)
          try{await fs.writeFile(`tests/.cloud-issue-preview/rotation-${rotation}.png`,pix.asPNG())}finally{pix.destroy()}
        }
        const data=bytes(saved)
        expect(pdfiumCount(data,[95,211,245,313],'red')).toBeGreaterThan(600)
        expect(pdfiumCount(data,[118,368,146,396],'red')).toBeGreaterThan(70)
        expect(pdfiumCount(data,[168,368,196,396],'gray')).toBeGreaterThan(70)
      } finally { page.destroy();saved.destroy() }
    } finally { doc.destroy() }
  })
  it.each([90,180,270])('CropBox/UserUnit with rotation %s keep visible cloud and issue geometry and digit size', rotation => {
    const doc=new mupdf.PDFDocument(source),object=doc.findPage(0)
    try {
      object.put('CropBox',[20,30,570,810]);object.put('UserUnit',2);object.put('Rotate',rotation)
      expect(applyEdits(doc,[cloud('square'),cloud('polygon'),issue()],resources()).errors).toEqual([])
      const saved=new mupdf.PDFDocument(bytes(doc)),page=saved.loadPage(0)
      try {
        const info=listAnnotations(saved,0), square=info.find(a=>a.kind==='cloudSquare')!
        square.rect.forEach((n,i)=>expect(n).toBeCloseTo(squareRect[i],3))
        expect(info.find(a=>a.kind==='cloudPolygon')?.vertices).toEqual(polygonPoints)
        const label=lines(page).find(l=>l.text==='123')!
        expect(label.dir[0]).toBeCloseTo(1,5);expect(label.dir[1]).toBeCloseTo(0,5)
        expect(label.sizes.every(size=>Math.abs(size-issueFontSize(123,24))<.01)).toBe(true)
        expect(label.bbox[0]).toBeGreaterThan(120);expect(label.bbox[2]).toBeLessThan(144)
        expect(red(page,[100,211,240,310])).toBeGreaterThan(600)
      } finally { page.destroy();saved.destroy() }
    } finally { object.destroy();doc.destroy() }
  })
  it('maxIssueNumber includes unloaded pages and reads only /Annots dictionaries', () => {
    const doc=new mupdf.PDFDocument(source)
    try {
      expect(applyEdits(doc,[issue(2),issue(80,'done',doc.countPages()-1)],resources()).errors).toEqual([])
      const load=vi.spyOn(doc,'loadPage').mockImplementation(()=>{throw Error('must not load a page')})
      expect(maxIssueNumber(doc)).toBe(80);expect(load).not.toHaveBeenCalled();load.mockRestore()
    } finally { doc.destroy() }
  })
  it('旧版変更は指摘・番号走査・CSVから除外し、未編集の外観を保って削除とUndoだけを許す', async () => {
    const doc = new mupdf.PDFDocument(source)
    try {
      const change = issue(2)
      if (change.kind !== 'createIssue') throw Error('fixture')
      change.issue = { number: 2, status: 'open', recordKind: 'change', changeReason: '旧版の理由' }
      expect(applyEdits(doc, [issue(1), change, issue(3)], resources()).errors).toEqual([])
      const saved = new mupdf.PDFDocument(bytes(doc))
      try {
        const annotations = listAnnotations(saved, 0), legacy = annotations.find(a => a.legacyChange)!
        expect(annotations.filter(a => a.issue).map(a => a.issue!.number)).toEqual([1,3])
        expect(legacy).toMatchObject({ kind: 'issue', editable: false, issue: null })
        expect(maxIssueNumber(saved)).toBe(3)
        const store = new AnnotationStore()
        await store.ensurePageLoaded(0, async () => annotations)
        expect(store.isDirty()).toBe(false); expect(store.toEdits()).toEqual([])
        const id = `obj-${legacy.objNum}`
        store.selectOnly(id); store.touch(id)
        store.move(id, 10, 20); store.update(id, { color: [0,0,1] }); store.updateIssueText(id, '変えない')
        expect(store.copySelected()).toEqual([])
        expect(store.touchedObjNums(0)).toEqual([])
        expect(store.isDirty()).toBe(false)
        expect(createIssueCsv(store.getPageAnnotations(0)).split('\r\n').filter(line => line.startsWith('指摘,'))).toHaveLength(2)
        expect(createAnnotationCsv(store.getPageAnnotations(0))).not.toContain('旧版の理由')
        store.renumberIssues()
        expect(store.getPageAnnotations(0).filter(a => a.issue).map(a => a.issue!.number)).toEqual([1,2])
        expect(store.get(id)?.legacyChange).toBe(true)
        store.undo()
        expect(store.getPageAnnotations(0).filter(a => a.issue).map(a => a.issue!.number)).toEqual([1,3])
        expect(store.isDirty()).toBe(false)
        store.remove(id)
        expect(store.toEdits()).toEqual([{ kind: 'delete', objNum: legacy.objNum, pageIndex: 0 }])
        expect(store.touchedObjNums(0)).toContain(legacy.objNum)
        store.undo()
        expect(store.get(id)?.legacyChange).toBe(true)
        expect(store.toEdits()).toEqual([])
        expect(store.touchedObjNums(0)).not.toContain(legacy.objNum)
        const objectBefore = saved.newIndirect(legacy.objNum)
        const resolvedBefore = objectBefore.resolve()
        const before = resolvedBefore.toString(); resolvedBefore.destroy(); objectBefore.destroy()
        expect(applyEdits(saved, store.toEdits(), resources()).errors).toEqual([])
        const objectAfter = saved.newIndirect(legacy.objNum)
        const resolvedAfter = objectAfter.resolve()
        expect(resolvedAfter.toString()).toBe(before); resolvedAfter.destroy(); objectAfter.destroy()
        expect(store.create({ kind: 'issue', pageIndex: 0, rect: [20,20,36,36] }).issue?.number).toBe(4)
        store.undo()
        store.remove(id)
        const deleted = applyEdits(saved, store.toEdits(), resources())
        expect(deleted.errors).toEqual([])
        store.markApplied(deleted)
        expect(listAnnotations(saved, 0).some(a => a.legacyChange)).toBe(false)
        const deletedBuffer = saved.saveToBuffer('garbage=1,compress')
        const savedAfterDelete = new Uint8Array(deletedBuffer.asUint8Array()); deletedBuffer.destroy()
        const reopened = new mupdf.PDFDocument(savedAfterDelete)
        try {
          store.undo()
          expect(store.get(id)).toMatchObject({ legacyChange: true, objNum: null, dirty: true })
          expect(store.toEdits().map(e => e.kind)).toEqual(['createLegacyChange'])
          const restored = applyEdits(reopened, store.toEdits(), resources())
          expect(restored.errors).toEqual([])
          store.markApplied(restored)
          const info = listAnnotations(reopened, 0).find(a => a.legacyChange)!
          expect(info).toMatchObject({ rect: legacy.rect, contents: legacy.contents, issue: null, editable: false })
          expect(info.legacyChangeData?.preview).toBe(legacy.legacyChangeData?.preview)
          expect(store.isDirty()).toBe(false)
          store.redo()
          const redone = applyEdits(reopened, store.toEdits(), resources())
          expect(redone.errors).toEqual([]); store.markApplied(redone)
          expect(listAnnotations(reopened, 0).some(a => a.legacyChange)).toBe(false)
        } finally { reopened.destroy() }
      } finally { saved.destroy() }
      const highChange = issue(999)
      if (highChange.kind !== 'createIssue') throw Error('fixture')
      highChange.issue.recordKind = 'change'
      applyEdits(doc, [highChange], resources())
      const load = vi.spyOn(doc, 'loadPage').mockImplementation(() => { throw Error('must not load a page') })
      expect(maxIssueNumber(doc)).toBe(3); expect(load).not.toHaveBeenCalled(); load.mockRestore()
    } finally { doc.destroy() }
  })
  it('sourceNumber をPDFに保存して読み込み、不正な保存値を拒否する', () => {
    const doc = new mupdf.PDFDocument(source), edit = issue(31)
    try {
      if (edit.kind !== 'createIssue') throw Error('fixture')
      edit.issue = { number: 31, status: 'open', sourceNumber: 12, sourceId: 'old-12', sourceDocument: '旧版.pdf' }
      expect(applyEdits(doc, [edit], resources()).errors).toEqual([])
      const saved = new mupdf.PDFDocument(bytes(doc))
      try { expect(listAnnotations(saved, 0).find(a => a.issue)?.issue).toMatchObject(edit.issue) } finally { saved.destroy() }
      edit.issue.sourceNumber = -1
      expect(applyEdits(doc, [edit], resources()).errors).toHaveLength(1)
    } finally { doc.destroy() }
  })
  it('reads foreign clouds and updates fill, stroke, size and issue contents/status without losing original page text', () => {
    const doc=new mupdf.PDFDocument(source),page=doc.loadPage(0)
    try {
      for(const type of ['Square','Polygon'] as const) {
        const a=page.createAnnotation(type),o=a.getObject()
        try{if(type==='Square')a.setRect(squareRect);else a.setVertices(polygonPoints);a.setColor([1,0,0]);o.put('BE',{S:'C',I:2});a.update()}finally{o.destroy();a.destroy()}
      }
      expect(applyEdits(doc,[issue()],resources()).errors).toEqual([])
      const info=listAnnotations(doc,0)
      expect(info.filter(a=>a.kind==='cloudSquare'||a.kind==='cloudPolygon')).toHaveLength(2)
      const edits:AnnotationEdit[]=info.filter(a=>a.kind==='cloudSquare'||a.kind==='cloudPolygon').map(a=>({kind:'updateCloud',objNum:a.objNum,pageIndex:0,shape:a.kind==='cloudSquare'?'square':'polygon',rect:a.rect,vertices:a.vertices??null,color:[0,0,1],interiorColor:[1,1,0],opacity:.5,borderWidth:2,cloudIntensity:0}))
      const a=info.find(a=>a.issue)!
      edits.push({kind:'updateIssue',objNum:a.objNum,pageIndex:0,rect:[120,370,136,386],issue:{number:123,status:'done'},text:'直しました',color:[0,0,1]})
      expect(applyEdits(doc,edits,resources()).errors).toEqual([])
      const saved=new mupdf.PDFDocument(bytes(doc))
      try {
        const updated=listAnnotations(saved,0)
        expect(updated.filter(a=>a.cloudIntensity===0).every(a=>a.opacity===.5&&a.interiorColor?.[0]===1&&a.strokeColor?.[2]===1)).toBe(true)
        expect(updated.find(a=>a.issue)).toMatchObject({issue:{number:123,status:'done'},contents:'直しました',rect:[120,370,136,386]})
        const p=saved.loadPage(0);try{expect(lines(p).some(l=>l.text==='Sample page 1')).toBe(true)}finally{p.destroy()}
      } finally { saved.destroy() }
    } finally { page.destroy();doc.destroy() }
  })
})
