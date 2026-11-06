import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'
import { ensureSamplePdf } from '../tests/fixtures'

async function openSample(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(await ensureSamplePdf())
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: '墨消しを適用して別名で保存…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '墨消しを適用して別名で保存', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function drawArea(page: Page): Promise<void> {
  // Locate sample text through the same search UI used by text-mark.annotate.spec.ts.
  await page.keyboard.press('Control+f')
  const search = page.getByLabel('検索する文字')
  await search.fill('Sample page 1')
  await search.press('Enter')
  const polygon = page.locator('.search-highlight-layer polygon.active')
  await expect(polygon).toBeVisible()
  const text = await polygon.boundingBox(), before = await page.getByTestId('annotation-layer-0').boundingBox()
  if (!text || !before) throw new Error('墨消しする文字が見つかりません。')
  await page.getByRole('button', { name: '図形▼', exact: true }).click()
  await page.getByRole('menu').getByText('墨消し（範囲）', { exact: true }).click()
  const after = await page.getByTestId('annotation-layer-0').boundingBox()
  if (!after) throw new Error('注釈レイヤーがありません。')
  const x = after.x + (text.x - before.x) * after.width / before.width
  const y = after.y + (text.y - before.y) * after.height / before.height
  await page.mouse.move(x - 4, y - 4)
  // Redaction area deliberately ignores Shift's square constraint.
  await page.keyboard.down('Shift')
  try {
    await page.mouse.down()
    await page.mouse.move(x + text.width * after.width / before.width + 4, y + text.height * after.height / before.height + 4, { steps: 6 })
    await page.mouse.up()
  } finally { await page.keyboard.up('Shift') }
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.kind === 'redact').length)).toBe(1)
  const rect = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'redact')!.rect)
  expect(rect[2] - rect[0]).not.toBeCloseTo(rect[3] - rect[1], 2)
}

test('range tool creates a 墨消し list entry and supports undo', async ({ page }) => {
  await openSample(page)
  await drawArea(page)
  await page.getByRole('tab', { name: '書き込み', exact: true }).click()
  await expect(page.locator('.annotation-kind').filter({ hasText: /^墨消し$/ })).toHaveCount(1)
  await expect(page.getByTestId('format-panel')).toContainText('保存しただけでは消えません。')
  await expect(page.getByTestId('format-panel').getByLabel('透明度', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.kind === 'redact').length)).toBe(0)
  await expect(page.locator('.annotation-kind').filter({ hasText: /^墨消し$/ })).toHaveCount(0)
})

test('applies to a downloaded copy and keeps the current tab dirty with its range mark', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined })
  await openSample(page)
  await drawArea(page)
  const before = await page.evaluate(() => ({
    tabs: window.__karu!.listTabs(), annotations: window.__karu!.getEditableAnnotations(0),
  }))
  expect(before.tabs.some(tab => tab.dirty)).toBe(true)
  const dialog = await openDialog(page)
  await expect(dialog).toContainText('墨消しの範囲: 1 か所（1 ページ）')
  await expect(dialog.getByRole('checkbox', { name: '文書のプロパティ（タイトル・作成者など）を消す' })).toBeChecked()
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toMatch(/_墨消し\.pdf$/)
  const output = new mupdf.PDFDocument(new Uint8Array(await fs.readFile((await download.path())!)))
  try {
    expect(output.countPages()).toBe(5)
    for (const [index, removed] of [[0, true], [1, false]] as const) {
      const pdfPage = output.loadPage(index), structured = pdfPage.toStructuredText({})
      try {
        if (removed) expect(structured.asText()).not.toContain('Sample page 1')
        else expect(structured.asText()).toContain('Sample page 2')
      } finally { structured.destroy(); pdfPage.destroy() }
    }
  } finally { output.destroy() }
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => ({
    tabs: window.__karu!.listTabs(), annotations: window.__karu!.getEditableAnnotations(0),
  }))).toEqual(before)
  await expect(page.locator('.annotation-redact')).toHaveCount(1)
})

test('zero ranges disables save and explains both ways to mark a range', async ({ page }) => {
  await openSample(page)
  const dialog = await openDialog(page)
  await expect(dialog).toContainText('墨消しの範囲: 0 か所（0 ページ）')
  await expect(dialog).toContainText('墨消しの範囲がありません。')
  await expect(dialog).toContainText('文字を墨消し')
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(dialog).toBeHidden()
})
