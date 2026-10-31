import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'

async function openPdf(page: Page) {
  const doc = new mupdf.PDFDocument()
  let bytes: number[]
  try {
    const ref = doc.addPage([0, 0, 500, 600], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(data => window.__karu!.openBytes(data, 'ウィンドウの移動試験.pdf'), bytes)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}

async function drag(page: Page, heading: Locator, dx: number, dy: number) {
  const rect = (await heading.boundingBox())!
  const x = rect.x + Math.min(rect.width / 2, 100), y = rect.y + rect.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}

test('標準マスタとCSVの見出しをドラッグし、入力と閉じる操作を保つ', async ({ page }) => {
  await openPdf(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  const quantity = page.getByTestId('fixture-panel')
  await quantity.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  const master = page.getByRole('dialog', { name: '標準マスタから追加', exact: true })
  const search = master.getByLabel('標準マスタを検索', { exact: true })
  await search.fill('分電盤')
  const before = (await master.boundingBox())!
  await drag(page, master.getByRole('heading', { name: '標準マスタから追加', exact: true }), 100, 70)
  const after = (await master.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(100, 0)
  expect(after.y - before.y).toBeCloseTo(70, 0)
  await expect(search).toHaveValue('分電盤')
  await search.fill('IV')
  await expect(search).toHaveValue('IV')
  await page.screenshot({ path: test.info().outputPath('master-dragged.png') })
  await master.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(master).toHaveCount(0)

  await quantity.getByRole('button', { name: '数量をCSVに書き出す', exact: true }).click()
  const csv = page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true })
  const csvBefore = (await csv.boundingBox())!
  await drag(page, csv.getByRole('heading'), -90, 60)
  const csvAfter = (await csv.boundingBox())!
  expect(csvAfter.x - csvBefore.x).toBeCloseTo(-90, 0)
  expect(csvAfter.y - csvBefore.y).toBeCloseTo(60, 0)
  await csv.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(csv).toHaveCount(0)
})

test('ヘルプのヘッダーは画面外へ失われず、画面縮小後も閉じられる', async ({ page }) => {
  await openPdf(page)
  await page.getByRole('button', { name: 'ヘルプ▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '使い方', exact: true }).click()
  const help = page.getByRole('dialog', { name: 'かるPDFの使い方', exact: true })
  const heading = help.getByRole('heading', { name: 'かるPDFの使い方', exact: true })
  const before = (await help.boundingBox())!
  await drag(page, heading, 80, 50)
  const after = (await help.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(80, 0)
  expect(after.y - before.y).toBeCloseTo(50, 0)
  await help.getByRole('button', { name: '使い方を閉じる', exact: true }).click()
  await expect(help).not.toBeVisible()
  await page.getByRole('button', { name: 'ヘルプ▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '使い方', exact: true }).click()
  await expect(help).toBeVisible()
  await drag(page, heading, 2000, 2000)
  const header = help.locator('header')
  const rect = (await header.boundingBox())!
  expect(rect.y).toBeGreaterThanOrEqual(0)
  expect(rect.y + rect.height).toBeLessThanOrEqual(901)
  expect(rect.x).toBeLessThanOrEqual(1360)
  await page.setViewportSize({ width: 800, height: 600 })
  await expect.poll(async () => {
    const rect = (await header.boundingBox())!
    return rect.y + rect.height
  }).toBeLessThanOrEqual(601)
  await page.keyboard.press('Escape')
  await expect(help).not.toBeVisible()
  await expect(page.locator('html')).not.toHaveAttribute('data-window-dragging')
})
