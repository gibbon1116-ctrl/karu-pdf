import { describe, expect, it } from 'vitest'
import { computeDetailRegion, computeVisibleRegion, regionCovers, visiblePartOfPage } from '../src/viewer/detailRegion'

describe('detailRegion', () => {
  it('途中から始まり横にずれたページの可視部分をページ内座標で返す', () => {
    expect(visiblePartOfPage(
      { x: 300, y: 800, width: 1000, height: 1200 },
      { x: 500, y: 600, width: 600, height: 700 },
    )).toEqual([200, 0, 800, 500])
  })

  it('可視範囲の半分の余白を加え、128px単位に丸め、ページ端で切る', () => {
    expect(computeDetailRegion([310, 270, 1110, 900], { width: 1200, height: 1000 })).toEqual([
      0, 0, 1200, 1000,
    ])
    expect(computeDetailRegion([600, 600, 800, 800], { width: 2000, height: 2000 })).toEqual([
      384, 384, 1024, 1024,
    ])
  })

  it('第1段は余白を付けず128px単位で外側へ丸め、ページ端で切る', () => {
    expect(computeVisibleRegion([310, 270, 1110, 900], { width: 1200, height: 1000 })).toEqual([
      256, 256, 1152, 1000,
    ])
    expect(computeVisibleRegion([0, 0, 200, 200], { width: 180, height: 190 })).toEqual([
      0, 0, 180, 190,
    ])
  })

  it('詳細領域を縦横4096px以内に制限しながら可視範囲を覆う', () => {
    const visible: [number, number, number, number] = [4000, 4000, 7000, 7000]
    const region = computeDetailRegion(visible, { width: 10000, height: 10000 })
    expect(region[2] - region[0]).toBeLessThanOrEqual(4096)
    expect(region[3] - region[1]).toBeLessThanOrEqual(4096)
    expect(regionCovers(region, visible)).toBe(true)
  })

  it('詳細領域が可視範囲を覆うか判定する', () => {
    expect(regionCovers([128, 128, 1024, 1024], [200, 200, 900, 900])).toBe(true)
    expect(regionCovers([256, 128, 1024, 1024], [200, 200, 900, 900])).toBe(false)
    expect(regionCovers(null, [200, 200, 900, 900])).toBe(false)
  })
})
