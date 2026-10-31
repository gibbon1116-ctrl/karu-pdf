import { expect, test, type Locator, type Page } from '@playwright/test'
import { symbolSampleEraserPdf, symbolSampleEraserRect } from '../tests/symbolSampleEraserFixtures'

const panel = (page: Page) => page.getByRole('dialog', { name: '同じ記号を探す', exact: true })
const eraser = (page: Page) => page.getByRole('dialog', { name: '見本の線を整える', exact: true })
const selection = (page: Page) => page.getByTestId('fixture-sample-selection-0')

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:symbol-search-shape', 'false')
    localStorage.setItem('karu-pdf:symbol-search-verify', 'false')
  })
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'symbol-sample-eraser.pdf'), symbolSampleEraserPdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  const quantity = page.getByTestId('fixture-panel')
  await quantity.getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill('器具')
  await dialog.getByLabel('略号', { exact: true }).fill('D')
  await dialog.getByRole('radio', { name: '個数', exact: true }).check()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
  await quantity.getByRole('button', { name: 'D 器具', exact: true }).click()
  await quantity.getByRole('button', { name: '同じ記号を探す', exact: true }).click()
  await capture(page)
}

async function capture(page: Page) {
  await expect(selection(page)).toBeVisible()
  const points = await selection(page).evaluate((el, rect) => {
    const svg = el as SVGSVGElement, bounds = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    const point = (x: number, y: number) => ({
      x: bounds.left + (x - view.x) * bounds.width / view.width,
      y: bounds.top + (y - view.y) * bounds.height / view.height,
    })
    return [point(rect[0], rect[1]), point(rect[2], rect[3])]
  }, symbolSampleEraserRect)
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y)
  await page.mouse.up()
  await expect(panel(page)).toBeVisible()
}

async function search(page: Page): Promise<number> {
  await panel(page).getByRole('checkbox', { name: '画像でも確認する', exact: true }).uncheck()
  await panel(page).getByRole('checkbox', { name: '形の細部（円弧・枠・斜線・塗り）も見本と比べる', exact: true }).uncheck()
  await panel(page).getByRole('button', { name: '探す', exact: true }).click()
  await expect(panel(page)).toContainText('検索が終わりました', { timeout: 60_000 })
  return page.getByTestId('symbol-search-candidate').count()
}

async function midpoint(line: Locator): Promise<{ x: number; y: number }> {
  return line.evaluate(el => {
    const line = el as SVGLineElement, matrix = line.getScreenCTM()
    if (!matrix) throw new Error('見本の線が表示されていません')
    const point = new DOMPoint((line.x1.baseVal.value + line.x2.baseVal.value) / 2,
      (line.y1.baseVal.value + line.y2.baseVal.value) / 2).matrixTransform(matrix)
    return { x: point.x, y: point.y }
  })
}

async function extraLineIds(page: Page): Promise<string[]> {
  // Select the three short interior lines by their synthetic geometry, not extraction order.
  return eraser(page).getByTestId('sample-line').evaluateAll(elements => {
    const lines = elements as SVGLineElement[]
    const left = Math.min(...lines.flatMap(line => [line.x1.baseVal.value, line.x2.baseVal.value]))
    const right = Math.max(...lines.flatMap(line => [line.x1.baseVal.value, line.x2.baseVal.value]))
    return lines.filter(line => Math.abs(line.y1.baseVal.value - line.y2.baseVal.value) < .01
      && Math.min(line.x1.baseVal.value, line.x2.baseVal.value) > left + .01
      && Math.max(line.x1.baseVal.value, line.x2.baseVal.value) < right - .01)
      .sort((a, b) => a.y1.baseVal.value - b.y1.baseVal.value)
      .map(line => line.getAttribute('data-line-id')!)
  })
}

