import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

// Generate PDFs in memory. No test writes into work/ or other unmanaged paths.
async function drawingPdf(extraFixtures = 0, pageCount = 3) {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    { id: 'led', code: 'LED', name: 'LED', category: '電気', order: 0, style: nextCountStyle([]) },
    { id: 'cv', code: 'CV', name: 'CV', category: '電気', kind: 'length', order: 1, style: nextCountStyle([]) },
    ...Array.from({ length: extraFixtures }, (_, i) => ({ id: `unused${i}`, code: `U${i}`, name: `未使用${i}`, category: 'その他', order: i + 2, style: nextCountStyle([]) })),
  ]
  try {
    for (let p = 0; p < pageCount; p++) {
      const page = doc.addPage([0, 0, 500, 600], 0, {}, '')
      try { doc.insertPage(-1, page) } finally { page.destroy() }
    }
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    // Intentionally insert the lower/right marks first to check geometric order.
    for (const [p, x, y, floor, room] of [
      [0, 80, 100, '1階', ''], [0, 180, 100, '1階', ''],
      [1, 180, 220, '1階', '事務室'], [1, 180, 100, '1階', '事務室'], [1, 80, 100, '1階', '事務室'],
      [2, 80, 100, '2階', ''],
    ] as const) store.create({ kind: 'symbol', symbol: 'circle', pageIndex: p, rect: [x, y, x + 10, y + 10],
      count: { version: 2, id: `${p}-${x}-${y}`, fixtureId: 'led', floor, room } })
    store.create({ kind: 'perimeter', pageIndex: 1, rect: [80, 320, 180, 320], vertices: [[80, 320], [180, 320]],
      measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 100 },
      quantity: { version: 1, id: 'cv', itemId: 'cv', method: 'polyline' } })
    for (let p = 3; p < pageCount; p++) store.create({ kind: 'symbol', symbol: 'circle', pageIndex: p, rect: [80, 100, 90, 110],
      count: { version: 2, id: `extra${p}`, fixtureId: 'led', floor: `${p + 1}階` } })
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { font.font.destroy(); doc.destroy() }
}

async function load(page: Page, bytes: number[]) {
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '集計表試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByTestId('fixture-panel').getByRole('button', { name: 'LED LED', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getDrawingScanMetrics().scanning)).toBe(false)
  await page.evaluate(() => {
    window.__karu!.setDrawingInfo(1, { number: 'E-101', name: '1階電灯設備平面図', numberManual: true, nameManual: true, scanned: true })
    window.__karu!.setDrawingInfo(2, { number: 'E-201', name: '2階電灯設備平面図', numberManual: true, nameManual: true, scanned: true })
  })
}
const table = (page: Page) => page.getByRole('region', { name: '数量の集計表', exact: true })
const row = (page: Page, id = 'led') => table(page).locator(`tr[data-fixture-id="${id}"]`)
const cell = (page: Page, key: string, id = 'led') => row(page, id).locator(`button[data-column-key='${key}']`)
async function selected(page: Page) {
  return page.evaluate(() => {
    const ids = window.__karu!.getSelectedAnnotationIds()
    const mark = [0, 1, 2].flatMap(p => window.__karu!.getEditableAnnotations(p)).find(a => ids.includes(a.id))
    return { ids, id: mark?.id, pageIndex: mark?.pageIndex, rect: mark?.rect, fixture: mark?.count?.version === 2 ? mark.count.fixtureId : undefined }
  })
}

