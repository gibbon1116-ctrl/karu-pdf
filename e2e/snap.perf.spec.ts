import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page, file: string, index: number) {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve(file))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible({ timeout: 180000 })
  await page.evaluate(i => window.__karu!.scrollToPage(i), index)
  await expect(page.getByTestId(`annotation-layer-${index}`)).toBeVisible()
}
async function frames(page: Page, index: number, mode: string) {
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitem', { name: '縮尺の設定…', exact: false }).click()
  await page.getByRole('button', { name: '決定', exact: true }).click()
  await page.evaluate(i => window.__karu!.seedSnapPerfVertices(i), index)
  await page.evaluate(() => window.__karu!.setZoom(4)); await page.waitForTimeout(400)
  await page.evaluate(i => window.__karu!.scrollToPage(i), index)
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp()), { timeout: 180000 }).toBe(true)
  await page.getByRole('button', { name: '計測▼' }).click(); await page.getByRole('menuitemcheckbox', { name: '面積', exact: false }).click()
  if (mode !== 'off') {
    await page.getByTestId('snap-toggle').click()
  }
  await page.evaluate(i => window.__karu!.scrollToPage(i), index)
  await page.waitForTimeout(400)
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp()), { timeout: 180000 }).toBe(true)
  const box = await page.getByTestId('viewer').boundingBox()
  if (!box) throw Error('表示領域がありません')
  const target = await page.getByTestId(`annotation-layer-${index}`).boundingBox()
  if (!target) throw Error('図面がありません')
  const left = Math.max(box.x, target.x), top = Math.max(box.y, target.y), right = Math.min(box.x + box.width, target.x + target.width), bottom = Math.min(box.y + box.height, target.y + target.height)
  expect(Math.min(right - left, bottom - top)).toBeGreaterThan(300)
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 }
  await page.evaluate(() => {
    const w = window as Window & { __snapFrames?: { samples: number[]; frame: number; last: number } }
    const state = w.__snapFrames = { samples: [] as number[], frame: 0, last: 0 }
    const tick = (t: number) => { if (state.last) state.samples.push(t - state.last); state.last = t; state.frame = requestAnimationFrame(tick) }
    state.frame = requestAnimationFrame(tick)
  })
  for (let i = 0; i < 20; i++) {
    const angle = 2 * Math.PI * i / 20, x = center.x + Math.cos(angle) * 140, y = center.y + Math.sin(angle) * 140
    await page.mouse.move(x, y, { steps: 3 }); await page.mouse.click(x, y); await page.waitForTimeout(30)
  }
  const result = await page.evaluate(() => {
    const w = window as Window & { __snapFrames?: { samples: number[]; frame: number } }, state = w.__snapFrames!
    cancelAnimationFrame(state.frame); delete w.__snapFrames
    const samples = state.samples.sort((a, b) => a - b)
    return { samples: samples.length, p95: samples[Math.ceil(samples.length * .95) - 1], max: samples.at(-1) }
  })
  await page.keyboard.press('Enter')
  expect(await page.evaluate(i => window.__karu!.getEditableAnnotations(i).find(a => a.kind === 'area')?.vertices?.length, index)).toBe(20)
  return result
}

test('A1・400%・20点をオフと採用方式で一度ずつ測定', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('karu-pdf:snap') } catch {} })
  const results = []
  for (const mode of ['off', 'A']) {
    await open(page, 'test-data/heavy-300p.pdf', 5)
    if (mode === 'A') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('HeapProfiler.collectGarbage')
      const before = await cdp.send('Runtime.getHeapUsage')
      const metrics = await page.evaluate(() => {
        const result = window.__karu!.snapVertexProbe(5) as Record<string, unknown>
        ;(window as Window & { __snapHold?: unknown }).__snapHold = result
        const { index: _index, ...metrics } = result
        return metrics
      })
      await cdp.send('HeapProfiler.collectGarbage')
      const after = await cdp.send('Runtime.getHeapUsage')
      console.log('SNAP_FINAL_VERTEX_PROBE', JSON.stringify({ ...metrics, heapDelta: after.usedSize - before.usedSize, backingDelta: (after.backingStorageSize ?? 0) - (before.backingStorageSize ?? 0) }))
      await page.evaluate(() => { delete (window as Window & { __snapHold?: unknown }).__snapHold })
      await cdp.detach()
    }
    const result = await frames(page, 5, mode)
    console.log('SNAP_FINAL_FRAMES', JSON.stringify({ mode, ...result }))
    expect(result.p95).toBeLessThanOrEqual(20); results.push(result)
  }
  expect(results[1].p95 - results[0].p95).toBeLessThanOrEqual(2)
})
