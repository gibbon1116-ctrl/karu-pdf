import { describe, expect, it } from 'vitest'
import {
  BANDED_RENDER_PIXEL_THRESHOLD,
  MAX_RENDER_BAND_HEIGHT,
  completedBandsCover,
  makeRenderBands,
} from '../src/viewer/bandedRender'

describe('bandedRender', () => {
  it('100万画素以下は分割しない', () => {
    expect(makeRenderBands('detail', [10, 20, 1010, 1020])).toEqual([
      { key: 'detail', rect: [10, 20, 1010, 1020] },
    ])
  })

  it('100万画素を超える領域を512px以下かつ100万画素以下の横帯に分ける', () => {
    const bands = makeRenderBands('detail', [100, 200, 4100, 1800])
    expect(bands.length).toBeGreaterThan(1)
    expect(bands[0].rect[1]).toBe(200)
    expect(bands.at(-1)?.rect[3]).toBe(1800)
    for (const band of bands) {
      const width = band.rect[2] - band.rect[0]
      const height = band.rect[3] - band.rect[1]
      expect(height).toBeLessThanOrEqual(MAX_RENDER_BAND_HEIGHT)
      expect(width * height).toBeLessThanOrEqual(BANDED_RENDER_PIXEL_THRESHOLD)
      expect(band.key).toContain(`band=${band.rect.join(',')}`)
    }
  })

  it('見えている範囲に重なる帯がすべて描かれたときだけ鮮明と判定する', () => {
    const region: [number, number, number, number] = [0, 0, 2000, 1600]
    const bands = makeRenderBands('detail', region)
    const visible: [number, number, number, number] = [200, 450, 1200, 900]
    const completed = bands.map((band) => band.rect[1] < visible[3] && band.rect[3] > visible[1])
    expect(completedBandsCover(region, bands, completed, visible)).toBe(true)
    const firstVisible = bands.findIndex((band) => band.rect[1] < visible[3] && band.rect[3] > visible[1])
    completed[firstVisible] = false
    expect(completedBandsCover(region, bands, completed, visible)).toBe(false)
    expect(completedBandsCover(region, bands, bands.map(() => true), [-1, 0, 100, 100])).toBe(false)
  })
})
