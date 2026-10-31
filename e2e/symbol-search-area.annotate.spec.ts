import { expect, test, type Page } from '@playwright/test'
import type { Rect } from '../src/core/annotations'
import { symbolShapePdf, symbolShapeSampleRect } from '../tests/symbolShapeFixtures'

const panel = (page: Page) => page.getByRole('dialog', { name: '同じ記号を探す', exact: true })
const instruction = (page: Page) => page.locator('.fixture-sample-instruction')
const areaFrame = (page: Page) => page.getByTestId('symbol-search-area-0')

async function point(page: Page, x: number, y: number) {
  return page.getByTestId('fixture-sample-selection-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, b = svg.getBoundingClientRect(), v = svg.viewBox.baseVal
    return { x: b.left + p.x * b.width / v.width, y: b.top + p.y * b.height / v.height }
  }, { x, y })
}

async function draw(page: Page, rect: Rect) {
  await expect(page.getByTestId('fixture-sample-selection-0')).toBeVisible()
  const a = await point(page, rect[0], rect[1])
  const b = await point(page, rect[2], rect[3])
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y)
  await page.mouse.up()
}

async function addFixture(page: Page) {
  const quantity = page.getByTestId('fixture-panel')
  await quantity.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('感知器A')
  await dialog.getByLabel('略号', { exact: true }).fill('D')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await quantity.getByRole('button', { name: 'D 感知器A', exact: true }).click()
}

async function openPanel(page: Page) {
  await page.getByTestId('fixture-panel').getByRole('button', { name: '同じ記号を探す', exact: true }).click()
  // A registered sample opens the panel directly (SPEC-S07); recapture to keep drawing the sample.
  await expect(instruction(page).or(panel(page))).toBeVisible()
  if (await panel(page).isVisible()) await panel(page).getByRole('button', { name: '見本を囲み直す', exact: true }).click()
  await draw(page, symbolShapeSampleRect)
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('checkbox', { name: '形の細部（円弧・枠・斜線・塗り）も見本と比べる', exact: true }).uncheck()
  await panel(page).getByRole('checkbox', { name: '画像でも確認する', exact: true }).uncheck()
}

async function setup(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(() => {
    localStorage.removeItem('karu-pdf:symbol-search-shape')
    localStorage.removeItem('karu-pdf:symbol-search-verify')
  })
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'symbol-search-area.pdf'), symbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect(page.locator('.symbol-search-area-layer')).toHaveCount(0)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await addFixture(page)
  await openPanel(page)
}

async function search(page: Page, count: number) {
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page)).toContainText('検索が終わりました', { timeout: 60_000 })
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(count)
  await expect(panel(page)).toContainText(`候補 ${count} 件`)
}

