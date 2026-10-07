import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { readPageScale, readScaleRegions } from '../src/core/measure'
function blankPdf() {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try { doc.insertPage(-1, ref); const bytes = doc.saveToBuffer('compress'); try { return [...bytes.asUint8Array()] } finally { bytes.destroy() } }
  finally { ref.destroy(); doc.destroy() }
}
async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0'); await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '縮尺範囲.pdf'), blankPdf())
  await page.evaluate(() => window.__karu!.setZoom(1)); await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}
async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: box.left + p.x * box.width / svg.viewBox.baseVal.width, y: box.top + p.y * box.height / svg.viewBox.baseVal.height }
  }, { x, y })
}
async function click(page: Page, x: number, y: number) { const p = await point(page, x, y); await page.mouse.click(p.x, p.y) }
async function drag(page: Page, a: [number, number], b: [number, number]) {
  const from = await point(page, ...a), to = await point(page, ...b)
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up()
}
async function pickup(page: Page, a: [number, number], b: [number, number]) { await click(page, ...a); await click(page, ...b); await page.keyboard.press('Enter') }
async function cable(page: Page) {
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '標準マスタから追加', exact: true }).click()
  await page.getByRole('tab', { name: '分野の一式', exact: true }).click()
  await page.getByRole('dialog', { name: '標準マスタから追加' }).getByRole('button', { name: '選んだ項目を追加', exact: true }).click()
  await page.getByRole('button', { name: 'CV ケーブル（CV）', exact: true }).click()
}
const pageDialog = (page: Page) => page.getByRole('dialog', { name: '縮尺の設定（1 ページ）', exact: true })
const regionDialog = (page: Page) => page.getByRole('dialog', { name: '縮尺の範囲の設定（1 ページ）', exact: true })
async function pageScale(page: Page, denominator: number, recalculate = false) {
  if (await page.locator('.status-scale').count()) await page.locator('.status-scale').click()
  else { await page.getByRole('button', { name: '計測▼', exact: true }).click(); await page.getByRole('menuitem', { name: /^縮尺の設定/ }).click() }
  const dialog = pageDialog(page); await dialog.getByLabel('縮尺の分母').fill(String(denominator))
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  if (recalculate) await dialog.getByRole('button', { name: '計算し直す', exact: true }).click()
}
async function addRegion(page: Page) {
  await page.getByRole('button', { name: '計測▼', exact: true }).click()
  await page.getByRole('menuitem', { name: /^縮尺の範囲を追加/ }).click()
  await expect(page.getByText('縮尺の範囲を四角で囲んでください（Esc でやめる）', { exact: true })).toBeVisible()
  await drag(page, [250, 250], [450, 450])
  const dialog = regionDialog(page); await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: '同じ大きさのすべてのページ' })).toHaveCount(0)
  await dialog.getByLabel('縮尺の分母').fill('20'); await dialog.getByLabel('範囲の名前（任意）').fill('A部詳細')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
}
const labels = (page: Page) => page.locator('.measurement-shape .measurement-label')
const hasValue = async (page: Page, value: string) => { await expect(labels(page).filter({ hasText: new RegExp('^CV ' + value.replace('.', '\\.') + ' m$') })).toHaveCount(1) }

