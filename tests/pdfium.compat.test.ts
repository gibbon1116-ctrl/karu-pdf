import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFDocument, type PDFPage } from 'mupdf'
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdits, SYMBOL_OPTIONS, type Rect } from '../src/core/annotations'
import { createDingbatsFontResource, createFontResource, type FontResource, type FontResources } from '../src/core/fontMetrics'
import { saveDocument } from '../src/core/save'
import { searchPage } from '../src/core/search'
import { ensureSamplePdf } from './fixtures'
import { measureText, ratioScale } from '../src/core/measure'

const fontPath = path.resolve('public/fonts/BIZUDGothic-Regular.ttf')
const minchoFontPath = path.resolve('public/fonts/BIZUDMincho-Regular.ttf')
const wasmPath = path.resolve('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')
const pageRect: Rect = [72, 320, 272, 362]
const rotatedRect: Rect = [100, 100, 300, 145]
const scale = 2

let pdfium: WrappedPdfiumModule
let fontResource: FontResource
let minchoFontResource: FontResource
let dingbatsFontResource: FontResource
let fontResources: FontResources
let sourceBytes: Uint8Array
let annotatedBytes: Uint8Array

beforeAll(async () => {
  const wasmBinary = new Uint8Array(await fs.readFile(wasmPath))
  // Emscripten は実行ファイル名を ASCII 環境変数へ入れる。日本語を含む
  // 作業パスを使わない固定名にして、Node/Vitest でも初期化できるようにする。
  pdfium = await init({ wasmBinary, thisProgram: 'pdfium' })
  pdfium.FPDF_InitLibrary()
  pdfium.PDFiumExt_Init()
  fontResource = createFontResource(new Uint8Array(await fs.readFile(fontPath)))
  minchoFontResource = createFontResource(
    new Uint8Array(await fs.readFile(minchoFontPath)),
    'BIZUDMincho',
  )
  dingbatsFontResource = createDingbatsFontResource()
  fontResources = {
    BIZUDGothic: fontResource,
    BIZUDMincho: minchoFontResource,
    ZapfDingbats: dingbatsFontResource,
  }
  sourceBytes = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  const document = new mupdf.PDFDocument(sourceBytes)
  try {
    const markups = (['Highlight', 'Underline', 'StrikeOut'] as const).map((markup, pageIndex) => {
      const page = document.loadPage(pageIndex)
      try {
        const markedText = `Sample page ${pageIndex + 1}`
        const quads = searchPage(page, pageIndex, markedText, { caseSensitive: true, normalizeWidth: false }).matches[0].quads
        return {
          kind: 'createTextMarkup' as const, pageIndex, markup, quads, markedText,
          color: [1, 0, 0] as [number, number, number], opacity: markup === 'Highlight' ? 0.4 : 1,
        }
      } finally { page.destroy() }
    })
    const applied = applyEdits(document, [
      {
        kind: 'createFreeText', pageIndex: 0, rect: pageRect,
        text: '日本語の書き込みテスト①（半角ABC 123）', fontSize: 10.5,
        color: [1, 0, 0], font: 'BIZUDGothic',
      },
      {
        kind: 'createFreeText', pageIndex: 4, rect: rotatedRect,
        text: '回転ページの日本語', fontSize: 10.5,
        color: [1, 0, 0], font: 'BIZUDGothic',
      },
      {
        kind: 'createLine', pageIndex: 0, line: [[300, 340], [470, 380]],
        color: [1, 0, 0], borderWidth: 3,
        lineEnding: { start: 'None', end: 'OpenArrow' },
      },
      {
        kind: 'createCircle', pageIndex: 0, rect: [300, 400, 400, 465],
        color: [0, 0, 1], borderWidth: 2, interiorColor: null,
      },
      {
        kind: 'createInk', pageIndex: 0,
        inkList: [[[72, 450], [140, 455], [230, 450]]],
        color: [1, 1, 0], borderWidth: 12, opacity: 0.35,
      },
      {
        kind: 'createInk', pageIndex: 0,
        inkList: [[[300, 500], [330, 480], [360, 510]], [[370, 480], [400, 510], [430, 485]]],
        color: [0, 0.7, 0], borderWidth: 3, opacity: 1,
      },
      {
        kind: 'createSquare', pageIndex: 0, rect: [300, 145, 450, 200],
        color: [], borderWidth: 0, interiorColor: [1, 1, 1],
      },
      {
        kind: 'createFreeText', pageIndex: 0, rect: [72, 560, 272, 605],
        text: '明朝体の日本語', fontSize: 12,
        color: [0.8, 0, 0.8], font: 'BIZUDMincho',
      },
      {
        kind: 'createSquare', pageIndex: 1, rect: [72, 100, 190, 160],
        color: [], borderWidth: 0, interiorColor: [0, 0.25, 1], opacity: 0.5,
      },
      {
        kind: 'createFreeText', pageIndex: 1, rect: [72, 200, 260, 245],
        text: '背景つき文字', fontSize: 10.5, color: [1, 0, 0], font: 'BIZUDGothic',
        backgroundColor: [1, 0.9, 0], borderColor: [0, 0, 0], borderWidth: 1,
      },
      {
        kind: 'createCallout', pageIndex: 1, rect: [300, 250, 460, 300], point: [250, 180],
        text: '吹き出し', fontSize: 10.5, color: [1, 0, 0], font: 'BIZUDGothic',
        backgroundColor: [1, 1, 1], borderColor: [1, 0, 0], borderWidth: 1,
      },
      ...SYMBOL_OPTIONS.map((option, index) => {
        const x = 72 + (index % 4) * 70
        const y = 100 + Math.floor(index / 4) * 70
        return {
          kind: 'createSymbol' as const,
          pageIndex: 2,
          rect: [x, y, x + 32, y + 32] as Rect,
          color: [1, 0, 0] as [number, number, number],
          symbol: option.name,
        }
      }),
      {
        kind: 'createFreeText', pageIndex: 2, rect: [72, 360, 300, 405],
        text: '確認✔済み✗', fontSize: 14,
        color: [1, 0, 0], font: 'BIZUDGothic',
      },
      {
        kind: 'createSquare', pageIndex: 3, rect: [60, 80, 390, 200],
        color: [], borderWidth: 0, interiorColor: [1, 1, 1], opacity: 1,
      },
      {
        kind: 'createFreeText', pageIndex: 3, rect: [72, 100, 372, 180],
        text: '透明度', fontSize: 30, color: [0, 0, 0], font: 'BIZUDGothic',
        backgroundColor: [1, 1, 0], borderColor: null, borderWidth: 1,
        textOpacity: 0.5, boxOpacity: 0.25,
      },
      ...markups,
    ], fontResources)
    expect(applied.errors).toEqual([])
    annotatedBytes = saveDocument(document, 'full').bytes
  } finally {
    document.destroy()
  }
}, 120_000)

