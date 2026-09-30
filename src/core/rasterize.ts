import mupdf, { type PDFDocument, type Rect } from 'mupdf'
import { MemoryPdfWriteTarget, PdfStreamWriter } from './pdfStreamWriter'

export type RasterColor = 'color' | 'gray'
export type RasterFormat = 'jpeg' | 'png'

export interface RasterizeOptions {
  dpi: 150 | 200 | 300
  color: RasterColor
  format: RasterFormat
  pageIndexes: number[]
}

export interface RasterBandPlan {
  index: number
  y: number
  height: number
  deviceRect: Rect
}

export interface RasterPagePlan {
  sourcePageIndex: number
  outputPageIndex: number
  width: number
  height: number
  pixelWidth: number
  pixelHeight: number
  scale: number
  bands: RasterBandPlan[]
}

export interface RasterizedBand {
  bytes: Uint8Array
  width: number
  height: number
  components: number
  pixelBytes: number
}

export const MAX_RASTER_BAND_PIXELS = 30_000_000

function scaledBounds(bounds: Rect, scale: number): Rect {
  return [
    Math.floor(bounds[0] * scale),
    Math.floor(bounds[1] * scale),
    Math.ceil(bounds[2] * scale),
    Math.ceil(bounds[3] * scale),
  ]
}

export function planRasterPages(document: PDFDocument, options: RasterizeOptions): RasterPagePlan[] {
  const pageCount = document.countPages()
  if (options.pageIndexes.length === 0) throw new Error('画像にするページがありません。')
  const scale = options.dpi / 72
  return options.pageIndexes.map((sourcePageIndex, outputPageIndex) => {
    if (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0 || sourcePageIndex >= pageCount) {
      throw new Error(`ページ番号が範囲外です: ${sourcePageIndex + 1}`)
    }
    const page = document.loadPage(sourcePageIndex)
    try {
      const bounds = page.getBounds()
      const deviceBounds = scaledBounds(bounds, scale)
      const pixelWidth = deviceBounds[2] - deviceBounds[0]
      const pixelHeight = deviceBounds[3] - deviceBounds[1]
      const bandHeight = Math.max(1, Math.min(pixelHeight, Math.floor(MAX_RASTER_BAND_PIXELS / pixelWidth)))
      const bands: RasterBandPlan[] = []
      for (let y = 0; y < pixelHeight; y += bandHeight) {
        const height = Math.min(bandHeight, pixelHeight - y)
        bands.push({
          index: bands.length,
          y,
          height,
          deviceRect: [deviceBounds[0], deviceBounds[1] + y, deviceBounds[2], deviceBounds[1] + y + height],
        })
      }
      return {
        sourcePageIndex,
        outputPageIndex,
        width: bounds[2] - bounds[0],
        height: bounds[3] - bounds[1],
        pixelWidth,
        pixelHeight,
        scale,
        bands,
      }
    } finally {
      page.destroy()
    }
  })
}

export function renderRasterBand(
  document: PDFDocument,
  pagePlan: RasterPagePlan,
  bandPlan: RasterBandPlan,
  options: Pick<RasterizeOptions, 'color' | 'format'>,
): RasterizedBand {
  const page = document.loadPage(pagePlan.sourcePageIndex)
  const colorspace = options.color === 'gray' ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB
  const pixmap = new mupdf.Pixmap(colorspace, bandPlan.deviceRect, false)
  let device: import('mupdf').DrawDevice | undefined
  try {
    pixmap.clear(255)
    device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
    page.runPageContents(device, mupdf.Matrix.scale(pagePlan.scale, pagePlan.scale))
    page.runPageAnnots(device, mupdf.Matrix.scale(pagePlan.scale, pagePlan.scale))
    page.runPageWidgets(device, mupdf.Matrix.scale(pagePlan.scale, pagePlan.scale))
    device.close()
    device.destroy()
    device = undefined
    const encoded = options.format === 'png' ? pixmap.asPNG() : pixmap.asJPEG(85)
    const bytes = new Uint8Array(encoded)
    const components = pixmap.getNumberOfComponents()
    return {
      bytes,
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      components,
      pixelBytes: pixmap.getWidth() * pixmap.getHeight() * components,
    }
  } finally {
    device?.destroy()
    pixmap.destroy()
    page.destroy()
  }
}

export async function rasterizeDocument(document: PDFDocument, options: RasterizeOptions): Promise<Uint8Array> {
  const plans = planRasterPages(document, options)
  const target = new MemoryPdfWriteTarget()
  const writer = new PdfStreamWriter(target)
  try {
    await writer.start()
    for (const pagePlan of plans) {
      const bands = []
      for (const bandPlan of pagePlan.bands) {
        const rendered = renderRasterBand(document, pagePlan, bandPlan, options)
        bands.push({ ...rendered, format: options.format })
      }
      await writer.writePage(pagePlan, bands)
    }
    await writer.close()
    return target.toBytes()
  } catch (error) {
    await writer.abort(error)
    throw error
  }
}