test('消した配線を検索から除き、編集・復元・保存・囲み直しを確認する', async ({ page }) => {
  test.setTimeout(240_000)
  await prepare(page)
  const baselineCount = await search(page)
  expect(baselineCount).toBeLessThan(3)

  await expect(panel(page).getByRole('button', { name: '見本の線を整える', exact: true })).toBeEnabled()
  await panel(page).getByRole('button', { name: '見本の線を整える', exact: true }).click()
  await expect(eraser(page)).toBeVisible()
  await expect(eraser(page).getByTestId('sample-line')).toHaveCount(7)
  await expect(eraser(page).getByRole('button', { name: '消しゴム', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await eraser(page).getByRole('button', { name: 'すべての線を使う', exact: true }).click()
  await expect(eraser(page).locator('[data-testid="sample-line"][data-state="use"]')).toHaveCount(7)

  const ids = await extraLineIds(page)
  expect(ids).toHaveLength(3)
  const line = (id: string) => eraser(page).locator(`[data-testid="sample-line"][data-line-id="${id}"]`)
  const first = await midpoint(line(ids[0])), last = await midpoint(line(ids[2]))
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  await page.mouse.move(last.x, last.y, { steps: 16 })
  await page.mouse.up()
  await expect(eraser(page).locator('[data-testid="sample-line"][data-state="use"]')).toHaveCount(4)
  await eraser(page).getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(eraser(page).locator('[data-testid="sample-line"][data-state="use"]')).toHaveCount(7)

  for (const id of ids) {
    const point = await midpoint(line(id))
    await page.mouse.click(point.x, point.y)
    await expect(line(id)).toHaveAttribute('data-state', 'erased')
  }
  const registeredSample = (await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample
  await page.keyboard.press('Control+z')
  await expect(line(ids[2])).toHaveAttribute('data-state', 'use')
  // Ctrl+Z in the eraser undoes only the eraser step, never the document (the sample registration stays).
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample).toEqual(registeredSample)
  const undoPoint = await midpoint(line(ids[2]))
  await page.mouse.click(undoPoint.x, undoPoint.y)
  await expect(line(ids[2])).toHaveAttribute('data-state', 'erased')
  await expect(eraser(page).locator('[data-testid="sample-line"][data-state="use"]')).toHaveCount(4)
  await expect(eraser(page)).toContainText('使う線 4 本・消した線 3 本')

  await eraser(page).getByRole('button', { name: '戻す', exact: true }).click()
  await expect(eraser(page).getByRole('button', { name: '戻す', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(eraser(page)).toContainText('戻す線（赤い破線）をなぞるか押してください。')
  const restorePoint = await midpoint(line(ids[0]))
  await page.mouse.click(restorePoint.x, restorePoint.y)
  await expect(line(ids[0])).toHaveAttribute('data-state', 'use')
  await eraser(page).getByRole('button', { name: '消しゴム', exact: true }).click()
  await page.mouse.click(restorePoint.x, restorePoint.y)
  await expect(line(ids[0])).toHaveAttribute('data-state', 'erased')

  await eraser(page).getByRole('button', { name: 'この線で探す', exact: true }).click()
  await expect(eraser(page)).toHaveCount(0)
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(0)
  await expect(panel(page)).toContainText('線を整えた見本（使う線 4 本・消した線 3 本）')
  const editedFixtures = await page.evaluate(() => window.__karu!.getCountFixtures())
  expect(editedFixtures[0].sample?.lines?.segments).toHaveLength(16)
  expect(editedFixtures[0].sample?.lines?.widths).toHaveLength(4)
  expect(await search(page)).toBe(3)

  // Cancel/Esc must preserve both the saved selection and the completed candidates.
  await panel(page).getByRole('button', { name: '見本の線を整える', exact: true }).click()
  await expect(eraser(page).locator('[data-testid="sample-line"][data-state="use"]')).toHaveCount(4)
  await eraser(page).getByRole('button', { name: 'すべての線を使う', exact: true }).click()
  await eraser(page).getByRole('button', { name: 'やめる', exact: true }).click()
  expect(await page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(editedFixtures)
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(3)
  await panel(page).getByRole('button', { name: '見本の線を整える', exact: true }).click()
  await expect(eraser(page)).toBeVisible()
  await eraser(page).getByRole('button', { name: 'すべての線を使う', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(eraser(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(editedFixtures)

  // Reopening a registered sample starts with its stored manual lines.
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '同じ記号を探す', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  await expect(selection(page)).toHaveCount(0)
  await expect(panel(page)).toContainText('線を整えた見本（使う線 4 本')
  expect(await search(page)).toBe(3)

  await panel(page).getByRole('button', { name: '整えた線を元に戻す', exact: true }).click()
  await expect(page.getByTestId('symbol-search-candidate')).toHaveCount(0)
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample?.lines).toBeUndefined()
  expect(await search(page)).toBe(baselineCount)
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(editedFixtures)

  // Recapturing the same rectangle must still discard its old manual lines.
  await page.getByTestId('fixture-panel').getByRole('button', { name: '同じ記号を探す', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('button', { name: '見本を囲み直す', exact: true }).click()
  await capture(page)
  expect((await page.evaluate(() => window.__karu!.getCountFixtures()))[0].sample?.lines).toBeUndefined()
  await panel(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getCountFixtures())).toEqual(editedFixtures)
})
