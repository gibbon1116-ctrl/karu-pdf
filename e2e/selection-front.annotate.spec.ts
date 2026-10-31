import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { applyEdits, listAnnotations, type AnnotationEdit } from '../src/core/annotations'
import { nextCountStyle, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

// All PDFs remain in memory; this test never writes into work/ or other folders.
function blankPdf(fixtures: CountFixture[] = [], edits: AnnotationEdit[] = []) {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, fixtures)
    expect(applyEdits(doc, edits, {}).errors).toEqual([])
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
const layer = (page: Page) => page.getByTestId('annotation-layer-0')
const group = (page: Page, id: string) => layer(page).locator(`g[data-annotation-id="${id}"]`)
const editable = (page: Page) => page.evaluate(() => window.__karu!.getEditableAnnotations(0))
const selected = (page: Page) => page.evaluate(() => window.__karu!.getSelectedAnnotationIds())
const svgOrder = (page: Page) => layer(page).locator('g[data-annotation-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-annotation-id')))

async function open(page: Page, bytes = blankPdf()) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(b => window.__karu!.openBytes(b, '選択最前面.pdf'), bytes)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(layer(page)).toBeVisible()
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
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await point(page, ...from), b = await point(page, ...to)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up()
}
async function save(page: Page) {
  return page.evaluate(async () => {
    const bytes = await window.__karu!.saveToBytes()
    if (!bytes) throw new Error('保存データがありません')
    return [...bytes]
  })
}
function savedOrder(bytes: number[]) {
  const doc = new mupdf.PDFDocument(new Uint8Array(bytes))
  try { return listAnnotations(doc, 0).map(a => a.objNum) } finally { doc.destroy() }
}
async function settle(page: Page) {
  await page.waitForFunction(() => window.__karu!.isIdle() && window.__karu!.isSharp())
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(() => page.evaluate(async () => (await window.__karu!.getWorkerStats()).queueLength)).toBe(0)
}
const renders = (page: Page) => page.evaluate(async () => (await window.__karu!.getWorkerStats()).processedCount)
async function addItem(page: Page, code: string, name: string, length: boolean, color: string) {
  await page.getByTestId('fixture-panel').getByRole('button', { name: '項目を追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '項目を追加', exact: true })
  await dialog.getByLabel('名称', { exact: true }).fill(name)
  await dialog.getByLabel('略号', { exact: true }).fill(code)
  if (length) await dialog.getByRole('radio', { name: '長さ', exact: true }).check()
  await dialog.getByRole('button', { name: `色 ${color.toUpperCase()}`, exact: true }).click()
  await dialog.getByRole('button', { name: '追加する', exact: true }).click()
}

test('quantity routes temporarily move to the front, keep their colors and preserve PDF annotation order', async ({ page }) => {
  await open(page)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await addItem(page, 'CV', 'ケーブル', true, '#e60012')
  await addItem(page, 'PF28', '配管', true, '#0068b7')
  await addItem(page, 'LED', '個数', false, '#00a040')
  const panel = page.getByTestId('fixture-panel')
  await panel.getByRole('button', { name: 'CV ケーブル', exact: true }).click()
  await click(page, 70, 200)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 70, 200); await click(page, 300, 200); await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'PF28 配管', exact: true }).click()
  await click(page, 100, 203); await click(page, 330, 203); await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'LED 個数', exact: true }).click()
  await click(page, 50, 350)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 450, 450)
  await expect.poll(() => selected(page)).toEqual([])
  const createdIds = (await editable(page)).map(a => a.id)
  await expect.poll(() => svgOrder(page)).toEqual(createdIds)

  // Save before selecting, then recapture IDs (new object numbers can rename IDs).
  const beforeBytes = await save(page), beforeOrder = savedOrder(beforeBytes)
  expect(beforeOrder).toHaveLength(3)
  const [cv, pf, count] = await editable(page)
  await group(page, cv.id).evaluate(el => el.setAttribute('data-node-probe', 'preserved'))
  const color = await group(page, cv.id).locator('.measurement-shape polyline[stroke]').getAttribute('stroke')
  expect(color).not.toBe(await group(page, pf.id).locator('.measurement-shape polyline[stroke]').getAttribute('stroke'))
  await click(page, 80, 200)
  await expect.poll(() => selected(page)).toEqual([cv.id])
  await expect.poll(() => svgOrder(page)).toEqual([pf.id, count.id, cv.id])
  await expect(group(page, cv.id)).toHaveAttribute('data-node-probe', 'preserved')
  await expect(group(page, cv.id).locator('.annotation-selection-halo [stroke="#fff"], .annotation-selection-halo[stroke="#fff"]')).toHaveCount(1)
  await expect(group(page, cv.id).locator('.measurement-shape polyline[stroke]')).toHaveAttribute('stroke', color!)
  expect((await editable(page)).map(a => a.id)).toEqual([cv.id, pf.id, count.id])
  await page.keyboard.press('Escape')
  await expect.poll(() => selected(page)).toEqual([])
  await expect.poll(() => svgOrder(page)).toEqual([cv.id, pf.id, count.id])
  await expect(group(page, cv.id)).toHaveAttribute('data-node-probe', 'preserved')

  await click(page, 80, 200); await click(page, 320, 203, true)
  await expect.poll(async () => (await selected(page)).sort()).toEqual([cv.id, pf.id].sort())
  await expect.poll(() => svgOrder(page)).toEqual([count.id, cv.id, pf.id])
  expect(savedOrder(await save(page))).toEqual(beforeOrder)
})

