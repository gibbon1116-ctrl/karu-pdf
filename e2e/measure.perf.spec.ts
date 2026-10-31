import path from 'node:path'
import { expect, test } from '@playwright/test'

test('A1を400%で面積20点のフレームp95を一度計測する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible({ timeout: 180000 })
  await page.evaluate(() => window.__karu!.scrollToPage(5))
  await expect(page.getByTestId('annotation-layer-5')).toBeVisible()
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  await page.getByRole('button', { name: '決定', exact: true }).click()
  await page.evaluate(() => window.__karu!.setZoom(4))
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__karu!.scrollToPage(5))
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp()), { timeout: 180000 }).toBe(true)
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitemcheckbox', { name: '面積', exact: false }).click()
  const box = await page.getByTestId('viewer').boundingBox()
  if (!box) throw Error('表示領域がありません')
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.evaluate(() => {
    const w = window as Window & { __measureFrames?: { samples: number[]; frame: number; last: number } }
    const state = w.__measureFrames = { samples: [] as number[], frame: 0, last: 0 }
    const tick = (t: number) => { if (state.last) state.samples.push(t - state.last); state.last = t; state.frame = requestAnimationFrame(tick) }
    state.frame = requestAnimationFrame(tick)
  })
  for (let i = 0; i < 20; i++) {
    const angle = 2 * Math.PI * i / 20, x = center.x + Math.cos(angle) * 140, y = center.y + Math.sin(angle) * 140
    await page.mouse.move(x, y, { steps: 3 }); await page.mouse.click(x, y); await page.waitForTimeout(30)
  }
  const result = await page.evaluate(() => {
    const w = window as Window & { __measureFrames?: { samples: number[]; frame: number } }, state = w.__measureFrames!
    cancelAnimationFrame(state.frame); delete w.__measureFrames
    const samples = state.samples.sort((a, b) => a - b)
    return { samples: samples.length, p95: samples[Math.ceil(samples.length * .95) - 1], max: samples.at(-1) }
  })
  console.log('MEASURE_A1_400_20_POINTS', JSON.stringify(result))
  await page.keyboard.press('Enter')
  const area = await page.evaluate(() => window.__karu!.getEditableAnnotations(5).find(a => a.kind === 'area'))
  expect(area?.vertices).toHaveLength(20)
  expect(result.samples).toBeGreaterThan(20); expect(result.p95).toBeLessThanOrEqual(20)
})
