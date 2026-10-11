import { expect, test, type Page } from '@playwright/test'
import { symbolShapePdf, symbolShapeSampleRect } from '../tests/symbolShapeFixtures'
import type { Rect } from '../src/core/annotations'

const panel = (page: Page) => page.getByRole('dialog', { name: '同じ記号を探す', exact: true })
const selection = (page: Page) => page.getByTestId('fixture-sample-selection-0')
const registeredMessage = '見本を項目に登録しました（Ctrl+Z で戻せます）'
const reuseMessage = '登録済みの見本で探します。替えるときは「見本を囲み直す」を押してください'

async function point(page: Page, x: number, y: number) {
  return selection(page).evaluate((el, p) => {
    const svg = el as SVGSVGElement, bounds = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return {
      x: bounds.left + p.x * bounds.width / view.width,
      y: bounds.top + p.y * bounds.height / view.height,
    }
  }, { x, y })
}

async function capture(page: Page, rect: readonly number[] = symbolShapeSampleRect) {
  await expect(selection(page)).toBeVisible()
  const a = await point(page, rect[0], rect[1])
  const b = await point(page, rect[2], rect[3])
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y)
  await page.mouse.up()
  await expect(panel(page)).toBeVisible()
}

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('karu-pdf:symbol-search-shape')
    localStorage.removeItem('karu-pdf:symbol-search-verify')
  })
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'symbol-sample-register.pdf'), symbolShapePdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const quantity = page.getByTestId('fixture-panel')
  await quantity.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('感知器')
  await dialog.getByLabel('略号', { exact: true }).fill('D')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await quantity.getByRole('button', { name: 'D 感知器', exact: true }).click()
}

async function start(page: Page) {
  await page.getByTestId('fixture-panel').getByRole('button', { name: '同じ記号を探す', exact: true }).click()
}

async function search(page: Page) {
  await panel(page).getByRole('checkbox', { name: '形の細部（円弧・枠・斜線・塗り）も見本と比べる', exact: true }).uncheck()
  await panel(page).getByRole('checkbox', { name: '画像でも確認する', exact: true }).uncheck()
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page)).toContainText('検索が終わりました', { timeout: 60_000 })
  const candidates = page.getByTestId('symbol-search-candidate')
  await expect(candidates).toHaveCount(8)
  return candidates.count()
}

async function close(page: Page) {
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
}

test('囲んだ見本を登録し、次回は囲み直さずに同じ候補を探し、囲み直しで上書きできる', async ({ page }) => {
  test.setTimeout(180_000)
  await prepare(page)
  const originalFixtures = await page.evaluate(() => window.__karu!.getCountFixtures())

  await start(page)
  await capture(page)
  await expect(page.getByText(registeredMessage, { exact: true })).toBeVisible()
  const registeredFixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  const registered = registeredFixtures[0].sample!
  expect(registered.png).not.toBe('')
  expect(registered.pageIndex).toBe(0)
  expect(registered.rect).toHaveLength(4)
  for (let index = 0; index < 4; index++) {
    expect(registered.rect![index]).toBeCloseTo(symbolShapeSampleRect[index], 1)
  }
  expect(registeredFixtures.map(({ sample: _sample, ...fixture }) => fixture))
    .toEqual(originalFixtures.map(({ sample: _sample, ...fixture }) => fixture))
  const firstCount = await search(page)

  await close(page)
  await start(page)
  await expect(panel(page)).toBeVisible()
  await expect(selection(page)).toHaveCount(0)
  await expect(page.getByText(reuseMessage, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(registeredFixtures)
  expect(await search(page)).toBe(firstCount)

  await panel(page).getByRole('button', { name: '見本を囲み直す', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(selection(page)).toBeVisible()
  await expect(page.locator('.fixture-sample-instruction')).toContainText('探す記号を四角で囲んでください（Esc で中止）')
  const recapturedRect: Rect = [
    symbolShapeSampleRect[0] + 2,
    symbolShapeSampleRect[1],
    symbolShapeSampleRect[2] + 2,
    symbolShapeSampleRect[3],
  ]
  await capture(page, recapturedRect)
  await expect(page.getByText(registeredMessage, { exact: true })).toBeVisible()
  const recapturedFixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(recapturedFixtures[0].sample!.rect).not.toEqual(registered.rect)
  for (let index = 0; index < 4; index++) {
    expect(recapturedFixtures[0].sample!.rect![index]).toBeCloseTo(recapturedRect[index], 1)
  }

  await close(page)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(registeredFixtures)
})

test('最初の見本登録を Ctrl+Z で戻せる', async ({ page }) => {
  test.setTimeout(90_000)
  await prepare(page)
  const before = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(before).toHaveLength(1)
  expect(before[0].sample).toBeUndefined()

  await start(page)
  await capture(page)
  await expect(page.getByText(registeredMessage, { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample?.rect).toHaveLength(4)
  await close(page)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(before)
})

test('ページを前に挿入しても、登録済みの見本をそのまま使える', async ({ page }) => {
  test.setTimeout(120_000)
  await prepare(page)
  await start(page)
  await capture(page)
  await expect(page.getByText(registeredMessage, { exact: true })).toBeVisible()
  await close(page)
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample?.pageIndex).toBe(0)

  // Insert a blank page before the drawing (SPEC-S13): the sample moves to page index 1.
  await page.evaluate(async () => {
    await window.__karu!.openOrganize()
    window.__karu!.organizeDraft()!.insertBlank(0, 200, 200)
    await window.__karu!.applyOrganize()
  })
  await expect(page.getByTestId('annotation-layer-1')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'D 感知器', exact: true }).click()
  await expect.poll(async () => (await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample?.pageIndex).toBe(1)
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample?.rect).toHaveLength(4)

  await start(page)
  await expect(panel(page)).toBeVisible()
  await expect(page.getByText(reuseMessage, { exact: true })).toBeVisible()
  await expect(page.locator('.fixture-sample-instruction')).toHaveCount(0)
})
