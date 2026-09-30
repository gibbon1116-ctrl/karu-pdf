import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

interface BlankResult { ratio: number; longestMs: number }
interface RenderRequestLogEntry {
  worker: number
  priority: number
  key: string
  startMs: number
  endMs: number | null
}
interface WorkerRenderLogEntry {
  jobId: number
  pageIndex: number
  worker: number
  priority: number
  deviceRect: [number, number, number, number] | null
  queuedMs: number
  startedMs: number | null
  endedMs: number | null
  cancelled: boolean
}
interface PageZoomResult {
  zoomMs: number
  zoomFullMs: number
  pan250Ms: number
  pan500Ms: number
  pan1500Ms: number
  requestLog: RenderRequestLogEntry[]
  zoomFullRequestLog: RenderRequestLogEntry[]
  workerRequestLog: WorkerRenderLogEntry[]
  zoomFullWorkerRequestLog: WorkerRenderLogEntry[]
}
interface ZoomFullResult {
  durationMs: number
  requestLog: RenderRequestLogEntry[]
  workerRequestLog: WorkerRenderLogEntry[]
}
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
  detailRecoveryCount: number
}

const pdf = path.resolve('test-data/heavy-300p.pdf')
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const urlFor = (workers: number, warm: boolean) => `/karu-pdf/?test=1&workers=${workers}&warm=${warm ? 1 : 0}`
let closedContextRecoveryCounts: number[] = []

async function isolatedPage(browser: Browser): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error('[pageerror]', error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser-console]', message.text())
  })
  return {
    page,
    close: async () => {
      const count = await page.evaluate(() => (
        (window as Window & { __karuGetDetailRecoveryCount?: () => number }).__karuGetDetailRecoveryCount?.() ?? 0
      )).catch(() => 0)
      closedContextRecoveryCounts.push(count)
      await context.close()
    },
  }
}

async function renderDiagnostics(page: Page, label: string): Promise<void> {
  const state = await page.evaluate(async () => {
    const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')
    const viewerRect = viewer?.getBoundingClientRect()
    const visiblePages = [...document.querySelectorAll<HTMLElement>('.page-view')].filter((element) => {
      const rect = element.getBoundingClientRect()
      return Boolean(viewerRect && rect.bottom > viewerRect.top && rect.top < viewerRect.bottom)
    }).map((element) => ({
      page: Number(element.dataset.pageIndex) + 1,
      sharp: element.dataset.sharp,
      visible: element.dataset.visible,
      zoomStable: element.dataset.zoomStable,
      usesDetail: element.dataset.usesDetail,
      detailStage: element.dataset.detailStage,
      detailKey: element.querySelector<HTMLElement>('.detail-canvas')?.dataset.detailKey ?? null,
      desiredKey: element.dataset.detailDesiredKey,
      syncKey: element.dataset.detailSyncKey,
      syncDisposed: element.dataset.detailSyncDisposed,
      safetyWatch: element.dataset.detailSafetyWatch,
    }))
    const requests = ((window as Window & { __karuRenderRequests?: RenderRequestLogEntry[] }).__karuRenderRequests ?? []).slice(-100)
    const workerRequests = ((window as Window & { __karuWorkerRenderRequests?: WorkerRenderLogEntry[] }).__karuWorkerRenderRequests ?? []).slice(-100)
    const detailWindow = window as Window & {
      __karuGetDetailRecoveryCount?: () => number
      __karuDetailTransitions?: Array<{ pageIndex: number; event: string; key: string | null; at: number }>
    }
    return {
      scroll: viewer ? { left: viewer.scrollLeft, top: viewer.scrollTop } : null,
      zoomText: document.querySelector('.zoom-output')?.textContent ?? null,
      visiblePages,
      unsharpPages: visiblePages.filter((item) => item.sharp !== 'true').map((item) => item.page),
      requests,
      workerRequests,
      detailRecoveryCount: detailWindow.__karuGetDetailRecoveryCount?.() ?? 0,
      detailTransitions: (detailWindow.__karuDetailTransitions ?? []).slice(-100),
      workers: await Promise.race([
        window.__karu?.getWorkerStats(),
        new Promise((resolve) => window.setTimeout(() => resolve({ timedOut: true }), 2_000)),
      ]),
    }
  })
  console.error(`[render-diagnostics] ${label}`, JSON.stringify(state))
}

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
  try {
    await expect.poll(() => page.evaluate(() => window.__karu?.isSharp() ?? false), { timeout: 180_000 }).toBe(true)
  } catch (error) {
    await renderDiagnostics(page, 'isSharp')
    throw error
  }
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
  const scroll = await viewer.evaluate((element, value) => {
    const start = element.scrollLeft
    element.scrollLeft += value
    return { start, end: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }
  }, distance)
  if (scroll.end === scroll.start) throw new Error(`横移動できません: ${JSON.stringify({ pageIndex, distance, scroll })}`)
  try {
    await expect.poll(() => page.evaluate((count) => (window.__karu?.getMetrics().panSettle.count ?? 0) > count, before), { timeout: 180_000 }).toBe(true)
  } catch (error) {
    await renderDiagnostics(page, `pan-settle p${pageIndex + 1} ${distance}px ${JSON.stringify(scroll)}`)
    throw error
  }
  await waitSharp(page)
  return page.evaluate(() => window.__karu?.getMetrics().panSettle.latest ?? 0)
}

