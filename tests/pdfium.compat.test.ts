import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFDocument, type PDFPage } from 'mupdf'
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdits, type Rect } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { saveDocument } from '../src/core/save'
import { ensureSamplePdf } from './fixtures'

const fontPath = path.resolve('public/fonts/BIZUDGothic-Regular.ttf')
const wasmPath = path.resolve('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')
const pageRect: Rect = [72, 320, 272, 362]
const rotatedRect: Rect = [100, 100, 300, 145]
const scale = 2

let pdfium: WrappedPdfiumModule
let fontResource: FontResource
let annotatedBytes: Uint8Array

beforeAll(async () => {
  const wasmBinary = new Uint8Array(await fs.readFile(wasmPath))
  // Emscripten は実行ファイル名を ASCII 環境変数へ入れる。日本語を含む
  // 作業パスを使わない固定名にして、Node/Vitest でも初期化できるようにする。
  pdfium = await init({ wasmBinary, thisProgram: 'pdfium' })
  pdfium.FPDF_InitLibrary()
  pdfium.PDFiumExt_Init()
  fontResource = createFontResource(new Uint8Array(await fs.readFile(fontPath)))
  const source = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  const document = new mupdf.PDFDocument(source)
  try {
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
    ], fontResource)
    expect(applied.errors).toEqual([])
    annotatedBytes = saveDocument(document, 'full').bytes
  } finally {
    document.destroy()
  }
}, 120_000)

afterAll(() => {
  if (fontResource) fontResource.font.destroy()
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

function verifyPage(pageIndex: number, rect: Rect, label: string): void {
  const mupdfRed = countMuPdfRed(pageIndex, rect)
  const pdfiumRed = countPdfiumRed(pageIndex, rect)
  expect(mupdfRed).toBeGreaterThan(100)
  expect(pdfiumRed).toBeGreaterThanOrEqual(mupdfRed * 0.7)
  expect(pdfiumRed).toBeLessThanOrEqual(mupdfRed * 1.3)
  console.info(`PDFIUM_METRIC page=${label} mupdf_red=${mupdfRed} pdfium_red=${pdfiumRed}`)
}

describe('PDFium compatibility', () => {
  it('1ページ目の日本語 FreeText を MuPDF の±30%の赤画素数で描く', () => {
    verifyPage(0, pageRect, 'normal')
  })

  it('回転ページの日本語 FreeText を MuPDF の±30%の赤画素数で描く', () => {
    verifyPage(4, rotatedRect, 'rotated')
  })
})
