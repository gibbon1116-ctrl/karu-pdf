import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { DEFAULT_HEADER_FOOTER_SETTINGS } from '../src/app/headerFooterText'

test('330ページと300ページへの適用を各1回計測する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  for (const [index, relative] of ['test-data/real/公共建築工事標準仕様書_建築_R7.pdf', 'test-data/heavy-300p.pdf'].entries()) {
    const file = path.resolve(relative)
    const sourceSize = (await fs.stat(file)).size
    await page.getByTestId('file-input').setInputFiles(file)
    await expect.poll(() => page.evaluate(() => window.__karu?.listTabs().length ?? 0), { timeout: 120_000 }).toBe(index + 1)
    await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__karu?.isIdle() ?? false), { timeout: 120_000 }).toBe(true)
    const started = Date.now()
    const timings = await page.evaluate(async (settings) => window.__karu!.applyHeaderFooter(settings, '2026年10月1日'), DEFAULT_HEADER_FOOTER_SETTINGS)
    await expect.poll(() => page.evaluate(() => window.__karu?.isIdle() ?? false), { timeout: 120_000 }).toBe(true)
    const elapsedMs = Date.now() - started
    const outputSize = await page.evaluate(async () => (await window.__karu!.exportDocumentBytes()).byteLength)
    const metric = { file: path.basename(file), elapsedMs, increaseBytes: outputSize - sourceSize, timings }
    console.info(`HEADER_FOOTER_PERF ${JSON.stringify(metric)}`)
    expect(timings).not.toBeNull()
    expect(outputSize).toBeGreaterThan(sourceSize)
    expect(elapsedMs).toBeLessThan(5_000)
  }
})