test('mixed page scales: add, edit, undo, page default, crossing and PDF persistence', async ({ page }) => {
  await open(page); await pageScale(page, 100); await cable(page)
  await pickup(page, [100, 100], [172, 100]); await hasValue(page, '2.54')
  await addRegion(page)
  await expect(page.locator('.status-scale')).toHaveText('縮尺 1/100（範囲 1）')
  await expect(page.locator('.scale-region-label')).toHaveText('A部詳細 1/20')
  await pickup(page, [300, 300], [372, 300]); await hasValue(page, '0.51'); await hasValue(page, '2.54')
  await page.getByRole('button', { name: '選択', exact: true }).click(); await expect(page.locator('.scale-region-label')).toHaveCount(0)
  await page.getByRole('button', { name: '数量拾い', exact: true }).click(); await expect(page.locator('.scale-region-label')).toHaveText('A部詳細 1/20')
  await page.locator('.status-scale').click()
  await pageDialog(page).getByRole('button', { name: '縮尺を変える', exact: true }).click()
  await regionDialog(page).getByLabel('縮尺の分母').fill('10')
  await regionDialog(page).getByRole('button', { name: '決定', exact: true }).click()
  await regionDialog(page).getByRole('button', { name: '計算し直す', exact: true }).click()
  await hasValue(page, '0.25'); await hasValue(page, '2.54')
  await page.keyboard.press('Control+z'); await hasValue(page, '0.51'); await expect(page.locator('.scale-region-label')).toHaveText('A部詳細 1/20')
  await pageScale(page, 200, true); await hasValue(page, '5.08'); await hasValue(page, '0.51')
  await pickup(page, [200, 300], [300, 300])
  await expect(page.getByRole('status').filter({ hasText: '縮尺の範囲をまたいでいます' })).toContainText('始点の縮尺（1/200）で計算しました')
  await hasValue(page, '7.06')
  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  const doc = new mupdf.PDFDocument(new Uint8Array(saved)), pdfPage = doc.loadPage(0)
  try {
    expect(readPageScale(pdfPage)?.denominator).toBe(200)
    const regions = readScaleRegions(pdfPage)
    expect(regions).toHaveLength(1); expect(regions[0].label).toBe('A部詳細'); expect(regions[0].scale.denominator).toBe(20)
    regions[0].rect.forEach((v, i) => expect(v).toBeCloseTo([250, 250, 450, 450][i], 4))
    const obj = pdfPage.getObject(), vp = obj.get('VP'); let defaults = 0, regionCount = 0
    try {
      for (let i = 0; i < vp.length; i++) {
        const viewport = vp.get(i), custom = viewport.get('KaruScale'), region = viewport.get('KaruScaleRegion'), measure = viewport.get('Measure')
        try { if (custom.isString()) defaults++; if (region.isString()) { regionCount++; expect(measure.isNull()).toBe(true) } }
        finally { measure.destroy(); region.destroy(); custom.destroy(); viewport.destroy() }
      }
      expect(defaults).toBe(1); expect(regionCount).toBe(1)
    } finally { vp.destroy(); obj.destroy() }
  } finally { pdfPage.destroy(); doc.destroy() }
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '範囲を再読込.pdf'), saved)
  await expect(page.locator('.status-scale')).toHaveText('縮尺 1/200（範囲 1）')
  await page.getByRole('button', { name: '数量拾い', exact: true }).click()
  await hasValue(page, '5.08'); await hasValue(page, '0.51'); await hasValue(page, '7.06')
  await expect(page.locator('.scale-region-label')).toHaveText('A部詳細 1/20')
})

test('region-only scale, drawing cancellation, minimum size, and delete without recalculation', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '計測▼', exact: true }).click(); await page.getByRole('menuitem', { name: /^縮尺の範囲を追加/ }).click()
  await drag(page, [250, 250], [255, 255]); await expect(regionDialog(page)).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: '10pt以上' })).toBeVisible()
  await page.keyboard.press('Escape'); await expect(page.getByText('縮尺の範囲を四角で囲んでください（Esc でやめる）', { exact: true })).toHaveCount(0)
  await addRegion(page); await expect(page.locator('.status-scale')).toHaveText('縮尺の範囲 1')
  await cable(page); await pickup(page, [300, 300], [372, 300]); await hasValue(page, '0.51')
  await page.locator('.status-scale').click(); await pageDialog(page).getByRole('button', { name: '削除', exact: true }).click()
  await pageDialog(page).getByRole('button', { name: 'そのまま', exact: true }).click()
  await pageDialog(page).getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(page.locator('.scale-region-label')).toHaveCount(0); await hasValue(page, '0.51')
  await click(page, 100, 100); await expect(pageDialog(page)).toBeVisible()
})

test('ordinary page without regions retains the quantity length scale setup flow', async ({ page }) => {
  await open(page); await cable(page); await click(page, 100, 100)
  await expect(pageDialog(page)).toBeVisible(); await pageDialog(page).getByLabel('縮尺の分母').fill('100')
  await pageDialog(page).getByRole('button', { name: '決定', exact: true }).click()
  await pickup(page, [100, 100], [172, 100]); await hasValue(page, '2.54')
  await expect(page.locator('.scale-region-label')).toHaveCount(0)
})