afterAll(() => {
  if (fontResource) fontResource.font.destroy()
  if (minchoFontResource) minchoFontResource.font.destroy()
  if (dingbatsFontResource) dingbatsFontResource.font.destroy()
  if (pdfium) pdfium.FPDF_DestroyLibrary()
})

function countMuPdfRed(pageIndex: number, rect: Rect): number {
  const document = new mupdf.PDFDocument(annotatedBytes)
  const page = document.loadPage(pageIndex)
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    const pixels = pixmap.getPixels()
    const width = pixmap.getWidth()
    const height = pixmap.getHeight()
    let count = 0
    for (let y = Math.floor(rect[1] * scale); y < Math.min(height, Math.ceil(rect[3] * scale)); y += 1) {
      for (let x = Math.floor(rect[0] * scale); x < Math.min(width, Math.ceil(rect[2] * scale)); x += 1) {
        const offset = (y * width + x) * 3
        if (pixels[offset] > 160 && pixels[offset + 1] < 140 && pixels[offset + 2] < 140) count += 1
      }
    }
    return count
  } finally {
    pixmap.destroy()
    page.destroy()
    document.destroy()
  }
}

function countPdfiumRed(pageIndex: number, rect: Rect): number {
  const { pdfium: runtime } = pdfium
  const heap = (runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8
  const sourcePointer = runtime.wasmExports.malloc(annotatedBytes.length)
  heap.set(annotatedBytes, sourcePointer)
  const document = pdfium.FPDF_LoadMemDocument64(sourcePointer, annotatedBytes.length, '')
  if (!document) throw new Error(`PDFium が PDF を開けませんでした (${pdfium.FPDF_GetLastError()})。`)
  const page = pdfium.FPDF_LoadPage(document, pageIndex)
  if (!page) throw new Error(`PDFium が ${pageIndex + 1} ページ目を開けませんでした。`)
  const width = Math.ceil(pdfium.FPDF_GetPageWidthF(page) * scale)
  const height = Math.ceil(pdfium.FPDF_GetPageHeightF(page) * scale)
  const bitmap = pdfium.FPDFBitmap_Create(width, height, 1)
  if (!bitmap) throw new Error('PDFium がビットマップを作れませんでした。')
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
    const FPDF_ANNOT = 0x01
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, FPDF_ANNOT)
    const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap)
    const stride = pdfium.FPDFBitmap_GetStride(bitmap)
    let count = 0
    for (let y = Math.floor(rect[1] * scale); y < Math.min(height, Math.ceil(rect[3] * scale)); y += 1) {
      for (let x = Math.floor(rect[0] * scale); x < Math.min(width, Math.ceil(rect[2] * scale)); x += 1) {
        const offset = buffer + y * stride + x * 4
        const blue = heap[offset]
        const green = heap[offset + 1]
        const red = heap[offset + 2]
        if (red > 160 && green < 140 && blue < 140) count += 1
      }
    }
    return count
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap)
    pdfium.FPDF_ClosePage(page)
    pdfium.FPDF_CloseDocument(document)
    runtime.wasmExports.free(sourcePointer)
  }
}

