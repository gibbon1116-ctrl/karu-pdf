import mupdf from 'mupdf'
import { describe, expect, it } from 'vitest'
import {
  MemoryPdfWriteTarget,
  PdfStreamWriter,
  type PdfImageBand,
  type PdfWriteTarget,
} from '../src/core/pdfStreamWriter'
import type { RasterPagePlan } from '../src/core/rasterize'

function image(format: 'jpeg' | 'png', components: 1 | 3, width: number, height: number, seed: number): PdfImageBand {
  const colorspace = components === 1 ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB
  const pixmap = new mupdf.Pixmap(colorspace, [0, 0, width, height], false)
  try {
    const pixels = pixmap.getPixels()
    for (let index = 0; index < pixels.length; index += components) {
      pixels[index] = (seed * 37 + index) % 256
      if (components === 3) {
        pixels[index + 1] = (seed * 73 + index) % 256
        pixels[index + 2] = (seed * 109 + index) % 256
      }
    }
    return {
      bytes: new Uint8Array(format === 'jpeg' ? pixmap.asJPEG(85) : pixmap.asPNG()),
      width,
      height,
      components,
      format,
    }
  } finally { pixmap.destroy() }
}

function plan(outputPageIndex: number, bandHeights: number[]): RasterPagePlan {
  const pixelWidth = 12
  const pixelHeight = bandHeights.reduce((sum, height) => sum + height, 0)
  let y = 0
  return {
    sourcePageIndex: outputPageIndex,
    outputPageIndex,
    width: 120 + outputPageIndex,
    height: 80 + outputPageIndex,
    pixelWidth,
    pixelHeight,
    scale: 1,
    bands: bandHeights.map((height, index) => {
      const band = { index, y, height, deviceRect: [0, y, pixelWidth, y + height] as [number, number, number, number] }
      y += height
      return band
    }),
  }
}

describe('PdfStreamWriter', () => {
  it('JPEG・PNGのGray・RGBと帯ページを、ページごとに書いてMuPDFで開ける', async () => {
    const plans = [plan(0, [8]), plan(1, [8]), plan(2, [8]), plan(3, [8]), plan(4, [4, 4])]
    const pages: PdfImageBand[][] = [
      [image('jpeg', 1, 12, 8, 1)],
      [image('jpeg', 3, 12, 8, 2)],
      [image('png', 1, 12, 8, 3)],
      [image('png', 3, 12, 8, 4)],
      [image('png', 3, 12, 4, 5), image('png', 3, 12, 4, 6)],
    ]
    const target = new MemoryPdfWriteTarget()
    const writer = new PdfStreamWriter(target)
    await writer.start()
    for (let index = 0; index < plans.length; index += 1) await writer.writePage(plans[index], pages[index])
    await writer.close()

    const document = new mupdf.PDFDocument(target.toBytes())
    try {
      expect(document.countPages()).toBe(5)
      for (let index = 0; index < plans.length; index += 1) {
        const page = document.loadPage(index)
        try {
          const bounds = page.getBounds()
          expect(bounds[2] - bounds[0]).toBeCloseTo(plans[index].width, 4)
          expect(bounds[3] - bounds[1]).toBeCloseTo(plans[index].height, 4)
        } finally { page.destroy() }

        const pageObject = document.findPage(index)
        const resources = pageObject.get('Resources')
        const xObjects = resources.get('XObject')
        const components: number[] = []
        try {
          xObjects.forEach((object) => {
            const loaded = document.loadImage(object)
            try { components.push(loaded.getNumberOfComponents()) } finally { loaded.destroy(); object.destroy() }
          })
          expect(components).toEqual(pages[index].map((item) => item.components))
        } finally { xObjects.destroy(); resources.destroy(); pageObject.destroy() }
      }
    } finally { document.destroy() }
  })

  it('中止では書き出し先をabortし、closeしない', async () => {
    const calls = { writes: 0, closed: false, aborted: false }
    const target: PdfWriteTarget = {
      write: async () => { calls.writes += 1 },
      close: async () => { calls.closed = true },
      abort: async () => { calls.aborted = true },
    }
    const writer = new PdfStreamWriter(target)
    await writer.start()
    await writer.abort(new DOMException('中止', 'AbortError'))
    expect(calls.writes).toBeGreaterThan(0)
    expect(calls.aborted).toBe(true)
    expect(calls.closed).toBe(false)
  })
})
