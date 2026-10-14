import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

// SPEC-R5c: 経路の頂点に個数の項目（防火区画貫通処理など）を足して計上する。

const style = { shape: 'circle', fill: 'none', size: 10, opacity: 1, showCode: true } as const
const fixtures: CountFixture[] = [
  { id: 'cable', name: 'ケーブル', code: 'CV', category: '電線・ケーブル', order: 0,
    kind: 'length', method: 'polyline', style: { ...style, color: [0, 0, 1] } },
  { id: 'switch', name: 'スイッチ', code: 'S', category: '配線器具', order: 1,
    style: { ...style, color: [0, .5, 0] } },
  { id: 'fire', name: '防火区画貫通処理', code: 'FP', category: '防火区画貫通処理', order: 2,
    unit: 'か所', style: { ...style, color: [1, 0, 0] } },
]

function pdf(items: CountFixture[] = fixtures): number[] {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, items)
    const b = doc.saveToBuffer('compress')
    try { return [...b.asUint8Array()] } finally { b.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
async function point(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((el, p) => {
    const svg = el as SVGSVGElement, box = svg.getBoundingClientRect()
    return { x: box.left + p.x * box.width / svg.viewBox.baseVal.width, y: box.top + p.y * box.height / svg.viewBox.baseVal.height }
  }, { x, y })
}
async function click(page: Page, x: number, y: number) { const p = await point(page, x, y); await page.mouse.click(p.x, p.y) }
const total = (page: Page, name: string) => page.getByTestId('fixture-panel')
  .getByRole('button', { name, exact: true }).locator('.fixture-row-count').first()

test('頂点の個数の同名候補を摘要で区別でき、名称は各候補に1回だけ出る', async ({ page }) => {
  const name = '機器用基礎'
  const items: CountFixture[] = [
    ...fixtures,
    {
      id: 'base-small', name, code: '', category: '機器用基礎', order: 3,
      unit: '基', summary: [{ label: '寸法', value: '600×600×150' }],
      style: { ...style, color: [0.5, 0, 0.5] },
    },
    {
      id: 'base-large', name, code: '', category: '機器用基礎', order: 4,
      unit: '基', summary: [{ label: '寸法', value: '900×900×150' }],
      style: { ...style, color: [0.5, 0.5, 0] },
    },
  ]

  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '同名の頂点候補.pdf'), pdf(items))
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel')
    .getByRole('button', { name: 'CV ケーブル', exact: true }).click()

  await click(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(scale).toBeVisible()
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 100, 220)
  await click(page, 172, 220)
  await click(page, 172, 300)
  await page.keyboard.press('Enter')
  await expect(total(page, 'CV ケーブル')).not.toHaveText('0.00')

  const panel = page.getByTestId('format-panel')
  await panel.getByRole('button', {
    name: '＋ 頂点に個数の項目を足す', exact: true,
  }).click()

  const select = panel.getByLabel('頂点の個数1の項目', { exact: true })
  const smallOption = select.locator('option[value="base-small"]')
  const largeOption = select.locator('option[value="base-large"]')
  await expect(smallOption).toHaveText('機器用基礎 （寸法 600×600×150）')
  await expect(largeOption).toHaveText('機器用基礎 （寸法 900×900×150）')

  const smallText = await smallOption.textContent()
  const largeText = await largeOption.textContent()
  expect(smallText).not.toBe(largeText)
  for (const text of [smallText, largeText]) {
    expect(text).not.toBeNull()
    expect(text!.split(name).length - 1).toBe(1)
  }

  await select.selectOption({ label: '機器用基礎 （寸法 900×900×150）' })
  await expect(select).toHaveValue('base-large')
  await expect(panel.locator('.route-point-row > small'))
    .toHaveText('機器用基礎 （寸法 900×900×150） 1基')

  await select.selectOption({ label: '機器用基礎 （寸法 600×600×150）' })
  await expect(select).toHaveValue('base-small')
  await expect(panel.locator('.route-point-row > small'))
    .toHaveText('機器用基礎 （寸法 600×600×150） 1基')
})

test('経路の頂点に防火区画貫通処理を足すと個数に入り、保存・Undo で保たれる', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '頂点の個数.pdf'), pdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', { name: 'CV ケーブル', exact: true }).click()

  await click(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(scale).toBeVisible()
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 100, 220); await click(page, 172, 220); await click(page, 172, 300); await page.keyboard.press('Enter')
  await expect(total(page, 'CV ケーブル')).not.toHaveText('0.00')

  const panel = page.getByTestId('format-panel')
  await panel.getByRole('button', { name: '＋ 頂点に個数の項目を足す', exact: true }).click()
  // 防火区画貫通を含む項目が先頭に選ばれ、まだ使っていない中間の頂点（頂点2）に入る。
  await expect(panel.getByLabel('頂点の個数1の項目', { exact: true })).toHaveValue('fire')
  await expect(panel.getByLabel('頂点の個数1の位置', { exact: true })).toHaveValue('1')
  await expect(total(page, 'FP 防火区画貫通処理')).toHaveText('1')
  await expect(page.locator('.annotation-point-mark')).toHaveText('◆FP')

  await panel.getByRole('button', { name: '頂点の個数1の数を増やす', exact: true }).click()
  await expect(total(page, 'FP 防火区画貫通処理')).toHaveText('2')
  await expect(page.locator('.annotation-point-mark')).toHaveText('◆FP×2')

  // 別の個数の項目も足せる。
  await panel.getByRole('button', { name: '＋ 頂点に個数の項目を足す', exact: true }).click()
  await panel.getByLabel('頂点の個数2の項目', { exact: true }).selectOption('switch')
  await expect(total(page, 'S スイッチ')).toHaveText('1')

  // 足した行は防火区画貫通処理で入り（3）、項目の変更でスイッチになった（2・1）。Undo は1手ずつ戻る。
  await page.keyboard.press('Control+z')
  await expect(total(page, 'S スイッチ')).toHaveText('0')
  await expect(total(page, 'FP 防火区画貫通処理')).toHaveText('3')
  await page.keyboard.press('Control+z')
  await expect(total(page, 'FP 防火区画貫通処理')).toHaveText('2')
  await expect(panel.getByLabel('頂点の個数2の項目', { exact: true })).toHaveCount(0)

  const saved = await page.evaluate(async () => [...(await window.__karu!.saveToBytes())!])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '再読込.pdf'), saved)
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(total(page, 'FP 防火区画貫通処理')).toHaveText('2')
  await expect(page.locator('.annotation-point-mark')).toHaveText('◆FP×2')
})
