import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

// Generate PDFs in memory. No test writes into work/ or other unmanaged paths.
async function drawingPdf(extraFixtures = 0, pageCount = 3, located = false, locatedCv = false) {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    {
      id: 'led', code: 'LED', name: located ? '分電盤 L-1' : 'LED',
      category: located ? '盤類' : '電気', order: 0, style: nextCountStyle([]),
      ...(located ? {
        summary: [{ label: '盤名称', value: 'L-1' }],
        breakdown: {
          book: '電気設備' as const, section: '庁舎',
          subject: '電灯設備', middle: '電灯分岐', item: '分電盤',
        },
      } : {}),
    },
    {
      id: 'cv', code: 'CV', name: 'CV', category: '電気', kind: 'length',
      order: 1, style: nextCountStyle([]),
      ...(locatedCv ? {
        breakdown: {
          book: '電気設備' as const, section: '庁舎',
          subject: '受変電設備', item: '受変電用ケーブル',
        },
      } : {}),
    },
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
  await expect(page.getByTestId('fixture-panel').getByRole('button', { name: /^LED (?:LED|分電盤 L-1)$/ })).toBeVisible()
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
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page)).toBeVisible()
  await expect(page.getByTestId('fixture-panel').getByRole('checkbox', { name: '内訳書の構成で表示', exact: true })).toHaveCount(0)
  const viewer = (await page.getByTestId('viewer').boundingBox())!, region = (await table(page).boundingBox())!
  expect(viewer.height).toBeLessThan(before.height * .7)
  expect(viewer.height).toBeGreaterThan(before.height * .5)
  expect(Math.abs(region.y - (viewer.y + viewer.height))).toBeLessThan(2)
  expect(Math.abs(region.width - viewer.width)).toBeLessThan(2)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect(row(page).locator('.quantity-table-fixed-5 button')).toHaveText('6')
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
  await row(page).locator('.quantity-table-fixed-5 button').click()
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
  await expect(table(page).getByRole('columnheader')).toHaveCount(87)
  expect(await table(page).locator('tr[data-fixture-id]').count()).toBeLessThan(50)
  const scroll = table(page).locator('.quantity-table-scroll'), fixed = row(page).locator('.quantity-table-fixed-1')
  const left = (await fixed.boundingBox())!.x
  const summary = row(page).locator('.quantity-table-summary')
  const summaryLeft = (await summary.boundingBox())!.x
  await expect(table(page).locator('.quantity-table-breakdown')).toHaveCount(0)
  await scroll.evaluate(e => { e.scrollLeft = 600 })
  expect(Math.abs((await fixed.boundingBox())!.x - left)).toBeLessThan(1)
  expect(Math.abs((await summary.boundingBox())!.x - summaryLeft + 600)).toBeLessThan(1)

  await scroll.evaluate(e => { e.scrollTop = e.scrollHeight })
  await expect(row(page, 'unused997')).toBeVisible()
  await expect(row(page)).toHaveCount(0)
  expect(await table(page).locator('tr[data-fixture-id]').count()).toBeLessThan(50)
  const header = (await table(page).getByRole('columnheader', { name: '全図面', exact: true }).boundingBox())!
  const viewport = (await scroll.boundingBox())!
  expect(Math.abs(header.y - viewport.y)).toBeLessThan(1)
  await table(page).getByLabel('集計表の種別', { exact: true }).selectOption('length')
  await expect(row(page, 'cv')).toBeVisible()
  await expect(table(page).getByRole('columnheader')).toHaveCount(8)
  await expect(table(page).getByRole('status')).toHaveCount(0)
  await expect(row(page, 'cv').locator('button[data-column-key="1"]')).toHaveText('10.00')
  await row(page, 'cv').locator('button[data-column-key="1"]').click()
  await expect(page.getByTestId('annotation-layer-1').locator('polyline.annotation-selection-path')).toHaveCount(1)
  await expect(page.getByTestId('annotation-layer-1').locator('.annotation-selection')).toHaveCount(0)
  await expect(page.getByTestId('quantity-pickup-flash')).toHaveJSProperty('tagName', 'polyline')
})

