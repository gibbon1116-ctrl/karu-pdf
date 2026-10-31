import { expect, test, type Page } from '@playwright/test'
import { shiftedSymbolShapePdf, symbolShapePdf, symbolShapeSampleRect } from '../tests/symbolShapeFixtures'

const panel = (page: Page) => page.getByRole('dialog', { name: '同じ記号を探す', exact: true })
const selection = (page: Page) => page.getByTestId('fixture-sample-selection-0')
const quantity = (page: Page) => page.getByTestId('fixture-panel')

async function start(page: Page) {
  await quantity(page).getByRole('button', { name: 'D 感知器', exact: true }).click()
  await quantity(page).getByRole('button', { name: '同じ記号を探す', exact: true }).click()
}

async function capture(page: Page, offsetY = 0) {
  await expect(selection(page)).toBeVisible()
  const points = await selection(page).evaluate((el, data) => {
    const svg = el as SVGSVGElement, bounds = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return [0, 2].map(i => ({
      x: bounds.left + data.rect[i] * bounds.width / view.width,
      y: bounds.top + (data.rect[i + 1] + data.offsetY) * bounds.height / view.height,
    }))
  }, { rect: symbolShapeSampleRect, offsetY })
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y)
  await page.mouse.up()
  await expect(panel(page)).toBeVisible()
}

test('他のPDFの見本を囲まずに検索し、見本元を閉じると囲み直す（SPEC-S23）', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.removeItem('karu-pdf:symbol-search-shape')
    localStorage.removeItem('karu-pdf:symbol-search-verify')
  })
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '見本元.pdf'), symbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await quantity(page).getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('感知器')
  await dialog.getByLabel('略号', { exact: true }).fill('D')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await start(page)
  await capture(page)
  await expect(page.getByText('見本を項目に登録しました（Ctrl+Z で戻せます）', { exact: true })).toBeVisible()
  const original = (await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()

  // Three open documents evict the source from display Workers' two-document LRU.
  // The unrelated document has no matching fixture and must not be rendered as a sample.
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '無関係.pdf'), shiftedSymbolShapePdf())
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '読込先.pdf'), shiftedSymbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await quantity(page).getByRole('button', { name: '他のPDFから読み込む', exact: true }).click()
  await page.getByLabel('読込元PDF', { exact: true }).selectOption({ label: '見本元.pdf' })
  await page.getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  const imported = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(imported[0].sample).toEqual(original)
  await start(page)
  await expect(panel(page)).toBeVisible()
  await expect(selection(page)).toHaveCount(0)
  await expect(page.locator('.fixture-sample-instruction')).toHaveCount(0)
  await expect(page.getByText('他のPDF「見本元.pdf」の見本で探します。替えるときは「見本を囲み直す」を押してください', { exact: true })).toBeVisible()
  await expect(panel(page)).toContainText('見本: 見本元.pdf（他のPDF）')
  expect(await page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(imported)

  await panel(page).getByRole('checkbox', { name: '形の細部（円弧・枠・斜線・塗り）も見本と比べる', exact: true }).uncheck()
  // Keep image verification enabled to cover rendering the template from the source document.
  await panel(page).getByRole('checkbox', { name: '画像でも確認する', exact: true }).check()
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page)).toContainText('検索が終わりました', { timeout: 60_000 })
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(8)
  expect(await page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(imported)

  await page.evaluate(async () => {
    const source = window.__karu!.listTabs().find(tab => tab.name === '見本元.pdf')!
    await window.__karu!.closeTab(source.docId)
  })
  await expect(panel(page)).toHaveCount(0)
  await start(page)
  await expect(selection(page)).toBeVisible()
  await expect(page.locator('.fixture-sample-instruction')).toContainText('登録した見本の場所が図面と合わないため、探す記号を四角で囲んでください（Esc で中止）')

  // A recaptured sample is registered in the destination's coordinates and reused locally.
  await capture(page, 170)
  await expect(panel(page).getByText('見本: 見本元.pdf（他のPDF）', { exact: true })).toHaveCount(0)
  const recaptured = (await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample!
  expect(recaptured.rect![1]).toBeCloseTo(symbolShapeSampleRect[1] + 170, 1)
  await panel(page).getByRole('button', { name: '見本を囲み直す', exact: true }).click()
  await expect(selection(page)).toBeVisible()
  await expect(page.locator('.fixture-sample-instruction')).toContainText('探す記号を四角で囲んでください（Esc で中止）')
  await capture(page, 170)
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await start(page)
  await expect(panel(page)).toBeVisible()
  await expect(selection(page)).toHaveCount(0)
  await expect(page.getByText('登録済みの見本で探します。替えるときは「見本を囲み直す」を押してください', { exact: true })).toBeVisible()
})