test('wide table, location reveal/cycling, filters, resize persistence, CSV and breakdown', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const bytes = await drawingPdf()
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0'); await load(page, bytes)
  await expect(table(page)).toHaveCount(0)
  const before = (await page.getByTestId('viewer').boundingBox())!
  // The launcher is available in both quantity-panel modes.
  await page.getByTestId('fixture-panel').getByRole('button', { name: '拾う', exact: true }).click()
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page)).toBeVisible()
  const viewer = (await page.getByTestId('viewer').boundingBox())!, region = (await table(page).boundingBox())!
  expect(viewer.height).toBeLessThan(before.height * .7)
  expect(viewer.height).toBeGreaterThan(before.height * .5)
  expect(Math.abs(region.y - (viewer.y + viewer.height))).toBeLessThan(2)
  expect(Math.abs(region.width - viewer.width)).toBeLessThan(2)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect(row(page).locator('.quantity-table-fixed-4 button')).toHaveText('6')
  const headers = table(page).getByRole('columnheader')
  await expect(headers.filter({ hasText: 'p.1' })).toHaveCount(1)
  await expect(headers.filter({ hasText: 'E-101' })).toContainText('1階電灯設備平面図')
  await expect(headers.filter({ hasText: 'E-101' }).locator('small')).toHaveAttribute('title', '1階電灯設備平面図')
  await expect(headers.filter({ hasText: 'E-201' })).toHaveCount(1)

  await cell(page, '1').click()
  await expect(cell(page, '1')).toContainText('1 / 3')
  await expect(page.getByTestId('quantity-pickup-flash')).toBeAttached()
  const first = await selected(page)
  expect(first.ids).toHaveLength(1); expect(first.pageIndex).toBe(1); expect(first.fixture).toBe('led')
  await expect(page.getByTestId('quantity-pickup-flash')).toHaveAttribute('data-flash-id', first.id!)
  await expect(page.getByTestId('annotation-layer-1').locator('.annotation-selection')).toBeVisible()
  await cell(page, '1').click(); await expect(cell(page, '1')).toContainText('2 / 3')
  const second = await selected(page)
  expect(second.id).not.toBe(first.id)
  expect(Math.abs(first.rect![1] - second.rect![1])).toBeLessThan(1)
  expect(first.rect![0]).toBeLessThan(second.rect![0])
  await cell(page, '1').click(); await expect(cell(page, '1')).toContainText('3 / 3')
  expect((await selected(page)).rect![1]).toBeGreaterThan(second.rect![1])
  await cell(page, '1').click(); expect((await selected(page)).id).toBe(first.id)

  await table(page).getByRole('button', { name: '階別', exact: true }).click()
  await expect(table(page).getByRole('columnheader').filter({ hasText: '1階' })).toHaveCount(1)
  await expect(table(page).getByRole('columnheader').filter({ hasText: '2階' })).toHaveCount(1)
  await expect(cell(page, '1階')).toHaveText('5')
  await cell(page, '1階').click(); expect((await selected(page)).pageIndex).toBe(0)
  await table(page).getByRole('button', { name: '階・部屋別', exact: true }).click()
  const office = row(page).getByRole('button', { name: 'LED LED 1階／事務室 3', exact: true })
  await expect(office).toHaveText('3'); await office.click()
  expect((await selected(page)).pageIndex).toBe(1)
  await expect(office).toContainText('1 / 3')

  await table(page).getByLabel('集計表の種別', { exact: true }).selectOption('length')
  await expect(row(page)).toHaveCount(0); await expect(row(page, 'cv')).toBeVisible()
  await table(page).getByLabel('集計表の種別', { exact: true }).selectOption('')
  await table(page).getByLabel('集計表の名称・略号を検索', { exact: true }).fill('led')
  await expect(row(page)).toBeVisible(); await expect(row(page, 'cv')).toHaveCount(0)
  await table(page).getByLabel('集計表の名称・略号を検索', { exact: true }).fill('')

  await table(page).getByRole('button', { name: 'CSVに書き出す', exact: true }).click()
  const csv = page.getByRole('dialog', { name: '数量をCSVに書き出す', exact: true })
  await expect(csv).toBeVisible(); await page.keyboard.press('Escape'); await expect(csv).toHaveCount(0)
  await expect(table(page)).toBeVisible()
  const grip = table(page).getByRole('separator', { name: '集計表の高さ', exact: true })
  const g = (await grip.boundingBox())!, stack = (await page.locator('.quantity-viewer-stack').boundingBox())!
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down()
  await page.mouse.move(g.x + g.width / 2, stack.y + stack.height * .4, { steps: 8 }); await page.mouse.up()
  const storedHeight = await page.evaluate(() => Number(localStorage.getItem('karu-pdf:quantity-table-height')))
  expect(storedHeight).toBeGreaterThan(55); expect(storedHeight).toBeLessThan(65)
  const resized = (await table(page).boundingBox())!.height
  expect(resized).toBeGreaterThan(region.height)
  await page.reload(); await load(page, bytes)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page)).toBeVisible()
  await expect(table(page).getByRole('separator')).toHaveAttribute('aria-valuenow', String(Math.round(storedHeight)))
  expect(Math.abs((await table(page).boundingBox())!.height - resized)).toBeLessThan(3)

  // The all-document cell uses the existing sidebar breakdown.
  await row(page).locator('.quantity-table-fixed-4 button').click()
  const breakdown = page.getByTestId('quantity-breakdown')
  await expect(breakdown).toBeVisible()
  await table(page).getByRole('button', { name: '集計表を閉じる', exact: true }).click()
  await breakdown.getByRole('button', { name: 'ページ別', exact: true }).click()
  await breakdown.locator('[data-page-index="1"]').click()
  expect((await selected(page)).ids).toHaveLength(1)
  await expect(page.getByTestId('quantity-pickup-flash')).toBeAttached()
  await expect(page.getByTestId('annotation-layer-1').locator('.annotation-selection')).toBeVisible()
  await breakdown.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page)).toBeVisible(); await page.keyboard.press('Escape'); await expect(table(page)).toHaveCount(0)
  await expect.poll(async () => (await page.getByTestId('viewer').boundingBox())!.height).toBeCloseTo(before.height, 0)
})

