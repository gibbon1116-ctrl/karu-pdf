import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resizeSymbolRect, symbolBounds, symbolRectFromDrag } from '../src/core/annotations'
import { characterFont, createDingbatsFontResource, createFontResource } from '../src/core/fontMetrics'

describe('記号の幾何と代替フォント', () => {
  it('長方形の中央に正方形の外接枠を作り、クリックは16pt四方にする', () => {
    expect(symbolBounds([10, 20, 50, 40])).toEqual([20, 20, 40, 40])
    expect(symbolRectFromDrag([100, 100], [100, 100], false)).toEqual([92, 92, 108, 108])
    expect(symbolRectFromDrag([10, 20], [50, 40], true)).toEqual([20, 20, 40, 40])
  })

  it('四隅の取っ手で縦横比を保って大きさを変える', () => {
    const resized = resizeSymbolRect([20, 20, 40, 40], 'se', [57, 50])
    expect(resized).toEqual([20, 20, 57, 57])
    expect(resized[2] - resized[0]).toBe(resized[3] - resized[1])
  })

  it('BIZ UDにない記号だけZapfDingbatsを選ぶ', async () => {
    const primary = createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf'))))
    const fallback = createDingbatsFontResource()
    try {
      expect(characterFont(primary.font, '○', fallback.font)).toBe('primary')
      expect(characterFont(primary.font, '✔', fallback.font)).toBe('fallback')
      expect(characterFont(primary.font, '✗', fallback.font)).toBe('fallback')
      expect(characterFont(primary.font, '🦄', fallback.font)).toBe('missing')
    } finally {
      primary.font.destroy()
      fallback.font.destroy()
    }
  })
})