test('defaults to hierarchy headings and persists category grouping after it is unchecked', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const bytes = await drawingPdf(0, 3, true)
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.evaluate(() => {
    localStorage.removeItem('karu-pdf:group-by-breakdown')
    localStorage.removeItem('karu-pdf:quantity-table-group-by-breakdown-v2')
    localStorage.removeItem('karu-pdf:fixture-panel-group-by-breakdown')
    localStorage.setItem('karu-pdf:quantity-table-group-by-breakdown', 'false')
  })
  // Reload so the module reads the prepared storage before its first snapshot.
  await page.reload()
  await load(page, bytes)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page)).toBeVisible()
  expect(await table(page).getByRole('columnheader').allTextContents()).toEqual([
    '見本', '略号', '名称', '規格', '単位', '全図面', '摘要',
    'p.1', 'E-1011階電灯設備平面図', 'E-2012階電灯設備平面図',
  ])
  await expect(table(page).locator('thead .quantity-table-fixed')).toHaveCount(6)
  await expect(row(page).locator('.quantity-table-fixed')).toHaveCount(6)
  await expect(table(page).locator('.quantity-table-fixed-6, .quantity-table-fixed-7')).toHaveCount(0)
  expect(await row(page).locator('.quantity-table-fixed').evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).left),
  )).toEqual(['0px', '44px', '144px', '294px', '384px', '434px'])
  await expect(row(page).locator('.quantity-table-summary')).toHaveText('L-1')
  await expect(row(page).locator('.quantity-table-summary')).toHaveAttribute('title', 'L-1')
  await expect(row(page).locator('.quantity-table-summary')).toHaveCSS('position', 'static')
  await expect(row(page).locator('.quantity-table-summary')).toHaveCSS('width', '120px')
  await expect(row(page).locator('.quantity-table-summary')).toHaveCSS('white-space', 'nowrap')
  await expect(row(page).locator('.quantity-table-summary')).toHaveCSS('text-overflow', 'ellipsis')
  await expect(table(page).locator('.quantity-table-breakdown')).toHaveCount(0)
  await expect(table(page).getByRole('columnheader', { name: '内訳書の位置', exact: true })).toHaveCount(0)
  const group = table(page).getByRole('checkbox', { name: '内訳書の位置でまとめる', exact: true })
  await expect(group).toBeChecked()
  const headings = table(page).locator('.quantity-table-category th')
  await expect(headings.locator('.quantity-table-heading-label')).toHaveText([
    '電気設備', '庁舎', '電灯設備', '電灯分岐', '（内訳書の位置なし）',
  ])
  await expect(headings.locator('.quantity-table-heading-count'))
    .toHaveText(['（1）', '（1）', '（1）', '（1）', '（1）'])
  expect(await table(page).locator('.quantity-table-category').evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-level')),
  )).toEqual(['0', '1', '2', '3', '0'])
  await expect(headings.nth(0)).toHaveCSS('text-indent', '0px')
  await expect(headings.nth(1)).toHaveCSS('text-indent', '0px')
  for (const [index, multiplier] of [[2, 1], [3, 2]] as const) {
    const indent = await headings.nth(index).evaluate(element => {
      const style = getComputedStyle(element)
      return parseFloat(style.textIndent) / parseFloat(style.fontSize)
    })
    expect(indent).toBeCloseTo(multiplier)
  }
  expect(await table(page).locator('tbody tr:not(.quantity-table-spacer)').evaluateAll(elements =>
    elements.map(element =>
      element.querySelector('td.quantity-table-fixed-2')?.textContent
      ?? element.querySelector('.quantity-table-heading-label')?.textContent,
    ),
  )).toEqual([
    '電気設備', '庁舎', '電灯設備', '電灯分岐', '分電盤 L-1',
    '（内訳書の位置なし）', 'CV',
  ])
  await expect(table(page).locator('.quantity-table-category th').last()
    .locator('.quantity-table-heading-label')).toHaveText('（内訳書の位置なし）')
  await expect(table(page).locator('.quantity-table-category th').first()).toHaveAttribute('colspan', '6')
  await expect(table(page).locator('.quantity-table-category td').first()).toHaveAttribute('colspan', '4')
  await expect(table(page).locator('.quantity-table-category td').first()).toBeEmpty()
  await expect(row(page).locator('.quantity-table-fixed-5 button')).toHaveText('6')
  await group.uncheck()
  await expect(group).not.toBeChecked()
  await expect(table(page).locator('.quantity-table-heading-label')).toHaveText(['盤類', '電気'])
  await expect(table(page).locator('.quantity-table-category[data-level]')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('karu-pdf:group-by-breakdown')))
    .toBe('false')

  await page.reload()
  await load(page, bytes)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page).getByRole('checkbox', { name: '内訳書の位置でまとめる', exact: true }))
    .not.toBeChecked()
  await expect(table(page).locator('.quantity-table-heading-label')).toHaveText(['盤類', '電気'])
  await expect(table(page).locator('.quantity-table-category[data-level]')).toHaveCount(0)
  await expect(row(page).locator('.quantity-table-summary')).toHaveText('L-1')
  await expect(table(page).locator('.quantity-table-breakdown')).toHaveCount(0)
})

