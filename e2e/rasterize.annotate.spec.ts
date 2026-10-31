import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

async function openRasterizeDialog(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '画像として保存…' }).click()
}

test('画像として保存ダイアログで見込みを表示し、テスト窓口から正しいページ数を返す', async ({ page }) => {
  await openRasterizeDialog(page)
  const dialog = page.getByRole('dialog', { name: '画像として保存' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('今開いているファイルは変わりません。')
  const estimate = dialog.locator('.rasterize-estimate')
  await expect(estimate).not.toContainText('計算中…', { timeout: 120_000 })
  await expect(estimate).toContainText('約')

  const before = await page.evaluate(() => ({
    tabs: window.__karu!.listTabs(),
    annotations: window.__karu!.getEditableAnnotations(0).map((item) => item.id),
  }))
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.rasterizeToBytes({
    dpi: 150, color: 'color', format: 'jpeg', pageIndexes: [0, 1, 2, 3, 4],
  }))!))
  const output = new mupdf.PDFDocument(Uint8Array.from(bytes))
  try { expect(output.countPages()).toBe(5) } finally { output.destroy() }
  expect(await page.evaluate(() => ({
    tabs: window.__karu!.listTabs(),
    annotations: window.__karu!.getEditableAnnotations(0).map((item) => item.id),
  }))).toEqual(before)
  expect(await page.evaluate(() => window.__karu!.getPageInfo().then((pages) => pages.length))).toBe(5)
})

test('画像として保存を中止するとファイルへ書かない', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __rasterWritten: false,
      __rasterAborted: false,
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => { ;(window as unknown as { __rasterWritten: boolean }).__rasterWritten = true },
          abort: async () => { ;(window as unknown as { __rasterAborted: boolean }).__rasterAborted = true },
        }),
      }),
    })
  })
  await openRasterizeDialog(page)
  const dialog = page.getByRole('dialog', { name: '画像として保存' })
  await expect(dialog.locator('.rasterize-estimate')).not.toContainText('計算中…', { timeout: 120_000 })
  await dialog.getByRole('button', { name: '保存' }).click()
  await dialog.getByRole('button', { name: '中止', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('中止しました', { timeout: 120_000 })
  expect(await page.evaluate(() => (window as unknown as { __rasterWritten: boolean }).__rasterWritten)).toBe(false)
  expect(await page.evaluate(() => (window as unknown as { __rasterAborted: boolean }).__rasterAborted)).toBe(true)
})
