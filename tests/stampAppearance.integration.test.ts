import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import mupdf, { type PDFDocument, type PDFPage } from 'mupdf'
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Rect } from '../src/core/annotations'
import { readCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { AnnotationStore } from '../src/editor/AnnotationStore'

let font: FontResource, pdfium: WrappedPdfiumModule
beforeAll(async () => {
  font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  pdfium = await init({ wasmBinary: new Uint8Array(await fs.readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')), thisProgram: 'pdfium' })
  pdfium.FPDF_InitLibrary()
})
afterAll(() => { font.font.destroy(); pdfium.FPDF_DestroyLibrary() })

function makeDocument(rotation: 0 | 90 | 180 | 270 = 0, userUnit = 1): PDFDocument {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 640, 840], rotation, {}, '')
  try { doc.insertPage(-1, ref) } finally { ref.destroy() }
  const page = doc.findPage(0)
  try { page.put('CropBox', [20, 30, 620, 810]); page.put('UserUnit', userUnit) } finally { page.destroy() }
  return doc
}

function fixture(opacity = 1): CountFixture {
  return { id: 'dl', name: 'ダウンライト', code: 'DL', category: '照明器具', order: 0,
    style: { shape: 'star', fill: 'solid', color: [1, 0, 0], size: 24, opacity, showCode: true } }
}
function countMark(id: string, rect: Rect, countFixture = fixture()): Extract<AnnotationEdit, { kind: 'createSymbol' }> {
  return { kind: 'createSymbol', pageIndex: 0, rect, symbol: 'circle', color: countFixture.style.color,
    count: { version: 2, id, fixtureId: countFixture.id }, countFixture }
}
function issue(rect: Rect): Extract<AnnotationEdit, { kind: 'createIssue' }> {
  return { kind: 'createIssue', pageIndex: 0, rect, issue: { number: 8, status: 'open' }, text: '寸法確認', color: [1, 0, 0] }
}
function savedBytes(doc: PDFDocument): Uint8Array {
  const buffer = doc.saveToBuffer('compress')
  try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
}

function appearances(page: PDFPage) {
  // MuPDF.js caches these handles on the page, so the page owns them: destroying
  // them here would break a second call on the same page.
  const annotations = page.getAnnotations()
  {
    return annotations.map(annotation => {
      const object = annotation.getObject(), appearance = object.get('AP', 'N')
      const resources = appearance.get('Resources'), fonts = resources.get('Font')
      const bbox = appearance.get('BBox'), matrix = appearance.get('Matrix'), stream = appearance.readStream()
      try {
        expect(appearance.isStream()).toBe(true)
        const fontObjects: number[] = []
        fonts.forEach(value => { try { fontObjects.push(value.asIndirect()) } finally { value.destroy() } })
        return { contents: stream.asString(), resources: resources.asIndirect(), fonts: fontObjects,
          bbox: bbox.asJS(), matrix: matrix.asJS(), opacity: annotation.getOpacity(), text: annotation.getContents() }
      } finally {
        stream.destroy(); matrix.destroy(); bbox.destroy(); fonts.destroy(); resources.destroy(); appearance.destroy(); object.destroy()
      }
    })
  }
}

function updateAndRender(page: PDFPage): void {
  page.update()
  const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true)
  try { expect(pixmap.getPixels().length).toBeGreaterThan(0) } finally { pixmap.destroy() }
}

function expectStar(contents: string): void {
  // A filled ten-vertex star and its outline each have nine line segments.
  // MuPDF's generated default Stamp and the old circle do not have this path.
  expect(contents.match(/(?:^|\s)l(?=\s|$)/g)).toHaveLength(18)
  expect(contents).toMatch(/(?:^|\s)f(?=\s|$)/)
  expect(contents).toMatch(/(?:^|\s)S(?=\s|$)/)
  expect(contents).toContain('BT') // fixture code uses the shared subset font
}

function expectRedCenter(pixels: ArrayLike<number>, stride: number, components: number, red: number, blue: number, rect: Rect, exact: boolean): void {
  const x = Math.floor((rect[0] + rect[2]) / 2), y = Math.floor((rect[1] + rect[3]) / 2)
  const isRed = (px: number, py: number) => {
    const at = py * stride + px * components
    return pixels[at + red] > 180 && pixels[at + 1] < 100 && pixels[at + blue] < 100
  }
  if (exact) expect(isRed(x, y)).toBe(true)
  else {
    // The issue circle has a white interior: sample its central numeral's pixels.
    let colored = 0
    for (let py = y - 2; py <= y + 2; py++) for (let px = x - 2; px <= x + 2; px++) if (isRed(px, py)) colored++
    expect(colored).toBeGreaterThan(0)
  }
}

function expectPdfiumCenters(bytes: Uint8Array, countRect: Rect, issueRect: Rect): void {
  const runtime = pdfium.pdfium, pointer = runtime.wasmExports.malloc(bytes.length)
  let document = 0, page = 0, bitmap = 0
  try {
    ;(runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, pointer)
    document = pdfium.FPDF_LoadMemDocument64(pointer, bytes.length, ''); expect(document).not.toBe(0)
    page = pdfium.FPDF_LoadPage(document, 0)
    const width = Math.ceil(pdfium.FPDF_GetPageWidthF(page)), height = Math.ceil(pdfium.FPDF_GetPageHeightF(page))
    bitmap = pdfium.FPDFBitmap_Create(width, height, 1)
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 1)
    const heap = (runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8
    const offset = pdfium.FPDFBitmap_GetBuffer(bitmap), stride = pdfium.FPDFBitmap_GetStride(bitmap)
    const pixels = heap.subarray(offset, offset + stride * height)
    expectRedCenter(pixels, stride, 4, 2, 0, countRect, true)
    expectRedCenter(pixels, stride, 4, 2, 0, issueRect, false)
  } finally {
    if (bitmap) pdfium.FPDFBitmap_Destroy(bitmap)
    if (page) pdfium.FPDF_ClosePage(page)
    if (document) pdfium.FPDF_CloseDocument(document)
    runtime.wasmExports.free(pointer)
  }
}

describe('count/issue setAppearance saves', () => {
  it('migrates 2,000 legacy counts and changes one fixture style within five seconds', async () => {
    const source = makeDocument()
    let legacy: Uint8Array
    try {
      const initial = applyEdits(source, Array.from({ length: 2000 }, (_, i): AnnotationEdit => {
        const x = 12 + i % 50 * 11, y = 12 + Math.floor(i / 50) * 15
        return { kind: 'createSymbol', pageIndex: 0, rect: [x, y, x + 10, y + 10], symbol: 'circle', color: [0, 0, 1],
          count: { version: 1, id: `legacy-${i}`, group: '照明器具' } }
      }), {})
      expect(initial.errors).toEqual([])
      legacy = savedBytes(source)
    } finally { source.destroy() }
    const doc = new mupdf.PDFDocument(legacy!)
    try {
      const store = new AnnotationStore()
      await store.ensureCountFixtures(async () => readCountFixtures(doc), async () => store.ensurePageLoaded(0, async () => listAnnotations(doc, 0)))
      expect(store.getCountFixtures()).toHaveLength(1)
      const old = store.getCountFixtures()[0]
      const changed: CountFixture = { ...old, code: 'DL', style: { ...fixture().style, size: 10 } }
      store.setCountFixtures([changed])
      const edits = store.toEdits()
      expect(edits.filter(edit => edit.kind === 'updateSymbol')).toHaveLength(2000)
      const update = vi.spyOn(mupdf.PDFAnnotation.prototype, 'update')
      try {
        const start = performance.now(), result = applyEdits(doc, edits, { BIZUDGothic: font }), elapsed = performance.now() - start
        expect(result.errors).toEqual([])
        expect(update).not.toHaveBeenCalled()
        expect(elapsed).toBeLessThanOrEqual(5000)
      } finally { update.mockRestore() }
      const reopened = new mupdf.PDFDocument(savedBytes(doc))
      try {
        expect(readCountFixtures(reopened)).toEqual([changed])
        const marks = listAnnotations(reopened, 0)
        expect(marks).toHaveLength(2000)
        expect(marks.every(mark => mark.count?.version === 2 && mark.count.fixtureId === changed.id)).toBe(true)
        expect(new Set(marks.map(mark => mark.count!.id)).size).toBe(2000)
        const page = reopened.loadPage(0)
        try {
          const saved = appearances(page)
          for (const appearance of saved) expectStar(appearance.contents)
          expect(new Set(saved.map(appearance => appearance.resources)).size).toBe(1)
          expect(saved[0].resources).toBeGreaterThan(0)
          expect(saved[0].fonts.length).toBeGreaterThan(0)
          expect(saved.every(appearance => JSON.stringify(appearance.fonts) === JSON.stringify(saved[0].fonts))).toBe(true)
        } finally { page.destroy() }
      } finally { reopened.destroy() }
    } finally { doc.destroy() }
  }, 30_000)

  it('keeps created and updated custom APs through page.update, rendering, save and reopen without annotation.update', () => {
    const doc = makeDocument(90, 2)
    try {
      const initial = applyEdits(doc, [countMark('existing', [40, 60, 64, 84]), issue([100, 60, 124, 84])], { BIZUDGothic: font })
      expect(initial.errors).toEqual([])
      const update = vi.spyOn(mupdf.PDFAnnotation.prototype, 'update')
      try {
        const result = applyEdits(doc, [
          { ...countMark('existing', [50, 160, 74, 184], fixture(.5)), kind: 'updateSymbol', objNum: initial.created[0] },
          { ...issue([110, 160, 134, 184]), kind: 'updateIssue', objNum: initial.created[1], issue: { number: 123, status: 'done' } },
          countMark('new', [200, 260, 224, 284], fixture(.5)), issue([300, 260, 324, 284]),
        ], { BIZUDGothic: font })
        expect(result.errors).toEqual([])
        expect(result.created).toHaveLength(2)
        expect(update).not.toHaveBeenCalled()
      } finally { update.mockRestore() }
      const page = doc.loadPage(0)
      const before = appearances(page)
      try {
        expectStar(before[0].contents); expectStar(before[2].contents)
        expect(before[0].resources).toBe(before[2].resources)
        expect(before[0].opacity).toBe(.5); expect(before[2].opacity).toBe(.5)
        for (const index of [1, 3]) {
          expect(before[index].contents).toContain('BT')
          expect(before[index].contents).toMatch(/(?:^|\s)c(?=\s|$)/) // custom circle
          expect(before[index].contents).toMatch(/(?:^|\s)S(?=\s|$)/)
        }
        updateAndRender(page)
        expect(appearances(page)).toEqual(before)
      } finally { page.destroy() }
      const reopened = new mupdf.PDFDocument(savedBytes(doc))
      try {
        const page = reopened.loadPage(0)
        try {
          updateAndRender(page)
          expect(appearances(page)).toEqual(before)
        } finally { page.destroy() }
        const marks = listAnnotations(reopened, 0)
        expect(marks[0].rect).toEqual([50, 160, 74, 184])
        expect(marks[1].issue).toEqual({ number: 123, status: 'done' })
        expect(marks[2].rect).toEqual([200, 260, 224, 284])
        expect(marks[3].issue).toEqual({ number: 8, status: 'open' })
      } finally { reopened.destroy() }
    } finally { doc.destroy() }
  })

  it.each([0, 90, 180, 270] as const)('renders count/issue centers at visible coordinates on rotation %s with an offset CropBox', rotation => {
    const doc = makeDocument(rotation), countRect: Rect = [80, 100, 104, 124], issueRect: Rect = [180, 160, 204, 184]
    try {
      const result = applyEdits(doc, [countMark('rotated', countRect), issue(issueRect)], { BIZUDGothic: font })
      expect(result.errors).toEqual([])
      const page = doc.loadPage(0)
      try {
        const before = appearances(page)
        page.update()
        const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true)
        try {
          expectRedCenter(pixmap.getPixels(), pixmap.getStride(), pixmap.getNumberOfComponents(), 0, 2, countRect, true)
          expectRedCenter(pixmap.getPixels(), pixmap.getStride(), pixmap.getNumberOfComponents(), 0, 2, issueRect, false)
        } finally { pixmap.destroy() }
        expect(appearances(page)).toEqual(before)
      } finally { page.destroy() }
      const bytes = savedBytes(doc)
      expectPdfiumCenters(bytes, countRect, issueRect)
      const reopened = new mupdf.PDFDocument(bytes)
      try {
        const marks = listAnnotations(reopened, 0)
        expect(marks[0].rect).toEqual(countRect); expect(marks[1].rect).toEqual(issueRect)
      } finally { reopened.destroy() }
    } finally { doc.destroy() }
  })
})
