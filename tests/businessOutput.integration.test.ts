import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdits, listAnnotations, type Rect } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { openDocument } from '../src/core/mupdfDoc'
import { prepareDocumentOutput } from '../src/core/output'
import { pdfEditRestriction } from '../src/core/pdfRestrictions'
import { applyEditsAtomically } from '../src/core/editTransaction'
import { saveDocument } from '../src/core/save'
import { stripJpegMetadata, readExif } from '../src/core/exif'
import { testJpeg, withExif } from './imagePdfFixtures'

let font: FontResource, pdfium: WrappedPdfiumModule
beforeAll(async () => {
  font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  pdfium = await init({ wasmBinary: new Uint8Array(await fs.readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')), thisProgram: 'pdfium' })
  pdfium.FPDF_InitLibrary()
})
afterAll(() => { font.font.destroy(); pdfium.FPDF_DestroyLibrary() })

function fixture(rotation = 0) {
  const doc = new mupdf.PDFDocument(), face = new mupdf.Font('Helvetica')
  try {
    const ref = doc.addSimpleFont(face, 'Latin')
    doc.insertPage(-1, doc.addPage([0, 0, 400, 500], rotation as 0 | 90 | 180 | 270, { Font: { F1: ref } }, 'BT /F1 18 Tf 80 380 Td (SECRET) Tj 0 -150 Td (PUBLIC) Tj ET'))
    const page = doc.findPage(0); try { page.put('CropBox', [20, 30, 380, 470]) } finally { page.destroy() }
    return saveDocument(doc, 'full').bytes
  } finally { face.destroy(); doc.destroy() }
}

function pdfiumPixels(data: Uint8Array) {
  const runtime = pdfium.pdfium, pointer = runtime.wasmExports.malloc(data.length)
  let document = 0, page = 0, bitmap = 0
  try {
    (runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(data, pointer)
    document = pdfium.FPDF_LoadMemDocument64(pointer, data.length, ''); expect(document).not.toBe(0)
    page = pdfium.FPDF_LoadPage(document, 0)
    const width = Math.ceil(pdfium.FPDF_GetPageWidthF(page)), height = Math.ceil(pdfium.FPDF_GetPageHeightF(page))
    bitmap = pdfium.FPDFBitmap_Create(width, height, 1)
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 1)
    const heap = (runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8, offset = pdfium.FPDFBitmap_GetBuffer(bitmap), stride = pdfium.FPDFBitmap_GetStride(bitmap)
    return { width, height, stride, pixels: heap.slice(offset, offset + stride * height) }
  } finally {
    if (bitmap) pdfium.FPDFBitmap_Destroy(bitmap); if (page) pdfium.FPDF_ClosePage(page); if (document) pdfium.FPDF_CloseDocument(document); runtime.wasmExports.free(pointer)
  }
}
function redPixels(data: Uint8Array, rect: Rect) {
  const image = pdfiumPixels(data)
  let count = 0
  for (let y = Math.max(0, Math.floor(rect[1])); y < Math.min(image.height, rect[3]); y++) for (let x = Math.max(0, Math.floor(rect[0])); x < Math.min(image.width, rect[2]); x++) {
    const at = y * image.stride + x * 4
    if (image.pixels[at + 2] > 180 && image.pixels[at] < 100 && image.pixels[at + 1] < 100) count++
  }
  return count
}

describe('図面の保存と電子署名保護', () => {
  it.each([0, 90, 180, 270])('回転%s度・CropBoxの矢印と吹き出しの24pt先端をPDFiumで描画し、再編集できる', async rotation => {
    const opened = openDocument(fixture(rotation)), doc = opened.document.asPDF()!
    try {
      const result = applyEdits(doc, [
        { kind: 'createLine', pageIndex: 0, line: [[60, 180], [160, 180]], color: [1, 0, 0], borderWidth: 1, lineEnding: { start: 'None', end: 'OpenArrow' }, arrowHeadSize: 24 },
        { kind: 'createCallout', pageIndex: 0, rect: [180, 235, 300, 265], point: [130, 250], text: '確認', fontSize: 12, font: 'BIZUDGothic', color: [1, 0, 0], borderColor: [1, 0, 0], arrowHeadSize: 24 },
      ], { BIZUDGothic: font })
      expect(result.errors).toEqual([])
      const bytes = saveDocument(doc, 'full').bytes, reopened = openDocument(bytes)
      try { expect(listAnnotations(reopened.document.asPDF()!, 0).map(a => a.arrowHeadSize)).toEqual([24, 24]) } finally { reopened.document.destroy() }
      expect(redPixels(bytes, [136, 167, 159, 174])).toBeGreaterThan(8)
      expect(redPixels(bytes, [131, 237, 153, 244])).toBeGreaterThan(8)
      await fs.mkdir('test-results/business-output', { recursive: true })
      const page = doc.loadPage(0), pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true)
      try { await fs.writeFile(`test-results/business-output/arrows-${rotation}.png`, pixmap.asPNG()) } finally { pixmap.destroy(); page.destroy() }
      const smaller = applyEdits(doc, [{ kind: 'updateLine', pageIndex: 0, objNum: result.created[0], line: [[60, 180], [160, 180]], color: [1, 0, 0], borderWidth: 1, lineEnding: { start: 'None', end: 'OpenArrow' }, arrowHeadSize: 4 }], {})
      expect(smaller.errors).toEqual([])
      expect(redPixels(saveDocument(doc, 'full').bytes, [136, 167, 159, 174])).toBe(0)
    } finally { doc.destroy() }
  })
  it('署名値があるPDFは編集・確定出力を停止し、通常の閲覧用コピーは原本のバイトを保つ', () => {
    const doc = openDocument(fixture()).document.asPDF()!, field = doc.newDictionary(), value = doc.newDictionary(), root = doc.getTrailer().get('Root')
    let bytes: Uint8Array
    try {
      field.put('FT', doc.newName('Sig')); value.put('Contents', doc.newString('SYNTHETIC SIGNATURE VALUE')); field.put('V', doc.addObject(value)); root.put('AcroForm', { Fields: [doc.addObject(field)] })
      expect(pdfEditRestriction(doc)).toContain('電子署名')
      expect(() => applyEditsAtomically(doc, [{ kind: 'createSquare', pageIndex: 0, rect: [0, 0, 30, 30], color: [1, 0, 0], borderWidth: 1 }], {})).toThrow('電子署名')
      bytes = saveDocument(doc, 'full').bytes
    } finally { root.destroy(); value.destroy(); field.destroy(); doc.destroy() }
    expect(() => prepareDocumentOutput(bytes!, [], {}, true)).toThrow('電子署名')
    const display = openDocument(bytes!, false)
    try {
      expect(display.editRestriction).toContain('電子署名')
      expect(display.pageSizes).toEqual([])
    } finally { display.document.destroy() }
    expect(prepareDocumentOutput(bytes!, [], {}, false).bytes).toEqual(bytes!)
  })
  it('空の署名欄は編集可能、DocMDP付きは閲覧専用にする', () => {
    const doc = openDocument(fixture()).document.asPDF()!, root = doc.getTrailer().get('Root')
    try { root.put('AcroForm', { Fields: [{ FT: 'Sig' }] }); expect(pdfEditRestriction(doc)).toBeNull(); root.put('Perms', { DocMDP: doc.addObject({ Type: 'Sig' }) }); expect(pdfEditRestriction(doc)).toContain('電子署名') } finally { root.destroy(); doc.destroy() }
  })
  it('空のユーザーパスワードでも編集権限のないPDFは閲覧専用にする', () => {
    const source = openDocument(fixture()).document.asPDF()!
    const buffer = source.saveToBuffer('encrypt=aes-256,owner-password=test-owner,user-password=,permissions=4')
    let bytes: Uint8Array
    try { bytes = new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy(); source.destroy() }
    const opened = openDocument(bytes!), doc = opened.document.asPDF()!
    try {
      expect(opened.editRestriction).toContain('編集権限')
      expect(doc.hasPermission('print')).toBe(true)
      expect(() => applyEditsAtomically(doc, [], {})).toThrow('編集権限')
    } finally { doc.destroy() }
    expect(() => prepareDocumentOutput(bytes!, [], {}, true)).toThrow('編集権限')
  })
  it('JPEG EXIFの日時と方向を除去し、JPEGの復号画素を変えない', () => {
    const original = withExif(testJpeg(), 6), cleaned = stripJpegMetadata(original)
    expect(readExif(original).orientation).toBe(6); expect(readExif(cleaned)).toEqual({ orientation: 1 })
    const a = new mupdf.Image(original), b = new mupdf.Image(cleaned), ap = a.toPixmap(), bp = b.toPixmap()
    try { expect(ap.getPixels()).toEqual(bp.getPixels()) } finally { ap.destroy(); bp.destroy(); a.destroy(); b.destroy() }
    expect(() => stripJpegMetadata(new Uint8Array([255, 216, 255, 225, 0, 20]))).toThrow()
  })
})
