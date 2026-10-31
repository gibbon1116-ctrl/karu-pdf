import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

const DOOR_SPEC = '1.2m*2m・長い規格表示'
const WIDTH_KEY = 'karu-pdf:format-panel-width'

async function drawingPdf(): Promise<number[]> {
  const doc = new mupdf.PDFDocument()
  const store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const fixtures: CountFixture[] = [
    {
      id: 'door', code: 'DS', spec: DOOR_SPEC, name: '片開き戸の長い建具名称',
      category: '建具', order: 0,
      opening: { widthM: 1.2, heightM: 2 },
      style: { ...nextCountStyle([]), showCode: true },
    },
    {
      id: 'wall', code: 'W', name: '壁仕上げ', kind: 'area',
      category: '建築', order: 1,
      style: { ...nextCountStyle([]), showCode: true },
    },
  ]
  try {
    const page = doc.addPage([0, 0, 500, 600], 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    store.create({
      kind: 'symbol', symbol: 'circle', pageIndex: 0, rect: [80, 100, 90, 110],
      count: { version: 2, id: 'door-mark', fixtureId: 'door' },
    })
    store.create({
      kind: 'perimeter', pageIndex: 0, rect: [80, 300, 180, 300],
      vertices: [[80, 300], [180, 300]],
      measure: { kind: 'perimeter', unit: 'mm', decimals: null, mmPerPoint: 100 },
      quantity: { version: 1, id: 'wall-mark', itemId: 'wall', method: 'lengthHeight', heightM: 2 },
    })
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally {
    font.font.destroy()
    doc.destroy()
  }
}

async function openDrawing(page: Page, bytes: number[]): Promise<void> {
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '右欄試験.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(page.getByTestId('fixture-panel')).toBeVisible()
}

async function start(page: Page, bytes: number[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.evaluate(key => {
    localStorage.removeItem(key)
    localStorage.setItem('karu-pdf:side-panel-width', '220')
  }, WIDTH_KEY)
  await page.reload()
  await openDrawing(page, bytes)
}

async function selectWall(page: Page): Promise<void> {
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await expect(table).toBeVisible()
  await table.locator('tr[data-fixture-id="wall"] button[data-column-key="0"]').click()
  await page.getByRole('button', { name: '集計表を閉じる', exact: true }).click()
  await expect(page.getByTestId('format-panel').getByRole('button', { name: '開口部を追加', exact: true })).toBeVisible()
}

async function dragTo(page: Page, x: number): Promise<void> {
  const handle = page.getByRole('separator', { name: '右の欄の幅', exact: true })
  const bounds = (await handle.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('draws only the code and separates the specification in the quantity table', async ({ page }) => {
  await start(page, await drawingPdf())
  const layer = page.getByTestId('annotation-layer-0')
  await expect(layer).toBeVisible()
  await expect.poll(async () => (await layer.locator('text').allTextContents()).includes('DS')).toBe(true)
  expect((await layer.locator('text').allTextContents()).some(text => text.includes(DOOR_SPEC))).toBe(false)

  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  const row = table.locator('tr[data-fixture-id="door"]')
  await expect(row.locator('.quantity-table-fixed-1')).toHaveText('DS')
  await expect(row.locator('.quantity-table-fixed-3')).toHaveText(DOOR_SPEC)
  await expect(table.getByRole('columnheader').nth(3)).toHaveText('規格')
})

test('fits three openings inside the 210px panel without a nested scroll area', async ({ page }) => {
  await start(page, await drawingPdf())
  await selectWall(page)
  const panel = page.getByTestId('format-panel')
  const handle = page.getByRole('separator', { name: '右の欄の幅', exact: true })
  await expect(handle).toHaveAttribute('aria-valuenow', '210')

  for (let i = 0; i < 3; i++) {
    await panel.getByRole('button', { name: '開口部を追加', exact: true }).click()
  }
  await panel.getByRole('combobox', { name: '開口部1の種類', exact: true }).selectOption('door')
  for (const index of [2, 3]) {
    await panel.getByRole('spinbutton', { name: `開口部${index}の幅（m）`, exact: true }).fill('1.5')
    await panel.getByRole('spinbutton', { name: `開口部${index}の高さ（m）`, exact: true }).fill('2')
    await panel.getByRole('spinbutton', { name: `開口部${index}の箇所数`, exact: true }).focus()
  }

  await expect(panel.locator('.quantity-opening-row')).toHaveCount(3)
  await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const listStyle = await panel.locator('.quantity-opening-list').evaluate(element => {
    const style = getComputedStyle(element)
    return { overflowY: style.overflowY, maxHeight: style.maxHeight }
  })
  expect(listStyle).toEqual({ overflowY: 'visible', maxHeight: 'none' })
  for (const row of await panel.locator('.quantity-opening-row').all()) {
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('resizes by drag and keyboard, remembers the width and keeps room for the drawing', async ({ page }) => {
  const bytes = await drawingPdf()
  await start(page, bytes)
  const handle = page.getByRole('separator', { name: '右の欄の幅', exact: true })
  await expect(handle).toHaveAttribute('aria-valuenow', '210')
  await expect(handle).toHaveAttribute('aria-valuemin', '210')
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  await expect(handle).toHaveAttribute('tabindex', '0')

  const bounds = (await handle.boundingBox())!
  await dragTo(page, bounds.x + bounds.width / 2 - 100)
  await expect(handle).toHaveAttribute('aria-valuenow', '310')
  expect(await page.evaluate(key => localStorage.getItem(key), WIDTH_KEY)).toBe('310')

  await page.reload()
  await openDrawing(page, bytes)
  await expect(handle).toHaveAttribute('aria-valuenow', '310')
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(handle).toHaveAttribute('aria-valuenow', '320')
  await page.keyboard.press('ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuenow', '310')

  await dragTo(page, 1279)
  await expect(handle).toHaveAttribute('aria-valuenow', '210')
  await dragTo(page, 0)
  const maximum = Number(await handle.getAttribute('aria-valuemax'))
  await expect(handle).toHaveAttribute('aria-valuenow', String(maximum))
  expect(maximum).toBeLessThanOrEqual(560)
  expect(maximum).toBeLessThanOrEqual(Math.floor(1280 * .45))
  await expect.poll(async () => (await page.getByTestId('viewer').boundingBox())!.width).toBeGreaterThanOrEqual(500)

  await page.setViewportSize({ width: 800, height: 900 })
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(360)
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(210)
})