function countPdfiumPixels(
  bytes: Uint8Array,
  pageIndex: number,
  rect: Rect,
  matches: (red: number, green: number, blue: number) => boolean,
): number {
  const { pdfium: runtime } = pdfium
  const heap = (runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8
  const sourcePointer = runtime.wasmExports.malloc(bytes.length)
  heap.set(bytes, sourcePointer)
  const document = pdfium.FPDF_LoadMemDocument64(sourcePointer, bytes.length, '')
  if (!document) throw new Error(`PDFium が PDF を開けませんでした (${pdfium.FPDF_GetLastError()})。`)
  const page = pdfium.FPDF_LoadPage(document, pageIndex)
  if (!page) throw new Error(`PDFium が ${pageIndex + 1} ページ目を開けませんでした。`)
  const width = Math.ceil(pdfium.FPDF_GetPageWidthF(page) * scale)
  const height = Math.ceil(pdfium.FPDF_GetPageHeightF(page) * scale)
  const bitmap = pdfium.FPDFBitmap_Create(width, height, 1)
  if (!bitmap) throw new Error('PDFium がビットマップを作れませんでした。')
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x01)
    const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap)
    const stride = pdfium.FPDFBitmap_GetStride(bitmap)
    let count = 0
    for (let y = Math.floor(rect[1] * scale); y < Math.min(height, Math.ceil(rect[3] * scale)); y += 1) {
      for (let x = Math.floor(rect[0] * scale); x < Math.min(width, Math.ceil(rect[2] * scale)); x += 1) {
        const offset = buffer + y * stride + x * 4
        if (matches(heap[offset + 2], heap[offset + 1], heap[offset])) count += 1
      }
    }
    return count
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap)
    pdfium.FPDF_ClosePage(page)
    pdfium.FPDF_CloseDocument(document)
    runtime.wasmExports.free(sourcePointer)
  }
}

function verifyPage(pageIndex: number, rect: Rect, label: string): void {
  const mupdfRed = countMuPdfRed(pageIndex, rect)
  const pdfiumRed = countPdfiumRed(pageIndex, rect)
  expect(mupdfRed).toBeGreaterThan(100)
  expect(pdfiumRed).toBeGreaterThanOrEqual(mupdfRed * 0.7)
  expect(pdfiumRed).toBeLessThanOrEqual(mupdfRed * 1.3)
  console.info(`PDFIUM_METRIC page=${label} mupdf_red=${mupdfRed} pdfium_red=${pdfiumRed}`)
}

