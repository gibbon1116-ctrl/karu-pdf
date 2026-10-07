import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { VectorSymbolMatch } from '../src/core/vectorSymbolSearch'

// Matched automatically by the existing bench project's *.perf.spec.ts rule.
const realFile = 'test-data/real/七ヶ浜町_実施設計図.pdf'
const measurements: unknown[] = []
test.afterAll(async () => {
  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile('test-results/vector-paths-perf.json', JSON.stringify({
    timestamp: new Date().toISOString(), measurements,
    conditions: {
      workers: 3, zoom: 2, scrollPx: 1500,
      extraction: 'content-only; display-cache reuse only on pages without annotations/widgets, otherwise temporary list; ms.total is Worker execution; round-trip includes queue and delivery',
      frames: 'rAF intervals wholly inside extraction request/response marks; excludes endpoint preparation and query batches; baseline 600ms',
      scroll: 'one 1500px scroll on first frame inside extraction marks; actual distance and overlap are recorded',
      snap: '1000 batches of 100 queries, times divided by 100, same as snapVertexProbe; capped at 200000 unique endpoints',
      limitations: 'frame p95 alone does not measure GPU/Worker memory or guarantee extraction began before scrolling; queued renders have priority, synchronous extraction cannot be preempted',
    },
  }, null, 2))
})

async function open(page: Page, file: string, pageIndex: number) {
  await page.goto('/karu-pdf/?test=1&workers=3&warm=0')
  await page.getByTestId('file-input').setInputFiles(path.resolve(file))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => window.__karu!.setZoom(2))
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle()), { timeout: 180_000 }).toBe(true)
  await page.evaluate(index => window.__karu!.scrollToPage(index), pageIndex)
  await expect(page.getByTestId(`annotation-layer-${pageIndex}`)).toBeVisible({ timeout: 180_000 })
  await expect.poll(() => page.evaluate(() => window.__karu!.isIdle() && window.__karu!.isSharp()), { timeout: 180_000 }).toBe(true)
}

for (const { file, pageIndex } of [
  ...[0, 1, 2].map(pageIndex => ({ file: realFile, pageIndex })),
  { file: 'test-data/heavy-300p.pdf', pageIndex: 5 },
]) {
  test(`vector extraction and endpoint snap: ${file}, page ${pageIndex + 1}`, async ({ page }) => {
    const exists = await fs.access(file).then(() => true, () => false)
    if (!exists) measurements.push({ file, pageIndex, skipped: 'PDF is unavailable' })
    test.skip(!exists, 'PDF is unavailable')
    await open(page, file, pageIndex)
    const baseline = await page.evaluate(async () => {
      const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')!, top = viewer.scrollTop
      const frames: number[] = []
      let id = 0, last = 0, first = true
      const tick = (t: number) => {
        if (last) frames.push(t - last)
        last = t
        if (first) { viewer.scrollTop += 1500; first = false }
        id = requestAnimationFrame(tick)
      }
      try {
        id = requestAnimationFrame(tick)
        await new Promise(resolve => setTimeout(resolve, 600))
        frames.sort((a, b) => a - b)
        return { samples: frames.length, p95Ms: frames[Math.ceil(frames.length * .95) - 1] ?? null, scrollPx: viewer.scrollTop - top }
      } finally { cancelAnimationFrame(id); viewer.scrollTop = top }
    })
    await expect.poll(() => page.evaluate(() => window.__karu!.isIdle() && window.__karu!.isSharp()), { timeout: 180_000 }).toBe(true)
    const measured = await page.evaluate(async pageIndex => {
      performance.clearMarks('karu-vector-extract-start'); performance.clearMarks('karu-vector-extract-end')
      const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')!, top = viewer.scrollTop
      const intervals: Array<{ start: number; end: number }> = []
      let id = 0, last = 0, scrollAt: number | null = null, actualScroll = 0
      const tick = (t: number) => {
        const now = performance.now()
        if (last) intervals.push({ start: last, end: t })
        last = t
        if (scrollAt === null && performance.getEntriesByName('karu-vector-extract-start').length && !performance.getEntriesByName('karu-vector-extract-end').length) {
          viewer.scrollTop += 1500; actualScroll = viewer.scrollTop - top; scrollAt = now
        }
        id = requestAnimationFrame(tick)
      }
      try {
        id = requestAnimationFrame(tick)
        const result = await window.__karu!.vectorProbe(pageIndex)
        const start = performance.getEntriesByName('karu-vector-extract-start').at(-1)!.startTime
        const end = performance.getEntriesByName('karu-vector-extract-end').at(-1)!.startTime
        const frames = intervals.filter(i => i.start >= start && i.end <= end).map(i => i.end - i.start).sort((a, b) => a - b)
        return { ...result, extractionRoundTripMs: end - start,
          scroll: { requestedPx: 1500, actualPx: actualScroll, duringRequest: scrollAt !== null && scrollAt >= start && scrollAt < end,
            samples: frames.length, p95Ms: frames[Math.ceil(frames.length * .95) - 1] ?? null, maxMs: frames.at(-1) ?? null } }
      } finally { cancelAnimationFrame(id); viewer.scrollTop = top }
    }, pageIndex)
    const hardware = await page.evaluate(() => window.__karu!.getHardwareInfo())
    const record = { file, pageIndex, pageOneBased: pageIndex + 1, browser: page.context().browser()?.version(), hardware, baseline, ...measured,
      frameP95DeltaMs: baseline.p95Ms === null || measured.scroll.p95Ms === null ? null : measured.scroll.p95Ms - baseline.p95Ms }
    measurements.push(record)
    console.log('VECTOR_PATHS_PERF', JSON.stringify(record))
    expect(measured.transferBytes).toBe(measured.segmentCount * 16)
    expect(measured.segmentCount).toBeLessThanOrEqual(400_000)
    expect(measured.endpointCount).toBeLessThanOrEqual(200_000)
    // Timings and absent overlapping frames are observations, not a pass/fail adoption gate.
  })
}

