import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits, type Point } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

async function drawingPdf(vertexCount = 3) {
  const doc = new mupdf.PDFDocument(), store = new AnnotationStore()
  const font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  const fixtures: CountFixture[] = [
    { id: 'cv', code: 'CV', name: 'ケーブル', category: '電気', kind: 'length', order: 0, style: nextCountStyle([]) },
    { id: 'area', code: 'A', name: '面積', category: '仮設', kind: 'area', order: 1, style: nextCountStyle([]) },
    { id: 'led', code: 'LED', name: '個数', category: '電気', order: 2, style: nextCountStyle([]) },
  ]
  try {
    doc.insertPage(-1, ref)
    await store.ensureCountFixtures(async () => fixtures, async () => {})
    const vertices: Point[] = vertexCount === 3 ? [[70, 120], [210, 120], [210, 200]]
      : Array.from({ length: vertexCount }, (_, i) => [70 + 280 * i / (vertexCount - 1), 120 + (i % 2) * .2])
    store.create({ kind: 'perimeter', pageIndex: 0, rect: [70, 120, 350, 200], vertices,
      measure: { kind: 'perimeter', mmPerPoint: 100, unit: 'mm', decimals: null },
      quantity: { version: 1, id: 'route', itemId: 'cv', method: 'polyline', rises: [{ m: 3, at: 2 }, { m: 2, at: 0 }] } })
    store.create({ kind: 'area', pageIndex: 0, rect: [70, 280, 210, 360], vertices: [[70, 280], [210, 280], [210, 360], [70, 360]],
      measure: { kind: 'area', mmPerPoint: 100, unit: 'mm', decimals: null },
      quantity: { version: 1, id: 'area', itemId: 'area', method: 'polygon' } })
    store.create({ kind: 'symbol', symbol: 'circle', pageIndex: 0, rect: [300, 290, 312, 302], count: { version: 2, id: 'count', fixtureId: 'led' } })
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); font.font.destroy(); doc.destroy() }
}
const layer = (page: Page) => page.getByTestId('annotation-layer-0')
const annotations = (page: Page) => page.evaluate(() => window.__karu!.getEditableAnnotations(0))
async function open(page: Page, vertexCount = 3) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '経路選択.pdf'), await drawingPdf(vertexCount))
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await expect(layer(page)).toBeVisible()
  await page.getByRole('button', { name: '選択', exact: true }).click()
}
async function point(page: Page, x: number, y: number) {
  return layer(page).evaluate((el, p) => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: box.left + p.x * box.width / svg.viewBox.baseVal.width, y: box.top + p.y * box.height / svg.viewBox.baseVal.height }
  }, { x, y })
}
async function click(page: Page, x: number, y: number, shift = false) {
  const p = await point(page, x, y)
  if (shift) await page.keyboard.down('Shift')
  try { await page.mouse.click(p.x, p.y) } finally { if (shift) await page.keyboard.up('Shift') }
}
async function drag(page: Page, from: Point, to: Point, steps = 5) {
  const a = await point(page, ...from), b = await point(page, ...to)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps }); await page.mouse.up()
}

test('length selection retains vertex editing, keyboard and drag movement, and rise feedback', async ({ page }) => {
  await open(page)
  const route = (await annotations(page)).find(a => a.quantity?.itemId === 'cv')!
  const group = layer(page).locator(`g[data-annotation-id="${route.id}"]`)
  await expect(group.locator('.annotation-selection-path, .annotation-rise-mark')).toHaveCount(0)
  await click(page, 140, 120)
  await expect(group.locator('polyline.annotation-selection-path')).toHaveCount(1)
  await expect(group.locator('.annotation-selection')).toHaveCount(0)
  await expect(group.locator('.annotation-selection-path')).toHaveAttribute('points', await group.locator('.annotation-hit').getAttribute('points') as string)
  const rise = group.locator('[data-rise-index="0"]')
  await expect(rise).toHaveAttribute('x', '210'); await expect(rise).toHaveAttribute('y', '200')
  await expect(rise).toHaveText('↕1')
  // Read the existing layer's store through React solely for this new display API.
  // This avoids adding a test bridge to an out-of-scope application file.
  await layer(page).evaluate((el, id) => {
    type Fiber = { return?: Fiber; memoizedProps?: { store?: { setHighlightedRise(value: { annotationId: string; riseIndex: number }): void } } }
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    let fiber = key ? (el as unknown as Record<string, Fiber>)[key] : undefined
    while (fiber && !fiber.memoizedProps?.store) fiber = fiber.return
    if (!fiber?.memoizedProps?.store) throw Error('AnnotationLayer store unavailable')
    fiber.memoizedProps.store.setHighlightedRise({ annotationId: id, riseIndex: 0 })
  }, route.id)
  await expect(rise).toHaveClass(/annotation-rise-mark-highlighted/)
  await expect(group.locator('[data-rise-index="1"]')).not.toHaveClass(/annotation-rise-mark-highlighted/)
  await drag(page, [210, 200], [230, 220])
  await expect.poll(async () => (await annotations(page)).find(a => a.id === route.id)!.vertices![2].map(n => Math.round(n * 100) / 100)).toEqual([230, 220])
  await expect.poll(async () => [Number(await rise.getAttribute('x')), Number(await rise.getAttribute('y'))].map(n => Math.round(n * 100) / 100)).toEqual([230, 220])
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await annotations(page)).find(a => a.id === route.id)!.vertices![0][0]).toBeGreaterThan(70)
  const before = (await annotations(page)).find(a => a.id === route.id)!.vertices!
  const midpoint: Point = [(before[0][0] + before[1][0]) / 2, before[0][1]]
  await drag(page, midpoint, [midpoint[0] + 20, midpoint[1] + 20])
  const after = (await annotations(page)).find(a => a.id === route.id)!.vertices!
  after.forEach((p, i) => { expect(p[0]).toBeCloseTo(before[i][0] + 20); expect(p[1]).toBeCloseTo(before[i][1] + 20) })
})

