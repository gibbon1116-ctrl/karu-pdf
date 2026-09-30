import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

async function openSample(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu?.getEditableAnnotations(0).length ?? -1)).toBeGreaterThanOrEqual(0)
}

async function layerBox(page: Page, pageIndex = 0) {
  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  await expect(layer).toBeVisible()
  const box = await layer.boundingBox()
  if (!box) throw new Error(`ページ${pageIndex + 1}の注釈レイヤーがありません。`)
  return { layer, box }
}

async function createSquare(page: Page, x: number, y: number, width = 70, height = 50): Promise<string> {
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))
  const { box } = await layerBox(page)
  await page.getByRole('button', { name: '図形▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: '四角' }).click()
  await page.mouse.move(box.x + x, box.y + y)
  await page.mouse.down()
  await page.mouse.move(box.x + x + width, box.y + y + height, { steps: 5 })
  await page.mouse.up()
  const created = await page.evaluate((ids) => window.__karu!.getEditableAnnotations(0).find((item) => !ids.includes(item.id) && item.kind === 'square')?.id ?? '', before)
  expect(created).not.toBe('')
  return created
}

async function createSymbol(page: Page, x: number, y: number, size = 16): Promise<string> {
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))
  const { box } = await layerBox(page)
  await page.getByRole('button', { name: '記号', exact: true }).click()
  await page.getByLabel('記号の大きさ').selectOption(String(size))
  await page.mouse.click(box.x + x, box.y + y)
  const created = await page.evaluate((ids) => window.__karu!.getEditableAnnotations(0).find((item) => !ids.includes(item.id) && item.kind === 'symbol')?.id ?? '', before)
  expect(created).not.toBe('')
  return created
}

async function createText(page: Page, x: number, y: number, text: string): Promise<string> {
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))
  const { layer } = await layerBox(page)
  await page.getByRole('button', { name: '文字', exact: true }).click()
  await layer.click({ position: { x, y } })
  await page.getByTestId('text-editor').fill(text)
  await page.keyboard.press('Control+Enter')
  const created = await page.evaluate((ids) => window.__karu!.getEditableAnnotations(0).find((item) => !ids.includes(item.id) && item.kind === 'freetext')?.id ?? '', before)
  expect(created).not.toBe('')
  return created
}

test('蛍光ペンは1本で選択へ戻り、作った線を選ぶ', async ({ page }) => {
  await openSample(page)
  const { box, layer } = await layerBox(page)
  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click()
  await page.mouse.move(box.x + 100, box.y + 140)
  await page.mouse.down()
  await page.mouse.move(box.x + 250, box.y + 150, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(layer.locator('.annotation-selection')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'highlight').length)).toBe(1)
})

test('32ptの記号と透明度を保存して開き直す', async ({ page }) => {
  await openSample(page)
  await page.getByRole('button', { name: '記号', exact: true }).click()
  await page.getByLabel('記号の大きさ').selectOption('32')
  await page.getByLabel('透明度').selectOption('0.5')
  const id = await createSymbol(page, 180, 180, 32)
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(async (value) => window.__karu!.openBytes(value, 'symbol-opacity.pdf'), bytes)
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'symbol'))).toMatchObject({
    rect: expect.any(Array), opacity: 0.5,
  })
  const symbol = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find((item) => item.kind === 'symbol')!)
  expect(symbol.id).not.toBe(id)
  expect(symbol.rect[2] - symbol.rect[0]).toBeCloseTo(32, 1)
  expect(symbol.rect[3] - symbol.rect[1]).toBeCloseTo(32, 1)
})