test('vector desk symbols: threshold .85/.75, page 1, candidate image', async ({ page }) => {
  const exists = await fs.access(realFile).then(() => true, () => false)
  if (!exists) measurements.push({ file: realFile, searchSkipped: 'PDF is unavailable' })
  test.skip(!exists, 'real drawing PDF is unavailable')
  await open(page, realFile, 0)
  const results = []
  for (const threshold of [.85, .75]) {
    const result = await page.evaluate(threshold => window.__karu!.vectorSymbolSearch({ pageIndex: 0, sampleRect: [742, 174, 753, 182], threshold, rotations: false }), threshold)
    results.push({ threshold, ...result, candidateCount: result.matches.length })
    console.log('VECTOR_DESK_SYMBOLS', JSON.stringify({ threshold, extractMs: result.extractMs, searchMs: result.searchMs, template: result.template, candidateCount: result.matches.length }))
  }
  measurements.push({ file: realFile, pageIndex: 0, sampleRect: [742, 174, 753, 182], searches: results })
  // Image generation follows every measurement; rendering cannot distort timings.
  // Red = .85, orange = additional .75 candidates.
  await candidateImage(realFile, results[0].matches, results[1].matches)
})

async function candidateImage(file: string, strict: VectorSymbolMatch[], loose: VectorSymbolMatch[]) {
  const { default: mupdf } = await import('mupdf')
  const document = mupdf.Document.openDocument(await fs.readFile(file), 'application/pdf'), page = document.loadPage(0)
  try {
    const bounds = page.getBounds(), scale = Math.min(2, 3000 / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]))
    const width = Math.ceil((bounds[2] - bounds[0]) * scale), height = Math.ceil((bounds[3] - bounds[1]) * scale)
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
    try {
      pixmap.clear(255)
      const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
      try { page.runPageContents(device, [scale, 0, 0, scale, -bounds[0] * scale, -bounds[1] * scale]); device.close() } finally { device.destroy() }
      const pixels = pixmap.getPixels(), stride = pixmap.getStride(), components = pixmap.getNumberOfComponents()
      const pixel = (x: number, y: number, green: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return
        const at = y * stride + x * components
        pixels[at] = 255; pixels[at + 1] = green; pixels[at + 2] = 0
      }
      for (const { matches, green } of [{ matches: loose, green: 145 }, { matches: strict, green: 0 }]) {
        for (const match of matches) {
          const [x0, y0, x1, y1] = match.rect.map(v => Math.round(v * scale))
          for (let thickness = 0; thickness < 2; thickness++) {
            for (let x = x0; x <= x1; x++) { pixel(x, y0 + thickness, green); pixel(x, y1 - thickness, green) }
            for (let y = y0; y <= y1; y++) { pixel(x0 + thickness, y, green); pixel(x1 - thickness, y, green) }
          }
        }
      }
      await fs.mkdir('test-results', { recursive: true })
      await fs.writeFile('test-results/vector-symbol-candidates.png', pixmap.asPNG())
    } finally { pixmap.destroy() }
  } finally { page.destroy(); document.destroy() }
}