describe('PDFium compatibility', () => {
  it.each([0, 90, 180, 270])('計測の線・値・面積をPDFiumで回転%s°でも正しい位置に描く', rotation => {
    const doc = new mupdf.PDFDocument(sourceBytes)
    try {
      const p = doc.findPage(0); try { p.put('Rotate', rotation) } finally { p.destroy() }
      const s = ratioScale(100, 'PDF', { width: 595, height: 842 })
      const measures = ([
        { kind: 'distance', points: [[100, 220], [172, 220]] },
        { kind: 'perimeter', points: [[280, 300], [352, 300], [352, 372]] },
        { kind: 'area', points: [[100, 400], [172, 400], [172, 472], [100, 472]] },
      ] as const).map(item => {
        const measure = { ...s, kind: item.kind }, vertices = item.points.map(p => [...p] as [number, number])
        return { kind: 'createMeasure' as const, pageIndex: 0, measure, vertices, text: measureText(vertices, measure), color: [1, 0, 0] as [number, number, number], borderWidth: 1, fontSize: 10.5, opacity: 1 }
      })
      expect(applyEdits(doc, measures, fontResources).errors).toEqual([])
      const bytes = saveDocument(doc, 'full').bytes
      const isRed = (r: number, g: number, b: number) => r > 150 && g < 120 && b < 120
      const distanceLabel = countPdfiumPixels(bytes, 0, [110, 195, 165, 216], isRed)
      const distanceLine = countPdfiumPixels(bytes, 0, [110, 218, 120, 223], isRed)
      const perimeterLabel = countPdfiumPixels(bytes, 0, [305, 346, 405, 370], isRed)
      const areaLabel = countPdfiumPixels(bytes, 0, [110, 425, 165, 447], isRed)
      const paleFill = countPdfiumPixels(bytes, 0, [110, 450, 160, 465], (r, g, b) => r > 240 && g >= 200 && g < 235 && b >= 200 && b < 235)
      expect(distanceLabel).toBeGreaterThan(40); expect(distanceLine).toBeGreaterThan(15)
      expect(perimeterLabel).toBeGreaterThan(40); expect(areaLabel).toBeGreaterThan(40); expect(paleFill).toBeGreaterThan(600)
      console.info(`PDFIUM_MEASURE rotation=${rotation} distance_label=${distanceLabel} distance_line=${distanceLine} perimeter_label=${perimeterLabel} area_label=${areaLabel} fill=${paleFill}`)
    } finally { doc.destroy() }
  })
  it('1ページ目の日本語 FreeText を MuPDF の±30%の赤画素数で描く', () => {
    verifyPage(0, pageRect, 'normal')
  })

  it('回転ページの日本語 FreeText を MuPDF の±30%の赤画素数で描く', () => {
    verifyPage(4, rotatedRect, 'rotated')
  })

  it('追加した注釈と明朝体を PDFium で描き、白塗りで下の内容を隠す', () => {
    const red = countPdfiumPixels(
      annotatedBytes, 0, [290, 330, 480, 390],
      (r, g, b) => r > 160 && g < 140 && b < 140,
    )
    const blue = countPdfiumPixels(
      annotatedBytes, 0, [290, 390, 410, 475],
      (r, g, b) => b > 150 && r < 140 && g < 140,
    )
    const yellow = countPdfiumPixels(
      annotatedBytes, 0, [60, 435, 245, 470],
      (r, g, b) => r > 220 && g > 220 && b < 220,
    )
    const green = countPdfiumPixels(
      annotatedBytes, 0, [290, 470, 440, 520],
      (r, g, b) => g > 110 && r < 140 && b < 140,
    )
    const magenta = countPdfiumPixels(
      annotatedBytes, 0, [72, 560, 272, 605],
      (r, g, b) => r > 130 && b > 130 && g < 140,
    )
    expect(red).toBeGreaterThan(50)
    expect(blue).toBeGreaterThan(50)
    expect(yellow).toBeGreaterThan(100)
    expect(green).toBeGreaterThan(50)
    expect(magenta).toBeGreaterThan(50)

    const whiteoutInner: Rect = [310, 155, 440, 190]
    const sourceBlue = countPdfiumPixels(
      sourceBytes, 0, whiteoutInner,
      (r, g, b) => b > r && b > g && r < 245,
    )
    const hiddenBlue = countPdfiumPixels(
      annotatedBytes, 0, whiteoutInner,
      (r, g, b) => b > r && b > g && r < 245,
    )
    const white = countPdfiumPixels(
      annotatedBytes, 0, whiteoutInner,
      (r, g, b) => r > 250 && g > 250 && b > 250,
    )
    expect(sourceBlue).toBeGreaterThan(1_000)
    expect(hiddenBlue).toBeLessThan(sourceBlue * 0.05)
    expect(white).toBeGreaterThan(10_000)
    console.info(
      `PDFIUM_METRIC added red=${red} blue=${blue} yellow=${yellow} green=${green} mincho=${magenta} `
      + `whiteout_source_blue=${sourceBlue} whiteout_hidden_blue=${hiddenBlue} whiteout_white=${white}`,
    )
  })

  it('半透明の塗り、背景つき文字、矢印つき吹き出しをPDFiumで描く', () => {
    const blueFill = countPdfiumPixels(
      annotatedBytes, 1, [80, 108, 182, 152],
      (r, g, b) => b > r + 35 && b > g + 15,
    )
    const yellowBackground = countPdfiumPixels(
      annotatedBytes, 1, [80, 205, 250, 240],
      (r, g, b) => r > 220 && g > 190 && b < 190,
    )
    const calloutRed = countPdfiumPixels(
      annotatedBytes, 1, [240, 170, 470, 310],
      (r, g, b) => r > 160 && g < 150 && b < 150,
    )
    expect(blueFill).toBeGreaterThan(1_000)
    expect(yellowBackground).toBeGreaterThan(1_000)
    expect(calloutRed).toBeGreaterThan(100)
    console.info(`PDFIUM_METRIC spec01e blue_fill=${blueFill} yellow_background=${yellowBackground} callout_red=${calloutRed}`)
  })

  it('12種類の記号とZapfDingbatsの文字をPDFiumで描く', () => {
    const symbols = countPdfiumPixels(
      annotatedBytes, 2, [65, 90, 360, 285],
      (r, g, b) => r > 150 && g < 150 && b < 150,
    )
    const fallbackText = countPdfiumPixels(
      annotatedBytes, 2, [65, 350, 310, 415],
      (r, g, b) => r > 150 && g < 150 && b < 150,
    )
    expect(symbols).toBeGreaterThan(300)
    expect(fallbackText).toBeGreaterThan(50)
    console.info(`PDFIUM_METRIC symbols=${symbols} fallback_text=${fallbackText}`)
  })

  it('ハイライト・下線・取り消し線をPDFiumで描く', () => {
    const redPixels = [0, 1, 2].map((pageIndex) => countPdfiumPixels(
      annotatedBytes, pageIndex, [60, 35, 280, 100],
      (r, g, b) => r > 140 && g < 140 && b < 140,
    ))
    expect(redPixels.every((count) => count > 10)).toBe(true)
    console.info(`PDFIUM_METRIC text_markup=${redPixels.join(',')}`)
  })

  it('文字50%と背景25%を別々の濃さでPDFium描画する', () => {
    const paleYellow = countPdfiumPixels(
      annotatedBytes, 3, [220, 110, 360, 170],
      (r, g, b) => r > 245 && g > 245 && b >= 165 && b <= 225,
    )
    const halfBlack = countPdfiumPixels(
      annotatedBytes, 3, [70, 95, 220, 180],
      (r, g, b) => r >= 70 && r <= 190 && g >= 70 && g <= 190 && b >= 45 && b <= 165,
    )
    expect(paleYellow).toBeGreaterThan(5_000)
    expect(halfBlack).toBeGreaterThan(100)
    console.info(`PDFIUM_METRIC opacity pale_yellow=${paleYellow} half_black=${halfBlack}`)
  })
})
