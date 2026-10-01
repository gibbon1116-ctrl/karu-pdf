import { describe, expect, it } from 'vitest'
import {
  cappedFullRenderScale,
  MAX_PREVIEW_FULL_PIXELS,
  nextPreviewZoom,
  zoomedScrollPosition,
} from '../src/organize/OrganizePreview'

describe('ページ整理プレビューの倍率計算', () => {
  it('倍率の段階を上げ下げし、両端で止まる', () => {
    expect(nextPreviewZoom(1, -1)).toBe(1)
    expect(nextPreviewZoom(1, 1)).toBe(1.5)
    expect(nextPreviewZoom(1.5, 1)).toBe(2)
    expect(nextPreviewZoom(8, 1)).toBe(8)
    expect(nextPreviewZoom(8, -1)).toBe(6)
  })

  it('カーソル位置の内容が動かない拡大後のスクロール位置を求める', () => {
    expect(zoomedScrollPosition(100, 50, 1, 2)).toBe(250)
    expect(zoomedScrollPosition(500, 200, 4, 2)).toBe(150)
    expect(zoomedScrollPosition(0, 0, 1, 8)).toBe(0)
  })

  it('A1ページの全体描画を800万画素以下の倍率に抑える', () => {
    const page = { width: 2384, height: 1684 }
    const scale = cappedFullRenderScale(page, 8)
    const pixels = Math.ceil(page.width * scale) * Math.ceil(page.height * scale)
    expect(scale).toBeLessThan(8)
    expect(pixels).toBeLessThanOrEqual(MAX_PREVIEW_FULL_PIXELS)
  })
})