async function fitWidthAndScrollTo(page: Page, pageIndex: number): Promise<void> {
  const before = await page.evaluate(() => window.__karu?.getMetrics().zoomSettle.count ?? 0)
  await page.getByRole('button', { name: '幅に合わせる' }).click()
  await expect.poll(() => page.evaluate((count) => (
    window.__karu?.getMetrics().zoomSettle.count ?? 0
  ) > count, before), { timeout: 180_000 }).toBe(true)
  await page.evaluate((index) => window.__karu?.scrollToPage(index), pageIndex)
  await page.waitForTimeout(200)
  await waitSharp(page)
}

async function measureZoomPage(page: Page, pageIndex: number): Promise<PageZoomResult> {
  await fitWidthAndScrollTo(page, pageIndex)
  const requestLogStart = await page.evaluate(() => performance.now())
  const before = await page.evaluate(() => window.__karu?.getMetrics().zoomSettle.count ?? 0)
  await page.evaluate(() => window.__karu?.setZoom(4))
  try {
    await expect.poll(() => page.evaluate((count) => (
      window.__karu?.getMetrics().zoomSettle.count ?? 0
    ) > count, before), { timeout: 180_000 }).toBe(true)
  } catch (error) {
    await renderDiagnostics(page, `zoom-settle p${pageIndex + 1}`)
    throw error
  }
  await waitSharp(page)
  const zoomMs = await page.evaluate(() => window.__karu?.getMetrics().zoomSettle.latest ?? 0)
  const pan250Ms = await measurePan(page, pageIndex, 250, false)
  const pan500Ms = await measurePan(page, pageIndex, 500)
  const pan1500Ms = await measurePan(page, pageIndex, 1500)
  const requestLog = await page.evaluate(({ index, start }) => {
    const log = (window as Window & { __karuRenderRequests?: RenderRequestLogEntry[] }).__karuRenderRequests ?? []
    return log.filter((entry) => entry.startMs >= start && entry.key.startsWith(`${index}:`))
  }, { index: pageIndex, start: requestLogStart })
  const workerRequestLog = await page.evaluate((start) => {
    const log = (window as Window & { __karuWorkerRenderRequests?: WorkerRenderLogEntry[] }).__karuWorkerRenderRequests ?? []
    return log.filter((entry) => entry.queuedMs >= start - 5_000)
  }, requestLogStart)
  return {
    zoomMs,
    zoomFullMs: 0,
    pan250Ms,
    pan500Ms,
    pan1500Ms,
    requestLog,
    zoomFullRequestLog: [],
    workerRequestLog,
    zoomFullWorkerRequestLog: [],
  }
}

