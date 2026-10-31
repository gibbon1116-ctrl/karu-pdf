import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_PDF_SETTINGS as defaults, layoutImages, MM } from '../src/core/imagePdfLayout'
import { sortImageEntries, estimateImagePdf, type ImageEntry } from '../src/app/imageFiles'

describe('画像の配置', () => {
  it('A4縦・余白10mmで横長画像の幅・比・中央位置', () => {
    const p = layoutImages([{ width: 400, height: 200 }], { ...defaults, orientation: 'portrait' })[0], image = p.placements[0]
    expect(p.width).toBeCloseTo(210 * MM); expect(p.height).toBeCloseTo(297 * MM)
    expect(image.x).toBeCloseTo(10 * MM); expect(image.width).toBeCloseTo(190 * MM)
    expect(image.width / image.height).toBe(2); expect(image.y + image.height / 2).toBeCloseTo(p.height / 2)
  })
  it('自動の縦・横、EXIF6と8の交換後の縦横', () => {
    for (const orientation of [1, 6, 8] as const) {
      const p = layoutImages([{ width: 400, height: 200, orientation }], defaults)[0]
      expect(p.width > p.height).toBe(orientation === 1)
      expect(p.placements[0].width / p.placements[0].height).toBeCloseTo(orientation === 1 ? 2 : .5)
    }
  })
  for (const perPage of [2, 4] as const) it(`${perPage}枚の区画・5mmの間隔・重ならない`, () => {
    const p = layoutImages(Array.from({ length: perPage }, () => ({ width: 100, height: 100 })), { ...defaults, perPage })[0]
    expect(p.width).toBeLessThan(p.height)
    for (let i = 0; i < perPage; i++) for (let j = i + 1; j < perPage; j++) {
      const a = p.placements[i], b = p.placements[j]
      expect(a.x + a.width + 5 * MM <= b.x + .001 || a.y + a.height + 5 * MM <= b.y + .001).toBe(true)
    }
    expect(p.placements[0].width / p.placements[0].height).toBe(1)
  })
  it('画像の大きさ150dpi・余白なし・EXIF適用後', () => {
    const p = layoutImages([{ width: 3000, height: 1500, orientation: 6 }], { ...defaults, paper: 'image' })[0]
    expect([p.width, p.height]).toEqual([720, 1440])
    expect(p.placements[0]).toEqual({ index: 0, x: 0, y: 0, width: 720, height: 1440 })
    expect(() => layoutImages([{ width: 1, height: 1 }], { ...defaults, paper: 'image', perPage: 2 })).toThrow()
  })
  it('端数ページと明示的な横向き', () => {
    const pages = layoutImages(Array.from({ length: 5 }, () => ({ width: 100, height: 200 })), { ...defaults, perPage: 4, orientation: 'landscape' })
    expect(pages.map(p => p.placements.length)).toEqual([4, 1]); expect(pages[0].width).toBeGreaterThan(pages[0].height)
  })
})

describe('並びと見込み', () => {
  const entry = (id: number, name: string, modified: number, dateTime?: string): ImageEntry => ({ id, order: id, file: { name, lastModified: modified, size: 100 } as File, info: { width: 4000, height: 3000, orientation: 1, dateTime } })
  it('名前順は数として比較し、同名は選択順', () => {
    expect(sortImageEntries([entry(1, 'IMG_10.jpg', 1), entry(2, 'IMG_2.jpg', 1), entry(3, 'IMG_2.jpg', 1)], 'name').map(e => e.id)).toEqual([2, 3, 1])
  })
  it('撮影日時がない画像は更新日時、選んだ順へ戻せる', () => {
    const entries = [entry(1, 'a', 0, '2026:10:02 10:00:00'), entry(2, 'b', new Date(2026, 9, 1).getTime()), entry(3, 'c', 0, '2026:10:03 10:00:00')]
    expect(sortImageEntries(entries, 'date').map(e => e.id)).toEqual([2, 1, 3])
    expect(sortImageEntries([...entries].reverse(), 'selected').map(e => e.id)).toEqual([1, 2, 3])
  })
  it('元のままは合計サイズ・エラー除外、縮小は画素数の概算', () => {
    const entries = [entry(1, 'a', 0), { ...entry(2, 'b', 0), error: 'bad' }]
    expect(estimateImagePdf(entries, 'original')).toBe(100)
    expect(estimateImagePdf(entries, 'standard')).toBeCloseTo(2400 * 1800 * .35)
  })
})
