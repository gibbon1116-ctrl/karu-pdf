import { expect, test, type Locator, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { readCountFixtures } from '../src/core/countFixtures'
import { groupFixtures } from '../src/app/fixtureOrder'

function blankPdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    const bytes = doc.saveToBuffer('compress')
    try { return [...bytes.asUint8Array()] } finally { bytes.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
async function open(page: Page, presets = true) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '並び替え試験.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  if (presets) {
    await page.getByRole('button', { name: '見本から追加', exact: true }).click()
    await page.getByRole('dialog', { name: '見本から追加' }).getByRole('button', { name: '選んだ項目を追加' }).click()
  }
}
const panel = (page: Page) => page.getByTestId('fixture-panel')
const category = (page: Page, name: string) => panel(page).locator('.fixture-groups > section').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}（`) }) })
const header = (page: Page, name: string) => category(page, name).locator('.fixture-category button').first()
const row = (page: Page, name: string) => panel(page).locator('li[data-fixture-id]').filter({ has: page.getByRole('button', { name, exact: true }) })
async function add(page: Page, name: string, selectedCategory: string, create = false) {
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByLabel('分類', { exact: true }).selectOption(create ? '' : selectedCategory)
  if (create) await dialog.getByLabel('新しい分類の名前', { exact: true }).fill(selectedCategory)
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
}
async function drag(source: Locator, target: Locator, side: 'before' | 'after' = 'before') {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  await source.dragTo(target, { sourcePosition: { x: 5, y: 10 }, targetPosition: { x: 50, y: side === 'before' ? 3 : box!.height - 3 } })
}
async function clickPoint(page: Page, x: number, y: number) {
  const layer = page.getByTestId('annotation-layer-0')
  const position = await layer.evaluate((el, p) => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: p.x * box.width / svg.viewBox.baseVal.width, y: p.y * box.height / svg.viewBox.baseVal.height }
  }, { x, y })
  await layer.click({ position })
}

test('category selection, visible steps, drag moves, Undo, and persisted category/order', async ({ page }) => {
  // Keep both endpoints visible: dragTo does not simulate scrolling during a drag.
  await page.setViewportSize({ width: 1440, height: 1400 })
  await open(page)
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true }), select = dialog.getByLabel('分類', { exact: true })
  await expect(select.locator('option')).toHaveText(['照明器具', 'コンセント', 'スイッチ', '弱電・防災', '電線・ケーブル', '電線管', 'ケーブルラック', '＋ 新しい分類…'])
  await expect(select).toHaveValue('照明器具')
  await select.selectOption('照明器具')
  await dialog.getByLabel('名称', { exact: true }).fill('新LED')
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(category(page, '照明器具').locator('li').last()).toHaveAttribute('data-fixture-id', (await row(page, '新LED').getAttribute('data-fixture-id'))!)
  await add(page, '幹線項目', '幹線', true)
  await expect(header(page, '幹線')).toBeVisible()
  // Collapse unrelated groups to keep both drag endpoints in the scroll viewport.
  for (const name of ['コンセント', 'スイッチ', '弱電・防災', '電線・ケーブル', '電線管', 'ケーブルラック']) await header(page, name).click()
  const first = row(page, 'DL ダウンライト')
  await drag(row(page, '新LED'), first)
  await expect(category(page, '照明器具').locator('.fixture-row-name').first()).toHaveText('新LED')
  await expect(row(page, '新LED')).toHaveClass(/selected/)
  await page.keyboard.press('Control+z')
  await expect(category(page, '照明器具').locator('.fixture-row-name').last()).toHaveText('新LED')
  for (let i = 9; i >= 0; i--) {
    await panel(page).getByRole('button', { name: '上へ', exact: true }).click()
    await expect(category(page, '照明器具').locator('.fixture-row-name').nth(i)).toHaveText('新LED')
  }
  await expect(panel(page).getByRole('button', { name: '上へ', exact: true })).toBeDisabled()
  await expect(panel(page).getByRole('button', { name: '上へ', exact: true })).toHaveAttribute('title', /分類の先頭/)
  await header(page, 'コンセント').click()
  await drag(row(page, '新LED'), row(page, 'C2 コンセント（2口）'), 'after')
  await expect(category(page, 'コンセント').locator('.fixture-row-name').nth(1)).toHaveText('新LED')
  await expect(panel(page).getByRole('status')).toHaveText('新LEDを分類「コンセント」へ移しました（Ctrl+Z で戻せます）')
  // Row heights differ between fonts (the Linux runner); collapse the long groups so both headers stay in the scroll viewport.
  for (const name of ['照明器具', 'コンセント']) await header(page, name).click()
  await header(page, '幹線').scrollIntoViewIfNeeded()
  await drag(header(page, '幹線'), header(page, '照明器具'))
  await expect(panel(page).locator('.fixture-category button[aria-expanded]').first()).toHaveText('幹線（1）')
  for (const name of ['照明器具', 'コンセント']) await header(page, name).click()
  await panel(page).getByLabel('名称・略号で検索').fill('新LED')
  await expect(row(page, '新LED')).toHaveAttribute('draggable', 'false')
  await expect(header(page, 'コンセント')).toHaveAttribute('draggable', 'false')
  await expect(row(page, '新LED')).toHaveAttribute('title', '検索中は並べ替えできません')
  await panel(page).getByLabel('名称・略号で検索').fill('')
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(saved))
  try {
    const groups = groupFixtures(readCountFixtures(doc))
    expect(groups[0].category).toBe('幹線')
    expect(groups.find(g => g.category === 'コンセント')!.items[1].name).toBe('新LED')
  } finally { doc.destroy() }
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '再読込.pdf'), saved)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).locator('.fixture-category button[aria-expanded]').first()).toHaveText('幹線（1）')
  await expect(category(page, 'コンセント').locator('.fixture-row-name').nth(1)).toHaveText('新LED')
})

test('new category validation, existing-name reuse, edit/duplicate defaults, and collapsed-header drop', async ({ page }) => {
  // The 数量 tab's controls leave a short list at 900px on the Linux runner; keep drag endpoints in view.
  await page.setViewportSize({ width: 1440, height: 1400 })
  await open(page, false)
  await page.getByRole('button', { name: '項目を追加', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog.getByLabel('分類', { exact: true })).toHaveValue('')
  await expect(dialog.getByLabel('新しい分類の名前')).toHaveValue('その他')
  await dialog.getByLabel('名称', { exact: true }).fill('初項目')
  await dialog.getByLabel('新しい分類の名前').fill('   ')
  await expect(dialog.getByRole('button', { name: '追加する' })).toBeDisabled()
  await dialog.getByLabel('新しい分類の名前').fill('照明器具')
  await dialog.getByRole('button', { name: '追加する' }).click()
  await add(page, '同分類項目', ' 照明器具 ', true)
  await expect(panel(page).locator('.fixture-category')).toHaveCount(1)
  await panel(page).getByRole('button', { name: '編集', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '項目を編集', exact: true })
  await expect(dialog.getByLabel('分類', { exact: true })).toHaveValue('照明器具')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await panel(page).getByRole('button', { name: '複製', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await expect(dialog.getByLabel('分類', { exact: true })).toHaveValue('照明器具')
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  await add(page, '幹線項目', '幹線', true)
  await header(page, '照明器具').click()
  await drag(row(page, '幹線項目'), header(page, '照明器具'))
  await expect(header(page, '幹線')).toHaveCount(0)
  await expect(header(page, '照明器具')).toHaveAttribute('aria-expanded', 'false')
  await header(page, '照明器具').click()
  await expect(category(page, '照明器具').locator('.fixture-row-name').last()).toHaveText('幹線項目')
  await expect(row(page, '幹線項目')).toHaveClass(/selected/)
  await page.keyboard.press('Control+z')
  await expect(header(page, '幹線')).toHaveText('幹線（1）')
  // Category drops on rows use the row's category; the lower half moves after it.
  await drag(header(page, '照明器具'), row(page, '幹線項目'), 'after')
  await expect(panel(page).locator('.fixture-category button[aria-expanded]').first()).toHaveText('幹線（1）')
})

test('quantity values toggle leaves geometry/totals/drafts intact and saved PDF values visible', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'CV ケーブル（CV）', exact: true }).click()
  await clickPoint(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await clickPoint(page, 100, 220); await clickPoint(page, 172, 220); await page.keyboard.press('Enter')
  const labels = page.locator('.measurement-shape .measurement-label'), shapes = page.locator('.measurement-shape polyline')
  const value = row(page, 'CV ケーブル（CV）').locator('.fixture-row-count').first()
  const toggle = panel(page).getByLabel('図面に長さ・面積・体積の数値を表示')
  await expect(labels).toHaveText('CV 2.54 m'); await expect(value).toHaveText('2.54')
  const geometry = await shapes.getAttribute('points')
  await toggle.uncheck()
  await expect(labels).toHaveCount(0); await expect(shapes).toHaveAttribute('points', geometry!)
  await expect(value).toHaveText('2.54')
  await clickPoint(page, 100, 300); await clickPoint(page, 172, 300)
  await expect(page.locator('.measurement-draft text')).toContainText('2.54')
  await page.keyboard.press('Escape')
  await toggle.check(); await expect(labels).toHaveText('CV 2.54 m')
  await toggle.uncheck()
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(saved)), pdfPage = doc.loadPage(0)
  const annotations = pdfPage.getAnnotations()
  try {
    expect(annotations).toHaveLength(1)
    expect(annotations[0].getContents()).toBe('CV 2.54 m')
    const display = annotations[0].toDisplayList(), text = display.toStructuredText('preserve-whitespace')
    try { let contents = ''; text.walk({ onChar: c => { contents += c } }); expect(contents).toBe('CV 2.54 m') } finally { text.destroy(); display.destroy() }
  } finally { annotations.forEach(a => a.destroy()); pdfPage.destroy(); doc.destroy() }
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '再読込.pdf'), saved)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByLabel('図面に長さ・面積・体積の数値を表示')).toBeChecked()
  await expect(labels).toHaveText('CV 2.54 m')
})
