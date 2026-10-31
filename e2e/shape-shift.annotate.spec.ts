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

async function drawShape(page: Page, kind: 'square' | 'circle', shift: boolean) {
  const before = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).map((item) => item.id))
  const name = kind === 'square' ? '四角' : '丸'
  await page.getByRole('button', { name: '図形▼', exact: true }).click()
  await page.getByRole('menu').getByText(name, { exact: true }).click()
  const layer = page.getByTestId('annotation-layer-0')
  await expect(layer).toBeVisible()
  const box = await layer.boundingBox()
  if (!box) throw new Error('ページ1の注釈レイヤーがありません。')
  if (shift) await page.keyboard.down('Shift')
  try {
    await page.mouse.move(box.x + 180, box.y + 180)
    await page.mouse.down()
    await page.mouse.move(box.x + 300, box.y + 230, { steps: 5 })
    await page.mouse.up()
  } finally {
    if (shift) await page.keyboard.up('Shift')
  }
  await expect.poll(() => page.evaluate(({ ids, shapeKind }) =>
    window.__karu!.getEditableAnnotations(0).filter((item) => !ids.includes(item.id) && item.kind === shapeKind).length,
  { ids: before, shapeKind: kind })).toBe(1)
  return page.evaluate(({ ids, shapeKind }) =>
    window.__karu!.getEditableAnnotations(0).find((item) => !ids.includes(item.id) && item.kind === shapeKind)!.rect,
  { ids: before, shapeKind: kind })
}

test('四角はShiftを押しながら横長にドラッグすると正方形になる', async ({ page }) => {
  await openSample(page)
  const rect = await drawShape(page, 'square', true)
  expect(rect[2] - rect[0]).toBeCloseTo(rect[3] - rect[1], 3)
})

test('四角はShiftなしで横長にドラッグすると幅と高さが異なる', async ({ page }) => {
  await openSample(page)
  const rect = await drawShape(page, 'square', false)
  expect(rect[2] - rect[0]).not.toBeCloseTo(rect[3] - rect[1], 3)
})

test('丸はShiftを押しながら横長にドラッグすると正円になる', async ({ page }) => {
  await openSample(page)
  const rect = await drawShape(page, 'circle', true)
  expect(rect[2] - rect[0]).toBeCloseTo(rect[3] - rect[1], 3)
})
