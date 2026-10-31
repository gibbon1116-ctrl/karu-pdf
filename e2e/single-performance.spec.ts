import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

test('300ページの図面で用紙一覧と表示履歴を軽く操作し、外部通信と自動解析を追加しない', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    Object.assign(window, { __businessWorkerJobs: [] as string[] })
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function(message, options) {
      if (message?.type) (window as any).__businessWorkerJobs.push(message.type)
      return Reflect.apply(original, this, [message, options])
    }
  })
  const outgoing: string[] = []
  page.on('request', request => { if (/^https?:/i.test(request.url())) outgoing.push(request.url()) })
  const html = (await fs.readdir('dist-single')).find(name => name.endsWith('.html'))!
  await page.goto(pathToFileURL(path.resolve('dist-single', html)).href + '?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/heavy-300p.pdf'))
  await expect(page.getByText('1 / 300 ページ', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.isSharp())).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  const before = await page.evaluate(() => ({ jobs: (window as any).__businessWorkerJobs.length, metrics: window.__karu!.getMetrics() }))
  const timings: number[] = []
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'ページ▼', exact: true }).click()
    const elapsed = await page.getByRole('menuitem', { name: '用紙サイズ一覧…', exact: true }).evaluate(async element => {
      const start = performance.now(); (element as HTMLButtonElement).click()
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      return performance.now() - start
    })
    const dialog = page.getByRole('dialog', { name: '用紙サイズ一覧' })
    await expect(dialog.locator('tbody tr')).toHaveCount(300)
    timings.push(elapsed)
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
  }
  await page.evaluate(() => window.__karu!.scrollToPage(5))
  await expect(page.locator('.page-view[data-page-index="5"]')).toHaveAttribute('data-sharp', 'true')
  await page.locator('.viewer').focus(); await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.getByText('1 / 300 ページ', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle())).toBe(true)
  const jobs = await page.evaluate(() => (window as any).__businessWorkerJobs as string[])
  expect(jobs.filter(type => ['listAllAnnotations', 'searchDocument', 'prepareOutput', 'applyAndSave'].includes(type))).toEqual([])
  expect(outgoing).toEqual([])
  expect(Math.max(...timings)).toBeLessThan(1000)
  const result = { pdfBytes: (await fs.stat('test-data/heavy-300p.pdf')).size, pageCount: 300, sheetDialogMs: timings, metricsAtOpen: before.metrics, totalWorkerJobs: jobs.length, initialWorkerJobs: before.jobs, externalHttpRequests: outgoing.length, automaticFullDocumentScans: 0, note: 'Single current build on this PC; no comparative speed guarantee.' }
  await fs.mkdir('work/implementation-results', { recursive: true })
  await fs.writeFile('work/implementation-results/performance.json', JSON.stringify(result, null, 2))
  console.log('BUSINESS_PERFORMANCE', JSON.stringify(result))
})
