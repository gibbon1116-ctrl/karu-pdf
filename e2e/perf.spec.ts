import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

interface BlankResult { ratio: number; longestMs: number }
interface RenderRequestLogEntry {
  worker: number
  priority: number
  key: string
  startMs: number
  endMs: number | null
}
interface PageZoomResult {
  zoomMs: number
  zoomFullMs: number
  pan250Ms: number
  pan500Ms: number
  pan1500Ms: number
  requestLog: RenderRequestLogEntry[]
  zoomFullRequestLog: RenderRequestLogEntry[]
}
interface ZoomFullResult { durationMs: number; requestLog: RenderRequestLogEntry[] }
interface BenchRow {
  workers: number
  warm: boolean
  openMs: number
  openSharpMs: number
  scroll: {
    cold1500: BlankResult
    cached1500: BlankResult
    cold3000: BlankResult
    cached3000: BlankResult
  }
  a1: PageZoomResult
  a4: PageZoomResult
  renderAverageMs: number
  renderP95Ms: number
  workerProcessed: number[]
}

const pdf = path.resolve('test-data/heavy-300p.pdf')
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const urlFor = (workers: number, warm: boolean) => `/karu-pdf/?test=1&workers=${workers}&warm=${warm ? 1 : 0}`

async function openPdf(page: Page): Promise<{ open: number; sharp: number }> {
  await page.evaluate(() => localStorage.removeItem('karu-pdf:view'))
  const before = await page.evaluate(() => ({
    open: window.__karu?.getMetrics().open.count ?? 0,
    sharp: window.__karu?.getMetrics().openSharp.count ?? 0,
  }))
  await page.getByTestId('file-input').setInputFiles(pdf)
  await expect.poll(() => page.evaluate((count) => (window.__karu?.getMetrics().open.count ?? 0) > count, before.open), { timeout: 180_000 }).toBe(true)
  await expect.poll(() => page.evaluate((count) => (window.__karu?.getMetrics().openSharp.count ?? 0) > count, before.sharp), { timeout: 180_000 }).toBe(true)
  return page.evaluate(() => ({
    open: window.__karu?.getMetrics().open.latest ?? 0,
    sharp: window.__karu?.getMetrics().openSharp.latest ?? 0,
  }))
}

async function waitSharp(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__karu?.isSharp() ?? false), { timeout: 180_000 }).toBe(true)
}

async function measureScroll(page: Page, pixelsPerSecond: 1500 | 3000): Promise<BlankResult> {
  const viewer = page.getByTestId('viewer')
  await viewer.evaluate((element) => { element.scrollTop = 0 })
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__karu?.resetBlankFrames())
  await viewer.hover()
  const delta = pixelsPerSecond / 10
  for (let step = 0; step < 50; step += 1) {
    await page.mouse.wheel(0, delta)
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(250)
  const result = await page.evaluate(() => {
    const blank = window.__karu!.getMetrics().blankFrames
    return { ratio: blank.ratio, longestMs: blank.longestMs }
  })
  console.log(`[perf-scroll] ${pixelsPerSecond}px/s`, JSON.stringify(result))
  return result
}

async function measurePan(
  page: Page,
  pageIndex: number,
  distance: 250 | 500 | 1500,
  resetToPageStart = true,
): Promise<number> {
  const viewer = page.getByTestId('viewer')
  if (resetToPageStart) {
    await viewer.evaluate((element, index) => {
      const pageElement = element.querySelector<HTMLElement>(`.page-view[data-page-index="${index}"]`)
      if (!pageElement) throw new Error(`ページ ${index + 1} のDOMがありません。`)
      element.scrollLeft = pageElement.offsetLeft
    }, pageIndex)
    await page.waitForTimeout(150)
    await waitSharp(page)
    await page.waitForTimeout(150)
  }
  const before = await page.evaluate(() => window.__karu?.getMetrics().panSettle.count ?? 0)
  await viewer.evaluate((element, value) => { element.scrollLeft += value }, distance)
  await expect.poll(() => page.evaluate((count) => (window.__karu?.getMetrics().panSettle.count ?? 0) > count, before), { timeout: 180_000 }).toBe(true)
  await waitSharp(page)
  return page.evaluate(() => window.__karu?.getMetrics().panSettle.latest ?? 0)
}

async function measureZoomPage(page: Page, pageIndex: number): Promise<PageZoomResult> {
  await page.getByRole('button', { name: '幅に合わせる' }).click()
  await page.evaluate((index) => window.__karu?.scrollToPage(index), pageIndex)
  await page.waitForTimeout(200)
  await waitSharp(page)
  const requestLogStart = await page.evaluate(() => performance.now())
  const before = await page.evaluate(() => window.__karu?.getMetrics().zoomSettle.count ?? 0)
  await page.evaluate(() => window.__karu?.setZoom(4))
  await expect.poll(() => page.evaluate((count) => (window.__karu?.getMetrics().zoomSettle.count ?? 0) > count, before), { timeout: 180_000 }).toBe(true)
  await waitSharp(page)
  const zoomMs = await page.evaluate(() => window.__karu?.getMetrics().zoomSettle.latest ?? 0)
  const pan250Ms = await measurePan(page, pageIndex, 250, false)
  const pan500Ms = await measurePan(page, pageIndex, 500)
  const pan1500Ms = await measurePan(page, pageIndex, 1500)
  const requestLog = await page.evaluate(({ index, start }) => {
    const log = (window as Window & { __karuRenderRequests?: RenderRequestLogEntry[] }).__karuRenderRequests ?? []
    return log.filter((entry) => entry.startMs >= start && entry.key.startsWith(`${index}:`))
  }, { index: pageIndex, start: requestLogStart })
  return { zoomMs, zoomFullMs: 0, pan250Ms, pan500Ms, pan1500Ms, requestLog, zoomFullRequestLog: [] }
}

