import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

async function drawingPdf(scrollable = false) {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    { id: 'led', code: 'LED', name: '照明器具', category: '電気', order: scrollable ? 50 : 0, style: nextCountStyle([]) },
    { id: 'cv', code: 'CV', name: 'ケーブル', category: '電気', kind: 'length', order: 200, style: nextCountStyle([]) },
    ...(scrollable ? Array.from({ length: 120 }, (_, i) => ({ id: `unused${i}`, code: `U${i}`, name: `未使用${i}`,
      category: '電気', order: i < 50 ? i : i + 1, style: nextCountStyle([]) })) : []),
  ]
  try {
    const page = doc.addPage([0, 0, 500, 600], 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    // Reverse insertion order makes the expected review order independent of storage order.
    for (const i of [4, 3, 2, 1, 0]) store.create({ kind: 'symbol', symbol: 'circle', pageIndex: 0,
      rect: [80, 80 + i * 50, 90, 90 + i * 50], count: { version: 2, id: `led${i}`, fixtureId: 'led', floor: '1階', room: '事務室' } })
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { font.font.destroy(); doc.destroy() }
}

async function open(page: Page, scrollable = false) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '確認位置試験.pdf'), await drawingPdf(scrollable))
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.__karu!.getDrawingScanMetrics().scanning)).toBe(false)
}
const table = (page: Page) => page.getByRole('region', { name: '数量の集計表', exact: true })
const row = (page: Page) => table(page).locator('tr[data-fixture-id="led"]')
const cell = (page: Page) => row(page).locator('button[data-column-key="0"]')
const breakdown = (page: Page) => page.getByTestId('quantity-breakdown')
const selected = (page: Page) => page.evaluate(() => window.__karu!.getSelectedAnnotationIds())
async function orderedIds(page: Page) {
  return page.evaluate(() => window.__karu!.getEditableAnnotations(0)
    .filter(a => a.count?.version === 2 && a.count.fixtureId === 'led')
    .sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0] || a.id.localeCompare(b.id)).map(a => a.id))
}

for (const view of ['table', 'breakdown'] as const) {
  test(`${view}: reviewed deletion, counters, Undo/Redo and deletion of the last pickup`, async ({ page }) => {
    await open(page)
    if (view === 'table') await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
    else {
      await page.getByRole('button', { name: 'LED 照明器具の全図面の内訳', exact: true }).last().click()
      await breakdown(page).getByRole('button', { name: 'ページ別', exact: true }).click()
    }
    const button = view === 'table' ? cell(page) : breakdown(page).locator('[data-page-index="0"]')
    const total = view === 'table' ? row(page).locator('.quantity-table-fixed-4 button') : breakdown(page).locator('.quantity-breakdown-total')
    const assertTotal = async (n: number) => expect(total).toHaveText(view === 'table' ? String(n) : `合計 ${n} 個`)
    await button.click(); await expect(button).toContainText('1 / 5')
    const ids = await orderedIds(page)
    await expect.poll(() => selected(page)).toEqual([ids[0]])
    await button.click(); await expect(button).toContainText('2 / 5')
    await expect.poll(() => selected(page)).toEqual([ids[1]])
    await page.keyboard.press('Delete')
    await assertTotal(4); await expect(button).toContainText('1 / 4')
    await button.click()
    await expect.poll(() => selected(page)).toEqual([ids[2]])
    await expect(button).toContainText('2 / 4')
    await page.keyboard.press('Control+z')
    await assertTotal(5); await expect(button).toContainText('3 / 5')
    await button.click()
    await expect.poll(() => selected(page)).toEqual([ids[3]])
    await expect(button).toContainText('4 / 5')
    await page.keyboard.press('Control+Shift+z')
    await assertTotal(4); await expect(button).toContainText('3 / 4')
    await button.click()
    await expect.poll(() => selected(page)).toEqual([ids[4]])
    await expect(button).toContainText('4 / 4')
    await page.keyboard.press('Delete')
    await assertTotal(3)
    await button.click()
    await expect.poll(() => selected(page)).toEqual([ids[0]])
    await expect(button).toContainText('1 / 3')
  })
}

test('table: deletion preserves scrolled viewport and category/kind filters', async ({ page }) => {
  await open(page, true)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await table(page).getByLabel('集計表の分類', { exact: true }).selectOption('電気')
  await table(page).getByLabel('集計表の種別', { exact: true }).selectOption('count')
  const scroll = table(page).locator('.quantity-table-scroll')
  await scroll.evaluate(e => { e.scrollTop = 45 * 32 })
  await expect(row(page)).toBeVisible()
  await cell(page).click(); await cell(page).click()
  await expect(cell(page)).toContainText('2 / 5')
  const top = await scroll.evaluate(e => e.scrollTop)
  expect(top).toBeGreaterThan(0)
  await page.keyboard.press('Delete')
  await expect(row(page).locator('.quantity-table-fixed-4 button')).toHaveText('4')
  await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBe(top)
  await expect(table(page).getByLabel('集計表の分類', { exact: true })).toHaveValue('電気')
  await expect(table(page).getByLabel('集計表の種別', { exact: true })).toHaveValue('count')
  await cell(page).click(); await expect(cell(page)).toContainText('2 / 4')
})

test('breakdown: deleting while filtered preserves the floor/room restriction', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'LED 照明器具の全図面の内訳', exact: true }).last().click()
  await breakdown(page).getByRole('button', { name: '階・部屋別', exact: true }).click()
  await breakdown(page).getByRole('button', { name: '事務室 5 個', exact: true }).click()
  const button = breakdown(page).locator('[data-page-index="0"]')
  await button.click(); await button.click()
  await expect(button).toContainText('2 / 5')
  await page.keyboard.press('Delete')
  await expect(breakdown(page).locator('.quantity-breakdown-total')).toHaveText('合計 4 個')
  await expect(breakdown(page)).toContainText('1階 ／ 事務室')
  await expect(breakdown(page).getByRole('button', { name: '絞り込みを解除', exact: true })).toBeVisible()
  await button.click(); await expect(button).toContainText('2 / 4')
})
