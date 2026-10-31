import path from 'node:path'
import { expect, test } from '@playwright/test'

test('A1の現在の組の重ね画像と違い検出を1回計測する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=4&warm=0')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.locator('.status-bar')).toContainText('1 / 300')
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  await page.evaluate(() => window.__karu!.scrollToPage(5))
  await expect(page.locator('.status-bar')).toContainText('6 / 300')
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '2つの PDF を比較…', exact: true }).click()
  await page.getByRole('button', { name: '比較', exact: true }).click()
  await expect(page.getByLabel('比較の旧ページ番号')).toHaveValue('6')
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-image-ms', /\d/)
  await expect(page.getByTestId('compare-view')).toHaveAttribute('data-detection-ms', /\d/)
  const result = await page.getByTestId('compare-view').evaluate(el => ({ imageMs: Number(el.getAttribute('data-image-ms')), detectionMs: Number(el.getAttribute('data-detection-ms')) }))
  console.log('[compare-A1]', JSON.stringify(result))
  await expect(page.getByTestId('compare-difference')).toHaveCount(0)
  expect(result.imageMs).toBeLessThanOrEqual(1000)
  expect(result.detectionMs).toBeLessThanOrEqual(2000)
})
