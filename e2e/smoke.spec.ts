import path from 'node:path'
import { expect, test } from '@playwright/test'

test('sample-small.pdfを開いて1ページ目を描画できる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu?.isIdle() ?? false), { timeout: 60_000 }).toBe(true)
  const isNonUniform = await page.locator('.page-view[data-page-index="0"] .preview-canvas').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement
    const context = element.getContext('2d')
    if (!context || element.width < 2 || element.height < 2) return false
    const pixels = context.getImageData(0, 0, element.width, element.height).data
    const first = [pixels[0], pixels[1], pixels[2], pixels[3]]
    for (let index = 4; index < pixels.length; index += 64) {
      if (pixels[index] !== first[0] || pixels[index + 1] !== first[1] || pixels[index + 2] !== first[2] || pixels[index + 3] !== first[3]) return true
    }
    return false
  })
  expect(isNonUniform).toBe(true)
})
