import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import mupdf, { type PDFDocument } from 'mupdf'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')
const realPdf = path.resolve('test-data/real/公共建築工事標準仕様書_建築_R7.pdf')
const outlinePdf = path.resolve('test-results/sidebar-outline.tmp.pdf')
const blankPdf = path.resolve('test-results/sidebar-blank.tmp.pdf')

function savedBytes(document: PDFDocument): Uint8Array {
  const buffer = document.saveToBuffer('compress,garbage=4')
  try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
}

async function createFixtures(): Promise<void> {
  await fs.mkdir(path.dirname(outlinePdf), { recursive: true })
  const outlined = new mupdf.PDFDocument(await fs.readFile(sample))
  const iterator = outlined.outlineIterator()
  try {
    iterator.insert({ title: '第1章', uri: '#page=2&zoom=100,72,100', open: true })
    iterator.prev()
    iterator.down()
    iterator.insert({ title: '第1節', uri: '#page=3&zoom=100,80,120', open: true })
  } finally { iterator.destroy() }
  try { await fs.writeFile(outlinePdf, savedBytes(outlined)) } finally { outlined.destroy() }

  const blank = new mupdf.PDFDocument()
  const page = blank.addPage([0, 0, 595, 842], 0, {}, '')
  try { blank.insertPage(-1, page) } finally { page.destroy() }
  try { await fs.writeFile(blankPdf, savedBytes(blank)) } finally { blank.destroy() }
}

async function waitForPage(page: Page, pageIndex = 0): Promise<void> {
  await expect(page.locator(`.page-view[data-page-index="${pageIndex}"]`)).toBeVisible()
}

test.beforeAll(createFixtures)
test.afterAll(async () => {
  await fs.rm(outlinePdf, { force: true })
  await fs.rm(blankPdf, { force: true })
})

test('Ctrl+F で検索し、結果から3ページ目へ移る', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await waitForPage(page)
  await page.keyboard.press('Control+f')
  const input = page.getByLabel('検索する文字')
  await expect(input).toBeFocused()
  await input.fill('Sample page 3')
  await input.press('Enter')
  await expect(page.getByTestId('search-results').locator('li')).toHaveCount(1)
  await page.getByTestId('search-results').locator('button').click()
  await expect(page.getByText('3 / 5 ページ')).toBeVisible()
  await expect(page.locator('.search-highlight-layer polygon.active')).toHaveCount(1)
})

test('しおりの入れ子を表示し、項目からページへ移る', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(outlinePdf)
  await waitForPage(page)
  await page.getByRole('tab', { name: 'しおり' }).click()
  await page.getByRole('button', { name: '第1章' }).click()
  await expect(page.getByText('2 / 5 ページ')).toBeVisible()
  await expect(page.getByRole('button', { name: '第1節' })).toBeVisible()
})

test('3件の書き込みを一覧・選択し、CSVに出力する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(blankPdf)
  await waitForPage(page)
  const layer = page.getByTestId('annotation-layer-0')
  await page.getByRole('button', { name: '記号', exact: true }).click()
  await layer.click({ position: { x: 120, y: 130 } })
  await layer.click({ position: { x: 220, y: 130 } })
  await layer.click({ position: { x: 320, y: 130 } })

  await page.getByRole('tab', { name: '書き込み' }).click()
  const rows = page.locator('.annotation-rows button')
  await expect(rows).toHaveCount(3)
  const selectedId = await rows.nth(1).getAttribute('data-annotation-id')
  await rows.nth(1).click()
  await expect(layer.locator(`g[data-annotation-id="${selectedId}"] .annotation-selection`)).toBeVisible()
  const csv = await page.evaluate(() => window.__karu!.exportAnnotationCsv())
  expect(csv.charCodeAt(0)).toBe(0xFEFF)
  expect(csv.trim().split('\r\n')).toHaveLength(4)
})

test('実文書の検索性能を1回だけ計測する', async ({ page }) => {
  test.skip(!existsSync(realPdf), 'test-data/real がありません。')
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(realPdf)
  await waitForPage(page)

  await page.evaluate(() => window.__karu!.resetBlankFrames())
  await page.evaluate(() => window.__karu!.scrollToPage(120))
  await expect(page.locator('.page-view[data-page-index="120"]')).toHaveAttribute('data-has-bitmap', 'true')
  const baselineBlank = await page.evaluate(() => window.__karu!.getMetrics().blankFrames.ratio)

  await page.keyboard.press('Control+f')
  const input = page.getByLabel('検索する文字')
  await input.fill('コンクリート')
  await page.evaluate(() => window.__karu!.resetBlankFrames())
  const started = await page.evaluate(() => performance.now())
  await input.press('Enter')
  await page.evaluate(() => window.__karu!.scrollToPage(240))
  await expect(page.getByTestId('search-results').locator('li').first()).toBeVisible()
  const firstResultMs = await page.evaluate((start) => performance.now() - start, started)
  await expect(page.getByTestId('search-summary')).toHaveAttribute('data-searching', 'false')
  const totalMs = await page.evaluate((start) => performance.now() - start, started)
  const searchingBlank = await page.evaluate(() => window.__karu!.getMetrics().blankFrames.ratio)
  const count = await page.getByTestId('search-results').locator('li').count()
  console.log(`SEARCH_PERF ${JSON.stringify({ firstResultMs, totalMs, count, baselineBlank, searchingBlank })}`)
  expect(firstResultMs).toBeLessThan(5_000)
  expect(totalMs).toBeLessThan(30_000)
  expect(searchingBlank).toBeLessThanOrEqual(Math.min(1, baselineBlank + 0.35))
})
