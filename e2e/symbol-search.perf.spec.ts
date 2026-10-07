import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { detectDrawingInfo, readDrawingInfo } from '../src/core/drawingInfo'
import { extractTextLines } from '../src/core/textExtract'
import type { Rect } from '../src/core/annotations'
import type { SymbolSearchTestHooks } from '../src/client/SymbolSearchClient'

// SYMBOL_SAMPLE=page,x0,y0,x1,y1: page is ONE-BASED; coordinates are top-left page points.
// Example invocation after building: SYMBOL_SAMPLE=12,100,200,112,212 npx playwright test --project=bench symbol-search.perf.spec.ts
// SYMBOL_ROTATIONS=1 enables all four rotations; SYMBOL_THRESHOLD defaults to 0.7.
test('visual search: real drawing timings, memory, scrolling, cancellation and candidate image', async ({ page }) => {
  const file = path.resolve('test-data/real/七ヶ浜町_実施設計図.pdf'), argument = process.env.SYMBOL_SAMPLE
  test.skip(!argument, 'SYMBOL_SAMPLE is required (one-based page,x0,y0,x1,y1)')
  const exists = await fs.access(file).then(() => true, () => false)
  test.skip(!exists, 'real drawing PDF is unavailable')
  const sample = argument!.split(',').map(Number)
  expect(sample).toHaveLength(5)
  expect(sample.every(Number.isFinite)).toBe(true)
  expect(Number.isInteger(sample[0]) && sample[0] >= 1).toBe(true)
  const sampleRect = sample.slice(1) as Rect
  expect(sampleRect[2]).toBeGreaterThan(sampleRect[0]); expect(sampleRect[3]).toBeGreaterThan(sampleRect[1])
  const rotations = process.env.SYMBOL_ROTATIONS === '1'
  const threshold = Number(process.env.SYMBOL_THRESHOLD ?? '0.7')
  expect(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1).toBe(true)

  // Identify the drawing title locally, outside browser performance measurements.
  // This never starts the application's quantity scan or changes the PDF.
  const { default: mupdf } = await import('mupdf')
  const pdfDocument = mupdf.Document.openDocument(await fs.readFile(file), 'application/pdf').asPDF() as import('mupdf').PDFDocument
  try {
    expect(sample[0]).toBeLessThanOrEqual(pdfDocument.countPages())
    let pageIndex = 0, title: string | undefined, titleErrors = 0
    for (let index = 0; index < pdfDocument.countPages(); index++) {
      const pdfPage = pdfDocument.loadPage(index)
      try {
        let name = readDrawingInfo(pdfPage)?.name
        if (!name) {
          const structured = pdfPage.toStructuredText('preserve-whitespace')
          try {
            const bounds = pdfPage.getBounds(), lines = extractTextLines(structured, bounds, 0).lines
            name = detectDrawingInfo(lines, bounds, 0, true).name
          } catch { titleErrors++ } finally { structured.destroy() }
        }
        if (name?.includes('電灯')) { pageIndex = index; title = name; break }
      } finally { pdfPage.destroy() }
    }
    await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
    await page.getByTestId('file-input').setInputFiles(file)
    await expect(page.getByTestId('annotation-layer-0')).toBeVisible({ timeout: 180_000 })
    await expect.poll(() => page.evaluate(() => window.__karu!.isIdle()), { timeout: 180_000 }).toBe(true)
    const docId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
    const request = { docId, pageIndex, samplePageIndex: sample[0] - 1, sampleRect, options: { rotations, threshold } }
    const measured = await page.evaluate(async request => {
      const api = window.__karu! as typeof window.__karu & SymbolSearchTestHooks
      const memory = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
      const frames: number[] = [], viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')!
      const originalTop = viewer.scrollTop
      let frame = 0, last = 0
      const tick = (time: number) => {
        if (last) frames.push(time - last)
        last = time; viewer.scrollTop += 40
        if (viewer.scrollTop > 1600) viewer.scrollTop = 0
        frame = requestAnimationFrame(tick)
      }
      const before = memory()
      frame = requestAnimationFrame(tick)
      try {
        const result = await api.symbolSearch(request), after = memory()
        cancelAnimationFrame(frame); viewer.scrollTop = originalTop
        await new Promise(resolve => setTimeout(resolve, 2000))
        const afterTwoSeconds = memory()
        frames.sort((a, b) => a - b)
        return { ...result, heap: { before, after, afterTwoSeconds }, scroll: { samples: frames.length,
          p95Ms: frames[Math.ceil(frames.length * .95) - 1] ?? null, maxMs: frames.at(-1) ?? null } }
      } finally { cancelAnimationFrame(frame); viewer.scrollTop = originalTop }
    }, request)
    const afterMs = process.env.SYMBOL_CANCEL_AFTER_MS === undefined
      ? Math.ceil(measured.metrics.renderMs + Math.max(20, measured.metrics.searchMs * .2)) : Number(process.env.SYMBOL_CANCEL_AFTER_MS)
    expect(Number.isFinite(afterMs) && afterMs >= 0).toBe(true)
    const cancellation = await page.evaluate(({ request, afterMs }) =>
      (window.__karu! as typeof window.__karu & SymbolSearchTestHooks).symbolSearchCancelTest(request, afterMs), { request, afterMs })
    await fs.mkdir('test-results', { recursive: true })
    const report = { file, timestamp: new Date().toISOString(), browserVersion: page.context().browser()?.version(),
      hardware: await page.evaluate(() => window.__karu!.getHardwareInfo()), workers: 3,
      samplePageOneBased: sample[0], sampleRect, searchPageOneBased: pageIndex + 1, title: title ?? null, titleErrors,
      options: { rotations, threshold },
      titleFallback: !title, metrics: measured.metrics, candidateCount: measured.candidates.length,
      candidates: measured.candidates, heap: measured.heap, scroll: measured.scroll, cancellation: { afterMs, ...cancellation },
      conditions: { scroll: '40px per rAF, reset after 1600px; includes render and Worker search',
        memory: 'usedJSHeapSize covers the browser main context; Worker/GPU memory is excluded; no forced GC',
        transfer: 'gray-buffer round-trip overhead excluding Worker search; includes startup/scheduling',
        cancellation: 'a completed search returns cancelled=false; inspect render timing when selecting SYMBOL_CANCEL_AFTER_MS' } }
    await fs.writeFile('test-results/symbol-search-perf.json', JSON.stringify(report, null, 2))
    console.log('SYMBOL_SEARCH_REAL_PERF', JSON.stringify({ ...report, candidates: undefined }))

    // Render the source content directly; the application viewport and scroll position do not affect this image.
    // Run after measurements, so no other heavy rendering overlaps them.
    const source = pdfDocument.loadPage(pageIndex)
    try {
      const scale = measured.metrics.renderScale, bounds = source.getBounds()
      const width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale)
      const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], true)
      try {
        pixmap.clear(255)
        const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
        try { source.runPageContents(device, mupdf.Matrix.scale(scale, scale)); device.close() } finally { device.destroy() }
        const pixels = pixmap.getPixels(), components = pixmap.getNumberOfComponents(), stride = pixmap.getStride()
        const red = (x: number, y: number) => {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const at = y * stride + x * components
            pixels[at] = 255; pixels[at + 1] = 0; pixels[at + 2] = 0; if (components === 4) pixels[at + 3] = 255
          }
        }
        for (const candidate of measured.candidates) {
          const [x0, y0, x1, y1] = candidate.rect.map(v => Math.round(v * scale))
          for (let thickness = 0; thickness < 2; thickness++) {
            for (let x = x0; x <= x1; x++) { red(x, y0 + thickness); red(x, y1 - thickness) }
            for (let y = y0; y <= y1; y++) { red(x0 + thickness, y); red(x1 - thickness, y) }
          }
        }
        await fs.writeFile('test-results/symbol-search-candidates.png', pixmap.asPNG())
      } finally { pixmap.destroy() }
    } finally { source.destroy() }
    expect(measured.metrics.pagePixels).toBeLessThanOrEqual(16_000_000)
    expect(measured.scroll.samples).toBeGreaterThan(0)
    if (cancellation.cancelled) expect(cancellation.settledMs).toBeLessThan(1000)
  } finally { pdfDocument.destroy() }
})
