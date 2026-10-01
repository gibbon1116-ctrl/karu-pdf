import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')
const sixtyPagePdf = path.resolve('test-results/e2e-60-page.pdf')

async function waitForPage(page: Page, pageIndex = 0): Promise<void> {
  await expect(page.locator(`.page-view[data-page-index="${pageIndex}"]`)).toBeVisible()
  await expect.poll(() => page.evaluate((index) => window.__karu?.getEditableAnnotations(index).length ?? -1, pageIndex)).toBeGreaterThanOrEqual(0)
}

async function saveAndReopen(page: Page): Promise<void> {
  const bytes = await page.evaluate(async () => {
    const saved = await window.__karu!.saveToBytes()
    if (!saved) throw new Error('保存結果がありません。')
    return Array.from(saved)
  })
  await page.evaluate(async (value) => window.__karu!.openBytes(value, 'symbol-roundtrip.pdf'), bytes)
  await waitForPage(page)
}

test.beforeAll(async () => {
  await fs.mkdir(path.dirname(sixtyPagePdf), { recursive: true })
  const document = new mupdf.PDFDocument()
  try {
    for (let index = 0; index < 60; index += 1) {
      const page = document.addPage([0, 0, 300, 400], 0, {}, '')
      try { document.insertPage(-1, page) } finally { page.destroy() }
    }
    const buffer = document.saveToBuffer('compress,garbage=4')
    try { await fs.writeFile(sixtyPagePdf, new Uint8Array(buffer.asUint8Array())) } finally { buffer.destroy() }
  } finally {
    document.destroy()
  }
})

test.afterAll(async () => {
  await fs.rm(sixtyPagePdf, { force: true })
})

test('記号の道具でチェックを置き、保存して開き直せる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')

  await page.getByRole('button', { name: '記号', exact: true }).click()
  await layer.click({ position: { x: 180, y: 180 } })
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'symbol' && item.symbol === 'check').length)).toBe(1)
  await saveAndReopen(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'symbol' && item.symbol === 'check').length)).toBe(1)
})

test('記号を3つ続けて置き、Escで選択へ戻れる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')

  await page.getByRole('button', { name: '記号', exact: true }).click()
  await layer.click({ position: { x: 160, y: 190 } })
  await layer.click({ position: { x: 230, y: 190 } })
  await layer.click({ position: { x: 300, y: 190 }, modifiers: ['Shift'] })
  await expect(page.getByRole('button', { name: '記号', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'symbol').length)).toBe(3)
  await expect(layer.locator('.annotation-selection')).toHaveCount(1)
  await expect(layer.locator('.annotation-resize-handle')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('文字の入力中に太いチェックをカーソル位置へ挿入できる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')

  await page.getByRole('button', { name: '文字', exact: true }).click()
  await layer.click({ position: { x: 180, y: 180 } })
  const editor = page.getByTestId('text-editor')
  await editor.fill('確認済み')
  await editor.press('Home')
  await editor.press('ArrowRight')
  await editor.press('ArrowRight')
  await page.getByRole('button', { name: '記号を挿入 ✔', exact: true }).click()
  await expect(editor).toHaveValue('確認✔済み')
})

test('60ページのページ整理を最後までスクロールしてもツールバーが残る', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sixtyPagePdf)
  await waitForPage(page)
  await page.getByRole('button', { name: 'ページ▼' }).click()
  await page.getByRole('menuitem', { name: 'ページ整理', exact: true }).click()
  const scroller = page.locator('.organize-grid-scroller')
  await expect(scroller).toBeVisible()
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(page.locator('.tool-row')).toBeVisible()
  await expect(page.locator('.organize-toolbar')).toBeVisible()
  await expect(page.getByTestId('organize-card-59')).toBeVisible()
})

test('作業領域の例外後もタブとツールバー、書き込みが残る', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')
  await page.getByRole('button', { name: '記号', exact: true }).click()
  await layer.click({ position: { x: 180, y: 180 } })
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'symbol').length)

  await page.getByTestId('throw-workspace-error').click()
  await expect(page.getByText('表示中に問題が起きました。書き込みは消えていません。')).toBeVisible()
  await expect(page.locator('.top-controls')).toBeVisible()
  await expect(page.locator('.document-tabs')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存する', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '表示し直す', exact: true }).click()
  await waitForPage(page)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'symbol').length)).toBe(before)
})