test('area closes its edges, count keeps its rectangle, and multi-selection has one path per measurement', async ({ page }) => {
  await open(page)
  await click(page, 140, 280)
  await expect(layer(page).locator('polygon.annotation-selection-path')).toHaveCount(1)
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(0)
  const polygon = layer(page).locator('polygon.annotation-selection-path')
  await expect(polygon).toHaveAttribute('points', '70,280 210,280 210,360 70,360 70,280')
  await click(page, 140, 120, true)
  await expect(layer(page).locator('.annotation-selection-path')).toHaveCount(2)
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(0)
  await expect(layer(page).locator('[data-measure-vertex]')).toHaveCount(0)
  await click(page, 306, 296)
  await expect(layer(page).locator('.annotation-selection-path')).toHaveCount(0)
  await expect(layer(page).locator('rect.annotation-selection')).toHaveCount(1)
})

test('table navigation flashes the route without scaling; count still flashes a rectangle', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '集計表を開く', exact: true }).click()
  const table = page.getByRole('region', { name: '数量の集計表', exact: true })
  await table.getByLabel('集計表の種別', { exact: true }).selectOption('length')
  await table.locator('tr[data-fixture-id="cv"] button[data-column-key="0"]').click()
  const flash = page.getByTestId('quantity-pickup-flash')
  await expect(flash).toHaveJSProperty('tagName', 'polyline')
  await expect(flash).toHaveClass(/quantity-pickup-flash-path/)
  await expect(layer(page).locator('polyline.annotation-selection-path')).toHaveCount(1)
  expect(await flash.evaluate(el => getComputedStyle(el).animationName)).toBe('quantity-pickup-flash-path')
  expect(await flash.evaluate(el => getComputedStyle(el).transform)).toBe('none')
  await expect(flash).toHaveCount(0, { timeout: 2500 })
  await table.getByLabel('集計表の種別', { exact: true }).selectOption('area')
  await table.locator('tr[data-fixture-id="area"] button[data-column-key="0"]').click()
  await expect(flash).toHaveJSProperty('tagName', 'polygon')
  await table.getByLabel('集計表の種別', { exact: true }).selectOption('count')
  await table.locator('tr[data-fixture-id="led"] button[data-column-key="0"]').click()
  await expect(flash).toHaveJSProperty('tagName', 'rect')
})

test('1000-vertex selected route keeps shared geometry and records drag frame timings', async ({ page }) => {
  await open(page, 1000)
  await click(page, 140, 120.1)
  const path = layer(page).locator('polyline.annotation-selection-path')
  await expect(path).toHaveCount(1)
  expect((await path.getAttribute('points'))!.split(' ')).toHaveLength(1000)
  await expect(layer(page).locator('[data-measure-vertex]')).toHaveCount(1000)
  const route = (await annotations(page)).find(a => a.quantity?.itemId === 'cv')!
  const before = route.vertices![0]
  // Dense existing handles cover the whole hit stroke. Keep them drawn while
  // letting this performance probe drag the route rather than one vertex.
  await page.addStyleTag({ content: '.annotation-resize-handle { pointer-events: none; }' })
  await drag(page, [140, 120.1], [160, 140.1], 30)
  const moved = (await annotations(page)).find(a => a.id === route.id)!
  expect(moved.vertices![0][0]).toBeCloseTo(before[0] + 20)
  expect(moved.vertices![0][1]).toBeCloseTo(before[1] + 20)
  await expect(path).toHaveAttribute('points', await layer(page).locator(`g[data-annotation-id="${route.id}"] .annotation-hit`).getAttribute('points') as string)
  console.log('SPEC-07e 1000 vertices / zoom=1 / drag=30 steps:', await page.evaluate(() => window.__karu!.getFrameStats().drag))
  // Record the real browser timings for user trials; do not treat an unrun test as a performance result.
})
