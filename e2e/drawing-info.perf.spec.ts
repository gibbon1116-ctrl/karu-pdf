import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test('図面情報の全ページ読取と読取中スクロールを各PDFで一度測定する', async ({ page }) => {
  const reports: unknown[] = []
  for (const file of ['heavy-300p.pdf', 'real/七ヶ浜町_実施設計図.pdf']) {
    await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
    await page.getByTestId('file-input').setInputFiles(path.resolve('test-data', file))
    await expect(page.getByTestId('annotation-layer-0')).toBeVisible({ timeout: 180_000 })
    expect(await page.evaluate(() => window.__karu!.getDrawingScanMetrics().totalMs)).toBe(0)
    await page.evaluate(() => {
      const w = window as Window & { __drawingFrames?: { samples: number[]; frame: number; last: number } }
      const state = w.__drawingFrames = { samples: [] as number[], frame: 0, last: 0 }
      const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')!
      const tick = (t: number) => {
        if (window.__karu!.getDrawingScanMetrics().scanning) {
          if (state.last) state.samples.push(t - state.last)
          state.last = t; viewer.scrollTop += 40
          if (viewer.scrollTop > 1600) viewer.scrollTop = 0
        } else state.last = 0
        state.frame = requestAnimationFrame(tick)
      }
      state.frame = requestAnimationFrame(tick)
    })
    await page.getByRole('tab', { name: '数量', exact: true }).click(); await page.getByTestId('fixture-panel').getByRole('button', { name: '管理', exact: true }).click()
    await expect(page.getByTestId('drawing-scan-status')).toContainText('読み取りました', { timeout: 180_000 })
    const result = await page.evaluate(() => {
      const w = window as Window & { __drawingFrames?: { samples: number[]; frame: number } }, state = w.__drawingFrames!
      cancelAnimationFrame(state.frame); delete w.__drawingFrames
      const samples = state.samples.sort((a, b) => a - b), metrics = window.__karu!.getDrawingScanMetrics()
      return { hardware: window.__karu!.getHardwareInfo(), pages: window.__karu!.getDrawingInfos().length, totalMs: metrics.totalMs,
        averageMs: metrics.totalMs / metrics.pageMs.length, workerTotalMs: metrics.pageMs.reduce((a, b) => a + b, 0),
        workerAverageMs: metrics.pageMs.reduce((a, b) => a + b, 0) / metrics.pageMs.length,
        samples: samples.length, p95: samples[Math.ceil(samples.length * .95) - 1] ?? null, max: samples.at(-1) ?? null }
    })
    expect(result.pages).toBe(file === 'heavy-300p.pdf' ? 300 : 30)
    expect(result.samples).toBeGreaterThan(0)
    reports.push({ file, browserVersion: page.context().browser()?.version(), workers: 3, zoom: '初期の幅合わせ', scroll: 'rAFごと40px、1600pxで先頭へ', ...result })
    console.log('DRAWING_INFO_PERF', JSON.stringify(reports.at(-1)))
  }
  await fs.mkdir('work/spec05b', { recursive: true })
  await fs.writeFile('work/spec05b/performance.json', JSON.stringify(reports, null, 2))
})

