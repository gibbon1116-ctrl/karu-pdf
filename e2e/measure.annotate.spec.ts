import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
}
async function screenPoint(page: Page, x: number, y: number) {
  return page.getByTestId('annotation-layer-0').evaluate((element, p) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return { x: box.left + p.x * box.width / view.width, y: box.top + p.y * box.height / view.height }
  }, { x, y })
}
async function clickPoint(page: Page, x: number, y: number) { const p = await screenPoint(page, x, y); await page.mouse.click(p.x, p.y) }
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitemcheckbox', { name, exact: false }).click()
}
async function setScale(page: Page) {
  await page.keyboard.press('k')
  await clickPoint(page, 100, 200)
  const dialog = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(dialog.getByText('このページの縮尺を決めてください')).toBeVisible()
  await dialog.getByLabel('縮尺の分母').fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}
async function distance(page: Page) {
  const a = await screenPoint(page, 100, 220), b = await screenPoint(page, 172, 220)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
}
test('縮尺未設定から72ptの距離を測り、書き込みの一覧に実寸を表示する', async ({ page }) => {
  await open(page); await setScale(page); await distance(page)
  await expect(page.locator('.status-scale')).toHaveText('縮尺 1/100')
  await expect(page.getByRole('button', { name: '距離', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: '書き込み' }).click()
  await expect(page.locator('.annotation-body').filter({ hasText: '2,540 mm' })).toHaveCount(1)
})
test('頂点の移動で5,080mmへ再計算しUndoで2,540mmへ戻す', async ({ page }) => {
  await open(page); await setScale(page); await distance(page)
  const handle = page.getByTestId('measure-handle-1'), box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const target = await screenPoint(page, 244, 220)
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 5 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('5,080 mm')
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
})
test('寸法をなぞり3600mmから約1/141.73を設定する', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('図面の寸法をなぞって合わせる').check()
  await dialog.getByRole('button', { name: 'なぞる', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await clickPoint(page, 100, 220); await clickPoint(page, 172, 220)
  await expect(dialog).toBeVisible(); await dialog.getByLabel('実際の長さ').fill('3600')
  await expect(dialog.getByTestId('calibration-ratio')).toHaveText('約 1/141.73 に相当')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await expect(page.locator('.status-scale')).toHaveText('約 1/141.73')
  await page.keyboard.press('k')
  const a = await screenPoint(page, 100, 220), b = await screenPoint(page, 172, 220)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('3,600 mm')
})
test('72pt四方の面積は手計算どおり6.45m²になる', async ({ page }) => {
  await open(page); await setScale(page); await choose(page, '面積')
  for (const [x, y] of [[100, 300], [172, 300], [172, 372], [100, 372]]) await clickPoint(page, x, y)
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'area')?.text)).toBe('6.45 m²')
  await expect(page.locator('.measurement-label')).toHaveText('6.45 m²')
  // The first vertex must use the same preceding vertex during preview and release.
  const start = await screenPoint(page, 100, 300), end = await screenPoint(page, 120, 280)
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Shift')
  await page.mouse.move(end.x, end.y); await page.mouse.up(); await page.keyboard.up('Shift')
  const moved = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'area')!.vertices![0])
  expect(moved[0]).toBeCloseTo(100, 3)
  expect(moved[1]).toBeCloseTo(372 - Math.hypot(20, 92), 3)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.measurement-label')).toHaveText('6.45 m²')
})
test('折れ線のBackspaceとEscで点の削除・取消・選択への復帰ができる', async ({ page }) => {
  await open(page); await setScale(page); await choose(page, '連続した長さ')
  for (const [x, y] of [[100, 250], [172, 250], [172, 322]]) await clickPoint(page, x, y)
  await page.keyboard.press('Backspace')
  const draft = (await page.locator('.measurement-draft polyline').getAttribute('points'))!.split(' ').map(p => p.split(',').map(Number))
  expect(draft).toHaveLength(2)
  for (let i = 0; i < 2; i++) { expect(draft[i][0]).toBeCloseTo([100, 172][i], 3); expect(draft[i][1]).toBeCloseTo(250, 3) }
  await page.keyboard.press('Escape'); await expect(page.locator('.measurement-draft polyline')).toHaveCount(0)
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).filter(a => a.measure).length)).toBe(0)
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
test('縮尺変更の値保持・明示再計算・Undoが動作する', async ({ page }) => {
  await open(page); await setScale(page); await distance(page)
  await page.locator('.status-scale').click(); await page.getByLabel('縮尺の分母').fill('200'); await page.getByRole('button', { name: '決定', exact: true }).click()
  await page.getByRole('button', { name: 'そのまま', exact: true }).click()
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
  await page.locator('.status-scale').click(); await page.getByRole('button', { name: '決定', exact: true }).click(); await page.getByRole('button', { name: '計算し直す', exact: true }).click()
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('5,080 mm')
  await page.keyboard.press('Control+z')
  expect(await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
})
test('保存して再度開いても縮尺と実寸と頂点が戻る', async ({ page }) => {
  await open(page); await setScale(page); await distance(page)
  await page.evaluate(async () => { const bytes = await window.__karu!.saveToBytes(); if (!bytes) throw Error('保存失敗'); await window.__karu!.openBytes(bytes, '計測の保存結果.pdf') })
  await expect(page.locator('.status-scale')).toHaveText('縮尺 1/100')
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance')?.text)).toBe('2,540 mm')
  const a = await page.evaluate(() => window.__karu!.getEditableAnnotations(0).find(a => a.kind === 'distance'))
  expect(a?.vertices).toHaveLength(2)
  for (let i = 0; i < 2; i++) { expect(a!.vertices![i][0]).toBeCloseTo([100, 172][i], 3); expect(a!.vertices![i][1]).toBeCloseTo(220, 3) }
})
