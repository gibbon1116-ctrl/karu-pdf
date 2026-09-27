import fs from 'node:fs/promises'
import path from 'node:path'
import { type PDFPage } from 'mupdf'
import { beforeAll, describe, expect, it } from 'vitest'
import { DisplayListCache } from '../src/core/displayListCache'
import { openDocument } from '../src/core/mupdfDoc'
import { renderRegion } from '../src/core/render'
import { ensureSamplePdf, samplePath } from './fixtures'

beforeAll(async () => {
  await ensureSamplePdf()
})

async function openSample() {
  return openDocument(new Uint8Array(await fs.readFile(samplePath)))
}

describe('MuPDF integration', () => {
  it('ページ数と回転反映済みのページサイズを返す', async () => {
    const opened = await openSample()
    try {
      expect(opened.pageCount).toBe(5)
      expect(opened.pageSizes[0].width).toBeCloseTo(595, 1)
      expect(opened.pageSizes[0].height).toBeCloseTo(842, 1)
      expect(opened.pageSizes[4].width).toBeCloseTo(842, 1)
      expect(opened.pageSizes[4].height).toBeCloseTo(595, 1)
    } finally {
      opened.document.destroy()
    }
  })

  it('ページ全体と4分割タイルを画素単位で一致させる', async () => {
    const opened = await openSample()
    const cache = new DisplayListCache(opened.document)
    try {
      const full = renderRegion(cache, 1, 1, null)
      const halfWidth = Math.floor(full.width / 2)
      const halfHeight = Math.floor(full.height / 2)
      const rects: [number, number, number, number][] = [
        [0, 0, halfWidth, halfHeight],
        [halfWidth, 0, full.width, halfHeight],
        [0, halfHeight, halfWidth, full.height],
        [halfWidth, halfHeight, full.width, full.height],
      ]
      const assembled = new Uint8ClampedArray(full.rgba.length)
      for (const rect of rects) {
        const tile = renderRegion(cache, 1, 1, rect)
        for (let y = 0; y < tile.height; y += 1) {
          const targetOffset = ((rect[1] + y) * full.width + rect[0]) * 4
          assembled.set(tile.rgba.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), targetOffset)
        }
      }
      let maximumDifference = 0
      for (let index = 0; index < full.rgba.length; index += 1) {
        maximumDifference = Math.max(maximumDifference, Math.abs(full.rgba[index] - assembled[index]))
      }
      expect(maximumDifference).toBeLessThanOrEqual(2)
    } finally {
      cache.destroy()
      opened.document.destroy()
    }
  })

  it('指定した注釈オブジェクトをDisplayListから除外する', async () => {
    const opened = await openSample()
    const page = opened.document.loadPage(0) as PDFPage
    let objectNumber = -1
    try {
      const annotation = page.getAnnotations().find((item) => item.getType() === 'Square')
      expect(annotation).toBeDefined()
      if (!annotation) return
      const object = annotation.getObject()
      try {
        objectNumber = object.asIndirect()
      } finally {
        object.destroy()
        annotation.destroy()
      }
    } finally {
      page.destroy()
    }

    const cache = new DisplayListCache(opened.document)
    try {
      const included = renderRegion(cache, 0, 1, [60, 130, 280, 240])
      const excluded = renderRegion(cache, 0, 1, [60, 130, 280, 240], new Set([objectNumber]))
      let differentPixels = 0
      for (let index = 0; index < included.rgba.length; index += 4) {
        if (included.rgba[index] !== excluded.rgba[index] || included.rgba[index + 1] !== excluded.rgba[index + 1]) {
          differentPixels += 1
        }
      }
      expect(differentPixels).toBeGreaterThan(100)
    } finally {
      cache.destroy()
      opened.document.destroy()
    }
  })
})