test('selecting a reopened saved line overlays its stroke without rendering the PDF page again', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '図形▼', exact: true }).click()
  await page.getByRole('menu').getByText('線', { exact: true }).click()
  await drag(page, [80, 220], [300, 220])
  await expect.poll(async () => (await editable(page)).filter(a => a.kind === 'line').length).toBe(1)
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 450, 450)
  const bytes = await save(page)
  await page.evaluate(b => window.__karu!.openBytes(b, '線再読込.pdf'), bytes)
  await expect.poll(async () => (await editable(page)).length).toBe(1)
  const line = (await editable(page))[0]
  expect(line.objNum).not.toBeNull()
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await click(page, 450, 450)
  await settle(page)
  await expect(group(page, line.id).locator('line.annotation-line')).toHaveCount(0)
  const renderCount = await renders(page)
  await click(page, 160, 220)
  await expect.poll(() => selected(page)).toEqual([line.id])
  await expect(group(page, line.id).locator('line.annotation-line')).toHaveCount(1)
  await expect(group(page, line.id).locator('line.annotation-line')).toHaveAttribute('stroke', `rgb(${line.color.map(c => c * 255).join(' ')})`)
  await expect(group(page, line.id).locator('.annotation-selection-halo')).toHaveCount(1)
  await settle(page)
  expect(await renders(page)).toBe(renderCount)

  await page.keyboard.press('Escape')
  await expect.poll(() => selected(page)).toEqual([])
  await expect(group(page, line.id).locator('line.annotation-line')).toHaveCount(0)
  await settle(page)
  expect(await renders(page)).toBe(renderCount)

  // Deferring touch on selection must still allow the existing drag/edit flow.
  await drag(page, [160, 220], [180, 240])
  await expect.poll(async () => (await editable(page))[0].line?.flat().map(n => Math.round(n * 100) / 100)).toEqual([100, 240, 320, 240])
})

test('semi-transparent saved lines and highlighter strokes get a hollow halo without duplicate color', async ({ page }) => {
  await open(page, blankPdf([], [
    { kind: 'createLine', pageIndex: 0, line: [[80, 180], [300, 180]], color: [1, 0, 0], borderWidth: 2, lineEnding: { start: 'None', end: 'None' }, opacity: .5 },
    { kind: 'createInk', pageIndex: 0, inkList: [[[80, 260], [300, 260]]], color: [1, 1, 0], borderWidth: 10, opacity: 1, inkKind: 'highlight' },
  ]))
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect.poll(async () => (await editable(page)).length).toBe(2)
  const annotations = await editable(page)
  await settle(page)
  const renderCount = await renders(page)
  for (const [i, y] of [180, 260].entries()) {
    await click(page, 160, y)
    await expect.poll(() => selected(page)).toEqual([annotations[i].id])
    const g = group(page, annotations[i].id)
    await expect(g.locator('.annotation-line, .annotation-ink')).toHaveCount(0)
    await expect(g.locator('.annotation-selection-halo mask')).toHaveCount(1)
    await expect(g.locator('.annotation-selection-halo > g[stroke="#fff"]')).toHaveAttribute('opacity', '0.85')
    await page.keyboard.press('Escape')
    await expect(g.locator('.annotation-selection-halo')).toHaveCount(0)
  }
  await settle(page)
  expect(await renders(page)).toBe(renderCount)
})

test('compact counts render a single selected marker after all batches and selected batches after unselected batches', async ({ page }) => {
  const fixture: CountFixture = { id: 'led', name: '個数', code: '', category: '試験', order: 0, style: { ...nextCountStyle([]), showCode: false } }
  const edits: AnnotationEdit[] = Array.from({ length: 501 }, (_, i) => {
    const x = i === 0 ? 80 : i === 1 ? 100 : 250 + i % 20 * 8
    const y = i < 2 ? 180 : 280 + Math.floor((i - 2) / 20) * 6
    // Metadata is enough for the SVG fixture renderer; no text/font AP is needed.
    return { kind: 'createSymbol', pageIndex: 0, rect: [x - 4, y - 4, x + 4, y + 4], color: fixture.style.color, symbol: 'circle', count: { version: 2, id: `mark-${i}`, fixtureId: fixture.id } }
  })
  await open(page, blankPdf([fixture], edits))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByRole('button', { name: '選択', exact: true }).click()
  await expect.poll(async () => (await editable(page)).length).toBe(501)
  await expect(layer(page).getByTestId('count-batch')).toHaveCount(1)
  const [first, second] = await editable(page)
  await click(page, 80, 180)
  await expect.poll(() => selected(page)).toEqual([first.id])
  await expect.poll(() => layer(page).evaluate((svg, id) => {
    const children = [...svg.children]
    return children.indexOf(svg.querySelector(`g[data-annotation-id="${id}"]`)!) > children.findLastIndex(el => el.getAttribute('data-testid') === 'count-batch')
  }, first.id)).toBe(true)
  await click(page, 100, 180, true)
  await expect.poll(async () => (await selected(page)).sort()).toEqual([first.id, second.id].sort())
  await expect(layer(page).getByTestId('count-batch')).toHaveCount(2)
  expect(await layer(page).getByTestId('count-batch').evaluateAll(groups => groups.map(g => g.getAttribute('data-selected')))).toEqual(['false', 'true'])
  await page.keyboard.press('Escape')
  await expect(layer(page).getByTestId('count-batch')).toHaveCount(1)
  await expect(layer(page).locator('g[data-annotation-id]')).toHaveCount(0)
})
