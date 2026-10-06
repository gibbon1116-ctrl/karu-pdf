import { expect, test, type Page } from '@playwright/test'
import { snapPdf } from './snapFixtures'

async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, b = svg.getBoundingClientRect(), v = svg.viewBox.baseVal
    return { x: b.left + p.x * b.width / v.width, y: b.top + p.y * b.height / v.height }
  }, { x, y })
}
async function drag(page: Page, a: [number, number], b: [number, number]) {
  const start = await point(page, ...a), end = await point(page, ...b)
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up()
}
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'snap.pdf'), snapPdf())
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  await page.getByLabel('縮尺の分母').fill('100'); await page.getByRole('button', { name: '決定', exact: true }).click()
  await page.keyboard.press('k')
}
async function enable(page: Page) {
  await page.getByTestId('snap-toggle').click()
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true')
}

test('オンの距離計測は既存の頂点へ吸い付き、Shift の拘束も守る', async ({ page }) => {
  await open(page); await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'false'); await drag(page, [100, 200], [172, 200])
  const original = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).at(-1)!.vertices)
  await enable(page)
  await drag(page, [102, 203], [170, 197])
  let a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).at(-1))
  expect(a?.vertices).toEqual(original); expect(a?.text).toBe('2,540 mm')
  await page.keyboard.down('Shift'); await drag(page, [100, 200], [170, 202]); await page.keyboard.up('Shift')
  a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).at(-1))
  expect(a?.vertices).toEqual(original)
})
for (const mode of ['off', 'Alt']) test(`${mode}では吸い付かない`, async ({ page }) => {
  await open(page); await drag(page, [100, 200], [172, 200])
  if (mode === 'Alt') { await enable(page); await page.keyboard.down('Alt') }
  await drag(page, [102, 203], [170, 197])
  if (mode === 'Alt') await page.keyboard.up('Alt')
  const a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).at(-1))
  for (const [i, p] of [[102, 203], [170, 197]].entries()) for (let c = 0; c < 2; c++) expect(a!.vertices![i][c]).toBeCloseTo(p[c], 3)
})
test('既存の計測の頂点を図面の端点より優先し、通常の図形では無効', async ({ page }) => {
  await open(page); await drag(page, [103, 204], [140, 240]); await enable(page)
  await drag(page, [101, 202], [160, 260])
  const a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).at(-1))
  expect(a!.vertices![0][0]).toBeCloseTo(103, 3); expect(a!.vertices![0][1]).toBeCloseTo(204, 3)
  await page.keyboard.press('l'); await expect(page.getByTestId('snap-toggle')).toBeDisabled()
  await page.reload(); await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true')
})
test('PDF の線には吸い付かず、頂点の四角は Alt で即座に消える', async ({ page }) => {
  await open(page); await drag(page, [100, 200], [172, 200]); await enable(page)
  let p = await point(page, 130, 202); await page.mouse.move(p.x, p.y)
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('display', 'none')
  p = await point(page, 301, 251); await page.mouse.move(p.x, p.y)
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('display', 'none')
  p = await point(page, 102, 203); await page.mouse.move(p.x, p.y)
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('data-kind', 'vertex')
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('display', '')
  await page.keyboard.down('Alt')
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('display', 'none')
  await page.keyboard.up('Alt')
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('display', '')
  await page.mouse.move(5, 5)
  await expect(page.getByTestId('snap-marker-0')).toHaveAttribute('display', 'none')
})

test('既存の数量拾いの頂点へ距離計測が吸い付く', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await page.getByRole('button', { name: '見本から追加', exact: true }).click()
  await page.getByRole('dialog', { name: '見本から追加' }).getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await page.getByRole('button', { name: 'CV ケーブル（CV）', exact: true }).click()
  for (const [x, y] of [[103, 204], [140, 240]]) { const p = await point(page, x, y); await page.mouse.click(p.x, p.y) }
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).some(a => !!a.quantity))).toBe(true)
  await page.keyboard.press('k'); await enable(page)
  await drag(page, [101, 202], [160, 260])
  const a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).at(-1))
  expect(a!.vertices![0][0]).toBeCloseTo(103, 3); expect(a!.vertices![0][1]).toBeCloseTo(204, 3)
})

test('縮尺をなぞるときも頂点へ吸い付き、通常の図形から利用できる', async ({ page }) => {
  await open(page); await drag(page, [100, 200], [172, 200]); await enable(page)
  await page.keyboard.press('l'); await expect(page.getByTestId('snap-toggle')).toBeDisabled()
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  await page.getByLabel('図面の寸法をなぞって合わせる').check()
  await page.getByRole('button', { name: 'なぞる', exact: true }).click()
  await expect(page.getByTestId('snap-toggle')).toBeEnabled()
  await drag(page, [102, 203], [170, 197])
  await page.getByLabel('実際の長さ').fill('3600')
  await expect(page.getByTestId('calibration-ratio')).toHaveText('約 1/141.73 に相当')
})
