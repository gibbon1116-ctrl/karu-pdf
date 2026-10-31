import fs from 'node:fs/promises'
import mupdf, { type Pixmap } from 'mupdf'
import { init } from '@embedpdf/pdfium'
import { expect, it } from 'vitest'
import { readExif, type ExifOrientation } from '../src/core/exif'
import { DEFAULT_IMAGE_PDF_SETTINGS as defaults, layoutImages, type ImagePdfSettings } from '../src/core/imagePdfLayout'
import { MemoryPdfWriteTarget, PdfStreamWriter } from '../src/core/pdfStreamWriter'
import { createImagesPdf, type ImageWorkerClient } from '../src/client/ImageWorkerClient'
import { CORNER_COLORS, ORIENTED_CORNERS, testJpeg } from './imagePdfFixtures'

async function build(images: { bytes: Uint8Array; orientation?: ExifOrientation; color?: number[] }[], settings: ImagePdfSettings = { ...defaults, quality: 'original', orientation: 'portrait' }) {
  const target = new MemoryPdfWriteTarget(), writer = new PdfStreamWriter(target)
  const pages = layoutImages(images.map(image => ({ width: 120, height: 80, orientation: image.orientation ?? 1 })), settings)
  await writer.start()
  for (const p of pages) await writer.writeImagesPage(p, p.placements.map(place => ({ ...place, orientation: images[place.index].orientation ?? 1,
    image: { bytes: images[place.index].bytes, format: 'jpeg', width: 120, height: 80, components: 3 } })))
  await writer.close()
  return { bytes: target.toBytes(), pages }
}
function nearColor(actual: number[], expected: number[]) { for (let i = 0; i < 3; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThan(28) }
function pixel(pixmap: Pixmap, x: number, y: number): number[] {
  const at = (Math.floor(y) * pixmap.getWidth() + Math.floor(x)) * pixmap.getNumberOfComponents()
  return Array.from(pixmap.getPixels().subarray(at, at + 3))
}

it('JPEG3枚のDCTバイト列・A4・余白・比・中央配置を実際のPDF内容から照合する', async () => {
  const images = Array.from({ length: 3 }, (_, i) => ({ bytes: testJpeg(120, 80, CORNER_COLORS[i]) }))
  const { bytes } = await build(images), doc = new mupdf.PDFDocument(bytes)
  try {
    expect(doc.countPages()).toBe(3)
    for (let i = 0; i < 3; i++) {
      const object = doc.findPage(i), image = object.get('Resources', 'XObject', 'Im0'), filter = image.get('Filter'), raw = image.readRawStream(), content = object.get('Contents'), stream = content.readStream()
      try {
        expect(filter.asName()).toBe('DCTDecode'); expect(new Uint8Array(raw.asUint8Array())).toEqual(images[i].bytes)
        const commands = new TextDecoder().decode(stream.asUint8Array())
        const matrix = commands.match(/q ([\d.\- ]+) cm/)![1].trim().split(/\s+/).map(Number)
        const [w, b, c, h, x, y] = matrix
        expect([b, c]).toEqual([0, 0]); expect(w / h).toBeCloseTo(1.5)
        const page = doc.loadPage(i), bounds = page.getBounds(), pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
        try {
          expect(bounds[2]).toBeCloseTo(595.27559, 3); expect(bounds[3]).toBeCloseTo(841.88976, 3)
          expect(x).toBeCloseTo(28.346457); expect(bounds[2] - x - w).toBeCloseTo(28.346457)
          expect(y).toBeGreaterThan(28.346); expect(y + h / 2).toBeCloseTo(bounds[3] / 2, 3)
          nearColor(pixel(pixmap, bounds[2] / 2, bounds[3] / 2), CORNER_COLORS[i])
          nearColor(pixel(pixmap, 5, 5), [255, 255, 255])
        } finally { pixmap.destroy(); page.destroy() }
      } finally { stream.destroy(); content.destroy(); raw.destroy(); filter.destroy(); image.destroy(); object.destroy() }
    }
  } finally { doc.destroy() }
})

for (let orientation = 1; orientation <= 8; orientation++) it(`EXIF${orientation}: JPEGをそのまま埋め込み、描画した四隅の画素位置が正しい`, async () => {
  const bytes = testJpeg(120, 80, undefined, orientation as ExifOrientation)
  const output = await build([{ bytes, orientation: readExif(bytes).orientation }], { ...defaults, paper: 'image', quality: 'original' })
  const doc = new mupdf.PDFDocument(output.bytes), page = doc.loadPage(0), pixmap = page.toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, false)
  try {
    const w = pixmap.getWidth(), h = pixmap.getHeight()
    for (const [corner, [x, y]] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].entries()) nearColor(pixel(pixmap, x * w, y * h), CORNER_COLORS[ORIENTED_CORNERS[orientation - 1][corner]])
    if (process.env.KARU_IMAGE_QA === '1' && [6, 8].includes(orientation)) {
      await fs.mkdir('tests/.image-pdf-qa', { recursive: true }); await fs.writeFile(`tests/.image-pdf-qa/exif-${orientation}.png`, pixmap.asPNG())
    }
  } finally { pixmap.destroy(); page.destroy(); doc.destroy() }
})