async function measureZoomFull(page: Page, pageIndex: number): Promise<ZoomFullResult> {
  await fitWidthAndScrollTo(page, pageIndex)
  const startedAt = await page.evaluate(() => performance.now())
  await page.evaluate(() => window.__karu?.setZoom(4))
  try {
    await expect.poll(() => page.evaluate((index) => {
      const element = document.querySelector<HTMLElement>(`.page-view[data-page-index="${index}"]`)
      return element?.dataset.detailStage === 'full' && element.dataset.sharp === 'true'
    }, pageIndex), { timeout: 180_000 }).toBe(true)
  } catch (error) {
    await renderDiagnostics(page, `zoom-full p${pageIndex + 1}`)
    throw error
  }
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
  const workerRequestLog = await page.evaluate(({ index, start }) => {
    const log = (window as Window & { __karuWorkerRenderRequests?: WorkerRenderLogEntry[] }).__karuWorkerRenderRequests ?? []
    return log.filter((entry) => entry.queuedMs >= start && entry.pageIndex === index)
  }, { index: pageIndex, start: startedAt })
  return { durationMs, requestLog, workerRequestLog }
}

test('Worker 4本（文書1＋描画3）・warmなしの表示性能を計測する', async ({ browser }) => {
  await fs.access(pdf)
  closedContextRecoveryCounts = []
  const rows: BenchRow[] = []

  const workers = 4
  const warm = false
  const openValues: number[] = []
  const sharpValues: number[] = []
  for (let run = 0; run < 3; run += 1) {
    const isolatedRun = await isolatedPage(browser)
    const runPage = isolatedRun.page
    try {
      await runPage.goto(urlFor(workers, warm))
      const opened = await openPdf(runPage)
      openValues.push(opened.open)
      sharpValues.push(opened.sharp)
    } finally {
      await isolatedRun.close()
    }
  }

  const scroll1500Run = await isolatedPage(browser)
  const scroll1500Page = scroll1500Run.page
  let cold1500!: BlankResult
  let cached1500!: BlankResult
  try {
    await scroll1500Page.goto(urlFor(workers, warm))
    await openPdf(scroll1500Page)
    cold1500 = await measureScroll(scroll1500Page, 1500)
    await scroll1500Page.waitForTimeout(1500)
    cached1500 = await measureScroll(scroll1500Page, 1500)
  } finally {
    await scroll1500Run.close()
  }

  const scroll3000Run = await isolatedPage(browser)
  const scroll3000Page = scroll3000Run.page
  let cold3000!: BlankResult
  let cached3000!: BlankResult
  try {
    await scroll3000Page.goto(urlFor(workers, warm))
    await openPdf(scroll3000Page)
    cold3000 = await measureScroll(scroll3000Page, 3000)
    await scroll3000Page.waitForTimeout(1500)
    cached3000 = await measureScroll(scroll3000Page, 3000)
  } finally {
    await scroll3000Run.close()
  }

  const zoomRun = await isolatedPage(browser)
  const zoomPage = zoomRun.page
  let a1!: PageZoomResult
  let a4!: PageZoomResult
  let renderAverageMs = 0
  let renderP95Ms = 0
  let workerProcessed: number[] = []
  try {
    await zoomPage.goto(urlFor(workers, warm))
    await openPdf(zoomPage)
    a1 = await measureZoomPage(zoomPage, 5)
    a4 = await measureZoomPage(zoomPage, 0)
    const metrics = await zoomPage.evaluate(() => window.__karu!.getMetrics())
    const stats = await zoomPage.evaluate(() => Promise.race([
      window.__karu!.getWorkerStats(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5_000)),
    ]))
    renderAverageMs = metrics.renderWorker.average ?? 0
    renderP95Ms = metrics.renderWorker.p95 ?? 0
    workerProcessed = stats?.workers.map((worker) => worker.processedCount) ?? [-1, -1, -1]
  } finally {
    await zoomRun.close()
  }

  const a1FullRun = await isolatedPage(browser)
  const a1FullPage = a1FullRun.page
  try {
    await a1FullPage.goto(urlFor(workers, warm))
    await openPdf(a1FullPage)
    const a1Full = await measureZoomFull(a1FullPage, 5)
    a1.zoomFullMs = a1Full.durationMs
    a1.zoomFullRequestLog = a1Full.requestLog
    a1.zoomFullWorkerRequestLog = a1Full.workerRequestLog
  } finally {
    await a1FullRun.close()
  }

  const a4FullRun = await isolatedPage(browser)
  const a4FullPage = a4FullRun.page
  try {
    await a4FullPage.goto(urlFor(workers, warm))
    await openPdf(a4FullPage)
    const a4Full = await measureZoomFull(a4FullPage, 0)
    a4.zoomFullMs = a4Full.durationMs
    a4.zoomFullRequestLog = a4Full.requestLog
    a4.zoomFullWorkerRequestLog = a4Full.workerRequestLog
  } finally {
    await a4FullRun.close()
  }
  rows.push({
    workers,
    warm,
    openMs: median(openValues),
    openSharpMs: median(sharpValues),
    scroll: { cold1500, cached1500, cold3000, cached3000 },
    a1,
    a4,
    renderAverageMs,
    renderP95Ms,
    workerProcessed,
    detailRecoveryCount: closedContextRecoveryCounts.reduce((sum, count) => sum + count, 0),
  })

  const hardwareRun = await isolatedPage(browser)
  const browserHardware = await hardwareRun.page.evaluate(() => ({
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
  }))
  await hardwareRun.close()
  const hardware = {
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    browser: browserHardware,
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
    detail_recovery_count: row.detailRecoveryCount,
  })))
  console.log(hardware)
  expect(rows).toHaveLength(1)
  expect(rows[0].detailRecoveryCount).toBe(0)
})