test('renders only viewport rows, fixes headings/left columns and limits 100 drawing columns to 80', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0'); await load(page, await drawingPdf(998, 100))
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page)).toBeVisible()
  await expect(table(page).getByRole('status')).toContainText('ほか 20 列。')
  await expect(table(page).getByRole('columnheader')).toHaveCount(85)
  expect(await table(page).locator('tr[data-fixture-id]').count()).toBeLessThan(50)
  const scroll = table(page).locator('.quantity-table-scroll'), fixed = row(page).locator('.quantity-table-fixed-1')
  const left = (await fixed.boundingBox())!.x
  await scroll.evaluate(e => { e.scrollLeft = 600 })
  expect(Math.abs((await fixed.boundingBox())!.x - left)).toBeLessThan(1)
  await scroll.evaluate(e => { e.scrollTop = e.scrollHeight })
  await expect(row(page, 'unused997')).toBeVisible()
  await expect(row(page)).toHaveCount(0)
  expect(await table(page).locator('tr[data-fixture-id]').count()).toBeLessThan(50)
  const header = (await table(page).getByRole('columnheader', { name: '全図面', exact: true }).boundingBox())!
  const viewport = (await scroll.boundingBox())!
  expect(Math.abs(header.y - viewport.y)).toBeLessThan(1)
  await table(page).getByLabel('集計表の種別', { exact: true }).selectOption('length')
  await expect(row(page, 'cv')).toBeVisible()
  await expect(table(page).getByRole('columnheader')).toHaveCount(6)
  await expect(table(page).getByRole('status')).toHaveCount(0)
  await expect(row(page, 'cv').locator('button[data-column-key="1"]')).toHaveText('10.00')
  await row(page, 'cv').locator('button[data-column-key="1"]').click()
  await expect(page.getByTestId('annotation-layer-1').locator('polyline.annotation-selection-path')).toBeVisible()
  await expect(page.getByTestId('annotation-layer-1').locator('.annotation-selection')).toHaveCount(0)
  await expect(page.getByTestId('quantity-pickup-flash')).toHaveJSProperty('tagName', 'polyline')
})