test('shares breakdown grouping between the table and fixture list for 13 amplification items', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1400 })
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:group-by-breakdown', 'true')
    localStorage.removeItem('karu-pdf:quantity-table-collapsed')
  })

  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  let bytes: number[]
  try {
    const pdfPage = doc.addPage([0, 0, 500, 600], 0, {}, '')
    try { doc.insertPage(-1, pdfPage) } finally { pdfPage.destroy() }
    const fixtures: CountFixture[] = Array.from({ length: 13 }, (_, index) => ({
      id: `speaker${index}`,
      code: `SP${index + 1}`,
      name: `スピーカー${index + 1}`,
      category: '拡声設備',
      order: index,
      style: nextCountStyle([]),
      ...(index < 3 ? {
        breakdown: {
          book: '電気設備' as const,
          section: '庁舎',
          subject: '拡声設備',
          item: 'スピーカー',
        },
      } : {}),
    }))
    // Load an empty list first so the 13 items are written to the PDF as a change.
    await store.ensureCountFixtures(async () => [], async () => {})
    store.setCountFixtures(fixtures)
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { bytes = [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { font.font.destroy(); doc.destroy() }

  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(value => window.__karu!.openBytes(value, '拡声設備試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()

  const panel = page.getByTestId('fixture-panel')
  const panelToggle = panel.getByRole('checkbox', { name: '内訳書の構成で表示', exact: true })
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(13)
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'breakdown')
  await expect(panelToggle).toBeChecked()
  await expect(panel.getByRole('button', { name: '拡声設備（10）', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getDrawingScanMetrics().scanning)).toBe(false)

  await panel.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const tableToggle = table(page).getByRole('checkbox', { name: '内訳書の位置でまとめる', exact: true })
  const amplificationHeading = table(page).locator('.quantity-table-category').filter({
    has: page.locator('.quantity-table-heading-label').filter({ hasText: /^拡声設備$/ }),
  })
  await expect(tableToggle).toBeChecked()
  await expect(amplificationHeading.locator('.quantity-table-heading-count')).toHaveText('（3）')
  await expect(table(page).locator('.quantity-table-heading-label'))
    .toContainText(['電気設備', '庁舎', '拡声設備', '（内訳書の位置なし）'])

  await tableToggle.uncheck()
  await expect(panelToggle).not.toBeChecked()
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'category')
  const categoryHeading = panel.getByRole('button', { name: '拡声設備（13）', exact: true })
  await expect(categoryHeading).toBeVisible()
  await expect(panel.locator('.fixture-category > button:first-child')).toHaveText(['拡声設備（13）'])
  await expect(panel.locator('li[data-fixture-id]')).toHaveCount(13)
  await expect(table(page).locator('.quantity-table-heading-label')).toHaveText(['拡声設備'])
  await expect(amplificationHeading.locator('.quantity-table-heading-count')).toHaveText('（13）')
  const panelCount = Number((await categoryHeading.innerText()).match(/（(\d+)）$/)![1])
  const tableCount = Number((await amplificationHeading.locator('.quantity-table-heading-count').innerText())
    .match(/（(\d+)）/)![1])
  expect(panelCount).toBe(tableCount)
  expect(await page.evaluate(() => localStorage.getItem('karu-pdf:group-by-breakdown'))).toBe('false')

  await tableToggle.check()
  await expect(panelToggle).toBeChecked()
  await expect(panel.locator('.fixture-groups')).toHaveAttribute('data-grouping', 'breakdown')
  await expect(panel.getByRole('button', { name: '電気設備（3）', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '（内訳書の位置なし）（10）', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '拡声設備（10）', exact: true })).toBeVisible()
  await expect(amplificationHeading.locator('.quantity-table-heading-count')).toHaveText('（3）')
  await expect(table(page).locator('.quantity-table-heading-label'))
    .toContainText(['電気設備', '庁舎', '拡声設備', '（内訳書の位置なし）'])
  expect(await page.evaluate(() => localStorage.getItem('karu-pdf:group-by-breakdown'))).toBe('true')

  // Verify the reverse direction while the table remains mounted.
  await panelToggle.uncheck()
  await expect(tableToggle).not.toBeChecked()
  await expect(table(page).locator('.quantity-table-heading-label')).toHaveText(['拡声設備'])
  await expect(amplificationHeading.locator('.quantity-table-heading-count')).toHaveText('（13）')
  await panelToggle.check()
  await expect(tableToggle).toBeChecked()
  await expect(amplificationHeading.locator('.quantity-table-heading-count')).toHaveText('（3）')
})

test('Excel export writes every row and drawing column even when headings are collapsed', async ({ page }) => {
  test.setTimeout(120_000)
  // Use the download fallback; a native save dialog cannot be driven headless.
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0'); await load(page, await drawingPdf(0, 100))
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(table(page).locator('thead th[data-column-key]')).toHaveCount(80)
  await table(page).getByRole('button', { name: '電気をたたむ', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  await expect(row(page, 'cv')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await table(page).getByRole('button', { name: 'Excelに書き出す', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('集計表試験_数量集計表.xlsx')
  const bytes = await fs.readFile(await file.path())
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  // Stored (uncompressed) entries: the sheet XML is readable in place.
  const text = bytes.toString('utf8')
  expect(text).toContain('<sheet name="集計表"')
  expect(text).toContain('<sheet name="明細"')
  // 6 fixed columns + 1 metadata column + 100 drawing columns: the last heading is column DC (107th).
  expect(text).toContain('r="DC4"')
  expect(text).not.toContain('r="DD4"')
  expect(text).toContain('E-101')
  expect(text).toContain('LED')
  expect(text).toContain('CV')
  await expect(table(page).getByRole('button', { name: 'Excelに書き出す', exact: true })).toBeEnabled()
  await expect(table(page).getByRole('alert')).toHaveCount(0)
})

test('collapses hierarchy headings, opens selected ancestors and persists collapsed keys', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const bytes = await drawingPdf(0, 3, true, true)
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.evaluate(() => {
    localStorage.removeItem('karu-pdf:quantity-table-collapsed')
    localStorage.removeItem('karu-pdf:group-by-breakdown')
    localStorage.removeItem('karu-pdf:quantity-table-group-by-breakdown-v2')
    localStorage.removeItem('karu-pdf:fixture-panel-group-by-breakdown')
  })
  await page.reload()
  await load(page, bytes)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()

  const light = table(page).getByRole('button', { name: '電灯設備をたたむ', exact: true })
  await expect(light).toHaveAttribute('aria-expanded', 'true')
  await expect(light.locator('..').locator('.quantity-table-heading-count')).toHaveText('（1）')
  await light.click()
  await expect(row(page)).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: '電灯分岐をたたむ', exact: true })).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: '電灯設備を開く', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  await expect(row(page, 'cv')).toBeVisible()

  await table(page).getByRole('button', { name: 'すべて開く', exact: true }).click()
  await expect(row(page)).toBeVisible()
  await expect(row(page, 'cv')).toBeVisible()

  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', { name: 'CV CV', exact: true }).click()
  await table(page).getByRole('button', { name: 'すべてたたむ', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  await expect(row(page, 'cv')).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: '電気設備を開く', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')

  const savedKeys = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('karu-pdf:quantity-table-collapsed')!) as string[],
  )
  expect(savedKeys).toEqual(expect.arrayContaining([
    JSON.stringify(['電気設備']),
    JSON.stringify(['電気設備', '庁舎']),
    JSON.stringify(['電気設備', '庁舎', '電灯設備']),
    JSON.stringify(['電気設備', '庁舎', '受変電設備']),
  ]))

  // 「すべてたたむ」も、別の項目を選ぶまで自動で開き直さない。
  await panel.getByRole('button', { name: 'LED 分電盤 L-1', exact: true }).click()
  await expect(row(page)).toBeVisible()
  await panel.getByRole('button', { name: 'CV CV', exact: true }).click()
  await expect(row(page, 'cv')).toBeVisible()

  // A manual collapse overrides automatic expansion until selection changes.
  await table(page).getByRole('button', { name: '受変電設備をたたむ', exact: true }).click()
  await expect(row(page, 'cv')).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: '受変電設備を開く', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  await panel.getByRole('button', { name: 'LED 分電盤 L-1', exact: true }).click()
  await expect(row(page)).toBeVisible()
  await expect(row(page, 'cv')).toHaveCount(0)
  await panel.getByRole('button', { name: 'CV CV', exact: true }).click()
  await expect(row(page, 'cv')).toBeVisible()
  await expect(row(page)).toHaveCount(0)
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('karu-pdf:quantity-table-collapsed')!) as string[],
  )).toEqual(savedKeys)

  await table(page).getByRole('button', { name: '集計表を閉じる', exact: true }).click()
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  await expect(row(page, 'cv')).toBeVisible()

  await page.reload()
  await load(page, bytes)
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'CV CV', exact: true }).click()
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  await expect(row(page)).toHaveCount(0)
  await expect(row(page, 'cv')).toBeVisible()
  await expect(table(page).getByRole('button', { name: '電灯設備を開く', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('karu-pdf:quantity-table-collapsed')!) as string[],
  )).toEqual(savedKeys)
})

