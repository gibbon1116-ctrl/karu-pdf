import path from 'node:path'
import { expect, test } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

test('ページ番号を適用し、範囲指定・元に戻す・削除ができる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()

  const openDialog = async () => {
    await page.getByRole('button', { name: 'ページ▼' }).click()
    await page.getByRole('menuitem', { name: 'ページ番号・ヘッダー・フッター…' }).click()
    await expect(page.getByRole('dialog', { name: 'ページ番号・ヘッダー・フッター' })).toBeVisible()
  }

  await openDialog()
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'ページ番号・ヘッダー・フッター' })).not.toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await window.__karu!.getPageInfo())[0].text)).toContain('- 1 -')
  // 元のページの文字は残る
  expect(await page.evaluate(async () => (await window.__karu!.getPageInfo()).map((item, index) => item.text.includes(`Sample page ${index + 1}`)))).toEqual([true, true, true, true, true])
  expect(await page.evaluate(async () => (await window.__karu!.getPageInfo())[2].text)).toContain('Sample page 3')

  await openDialog()
  await page.locator('input[name="hf-target"]').nth(1).check()
  await page.getByLabel('対象範囲').fill('5-2')
  await expect(page.getByRole('button', { name: '適用', exact: true })).toBeDisabled()
  await page.getByLabel('対象範囲').fill('2-5')
  await page.getByLabel('開始番号').fill('1')
  await page.getByRole('button', { name: '適用', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await window.__karu!.getPageInfo()).map((item) => item.text))).toEqual([
    expect.not.stringContaining('- 1 -'), expect.stringContaining('- 1 -'), expect.any(String), expect.any(String), expect.any(String),
  ])

  await page.getByRole('button', { name: 'ページ▼' }).click()
  await page.getByRole('menuitem', { name: '直前のページ操作を元に戻す' }).click()
  await expect.poll(() => page.evaluate(async () => (await window.__karu!.getPageInfo())[0].text)).toContain('- 1 -')

  await openDialog()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await window.__karu!.getPageInfo()).every((item) => !item.text.includes('- 1 -')))).toBe(true)
  expect(await page.evaluate(async () => (await window.__karu!.getPageInfo())[2].text)).toContain('Sample page 3')
})