test('3件を別ページへ貼り付け、1回の元に戻すでまとめて消す', async ({ page }) => {
  await openSample(page)
  const text = await createText(page, 100, 100, 'コピーする文字')
  const square = await createSquare(page, 320, 220)
  const symbol = await createSymbol(page, 470, 150)
  await page.keyboard.press('v')
  const layer = page.getByTestId('annotation-layer-0')
  await layer.locator(`g[data-annotation-id="${text}"] .annotation-hit`).click()
  await layer.locator(`g[data-annotation-id="${square}"] .annotation-hit`).click({ modifiers: ['Shift'] })
  await layer.locator(`g[data-annotation-id="${symbol}"] .annotation-hit`).click({ modifiers: ['Shift'] })
  await expect(layer.locator('.annotation-selection')).toHaveCount(3)
  await page.keyboard.press('Control+c')
  await page.evaluate(() => window.__karu!.scrollToPage(1))
  await expect(page.getByTestId('annotation-layer-1')).toBeVisible()
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(1).length)
  await page.keyboard.press('Control+v')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(1).length)).toBe(before + 3)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(1).length)).toBe(before)
})

test('同じページへの連続貼り付けは10pt、20ptずれる', async ({ page }) => {
  await openSample(page)
  const id = await createSquare(page, 180, 180, 40, 40)
  const layer = page.getByTestId('annotation-layer-0')
  await layer.locator(`g[data-annotation-id="${id}"] .annotation-hit`).click()
  const source = await page.evaluate((value) => window.__karu!.getEditableAnnotations(0).find((item) => item.id === value)!.rect, id)
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await page.keyboard.press('Control+v')
  const squares = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter((item) => item.kind === 'square' && item.objNum === null).map((item) => item.rect))
  expect(squares).toEqual(expect.arrayContaining([
    [source[0] + 10, source[1] + 10, source[2] + 10, source[3] + 10],
    [source[0] + 20, source[1] + 20, source[2] + 20, source[3] + 20],
  ]))
})

test('タブAでコピーした書き込みをタブBへ貼り付ける', async ({ page }) => {
  await openSample(page)
  const id = await createSquare(page, 160, 160)
  const layer = page.getByTestId('annotation-layer-0')
  await layer.locator(`g[data-annotation-id="${id}"] .annotation-hit`).click()
  await page.keyboard.press('Control+c')
  const bytes = await page.evaluate(async () => Array.from((await window.__karu!.saveToBytes())!))
  await page.evaluate(async (value) => window.__karu!.openBytes(value, 'tab-b.pdf'), bytes)
  await expect.poll(() => page.evaluate(() => window.__karu!.listTabs().length)).toBe(2)
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)
  await page.keyboard.press('Control+v')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)).toBe(before + 1)
})

test('囲み選択した2件をまとめて移動する', async ({ page }) => {
  await openSample(page)
  const first = await createSquare(page, 180, 180, 40, 35)
  const second = await createSquare(page, 250, 210, 40, 35)
  await page.keyboard.press('v')
  const { box, layer } = await layerBox(page)
  await page.mouse.move(box.x + 160, box.y + 160)
  await page.mouse.down()
  await page.mouse.move(box.x + 310, box.y + 270, { steps: 6 })
  await page.mouse.up()
  await expect(layer.locator('.annotation-selection')).toHaveCount(2)
  const before = await page.evaluate(([a, b]) => [
    window.__karu!.getEditableAnnotations(0).find((item) => item.id === a)!.rect,
    window.__karu!.getEditableAnnotations(0).find((item) => item.id === b)!.rect,
  ], [first, second])
  const hit = layer.locator(`g[data-annotation-id="${first}"] .annotation-hit`)
  const hitBox = await hit.boundingBox()
  if (!hitBox) throw new Error('移動する書き込みが見つかりません。')
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(hitBox.x + hitBox.width / 2 + 30, hitBox.y + hitBox.height / 2 + 20, { steps: 5 })
  await page.mouse.up()
  const after = await page.evaluate(([a, b]) => [
    window.__karu!.getEditableAnnotations(0).find((item) => item.id === a)!.rect,
    window.__karu!.getEditableAnnotations(0).find((item) => item.id === b)!.rect,
  ], [first, second])
  expect(after[0][0] - before[0][0]).toBeCloseTo(after[1][0] - before[1][0], 2)
  expect(after[0][1] - before[0][1]).toBeCloseTo(after[1][1] - before[1][1], 2)
  expect(after[0][0]).toBeGreaterThan(before[0][0])
})
