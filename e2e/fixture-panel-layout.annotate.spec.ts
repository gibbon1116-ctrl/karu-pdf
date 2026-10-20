import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

// Generate PDFs in memory; do not write test artifacts into unmanaged paths.
async function drawingPdf(extraFixtures = 0) {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    { id: 'led', code: 'LED', name: 'LED', category: '電気', order: 0, style: nextCountStyle([]) },
    { id: 'cv', code: 'CV', name: 'CV', category: '電気', kind: 'length', order: 1, style: nextCountStyle([]) },
    ...Array.from({ length: extraFixtures }, (_, i) => ({
      id: `unused${i}`, code: `U${i}`, name: `未使用${i}`, category: 'その他',
      order: i + 2, style: nextCountStyle([]),
    })),
  ]
  try {
    const page = doc.addPage([0, 0, 500, 600], 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    // Loaded fixtures are the baseline and emit no edit; write the list itself.
    writeCountFixtures(doc, fixtures)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { font.font.destroy(); doc.destroy() }
}

const panel = (page: Page) => page.getByTestId('fixture-panel')
const settings = (page: Page) => panel(page).locator('details.fixture-panel-settings')
const groups = (page: Page) => panel(page).locator('.fixture-groups')

async function load(page: Page, bytes: number[]) {
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '数量タブ配置試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: 'LED LED', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getDrawingScanMetrics().scanning)).toBe(false)
}

async function start(page: Page, bytes: number[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(() => {
    localStorage.removeItem('karu-pdf:fixture-panel-settings-open')
    // A preference left by the former management screen must be ignored.
    localStorage.setItem('karu-pdf:fixture-panel-mode', 'manage')
  })
  await page.reload()
  await load(page, bytes)
}

async function expectLayout(page: Page) {
  const sizes = await panel(page).evaluate(element => {
    const controls = element.querySelector<HTMLElement>('.fixture-panel-controls')!
    const list = element.querySelector<HTMLElement>('.fixture-groups')!
    const panelRect = element.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    return {
      panelHeight: panelRect.height,
      controlsHeight: controlsRect.height,
      listHeight: listRect.height,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }
  })
  expect(sizes.listHeight).toBeGreaterThanOrEqual(200)
  expect(sizes.listHeight).toBeGreaterThanOrEqual(sizes.panelHeight * 0.5)
  expect(sizes.controlsHeight).toBeLessThanOrEqual(sizes.panelHeight * 0.45 + 1)
  expect(sizes.listTop).toBeGreaterThanOrEqual(sizes.panelTop)
  expect(sizes.listBottom).toBeLessThanOrEqual(sizes.panelBottom + 1)
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
  expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.clientHeight + 1)
}

test('quantity controls share one screen and retain their names and columns', async ({ page }) => {
  await start(page, await drawingPdf())
  const currentPanel = panel(page)
  await expect(currentPanel).toHaveAttribute('class', 'fixture-panel')
  await expect(currentPanel.getByRole('button', { name: '拾う', exact: true })).toHaveCount(0)
  await expect(currentPanel.getByRole('button', { name: '管理', exact: true })).toHaveCount(0)

  const summary = currentPanel.locator('.fixture-count-summary')
  await expect(summary).toContainText('数量拾いの一覧で項目を選んでください')
  await expect(summary.getByRole('button')).toHaveText(['編集', '複製', '削除', '上へ', '下へ'])
  for (const name of ['編集', '複製', '削除', '上へ', '下へ']) {
    await expect(summary.getByRole('button', { name, exact: true })).toBeDisabled()
  }

  await currentPanel.getByRole('button', { name: 'LED LED', exact: true }).click()
  await expect(summary).toContainText('LED LED')
  await expect(summary).toContainText('全図面:')
  for (const name of ['編集', '複製', '削除']) {
    await expect(summary.getByRole('button', { name, exact: true })).toBeEnabled()
  }
  await expect(summary.getByRole('button', { name: '上へ', exact: true })).toBeDisabled()
  await expect(summary.getByRole('button', { name: '下へ', exact: true })).toBeEnabled()

  await settings(page).locator('summary').click()
  for (const name of [
    '集計表を開く', '数量をCSVに書き出す', '項目を追加',
    '標準マスタから追加', '他のPDFから読み込む',
    '編集', '複製', '削除', '上へ', '下へ',
  ]) {
    const button = currentPanel.getByRole('button', { name, exact: true })
    await expect(button).toHaveCount(1)
    await button.scrollIntoViewIfNeeded()
    await expect(button).toBeVisible()
    await expect(button).toBeInViewport()
  }
  for (const name of ['現在の階', '現在の部屋']) {
    const input = currentPanel.getByRole('combobox', { name, exact: true })
    await input.scrollIntoViewIfNeeded()
    await expect(input).toBeVisible()
    await expect(input).toBeInViewport()
  }
  const search = currentPanel.getByRole('searchbox', { name: '名称・略号で検索', exact: true })
  await search.scrollIntoViewIfNeeded()
  await expect(search).toBeVisible()
  await expect(search).toBeInViewport()

  await expect(currentPanel.locator('.fixture-list-heading > span')).toHaveText([
    '表示', '印', '見本', '略号', '名称', 'この図面', '全図面',
  ])
  await expectLayout(page)
})

test('数量の項目をダブルクリックして編集し、閉じる・変更するを使える', async ({ page }) => {
  await start(page, await drawingPdf())
  const currentPanel = panel(page)
  const led = currentPanel.getByRole('button', { name: 'LED LED', exact: true })
  const cv = currentPanel.getByRole('button', { name: 'CV CV', exact: true })
  const dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })

  await led.click()
  await expect(led).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog).toBeHidden()

  // Double-click a different item: edit the clicked cable, not the former selection.
  await cv.locator('.fixture-row-name').dblclick()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('CV')
  await dialog.getByLabel('名称', { exact: true }).fill('保存しないケーブル')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(cv).toHaveAttribute('aria-pressed', 'true')

  // The marker is part of the same item row, including count fixtures.
  await led.locator('.fixture-swatch').dblclick()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('LED')
  await dialog.getByLabel('名称', { exact: true }).fill('照明器具')
  await dialog.getByRole('button', { name: '変更する', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(currentPanel.getByRole('button', { name: 'LED 照明器具', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Visibility remains a separate action and must not open the editor.
  const visibility = currentPanel.getByRole('button', { name: 'LED 照明器具の表示切替', exact: true })
  await visibility.dblclick()
  await expect(visibility).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog).toBeHidden()

  // Existing Edit button still opens the same saved item.
  await currentPanel.getByRole('button', { name: '編集', exact: true }).click()
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('照明器具')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
})

test('settings start closed and remember both open and closed states across reloads', async ({ page }) => {
  const bytes = await drawingPdf()
  await start(page, bytes)
  await expect(settings(page)).toHaveJSProperty('open', false)
  await expect(settings(page).getByRole('checkbox')).toHaveCount(0)
  await expect(settings(page).getByRole('button', { name: 'すべて表示', exact: true })).toHaveCount(0)
  await expect(settings(page).getByRole('button', { name: '図面番号・図面名称を読み直す', exact: true })).toHaveCount(0)

  await settings(page).locator('summary').click()
  await expect(settings(page)).toHaveJSProperty('open', true)
  await expect(settings(page).getByRole('checkbox')).toHaveCount(5)
  for (const name of [
    '選択中の項目だけ表示',
    '図面に長さ・面積・体積の数値を表示',
    '部屋の範囲を表示',
    'スナップ（既存の頂点に合わせる）',
    '図面の線の端点にも合わせる',
  ]) {
    const checkbox = settings(page).getByRole('checkbox', { name, exact: true })
    await checkbox.scrollIntoViewIfNeeded()
    await expect(checkbox).toBeVisible()
    await expect(checkbox).toBeInViewport()
  }
  for (const name of ['すべて表示', '図面番号・図面名称を読み直す']) {
    const button = settings(page).getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    await expect(button).toBeVisible()
    await expect(button).toBeInViewport()
  }
  await expect(settings(page).getByTestId('drawing-scan-status')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('karu-pdf:fixture-panel-settings-open'))).toBe('true')

  await page.reload()
  await load(page, bytes)
  await expect(settings(page)).toHaveJSProperty('open', true)
  await expect(settings(page).getByRole('checkbox')).toHaveCount(5)
  await expectLayout(page)

  await settings(page).locator('summary').click()
  await expect(settings(page)).toHaveJSProperty('open', false)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('karu-pdf:fixture-panel-settings-open'))).toBe('false')

  await page.reload()
  await load(page, bytes)
  await expect(settings(page)).toHaveJSProperty('open', false)
  await expect(settings(page).getByRole('checkbox')).toHaveCount(0)
})