test('囲んだ範囲だけを探し、中止や範囲の切替では前の範囲を保持する', async ({ page }) => {
  test.setTimeout(180_000)
  await setup(page)
  const candidates = page.getByTestId('symbol-search-candidate')

  await panel(page).getByRole('radio', { name: '範囲を囲む', exact: true }).check()
  await expect(instruction(page)).toContainText('探す範囲を四角で囲んでください（Esc で中止）')
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeDisabled()
  const pageWidth = await page.getByTestId('fixture-sample-selection-0').evaluate(el => (el as SVGSVGElement).viewBox.baseVal.width)
  await draw(page, [1, 1, pageWidth - 1, 99])

  await expect(panel(page)).toBeVisible()
  await expect(instruction(page)).toHaveCount(0)
  await expect(areaFrame(page)).toBeVisible()
  await expect(areaFrame(page)).toHaveClass('symbol-search-area')
  await expect(areaFrame(page)).toHaveAttribute('vector-effect', 'non-scaling-stroke')
  expect(await areaFrame(page).evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')

  const savedArea = await areaFrame(page).evaluate(el => ({
    x: el.getAttribute('x')!,
    y: el.getAttribute('y')!,
    width: el.getAttribute('width')!,
    height: el.getAttribute('height')!,
  }))
  const description = `p.1 の範囲（${Math.round(Number(savedArea.width) * 25.4 / 72)} × ${Math.round(Number(savedArea.height) * 25.4 / 72)} mm）`
  await expect(panel(page).getByText(description, { exact: true })).toBeVisible()

  await search(page, 4)
  const positions = await candidates.evaluateAll(elements => elements.map(el => {
    const rect = el.querySelector('rect')!
    return {
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height')),
    }
  }))
  expect(positions.every(p => p.y < 100)).toBe(true)
  expect(positions.every(p => p.x >= Number(savedArea.x)
    && p.y >= Number(savedArea.y)
    && p.x + p.width <= Number(savedArea.x) + Number(savedArea.width)
    && p.y + p.height <= Number(savedArea.y) + Number(savedArea.height))).toBe(true)
  await expect(areaFrame(page)).toBeVisible()

  const candidateIds = await candidates.evaluateAll(elements => elements.map(el => el.getAttribute('data-candidate-id')))
  await panel(page).getByRole('button', { name: '範囲を囲み直す', exact: true }).click()
  await expect(instruction(page)).toContainText('探す範囲を四角で囲んでください')
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(instruction(page)).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeEnabled()
  await expect(panel(page).getByText(description, { exact: true })).toBeVisible()
  await expect(areaFrame(page)).toBeVisible()
  for (const [name, value] of Object.entries(savedArea)) await expect(areaFrame(page)).toHaveAttribute(name, value)
  expect(await candidates.evaluateAll(elements => elements.map(el => el.getAttribute('data-candidate-id')))).toEqual(candidateIds)

  await panel(page).getByRole('radio', { name: 'このページ', exact: true }).check()
  await expect(areaFrame(page)).toHaveCount(0)
  await search(page, 8)
  const allY = await candidates.evaluateAll(elements => elements.map(el => Number(el.querySelector('rect')!.getAttribute('y'))))
  expect(allY.filter(y => y < 100)).toHaveLength(4)
  expect(allY.filter(y => y > 100)).toHaveLength(4)

  await panel(page).getByRole('radio', { name: '範囲を囲む', exact: true }).check()
  await expect(instruction(page)).toHaveCount(0)
  await expect(panel(page).getByText(description, { exact: true })).toBeVisible()
  await expect(areaFrame(page)).toBeVisible()
  for (const [name, value] of Object.entries(savedArea)) await expect(areaFrame(page)).toHaveAttribute(name, value)

  await panel(page).getByRole('button', { name: '範囲を囲み直す', exact: true }).click()
  await draw(page, [
    symbolShapeSampleRect[0],
    symbolShapeSampleRect[1],
    symbolShapeSampleRect[0] + 8,
    symbolShapeSampleRect[1] + 7,
  ])
  await expect(instruction(page)).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  await expect(areaFrame(page)).toBeVisible()
  await expect(candidates).toHaveCount(0)
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page).getByRole('alert')).toHaveText('範囲が見本より小さいため探せません。広く囲んでください')
  await expect(candidates).toHaveCount(0)
  await expect(panel(page).getByRole('progressbar', { name: '検索の進み', exact: true })).toHaveCount(0)

  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(areaFrame(page)).toHaveCount(0)
  await expect(page.locator('.symbol-search-area-layer')).toHaveCount(0)
})

test('初回の範囲指定は中止でき、2mm未満は再指定を続け、パネル終了と文書切替でも終了する', async ({ page }) => {
  test.setTimeout(180_000)
  await setup(page)

  await panel(page).getByRole('radio', { name: '範囲を囲む', exact: true }).check()
  await expect(instruction(page)).toContainText('探す範囲を四角で囲んでください')
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(instruction(page)).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeEnabled()
  await expect(areaFrame(page)).toHaveCount(0)
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page).getByRole('alert')).toHaveText('範囲を囲んでください')
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(0)

  await panel(page).getByRole('button', { name: '範囲を囲む', exact: true }).click()
  await draw(page, [
    symbolShapeSampleRect[0],
    symbolShapeSampleRect[1],
    symbolShapeSampleRect[0] + 3,
    symbolShapeSampleRect[1] + 3,
  ])
  await expect(instruction(page)).toContainText('範囲が小さすぎます。探す範囲を四角で囲んでください（Esc で中止）')
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeDisabled()
  await expect(areaFrame(page)).toHaveCount(0)
  await instruction(page).getByRole('button', { name: '中止', exact: true }).click()
  await expect(instruction(page)).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: '探す', exact: true })).toBeEnabled()

  await panel(page).getByRole('button', { name: '範囲を囲む', exact: true }).click()
  await expect(instruction(page)).toContainText('探す範囲を四角で囲んでください')
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(instruction(page)).toHaveCount(0)
  await expect(page.getByTestId('fixture-sample-selection-0')).toHaveCount(0)
  await expect(areaFrame(page)).toHaveCount(0)

  await openPanel(page)
  await panel(page).getByRole('radio', { name: '範囲を囲む', exact: true }).check()
  await expect(instruction(page)).toContainText('探す範囲を四角で囲んでください')
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'symbol-search-area-replacement.pdf'), symbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  await expect(instruction(page)).toHaveCount(0)
  await expect(page.getByTestId('fixture-sample-selection-0')).toHaveCount(0)
  await expect(page.locator('.symbol-search-area-layer')).toHaveCount(0)
})