it('4枚が2×2に並ぶことを描画後の画素と白い区画間で確かめる', async () => {
  const output = await build(CORNER_COLORS.map(color => ({ bytes: testJpeg(120, 80, color) })), { ...defaults, perPage: 4, quality: 'original' })
  const doc = new mupdf.PDFDocument(output.bytes), page = doc.loadPage(0), pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
  try {
    output.pages[0].placements.forEach((p, i) => nearColor(pixel(pixmap, p.x + p.width / 2, p.y + p.height / 2), CORNER_COLORS[i]))
    nearColor(pixel(pixmap, output.pages[0].width / 2, output.pages[0].height / 4), [255, 255, 255])
    nearColor(pixel(pixmap, output.pages[0].width / 4, output.pages[0].height / 2), [255, 255, 255])
    if (process.env.KARU_IMAGE_QA === '1') { await fs.mkdir('tests/.image-pdf-qa', { recursive: true }); await fs.writeFile('tests/.image-pdf-qa/four.png', pixmap.asPNG()) }
  } finally { pixmap.destroy(); page.destroy(); doc.destroy() }
})

it('PDFiumでもEXIF1〜8の四隅の色・位置が正しく描かれる', async () => {
  const pdfium = await init({ wasmBinary: new Uint8Array(await fs.readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')), thisProgram: 'pdfium' })
  pdfium.FPDF_InitLibrary()
  const runtime = pdfium.pdfium, heap = () => (runtime as unknown as { HEAPU8: Uint8Array }).HEAPU8
  try {
    const output = await build(Array.from({ length: 8 }, (_, i) => ({ bytes: testJpeg(120, 80, undefined, i + 1 as ExifOrientation), orientation: i + 1 as ExifOrientation })), { ...defaults, paper: 'image', quality: 'original' })
    const pointer = runtime.wasmExports.malloc(output.bytes.length); heap().set(output.bytes, pointer)
    const doc = pdfium.FPDF_LoadMemDocument64(pointer, output.bytes.length, '')
    expect(doc).toBeTruthy()
    try {
      for (let i = 0; i < 8; i++) {
        const page = pdfium.FPDF_LoadPage(doc, i), w = i < 4 ? 240 : 160, h = i < 4 ? 160 : 240, bitmap = pdfium.FPDFBitmap_Create(w, h, 1)
        try {
          pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff); pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, w, h, 0, 0)
          const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap), stride = pdfium.FPDFBitmap_GetStride(bitmap)
          for (const [corner, [x, y]] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].entries()) {
            const at = buffer + Math.floor(y * h) * stride + Math.floor(x * w) * 4, pixels = heap()
            nearColor([pixels[at + 2], pixels[at + 1], pixels[at]], CORNER_COLORS[ORIENTED_CORNERS[i][corner]])
          }
        } finally { pdfium.FPDFBitmap_Destroy(bitmap); pdfium.FPDF_ClosePage(page) }
      }
    } finally { pdfium.FPDF_CloseDocument(doc); runtime.wasmExports.free(pointer) }
  } finally { pdfium.FPDF_DestroyLibrary() }
})

it('作成の逐次処理・進捗・中止後に結果を返さない', async () => {
  const bytes = testJpeg(), entries = Array.from({ length: 3 }, () => ({ file: {} as File, info: { width: 120, height: 80, orientation: 1 as const } }))
  let inFlight = 0, maximum = 0, calls = 0
  const client = { request: async () => {
    calls++; maximum = Math.max(maximum, ++inFlight); await Promise.resolve(); inFlight--
    return { width: 120, height: 80, orientation: 1, image: { bytes, width: 120, height: 80, components: 3, format: 'jpeg' } }
  } } as unknown as ImageWorkerClient
  const progress: number[] = [], output = await createImagesPdf(client, entries, defaults, undefined, n => progress.push(n))
  expect(maximum).toBe(1); expect(progress).toEqual([1, 2, 3]); expect(output.length).toBeGreaterThan(bytes.length)
  calls = 0
  const controller = new AbortController()
  await expect(createImagesPdf(client, entries, defaults, controller.signal, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' })
  expect(calls).toBe(1)
})
