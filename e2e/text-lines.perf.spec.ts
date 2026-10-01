import path from 'node:path'
import { expect, test } from '@playwright/test'

test('pageTextLines の応答を1回計測する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/real/公共建築工事標準仕様書_建築_R7.pdf'))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  const metric = await page.evaluate(async () => {
    const started = performance.now()
    const lines = await window.__karu!.pageTextLines(10)
    return { ms: performance.now() - started, lines: lines.length }
  })
  expect(metric.lines).toBeGreaterThan(0)
  console.info(`TEXT_LINES_PERF ${JSON.stringify(metric)}`)
})