test('the list uses at least half the panel and scrolls independently with 30 extra items', async ({ page }) => {
  await start(page, await drawingPdf(30))
  await expect(groups(page).locator('li')).toHaveCount(32)
  await expectLayout(page)

  await settings(page).locator('summary').click()
  await expect(settings(page)).toHaveJSProperty('open', true)
  await expectLayout(page)

  const scrollSize = await groups(page).evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(scrollSize.scrollHeight).toBeGreaterThan(scrollSize.clientHeight)
  await groups(page).evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => groups(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(panel(page).getByRole('button', { name: 'U29 未使用29', exact: true })).toBeInViewport()

  const headingPosition = await groups(page).evaluate(element => ({
    listTop: element.getBoundingClientRect().top,
    headingTop: element.querySelector('.fixture-list-heading')!.getBoundingClientRect().top,
  }))
  expect(Math.abs(headingPosition.headingTop - headingPosition.listTop)).toBeLessThanOrEqual(1)
  await expectLayout(page)
})

test('a 300px panel keeps controls and list columns within its width', async ({ page }) => {
  await start(page, await drawingPdf(30))
  // Isolate the requested panel width from the surrounding sidebar's resize UI.
  await panel(page).evaluate(element => {
    element.style.width = '300px'
    element.style.maxWidth = '300px'
    element.style.minWidth = '0'
  })
  await settings(page).locator('summary').click()
  await expect(settings(page)).toHaveJSProperty('open', true)
  await expectLayout(page)

  const widths = await panel(page).evaluate(element => {
    const controls = element.querySelector<HTMLElement>('.fixture-panel-controls')!
    const list = element.querySelector<HTMLElement>('.fixture-groups')!
    const heading = element.querySelector<HTMLElement>('.fixture-list-heading')!
    const location = element.querySelector<HTMLElement>('.current-location')!
    const row = list.querySelector<HTMLElement>('li')!
    const rowRect = row.getBoundingClientRect()
    return {
      panelWidth: element.getBoundingClientRect().width,
      controlsClient: controls.clientWidth,
      controlsScroll: controls.scrollWidth,
      listClient: list.clientWidth,
      listScroll: list.scrollWidth,
      headingClient: heading.clientWidth,
      headingScroll: heading.scrollWidth,
      locationClient: location.clientWidth,
      locationScroll: location.scrollWidth,
      buttons: [...row.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      }),
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
    }
  })
  expect(widths.panelWidth).toBeCloseTo(300, 0)
  expect(widths.controlsScroll).toBeLessThanOrEqual(widths.controlsClient + 1)
  expect(widths.listScroll).toBeLessThanOrEqual(widths.listClient + 1)
  expect(widths.headingScroll).toBeLessThanOrEqual(widths.headingClient + 1)
  expect(widths.locationScroll).toBeLessThanOrEqual(widths.locationClient + 1)
  for (const button of widths.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(widths.rowLeft - 1)
    expect(button.right).toBeLessThanOrEqual(widths.rowRight + 1)
  }
})
