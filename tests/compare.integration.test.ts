import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { describe, expect, it, vi } from 'vitest'
import { ComparePageCache, renderComparePixels } from '../src/worker/compareRender'
import type { CompareOptions } from '../src/worker/protocol'
import { makeComparePdf } from './compareFixtures'

const options: CompareOptions = { docId: 'old', newDocId: 'new', pageIndex: 0, newPageIndex: 0, renderScale: 2, deviceRect: null, offset: [0, 0], includeAnnotations: false }
async function compare(a: Uint8Array, b: Uint8Array, overrides: Partial<CompareOptions> = {}) {
  const old = new mupdf.PDFDocument(a), next = new mupdf.PDFDocument(b)
  const ac = new ComparePageCache(old), bc = new ComparePageCache(next)
  try { return await renderComparePixels(ac, bc, { ...options, ...overrides }) }
  finally { ac.destroy(); bc.destroy(); old.destroy(); next.destroy() }
}
function rgb(image: { width: number; rgba: Uint8ClampedArray }, x: number, y: number, scale = 2) {
  const i = (Math.floor(y * scale) * image.width + Math.floor(x * scale)) * 4
  return [...image.rgba.slice(i, i + 3)]
}
describe('実際のMuPDF描画による比較', () => {
  it('同じ文書・ページの再描画と検出は同じDisplayListを再利用し、画素は灰で差分ゼロになる', async () => {
    const document = new mupdf.PDFDocument(makeComparePdf()), cache = new ComparePageCache(document)
    try {
      const list = cache.get(0, false), run = vi.spyOn(list, 'run')
      const image = await renderComparePixels(cache, cache, options)
      expect(rgb(image, 60, 40)).toEqual([128, 128, 128])
      expect(rgb(image, 201, 90)).toEqual([128, 128, 128])
      expect(run).toHaveBeenCalledOnce()
      run.mockClear()
      const detected = await renderComparePixels(cache, cache, { ...options, detect: true })
      expect(detected.differences).toEqual([])
      expect(run).toHaveBeenCalledOnce()
      expect(cache.get(0, false)).toBe(list)
    } finally { cache.destroy(); document.destroy() }
  })
  it('共通の四角と移動した線と追加した丸の色、検出位置、PNG再読込の画素を確かめる', async () => {
    const image = await compare(makeComparePdf(), makeComparePdf({ revised: true }))
    expect(rgb(image, 60, 40)).toEqual([128, 128, 128])
    expect(rgb(image, 201, 90)).toEqual([255, 0, 0])
    expect(rgb(image, 211, 90)).toEqual([0, 0, 255])
    expect(rgb(image, 300, 185)).toEqual([0, 0, 255])
    expect(rgb(image, 20, 20)).toEqual([255, 255, 255])
    const detected = await compare(makeComparePdf(), makeComparePdf({ revised: true }), { detect: true })
    expect(detected.differences).toHaveLength(3)
    expect(detected.differences![0]).toEqual([200, 70, 203, 130])
    expect(detected.differences![1]).toEqual([210, 70, 213, 130])
    const c = detected.differences![2]
    expect(c[0]).toBeGreaterThanOrEqual(282); expect(c[0]).toBeLessThan(286)
    expect(c[1]).toBeGreaterThanOrEqual(182); expect(c[1]).toBeLessThan(186)
    expect(c[2]).toBeGreaterThan(314); expect(c[3]).toBeGreaterThan(214)
    expect(detected.differences!.some(r => r[0] < 125 && r[1] < 105)).toBe(false)
    const directory = await fs.mkdtemp(path.resolve('tests/.compare-image-'))
    const filename = path.join(directory, 'overlay.png')
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, image.width, image.height], true)
    try {
      pixmap.getPixels().set(image.rgba)
      await fs.writeFile(filename, pixmap.asPNG())
      const png = new mupdf.Image(new Uint8Array(await fs.readFile(filename)))
      const reopened = png.toPixmap()
      try { expect(rgb({ width: reopened.getWidth(), rgba: new Uint8ClampedArray(reopened.getPixels()) }, 201, 90)).toEqual([255, 0, 0]) }
      finally { reopened.destroy(); png.destroy() }
      // Opt-in export for the implementation's visual review, removed after review.
      if (process.env.KARU_COMPARE_EXPORT === '1') await fs.copyFile(filename, path.resolve('tests/.compare-review.png'))
    } finally { pixmap.destroy(); await fs.unlink(filename); await fs.rmdir(directory) }
  })
  it('2ptの全体ずれを−2ptに合わせると四角が灰に戻り、その領域の違いが消える', async () => {
    const old = makeComparePdf(), next = makeComparePdf({ revised: true, shift: 2 })
    const shifted = await compare(old, next)
    expect(rgb(shifted, 39, 60)).toEqual([255, 0, 0])
    expect(rgb(shifted, 43, 60)).toEqual([0, 0, 255])
    const aligned = await compare(old, next, { offset: [-2, 0] })
    expect(rgb(aligned, 39, 60)).toEqual([128, 128, 128])
    expect(rgb(aligned, 43, 60)).toEqual([255, 255, 255])
    const detected = await compare(old, next, { offset: [-2, 0], detect: true })
    expect(detected.differences).toHaveLength(3)
    expect(detected.differences!.some(r => r[0] < 125)).toBe(false)
  })
  it('A1とA3を旧版の幅に合わせると共通線が灰になり、違いが消える', async () => {
    const old = makeComparePdf({ width: 1684, height: 2384 }), next = makeComparePdf({ width: 842, height: 1192 })
    const image = await compare(old, next, { renderScale: .5 })
    expect(rgb(image, 60 * 1684 / 400, 40 * 1684 / 400, .5)).toEqual([128, 128, 128])
    const detected = await compare(old, next, { detect: true })
    expect(detected.width).toBeLessThanOrEqual(2000); expect(detected.height).toBeLessThanOrEqual(2000)
    expect(detected.differences).toEqual([])
  })
  it('新版だけの保存済み書き込みを既定では除き、オンのときだけ青で検出する', async () => {
    const old = makeComparePdf(), next = makeComparePdf({ annotation: true })
    const without = await compare(old, next, { detect: true })
    expect(rgb(without, 160, 260, 1)).toEqual([255, 255, 255]); expect(without.differences).toEqual([])
    const withAnnotations = await compare(old, next, { includeAnnotations: true, detect: true })
    expect(rgb(withAnnotations, 160, 260, 1)).toEqual([0, 0, 255]); expect(withAnnotations.differences).toHaveLength(1)
    // The annotation's border extends one raster pixel beyond its nominal Rect.
    expect(withAnnotations.differences![0]).toEqual([149, 249, 181, 281])
  })
  it('画面の範囲と分割した帯を、全体の実画素と一致させる', async () => {
    const old = makeComparePdf(), next = makeComparePdf({ revised: true })
    const full = await compare(old, next, { renderScale: 4 })
    const tile = await compare(old, next, { renderScale: 4, deviceRect: [760, 260, 880, 560] })
    for (let y = 0; y < tile.height; y++) {
      const start = ((y + 260) * full.width + 760) * 4
      expect(tile.rgba.slice(y * tile.width * 4, (y + 1) * tile.width * 4)).toEqual(full.rgba.slice(start, start + tile.width * 4))
    }
  })
  it('分割描画の途中の取り消しで、後続の帯を描かない', async () => {
    const old = new mupdf.PDFDocument(makeComparePdf()), next = new mupdf.PDFDocument(makeComparePdf({ revised: true }))
    const ac = new ComparePageCache(old), bc = new ComparePageCache(next)
    let checkpoints = 0
    try {
      await expect(renderComparePixels(ac, bc, { ...options, renderScale: 4 }, async () => { if (++checkpoints === 3) throw new Error('cancelled') })).rejects.toThrow('cancelled')
      expect(checkpoints).toBe(3)
    } finally { ac.destroy(); bc.destroy(); old.destroy(); next.destroy() }
  })
})