test('選択時だけ行へ追従し、拾いの更新では手動スクロールや見出しの折りたたみを維持する', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:group-by-breakdown', 'false')
    localStorage.removeItem('karu-pdf:quantity-table-collapsed')
  })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await load(page, await drawingPdf(200))
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()

  const panel = page.getByTestId('fixture-panel')
  const scroll = table(page).locator('.quantity-table-scroll')
  const choose = async (index: number) => {
    await panel.getByRole('button', {
      name: `U${index} 未使用${index}`, exact: true,
    }).click()
  }
  const pick = async () => {
    await page.getByTestId('annotation-layer-0').click({
      position: { x: 300, y: 150 },
    })
  }
  const settledTop = () => scroll.evaluate(async element => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    return element.scrollTop
  })

  await choose(180)
  await expect(row(page, 'unused180')).toBeInViewport()
  await expect.poll(() => scroll.evaluate(element => element.scrollTop))
    .toBeGreaterThan(1000)

  await scroll.evaluate(element => { element.scrollTop = 0 })
  await expect(row(page)).toBeInViewport()
  await expect(row(page, 'unused180')).toHaveCount(0)
  await pick()
  await expect(panel.locator('li[data-fixture-id="unused180"]')
    .locator('.fixture-total-button')).toHaveText('1')
  expect(await settledTop()).toBeLessThan(1)
  await expect(row(page)).toBeInViewport()
  await expect(row(page, 'unused180')).toHaveCount(0)

  // 別項目を選ぶと、その項目の行へ再び追従する。
  await choose(120)
  await expect(row(page, 'unused120')).toBeInViewport()
  await expect.poll(() => scroll.evaluate(element => element.scrollTop))
    .toBeGreaterThan(1000)

  // 選択中の項目を含む見出しも、手でたたんだ後は更新で開き直さない。
  await scroll.evaluate(element => { element.scrollTop = 0 })
  await table(page).getByRole('button', { name: 'その他をたたむ', exact: true }).click()
  const collapsed = table(page).getByRole('button', {
    name: 'その他を開く', exact: true,
  })
  await expect(collapsed).toHaveAttribute('aria-expanded', 'false')
  await expect(row(page, 'unused120')).toHaveCount(0)
  await pick()
  await expect(panel.locator('li[data-fixture-id="unused120"]')
    .locator('.fixture-total-button')).toHaveText('1')
  expect(await settledTop()).toBeLessThan(1)
  await expect(collapsed).toHaveAttribute('aria-expanded', 'false')
  await expect(row(page, 'unused120')).toHaveCount(0)

  await choose(121)
  await expect(row(page, 'unused121')).toBeInViewport()
  await expect.poll(() => scroll.evaluate(element => element.scrollTop))
    .toBeGreaterThan(1000)
})
