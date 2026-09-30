import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFDocument, type PDFObject } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdits, type AnnotationEdit } from '../src/core/annotations'
import { createFontResource, type FontResources } from '../src/core/fontMetrics'
import {
  MAX_RASTER_BAND_PIXELS,
  planRasterPages,
  rasterizeDocument,
  type RasterizeOptions,
} from '../src/core/rasterize'
import { ensureSamplePdf } from './fixtures'

let sourceBytes: Uint8Array
let fonts: FontResources

beforeAll(async () => {
  sourceBytes = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  fonts = {
    BIZUDGothic: createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf')))),
  }
})

afterAll(() => fonts.BIZUDGothic?.font.destroy())

function options(overrides: Partial<RasterizeOptions> = {}): RasterizeOptions {
  return { dpi: 150, color: 'color', format: 'jpeg', pageIndexes: [0, 1, 2, 3, 4], ...overrides }
}

function pageSize(document: PDFDocument, pageIndex: number): [number, number] {
  const page = document.loadPage(pageIndex)
  try {
    const bounds = page.getBounds()
    return [bounds[2] - bounds[0], bounds[3] - bounds[1]]
  } finally { page.destroy() }
}

function destroyObjects(objects: PDFObject[]): void {
  for (const object of objects) object.destroy()
}

async function heavyOrGeneratedBytes(): Promise<Uint8Array> {
  try {
    return new Uint8Array(await fs.readFile(path.resolve('test-data/heavy-300p.pdf')))
  } catch {
    const document = new mupdf.PDFDocument()
    try {
      for (let index = 0; index < 6; index += 1) {
        const a1 = index === 5
        const page = document.addPage(
          a1 ? [0, 0, 2384, 1684] : [0, 0, 595, 842],
          0,
          {},
          a1 ? '0.2 0.4 0.8 rg 0 0 2384 1684 re f' : '',
        )
        try { document.insertPage(-1, page) } finally { page.destroy() }
      }
      const buffer = document.saveToBuffer('compress')
      try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
    } finally { document.destroy() }
  }
}

describe('画像として保存', () => {
  it('150 dpi・JPEGで回転後の大きさを保ち、文字と注釈を除く', async () => {
    const source = new mupdf.PDFDocument(sourceBytes)
    const originalSizes = Array.from({ length: source.countPages() }, (_, index) => pageSize(source, index))
    const rasterized = await rasterizeDocument(source, options())
    source.destroy()

    const output = new mupdf.PDFDocument(rasterized)
    try {
      expect(output.countPages()).toBe(5)
      expect(pageSize(output, 4)[0]).toBeGreaterThan(pageSize(output, 4)[1])
      for (let index = 0; index < output.countPages(); index += 1) {
        const [width, height] = pageSize(output, index)
        expect(width).toBeCloseTo(originalSizes[index][0], 4)
        expect(height).toBeCloseTo(originalSizes[index][1], 4)
        const page = output.loadPage(index)
        try {
          const text = page.toStructuredText('preserve-spans')
          try { expect(text.asText()).toBe('') } finally { text.destroy() }
          const annotations = page.getAnnotations()
          try { expect(annotations).toHaveLength(0) } finally { annotations.forEach((item) => item.destroy()) }
        } finally { page.destroy() }
      }
    } finally { output.destroy() }
  })

  it('赤い文字の書き込みを赤い画素として焼き付ける', async () => {
    const document = new mupdf.PDFDocument(sourceBytes)
    const edit: AnnotationEdit = {
      kind: 'createFreeText', pageIndex: 1, rect: [60, 80, 300, 145], text: '赤い書き込み',
      fontSize: 24, color: [1, 0, 0], font: 'BIZUDGothic',
    }
    expect(applyEdits(document, [edit], fonts).errors).toEqual([])
    const rasterized = await rasterizeDocument(document, options({ pageIndexes: [1] }))
    document.destroy()

    const output = new mupdf.PDFDocument(rasterized)
    try {
      const page = output.loadPage(0)
      try {
        const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true)
        try {
          const pixels = pixmap.getPixels()
          let red = 0
          for (let index = 0; index < pixels.length; index += 3) {
            if (pixels[index] > 150 && pixels[index + 1] < 120 && pixels[index + 2] < 120) red += 1
          }
          expect(red).toBeGreaterThan(10)
        } finally { pixmap.destroy() }
      } finally { page.destroy() }
    } finally { output.destroy() }
  })

  it('グレー出力の埋め込み画像は1成分である', async () => {
    const source = new mupdf.PDFDocument(sourceBytes)
    const rasterized = await rasterizeDocument(source, options({ color: 'gray', format: 'png', pageIndexes: [1] }))
    source.destroy()
    const output = new mupdf.PDFDocument(rasterized)
    try {
      const pageObject = output.findPage(0)
      const resources = pageObject.get('Resources')
      const xObjects = resources.get('XObject')
      const imageObject = xObjects.get('Im0')
      try {
        const image = output.loadImage(imageObject)
        try { expect(image.getNumberOfComponents()).toBe(1) } finally { image.destroy() }
      } finally {
        destroyObjects([imageObject, xObjects, resources, pageObject])
      }
    } finally { output.destroy() }
  })

  it('heavy-300p.pdfのA1ページを300 dpiで帯に分け、隙間なく配置する', async () => {
    const heavy = new mupdf.PDFDocument(await heavyOrGeneratedBytes())
    try {
      const rasterOptions = options({ dpi: 300, format: 'png', pageIndexes: [5] })
      const plans = planRasterPages(heavy, rasterOptions)
      expect(plans[0].pixelWidth * plans[0].pixelHeight).toBeGreaterThan(MAX_RASTER_BAND_PIXELS)
      expect(plans[0].bands.length).toBeGreaterThan(1)
      for (let index = 1; index < plans[0].bands.length; index += 1) {
        expect(plans[0].bands[index - 1].y + plans[0].bands[index - 1].height).toBe(plans[0].bands[index].y)
      }
      const rasterized = await rasterizeDocument(heavy, rasterOptions)
      const output = new mupdf.PDFDocument(rasterized)
      try {
        expect(output.countPages()).toBe(1)
        const pageObject = output.findPage(0)
        const resources = pageObject.get('Resources')
        const xObjects = resources.get('XObject')
        try {
          let imageCount = 0
          xObjects.forEach(() => { imageCount += 1 })
          expect(imageCount).toBe(plans[0].bands.length)
          const contents = pageObject.get('Contents')
          try {
            const buffer = contents.readStream()
            try {
              const commands = new TextDecoder().decode(buffer.asUint8Array())
              expect(commands.match(/\sDo\s/g)).toHaveLength(plans[0].bands.length)
            } finally { buffer.destroy() }
          } finally { contents.destroy() }
        } finally { destroyObjects([xObjects, resources, pageObject]) }
      } finally { output.destroy() }
    } finally { heavy.destroy() }
  }, 10 * 60_000)
})
