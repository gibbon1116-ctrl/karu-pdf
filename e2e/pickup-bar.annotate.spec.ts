import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'

function blankPdf() {
  const doc = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < 2; i++) {
      const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
const panel = (page: Page) => page.getByTestId('fixture-panel')
const bar = (page: Page) => page.getByRole('toolbar', { name: '拾いバー', exact: true })
const current = (page: Page) => bar(page).getByRole('button', { name: '今の項目を選ぶ', exact: true })
const names = { LED: '照明', CV: 'ケーブル', PF22: '電線管' } as const
async function load(page: Page, bytes = blankPdf()) {
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(data => window.__karu!.openBytes(data, '拾いバー試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '項目を追加', exact: true })).toBeEnabled()
}
async function setup(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await load(page)
  for (const code of ['LED', 'CV', 'PF22'] as const) {
    await panel(page).getByRole('button', { name: '項目を追加', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
    await dialog.getByLabel('略号', { exact: true }).fill(code)
    await dialog.getByLabel('名称', { exact: true }).fill(names[code])
    if (code !== 'LED') await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
    await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  }
}
async function select(page: Page, code: keyof typeof names) {
  await panel(page).getByRole('button', { name: `${code} ${names[code]}`, exact: true }).click()
  await expect(page.getByRole('button', { name: '数量拾い', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(current(page)).toContainText(code)
}
async function clickPoint(page: Page, x: number, y: number, pageIndex = 0) {
  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  const point = await layer.evaluate((element, p) => {
    const svg = element as SVGSVGElement, rect = svg.getBoundingClientRect()
    return { x: p.x * rect.width / svg.viewBox.baseVal.width, y: p.y * rect.height / svg.viewBox.baseVal.height }
  }, { x, y })
  await layer.click({ position: point })
}
async function reloadPdf(page: Page) {
  const bytes = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await page.reload()
  await load(page, bytes)
}

test('拾うと管理を分け、モードと拾いバーの上下位置を再読込後も保つ', async ({ page }) => {
  await setup(page)
  await expect(panel(page).getByRole('button', { name: '拾う', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page).getByRole('button', { name: /表示切替/ })).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: '複製', exact: true })).toHaveCount(0)
  await expect(panel(page).locator('.fixture-list-heading > span')).toHaveText(['項目', 'この図面', '全図面'])
  await expect(panel(page).locator('.fixture-grip')).toHaveCount(0)
  await expect(panel(page).locator('li[draggable="true"]')).toHaveCount(0)
  await panel(page).getByRole('button', { name: '管理', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '複製', exact: true })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'LED 照明の表示切替', exact: true })).toBeVisible()
  await expect(panel(page).locator('.fixture-list-heading > span')).toHaveCount(7)
  await reloadPdf(page)
  await expect(panel(page).getByRole('button', { name: '管理', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await panel(page).getByRole('button', { name: '拾う', exact: true }).click()
  await select(page, 'LED')
  await bar(page).getByRole('button', { name: '拾いバーを下に移す', exact: true }).click()
  await expect(page.locator('.pickup-bar-anchor')).toHaveClass(/pickup-bar-bottom/)
  await reloadPdf(page)
  await select(page, 'LED')
  await expect(page.locator('.pickup-bar-anchor')).toHaveClass(/pickup-bar-bottom/)
  await bar(page).getByRole('button', { name: '拾いバーを上に移す', exact: true }).click()
  await expect(page.locator('.pickup-bar-anchor')).toHaveClass(/pickup-bar-top/)
})

test('数量・前後・検索・最近・取消を図面の近くで操作し、バーのクリックは拾いを増やさない', async ({ page }) => {
  await setup(page); await select(page, 'LED')
  await expect(bar(page)).toContainText('この図面 0 個')
  await expect(bar(page)).toContainText('全図面 0 個')
  await clickPoint(page, 120, 180); await clickPoint(page, 160, 180)
  await expect(bar(page)).toContainText('この図面 2 個')
  await expect(bar(page)).toContainText('全図面 2 個')
  // The page and document totals differ after picking on the second drawing.
  await page.evaluate(() => window.__karu!.scrollToPage(1))
  await clickPoint(page, 120, 180, 1)
  await expect(bar(page)).toContainText('この図面 1 個')
  await expect(bar(page)).toContainText('全図面 3 個')
  await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(bar(page)).toContainText('この図面 0 個')
  await expect(bar(page)).toContainText('全図面 2 個')
  await page.evaluate(() => window.__karu!.scrollToPage(0))
  await expect(bar(page)).toContainText('この図面 2 個')
  await expect(bar(page).getByRole('button', { name: '前の項目', exact: true })).toBeDisabled()
  await page.keyboard.press(']'); await expect(current(page)).toContainText('CV')
  await page.keyboard.press('['); await expect(current(page)).toContainText('LED')
  await bar(page).getByRole('button', { name: '次の項目', exact: true }).click()
  await expect(current(page)).toContainText('CV')
  await current(page).click()
  const quick = page.getByRole('dialog', { name: '項目を選ぶ', exact: true })
  await expect(quick.getByRole('searchbox', { name: '項目を検索', exact: true })).toBeFocused()
  await quick.getByRole('searchbox', { name: '項目を検索', exact: true }).fill('pf')
  const options = quick.getByRole('option')
  expect(await options.count()).toBeGreaterThan(0)
  for (const text of await options.allTextContents()) expect(text).toContain('PF22')
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
  await expect(quick).toHaveCount(0); await expect(current(page)).toContainText('PF22')
  await expect(bar(page).getByRole('button', { name: '次の項目', exact: true })).toBeDisabled()
  await page.keyboard.press(']'); await expect(current(page)).toContainText('PF22')
  await select(page, 'LED'); await select(page, 'CV'); await select(page, 'PF22')
  const recent = panel(page).getByRole('group', { name: '最近使った項目', exact: true })
  await expect(recent.getByRole('button')).toHaveText(['PF22', 'CV', 'LED'])
  await recent.getByRole('button', { name: '最近のLED 照明', exact: true }).click()
  await expect(current(page)).toContainText('LED')
  await current(page).click(); await page.keyboard.press('Escape'); await expect(quick).toHaveCount(0)
  await expect(current(page)).toBeFocused()
  await current(page).click(); await panel(page).getByRole('heading', { name: '数量拾い', exact: true }).click()
  await expect(quick).toHaveCount(0)
  await expect(bar(page)).toContainText('この図面 2 個')
  // Wheel and toolbar clicks stay on the overlay.
  const before = await page.getByTestId('viewer').evaluate(element => element.scrollTop)
  await bar(page).hover(); await page.mouse.wheel(0, 200)
  expect(await page.getByTestId('viewer').evaluate(element => element.scrollTop)).toBe(before)
  await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(bar(page)).toContainText('この図面 1 個')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.count).length)).toBe(1)
  // Typing brackets in search and modified keys never change the item.
  await panel(page).getByRole('searchbox').fill('')
  await panel(page).getByRole('searchbox').press(']')
  await expect(current(page)).toContainText('LED')
  await panel(page).getByRole('searchbox').fill('')
  await panel(page).getByRole('heading', { name: '数量拾い', exact: true }).click()
  await page.keyboard.press('Control+]'); await expect(current(page)).toContainText('LED')
  const bounds = await bar(page).boundingBox(), region = await page.locator('.pickup-bar-region').boundingBox()
  expect(bounds!.height).toBe(32); expect(bounds!.width).toBeLessThanOrEqual(region!.width * .7 + 1)
})

test('選択した経路の項目を表示し、選択を外すと隠れ、分割表示では左の領域に収まる', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '計測▼', exact: true }).click()
  await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  await page.getByLabel('縮尺の分母').fill('100')
  await page.getByRole('button', { name: '決定', exact: true }).click()
  await select(page, 'CV')
  await clickPoint(page, 150, 300); await clickPoint(page, 250, 300); await page.keyboard.press('Enter')
  await select(page, 'LED')
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect(bar(page)).toHaveCount(0)
  await clickPoint(page, 200, 300)
  await expect(current(page)).toContainText('CV')
  await expect(bar(page)).toContainText('この図面 3.53 m')
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)
  await select(page, 'LED')
  await page.keyboard.press('Control+\\')
  const region = await page.locator('.pickup-bar-region').boundingBox(), slot = await page.locator('.viewer-slot').boundingBox()
  expect(region!.width).toBeLessThan(slot!.width)
  const bounds = await bar(page).boundingBox()
  expect(bounds!.x).toBeCloseTo(slot!.x + 8, 0)
  expect(bounds!.width).toBeLessThanOrEqual(region!.width * .7 + 1)
  // Page organization suppresses both the bar and the bracket shortcuts.
  await page.getByRole('button', { name: 'ページ▼', exact: true }).click()
  await page.getByRole('menuitem', { name: 'ページ整理', exact: true }).click()
  await expect(bar(page)).toHaveCount(0)
  await page.keyboard.press(']')
  await expect(page.getByRole('button', { name: '数量拾い', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