test('画像として保存の性能を1回計測する', async ({ page }) => {
  await fs.access(pdf)
  await page.goto('/karu-pdf/?test=1&workers=4')
  await page.getByTestId('file-input').setInputFiles(pdf)
  await expect(page.getByText('1 / 300')).toBeVisible({ timeout: 180_000 })
  const result = await page.evaluate(async () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    let peakMainHeapBytes = memory?.usedJSHeapSize ?? null
    const timer = window.setInterval(() => {
      if (memory && peakMainHeapBytes !== null) peakMainHeapBytes = Math.max(peakMainHeapBytes, memory.usedJSHeapSize)
    }, 100)
    const started = performance.now()
    const storage = navigator.storage as StorageManager & {
      getDirectory(): Promise<{
        getFileHandle(name: string, options: { create: boolean }): Promise<{
          createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> }>
          getFile(): Promise<File>
        }>
        removeEntry(name: string): Promise<void>
      }>
    }
    const root = await storage.getDirectory()
    const temporaryName = 'rasterize-benchmark.pdf'
    try {
      const handle = await root.getFileHandle(temporaryName, { create: true })
      const writable = await handle.createWritable()
      const metrics = await window.__karu!.rasterizeToStream({
        dpi: 150,
        color: 'color',
        format: 'jpeg',
        pageIndexes: Array.from({ length: 300 }, (_, index) => index),
      }, {
        write: (data) => writable.write(new Uint8Array(data).buffer),
        close: () => writable.close(),
        abort: (reason) => writable.abort(reason),
      })
      return {
        elapsedMs: performance.now() - started,
        outputBytes: (await handle.getFile()).size,
        peakMainHeapBytes,
        metrics,
      }
    } finally {
      window.clearInterval(timer)
      await root.removeEntry(temporaryName).catch(() => undefined)
    }
  })
  console.log('[画像として保存 性能計測]', JSON.stringify(result))
  expect(result.outputBytes).toBeGreaterThan(0)
  expect(result.metrics?.pageCount).toBe(300)
})