async function measureZoomFull(page: Page, pageIndex: number): Promise<ZoomFullResult> {
  await page.getByRole('button', { name: '幅に合わせる' }).click()
  await page.evaluate((index) => window.__karu?.scrollToPage(index), pageIndex)
  await page.waitForTimeout(200)
  await waitSharp(page)
  const startedAt = await page.evaluate(() => performance.now())
  await page.evaluate(() => window.__karu?.setZoom(4))
  await expect.poll(() => page.evaluate((index) => {
    const element = document.querySelector<HTMLElement>(`.page-view[data-page-index="${index}"]`)
    return element?.dataset.detailStage === 'full' && element.dataset.sharp === 'true'
  }, pageIndex), { timeout: 180_000 }).toBe(true)
  const durationMs = await page.evaluate((start) => performance.now() - start, startedAt)
  await expect.poll(() => page.evaluate(({ index, start }) => {
    const log = (window as Window & { __karuRenderRequests?: RenderRequestLogEntry[] }).__karuRenderRequests ?? []
    return log.some((entry) => entry.startMs >= start && entry.priority === 2
      && entry.key.startsWith(`${index}:`) && entry.endMs !== null)
  }, { index: pageIndex, start: startedAt }), { timeout: 180_000 }).toBe(true)
  const requestLog = await page.evaluate(({ index, start }) => {
    const log = (window as Window & { __karuRenderRequests?: RenderRequestLogEntry[] }).__karuRenderRequests ?? []
    return log.filter((entry) => entry.startMs >= start && entry.key.startsWith(`${index}:`))
  }, { index: pageIndex, start: startedAt })
  return { durationMs, requestLog }
}

test('Worker 3本・warmなしの表示性能を計測する', async ({ page }) => {
  await fs.access(pdf)
  const rows: BenchRow[] = []

  const workers = 3
  const warm = false
  const openValues: number[] = []
  const sharpValues: number[] = []
  for (let run = 0; run < 3; run += 1) {
    await page.goto(urlFor(workers, warm))
    const opened = await openPdf(page)
    openValues.push(opened.open)
    sharpValues.push(opened.sharp)
  }

  const cold1500 = await measureScroll(page, 1500)
  await page.waitForTimeout(1500)
  const cached1500 = await measureScroll(page, 1500)

  await page.goto(urlFor(workers, warm))
  await openPdf(page)
  const cold3000 = await measureScroll(page, 3000)
  await page.waitForTimeout(1500)
  const cached3000 = await measureScroll(page, 3000)

  const a1 = await measureZoomPage(page, 5)
  const a4 = await measureZoomPage(page, 0)
  const metrics = await page.evaluate(() => window.__karu!.getMetrics())
  const stats = await page.evaluate(() => window.__karu!.getWorkerStats())

  const a1FullPage = await page.context().newPage()
  await a1FullPage.goto(urlFor(workers, warm))
  await openPdf(a1FullPage)
  const a1Full = await measureZoomFull(a1FullPage, 5)
  a1.zoomFullMs = a1Full.durationMs
  a1.zoomFullRequestLog = a1Full.requestLog
  await a1FullPage.close()

  const a4FullPage = await page.context().newPage()
  await a4FullPage.goto(urlFor(workers, warm))
  await openPdf(a4FullPage)
  const a4Full = await measureZoomFull(a4FullPage, 0)
  a4.zoomFullMs = a4Full.durationMs
  a4.zoomFullRequestLog = a4Full.requestLog
  await a4FullPage.close()
  rows.push({
    workers,
    warm,
    openMs: median(openValues),
    openSharpMs: median(sharpValues),
    scroll: { cold1500, cached1500, cold3000, cached3000 },
    a1,
    a4,
    renderAverageMs: metrics.renderWorker.average ?? 0,
    renderP95Ms: metrics.renderWorker.p95 ?? 0,
    workerProcessed: stats.workers.map((worker) => worker.processedCount),
  })

  const hardware = {
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    browser: await page.evaluate(() => window.__karu?.getHardwareInfo()),
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fs.mkdir('bench-results', { recursive: true })
  await fs.writeFile(`bench-results/perf-${timestamp}.json`, JSON.stringify({ timestamp, hardware, rows }, null, 2))
  console.table(rows.map((row) => ({
    workers: row.workers,
    warm: row.warm,
    open_ms: row.openMs.toFixed(1),
    open_sharp_ms: row.openSharpMs.toFixed(1),
    cold1500_blank_pct: (row.scroll.cold1500.ratio * 100).toFixed(1),
    cold1500_longest_ms: row.scroll.cold1500.longestMs.toFixed(1),
    A1_zoom_ms: row.a1.zoomMs.toFixed(1),
    A1_zoom_full_ms: row.a1.zoomFullMs.toFixed(1),
    A1_pan250_ms: row.a1.pan250Ms.toFixed(1),
    A1_pan500_ms: row.a1.pan500Ms.toFixed(1),
    A1_pan1500_ms: row.a1.pan1500Ms.toFixed(1),
    A4_zoom_ms: row.a4.zoomMs.toFixed(1),
    A4_zoom_full_ms: row.a4.zoomFullMs.toFixed(1),
    A4_pan250_ms: row.a4.pan250Ms.toFixed(1),
    A4_pan500_ms: row.a4.pan500Ms.toFixed(1),
    A4_pan1500_ms: row.a4.pan1500Ms.toFixed(1),
    render_avg_ms: row.renderAverageMs.toFixed(1),
    render_p95_ms: row.renderP95Ms.toFixed(1),
    processed: row.workerProcessed.join('/'),
  })))
  console.log(hardware)
  expect(rows).toHaveLength(1)
})
